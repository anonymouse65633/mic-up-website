// ============================================================
//  WalkWorld 3D — caves.js  (PART 2)
//
//  Procedural underground cave system.
//  Handles: Drunkard's Walk cave generation · cave biomes ·
//           Crystal Geode rooms · Treasure chests · Underground
//           cabins · Surface landmarks
//
//  Public API
//  ----------
//  initCaves(scene, worldSize)   — call once after initWorld()
//  tickCaves(px, py, pz, dt)     — call every frame (glow anim + proximity)
//  onInteractKey(px, py, pz)     — call when player presses E
//  getCaveData()                 — returns { caves, geodes }
//  setOnChestOpen(callback)      — callback(chest) when chest opened
// ============================================================

import { getMaterialAtDepth }  from './layers.js';
import { scene as _worldScene } from './world.js';

// ── Cave generation constants ─────────────────────────────────
const NUM_WALKERS     = 5;
const WALK_STEPS      = 60;
const CAVE_CELL       = 4.0;     // world units per cave grid step
const CAVE_SPHERE_R   = 2.0;     // radius of each step's carved sphere
const GEODE_CHANCE    = 0.10;    // 10% of caves become a geode room
const GEODE_R_MIN     = 4;
const GEODE_R_MAX     = 6;
const WORLD_HALF      = 100;     // matches world.js HALF

// Depth ranges for cave seeding
const CAVE_DEPTH_MIN  = 20;
const CAVE_DEPTH_MAX  = 200;

// ── Chest spawn depths (metres underground) ──────────────────
const CHEST_DEPTHS = [20, 55, 100, 170];
// Grid cell spacing for chest spawning
const CHEST_GRID   = 8;

// ── Seeded RNG (deterministic per world) ─────────────────────
let _rng = null;
function _makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// ── Module state ──────────────────────────────────────────────
let _scene         = null;
let _caves         = [];     // [{ steps:[{x,y,z}], isGeode, geodeOre }]
let _geodeRooms    = [];     // [{ cx, cy, cz, r, oreId, mesh }]
let _chests        = [];     // [{ x, y, z, depth, tier, mesh, light, opened }]
let _cabins        = [];     // [{ x, z, depth, group }]
let _landmarks     = [];     // [{ x, z, group, type }]

// Callbacks
let _onChestOpen   = null;

// Biome emitter particles (lightweight)
const _emitters    = [];

// ── Helpers ───────────────────────────────────────────────────
function _depthToWorldY(surfaceY, depth) {
  return surfaceY - depth;
}

function _getLayerForDepth(d) {
  return getMaterialAtDepth(d);
}

// Tier based on chest depth
function _chestTier(depth) {
  if (depth >= 150) return 'legendary';
  if (depth >= 80)  return 'epic';
  if (depth >= 40)  return 'rare';
  return 'common';
}

function _chestGlowColor(tier) {
  const MAP = {
    common: 0xffffaa, rare: 0xffaa22,
    epic: 0x88eeff, legendary: 0xcc00ff,
  };
  return MAP[tier] ?? 0xffffaa;
}

function _chestGlowIntensity(tier) {
  const MAP = { common: 0.5, rare: 0.9, epic: 1.4, legendary: 2.0 };
  return MAP[tier] ?? 0.5;
}

// ── Cave Visual Spheres (for rendering hole hints) ────────────
// We don't actually deform terrain (that's world.js's job),
// but we add atmospheric crystal/particle decorations inside caves.

