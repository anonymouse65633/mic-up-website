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
import { initWorld, getZoneName } from './world.js';
import { initObjects } from './objects.js';
import {
  joinGame,
  leaveGame,
  updatePosition,
  onPlayersUpdate,
  getPlayerCount,
  sendChat,
  onChat,
} from './network.js';

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
const lockOverlay         = document.getElementById('lockOverlay');
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

// Settings
const settingsPanel = document.getElementById('settingsPanel');
const settingsBtn   = document.getElementById('settingsBtn');
const sensSlider    = document.getElementById('sensSlider');
const sensValueEl   = document.getElementById('sensValue');
const settingsClose = document.getElementById('settingsClose');

// ============================================================
//  RUNTIME STATE
// ============================================================
let player        = null;
let renderer      = null;
let remotePlayers = {};
let lastTime      = 0;
let rafId         = null;
let isChatOpen    = false;
let isSettingsOpen = false;

let _lastPosSend = 0;
const POS_INTERVAL = 100; // ms between Firebase position writes (~10 Hz)

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
  // Populate the scene (trees, rocks, cabin, plaza, etc.)
  initObjects();

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
  setupSettings();
  buildMinimapCache();

  setLoad(100, 'Ready!');
  await delay(300);

  loadingOverlay.classList.add('hidden');
  gameWrapper.classList.remove('hidden');
  lockOverlay.classList.remove('hidden'); // prompt to click

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
  const dt = Math.min((timestamp - lastTime) / 1000, 0.1);
  lastTime  = timestamp;

  // Only update player physics when gameplay is active
  if (!isChatOpen && !isSettingsOpen) {
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

  renderer.draw(player, remotePlayers, timestamp);

  rafId = requestAnimationFrame(gameLoop);
}

// ============================================================
//  HUD
// ============================================================
function updateHUD() {
  hudPos.textContent  = `${player.x.toFixed(1)}, ${player.z.toFixed(1)}`;
  if (hudZone) hudZone.textContent = getZoneName(player.x, player.z);
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
  compassCtx.fillStyle = 'rgba(13,13,26,0.80)';
  compassCtx.beginPath();
  compassCtx.roundRect(0, 0, W, H, [0, 0, 6, 6]);
  compassCtx.fill();

  // Ticks and labels — draw ±90° either side of current bearing
  for (let offset = -90; offset <= 90; offset++) {
    const deg = ((bearing + offset) % 360 + 360) % 360;
    const sx  = W / 2 + offset * DEG_PX;

    const isMajor = deg % 45 === 0;
    const isMid   = deg % 15 === 0 && !isMajor;

    if (isMajor || isMid) {
      const tickH = isMajor ? H * 0.50 : H * 0.28;
      compassCtx.fillStyle = isMajor
        ? 'rgba(0,245,196,0.95)'
        : 'rgba(255,255,255,0.35)';
      compassCtx.fillRect(Math.round(sx) - 0.5, (H - tickH) / 2, 1, tickH);
    }

    if (isMajor) {
      const label = CARDINAL.find(([v]) => v === deg);
      if (label) {
        compassCtx.font         = '700 10px "Press Start 2P", monospace';
        compassCtx.fillStyle    = 'rgba(0,245,196,1)';
        compassCtx.textAlign    = 'center';
        compassCtx.textBaseline = 'bottom';
        compassCtx.fillText(label[1], sx, H - 3);
      }
    }
  }

  // Centre marker — small downward-pointing triangle
  compassCtx.fillStyle = '#ffffff';
  compassCtx.beginPath();
  compassCtx.moveTo(W / 2 - 5, 0);
  compassCtx.lineTo(W / 2 + 5, 0);
  compassCtx.lineTo(W / 2,     6);
  compassCtx.closePath();
  compassCtx.fill();
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

  const W    = minimapCanvas.width;
  const H    = minimapCanvas.height;
  const WORLD = 200;
  const off   = new OffscreenCanvas(W, H);
  const ctx   = off.getContext('2d');

  MINI_ZONES.forEach(({ x, z, w, h, zone }) => {
    ctx.fillStyle = MINI_COLOURS[zone];
    ctx.fillRect(
      ((x + 100) / WORLD) * W,
      ((z + 100) / WORLD) * H,
      (w / WORLD) * W,
      (h / WORLD) * H,
    );
  });

  // Border
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth   = 1;
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

  _minimapBg = off.transferToImageBitmap();
}

