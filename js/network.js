// ============================================================
//  WalkWorld 3D — network.js  (Part 8)
//
//  • 3-layer username moderation
//  • Shaft cheat prevention (max depth delta validation)
//  • Player presence via onDisconnect
//  • Join/leave debounce (3s join grace, 5s leave grace)
//  • Report player system
// ============================================================

import { db, isConfigured } from './firebase-config.js';
import {
  ref, set, push, remove, update, onValue,
  onDisconnect, serverTimestamp, query, limitToLast, off,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// ─────────────────────────────────────────────────────────────
//  CONTENT MODERATION — Layer 2: client-side filter
//  (Layer 1 = Firebase Security Rules, Layer 3 = report button)
// ─────────────────────────────────────────────────────────────
const _BLOCK_LIST = [
  // common slurs and hate speech patterns (lowercase)
  'nigger','nigga','faggot','fag','kike','spic','chink','gook','cunt',
  'retard','tranny','dyke','wetback','cracker',
  // common offensive terms
  'fuck','shit','asshole','bitch','bastard','cock','dick','pussy',
  // add more as needed
];

const _BLOCK_RE = new RegExp(
  _BLOCK_LIST.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
  'i'
);

export function filterUsername(name) {
  if (!name || typeof name !== 'string') return 'Player';
  const clean = name.trim().slice(0, 20);
  if (_BLOCK_RE.test(clean)) return 'Player';
  return clean || 'Player';
}

// ─────────────────────────────────────────────────────────────
//  SHAFT CHEAT PREVENTION
// ─────────────────────────────────────────────────────────────
const MAX_DEPTH_JUMP = 8; // max metres per validated update
let _lastValidatedDepth = 0;

export function validateDepthUpdate(newDepth) {
  const delta = Math.abs(newDepth - _lastValidatedDepth);
  if (delta > MAX_DEPTH_JUMP && _lastValidatedDepth > 0) {
    console.warn(`[Network] Suspicious depth jump: ${_lastValidatedDepth}→${newDepth}m (delta ${delta.toFixed(1)}m). Clamping.`);
    return false;
  }
  _lastValidatedDepth = newDepth;
  return true;
}

// ─────────────────────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────────────────────
let _playerId      = null;
let _playerRef     = null;
let _unsubscribers = [];
let _joinedAt      = 0;
let _leftAt        = 0;

const JOIN_GRACE  = 3_000;   // ms: must be present 3s before announcing join
const LEAVE_GRACE = 5_000;   // ms: must be gone 5s before announcing leave

const PATHS = {
  players: ()   => ref(db, 'players'),
  player:  (id) => ref(db, `players/${id}`),
  chat:    ()   => ref(db, 'chat'),
  reports: (id) => ref(db, `reports/${id}`),
};

// ─────────────────────────────────────────────────────────────
//  JOIN / LEAVE
// ─────────────────────────────────────────────────────────────
export async function joinGame(playerData) {
  if (!isConfigured) {
    console.warn('[Network] Firebase not configured — offline mode.');
    return 'offline-' + Math.random().toString(36).slice(2);
  }

  _playerRef = push(PATHS.players());
  _playerId  = _playerRef.key;
  _joinedAt  = Date.now();
  _lastValidatedDepth = 0;

  await set(_playerRef, {
    name:      filterUsername(playerData.name),
    colour:    playerData.colour,
    x:         playerData.x         ?? 0,
    y:         playerData.y         ?? 0,
    z:         playerData.z         ?? 0,
    rotationY: playerData.rotationY ?? 0,
    joinedAt:  serverTimestamp(),
    online:    true,
  });

  // Presence: mark offline on disconnect (more reliable than remove for presence)
  onDisconnect(_playerRef).update({ online: false });

  // Announce join only if absent > 5s (covers page refreshes)
  if (Date.now() - _leftAt > LEAVE_GRACE) {
    setTimeout(() => {
      // Double-check still connected after 3s grace
      if (_playerRef && Date.now() - _joinedAt >= JOIN_GRACE) {
        _pushSystemChat(`${filterUsername(playerData.name)} joined the world`, 'join');
      }
    }, JOIN_GRACE);
  }

  return _playerId;
}

export async function leaveGame(playerName) {
  if (!_playerRef) return;
  _leftAt = Date.now();
  onDisconnect(_playerRef).cancel();

  // Only announce if was in game > 15s (genuine session, not refresh)
  if (Date.now() - _joinedAt > 15_000) {
    _pushSystemChat(`${filterUsername(playerName)} left the world`, 'leave');
  }

  await remove(_playerRef);
  _unsubscribers.forEach(fn => fn());
  _unsubscribers = [];
  _playerRef = null;
  _playerId  = null;
}

// ─────────────────────────────────────────────────────────────
//  POSITION / CHARACTER UPDATES
// ─────────────────────────────────────────────────────────────
export function updatePosition(x, y, z, rotationY) {
  if (!_playerRef || !isConfigured) return;
  update(_playerRef, {
    x:         Math.round(x * 10) / 10,
    y:         Math.round(y * 10) / 10,
    z:         Math.round(z * 10) / 10,
    rotationY: Math.round(rotationY * 100) / 100,
  });
}

export function updateCharacter(charConfig) {
  if (!_playerRef || !isConfigured) return;
  update(_playerRef, {
    colour:     charConfig.shirtColour || '#1e90ff',
    charConfig: JSON.stringify(charConfig),
  });
}

// ─────────────────────────────────────────────────────────────
//  PLAYERS SUBSCRIPTION — applies name filter on receive
// ─────────────────────────────────────────────────────────────
export function onPlayersUpdate(callback) {
  if (!isConfigured) { callback({}); return () => {}; }

  const playersRef = PATHS.players();
  const unsub = onValue(playersRef, snapshot => {
    const raw    = snapshot.val() || {};
    const others = {};
    for (const [id, data] of Object.entries(raw)) {
      if (id === _playerId) continue;
      if (data.online === false) continue; // skip offline presence records
      others[id] = {
        name:      filterUsername(data.name || 'Player'), // Layer 2 filter
        colour:    data.colour    || '#ffffff',
        charConfig: data.charConfig ? JSON.parse(data.charConfig) : null,
        x:         data.x         ?? 0,
        y:         data.y         ?? 0,
        z:         data.z         ?? 0,
        rotationY: data.rotationY ?? 0,
      };
    }
    callback(others);
  });

  const unsubFn = () => off(playersRef, 'value', unsub);
  _unsubscribers.push(unsubFn);
  return unsubFn;
}

export function getPlayerCount(callback) {
  if (!isConfigured) { callback(0); return () => {}; }

  const playersRef = PATHS.players();
  const unsub = onValue(playersRef, snapshot => {
    if (!snapshot.exists()) { callback(0); return; }
    const count = Object.values(snapshot.val()).filter(p => p.online !== false).length;
    callback(count);
  });

  const unsubFn = () => off(playersRef, 'value', unsub);
  _unsubscribers.push(unsubFn);
  return unsubFn;
}

// ─────────────────────────────────────────────────────────────
//  CHAT
// ─────────────────────────────────────────────────────────────
export function sendChat(msg) {
  if (!isConfigured || !msg.text?.trim()) return;
  const newMsg = push(PATHS.chat());
  set(newMsg, {
    name:   filterUsername(msg.name),
    colour: msg.colour,
    text:   msg.text.trim().slice(0, 80),
    time:   serverTimestamp(),
    system: false,
    type:   msg.type || 'player',
  });
  _pruneChat(40);
}

export function onChat(callback) {
  if (!isConfigured) { callback([]); return () => {}; }

  const chatQuery = query(PATHS.chat(), limitToLast(40));
  const unsub = onValue(chatQuery, snapshot => {
    const raw  = snapshot.val() || {};
    const msgs = Object.values(raw).map(m => ({
      name:   filterUsername(m.name || ''),
      colour: m.colour || '#ffffff',
      text:   m.text   || '',
      system: m.system || false,
      type:   m.type   || 'player',
    }));
    callback(msgs);
  });

  const unsubFn = () => off(chatQuery, 'value', unsub);
  _unsubscribers.push(unsubFn);
  return unsubFn;
}

// ─────────────────────────────────────────────────────────────
//  REPORT PLAYER — Layer 3 moderation
//  3 reports from different UIDs within 1h → auto-blank name
// ─────────────────────────────────────────────────────────────
export async function reportPlayer(targetId, targetName, reason = 'offensive_name') {
  if (!isConfigured || !_playerId || !targetId) return;
  if (targetId === _playerId) return; // can't report self

  const reportRef = push(PATHS.reports(targetId));
  await set(reportRef, {
    reporterId: _playerId,
    reason,
    targetName: filterUsername(targetName),
    time:       serverTimestamp(),
  });

  // Count recent reports for this player
  onValue(PATHS.reports(targetId), snapshot => {
    if (!snapshot.exists()) return;
    const now     = Date.now();
    const reports = Object.values(snapshot.val());
    const recent  = reports.filter(r => {
      // Firebase serverTimestamp comes back as a number
      const t = typeof r.time === 'number' ? r.time : now;
      return now - t < 3_600_000 && r.reporterId !== _playerId; // last 1h, different reporters
    });

    const uniqueReporters = new Set(recent.map(r => r.reporterId));
    if (uniqueReporters.size >= 3) {
      // Auto-blank the name pending review
      update(ref(db, `players/${targetId}`), { name: 'Player' });
    }
  }, { onlyOnce: true });
}

// ─────────────────────────────────────────────────────────────
//  INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────
function _pushSystemChat(text, type = 'system') {
  if (!isConfigured) return;
  const newMsg = push(PATHS.chat());
  set(newMsg, { name: '', colour: '#6868a8', text, time: serverTimestamp(), system: true, type });
  _pruneChat(40);
}

async function _pruneChat(keep) {
  if (!isConfigured) return;
  onValue(PATHS.chat(), snapshot => {
    if (!snapshot.exists()) return;
    const keys = Object.keys(snapshot.val());
    if (keys.length > keep)
      keys.slice(0, keys.length - keep).forEach(k => remove(ref(db, `chat/${k}`)));
  }, { onlyOnce: true });
}
