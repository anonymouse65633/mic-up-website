// ============================================================
//  WalkWorld 3D — ui.js
//  Part 7: Animated coin HUD · Depth pill · Ore toast ·
//          Inactive kick · Chat fade · Minimap depth view ·
//          Prestige aura · Save-progress banner
// ============================================================

import { getMaterialAtDepth } from './mining.js';

// ────────────────────────────────────────────────────────────
//  COIN COUNTER — animated count-up + "+X" badge
// ────────────────────────────────────────────────────────────
let _displayedMoney = 0;
let _targetMoney    = 0;
let _coinRafId      = null;
let _badgeTimer     = null;

export function updateMoneyHUD(money) {
  const el     = document.getElementById('hudMoney');
  const badge  = document.getElementById('hudMoneyBadge');
  if (!el) return;

  const diff = money - _targetMoney;
  _targetMoney = money;

  // Show +X / -X badge
  if (diff !== 0 && badge) {
    badge.textContent = (diff > 0 ? '+' : '') + diff.toLocaleString();
    badge.className   = 'money-badge ' + (diff > 0 ? 'positive' : 'negative');
    badge.classList.remove('hidden');
    clearTimeout(_badgeTimer);
    _badgeTimer = setTimeout(() => badge.classList.add('hidden'), 1200);
  }

  // Animate count-up/down
  if (_coinRafId) cancelAnimationFrame(_coinRafId);
  const startVal  = _displayedMoney;
  const startTime = performance.now();
  const DURATION  = 400;

  function tick(now) {
    const t = Math.min(1, (now - startTime) / DURATION);
    const ease = 1 - Math.pow(1 - t, 3); // ease-out-cubic
    _displayedMoney = Math.round(startVal + (money - startVal) * ease);
    el.textContent = '$' + _displayedMoney.toLocaleString();
    if (t < 1) {
      _coinRafId = requestAnimationFrame(tick);
    } else {
      _displayedMoney = money;
      el.textContent  = '$' + money.toLocaleString();
    }
  }
  _coinRafId = requestAnimationFrame(tick);
}

// ────────────────────────────────────────────────────────────
//  DEPTH PILL — layer-coloured + pulse on layer change
// ────────────────────────────────────────────────────────────
let _lastLayerName = '';

export function updateDepthHUD(depth, zone) {
  const depthEl  = document.getElementById('hudDepth');
  const panel    = document.getElementById('hudDepthPanel');
  if (!depthEl || !panel) return;

  if (zone === 'Plaza') {
    depthEl.innerHTML = '🏛 Plaza — <span style="color:#ff9944">No Digging</span>';
    depthEl.style.color = '#cccccc';
    panel.style.background = 'rgba(20,20,30,0.85)';
    panel.style.display = '';
    return;
  }

  if (depth > 0.3) {
    const mat = getMaterialAtDepth(depth);
    depthEl.textContent = `⛏ ${depth.toFixed(1)}m — ${mat.name}`;
    depthEl.style.color = mat.hexColor;
    panel.style.background = mat.hexColor + '22';
    panel.style.borderColor = mat.hexColor + '66';
    panel.style.display = '';

    if (mat.name !== _lastLayerName) {
      _lastLayerName = mat.name;
      panel.classList.remove('depth-pulse');
      void panel.offsetWidth; // reflow
      panel.classList.add('depth-pulse');
    }
    window._currentLayerName = mat.name;
  } else {
    panel.style.display = 'none';
  }
}

// ────────────────────────────────────────────────────────────
//  ORE TOAST — bottom-right stack, up to 3
// ────────────────────────────────────────────────────────────
const _toastQueue = [];

export function showOreToast(ore, depth) {
  const container = document.getElementById('oreToastContainer');
  if (!container) return;

  // Limit to 3 visible
  while (container.children.length >= 3) {
    container.removeChild(container.firstChild);
  }

  const RARITY_DURATION = { common: 3000, uncommon: 4000, rare: 5000, legendary: 0 };
  const duration = RARITY_DURATION[ore.rarity] ?? 3000;

  const toast = document.createElement('div');
  toast.className = 'ore-toast ore-toast-' + (ore.rarity || 'common');
  toast.innerHTML = `
    <span class="ore-toast-swatch" style="background:${ore.hexColor}"></span>
    <span class="ore-toast-name">${ore.name}</span>
    <span class="ore-toast-value">$${ore.value}</span>
    <span class="ore-toast-depth">${Math.round(depth)}m</span>
    ${ore.rarity === 'legendary' ? '<button class="ore-toast-close" aria-label="Dismiss">×</button>' : ''}
  `;

  if (ore.rarity === 'legendary') {
    toast.querySelector('.ore-toast-close')?.addEventListener('click', () => removeToast(toast));
  }

  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));

  if (duration > 0) {
    setTimeout(() => removeToast(toast), duration);
  }
}

