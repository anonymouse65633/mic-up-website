// ============================================================
//  WalkWorld — renderer.js
//  Draws everything to the game canvas each frame:
//    • Tile map   (viewport-culled for performance)
//    • Decorations (trees, flowers, rocks, etc.)
//    • Remote players (coloured circles + nametags)
//    • Local player
//    • Chat bubbles above players
//    • Minimap (top-down overview)
// ============================================================

import {
  TILE, TILE_DEF, TILE_SIZE,
  WORLD_W, WORLD_H, WORLD_PX, WORLD_PY,
  tileMap, decorations, DECO,
} from './world.js';

// ── Camera smooth-follow settings ───────────────────────────
const CAM_LERP    = 0.10;  // 0=no follow, 1=instant snap
const PLAYER_R    = 14;    // local player circle radius (px)
const REMOTE_R    = 13;    // remote player circle radius
const NAME_FONT   = '9px "Press Start 2P", monospace';
const BUBBLE_FONT = '15px "VT323", monospace';

// Pre-sort decorations so trees (tall) draw after ground-level items
const DECO_ORDER  = [DECO.FLOWER, DECO.MUSHROOM, DECO.ROCK, DECO.BUSH, DECO.SIGN, DECO.TREE];
const sortedDecos = [...decorations].sort(
  (a, b) => DECO_ORDER.indexOf(a.type) - DECO_ORDER.indexOf(b.type)
);

// Separate flower/ground decos from solid decos for layering
const groundDecos = sortedDecos.filter(d =>
  d.type === DECO.FLOWER || d.type === DECO.MUSHROOM
);
const solidDecos = sortedDecos.filter(d =>
  d.type !== DECO.FLOWER && d.type !== DECO.MUSHROOM
);

// ── Water animation ──────────────────────────────────────────
let _waterOffset = 0;

// ── Minimap tile cache ───────────────────────────────────────
let _minimapCache = null;

// ============================================================
//  RENDERER CLASS
// ============================================================
export class Renderer {
  constructor(canvas, minimapCanvas) {
    this.canvas  = canvas;
    this.ctx     = canvas.getContext('2d');
    this.miniCtx = minimapCanvas ? minimapCanvas.getContext('2d') : null;
    this.miniW   = minimapCanvas?.width  ?? 120;
    this.miniH   = minimapCanvas?.height ?? 120;

    // Camera position in world pixels (top-left of viewport)
    this.camX = 0;
    this.camY = 0;

    // Chat bubble store: { [playerId]: { text, expires } }
    this._bubbles = {};

    this._resizeCanvas();
    window.addEventListener('resize', () => this._resizeCanvas());
  }

  // ── Public: add a chat bubble for a player ──
  addBubble(playerId, text) {
    this._bubbles[playerId] = {
      text: text.slice(0, 40),
      expires: performance.now() + 4000,
    };
  }

  // ── Main draw call (called every animation frame) ──────────
  draw(localPlayer, remotePlayers, timestamp) {
    const ctx = this.ctx;
    const vw  = this.canvas.width;
    const vh  = this.canvas.height;

    // Advance water shimmer
    _waterOffset = (timestamp * 0.0008) % 1;

    // ── Smooth camera follow ──
    const targetX = localPlayer.x - vw / 2;
    const targetY = localPlayer.y - vh / 2;
    this.camX += (targetX - this.camX) * CAM_LERP;
    this.camY += (targetY - this.camY) * CAM_LERP;

    // Clamp camera to world bounds
    this.camX = Math.max(0, Math.min(this.camX, WORLD_PX - vw));
    this.camY = Math.max(0, Math.min(this.camY, WORLD_PY - vh));

    const cx = Math.round(this.camX);
    const cy = Math.round(this.camY);

    // ── Clear ──
    ctx.clearRect(0, 0, vw, vh);

    // ── Draw world ──
    ctx.save();
    ctx.translate(-cx, -cy);

    this._drawTiles(cx, cy, vw, vh, timestamp);
    this._drawDecos(groundDecos, cx, cy, vw, vh);

    // Draw remote players (behind trees)
    for (const [id, p] of Object.entries(remotePlayers)) {
      this._drawPlayer(p.x, p.y, p.colour, p.name, REMOTE_R, false);
      this._drawBubble(ctx, id, p.x, p.y - REMOTE_R);
    }

    // Draw solid decorations (trees in front of players)
    this._drawDecos(solidDecos, cx, cy, vw, vh);

    // Draw local player on top
    this._drawPlayer(
      localPlayer.x, localPlayer.y,
      localPlayer.colour, localPlayer.name,
      PLAYER_R, true
    );
    this._drawBubble(ctx, 'local', localPlayer.x, localPlayer.y - PLAYER_R);

    ctx.restore();

    // ── Minimap ──
    if (this.miniCtx) this._drawMinimap(localPlayer, remotePlayers);

    // Expire old bubbles
    this._pruneBubbles(timestamp);
  }

