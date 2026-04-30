// ============================================================
//  WalkWorld 3D — shop.js  (Part 8)
//
//  • 4-tab shop panel: Consumables · Upgrades · Cosmetics · Daily Deals
//  • Depth-gated catalogue (14 items)
//  • Purchase animation: scale-up + green flash
//  • Economy balance: 3-min rule depth gates
// ============================================================

import { TOOLS, BACKPACKS, SELL_PRICES, ITEM_EMOJIS, playerInventory } from './inventory.js';
import { getMoney, addMoney } from './mining.js';

// ─────────────────────────────────────────────────────────────
//  DEPTH-GATED CATALOGUE
// ─────────────────────────────────────────────────────────────
export const DEPTH_GATED = [
  // ── CONSUMABLES ──────────────────────────────────────────
  {
    id: 'dynamite', emoji: '🧨', name: 'Dynamite', type: 'consumable',
    desc: 'Instant 4-punch dig + explosion FX.', price: 120, depthReq: 0, qty: 1,
  },
  {
    id: 'cluster_bomb', emoji: '💣', name: 'Cluster Bomb', type: 'consumable',
    desc: 'Instantly clears a 3×3 grid of blocks.', price: 350, depthReq: 40, qty: 1,
  },
  {
    id: 'ore_magnet', emoji: '🧲', name: 'Ore Magnet', type: 'consumable',
    desc: '×3 ore roll chance for 5 minutes.', price: 1200, depthReq: 30,
  },
  {
    id: 'void_magnet', emoji: '🔮', name: 'Void Magnet', type: 'consumable',
    desc: '×5 rare ore chance for 3 minutes.', price: 5000, depthReq: 150,
  },
  // ── UPGRADES ─────────────────────────────────────────────
  {
    id: 'detector_t1', emoji: '📡', name: 'Ore Detector T1', type: 'upgrade',
    desc: 'Shows nearest ore distance in HUD.', price: 100, depthReq: 15, tier: 1,
  },
  {
    id: 'detector_t2', emoji: '📡', name: 'Ore Detector T2', type: 'upgrade',
    desc: 'Ore type + minimap ping.', price: 800, depthReq: 40, tier: 2,
  },
  {
    id: 'detector_t3', emoji: '📡', name: 'Ore Detector T3', type: 'upgrade',
    desc: 'Vein highlight + full minimap overlay.', price: 4000, depthReq: 80, tier: 3,
  },
  {
    id: 'headlamp', emoji: '💡', name: 'Headlamp', type: 'upgrade',
    desc: 'Player SpotLight — essential at Dark Stone.', price: 200, depthReq: 65,
  },
  {
    id: 'lantern', emoji: '🏮', name: 'Lantern', type: 'upgrade',
    desc: 'Wider beam for Obsidian layer navigation.', price: 600, depthReq: 110,
  },
  {
    id: 'void_torch', emoji: '🔦', name: 'Void Torch', type: 'upgrade',
    desc: 'Only light source that works in The Void.', price: 3000, depthReq: 250,
  },
  {
    id: 'depth_boots', emoji: '👢', name: 'Depth Boots', type: 'upgrade',
    desc: '+20% movement speed underground.', price: 500, depthReq: 20,
  },
  {
    id: 'waypoint', emoji: '📍', name: 'Waypoint Anchor', type: 'upgrade',
    desc: 'Place a teleport marker underground.', price: 500, depthReq: 0,
  },
  // ── COSMETICS ─────────────────────────────────────────────
  {
    id: 'mining_helmet', emoji: '⛑️', name: 'Mining Helmet', type: 'cosmetic',
    desc: 'Hat + glow on head. Craft: iron ×5 at the forge.', price: 0, depthReq: 0, craftReq: { iron: 5 },
  },
  {
    id: 'prestige_reset', emoji: '♻️', name: 'Prestige Reset', type: 'upgrade',
    desc: 'Resets shaft depth. Grants permanent +10% coin bonus.', price: 10000, depthReq: 200,
  },
];

// ─────────────────────────────────────────────────────────────
//  LEGACY SHOP DEFS (Plaza NPC stalls — sell stall still used)
// ─────────────────────────────────────────────────────────────
export const SHOPS = {
  toolShop: {
    id: 'toolShop', name: '⛏ Tool Shop', npcName: 'TOOL SMITH',
    desc: 'Gear, upgrades & consumables.', color: '#c0823a',
    items: [],
  },
  gearShop: {
    id: 'gearShop', name: '🎒 Gear Shop', npcName: 'OUTFITTER',
    desc: 'Backpacks, detectors & cosmetics.', color: '#3a8c5a',
    items: [],
  },
  sellStall: {
    id: 'sellStall', name: '💰 Sell Stall', npcName: 'ORE TRADER',
    desc: 'Sell your mined ores and blocks.', color: '#8c3a8c',
    items: [],
  },
};

