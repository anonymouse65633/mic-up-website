// ============================================================
//  WalkWorld 3D — layers.js  (PART 3 REWRITE)
//
//  12-ore rebalanced system:
//  • Depth bands per ore — ores only spawn within their valid range
//  • Rebalanced ORE_TABLE — Dense Ore max ~3.5%, no layer exceeds 12%
//  • 3 new ores: Tin (Sandstone), Sapphire (Obsidian), Sunstone (Void)
//  • All probability values are cumulative thresholds for rollOre()
// ============================================================

export const LAYERS = [
  {
    name:'Grass/Dirt', minDepth:0,   maxDepth:6,    value:2,  punches:1,
    color:0x6B8C42, hexColor:'#6B8C42', emoji:'🌿', rarity:'common',
    bgGlow:'rgba(107,140,66,0.4)', wallHex:'#4a6230', shakeAmt:0.03, soundTier:0,
  },
  {
    name:'Clay',       minDepth:6,   maxDepth:18,   value:4,  punches:2,
    color:0xCC8855, hexColor:'#CC8855', emoji:'🟤', rarity:'common',
    bgGlow:'rgba(204,136,85,0.4)', wallHex:'#a06030', shakeAmt:0.03, soundTier:0,
  },
  {
    name:'Stone',      minDepth:18,  maxDepth:42,   value:8,  punches:3,
    color:0x909090, hexColor:'#909090', emoji:'🪨', rarity:'uncommon',
    bgGlow:'rgba(144,144,144,0.4)', wallHex:'#606060', shakeAmt:0.07, soundTier:1,
  },
  {
    name:'Sandstone',  minDepth:42,  maxDepth:65,   value:14, punches:4,
    color:0xC8A060, hexColor:'#C8A060', emoji:'🏜', rarity:'uncommon',
    bgGlow:'rgba(200,160,96,0.4)', wallHex:'#9a7040', shakeAmt:0.07, soundTier:1,
  },
  {
    name:'Dark Stone', minDepth:65,  maxDepth:110,  value:18, punches:5,
    color:0x3A3A66, hexColor:'#3A3A66', emoji:'🔮', rarity:'rare',
    bgGlow:'rgba(58,58,102,0.55)', wallHex:'#252545', shakeAmt:0.14, soundTier:2,
  },
  {
    name:'Obsidian',   minDepth:110, maxDepth:160,  value:28, punches:8,
    color:0x1A1A2E, hexColor:'#1A1A2E', emoji:'⬛', rarity:'rare',
    bgGlow:'rgba(26,26,46,0.7)', wallHex:'#0d0d1a', shakeAmt:0.14, soundTier:2,
  },
  {
    name:'Dense Ore',  minDepth:160, maxDepth:250,  value:35, punches:12,
    color:0xFF7700, hexColor:'#FF7700', emoji:'🌋', rarity:'epic',
    bgGlow:'rgba(255,119,0,0.65)', wallHex:'#cc5500', shakeAmt:0.2, soundTier:3,
  },
  {
    name:'The Void',   minDepth:250, maxDepth:9999, value:60, punches:20,
    color:0x220033, hexColor:'#220033', emoji:'🕳', rarity:'legendary',
    bgGlow:'rgba(34,0,51,0.9)', wallHex:'#110022', shakeAmt:0.2, soundTier:3,
  },
];

export function getMaterialAtDepth(depth) {
  for (const layer of LAYERS) {
    if (depth >= layer.minDepth && depth < layer.maxDepth) return layer;
  }
  return LAYERS[LAYERS.length - 1];
}

