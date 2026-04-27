// ============================================================
//  WalkWorld — network.js
//  Handles all Firebase Realtime Database multiplayer logic:
//    • Player join / leave (with auto-cleanup on disconnect)
//    • Real-time position sync for all players
//    • Live player count
//    • Chat messages (last 40 kept, older auto-deleted)
// ============================================================

import { db, isConfigured } from './firebase-config.js';
import {
  ref,
  set,
  push,
  remove,
  update,
  onValue,
  onDisconnect,
  serverTimestamp,
  query,
  limitToLast,
  off,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// ── Internal state ──────────────────────────────────────────
let _playerId    = null;   // This player's unique Firebase key
let _playerRef   = null;   // Ref to /players/{id}
let _unsubscribers = [];   // Functions to call on cleanup

// ── Firebase DB paths ───────────────────────────────────────
const PATHS = {
  players : () => ref(db, 'players'),
  player  : (id) => ref(db, `players/${id}`),
  chat    : () => ref(db, 'chat'),
};

// ============================================================
//  JOIN — call this when the player enters the game
//  playerData: { name, colour, x, y }
//  Returns the generated playerId string
// ============================================================
export async function joinGame(playerData) {
  if (!isConfigured) {
    console.warn('[Network] Firebase not configured — running in offline mode.');
    return 'offline-' + Math.random().toString(36).slice(2);
  }

  // Push a new slot under /players/
  _playerRef = push(PATHS.players());
  _playerId  = _playerRef.key;

  const data = {
    name:      playerData.name,
    colour:    playerData.colour,
    x:         playerData.x,
    y:         playerData.y,
    joinedAt:  serverTimestamp(),
  };

  // Write initial data
  await set(_playerRef, data);

  // ── Auto-remove this player when they disconnect ──
  onDisconnect(_playerRef).remove();

  // ── Announce join in chat ──
  _pushSystemChat(`${playerData.name} joined the world`);

  return _playerId;
}

// ============================================================
//  LEAVE — call this on page unload / manual quit
// ============================================================
export async function leaveGame(playerName) {
  if (!_playerRef) return;

  // Remove disconnect handler so it doesn't fire twice
  onDisconnect(_playerRef).cancel();

  // Announce leave
  _pushSystemChat(`${playerName} left the world`);

  // Remove player record
  await remove(_playerRef);

  // Clean up listeners
  _unsubscribers.forEach(fn => fn());
  _unsubscribers = [];

  _playerRef = null;
  _playerId  = null;
}

// ============================================================
//  UPDATE POSITION — throttled by game loop; call every frame
// ============================================================
export function updatePosition(x, y) {
  if (!_playerRef || !isConfigured) return;
  update(_playerRef, { x: Math.round(x), y: Math.round(y) });
}

// ============================================================
//  SUBSCRIBE TO PLAYERS
//  callback(playersMap) where playersMap = { id: {name,colour,x,y}, ... }
//  Returns an unsubscribe function
// ============================================================
export function onPlayersUpdate(callback) {
  if (!isConfigured) {
    callback({});
    return () => {};
  }

  const playersRef = PATHS.players();

  const unsub = onValue(playersRef, snapshot => {
    const raw  = snapshot.val() || {};

    // Exclude this client's own player — the local game loop draws it directly
    const others = {};
    for (const [id, data] of Object.entries(raw)) {
      if (id !== _playerId) others[id] = data;
    }

    callback(others);
  });

  const unsubFn = () => off(playersRef, 'value', unsub);
  _unsubscribers.push(unsubFn);
  return unsubFn;
}

// ============================================================
//  GET PLAYER COUNT (live)
//  callback(count: number) — fires every time someone joins/leaves
//  Returns an unsubscribe function
// ============================================================
export function getPlayerCount(callback) {
  if (!isConfigured) {
    callback(0);
    return () => {};
  }

  const playersRef = PATHS.players();

  const unsub = onValue(playersRef, snapshot => {
    const count = snapshot.exists() ? Object.keys(snapshot.val()).length : 0;
    callback(count);
  });

  const unsubFn = () => off(playersRef, 'value', unsub);
  _unsubscribers.push(unsubFn);
  return unsubFn;
}

// ============================================================
//  SEND CHAT MESSAGE
//  msg: { name, colour, text }
// ============================================================
export function sendChat(msg) {
  if (!isConfigured) return;
  if (!msg.text || !msg.text.trim()) return;

  const chatRef = PATHS.chat();
  const newMsg  = push(chatRef);

  set(newMsg, {
    name:   msg.name,
    colour: msg.colour,
    text:   msg.text.trim().slice(0, 80), // hard cap at 80 chars
    time:   serverTimestamp(),
    system: false,
  });

  // Prune old messages — keep only the latest 40
  _pruneChat(40);
}

// ============================================================
//  SUBSCRIBE TO CHAT (last 40 messages)
//  callback(messages[]) where each msg = { name, colour, text, system }
//  Returns an unsubscribe function
// ============================================================
export function onChat(callback) {
  if (!isConfigured) {
    callback([]);
    return () => {};
  }

  const chatQuery = query(PATHS.chat(), limitToLast(40));

  const unsub = onValue(chatQuery, snapshot => {
    const raw  = snapshot.val() || {};
    const msgs = Object.values(raw).map(m => ({
      name:   m.name   || '',
      colour: m.colour || '#ffffff',
      text:   m.text   || '',
      system: m.system || false,
    }));
    callback(msgs);
  });

  const unsubFn = () => off(chatQuery, 'value', unsub);
  _unsubscribers.push(unsubFn);
  return unsubFn;
}

// ============================================================
//  INTERNAL HELPERS
// ============================================================

// Push a system/announcement message (join, leave)
function _pushSystemChat(text) {
  if (!isConfigured) return;
  const chatRef = PATHS.chat();
  const newMsg  = push(chatRef);
  set(newMsg, {
    name:   '',
    colour: '#6868a8',
    text,
    time:   serverTimestamp(),
    system: true,
  });
  _pruneChat(40);
}

// Delete messages beyond the `keep` limit
async function _pruneChat(keep) {
  if (!isConfigured) return;
  // Read all chat keys then delete oldest
  onValue(PATHS.chat(), snapshot => {
    if (!snapshot.exists()) return;
    const keys = Object.keys(snapshot.val());
    if (keys.length > keep) {
      const toDelete = keys.slice(0, keys.length - keep);
      toDelete.forEach(k => remove(ref(db, `chat/${k}`)));
    }
  }, { onlyOnce: true });
}

