// ============================================================
//  WalkWorld 3D — events.js  (PART 2)
//
//  Server-wide World Events system.
//
//  Events
//  ──────
//  Ore Rush     — every 20 min · 3 min active · 2× coin bonus
//  Meteor Strike — every 2 hr  · 5 min window · 10× bonus at site
//  Void Surge   — once per day  · 10 min  · 3× rare ore chance in Void
//
//  Public API
//  ----------
//  initWorldEvents(db?, chatCallback?, meteorCallback?)
//    — db:             optional Firebase Database reference
//    — chatCallback:   fn(msg, type) posts to game chat
//    — meteorCallback: fn(wx, wz) spawns meteor visual (caves.js)
//
//  getOreRushMultiplier()   → number  (1 normally, 2 during rush)
//  getVoidSurgeActive()     → boolean
//  getMeteorSiteBonus(x,z)  → number  (1 normally, 10 near meteor)
//  tickEvents(timestamp)    → call each frame (handles countdowns)
// ============================================================

// ── Timing constants ──────────────────────────────────────────
const ORE_RUSH_INTERVAL_MS   = 20 * 60 * 1000;   // 20 min between starts
const ORE_RUSH_DURATION_MS   =  3 * 60 * 1000;   //  3 min active
const METEOR_INTERVAL_MS     = 120 * 60 * 1000;  //  2 hr between strikes
const METEOR_WINDOW_MS       =  5 * 60 * 1000;   //  5 min visible
const METEOR_CLAIM_R         = 6;                 //  metres to claim bonus
const VOID_SURGE_INTERVAL_MS = 24 * 60 * 60 * 1000; // once per day
const VOID_SURGE_DURATION_MS = 10 * 60 * 1000;   // 10 min active

// ── Module state ──────────────────────────────────────────────
let _db              = null;
let _chatCallback    = null;
let _meteorCallback  = null;

let _oreRushActive   = false;
let _oreRushEnd      = 0;          // timestamp ms
let _oreRushNext     = 0;

let _meteorActive    = false;
let _meteorEnd       = 0;
let _meteorNext      = 0;
let _meteorX         = 0;
let _meteorZ         = 0;

let _voidSurgeActive = false;
let _voidSurgeEnd    = 0;
let _voidSurgeNext   = 0;

let _lastTickSec     = 0;          // for HUD countdown throttle
let _initialized     = false;

// HUD event banner element
let _eventBannerEl   = null;

// ── Helpers ───────────────────────────────────────────────────
function _now() { return Date.now(); }

function _chat(msg, type = 'event') {
  if (_chatCallback) _chatCallback(msg, type);
}