export const SHOP_POSITIONS = {
  toolShop:  { x: -12, z: -14 },
  gearShop:  { x:   0, z: -14 },
  sellStall: { x:  12, z: -14 },
};
export const SHOP_PROXIMITY = 5.5;

// ─────────────────────────────────────────────────────────────
//  OWNED ITEMS TRACKING
// ─────────────────────────────────────────────────────────────
const _ownedUpgrades = new Set(
  JSON.parse(sessionStorage.getItem('ownedUpgrades') || '[]')
);
function _isOwned(id) { return _ownedUpgrades.has(id); }
function _setOwned(id) {
  _ownedUpgrades.add(id);
  sessionStorage.setItem('ownedUpgrades', JSON.stringify([..._ownedUpgrades]));
}

// ─────────────────────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────────────────────
let _isOpen      = false;
let _activeShop  = null;
let _activeTab   = 'consumable';
let _onMoneyChange = null;

export function isShopOpen() { return _isOpen; }
export function setMoneyChangeCallback(cb) { _onMoneyChange = cb; }

export function getNearestShop(px, pz) {
  let bestId = null, bestDist = Infinity;
  for (const [id, pos] of Object.entries(SHOP_POSITIONS)) {
    const d = Math.hypot(px - pos.x, pz - pos.z);
    if (d < SHOP_PROXIMITY && d < bestDist) { bestDist = d; bestId = id; }
  }
  return bestId;
}

// ─────────────────────────────────────────────────────────────
//  OPEN / CLOSE
// ─────────────────────────────────────────────────────────────
export function openShop(shopId) {
  const shop = SHOPS[shopId];
  if (!shop) return;
  _isOpen    = true;
  _activeShop = shopId;

  const overlay = document.getElementById('shopOverlay');
  if (!overlay) return;

  // Update header
  overlay.querySelector('.shop-title').textContent = shop.name;
  overlay.querySelector('.shop-npc').textContent   = shop.npcName;
  overlay.querySelector('.shop-desc').textContent  = shop.desc;
  overlay.querySelector('.shop-money').textContent = `💰 $${getMoney().toLocaleString()}`;

  if (shopId === 'sellStall') {
    _showPanel('sell');
  } else {
    _showPanel(_activeTab);
  }

  _wireTabs();
  overlay.classList.remove('hidden');
  _loadDailyDeals();
  _tickDailyTimer();
}

export function closeShop() {
  _isOpen     = false;
  _activeShop = null;
  document.getElementById('shopOverlay')?.classList.add('hidden');
}

// ─────────────────────────────────────────────────────────────
//  PANEL SWITCHING
// ─────────────────────────────────────────────────────────────
const PANEL_IDS = {
  consumable: 'shopConsumableGrid',
  upgrade:    'shopUpgradeGrid',
  cosmetic:   'shopCosmeticGrid',
  daily:      'shopDailyPanel',
  sell:       'shopSellPanel',
  tools:      'shopToolsGrid',
};

function _showPanel(tab) {
  _activeTab = tab;

  // Highlight tab button
  document.querySelectorAll('[data-shop-tab]').forEach(b => {
    b.classList.toggle('active', b.dataset.shopTab === tab);
  });

  // Show correct panel, hide others
  Object.values(PANEL_IDS).forEach(id => {
    document.getElementById(id)?.classList.add('hidden');
  });
  document.getElementById(PANEL_IDS[tab] || 'shopConsumableGrid')?.classList.remove('hidden');

  // Render content
  const depth = window._playerDepthForShop ?? 0;
  if (tab === 'consumable') _renderDepthGated('consumable', depth);
  if (tab === 'upgrade')    _renderDepthGated('upgrade', depth);
  if (tab === 'cosmetic')   _renderDepthGated('cosmetic', depth);
  if (tab === 'sell')       _renderSellPanel();
  if (tab === 'tools')      _renderToolsPanel();
  if (tab === 'daily')      { /* already loaded */ }
}

