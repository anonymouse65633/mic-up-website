// ============================================================
//  WalkWorld 3D — atmosphere.js  (PART 2)
//
//  Depth-driven atmosphere system.
//  Handles: fog colour/density · ambient light intensity ·
//           sky colour · player headlamp · underground audio
//
//  Public API
//  ----------
//  initAtmosphere(scene, ambientLight, sunLight)
//  tickAtmosphere(depth, dt)          — call every frame
//  setHeadlampOwned(bool)             — call when Headlamp item bought
// ============================================================

// ── Layer atmosphere definitions ─────────────────────────────
// Each entry maps to a LAYERS depth band.
// fogColor / skyColor are THREE.Color hex integers.
const ATMOS_BANDS = [
  {
    minDepth: 0,   maxDepth: 6,
    fogColor: 0xa4d4e8, fogDensity: 0.0095,
    skyColor: 0x7ec8e3,
    ambientIntensity: 1.00, sunIntensity: 1.05,
    audioTrack: 'wind',
    label: 'surface',
  },
  {
    minDepth: 6,   maxDepth: 18,
    fogColor: 0xc8a87a, fogDensity: 0.013,
    skyColor: 0x9a7a50,
    ambientIntensity: 0.80, sunIntensity: 0.7,
    audioTrack: 'wind',
    label: 'clay',
  },
  {
    minDepth: 18,  maxDepth: 42,
    fogColor: 0x606060, fogDensity: 0.017,
    skyColor: 0x404040,
    ambientIntensity: 0.60, sunIntensity: 0.4,
    audioTrack: 'drip',
    label: 'stone',
  },
  {
    minDepth: 42,  maxDepth: 65,
    fogColor: 0x8a6630, fogDensity: 0.020,
    skyColor: 0x5a4020,
    ambientIntensity: 0.50, sunIntensity: 0.25,
    audioTrack: 'drip',
    label: 'sandstone',
  },
  {
    minDepth: 65,  maxDepth: 110,
    fogColor: 0x1a1a44, fogDensity: 0.025,
    skyColor: 0x0d0d2a,
    ambientIntensity: 0.35, sunIntensity: 0.10,
    audioTrack: 'hum',
    label: 'darkstone',
  },
  {
    minDepth: 110, maxDepth: 160,
    fogColor: 0x0d0d1a, fogDensity: 0.032,
    skyColor: 0x050510,
    ambientIntensity: 0.18, sunIntensity: 0.02,
    audioTrack: 'hum',
    label: 'obsidian',
    needsHeadlamp: true,
  },
  {
    minDepth: 160, maxDepth: 250,
    fogColor: 0x331400, fogDensity: 0.038,
    skyColor: 0x1a0800,
    ambientIntensity: 0.08, sunIntensity: 0.00,
    audioTrack: 'rumble',
    label: 'denseore',
    needsHeadlamp: true,
  },
  {
    minDepth: 250, maxDepth: 9999,
    fogColor: 0x000000, fogDensity: 0.045,
    skyColor: 0x000000,
    ambientIntensity: 0.02, sunIntensity: 0.00,
    audioTrack: 'rumble',
    label: 'void',
    needsHeadlamp: true,
  },
];

// ── Module state ──────────────────────────────────────────────
let _scene     = null;
let _ambient   = null;
let _sun       = null;

// Lerp state — "current" values interpolate toward "target"
const _cur = {
  fogR: 0.64, fogG: 0.83, fogB: 0.91,   // #a4d4e8
  fogDensity: 0.0095,
  skyR: 0.49, skyG: 0.78, skyB: 0.89,   // #7ec8e3
  ambientIntensity: 1.00,
  sunIntensity: 1.05,
};

// Headlamp (PointLight attached to the camera group)
let _headlamp        = null;
let _headlampOwned   = false;
let _headlampTargetI = 0;

// Audio system
let _audioCtx    = null;
let _audioGains  = {};    // track name → GainNode
let _audioSrcs   = {};    // track name → AudioBufferSourceNode
let _lastTrack   = null;
const AUDIO_URLS = {
  wind  : null,   // synthesised — no external file needed
  drip  : null,
  hum   : null,
  rumble: null,
};

// HUD darkness-vignette overlay
let _vignetteEl = null;

// ── Helpers ───────────────────────────────────────────────────
function _hexToRgb(hex) {
  return {
    r: ((hex >> 16) & 0xff) / 255,
    g: ((hex >>  8) & 0xff) / 255,
    b: ( hex        & 0xff) / 255,
  };
}

function _lerp(a, b, t) { return a + (b - a) * t; }

function _getTargetBand(depth) {
  for (let i = ATMOS_BANDS.length - 1; i >= 0; i--) {
    if (depth >= ATMOS_BANDS[i].minDepth) return ATMOS_BANDS[i];
  }
  return ATMOS_BANDS[0];
}

