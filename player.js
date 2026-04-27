// ============================================================
//  WalkWorld — player.js
//  Local player state, input handling, and movement.
//  Collision is checked against world.js isBlocked().
// ============================================================

import { isBlocked, SPAWN, WORLD_PX, WORLD_PY } from './world.js';

// ── Movement constants ───────────────────────────────────────
const BASE_SPEED   = 160;   // pixels per second
const PLAYER_R     = 10;    // collision radius (must match isBlocked call)
const DIAGONAL_MOD = 0.707; // 1/√2 — normalise diagonal speed

// ── Key map ──────────────────────────────────────────────────
const KEYS = new Set();

window.addEventListener('keydown', e => {
  KEYS.add(e.code);
  // Prevent arrow keys from scrolling the page
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) {
    e.preventDefault();
  }
});
window.addEventListener('keyup', e => KEYS.delete(e.code));

// Touch / on-screen joystick support (mobile)
// A thin virtual D-pad written directly into this module so we
// don't need an extra file.
let _touchDx = 0;
let _touchDy = 0;

export function setTouchInput(dx, dy) {
  _touchDx = dx;
  _touchDy = dy;
}

// ============================================================
//  Player class
// ============================================================
export class Player {
  constructor(name, colour) {
    this.name   = name;
    this.colour = colour;
    this.x      = SPAWN.x;
    this.y      = SPAWN.y;

    // Facing direction — used by chat bubble placement
    this.dx = 0;
    this.dy = 0;

    // Is the player actually moving this frame?
    this.moving = false;
  }

  // ── Called every frame with elapsed seconds ──────────────
  update(dt) {
    let dx = 0;
    let dy = 0;

    // Keyboard input
    if (KEYS.has('KeyW') || KEYS.has('ArrowUp'))    dy -= 1;
    if (KEYS.has('KeyS') || KEYS.has('ArrowDown'))  dy += 1;
    if (KEYS.has('KeyA') || KEYS.has('ArrowLeft'))  dx -= 1;
    if (KEYS.has('KeyD') || KEYS.has('ArrowRight')) dx += 1;

    // Touch / virtual joystick input
    if (_touchDx !== 0 || _touchDy !== 0) {
      dx += _touchDx;
      dy += _touchDy;
    }

    // Normalise diagonal movement
    if (dx !== 0 && dy !== 0) {
      dx *= DIAGONAL_MOD;
      dy *= DIAGONAL_MOD;
    }

    this.moving = dx !== 0 || dy !== 0;

    if (!this.moving) return;

    // Store facing direction
    if (dx !== 0) this.dx = Math.sign(dx);
    if (dy !== 0) this.dy = Math.sign(dy);

    const speed  = BASE_SPEED * dt;
    let   newX   = this.x + dx * speed;
    let   newY   = this.y + dy * speed;

    // Clamp to world bounds first
    newX = Math.max(PLAYER_R, Math.min(WORLD_PX - PLAYER_R, newX));
    newY = Math.max(PLAYER_R, Math.min(WORLD_PY - PLAYER_R, newY));

    // Axis-separated collision so player can slide along walls
    const canMoveX = !isBlocked(newX, this.y, PLAYER_R);
    const canMoveY = !isBlocked(this.x, newY, PLAYER_R);

    if (canMoveX) this.x = newX;
    if (canMoveY) this.y = newY;
  }
}