function _buildCaveBiomeDecor(cx, cy, cz, layer) {
  const group = new THREE.Group();

  if (layer.name === 'Stone') {
    // Iron streaks on ceiling — thin horizontal cylinders
    for (let i = 0; i < 4; i++) {
      const cx2 = cx + (_rng() - 0.5) * 3;
      const cz2 = cz + (_rng() - 0.5) * 3;
      const geo  = new THREE.CylinderGeometry(0.04, 0.04, 0.8 + _rng() * 1.2, 4);
      const mat  = new THREE.MeshLambertMaterial({ color: 0x886644 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(cx2, cy + CAVE_SPHERE_R * 0.7, cz2);
      mesh.rotation.z = (_rng() - 0.5) * 1.2;
      group.add(mesh);
    }
  }

  if (layer.name === 'Sandstone') {
    // Gold-dust particle emitter (tiny glowing spheres floating up)
    for (let i = 0; i < 6; i++) {
      const geo  = new THREE.SphereGeometry(0.04, 4, 4);
      const mat  = new THREE.MeshLambertMaterial({
        color: 0xFFCC00, emissive: 0xFFCC00, emissiveIntensity: 0.8,
      });
      const sp = new THREE.Mesh(geo, mat);
      sp.position.set(
        cx + (_rng() - 0.5) * CAVE_SPHERE_R * 1.5,
        cy + (_rng() * CAVE_SPHERE_R * 1.5),
        cz + (_rng() - 0.5) * CAVE_SPHERE_R * 1.5,
      );
      sp.userData.floatSeed = _rng() * Math.PI * 2;
      sp.userData.floatBase = sp.position.y;
      sp.userData.floatAmp  = 0.15 + _rng() * 0.25;
      group.add(sp);
      _emitters.push(sp);
    }
  }

  if (layer.name === 'Obsidian') {
    // Red lava-crack line geometry (cosmetic)
    const pts = [];
    let px2 = cx, pz2 = cz;
    for (let i = 0; i < 8; i++) {
      px2 += (_rng() - 0.5) * 1.2;
      pz2 += (_rng() - 0.5) * 1.2;
      pts.push(new THREE.Vector3(px2, cy + (_rng() - 0.5) * 0.4, pz2));
    }
    const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
    const lineMat = new THREE.LineBasicMaterial({
      color: 0xff2200, transparent: true, opacity: 0.7,
    });
    group.add(new THREE.Line(lineGeo, lineMat));
  }

  if (layer.name === 'The Void') {
    // Void crystal cluster — floating dark purple shards
    for (let i = 0; i < 5; i++) {
      const h = 0.3 + _rng() * 0.6;
      const geo = new THREE.ConeGeometry(0.07, h, 5);
      const mat = new THREE.MeshLambertMaterial({
        color: 0x330055, emissive: 0x220033, emissiveIntensity: 1.0,
      });
      const shard = new THREE.Mesh(geo, mat);
      shard.position.set(
        cx + (_rng() - 0.5) * CAVE_SPHERE_R,
        cy + (_rng() - 0.5) * CAVE_SPHERE_R * 0.5,
        cz + (_rng() - 0.5) * CAVE_SPHERE_R,
      );
      shard.rotation.set(_rng() * 0.5, _rng() * Math.PI * 2, _rng() * 0.5);
      group.add(shard);
    }
    // Dim void point light
    const voidLight = new THREE.PointLight(0x440066, 0.4, 5);
    voidLight.position.set(cx, cy, cz);
    group.add(voidLight);
  }

  _scene.add(group);
  return group;
}

// ── Geode Room ────────────────────────────────────────────────
function _buildGeodeRoom(cx, cy, cz, r, layer) {
  const group = new THREE.Group();

  // Crystal lining — icosahedra covering the inner surface
  const crystalCount = Math.floor(Math.PI * 4 * r * r / 0.7);  // surface area / spacing
  const oreColor     = layer.color;
  const mat = new THREE.MeshLambertMaterial({
    color: oreColor, emissive: new THREE.Color(oreColor),
    emissiveIntensity: 0.4,
  });

  for (let i = 0; i < Math.min(crystalCount, 80); i++) {
    // Fibonacci sphere distribution for even coverage
    const phi   = Math.acos(1 - 2 * (i + 0.5) / crystalCount);
    const theta = Math.PI * (1 + Math.sqrt(5)) * i;
    const nx = Math.sin(phi) * Math.cos(theta);
    const ny = Math.cos(phi);
    const nz = Math.sin(phi) * Math.sin(theta);

    const sx    = 0.06 + _rng() * 0.12;
    const sy    = 0.15 + _rng() * 0.30;
    const geo   = new THREE.ConeGeometry(sx, sy, 5);
    const mesh  = new THREE.Mesh(geo, mat);
    mesh.position.set(cx + nx * r * 0.85, cy + ny * r * 0.85, cz + nz * r * 0.85);
    // Tip points inward
    mesh.lookAt(cx, cy, cz);
    mesh.rotateX(Math.PI / 2);
    group.add(mesh);
  }

  // Central glow
  const glowLight = new THREE.PointLight(oreColor, 1.5, r * 3);
  glowLight.position.set(cx, cy, cz);
  group.add(glowLight);

  _scene.add(group);
  return group;
}

// ── Treasure Chest ────────────────────────────────────────────
function _buildChestMesh(tier) {
  const group = new THREE.Group();
  const glowColor = _chestGlowColor(tier);

  // Main chest body
  const bodyGeo = new THREE.BoxGeometry(0.6, 0.4, 0.4);
  const bodyMat = new THREE.MeshLambertMaterial({
    color: 0x6b4c1f, emissive: new THREE.Color(glowColor),
    emissiveIntensity: 0.2,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  group.add(body);

  // Lid (slightly narrower, on top)
  const lidGeo = new THREE.BoxGeometry(0.62, 0.18, 0.42);
  const lid    = new THREE.Mesh(lidGeo, bodyMat);
  lid.position.y = 0.29;
  group.add(lid);

  // Latch (golden cube)
  const latchGeo = new THREE.BoxGeometry(0.08, 0.08, 0.05);
  const latchMat = new THREE.MeshLambertMaterial({ color: 0xFFD700, emissive: 0xFFD700, emissiveIntensity: 0.5 });
  const latch    = new THREE.Mesh(latchGeo, latchMat);
  latch.position.set(0, 0.05, 0.22);
  group.add(latch);

  // Glow point light
  const light = new THREE.PointLight(glowColor, _chestGlowIntensity(tier), 6);
  light.position.set(0, 0.6, 0);
  group.add(light);

  return { group, light };
}

function _spawnChests(surfaceY) {
  // For each depth tier and each grid cell, randomly spawn a chest
  for (const depth of CHEST_DEPTHS) {
    const tier  = _chestTier(depth);
    const worldY = _depthToWorldY(surfaceY, depth);

    // Grid sweep — 1 chest per CHEST_GRID × CHEST_GRID area
    for (let gz = -WORLD_HALF; gz < WORLD_HALF; gz += CHEST_GRID) {
      for (let gx = -WORLD_HALF; gx < WORLD_HALF; gx += CHEST_GRID) {
        if (_rng() > 0.15) continue;   // ~15% chance per grid cell
        const cx = gx + (_rng() - 0.5) * (CHEST_GRID - 2);
        const cz = gz + (_rng() - 0.5) * (CHEST_GRID - 2);

        const { group, light } = _buildChestMesh(tier);
        group.position.set(cx, worldY + 0.2, cz);
        _scene.add(group);

        _chests.push({
          x: cx, y: worldY + 0.2, z: cz,
          depth, tier,
          mesh: group, light,
          opened: false,
          glowBase: _chestGlowIntensity(tier),
        });
      }
    }
  }
}

// ── Underground Cabins ────────────────────────────────────────
function _buildCabin(cx, cz, surfaceY) {
  const depth  = 30 + _rng() * 30; // 30–60m
  const worldY = _depthToWorldY(surfaceY, depth);
  const group  = new THREE.Group();

  const wallMat = new THREE.MeshLambertMaterial({ color: 0x555566 });
  const floorMat = new THREE.MeshLambertMaterial({ color: 0x333344 });

  // Floor
  const floor = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.15, 3.2), floorMat);
  floor.position.y = -0.08;
  group.add(floor);

  // 4 walls
  const wallW = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.0, 3.2), wallMat);
  wallW.position.set(-1.5, 1.0, 0); group.add(wallW);
  const wallE = wallW.clone(); wallE.position.x = 1.5; group.add(wallE);
  const wallN = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.0, 0.2), wallMat);
  wallN.position.set(0, 1.0, -1.5); group.add(wallN);
  // South wall with doorway gap
  const wallS1 = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.0, 0.2), wallMat);
  wallS1.position.set(-1.1, 1.0, 1.5); group.add(wallS1);
  const wallS2 = wallS1.clone(); wallS2.position.x = 1.1; group.add(wallS2);
  const wallS3 = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.6, 0.2), wallMat);
  wallS3.position.set(0, 1.7, 1.5); group.add(wallS3);

  // Ceiling
  const ceil = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.15, 3.4), floorMat);
  ceil.position.y = 2.08; group.add(ceil);

  // Interior candle light
  const light = new THREE.PointLight(0xffcc66, 0.7, 5);
  light.position.set(0, 1.0, 0); group.add(light);

  // Sign (thin slab with a prompt label)
  const signGeo = new THREE.BoxGeometry(0.8, 0.35, 0.04);
  const signMat = new THREE.MeshLambertMaterial({ color: 0xaa8844 });
  const sign = new THREE.Mesh(signGeo, signMat);
  sign.position.set(0, 1.1, -1.42);
  group.add(sign);
  sign.userData.isSign = true;

  group.position.set(cx, worldY, cz);
  _scene.add(group);

  const cabin = { cx, cz, worldY, depth, group, sign };
  _cabins.push(cabin);
  return cabin;
}

