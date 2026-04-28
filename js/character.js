// ============================================================
//  WalkWorld 3D — character.js
//
//  Block-character system (Roblox-inspired).
//
//  ── What this file provides ──────────────────────────────────
//  buildCharacter(config)       — returns a THREE.Group
//  CharacterEditor              — class: in-game customisation panel
//  getLocalCharConfig()         — reads config from sessionStorage
//  saveLocalCharConfig(config)  — writes config to sessionStorage
//
//  ── Config object ────────────────────────────────────────────
//  {
//    skinColour  : '#f0c890',   // hex
//    shirtColour : '#1e90ff',   // hex
//    pantsColour : '#2c2c3a',   // hex
//    hairStyle   : 'none' | 'afro' | 'straight' | 'spiky' | 'bun',
//    hairColour  : '#3a2010',   // hex
//    height      : 1.0,         // scale 0.70 – 1.40
//    faceDataUrl : null | 'data:image/...'  // uploaded face texture
//  }
//
//  ── Integration notes ────────────────────────────────────────
//  • renderer.js already has its own makeBlockChar() which reads
//    only p.colour for remote players. If you want full config
//    synced for remote players you can replace that call with
//    buildCharacter({ shirtColour: p.colour, ...defaults }).
//
//  • game.js should call:
//      import { CharacterEditor, getLocalCharConfig } from './character.js';
//      const charEditor = new CharacterEditor();
//      charEditor.mount(document.getElementById('gameWrapper'));
//    Then pass getLocalCharConfig() alongside player name/colour
//    so your HUD avatar reflects customisation.
// ============================================================

// ── Default config ────────────────────────────────────────────
export const DEFAULT_CHAR_CONFIG = {
  skinColour  : '#f0c890',
  shirtColour : '#1e90ff',
  pantsColour : '#2c2c3a',
  hairStyle   : 'straight',
  hairColour  : '#3a2010',
  height      : 1.0,
  faceDataUrl : null,
};

const CONFIG_KEY = 'walkworld_char_config';

export function getLocalCharConfig() {
  try {
    const raw = sessionStorage.getItem(CONFIG_KEY);
    if (!raw) return { ...DEFAULT_CHAR_CONFIG };
    return { ...DEFAULT_CHAR_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CHAR_CONFIG };
  }
}

