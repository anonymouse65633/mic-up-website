// ============================================================
//  WalkWorld 3D — game.js
//  Main entry point: init → load → game-loop → HUD → cleanup
//
//  Fixed from original:
//    • Removed dead minimapCanvas reference (renderer creates its own)
//    • initWorld() + initObjects() now called during load
//    • updatePosition now passes x, y, z, rotationY
//    • player.update() only runs when pointer-locked + not in UI
//    • Pointer-lock overlay fully wired
//    • HUD shows real 3D coordinates + live zone name
//    • Compass direction text updates every frame
//
//  New:
//    • Settings panel — sensitivity slider + key-bind display
//      (ESC toggles when chat is closed and mouse is unlocked)
//    • window.WALKWORLD_SENS — read by player.js for sensitivity
// ============================================================

import { Player, requestPointerLock, isPointerLocked } from './player.js';
import { Renderer }      from './renderer.js';
import { initWorld, getZoneName } from './world.js';
import { initObjects }   from './objects.js';
import {
  joinGame,
  leaveGame,
  updatePosition,
  onPlayersUpdate,
  getPlayerCount,
  sendChat,
  onChat,
} from './network.js';

// ── DOM refs ──────────────────────────────────────────────────
const loadingOverlay      = document.getElementById('loadingOverlay');
const loadBar             = document.getElementById('loadBar');
const loadStatus          = document.getElementById('loadStatus');
const disconnectedOverlay = document.getElementById('disconnectedOverlay');
const lockOverlay         = document.getElementById('lockOverlay');
const gameWrapper         = document.getElementById('gameWrapper');
const gameCanvas          = document.getElementById('gameCanvas');

const hudAvatar   = document.getElementById('hudAvatar');
const hudName     = document.getElementById('hudName');
const hudPos      = document.getElementById('hudPos');
const hudZone     = document.getElementById('hudZone');
const hudCount    = document.getElementById('hudCount');

const chatMessages = document.getElementById('chatMessages');
const chatForm     = document.getElementById('chatForm');
const chatInput    = document.getElementById('chatInput');

// Settings + compass elements (added in game.html — guarded with ?. below)
// #settingsPanel, #settingsClose, #settingsSens, #settingsSensVal
// #codCompass (the CoD horizontal compass canvas at top centre)
// #compassDir (the old circular compass direction label — still updated)

// ── Runtime state ─────────────────────────────────────────────
let player        = null;
let renderer      = null;
let remotePlayers = {};
let lastTime      = 0;
let rafId         = null;
let isChatOpen    = false;
let isSettingsOpen = false;

// Throttle Firebase position updates to ~10 Hz
let _lastPosSend      = 0;
const POS_SEND_INTERVAL = 100;

// ── Settings (persisted in localStorage) ─────────────────────
const SENS_MIN     = 0.0008;
const SENS_MAX     = 0.006;
const SENS_DEFAULT = 0.0022;

const settings = {
  sensitivity: SENS_DEFAULT,
  // Key binds shown in settings panel — read by player.js via
  // window.WALKWORLD_BINDS after we update player.js.
  binds: {
    forward : 'KeyW',
    back    : 'KeyS',
    left    : 'KeyA',
    right   : 'KeyD',
    jump    : 'Space',
    sprint  : 'ShiftLeft',
    chat    : 'KeyT',
  },
};

(function _loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('walkworld_settings') || '{}');
    if (typeof s.sensitivity === 'number') settings.sensitivity = s.sensitivity;
    if (s.binds) Object.assign(settings.binds, s.binds);
  } catch (_) {}
})();

// Expose globally so player.js can pick them up
window.WALKWORLD_SENS  = settings.sensitivity;
window.WALKWORLD_BINDS = settings.binds;

function _saveSettings() {
  try { localStorage.setItem('walkworld_settings', JSON.stringify(settings)); } catch (_) {}
  window.WALKWORLD_SENS  = settings.sensitivity;
  window.WALKWORLD_BINDS = settings.binds;
}

// ── Compass helpers ───────────────────────────────────────────
const DIR_LABELS = ['N','NE','E','SE','S','SW','W','NW'];