// ── Surface Landmarks ─────────────────────────────────────────
function _buildRuins(cx, cz) {
  const group = new THREE.Group();
  const stoneMat = new THREE.MeshLambertMaterial({ color: 0x888880 });
  const count = 2 + Math.floor(_rng() * 4);
  for (let i = 0; i < count; i++) {
    const h    = 0.8 + _rng() * 2.5;
    const r    = 0.25 + _rng() * 0.3;
    const col  = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.1, h, 6), stoneMat);
    col.position.set((_rng() - 0.5) * 5, h / 2, (_rng() - 0.5) * 5);
    col.rotation.set((_rng() - 0.5) * 0.4, _rng() * Math.PI * 2, (_rng() - 0.5) * 0.3);
    group.add(col);
  }
  group.position.set(cx, 0.05, cz);
  _scene.add(group);
  _landmarks.push({ cx, cz, group, type: 'ruins' });
}

function _buildGlowingStone(cx, cz) {
  const group = new THREE.Group();
  const stoneMat = new THREE.MeshLambertMaterial({
    color: 0x4488ff, emissive: 0x2244aa, emissiveIntensity: 0.6,
  });
  const geo  = new THREE.DodecahedronGeometry(0.35 + _rng() * 0.25, 0);
  const mesh = new THREE.Mesh(geo, stoneMat);
  mesh.position.y = 0.25;
  group.add(mesh);
  const light = new THREE.PointLight(0x4488ff, 0.8, 4);
  light.position.y = 0.5;
  group.add(light);
  group.position.set(cx, 0, cz);
  _scene.add(group);
  _landmarks.push({ cx, cz, group, type: 'glowstone', light, mesh });
}