function removeToast(toast) {
  toast.classList.remove('visible');
  toast.classList.add('fading');
  setTimeout(() => toast.remove(), 300);
}

// ────────────────────────────────────────────────────────────
//  INACTIVE KICK — 4 min warning, 5 min kick
// ────────────────────────────────────────────────────────────
let _lastInputTime  = Date.now();
let _inactiveWarned = false;
let _inactiveKicked = false;

const WARN_MS = 4 * 60 * 1000;
const KICK_MS = 5 * 60 * 1000;

export function resetInactivityTimer() {
  _lastInputTime  = Date.now();
  _inactiveWarned = false;
  const warn = document.getElementById('inactiveWarning');
  if (warn) warn.classList.add('hidden');
}

export function tickInactivity(onKick) {
  if (_inactiveKicked) return;
  const idle = Date.now() - _lastInputTime;

  if (idle >= KICK_MS) {
    _inactiveKicked = true;
    const warn = document.getElementById('inactiveWarning');
    if (warn) warn.classList.add('hidden');
    onKick();
    return;
  }

  if (idle >= WARN_MS && !_inactiveWarned) {
    _inactiveWarned = true;
    const warn = document.getElementById('inactiveWarning');
    if (warn) warn.classList.remove('hidden');
  }
}

// ────────────────────────────────────────────────────────────
//  CHAT FADE — fade to 0 after 8s, revive on new message
// ────────────────────────────────────────────────────────────
let _chatFadeTimer = null;
const CHAT_FADE_DELAY = 8000;

export function reviveChatFade() {
  const panel = document.getElementById('chatMessages');
  if (!panel) return;
  panel.classList.remove('chat-faded');
  clearTimeout(_chatFadeTimer);
  _chatFadeTimer = setTimeout(() => {
    panel.classList.add('chat-faded');
  }, CHAT_FADE_DELAY);
}

// Chat color coding by message type
export function getChatMsgClass(msg) {
  if (msg.type === 'join' || msg.type === 'leave') return 'chat-msg sys-msg chat-join-leave';
  if (msg.type === 'event')     return 'chat-msg chat-event';
  if (msg.type === 'depth')     return 'chat-msg chat-depth';
  if (msg.type === 'legendary') return 'chat-msg chat-legendary';
  if (msg.type === 'ore')       return 'chat-msg chat-ore';
  if (msg.system)               return 'chat-msg sys-msg';
  return 'chat-msg';
}

// ────────────────────────────────────────────────────────────
//  MINIMAP DEPTH VIEW — depth strip on right edge
// ────────────────────────────────────────────────────────────
const LAYER_BANDS = [
  { name: 'Grass',      color: '#6B8C42', min: 0,   max: 6   },
  { name: 'Clay',       color: '#CC8855', min: 6,   max: 18  },
  { name: 'Stone',      color: '#909090', min: 18,  max: 42  },
  { name: 'Sandstone',  color: '#C8A060', min: 42,  max: 65  },
  { name: 'Dark Stone', color: '#3A3A66', min: 65,  max: 110 },
  { name: 'Obsidian',   color: '#1A1A2E', min: 110, max: 160 },
  { name: 'Dense Ore',  color: '#FF7700', min: 160, max: 250 },
  { name: 'The Void',   color: '#220033', min: 250, max: 300 },
];

let _minimapMode = 'surface'; // 'surface' | 'depth'

export function getMinimapMode() { return _minimapMode; }
export function setMinimapMode(m) { _minimapMode = m; }

export function drawDepthStrip(canvas2d, width, height, playerDepth) {
  const stripW = 10;
  const x0     = width - stripW;
  const maxDepth = 300;

  // Draw layer bands
  LAYER_BANDS.forEach(band => {
    const y0 = (band.min / maxDepth) * height;
    const y1 = (band.max / maxDepth) * height;
    canvas2d.fillStyle = band.color;
    canvas2d.fillRect(x0, y0, stripW, y1 - y0);
  });

  // Cursor dot
  const cursorY = Math.min((playerDepth / maxDepth) * height, height - 3);
  canvas2d.fillStyle = '#ffffff';
  canvas2d.beginPath();
  canvas2d.arc(x0 + stripW / 2, cursorY, 3, 0, Math.PI * 2);
  canvas2d.fill();
}