// ─────────────────────────────────────────────────────────────
//  ORE DEFINITIONS  (12 ores, with depth bands)
//
//  depthBand: [minDepth, maxDepth] — ore will NOT spawn outside
//  this range even if it appears in that layer's ORE_TABLE.
//  Prevents farming exploits (e.g. reaching Diamond depth early).
// ─────────────────────────────────────────────────────────────
export const ORES = {
  coal:        { id:'coal',        name:'Coal',         value:8,    color:0x222222, hexColor:'#555555', emoji:'🪨', rarity:'common',    label:'COMMON',    bgGlow:'rgba(80,80,80,0.4)',       homeLayer:'Stone',     desc:'Burns well',                  depthBand:[0,   9999] },
  copper:      { id:'copper',      name:'Copper',       value:18,   color:0xCC6633, hexColor:'#CC6633', emoji:'🟠', rarity:'common',    label:'COMMON',    bgGlow:'rgba(204,102,51,0.4)',     homeLayer:'Clay',      desc:'Turns green over time',       depthBand:[0,   65]   },
  iron:        { id:'iron',        name:'Iron',         value:35,   color:0xBB8866, hexColor:'#BB8866', emoji:'🔩', rarity:'common',    label:'COMMON',    bgGlow:'rgba(187,136,102,0.45)',   homeLayer:'Stone',     desc:'Workhorse of metals',         depthBand:[0,   110]  },
  tin:         { id:'tin',         name:'Tin',          value:28,   color:0xC8C8AA, hexColor:'#C8C8AA', emoji:'🥈', rarity:'common',    label:'COMMON',    bgGlow:'rgba(200,200,170,0.4)',    homeLayer:'Sandstone', desc:'Dull but useful',             depthBand:[30,  110]  },
  gold:        { id:'gold',        name:'Gold',         value:90,   color:0xFFCC00, hexColor:'#FFCC00', emoji:'✨', rarity:'uncommon',  label:'UNCOMMON',  bgGlow:'rgba(255,204,0,0.5)',      homeLayer:'Sandstone', desc:'Shiny and valuable',          depthBand:[42,  100]  },
  emerald:     { id:'emerald',     name:'Emerald',      value:130,  color:0x00DD66, hexColor:'#00DD66', emoji:'💚', rarity:'uncommon',  label:'UNCOMMON',  bgGlow:'rgba(0,220,100,0.5)',      homeLayer:'Dark Stone',desc:'Vivid and striking',          depthBand:[55,  160]  },
  sapphire:    { id:'sapphire',    name:'Sapphire',     value:165,  color:0x4488FF, hexColor:'#4488FF', emoji:'💙', rarity:'uncommon',  label:'UNCOMMON',  bgGlow:'rgba(68,136,255,0.5)',     homeLayer:'Obsidian',  desc:'Deep blue clarity',           depthBand:[90,  250]  },
  ruby:        { id:'ruby',        name:'Ruby',         value:210,  color:0xFF2244, hexColor:'#FF2244', emoji:'❤️‍🔥', rarity:'rare', label:'RARE',      bgGlow:'rgba(255,34,68,0.55)',     homeLayer:'Obsidian',  desc:'Fiery red gem',               depthBand:[90,  250]  },
  amethyst:    { id:'amethyst',    name:'Amethyst',     value:260,  color:0xAA44FF, hexColor:'#AA44FF', emoji:'💜', rarity:'rare',      label:'RARE',      bgGlow:'rgba(170,68,255,0.6)',     homeLayer:'Dense Ore', desc:'Regal purple crystal',        depthBand:[140, 9999] },
  diamond:     { id:'diamond',     name:'Diamond',      value:480,  color:0x88EEFF, hexColor:'#88EEFF', emoji:'💎', rarity:'epic',      label:'EPIC',      bgGlow:'rgba(136,238,255,0.65)',   homeLayer:'Dense Ore', desc:'The hardest thing here',      depthBand:[140, 250]  },
  void_crystal:{ id:'void_crystal',name:'Void Crystal', value:1000, color:0xCC00FF, hexColor:'#CC00FF', emoji:'🔮', rarity:'legendary', label:'LEGENDARY', bgGlow:'rgba(200,0,255,0.7)',      homeLayer:'The Void',  desc:'From beyond the world',       depthBand:[250, 9999] },
  sunstone:    { id:'sunstone',    name:'Sunstone',     value:3500, color:0xFFD700, hexColor:'#FFD700', emoji:'☀️', rarity:'mythic',    label:'MYTHIC',    bgGlow:'rgba(255,215,0,0.9)',      homeLayer:'The Void',  desc:'Warm light in absolute dark',  depthBand:[250, 9999] },
};

