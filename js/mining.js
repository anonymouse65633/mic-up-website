// ============================================================
//  WalkWorld 3D — mining.js  (PART 3 REWRITE)
//
//  Ore vein system:
//  • generateOreVeins() pre-generates vein cells at world init
//  • Veins spread to up to 3 adjacent cells (55% chance each)
//  • Each vein cell has a size property (1–3) for visual variation
//  • Depth bands enforced — ores can't spawn outside their range
//  • Motherlode detection: 4+ cells = 1.5× bonus, 6+ cells = 2× + chat
//  • onDig respects vein data for guaranteed ore in vein cells
// ============================================================

import { LAYERS, ORES, ORE_TABLE, getMaterialAtDepth, rollOre } from './layers.js';
export { LAYERS, ORES, getMaterialAtDepth, rollOre };

import { scene, digSphere, getShaftAt, MINE_CELL, DIG_SPHERE_R, DIG_REACH, getBaseHeightAt } from './world.js';

// ── Gemini ore deposit generation ───────────────────────────
const GEMINI_API_KEY  = 'AIzaSyCMQqhCFpF5f1_6Fz_MJVHHFj9eYSZQVww';
const GEMINI_ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

const FALLBACK_DEPOSITS = [
  {cx:-8,cz:-5},{cx:-7,cz:-5},{cx:12,cz:3},{cx:0,cz:14},{cx:1,cz:14},
  {cx:-15,cz:10},{cx:6,cz:-18},{cx:7,cz:-18},{cx:-3,cz:7},{cx:19,cz:-9},
  {cx:-20,cz:-14},{cx:10,cz:20},{cx:-5,cz:-20},{cx:15,cz:12},{cx:-12,cz:2},
  {cx:2,cz:-8},{cx:-9,cz:17},{cx:18,cz:-2},{cx:-1,cz:-13},{cx:5,cz:5},
];

let _deposits   = [];
let _depositSet = new Set();

