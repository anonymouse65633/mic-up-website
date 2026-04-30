// ============================================================
//  WalkWorld 3D — game.js
//  Main entry point.
//  Orchestrates: settings → init → world → network → game loop
//                → HUD → compass → minimap → chat → cleanup
//
//  New HTML elements expected in game.html:
//    #compassCanvas   — horizontal CoD-style compass strip (top-centre)
//    #minimapCanvas   — top-down minimap canvas (top-right)
//    #settingsPanel   — hidden settings overlay
//    #settingsBtn     — HUD button that opens settings
//    #sensSlider      — <input type="range"> for mouse sensitivity
//    #sensValue       — <span> showing current sensitivity value
//    [data-bind="X"]  — buttons for remapping each action key
//    #settingsClose   — button inside settings panel to close it
// ============================================================

import { Player, camera, requestPointerLock, isPointerLocked } from './player.js';
import { Renderer }   from './renderer.js';
import { initWorld, scene, getZoneName, resetTerrain, getBaseHeightAt } from './world.js';
import { initObjects } from './objects.js';
import {
  joinGame,
  leaveGame,
  updatePosition,
  updateCharacter,
  onPlayersUpdate,
  getPlayerCount,
  sendChat,
  onChat,
} from './network.js';
import { onDig, getMoney, addMoney, getDepthAt, getMaterialAtDepth, ORES, rollOre, resetMining, generateOreDeposits, generateOreVeins,
         initMining, tickParticles, tickCameraShake, triggerShake,
         tickOreCrystals } from './mining.js';
import { playerInventory, TOOLS } from './inventory.js';
import { openShop, closeShop, isShopOpen, getNearestShop, setMoneyChangeCallback, SHOPS } from './shop.js';
import {
  buildCharacter,
  getLocalCharConfig,
  saveLocalCharConfig,
  DEFAULT_CHAR_CONFIG,
} from './character.js';

// ── Part 2 systems ───────────────────────────────────────────
import {
  initAtmosphere, tickAtmosphere, setHeadlampOwned, flashLayerColour,
} from './atmosphere.js';

import {
  initCaves, tickCaves, setOnChestOpen, onInteractKey as cavesInteract,
  spawnMeteor, getCaveData,
} from './caves.js';

import {
  initWorldEvents, tickEvents,
  getOreRushMultiplier, getVoidSurgeActive, getMeteorSiteBonus,
  getActiveEventSummary, getMeteorMinimapMarker,
} from './events.js';

// ── Part 5: AI Content ───────────────────────────────────────
import { getChestLoot, getCabinLore, getOreDesc } from './aiContent.js';

// ============================================================
//  SETTINGS
//  Stored in sessionStorage so they persist across page reloads
//  but are wiped when the browser session ends.
//  Exposed on window so player.js can read them live.
// ============================================================
const DEFAULT_SENS  = 0.0022;
const DEFAULT_BINDS = {
  forward : 'KeyW',
  back    : 'KeyS',
  left    : 'KeyA',
  right   : 'KeyD',
  jump    : 'Space',
  sprint  : 'ShiftLeft',
  chat    : 'KeyT',
  map     : 'KeyM',
};

// Pretty-print a KeyboardEvent.code string for UI labels
function prettyCode(code) {
  const MAP = {
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Space: 'Space', ShiftLeft: 'L.Shift', ShiftRight: 'R.Shift',
    ControlLeft: 'L.Ctrl', ControlRight: 'R.Ctrl',
    AltLeft: 'L.Alt', AltRight: 'R.Alt',
  };
  return MAP[code] ?? code.replace('Key', '').replace('Digit', '');
}

function loadSettings() {
  try {
    const stored = JSON.parse(sessionStorage.getItem('ww_settings') || '{}');
    window.WALKWORLD_SENS  = stored.sens  ?? DEFAULT_SENS;
    window.WALKWORLD_BINDS = { ...DEFAULT_BINDS, ...(stored.binds || {}) };
  } catch {
    window.WALKWORLD_SENS  = DEFAULT_SENS;
    window.WALKWORLD_BINDS = { ...DEFAULT_BINDS };
  }
}

function saveSettings() {
  sessionStorage.setItem('ww_settings', JSON.stringify({
    sens:  window.WALKWORLD_SENS,
    binds: window.WALKWORLD_BINDS,
  }));
}

// ============================================================
//  DOM REFS
// ============================================================

// Overlays
const loadingOverlay      = document.getElementById('loadingOverlay');
const loadBar             = document.getElementById('loadBar');
const loadStatus          = document.getElementById('loadStatus');
const disconnectedOverlay = document.getElementById('disconnectedOverlay');
const gameWrapper         = document.getElementById('gameWrapper');
const gameCanvas          = document.getElementById('gameCanvas');

// HUD
const hudAvatar  = document.getElementById('hudAvatar');
const hudName    = document.getElementById('hudName');
const hudPos     = document.getElementById('hudPos');
const hudZone    = document.getElementById('hudZone');
const hudCount   = document.getElementById('hudCount');

// Compass — CoD canvas strip + fallback text label
const compassCanvas = document.getElementById('compassCanvas');
const compassCtx    = compassCanvas?.getContext('2d') ?? null;
const compassDir    = document.getElementById('compassDir'); // existing text span

// Minimap
const minimapCanvas = document.getElementById('minimapCanvas');
const minimapCtx    = minimapCanvas?.getContext('2d') ?? null;

// Chat
const chatMessages = document.getElementById('chatMessages');
const chatForm     = document.getElementById('chatForm');
const chatInput    = document.getElementById('chatInput');

// Pause menu
const pauseMenu  = document.getElementById('pauseMenu');
const btnSettings = document.getElementById('btnSettings');
const btnCharacter = document.getElementById('btnCharacter');
const sensSlider  = document.getElementById('spSensSlider');
const sensValueEl = document.getElementById('spSensVal');
const lockHint   = document.getElementById('lockHint');

// ============================================================
//  RUNTIME STATE
// ============================================================
let player        = null;
let renderer      = null;
let remotePlayers = {};
let lastTime      = 0;
let rafId         = null;
let isChatOpen    = false;
let isPauseOpen   = false;
let isMapOpen     = false;
let isInventoryOpen = false;

let _lastPosSend = 0;
const POS_INTERVAL = 100; // ms between Firebase position writes (~10 Hz)

// ── Mining state ─────────────────────────────────────────────
let _lastDigTime = 0;
const BASE_DIG_COOLDOWN = 550; // ms at digSpeed 1.0

// ── Part 4: Discovery event system ───────────────────────────
let _discoveryLock  = false;   // prevent stacking dramatic events
let _timeScaleMult  = 1.0;     // applied to dt for slowdown effects
let _digNotifTimer = null;
let _nearestShop   = null;
let _punchProgress = 0;  // 0..1 — drives progress ring on crosshair

// ── Motherlode banner ─────────────────────────────────────────
function _showMotherloadeBanner(ore, isGrand) {
  const el = document.createElement('div');
  el.style.cssText = [
    'position:fixed','bottom:155px','left:50%','transform:translateX(-50%)',
    'border-radius:10px','padding:10px 22px',
    'font-family:inherit','font-size:15px','font-weight:700','color:#fff',
    'pointer-events:none','z-index:401','opacity:0',
    'transition:opacity 0.3s','white-space:nowrap','text-align:center',
    `background:rgba(0,0,0,0.82)`,
    `border:2px solid ${ore.hexColor}`,
    `box-shadow:0 0 18px ${ore.hexColor}88`,
  ].join(';');
  el.innerHTML = isGrand
    ? `🏆 GRAND MOTHERLODE! ${ore.emoji} ${ore.name} ×6 — 2× bonus!`
    : `💥 Motherlode! ${ore.emoji} ${ore.name} ×4 — 1.5× bonus!`;
  document.body.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = '1'; });
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 400);
  }, isGrand ? 5000 : 3500);
}

// ── Layer transition banner ───────────────────────────────────
function _showLayerTransitionBanner(layer) {
  // Brief HUD flash + "You entered X — ⬇ Ym" message
  const existing = document.getElementById('layerBanner');
  const banner = existing || (() => {
    const el = document.createElement('div');
    el.id = 'layerBanner';
    el.style.cssText = [
      'position:fixed','bottom:120px','left:50%','transform:translateX(-50%)',
      'background:rgba(0,0,0,0.75)','border-radius:8px','padding:8px 18px',
      'font-family:inherit','font-size:14px','font-weight:600','color:#fff',
      'pointer-events:none','z-index:400','opacity:0',
      'transition:opacity 0.3s','white-space:nowrap',
    ].join(';');
    document.body.appendChild(el);
    return el;
  })();

  const depth = Math.round(layer.minDepth);
  banner.textContent = `${layer.emoji} You entered ${layer.name} — ⬇ ${depth}m`;
  banner.style.borderLeft = `4px solid ${layer.hexColor}`;
  banner.style.opacity = '1';

  // Screen flash in layer colour
  const flash = document.createElement('div');
  flash.style.cssText = [
    'position:fixed','inset:0','pointer-events:none','z-index:500',
    `background:${layer.hexColor}22`,'transition:opacity 0.6s',
  ].join(';');
  document.body.appendChild(flash);
  requestAnimationFrame(() => { flash.style.opacity = '0'; });
  setTimeout(() => flash.remove(), 700);

  clearTimeout(banner._timer);
  banner._timer = setTimeout(() => { banner.style.opacity = '0'; }, 3500);
}

function _getDigCooldown() {
  const tool = playerInventory.getActiveTool();
  if (!tool || tool.digSpeed <= 0) return BASE_DIG_COOLDOWN;
  return Math.max(100, BASE_DIG_COOLDOWN / tool.digSpeed);
}

// ── 20-minute reset timer ────────────────────────────────────
const RESET_DURATION  = 20 * 60;   // 20 minutes in seconds
let   _resetSecondsLeft = RESET_DURATION;
let   _resetWarned      = false;    // true once the 1-min warning fires
let   _resetLastTick    = 0;        // timestamp of last countdown tick

// ── Map overlay ──────────────────────────────────────────────
const MAP_ZOOM_MIN  = 1;
const MAP_ZOOM_MAX  = 8;
let   mapZoom       = 1;
let   _mapWorldCanvas = null; // cached background (one pixel per world unit)

const MAP_ZONE_COLS = {
  Forest: '#1a3a10',
  Plains: '#2d6b22',
  Lake:   '#1a5fa8',
  Cabin:  '#7a5428',
  Plaza:  '#606070',
};
const MAP_ZONE_LABELS = [
  { name: 'FOREST', wx: -60, wz: -40 },
  { name: 'PLAINS', wx:  28, wz:  30 },
  { name: 'LAKE',   wx:  62, wz:  55 },
  { name: 'CABIN',  wx:  55, wz: -62 },
  { name: 'PLAZA',  wx:   0, wz:   0 },
];

