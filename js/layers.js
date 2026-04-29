// ============================================================
//  WalkWorld 3D — layers.js
//
//  Two systems live here:
//
//  1. LAYERS  — the five geological strata (Grass/Dirt → Dense Ore).
//               Each layer has a base dig value, colour, and wall tint.
//
//  2. ORES    — nine ore types (Coal → Void Crystal).
//               Every ore has a value, rarity, colour, and emoji.
//               rollOre(layerName) rolls a random ore (or null) using
//               per-layer probability tables so:
//                 • Coal / Iron / Copper are COMMON in their home layers
//                   but still possible deeper (just much less likely).
//                 • Gold / Emerald are UNCOMMON, centred on Dark Stone.
//                 • Ruby / Amethyst are RARE, start in Dark Stone,
//                   more common in Dense Ore.
//                 • Diamond is EPIC — very rare in Dark Stone, possible
//                   in Dense Ore.
//                 • Void Crystal is LEGENDARY — almost exclusively in
//                   Dense Ore, astronomically rare above it.
//
//  Exports:
//    LAYERS              — array of layer definitions
//    ORES                — map of oreId → ore definition
//    getMaterialAtDepth  — layer lookup by depth
//    rollOre             — probabilistic ore roller
// ============================================================

// ─────────────────────────────────────────────────────────────
//  GEOLOGICAL LAYERS  (surface → core)
// ─────────────────────────────────────────────────────────────
export const LAYERS = [
  {
    name     : 'Grass/Dirt',
    minDepth : 0,
    maxDepth : 5,
    value    : 2,          // base $ per punch (no ore found)
    color    : 0x6B8C42,
    hexColor : '#6B8C42',
    emoji    : '🌿',
    rarity   : 'common',
    bgGlow   : 'rgba(107,140,66,0.4)',
    wallHex  : '#4a6230',
  },
  {
    name     : 'Clay',
    minDepth : 5,
    maxDepth : 15,
    value    : 4,
    color    : 0xCC8855,
    hexColor : '#CC8855',
    emoji    : '🟤',
    rarity   : 'common',
    bgGlow   : 'rgba(204,136,85,0.4)',
    wallHex  : '#a06030',
  },
  {
    name     : 'Stone',
    minDepth : 15,
    maxDepth : 30,
    value    : 8,
    color    : 0x909090,
    hexColor : '#909090',
    emoji    : '🪨',
    rarity   : 'uncommon',
    bgGlow   : 'rgba(144,144,144,0.4)',
    wallHex  : '#606060',
  },
  {
    name     : 'Dark Stone',
    minDepth : 30,
    maxDepth : 60,
    value    : 18,
    color    : 0x3A3A66,
    hexColor : '#3A3A66',
    emoji    : '🔮',
    rarity   : 'rare',
    bgGlow   : 'rgba(58,58,102,0.55)',
    wallHex  : '#252545',
  },
  {
    name     : 'Dense Ore',
    minDepth : 60,
    maxDepth : 9999,
    value    : 35,
    color    : 0xFF7700,
    hexColor : '#FF7700',
    emoji    : '🌋',
    rarity   : 'epic',
    bgGlow   : 'rgba(255,119,0,0.65)',
    wallHex  : '#cc5500',
  },
];

export function getMaterialAtDepth(depth) {
  for (const layer of LAYERS) {
    if (depth >= layer.minDepth && depth < layer.maxDepth) return layer;
  }
  return LAYERS[LAYERS.length - 1];
}

// ─────────────────────────────────────────────────────────────
//  ORE DEFINITIONS
//  value = bonus $ on top of base layer value
// ─────────────────────────────────────────────────────────────
export const ORES = {
  coal: {
    id       : 'coal',
    name     : 'Coal',
    value    : 8,
    color    : 0x222222,
    hexColor : '#555555',
    emoji    : '🪨',
    rarity   : 'common',
    label    : 'COMMON',
    bgGlow   : 'rgba(80,80,80,0.4)',
    homeLayer: 'Stone',
    desc     : 'Burns well',
  },
  copper: {
    id       : 'copper',
    name     : 'Copper',
    value    : 18,
    color    : 0xCC6633,
    hexColor : '#CC6633',
    emoji    : '🟠',
    rarity   : 'common',
    label    : 'COMMON',
    bgGlow   : 'rgba(204,102,51,0.4)',
    homeLayer: 'Clay',
    desc     : 'Turns green over time',
  },
  iron: {
    id       : 'iron',
    name     : 'Iron',
    value    : 35,
    color    : 0xBB8866,
    hexColor : '#BB8866',
    emoji    : '🔩',
    rarity   : 'common',
    label    : 'COMMON',
    bgGlow   : 'rgba(187,136,102,0.45)',
    homeLayer: 'Stone',
    desc     : 'Workhorse of metals',
  },
  gold: {
    id       : 'gold',
    name     : 'Gold',
    value    : 90,
    color    : 0xFFCC00,
    hexColor : '#FFCC00',
    emoji    : '✨',
    rarity   : 'uncommon',
    label    : 'UNCOMMON',
    bgGlow   : 'rgba(255,204,0,0.5)',
    homeLayer: 'Dark Stone',
    desc     : 'Shiny and valuable',
  },
  emerald: {
    id       : 'emerald',
    name     : 'Emerald',
    value    : 130,
    color    : 0x00DD66,
    hexColor : '#00DD66',
    emoji    : '💚',
    rarity   : 'uncommon',
    label    : 'UNCOMMON',
    bgGlow   : 'rgba(0,220,100,0.5)',
    homeLayer: 'Dark Stone',
    desc     : 'Vivid and striking',
  },
  ruby: {
    id       : 'ruby',
    name     : 'Ruby',
    value    : 180,
    color    : 0xFF2244,
    hexColor : '#FF2244',
    emoji    : '❤️‍🔥',
    rarity   : 'rare',
    label    : 'RARE',
    bgGlow   : 'rgba(255,34,68,0.55)',
    homeLayer: 'Dark Stone',
    desc     : 'Fiery red gem',
  },
  amethyst: {
    id       : 'amethyst',
    name     : 'Amethyst',
    value    : 220,
    color    : 0xAA44FF,
    hexColor : '#AA44FF',
    emoji    : '💜',
    rarity   : 'rare',
    label    : 'RARE',
    bgGlow   : 'rgba(170,68,255,0.6)',
    homeLayer: 'Dense Ore',
    desc     : 'Regal purple crystal',
  },
  diamond: {
    id       : 'diamond',
    name     : 'Diamond',
    value    : 400,
    color    : 0x88EEFF,
    hexColor : '#88EEFF',
    emoji    : '💎',
    rarity   : 'epic',
    label    : 'EPIC',
    bgGlow   : 'rgba(136,238,255,0.65)',
    homeLayer: 'Dense Ore',
    desc     : 'The hardest thing here',
  },
  void_crystal: {
    id       : 'void_crystal',
    name     : 'Void Crystal',
    value    : 750,
    color    : 0x220044,
    hexColor : '#CC00FF',
    emoji    : '🔮',
    rarity   : 'legendary',
    label    : 'LEGENDARY',
    bgGlow   : 'rgba(200,0,255,0.7)',
    homeLayer: 'Dense Ore',
    desc     : 'From beyond the world',
  },
};

