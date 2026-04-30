// ============================================================
//  WalkWorld 3D — shop.js
//
//  Part 4 — Plaza shops (upgrade + sell)
//    • toolShop  — buy shovels & pickaxes
//    • gearShop  — buy backpack upgrades
//    • sellStall — sell mined inventory for coins
// ============================================================

import { TOOLS, BACKPACKS, SELL_PRICES, ITEM_EMOJIS, playerInventory } from './inventory.js';
import { getMoney, addMoney } from './mining.js';

// ─────────────────────────────────────────────────────────────
//  SHOP DEFINITIONS
// ─────────────────────────────────────────────────────────────
export const SHOPS = {
  toolShop: {
    id: 'toolShop',
    name: '⛏ Tool Shop',
    npcName: 'TOOL SMITH',
    desc: 'Buy better shovels and pickaxes.',
    color: '#c0823a',
    items: [
      { type: 'tool', id: 'stone_shovel'  },
      { type: 'tool', id: 'iron_shovel'   },
      { type: 'tool', id: 'gold_shovel'   },
      { type: 'tool', id: 'diamond_shovel'},
      { type: 'tool', id: 'stone_pick'    },
      { type: 'tool', id: 'iron_pick'     },
      { type: 'tool', id: 'diamond_pick'  },
    ],
  },
  gearShop: {
    id: 'gearShop',
    name: '🎒 Gear Shop',
    npcName: 'OUTFITTER',
    desc: 'Upgrade your backpack capacity.',
    color: '#3a8c5a',
    items: [
      { type: 'backpack', id: 'small'  },
      { type: 'backpack', id: 'medium' },
      { type: 'backpack', id: 'large'  },
    ],
  },
  sellStall: {
    id: 'sellStall',
    name: '💰 Sell Stall',
    npcName: 'ORE TRADER',
    desc: 'Sell your mined ores and blocks.',
    color: '#8c3a8c',
    items: [], // dynamic — filled from inventory
  },
};

// World positions of each shop in the Plaza
export const SHOP_POSITIONS = {
  toolShop:  { x: -12, z: -14 },
  gearShop:  { x:   0, z: -14 },
  sellStall: { x:  12, z: -14 },
};

export const SHOP_PROXIMITY = 5.5; // units to trigger E prompt

// ─────────────────────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────────────────────
let _isOpen      = false;
let _activeShop  = null;
let _onMoneyChange = null; // callback(newMoney)

export function isShopOpen() { return _isOpen; }

export function setMoneyChangeCallback(cb) { _onMoneyChange = cb; }

// ─────────────────────────────────────────────────────────────
//  PROXIMITY CHECK  (called every frame from game.js)
// ─────────────────────────────────────────────────────────────
/**
 * Returns the id of the nearest shop within range, or null.
 */
export function getNearestShop(px, pz) {
  let bestId   = null;
  let bestDist = Infinity;
  for (const [id, pos] of Object.entries(SHOP_POSITIONS)) {
    const dx = px - pos.x;
    const dz = pz - pos.z;
    const d  = Math.sqrt(dx * dx + dz * dz);
    if (d < SHOP_PROXIMITY && d < bestDist) {
      bestDist = d;
      bestId   = id;
    }
  }
  return bestId;
}

// ─────────────────────────────────────────────────────────────
//  OPEN / CLOSE
// ─────────────────────────────────────────────────────────────
export function openShop(shopId) {
  const shop = SHOPS[shopId];
  if (!shop) return;
  _isOpen     = true;
  _activeShop = shopId;
  _renderShop(shop);
  document.getElementById('shopOverlay')?.classList.remove('hidden');
  // Always start on stock tab
  _switchShopTab('stock');
  // Kick off daily deals load (non-blocking)
  _loadDailyDeals();
  // Start reset timer tick
  _tickDailyTimer();
}

export function closeShop() {
  _isOpen     = false;
  _activeShop = null;
  document.getElementById('shopOverlay')?.classList.add('hidden');
}