export function toggleMinimapMode() {
  _minimapMode = _minimapMode === 'surface' ? 'depth' : 'surface';
  const btn = document.getElementById('minimapModeBtn');
  if (btn) btn.textContent = _minimapMode === 'depth' ? '🗺' : '📊';
  return _minimapMode;
}

// ────────────────────────────────────────────────────────────
//  PRESTIGE AURA — P3+ animated particle ring
// ────────────────────────────────────────────────────────────
const AURA_COLORS = {
  1: '#CD7F32', // bronze
  2: '#C0C0C0', // silver
  3: '#FFD700', // gold
  4: '#00BFFF', // diamond
  5: '#FF00FF', // mythic
};

const _auras = new Map(); // uid → { mesh: Group, angle: number }

export function updatePrestigeAura(scene, THREE, uid, playerMesh, prestigeLevel) {
  // Remove existing
  if (_auras.has(uid)) {
    scene.remove(_auras.get(uid).group);
    _auras.delete(uid);
  }
  if (prestigeLevel < 3 || !playerMesh) return;

  const color  = AURA_COLORS[Math.min(prestigeLevel, 5)] || '#FFD700';
  const group  = new THREE.Group();
  const geo    = new THREE.SphereGeometry(0.08, 6, 6);
  const mat    = new THREE.MeshBasicMaterial({ color });
  const count  = 6;

  for (let i = 0; i < count; i++) {
    const sphere = new THREE.Mesh(geo, mat.clone());
    group.add(sphere);
  }

  scene.add(group);
  _auras.set(uid, { group, angle: 0, count, radius: 0.8 });
}

export function tickPrestigeAuras(dt) {
  for (const [uid, aura] of _auras) {
    aura.angle += 0.8 * dt;
    for (let i = 0; i < aura.count; i++) {
      const a = aura.angle + (i / aura.count) * Math.PI * 2;
      const sphere = aura.group.children[i];
      sphere.position.set(
        Math.cos(a) * aura.radius,
        0.2,
        Math.sin(a) * aura.radius,
      );
    }
  }
}

export function syncAuraToPlayer(uid, playerPos) {
  const aura = _auras.get(uid);
  if (!aura) return;
  aura.group.position.set(playerPos.x, playerPos.y, playerPos.z);
}

// ────────────────────────────────────────────────────────────
//  SEASONAL TINT — weekly hue shift on surface grass
// ────────────────────────────────────────────────────────────
const SEASONS = [
  { name: 'Summer',  color: 0x6B8C42 },
  { name: 'Autumn',  color: 0xB8730A },
  { name: 'Winter',  color: 0x8899BB },
  { name: 'Spring',  color: 0xF48FBF },
];

export function getSeasonalGrassColor() {
  const week = Math.floor(Date.now() / (7 * 24 * 3600 * 1000));
  return SEASONS[week % 4].color;
}

export function getSeasonName() {
  const week = Math.floor(Date.now() / (7 * 24 * 3600 * 1000));
  return SEASONS[week % 4].name;
}

// ────────────────────────────────────────────────────────────
//  SAVE PROGRESS BANNER — shown after 10 min for guests
// ────────────────────────────────────────────────────────────
let _savePromptShown = false;

export function checkSaveProgressPrompt() {
  if (_savePromptShown) return;
  const isGuest = sessionStorage.getItem('playerGuest') === 'true';
  if (!isGuest) return;

  const el = document.getElementById('saveProgressBanner');
  if (!el) return;

  _savePromptShown = true;
  el.classList.remove('hidden');

  document.getElementById('saveProgressDismiss')?.addEventListener('click', () => {
    el.classList.add('hidden');
  });

  document.getElementById('saveProgressLink')?.addEventListener('click', async () => {
    el.classList.add('hidden');
    // Import auth dynamically to avoid circular deps
    const { auth, linkWithPopup, GoogleAuthProvider } = await import('./firebase-config.js');
    if (!auth) return;
    try {
      const provider = new GoogleAuthProvider();
      await linkWithPopup(auth.currentUser, provider);
      sessionStorage.setItem('playerGuest', 'false');
      const notice = document.getElementById('saveProgressBanner');
      if (notice) {
        notice.innerHTML = '<span style="color:#2ed573">✅ Progress saved to Google account!</span>';
        notice.classList.remove('hidden');
        setTimeout(() => notice.classList.add('hidden'), 4000);
      }
    } catch(e) {
      console.warn('[Auth] link failed', e);
    }
  });
}
