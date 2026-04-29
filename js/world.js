// ============================================================
//  WalkWorld 3D — world.js  (with mining shaft system)
// ============================================================

export const WORLD_SIZE = 200;
export const HALF       = WORLD_SIZE / 2;
export const WATER_Y    = -0.35;
export const SPAWN      = { x: 0, y: 2.0, z: 5 };

export const scene = new THREE.Scene();

const SEGS  = 120;
const HSTEP = WORLD_SIZE / SEGS;

let _hmap = null;

// ============================================================
//  MINING SHAFT SYSTEM
// ============================================================
export const MINE_CELL     = 3.0;   // shaft width in world units
export const DIG_PER_PUNCH = 1.2;   // depth per punch
export const MAX_DIG_DEPTH = 120;   // max shaft depth

const _shafts = new Map();          // "cx,cz" -> { surfaceY, floorY, depth }
let _terrainPosAttr = null;
let _terrainGeo     = null;
let _originalY      = null;         // backup of all vertex Y values for reset

function _shaftCX(x) { return Math.round(x / MINE_CELL); }
function _shaftCZ(z) { return Math.round(z / MINE_CELL); }
function _shaftKey(cx, cz) { return cx + ',' + cz; }

function _getShaftAt(x, z) {
  return _shafts.get(_shaftKey(_shaftCX(x), _shaftCZ(z))) ?? null;
}

function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = Math.imul(s, 1664525) + 1013904223 >>> 0;
    return s / 0x100000000;
  };
}

export function getZoneName(x, z) {
  if (x < -25 && z < 18)                      return 'Forest';
  if (x > 40  && z > 16)                       return 'Lake';
  if (x > 30  && z < -30)                      return 'Cabin';
  if (Math.abs(x) <= 22 && Math.abs(z) <= 18)  return 'Plaza';
  return 'Plains';
}

function _noise(x, z) {
  return (
    Math.sin(x * 0.070 + 0.40) * Math.cos(z * 0.060 + 0.80) * 2.2 +
    Math.sin(x * 0.130 + z * 0.110 - 0.30) * 1.1 +
    Math.cos(x * 0.040 - z * 0.080 + 1.40) * 1.6 +
    Math.sin(x * 0.220 + z * 0.190 + 0.70) * 0.4
  );
}

function _targetHeight(x, z) {
  const zone = getZoneName(x, z);
  if (zone === 'Plaza') return 0.08;
  if (zone === 'Cabin') return 0.22;
  if (zone === 'Lake') {
    const dx = x - 62, dz = z - 52;
    const d  = Math.sqrt(dx * dx + dz * dz);
    return Math.max(-4.5, -0.9 - d * 0.13);
  }
  const n = _noise(x, z);
  if (zone === 'Forest') return n * 0.55 + 1.0;
  return n * 0.70 + 0.30;
}

function _buildHeightmap() {
  _hmap = [];
  for (let iz = 0; iz <= SEGS; iz++) {
    const row = [];
    for (let ix = 0; ix <= SEGS; ix++) {
      row.push(_targetHeight(-HALF + ix * HSTEP, -HALF + iz * HSTEP));
    }
    _hmap.push(row);
  }
}

function _bilinearHeight(x, z) {
  if (!_hmap) return 0;
  const fx = (x + HALF) / HSTEP;
  const fz = (z + HALF) / HSTEP;
  const ix = Math.max(0, Math.min(SEGS - 1, Math.floor(fx)));
  const iz = Math.max(0, Math.min(SEGS - 1, Math.floor(fz)));
  const tx = fx - ix;
  const tz = fz - iz;
  const h00 = _hmap[iz][ix];
  const h10 = _hmap[iz][ix + 1]             ?? h00;
  const h01 = (_hmap[iz + 1] || [])[ix]     ?? h00;
  const h11 = (_hmap[iz + 1] || [])[ix + 1] ?? h00;
  return h00*(1-tx)*(1-tz) + h10*tx*(1-tz) + h01*(1-tx)*tz + h11*tx*tz;
}

/** Surface height without shaft overrides (used by player jump calc). */
export function getBaseHeightAt(x, z) {
  return _bilinearHeight(x, z);
}

/** Height at (x,z) — returns shaft floor if inside a dug shaft. */
export function getHeightAt(x, z) {
  const shaft = _getShaftAt(x, z);
  if (shaft) return shaft.floorY;
  return _bilinearHeight(x, z);
}

export function isBlocked(x, z) {
  if (Math.abs(x) >= HALF - 1.5) return true;
  if (Math.abs(z) >= HALF - 1.5) return true;
  return getZoneName(x, z) === 'Lake';
}

/**
 * Dig one punch deeper at world position (x, z).
 * Returns dig info object, or null if at max depth or invalid.
 */
export function digShaft(x, z) {
  const cx = _shaftCX(x);
  const cz = _shaftCZ(z);
  const key = _shaftKey(cx, cz);

  const worldX = cx * MINE_CELL;
  const worldZ = cz * MINE_CELL;

  // ── Plaza is indestructible — no digging allowed ──────────
  if (getZoneName(worldX, worldZ) === 'Plaza') return null;

  const surfaceY      = _bilinearHeight(worldX, worldZ);
  const existing      = _shafts.get(key);
  const currentFloorY = existing ? existing.floorY : surfaceY;
  const newFloorY     = currentFloorY - DIG_PER_PUNCH;
  const depth         = surfaceY - newFloorY;

  if (depth > MAX_DIG_DEPTH) return null;

  _shafts.set(key, { surfaceY, floorY: newFloorY, depth });
  _excavateTerrainAt(cx, cz, newFloorY);

  return { key, cellX: cx, cellZ: cz, worldX, worldZ, surfaceY, floorY: newFloorY, depth };
}

