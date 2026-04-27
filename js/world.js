// ============================================================
//  WalkWorld 3D — world.js   (Part 3)
//
//  Three.js r128 is a CDN global — no import needed.
//  All geometry is seeded/deterministic so every player sees
//  the exact same world.
//
//  Exports
//  ─────────────────────────────────────────────────────────
//  scene            THREE.Scene   — shared scene graph
//  WORLD_SIZE       number        — square world, side length
//  HALF             number        — WORLD_SIZE / 2
//  WATER_Y          number        — Y of all water surfaces
//  SPAWN            {x,y,z}       — player start position
//  getHeightAt(x,z) → number     — terrain Y at world position
//  isBlocked(x,z)   → boolean    — true = player cannot walk
//  getZoneName(x,z) → string     — zone label for HUD
//  initWorld()      → scene      — builds and populates scene
//
//  Coordinate system (Three.js right-hand):
//    X  →  East / West
//    Y  ↑  Up / Down
//    Z  →  South / North  (positive Z = toward viewer / south)
//
//  Zone layout mirrors v1 tile map:
//    Forest  — North-West  (neg X, neg Z)
//    Cabin   — North-East  (pos X, neg Z)
//    Plains  — Center / South-West
//    Lake    — South-East  (pos X, pos Z)
//    Plaza   — Centre square
// ============================================================

// ── World constants ──────────────────────────────────────────
export const WORLD_SIZE = 200;      // world is 200 × 200 units
export const HALF       = WORLD_SIZE / 2;   // convenience: 100
export const WATER_Y    = -0.35;    // water surface height

export const SPAWN = { x: 0, y: 2.0, z: 5 };  // centre plaza

// ── Scene — created once, populated by initWorld() ───────────
export const scene = new THREE.Scene();

// ── Terrain resolution ────────────────────────────────────────
const SEGS  = 120;                  // segments per axis of PlaneGeometry
const HSTEP = WORLD_SIZE / SEGS;    // world units per heightmap cell

// _hmap[iz][ix] — built in _buildHeightmap(), used by getHeightAt()
let _hmap = null;

// ============================================================
//  SEEDED RNG  (LCG — deterministic output every run)
// ============================================================
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = Math.imul(s, 1664525) + 1013904223 >>> 0;
    return s / 0x100000000;
  };
}

// ============================================================
//  ZONE CLASSIFICATION
// ============================================================
/**
 * Returns the zone name at world-space (x, z).
 * Zones mirror the v1 100×75 tile layout, re-scaled to ±100 units.
 *
 *  v1 tile (tx, ty) → 3D (x, z):
 *    x = (tx / 100) * 200 - 100
 *    z = (ty /  75) * 200 - 100   (ty increases downward → +Z)
 *
 *  Key v1 landmarks:
 *    Forest:  tiles (0,0)–(42,34)  → x < -16, z < -7
 *    Lake:    centre tile (78,58)   → x ≈ 56, z ≈ 55
 *    Plaza:   tiles (43,31)–(57,44) → x ∈ [-14,14], z ∈ [-17,17]
 *    Cabin:   tiles (68,8)–(82,18)  → x ≈ 36–64, z ≈ -79 to -52
 */
export function getZoneName(x, z) {
  // Forest: NW quadrant
  if (x < -25 && z < 18)                        return 'Forest';
  // Lake: SE area (sunken basin)
  if (x > 40  && z > 16)                        return 'Lake';
  // Cabin: NE flat area
  if (x > 30  && z < -30)                       return 'Cabin';
  // Plaza: central square
  if (Math.abs(x) <= 22 && Math.abs(z) <= 18)   return 'Plaza';
  // Everything else is Plains
  return 'Plains';
}

// ============================================================
//  TERRAIN HEIGHT
// ============================================================

/** Smooth noise — sum of sines, no deps needed. */
function _noise(x, z) {
  return (
    Math.sin(x * 0.070 + 0.40) * Math.cos(z * 0.060 + 0.80) * 2.2 +
    Math.sin(x * 0.130 + z * 0.110 - 0.30) * 1.1 +
    Math.cos(x * 0.040 - z * 0.080 + 1.40) * 1.6 +
    Math.sin(x * 0.220 + z * 0.190 + 0.70) * 0.4
  );
}

/**
 * Target terrain Y height for any world position.
 * Flat zones (Plaza, Cabin) override the noise.
 * Lake zone is sunken below water level.
 */
function _targetHeight(x, z) {
  const zone = getZoneName(x, z);

  if (zone === 'Plaza') return 0.08;   // dead flat stone
  if (zone === 'Cabin') return 0.22;   // flat wood floor, slightly raised

  if (zone === 'Lake') {
    // Smooth concave basin centred at (62, 52) — keeps water visible
    const dx = x - 62, dz = z - 52;
    const d  = Math.sqrt(dx * dx + dz * dz);
    return Math.max(-4.5, -0.9 - d * 0.13);
  }

  const n = _noise(x, z);
  if (zone === 'Forest') return n * 0.55 + 1.0;  // gentle forest hills
  return n * 0.70 + 0.30;                         // rolling plains
}

/** Build the 2-D heightmap grid. Called once in initWorld(). */
function _buildHeightmap() {
  _hmap = [];
  for (let iz = 0; iz <= SEGS; iz++) {
    const row = [];
    for (let ix = 0; ix <= SEGS; ix++) {
      row.push(_targetHeight(
        -HALF + ix * HSTEP,
        -HALF + iz * HSTEP
      ));
    }
    _hmap.push(row);
  }
}

/**
 * Returns terrain Y height at world position (x, z).
 * Uses bilinear interpolation for smooth results between grid cells.
 */