// ─────────────────────────────────────────────────────────────
//  RENDER: DEPTH-GATED ITEMS  (consumable / upgrade / cosmetic)
// ─────────────────────────────────────────────────────────────
function _renderDepthGated(type, depth) {
  const panelId = PANEL_IDS[type];
  const grid = document.getElementById(panelId);
  if (!grid) return;
  grid.innerHTML = '';

  const items = DEPTH_GATED.filter(i => i.type === type);
  const money  = getMoney();

  for (const item of items) {
    const locked    = depth < item.depthReq;
    const owned     = item.type === 'upgrade' && _isOwned(item.id);
    const canAfford = money >= item.price && !item.craftReq;
    const buyable   = !locked && !owned && canAfford;

    const card = document.createElement('div');
    card.className = 'shop-item-card' + (locked ? ' shop-locked' : '');
    card.dataset.itemId = item.id;

    let priceHtml;
    if (item.craftReq) {
      const reqs = Object.entries(item.craftReq).map(([k, v]) => `${v}× ${k}`).join(', ');
      priceHtml = `<span class="shop-craft-req">🔨 Craft: ${reqs}</span>`;
    } else {
      priceHtml = `$${item.price.toLocaleString()}`;
    }

    card.innerHTML = `
      ${locked ? `<div class="shop-depth-badge">🔒 Depth ${item.depthReq}m</div>` : ''}
      <div class="shop-item-emoji">${item.emoji}</div>
      <div class="shop-item-name">${item.name}</div>
      <div class="shop-item-desc">${item.desc}</div>
      ${item.qty ? `<div class="shop-item-stats"><span>×${item.qty} per purchase</span></div>` : ''}
      <button class="shop-buy-btn ${!buyable || locked || owned ? 'disabled' : ''}"
              data-dg-buy="${item.id}"
              ${!buyable || locked || owned ? 'disabled' : ''}>
        ${locked ? `🔒 Reach ${item.depthReq}m`
          : owned ? '✓ OWNED'
          : item.craftReq ? priceHtml
          : canAfford ? priceHtml
          : `${priceHtml} — need more`}
      </button>`;

    grid.appendChild(card);
  }

  // Wire buy buttons
  grid.querySelectorAll('[data-dg-buy]').forEach(btn => {
    btn.addEventListener('click', () => _buyDepthGated(btn.dataset.dgBuy, btn));
  });
}

// ─────────────────────────────────────────────────────────────
//  RENDER: SELL PANEL
// ─────────────────────────────────────────────────────────────
function _renderSellPanel() {
  const grid = document.getElementById('shopSellPanel');
  if (!grid) return;
  const money = getMoney();
  const slots = playerInventory.slots.filter(Boolean);

  if (slots.length === 0) {
    grid.innerHTML = '<div class="shop-empty">Your bag is empty.<br>Mine some ores first!</div>';
    return;
  }
  grid.innerHTML = '';

  const grouped = {};
  for (const slot of slots) {
    if (!grouped[slot.id]) grouped[slot.id] = { ...slot, count: 0 };
    grouped[slot.id].count += slot.count;
  }

  let total = 0;
  for (const item of Object.values(grouped)) {
    const price    = SELL_PRICES[item.id] || 1;
    const subtotal = price * item.count;
    total += subtotal;

    const card = document.createElement('div');
    card.className = 'shop-item-card sell-card';
    card.innerHTML = `
      <div class="shop-item-emoji">${ITEM_EMOJIS[item.id] || '📦'}</div>
      <div class="shop-item-name">${item.name}</div>
      <div class="shop-item-stats">
        <span>×${item.count}</span><span>$${price} ea</span><span>= $${subtotal}</span>
      </div>`;
    grid.appendChild(card);
  }

  const sellBtn = document.createElement('button');
  sellBtn.className = 'shop-sell-all-btn';
  sellBtn.textContent = `💰 SELL ALL — $${total.toLocaleString()}`;
  sellBtn.addEventListener('click', () => {
    playerInventory.clearAll();
    addMoney(total);
    _refreshMoney();
    window.dispatchEvent(new CustomEvent('inventory-changed'));
    _renderSellPanel();
  });
  grid.appendChild(sellBtn);
}

