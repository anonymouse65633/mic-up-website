// ============================================================
//  WalkWorld 3D — mining.js  (PART 4 FINAL)
//
//  NEW in Part 4:
//  ─────────────
//  • Particle pool     — 60 pre-allocated debris meshes, reused on every dig
//  • Camera shake      — triggerShake / tickCameraShake with exponential decay
//  • Punch resistance  — layers need 1–20 hits before breaking through
//                        → onDig returns { partialHit, punchProgress } mid-sequence
//  • Rarity geometry   — shape-per-rarity tier:
//       common     : ConeGeometry cluster + flat TorusGeometry ring
//       uncommon   : OctahedronGeometry, slow rotation, PointLight 0.6
//       rare       : DodecahedronGeometry + 2 orbiting cone satellites + pulse ring
//       epic       : IcosahedronGeometry + 3-axis spin + dual PointLights + 3 orbiting spheres
//       legendary  : TorusKnotGeometry, float, intense PointLight 1.8, haze sphere
//       mythic     : TorusKnotGeometry (denser), fast float, PointLight 2.5, dual hazes
//  • tickOreCrystals   — animation-budget system (only 5 nearest animated per frame)
//       LOD: >15m skip rotate, >25m disable PointLights, >40m use proxy sphere
//
//  Carries forward from Part 3:
//  ────────────────────────────
//  • Gemini ore deposit generation
//  • Deterministic vein system (generateOreVeins)
//  • Motherlode detection (4+ = 1.5×, 6+ = 2× + server chat)
//  • Strata rings on shaft walls
//  • onDig fully wired to vein/deposit/size bonus pipeline
// ============================================================

import { LAYERS, ORES, ORE_TABLE, getMaterialAtDepth, rollOre } from './layers.js';
export { LAYERS, ORES, getMaterialAtDepth, rollOre };

import {
  scene, digSphere, getShaftAt,
  MINE_CELL, DIG_SPHERE_R, DIG_REACH, getBaseHeightAt,
} from './world.js';

import { GEMINI_API_KEY } from './config.js';

