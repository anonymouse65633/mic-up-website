// ============================================================
//  WalkWorld 3D — player.js  (with shaft-escape jump boost)
// ============================================================

import { getHeightAt, getBaseHeightAt, isBlocked, SPAWN, HALF } from './world.js';

const MOVE_SPEED   = 9.0;
const SPRINT_MOD   = 1.65;
const JUMP_VY      = 7.5;
const GRAVITY      = -22.0;
const EYE_HEIGHT   = 1.65;
const PITCH_LIMIT  = Math.PI * 0.44;
const SENS_DEFAULT = 0.0022;
const STEP_UP      = 0.38;

const DEFAULT_BINDS = {
  forward : 'KeyW',
  back    : 'KeyS',
  left    : 'KeyA',
  right   : 'KeyD',
  jump    : 'Space',
  sprint  : 'ShiftLeft',
  chat    : 'KeyT',
};

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
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
    if (_locked) e.preventDefault();
  }
});

window.addEventListener('keyup', e => KEYS.delete(e.code));

function _pressed(action) {
  const binds = window.WALKWORLD_BINDS || DEFAULT_BINDS;
  const code  = binds[action] || DEFAULT_BINDS[action];
  if (KEYS.has(code)) return true;
  if (action === 'forward' && KEYS.has('ArrowUp'))    return true;
  if (action === 'back'    && KEYS.has('ArrowDown'))  return true;
  if (action === 'left'    && KEYS.has('ArrowLeft'))  return true;
  if (action === 'right'   && KEYS.has('ArrowRight')) return true;
  return false;
}

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

    this.moving = false;
  }

  get rotationY() { return this.yaw; }

  update(dt) {

    // ── 1. Mouse look ──────────────────────────────────────
    if (_mouseDX !== 0 || _mouseDY !== 0) {
      const sens = (typeof window.WALKWORLD_SENS === 'number')
        ? window.WALKWORLD_SENS
        : SENS_DEFAULT;

      this.yaw   -= _mouseDX * sens;
      this.pitch -= _mouseDY * sens;

      if (this.yaw >  Math.PI) this.yaw -= Math.PI * 2;
      if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;

      this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));

      _mouseDX = 0;
      _mouseDY = 0;
    }

    // ── 2. Horizontal movement ─────────────────────────────
    let mx = 0;
    let mz = 0;

    if (_pressed('forward')) mz -= 1;
    if (_pressed('back'))    mz += 1;
    if (_pressed('left'))    mx -= 1;
    if (_pressed('right'))   mx += 1;

    mx += _touchDX;
    mz += _touchDZ;

    const inputLen = Math.sqrt(mx * mx + mz * mz);
    if (inputLen > 1) { mx /= inputLen; mz /= inputLen; }

    this.moving = (inputLen > 0.01);

    if (this.moving) {
      const isSprinting = _pressed('sprint');
      const speed       = MOVE_SPEED * (isSprinting ? SPRINT_MOD : 1.0) * dt;

      const cosY = Math.cos(this.yaw);
      const sinY = Math.sin(this.yaw);

      const worldDX = mx * cosY + mz * sinY;
      const worldDZ = mz * cosY - mx * sinY;

      let nx = this.x + worldDX * speed;
      let nz = this.z + worldDZ * speed;

      nx = Math.max(-(HALF - 1.0), Math.min(HALF - 1.0, nx));
      nz = Math.max(-(HALF - 1.0), Math.min(HALF - 1.0, nz));

      if (!isBlocked(nx,     this.z)) this.x = nx;
      if (!isBlocked(this.x, nz))     this.z = nz;
    }

    // ── 3. Jump — boosted when inside a shaft ──────────────
    if (_pressed('jump') && this.onGround) {
      const surfaceY   = getBaseHeightAt(this.x, this.z);
      const shaftDepth = Math.max(0, surfaceY - this.y);

      if (shaftDepth > 0.3) {
        // Boost jump velocity just enough to escape the shaft + 1.5m clearance
        const escapeVY = Math.sqrt(2 * Math.abs(GRAVITY) * (shaftDepth + 1.5));
        this.vy = Math.max(JUMP_VY, escapeVY);
      } else {
        this.vy = JUMP_VY;
      }
      this.onGround = false;
    }

    // ── 4. Gravity ─────────────────────────────────────────
    this.vy += GRAVITY * dt;
    this.y  += this.vy * dt;

    // ── 5. Ground snap & landing ───────────────────────────
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

    // ── 6. Update camera ───────────────────────────────────
    camera.position.set(this.x, this.y + EYE_HEIGHT, this.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.y     = this.yaw;
    camera.rotation.x     = this.pitch;
  }
}