// ─────────────────────────────────────────────────────────────
//  RENDER: TOOLS PANEL (shovels/picks/backpacks — legacy)
// ─────────────────────────────────────────────────────────────
function _renderToolsPanel() {
  const grid = document.getElementById('shopToolsGrid');
  if (!grid) return;
  grid.innerHTML = '';
  const money = getMoney();

  // Tools
  for (const tool of Object.values(TOOLS)) {
    const canAfford = money >= tool.price;
    const owned = playerInventory.hotbar.some(s => s?.tool.id === tool.id);
    const card = document.createElement('div');
    card.className = 'shop-item-card';
    card.innerHTML = `
      <div class="shop-item-emoji">${tool.emoji}</div>
      <div class="shop-item-name">${tool.name}</div>
      <div class="shop-item-stats">
        <span>⚡ ${tool.digSpeed}x</span><span>🛡 ${tool.durability} uses</span>
      </div>
      <div class="shop-item-desc">${tool.desc}</div>
      <button class="shop-buy-btn ${!canAfford || owned ? 'disabled' : ''}"
              data-buy-tool="${tool.id}" ${!canAfford || owned ? 'disabled' : ''}>
        ${owned ? '✓ OWNED' : canAfford ? `$${tool.price}` : `$${tool.price} — need more`}
      </button>`;
    grid.appendChild(card);
  }

  // Backpacks
  for (const pack of Object.values(BACKPACKS)) {
    const canAfford = money >= pack.price;
    const owned = playerInventory.capacity >= pack.slots;
    const card = document.createElement('div');
    card.className = 'shop-item-card';
    card.innerHTML = `
      <div class="shop-item-emoji">🎒</div>
      <div class="shop-item-name">${pack.name}</div>
      <div class="shop-item-stats"><span>📦 ${pack.slots} slots</span></div>
      <div class="shop-item-desc">Carries more loot.</div>
      <button class="shop-buy-btn ${!canAfford || owned ? 'disabled' : ''}"
              data-buy-pack="${pack.id}" ${!canAfford || owned ? 'disabled' : ''}>
        ${owned ? '✓ OWNED' : canAfford ? `$${pack.price}` : `$${pack.price} — need more`}
      </button>`;
    grid.appendChild(card);
  }

  grid.querySelectorAll('[data-buy-tool]').forEach(btn =>
    btn.addEventListener('click', () => _buyTool(btn.dataset.buyTool)));
  grid.querySelectorAll('[data-buy-pack]').forEach(btn =>
    btn.addEventListener('click', () => _buyBackpack(btn.dataset.buyPack)));
}

// ─────────────────────────────────────────────────────────────
//  BUY LOGIC
// ─────────────────────────────────────────────────────────────
function _buyDepthGated(itemId, btnEl) {
  const item = DEPTH_GATED.find(i => i.id === itemId);
  if (!item) return;
  if (getMoney() < item.price) return;

  addMoney(-item.price);

  // Upgrades are permanently owned
  if (item.type === 'upgrade') _setOwned(itemId);

  // Fire event for game.js to handle (activate effect)
  window.dispatchEvent(new CustomEvent('shop-item-bought', {
    detail: { id: item.id, type: item.type, name: item.name, emoji: item.emoji, price: item.price },
  }));

  // Purchase animation
  const card = btnEl?.closest('.shop-item-card');
  if (card) _playPurchaseAnim(card);

  _refreshMoney();
  // Re-render the current tab
  _showPanel(_activeTab);
}

function _buyTool(toolId) {
  const tool = TOOLS[toolId];
  if (!tool || getMoney() < tool.price) return;
  let slot = playerInventory.hotbar.findIndex((s, i) => i >= 2 && s === null);
  if (slot === -1) slot = 2;
  addMoney(-tool.price);
  playerInventory.setHotbarTool(toolId, slot);
  _refreshMoney();
  window.dispatchEvent(new CustomEvent('hotbar-changed'));
  _renderToolsPanel();
}

function _buyBackpack(packId) {
  const pack = BACKPACKS[packId];
  if (!pack || getMoney() < pack.price || playerInventory.capacity >= pack.slots) return;
  addMoney(-pack.price);
  playerInventory.upgradeBackpack(packId);
  _refreshMoney();
  window.dispatchEvent(new CustomEvent('inventory-changed'));
  _renderToolsPanel();
}

// ─────────────────────────────────────────────────────────────
//  PURCHASE ANIMATION
// ─────────────────────────────────────────────────────────────
function _playPurchaseAnim(card) {
  card.classList.add('shop-buy-flash');
  setTimeout(() => card.classList.remove('shop-buy-flash'), 600);
}

// ─────────────────────────────────────────────────────────────
//  SHARED HELPERS
// ─────────────────────────────────────────────────────────────
function _refreshMoney() {
  const money = getMoney();
  const el = document.querySelector('.shop-money');
  if (el) {
    el.textContent = `💰 $${money.toLocaleString()}`;
    el.classList.add('shop-money-tick');
    setTimeout(() => el.classList.remove('shop-money-tick'), 300);
  }
  if (_onMoneyChange) _onMoneyChange(money);
}