// ============================================================
//  BOOT
// ============================================================
async function init() {
  loadSettings();

  // Redirect to lobby if the player skipped name entry
  const name   = sessionStorage.getItem('playerName');
  const colour = sessionStorage.getItem('playerColour');
  if (!name) { window.location.href = 'index.html'; return; }

  setLoad(10, 'Building world…');
  await tick();

  // Build the 3D world (terrain, lighting, fog, water)
  initWorld();
  // Initialise particle pool and audio for dig physics
  initMining();
  // Populate the scene (trees, rocks, cabin, plaza, etc.)
  initObjects();

  // ── Part 2: Atmosphere, Caves, World Events ──────────────
  // Grab the lights that initWorld() created so atmosphere.js can lerp them
  const _ambLight = scene.children.find(c => c.isAmbientLight);
  const _sunLight  = scene.children.find(c => c.isDirectionalLight);
  initAtmosphere(scene, _ambLight, _sunLight, camera);

  // Seeded procedural cave + chest + landmark generation
  initCaves(0xCAFEBABE);

  // Set up AI chest open handler
  setOnChestOpen((chest) => {
    _handleChestOpen(chest);
  });

  // World events — pass chat broadcaster and meteor spawner
  initWorldEvents(
    window._firebaseDB ?? null,
    (msg, type) => {
      const chatEl = document.getElementById('chatMessages');
      if (!chatEl) return;
      const div = document.createElement('div');
      div.className = 'chat-msg chat-event';
      div.innerHTML = `<span style="color:#ffd700;font-weight:600">${msg}</span>`;
      chatEl.appendChild(div);
      chatEl.scrollTop = chatEl.scrollHeight;
    },
    (wx, wz) => spawnMeteor(wx, wz, 0),
  );


  // Ask Gemini to seed ore deposit hot-spots for this session
  generateOreDeposits().catch(() => {});  // async, non-blocking

  // Pre-generate vein cells for all layers (deterministic per session)
  generateOreVeins(Date.now() & 0xFFFF);

  // Initialise the 20-minute reset countdown
  _resetSecondsLeft = RESET_DURATION;
  _resetWarned      = false;
  _resetLastTick    = performance.now();

  setLoad(30, 'Spawning player…');
  await tick();

  player   = new Player(name, colour);
  renderer = new Renderer(gameCanvas);

  // HUD identity chip
  hudAvatar.style.background = colour;
  hudName.textContent        = name;

  setLoad(50, 'Connecting to server…');
  await tick();

  // Firebase join
  try {
    await joinGame({
      name,
      colour,
      x:         player.x,
      y:         player.y,
      z:         player.z,
      rotationY: player.rotationY,
    });
  } catch (err) {
    console.error('[Game] joinGame failed:', err);
    showDisconnected();
    return;
  }

  setLoad(70, 'Syncing players…');
  await tick();

  onPlayersUpdate(players => {
    remotePlayers = players;
    // +1 to include the local player in the count
    hudCount.textContent = Object.keys(players).length + 1;
  });

  getPlayerCount(n => { hudCount.textContent = n; });

  setLoad(85, 'Loading chat…');
  await tick();

  onChat(msgs => renderChat(msgs));
  setupChat(name, colour);
  setupPointerLock();
  setupPauseMenu();
  setupHotbar();
  setupInventory();
  setupShop();
  buildMinimapCache();
  buildMapWorldCanvas();
  setupMap();
  initAvatarPreview();

  setLoad(100, 'Ready!');
  await delay(300);

  loadingOverlay.classList.add('hidden');
  gameWrapper.classList.remove('hidden');
  // Pointer lock will be acquired on first canvas click (no "click to play" overlay)

  lastTime = performance.now();
  rafId    = requestAnimationFrame(gameLoop);

  // Cleanup on page leave / tab close
  window.addEventListener('beforeunload', () => {
    leaveGame(name);
    if (rafId) cancelAnimationFrame(rafId);
  });

  // Pause / resume when tab is hidden / visible
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      // Open pause menu when tab loses focus (if gameplay is active)
      if (!isPauseOpen && !isChatOpen && !isMapOpen) {
        openPauseMenu();
      }
    } else {
      lastTime = performance.now();
      rafId = requestAnimationFrame(gameLoop);
    }
  });
}

// ============================================================
//  GAME LOOP
// ============================================================
function gameLoop(timestamp) {
  // Cap dt at 100 ms so a frozen tab doesn't cause a physics explosion
  const rawDt = Math.min((timestamp - lastTime) / 1000, 0.1);
  const dt     = rawDt * _timeScaleMult;   // Part 4: discovery slowdown
  lastTime  = timestamp;

  // Only update player physics when gameplay is active
  if (!isChatOpen && !isPauseOpen) {
    player.update(dt);
  }

  // Network: throttled position sync
  if (timestamp - _lastPosSend > POS_INTERVAL) {
    updatePosition(player.x, player.y, player.z, player.rotationY);
    _lastPosSend = timestamp;
  }

  updateHUD();
  updateCompass();
  updateMinimap();
  if (isMapOpen) drawMap();
  _updateUndergroundEscape();

  // Shop proximity check
  _updateShopProximity(player.x, player.z);

  // 20-minute countdown tick
  _tickResetTimer(timestamp);

  // Physics ticks for dig effects
  tickParticles(dt);
  tickCameraShake(camera, dt);
  tickOreCrystals(camera, dt);   // Part 4: LOD + animate ore crystal clusters

  // Part 2 ticks
  const _playerDepth = getDepthAt(player.x, player.z);
  tickAtmosphere(_playerDepth, dt);
  tickCaves(player.x, player.y, player.z, dt);
  tickEvents(timestamp);

  renderer.draw(player, remotePlayers, timestamp);

  rafId = requestAnimationFrame(gameLoop);
}

// ============================================================
//  20-MINUTE TERRAIN RESET
// ============================================================
function _tickResetTimer(timestamp) {
  const elapsed = (timestamp - _resetLastTick) / 1000;
  if (elapsed < 1) return;   // only tick once per second
  _resetLastTick = timestamp;

  _resetSecondsLeft = Math.max(0, _resetSecondsLeft - Math.floor(elapsed));

  // Update HUD timer
  const timerEl = document.getElementById('hudResetTimer');
  if (timerEl) {
    const m = Math.floor(_resetSecondsLeft / 60);
    const s = _resetSecondsLeft % 60;
    timerEl.textContent = `⏱ ${m}:${String(s).padStart(2,'0')}`;

    // Colour: white → amber (2 min) → red (1 min)
    if (_resetSecondsLeft <= 60) {
      timerEl.style.color = '#ff4444';
    } else if (_resetSecondsLeft <= 120) {
      timerEl.style.color = '#ffaa00';
    } else {
      timerEl.style.color = '#ffffff';
    }
  }

  // 1-minute warning popup
  if (_resetSecondsLeft <= 60 && !_resetWarned) {
    _resetWarned = true;
    _showResetWarning();
  }

  // Time's up — reset everything
  if (_resetSecondsLeft <= 0) {
    _doTerrainReset();
  }
}

function _showResetWarning() {
  const el = document.getElementById('resetWarning');
  if (!el) return;
  el.classList.add('visible');
  setTimeout(() => el.classList.remove('visible'), 8000);
}

async function _doTerrainReset() {
  // Stop the loop while we reset
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }

  // Show the overlay
  const overlay = document.getElementById('resetOverlay');
  if (overlay) overlay.classList.add('visible');

  // 1. Reset Three.js terrain geometry to original heights
  resetTerrain();

  // 2. Wipe all shaft 3D meshes and reset money
  resetMining();

  // 3. Teleport player back to the Plaza spawn
  if (player) {
    player.x  = 0;
    player.y  = 2.0;
    player.z  = 5;
    player.vy = 0;
    player.onGround = false;
  }

  // 4. Ask Gemini for a fresh ore deposit map + regenerate veins
  await generateOreDeposits().catch(() => {});
  generateOreVeins(Date.now() & 0xFFFF);

  // 5. Restart the countdown
  _resetSecondsLeft = RESET_DURATION;
  _resetWarned      = false;
  _resetLastTick    = performance.now();

  // Hide the overlay and resume
  if (overlay) overlay.classList.remove('visible');
  rafId = requestAnimationFrame(gameLoop);
}

// ============================================================
//  UNDERGROUND ESCAPE BUTTON
//  Shows a teleport button when the player is more than 1m
//  below the original terrain surface — helping them get out.
// ============================================================
function _updateUndergroundEscape() {
  const panel = document.getElementById('undergroundEscape');
  const label = document.getElementById('ugDepthLabel');
  if (!panel || !player) return;

  const surfaceY = getBaseHeightAt ? getBaseHeightAt(player.x, player.z) : 0;

  // Show when player is more than 1.2m below original surface
  const depthBelow = surfaceY - player.y;

  if (depthBelow > 1.2) {
    panel.classList.remove('hidden');
    if (label) label.textContent = `⛏ ${depthBelow.toFixed(1)}m underground`;
  } else {
    panel.classList.add('hidden');
  }
}

// ============================================================
//  HUD
// ============================================================
function updateHUD() {
  // ── Progress ring (punch resistance visual) ───────────────
  const ringCanvas = document.getElementById('progressRingCanvas');
  if (ringCanvas) {
    if (_punchProgress > 0 && _punchProgress < 1) {
      ringCanvas.style.opacity = '1';
      const rc = ringCanvas.getContext('2d');
      rc.clearRect(0, 0, 72, 72);
      // Background arc (dimmed)
      rc.beginPath();
      rc.arc(36, 36, 28, 0, Math.PI * 2);
      rc.strokeStyle = 'rgba(255,255,255,0.15)';
      rc.lineWidth   = 2.5;
      rc.stroke();
      // Progress arc (white, from top)
      rc.beginPath();
      rc.arc(36, 36, 28, -Math.PI / 2, -Math.PI / 2 + _punchProgress * Math.PI * 2);
      rc.strokeStyle = 'rgba(255,255,255,0.85)';
      rc.lineWidth   = 2.5;
      rc.lineCap     = 'round';
      rc.stroke();
    } else {
      ringCanvas.style.opacity = '0';
    }
  }

  hudPos.textContent  = `${player.x.toFixed(1)}, ${player.z.toFixed(1)}`;
  if (hudZone) hudZone.textContent = getZoneName(player.x, player.z);

  // Expose depth for daily shop AI call
  window._playerDepthForShop = getDepthAt(player.x, player.z);

  // Money display
  const moneyEl = document.getElementById('hudMoney');
  if (moneyEl) moneyEl.textContent = '$' + getMoney().toLocaleString();

  // Depth display
  const depth = getDepthAt(player.x, player.z);
  const depthEl = document.getElementById('hudDepth');
  const depthPanel = document.getElementById('hudDepthPanel');
  const zone = getZoneName(player.x, player.z);
  if (depthEl && depthPanel) {
    if (zone === 'Plaza') {
      // Show the "no digging" indicator only if you're actually standing in the Plaza
      depthEl.innerHTML = '🏛 Plaza — <span style="color:#ff9944">No Digging</span>';
      depthEl.style.color = '#cccccc';
      depthEl.style.display = '';
      depthPanel.style.display = '';
    } else if (depth > 0.3) {
      const mat = getMaterialAtDepth(depth);
      depthEl.textContent = '⛏ ' + depth.toFixed(1) + 'm — ' + mat.name;
      depthEl.style.color = mat.hexColor;
      depthEl.style.display = '';
      depthPanel.style.display = '';
    } else {
      depthEl.style.display = 'none';
      depthPanel.style.display = 'none';
    }
  }
}