// ─────────────────────────────────────────────────────────────
//  RENDER SHOP UI
// ─────────────────────────────────────────────────────────────
function _renderShop(shop) {
  const overlay = document.getElementById('shopOverlay');
  if (!overlay) return;

  const money = getMoney();

  // Header
  overlay.querySelector('.shop-title').textContent = shop.name;
  overlay.querySelector('.shop-npc').textContent   = shop.npcName;
  overlay.querySelector('.shop-desc').textContent  = shop.desc;
  overlay.querySelector('.shop-money').textContent = `💰 $${money.toLocaleString()}`;

  const grid = overlay.querySelector('#shopStockGrid');
  grid.innerHTML = '';

  if (shop.id === 'sellStall') {
    _renderSellStall(grid, money);
    return;
  }

  for (const entry of shop.items) {
    const card = document.createElement('div');
    card.className = 'shop-item-card';

    if (entry.type === 'tool') {
      const tool = TOOLS[entry.id];
      if (!tool) continue;
      const canAfford = money >= tool.price;
      const owned     = playerInventory.hotbar.some(s => s?.tool.id === tool.id);

      card.innerHTML = `
        <div class="shop-item-emoji">${tool.emoji}</div>
        <div class="shop-item-name">${tool.name}</div>
        <div class="shop-item-stats">
          <span>⚡ ${tool.digSpeed}x speed</span>
          <span>🛡 ${tool.durability} uses</span>
        </div>
        <div class="shop-item-desc">${tool.desc}</div>
        <button class="shop-buy-btn ${!canAfford || owned ? 'disabled' : ''}"
                data-buy-tool="${tool.id}"
                ${!canAfford || owned ? 'disabled' : ''}>
          ${owned ? '✓ OWNED' : canAfford ? `$${tool.price}` : `$${tool.price} (need more)`}
        </button>`;
    } else if (entry.type === 'backpack') {
      const pack    = BACKPACKS[entry.id];
      if (!pack) continue;
      const canAfford = money >= pack.price;
      const owned     = playerInventory.capacity >= pack.slots;

      card.innerHTML = `
        <div class="shop-item-emoji">🎒</div>
        <div class="shop-item-name">${pack.name}</div>
        <div class="shop-item-stats"><span>📦 ${pack.slots} slots</span></div>
        <div class="shop-item-desc">Carries more loot.</div>
        <button class="shop-buy-btn ${!canAfford || owned ? 'disabled' : ''}"
                data-buy-pack="${pack.id}"
                ${!canAfford || owned ? 'disabled' : ''}>
          ${owned ? '✓ OWNED' : canAfford ? `$${pack.price}` : `$${pack.price} (need more)`}
        </button>`;
    }

    grid.appendChild(card);
  }

  // Buy handlers
  grid.querySelectorAll('[data-buy-tool]').forEach(btn => {
    btn.addEventListener('click', () => _buyTool(btn.dataset.buyTool));
  });
  grid.querySelectorAll('[data-buy-pack]').forEach(btn => {
    btn.addEventListener('click', () => _buyBackpack(btn.dataset.buyPack));
  });
}

function _renderSellStall(grid, money) {
  const slots = playerInventory.slots.filter(Boolean);

  if (slots.length === 0) {
    grid.innerHTML = '<div class="shop-empty">Your bag is empty.<br>Mine some ores first!</div>';
    return;
  }

  // Group by item id
  const grouped = {};
  for (const slot of slots) {
    if (!grouped[slot.id]) grouped[slot.id] = { ...slot, count: 0 };
    grouped[slot.id].count += slot.count;
  }

  let sellAllTotal = 0;

  for (const item of Object.values(grouped)) {
    const price    = SELL_PRICES[item.id] || 1;
    const subtotal = price * item.count;
    sellAllTotal  += subtotal;

    const card = document.createElement('div');
    card.className = 'shop-item-card sell-card';
    card.innerHTML = `
      <div class="shop-item-emoji">${ITEM_EMOJIS[item.id] || '📦'}</div>
      <div class="shop-item-name">${item.name}</div>
      <div class="shop-item-stats">
        <span>×${item.count}</span>
        <span>$${price} ea</span>
        <span>= $${subtotal}</span>
      </div>`;
    grid.appendChild(card);
  }

  // Sell All button
  const sellBtn = document.createElement('button');
  sellBtn.className = 'shop-sell-all-btn';
  sellBtn.textContent = `💰 SELL ALL — $${sellAllTotal.toLocaleString()}`;
  sellBtn.addEventListener('click', () => _sellAll(sellAllTotal));
  grid.appendChild(sellBtn);
}

// ─────────────────────────────────────────────────────────────
//  BUY / SELL LOGIC
// ─────────────────────────────────────────────────────────────
function _buyTool(toolId) {
  const tool = TOOLS[toolId];
  if (!tool) return;
  const money = getMoney();
  if (money < tool.price) return;

  // Find first empty hotbar slot after the first two defaults
  let slot = playerInventory.hotbar.findIndex((s, i) => i >= 2 && s === null);
  if (slot === -1) slot = 2; // overwrite slot 3 if full

  addMoney(-tool.price);
  playerInventory.setHotbarTool(toolId, slot);

  // Refresh shop UI + notify game.js to rebuild hotbar
  _refreshAfterBuy();
  window.dispatchEvent(new CustomEvent('hotbar-changed'));
}

function _buyBackpack(packId) {
  const pack = BACKPACKS[packId];
  if (!pack) return;
  const money = getMoney();
  if (money < pack.price) return;
  if (playerInventory.capacity >= pack.slots) return;

  addMoney(-pack.price);
  playerInventory.upgradeBackpack(packId);

  _refreshAfterBuy();
  window.dispatchEvent(new CustomEvent('inventory-changed'));
}

function _sellAll(total) {
  playerInventory.clearAll();
  addMoney(total);
  _refreshAfterBuy();
  window.dispatchEvent(new CustomEvent('inventory-changed'));
}