// ============================================================
//  GEMINI ORE DEPOSIT GENERATION
// ============================================================
const GEMINI_ENDPOINT = () =>
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

  if (!GEMINI_API_KEY || GEMINI_API_KEY.startsWith('REPLACE_WITH')) {
    console.warn('[Mining] Gemini API key not configured, using fallback deposits.');
    _deposits = [...FALLBACK_DEPOSITS];
    _deposits.forEach(d => _depositSet.add(`${d.cx},${d.cz}`));
    return;
  }

  try {
    const res = await fetch(GEMINI_ENDPOINT(), {
      method  : 'POST',
      headers : { 'Content-Type': 'application/json' },
      body    : JSON.stringify({
        contents        : [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.9, maxOutputTokens: 512 },
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
//  VEIN SYSTEM  (Part 3 — unchanged)
// ============================================================
const _cellVein  = new Map();
const _veinMeta  = new Map();
let _veinCounter = 0;

const VEIN_SEEDS_PER_LAYER = {
  'Grass/Dirt':  4, 'Clay': 7, 'Stone': 14, 'Sandstone': 11,
  'Dark Stone': 9,  'Obsidian': 7, 'Dense Ore': 5, 'The Void': 3,
};

function _makePrng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = Math.imul(s, 1664525) + 1013904223 >>> 0;
    return s / 0x100000000;
  };
}

export function generateOreVeins(worldSeed = 42) {
  _cellVein.clear(); _veinMeta.clear(); _veinCounter = 0;
  const rng = _makePrng(worldSeed);
  const HALF = 30;

  for (const layer of LAYERS) {
    const seeds = VEIN_SEEDS_PER_LAYER[layer.name] || 6;
    const table = ORE_TABLE[layer.name];
    if (!table || table.length === 0) continue;

    for (let s = 0; s < seeds; s++) {
      const cx0 = Math.floor(rng() * (HALF * 2 + 1)) - HALF;
      const cz0 = Math.floor(rng() * (HALF * 2 + 1)) - HALF;
      const ore = _rollFromTable(table, rng());
      if (!ore) continue;
      const midDepth = (layer.minDepth + layer.maxDepth) / 2;
      const band = ore.depthBand;
      if (midDepth < band[0] || midDepth > band[1]) continue;

      const veinId = ++_veinCounter;
      const cells  = [];
      _addCell(cx0, cz0, ore.id, veinId, layer.name, rng, cells);

      const dirs = [
        [cx0+1,cz0],[cx0-1,cz0],[cx0,cz0+1],[cx0,cz0-1],
      ].sort(() => rng() - 0.5);

      let propagated = 0;
      for (const [nx, nz] of dirs) {
        if (propagated >= 3) break;
        if (rng() < 0.55) {
          _addCell(nx, nz, ore.id, veinId, layer.name, rng, cells);
          propagated++;
          if (rng() < 0.30) {
            const dirs2 = [[nx+1,nz],[nx-1,nz],[nx,nz+1],[nx,nz-1]].sort(() => rng() - 0.5);
            const [nx2, nz2] = dirs2[0];
            const k2 = `${nx2},${nz2}`;
            const existing = _cellVein.get(k2) || [];
            if (!existing.some(v => v.layerName === layer.name)) {
              _addCell(nx2, nz2, ore.id, veinId, layer.name, rng, cells);
            }
          }
        }
      }
      _veinMeta.set(veinId, { oreId: ore.id, layerName: layer.name, totalCells: cells.length, minedCells: new Set() });
    }
  }
  console.log(`[Mining] Generated ${_veinCounter} ore veins across ${_cellVein.size} unique cells.`);
}

function _addCell(cx, cz, oreId, veinId, layerName, rng, cells) {
  const key = `${cx},${cz}`;
  const existing = _cellVein.get(key) || [];
  if (existing.some(v => v.layerName === layerName)) return;
  const size = Math.floor(rng() * 3) + 1;
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

export function getVeinCell(cx, cz, layerName) {
  const entries = _cellVein.get(`${cx},${cz}`);
  if (!entries) return null;
  return entries.find(v => v.layerName === layerName) || null;
}

export function recordVeinMined(veinId, cx, cz) {
  const meta = _veinMeta.get(veinId);
  if (!meta) return null;
  meta.minedCells.add(`${cx},${cz}`);
  const minedCount = meta.minedCells.size;
  return {
    isMotherlode: minedCount >= 4, isGrandMotherlode: minedCount >= 6,
    minedCount, totalCells: meta.totalCells, oreId: meta.oreId,
  };
}

// ============================================================
//  STATE
// ============================================================
let _money = 0;
export function getMoney()       { return _money; }
export function addMoney(amount) { _money = Math.max(0, _money + amount); }
export function getDepthAt(x, z) { const s = getShaftAt(x, z); return s ? s.depth : 0; }

// _sphereMeshes: key → { group, cx, cz, baseY, rarity, crystals[], satellites[],
//                         pointLights[], pulseRings[], animPhase, floatAmp,
//                         proxyMesh|null, isLowLOD }
const _sphereMeshes = new Map();

// Punch resistance: tracks hit count per dig-cell-key
const _punchHits = new Map();

// ============================================================
//  PARTICLE POOL  (60 pre-allocated debris meshes)
// ============================================================
const POOL_SIZE        = 60;
const _particlePool    = [];
const _activeParticles = [];

export function initMining() {
  if (typeof THREE === 'undefined') return;
  const geo = new THREE.OctahedronGeometry(0.055, 0);
  const mat = new THREE.MeshLambertMaterial({ color: 0x888888 });
  for (let i = 0; i < POOL_SIZE; i++) {
    const mesh = new THREE.Mesh(geo, mat.clone());
    mesh.visible = false;
    scene.add(mesh);
    _particlePool.push(mesh);
  }
}

function _acquireParticle() {
  return _particlePool.find(m => !m.visible) ?? null;
}

function _spawnParticles(x, y, z, color, count = 8) {
  const col = new THREE.Color(color);
  for (let i = 0; i < count; i++) {
    const mesh = _acquireParticle();
    if (!mesh) break;
    mesh.material.color.copy(col);
    mesh.position.set(x, y, z);
    mesh.visible = true;
    mesh.scale.setScalar(0.8 + Math.random() * 0.8);
    const speed = 2.5 + Math.random() * 3.5;
    const theta = Math.random() * Math.PI * 2;
    const phi   = Math.PI * (0.25 + Math.random() * 0.5);
    _activeParticles.push({
      mesh,
      vel: {
        x: Math.sin(phi) * Math.cos(theta) * speed,
        y: Math.cos(phi) * speed + 1.5,
        z: Math.sin(phi) * Math.sin(theta) * speed,
      },
      life: 0,
      maxLife: 0.55 + Math.random() * 0.35,
    });
  }
}

export function tickParticles(dt) {
  for (let i = _activeParticles.length - 1; i >= 0; i--) {
    const p = _activeParticles[i];
    p.life += dt;
    if (p.life >= p.maxLife) {
      p.mesh.visible = false;
      _activeParticles.splice(i, 1);
      continue;
    }
    const t = p.life / p.maxLife;
    p.vel.y -= 9.8 * dt;
    p.mesh.position.x += p.vel.x * dt;
    p.mesh.position.y += p.vel.y * dt;
    p.mesh.position.z += p.vel.z * dt;
    p.mesh.material.opacity = 1 - t * t;
    p.mesh.material.transparent = true;
    p.mesh.scale.setScalar((1 - t) * (0.8 + Math.random() * 0.05));
    p.mesh.rotation.x += dt * 6;
    p.mesh.rotation.z += dt * 4;
  }
}

// ============================================================
//  CAMERA SHAKE
// ============================================================
let _shakeAmount = 0;
const SHAKE_DECAY = 9.0;

export function triggerShake(amount) {
  _shakeAmount = Math.max(_shakeAmount, amount);
}

export function tickCameraShake(camera, dt) {
  if (!camera || _shakeAmount <= 0.001) { _shakeAmount = 0; return; }
  camera.position.x += (Math.random() - 0.5) * _shakeAmount * 0.12;
  camera.position.y += (Math.random() - 0.5) * _shakeAmount * 0.08;
  _shakeAmount *= Math.exp(-SHAKE_DECAY * dt);
}

// ============================================================
//  MAIN DIG API — punch resistance + full ore pipeline
// ============================================================
export function onDig(px, py, pz, yaw, pitch, eyeHeight) {
  const surfaceY      = getBaseHeightAt(px, pz);
  const shaft         = getShaftAt(px, pz);
  const currentFloorY = shaft ? shaft.floorY : surfaceY;

  // Preview depth to determine the layer the player is about to punch
  const previewDepth = surfaceY - currentFloorY + DIG_SPHERE_R * 0.9;
  const layer        = getMaterialAtDepth(Math.max(0, previewDepth));

  // ── Punch resistance ────────────────────────────────────
  const punchKey   = `${Math.round(px / MINE_CELL)},${Math.round(pz / MINE_CELL)}`;
  const maxPunches = Math.max(1, layer.punches ?? 1);
  let currentHits  = (_punchHits.get(punchKey) ?? 0) + 1;
  _punchHits.set(punchKey, currentHits);

  const punchProgress = Math.min(currentHits / maxPunches, 1);
  const shakeAmt = (layer.shakeAmt ?? 0.05) * (currentHits < maxPunches ? 0.5 : 1.0);
  triggerShake(shakeAmt);

  if (currentHits < maxPunches) {
    return { partialHit: true, layer, hits: currentHits, maxHits: maxPunches, punchProgress, shakeAmt };
  }

  // ── Full break ──────────────────────────────────────────
  _punchHits.delete(punchKey);

  const digX = px;
  const digY = currentFloorY - (DIG_SPHERE_R * 0.45);
  const digZ = pz;

  const result = digSphere(digX, digY, digZ, DIG_SPHERE_R);
  if (!result) return null;

  const { key, cellX, cellZ, depth, surfaceY: sY, floorY } = result;
  const finalLayer = getMaterialAtDepth(depth);
  const depositHit = finalLayer.name === 'Dense Ore' && _isDeposit(cellX, cellZ);

  // Ore resolution: vein first, then scatter
  let ore = null, oreSize = 1, veinId = null;
  const veinEntry = getVeinCell(cellX, cellZ, finalLayer.name);
  if (veinEntry) {
    ore = ORES[veinEntry.oreId]; oreSize = veinEntry.size; veinId = veinEntry.veinId;
  } else {
    ore = rollOre(finalLayer.name, depth);
  }

  // Coins
  const oreCoinValue = (ore ? ore.value : 0) * (oreSize === 3 ? 2.0 : oreSize === 2 ? 1.5 : 1.0);
  let earned = finalLayer.value + oreCoinValue;
  if (depositHit) earned *= 3;

  // Motherlode
  let motherlodeInfo = null;
  if (veinId !== null) {
    motherlodeInfo = recordVeinMined(veinId, cellX, cellZ);
    if (motherlodeInfo?.isGrandMotherlode) earned += oreCoinValue;
    else if (motherlodeInfo?.isMotherlode)  earned += oreCoinValue * 0.5;
  }
  _money += earned;

  // Particles
  _spawnParticles(digX, (floorY ?? digY - DIG_SPHERE_R) + 0.15, digZ, ore ? ore.color : finalLayer.color, ore ? 12 : 7);

  // Layer change detection
  let newLayer = null;
  if (shaft) {
    const prevLayer = getMaterialAtDepth(shaft.depth);
    if (prevLayer.name !== finalLayer.name) newLayer = finalLayer;
  }

  _updateSphereVisuals(key, digX, digY, digZ, DIG_SPHERE_R, depth, sY, ore, finalLayer, oreSize);

  return {
    layer: finalLayer, ore, oreSize, depth, earned, totalMoney: _money,
    isDeposit: depositHit, veinEntry, motherlode: motherlodeInfo,
    cellX, cellZ, punchProgress: 1, shakeAmt: finalLayer.shakeAmt ?? 0.05, newLayer,
  };
}

// ============================================================
//  RESET
// ============================================================
export function resetMining() {
  for (const data of _sphereMeshes.values()) {
    scene.remove(data.group);
    data.group.traverse(c => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    });
    if (data.proxyMesh) { scene.remove(data.proxyMesh); data.proxyMesh.geometry?.dispose(); data.proxyMesh.material?.dispose(); }
  }
  _sphereMeshes.clear();
  _punchHits.clear();
  _money = 0;
  _activeParticles.forEach(p => { p.mesh.visible = false; });
  _activeParticles.length = 0;
}

// ============================================================
//  SPHERE VISUALS
// ============================================================
function _updateSphereVisuals(key, cx, cy, cz, radius, depth, surfaceY, ore, layer, oreSize = 1) {
  const old = _sphereMeshes.get(key);
  if (old) {
    scene.remove(old.group);
    old.group.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); });
    if (old.proxyMesh) { scene.remove(old.proxyMesh); old.proxyMesh.geometry?.dispose(); old.proxyMesh.material?.dispose(); }
  }

  const group  = new THREE.Group();
  const floorY = cy - radius;

  // Strata rings
  const visibleLayers = LAYERS.filter(l => {
    const bt = surfaceY - l.minDepth;
    const bb = surfaceY - Math.min(depth, l.maxDepth);
    return bt > bb;
  });
  for (const vl of visibleLayers) {
    const bt = surfaceY - vl.minDepth;
    const bb = surfaceY - Math.min(depth, vl.maxDepth);
    if (bt - bb < 0.1) continue;
    const midY = (bt + bb) * 0.5;
    const relY = Math.max(-radius * 0.95, Math.min(radius * 0.95, midY - cy));
    const ringR = Math.sqrt(Math.max(0, radius * radius - relY * relY));
    if (ringR < 0.3) continue;
    const t = new THREE.Mesh(
      new THREE.TorusGeometry(ringR, 0.12, 6, 24, Math.PI * 2),
      new THREE.MeshLambertMaterial({ color: vl.color, transparent: true, opacity: 0.85 }),
    );
    t.rotation.x = Math.PI / 2;
    t.position.set(cx, midY, cz);
    group.add(t);
  }

  // Ore crystals
  let crystalData = null;
  if (ore) crystalData = _buildOreCrystalCluster(group, cx, floorY + 0.05, cz, ore, depth, oreSize);

  scene.add(group);
  _sphereMeshes.set(key, {
    group, cx, cz,
    baseY:       floorY + 0.05,
    rarity:      ore?.rarity ?? 'common',
    crystals:    crystalData?.crystals    ?? [],
    satellites:  crystalData?.satellites  ?? [],
    pointLights: crystalData?.pointLights ?? [],
    pulseRings:  crystalData?.pulseRings  ?? [],
    animPhase:   Math.random() * Math.PI * 2,
    floatAmp:    crystalData?.floatAmp    ?? 0,
    proxyMesh:   null,
    isLowLOD:    false,
  });
}