// ============================================================
//  COD-STYLE COMPASS
//
//  Draws a horizontal scrolling strip showing degree marks and
//  cardinal/intercardinal labels (N NE E SE S SW W NW).
//  A downward triangle at the centre marks the current heading.
//
//  Falls back to updating the existing #compassDir text span
//  if no #compassCanvas element is present in the DOM.
// ============================================================
const CARDINAL = [
  [0, 'N'], [45, 'NE'], [90, 'E'], [135, 'SE'],
  [180, 'S'], [225, 'SW'], [270, 'W'], [315, 'NW'], [360, 'N'],
];

function updateCompass() {
  // Convert yaw (radians, left = positive) → compass bearing (0–360°, clockwise)
  const bearing = (((-player.yaw * 180) / Math.PI) % 360 + 360) % 360;

  // ── Text fallback (existing HUD span) ──
  if (compassDir) {
    const nearest = CARDINAL.reduce((best, cur) =>
      Math.abs(cur[0] - bearing) < Math.abs(best[0] - bearing) ? cur : best
    );
    compassDir.textContent = `${nearest[1]}  ${Math.round(bearing)}°`;
  }

  // ── Canvas compass strip ──
  if (!compassCtx || !compassCanvas) return;

  const W      = compassCanvas.width;
  const H      = compassCanvas.height;
  const DEG_PX = W / 90; // pixels per degree (90° visible range)

  compassCtx.clearRect(0, 0, W, H);

  // Background
  compassCtx.fillStyle = 'rgba(10,10,22,0.92)';
  compassCtx.fillRect(0, 0, W, H);

  // Accent border along the bottom edge
  compassCtx.fillStyle = 'rgba(0,245,196,0.55)';
  compassCtx.fillRect(0, H - 2, W, 2);

  // ── Minor / mid ticks at every integer offset from centre ──
  // These give the visual texture of the scrolling strip.
  for (let offset = -90; offset <= 90; offset++) {
    const sx = Math.round(W / 2 + offset * DEG_PX);
    // Classify tick by rounding the degree value at this integer offset.
    // We round bearing so that minor tick spacing stays consistent.
    const deg = ((Math.round(bearing) + offset) % 360 + 360) % 360;
    const isMajor = deg % 45 === 0;
    const isMid   = !isMajor && deg % 15 === 0;
    const isMinor = !isMajor && !isMid && deg % 5 === 0;

    if (isMajor) {
      // Drawn separately below using float positions — skip here
    } else if (isMid) {
      compassCtx.fillStyle = 'rgba(255,255,255,0.45)';
      const th = H * 0.30;
      compassCtx.fillRect(sx, (H - th) * 0.45, 1, th);
    } else if (isMinor) {
      compassCtx.fillStyle = 'rgba(255,255,255,0.18)';
      const th = H * 0.18;
      compassCtx.fillRect(sx, (H - th) * 0.5, 1, th);
    }
  }

  // ── Cardinal / intercardinal labels at their REAL fractional positions ──
  // By computing offset as a float we avoid the "only shows at 0°" bug where
  // integer iteration never lands exactly on a non-integer offset.
  compassCtx.font         = 'bold 10px "Courier New", monospace';
  compassCtx.textAlign    = 'center';
  compassCtx.textBaseline = 'bottom';

  CARDINAL.forEach(([cardDeg, label]) => {
    if (cardDeg === 360) return; // skip duplicate N
    // Float offset of this cardinal from the current bearing
    let offset = cardDeg - bearing;
    // Normalise to (−180, +180] so we pick the nearest crossing
    if (offset >  180) offset -= 360;
    if (offset < -180) offset += 360;
    if (Math.abs(offset) > 90) return; // outside visible window

    const sx = W / 2 + offset * DEG_PX;

    // Bold bright tick
    compassCtx.fillStyle = 'rgba(0,245,196,1)';
    compassCtx.fillRect(Math.round(sx) - 1, 2, 2, H * 0.55);

    // Label
    compassCtx.fillStyle = '#00f5c4';
    compassCtx.fillText(label, sx, H - 4);
  });

  // Centre marker — downward-pointing triangle at top edge
  compassCtx.fillStyle = '#ffffff';
  compassCtx.beginPath();
  compassCtx.moveTo(W / 2 - 6, 0);
  compassCtx.lineTo(W / 2 + 6, 0);
  compassCtx.lineTo(W / 2,     8);
  compassCtx.closePath();
  compassCtx.fill();

  // Degree readout in the centre notch area
  compassCtx.font      = 'bold 9px "Courier New", monospace';
  compassCtx.fillStyle = 'rgba(255,255,255,0.70)';
  compassCtx.textAlign = 'center';
  compassCtx.textBaseline = 'top';
  compassCtx.fillText(Math.round(bearing) + '°', W / 2, 10);
}

// ============================================================
//  MINIMAP
//  2D top-down overview using coloured zone rectangles.
//  The static background is rendered once to an OffscreenCanvas
//  and composited each frame — player/remote dots drawn on top.
// ============================================================
const MINI_COLOURS = {
  Forest: '#1a3a10',
  Plains: '#2d6b22',
  Lake:   '#1a5fa8',
  Cabin:  '#7a5428',
  Plaza:  '#606070',
};

// Zone rectangles in world-space (world centre = 0,0, range ±100)
const MINI_ZONES = [
  { x: -100, z: -100, w: 75,  h: 118, zone: 'Forest' },
  { x: -25,  z: -100, w: 125, h: 200, zone: 'Plains' },
  { x:  40,  z:  16,  w: 60,  h: 84,  zone: 'Lake'   },
  { x:  30,  z: -100, w: 70,  h: 70,  zone: 'Cabin'  },
  { x: -22,  z: -18,  w: 44,  h: 36,  zone: 'Plaza'  },
];

let _minimapBg = null; // cached ImageBitmap of the static background

function buildMinimapCache() {
  if (!minimapCtx || !minimapCanvas) return;

  const WORLD = 200;
  // Build a full 200×200 world bitmap for dynamic scrolling
  const off = new OffscreenCanvas(WORLD, WORLD);
  const ctx = off.getContext('2d');

  MINI_ZONES.forEach(({ x, z, w, h, zone }) => {
    ctx.fillStyle = MINI_COLOURS[zone];
    ctx.fillRect(x + 100, z + 100, w, h);
  });

  _minimapBg = off.transferToImageBitmap();
}

function updateMinimap() {
  if (!minimapCtx || !minimapCanvas || !_minimapBg) return;

  const W     = minimapCanvas.width;
  const H     = minimapCanvas.height;

  // Player-centered, zoom = 1.6 world units per pixel
  const ZOOM   = 1.6;   // higher = more zoomed in
  const VIEW_W = W / ZOOM;
  const VIEW_H = H / ZOOM;

  // Source rect in the 200x200 world bitmap
  const srcX = (player.x + 100) - VIEW_W * 0.5;
  const srcZ = (player.z + 100) - VIEW_H * 0.5;

  minimapCtx.clearRect(0, 0, W, H);
  minimapCtx.drawImage(_minimapBg, srcX, srcZ, VIEW_W, VIEW_H, 0, 0, W, H);

  // World → canvas coord
  const toM = (wx, wz) => ({
    mx: ((wx - player.x) * ZOOM + W * 0.5),
    mz: ((wz - player.z) * ZOOM + H * 0.5),
  });

  // Remote player dots
  for (const p of Object.values(remotePlayers)) {
    const { mx, mz } = toM(p.x, p.z);
    if (mx < 0 || mz < 0 || mx > W || mz > H) continue;
    minimapCtx.fillStyle = p.colour || '#ffffff';
    minimapCtx.beginPath();
    minimapCtx.arc(mx, mz, 3, 0, Math.PI * 2);
    minimapCtx.fill();
  }

  // Local player dot (always center)
  const cx = W * 0.5, cz = H * 0.5;
  minimapCtx.fillStyle   = '#ffffff';
  minimapCtx.strokeStyle = player.colour || '#44ff88';
  minimapCtx.lineWidth   = 2;
  minimapCtx.beginPath();
  minimapCtx.arc(cx, cz, 4, 0, Math.PI * 2);
  minimapCtx.fill();
  minimapCtx.stroke();

  // Heading arrow
  const bearing = player.yaw;
  minimapCtx.strokeStyle = '#ffffff';
  minimapCtx.lineWidth   = 2;
  minimapCtx.beginPath();
  minimapCtx.moveTo(cx, cz);
  minimapCtx.lineTo(cx + Math.sin(bearing) * 9, cz + Math.cos(bearing) * 9);
  minimapCtx.stroke();

  // Circular clip
  minimapCtx.globalCompositeOperation = 'destination-in';
  minimapCtx.beginPath();
  minimapCtx.arc(W/2, H/2, W/2, 0, Math.PI * 2);
  minimapCtx.fill();
  minimapCtx.globalCompositeOperation = 'source-over';

  // Zone label
  const zoneLabel = document.getElementById('minimapZoneLabel');
  if (zoneLabel) zoneLabel.textContent = getZoneName(player.x, player.z);
}


// ============================================================
//  WORLD MAP  (M key — expandable fullscreen overlay)
//
//  _mapWorldCanvas  — 200×200 px canvas, one px per world unit,
//                     baked once with zone colours.
//  openMap()        — sizes the overlay canvas, shows the modal
//  closeMap()       — hides modal, re-acquires pointer lock
//  drawMap()        — called every frame when map is open;
//                     draws zones → labels → remote dots → local
//  setupMap()       — wires up buttons and scroll-wheel zoom
// ============================================================

function buildMapWorldCanvas() {
  const SIZE = 200; // 1 px per world unit (world is ±100 on each axis)
  _mapWorldCanvas = document.createElement('canvas');
  _mapWorldCanvas.width  = SIZE;
  _mapWorldCanvas.height = SIZE;
  const ctx = _mapWorldCanvas.getContext('2d');

  // Sample every 2 world units (100×100 cells, each 2 px)
  for (let iz = 0; iz < SIZE; iz += 2) {
    for (let ix = 0; ix < SIZE; ix += 2) {
      const wx = ix - 100;
      const wz = iz - 100;
      ctx.fillStyle = MAP_ZONE_COLS[getZoneName(wx, wz)] || '#1a3a10';
      ctx.fillRect(ix, iz, 2, 2);
    }
  }

  // World border
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth   = 1;
  ctx.strokeRect(0.5, 0.5, SIZE - 1, SIZE - 1);
}

function openMap() {
  const mapCanvas = document.getElementById('mapCanvas');
  if (!mapCanvas) return;

  // Size the canvas to ~80 % of the smaller screen dimension, max 700 px
  const sz = Math.min(Math.floor(window.innerWidth * 0.78),
                      Math.floor(window.innerHeight * 0.75), 700);
  mapCanvas.width  = sz;
  mapCanvas.height = sz;

  mapZoom = 1;
  _updateMapZoomUI();

  isMapOpen = true;
  document.getElementById('mapOverlay')?.classList.remove('hidden');
  if (isPointerLocked()) document.exitPointerLock();
}