export function saveLocalCharConfig(config) {
  try {
    sessionStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch {/* storage full — ignore */}
}

// ── Shared geometry cache ─────────────────────────────────────
let _G = null;
function geoms() {
  if (_G) return _G;
  _G = {
    head      : new THREE.BoxGeometry(0.55, 0.55, 0.55),
    torso     : new THREE.BoxGeometry(0.55, 0.70, 0.30),
    limb      : new THREE.BoxGeometry(0.22, 0.55, 0.22),
    leg       : new THREE.BoxGeometry(0.22, 0.60, 0.22),
    // Hair shapes (reused across many characters)
    afro      : new THREE.SphereGeometry(0.35, 8, 6),
    straight  : new THREE.BoxGeometry(0.60, 0.12, 0.60),
    bun       : new THREE.SphereGeometry(0.18, 7, 5),
    spikeBase : new THREE.ConeGeometry(0.07, 0.32, 4),
  };
  return _G;
}

// ── Texture cache (face uploads) ─────────────────────────────
const _texCache = {};
function getFaceTex(dataUrl) {
  if (!dataUrl) return null;
  if (_texCache[dataUrl]) return _texCache[dataUrl];
  const t = new THREE.TextureLoader().load(dataUrl);
  _texCache[dataUrl] = t;
  return t;
}

// ── Hair builders ─────────────────────────────────────────────
function _addHair(group, style, colour, headTopY) {
  if (style === 'none') return;

  const mat = new THREE.MeshLambertMaterial({ color: colour });
  const g   = geoms();

  if (style === 'afro') {
    const m = new THREE.Mesh(g.afro, mat);
    m.position.y = headTopY + 0.18;
    group.add(m);
  }

  if (style === 'straight') {
    const m = new THREE.Mesh(g.straight, mat);
    m.position.y = headTopY + 0.02;
    group.add(m);
    // Side flaps hanging down
    const flap = new THREE.BoxGeometry(0.62, 0.22, 0.10);
    [-1, 1].forEach(side => {
      const f = new THREE.Mesh(flap, mat);
      f.position.set(0, headTopY - 0.13, side * 0.32);
      group.add(f);
    });
  }

  if (style === 'spiky') {
    const offsets = [
      [0, 0], [0.12, 0.06], [-0.12, 0.06],
      [0.06, -0.10], [-0.06, -0.10],
    ];
    offsets.forEach(([ox, oz]) => {
      const m = new THREE.Mesh(g.spikeBase, mat);
      m.position.set(ox, headTopY + 0.16, oz);
      m.rotation.z = ox * 1.8;
      m.rotation.x = oz * 1.4;
      group.add(m);
    });
  }

  if (style === 'bun') {
    // Flat cap
    const cap = new THREE.Mesh(g.straight, mat);
    cap.position.y = headTopY + 0.02;
    group.add(cap);
    // Bun on top
    const bun = new THREE.Mesh(g.bun, mat);
    bun.position.y = headTopY + 0.20;
    group.add(bun);
  }
}

// ── Main builder ──────────────────────────────────────────────
/**
 * Build a fully-customised block character as a THREE.Group.
 * The group's origin is at the player's feet (y = 0).
 *
 * @param {object} cfg — character config (merged with defaults)
 * @returns {THREE.Group}
 */
export function buildCharacter(cfg = {}) {
  const c   = { ...DEFAULT_CHAR_CONFIG, ...cfg };
  const g   = geoms();

  const skinMat  = new THREE.MeshLambertMaterial({ color: c.skinColour });
  const shirtMat = new THREE.MeshLambertMaterial({ color: c.shirtColour });
  const pantsMat = new THREE.MeshLambertMaterial({
    color: new THREE.Color(c.pantsColour),
  });

  // Face texture overrides front face of head box
  let headMat = skinMat;
  const faceTex = getFaceTex(c.faceDataUrl);
  if (faceTex) {
    // BoxGeometry faces order: +X, -X, +Y, -Y, +Z (front), -Z (back)
    headMat = [
      skinMat, skinMat, skinMat, skinMat,
      new THREE.MeshLambertMaterial({ map: faceTex }),
      skinMat,
    ];
  }

  const group = new THREE.Group();

  // ── Head ────────────────────────────────────────────────────
  const head = new THREE.Mesh(g.head, headMat);
  head.position.y = 1.60;
  group.add(head);    // index [0]

  // ── Torso ───────────────────────────────────────────────────
  const torso = new THREE.Mesh(g.torso, shirtMat);
  torso.position.y = 0.95;
  group.add(torso);   // index [1]

  // ── Arms ────────────────────────────────────────────────────
  const lArm = new THREE.Mesh(g.limb, shirtMat);
  lArm.position.set(-0.40, 0.96, 0);
  group.add(lArm);    // index [2]

  const rArm = new THREE.Mesh(g.limb, shirtMat);
  rArm.position.set( 0.40, 0.96, 0);
  group.add(rArm);    // index [3]

  // ── Legs ────────────────────────────────────────────────────
  const lLeg = new THREE.Mesh(g.leg, pantsMat);
  lLeg.position.set(-0.17, 0.35, 0);
  group.add(lLeg);    // index [4]

  const rLeg = new THREE.Mesh(g.leg, pantsMat);
  rLeg.position.set( 0.17, 0.35, 0);
  group.add(rLeg);    // index [5]

  // ── Hair ────────────────────────────────────────────────────
  // Head top sits at 1.60 + 0.55/2 = 1.875
  _addHair(group, c.hairStyle, c.hairColour, 1.875);

  // ── Height scale ────────────────────────────────────────────
  // Clamp to allowed range before applying
  const scale = Math.max(0.70, Math.min(1.40, c.height));
  group.scale.setScalar(scale);

  return group;
}

// ============================================================
//  CHARACTER EDITOR — in-game customisation panel
// ============================================================

const HAIR_STYLES = ['none', 'straight', 'afro', 'spiky', 'bun'];
const SKIN_PRESETS  = ['#f0c890','#d4956a','#a0643a','#7a3f20','#4a2010','#ffe0d0'];
const SHIRT_PRESETS = [
  '#1e90ff','#e03030','#2ed573','#ffa502',
  '#a29bfe','#fd79a8','#ffffff','#333355',
];
const PANTS_PRESETS = [
  '#2c2c3a','#1a3a6a','#3a2010','#2a4a2a',
  '#555555','#8b6914','#000000','#4a0a0a',
];
const HAIR_PRESETS  = [
  '#3a2010','#1a1a1a','#c8a020','#e08030',
  '#a0a0a0','#ffffff','#e03030','#4060c0',
];

/**
 * Manages the character customisation panel and the live 3D preview.
 *
 * Usage:
 *   const editor = new CharacterEditor();
 *   editor.mount(document.getElementById('gameWrapper'));
 *   // later:
 *   editor.open();
 *   editor.close();
 */
export class CharacterEditor {

  constructor() {
    this._config  = getLocalCharConfig();
    this._panel   = null;
    this._preview = null;   // THREE scene for the preview thumbnail
    this._mounted = false;
    this._open    = false;
  }

  /** Inject DOM into parent element and wire all events. */
  mount(parent = document.body) {
    if (this._mounted) return;
    this._mounted = true;

    // ── Inject CSS ────────────────────────────────────────────
    if (!document.getElementById('_charEditorStyles')) {
      const s = document.createElement('style');
      s.id = '_charEditorStyles';
      s.textContent = EDITOR_CSS;
      document.head.appendChild(s);
    }

    // ── Build DOM ─────────────────────────────────────────────
    const el = document.createElement('div');
    el.id        = 'charEditor';
    el.className = 'ce-panel ce-hidden';
    el.innerHTML = _panelHTML();
    parent.appendChild(el);
    this._panel = el;

    // ── Wire controls ─────────────────────────────────────────
    this._wire();

    // ── 3-D thumbnail preview ─────────────────────────────────
    this._initPreview();

    // ── Seed UI from saved config ─────────────────────────────
    this._refreshUI();
  }

  open() {
    if (!this._panel) return;
    this._open = true;
    this._panel.classList.remove('ce-hidden');
    this._tickPreview();
  }

  close() {
    if (!this._panel) return;
    this._open = false;
    this._panel.classList.add('ce-hidden');
  }

  toggle() {
    this._open ? this.close() : this.open();
  }

  isOpen() { return this._open; }

  // ── Internal: wire all input events ─────────────────────────
  _wire() {
    const el  = this._panel;
    const cfg = this._config;

    // Close button
    el.querySelector('#ce-close').addEventListener('click', () => this.close());

    // Colour swatches (skin / shirt / pants / hair)
    el.addEventListener('click', e => {
      const sw = e.target.closest('[data-ce-swatch]');
      if (!sw) return;
      const field = sw.dataset.ceSwatch;
      const val   = sw.dataset.ceVal;
      cfg[field]  = val;
      this._highlightSwatch(field, val);
      this._updatePreview();
      saveLocalCharConfig(cfg);
    });

    // Hair style buttons
    el.addEventListener('click', e => {
      const btn = e.target.closest('[data-ce-hair]');
      if (!btn) return;
      cfg.hairStyle = btn.dataset.ceHair;
      el.querySelectorAll('[data-ce-hair]').forEach(b =>
        b.classList.toggle('ce-active', b.dataset.ceHair === cfg.hairStyle)
      );
      this._updatePreview();
      saveLocalCharConfig(cfg);
    });

    // Height slider
    const slider = el.querySelector('#ce-height');
    if (slider) {
      slider.addEventListener('input', () => {
        cfg.height = parseFloat(slider.value);
        el.querySelector('#ce-height-val').textContent =
          cfg.height.toFixed(2) + '×';
        this._updatePreview();
        saveLocalCharConfig(cfg);
      });
    }

    // Face image upload
    const upload = el.querySelector('#ce-face-upload');
    if (upload) {
      upload.addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
          cfg.faceDataUrl = ev.target.result;
          const thumb = el.querySelector('#ce-face-thumb');
          if (thumb) {
            thumb.style.backgroundImage = `url(${cfg.faceDataUrl})`;
            thumb.textContent = '';
          }
          this._updatePreview();
          saveLocalCharConfig(cfg);
        };
        reader.readAsDataURL(file);
      });
    }

    // Clear face
    const clearFace = el.querySelector('#ce-face-clear');
    if (clearFace) {
      clearFace.addEventListener('click', () => {
        cfg.faceDataUrl = null;
        const thumb = el.querySelector('#ce-face-thumb');
        if (thumb) {
          thumb.style.backgroundImage = '';
          thumb.textContent = '😊';
        }
        this._updatePreview();
        saveLocalCharConfig(cfg);
      });
    }

    // Reset all
    el.querySelector('#ce-reset')?.addEventListener('click', () => {
      this._config = { ...DEFAULT_CHAR_CONFIG };
      saveLocalCharConfig(this._config);
      this._refreshUI();
      this._updatePreview();
    });
  }

  // ── Internal: reflect config → UI state ─────────────────────
  _refreshUI() {
    const el  = this._panel;
    const cfg = this._config;

    ['skinColour','shirtColour','pantsColour','hairColour'].forEach(f => {
      this._highlightSwatch(f, cfg[f]);
    });

    el.querySelectorAll('[data-ce-hair]').forEach(b => {
      b.classList.toggle('ce-active', b.dataset.ceHair === cfg.hairStyle);
    });

    const slider = el.querySelector('#ce-height');
    if (slider) {
      slider.value = cfg.height;
      const lbl = el.querySelector('#ce-height-val');
      if (lbl) lbl.textContent = cfg.height.toFixed(2) + '×';
    }

    const thumb = el.querySelector('#ce-face-thumb');
    if (thumb) {
      if (cfg.faceDataUrl) {
        thumb.style.backgroundImage = `url(${cfg.faceDataUrl})`;
        thumb.textContent = '';
      } else {
        thumb.style.backgroundImage = '';
        thumb.textContent = '😊';
      }
    }
  }

  _highlightSwatch(field, val) {
    this._panel.querySelectorAll(`[data-ce-swatch="${field}"]`).forEach(sw => {
      sw.classList.toggle('ce-active', sw.dataset.ceVal === val);
    });
  }

  // ── Internal: mini THREE.js preview ─────────────────────────
  _initPreview() {
    const canvas = this._panel.querySelector('#ce-preview-canvas');
    if (!canvas || typeof THREE === 'undefined') return;

    const W = 120, H = 180;
    canvas.width  = W;
    canvas.height = H;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setClearColor(0x000000, 0);

    const previewScene = new THREE.Scene();
    previewScene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dLight = new THREE.DirectionalLight(0xfff0cc, 0.9);
    dLight.position.set(2, 4, 3);
    previewScene.add(dLight);

    const cam = new THREE.PerspectiveCamera(42, W / H, 0.1, 50);
    cam.position.set(0, 1.0, 3.4);
    cam.lookAt(0, 1.0, 0);

    this._prevRenderer = renderer;
    this._prevScene    = previewScene;
    this._prevCam      = cam;
    this._prevGroup    = null;

    this._updatePreview();
  }

  _updatePreview() {
    if (!this._prevScene) return;

    if (this._prevGroup) {
      this._prevScene.remove(this._prevGroup);
    }

    this._prevGroup = buildCharacter(this._config);
    this._prevScene.add(this._prevGroup);

    // Render immediately + keep a slow spin going while panel is open
    this._renderPreview();
  }

  _renderPreview() {
    if (!this._prevRenderer) return;
    // Slight turntable rotation
    if (this._prevGroup) {
      this._prevGroup.rotation.y += 0.015;
    }
    this._prevRenderer.render(this._prevScene, this._prevCam);
  }

  _tickPreview() {
    if (!this._open) return;
    this._renderPreview();
    requestAnimationFrame(() => this._tickPreview());
  }
}