export async function generateOreDeposits() {
  _deposits = [];
  _depositSet.clear();

  const prompt = `You are generating a random ore deposit map for a 3D mining game.
Generate exactly 20 unique special ore deposit locations as a JSON array.
Each object has integer keys "cx" and "cz" in the range -25 to 25.
Rules:
- No two deposits share the same (cx, cz).
- Include 3-4 clusters of 2-3 adjacent cells (adjacent = differ by 1 in one axis).
- Other deposits spread out at least 4 units apart.
- Vary placement across all four quadrants.
Return ONLY a valid JSON array like: [{"cx":3,"cz":-7},{"cx":4,"cz":-7}]
No markdown, no explanation.`;

  try {
    const res = await fetch(GEMINI_ENDPOINT, {
      method  : 'POST',
      headers : { 'Content-Type': 'application/json' },
      body    : JSON.stringify({
        contents        : [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 1.1, maxOutputTokens: 512 },
      }),
    });
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
    const data  = await res.json();
    const raw   = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const clean = raw.replace(/```[\w]*\n?/g, '').trim();
    const list  = JSON.parse(clean);
    if (Array.isArray(list) && list.length > 0) {
      _deposits = list.map(d => ({ cx: Number(d.cx), cz: Number(d.cz) }));
      _deposits.forEach(d => _depositSet.add(`${d.cx},${d.cz}`));
      console.log(`[Mining] Gemini generated ${_deposits.length} ore deposits.`);
      return;
    }
    throw new Error('Empty list from Gemini');
  } catch (err) {
    console.warn('[Mining] Gemini failed, using fallback deposits.', err);
    _deposits = [...FALLBACK_DEPOSITS];
    _deposits.forEach(d => _depositSet.add(`${d.cx},${d.cz}`));
  }
}

export function getOreDeposits() { return _deposits; }
function _isDeposit(cx, cz) { return _depositSet.has(`${cx},${cz}`); }

// ============================================================
//  VEIN SYSTEM
//
//  Veins are pre-generated at world init. Each vein:
//  • Belongs to a specific geological layer
//  • Contains 1–6 cells that are adjacent or nearly adjacent
//  • Each cell has a size (1–3) affecting visuals + bonus coins
//  • Tracking mined cells enables the Motherlode detection
// ============================================================

// _cellVein maps "cx,cz" -> [{ oreId, veinId, layerName, size }, ...]
// A cell can technically be in veins from multiple layers (one per layer).
const _cellVein  = new Map();

// _veinMeta maps veinId -> { oreId, layerName, totalCells, minedCells: Set }
const _veinMeta  = new Map();

let _veinCounter = 0;

// How many vein seed points to scatter per layer
const VEIN_SEEDS_PER_LAYER = {
  'Grass/Dirt':  4,
  'Clay':        7,
  'Stone':       14,
  'Sandstone':   11,
  'Dark Stone':   9,
  'Obsidian':     7,
  'Dense Ore':    5,
  'The Void':     3,
};

// Simple seeded PRNG so veins are deterministic across clients
function _makePrng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = Math.imul(s, 1664525) + 1013904223 >>> 0;
    return s / 0x100000000;
  };
}

/**
 * generateOreVeins(worldSeed)
 *
 * Call once at world init (after generateOreDeposits).
 * Seeds all vein data so every client in the same session sees
 * the same ores at the same cell coords.
 */
export function generateOreVeins(worldSeed = 42) {
  _cellVein.clear();
  _veinMeta.clear();
  _veinCounter = 0;

  const rng   = _makePrng(worldSeed);
  const HALF  = 30; // grid spans -30 to +30 cells

  for (const layer of LAYERS) {
    const seeds   = VEIN_SEEDS_PER_LAYER[layer.name] || 6;
    const table   = ORE_TABLE[layer.name];
    if (!table || table.length === 0) continue;

    for (let s = 0; s < seeds; s++) {
      // Random seed cell inside the world grid
      const cx0 = Math.floor(rng() * (HALF * 2 + 1)) - HALF;
      const cz0 = Math.floor(rng() * (HALF * 2 + 1)) - HALF;

      // Pick an ore for this vein by rolling against the layer table
      const ore = _rollFromTable(table, rng());
      if (!ore) continue;

      // Depth band check against the layer's midpoint
      const midDepth = (layer.minDepth + layer.maxDepth) / 2;
      const band     = ore.depthBand;
      if (midDepth < band[0] || midDepth > band[1]) continue;

      // Create the vein
      const veinId = ++_veinCounter;
      const cells  = [];

      _addCell(cx0, cz0, ore.id, veinId, layer.name, rng, cells);

      // Shuffle 4 cardinal neighbours and propagate (55% each, up to 3)
      const dirs = [
        [cx0 + 1, cz0], [cx0 - 1, cz0],
        [cx0,     cz0 + 1], [cx0, cz0 - 1],
      ].sort(() => rng() - 0.5);

      let propagated = 0;
      for (const [nx, nz] of dirs) {
        if (propagated >= 3) break;
        if (rng() < 0.55) {
          _addCell(nx, nz, ore.id, veinId, layer.name, rng, cells);
          propagated++;

          // Second-level spread (30% chance from each propagated cell)
          if (rng() < 0.30) {
            const dirs2 = [
              [nx + 1, nz], [nx - 1, nz],
              [nx,     nz + 1], [nx, nz - 1],
            ].sort(() => rng() - 0.5);
            const [nx2, nz2] = dirs2[0];
            const k2 = `${nx2},${nz2}`;
            // Only extend if the cell has no vein entry for this layer yet
            const existing = _cellVein.get(k2) || [];
            if (!existing.some(v => v.layerName === layer.name)) {
              _addCell(nx2, nz2, ore.id, veinId, layer.name, rng, cells);
            }
          }
        }
      }

      _veinMeta.set(veinId, {
        oreId:      ore.id,
        layerName:  layer.name,
        totalCells: cells.length,
        minedCells: new Set(),
      });
    }
  }

  console.log(`[Mining] Generated ${_veinCounter} ore veins across ${_cellVein.size} unique cells.`);
}

function _addCell(cx, cz, oreId, veinId, layerName, rng, cells) {
  const key      = `${cx},${cz}`;
  const existing = _cellVein.get(key) || [];
  // One vein entry per layer per cell
  if (existing.some(v => v.layerName === layerName)) return;
  const size = Math.floor(rng() * 3) + 1;   // 1–3
  existing.push({ oreId, veinId, layerName, size });
  _cellVein.set(key, existing);
  cells.push(key);
}

function _rollFromTable(table, r) {
  for (const [oreId, threshold] of table) {
    if (r < threshold) return ORES[oreId];
  }
  return null;
}

/**
 * getVeinCell(cx, cz, layerName)
 * Returns the vein entry for this cell at the current layer, or null.
 */
export function getVeinCell(cx, cz, layerName) {
  const entries = _cellVein.get(`${cx},${cz}`);
  if (!entries) return null;
  return entries.find(v => v.layerName === layerName) || null;
}

/**
 * recordVeinMined(veinId, cellKey)
 * Called when a vein cell is dug. Returns motherlode info if applicable.
 * Returns: { isMotherlode, isGrandMotherlode, totalCells, minedCount, oreId }
 */
export function recordVeinMined(veinId, cx, cz) {
  const meta = _veinMeta.get(veinId);
  if (!meta) return null;

  const cellKey = `${cx},${cz}`;
  meta.minedCells.add(cellKey);

  const minedCount = meta.minedCells.size;
  const totalCells = meta.totalCells;

  return {
    isMotherlode:      minedCount >= 4,
    isGrandMotherlode: minedCount >= 6,
    minedCount,
    totalCells,
    oreId: meta.oreId,
  };
}

// ── State ────────────────────────────────────────────────────
let _money = 0;
const _sphereMeshes = new Map(); // key -> { group, oreCrystals }

export function getMoney()        { return _money; }
export function addMoney(amount)  { _money = Math.max(0, _money + amount); }

export function getDepthAt(x, z) {
  const shaft = getShaftAt(x, z);
  return shaft ? shaft.depth : 0;
}

// ============================================================
//  MAIN DIG API — always digs DOWN at player position
//
//  Priority order for ore at a cell:
//  1. Vein cell for current layer  (guaranteed ore, size bonus)
//  2. Random rollOre() scatter     (depth-band enforced)
//  3. Deposit multiplier on top of either
// ============================================================
export function onDig(px, py, pz, yaw, pitch, eyeHeight) {
  const surfaceY      = getBaseHeightAt(px, pz);
  const shaft         = getShaftAt(px, pz);
  const currentFloorY = shaft ? shaft.floorY : surfaceY;

  const digX = px;
  const digY = currentFloorY - (DIG_SPHERE_R * 0.45);
  const digZ = pz;

  const result = digSphere(digX, digY, digZ, DIG_SPHERE_R);
  if (!result) return null;

  const { key, cellX, cellZ, worldX, worldZ, floorY, depth, surfaceY: sY } = result;
  const layer      = getMaterialAtDepth(depth);
  const depositHit = layer.name === 'Dense Ore' && _isDeposit(cellX, cellZ);

  // ── Ore resolution ──────────────────────────────────────
  let ore     = null;
  let oreSize = 1;
  let veinId  = null;

  const veinEntry = getVeinCell(cellX, cellZ, layer.name);

  if (veinEntry) {
    // Guaranteed ore from vein (depth band already checked at generation)
    ore     = ORES[veinEntry.oreId];
    oreSize = veinEntry.size;
    veinId  = veinEntry.veinId;
  } else {
    // Scattered random ore (passes through depth band check in rollOre)
    ore = rollOre(layer.name, depth);
  }

  // ── Coin calculation ─────────────────────────────────────
  const layerBase     = layer.value;
  const oreBase       = ore ? ore.value : 0;

  // Size multiplier: size 2 = +50% ore coins, size 3 = +100% ore coins
  const sizeMult      = oreSize === 3 ? 2.0 : oreSize === 2 ? 1.5 : 1.0;
  const oreCoinValue  = oreBase * sizeMult;

  let earned = layerBase + oreCoinValue;
  if (depositHit) earned *= 3;

  // ── Motherlode bonus ─────────────────────────────────────
  let motherlodeInfo = null;
  if (veinId !== null) {
    motherlodeInfo = recordVeinMined(veinId, cellX, cellZ);
    if (motherlodeInfo?.isGrandMotherlode) {
      // 6+ cells mined: 2× the last ore's value (already applied to earned above)
      earned += oreCoinValue; // doubles the ore portion
    } else if (motherlodeInfo?.isMotherlode) {
      // 4+ cells mined: 1.5× the last ore's value
      earned += oreCoinValue * 0.5;
    }
  }

  _money += earned;

  _updateSphereVisuals(key, digX, digY, digZ, DIG_SPHERE_R, depth, sY, ore, layer, oreSize);

  return {
    layer,
    ore,
    oreSize,
    depth,
    earned,
    totalMoney: _money,
    isDeposit:  depositHit,
    veinEntry,
    motherlode: motherlodeInfo,
    cellX,
    cellZ,
  };
}

// ============================================================
//  RESET
// ============================================================
export function resetMining() {
  for (const { group } of _sphereMeshes.values()) {
    scene.remove(group);
    group.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
  }
  _sphereMeshes.clear();
  _money = 0;
}

// ============================================================
//  SPHERE VISUALS — ore crystal clusters in holes
// ============================================================
function _updateSphereVisuals(key, cx, cy, cz, radius, depth, surfaceY, ore, layer, oreSize = 1) {
  const old = _sphereMeshes.get(key);
  if (old) {
    scene.remove(old.group);
    old.group.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
  }

  const group  = new THREE.Group();
  const floorY = cy - radius;

  // Strata layer rings — visible at the walls of the hole
  const visibleLayers = LAYERS.filter(l => {
    const bandTop    = surfaceY - l.minDepth;
    const bandBottom = surfaceY - Math.min(depth, l.maxDepth);
    return bandTop > bandBottom;
  });

  for (const vl of visibleLayers) {
    const bandTop    = surfaceY - vl.minDepth;
    const bandBottom = surfaceY - Math.min(depth, vl.maxDepth);
    if (bandTop - bandBottom < 0.1) continue;

    const midY        = (bandTop + bandBottom) * 0.5;
    const relY        = midY - cy;
    const clampedRelY = Math.max(-radius * 0.95, Math.min(radius * 0.95, relY));
    const ringR       = Math.sqrt(Math.max(0, radius * radius - clampedRelY * clampedRelY));

    if (ringR < 0.3) continue;

    const torusGeo = new THREE.TorusGeometry(ringR, 0.12, 6, 24, Math.PI * 2);
    const torusMat = new THREE.MeshLambertMaterial({
      color:       vl.color,
      transparent: true,
      opacity:     0.85,
    });
    const torus = new THREE.Mesh(torusGeo, torusMat);
    torus.rotation.x = Math.PI / 2;
    torus.position.set(cx, midY, cz);
    group.add(torus);
  }

  // Ore crystal cluster at the floor (size scales the cluster)
  if (ore) {
    _buildOreCrystalCluster(group, cx, floorY + 0.05, cz, ore, depth, oreSize);
  }

  scene.add(group);
  _sphereMeshes.set(key, { group });
}

function _buildOreCrystalCluster(group, cx, baseY, cz, ore, depth, oreSize = 1) {
  const rarity   = ore.rarity;
  const oreColor = ore.color;
  const emissive = new THREE.Color(oreColor);

  // oreSize (1–3) scales count and base size
  const countBase = { legendary: 9, mythic: 11, epic: 7, rare: 5, uncommon: 4, common: 3 };
  const count  = Math.round((countBase[rarity] ?? 3) * (0.7 + oreSize * 0.3));

  const sizeBase = { legendary: 0.55, mythic: 0.65, epic: 0.45, rare: 0.38, uncommon: 0.30, common: 0.22 };
  const baseSize = (sizeBase[rarity] ?? 0.22) * (0.7 + oreSize * 0.2);

  const mat = new THREE.MeshLambertMaterial({
    color:              oreColor,
    emissive:           emissive,
    emissiveIntensity:  rarity === 'mythic'    ? 1.0
                      : rarity === 'legendary' ? 0.8
                      : rarity === 'epic'      ? 0.65
                      : rarity === 'rare'      ? 0.5
                      : rarity === 'uncommon'  ? 0.35
                      :                          0.2,
  });

  let rngSeed = (Math.round(cx * 13 + cz * 7 + 1000)) >>> 0;
  const rng = () => {
    rngSeed = Math.imul(rngSeed, 1664525) + 1013904223 >>> 0;
    return rngSeed / 0x100000000;
  };

  for (let i = 0; i < count; i++) {
    const angle  = (i / count) * Math.PI * 2 + rng() * 0.8;
    const spread = i === 0 ? 0 : (0.1 + rng() * 0.55);
    const height = baseSize * (0.7 + rng() * 0.9);
    const width  = baseSize * (0.12 + rng() * 0.14);
    const tilt   = rng() * 0.45;

    const geo  = new THREE.ConeGeometry(width, height, 5 + Math.floor(rng() * 3), 1);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(cx + Math.cos(angle) * spread, baseY + height * 0.5, cz + Math.sin(angle) * spread);
    mesh.rotation.z =  Math.cos(angle) * tilt;
    mesh.rotation.x = -Math.sin(angle) * tilt;
    group.add(mesh);

    if (rarity !== 'common') {
      const nubGeo = new THREE.ConeGeometry(width * 0.7, height * 0.25, 5, 1);
      const nub    = new THREE.Mesh(nubGeo, mat);
      nub.position.set(cx + Math.cos(angle) * spread, baseY + height * 0.08, cz + Math.sin(angle) * spread);
      nub.rotation.z = mesh.rotation.z;
      nub.rotation.x = mesh.rotation.x;
      nub.rotation.y = Math.PI;
      group.add(nub);
    }
  }

  // Point lights for rarer tiers — scale intensity with oreSize
  const lightScale = 0.7 + oreSize * 0.3;
  if (rarity === 'mythic') {
    const light = new THREE.PointLight(oreColor, 2.5 * lightScale, 12);
    light.position.set(cx, baseY + baseSize, cz);
    group.add(light);
  } else if (rarity === 'legendary') {
    const light = new THREE.PointLight(oreColor, 1.8 * lightScale, 8);
    light.position.set(cx, baseY + baseSize, cz);
    group.add(light);
  } else if (rarity === 'epic') {
    const light = new THREE.PointLight(oreColor, 1.0 * lightScale, 6);
    light.position.set(cx, baseY + baseSize, cz);
    group.add(light);
  }
}


// ── Gemini ore deposit generation ───────────────────────────
const GEMINI_API_KEY  = 'AIzaSyCMQqhCFpF5f1_6Fz_MJVHHFj9eYSZQVww';
const GEMINI_ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

const FALLBACK_DEPOSITS = [
  {cx:-8,cz:-5},{cx:-7,cz:-5},{cx:12,cz:3},{cx:0,cz:14},{cx:1,cz:14},
  {cx:-15,cz:10},{cx:6,cz:-18},{cx:7,cz:-18},{cx:-3,cz:7},{cx:19,cz:-9},
  {cx:-20,cz:-14},{cx:10,cz:20},{cx:-5,cz:-20},{cx:15,cz:12},{cx:-12,cz:2},
  {cx:2,cz:-8},{cx:-9,cz:17},{cx:18,cz:-2},{cx:-1,cz:-13},{cx:5,cz:5},
];

let _deposits   = [];
let _depositSet = new Set();

export async function generateOreDeposits() {
  _deposits = [];
  _depositSet.clear();

  const prompt = `You are generating a random ore deposit map for a 3D mining game.
Generate exactly 20 unique special ore deposit locations as a JSON array.
Each object has integer keys "cx" and "cz" in the range -25 to 25.
Rules:
- No two deposits share the same (cx, cz).
- Include 3-4 clusters of 2-3 adjacent cells (adjacent = differ by 1 in one axis).
- Other deposits spread out at least 4 units apart.
- Vary placement across all four quadrants.
Return ONLY a valid JSON array like: [{"cx":3,"cz":-7},{"cx":4,"cz":-7}]
No markdown, no explanation.`;

  try {
    const res = await fetch(GEMINI_ENDPOINT, {
      method  : 'POST',
      headers : { 'Content-Type': 'application/json' },
      body    : JSON.stringify({
        contents        : [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 1.1, maxOutputTokens: 512 },
      }),
    });
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
    const data  = await res.json();
    const raw   = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const clean = raw.replace(/```[\w]*\n?/g, '').trim();
    const list  = JSON.parse(clean);
    if (Array.isArray(list) && list.length > 0) {
      _deposits = list.map(d => ({ cx: Number(d.cx), cz: Number(d.cz) }));
      _deposits.forEach(d => _depositSet.add(`${d.cx},${d.cz}`));
      console.log(`[Mining] Gemini generated ${_deposits.length} ore deposits.`);
      return;
    }
    throw new Error('Empty list from Gemini');
  } catch (err) {
    console.warn('[Mining] Gemini failed, using fallback deposits.', err);
    _deposits = [...FALLBACK_DEPOSITS];
    _deposits.forEach(d => _depositSet.add(`${d.cx},${d.cz}`));
  }
}