function closeMap() {
  isMapOpen = false;
  document.getElementById('mapOverlay')?.classList.add('hidden');
  // Re-acquire pointer lock automatically
  requestPointerLock(gameCanvas);
}

function _updateMapZoomUI() {
  const el = document.getElementById('mapZoomDisplay');
  if (el) el.textContent = mapZoom.toFixed(1) + '×';
}

function drawMap() {
  const mapCanvas = document.getElementById('mapCanvas');
  if (!mapCanvas || !_mapWorldCanvas) return;
  const ctx = mapCanvas.getContext('2d');
  if (!ctx) return;

  const W = mapCanvas.width;
  const H = mapCanvas.height;

  // ── Background ──────────────────────────────────────────
  ctx.fillStyle = '#0a0a16';
  ctx.fillRect(0, 0, W, H);

  // ── World image: scale+pan via drawImage source rect ────
  //
  // At zoom=1  → full 200×200 world fits the canvas.
  //   srcW = srcH = 200,  srcX = srcY = 0
  // At zoom>1  → we see only (200/zoom) world units.
  //   We centre on the player.
  //
  const WORLD = 200;
  const srcSide = WORLD / mapZoom;
  // Centre of view in world-canvas pixels (0…200)
  const cx = mapZoom > 1.2 ? (player.x + 100) : WORLD / 2;
  const cz = mapZoom > 1.2 ? (player.z + 100) : WORLD / 2;
  const srcX = Math.max(0, Math.min(WORLD - srcSide, cx - srcSide / 2));
  const srcZ = Math.max(0, Math.min(WORLD - srcSide, cz - srcSide / 2));

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(_mapWorldCanvas, srcX, srcZ, srcSide, srcSide, 0, 0, W, H);

  // ── Grid lines every 25 world units (major zones) ───────
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth   = 1;
  const gridStep  = 25; // world units
  const scale     = W / srcSide;
  for (let gw = Math.ceil((srcX - srcX % gridStep) / gridStep) * gridStep;
       gw <= srcX + srcSide; gw += gridStep) {
    const sx = (gw - srcX) * scale;
    ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, H); ctx.stroke();
  }
  for (let gz = Math.ceil((srcZ - srcZ % gridStep) / gridStep) * gridStep;
       gz <= srcZ + srcSide; gz += gridStep) {
    const sy = (gz - srcZ) * scale;
    ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(W, sy); ctx.stroke();
  }

  // ── Helper: world → canvas px ───────────────────────────
  // wx/wz in world coords (±100).  srcX/srcZ are in world-canvas px (0…200).
  const toC = (wx, wz) => ({
    cx: ((wx + 100) - srcX) * scale,
    cy: ((wz + 100) - srcZ) * scale,
  });

  // ── Zone labels ──────────────────────────────────────────
  const labelSize = Math.max(8, Math.min(12, 9 * mapZoom * 0.5));
  ctx.font        = `bold ${labelSize}px "Courier New", monospace`;
  ctx.textAlign   = 'center';
  ctx.textBaseline = 'middle';
  MAP_ZONE_LABELS.forEach(({ name, wx, wz }) => {
    const { cx: lx, cy: ly } = toC(wx, wz);
    if (lx < -30 || lx > W + 30 || ly < -20 || ly > H + 20) return;
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillText(name, lx, ly);
  });

  // ── Remote player dots ───────────────────────────────────
  const dotR = Math.max(3, 3.5 * Math.min(mapZoom, 3) * 0.5);
  ctx.textBaseline = 'bottom';
  ctx.font = `${Math.max(10, 11 * mapZoom * 0.4)}px "VT323", monospace`;
  for (const p of Object.values(remotePlayers)) {
    const { cx: px, cy: py } = toC(p.x ?? 0, p.z ?? 0);
    if (px < -12 || px > W + 12 || py < -12 || py > H + 12) continue;
    ctx.fillStyle = p.colour || '#ffffff';
    ctx.beginPath();
    ctx.arc(px, py, dotR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.80)';
    ctx.textAlign = 'center';
    ctx.fillText(p.name || '?', px, py - dotR - 1);
  }

  // ── Local player ─────────────────────────────────────────
  const { cx: lx, cy: ly } = toC(player.x, player.z);

  // Pulse ring
  ctx.strokeStyle = 'rgba(0,245,196,0.40)';
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.arc(lx, ly, 11, 0, Math.PI * 2);
  ctx.stroke();

  // Filled dot
  ctx.fillStyle   = '#ffffff';
  ctx.strokeStyle = '#00f5c4';
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.arc(lx, ly, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Direction arrow
  const bearing  = -player.yaw;
  const arrowLen = Math.max(14, 14 * Math.min(mapZoom, 3) * 0.5);
  ctx.strokeStyle = '#00f5c4';
  ctx.lineWidth   = 2.5;
  ctx.beginPath();
  ctx.moveTo(lx, ly);
  ctx.lineTo(lx + Math.sin(bearing) * arrowLen, ly - Math.cos(bearing) * arrowLen);
  ctx.stroke();

  // Player name
  ctx.font        = `bold 10px "Courier New", monospace`;
  ctx.fillStyle   = '#00f5c4';
  ctx.textAlign   = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(player.name, lx, ly - 13);

  // ── HUD overlay (zoom level, coords, hint) ───────────────
  ctx.textBaseline = 'top';
  ctx.textAlign    = 'left';
  ctx.fillStyle    = 'rgba(0,245,196,0.90)';
  ctx.font         = 'bold 11px "Courier New", monospace';
  ctx.fillText(`${mapZoom.toFixed(1)}×`, 10, 10);

  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font      = '10px "Courier New", monospace';
  ctx.fillText(`${Math.round(player.x)}, ${Math.round(player.z)}`, 10, 28);

  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillText('M · Close  |  Scroll · Zoom', W - 10, 10);
}

// ============================================================
//  HOTBAR  (9 slots, Part 1)
// ============================================================
function setupHotbar() {
  _refreshAllHotbarSlots();

  // Number keys 1-9
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (isShopOpen() || isInventoryOpen) return;
    const n = parseInt(e.key);
    if (n >= 1 && n <= 9) _selectHotbarSlot(n - 1);
  });

  // Listen for hotbar-changed (after buying a tool from shop)
  window.addEventListener('hotbar-changed', () => _refreshAllHotbarSlots());
}

function _selectHotbarSlot(idx) {
  const prev = playerInventory.activeSlot;
  playerInventory.activeSlot = idx;

  // Update CSS active class
  const prevEl = document.getElementById(`hotbarSlot${prev + 1}`);
  const nextEl = document.getElementById(`hotbarSlot${idx + 1}`);
  prevEl?.classList.remove('active');
  nextEl?.classList.add('active');

  // Show item name tooltip
  const tool = playerInventory.getActiveTool();
  const nameEl = document.getElementById('hotbarItemName');
  if (nameEl) {
    nameEl.textContent = tool ? tool.name : '';
    nameEl.classList.toggle('visible', !!tool);
    clearTimeout(nameEl._timer);
    if (tool) nameEl._timer = setTimeout(() => nameEl.classList.remove('visible'), 2000);
  }

  // Keep window.HOTBAR_SLOT for backwards compat
  window.HOTBAR_SLOT = String(idx + 1);
}

function _refreshHotbarSlot(idx) {
  const slotEl = document.getElementById(`hotbarSlot${idx + 1}`);
  if (!slotEl) return;
  const entry = playerInventory.hotbar[idx];

  const iconEl  = slotEl.querySelector('.hotbar-slot-icon');
  const labelEl = slotEl.querySelector('.hotbar-slot-label');
  const durBar  = slotEl.querySelector('.hotbar-dur-bar');
  const durFill = slotEl.querySelector('.hotbar-dur-fill');

  if (entry && entry.tool) {
    // Slot has an item — show it
    slotEl.style.display = '';
    if (iconEl)  iconEl.textContent  = entry.tool.emoji;
    if (labelEl) labelEl.textContent = entry.tool.name.replace(' Shovel', '').replace(' Pickaxe', '');
    slotEl.classList.toggle('broken', entry.durLeft === 0);

    if (durBar && entry.tool.durability < 9999) {
      durBar.style.display = '';
      const frac = entry.durLeft / entry.tool.durability;
      if (durFill) {
        durFill.style.width = `${(frac * 100).toFixed(1)}%`;
        durFill.className = 'hotbar-dur-fill' + (frac < 0.2 ? ' low' : frac < 0.5 ? ' med' : '');
      }
    } else if (durBar) {
      durBar.style.display = 'none';
    }
  } else {
    // Empty slot — hide unless it's the active slot (always show active)
    const isActive = (idx === playerInventory.activeSlot);
    slotEl.style.display = isActive ? '' : 'none';
    if (iconEl)  iconEl.textContent  = '';
    if (labelEl) labelEl.textContent = '';
    if (durBar)  durBar.style.display = 'none';
  }
}

function _refreshAllHotbarSlots() {
  for (let i = 0; i < 9; i++) _refreshHotbarSlot(i);
  // Re-number visible slot keys
  let visibleIdx = 1;
  for (let i = 0; i < 9; i++) {
    const slotEl = document.getElementById(`hotbarSlot${i + 1}`);
    if (!slotEl) continue;
    const keyEl = slotEl.querySelector('.hotbar-slot-key');
    if (slotEl.style.display !== 'none') {
      if (keyEl) keyEl.textContent = String(visibleIdx++);
    }
  }
}

// ============================================================
//  INVENTORY OVERLAY  (Part 3)
// ============================================================
function setupInventory() {
  document.getElementById('invCloseBtn')?.addEventListener('click', closeInventory);

  // Tab key also opens inventory
  window.addEventListener('keydown', e => {
    if (e.code === 'Tab' && !isChatOpen && !isPauseOpen) {
      e.preventDefault();
      isInventoryOpen ? closeInventory() : openInventory();
    }
  });

  window.addEventListener('inventory-changed', () => {
    if (isInventoryOpen) _renderInventoryGrid();
    _updateInvCapacityUI();
  });
}

function openInventory() {
  isInventoryOpen = true;
  document.getElementById('inventoryOverlay')?.classList.remove('hidden');
  _renderInventoryGrid();
  _updateInvCapacityUI();
}

function closeInventory() {
  isInventoryOpen = false;
  document.getElementById('inventoryOverlay')?.classList.add('hidden');
}

function _renderInventoryGrid() {
  const grid = document.getElementById('invGrid');
  if (!grid) return;
  grid.innerHTML = '';

  for (let i = 0; i < playerInventory.capacity; i++) {
    const slot = playerInventory.slots[i];
    const el   = document.createElement('div');
    el.className = 'inv-slot';
    if (slot) {
      el.innerHTML = `
        <span>${slot.emoji || '📦'}</span>
        <span class="inv-slot-count">${slot.count}</span>
        <span class="inv-slot-name">${slot.name}</span>`;
    }
    grid.appendChild(el);
  }
}

function _updateInvCapacityUI() {
  const total = playerInventory.totalItems();
  const cap   = playerInventory.capacity;
  const el    = document.getElementById('invCapacity');
  if (el) el.textContent = `${total} / ${cap * 64} items`;
}

