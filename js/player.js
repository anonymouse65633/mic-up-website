// ============================================================
//  WalkWorld 3D — player.js   (Part 5)
//
//  Handles all local-player logic:
//    • THREE.PerspectiveCamera (exported — used by game.js renderer)
//    • Pointer Lock API (mouse capture / release)
//    • Mouse-look: yaw (left/right) + pitch (up/down, clamped)
//    • WASD / arrow keys — movement is camera-yaw-relative so
//      W always means "forward the way I'm looking"
//    • Shift = sprint
//    • Space = jump, with gravity + terrain-snap landing
//    • Axis-separated collision via world.isBlocked
//    • Mobile virtual joystick via setTouchInput()
//
//  Exports
//  ─────────────────────────────────────────────────────────
//  camera              THREE.PerspectiveCamera
//  Player              class — main player controller
//  requestPointerLock(el)  — call on canvas click to capture mouse
//  isPointerLocked()       — true when mouse is captured
//  setTouchInput(dx, dz)   — drive movement from virtual joystick
// ============================================================

import { getHeightAt, isBlocked, SPAWN, HALF } from './world.js';

// ── Movement & physics constants ─────────────────────────────
const MOVE_SPEED  = 9.0;             // world units / second (walk)
const SPRINT_MOD  = 1.65;            // Shift multiplier
const JUMP_VY     = 7.5;             // upward velocity on jump
const GRAVITY     = -22.0;           // downward acceleration (units/s²)
const EYE_HEIGHT  = 1.65;            // camera above player feet
const PITCH_LIMIT = Math.PI * 0.44;  // ≈ 79° — prevents gimbal flip
const MOUSE_SENS  = 0.0022;          // radians per pixel of mouse movement
const DIAG_MOD    = 0.7071;          // 1 / √2 — normalise diagonal speed
const STEP_UP     = 0.38;            // max terrain step climbed per frame

// ============================================================
//  CAMERA
//  Exported so game.js can pass it to the WebGLRenderer.
//  rotation.order = 'YXZ' is applied in update() so pitch never
//  causes unintended roll.
// ============================================================
export const camera = new THREE.PerspectiveCamera(
  72,                                       // vertical FOV (degrees)
  window.innerWidth / window.innerHeight,   // aspect (corrected on resize)
  0.05,                                     // near clip plane
  500                                       // far clip plane (≥ fog far)
);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

// ============================================================
//  POINTER LOCK
//  game.js calls requestPointerLock(canvas) from the lockOverlay
//  click handler.  player.js listens for the change event so it
//  knows whether to consume mouse movement.
// ============================================================
let _locked  = false;
let _mouseDX = 0;
let _mouseDY = 0;

document.addEventListener('pointerlockchange', () => {
  _locked = !!document.pointerLockElement;
  // Clear any stale delta when lock state changes
  _mouseDX = 0;
  _mouseDY = 0;
});

document.addEventListener('mousemove', e => {
  if (!_locked) return;
  _mouseDX += e.movementX;
  _mouseDY += e.movementY;
});

/** Call when the user clicks the lock overlay / canvas. */
export function requestPointerLock(element) {
  element.requestPointerLock();
}

/** Returns true while the mouse is captured. */
export function isPointerLocked() {
  return _locked;
}

// ============================================================
//  KEYBOARD
// ============================================================
const KEYS = new Set();

window.addEventListener('keydown', e => {
  KEYS.add(e.code);
  // Block browser scroll / page-jump shortcuts while in-game
  if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) {
    e.preventDefault();
  }
});

window.addEventListener('keyup', e => KEYS.delete(e.code));