function _msToCountdown(ms) {
  if (ms <= 0) return '0:00';
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// Random world position for meteor (stays within ±70 of centre, not Plaza)
function _randomMeteorPos() {
  const range = 70;
  let x, z;
  do {
    x = (Math.random() - 0.5) * range * 2;
    z = (Math.random() - 0.5) * range * 2;
  } while (Math.abs(x) < 22 && Math.abs(z) < 18);  // avoid Plaza
  return { x, z };
}

// ── Event banner UI ───────────────────────────────────────────
function _ensureBanner() {
  if (_eventBannerEl) return;
  _eventBannerEl = document.createElement('div');
  _eventBannerEl.id = 'worldEventBanner';
  _eventBannerEl.style.cssText = [
    'position:fixed','top:72px','left:50%','transform:translateX(-50%)',
    'background:rgba(0,0,0,0.82)','border-radius:10px',
    'padding:7px 18px 7px 14px',
    'font-family:inherit','font-size:13px','font-weight:600','color:#fff',
    'pointer-events:none','z-index:410',
    'display:flex','align-items:center','gap:9px',
    'opacity:0','transition:opacity 0.4s',
    'white-space:nowrap','max-width:90vw',
  ].join(';');
  document.body.appendChild(_eventBannerEl);
}

function _showBanner(icon, text, color, countdown) {
  _ensureBanner();
  const cdStr = countdown > 0 ? ` — <span id="weBannerCD" style="color:${color}">${_msToCountdown(countdown)}</span>` : '';
  _eventBannerEl.innerHTML = `<span style="font-size:16px">${icon}</span> ${text}${cdStr}`;
  _eventBannerEl.style.borderLeft = `3px solid ${color}`;
  _eventBannerEl.style.opacity = '1';
}

function _hideBanner() {
  if (_eventBannerEl) _eventBannerEl.style.opacity = '0';
}

function _updateBannerCountdown(ms) {
  const cdEl = document.getElementById('weBannerCD');
  if (cdEl) cdEl.textContent = _msToCountdown(ms);
}

// ── Minimap event dot ─────────────────────────────────────────
// Writes a gold star marker for the meteor into the minimap.
// The minimap renderer in game.js/renderer.js can query this.
let _meteorMinimapMarker = null;

export function getMeteorMinimapMarker() {
  return _meteorActive ? _meteorMinimapMarker : null;
}

// ── Firebase sync (optional) ──────────────────────────────────
// If a Firebase Realtime Database ref is provided, events are
// synced across all connected clients in real time.

function _listenFirebase() {
  if (!_db) return;

  try {
    // Ore Rush
    _db.ref('worldEvents/oreRush').on('value', snap => {
      const data = snap.val();
      if (!data) return;
      _oreRushActive = data.active ?? false;
      _oreRushEnd    = data.endMs  ?? 0;
      if (_oreRushActive) _chat('⚡ ORE RUSH — 2× coins for 3 minutes!', 'oreRush');
    });

    // Meteor Strike
    _db.ref('worldEvents/meteor').on('value', snap => {
      const data = snap.val();
      if (!data) return;
      _meteorActive = data.active ?? false;
      _meteorX      = data.x ?? 0;
      _meteorZ      = data.z ?? 0;
      _meteorEnd    = data.endMs ?? 0;
      _meteorMinimapMarker = { x: _meteorX, z: _meteorZ };
      if (_meteorActive && _meteorCallback) {
        _meteorCallback(_meteorX, _meteorZ);
        _chat(`☄️ METEOR STRIKE at (${Math.round(_meteorX)}, ${Math.round(_meteorZ)}) — first to dig it gets 10× bonus!`, 'meteor');
      }
    });

    // Void Surge
    _db.ref('worldEvents/voidSurge').on('value', snap => {
      const data = snap.val();
      if (!data) return;
      _voidSurgeActive = data.active ?? false;
      _voidSurgeEnd    = data.endMs ?? 0;
      if (_voidSurgeActive) _chat('🌌 VOID SURGE — 3× rare ore chance in The Void for 10 minutes!', 'voidSurge');
    });
  } catch (e) {
    console.warn('[Events] Firebase listen error:', e);
  }
}

// Write event state to Firebase (called by the "host" client)
function _writeFirebase(path, data) {
  if (!_db) return;
  try { _db.ref(path).set(data); } catch {}
}

// ── Event triggers ────────────────────────────────────────────

function _startOreRush() {
  _oreRushActive = true;
  _oreRushEnd    = _now() + ORE_RUSH_DURATION_MS;
  _oreRushNext   = _oreRushEnd + ORE_RUSH_INTERVAL_MS;
  _chat('⚡ ORE RUSH — 2× coins for 3 minutes!', 'oreRush');
  _showBanner('⚡', 'ORE RUSH — double coins!', '#ffcc00', ORE_RUSH_DURATION_MS);
  _writeFirebase('worldEvents/oreRush', {
    active: true, endMs: _oreRushEnd,
  });
}

function _endOreRush() {
  _oreRushActive = false;
  _chat('⚡ Ore Rush ended.', 'system');
  _hideBanner();
  _writeFirebase('worldEvents/oreRush', { active: false, endMs: 0 });
}

function _startMeteor() {
  const { x, z } = _randomMeteorPos();
  _meteorActive   = true;
  _meteorX        = x;
  _meteorZ        = z;
  _meteorEnd      = _now() + METEOR_WINDOW_MS;
  _meteorNext     = _meteorEnd + METEOR_INTERVAL_MS;
  _meteorMinimapMarker = { x, z };

  if (_meteorCallback) _meteorCallback(x, z);
  _chat(`☄️ METEOR STRIKE — dig at (${Math.round(x)}, ${Math.round(z)}) for 10× bonus! 5 min window.`, 'meteor');
  _showBanner('☄️', `Meteor Strike — dig fast!`, '#ff8800', METEOR_WINDOW_MS);
  _writeFirebase('worldEvents/meteor', {
    active: true, x, z, endMs: _meteorEnd,
  });
}

function _endMeteor() {
  _meteorActive        = false;
  _meteorMinimapMarker = null;
  _hideBanner();
  _writeFirebase('worldEvents/meteor', { active: false, x: 0, z: 0, endMs: 0 });
}

function _startVoidSurge() {
  _voidSurgeActive = true;
  _voidSurgeEnd    = _now() + VOID_SURGE_DURATION_MS;
  _voidSurgeNext   = _now() + VOID_SURGE_INTERVAL_MS;
  _chat('🌌 VOID SURGE — 3× rare ore in The Void for 10 minutes! Sync your playtime.', 'voidSurge');
  _showBanner('🌌', 'Void Surge — rare ore ×3!', '#cc44ff', VOID_SURGE_DURATION_MS);
  _writeFirebase('worldEvents/voidSurge', {
    active: true, endMs: _voidSurgeEnd,
  });
}

function _endVoidSurge() {
  _voidSurgeActive = false;
  _hideBanner();
  _writeFirebase('worldEvents/voidSurge', { active: false, endMs: 0 });
}

// ── Tick (called every frame) ─────────────────────────────────
export function tickEvents(timestamp) {
  const now = _now();

  // Only run heavyweight checks once per second
  const sec = Math.floor(now / 1000);
  if (sec === _lastTickSec) return;
  _lastTickSec = sec;

  // ── Ore Rush ────────────────────────────────────────────────
  if (_oreRushActive) {
    const remaining = _oreRushEnd - now;
    if (remaining <= 0) {
      _endOreRush();
    } else {
      _updateBannerCountdown(remaining);
      // Warn 30 s before end
      if (remaining <= 30000 && remaining > 29000) {
        _chat('⚡ Ore Rush ending in 30 seconds!', 'system');
      }
    }
  } else if (now >= _oreRushNext && _oreRushNext > 0) {
    _startOreRush();
  }

  // ── Meteor Strike ───────────────────────────────────────────
  if (_meteorActive) {
    if (now >= _meteorEnd) _endMeteor();
    else                   _updateBannerCountdown(_meteorEnd - now);
  } else if (now >= _meteorNext && _meteorNext > 0) {
    _startMeteor();
  }

  // ── Void Surge ──────────────────────────────────────────────
  if (_voidSurgeActive) {
    if (now >= _voidSurgeEnd) _endVoidSurge();
    else                      _updateBannerCountdown(_voidSurgeEnd - now);
  } else if (now >= _voidSurgeNext && _voidSurgeNext > 0) {
    _startVoidSurge();
  }
}

// ── Public multiplier queries ─────────────────────────────────

/** Returns 2 during Ore Rush, 1 otherwise. */
export function getOreRushMultiplier() {
  return _oreRushActive ? 2 : 1;
}

/** Returns true during Void Surge. */
export function getVoidSurgeActive() {
  return _voidSurgeActive;
}

/**
 * Returns 10 if the player is within METEOR_CLAIM_R of the meteor site,
 * 1 otherwise. Call once per dig — set _meteorActive = false on first claim.
 */
export function getMeteorSiteBonus(px, pz) {
  if (!_meteorActive) return 1;
  const dx = px - _meteorX;
  const dz = pz - _meteorZ;
  if (dx*dx + dz*dz > METEOR_CLAIM_R * METEOR_CLAIM_R) return 1;

  // Claimed — end the event and announce
  _endMeteor();
  _chat('🏆 A player claimed the meteor! 10× bonus earned.', 'meteor');
  return 10;
}

/**
 * Returns the event status HUD strings for display in the reset timer area.
 * [{ label, color, countdown }]
 */
export function getActiveEventSummary() {
  const events = [];
  const now    = _now();
  if (_oreRushActive)   events.push({ label: '⚡ Ore Rush',   color: '#ffcc00', countdown: _oreRushEnd   - now });
  if (_meteorActive)    events.push({ label: '☄️ Meteor',     color: '#ff8800', countdown: _meteorEnd    - now });
  if (_voidSurgeActive) events.push({ label: '🌌 Void Surge', color: '#cc44ff', countdown: _voidSurgeEnd - now });
  return events;
}

// ── Init ──────────────────────────────────────────────────────

/**
 * @param {object|null}   db             Firebase Database reference (optional)
 * @param {function|null} chatCallback   fn(message, type) → posts to chat HUD
 * @param {function|null} meteorCallback fn(worldX, worldZ) → spawns meteor visual
 */
export function initWorldEvents(db = null, chatCallback = null, meteorCallback = null) {
  if (_initialized) return;
  _initialized    = true;
  _db             = db;
  _chatCallback   = chatCallback;
  _meteorCallback = meteorCallback;

  const now = _now();

  // Schedule first events (staggered so they don't all fire on launch)
  _oreRushNext   = now + ORE_RUSH_INTERVAL_MS;
  _meteorNext    = now + METEOR_INTERVAL_MS;
  _voidSurgeNext = now + VOID_SURGE_INTERVAL_MS;

  // If Firebase is available, sync shared state
  _listenFirebase();

  console.log('[Events] World events initialised. ' +
    `Ore Rush in ${Math.round(ORE_RUSH_INTERVAL_MS / 60000)} min, ` +
    `Meteor in ${Math.round(METEOR_INTERVAL_MS / 60000)} min, ` +
    `Void Surge in ${Math.round(VOID_SURGE_INTERVAL_MS / 3600000)} hr`);
}

export default {
  initWorldEvents, tickEvents,
  getOreRushMultiplier, getVoidSurgeActive,
  getMeteorSiteBonus, getActiveEventSummary, getMeteorMinimapMarker,
};