// ============================================================
//  SHOP SYSTEM  (Part 4)
// ============================================================
function setupShop() {
  document.getElementById('shopCloseBtn')?.addEventListener('click', closeShop);

  setMoneyChangeCallback(money => _updateMoneyHUD(money));

}

function _updateShopProximity(px, pz) {
  const nearest = getNearestShop(px, pz);
  if (nearest !== _nearestShop) {
    _nearestShop = nearest;
    const hint = document.getElementById('shopHint');
    const text = document.getElementById('shopHintText');
    if (hint) {
      if (nearest) {
        const shop = SHOPS[nearest];
        if (text) text.innerHTML = `${shop.name} — Press <kbd>E</kbd> to open`;
        hint.classList.remove('hidden');
      } else {
        hint.classList.add('hidden');
      }
    }
  }
}

function _updateMoneyHUD(money) {
  const el = document.getElementById('hudMoney');
  if (el) el.textContent = `$${money.toLocaleString()}`;
}

function setupMap() {

  document.getElementById('mapClose')?.addEventListener('click', closeMap);

  document.getElementById('mapZoomIn')?.addEventListener('click', () => {
    mapZoom = Math.min(MAP_ZOOM_MAX, parseFloat((mapZoom * 1.5).toFixed(2)));
    _updateMapZoomUI();
  });

  document.getElementById('mapZoomOut')?.addEventListener('click', () => {
    mapZoom = Math.max(MAP_ZOOM_MIN, parseFloat((mapZoom / 1.5).toFixed(2)));
    _updateMapZoomUI();
  });

  // Scroll-wheel zoom on the overlay
  document.getElementById('mapOverlay')?.addEventListener('wheel', e => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    mapZoom = Math.max(MAP_ZOOM_MIN, Math.min(MAP_ZOOM_MAX,
      parseFloat((mapZoom * factor).toFixed(2))
    ));
    _updateMapZoomUI();
  }, { passive: false });
}
function setupPointerLock() {
  // LEFT CLICK: acquire pointer lock if not locked, otherwise DIG
  gameCanvas.addEventListener('mousedown', e => {
    if (e.button !== 0) return; // left button only

    if (!isPointerLocked()) {
      requestPointerLock(gameCanvas);
      return;
    }

    // Dig on left click (same logic as E key dig)
    if (!isChatOpen && !isPauseOpen && !isShopOpen() && !isInventoryOpen) {
      _performDig();
    }
  });

  // pointerlockchange: open the pause menu whenever the browser releases lock
  document.addEventListener('pointerlockchange', () => {
    if (!isPointerLocked() && !isChatOpen && !isMapOpen && !isPauseOpen) {
      openPauseMenu();
    }
  });

  document.addEventListener('pointerlockerror', () => {
    console.warn('[Game] Pointer lock request denied.');
  });

  // ── Teleport Wheel (hold Y when underground) ─────────────
  _setupTeleportWheel();
}

// ── Shared dig logic (used by mouse click AND E key) ─────────
function _performDig() {
  if (!isPointerLocked()) return;

  const now = performance.now();
  if (now - _lastDigTime < _getDigCooldown()) return;
  _lastDigTime = now;

  if (playerInventory.isActiveBroken()) {
    _showDigNotif('broken');
    return;
  }

  const EYE_H     = 1.62;
  const digResult = onDig(player.x, player.y, player.z, player.yaw, player.pitch, EYE_H);

  if (!digResult) {
    _showDigNotif(getZoneName(player.x, player.z) === 'Plaza' ? null : 'maxdepth');
    _punchProgress = 0;
    return;
  }

  // Camera shake — always, every punch
  if (digResult.shakeAmt) triggerShake(digResult.shakeAmt);

  // Progress ring HUD state
  _punchProgress = digResult.punchProgress ?? 1;

  if (digResult.partialHit) {
    // Partial punch — no inventory change, no money, just feedback
    _showDigNotif({ partialHit: true, layer: digResult.layer,
                    hits: digResult.hits, maxHits: digResult.maxHits });
    return;
  }

  // ── Full dig landed ─────────────────────────────────────
  _punchProgress = 0;

  // ── Part 2: Apply world-event multipliers ───────────────
  const _rushMult   = getOreRushMultiplier();
  const _meteorMult = getMeteorSiteBonus(player.x, player.z);
  const _eventMult  = _rushMult * _meteorMult;
  if (_eventMult > 1 && digResult.earned) {
    const bonus = Math.round(digResult.earned * (_eventMult - 1));
    addMoney(bonus);
    digResult.earned    += bonus;
    digResult.eventMult  = _eventMult;
    digResult.totalMoney = getMoney();
  }
  // Void Surge: boost ore roll chance (flag for notif)
  if (getVoidSurgeActive() && digResult.layer?.name === 'The Void') {
    digResult.voidSurge = true;
  }

  const itemId    = digResult.ore ? digResult.ore.id   : digResult.layer.name;
  const itemName  = digResult.ore ? digResult.ore.name : digResult.layer.name;
  const collected = playerInventory.addItem(itemId, itemName);
  if (!collected) digResult.bagFull = true;

  const broke = playerInventory.damageTool(1);
  if (broke) digResult.toolBroke = true;

  _showDigNotif(digResult);
  _refreshHotbarSlot(playerInventory.activeSlot);
  _updateInvCapacityUI();
  _updateMoneyHUD(getMoney());

  // Record for teleport wheel "Last Dig" slot
  recordLastDigPoint(player.x, player.z, digResult.depth);

  // Layer-transition flourish
  if (digResult.newLayer) {
    _showLayerTransitionBanner(digResult.newLayer);
    flashLayerColour(digResult.newLayer.hexColor);
  }

  // ── Motherlode announcements ─────────────────────────────
  if (digResult.motherlode && digResult.ore) {
    const { isMotherlode, isGrandMotherlode, minedCount, oreId } = digResult.motherlode;
    const ore = digResult.ore;

    if (isGrandMotherlode && minedCount === 6) {
      // Exactly 6 = announce once to server chat
      const msg = `🏆 ${sessionStorage.getItem('playerName') || 'A miner'} found a ${ore.name} motherlode at ${Math.round(digResult.depth)}m!`;
      sendChat(msg).catch(() => {});
      _showMotherloadeBanner(ore, true);
    } else if (isMotherlode && minedCount === 4) {
      // Hit 4 cells — local popup only
      _showMotherloadeBanner(ore, false);
    }
  }

  // ── Part 4: Discovery event system ──────────────────────
  if (digResult.ore) _triggerDiscoveryEvent(digResult.ore, digResult.depth);
}

// ============================================================
//  CHAT
// ============================================================
// ============================================================
//  TELEPORT WHEEL  (hold Y key — 3 slots: Plaza, Last Dig, Custom)
// ============================================================
let _tpWheelOpen    = false;
let _tpHoldTimer    = null;
let _tpLastDigX     = null;
let _tpLastDigZ     = null;
let _tpLastDigDepth = 0;
let _tpCustomWaypoint = null;   // { x, z, depth, label } — set by Anchor item

const TP_SLOTS_DEF = [
  { id:'plaza',    icon:'🏛',  label:'Plaza',         fixed: true },
  { id:'lastdig',  icon:'⛏',   label:'Last Dig',      fixed: false },
  { id:'custom',   icon:'📍',  label:'Waypoint',      fixed: false },
];

function _buildTpWheel() {
  const ring = document.getElementById('tpWheelRing');
  if (!ring) return;
  ring.innerHTML = '';

  const depth   = getDepthAt(player.x, player.z);
  const slots   = [...TP_SLOTS_DEF];
  const count   = slots.length;
  const R       = 110;  // px from centre

  slots.forEach((slot, i) => {
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
    const sx    = R * Math.cos(angle);
    const sy    = R * Math.sin(angle);

    const el = document.createElement('div');
    el.className = 'tp-slot';
    el.style.left = (140 + sx) + 'px';
    el.style.top  = (140 + sy) + 'px';

    const locked = (slot.id === 'lastdig'  && _tpLastDigX === null)
                || (slot.id === 'custom'   && !_tpCustomWaypoint);

    if (locked) el.classList.add('tp-locked');

    let depthLabel = '';
    if (slot.id === 'lastdig' && _tpLastDigX !== null) depthLabel = _tpLastDigDepth.toFixed(0) + 'm deep';
    if (slot.id === 'custom'  && _tpCustomWaypoint)    depthLabel = _tpCustomWaypoint.depth.toFixed(0) + 'm';

    // Deep teleport cost warning
    let costLabel = '';
    if (!locked) {
      const targetDepth = slot.id === 'plaza' ? 0 : (slot.id === 'lastdig' ? _tpLastDigDepth : (_tpCustomWaypoint?.depth ?? 0));
      if (targetDepth > 100 && slot.id !== 'plaza') costLabel = '💰 50 coins';
    }

    el.innerHTML = `<div class="tp-slot-icon">${slot.icon}</div>
      <div class="tp-slot-label">${slot.id === 'custom' && _tpCustomWaypoint ? _tpCustomWaypoint.label : slot.label}</div>
      ${depthLabel ? `<div class="tp-slot-depth">${depthLabel}</div>` : ''}
      ${costLabel  ? `<div class="tp-slot-depth" style="color:#ffd700">${costLabel}</div>` : ''}`;

    if (!locked) {
      el.addEventListener('mouseenter', () => el.classList.add('tp-hovered'));
      el.addEventListener('mouseleave', () => el.classList.remove('tp-hovered'));
      el.addEventListener('click', () => _executeTeleport(slot.id));
    }

    ring.appendChild(el);
  });
}

function _executeTeleport(slotId) {
  _closeTpWheel();
  if (!player) return;

  // Cost check for deep teleports
  const targetDepth = slotId === 'lastdig' ? _tpLastDigDepth
                    : slotId === 'custom'  ? (_tpCustomWaypoint?.depth ?? 0)
                    : 0;
  if (targetDepth > 100 && slotId !== 'plaza') {
    const cost = 50;
    if (getMoney() < cost) {
      _showLayerTransitionBanner({ name:'Insufficient coins (need 50)', hexColor:'#ff4444', emoji:'💰', minDepth:0 });
      return;
    }
    addMoney(-cost);
    _updateMoneyHUD(getMoney());
  }

  // Teleport animation — brief FOV widen then snap
  const flash = document.createElement('div');
  flash.className = 'tp-flash';
  document.body.appendChild(flash);
  requestAnimationFrame(() => {
    flash.style.transition = 'background 0.15s';
    flash.style.background = 'rgba(255,255,255,0.35)';
  });
  setTimeout(() => {
    flash.style.transition = 'background 0.3s';
    flash.style.background = 'rgba(255,255,255,0)';
    setTimeout(() => flash.remove(), 350);
  }, 150);

  // Move player
  if (slotId === 'plaza') {
    player.x = 0; player.y = 2.0; player.z = 5;
  } else if (slotId === 'lastdig' && _tpLastDigX !== null) {
    player.x = _tpLastDigX; player.y = 2.0; player.z = _tpLastDigZ;
  } else if (slotId === 'custom' && _tpCustomWaypoint) {
    player.x = _tpCustomWaypoint.x; player.y = 2.0; player.z = _tpCustomWaypoint.z;
  }
  player.vy = 0;
  player.onGround = false;
}

