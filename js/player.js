// ============================================================
//  WalkWorld 3D — player.js
//
//  Handles all local-player logic:
//    • THREE.PerspectiveCamera (exported — used by renderer.js)
//    • Pointer Lock API (mouse capture / release)
//    • Mouse-look: yaw (left/right) + pitch (up/down, clamped)
//    • WASD / arrow keys + configurable key-binds
//    • Sprint (Shift), Jump (Space), gravity, terrain-snap
//    • Axis-separated collision via world.isBlocked
//    • Mobile virtual joystick via setTouchInput()
//
//  Settings integration:
//    window.WALKWORLD_SENS  — mouse sensitivity (set by game.js)
//    window.WALKWORLD_BINDS — key-bind map     (set by game.js)
//
//  Exports
//  ─────────────────────────────────────────────────────────────
//  camera                  THREE.PerspectiveCamera
//  Player                  class — main player controller
//  requestPointerLock(el)  — call on canvas / overlay click
//  isPointerLocked()       — true when mouse is captured
//  setTouchInput(dx, dz)   — drive movement from virtual joystick
// ============================================================

import { getHeightAt, isBlocked, SPAWN, HALF } from './world.js';

// ── Movement & physics constants ─────────────────────────────
const MOVE_SPEED   = 9.0;             // world units / second (walk)
const SPRINT_MOD   = 1.65;            // Shift multiplier
const JUMP_VY      = 7.5;             // upward velocity on jump
const GRAVITY      = -22.0;           // downward acceleration (units/s²)
const EYE_HEIGHT   = 1.65;            // camera above player feet
const PITCH_LIMIT  = Math.PI * 0.44;  // ≈ 79° — prevents gimbal flip
const SENS_DEFAULT = 0.0022;          // fallback sensitivity
const STEP_UP      = 0.38;            // max terrain step climbed per frame

// ── Default key binds (overridden by window.WALKWORLD_BINDS) ─
const DEFAULT_BINDS = {
  forward : 'KeyW',
  back    : 'KeyS',
  left    : 'KeyA',
  right   : 'KeyD',
  jump    : 'Space',
  sprint  : 'ShiftLeft',
  chat    : 'KeyT',
};

// ── Camera ───────────────────────────────────────────────────
// Exported so renderer.js can pass it to THREE.WebGLRenderer.
// rotation.order = 'YXZ' is applied in update() every frame.
export const camera = new THREE.PerspectiveCamera(
  72,                                       // vertical FOV (degrees)
  window.innerWidth / window.innerHeight,   // aspect ratio
  0.05,                                     // near clip plane
  500                                       // far clip plane
);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

// ── Pointer Lock ─────────────────────────────────────────────
let _locked  = false;
let _mouseDX = 0;
let _mouseDY = 0;

document.addEventListener('pointerlockchange', () => {
  _locked  = !!document.pointerLockElement;
  _mouseDX = 0;
  _mouseDY = 0;
});

document.addEventListener('mousemove', e => {
  if (!_locked) return;
  _mouseDX += e.movementX;
  _mouseDY += e.movementY;
});

/** Call when the user clicks the lock overlay or canvas. */
export function requestPointerLock(element) {
  element.requestPointerLock();
}

/** Returns true while the mouse is captured. */
export function isPointerLocked() {
  return _locked;
}

// ── Keyboard ─────────────────────────────────────────────────
const KEYS = new Set();

window.addEventListener('keydown', e => {
  KEYS.add(e.code);
  // Block browser scroll / page-jump shortcuts while in-game
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
    if (_locked) e.preventDefault();
  }
});

window.addEventListener('keyup', e => KEYS.delete(e.code));

/**
 * Returns true if a bound action key is currently held.
 * Checks the configured bind first, then falls back to arrow keys
 * alongside WASD so both always work regardless of rebinds.
 */
function _pressed(action) {
  const binds = window.WALKWORLD_BINDS || DEFAULT_BINDS;
  const code  = binds[action] || DEFAULT_BINDS[action];
  if (KEYS.has(code)) return true;
  // Arrow key fallbacks for movement — always active
  if (action === 'forward' && KEYS.has('ArrowUp'))    return true;
  if (action === 'back'    && KEYS.has('ArrowDown'))  return true;
  if (action === 'left'    && KEYS.has('ArrowLeft'))  return true;
  if (action === 'right'   && KEYS.has('ArrowRight')) return true;
  return false;
}

// ── Virtual Joystick (mobile) ─────────────────────────────────
// dx = strafe (−1…+1),  dz = forward/back (+1 = backward)
let _touchDX = 0;
let _touchDZ = 0;

export function setTouchInput(dx, dz) {
  _touchDX = dx;
  _touchDZ = dz;
}

// ============================================================
//  PLAYER CLASS
// ============================================================
export class Player {

