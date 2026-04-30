// ============================================================
//  WalkWorld 3D — world.js  (IMPROVED DIGGING REWRITE)
// ============================================================

export const WORLD_SIZE = 200;
export const HALF       = WORLD_SIZE / 2;
export const WATER_Y    = -0.35;
export const SPAWN      = { x: 0, y: 2.0, z: 5 };

export const scene = new THREE.Scene();

// Higher segment count = more vertices = much more detailed holes
const SEGS  = 200;
const HSTEP = WORLD_SIZE / SEGS;

let _hmap = null;

// ============================================================
//  MINING SYSTEM
// ============================================================
export const MINE_CELL     = 3.0;
export const DIG_SPHERE_R  = 5.0;   // big sphere = visible holes
export const DIG_PER_PUNCH = 2.2;   // how much deeper each punch goes
export const MAX_DIG_DEPTH = 200;
export const DIG_REACH     = 3.5;

const _shafts    = new Map();   // "cx,cz" -> { surfaceY, floorY, depth }
const _sphereMap = new Map();   // "rx,rz" -> minY tracked

let _terrainPosAttr = null;
let _terrainColAttr = null;   // NEW: color buffer so we can color excavated areas
let _terrainGeo     = null;
let _originalY      = null;

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

export function getBaseHeightAt(x, z) {
  return _bilinearHeight(x, z);
}

export function getHeightAt(x, z) {
  const mk = Math.round(x) + ',' + Math.round(z);
  const minY = _sphereMap.get(mk);
  if (minY !== undefined) return minY;

  const shaft = _getShaftAt(x, z);
  if (shaft) return shaft.floorY;
  return _bilinearHeight(x, z);
}

export function isBlocked(x, z) {
  if (Math.abs(x) >= HALF - 1.5) return true;
  if (Math.abs(z) >= HALF - 1.5) return true;
  return getZoneName(x, z) === 'Lake';
}

// ── Depth → underground color (for excavated vertices) ───────
function _excavationColor(depth) {
  if (depth < 1.5) return [0.38, 0.24, 0.10];   // topsoil — dark brown
  if (depth < 5)   return [0.50, 0.30, 0.12];   // dirt — medium brown
  if (depth < 12)  return [0.56, 0.34, 0.14];   // clay — orange-brown
  if (depth < 25)  return [0.32, 0.30, 0.28];   // stone — gray
  if (depth < 50)  return [0.14, 0.14, 0.26];   // dark stone — blue-gray
  return [0.22, 0.08, 0.04];                     // dense ore — deep red
}

/**
 * Dig a smooth sphere at world position (digX, digY, digZ).
 */
export function digSphere(digX, digY, digZ, radius) {
  if (getZoneName(digX, digZ) === 'Plaza') return null;

  const surfaceY = _bilinearHeight(digX, digZ);
  const floorY   = digY - radius;
  const depth    = surfaceY - floorY;

  if (depth > MAX_DIG_DEPTH) return null;

  const cx  = _shaftCX(digX);
  const cz  = _shaftCZ(digZ);
  const key = _shaftKey(cx, cz);
  const worldX = cx * MINE_CELL;
  const worldZ = cz * MINE_CELL;

  const existing  = _shafts.get(key);
  const newFloorY = existing ? Math.min(existing.floorY, floorY) : floorY;
  const newDepth  = surfaceY - newFloorY;

  _shafts.set(key, { surfaceY, floorY: newFloorY, depth: newDepth });
  _excavateSphere(digX, digY, digZ, radius);

  return { key, cellX: cx, cellZ: cz, worldX, worldZ, surfaceY,
           floorY: newFloorY, depth: newDepth, digX, digY, digZ, radius };
}

/** Dig straight down — always goes deeper each call */
export function digShaft(x, z) {
  const surfaceY = _bilinearHeight(x, z);
  const cx  = _shaftCX(x);
  const cz  = _shaftCZ(z);
  const key = _shaftKey(cx, cz);
  const existing = _shafts.get(key);
  const currentFloorY = existing ? existing.floorY : surfaceY;
  const centerY = currentFloorY - DIG_PER_PUNCH * 0.5;
  return digSphere(x, centerY, z, DIG_SPHERE_R);
}