export function getOreDeposits() { return _deposits; }
function _isDeposit(cx, cz) { return _depositSet.has(`${cx},${cz}`); }

// ── State ────────────────────────────────────────────────────
let _money = 0;
const _sphereMeshes = new Map(); // key -> { group, oreCrystals }

export function getMoney()        { return _money; }
export function addMoney(amount)  { _money = Math.max(0, _money + amount); }

export function getDepthAt(x, z) {
  const shaft = getShaftAt(x, z);
  return shaft ? shaft.depth : 0;
}

// ============================================================
//  MAIN DIG API — always digs DOWN at player position
//
//  Instead of aiming a sphere in the look direction (which often
//  misses the ground), we dig straight down from the player's
//  current position. Each punch goes deeper than the last.
//  This makes digging reliable and satisfying every time.
// ============================================================
export function onDig(px, py, pz, yaw, pitch, eyeHeight) {
  // Find the current dig floor at this position
  const surfaceY      = getBaseHeightAt(px, pz);
  const shaft         = getShaftAt(px, pz);
  const currentFloorY = shaft ? shaft.floorY : surfaceY;

  // Sphere center sits just below the current floor so each dig
  // pushes deeper. The sphere radius determines how wide the hole is.
  const digX = px;
  const digY = currentFloorY - (DIG_SPHERE_R * 0.45);
  const digZ = pz;

  const result = digSphere(digX, digY, digZ, DIG_SPHERE_R);
  if (!result) return null;

  const { key, cellX, cellZ, worldX, worldZ, floorY, depth, surfaceY: sY } = result;
  const layer      = getMaterialAtDepth(depth);
  const depositHit = layer.name === 'Dense Ore' && _isDeposit(cellX, cellZ);

  const ore = rollOre(layer.name);

  const baseEarned = layer.value + (ore ? ore.value : 0);
  const earned     = depositHit ? baseEarned * 3 : baseEarned;

  _money += earned;

  _updateSphereVisuals(key, digX, digY, digZ, DIG_SPHERE_R, depth, sY, ore, layer);

  return { layer, ore, depth, earned, totalMoney: _money, isDeposit: depositHit };
