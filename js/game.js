// ============================================================
//  WalkWorld 3D — game.js
// ============================================================

import { Player, camera, requestPointerLock, isPointerLocked }
                          from './player.js';
import { initWorld, scene, getZoneName }
                          from './world.js';
import { initObjects }    from './objects.js';
import {
  joinGame, leaveGame, updatePosition,
  onPlayersUpdate, getPlayerCount, sendChat, onChat,
}                         from './network.js';

const loadingOverlay      = document.getElementById('loadingOverlay');
const loadBar             = document.getElementById('loadBar');
const loadStatus          = document.getElementById('loadStatus');
const disconnectedOverlay = document.getElementById('disconnectedOverlay');
const lockOverlay         = document.getElementById('lockOverlay');
const gameWrapper         = document.getElementById('gameWrapper');
const gameCanvas          = document.getElementById('gameCanvas');
const hudAvatar           = document.getElementById('hudAvatar');
const hudName             = document.getElementById('hudName');
const hudPos              = document.getElementById('hudPos');
const hudZone             = document.getElementById('hudZone');
const hudCount            = document.getElementById('hudCount');
const compass             = document.getElementById('compass');
const compassDir          = document.getElementById('compassDir');
const chatMessages        = document.getElementById('chatMessages');
const chatForm            = document.getElementById('chatForm');
const chatInput           = document.getElementById('chatInput');

let player        = null;
let renderer3d    = null;
let remotePlayers = {};
let remoteMeshes  = {};
let lastTime      = 0;
let rafId         = null;
let isChatOpen    = false;
let _lastPosSend  = 0;
const POS_INTERVAL = 100;

const DIRS = ['N','NE','E','SE','S','SW','W','NW'];

function _getCompassDir(yaw) {
  const bearing = ((-yaw) % (Math.PI*2) + Math.PI*2) % (Math.PI*2);
  return DIRS[Math.round(bearing / (Math.PI/4)) % 8];
}

function _createAvatar(colour) {
  const group = new THREE.Group();
  const mat   = new THREE.MeshLambertMaterial({ color: new THREE.Color(colour) });
  const body  = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 1.4, 8), mat);
  body.position.y = 0.7;
  group.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 8), mat);
  head.position.y = 1.72;
  group.add(head);
  const outline = new THREE.Mesh(
    new THREE.SphereGeometry(0.35, 8, 8),
    new THREE.MeshLambertMaterial({ color: 0x000000, side: THREE.BackSide })
  );
  outline.position.y = 1.72;
  group.add(outline);
  return group;
}

function _syncRemotePlayers(players) {
  for (const [id, data] of Object.entries(players)) {
    if (!remoteMeshes[id]) {
      const grp = _createAvatar(data.colour);
      scene.add(grp);
      remoteMeshes[id] = grp;
    }
    remoteMeshes[id].position.set(data.x, data.y, data.z);
    remoteMeshes[id].rotation.y = data.rotationY;
  }
  for (const id of Object.keys(remoteMeshes)) {
    if (!players[id]) { scene.remove(remoteMeshes[id]); delete remoteMeshes[id]; }
  }
}

async function init() {
  const name   = sessionStorage.getItem('playerName');
  const colour = sessionStorage.getItem('playerColour');
  if (!name) { window.location.href = 'index.html'; return; }

  setLoad(5,  'Building world…');  await tick(); initWorld();
  setLoad(25, 'Placing objects…'); await tick(); initObjects();
  setLoad(40, 'Starting renderer…'); await tick();

  renderer3d = new THREE.WebGLRenderer({ canvas: gameCanvas, antialias: true });
  renderer3d.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer3d.setSize(window.innerWidth, window.innerHeight);
  renderer3d.outputEncoding = THREE.sRGBEncoding;
  window.addEventListener('resize', () => renderer3d.setSize(window.innerWidth, window.innerHeight));

  setLoad(50, 'Spawning player…'); await tick();
  player = new Player(name, colour);
  hudAvatar.style.background = colour;
  hudName.textContent        = name;

  setLoad(60, 'Connecting to server…'); await tick();
  try {
    await joinGame({ name, colour, x: player.x, y: player.y, z: player.z, rotationY: player.rotationY });
  } catch (err) {
    console.error('[Game] joinGame failed:', err);
    showDisconnected(); return;
  }

  setLoad(72, 'Syncing players…'); await tick();
  onPlayersUpdate(players => { remotePlayers = players; _syncRemotePlayers(players); });
  getPlayerCount(n => { hudCount.textContent = n; });

  setLoad(85, 'Loading chat…'); await tick();
  onChat(messages => _renderChat(messages));
  _setupChat(name, colour);
  _setupPointerLock();

  setLoad(100, 'Ready!'); await delay(280);
  loadingOverlay.classList.add('hidden');
  gameWrapper.classList.remove('hidden');
  lockOverlay.classList.remove('hidden');

  lastTime = performance.now();
  rafId    = requestAnimationFrame(gameLoop);
  window.addEventListener('beforeunload', _cleanup);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } }
    else { lastTime = performance.now(); rafId = requestAnimationFrame(gameLoop); }
  });
}