  /**
   * @param {string} name   — display name (from sessionStorage)
   * @param {string} colour — hex colour string
   */
  constructor(name, colour) {
    this.name   = name;
    this.colour = colour;

    // World-space position of the player's FEET
    this.x = SPAWN.x;
    this.y = SPAWN.y;
    this.z = SPAWN.z;

    // Camera orientation (radians)
    this.yaw   = 0;   // horizontal rotation (increases = turns left)
    this.pitch = 0;   // vertical rotation   (negative  = looks up)

    // Vertical physics
    this.vy       = 0;
    this.onGround = false;

    // State flag used by game.js for HUD / network
    this.moving = false;
  }

  // network.js reads rotationY for Firebase sync
  get rotationY() { return this.yaw; }

  // ============================================================
  //  UPDATE — call once per frame with elapsed seconds (dt)
  // ============================================================
  update(dt) {

    // ── 1. Mouse look ──────────────────────────────────────
    if (_mouseDX !== 0 || _mouseDY !== 0) {
      // Read sensitivity live so settings changes take effect instantly
      const sens = (typeof window.WALKWORLD_SENS === 'number')
        ? window.WALKWORLD_SENS
        : SENS_DEFAULT;

      this.yaw   -= _mouseDX * sens;
      this.pitch -= _mouseDY * sens;

      // Keep yaw in (−π, π] to avoid float drift
      if (this.yaw >  Math.PI) this.yaw -= Math.PI * 2;
      if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;

      // Hard-clamp pitch — camera never flips upside-down
      this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));

      _mouseDX = 0;
      _mouseDY = 0;
    }

    // ── 2. Horizontal movement ─────────────────────────────
    //
    // Input axes (camera-local space):
    //   mz < 0 = forward,  mz > 0 = backward
    //   mx < 0 = left,     mx > 0 = right
    //
    let mx = 0;
    let mz = 0;

    if (_pressed('forward')) mz -= 1;
    if (_pressed('back'))    mz += 1;
    if (_pressed('left'))    mx -= 1;
    if (_pressed('right'))   mx += 1;

    // Virtual joystick (mobile) — additive so both can coexist
    mx += _touchDX;
    mz += _touchDZ;

    // Normalise so diagonal movement is never faster than cardinal
    const inputLen = Math.sqrt(mx * mx + mz * mz);
    if (inputLen > 1) { mx /= inputLen; mz /= inputLen; }

    this.moving = (inputLen > 0.01);

    if (this.moving) {
      const isSprinting = _pressed('sprint');
      const speed       = MOVE_SPEED * (isSprinting ? SPRINT_MOD : 1.0) * dt;

      // ── Rotate local input vector into world space ────────
      //
      // Camera facing direction at rotation.y = yaw:
      //   forward = (−sin(yaw),  0, −cos(yaw))
      //   right   = ( cos(yaw),  0, −sin(yaw))
      //
      // worldDir = mx·right + (−mz)·forward, which expands to:
      //   worldDX =  mx·cos(yaw) + mz·sin(yaw)
      //   worldDZ =  mz·cos(yaw) − mx·sin(yaw)
      //
      // Proof — yaw = −π/2 (facing East / +X), W pressed (mz = −1):
      //   cos = 0, sin = −1
      //   worldDX = 0 + (−1)(−1) = +1  →  moves East ✓
      //
      const cosY = Math.cos(this.yaw);
      const sinY = Math.sin(this.yaw);

      const worldDX = mx * cosY + mz * sinY;
      const worldDZ = mz * cosY - mx * sinY;

      let nx = this.x + worldDX * speed;
      let nz = this.z + worldDZ * speed;

      // Hard-clamp to world boundary
      nx = Math.max(-(HALF - 1.0), Math.min(HALF - 1.0, nx));
      nz = Math.max(-(HALF - 1.0), Math.min(HALF - 1.0, nz));

      // Axis-separated collision so the player slides along walls
      // instead of stopping dead when one axis is blocked.
      if (!isBlocked(nx,     this.z)) this.x = nx;
      if (!isBlocked(this.x, nz))     this.z = nz;
    }

    // ── 3. Jump ────────────────────────────────────────────
    if (_pressed('jump') && this.onGround) {
      this.vy       = JUMP_VY;
      this.onGround = false;
    }

    // ── 4. Gravity ─────────────────────────────────────────
    this.vy += GRAVITY * dt;
    this.y  += this.vy * dt;

    // ── 5. Ground snap & landing ───────────────────────────
    const groundY = getHeightAt(this.x, this.z);

    if (this.y <= groundY) {
      // Landed or walking on flat terrain
      this.y        = groundY;
      this.vy       = 0;
      this.onGround = true;
    } else if (this.onGround && this.y - groundY < STEP_UP) {
      // Smooth step-up on gentle slopes while walking
      this.y  = groundY;
      this.vy = 0;
    } else {
      this.onGround = false;
    }

    // ── 6. Update camera ───────────────────────────────────
    //
    // rotation.order = 'YXZ': yaw applied first (world-Y axis),
    // pitch second (local-X axis).  Standard FPS order — no roll.
    //
    camera.position.set(this.x, this.y + EYE_HEIGHT, this.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.y     = this.yaw;
    camera.rotation.x     = this.pitch;
  }
}
