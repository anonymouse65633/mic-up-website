// ============================================================
//  WalkWorld 3D — inventory.js
//
//  Part 1 — Tool definitions (dig speed, durability, tier)
//  Part 3 — Inventory / backpack system
//  Part 5 — Sell prices, durability tracking
// ============================================================

// ─────────────────────────────────────────────────────────────
//  TOOL DEFINITIONS
//  digSpeed: multiplier on base DIG_COOLDOWN (1.0 = normal)
//  durability: max punches before broken
//  hardnessReq: minimum layer tier tool can break efficiently
// ─────────────────────────────────────────────────────────────
export const TOOLS = {
  wooden_shovel: {
    id: 'wooden_shovel', name: 'Wooden Shovel', emoji: '🪵',
    digSpeed: 1.0, durability: 60,  tier: 1, price: 0,
    desc: 'Starter tool. Handles dirt and clay.',
  },
  stone_shovel: {
    id: 'stone_shovel', name: 'Stone Shovel', emoji: '🪨',
    digSpeed: 1.8, durability: 130, tier: 2, price: 50,
    desc: 'Breaks stone layers.',
  },
  iron_shovel: {
    id: 'iron_shovel', name: 'Iron Shovel', emoji: '⚙️',
    digSpeed: 2.8, durability: 250, tier: 3, price: 200,
    desc: 'Fast and durable.',
  },
  gold_shovel: {
    id: 'gold_shovel', name: 'Gold Shovel', emoji: '✨',
    digSpeed: 4.0, durability: 120, tier: 4, price: 400,
    desc: 'Blazing fast but fragile.',
  },
  diamond_shovel: {
    id: 'diamond_shovel', name: 'Diamond Shovel', emoji: '💎',
    digSpeed: 6.0, durability: 500, tier: 5, price: 1200,
    desc: 'The ultimate digging machine.',
  },
  wooden_pick: {
    id: 'wooden_pick', name: 'Wooden Pickaxe', emoji: '⛏️',
    digSpeed: 1.2, durability: 70,  tier: 1, price: 0,
    desc: 'Basic pickaxe for stone.',
  },
  stone_pick: {
    id: 'stone_pick', name: 'Stone Pickaxe', emoji: '🔨',
    digSpeed: 2.2, durability: 150, tier: 2, price: 80,
    desc: 'Better for deeper layers.',
  },
  iron_pick: {
    id: 'iron_pick', name: 'Iron Pickaxe', emoji: '🔧',
    digSpeed: 3.5, durability: 300, tier: 3, price: 350,
    desc: 'Chews through dark stone.',
  },
  diamond_pick: {
    id: 'diamond_pick', name: 'Diamond Pickaxe', emoji: '💠',
    digSpeed: 5.5, durability: 600, tier: 5, price: 1500,
    desc: 'Reaches the densest ore.',
  },
  detector: {
    id: 'detector', name: 'Ore Detector', emoji: '📡',
    digSpeed: 0,   durability: 9999, tier: 0, price: 0,
    desc: 'Pulses near ore deposits.',
  },
};

// ─────────────────────────────────────────────────────────────
//  BACKPACK TIERS
// ─────────────────────────────────────────────────────────────
export const BACKPACKS = {
  starter:  { id: 'starter',  name: 'Starter Bag',    slots: 9,  price: 0    },
  small:    { id: 'small',    name: 'Small Backpack',  slots: 18, price: 150  },
  medium:   { id: 'medium',   name: 'Medium Backpack', slots: 27, price: 400  },
  large:    { id: 'large',    name: 'Large Backpack',  slots: 36, price: 900  },
};

// ─────────────────────────────────────────────────────────────
//  SELL PRICES  (at the Sell Stall)
//  These are BONUS prices on top of the auto-earn per punch.
// ─────────────────────────────────────────────────────────────
export const SELL_PRICES = {
  'Grass/Dirt': 1,
  'Clay':       2,
  'Stone':      5,
  'Dark Stone': 12,
  'Dense Ore':  30,
  // Ores:
  coal:         8,
  copper:       15,
  iron:         20,
  gold:         60,
  emerald:      80,
  ruby:         120,
  amethyst:     150,
  diamond:      200,
  void_crystal: 500,
};