export function getHeightAt(x, z) {
  if (!_hmap) return 0;

  const fx = (x + HALF) / HSTEP;
  const fz = (z + HALF) / HSTEP;
  const ix = Math.max(0, Math.min(SEGS - 1, Math.floor(fx)));
  const iz = Math.max(0, Math.min(SEGS - 1, Math.floor(fz)));
  const tx = fx - ix;
  const tz = fz - iz;

  const h00 = _hmap[iz][ix];
  const h10 = _hmap[iz][ix + 1]         ?? h00;
  const h01 = (_hmap[iz + 1] || [])[ix]     ?? h00;
  const h11 = (_hmap[iz + 1] || [])[ix + 1] ?? h00;

  return h00 * (1 - tx) * (1 - tz)
       + h10 * tx       * (1 - tz)
       + h01 * (1 - tx) * tz
       + h11 * tx       * tz;
}

// ============================================================
//  COLLISION
// ============================================================
/**
 * Returns true if the player cannot walk to (x, z).
 * Blocks: world boundary and Lake zone (treat water as solid).
 */
export function isBlocked(x, z) {
  if (Math.abs(x) >= HALF - 1.5) return true;
  if (Math.abs(z) >= HALF - 1.5) return true;
  return getZoneName(x, z) === 'Lake';
}

// ============================================================
//  VERTEX COLOUR
// ============================================================
function _terrainColour(x, z, h) {
  const zone = getZoneName(x, z);
  switch (zone) {
    case 'Lake':
      return [0.10, 0.34, 0.62];          // deep blue
    case 'Plaza':
      return [0.50, 0.50, 0.56];          // grey stone
    case 'Cabin':
      return [0.52, 0.38, 0.20];          // warm wood brown
    case 'Forest':
      return h > 2.0
        ? [0.24, 0.40, 0.16]             // high canopy — dark green
        : [0.18, 0.34, 0.12];            // forest floor — deeper green
    default: // Plains
      if (h > 2.8) return [0.60, 0.54, 0.42];  // rocky hilltop
      if (h > 1.5) return [0.42, 0.62, 0.26];  // lighter hill grass
      return [0.28, 0.55, 0.20];               // standard meadow grass
  }
}

// ============================================================
//  MAIN INIT
// ============================================================
/**
 * Builds the entire Three.js scene.
 * Must be called after Three.js loads. Returns the scene.
 */
export function initWorld() {

  // ── Sky + fog ───────────────────────────────────────────
  scene.background = new THREE.Color(0x7ec8e3);
  // Exponential fog so distant terrain fades smoothly
  scene.fog = new THREE.FogExp2(0xa4d4e8, 0.0095);

  // ── Lighting ────────────────────────────────────────────

  // Warm ambient fill
  scene.add(new THREE.AmbientLight(0xfff0cc, 0.52));

  // Directional sun (high angle, slightly south-east)
  const sun = new THREE.DirectionalLight(0xfff8e0, 1.05);
  sun.position.set(70, 130, 55);
  scene.add(sun);

  // Sky hemisphere — cool blue from above, green bounce from ground
  scene.add(new THREE.HemisphereLight(0x7ec8e3, 0x3a6e28, 0.38));

  // ── Heightmap ────────────────────────────────────────────
  _buildHeightmap();

  // ── Terrain mesh ─────────────────────────────────────────
  //
  // PlaneGeometry lies in XY plane by default.
  // rotateX(-PI/2) lays it flat in the XZ plane.
  // After rotation:  pos.getX(i) = X,  pos.getZ(i) = Z (world space).
  //
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
    colBuf[i * 3]     = r;
    colBuf[i * 3 + 1] = g;
    colBuf[i * 3 + 2] = b;
  }

  posAttr.needsUpdate = true;
  geoT.computeVertexNormals();
  geoT.setAttribute('color', new THREE.BufferAttribute(colBuf, 3));

  scene.add(new THREE.Mesh(
    geoT,
    new THREE.MeshLambertMaterial({ vertexColors: true })
  ));

  // ── Water surfaces ───────────────────────────────────────
  const waterMat = new THREE.MeshLambertMaterial({
    color:       0x1a6bbf,
    transparent: true,
    opacity:     0.80,
  });

  // Main lake — SE, centre at approx tile (78, 58) → (56, 55) 3D
  _addWater(60, 50, 44, 36, waterMat);

  // Small pond — centre-west, v1 tile (18, 52) → (-64, 39) 3D
  _addWater(-60, 38, 18, 14, waterMat);

  // ── Catch-all under-plane (prevents sky gaps at steep hills) ─
  const underGeo = new THREE.PlaneGeometry(WORLD_SIZE + 80, WORLD_SIZE + 80);
  underGeo.rotateX(-Math.PI / 2);
  scene.add(new THREE.Mesh(
    underGeo,
    new THREE.MeshLambertMaterial({ color: 0x162d10 })
  ));
  // Position just below deepest lake point
  scene.children[scene.children.length - 1].position.y = -5.2;

  // ── Horizon hills (decorative border) ────────────────────
  _buildHorizon();

  return scene;
}

// ── Water helper ─────────────────────────────────────────────
function _addWater(cx, cz, w, d, mat) {
  const geo = new THREE.PlaneGeometry(w, d, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(cx, WATER_Y, cz);
  scene.add(mesh);
}

// ── Distant horizon ring ──────────────────────────────────────
// Low-poly cones just beyond the world edge give a sense of
// mountains in the distance and hide the hard boundary.
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

    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(w, h, segs),
      mat
    );
    cone.position.set(cx, h * 0.28 - 1.5, cz);
    cone.rotation.y = rng() * Math.PI * 2;
    scene.add(cone);
  }
}