// ── Main generation ───────────────────────────────────────────

export function initCaves(worldSeed = 0xCAFEBABE) {
  _scene = _worldScene;
  _rng   = _makeRng(worldSeed);
  _caves = []; _geodeRooms = []; _chests = [];
  _cabins = []; _landmarks = []; _emitters.length = 0;

  const surfaceY = 0;   // approximate world surface

  // ── 1. Drunkard's Walk cave generator ─────────────────────
  for (let w = 0; w < NUM_WALKERS; w++) {
    // Random seed point
    let wx = (_rng() - 0.5) * (WORLD_HALF * 1.4);
    let wz = (_rng() - 0.5) * (WORLD_HALF * 1.4);
    let wd = CAVE_DEPTH_MIN + _rng() * (CAVE_DEPTH_MAX - CAVE_DEPTH_MIN);
    const steps = [];

    const isGeode  = _rng() < GEODE_CHANCE;
    let dir = _rng() * Math.PI * 2;  // heading

    for (let s = 0; s < WALK_STEPS; s++) {
      // 25% chance to turn
      if (_rng() < 0.25) dir += (_rng() - 0.5) * Math.PI * 0.7;

      wx += Math.cos(dir) * CAVE_CELL;
      wz += Math.sin(dir) * CAVE_CELL;
      // Slowly drift deeper
      wd += (_rng() - 0.3) * 2.0;
      wd  = Math.max(CAVE_DEPTH_MIN, Math.min(CAVE_DEPTH_MAX, wd));

      // Stay within world bounds
      wx = Math.max(-WORLD_HALF + 5, Math.min(WORLD_HALF - 5, wx));
      wz = Math.max(-WORLD_HALF + 5, Math.min(WORLD_HALF - 5, wz));

      const wy    = surfaceY - wd;
      const layer = _getLayerForDepth(wd);
      steps.push({ x: wx, y: wy, z: wz, depth: wd, layer });

      // Add biome decorations at every other step
      if (s % 2 === 0) {
        _buildCaveBiomeDecor(wx, wy, wz, layer);
      }
    }

    // Geode room at the midpoint of the cave
    let geodeOre = null;
    if (isGeode && steps.length > 0) {
      const mid    = steps[Math.floor(steps.length / 2)];
      const r      = GEODE_R_MIN + _rng() * (GEODE_R_MAX - GEODE_R_MIN);
      const layer  = mid.layer;
      _buildGeodeRoom(mid.x, mid.y, mid.z, r, layer);
      _geodeRooms.push({ cx: mid.x, cy: mid.y, cz: mid.z, r, layer });
      geodeOre = layer.name;
    }

    _caves.push({ steps, isGeode, geodeOre });
  }

  // ── 2. Treasure chests ─────────────────────────────────────
  _spawnChests(surfaceY);

  // ── 3. Underground cabins (6 total) ───────────────────────
  const usedCells = new Set();
  for (let c = 0; c < 6; c++) {
    let cx, cz, key;
    let tries = 0;
    do {
      cx  = Math.floor((_rng() - 0.5) * 40) * 5;
      cz  = Math.floor((_rng() - 0.5) * 40) * 5;
      key = `${cx},${cz}`;
      tries++;
    } while (usedCells.has(key) && tries < 20);
    usedCells.add(key);
    _buildCabin(cx, cz, surfaceY);
  }

  // ── 4. Surface landmarks ───────────────────────────────────
  for (let i = 0; i < 4; i++) {
    const lx = (_rng() - 0.5) * WORLD_HALF * 1.5;
    const lz = (_rng() - 0.5) * WORLD_HALF * 1.5;
    if (_rng() < 0.5) _buildRuins(lx, lz);
    else               _buildGlowingStone(lx, lz);
  }

  console.log(`[Caves] Generated ${_caves.length} caves, ` +
    `${_geodeRooms.length} geodes, ${_chests.length} chests, ` +
    `${_cabins.length} cabins, ${_landmarks.length} landmarks`);
}