// ── Panel HTML ────────────────────────────────────────────────
function _panelHTML() {
  function swatches(field, presets) {
    return presets.map(c =>
      `<button class="ce-swatch" data-ce-swatch="${field}" data-ce-val="${c}"
         style="background:${c}" aria-label="${c}"></button>`
    ).join('');
  }

  const hairBtns = HAIR_STYLES.map(s =>
    `<button class="ce-hair-btn" data-ce-hair="${s}">${s}</button>`
  ).join('');

  return `
    <div class="ce-header">
      <span class="ce-title">CHARACTER</span>
      <button id="ce-close" class="ce-close-btn" aria-label="Close">✕</button>
    </div>

    <div class="ce-body">

      <!-- 3D preview -->
      <div class="ce-preview-wrap">
        <canvas id="ce-preview-canvas"></canvas>
      </div>

      <!-- Skin colour -->
      <div class="ce-section">
        <p class="ce-label">SKIN</p>
        <div class="ce-swatches">${swatches('skinColour', SKIN_PRESETS)}</div>
      </div>

      <!-- Shirt colour -->
      <div class="ce-section">
        <p class="ce-label">SHIRT</p>
        <div class="ce-swatches">${swatches('shirtColour', SHIRT_PRESETS)}</div>
      </div>

      <!-- Pants colour -->
      <div class="ce-section">
        <p class="ce-label">PANTS</p>
        <div class="ce-swatches">${swatches('pantsColour', PANTS_PRESETS)}</div>
      </div>

      <!-- Hair style -->
      <div class="ce-section">
        <p class="ce-label">HAIR STYLE</p>
        <div class="ce-hair-row">${hairBtns}</div>
      </div>

      <!-- Hair colour -->
      <div class="ce-section">
        <p class="ce-label">HAIR COLOUR</p>
        <div class="ce-swatches">${swatches('hairColour', HAIR_PRESETS)}</div>
      </div>

      <!-- Height -->
      <div class="ce-section">
        <p class="ce-label">HEIGHT &nbsp;<span id="ce-height-val">1.00×</span></p>
        <input
          id="ce-height"
          class="ce-slider"
          type="range"
          min="0.70" max="1.40" step="0.01"
          value="1.00"
          aria-label="Character height"
        />
        <div class="ce-slider-labels"><span>Short</span><span>Tall</span></div>
      </div>

      <!-- Face texture -->
      <div class="ce-section">
        <p class="ce-label">FACE</p>
        <div class="ce-face-row">
          <div id="ce-face-thumb" class="ce-face-thumb">😊</div>
          <label class="ce-upload-btn">
            Upload Image
            <input id="ce-face-upload" type="file" accept="image/*" hidden />
          </label>
          <button id="ce-face-clear" class="ce-clear-btn">✕</button>
        </div>
      </div>

      <!-- Actions -->
      <div class="ce-actions">
        <button id="ce-reset" class="ce-reset-btn">Reset Defaults</button>
      </div>

    </div>
  `;
}