// ============================================================
//  RARITY-BASED GEOMETRY
// ============================================================
function _buildOreCrystalCluster(group, cx, baseY, cz, ore, depth, oreSize = 1) {
  const rarity     = ore.rarity;
  const oreColor   = ore.color;
  const emissive   = new THREE.Color(oreColor);
  const sizeFactor = 0.7 + oreSize * 0.2;

  const crystals = [], satellites = [], pointLights = [], pulseRings = [];
  let floatAmp = 0;

  let rngSeed = (Math.round(cx * 13 + cz * 7 + 1000)) >>> 0;
  const rng = () => { rngSeed = Math.imul(rngSeed, 1664525) + 1013904223 >>> 0; return rngSeed / 0x100000000; };

  const mkMat = (intensity, opacity = 1) => new THREE.MeshLambertMaterial({
    color: oreColor, emissive, emissiveIntensity: intensity,
    transparent: opacity < 1, opacity,
  });

  if (rarity === 'common') {
    const mat = mkMat(0.15);
    const count = Math.round(3 * sizeFactor);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + rng() * 0.8;
      const spread = i === 0 ? 0 : 0.12 + rng() * 0.45;
      const h = (0.18 + rng() * 0.25) * sizeFactor;
      const w = (0.06 + rng() * 0.07) * sizeFactor;
      const mesh = new THREE.Mesh(new THREE.ConeGeometry(w, h, 5, 1), mat);
      mesh.position.set(cx + Math.cos(angle) * spread, baseY + h * 0.5, cz + Math.sin(angle) * spread);
      mesh.rotation.z =  Math.cos(angle) * 0.35 * rng();
      mesh.rotation.x = -Math.sin(angle) * 0.35 * rng();
      group.add(mesh); crystals.push(mesh);
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.18 * sizeFactor, 0.025, 4, 18), mkMat(0.12, 0.75));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(cx, baseY + 0.01, cz);
    group.add(ring); pulseRings.push(ring);

  } else if (rarity === 'uncommon') {
    const mat = mkMat(0.65);
    const count = Math.round(4 * sizeFactor);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + rng() * 0.6;
      const spread = i === 0 ? 0 : 0.08 + rng() * 0.38;
      const sz = (0.12 + rng() * 0.16) * sizeFactor;
      const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(sz, 0), mat);
      mesh.position.set(cx + Math.cos(angle) * spread, baseY + sz, cz + Math.sin(angle) * spread);
      mesh.rotation.y = rng() * Math.PI;
      group.add(mesh); crystals.push(mesh);
    }
    // Emissive-only lighting — no PointLight to avoid WebGL uniform overflow

  } else if (rarity === 'rare') {
    const mat = mkMat(0.85);
    const sz  = (0.22 + rng() * 0.12) * sizeFactor;
    const main = new THREE.Mesh(new THREE.DodecahedronGeometry(sz, 0), mat);
    main.position.set(cx, baseY + sz + 0.06, cz);
    main.rotation.y = rng() * Math.PI * 2;
    group.add(main); crystals.push(main);
    for (let i = 0; i < 2; i++) {
      const a = (i / 2) * Math.PI * 2 + rng() * 0.5;
      const ssz = sz * 0.55;
      const sm = new THREE.Mesh(new THREE.DodecahedronGeometry(ssz, 0), mat);
      sm.position.set(cx + Math.cos(a) * 0.22 * sizeFactor, baseY + ssz + 0.04, cz + Math.sin(a) * 0.22 * sizeFactor);
      sm.rotation.y = rng() * Math.PI * 2;
      group.add(sm); crystals.push(sm);
    }
    for (let i = 0; i < 2; i++) {
      const satMesh = new THREE.Mesh(new THREE.ConeGeometry(0.045 * sizeFactor, 0.16 * sizeFactor, 5, 1), mkMat(0.6));
      group.add(satMesh);
      satellites.push({ mesh: satMesh, angle: (i / 2) * Math.PI * 2, dist: 0.30 * sizeFactor, speed: 1.1 + rng() * 0.4, baseY: baseY + sz + 0.06, tiltZ: 0.3 + rng() * 0.3 });
    }
    const pulseMesh = new THREE.Mesh(new THREE.TorusGeometry(sz * 1.8, 0.03, 6, 24), mkMat(0.5, 0.7));
    pulseMesh.rotation.x = Math.PI / 2;
    pulseMesh.position.set(cx, baseY + sz + 0.06, cz);
    group.add(pulseMesh); pulseRings.push(pulseMesh);
    // Emissive-only — no PointLight (prevents WebGL uniform overflow)
    // Higher emissiveIntensity compensates for the missing point light

  } else if (rarity === 'epic') {
    const mat = mkMat(1.0);
    const sz  = (0.28 + rng() * 0.10) * sizeFactor;
    const main = new THREE.Mesh(new THREE.IcosahedronGeometry(sz, 0), mat);
    main.position.set(cx, baseY + sz + 0.08, cz);
    group.add(main); crystals.push(main);
    for (let i = 0; i < 3; i++) {
      const orbMesh = new THREE.Mesh(new THREE.SphereGeometry(0.065 * sizeFactor, 6, 4), mkMat(0.75));
      group.add(orbMesh);
      satellites.push({ mesh: orbMesh, angle: (i / 3) * Math.PI * 2, dist: 0.42 * sizeFactor, speed: 0.85 + rng() * 0.3, baseY: baseY + sz + 0.08, tiltZ: 0 });
    }
    // Emissive-only — no PointLights (prevents WebGL uniform overflow)
    floatAmp = 0.06;

  } else if (rarity === 'legendary') {
    const mat = mkMat(1.2);
    const sz  = (0.22 + rng() * 0.06) * sizeFactor;
    const main = new THREE.Mesh(new THREE.TorusKnotGeometry(sz, sz * 0.32, 64, 8, 2, 3), mat);
    main.position.set(cx, baseY + sz + 0.3, cz);
    group.add(main); crystals.push(main);
    const hazeMesh = new THREE.Mesh(new THREE.SphereGeometry(sz * 2.2, 8, 6), new THREE.MeshLambertMaterial({ color: oreColor, transparent: true, opacity: 0.08, depthWrite: false }));
    hazeMesh.position.set(cx, baseY + sz + 0.3, cz);
    group.add(hazeMesh);
    // Emissive-only — no PointLight (prevents WebGL uniform overflow)
    floatAmp = 0.12;

  } else if (rarity === 'mythic') {
    const mat = mkMat(1.5);
    const sz  = (0.26 + rng() * 0.06) * sizeFactor;
    const main = new THREE.Mesh(new THREE.TorusKnotGeometry(sz, sz * 0.36, 96, 10, 3, 4), mat);
    main.position.set(cx, baseY + sz + 0.35, cz);
    group.add(main); crystals.push(main);
    for (let h = 0; h < 2; h++) {
      const hazeMesh = new THREE.Mesh(new THREE.SphereGeometry(sz * (2.0 + h * 1.2), 8, 6), new THREE.MeshLambertMaterial({ color: oreColor, transparent: true, opacity: 0.06 - h * 0.02, depthWrite: false }));
      hazeMesh.position.set(cx, baseY + sz + 0.35, cz);
      group.add(hazeMesh);
    }
    for (let i = 0; i < 3; i++) {
      const oMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07 * sizeFactor, 0), mkMat(0.9));
      group.add(oMesh);
      satellites.push({ mesh: oMesh, angle: (i / 3) * Math.PI * 2, dist: 0.5 * sizeFactor, speed: 1.4 + rng() * 0.4, baseY: baseY + sz + 0.35, tiltZ: 0 });
    }
    // Emissive-only — no PointLight (prevents WebGL uniform overflow)
    floatAmp = 0.18;
  }

  return { crystals, satellites, pointLights, pulseRings, floatAmp };
}