export function getShaftAt(x, z) { return _getShaftAt(x, z); }

export function clearShafts() {
  _shafts.clear();
  _sphereMap.clear();
}

export function resetTerrain() {
  if (!_terrainPosAttr || !_originalY) return;
  clearShafts();
  for (let i = 0; i < _terrainPosAttr.count; i++) {
    _terrainPosAttr.setY(i, _originalY[i]);
    if (_terrainColAttr) {
      const vx = _terrainPosAttr.getX(i);
      const vz = _terrainPosAttr.getZ(i);
      const vy = _originalY[i];
      const [r, g, b] = _terrainColour(vx, vz, vy);
      _terrainColAttr.setXYZ(i, r, g, b);
    }
  }
  _terrainPosAttr.needsUpdate = true;
  if (_terrainColAttr) _terrainColAttr.needsUpdate = true;
  _terrainGeo.computeVertexNormals();
}

function _excavateSphere(cx, cy, cz, radius) {
  if (!_terrainPosAttr || !_terrainGeo) return;
  const r2 = radius * radius;
  let dirty = false;

  for (let i = 0; i < _terrainPosAttr.count; i++) {
    const vx = _terrainPosAttr.getX(i);
    const vz = _terrainPosAttr.getZ(i);
    const vy = _terrainPosAttr.getY(i);

    const dx = vx - cx;
    const dz = vz - cz;
    const d2 = dx * dx + dz * dz;

    if (d2 >= r2) continue;

    // Smooth hemispherical bowl: deepest at center, slopes up to edges
    const bowlY = cy - Math.sqrt(r2 - d2);

    if (vy > bowlY) {
      _terrainPosAttr.setY(i, bowlY);

      // Update sphere map for player physics collision
      const mk = Math.round(vx) + ',' + Math.round(vz);
      const prev = _sphereMap.get(mk);
      if (prev === undefined || bowlY < prev) _sphereMap.set(mk, bowlY);

      // Color the excavated vertex based on depth below original surface
      if (_terrainColAttr && _originalY) {
        const origY = _originalY[i];
        const excavDepth = origY - bowlY;
        const [r, g, b] = _excavationColor(excavDepth);
        _terrainColAttr.setXYZ(i, r, g, b);
      }

      dirty = true;
    }
  }

  if (dirty) {
    _terrainPosAttr.needsUpdate = true;
    if (_terrainColAttr) _terrainColAttr.needsUpdate = true;
    _terrainGeo.computeVertexNormals();
  }
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

  const colAttr = new THREE.BufferAttribute(colBuf, 3);
  geoT.setAttribute('color', colAttr);

  const terrainMesh = new THREE.Mesh(geoT, new THREE.MeshLambertMaterial({ vertexColors: true }));
  scene.add(terrainMesh);

  _terrainPosAttr = posAttr;
  _terrainColAttr = colAttr;   // save for live color updates during digging
  _terrainGeo     = geoT;

  _originalY = new Float32Array(posAttr.count);
  for (let i = 0; i < posAttr.count; i++) {
    _originalY[i] = posAttr.getY(i);
  }

  const waterMat = new THREE.MeshLambertMaterial({ color: 0x1a6bbf, transparent: true, opacity: 0.80 });
  _addWater(60, 50, 44, 36, waterMat);
  _addWater(-60, 38, 18, 14, waterMat);

  // Deep underground floor visible from inside shafts
  const underGeo = new THREE.PlaneGeometry(WORLD_SIZE + 80, WORLD_SIZE + 80);
  underGeo.rotateX(-Math.PI / 2);
  const under = new THREE.Mesh(underGeo, new THREE.MeshLambertMaterial({ color: 0x0c1208 }));
  under.position.y = -80;
  scene.add(under);

  // Second bedrock layer closer to surface for depth perception
  const bedrock = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD_SIZE + 80, WORLD_SIZE + 80),
    new THREE.MeshLambertMaterial({ color: 0x181414 })
  );
  bedrock.rotation.x = -Math.PI / 2;
  bedrock.position.y = -15;
  scene.add(bedrock);

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