function _openTpWheel() {
  if (_tpWheelOpen) return;
  _tpWheelOpen = true;
  document.exitPointerLock?.();
  _buildTpWheel();
  document.getElementById('teleportWheel')?.classList.remove('hidden');
}

function _closeTpWheel() {
  if (!_tpWheelOpen) return;
  _tpWheelOpen = false;
  document.getElementById('teleportWheel')?.classList.add('hidden');
}

// ── Part 5: Chest open handler (AI-powered via aiContent.js) ─
async function _handleChestOpen(chest) {
  const notif = document.createElement('div');
  notif.style.cssText = [
    'position:fixed','bottom:140px','left:50%','transform:translateX(-50%)',
    'background:rgba(0,0,0,0.88)','border-radius:10px','padding:12px 22px',
    'font-family:inherit','font-size:13px','font-weight:600','color:#fff',
    'pointer-events:none','z-index:420','opacity:1','transition:opacity 0.5s',
    'display:flex','flex-direction:column','align-items:center','gap:4px',
    'border:1px solid rgba(255,255,255,0.12)',
  ].join(';');
  notif.innerHTML = '<span style="font-size:18px">📦</span> Opening ' + chest.tier + ' chest…';
  document.body.appendChild(notif);

  // ── AI loot determination via Part 5 module ──────────────
  const prestige = window._playerPrestige ?? 0;
  const loot = await getChestLoot(chest.depth, getMoney(), prestige, chest.tier);

  const ore        = ORES[loot.ore_id] ?? null;
  const bonusCoins = Math.max(0, loot.bonus_coins ?? 0);
  const flavour    = loot.flavour_text ?? 'Something shines in the dark.';
  const oreCount   = Math.max(1, Math.min(4, loot.ore_count ?? 1));

  // ── Apply loot ────────────────────────────────────────────
  if (ore) {
    for (let i = 0; i < oreCount; i++) playerInventory.addItem(ore.id, ore.name);
  }
  if (bonusCoins > 0) addMoney(bonusCoins);
  _updateMoneyHUD(getMoney());
  window.dispatchEvent(new CustomEvent('inventory-changed'));

  // ── Show result ───────────────────────────────────────────
  const oreLabel = ore
    ? `<span style="color:${ore.hexColor}">${ore.emoji} ${ore.name}${oreCount > 1 ? ' ×' + oreCount : ''}</span>`
    : '<span style="color:#aaa">Empty</span>';

  notif.innerHTML =
    `<div style="font-size:16px">📦 Chest Opened!</div>` +
    `<div>${oreLabel}${bonusCoins > 0 ? ` · <span style="color:#ffd700">+$${bonusCoins}</span>` : ''}</div>` +
    `<div style="font-size:11px;font-weight:400;color:#aaa;max-width:220px;text-align:center">${flavour}</div>`;

  setTimeout(() => {
    notif.style.opacity = '0';
    setTimeout(() => notif.remove(), 600);
  }, 4000);

}

// ── Part 2: E-key cave interaction ────────────────────────────
function _handleCaveInteract() {
  const result = cavesInteract(player.x, player.y, player.z);
  if (!result) return;
  if (result.type === 'chest') _handleChestOpen(result.chest);
  if (result.type === 'cabin') {
    const cabin = result.cabin;
    const popup = document.createElement('div');
    popup.style.cssText = [
      'position:fixed','top:50%','left:50%','transform:translate(-50%,-50%)',
      'background:rgba(10,8,6,0.93)','border:1px solid #8a7040','border-radius:10px',
      'padding:18px 26px','font-family:inherit','font-size:13px','color:#e8d4a0',
      'z-index:450','max-width:340px','text-align:center','pointer-events:auto','cursor:pointer',
      'box-shadow:0 0 30px rgba(0,0,0,0.7)',
    ].join(';');
    popup.innerHTML =
      '<div style="font-size:18px;margin-bottom:10px">📜 Miner's Log</div>' +
      '<div style="color:#c0a870;line-height:1.7;min-height:42px;font-style:italic">Loading…</div>' +
      '<div style="margin-top:14px;font-size:11px;color:#666">[Click to close]</div>';
    popup.addEventListener('click', () => popup.remove());
    document.body.appendChild(popup);
    const cabinKey = Math.round(cabin.cx) + '_' + Math.round(cabin.cz);
    getCabinLore(cabinKey, cabin.depth ?? 30).then(lore => {
      const textEl = popup.querySelectorAll('div')[1];
      if (textEl && popup.isConnected) { textEl.textContent = lore; textEl.style.fontStyle = 'normal'; }
    }).catch(() => {});
  }
}

// Track last dig point for "Last Dig" slot
function recordLastDigPoint(x, z, depth) {
  _tpLastDigX     = x;
  _tpLastDigZ     = z;
  _tpLastDigDepth = depth;
}

function _setupTeleportWheel() {
  // Hold Y to open wheel, release to close
  document.addEventListener('keydown', e => {
    if (e.code !== 'KeyY') return;
    if (isChatOpen || isPauseOpen || isShopOpen()) return;
    e.preventDefault();
    if (!_tpWheelOpen) _openTpWheel();
  });
  document.addEventListener('keyup', e => {
    if (e.code !== 'KeyY') return;
    _closeTpWheel();
    setTimeout(() => requestPointerLock(gameCanvas), 100);
  });

  // Escape closes the wheel
  document.addEventListener('keydown', e => {
    if (e.code === 'Escape' && _tpWheelOpen) { e.stopImmediatePropagation(); _closeTpWheel(); }
  }, true);

  // Keep the old button working as a quick Plaza teleport
  document.getElementById('ugTeleportBtn')?.addEventListener('click', e => {
    e.stopPropagation();
    _executeTeleport('plaza');
  });
}

function setupChat(name, colour) {
  document.addEventListener('keydown', e => {
    const binds  = window.WALKWORLD_BINDS || DEFAULT_BINDS;
    const chatKey = binds.chat;
    const mapKey  = binds.map || 'KeyM';

    // Map toggle — works whenever gameplay is live (not in chat/pause)
    if (e.code === mapKey && !isChatOpen && !isPauseOpen) {
      e.preventDefault();
      isMapOpen ? closeMap() : openMap();
      return;
    }

    // ── Inventory toggle (I key) ──────────────────────────────
    if (e.code === 'KeyI' && !isChatOpen && !isPauseOpen) {
      e.preventDefault();
      isInventoryOpen ? closeInventory() : openInventory();
      return;
    }

    // ── E key: open nearby shop OR dig ───────────────────────
    if (e.code === 'KeyE' && !isChatOpen && !isPauseOpen) {
      e.preventDefault();

      // If a shop is nearby, open it instead of digging
      if (_nearestShop && !isShopOpen() && !isInventoryOpen) {
        openShop(_nearestShop);
        return;
      }

      // Close shop/inventory on E if open
      if (isShopOpen()) { closeShop(); return; }
      if (isInventoryOpen) { closeInventory(); return; }

      // Part 2: Check for cave interactions (chests, cabin signs) first
      const _caveHit = _handleCaveInteract();
      if (_caveHit) return;

      // Dig on E key too (as fallback)
      _performDig();
      return;
    }

    if (e.code === chatKey && !isChatOpen && !isPauseOpen && isPointerLocked()) {
      e.preventDefault();
      openChat();
      return;
    }

    if (e.code === 'Escape') {
      e.preventDefault();
      if (isShopOpen())    { closeShop();         return; }
      if (isInventoryOpen) { closeInventory();     return; }
      if (isMapOpen)       { closeMap();           return; }
      if (isChatOpen)      { closeChat();          return; }
      if (isPauseOpen)     { closePauseMenu(true); return; }
      openPauseMenu();
      return;
    }
  });

  chatForm.addEventListener('submit', e => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;
    sendChat({ name, colour, text });
    renderer.addBubble('local', text);
    chatInput.value = '';
    closeChat();
  });
}

function openChat() {
  isChatOpen = true;
  chatInput.disabled = false;
  chatInput.focus();
  if (isPointerLocked()) document.exitPointerLock();
}

function closeChat() {
  isChatOpen = false;
  chatInput.disabled = true;
  chatInput.blur();
  // Re-acquire pointer lock so user can look around immediately
  requestPointerLock(gameCanvas);
}