// ─────────────────────────────────────────────────────────────
//  ORE PROBABILITY TABLES  (per-layer)
//
//  Format: [ [oreId, cumulativeProbability], … ]
//  Entries MUST be sorted ascending by cumulativeProbability.
//  Roll = Math.random(); pick first entry where roll < threshold.
//  If no entry matches → no ore this punch (just base layer value).
//
//  Design goals:
//    • Coal / Iron / Copper are "home" in Stone — frequent there,
//      still appear deeper but thin out fast.
//    • Gold / Emerald peak in Dark Stone.
//    • Ruby / Amethyst straddle Dark Stone / Dense Ore boundary.
//    • Diamond is Dense Ore territory, rare everywhere else.
//    • Void Crystal almost exclusively in Dense Ore.
//    • Every ore CAN appear in other layers — just increasingly
//      unlikely the further you are from its home.
// ─────────────────────────────────────────────────────────────
const ORE_TABLE = {
  'Grass/Dirt': [
    // Surface scratchings — only the odd coal seam or copper fleck
    ['coal',   0.030],   //  3%
    ['copper', 0.040],   //  1%
  ],

  'Clay': [
    // Copper is common here; iron starts appearing; tiny coal seams
    ['coal',   0.100],   // 10%
    ['copper', 0.240],   // 14%  ← copper home layer
    ['iron',   0.270],   //  3%
  ],

  'Stone': [
    // Coal and iron are abundant; copper trailing off; gold/amethyst faint
    ['coal',    0.220],  // 22%  ← coal home layer
    ['copper',  0.290],  //  7%  (still possible, less than Clay)
    ['iron',    0.480],  // 19%  ← iron home layer
    ['gold',    0.500],  //  2%  (rare here)
    ['emerald', 0.504],  //  0.4%
    ['ruby',    0.506],  //  0.2%
    ['amethyst',0.508],  //  0.2%
    ['diamond', 0.5085], //  0.05%
    // void_crystal: not present at this depth
  ],

  'Dark Stone': [
    // Coal/copper fade; iron still around; gold & emerald thrive;
    // ruby/amethyst emerge; diamond becomes possible
    ['coal',        0.040],  //  4%
    ['copper',      0.055],  //  1.5%
    ['iron',        0.120],  //  6.5%
    ['gold',        0.280],  // 16%  ← gold home layer
    ['emerald',     0.360],  //  8%  ← emerald home layer
    ['ruby',        0.420],  //  6%  ← ruby home layer (starts here)
    ['amethyst',    0.465],  //  4.5%
    ['diamond',     0.477],  //  1.2%
    ['void_crystal',0.478],  //  0.1%
  ],

  'Dense Ore': [
    // Surface ores rare; gold/emerald still good; ruby/amethyst peak;
    // diamond & void crystal at their best
    ['coal',        0.015],  //  1.5%
    ['copper',      0.025],  //  1%
    ['iron',        0.065],  //  4%
    ['gold',        0.135],  //  7%
    ['emerald',     0.205],  //  7%
    ['ruby',        0.280],  //  7.5%  ← also home layer for ruby
    ['amethyst',    0.370],  //  9%   ← amethyst home layer
    ['diamond',     0.410],  //  4%   ← diamond home layer
    ['void_crystal',0.425],  //  1.5% ← void_crystal home layer
  ],
};

/**
 * Roll a random ore for the current layer.
 * @param {string} layerName — e.g. 'Stone', 'Dark Stone'
 * @returns {object|null}    — one of the ORES entries, or null (no ore)
 */
export function rollOre(layerName) {
  const table = ORE_TABLE[layerName];
  if (!table) return null;

  const r = Math.random();
  for (const [oreId, threshold] of table) {
    if (r < threshold) return ORES[oreId];
  }
  return null; // no ore this punch
}