// ── Injected CSS ──────────────────────────────────────────────
const EDITOR_CSS = `
  .ce-panel {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 80;
    width: min(340px, 94vw);
    max-height: 88dvh;
    overflow-y: auto;
    background: #13132b;
    border: 2px solid #2a2a5a;
    border-radius: 4px;
    box-shadow: 0 0 0 1px #2a2a5a, 0 12px 48px rgba(0,0,0,.75);
    font-family: 'VT323', monospace;
    color: #e8e8f0;
    scrollbar-width: thin;
    scrollbar-color: #2a2a5a transparent;
    /* Scrollbar for webkit */
  }
  .ce-panel::-webkit-scrollbar { width: 4px; }
  .ce-panel::-webkit-scrollbar-track { background: transparent; }
  .ce-panel::-webkit-scrollbar-thumb { background: #2a2a5a; border-radius: 2px; }

  .ce-hidden { display: none !important; }

  .ce-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px 8px;
    border-bottom: 1px solid #2a2a5a;
    position: sticky;
    top: 0;
    background: #13132b;
    z-index: 2;
  }
  .ce-title {
    font-family: 'Press Start 2P', monospace;
    font-size: 9px;
    color: #00f5c4;
    letter-spacing: 2px;
  }
  .ce-close-btn {
    background: none;
    border: none;
    color: #6868a8;
    font-size: 18px;
    cursor: pointer;
    padding: 0 4px;
    line-height: 1;
    transition: color .15s;
  }
  .ce-close-btn:hover { color: #e8e8f0; }

  .ce-body { padding: 10px 14px 16px; display: flex; flex-direction: column; gap: 12px; }

  .ce-preview-wrap {
    display: flex;
    justify-content: center;
    padding: 6px 0 2px;
  }
  #ce-preview-canvas {
    border-radius: 4px;
    background: #0d0d1a;
    border: 1px solid #2a2a5a;
  }

  .ce-section { display: flex; flex-direction: column; gap: 5px; }

  .ce-label {
    font-family: 'Press Start 2P', monospace;
    font-size: 7px;
    color: #6868a8;
    letter-spacing: 1px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .ce-label span { color: #00f5c4; font-size: 8px; }

  .ce-swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .ce-swatch {
    width: 28px; height: 28px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    transition: transform .12s, border-color .12s;
    flex-shrink: 0;
  }
  .ce-swatch:hover  { transform: scale(1.15); }
  .ce-swatch.ce-active {
    border-color: #ffffff;
    transform: scale(1.2);
    box-shadow: 0 0 0 2px currentColor;
  }

  .ce-hair-row {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
  .ce-hair-btn {
    padding: 4px 9px;
    font-family: 'VT323', monospace;
    font-size: 17px;
    color: #6868a8;
    background: #0d0d1a;
    border: 1px solid #2a2a5a;
    border-radius: 4px;
    cursor: pointer;
    text-transform: capitalize;
    transition: color .12s, border-color .12s, background .12s;
  }
  .ce-hair-btn:hover   { color: #e8e8f0; border-color: #6868a8; }
  .ce-hair-btn.ce-active {
    color: #0d0d1a;
    background: #00f5c4;
    border-color: #00f5c4;
  }

  .ce-slider {
    width: 100%;
    accent-color: #00f5c4;
    cursor: pointer;
    height: 4px;
  }
  .ce-slider-labels {
    display: flex;
    justify-content: space-between;
    font-size: 15px;
    color: #6868a8;
    margin-top: -2px;
  }

  .ce-face-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .ce-face-thumb {
    width: 44px; height: 44px;
    border: 1px solid #2a2a5a;
    border-radius: 4px;
    background: #0d0d1a center/cover no-repeat;
    font-size: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .ce-upload-btn {
    flex: 1;
    padding: 7px 12px;
    background: #0d0d1a;
    border: 1px solid #2a2a5a;
    border-radius: 4px;
    color: #e8e8f0;
    font-family: 'VT323', monospace;
    font-size: 18px;
    cursor: pointer;
    text-align: center;
    transition: border-color .15s;
  }
  .ce-upload-btn:hover { border-color: #00f5c4; color: #00f5c4; }
  .ce-clear-btn {
    background: #0d0d1a;
    border: 1px solid #2a2a5a;
    border-radius: 4px;
    color: #6868a8;
    width: 32px; height: 32px;
    font-size: 16px;
    cursor: pointer;
    transition: color .12s;
  }
  .ce-clear-btn:hover { color: #ff4757; border-color: #ff4757; }

  .ce-actions { display: flex; justify-content: flex-end; padding-top: 4px; }
  .ce-reset-btn {
    padding: 6px 14px;
    background: none;
    border: 1px solid #2a2a5a;
    border-radius: 4px;
    color: #6868a8;
    font-family: 'VT323', monospace;
    font-size: 17px;
    cursor: pointer;
    transition: color .15s, border-color .15s;
  }
  .ce-reset-btn:hover { color: #ff4757; border-color: #ff4757; }

  @media (max-height: 600px) {
    .ce-panel { max-height: 98dvh; }
  }
`;