// ── Tick (called every frame) ─────────────────────────────────
let _elapsedTime = 0;

export function tickCaves(px, py, pz, dt) {
  _elapsedTime += dt;
  const t = _elapsedTime;

  // Animate floating emitter particles (Sandstone caves)
  for (const sp of _emitters) {
    const seed = sp.userData.floatSeed;
    const base = sp.userData.floatBase;
    const amp  = sp.userData.floatAmp;
    sp.position.y = base + Math.sin(t * 1.2 + seed) * amp;
    sp.material.opacity = 0.5 + 0.5 * Math.sin(t * 1.8 + seed);
  }

  // Animate chest glow — pulse intensity
  for (const chest of _chests) {
    if (chest.opened) continue;
    const pulse = chest.glowBase * (0.8 + 0.2 * Math.sin(t * 1.8 + chest.x));
    chest.light.intensity = pulse;
  }

  // Animate glowing stone landmarks
  for (const lm of _landmarks) {
    if (lm.type !== 'glowstone') continue;
    if (lm.light) lm.light.intensity = 0.6 + 0.4 * Math.sin(t * 0.9 + lm.cx);
    if (lm.mesh)  lm.mesh.rotation.y += dt * 0.3;
  }
}

// ── Interaction ───────────────────────────────────────────────
const INTERACT_REACH = 3.0;

export function setOnChestOpen(callback) {
  _onChestOpen = callback;
}

export function onInteractKey(px, py, pz) {
  // Check chest proximity
  for (const chest of _chests) {
    if (chest.opened) continue;
    const dx = px - chest.x;
    const dy = py - chest.y;
    const dz = pz - chest.z;
    if (dx*dx + dy*dy + dz*dz > INTERACT_REACH * INTERACT_REACH) continue;

    chest.opened = true;
    chest.light.intensity = 0;

    // Animate lid opening (rotate lid child)
    const lid = chest.mesh.children[1];
    if (lid) {
      const open = () => {
        lid.rotation.x -= 0.08;
        if (lid.rotation.x > -Math.PI * 0.45) requestAnimationFrame(open);
      };
      requestAnimationFrame(open);
    }

    if (_onChestOpen) _onChestOpen({ ...chest });
    return { type: 'chest', chest };
  }

  // Check cabin sign proximity
  for (const cabin of _cabins) {
    const dx = px - cabin.cx;
    const dz = pz - cabin.cz;
    if (Math.sqrt(dx*dx + dz*dz) > INTERACT_REACH * 2) continue;
    return { type: 'cabin', cabin };
  }

  return null;
}

// ── Meteor strike ─────────────────────────────────────────────
let _meteorMesh = null;

export function spawnMeteor(wx, wz, surfaceY = 0) {
  // Remove any previous meteor
  if (_meteorMesh) { _scene.remove(_meteorMesh); _meteorMesh = null; }

  const group  = new THREE.Group();
  const mat    = new THREE.MeshLambertMaterial({
    color: 0xffcc22, emissive: 0xff8800, emissiveIntensity: 1.2,
  });
  const geo    = new THREE.DodecahedronGeometry(0.9, 1);
  const body   = new THREE.Mesh(geo, mat);
  group.add(body);

  const light  = new THREE.PointLight(0xff8800, 2.5, 14);
  group.add(light);
  group.position.set(wx, surfaceY + 0.4, wz);
  _scene.add(group);
  _meteorMesh = group;

  // Auto-despawn after 5 minutes
  setTimeout(() => {
    if (_meteorMesh) { _scene.remove(_meteorMesh); _meteorMesh = null; }
  }, 5 * 60 * 1000);

  return { wx, wz };
}

// ── Accessors ─────────────────────────────────────────────────
export function getCaveData() {
  return { caves: _caves, geodes: _geodeRooms, chests: _chests, cabins: _cabins };
}