/** Returns shaft info for the cell containing (x, z), or null. */
export function getShaftAt(x, z) {
  return _getShaftAt(x, z);
}

/** Clear all shaft data (call before resetTerrain). */
export function clearShafts() {
  _shafts.clear();
}

/**
 * Restore the terrain mesh to its original un-dug state.
 * Call this together with clearShafts() and resetMining() for the 20-min reset.
 */
export function resetTerrain() {
  if (!_terrainPosAttr || !_originalY) return;
  clearShafts();
  for (let i = 0; i < _terrainPosAttr.count; i++) {
    _terrainPosAttr.setY(i, _originalY[i]);
  }
  _terrainPosAttr.needsUpdate = true;
  _terrainGeo.computeVertexNormals();
}

function _excavateTerrainAt(cx, cz, floorY) {
  if (!_terrainPosAttr || !_terrainGeo) return;
  for (let i = 0; i < _terrainPosAttr.count; i++) {
    const vx = _terrainPosAttr.getX(i);
    const vz = _terrainPosAttr.getZ(i);
    if (_shaftCX(vx) === cx && _shaftCZ(vz) === cz) {
      if (_terrainPosAttr.getY(i) > floorY) {
        _terrainPosAttr.setY(i, floorY);
      }
    }
  }
  _terrainPosAttr.needsUpdate = true;
  _terrainGeo.computeVertexNormals();
}

function _terrainColour(x, z, h) {
  const zone = getZoneName(x, z);
  switch (zone) {
    case 'Lake':   return [0.10, 0.34, 0.62];
    case 'Plaza':  return [0.50, 0.50, 0.56];
    case 'Cabin':  return [0.52, 0.38, 0.20];
    case 'Forest': return h > 2.0 ? [0.24, 0.40, 0.16] : [0.18, 0.34, 0.12];
    default:
      if (h > 2.8) return [0.60, 0.54, 0.42];
      if (h > 1.5) return [0.42, 0.62, 0.26];
      return [0.28, 0.55, 0.20];
  }
}

export function initWorld() {
  scene.background = new THREE.Color(0x7ec8e3);
  scene.fog = new THREE.FogExp2(0xa4d4e8, 0.0095);

  scene.add(new THREE.AmbientLight(0xfff0cc, 0.52));

  const sun = new THREE.DirectionalLight(0xfff8e0, 1.05);
  sun.position.set(70, 130, 55);
  scene.add(sun);

  scene.add(new THREE.HemisphereLight(0x7ec8e3, 0x3a6e28, 0.38));

  _buildHeightmap();

  const geoT = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, SEGS, SEGS);
  geoT.rotateX(-Math.PI / 2);

  const posAttr = geoT.attributes.position;
  const colBuf  = new Float32Array(posAttr.count * 3);

  for (let i = 0; i < posAttr.count; i++) {
    const wx = posAttr.getX(i);
    const wz = posAttr.getZ(i);
    const h  = getHeightAt(wx, wz);
    posAttr.setY(i, h);
    const [r, g, b] = _terrainColour(wx, wz, h);
    colBuf[i*3] = r; colBuf[i*3+1] = g; colBuf[i*3+2] = b;
  }

  posAttr.needsUpdate = true;
  geoT.computeVertexNormals();
  geoT.setAttribute('color', new THREE.BufferAttribute(colBuf, 3));

  const terrainMesh = new THREE.Mesh(geoT, new THREE.MeshLambertMaterial({ vertexColors: true }));
  scene.add(terrainMesh);

  // Store refs for dynamic shaft excavation
  _terrainPosAttr = posAttr;
  _terrainGeo     = geoT;

  // Snapshot original vertex Y positions so resetTerrain() can restore them
  _originalY = new Float32Array(posAttr.count);
  for (let i = 0; i < posAttr.count; i++) {
    _originalY[i] = posAttr.getY(i);
  }

  const waterMat = new THREE.MeshLambertMaterial({ color: 0x1a6bbf, transparent: true, opacity: 0.80 });
  _addWater(60, 50, 44, 36, waterMat);
  _addWater(-60, 38, 18, 14, waterMat);

  const underGeo = new THREE.PlaneGeometry(WORLD_SIZE + 80, WORLD_SIZE + 80);
  underGeo.rotateX(-Math.PI / 2);
  const under = new THREE.Mesh(underGeo, new THREE.MeshLambertMaterial({ color: 0x162d10 }));
  under.position.y = -5.2;
  scene.add(under);

  _buildHorizon();
  return scene;
}

function _addWater(cx, cz, w, d, mat) {
  const geo = new THREE.PlaneGeometry(w, d, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(cx, WATER_Y, cz);
  scene.add(mesh);
}

function _buildHorizon() {
  const mat = new THREE.MeshLambertMaterial({ color: 0x1a3a14 });
  const rng = makeRng(0xF00DCAFE);
  const COUNT = 30;
  for (let i = 0; i < COUNT; i++) {
    const angle = (i / COUNT) * Math.PI * 2 + rng() * 0.18;
    const dist  = HALF + 9 + rng() * 12;
    const cx    = Math.cos(angle) * dist;
    const cz    = Math.sin(angle) * dist;
    const w     = 14 + rng() * 22;
    const h     = 9  + rng() * 16;
    const segs  = 4 + Math.floor(rng() * 3);
    const cone  = new THREE.Mesh(new THREE.ConeGeometry(w, h, segs), mat);
    cone.position.set(cx, h * 0.28 - 1.5, cz);
    cone.rotation.y = rng() * Math.PI * 2;
    scene.add(cone);
  }
}