function renderChat(messages) {
  chatMessages.innerHTML = '';

  messages.forEach(m => {
    const div = document.createElement('div');
    div.className = 'chat-msg' + (m.system ? ' sys-msg' : '');

    if (m.name && !m.system) {
      const nameSpan = document.createElement('span');
      nameSpan.className   = 'msg-name';
      nameSpan.style.color = m.colour || '#ffffff';
      nameSpan.textContent = m.name;
      div.appendChild(nameSpan);
    }

    const textSpan = document.createElement('span');
    textSpan.className   = 'msg-text';
    textSpan.textContent = m.text;
    div.appendChild(textSpan);

    // Trigger a bubble on the matching remote player
    if (!m.system && m.name) {
      for (const [id, p] of Object.entries(remotePlayers)) {
        if (p.name === m.name) { renderer.addBubble(id, m.text); break; }
      }
    }

    chatMessages.appendChild(div);
  });

  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ============================================================
//  PAUSE MENU
// ============================================================

function setupPauseMenu() {
  if (!pauseMenu) return;

  // ── HUD buttons ──────────────────────────────────────────
  btnSettings?.addEventListener('click', () => {
    isPauseOpen ? closePauseMenu() : openPauseMenu('main');
  });

  btnCharacter?.addEventListener('click', () => {
    openPauseMenu('avatar');
  });

  // ── Nav items (Settings / Avatar) ────────────────────────
  pauseMenu.querySelectorAll('[data-pm-tab]').forEach(btn => {
    btn.addEventListener('click', () => _switchTab(btn.dataset.pmTab));
  });

  // ── Back buttons (return to main screen) ─────────────────
  pauseMenu.querySelectorAll('[data-pm-back]').forEach(btn => {
    btn.addEventListener('click', () => _switchTab(btn.dataset.pmBack));
  });

  // ── Resume ───────────────────────────────────────────────
  document.getElementById('pmResume')?.addEventListener('click', closePauseMenu);

  // ── Leave ────────────────────────────────────────────────
  document.getElementById('pmLeave')?.addEventListener('click', () => {
    window.location.href = 'index.html';
  });

  // ── Reset Character ──────────────────────────────────────
  document.getElementById('pmResetChar')?.addEventListener('click', () => {
    if (player) {
      player.x = 0;
      player.y = 2.0;
      player.z = 5;
      player.vy = 0;
      player.onGround = false;
    }
    closePauseMenu();
  });

  // ── Sensitivity slider ───────────────────────────────────
  if (sensSlider) {
    sensSlider.value = String(window.WALKWORLD_SENS);
    if (sensValueEl) sensValueEl.textContent = Number(window.WALKWORLD_SENS).toFixed(4);

    sensSlider.addEventListener('input', () => {
      window.WALKWORLD_SENS = parseFloat(sensSlider.value);
      if (sensValueEl) sensValueEl.textContent = parseFloat(sensSlider.value).toFixed(4);
      saveSettings();
    });
  }

  // ── Key bind buttons ─────────────────────────────────────
  document.querySelectorAll('[data-bind]').forEach(btn => {
    const action = btn.dataset.bind;
    btn.textContent = prettyCode((window.WALKWORLD_BINDS || {})[action] || action);

    btn.addEventListener('click', () => {
      const prev = btn.textContent;
      btn.textContent = '…';
      btn.classList.add('sp-listening');

      const capture = e => {
        e.preventDefault(); e.stopImmediatePropagation();
        window.WALKWORLD_BINDS[action] = e.code;
        btn.textContent = prettyCode(e.code);
        btn.classList.remove('sp-listening');
        saveSettings();
        window.removeEventListener('keydown', capture, true);
        window.removeEventListener('keydown', cancel,  true);
      };
      const cancel = e => {
        if (e.code !== 'Escape') return;
        btn.textContent = prev;
        btn.classList.remove('sp-listening');
        window.removeEventListener('keydown', capture, true);
        window.removeEventListener('keydown', cancel,  true);
      };
      window.addEventListener('keydown', capture, true);
      window.addEventListener('keydown', cancel,  true);
    });
  });

  // ── Reset defaults ───────────────────────────────────────
  document.getElementById('spReset')?.addEventListener('click', () => {
    window.WALKWORLD_SENS  = DEFAULT_SENS;
    window.WALKWORLD_BINDS = { ...DEFAULT_BINDS };
    saveSettings();
    if (sensSlider)   sensSlider.value = String(DEFAULT_SENS);
    if (sensValueEl)  sensValueEl.textContent = DEFAULT_SENS.toFixed(4);
    document.querySelectorAll('[data-bind]').forEach(b => {
      b.textContent = prettyCode(DEFAULT_BINDS[b.dataset.bind]);
    });
  });
}

function _switchTab(tabName) {
  const pmMain         = document.getElementById('pmMain');
  const pmTabSettings  = document.getElementById('pmTabSettings');
  const pmTabAvatar    = document.getElementById('pmTabAvatar');

  // Show/hide panels based on which tab is active
  pmMain?.classList.toggle('pm-hidden', tabName !== 'main');
  pmTabSettings?.classList.toggle('pm-hidden', tabName !== 'settings');
  pmTabAvatar?.classList.toggle('pm-hidden', tabName !== 'avatar');

  // Kick off avatar preview spin when avatar tab opens
  if (tabName === 'avatar') _tickAvatarPreview();
}

function openPauseMenu(tab = 'main') {
  isPauseOpen = true;
  pauseMenu.classList.remove('hidden');
  btnSettings?.classList.add('active');
  if (isPointerLocked()) document.exitPointerLock();
  _switchTab(tab);
  if (sensSlider)  sensSlider.value = String(window.WALKWORLD_SENS);
  if (sensValueEl) sensValueEl.textContent = Number(window.WALKWORLD_SENS).toFixed(4);
}

function closePauseMenu(fromEscape = false) {
  isPauseOpen = false;
  pauseMenu?.classList.add('hidden');
  btnSettings?.classList.remove('active');
  gameCanvas.focus();

  if (fromEscape) {
    // Browsers block requestPointerLock() called shortly after an Escape keydown
    // (Escape is the browser's own key to EXIT pointer lock, so it temporarily
    // prevents re-acquisition). A click event is always a trusted gesture and
    // bypasses this restriction — same reason the Resume button works fine.
    // Show a lightweight hint and re-acquire on the next click.
    lockHint?.classList.remove('hidden');
    const relock = () => {
      lockHint?.classList.add('hidden');
      if (!isPauseOpen && !isChatOpen && !isMapOpen) {
        requestPointerLock(gameCanvas);
      }
    };
    lockHint?.addEventListener('click', relock, { once: true });
  } else {
    // Re-acquire pointer lock automatically.
    // We use a short timeout because browsers block requestPointerLock()
    // when it's called in the same event tick that ESC released the lock.
    // Giving the browser one frame to clear that block makes it reliable.
    setTimeout(() => {
      if (!isPauseOpen && !isChatOpen && !isMapOpen) {
        requestPointerLock(gameCanvas);
      }
    }, 80);
  }
}

// ============================================================
//  AVATAR PREVIEW (inside pause menu Avatar tab)
// ============================================================
const SKIN_PRESETS  = ['#f0c890','#d4956a','#a0643a','#7a3f20','#4a2010','#ffe0d0'];
const SHIRT_PRESETS = ['#1e90ff','#e03030','#2ed573','#ffa502','#a29bfe','#fd79a8','#ffffff','#333355'];
const PANTS_PRESETS = ['#2c2c3a','#1a3a6a','#3a2010','#2a4a2a','#555555','#8b6914','#000000','#4a0a0a'];
const HAIR_PRESETS  = ['#3a2010','#1a1a1a','#c8a020','#e08030','#a0a0a0','#ffffff','#e03030','#4060c0'];
const HAIR_STYLES   = ['none','straight','afro','spiky','bun'];

let _avPrevRenderer = null;
let _avPrevScene    = null;
let _avPrevCam      = null;
let _avPrevGroup    = null;
let _avSpinning     = false;

function initAvatarPreview() {
  const canvas = document.getElementById('pmPreviewCanvas');
  if (!canvas || typeof THREE === 'undefined') return;

  const W = 110, H = 160;
  _avPrevRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  _avPrevRenderer.setSize(W, H);
  _avPrevRenderer.setClearColor(0x000000, 0);

  _avPrevScene = new THREE.Scene();
  _avPrevScene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const dl = new THREE.DirectionalLight(0xfff0cc, 0.9);
  dl.position.set(2, 4, 3);
  _avPrevScene.add(dl);

  _avPrevCam = new THREE.PerspectiveCamera(42, W / H, 0.1, 50);
  _avPrevCam.position.set(0, 1.0, 3.5);
  _avPrevCam.lookAt(0, 1.0, 0);

  // Build swatch grids + hair buttons
  _buildSwatches('pmSwatchSkin',  SKIN_PRESETS,  'skinColour');
  _buildSwatches('pmSwatchShirt', SHIRT_PRESETS, 'shirtColour');
  _buildSwatches('pmSwatchPants', PANTS_PRESETS, 'pantsColour');
  _buildSwatches('pmSwatchHair',  HAIR_PRESETS,  'hairColour');
  _buildHairBtns();

  // Height slider
  const hSlider = document.getElementById('pmHeightSlider');
  const hVal    = document.getElementById('pmHeightVal');
  if (hSlider) {
    const cfg = getLocalCharConfig();
    hSlider.value = cfg.height;
    if (hVal) hVal.textContent = Number(cfg.height).toFixed(2) + '×';
    hSlider.addEventListener('input', () => {
      const cfg2 = getLocalCharConfig();
      cfg2.height = parseFloat(hSlider.value);
      if (hVal) hVal.textContent = cfg2.height.toFixed(2) + '×';
      saveLocalCharConfig(cfg2);
      _rebuildAvPreview();
    });
  }

  // ── Avatar Reset ─────────────────────────────────────────
  document.getElementById('pmAvatarReset')?.addEventListener('click', () => {
    saveLocalCharConfig({ ...DEFAULT_CHAR_CONFIG });
    _syncAvSwatches();
    const hSl = document.getElementById('pmHeightSlider');
    const hV  = document.getElementById('pmHeightVal');
    if (hSl) hSl.value = DEFAULT_CHAR_CONFIG.height;
    if (hV)  hV.textContent = DEFAULT_CHAR_CONFIG.height.toFixed(2) + '×';
    _rebuildAvPreview();
    _flashApplyBtn('Reset!');
  });

  // ── Apply Avatar ──────────────────────────────────────────
  document.getElementById('pmApplyAvatar')?.addEventListener('click', () => {
    const cfg = getLocalCharConfig();
    updateCharacter(cfg);
    _flashApplyBtn('Applied ✓');
  });

  _rebuildAvPreview();
  _syncAvSwatches();
}

function _buildSwatches(containerId, presets, field) {
  const el = document.getElementById(containerId);
  if (!el) return;
  presets.forEach(colour => {
    const btn = document.createElement('button');
    btn.className = 'pm-av-swatch';
    btn.style.background = colour;
    btn.dataset.field  = field;
    btn.dataset.colour = colour;
    btn.setAttribute('aria-label', colour);
    btn.addEventListener('click', () => {
      const cfg = getLocalCharConfig();
      cfg[field] = colour;
      saveLocalCharConfig(cfg);
      _syncAvSwatches();
      _rebuildAvPreview();
    });
    el.appendChild(btn);
  });
}

function _buildHairBtns() {
  const el = document.getElementById('pmHairBtns');
  if (!el) return;
  HAIR_STYLES.forEach(style => {
    const btn = document.createElement('button');
    btn.className = 'pm-av-hair-btn';
    btn.textContent = style;
    btn.dataset.hair = style;
    btn.addEventListener('click', () => {
      const cfg = getLocalCharConfig();
      cfg.hairStyle = style;
      saveLocalCharConfig(cfg);
      document.querySelectorAll('.pm-av-hair-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.hair === style)
      );
      _rebuildAvPreview();
    });
    el.appendChild(btn);
  });
}

function _syncAvSwatches() {
  const cfg = getLocalCharConfig();
  document.querySelectorAll('.pm-av-swatch').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.colour === cfg[btn.dataset.field]);
  });
  document.querySelectorAll('.pm-av-hair-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.hair === cfg.hairStyle);
  });
}

function _rebuildAvPreview() {
  if (!_avPrevScene) return;
  if (_avPrevGroup) _avPrevScene.remove(_avPrevGroup);
  _avPrevGroup = buildCharacter(getLocalCharConfig());
  _avPrevScene.add(_avPrevGroup);
  _renderAvPreview();
}

function _flashApplyBtn(label) {
  const btn = document.getElementById('pmApplyAvatar');
  if (!btn) return;
  const orig = btn.textContent;
  btn.textContent = label;
  btn.disabled = true;
  setTimeout(() => {
    btn.textContent = 'Apply';
    btn.disabled = false;
  }, 1400);
}

function _renderAvPreview() {
  if (!_avPrevRenderer || !_avPrevScene) return;
  if (_avPrevGroup) _avPrevGroup.rotation.y += 0.015;
  _avPrevRenderer.render(_avPrevScene, _avPrevCam);
}