function _refreshAfterBuy() {
  const money = getMoney();
  const moneyEl = document.querySelector('.shop-money');
  if (moneyEl) moneyEl.textContent = `💰 $${money.toLocaleString()}`;
  if (_onMoneyChange) _onMoneyChange(money);
  // Re-render shop contents
  if (_activeShop) _renderShop(SHOPS[_activeShop]);
}

// ─────────────────────────────────────────────────────────────
//  PART 5 — DAILY DEALS  (AI-powered daily shop tab)
// ─────────────────────────────────────────────────────────────
import { getDailyShopStock } from './aiContent.js';

let _dailyTimerRaf = null;

function _switchShopTab(tab) {
  const stockGrid  = document.getElementById('shopStockGrid');
  const dailyPanel = document.getElementById('shopDailyPanel');
  document.querySelectorAll('.shop-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.shopTab === tab);
  });
  if (tab === 'daily') {
    stockGrid?.classList.add('hidden');
    dailyPanel?.classList.remove('hidden');
  } else {
    stockGrid?.classList.remove('hidden');
    dailyPanel?.classList.add('hidden');
  }
}

// Wire tab buttons — called once on first open
let _tabsWired = false;
function _wireTabs() {
  if (_tabsWired) return;
  _tabsWired = true;
  document.querySelectorAll('[data-shop-tab]').forEach(btn => {
    btn.addEventListener('click', () => _switchShopTab(btn.dataset.shopTab));
  });
}

// Seconds until UTC midnight
function _secsUntilMidnight() {
  const now = new Date();
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return Math.floor((midnight - now) / 1000);
}

function _tickDailyTimer() {
  _wireTabs();
  const el = document.getElementById('shopDailyTimer');
  if (!el) return;
  const secs = _secsUntilMidnight();
  const h    = Math.floor(secs / 3600);
  const m    = Math.floor((secs % 3600) / 60);
  el.textContent = `Resets in ${h}h ${m}m`;
  if (_dailyTimerRaf) cancelAnimationFrame(_dailyTimerRaf);
  if (_isOpen) _dailyTimerRaf = requestAnimationFrame(_tickDailyTimer);
}

async function _loadDailyDeals() {
  const grid = document.getElementById('shopDailyGrid');
  if (!grid) return;

  // Show spinner
  grid.innerHTML = `
    <div class="shop-daily-loading">
      <div class="shop-daily-spinner"></div>
      <span>Asking the merchant…</span>
    </div>`;

  // Gather player context
  const depth    = window._playerDepthForShop ?? 0;
  const prestige = window._playerPrestige     ?? 0;
  const ownedIds = [];  // could pull from playerInventory if needed

  try {
    const items = await getDailyShopStock(depth, prestige, ownedIds);
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

    const timerHtml = item.hoursLeft
      ? `<div class="daily-timer">⏱ ${item.hoursLeft}h left</div>`
      : '';

    const bundleHtml = item.type === 'bundle' && item.items?.length
      ? `<div class="daily-bundle-items">${item.items.map(i => `<span>${i.replace(/_/g,' ')}</span>`).join(' + ')}</div>`
      : '';

    card.innerHTML = `
      <div class="daily-type-badge" style="background:${item.colorHex}22;color:${item.colorHex}">${typeLabel}</div>
      <div class="shop-item-emoji">${item.emoji}</div>
      <div class="shop-item-name">${item.name}</div>
      <div class="shop-item-desc">${item.desc}</div>
      ${bundleHtml}
      ${timerHtml}
      <button class="shop-buy-btn ${canAfford ? '' : 'disabled'}"
              data-daily-buy="${item.id}"
              data-daily-price="${item.price}"
              data-daily-name="${item.name}"
              data-daily-emoji="${item.emoji}"
              ${canAfford ? '' : 'disabled'}>
        ${canAfford ? `$${item.price.toLocaleString()}` : `$${item.price.toLocaleString()} — need more`}
      </button>`;

    grid.appendChild(card);
  }

  // Wire buy buttons
  grid.querySelectorAll('[data-daily-buy]').forEach(btn => {
    btn.addEventListener('click', () => {
      const price = Number(btn.dataset.dailyPrice);
      if (getMoney() < price) return;
      addMoney(-price);
      // Add to inventory as a generic consumable item
      const event = new CustomEvent('daily-item-bought', {
        detail: {
          id:    btn.dataset.dailyBuy,
          name:  btn.dataset.dailyName,
          emoji: btn.dataset.dailyEmoji,
          price,
        },
      });
      window.dispatchEvent(event);
      // Refresh money display
      const moneyEl = document.querySelector('.shop-money');
      if (moneyEl) moneyEl.textContent = `💰 $${getMoney().toLocaleString()}`;
      if (_onMoneyChange) _onMoneyChange(getMoney());
      // Mark button as owned
      btn.textContent = '✓ PURCHASED';
      btn.disabled    = true;
      btn.classList.add('disabled');
    });
  });
}