// ─────────────────────────────────────────────────────────────
//  ORE PROBABILITY TABLE  (rebalanced for Part 3)
//
//  Values are CUMULATIVE thresholds [0,1] checked against Math.random().
//  Lower entry = checked first = wins the roll when r < threshold.
//  Design targets (per-punch chance, not per-hole):
//    Common ores:    2–4 %   peak
//    Uncommon ores:  1.5–2 % peak
//    Rare ores:      0.8–1 % peak
//    Epic ores:      0.3–0.5% peak
//    Legendary ores: 0.1–0.2% peak
//    Mythic ores:    0.03%  (Void only)
//  No layer total exceeds 12%. Dense Ore ~3.5% (deep = rare but worth it).
//  The vein system (mining.js) adds bonus guaranteed ores on top.
// ─────────────────────────────────────────────────────────────
export const ORE_TABLE = {
  'Grass/Dirt': [
    // Trace amounts — reward curious new players
    ['coal',   0.010],   //  1.0%
    ['copper', 0.020],   //  1.0%
  ],                     //  total: 2.0%

  'Clay': [
    ['coal',   0.020],   //  2.0%
    ['copper', 0.055],   //  3.5% ← Copper peak layer
    ['iron',   0.075],   //  2.0%
  ],                     //  total: 7.5%

  'Stone': [
    ['coal',   0.030],   //  3.0% ← Coal peak layer
    ['copper', 0.046],   //  1.6% (trailing off from Clay)
    ['iron',   0.086],   //  4.0% ← Iron peak layer
    ['gold',   0.089],   //  0.3% (trace — depth band caps this at 42-100m)
  ],                     //  total: 8.9%

  'Sandstone': [
    ['coal',   0.010],   //  1.0%
    ['copper', 0.020],   //  1.0%
    ['tin',    0.050],   //  3.0% ← Tin peak layer
    ['iron',   0.075],   //  2.5%
    ['gold',   0.095],   //  2.0% ← Gold peak layer
  ],                     //  total: 9.5%

  'Dark Stone': [
    ['iron',        0.015],   //  1.5%
    ['tin',         0.028],   //  1.3%
    ['gold',        0.040],   //  1.2% (depth band ends at 100m, won't spawn deep here)
    ['emerald',     0.058],   //  1.8% ← Emerald peak layer
    ['sapphire',    0.069],   //  1.1%
    ['ruby',        0.077],   //  0.8%
    ['amethyst',    0.082],   //  0.5%
  ],                          //  total: 8.2%

  'Obsidian': [
    ['gold',        0.008],   //  0.8% (at cap — depth band 42-100m; won't spawn below 100m)
    ['emerald',     0.018],   //  1.0%
    ['sapphire',    0.032],   //  1.4% ← Sapphire peak layer
    ['ruby',        0.042],   //  1.0% ← Ruby peak layer
    ['amethyst',    0.049],   //  0.7%
    ['diamond',     0.052],   //  0.3%
  ],                          //  total: 5.2%

  'Dense Ore': [
    ['emerald',     0.008],   //  0.8%
    ['sapphire',    0.016],   //  0.8%
    ['ruby',        0.022],   //  0.6%
    ['amethyst',    0.030],   //  0.8% ← Amethyst peak layer
    ['diamond',     0.033],   //  0.3%  (depth band 140-250m)
    ['void_crystal',0.035],   //  0.2%
  ],                          //  total: 3.5%

  'The Void': [
    ['amethyst',    0.006],   //  0.6%
    ['diamond',     0.009],   //  0.3%
    ['void_crystal',0.021],   //  1.2% ← Void Crystal peak (hunting ground)
    ['sunstone',    0.0213],  //  0.03% ← rarest thing in the game
  ],                          //  total: 2.1%
};

// ─────────────────────────────────────────────────────────────
//  rollOre — enforces depthBand so ores can't spawn out of range
// ─────────────────────────────────────────────────────────────
export function rollOre(layerName, currentDepth) {
  const table = ORE_TABLE[layerName];
  if (!table) return null;
  const r = Math.random();
  for (const [oreId, threshold] of table) {
    if (r < threshold) {
      const ore  = ORES[oreId];
      const band = ore.depthBand;
      // Depth band enforcement — reject out-of-range finds
      if (currentDepth < band[0] || currentDepth > band[1]) return null;
      return ore;
    }
  }
  return null;
}
