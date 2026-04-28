// ============================================================
//  WalkWorld 3D — renderer.js  (REWRITE)
//
//  Responsibilities
//  ────────────────────────────────────────────────────────────
//  • THREE.WebGLRenderer  — renders the 3D scene every frame
//  • Remote player meshes — Roblox-style block characters added
//    to / removed from the scene automatically
//  • Overlay canvas       — name tags + chat bubbles projected
//    from 3D world-space to 2D screen-space each frame
//  • Minimap canvas       — circular, baked zone-colour BG +
//    live player dots + local-player direction arrow
//
//  Public API
//  ────────────────────────────────────────────────────────────
//  new Renderer(gameCanvas)
//  renderer.addBubble(playerId, text)
//  renderer.draw(localPlayer, remotePlayers, timestamp)
//
//  game.js passes (gameCanvas, minimapCanvas) — the second arg
//  is ignored; we create our own internal canvases.
// ============================================================

import { scene, WORLD_SIZE, HALF, getZoneName } from './world.js';
import { camera }                                from './player.js';

// ── Minimap constants ─────────────────────────────────────────
const MINIMAP_SIZE = 130;   // px (displayed square, CSS clips to circle)
const MINIMAP_RES  = 64;    // grid resolution for the baked background

// Zone → fill colour for the baked minimap background
const ZONE_COLOR = {
  Forest: '#1a4010',
  Lake:   '#1a5fa8',
  Cabin:  '#7a5020',
  Plaza:  '#505060',
  Plains: '#2a5c18',
};

// ── Block-character geometry (built once, shared) ─────────────
let _geoms = null;

function sharedGeoms() {
  if (_geoms) return _geoms;
  _geoms = {
    head:  new THREE.BoxGeometry(0.55, 0.55, 0.55),
    torso: new THREE.BoxGeometry(0.55, 0.70, 0.30),
    limb:  new THREE.BoxGeometry(0.22, 0.55, 0.22),
    leg:   new THREE.BoxGeometry(0.22, 0.60, 0.22),
  };
  return _geoms;
}

/**
 * Build a Roblox-style block character THREE.Group.
 * Children layout (by index):
 *   0 head · 1 torso · 2 lArm · 3 rArm · 4 lLeg · 5 rLeg
 *
 * @param {string} colour — hex colour for shirt / body
 */
function makeBlockChar(colour) {
  const g    = sharedGeoms();
  const body = new THREE.MeshLambertMaterial({ color: colour });
  const skin = new THREE.MeshLambertMaterial({ color: 0xf0c890 });
  const pant = new THREE.MeshLambertMaterial({
    color: new THREE.Color(colour).multiplyScalar(0.55),
  });

  const group = new THREE.Group();

  // Head (skin-coloured)
  const head = new THREE.Mesh(g.head, skin);
  head.position.y = 1.60;
  group.add(head);                   // [0]

  // Torso
  const torso = new THREE.Mesh(g.torso, body);
  torso.position.y = 0.95;
  group.add(torso);                  // [1]

  // Arms
  const lArm = new THREE.Mesh(g.limb, body);
  lArm.position.set(-0.40, 0.96, 0);
  group.add(lArm);                   // [2]

  const rArm = new THREE.Mesh(g.limb, body);
  rArm.position.set( 0.40, 0.96, 0);
  group.add(rArm);                   // [3]

  // Legs
  const lLeg = new THREE.Mesh(g.leg, pant);
  lLeg.position.set(-0.17, 0.35, 0);
  group.add(lLeg);                   // [4]

  const rLeg = new THREE.Mesh(g.leg, pant);
  rLeg.position.set( 0.17, 0.35, 0);
  group.add(rLeg);                   // [5]

  return group;
}

// ============================================================
//  RENDERER CLASS
// ============================================================
export class Renderer {