export const ITEM_EMOJIS = {
  'Grass/Dirt': '🌿',
  'Clay':       '🟤',
  'Stone':      '🪨',
  'Dark Stone': '🔮',
  'Dense Ore':  '🌋',
  coal:         '🪨',
  copper:       '🟠',
  iron:         '🔩',
  gold:         '✨',
  emerald:      '💚',
  ruby:         '❤️‍🔥',
  amethyst:     '💜',
  diamond:      '💎',
  void_crystal: '🔮',
};

// ─────────────────────────────────────────────────────────────
//  INVENTORY CLASS
// ─────────────────────────────────────────────────────────────
export class Inventory {
  constructor() {
    this.backpackTier = 'starter';
    this.capacity     = 9;
    this.slots        = new Array(this.capacity).fill(null);

    // Hotbar: 9 slots, each = { tool, durLeft } or null
    this.hotbar = [
      { tool: TOOLS.wooden_shovel, durLeft: TOOLS.wooden_shovel.durability },
      { tool: TOOLS.detector,      durLeft: TOOLS.detector.durability },
      null, null, null, null, null, null, null,
    ];
    this.activeSlot = 0; // 0-indexed
  }

  // ── Tool helpers ──────────────────────────────────────────
  getActiveTool() {
    const s = this.hotbar[this.activeSlot];
    return s ? s.tool : null;
  }

  getActiveHotbarSlot() {
    return this.hotbar[this.activeSlot];
  }

  /** Returns 0.0-1.0 durability fraction for active tool */
  getActiveDurabilityFrac() {
    const s = this.hotbar[this.activeSlot];
    if (!s) return 1;
    return s.durLeft / s.tool.durability;
  }

  /**
   * Damage active tool by `amount`.
   * Returns true if the tool just broke.
   */
  damageTool(amount = 1) {
    const s = this.hotbar[this.activeSlot];
    if (!s || s.tool.durability >= 9999) return false;
    s.durLeft = Math.max(0, s.durLeft - amount);
    return s.durLeft === 0;
  }

  isActiveBroken() {
    const s = this.hotbar[this.activeSlot];
    return s ? (s.durLeft === 0) : true;
  }

  /** Place a tool into a hotbar slot (replaces whatever was there) */
  setHotbarTool(toolId, slotIndex = 0) {
    const tool = TOOLS[toolId];
    if (!tool) return;
    this.hotbar[slotIndex] = { tool, durLeft: tool.durability };
  }

  // ── Inventory helpers ─────────────────────────────────────
  /** Add one item. Returns true if it fit, false if bag full. */
  addItem(itemId, displayName) {
    // Try to stack
    for (const slot of this.slots) {
      if (slot && slot.id === itemId && slot.count < 64) {
        slot.count++;
        return true;
      }
    }
    // Find empty slot
    const idx = this.slots.indexOf(null);
    if (idx === -1) return false;
    this.slots[idx] = {
      id:    itemId,
      name:  displayName || itemId,
      emoji: ITEM_EMOJIS[itemId] || '📦',
      count: 1,
    };
    return true;
  }

  countItem(itemId) {
    let n = 0;
    for (const s of this.slots) if (s && s.id === itemId) n += s.count;
    return n;
  }

  totalItems() {
    return this.slots.filter(Boolean).reduce((a, s) => a + s.count, 0);
  }

  isFull() {
    return !this.slots.includes(null) &&
      !this.slots.some(s => s && s.count < 64);
  }

  /** Remove all items and return them (for sell-all). */
  clearAll() {
    const items = this.slots.filter(Boolean);
    this.slots = new Array(this.capacity).fill(null);
    return items;
  }

  /** Upgrade backpack; returns false if already at or above this tier. */
  upgradeBackpack(tierId) {
    const tier = BACKPACKS[tierId];
    if (!tier || tier.slots <= this.capacity) return false;
    this.backpackTier = tierId;
    this.capacity     = tier.slots;
    // Extend slots array
    while (this.slots.length < this.capacity) this.slots.push(null);
    return true;
  }
}

// Singleton
export const playerInventory = new Inventory();
