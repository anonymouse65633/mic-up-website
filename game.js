// ============================================================
//  WalkWorld — game.js
//  Entry point for the game page.
//  Orchestrates: init → load → game loop → HUD → chat → cleanup
// ============================================================

import { Player }        from './player.js';
import { Renderer }      from './renderer.js';
import {
  joinGame,
  leaveGame,
  updatePosition,
  onPlayersUpdate,
  getPlayerCount,
  sendChat,
  onChat,
}                        from './network.js';

// ── DOM refs ─────────────────────────────────────────────────
const loadingOverlay     = document.getElementById('loadingOverlay');
const loadBar            = document.getElementById('loadBar');
const loadStatus         = document.getElementById('loadStatus');
const disconnectedOverlay= document.getElementById('disconnectedOverlay');
const gameWrapper        = document.getElementById('gameWrapper');
const gameCanvas         = document.getElementById('gameCanvas');
const minimapCanvas      = document.getElementById('minimap');

const hudAvatar          = document.getElementById('hudAvatar');
const hudName            = document.getElementById('hudName');
const hudPos             = document.getElementById('hudPos');
const hudCount           = document.getElementById('hudCount');

const chatMessages       = document.getElementById('chatMessages');
const chatForm           = document.getElementById('chatForm');
const chatInput          = document.getElementById('chatInput');

// ── Runtime state ─────────────────────────────────────────────
let player       = null;
let renderer     = null;
let remotePlayers = {};   // { id: { name, colour, x, y } }
let lastTime     = 0;
let rafId        = null;
let isChatOpen   = false;

// Throttle position updates to ~10 Hz (every 100 ms)
let _lastPosSend = 0;
const POS_SEND_INTERVAL = 100;

// ── Boot ──────────────────────────────────────────────────────
async function init() {
  // 1. Read player identity from sessionStorage (set on login page)
  const name   = sessionStorage.getItem('playerName');
  const colour = sessionStorage.getItem('playerColour');

  if (!name) {
    // Redirect back to lobby if they landed here directly
    window.location.href = 'index.html';
    return;
  }

  // 2. Show load progress
  setLoad(10, 'Building world…');
  await tick(); // yield so browser paints

  // 3. Create player + renderer (world is already built by world.js import)
  player   = new Player(name, colour);
  renderer = new Renderer(gameCanvas, minimapCanvas);

  setLoad(30, 'Spawning player…');
  await tick();

  // 4. Set up HUD avatar + name
  hudAvatar.style.background = colour;
  hudName.textContent        = name;

  setLoad(50, 'Connecting to server…');
  await tick();

  // 5. Join Firebase multiplayer
  let playerId = null;
  try {
    playerId = await joinGame({ name, colour, x: player.x, y: player.y });
  } catch (err) {
    console.error('[Game] joinGame failed:', err);
    showDisconnected();
    return;
  }

  setLoad(70, 'Syncing players…');
  await tick();

  // 6. Subscribe to remote players
  onPlayersUpdate(players => {
    remotePlayers = players;
    hudCount.textContent = Object.keys(players).length + 1; // +1 = self
  });

  // 7. Subscribe to live player count (also counts self)
  getPlayerCount(n => { hudCount.textContent = n; });

  setLoad(85, 'Loading chat…');
  await tick();

  // 8. Subscribe to chat
  onChat(messages => renderChat(messages));

  // 9. Wire up chat UI
  setupChat(name, colour);

  setLoad(100, 'Ready!');
  await delay(300);

  // 10. Show game, hide loader
  loadingOverlay.classList.add('hidden');
  gameWrapper.classList.remove('hidden');
  gameCanvas.focus();

  // 11. Start game loop
  lastTime = performance.now();
  rafId    = requestAnimationFrame(gameLoop);

  // 12. Cleanup on page leave
  window.addEventListener('beforeunload', () => {
    leaveGame(name);
    if (rafId) cancelAnimationFrame(rafId);
  });

  // Also handle mobile back / tab switch
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
  const dt = Math.min((timestamp - lastTime) / 1000, 0.1); // cap at 100ms
  lastTime = timestamp;

  // Move local player
  player.update(dt);

  // Send position to Firebase (throttled)
  if (timestamp - _lastPosSend > POS_SEND_INTERVAL) {
    updatePosition(player.x, player.y);
    _lastPosSend = timestamp;
  }

  // Update HUD position
  const tx = Math.floor(player.x / 32);
  const ty = Math.floor(player.y / 32);
  hudPos.textContent = `x:${tx} y:${ty}`;

  // Draw everything
  renderer.draw(player, remotePlayers, timestamp);

  rafId = requestAnimationFrame(gameLoop);
}

// ── Chat ──────────────────────────────────────────────────────
function setupChat(name, colour) {
  // T → open chat
  document.addEventListener('keydown', e => {
    if (e.code === 'KeyT' && !isChatOpen) {
      e.preventDefault();
      openChat();
    }
    if (e.code === 'Escape' && isChatOpen) {
      closeChat();
    }
  });

  // Submit chat form
  chatForm.addEventListener('submit', e => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;
    sendChat({ name, colour, text });
    // Show local bubble immediately (before Firebase round-trip)
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
  gameCanvas.focus();
}

// Render chat message list from Firebase snapshot
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

    // For live chat bubbles: remote players
    if (!m.system && m.name) {
      // Find the matching remote player by name and add bubble
      for (const [id, p] of Object.entries(remotePlayers)) {
        if (p.name === m.name) {
          renderer.addBubble(id, m.text);
          break;
        }
      }
    }

    chatMessages.appendChild(div);
  });
  // Auto-scroll to bottom
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ── Loading helpers ───────────────────────────────────────────
function setLoad(pct, msg) {
  loadBar.style.width    = pct + '%';
  loadStatus.textContent = msg;
}

function showDisconnected() {
  loadingOverlay.classList.add('hidden');
  disconnectedOverlay.classList.remove('hidden');
}

// ── Tiny helpers ──────────────────────────────────────────────
const tick  = () => new Promise(r => requestAnimationFrame(r));
const delay = ms => new Promise(r => setTimeout(r, ms));

// ── Start ─────────────────────────────────────────────────────
init().catch(err => {
  console.error('[Game] Fatal init error:', err);
  showDisconnected();
});