  /**
   * @param {HTMLCanvasElement} gameCanvas — the main #gameCanvas
   * @param {HTMLCanvasElement} [_ignored] — kept for API compat
   */
  constructor(gameCanvas, _ignored) {
    this.canvas = gameCanvas;

    // ── THREE.WebGLRenderer ──────────────────────────────────
    this.webgl = new THREE.WebGLRenderer({
      canvas:    gameCanvas,
      antialias: true,
    });
    this.webgl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.webgl.setSize(window.innerWidth, window.innerHeight);

    const wrapper = gameCanvas.parentElement;

    // ── 2-D overlay (name tags + chat bubbles) ───────────────
    this._overlay    = _mkCanvas('position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:5;');
    this._overlayCtx = this._overlay.getContext('2d');
    wrapper.appendChild(this._overlay);
    this._resizeOverlay();

    // ── Minimap canvas ───────────────────────────────────────
    this._miniCanvas = _mkCanvas(`
      position:absolute; top:70px; right:14px;
      width:${MINIMAP_SIZE}px; height:${MINIMAP_SIZE}px;
      border-radius:50%;
      border:2px solid rgba(255,255,255,0.22);
      box-shadow:0 0 8px rgba(0,0,0,0.5);
      z-index:15; pointer-events:none;
    `);
    this._miniCanvas.width  = MINIMAP_SIZE;
    this._miniCanvas.height = MINIMAP_SIZE;
    this._miniCtx           = this._miniCanvas.getContext('2d');
    wrapper.appendChild(this._miniCanvas);

    // Bake the static zone-colour background (runs once)
    this._minimapBg = this._bakeMinimap();

    // ── Remote player state ──────────────────────────────────
    // { [id]: THREE.Group }
    this._remoteGroups = {};

    // ── Chat bubble store ────────────────────────────────────
    // { [id]: { text: string, expires: number } }
    this._bubbles = {};

    // ── Resize handler ───────────────────────────────────────
    window.addEventListener('resize', () => {
      this.webgl.setSize(window.innerWidth, window.innerHeight);
      this._resizeOverlay();
    });
  }

  // ── Public: register a chat bubble ───────────────────────
  addBubble(id, text) {
    this._bubbles[id] = {
      text:    text.slice(0, 40),
      expires: performance.now() + 4000,
    };
  }

  // ── Main draw call ────────────────────────────────────────
  draw(localPlayer, remotePlayers, timestamp) {
    this._syncRemotePlayers(remotePlayers, timestamp);

    // 3-D render
    this.webgl.render(scene, camera);

    // 2-D overlay
    this._drawOverlay(remotePlayers);

    // Minimap
    this._drawMinimap(localPlayer, remotePlayers);

    // Prune expired bubbles
    const now = performance.now();
    for (const id in this._bubbles) {
      if (now > this._bubbles[id].expires) delete this._bubbles[id];
    }
  }

  // ── Sync remote player block chars in the scene ───────────
  _syncRemotePlayers(remotePlayers, timestamp) {
    const live = new Set(Object.keys(remotePlayers));

    // Remove stale groups
    for (const id of Object.keys(this._remoteGroups)) {
      if (!live.has(id)) {
        scene.remove(this._remoteGroups[id]);
        delete this._remoteGroups[id];
      }
    }

    const t = timestamp * 0.003; // walk cycle time

    for (const [id, p] of Object.entries(remotePlayers)) {
      // Create group if new player
      if (!this._remoteGroups[id]) {
        const grp = makeBlockChar(p.colour || '#ffffff');
        this._remoteGroups[id] = grp;
        scene.add(grp);
      }

      const grp = this._remoteGroups[id];

      // Position & facing
      grp.position.set(p.x ?? 0, p.y ?? 0, p.z ?? 0);
      grp.rotation.y = p.rotationY ?? 0;

      // Walk animation — swing arms & legs
      // children: [0]head [1]torso [2]lArm [3]rArm [4]lLeg [5]rLeg
      if (grp.children.length === 6) {
        const swing = Math.sin(t) * 0.40;
        grp.children[2].rotation.x =  swing;   // lArm
        grp.children[3].rotation.x = -swing;   // rArm
        grp.children[4].rotation.x = -swing;   // lLeg
        grp.children[5].rotation.x =  swing;   // rLeg
      }
    }
  }

