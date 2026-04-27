// ============================================================
//  WalkWorld 3D — player.js
// ============================================================

import { getHeightAt, isBlocked, SPAWN, HALF } from './world.js';

const MOVE_SPEED  = 9.0;
const SPRINT_MOD  = 1.65;
const JUMP_VY     = 7.5;
const GRAVITY     = -22.0;
const EYE_HEIGHT  = 1.65;
const PITCH_LIMIT = Math.PI * 0.44;
const MOUSE_SENS  = 0.0022;
const DIAG_MOD    = 0.7071;
const STEP_UP     = 0.38;

export const camera = new THREE.PerspectiveCamera(
  72,
  window.innerWidth / window.innerHeight,
  0.05,
  500
);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

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

export function requestPointerLock(element) {
  element.requestPointerLock();
}

export function isPointerLocked() {
  return _locked;
}

const KEYS = new Set();

window.addEventListener('keydown', e => {
  KEYS.add(e.code);
  if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) {
    e.preventDefault();
  }
});

window.addEventListener('keyup', e => KEYS.delete(e.code));

let _touchDX = 0;
let _touchDZ = 0;

export function setTouchInput(dx, dz) {
  _touchDX = dx;
  _touchDZ = dz;
}

export class Player {

  constructor(name, colour) {
    this.name   = name;
    this.colour = colour;

    this.x = SPAWN.x;
    this.y = SPAWN.y;
    this.z = SPAWN.z;

    this.yaw   = 0;
    this.pitch = 0;

    this.vy       = 0;
    this.onGround = false;
    this.moving   = false;
  }

  get rotationY() { return this.yaw; }

  update(dt) {

    // ── 1. Mouse look ──────────────────────────────────────
    if (_mouseDX !== 0 || _mouseDY !== 0) {
      this.yaw   -= _mouseDX * MOUSE_SENS;
      this.pitch -= _mouseDY * MOUSE_SENS;

      if (this.yaw >  Math.PI) this.yaw -= Math.PI * 2;
      if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;

      this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));

      _mouseDX = 0;
      _mouseDY = 0;
    }

    // ── 2. Horizontal movement ─────────────────────────────
    let mx = 0;
    let mz = 0;

    if (KEYS.has('KeyW') || KEYS.has('ArrowUp'))    mz -= 1;
    if (KEYS.has('KeyS') || KEYS.has('ArrowDown'))  mz += 1;
    if (KEYS.has('KeyA') || KEYS.has('ArrowLeft'))  mx -= 1;
    if (KEYS.has('KeyD') || KEYS.has('ArrowRight')) mx += 1;

    mx += _touchDX;
    mz += _touchDZ;

    if (mx !== 0 && mz !== 0) {
      mx *= DIAG_MOD;
      mz *= DIAG_MOD;
    }

    this.moving = (mx !== 0 || mz !== 0);

    if (this.moving) {
      const isSprinting = KEYS.has('ShiftLeft') || KEYS.has('ShiftRight');
      const speed       = MOVE_SPEED * (isSprinting ? SPRINT_MOD : 1.0) * dt;

      const cosY = Math.cos(this.yaw);
      const sinY = Math.sin(this.yaw);

      // ✅ Fixed: rotate input by -yaw so W moves toward the camera's look direction
      const worldDX =  mx * cosY + mz * sinY;
      const worldDZ = -mx * sinY + mz * cosY;

      let nx = this.x + worldDX * speed;
      let nz = this.z + worldDZ * speed;

      nx = Math.max(-(HALF - 1.0), Math.min(HALF - 1.0, nx));
      nz = Math.max(-(HALF - 1.0), Math.min(HALF - 1.0, nz));

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

    // ── 5. Ground snap ─────────────────────────────────────
    const groundY = getHeightAt(this.x, this.z);

    if (this.y <= groundY) {
      this.y        = groundY;
      this.vy       = 0;
      this.onGround = true;
    } else if (this.onGround && this.y - groundY < STEP_UP) {
      this.y  = groundY;
      this.vy = 0;
    } else {
      this.onGround = false;
    }

    // ── 6. Camera ──────────────────────────────────────────
    camera.position.set(this.x, this.y + EYE_HEIGHT, this.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.y     = this.yaw;
    camera.rotation.x     = this.pitch;
  }
}
