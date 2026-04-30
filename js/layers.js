// ============================================================
//  WalkWorld 3D — layers.js  (PART 1 REWRITE)
//
//  8-layer geological system with punch resistance.
//  New layers: Sandstone (42-65m), Obsidian (110-160m), The Void (250m+)
//  New ores:   Tin, Sapphire, Sunstone
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
//  ORE DEFINITIONS  (12 ores)
// ─────────────────────────────────────────────────────────────
export const ORES = {
  coal:        { id:'coal',        name:'Coal',         value:8,    color:0x222222, hexColor:'#555555', emoji:'🪨', rarity:'common',    label:'COMMON',    bgGlow:'rgba(80,80,80,0.4)',       homeLayer:'Stone',     desc:'Burns well' },
  copper:      { id:'copper',      name:'Copper',       value:18,   color:0xCC6633, hexColor:'#CC6633', emoji:'🟠', rarity:'common',    label:'COMMON',    bgGlow:'rgba(204,102,51,0.4)',     homeLayer:'Clay',      desc:'Turns green over time' },
  iron:        { id:'iron',        name:'Iron',         value:35,   color:0xBB8866, hexColor:'#BB8866', emoji:'🔩', rarity:'common',    label:'COMMON',    bgGlow:'rgba(187,136,102,0.45)',   homeLayer:'Stone',     desc:'Workhorse of metals' },
  tin:         { id:'tin',         name:'Tin',          value:28,   color:0xC8C8AA, hexColor:'#C8C8AA', emoji:'🥈', rarity:'common',    label:'COMMON',    bgGlow:'rgba(200,200,170,0.4)',    homeLayer:'Sandstone', desc:'Dull but useful' },
  gold:        { id:'gold',        name:'Gold',         value:90,   color:0xFFCC00, hexColor:'#FFCC00', emoji:'✨', rarity:'uncommon',  label:'UNCOMMON',  bgGlow:'rgba(255,204,0,0.5)',      homeLayer:'Sandstone', desc:'Shiny and valuable' },
  emerald:     { id:'emerald',     name:'Emerald',      value:130,  color:0x00DD66, hexColor:'#00DD66', emoji:'💚', rarity:'uncommon',  label:'UNCOMMON',  bgGlow:'rgba(0,220,100,0.5)',      homeLayer:'Dark Stone',desc:'Vivid and striking' },
  sapphire:    { id:'sapphire',    name:'Sapphire',     value:165,  color:0x4488FF, hexColor:'#4488FF', emoji:'💙', rarity:'uncommon',  label:'UNCOMMON',  bgGlow:'rgba(68,136,255,0.5)',     homeLayer:'Obsidian',  desc:'Deep blue clarity' },
  ruby:        { id:'ruby',        name:'Ruby',         value:210,  color:0xFF2244, hexColor:'#FF2244', emoji:'❤️‍🔥', rarity:'rare',  label:'RARE',      bgGlow:'rgba(255,34,68,0.55)',     homeLayer:'Obsidian',  desc:'Fiery red gem' },
  amethyst:    { id:'amethyst',    name:'Amethyst',     value:260,  color:0xAA44FF, hexColor:'#AA44FF', emoji:'💜', rarity:'rare',      label:'RARE',      bgGlow:'rgba(170,68,255,0.6)',     homeLayer:'Dense Ore', desc:'Regal purple crystal' },
  diamond:     { id:'diamond',     name:'Diamond',      value:480,  color:0x88EEFF, hexColor:'#88EEFF', emoji:'💎', rarity:'epic',      label:'EPIC',      bgGlow:'rgba(136,238,255,0.65)',   homeLayer:'Dense Ore', desc:'The hardest thing here' },
  void_crystal:{ id:'void_crystal',name:'Void Crystal', value:1000, color:0xCC00FF, hexColor:'#CC00FF', emoji:'🔮', rarity:'legendary', label:'LEGENDARY', bgGlow:'rgba(200,0,255,0.7)',      homeLayer:'The Void',  desc:'From beyond the world' },
  sunstone:    { id:'sunstone',    name:'Sunstone',     value:3500, color:0xFFD700, hexColor:'#FFD700', emoji:'☀️', rarity:'mythic',    label:'MYTHIC',    bgGlow:'rgba(255,215,0,0.9)',      homeLayer:'The Void',  desc:'Warm light in absolute dark' },
};

// ─────────────────────────────────────────────────────────────
//  ORE PROBABILITY TABLES  (rebalanced — Dense Ore max ~8.5%)
// ─────────────────────────────────────────────────────────────
const ORE_TABLE = {
  'Grass/Dirt': [
    ['coal',   0.012],
    ['copper', 0.015],
  ],
  'Clay': [
    ['coal',   0.020],
    ['copper', 0.048],
    ['iron',   0.060],
  ],
  'Stone': [
    ['coal',    0.055],
    ['copper',  0.075],
    ['iron',    0.115],
    ['gold',    0.118],
    ['emerald', 0.119],
  ],
  'Sandstone': [
    ['coal',   0.015],
    ['copper', 0.025],
    ['tin',    0.055],
    ['iron',   0.075],
    ['gold',   0.095],
  ],
  'Dark Stone': [
    ['coal',        0.008],
    ['iron',        0.025],
    ['tin',         0.035],
    ['gold',        0.075],
    ['emerald',     0.105],
    ['sapphire',    0.117],
    ['ruby',        0.130],
    ['amethyst',    0.135],
    ['diamond',     0.137],
    ['void_crystal',0.1375],
  ],
  'Obsidian': [
    ['iron',        0.015],
    ['gold',        0.040],
    ['emerald',     0.060],
    ['sapphire',    0.074],
    ['ruby',        0.084],
    ['amethyst',    0.092],
    ['diamond',     0.095],
    ['void_crystal',0.0955],
  ],
  'Dense Ore': [
    ['gold',        0.018],
    ['emerald',     0.030],
    ['sapphire',    0.040],
    ['ruby',        0.048],
    ['amethyst',    0.056],
    ['diamond',     0.0595],
    ['void_crystal',0.0605],
  ],
  'The Void': [
    ['amethyst',    0.012],
    ['diamond',     0.018],
    ['void_crystal',0.030],
    ['sunstone',    0.0303],
  ],
};

export function rollOre(layerName) {
  const table = ORE_TABLE[layerName];
  if (!table) return null;
  const r = Math.random();
  for (const [oreId, threshold] of table) {
    if (r < threshold) return ORES[oreId];
  }
  return null;
}
