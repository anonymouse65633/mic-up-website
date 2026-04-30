// ============================================================
//  WalkWorld 3D — prestige.js  (PART 6)
//
//  Prestige system: two unlock paths
//    1. Money prestige  (10k → 20k → 40k…)
//    2. Rare item gates (P3: deep_rune, P5: void_shard, P7: sunstone)
//
//  Public API
//  ----------
//  initPrestige()                 — call once at game init
//  addLifetimeCoins(n)            — call whenever player earns coins
//  addPrestigeXP(n)               — call on ore finds / challenges / milestones
//  getPrestigeMultiplier()        → 1.0 + level * 0.10 (max 2.0)
//  isPrestigeAvailable()          → bool
//  getNextPrestigeThreshold()     → coin amount needed
//  performPrestige()              → increments level, resets shaft
//  grantRareItem(id)              → adds rare item to owned set, saves
//  hasRareItem(id)                → bool
//  getPrestigeState()             → full state snapshot
//  setOnPrestigeReady(fn)         → fn() when button should light up
//  setOnRareItemGranted(fn)       → fn(id, data)
// ============================================================

// ── Thresholds (doubles each level) ──────────────────────────
export const PRESTIGE_THRESHOLDS = [
  10_000, 20_000, 40_000, 80_000, 160_000,
  320_000, 640_000, 1_280_000, 2_560_000, 5_120_000,
];

// ── Rare item requirements at certain prestige levels ─────────
export const PRESTIGE_RARE_REQUIREMENTS = {
  3: 'deep_rune',
  5: 'void_shard',
  7: 'sunstone',
};

// ── Prestige XP thresholds (cosmetic track) ──────────────────
export const PRESTIGE_XP_TIERS = [
  { threshold: 0,      label: 'Miner',           color: '#888' },
  { threshold: 500,    label: 'Bronze Nameplate', color: '#cd7f32' },
  { threshold: 2000,   label: 'Silver Nameplate', color: '#c0c0c0' },
  { threshold: 5000,   label: 'Gold Nameplate',   color: '#ffd700' },
  { threshold: 12000,  label: 'Gem Nameplate',    color: '#88eeff' },
  { threshold: 30000,  label: 'Rainbow Nameplate',color: 'rainbow' },
  { threshold: 80000,  label: 'Legendary Aura',   color: 'aura' },
];

// ── Rare item definitions ─────────────────────────────────────
export const RARE_ITEM_DEFS = {
  deep_rune:       { name: 'Deep Rune',       emoji: '🪨', desc: 'Ancient stone tablet from Obsidian caves. Required for Prestige 3.', value: 800, source: 'obsidian_cave' },
  ancient_compass: { name: 'Ancient Compass', emoji: '🧭', desc: 'Shows nearest chest on minimap. Permanent.', value: 400, source: 'cabin' },
  void_shard:      { name: 'Void Shard',      emoji: '🔮', desc: 'Fragment of a Void Crystal. Required for Prestige 5.', value: 1200, source: 'void_cave' },
  earthquake_core: { name: 'Earthquake Core', emoji: '💥', desc: 'Destroys a 5×5 area on use. Required for one shop unlock.', value: 600, source: 'dense_ore_cave' },
  geo_crystal:     { name: 'Geo Crystal',     emoji: '💎', desc: 'Pure cosmetic from a Geode room. Crafted into a hat.', value: 300, source: 'geode' },
  sunstone:        { name: 'Sunstone',        emoji: '☀️', desc: 'Mythic ore found in The Void. Required for Prestige 7.', value: 3500, source: 'void_ore' },
  meteor_shard:    { name: 'Meteor Shard',    emoji: '☄️', desc: 'Fragment of a meteorite. Unique particle effect.', value: 200, source: 'meteor' },
  // 12 fossil types
  fossil_trilobite:  { name: 'Trilobite Fossil',   emoji: '🦀', desc: 'Ancient sea creature.', value: 150, source: 'deep', fossilIdx: 0 },
  fossil_ammonite:   { name: 'Ammonite Fossil',    emoji: '🐚', desc: 'Spiral shell creature.', value: 150, source: 'deep', fossilIdx: 1 },
  fossil_fern:       { name: 'Fern Fossil',        emoji: '🌿', desc: 'Prehistoric plant.', value: 150, source: 'deep', fossilIdx: 2 },
  fossil_fish:       { name: 'Fish Fossil',        emoji: '🐟', desc: 'Ancient fish skeleton.', value: 150, source: 'deep', fossilIdx: 3 },
  fossil_insect:     { name: 'Insect Fossil',      emoji: '🦗', desc: 'Trapped in ancient stone.', value: 150, source: 'deep', fossilIdx: 4 },
  fossil_claw:       { name: 'Claw Fossil',        emoji: '🦴', desc: 'Predator claw fragment.', value: 150, source: 'deep', fossilIdx: 5 },
  fossil_spine:      { name: 'Spine Fossil',       emoji: '🦎', desc: 'Vertebrae of unknown beast.', value: 150, source: 'deep', fossilIdx: 6 },
  fossil_leaf:       { name: 'Leaf Fossil',        emoji: '🍃', desc: 'Perfect leaf imprint.', value: 150, source: 'deep', fossilIdx: 7 },
  fossil_tooth:      { name: 'Tooth Fossil',       emoji: '🦷', desc: 'Massive ancient tooth.', value: 150, source: 'deep', fossilIdx: 8 },
  fossil_shell:      { name: 'Shell Fossil',       emoji: '🐌', desc: 'Coiled shell creature.', value: 150, source: 'deep', fossilIdx: 9 },
  fossil_eye:        { name: 'Eye Fossil',         emoji: '👁️', desc: 'Compound eye in stone.', value: 150, source: 'deep', fossilIdx: 10 },
  fossil_starfish:   { name: 'Starfish Fossil',    emoji: '⭐', desc: 'Perfect star shape.', value: 150, source: 'deep', fossilIdx: 11 },
};