function _tickAvatarPreview() {
  if (_avSpinning) return;
  _avSpinning = true;
  const tick = () => {
    const avatarTabVisible = !document.getElementById('pmTabAvatar')?.classList.contains('pm-hidden');
    if (!isPauseOpen || !avatarTabVisible) { _avSpinning = false; return; }
    _renderAvPreview();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ============================================================
//  PART 4 — DISCOVERY EVENT SYSTEM
//
//  Tiered reactions keyed to ore rarity:
//
//  common / uncommon → HUD rarity badge for 2 s, no camera change
//  rare              → FOV tween 75→62→75 over 800 ms + badge
//  epic              → 0.4 s time-scale 0.25 + zoom + vignette
//                      + white flash + server chat broadcast
//  legendary / mythic→ 1 s freeze + cinematic bars + white flash
//                      + server-wide chat
// ============================================================

function _triggerDiscoveryEvent(ore, depth) {
  const rarity = ore.rarity;

  // common / uncommon — just a badge, no drama
  if (rarity === 'common' || rarity === 'uncommon') {
    _showRarityBadge(ore, 2000);
    return;
  }

  // Prevent stacking dramatic events
  if (_discoveryLock) return;
  _discoveryLock = true;
  setTimeout(() => { _discoveryLock = false; }, 4000);

  if (rarity === 'rare') {
    _showRarityBadge(ore, 3000);
    _tweenFOV(75, 62, 300, () => setTimeout(() => _tweenFOV(62, 75, 500, null), 500));

  } else if (rarity === 'epic') {
    _showRarityBadge(ore, 4000);
    _showVignette(ore.hexColor, 1200);
    _showWhiteFlash(90);
    _tweenFOV(75, 60, 250, () => setTimeout(() => _tweenFOV(60, 75, 500, null), 400));
    // Time-scale slowdown for 0.4 s
    _timeScaleMult = 0.25;
    setTimeout(() => { _timeScaleMult = 1.0; }, 400);
    // Server-wide chat
    const name = sessionStorage.getItem('playerName') || 'A miner';
    sendChat(`💎 ${name} found ${ore.name} at ${Math.round(depth)}m!`).catch(() => {});

  } else if (rarity === 'legendary' || rarity === 'mythic') {
    _showRarityBadge(ore, 0);      // stays until timer expires internally
    _showCinematicBars(2200);
    _showWhiteFlash(220);
    _tweenFOV(75, 55, 200, () => setTimeout(() => _tweenFOV(55, 75, 700, null), 900));
    // 1 s freeze
    _timeScaleMult = 0;
    setTimeout(() => { _timeScaleMult = 1.0; }, 1000);
    // Server-wide chat
    const name  = sessionStorage.getItem('playerName') || 'A miner';
    const emoji = rarity === 'mythic' ? '☀️' : '🔮';
    sendChat(`${emoji} ${name} discovered ${ore.name} at ${Math.round(depth)}m! Legendary find!`).catch(() => {});
  }
}

/** Coloured rarity badge below crosshair. dur=0 → permanent (auto-fades after 5 s). */
function _showRarityBadge(ore, dur) {
  let el = document.getElementById('rarityBadge');
  if (!el) {
    el = document.createElement('div');
    el.id = 'rarityBadge';
    (document.getElementById('gameWrapper') || document.body).appendChild(el);
  }
  clearTimeout(el._timer);
  el.style.cssText = [
    'position:fixed','bottom:54%','left:50%','transform:translateX(-50%)',
    `padding:5px 16px 5px 12px`,`border-radius:6px`,
    `background:${ore.hexColor}22`,`border:1px solid ${ore.hexColor}88`,
    `color:${ore.hexColor}`,`font-family:var(--font-pixel,monospace)`,
    `font-size:13px`,`font-weight:600`,`letter-spacing:.06em`,
    `pointer-events:none`,`z-index:9000`,
    `display:flex`,`align-items:center`,`gap:8px`,
    `opacity:1`,`transition:opacity .4s`,
    `box-shadow:0 0 14px ${ore.hexColor}44`,
  ].join(';');
  el.innerHTML =
    `<span style="font-size:17px">${ore.emoji}</span>` +
    `${ore.name.toUpperCase()}&nbsp;` +
    `<span style="font-size:11px;opacity:.7">+$${ore.value}</span>`;
  const fadeDur = dur > 0 ? dur : 5000;
  el._timer = setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => { el.style.opacity = ''; el.style.transition = ''; }, 420);
  }, fadeDur);
}

/** White flash overlay. */
function _showWhiteFlash(durationMs) {
  let el = document.getElementById('ww-white-flash');
  if (!el) {
    el = document.createElement('div');
    el.id = 'ww-white-flash';
    el.style.cssText = 'position:fixed;inset:0;background:#fff;pointer-events:none;z-index:9100;opacity:0;';
    (document.getElementById('gameWrapper') || document.body).appendChild(el);
  }
  el.style.transition = 'none';
  el.style.opacity    = '0.92';
  requestAnimationFrame(() => {
    el.style.transition = `opacity ${durationMs}ms ease`;
    el.style.opacity    = '0';
  });
}

/** Coloured edge vignette. */
function _showVignette(hexColor, durationMs) {
  let el = document.getElementById('ww-vignette');
  if (!el) {
    el = document.createElement('div');
    el.id = 'ww-vignette';
    el.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9050;opacity:0;';
    (document.getElementById('gameWrapper') || document.body).appendChild(el);
  }
  el.style.background = `radial-gradient(ellipse at center, transparent 38%, ${hexColor}66 100%)`;
  el.style.transition = 'none';
  el.style.opacity    = '1';
  setTimeout(() => {
    el.style.transition = `opacity ${durationMs}ms ease`;
    el.style.opacity    = '0';
  }, 50);
}

/** Top + bottom cinematic bars slide in then out. */
function _showCinematicBars(holdMs) {
  ['ww-cinema-top', 'ww-cinema-bot'].forEach((id, i) => {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      (document.getElementById('gameWrapper') || document.body).appendChild(el);
    }
    el.style.cssText = [
      'position:fixed','left:0','right:0','height:11vh',
      'background:#000','pointer-events:none','z-index:9080',
      'transition:transform .22s ease',
      i === 0 ? 'top:0;transform:translateY(-100%);' : 'bottom:0;transform:translateY(100%);',
    ].join(';');
    requestAnimationFrame(() => { el.style.transform = 'translateY(0)'; });
    setTimeout(() => {
      el.style.transform = i === 0 ? 'translateY(-100%)' : 'translateY(100%)';
    }, holdMs);
  });
}

/** Smooth FOV tween on the Three.js camera. */
function _tweenFOV(from, to, ms, cb) {
  if (!camera) return;
  const start = performance.now();
  const step  = now => {
    const t = Math.min(1, (now - start) / ms);
    camera.fov = from + (to - from) * t;
    camera.updateProjectionMatrix();
    if (t < 1) requestAnimationFrame(step); else cb?.();
  };
  requestAnimationFrame(step);
}

// ============================================================
//  DIG NOTIFICATION
// ============================================================
function _showDigNotif(result) {
  const el = document.getElementById('digNotif');
  if (!el) return;

  if (!result) {
    el.innerHTML = '<span style="color:#ff9944">🏛 This ground cannot be dug!</span>';
    el.className = 'dig-notif visible';
    clearTimeout(_digNotifTimer);
    _digNotifTimer = setTimeout(() => { el.className = 'dig-notif'; }, 1800);
    return;
  }

  if (result === 'maxdepth') {
    el.innerHTML = '<span style="color:#ff6b6b">⛔ Max depth reached!</span>';
    el.className = 'dig-notif visible';
    clearTimeout(_digNotifTimer);
    _digNotifTimer = setTimeout(() => { el.className = 'dig-notif'; }, 1800);
    return;
  }

  if (result === 'broken') {
    el.innerHTML = '<span style="color:#ff4444">🔨 Tool is broken! Buy a new one.</span>';
    el.className = 'dig-notif visible';
    clearTimeout(_digNotifTimer);
    _digNotifTimer = setTimeout(() => { el.className = 'dig-notif'; }, 2200);
    return;
  }

  // Partial hit — layer not yet broken
  if (result.partialHit) {
    const { layer, hits, maxHits } = result;
    const pips = '▓'.repeat(hits) + '░'.repeat(maxHits - hits);
    el.innerHTML =
      `<span style="color:${layer.hexColor}">${layer.emoji} ${layer.name}</span>` +
      `<span style="color:#ccc;font-family:monospace;letter-spacing:2px"> ${pips}</span>` +
      `<span style="color:#aaa"> ${hits}/${maxHits}</span>`;
    el.className = 'dig-notif visible';
    clearTimeout(_digNotifTimer);
    _digNotifTimer = setTimeout(() => { el.className = 'dig-notif'; }, 900);
    return;
  }

  const { layer, ore, depth, earned, isDeposit, bagFull, toolBroke } = result;

  const displayItem  = ore || layer;
  const rarityClass  = 'rarity-' + displayItem.rarity;
  const depositTag   = isDeposit ? '<span class="dn-deposit">💥 ORE DEPOSIT ×3</span>' : '';
  const bagTag       = bagFull   ? '<span style="color:#ff9944">🎒 Bag full!</span>' : '';
  const brokeTag     = toolBroke ? '<span style="color:#ff4444">🔨 Tool broke!</span>' : '';

  if (ore) {
    el.innerHTML =
      '<span class="dn-ore-label">ORE FOUND!</span>' +
      '<span class="dn-emoji">' + ore.emoji + '</span>' +
      '<span class="dn-name ' + rarityClass + '" style="color:' + ore.hexColor + '">' + ore.name + '</span>' +
      '<span class="dn-label" style="color:' + ore.hexColor + '">' + ore.label + '</span>' +
      depositTag + bagTag + brokeTag +
      '<span class="dn-earned">+$' + earned + '</span>' +
      '<span class="dn-depth">' + depth.toFixed(1) + 'm · ' + layer.name + '</span>' +
      '<span class="dn-ai-desc" id="dnAiDesc_' + ore.id + '" style="display:none;font-size:10px;color:#bbb;font-style:italic;margin-top:2px"></span>';
    el.className = 'dig-notif visible ore-found ' + rarityClass + (isDeposit ? ' deposit-hit' : '');

    // Part 5: async AI ore description (fills in when ready, cached so 2nd+ finds are instant)
    getOreDesc(ore.id, ore.rarity).then(desc => {
      const descEl = document.getElementById('dnAiDesc_' + ore.id);
      if (descEl && el.classList.contains('visible')) {
        descEl.textContent = desc;
        descEl.style.display = '';
      }
    }).catch(() => {});
  } else {
    el.innerHTML =
      '<span class="dn-emoji">' + layer.emoji + '</span>' +
      '<span class="dn-name" style="color:' + layer.hexColor + '">' + layer.name + '</span>' +
      depositTag + bagTag + brokeTag +
      '<span class="dn-earned">+$' + earned + '</span>' +
      '<span class="dn-depth">' + depth.toFixed(1) + 'm deep</span>';
    el.className = 'dig-notif visible ' + (isDeposit ? 'deposit-hit' : '');
  }

  const dur = isDeposit ? 3500 : ore ? (ore.rarity === 'legendary' || ore.rarity === 'epic' ? 3000 : 2200) : 1600;
  clearTimeout(_digNotifTimer);
  _digNotifTimer = setTimeout(() => { el.className = 'dig-notif'; }, dur);
}

// ============================================================
//  HELPERS
// ============================================================
function setLoad(pct, msg) {
  loadBar.style.width    = pct + '%';
  loadStatus.textContent = msg;
}

function showDisconnected() {
  loadingOverlay.classList.add('hidden');
  disconnectedOverlay.classList.remove('hidden');
}

const tick  = () => new Promise(r => requestAnimationFrame(r));
const delay = ms  => new Promise(r => setTimeout(r, ms));

// ============================================================
//  START
// ============================================================
init().catch(err => {
  console.error('[Game] Fatal init error:', err);
  showDisconnected();
});