// ============================================================
//  VIRTUAL JOYSTICK  (mobile)
//  Values range −1…+1 on each axis.
//  dx = strafe,  dz = forward/back (positive = backward).
// ============================================================
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

    // Camera orientation
    this.yaw   = 0;   // horizontal rotation (radians, increases left)
    this.pitch = 0;   // vertical rotation   (radians, negative = up)

    // Vertical physics
    this.vy       = 0;      // current vertical velocity
    this.onGround = false;  // true when standing on terrain

    // State flags (used by game.js for HUD / network)
    this.moving = false;
  }

  // ── rotationY alias ──────────────────────────────────────
  // network.js expects playerData.rotationY for facing direction.
  get rotationY() { return this.yaw; }

  // ============================================================
  //  UPDATE  — call once per frame with elapsed seconds (dt)
  // ============================================================
  update(dt) {

    // ── 1. Mouse look ──────────────────────────────────────
    if (_mouseDX !== 0 || _mouseDY !== 0) {
      this.yaw   -= _mouseDX * MOUSE_SENS;
      this.pitch -= _mouseDY * MOUSE_SENS;

      // Keep yaw in [−π, π] to avoid floating-point drift
      if (this.yaw >  Math.PI) this.yaw -= Math.PI * 2;
      if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;

      // Hard-clamp pitch so the camera never flips upside-down
      this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));

      _mouseDX = 0;
      _mouseDY = 0;
    }

    // ── 2. Horizontal movement ─────────────────────────────
    //
    // Input is in camera-local space:
    //   mz < 0 = forward,  mz > 0 = backward
    //   mx < 0 = left,     mx > 0 = right
    //
    let mx = 0;
    let mz = 0;

    if (KEYS.has('KeyW') || KEYS.has('ArrowUp'))    mz -= 1;
    if (KEYS.has('KeyS') || KEYS.has('ArrowDown'))  mz += 1;
    if (KEYS.has('KeyA') || KEYS.has('ArrowLeft'))  mx -= 1;
    if (KEYS.has('KeyD') || KEYS.has('ArrowRight')) mx += 1;

    // Virtual joystick (mobile) — additive so gamepad + keys work together
    mx += _touchDX;
    mz += _touchDZ;

    // Normalise diagonal so you don't move faster at 45°
    if (mx !== 0 && mz !== 0) {
      mx *= DIAG_MOD;
      mz *= DIAG_MOD;
    }

    this.moving = (mx !== 0 || mz !== 0);

    if (this.moving) {
      const isSprinting = KEYS.has('ShiftLeft') || KEYS.has('ShiftRight');
      const speed       = MOVE_SPEED * (isSprinting ? SPRINT_MOD : 1.0) * dt;

      // Rotate the local-space input vector by the camera yaw so that
      // forward always means "the direction the camera is facing".
      const cosY = Math.cos(this.yaw);
      const sinY = Math.sin(this.yaw);

      const worldDX = mx * cosY - mz * sinY;
      const worldDZ = mx * sinY + mz * cosY;

      let nx = this.x + worldDX * speed;
      let nz = this.z + worldDZ * speed;

      // Hard clamp to world boundary
      nx = Math.max(-(HALF - 1.0), Math.min(HALF - 1.0, nx));
      nz = Math.max(-(HALF - 1.0), Math.min(HALF - 1.0, nz));

      // Axis-separated collision: try X then Z independently so the
      // player slides along walls instead of stopping dead.
      if (!isBlocked(nx,     this.z)) this.x = nx;
      if (!isBlocked(this.x, nz))     this.z = nz;
    }

    // ── 3. Jump ────────────────────────────────────────────
    if (KEYS.has('Space') && this.onGround) {
      this.vy       = JUMP_VY;
      this.onGround = false;
    }

    // ── 4. Gravity ─────────────────────────────────────────
    this.vy += GRAVITY * dt;
    this.y  += this.vy * dt;

    // ── 5. Ground snap & landing ───────────────────────────
    //
    // getHeightAt returns the terrain Y directly below the player.
    // If the player is at or below it they've landed; snap up and
    // clear vertical velocity.  The STEP_UP guard lets the player
    // walk up gentle terrain slopes without bouncing.
    //
    const groundY = getHeightAt(this.x, this.z);

    if (this.y <= groundY) {
      this.y        = groundY;
      this.vy       = 0;
      this.onGround = true;
    } else if (this.onGround && this.y - groundY < STEP_UP) {
      // Smooth step-up on gentle inclines while walking
      this.y  = groundY;
      this.vy = 0;
    } else {
      this.onGround = false;
    }

    // ── 6. Update camera ───────────────────────────────────
    //
    // rotation.order = 'YXZ': yaw is applied first (around world-Y),
    // pitch second (around local-X).  This is the standard FPS order
    // and prevents any roll from accumulating.
    //
    camera.position.set(this.x, this.y + EYE_HEIGHT, this.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.y     = this.yaw;
    camera.rotation.x     = this.pitch;
  }
}
