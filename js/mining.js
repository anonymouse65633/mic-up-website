// ============================================================
//  WalkWorld 3D — mining.js  (SPHERICAL + DIRECTIONAL REWRITE)
// ============================================================

import { LAYERS, ORES, getMaterialAtDepth, rollOre } from './layers.js';
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
//  MAIN DIG API  — now accepts look direction
// ============================================================
/**
 * Perform one dig punch.
 * @param {number} px,py,pz  — player position (NOT eye position)
 * @param {number} yaw,pitch — camera orientation
 * @param {number} eyeHeight — camera height offset above player.y
 */
export function onDig(px, py, pz, yaw, pitch, eyeHeight) {
  eyeHeight = eyeHeight ?? 1.62;
  yaw   = yaw   ?? 0;
  pitch = pitch ?? -0.4;  // default: slightly looking down

  // Eye position
  const ex = px;
  const ey = py + eyeHeight;
  const ez = pz;

  // Look direction vector (in this game: forward = +sinY, +cosZ)
  const cosPitch = Math.cos(pitch);
  const lx = Math.sin(yaw)  * cosPitch;
  const ly = -Math.sin(pitch);
  const lz = Math.cos(yaw)  * cosPitch;

  // Dig target = eye + look * reach
  const reach = DIG_REACH;
  let   digX  = ex + lx * reach;
  let   digY  = ey + ly * reach;
  let   digZ  = ez + lz * reach;

  // Clamp digY so we never dig above the surface (always deforms terrain)
  const surfaceAtTarget = getBaseHeightAt(digX, digZ);
  if (digY > surfaceAtTarget + 0.5) {
    // Aim is too high — lower the sphere center to surface level
    digY = surfaceAtTarget - DIG_SPHERE_R * 0.5;
  }

  const result = digSphere(digX, digY, digZ, DIG_SPHERE_R);
  if (!result) return null;

  const { key, cellX, cellZ, worldX, worldZ, floorY, depth, surfaceY } = result;
  const layer      = getMaterialAtDepth(depth);
  const depositHit = layer.name === 'Dense Ore' && _isDeposit(cellX, cellZ);

  const ore = rollOre(layer.name);

  const baseEarned = layer.value + (ore ? ore.value : 0);
  const earned     = depositHit ? baseEarned * 3 : baseEarned;

  _money += earned;

  _updateSphereVisuals(key, digX, digY, digZ, DIG_SPHERE_R, depth, surfaceY, ore, layer);

  return { layer, ore, depth, earned, totalMoney: _money, isDeposit: depositHit };
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
//  SPHERE VISUALS — smooth bowl + realistic ore crystals
// ============================================================
function _updateSphereVisuals(key, cx, cy, cz, radius, depth, surfaceY, ore, layer) {
  const old = _sphereMeshes.get(key);
  if (old) {
    scene.remove(old.group);
    old.group.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
  }

  const group = new THREE.Group();

  // ── Sphere bowl indicator (subtle dark overlay) ────────────
  // We use a half-sphere mesh sitting in the bowl to show strata bands
  const bowlSegs = 12;
  const floorY   = cy - radius;

  // Strata layers visible in the bowl walls
  const visibleLayers = LAYERS.filter(l => {
    const bandTop    = surfaceY - l.minDepth;
    const bandBottom = surfaceY - Math.min(depth, l.maxDepth);
    return bandTop > bandBottom;
  });

  // Render stratum rings as thin torus arcs in the bowl
  for (const vl of visibleLayers) {
    const bandTop    = surfaceY - vl.minDepth;
    const bandBottom = surfaceY - Math.min(depth, vl.maxDepth);
    if (bandTop - bandBottom < 0.05) continue;

    // Map band to sphere radius at that depth
    const midY = (bandTop + bandBottom) * 0.5;
    const relY = midY - cy; // relative to sphere center
    const clampedRelY = Math.max(-radius * 0.98, Math.min(radius * 0.98, relY));
    const ringR = Math.sqrt(Math.max(0, radius * radius - clampedRelY * clampedRelY));

    if (ringR < 0.2) continue;

    const torusGeo = new THREE.TorusGeometry(ringR, 0.06, 6, 20, Math.PI * 2);
    const torusMat = new THREE.MeshLambertMaterial({ color: vl.color, transparent: true, opacity: 0.7 });
    const torus = new THREE.Mesh(torusGeo, torusMat);
    torus.rotation.x = Math.PI / 2;
    torus.position.set(cx, midY, cz);
    group.add(torus);
  }

  // ── Ore crystal cluster ────────────────────────────────────
  if (ore) {
    _buildOreCrystalCluster(group, cx, floorY + 0.05, cz, ore, depth);
  }

  scene.add(group);
  _sphereMeshes.set(key, { group });
}

/**
 * Build realistic ore crystal cluster.
 * Uses multiple ConeGeometry spires arranged in a cluster for a natural gemstone look.
 */
function _buildOreCrystalCluster(group, cx, baseY, cz, ore, depth) {
  const rarity   = ore.rarity;
  const oreColor = ore.color;
  const emissive = new THREE.Color(oreColor);

  // Number of crystals based on rarity
  const counts = { legendary: 9, epic: 7, rare: 5, uncommon: 4, common: 3 };
  const count  = counts[rarity] ?? 3;

  // Size based on rarity
  const sizeBase = { legendary: 0.55, epic: 0.45, rare: 0.38, uncommon: 0.30, common: 0.22 };
  const baseSize = sizeBase[rarity] ?? 0.22;

  const mat = new THREE.MeshLambertMaterial({
    color          : oreColor,
    emissive       : emissive,
    emissiveIntensity: rarity === 'legendary' ? 0.8 : rarity === 'epic' ? 0.65 : rarity === 'rare' ? 0.5 : rarity === 'uncommon' ? 0.35 : 0.2,
  });

  // Scatter seed based on position
  let rngSeed = (Math.round(cx * 13 + cz * 7 + 1000)) >>> 0;
  const rng = () => {
    rngSeed = Math.imul(rngSeed, 1664525) + 1013904223 >>> 0;
    return rngSeed / 0x100000000;
  };

  for (let i = 0; i < count; i++) {
    const angle  = (i / count) * Math.PI * 2 + rng() * 0.8;
    const spread = i === 0 ? 0 : (0.1 + rng() * 0.55);  // center crystal + ring
    const height = baseSize * (0.7 + rng() * 0.9);
    const width  = baseSize * (0.12 + rng() * 0.14);
    const tilt   = rng() * 0.45;  // tilt away from center

    const geo  = new THREE.ConeGeometry(width, height, 5 + Math.floor(rng() * 3), 1);

    // Double cone (crystal point at top AND bottom) for gem-like look
    // Just use a cone pointing up, with a tiny inverted one below
    const mesh = new THREE.Mesh(geo, mat);
    const offsetX = Math.cos(angle) * spread;
    const offsetZ = Math.sin(angle) * spread;
    mesh.position.set(cx + offsetX, baseY + height * 0.5, cz + offsetZ);

    // Tilt outward slightly
    mesh.rotation.z =  Math.cos(angle) * tilt;
    mesh.rotation.x = -Math.sin(angle) * tilt;

    group.add(mesh);

    // Small base nub underneath each crystal
    if (rarity !== 'common') {
      const nubGeo  = new THREE.ConeGeometry(width * 0.7, height * 0.25, 5, 1);
      const nub     = new THREE.Mesh(nubGeo, mat);
      nub.position.set(cx + offsetX, baseY + height * 0.08, cz + offsetZ);
      nub.rotation.z = mesh.rotation.z;
      nub.rotation.x = mesh.rotation.x;
      nub.rotation.y = Math.PI;  // flip — points down
      group.add(nub);
    }
  }

  // For legendary/epic add a glowing point light
  if (rarity === 'legendary' || rarity === 'epic') {
    const light = new THREE.PointLight(oreColor, rarity === 'legendary' ? 1.8 : 1.0, 6);
    light.position.set(cx, baseY + baseSize, cz);
    group.add(light);
  }
}