// ── Vignette (darkness overlay that intensifies underground) ──
function _ensureVignette() {
  if (_vignetteEl) return;
  _vignetteEl = document.createElement('div');
  _vignetteEl.id = 'atmos-vignette';
  _vignetteEl.style.cssText = [
    'position:fixed','inset:0','pointer-events:none','z-index:5',
    'background:radial-gradient(ellipse at center, transparent 35%, rgba(0,0,0,0) 100%)',
    'transition:opacity 1.5s',
    'opacity:0',
  ].join(';');
  document.body.appendChild(_vignetteEl);
}

function _setVignetteStrength(depth) {
  if (!_vignetteEl) return;
  // 0 at surface, 0.55 at The Void
  const t = Math.min(1, depth / 250);
  const opacity = t * 0.55;
  _vignetteEl.style.background = `radial-gradient(ellipse at center, transparent 35%, rgba(0,0,0,${(t * 0.7).toFixed(2)}) 100%)`;
  _vignetteEl.style.opacity = opacity.toFixed(3);
}

// ── Audio (synthesised, no external files) ────────────────────
function _ensureAudioCtx() {
  if (_audioCtx) return;
  try {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch {
    _audioCtx = null;
  }
}

// Build a looping synthesised ambient buffer
function _buildAmbientBuffer(trackName) {
  if (!_audioCtx) return null;
  const sampleRate = _audioCtx.sampleRate;
  const duration   = 4; // seconds — will loop seamlessly
  const frames     = sampleRate * duration;
  const buf        = _audioCtx.createBuffer(1, frames, sampleRate);
  const data       = buf.getChannelData(0);

  if (trackName === 'wind') {
    // Pink-ish noise that slowly modulates
    let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0;
    for (let i = 0; i < frames; i++) {
      const w = (Math.random() * 2) - 1;
      b0=0.99886*b0+w*0.0555179; b1=0.99332*b1+w*0.0750759;
      b2=0.96900*b2+w*0.1538520; b3=0.86650*b3+w*0.3104856;
      b4=0.55000*b4+w*0.5329522; b5=-0.7616*b5-w*0.0168980;
      const env = 0.5 + 0.5 * Math.sin(i / frames * Math.PI * 2);
      data[i] = (b0+b1+b2+b3+b4+b5) * 0.028 * env;
    }
  } else if (trackName === 'drip') {
    // Slower, lower frequency noise — cave echo
    for (let i = 0; i < frames; i++) {
      const n = (Math.random() * 2) - 1;
      const lp = (i > 0 ? data[i-1] : 0) * 0.92 + n * 0.08;
      data[i] = lp * 0.25;
    }
  } else if (trackName === 'hum') {
    // Deep sine drone + light harmonics
    for (let i = 0; i < frames; i++) {
      const t = i / sampleRate;
      data[i] = (
        Math.sin(2 * Math.PI * 42 * t) * 0.12 +
        Math.sin(2 * Math.PI * 84 * t) * 0.06 +
        Math.sin(2 * Math.PI * 31 * t + 0.3) * 0.08
      ) * (0.5 + 0.5 * Math.sin(t * 0.4));
    }
  } else if (trackName === 'rumble') {
    // Very low sub-bass throb
    for (let i = 0; i < frames; i++) {
      const t = i / sampleRate;
      data[i] = (
        Math.sin(2 * Math.PI * 18 * t) * 0.18 +
        (Math.random() * 2 - 1) * 0.03
      ) * (0.5 + 0.5 * Math.sin(t * 0.2));
    }
  }
  return buf;
}

function _crossFadeTo(trackName) {
  if (!_audioCtx || trackName === _lastTrack) return;
  _ensureAudioCtx();
  if (_audioCtx.state === 'suspended') {
    _audioCtx.resume().catch(() => {});
  }

  // Fade out old
  if (_lastTrack && _audioGains[_lastTrack]) {
    const g = _audioGains[_lastTrack];
    g.gain.setTargetAtTime(0, _audioCtx.currentTime, 0.8);
    setTimeout(() => {
      try {
        _audioSrcs[_lastTrack]?.stop();
        _audioSrcs[_lastTrack] = null;
      } catch {}
    }, 3000);
  }

  _lastTrack = trackName;

  // Fade in new
  const buf = _buildAmbientBuffer(trackName);
  if (!buf) return;
  const src  = _audioCtx.createBufferSource();
  src.buffer = buf;
  src.loop   = true;

  const gain = _audioCtx.createGain();
  gain.gain.setValueAtTime(0, _audioCtx.currentTime);
  gain.gain.setTargetAtTime(0.15, _audioCtx.currentTime, 0.8);

  src.connect(gain);
  gain.connect(_audioCtx.destination);
  src.start();

  _audioGains[trackName] = gain;
  _audioSrcs[trackName]  = src;
}

// ── Public API ────────────────────────────────────────────────

/**
 * Call once after initWorld().
 * @param {THREE.Scene}            sceneRef
 * @param {THREE.AmbientLight}     ambientRef
 * @param {THREE.DirectionalLight} sunRef
 * @param {THREE.Camera}           cameraRef  — headlamp attaches here
 */
export function initAtmosphere(sceneRef, ambientRef, sunRef, cameraRef) {
  _scene   = sceneRef;
  _ambient = ambientRef;
  _sun     = sunRef;

  _ensureVignette();

  // Headlamp — PointLight follows the camera, used in deep layers
  _headlamp = new THREE.PointLight(0xfff8e0, 0, 12);
  if (cameraRef) cameraRef.add(_headlamp);
  else _scene.add(_headlamp);
  _headlamp.position.set(0, 0, 0);

  // Resume audio on first user gesture (browser policy)
  document.addEventListener('click',   _resumeAudio, { once: true });
  document.addEventListener('keydown', _resumeAudio, { once: true });
}

function _resumeAudio() {
  _ensureAudioCtx();
  if (_audioCtx?.state === 'suspended') _audioCtx.resume().catch(() => {});
  // Start surface wind track immediately
  if (!_lastTrack) _crossFadeTo('wind');
}

/** Called once Headlamp item is purchased from the shop. */
export function setHeadlampOwned(owned) {
  _headlampOwned = owned;
}

const _LERP_SPEED = 1.2;   // units per second — controls transition rate

/**
 * Call every frame from the game loop.
 * @param {number} depth   — player depth in metres (0 = surface)
 * @param {number} dt      — delta-time seconds
 */
export function tickAtmosphere(depth, dt) {
  if (!_scene) return;

  const band = _getTargetBand(depth);
  const speed = _LERP_SPEED * dt;

  // ── Fog ───────────────────────────────────────────────────
  const tFog = _hexToRgb(band.fogColor);
  _cur.fogR = _lerp(_cur.fogR, tFog.r, speed);
  _cur.fogG = _lerp(_cur.fogG, tFog.g, speed);
  _cur.fogB = _lerp(_cur.fogB, tFog.b, speed);
  _cur.fogDensity = _lerp(_cur.fogDensity, band.fogDensity, speed * 0.6);

  const fog = _scene.fog;
  if (fog) {
    fog.color.setRGB(_cur.fogR, _cur.fogG, _cur.fogB);
    fog.density = _cur.fogDensity;
  }

  // ── Sky / background ──────────────────────────────────────
  const tSky = _hexToRgb(band.skyColor);
  _cur.skyR = _lerp(_cur.skyR, tSky.r, speed * 0.7);
  _cur.skyG = _lerp(_cur.skyG, tSky.g, speed * 0.7);
  _cur.skyB = _lerp(_cur.skyB, tSky.b, speed * 0.7);
  _scene.background?.setRGB(_cur.skyR, _cur.skyG, _cur.skyB);

  // ── Ambient light ─────────────────────────────────────────
  _cur.ambientIntensity = _lerp(_cur.ambientIntensity, band.ambientIntensity, speed * 0.8);
  if (_ambient) _ambient.intensity = _cur.ambientIntensity;

  // ── Sun light ─────────────────────────────────────────────
  _cur.sunIntensity = _lerp(_cur.sunIntensity, band.sunIntensity, speed * 0.8);
  if (_sun) _sun.intensity = _cur.sunIntensity;

  // ── Headlamp (needs Headlamp item) ────────────────────────
  if (_headlamp) {
    const wantsLight = band.needsHeadlamp && _headlampOwned;
    _headlampTargetI = wantsLight ? 1.6 : 0;
    _headlamp.intensity = _lerp(_headlamp.intensity, _headlampTargetI, speed * 1.5);
  }

  // ── Vignette ──────────────────────────────────────────────
  _setVignetteStrength(depth);

  // ── Audio cross-fade ──────────────────────────────────────
  _crossFadeTo(band.audioTrack);
}

/**
 * Trigger a brief screen flash in a layer's colour (used on layer transition).
 * @param {string} hexColor  — e.g. '#3A3A66'
 */
export function flashLayerColour(hexColor) {
  const flash = document.createElement('div');
  flash.style.cssText = [
    'position:fixed','inset:0','pointer-events:none','z-index:500',
    `background:${hexColor}28`,
    'transition:opacity 0.8s','opacity:1',
  ].join(';');
  document.body.appendChild(flash);
  requestAnimationFrame(() => { flash.style.opacity = '0'; });
  setTimeout(() => flash.remove(), 900);
}

export default { initAtmosphere, tickAtmosphere, setHeadlampOwned, flashLayerColour };
