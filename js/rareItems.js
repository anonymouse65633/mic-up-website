// ============================================================
//  WalkWorld 3D — rareItems.js  (PART 6)
//
//  Spawns rare item pickups in the Three.js world.
//  Each item is a glowing floating mesh. Pickup on proximity.
//
//  Public API
//  ----------
//  spawnRareItemsInWorld(caves, geodes, cabins)  — call after initCaves
//  tickRareItems(px, py, pz, dt)                 — call every frame
//  spawnMeteorShards(wx, wz, wy, count)          — after meteor event
//  setOnRareItemPickup(fn)                       — fn(id, data)
//  getRareItemMeshGroup()                        → THREE.Group
// ============================================================

import { scene } from './world.js';
import { RARE_ITEM_DEFS } from './prestige.js';

const PICKUP_RADIUS = 2.2;
const FLOAT_AMP     = 0.18;
const FLOAT_FREQ    = 1.2;

// ── Seeded RNG ────────────────────────────────────────────────
let _rng = null;
function _makeRng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0x100000000; };
}

// ── Module state ──────────────────────────────────────────────
const _items   = [];    // { id, x, baseY, z, mesh, light, phase, picked }
let   _group   = null;
let   _onPickup = null;
let   _time    = 0;

// ── Geometry helpers ──────────────────────────────────────────
function _makeMesh(color, rarity) {
  let geo;
  switch (rarity) {
    case 'surface':   geo = new THREE.BoxGeometry(0.35, 0.35, 0.35); break;
    case 'common':    geo = new THREE.OctahedronGeometry(0.22, 0); break;
    case 'uncommon':  geo = new THREE.OctahedronGeometry(0.26, 1); break;
    case 'rare':      geo = new THREE.DodecahedronGeometry(0.24, 0); break;
    case 'epic':      geo = new THREE.IcosahedronGeometry(0.26, 0); break;
    case 'legendary': geo = new THREE.TorusKnotGeometry(0.18, 0.06, 40, 5); break;
    default:          geo = new THREE.OctahedronGeometry(0.22, 0);
  }
  const mat = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.7,
    metalness: 0.4,
    roughness: 0.3,
  });
  return new THREE.Mesh(geo, mat);
}

function _makeLight(color, intensity, distance) {
  return new THREE.PointLight(color, intensity, distance);
}

function _colorForId(id) {
  if (id === 'deep_rune')       return 0x8855ff;
  if (id === 'ancient_compass') return 0xffaa00;
  if (id === 'void_shard')      return 0xcc00ff;
  if (id === 'earthquake_core') return 0xff4400;
  if (id === 'geo_crystal')     return 0x00ffcc;
  if (id === 'sunstone')        return 0xffd700;
  if (id === 'meteor_shard')    return 0xff6600;
  if (id.startsWith('fossil_')) return 0xc8a060;
  return 0xffffff;
}

function _rarityForId(id) {
  if (['void_shard','sunstone'].includes(id))  return 'legendary';
  if (['deep_rune','earthquake_core'].includes(id)) return 'epic';
  if (['ancient_compass','geo_crystal'].includes(id)) return 'rare';
  if (id === 'meteor_shard')                   return 'uncommon';
  if (id.startsWith('fossil_'))                return 'common';
  return 'common';
}

// ── Spawn helpers ─────────────────────────────────────────────
function _spawnItem(id, x, y, z) {
  const color = _colorForId(id);
  const rarity = _rarityForId(id);
  const mesh  = _makeMesh(color, rarity);
  const light = _makeLight(color, 0.8, 5);
  mesh.position.set(x, y + 0.5, z);
  light.position.set(x, y + 0.7, z);
  _group.add(mesh);
  _group.add(light);
  _items.push({ id, x, baseY: y + 0.5, z, mesh, light, phase: Math.random() * Math.PI * 2, picked: false });
}