/** Convert camera yaw (radians) to a compass bearing string. */
function yawToDir(yaw) {
  // yaw=0 → looking down -Z = North.  yaw increases clockwise.
  // Normalise to [0, 2π)
  let a = ((-yaw) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
  const idx = Math.round(a / (Math.PI / 4)) % 8;
  return DIR_LABELS[idx];
}

/** Update the CoD-style horizontal compass canvas at top-centre.
 *  The canvas (#codCompass) is drawn in game.html; we just paint it.
 */
function updateCodCompass(yaw) {
  const canvas = document.getElementById('codCompass');
  if (!canvas) return;

  const ctx  = canvas.getContext('2d');
  const W    = canvas.width;
  const H    = canvas.height;

  ctx.clearRect(0, 0, W, H);

  // Background bar
  ctx.fillStyle = 'rgba(13,13,26,0.72)';
  ctx.fillRect(0, 0, W, H);

  // The compass shows a 180° window of bearings.
  // bearing 0 = North, increases clockwise.
  // yaw = 0 → North.  Positive yaw = left turn = bearing decreases.
  const bearing = ((-yaw) * 180 / Math.PI + 360) % 360;

  // Tick marks every 5° across the window
  const degsPerPx = 180 / W;   // how many degrees fit in the strip
  const centreX   = W / 2;

  ctx.font      = '9px "Press Start 2P", monospace';
  ctx.textAlign = 'center';

  for (let deg = bearing - 90; deg <= bearing + 90; deg += 5) {
    const d  = ((deg % 360) + 360) % 360;
    const px = centreX + (d - bearing) / degsPerPx;

    const isMajor = d % 45 === 0;
    const isMinor = d % 15 === 0;

    // Tick
    ctx.strokeStyle = isMajor ? '#00f5c4' : 'rgba(255,255,255,0.35)';
    ctx.lineWidth   = isMajor ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(px, isMajor ? 2 : 8);
    ctx.lineTo(px, H - 2);
    ctx.stroke();

    // Cardinal / intercardinal labels
    if (isMajor) {
      const label = DIR_LABELS[Math.round(d / 45) % 8];
      ctx.fillStyle = label === 'N' ? '#00f5c4' : '#ffffff';
      ctx.fillText(label, px, H - 14);
    }
  }

  // Centre marker
  ctx.strokeStyle = '#00f5c4';
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.moveTo(centreX, 0);
  ctx.lineTo(centreX, H);
  ctx.stroke();

  // Small triangle pointer at bottom-centre
  ctx.fillStyle = '#00f5c4';
  ctx.beginPath();
  ctx.moveTo(centreX,     H);
  ctx.moveTo(centreX - 5, H - 8);
  ctx.lineTo(centreX,     H - 2);
  ctx.lineTo(centreX + 5, H - 8);
  ctx.closePath();
  ctx.fill();
}

// ── Settings panel ────────────────────────────────────────────
function setupSettings() {
  const panel    = document.getElementById('settingsPanel');
  const closeBtn = document.getElementById('settingsClose');
  const slider   = document.getElementById('settingsSens');
  const valLabel = document.getElementById('settingsSensVal');

  if (!panel) return; // game.html hasn't been updated yet

  // Populate sensitivity slider
  if (slider) {
    slider.min   = 0;
    slider.max   = 100;
    slider.value = Math.round(
      ((settings.sensitivity - SENS_MIN) / (SENS_MAX - SENS_MIN)) * 100
    );
    if (valLabel) valLabel.textContent = Math.round(slider.value);

    slider.addEventListener('input', () => {
      const pct = slider.value / 100;
      settings.sensitivity = SENS_MIN + pct * (SENS_MAX - SENS_MIN);
      if (valLabel) valLabel.textContent = Math.round(slider.value);
      _saveSettings();
    });
  }

  // Populate bind display
  const bindEls = document.querySelectorAll('[data-bind]');
  bindEls.forEach(el => {
    const action = el.dataset.bind;
    if (settings.binds[action]) {
      el.textContent = settings.binds[action].replace('Key','').replace('Arrow','↑↓←→'.split('')[['Up','Down','Left','Right'].indexOf(settings.binds[action].replace('Arrow',''))]) || settings.binds[action];
    }
  });

  // Close button
  if (closeBtn) {
    closeBtn.addEventListener('click', closeSettings);
  }

  // Gear button in HUD (if present)
  const gearBtn = document.getElementById('settingsBtn');
  if (gearBtn) gearBtn.addEventListener('click', openSettings);
}

function openSettings() {
  isSettingsOpen = true;
  document.getElementById('settingsPanel')?.classList.remove('hidden');
  // Release pointer lock so cursor is free
  if (isPointerLocked()) document.exitPointerLock();
}

function closeSettings() {
  isSettingsOpen = false;
  document.getElementById('settingsPanel')?.classList.add('hidden');
}

// ── Pointer-lock management ───────────────────────────────────
function setupPointerLock() {
  // lockOverlay click → request lock
  lockOverlay?.addEventListener('click', () => {
    if (!isChatOpen && !isSettingsOpen) {
      requestPointerLock(gameCanvas);
    }
  });

  // Canvas click → request lock (if overlay is gone)
  gameCanvas.addEventListener('click', () => {
    if (!isChatOpen && !isSettingsOpen && !isPointerLocked()) {
      requestPointerLock(gameCanvas);
    }
  });

  // Lock gained → hide overlay
  document.addEventListener('pointerlockchange', () => {
    if (isPointerLocked()) {
      lockOverlay?.classList.add('hidden');
    } else {
      // Don't show lock overlay if chat or settings is open
      if (!isChatOpen && !isSettingsOpen) {
        lockOverlay?.classList.remove('hidden');
      }
    }
  });
}

// ── Boot ──────────────────────────────────────────────────────
async function init() {
  const name   = sessionStorage.getItem('playerName');
  const colour = sessionStorage.getItem('playerColour');

  if (!name) { window.location.href = 'index.html'; return; }

  setLoad(10, 'Building world…');
  await tick();

  // Build 3D world (terrain, lighting, water, horizon)
  initWorld();

  setLoad(22, 'Placing objects…');
  await tick();

  // Populate scene with trees, rocks, flowers, cabin, etc.
  initObjects();

  setLoad(38, 'Spawning player…');
  await tick();

  player   = new Player(name, colour);
  renderer = new Renderer(gameCanvas);   // minimap arg not needed — renderer creates its own

  setLoad(52, 'Setting up controls…');
  await tick();

  // HUD
  hudAvatar.style.background = colour;
  hudName.textContent        = name;

  setLoad(62, 'Connecting to server…');
  await tick();

  // Firebase
  try {
    await joinGame({
      name, colour,
      x: player.x, y: player.y, z: player.z,
      rotationY: player.rotationY,
    });
  } catch (err) {
    console.error('[Game] joinGame failed:', err);
    showDisconnected();
    return;
  }

  setLoad(76, 'Syncing players…');
  await tick();

  onPlayersUpdate(players => { remotePlayers = players; });
  getPlayerCount(n => { hudCount.textContent = n; });

  setLoad(88, 'Loading chat…');
  await tick();

  onChat(msgs => renderChat(msgs));
  setupChat(name, colour);
  setupPointerLock();
  setupSettings();

  setLoad(100, 'Ready!');
  await delay(300);

  // Show game
  loadingOverlay.classList.add('hidden');
  gameWrapper.classList.remove('hidden');
  lockOverlay?.classList.remove('hidden');   // prompt click-to-play

  lastTime = performance.now();
  rafId    = requestAnimationFrame(gameLoop);

  window.addEventListener('beforeunload', () => {
    leaveGame(name);
    if (rafId) cancelAnimationFrame(rafId);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    } else {
      lastTime = performance.now();
      rafId = requestAnimationFrame(gameLoop);
    }
  });
}