// ============================================================
//  TICK — LOD + ANIMATION BUDGET  (max 5 animated per frame)
//
//  LOD tiers:
//    ≤ 15m  → full animation (spin, float, orbit, pulse)
//    15–25m → skip rotation/float
//    25–40m → also disable PointLights
//    > 40m  → replace with tiny proxy sphere
// ============================================================
const MAX_ANIMATED    = 5;
const LOD_SKIP_ROTATE = 15;
const LOD_NO_LIGHTS   = 25;
const LOD_PROXY       = 40;

let _crystalTime = 0;

export function tickOreCrystals(camera, dt) {
  if (!camera || _sphereMeshes.size === 0) return;
  if (typeof THREE === 'undefined') return;
  _crystalTime += dt;

  const camPos = camera.position;
  const sorted = [..._sphereMeshes.entries()]
    .map(([key, data]) => {
      const dx = data.cx - camPos.x, dz = data.cz - camPos.z;
      return { key, data, dist: Math.sqrt(dx * dx + dz * dz) };
    })
    .sort((a, b) => a.dist - b.dist);

  let animated = 0;

  for (const { key, data, dist } of sorted) {
    const { rarity, crystals, satellites, pointLights, pulseRings, animPhase, floatAmp } = data;

    // LOD > 40m: proxy sphere
    if (dist > LOD_PROXY) {
      if (!data.isLowLOD) {
        data.isLowLOD = true;
        data.group.visible = false;
        if (!data.proxyMesh) {
          const pm = new THREE.Mesh(
            new THREE.SphereGeometry(0.18, 4, 3),
            new THREE.MeshLambertMaterial({ color: crystals[0]?.material?.color ?? 0xffffff }),
          );
          pm.position.set(data.cx, data.baseY + 0.2, data.cz);
          scene.add(pm);
          data.proxyMesh = pm;
        }
        data.proxyMesh.visible = true;
      }
      continue;
    }

    // Restore from proxy
    if (data.isLowLOD) {
      data.isLowLOD = false;
      data.group.visible = true;
      if (data.proxyMesh) data.proxyMesh.visible = false;
    }

    // LOD > 25m: disable point lights
    const lightsOn = dist <= LOD_NO_LIGHTS;
    for (const pl of pointLights) pl.visible = lightsOn;

    // LOD > 15m or over animation budget: skip animate
    if (dist > LOD_SKIP_ROTATE || animated >= MAX_ANIMATED) continue;
    animated++;

    const t = _crystalTime + animPhase;

    // Float (epic/legendary/mythic)
    if (floatAmp > 0 && crystals.length > 0) {
      crystals[0].position.y = data.baseY + Math.sin(t * 1.4) * floatAmp + 0.22;
    }

    // Per-rarity rotation
    for (const mesh of crystals) {
      switch (rarity) {
        case 'uncommon':  mesh.rotation.y += dt * 0.55; break;
        case 'rare':      mesh.rotation.y += dt * 0.9;  mesh.rotation.x += dt * 0.15; break;
        case 'epic':      mesh.rotation.x += dt * 0.7;  mesh.rotation.y += dt * 1.1;  mesh.rotation.z += dt * 0.4; break;
        case 'legendary': mesh.rotation.x += dt * 0.5;  mesh.rotation.y += dt * 0.8; break;
        case 'mythic':    mesh.rotation.x += dt * 0.9;  mesh.rotation.y += dt * 1.2;  mesh.rotation.z += dt * 0.6; break;
      }
    }

    // Satellite orbits
    for (const sat of satellites) {
      sat.angle += dt * sat.speed;
      sat.mesh.position.set(
        data.cx + Math.cos(sat.angle) * sat.dist,
        sat.baseY + Math.sin(sat.angle * 1.3) * 0.08,
        data.cz  + Math.sin(sat.angle) * sat.dist,
      );
      if (sat.tiltZ) sat.mesh.rotation.z = sat.angle;
      sat.mesh.rotation.y += dt * 2;
    }

    // Pulse rings
    for (const ring of pulseRings) {
      const pulse = 1.0 + Math.sin(t * 2.2 + animPhase) * 0.12;
      ring.scale.set(pulse, pulse, 1);
      if (ring.material) ring.material.opacity = 0.55 + Math.sin(t * 2.2) * 0.2;
    }
  }
}