  // ── 2-D overlay: name tags + chat bubbles ─────────────────
  _drawOverlay(remotePlayers) {
    const ctx = this._overlayCtx;
    const W   = this._overlay.width;
    const H   = this._overlay.height;

    ctx.clearRect(0, 0, W, H);

    for (const [id, p] of Object.entries(remotePlayers)) {
      // World-space point just above the character's head
      const worldPos = new THREE.Vector3(
        p.x ?? 0,
        (p.y ?? 0) + 2.3,
        p.z ?? 0
      );
      worldPos.project(camera);

      // Skip if behind camera or far off-screen
      if (worldPos.z > 1) continue;
      const sx = (worldPos.x *  0.5 + 0.5) * W;
      const sy = (worldPos.y * -0.5 + 0.5) * H;
      if (sx < -80 || sx > W + 80 || sy < -80 || sy > H + 80) continue;

      // ── Name tag ──────────────────────────────────────────
      const name = p.name || 'Player';
      ctx.font         = '9px "Press Start 2P", monospace';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';

      const tw  = ctx.measureText(name).width;
      const pad = 5;
      const bw  = tw + pad * 2;
      const bh  = 18;

      // Background pill
      ctx.fillStyle = 'rgba(13,13,26,0.80)';
      ctx.beginPath();
      ctx.roundRect(sx - bw / 2, sy - bh / 2, bw, bh, 4);
      ctx.fill();

      // Coloured border
      ctx.strokeStyle = p.colour || '#ffffff';
      ctx.lineWidth   = 1;
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.fillText(name, sx, sy);

      // ── Chat bubble ───────────────────────────────────────
      const bubble = this._bubbles[id];
      if (bubble && performance.now() < bubble.expires) {
        const fade   = Math.min(1, (bubble.expires - performance.now()) / 500);
        const bubbleY = sy - bh - 10;

        ctx.save();
        ctx.globalAlpha = fade;
        ctx.font        = '15px "VT323", monospace';
        ctx.textAlign   = 'center';
        ctx.textBaseline = 'middle';

        const btw = ctx.measureText(bubble.text).width;
        const bp  = 8;
        const bbw = btw + bp * 2;
        const bbh = 22;

        // Bubble background
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.beginPath();
        ctx.roundRect(sx - bbw / 2, bubbleY - bbh / 2, bbw, bbh, 6);
        ctx.fill();

        // Tail
        ctx.beginPath();
        ctx.moveTo(sx - 5, bubbleY + bbh / 2);
        ctx.lineTo(sx,     bubbleY + bbh / 2 + 7);
        ctx.lineTo(sx + 5, bubbleY + bbh / 2);
        ctx.fill();

        ctx.fillStyle = '#111';
        ctx.fillText(bubble.text, sx, bubbleY);
        ctx.restore();
      }
    }

    ctx.textAlign    = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  // ── Minimap: bake static zone-colour background ───────────
  _bakeMinimap() {
    const bg   = document.createElement('canvas');
    bg.width   = MINIMAP_SIZE;
    bg.height  = MINIMAP_SIZE;
    const bctx = bg.getContext('2d');
    const S    = MINIMAP_SIZE / MINIMAP_RES;

    for (let iy = 0; iy < MINIMAP_RES; iy++) {
      for (let ix = 0; ix < MINIMAP_RES; ix++) {
        const wx = -HALF + (ix / MINIMAP_RES) * WORLD_SIZE;
        const wz = -HALF + (iy / MINIMAP_RES) * WORLD_SIZE;
        bctx.fillStyle = ZONE_COLOR[getZoneName(wx, wz)] || '#204010';
        bctx.fillRect(
          ix * S, iy * S,
          Math.ceil(S) + 1, Math.ceil(S) + 1
        );
      }
    }
    return bg;
  }

  // ── Minimap: draw live frame ──────────────────────────────
  _drawMinimap(localPlayer, remotePlayers) {
    const ctx  = this._miniCtx;
    const size = MINIMAP_SIZE;
    const half = size / 2;

    ctx.clearRect(0, 0, size, size);

    // Circular clip
    ctx.save();
    ctx.beginPath();
    ctx.arc(half, half, half, 0, Math.PI * 2);
    ctx.clip();

    // Baked background
    if (this._minimapBg) ctx.drawImage(this._minimapBg, 0, 0);

    // Helper: world → minimap pixel
    const toMX = wx => ((wx + HALF) / WORLD_SIZE) * size;
    const toMY = wz => ((wz + HALF) / WORLD_SIZE) * size;

    // Remote players — coloured dots
    for (const p of Object.values(remotePlayers)) {
      const mx = toMX(p.x ?? 0);
      const my = toMY(p.z ?? 0);
      ctx.fillStyle = p.colour || '#ffffff';
      ctx.beginPath();
      ctx.arc(mx, my, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Local player — white dot + direction triangle
    const lpx = toMX(localPlayer.x);
    const lpy = toMY(localPlayer.z);

    ctx.fillStyle   = '#ffffff';
    ctx.strokeStyle = localPlayer.colour || '#00f5c4';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.arc(lpx, lpy, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Direction arrow (rotated by yaw)
    ctx.save();
    ctx.translate(lpx, lpy);
    // Three.js yaw = 0 → looking down -Z (north on minimap).
    // Minimap +Y = +Z world, so arrow pointing "up minimap" = -Z world = yaw 0.
    ctx.rotate(-localPlayer.yaw);
    ctx.fillStyle = '#00f5c4';
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(-3, 0);
    ctx.lineTo(3, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.restore(); // remove circular clip
  }

  // ── Internal helpers ──────────────────────────────────────
  _resizeOverlay() {
    this._overlay.width  = window.innerWidth;
    this._overlay.height = window.innerHeight;
  }
}

// ── Standalone helper: create a positioned canvas element ──
function _mkCanvas(cssText) {
  const c = document.createElement('canvas');
  c.style.cssText = cssText;
  return c;
}