// ─────────────────────────────────────────────────────────────
//  TAB WIRING
// ─────────────────────────────────────────────────────────────
let _tabsWired = false;
function _wireTabs() {
  if (_tabsWired) return;
  _tabsWired = true;
  document.querySelectorAll('[data-shop-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (_activeShop === 'sellStall') {
        _showPanel('sell');
        return;
      }
      _showPanel(btn.dataset.shopTab);
    });
  });
}

// ─────────────────────────────────────────────────────────────
//  DAILY DEALS  (Part 5 integration)
// ─────────────────────────────────────────────────────────────
import { getDailyShopStock } from './aiContent.js';

let _dailyTimerRaf = null;
let _dailyLoaded   = false;

function _secsUntilMidnight() {
  const now = new Date();
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return Math.floor((midnight - now) / 1000);
}

function _tickDailyTimer() {
  const el = document.getElementById('shopDailyTimer');
  if (!el) return;
  const secs = _secsUntilMidnight();
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60);
  el.textContent = `Resets in ${h}h ${m}m`;
  if (_dailyTimerRaf) cancelAnimationFrame(_dailyTimerRaf);
  if (_isOpen) _dailyTimerRaf = requestAnimationFrame(_tickDailyTimer);
}

async function _loadDailyDeals() {
  if (_dailyLoaded) return;
  const grid = document.getElementById('shopDailyGrid');
  if (!grid) return;
  _dailyLoaded = true;

  grid.innerHTML = `<div class="shop-daily-loading"><div class="shop-daily-spinner"></div><span>Asking the merchant…</span></div>`;

  const depth    = window._playerDepthForShop ?? 0;
  const prestige = window._playerPrestige     ?? 0;

  try {
    const items = await getDailyShopStock(depth, prestige, []);
    grid.innerHTML = '';
    _renderDailyItems(grid, items);
  } catch {
    grid.innerHTML = '<div class="shop-empty">Merchant is away — check back soon.</div>';
  }
}

function _renderDailyItems(grid, items) {
  const money = getMoney();
  for (const item of items) {
    const canAfford = money >= item.price;
    const typeLabel = { consumable:'CONSUMABLE', upgrade:'UPGRADE', cosmetic:'COSMETIC', bundle:'BUNDLE' }[item.type] ?? item.type.toUpperCase();
    const card = document.createElement('div');
    card.className = 'shop-item-card daily-card';
    card.style.borderTopColor = item.colorHex ?? '#445566';
    const timerHtml  = item.hoursLeft ? `<div class="daily-timer">⏱ ${item.hoursLeft}h left</div>` : '';
    const bundleHtml = item.type === 'bundle' && item.items?.length
      ? `<div class="daily-bundle-items">${item.items.map(i => `<span>${i.replace(/_/g,' ')}</span>`).join(' + ')}</div>` : '';

    card.innerHTML = `
      <div class="daily-type-badge" style="background:${item.colorHex}22;color:${item.colorHex}">${typeLabel}</div>
      <div class="shop-item-emoji">${item.emoji}</div>
      <div class="shop-item-name">${item.name}</div>
      <div class="shop-item-desc">${item.desc}</div>
      ${bundleHtml}${timerHtml}
      <button class="shop-buy-btn ${canAfford ? '' : 'disabled'}"
              data-daily-buy="${item.id}" data-daily-price="${item.price}"
              data-daily-name="${item.name}" data-daily-emoji="${item.emoji}"
              ${canAfford ? '' : 'disabled'}>
        ${canAfford ? `$${item.price.toLocaleString()}` : `$${item.price.toLocaleString()} — need more`}
      </button>`;
    grid.appendChild(card);
  }

  grid.querySelectorAll('[data-daily-buy]').forEach(btn => {
    btn.addEventListener('click', () => {
      const price = Number(btn.dataset.dailyPrice);
      if (getMoney() < price) return;
      addMoney(-price);
      window.dispatchEvent(new CustomEvent('daily-item-bought', {
        detail: { id: btn.dataset.dailyBuy, name: btn.dataset.dailyName, emoji: btn.dataset.dailyEmoji, price },
      }));
      const card = btn.closest('.shop-item-card');
      if (card) _playPurchaseAnim(card);
      _refreshMoney();
      btn.textContent = '✓ PURCHASED'; btn.disabled = true; btn.classList.add('disabled');
    });
  });
}

// ─────────────────────────────────────────────────────────────
//  PUBLIC: check if upgrade owned  (used by game.js)
// ─────────────────────────────────────────────────────────────
export function isUpgradeOwned(id) { return _isOwned(id); }
