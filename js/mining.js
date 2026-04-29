// ============================================================
//  WalkWorld 3D — mining.js
//
//  Handles the digging/mining system:
//    • Imports layer definitions from layers.js
//    • Gemini API — generates random ore-deposit "hot spots" each
//      session so the map is different every time (or after a reset)
//    • Shaft visual floor & wall meshes coloured by current layer
//    • Wallet / money tracking
//    • onDig(x, z)    — main API called by game.js on E key
//    • resetMining()  — wipe all shaft meshes + money
//
//  Exports:
//    onDig(x, z)          — perform one dig punch, returns result
//    getMoney()           — current wallet total
//    getDepthAt(x, z)     — current shaft depth at (x,z), or 0
//    resetMining()        — clear everything (for terrain reset)
//    generateOreDeposits()— async, call on start + after reset
//    getOreDeposits()     — array of {cx,cz} AI-generated hot spots
// ============================================================

import { LAYERS, ORES, getMaterialAtDepth, rollOre } from './layers.js';
export { LAYERS, ORES, getMaterialAtDepth, rollOre };   // re-export so game.js can grab them

import { scene, digShaft, getShaftAt, MINE_CELL } from './world.js';

// ============================================================
//  GEMINI — ore deposit generation
//  Replace the placeholder key with your actual Gemini API key.
//  The call happens once on load and again after every reset.
// ============================================================
const GEMINI_API_KEY  = 'AIzaSyCMQqhCFpF5f1_6Fz_MJVHHFj9eYSZQVww';
const GEMINI_ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

// Fallback deposits used when the API call fails / key is not set
const FALLBACK_DEPOSITS = [
  {cx:-8,cz:-5},{cx:-7,cz:-5},{cx:12,cz:3},{cx:0,cz:14},{cx:1,cz:14},
  {cx:-15,cz:10},{cx:6,cz:-18},{cx:7,cz:-18},{cx:-3,cz:7},{cx:19,cz:-9},
  {cx:-20,cz:-14},{cx:10,cz:20},{cx:-5,cz:-20},{cx:15,cz:12},{cx:-12,cz:2},
  {cx:2,cz:-8},{cx:-9,cz:17},{cx:18,cz:-2},{cx:-1,cz:-13},{cx:5,cz:5},
];

let _deposits   = [];
let _depositSet = new Set();

/**
 * Ask Gemini to generate a fresh set of ore-deposit coordinates.
 * Falls back gracefully if the API is unavailable or the key is unset.
 */
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
//  STATE
// ============================================================
let _money = 0;

const _shaftMeshes = new Map(); // shaft key -> { floorMesh, wallGroup }

export function getMoney() { return _money; }

export function getDepthAt(x, z) {
  const shaft = getShaftAt(x, z);
  return shaft ? shaft.depth : 0;
}

// ============================================================
//  MAIN DIG API
// ============================================================
/**
 * Perform one dig punch at world position (x, z).
 * Returns { material, depth, earned, totalMoney, isDeposit } or null.
 */
export function onDig(playerX, playerZ) {
  const result = digShaft(playerX, playerZ);
  if (!result) return null;

  const { key, cellX, cellZ, worldX, worldZ, floorY, depth, surfaceY } = result;
  const layer      = getMaterialAtDepth(depth);
  const depositHit = layer.name === 'Dense Ore' && _isDeposit(cellX, cellZ);

  // Roll for a random ore based on the current layer's probability table
  const ore = rollOre(layer.name);

  // Earnings: base layer value + ore bonus (deposit multiplies total by 3)
  const baseEarned = layer.value + (ore ? ore.value : 0);
  const earned     = depositHit ? baseEarned * 3 : baseEarned;

  _money += earned;

  _updateShaftVisuals(key, worldX, worldZ, surfaceY, floorY, depth, ore);

  return { layer, ore, depth, earned, totalMoney: _money, isDeposit: depositHit };
}