// ── Game Loop ─────────────────────────────────────────────────
function gameLoop(timestamp) {
  const dt = Math.min((timestamp - lastTime) / 1000, 0.1);
  lastTime = timestamp;

  // Only update movement when pointer is captured and no UI is open
  if (isPointerLocked() && !isChatOpen && !isSettingsOpen) {
    player.update(dt);
  }

  // Throttled Firebase position sync (x, y, z, rotationY)
  if (timestamp - _lastPosSend > POS_SEND_INTERVAL) {
    updatePosition(player.x, player.y, player.z, player.rotationY);
    _lastPosSend = timestamp;
  }

  // ── HUD updates ───────────────────────────────────────────
  hudPos.textContent = `${Math.round(player.x)}, ${Math.round(player.y)}, ${Math.round(player.z)}`;

  const zone = getZoneName(player.x, player.z);
  if (hudZone) hudZone.textContent = zone;

  // Classic circular compass (bottom-left)
  const dirLabel = document.getElementById('compassDir');
  if (dirLabel) dirLabel.textContent = yawToDir(player.yaw);

  // CoD-style horizontal compass (top-centre — drawn when element exists)
  updateCodCompass(player.yaw);

  // ── Render ────────────────────────────────────────────────
  renderer.draw(player, remotePlayers, timestamp);

  rafId = requestAnimationFrame(gameLoop);
}

// ── Chat ──────────────────────────────────────────────────────
function setupChat(name, colour) {
  document.addEventListener('keydown', e => {
    // T → open chat (only when pointer is locked and settings closed)
    if (e.code === 'KeyT' && !isChatOpen && !isSettingsOpen && isPointerLocked()) {
      e.preventDefault();
      openChat();
      return;
    }
    // ESC — priority: close chat, then close settings
    if (e.code === 'Escape') {
      if (isChatOpen)    { closeChat(); return; }
      if (isSettingsOpen){ closeSettings(); return; }
      // Otherwise ESC releases pointer lock (browser default)
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
}

function closeChat() {
  isChatOpen = false;
  chatInput.disabled = true;
  chatInput.blur();
  // Re-request pointer lock after chat closes
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

    // Bubble on remote player's character
    if (!m.system && m.name) {
      for (const [id, p] of Object.entries(remotePlayers)) {
        if (p.name === m.name) { renderer.addBubble(id, m.text); break; }
      }
    }

    chatMessages.appendChild(div);
  });
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ── Helpers ───────────────────────────────────────────────────
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

// ── Start ─────────────────────────────────────────────────────
init().catch(err => {
  console.error('[Game] Fatal init error:', err);
  showDisconnected();
});