function _setupPointerLock() {
  lockOverlay.addEventListener('click', () => requestPointerLock(gameCanvas));
  gameCanvas.addEventListener('click', () => {
    if (!isPointerLocked() && !isChatOpen) requestPointerLock(gameCanvas);
  });
  document.addEventListener('pointerlockchange', () => {
    if (isPointerLocked()) lockOverlay.classList.add('hidden');
    else if (!isChatOpen)  lockOverlay.classList.remove('hidden');
  });
}

function gameLoop(timestamp) {
  const dt = Math.min((timestamp - lastTime) / 1000, 0.1);
  lastTime = timestamp;

  player.update(dt);

  if (timestamp - _lastPosSend > POS_INTERVAL) {
    updatePosition(player.x, player.y, player.z, player.rotationY);
    _lastPosSend = timestamp;
  }

  hudPos.textContent  = `${player.x.toFixed(1)}, ${player.y.toFixed(1)}, ${player.z.toFixed(1)}`;
  hudZone.textContent = getZoneName(player.x, player.z);

  compass.style.transform    = `rotate(${player.yaw}rad)`;
  compassDir.textContent     = _getCompassDir(player.yaw);
  compassDir.style.transform = `rotate(${-player.yaw}rad)`;

  renderer3d.render(scene, camera);
  rafId = requestAnimationFrame(gameLoop);
}

function _setupChat(name, colour) {
  document.addEventListener('keydown', e => {
    if (e.code === 'KeyT' && !isChatOpen) { e.preventDefault(); _openChat(); }
    if (e.code === 'Escape' && isChatOpen) { e.preventDefault(); _closeChat(); }
  });
  chatForm.addEventListener('submit', e => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) { _closeChat(); return; }
    sendChat({ name, colour, text });
    chatInput.value = '';
    _closeChat();
  });
}

function _openChat() {
  isChatOpen = true;
  if (isPointerLocked()) document.exitPointerLock();
  chatInput.disabled = false;
  chatInput.focus();
  lockOverlay.classList.add('hidden');
}

function _closeChat() {
  isChatOpen = false;
  chatInput.disabled = true;
  chatInput.blur();
  lockOverlay.classList.remove('hidden');
}

function _renderChat(messages) {
  chatMessages.innerHTML = '';
  messages.forEach(m => {
    const div = document.createElement('div');
    div.className = 'chat-msg' + (m.system ? ' sys-msg' : '');
    if (m.name && !m.system) {
      const ns = document.createElement('span');
      ns.className = 'msg-name'; ns.style.color = m.colour || '#fff';
      ns.textContent = m.name + ':';
      div.appendChild(ns);
    }
    const ts = document.createElement('span');
    ts.className = 'msg-text'; ts.textContent = ' ' + m.text;
    div.appendChild(ts);
    chatMessages.appendChild(div);
  });
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function setLoad(pct, msg) { loadBar.style.width = pct + '%'; loadStatus.textContent = msg; }
function showDisconnected() { loadingOverlay.classList.add('hidden'); disconnectedOverlay.classList.remove('hidden'); }
function _cleanup() { if (player) leaveGame(player.name); if (rafId) cancelAnimationFrame(rafId); }
const tick  = () => new Promise(r => requestAnimationFrame(r));
const delay = ms  => new Promise(r => setTimeout(r, ms));

init().catch(err => { console.error('[Game] Fatal init error:', err); showDisconnected(); });