// ============================================================
//  RESET  (called on the 20-minute terrain reset)
// ============================================================
export function resetMining() {
  for (const { floorMesh, wallGroup, oreMesh } of _shaftMeshes.values()) {
    scene.remove(floorMesh);
    scene.remove(wallGroup);
    floorMesh.geometry.dispose();
    floorMesh.material.dispose();
    if (oreMesh) { scene.remove(oreMesh); oreMesh.geometry.dispose(); oreMesh.material.dispose(); }
  }
  _shaftMeshes.clear();
  _money = 0;
}

// ============================================================
//  SHAFT VISUALS
// ============================================================
const CELL_HALF  = MINE_CELL / 2 - 0.05;
const WALL_THICK = 0.18;

function _updateShaftVisuals(key, wx, wz, surfaceY, floorY, depth, ore = null) {
  const old = _shaftMeshes.get(key);
  if (old) {
    scene.remove(old.floorMesh);
    scene.remove(old.wallGroup);
    old.floorMesh.geometry.dispose();
    old.floorMesh.material.dispose();
    // Remove any lingering ore sparkle mesh
    if (old.oreMesh) { scene.remove(old.oreMesh); old.oreMesh.geometry.dispose(); old.oreMesh.material.dispose(); }
  }

  const layer = getMaterialAtDepth(depth);

  // Floor — coloured by the current layer (ore tints it slightly)
  const floorColor = ore ? ore.color : layer.color;
  const floorGeo  = new THREE.PlaneGeometry(MINE_CELL - 0.15, MINE_CELL - 0.15);
  floorGeo.rotateX(-Math.PI / 2);
  const floorMat  = new THREE.MeshLambertMaterial({ color: floorColor });
  const floorMesh = new THREE.Mesh(floorGeo, floorMat);
  floorMesh.position.set(wx, floorY + 0.05, wz);
  scene.add(floorMesh);

  // Ore sparkle — a small glowing box embedded in the floor
  let oreMesh = null;
  if (ore) {
    const sparkSize = 0.35 + (ore.rarity === 'legendary' ? 0.25 : ore.rarity === 'epic' ? 0.18 : ore.rarity === 'rare' ? 0.12 : 0.05);
    const sparkGeo  = new THREE.BoxGeometry(sparkSize, sparkSize * 0.5, sparkSize);
    const sparkMat  = new THREE.MeshLambertMaterial({ color: ore.color, emissive: ore.color, emissiveIntensity: 0.6 });
    oreMesh = new THREE.Mesh(sparkGeo, sparkMat);
    oreMesh.position.set(wx, floorY + sparkSize * 0.35, wz);
    scene.add(oreMesh);
  }

  // Walls — show visible strata bands
  const wallGroup = new THREE.Group();
  const bands = [];

  for (const layer of LAYERS) {
    const bandTop    = Math.max(0, layer.minDepth);
    const bandBottom = Math.min(depth, layer.maxDepth);
    if (bandBottom <= bandTop) continue;
    bands.push({ color: layer.color, topY: surfaceY - bandTop, botY: surfaceY - bandBottom });
  }

  const wallConfigs = [
    { pos: { x: wx,             z: wz - CELL_HALF }, rotY: 0            },
    { pos: { x: wx,             z: wz + CELL_HALF }, rotY: Math.PI      },
    { pos: { x: wx - CELL_HALF, z: wz             }, rotY:  Math.PI / 2 },
    { pos: { x: wx + CELL_HALF, z: wz             }, rotY: -Math.PI / 2 },
  ];

  for (const { pos, rotY } of wallConfigs) {
    for (const { color, topY, botY } of bands) {
      const bandH = topY - botY;
      if (bandH < 0.05) continue;
      const geo  = new THREE.BoxGeometry(MINE_CELL - 0.12, bandH, WALL_THICK);
      const wMat = new THREE.MeshLambertMaterial({ color });
      const mesh = new THREE.Mesh(geo, wMat);
      mesh.position.set(pos.x, botY + bandH / 2, pos.z);
      mesh.rotation.y = rotY;
      wallGroup.add(mesh);
    }
  }

  scene.add(wallGroup);
  _shaftMeshes.set(key, { floorMesh, wallGroup, oreMesh });
}