// ── Module state ──────────────────────────────────────────────
let _level         = 0;
let _lifetimeCoins = 0;
let _prestigeXP    = 0;
let _rareItems     = new Set();    // item IDs owned
let _wasAvailable  = false;

let _onPrestigeReady   = null;
let _onRareItemGranted = null;

const SAVE_KEY = 'ww_prestige_v1';

// ── Persistence ───────────────────────────────────────────────
function _save() {
  try {
    sessionStorage.setItem(SAVE_KEY, JSON.stringify({
      level: _level,
      lifetimeCoins: _lifetimeCoins,
      prestigeXP: _prestigeXP,
      rareItems: [..._rareItems],
    }));
  } catch {}
}

function _load() {
  try {
    const s = JSON.parse(sessionStorage.getItem(SAVE_KEY) || 'null');
    if (!s) return;
    _level         = s.level         ?? 0;
    _lifetimeCoins = s.lifetimeCoins ?? 0;
    _prestigeXP    = s.prestigeXP    ?? 0;
    _rareItems     = new Set(s.rareItems ?? []);
  } catch {}
}

// ── Public API ────────────────────────────────────────────────
export function initPrestige() {
  _load();
  window._playerPrestige = _level;   // expose for Part 5 aiContent
}

export function addLifetimeCoins(n) {
  if (!n || n <= 0) return;
  _lifetimeCoins += n;
  _save();
  const avail = isPrestigeAvailable();
  if (avail && !_wasAvailable) {
    _wasAvailable = true;
    if (_onPrestigeReady) _onPrestigeReady();
  } else if (!avail) {
    _wasAvailable = false;
  }
}

export function addPrestigeXP(n) {
  if (!n || n <= 0) return;
  _prestigeXP += n;
  _save();
}

export function getPrestigeMultiplier() {
  return 1.0 + _level * 0.10;
}

export function isPrestigeAvailable() {
  if (_level >= PRESTIGE_THRESHOLDS.length) return false;
  const threshold = PRESTIGE_THRESHOLDS[_level];
  if (_lifetimeCoins < threshold) return false;
  // Check rare item requirement
  const reqLevel = _level + 1;
  const reqItem  = PRESTIGE_RARE_REQUIREMENTS[reqLevel];
  if (reqItem && !_rareItems.has(reqItem)) return false;
  return true;
}

export function getNextPrestigeThreshold() {
  if (_level >= PRESTIGE_THRESHOLDS.length) return Infinity;
  return PRESTIGE_THRESHOLDS[_level];
}

export function performPrestige() {
  if (!isPrestigeAvailable()) return false;
  _level++;
  // Don't reset lifetimeCoins — keep accumulating for next level
  window._playerPrestige = _level;
  _wasAvailable = false;
  _save();
  return true;
}

export function grantRareItem(id) {
  if (_rareItems.has(id)) return false;  // already owned
  _rareItems.add(id);
  _save();
  if (_onRareItemGranted) {
    _onRareItemGranted(id, RARE_ITEM_DEFS[id] ?? { name: id, emoji: '📦' });
  }
  return true;
}

export function hasRareItem(id) {
  return _rareItems.has(id);
}

export function getPrestigeState() {
  const threshold  = getNextPrestigeThreshold();
  const progress   = threshold < Infinity ? Math.min(_lifetimeCoins / threshold, 1) : 1;
  const xpTier     = [...PRESTIGE_XP_TIERS].reverse().find(t => _prestigeXP >= t.threshold) ?? PRESTIGE_XP_TIERS[0];
  const fossils    = [..._rareItems].filter(id => id.startsWith('fossil_')).length;
  const reqItem    = PRESTIGE_RARE_REQUIREMENTS[_level + 1] ?? null;
  return {
    level: _level,
    lifetimeCoins: _lifetimeCoins,
    threshold,
    progress,
    prestigeXP: _prestigeXP,
    xpTier,
    rareItems: [..._rareItems],
    fossils,
    fossilBonus: fossils >= 12 ? 0.05 : 0,
    multiplier: getPrestigeMultiplier(),
    available: isPrestigeAvailable(),
    reqItem,
    reqItemMet: reqItem ? _rareItems.has(reqItem) : true,
  };
}

export function getAllRareItemDefs() { return RARE_ITEM_DEFS; }

export function setOnPrestigeReady(fn)    { _onPrestigeReady   = fn; }
export function setOnRareItemGranted(fn)  { _onRareItemGranted = fn; }