function updateMinimap() {
  if (!minimapCtx || !minimapCanvas || !_minimapBg) return;

  const W     = minimapCanvas.width;
  const H     = minimapCanvas.height;
  const WORLD = 200;

  // Composite static background
  minimapCtx.drawImage(_minimapBg, 0, 0);

  // World-space → minimap pixel
  const toM = (wx, wz) => ({
    mx: ((wx + 100) / WORLD) * W,
    mz: ((wz + 100) / WORLD) * H,
  });

  // Remote player dots (colour-coded)
  for (const p of Object.values(remotePlayers)) {
    const { mx, mz } = toM(p.x, p.z);
    minimapCtx.fillStyle = p.colour || '#ffffff';
    minimapCtx.beginPath();
    minimapCtx.arc(mx, mz, 2.5, 0, Math.PI * 2);
    minimapCtx.fill();
  }

  // Local player — white dot with player-colour ring + heading tick
  const { mx: lx, mz: lz } = toM(player.x, player.z);

  minimapCtx.fillStyle   = '#ffffff';
  minimapCtx.strokeStyle = player.colour;
  minimapCtx.lineWidth   = 1.5;
  minimapCtx.beginPath();
  minimapCtx.arc(lx, lz, 3.5, 0, Math.PI * 2);
  minimapCtx.fill();
  minimapCtx.stroke();

  // Heading tick (7 px line in facing direction)
  const bearing = -player.yaw; // world-space bearing (radians, CW from -Z)
  minimapCtx.strokeStyle = '#ffffff';
  minimapCtx.lineWidth   = 1.5;
  minimapCtx.beginPath();
  minimapCtx.moveTo(lx, lz);
  minimapCtx.lineTo(lx + Math.sin(bearing) * 7, lz - Math.cos(bearing) * 7);
  minimapCtx.stroke();
}

// ============================================================
//  POINTER LOCK
// ============================================================
function setupPointerLock() {
  // Clicking the lock overlay captures the mouse
  lockOverlay.addEventListener('click', () => {
    requestPointerLock(gameCanvas);
  });

  // Clicking the canvas itself also works (e.g. after ESC)
  gameCanvas.addEventListener('click', () => {
    if (!isPointerLocked()) requestPointerLock(gameCanvas);
  });

  // Show / hide the lock overlay based on lock state
  document.addEventListener('pointerlockchange', () => {
    if (isPointerLocked()) {
      lockOverlay.classList.add('hidden');
    } else if (!isChatOpen && !isSettingsOpen) {
      lockOverlay.classList.remove('hidden');
    }
  });
}

// ============================================================
//  CHAT
// ============================================================
function setupChat(name, colour) {
  document.addEventListener('keydown', e => {
    const chatKey = (window.WALKWORLD_BINDS || DEFAULT_BINDS).chat;

    if (e.code === chatKey && !isChatOpen && !isSettingsOpen && isPointerLocked()) {
      e.preventDefault();
      openChat();
      return;
    }

    if (e.code === 'Escape') {
      if (isChatOpen)     closeChat();
      if (isSettingsOpen) closeSettings();
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
  // Re-show lock overlay so user can click back in
  lockOverlay.classList.remove('hidden');
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
//  SETTINGS
// ============================================================
function setupSettings() {
  if (!settingsPanel) return;

  // HUD settings button (⚙)
  settingsBtn?.addEventListener('click', () => {
    isSettingsOpen ? closeSettings() : openSettings();
  });

  // Close button inside the panel
  settingsClose?.addEventListener('click', closeSettings);

  // Sensitivity slider
  if (sensSlider) {
    sensSlider.min   = '0.0005';
    sensSlider.max   = '0.005';
    sensSlider.step  = '0.0001';
    sensSlider.value = String(window.WALKWORLD_SENS);
    if (sensValueEl) sensValueEl.textContent = window.WALKWORLD_SENS.toFixed(4);

    sensSlider.addEventListener('input', () => {
      window.WALKWORLD_SENS = parseFloat(sensSlider.value);
      if (sensValueEl) sensValueEl.textContent = parseFloat(sensSlider.value).toFixed(4);
      saveSettings();
    });
  }

  // Key bind buttons — each has data-bind="actionName"
  document.querySelectorAll('[data-bind]').forEach(btn => {
    const action = btn.dataset.bind;
    btn.textContent = prettyCode((window.WALKWORLD_BINDS || {})[action] || action);

    btn.addEventListener('click', () => {
      // Visual feedback while waiting for key press
      const prev = btn.textContent;
      btn.textContent = '…';
      btn.classList.add('binding');

      const capture = e => {
        e.preventDefault();
        e.stopImmediatePropagation();
        window.WALKWORLD_BINDS[action] = e.code;
        btn.textContent = prettyCode(e.code);
        btn.classList.remove('binding');
        saveSettings();
        window.removeEventListener('keydown', capture, true);
      };

      // Cancel if user presses Escape
      const cancel = e => {
        if (e.code !== 'Escape') return;
        btn.textContent = prev;
        btn.classList.remove('binding');
        window.removeEventListener('keydown', capture, true);
        window.removeEventListener('keydown', cancel,  true);
      };

      window.addEventListener('keydown', capture, true);
      window.addEventListener('keydown', cancel,  true);
    });
  });
}

function openSettings() {
  isSettingsOpen = true;
  settingsPanel.classList.remove('hidden');
  if (isPointerLocked()) document.exitPointerLock();

  // Keep slider in sync with current value
  if (sensSlider)   sensSlider.value = String(window.WALKWORLD_SENS);
  if (sensValueEl)  sensValueEl.textContent = window.WALKWORLD_SENS.toFixed(4);
}

function closeSettings() {
  isSettingsOpen = false;
  settingsPanel?.classList.add('hidden');
  // Let the player click back in
  lockOverlay.classList.remove('hidden');
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