// ── Public: spawn from cave/geode/cabin data ──────────────────
export function spawnRareItemsInWorld(caves, geodes, cabins) {
  if (_group) { scene.remove(_group); }
  _group = new THREE.Group();
  _group.name = 'rareItems';
  scene.add(_group);
  _items.length = 0;

  _rng = _makeRng(0xDEADBEEF);

  // 1. Deep Rune — in Obsidian caves (caves with layer Obsidian or depth ~100m)
  const obsidianCaves = caves.filter(c => {
    const s = c.steps[0];
    return s && Math.abs(s.y) > 80;
  });
  if (obsidianCaves.length > 0) {
    const cave = obsidianCaves[Math.floor(_rng() * obsidianCaves.length)];
    const step = cave.steps[Math.floor(_rng() * cave.steps.length)];
    if (step) _spawnItem('deep_rune', step.x, step.y, step.z);
  }

  // 2. Ancient Compass — in underground cabins
  if (cabins.length > 0) {
    const cabin = cabins[Math.floor(_rng() * cabins.length)];
    _spawnItem('ancient_compass', cabin.cx + 1, -(cabin.depth ?? 30) + 0.5, cabin.cz + 1);
  }

  // 3. Void Shard — in deep caves (depth > 200)
  const voidCaves = caves.filter(c => c.steps[0] && Math.abs(c.steps[0].y) > 180);
  if (voidCaves.length > 0) {
    const cave = voidCaves[Math.floor(_rng() * voidCaves.length)];
    const step = cave.steps[Math.floor(_rng() * cave.steps.length)];
    if (step) _spawnItem('void_shard', step.x, step.y, step.z);
  }

  // 4. Earthquake Core — in caves at Dense Ore depth (~150m)
  const denseCaves = caves.filter(c => {
    const s = c.steps[0];
    return s && Math.abs(s.y) > 120 && Math.abs(s.y) < 200;
  });
  if (denseCaves.length > 0) {
    const cave = denseCaves[Math.floor(_rng() * denseCaves.length)];
    const step = cave.steps[Math.floor(_rng() * cave.steps.length)];
    if (step) _spawnItem('earthquake_core', step.x, step.y, step.z);
  }

  // 5. Geo Crystals — one per geode room (up to 3)
  const geodeSample = geodes.slice(0, 3);
  for (const geode of geodeSample) {
    _spawnItem('geo_crystal', geode.cx, geode.cy, geode.cz);
  }

  // 6. Random fossils (3 random types underground, depth 30m+)
  const fossilKeys = Object.keys(RARE_ITEM_DEFS).filter(k => k.startsWith('fossil_'));
  const shuffled   = [...fossilKeys].sort(() => _rng() - 0.5).slice(0, 3);
  for (const fk of shuffled) {
    const cave = caves[Math.floor(_rng() * caves.length)];
    if (!cave) continue;
    const step = cave.steps[Math.floor(_rng() * cave.steps.length)];
    if (step && Math.abs(step.y) > 25) {
      _spawnItem(fk, step.x + (_rng() - 0.5) * 2, step.y, step.z + (_rng() - 0.5) * 2);
    }
  }

  // 7. Spawn 3 ruined stone structures on the surface
  _spawnRuins();

  console.log(`[RareItems] Spawned ${_items.length} rare item pickups`);
}

function _spawnRuins() {
  // Simple stone column clusters at fixed seeded positions
  const positions = [[-40, -55], [60, 30], [-20, 70], [45, -40]].slice(0, 3);
  for (const [rx, rz] of positions) {
    const baseGroup = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const colGeo = new THREE.CylinderGeometry(0.25, 0.3, 1.2 + _rng() * 1.5, 6);
      const colMat = new THREE.MeshStandardMaterial({ color: 0x888877, roughness: 0.9 });
      const col = new THREE.Mesh(colGeo, colMat);
      col.position.set(rx + i * 1.4 - 1.4, 0.6, rz + (_rng() - 0.5) * 0.8);
      _group.add(col);
    }
    // Spawn Ancient Compass sign glow near ruin
    const glowGeo = new THREE.SphereGeometry(0.12, 6, 4);
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xffaa44, transparent: true, opacity: 0.7 });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    glow.position.set(rx, 1.5, rz);
    _group.add(glow);
    _group.add(baseGroup);
  }
}

// ── Meteor shards (called by game.js on meteor event) ─────────
export function spawnMeteorShards(wx, wz, wy = 0, count = 2) {
  const placed = [];
  for (let i = 0; i < count; i++) {
    const ox = (Math.random() - 0.5) * 6;
    const oz = (Math.random() - 0.5) * 6;
    _spawnItem('meteor_shard', wx + ox, wy + 0.2, wz + oz);
    placed.push(_items[_items.length - 1]);
  }
  // Despawn after 10 minutes
  setTimeout(() => {
    for (const item of placed) {
      if (!item.picked) {
        _removeItem(item);
      }
    }
  }, 10 * 60 * 1000);
}

function _removeItem(item) {
  if (item.mesh)  _group.remove(item.mesh);
  if (item.light) _group.remove(item.light);
  item.picked = true;
}

// ── Tick — animate + proximity pickup ────────────────────────
export function tickRareItems(px, py, pz, dt) {
  if (!_group) return;
  _time += dt;

  for (const item of _items) {
    if (item.picked) continue;

    // Float animation
    const newY = item.baseY + Math.sin(_time * FLOAT_FREQ + item.phase) * FLOAT_AMP;
    item.mesh.position.y  = newY;
    item.light.position.y = newY + 0.2;
    item.mesh.rotation.y += dt * 0.8;

    // Proximity pickup
    const dx = px - item.x;
    const dy = py - item.baseY;
    const dz = pz - item.z;
    if (Math.sqrt(dx*dx + dy*dy + dz*dz) < PICKUP_RADIUS) {
      _removeItem(item);
      if (_onPickup) _onPickup(item.id, RARE_ITEM_DEFS[item.id] ?? { name: item.id, emoji: '📦' });
    }
  }
}

export function setOnRareItemPickup(fn) { _onPickup = fn; }
export function getRareItemMeshGroup()  { return _group; }