  // ── Draw tiles (only tiles visible in viewport) ────────────
  _drawTiles(cx, cy, vw, vh, timestamp) {
    const ctx = this.ctx;

    const startX = Math.max(0, Math.floor(cx / TILE_SIZE));
    const startY = Math.max(0, Math.floor(cy / TILE_SIZE));
    const endX   = Math.min(WORLD_W - 1, Math.ceil((cx + vw)  / TILE_SIZE));
    const endY   = Math.min(WORLD_H - 1, Math.ceil((cy + vh) / TILE_SIZE));

    for (let ty = startY; ty <= endY; ty++) {
      for (let tx = startX; tx <= endX; tx++) {
        const tile = tileMap[ty][tx];
        const def  = TILE_DEF[tile];
        const px   = tx * TILE_SIZE;
        const py   = ty * TILE_SIZE;

        // Checkerboard variation for visual interest
        const alt = (tx + ty) % 2 === 0;

        if (tile === TILE.WATER) {
          // Animated water shimmer
          const wave = Math.sin(timestamp * 0.001 + tx * 0.5 + ty * 0.3);
          const blue = alt ? '#1a5fa8' : '#1b6dbf';
          ctx.fillStyle = blue;
          ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);

          // Shimmer highlight
          ctx.fillStyle = `rgba(255,255,255,${0.04 + 0.03 * wave})`;
          ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        } else {
          ctx.fillStyle = alt ? def.base : def.alt;
          ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        }
      }
    }
  }

  // ── Draw a list of decorations (culled to viewport) ────────
  _drawDecos(list, cx, cy, vw, vh) {
    const ctx    = this.ctx;
    const margin = TILE_SIZE * 3;

    for (const d of list) {
      const wx = d.x * TILE_SIZE;
      const wy = d.y * TILE_SIZE;

      // Cull offscreen
      if (wx < cx - margin || wx > cx + vw + margin) continue;
      if (wy < cy - margin || wy > cy + vh + margin) continue;

      // Centre of the tile
      const mx = wx + TILE_SIZE / 2;
      const my = wy + TILE_SIZE / 2;

      switch (d.type) {
        case DECO.TREE:     this._drawTree(ctx, mx, my);    break;
        case DECO.BUSH:     this._drawBush(ctx, mx, my);    break;
        case DECO.ROCK:     this._drawRock(ctx, mx, my);    break;
        case DECO.FLOWER:   this._drawFlower(ctx, mx, my, d.colour); break;
        case DECO.MUSHROOM: this._drawMushroom(ctx, mx, my); break;
        case DECO.SIGN:     this._drawSign(ctx, mx, my);    break;
      }
    }
  }

  // ── Individual decoration drawers ──────────────────────────

  _drawTree(ctx, x, y) {
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.ellipse(x + 2, y + 6, 12, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    // Trunk
    ctx.fillStyle = '#5c3d1e';
    ctx.fillRect(x - 4, y - 2, 8, 14);
    // Canopy (dark outer + lighter inner for pixel depth)
    ctx.fillStyle = '#1e5c17';
    ctx.beginPath();
    ctx.arc(x, y - 8, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2d8020';
    ctx.beginPath();
    ctx.arc(x - 3, y - 11, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#3a9c2b';
    ctx.beginPath();
    ctx.arc(x - 4, y - 13, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawBush(ctx, x, y) {
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.beginPath();
    ctx.ellipse(x + 1, y + 4, 9, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2d6b22';
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#38882c';
    ctx.beginPath();
    ctx.arc(x - 3, y - 3, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawRock(ctx, x, y) {
    ctx.fillStyle = 'rgba(0,0,0,0.15)';
    ctx.beginPath();
    ctx.ellipse(x + 2, y + 6, 9, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#6a6a7a';
    ctx.beginPath();
    ctx.ellipse(x, y, 9, 7, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#8a8a9a';
    ctx.beginPath();
    ctx.ellipse(x - 2, y - 2, 5, 4, -0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawFlower(ctx, x, y, colour = '#ff6b9d') {
    // Stem
    ctx.strokeStyle = '#4a8c3a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y + 2);
    ctx.lineTo(x, y + 7);
    ctx.stroke();
    // Petals
    ctx.fillStyle = colour;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * 3.5, y + Math.sin(a) * 3.5, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // Centre
    ctx.fillStyle = '#ffdd57';
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawMushroom(ctx, x, y) {
    // Stalk
    ctx.fillStyle = '#e8d8b0';
    ctx.fillRect(x - 3, y, 6, 7);
    // Cap
    ctx.fillStyle = '#c0392b';
    ctx.beginPath();
    ctx.arc(x, y, 8, Math.PI, 0);
    ctx.fill();
    // Spots
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath(); ctx.arc(x - 2, y - 3, 2, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 3, y - 1, 1.5, 0, Math.PI*2); ctx.fill();
  }

  _drawSign(ctx, x, y) {
    // Post
    ctx.fillStyle = '#7a5428';
    ctx.fillRect(x - 2, y - 4, 4, 16);
    // Board
    ctx.fillStyle = '#a06c38';
    ctx.strokeStyle = '#7a5428';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(x - 12, y - 18, 24, 14, 2);
    ctx.fill();
    ctx.stroke();
    // "!" text on sign
    ctx.fillStyle = '#3d1c00';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('!', x, y - 11);
    ctx.textAlign = 'left';
  }

  // ── Draw a player (local or remote) ───────────────────────
  _drawPlayer(x, y, colour, name, radius, isLocal) {
    const ctx = this.ctx;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(x + 2, y + radius - 2, radius * 0.8, radius * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body circle
    ctx.fillStyle = colour;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    // White outline (thicker for local player)
    ctx.strokeStyle = isLocal ? '#ffffff' : 'rgba(255,255,255,0.7)';
    ctx.lineWidth   = isLocal ? 2.5 : 1.5;
    ctx.stroke();

    // Local player indicator ring
    if (isLocal) {
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.arc(x, y, radius + 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Eyes
    const eyeY  = y - radius * 0.2;
    const eyeOff = radius * 0.3;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    ctx.arc(x - eyeOff, eyeY, 2.5, 0, Math.PI * 2);
    ctx.arc(x + eyeOff, eyeY, 2.5, 0, Math.PI * 2);
    ctx.fill();
    // Eye shine
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath();
    ctx.arc(x - eyeOff + 1, eyeY - 1, 1, 0, Math.PI * 2);
    ctx.arc(x + eyeOff + 1, eyeY - 1, 1, 0, Math.PI * 2);
    ctx.fill();

    // Name tag above player
    if (name) {
      const tagY = y - radius - 14;
      ctx.font         = NAME_FONT;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';

      // Measure for background
      const tw = ctx.measureText(name).width;
      const th = 10;
      const pad = 4;

      // Tag background
      ctx.fillStyle = 'rgba(13,13,26,0.75)';
      ctx.beginPath();
      ctx.roundRect(x - tw/2 - pad, tagY - th/2 - pad, tw + pad*2, th + pad*2, 3);
      ctx.fill();

      // Tag border (player colour)
      ctx.strokeStyle = colour;
      ctx.lineWidth   = 1;
      ctx.stroke();

      // Name text
      ctx.fillStyle = '#ffffff';
      ctx.fillText(name, x, tagY);
    }

    ctx.textAlign    = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  // ── Draw a chat bubble above a player ─────────────────────
  _drawBubble(ctx, id, x, topY) {
    const b = this._bubbles[id];
    if (!b || performance.now() > b.expires) return;

    const age    = performance.now() - (b.expires - 4000);
    const fade   = Math.min(1, (4000 - (performance.now() - (b.expires - 4000))) / 500);
    const bubbleY = topY - 24;

    ctx.save();
    ctx.globalAlpha = fade;
    ctx.font         = BUBBLE_FONT;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';

    const tw  = ctx.measureText(b.text).width;
    const pad = 8;
    const bw  = tw + pad * 2;
    const bh  = 22;
    const bx  = x - bw / 2;
    const by  = bubbleY - bh / 2;

    // Bubble background
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 6);
    ctx.fill();

    // Bubble tail
    ctx.beginPath();
    ctx.moveTo(x - 5, by + bh);
    ctx.lineTo(x,     by + bh + 8);
    ctx.lineTo(x + 5, by + bh);
    ctx.fill();

    // Text
    ctx.fillStyle = '#111';
    ctx.fillText(b.text, x, bubbleY);

    ctx.restore();
  }

  // ── Draw minimap ───────────────────────────────────────────
  _drawMinimap(localPlayer, remotePlayers) {
    const ctx = this.miniCtx;
    const mw  = this.miniW;
    const mh  = this.miniH;
    const scX = mw / (WORLD_W * TILE_SIZE);
    const scY = mh / (WORLD_H * TILE_SIZE);

    // Draw cached tile overview once (expensive, only build first frame)
    if (!_minimapCache) {
      const offCanvas = new OffscreenCanvas(mw, mh);
      const offCtx    = offCanvas.getContext('2d');

      for (let ty = 0; ty < WORLD_H; ty++) {
        for (let tx = 0; tx < WORLD_W; tx++) {
          offCtx.fillStyle = TILE_DEF[tileMap[ty][tx]].base;
          offCtx.fillRect(
            tx * mw / WORLD_W,
            ty * mh / WORLD_H,
            Math.ceil(mw / WORLD_W),
            Math.ceil(mh / WORLD_H)
          );
        }
      }

      // Trees on minimap
      offCtx.fillStyle = '#1e5c17';
      for (const d of decorations) {
        if (d.type !== DECO.TREE) continue;
        offCtx.fillRect(
          d.x * mw / WORLD_W, d.y * mh / WORLD_H, 2, 2
        );
      }

      _minimapCache = offCanvas.transferToImageBitmap();
    }

    ctx.clearRect(0, 0, mw, mh);
    ctx.drawImage(_minimapCache, 0, 0);

    // Viewport rectangle
    const vx = (this.camX / WORLD_PX) * mw;
    const vy = (this.camY / WORLD_PY) * mh;
    const vw = (this.canvas.width  / WORLD_PX) * mw;
    const vh = (this.canvas.height / WORLD_PY) * mh;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth   = 1;
    ctx.strokeRect(vx, vy, vw, vh);

    // Remote players
    for (const p of Object.values(remotePlayers)) {
      ctx.fillStyle = p.colour;
      ctx.beginPath();
      ctx.arc(p.x * scX, p.y * scY, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Local player (bright white dot)
    ctx.fillStyle   = '#ffffff';
    ctx.strokeStyle = localPlayer.colour;
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.arc(localPlayer.x * scX, localPlayer.y * scY, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // ── Prune expired bubbles ──────────────────────────────────
  _pruneBubbles(now) {
    for (const id in this._bubbles) {
      if (now > this._bubbles[id].expires) delete this._bubbles[id];
    }
  }

  // ── Resize canvas to fill window ──────────────────────────
  _resizeCanvas() {
    this.canvas.width  = window.innerWidth;
    this.canvas.height = window.innerHeight;
    // Invalidate minimap cache on resize (viewport rect changes)
    // (tile cache stays valid — only viewport box needs redraw)
  }
}
