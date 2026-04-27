// ============================================================
//  WalkWorld 3D — objects.js   (Part 4)
//
//  Populates the scene with all decorative and structural
//  geometry.  Three.js r128 is a CDN global — no import.
//
//  Uses InstancedMesh throughout so hundreds of trees / rocks
//  cost only one draw call each.  All placement is seeded so
//  every player sees an identical world.
//
//  Call order (from game.js):
//    1. initWorld()   ← world.js  (terrain must exist first)
//    2. initObjects() ← this file
//
//  Exports
//  ─────────────────────────────────────────────────────────
//  initObjects() → void   — places everything in the scene
// ============================================================

import {
  scene,
  HALF,
  WATER_Y,
  getHeightAt,
  getZoneName,
  isBlocked,
} from './world.js';

// ============================================================
//  SEEDED RNG  (same LCG as world.js, different seed)
// ============================================================
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// ============================================================
//  MATRIX4 HELPERS
// ============================================================
const _m4  = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _rot = new THREE.Euler();
const _scl = new THREE.Vector3();
const _q   = new THREE.Quaternion();

function setMatrix(mesh, idx, x, y, z, ry, sx, sy, sz) {
  _pos.set(x, y, z);
  _rot.set(0, ry, 0);
  _scl.set(sx, sy, sz);
  _q.setFromEuler(_rot);
  _m4.compose(_pos, _q, _scl);
  mesh.setMatrixAt(idx, _m4);
}

// ============================================================
//  SHARED MATERIALS  (created once, reused across instances)
// ============================================================
const MAT = {
  // Trees
  foliageDark:  new THREE.MeshLambertMaterial({ color: 0x1a4a10 }),
  foliageMid:   new THREE.MeshLambertMaterial({ color: 0x265c17 }),
  foliageLight: new THREE.MeshLambertMaterial({ color: 0x2e7020 }),
  trunk:        new THREE.MeshLambertMaterial({ color: 0x5c3d1e }),

  // Rocks
  rockGrey:  new THREE.MeshLambertMaterial({ color: 0x707880 }),
  rockBrown: new THREE.MeshLambertMaterial({ color: 0x6a5545 }),

  // Flowers
  petalRed:    new THREE.MeshLambertMaterial({ color: 0xe03030 }),
  petalYellow: new THREE.MeshLambertMaterial({ color: 0xe0c020 }),
  petalWhite:  new THREE.MeshLambertMaterial({ color: 0xe8e8e0 }),
  stem:        new THREE.MeshLambertMaterial({ color: 0x3a6010 }),

  // Mushrooms
  cap:   new THREE.MeshLambertMaterial({ color: 0xb03018 }),
  capSpot: new THREE.MeshLambertMaterial({ color: 0xf0e8d0, side: THREE.FrontSide }),
  stalk: new THREE.MeshLambertMaterial({ color: 0xd0c8a8 }),

  // Cabin
  wood:    new THREE.MeshLambertMaterial({ color: 0x8b5e2e }),
  roof:    new THREE.MeshLambertMaterial({ color: 0x4a2010 }),
  window_: new THREE.MeshLambertMaterial({ color: 0x9adcf0, transparent: true, opacity: 0.7 }),
  door:    new THREE.MeshLambertMaterial({ color: 0x5a3010 }),
  chimney: new THREE.MeshLambertMaterial({ color: 0x6a6060 }),

  // Signpost
  signPost:  new THREE.MeshLambertMaterial({ color: 0x9a7040 }),
  signBoard: new THREE.MeshLambertMaterial({ color: 0xc8a060 }),
};

// ============================================================
//  GEOMETRY  (created once)
// ============================================================
const GEO = {
  // Low-poly tree cone tiers
  coneTop: new THREE.ConeGeometry(1.3, 2.2, 7),
  coneMid: new THREE.ConeGeometry(1.7, 2.0, 7),
  coneBot: new THREE.ConeGeometry(2.1, 1.8, 7),
  trunky:  new THREE.CylinderGeometry(0.18, 0.26, 2.0, 6),

  // Rocks
  rock: new THREE.IcosahedronGeometry(0.8, 0),

  // Flowers
  petal: new THREE.CylinderGeometry(0.28, 0.18, 0.12, 5),
  stemG: new THREE.CylinderGeometry(0.05, 0.05, 0.55, 4),

  // Mushroom
  mCap:   new THREE.CylinderGeometry(0.55, 0.10, 0.50, 7),
  mStalk: new THREE.CylinderGeometry(0.16, 0.20, 0.55, 6),

  // Cabin / sign box reused via scale
  box:    new THREE.BoxGeometry(1, 1, 1),
};

// ============================================================
//  TREE BUILDER
//  One tree = three cone instances (top/mid/bot) + one trunk.
//  All tiers share the same InstancedMesh arrays; every tree
//  occupies ONE slot in each array.
// ============================================================

const MAX_FOREST_TREES = 220;
const MAX_PLAIN_TREES  = 130;
const MAX_ALL_TREES    = MAX_FOREST_TREES + MAX_PLAIN_TREES;

function buildTrees() {
  // Three tier meshes + one trunk, each max MAX_ALL_TREES instances
  const meshTop  = new THREE.InstancedMesh(GEO.coneTop, MAT.foliageDark,  MAX_ALL_TREES);
  const meshMid  = new THREE.InstancedMesh(GEO.coneMid, MAT.foliageMid,   MAX_ALL_TREES);
  const meshBot  = new THREE.InstancedMesh(GEO.coneBot, MAT.foliageLight, MAX_ALL_TREES);
  const meshTrunk= new THREE.InstancedMesh(GEO.trunky,  MAT.trunk,        MAX_ALL_TREES);

  meshTop.castShadow   = true;
  meshMid.castShadow   = true;
  meshBot.castShadow   = true;

  let idx = 0;

  function placeTree(x, z, scaleMod, ry) {
    const ground = getHeightAt(x, z);
    const sc     = scaleMod;
    const trunkH = 2.0 * sc;

    // Trunk: sits with base at ground level
    setMatrix(meshTrunk, idx, x, ground + trunkH * 0.5, z, ry, sc, sc, sc);

    // Cones stack from trunk top upwards
    const base = ground + trunkH;
    setMatrix(meshBot, idx, x, base + 0.80 * sc, z, ry, sc, sc, sc);
    setMatrix(meshMid, idx, x, base + 1.90 * sc, z, ry, sc, sc, sc);
    setMatrix(meshTop, idx, x, base + 2.90 * sc, z, ry, sc, sc, sc);

    idx++;
  }

  // ── Forest trees (NW — dense grid + jitter) ──────────────
  const rngF = makeRng(0xF0AE5700);
  const FSTEP = 5.5;

  for (let fx = -HALF + 3; fx < -22; fx += FSTEP) {
    for (let fz = -HALF + 3; fz < 20; fz += FSTEP) {
      if (idx >= MAX_FOREST_TREES) break;
      const jx = fx + (rngF() - 0.5) * 4.0;
      const jz = fz + (rngF() - 0.5) * 4.0;
      if (isBlocked(jx, jz)) continue;
      if (getZoneName(jx, jz) !== 'Forest') continue;
      const sc = 0.65 + rngF() * 0.60;
      placeTree(jx, jz, sc, rngF() * Math.PI * 2);
    }
    if (idx >= MAX_FOREST_TREES) break;
  }

  // ── Plains / scattered trees ─────────────────────────────
  const rngP = makeRng(0xA1A1A100);
  let plainCount = 0;
  const maxPlain = MAX_PLAIN_TREES;

  while (plainCount < maxPlain) {
    const x = (rngP() * 2 - 1) * (HALF - 4);
    const z = (rngP() * 2 - 1) * (HALF - 4);
    if (isBlocked(x, z)) { plainCount++; continue; }
    const zone = getZoneName(x, z);
    if (zone === 'Forest' || zone === 'Plaza' || zone === 'Lake') {
      plainCount++;
      continue;
    }
    // Cabin zone: only a few trees around the edges
    if (zone === 'Cabin' && rngP() > 0.15) { plainCount++; continue; }
    if (idx >= MAX_ALL_TREES) break;
    const sc = 0.55 + rngP() * 0.75;
    placeTree(x, z, sc, rngP() * Math.PI * 2);
    plainCount++;
  }

  // Mark used counts so Three.js skips unused slots
  meshTrunk.count = idx;
  meshTop.count   = idx;
  meshMid.count   = idx;
  meshBot.count   = idx;

  meshTrunk.instanceMatrix.needsUpdate = true;
  meshTop.instanceMatrix.needsUpdate   = true;
  meshMid.instanceMatrix.needsUpdate   = true;
  meshBot.instanceMatrix.needsUpdate   = true;

  scene.add(meshTrunk, meshTop, meshMid, meshBot);
}

// ============================================================
//  ROCKS
// ============================================================

const MAX_ROCKS = 140;

function buildRocks() {
  const meshGrey  = new THREE.InstancedMesh(GEO.rock, MAT.rockGrey,  MAX_ROCKS);
  const meshBrown = new THREE.InstancedMesh(GEO.rock, MAT.rockBrown, MAX_ROCKS);

  let ig = 0, ib = 0;
  const rng = makeRng(0xA0C05500);

  // Helper: place one rock
  function placeRock(x, z, useBrown) {
    const ground = getHeightAt(x, z);
    const sx = 0.4 + rng() * 1.0;
    const sy = 0.3 + rng() * 0.7;
    const sz = 0.4 + rng() * 0.9;
    const ry = rng() * Math.PI * 2;

    if (useBrown) {
      if (ib >= MAX_ROCKS) return;
      setMatrix(meshBrown, ib++, x, ground + sy * 0.4, z, ry, sx, sy, sz);
    } else {
      if (ig >= MAX_ROCKS) return;
      setMatrix(meshGrey, ig++, x, ground + sy * 0.4, z, ry, sx, sy, sz);
    }
  }

  // Rocks around lake shore
  const rngL = makeRng(0x1A4EA0C0);
  for (let i = 0; i < 55; i++) {
    const a   = rngL() * Math.PI * 2;
    const r   = 21 + rngL() * 8;
    const lx  = 60 + Math.cos(a) * r;
    const lz  = 50 + Math.sin(a) * r;
    if (Math.abs(lx) >= HALF - 2 || Math.abs(lz) >= HALF - 2) continue;
    if (getZoneName(lx, lz) === 'Lake') continue;
    placeRock(lx, lz, rngL() > 0.5);
  }

  // Rocks in forest / plains
  const rngW = makeRng(0xB11DA0C0);
  for (let i = 0; i < 90; i++) {
    const x = (rngW() * 2 - 1) * (HALF - 4);
    const z = (rngW() * 2 - 1) * (HALF - 4);
    const zone = getZoneName(x, z);
    if (zone === 'Plaza' || zone === 'Lake' || zone === 'Cabin') continue;
    if (isBlocked(x, z)) continue;
    placeRock(x, z, zone === 'Forest');
  }

  meshGrey.count  = ig;
  meshBrown.count = ib;
  meshGrey.instanceMatrix.needsUpdate  = true;
  meshBrown.instanceMatrix.needsUpdate = true;

  scene.add(meshGrey, meshBrown);
}

// ============================================================
//  FLOWERS
// ============================================================

const MAX_FLOWERS = 150;

function buildFlowers() {
  // Three petal colors + shared stem mesh
  const meshRed    = new THREE.InstancedMesh(GEO.petal, MAT.petalRed,    MAX_FLOWERS);
  const meshYellow = new THREE.InstancedMesh(GEO.petal, MAT.petalYellow, MAX_FLOWERS);
  const meshWhite  = new THREE.InstancedMesh(GEO.petal, MAT.petalWhite,  MAX_FLOWERS);
  const meshStem   = new THREE.InstancedMesh(GEO.stemG, MAT.stem,        MAX_FLOWERS * 3);

  let ir = 0, iy = 0, iw = 0, is_ = 0;
  const rng = makeRng(0xF10BEA50);

  function placeFlower(x, z, colorIdx) {
    const ground = getHeightAt(x, z);
    const stemY  = ground + 0.28;
    const headY  = ground + 0.62;
    const ry     = rng() * Math.PI * 2;
    const sc     = 0.6 + rng() * 0.6;

    // Stem
    if (is_ < MAX_FLOWERS * 3) {
      setMatrix(meshStem, is_++, x, stemY, z, ry, sc, sc, sc);
    }

    // Petal head
    if      (colorIdx === 0 && ir < MAX_FLOWERS) setMatrix(meshRed,    ir++,    x, headY, z, ry, sc, 0.6 * sc, sc);
    else if (colorIdx === 1 && iy < MAX_FLOWERS) setMatrix(meshYellow, iy++,    x, headY, z, ry, sc, 0.6 * sc, sc);
    else if (colorIdx === 2 && iw < MAX_FLOWERS) setMatrix(meshWhite,  iw++,    x, headY, z, ry, sc, 0.6 * sc, sc);
  }

  for (let i = 0; i < 400; i++) {
    const x = (rng() * 2 - 1) * (HALF - 5);
    const z = (rng() * 2 - 1) * (HALF - 5);
    const zone = getZoneName(x, z);
    if (zone === 'Lake' || zone === 'Plaza' || zone === 'Cabin') continue;
    if (isBlocked(x, z)) continue;
    // Fewer flowers deep in forest
    if (zone === 'Forest' && rng() > 0.25) continue;
    placeFlower(x, z, Math.floor(rng() * 3));
    if (ir >= MAX_FLOWERS && iy >= MAX_FLOWERS && iw >= MAX_FLOWERS) break;
  }

  meshRed.count    = ir;
  meshYellow.count = iy;
  meshWhite.count  = iw;
  meshStem.count   = is_;

  meshRed.instanceMatrix.needsUpdate    = true;
  meshYellow.instanceMatrix.needsUpdate = true;
  meshWhite.instanceMatrix.needsUpdate  = true;
  meshStem.instanceMatrix.needsUpdate   = true;

  scene.add(meshRed, meshYellow, meshWhite, meshStem);
}

// ============================================================
//  MUSHROOMS  (forest only)
// ============================================================

const MAX_MUSHROOMS = 70;

function buildMushrooms() {
  const meshCap   = new THREE.InstancedMesh(GEO.mCap,   MAT.cap,   MAX_MUSHROOMS);
  const meshStalk = new THREE.InstancedMesh(GEO.mStalk, MAT.stalk, MAX_MUSHROOMS);

  let im = 0;
  const rng = makeRng(0xA05AA00A);

  for (let i = 0; i < 300 && im < MAX_MUSHROOMS; i++) {
    const x = -HALF + 3 + rng() * 72;   // Forest spans roughly x ∈ [-100, -25]
    const z = -HALF + 3 + rng() * 115;  // z ∈ [-100, 18]
    if (getZoneName(x, z) !== 'Forest') continue;
    if (isBlocked(x, z)) continue;

    const ground = getHeightAt(x, z);
    const sc     = 0.5 + rng() * 0.9;
    const ry     = rng() * Math.PI * 2;

    setMatrix(meshStalk, im, x, ground + 0.28 * sc, z, ry, sc, sc, sc);
    setMatrix(meshCap,   im, x, ground + 0.60 * sc, z, ry, sc * 1.1, sc * 0.8, sc * 1.1);
    im++;
  }

  meshCap.count   = im;
  meshStalk.count = im;
  meshCap.instanceMatrix.needsUpdate   = true;
  meshStalk.instanceMatrix.needsUpdate = true;

  scene.add(meshCap, meshStalk);
}

// ============================================================
//  CABIN  (NE zone, centred ~55, -60)
//
//  Layout (top-down):
//
//         ┌──────────────────────┐
//         │  back wall           │  (z = cz - DH/2)
//         │  [window]            │
//     [side]               [side]│
//         │  [window]            │
//         │  front L │door│ fr R │  (z = cz + DH/2)
//         └──────────────────────┘
//
//  DW = 14  (east-west width)
//  DH = 10  (north-south depth)
//  H  = 4.5 (wall height)
//
//  Roof: two BoxGeometry panels forming an inverted-V, plus
//  a chimney stack on the back left.
// ============================================================

function buildCabin() {
  const CX = 55, CZ = -62;   // cabin centre (world space)
  const DW = 14, DH = 10, WH = 4.5;

  const ground = getHeightAt(CX, CZ);
  const wallBaseY = ground;
  const wallMidY  = wallBaseY + WH * 0.5;
  const wallTopY  = wallBaseY + WH;

  // ── Helper: add a solid box to the scene ─────────────────
  function addBox(mat, x, y, z, sx, sy, sz, ry) {
    ry = ry || 0;
    const mesh = new THREE.Mesh(GEO.box, mat);
    mesh.scale.set(sx, sy, sz);
    mesh.position.set(x, y + sy * 0.5, z);
    if (ry) mesh.rotation.y = ry;
    scene.add(mesh);
  }

  // ── Floor slab ───────────────────────────────────────────
  addBox(MAT.wood, CX, ground - 0.15, CZ, DW, 0.22, DH);

  // ── Walls  (four sides, door cut out of front wall) ──────

  // Back wall (full width)
  addBox(MAT.wood, CX, wallMidY, CZ - DH * 0.5, DW, WH, 0.35);

  // Side walls (full depth)
  addBox(MAT.wood, CX - DW * 0.5, wallMidY, CZ, 0.35, WH, DH);
  addBox(MAT.wood, CX + DW * 0.5, wallMidY, CZ, 0.35, WH, DH);

  // Front wall: two pieces flanking door (door = 2.2 wide, centred)
  const doorW = 2.2;
  const sideW = (DW - doorW) * 0.5;
  const leftCX  = CX - doorW * 0.5 - sideW * 0.5;
  const rightCX = CX + doorW * 0.5 + sideW * 0.5;

  addBox(MAT.wood, leftCX,  wallMidY, CZ + DH * 0.5, sideW, WH,  0.35);
  addBox(MAT.wood, rightCX, wallMidY, CZ + DH * 0.5, sideW, WH,  0.35);

  // Door lintel (above gap)
  const lintelH = 0.45;
  addBox(MAT.wood, CX, wallTopY - lintelH * 0.5, CZ + DH * 0.5, doorW, lintelH, 0.38);

  // ── Door ─────────────────────────────────────────────────
  addBox(MAT.door, CX, wallBaseY + 1.8, CZ + DH * 0.5 + 0.01, 1.8, 3.6, 0.12);

  // ── Windows (back wall x2, side walls x1 each) ───────────
  const winW = 1.4, winH = 1.4, winY = wallBaseY + WH * 0.6;

  // Back wall windows
  addBox(MAT.window_, CX - 3.5, winY, CZ - DH * 0.5 - 0.01, winW, winH, 0.12);
  addBox(MAT.window_, CX + 3.5, winY, CZ - DH * 0.5 - 0.01, winW, winH, 0.12);

  // Side windows
  addBox(MAT.window_, CX - DW * 0.5 - 0.01, winY, CZ, 0.12, winH, winW);
  addBox(MAT.window_, CX + DW * 0.5 + 0.01, winY, CZ, 0.12, winH, winW);

  // ── Roof (two angled panels + ridge cap) ─────────────────
  //
  // Each panel: width = DW/2 + overhang, depth = DH + overhang
  // Rotated ±rise angle around the ridge (Z-axis, running E-W).
  //
  const overhang  = 0.9;
  const rise      = 3.2;         // how far ridge is above wall top
  const ridgeY    = wallTopY + rise;
  const panelDepth = DH + overhang * 2;

  // Diagonal half-width (hypotenuse of rise / half-width triangle)
  const halfW  = DW * 0.5 + overhang;
  const pLen   = Math.sqrt(halfW * halfW + rise * rise);  // panel length
  const angle  = Math.atan2(rise, halfW);                 // tilt angle

  // Two roof panel meshes
  function addRoofPanel(side) {
    const mesh = new THREE.Mesh(GEO.box, MAT.roof);
    mesh.scale.set(pLen, 0.28, panelDepth);
    // centre of panel is halfway between eave and ridge, on that side
    const px = CX + side * (halfW * 0.5);
    const py = wallTopY + rise * 0.5 + 0.14;
    mesh.position.set(px, py, CZ);
    mesh.rotation.z = side * (-angle);
    scene.add(mesh);
  }
  addRoofPanel(-1);
  addRoofPanel( 1);

  // Ridge cap (thin box along the top)
  addBox(MAT.roof, CX, ridgeY + 0.10, CZ, 0.38, 0.28, panelDepth);

  // ── Chimney ───────────────────────────────────────────────
  const chX = CX - 4, chZ = CZ - 3.5;
  const chGroundH = getHeightAt(chX, chZ);
  addBox(MAT.chimney, chX, chGroundH, chZ, 0.90, ridgeY + 1.4 - chGroundH, 0.90);

  // ── Front porch step ─────────────────────────────────────
  addBox(MAT.wood, CX, ground, CZ + DH * 0.5 + 0.60, doorW + 0.6, 0.22, 1.2);
}

// ============================================================
//  SIGNPOSTS
//  Four signs at zone entry points.
// ============================================================

function buildSigns() {
  const signs = [
    // [ x,  z,  label,          facing (ry) ]
    [ -22,  10, 'Forest',       Math.PI * 0.75  ],
    [  38,  18, 'Lake',         Math.PI * 1.5   ],
    [  32, -28, 'Cabin',        0               ],
    [   0, -16, 'Plaza',        Math.PI         ],
  ];

  signs.forEach(([sx, sz, , ry]) => {
    const ground = getHeightAt(sx, sz);

    // Post
    const post = new THREE.Mesh(GEO.box, MAT.signPost);
    post.scale.set(0.16, 2.2, 0.16);
    post.position.set(sx, ground + 1.1, sz);
    scene.add(post);

    // Board
    const board = new THREE.Mesh(GEO.box, MAT.signBoard);
    board.scale.set(1.6, 0.65, 0.12);
    board.position.set(sx, ground + 2.2, sz);
    board.rotation.y = ry;
    scene.add(board);
  });
}

// ============================================================
//  LAKE REEDS  (ring of tall thin cylinders near shore)
// ============================================================

function buildReeds() {
  const reedGeo = new THREE.CylinderGeometry(0.05, 0.08, 1.8, 4);
  const reedMat = new THREE.MeshLambertMaterial({ color: 0x5a7a30 });
  const MAX_REEDS = 90;
  const meshReed  = new THREE.InstancedMesh(reedGeo, reedMat, MAX_REEDS);

  let ir = 0;
  const rng = makeRng(0xAEED0550);

  for (let i = 0; i < 300 && ir < MAX_REEDS; i++) {
    const a = rng() * Math.PI * 2;
    const r = 17 + rng() * 6;
    const x = 60 + Math.cos(a) * r;
    const z = 50 + Math.sin(a) * r;
    if (Math.abs(x) >= HALF - 2 || Math.abs(z) >= HALF - 2) continue;
    if (getZoneName(x, z) === 'Lake') continue;
    if (isBlocked(x, z)) continue;

    const ground = getHeightAt(x, z);
    const sc = 0.6 + rng() * 0.8;
    const ry = rng() * Math.PI * 2;
    setMatrix(meshReed, ir++, x, ground + 0.9 * sc, z, ry, sc, sc, sc);
  }

  meshReed.count = ir;
  meshReed.instanceMatrix.needsUpdate = true;
  scene.add(meshReed);
}

// ============================================================
//  FENCE  (runs along the cabin perimeter)
// ============================================================

function buildFence() {
  // Simple post + rail around the cabin clearing
  const postGeo  = new THREE.CylinderGeometry(0.08, 0.08, 1.4, 5);
  const railGeo  = new THREE.CylinderGeometry(0.05, 0.05, 3.5, 4);
  const fenceMat = new THREE.MeshLambertMaterial({ color: 0xb09060 });

  const MAX_POSTS = 70;
  const meshPost  = new THREE.InstancedMesh(postGeo, fenceMat, MAX_POSTS);
  const meshRail  = new THREE.InstancedMesh(railGeo, fenceMat, MAX_POSTS);
  let ip = 0;

  // Rectangular fence: 26 × 20, centred at cabin but wider
  const FCX = 55, FCZ = -62;
  const FW = 26, FH = 20;
  const POST_SPACING = 3.5;

  function fencePost(x, z, ry) {
    if (ip >= MAX_POSTS) return;
    const ground = getHeightAt(x, z);
    setMatrix(meshPost, ip, x, ground + 0.70, z, 0, 1, 1, 1);
    // Rail horizontal, along fence direction
    setMatrix(meshRail, ip, x + Math.cos(ry) * 1.75, ground + 0.80,
              z + Math.sin(ry) * 1.75, ry + Math.PI * 0.5, 1, 1, 1);
    ip++;
  }

  // South side (front)
  for (let x = FCX - FW * 0.5; x <= FCX + FW * 0.5; x += POST_SPACING) {
    fencePost(x, FCZ + FH * 0.5, 0);
  }
  // North side (back)
  for (let x = FCX - FW * 0.5; x <= FCX + FW * 0.5; x += POST_SPACING) {
    fencePost(x, FCZ - FH * 0.5, 0);
  }
  // East side
  for (let z = FCZ - FH * 0.5; z <= FCZ + FH * 0.5; z += POST_SPACING) {
    fencePost(FCX + FW * 0.5, z, Math.PI * 0.5);
  }
  // West side
  for (let z = FCZ - FH * 0.5; z <= FCZ + FH * 0.5; z += POST_SPACING) {
    fencePost(FCX - FW * 0.5, z, Math.PI * 0.5);
  }

  meshPost.count = ip;
  meshRail.count = ip;
  meshPost.instanceMatrix.needsUpdate = true;
  meshRail.instanceMatrix.needsUpdate = true;
  scene.add(meshPost, meshRail);
}

// ============================================================
//  PLAZA DETAILS
//  Low stone walls + central fountain
// ============================================================

function buildPlaza() {
  // Low stone border walls along plaza edges
  const wallMat = new THREE.MeshLambertMaterial({ color: 0x8888a0 });

  function addWall(x, z, sx, sz) {
    const mesh = new THREE.Mesh(GEO.box, wallMat);
    mesh.scale.set(sx, 0.60, sz);
    mesh.position.set(x, getHeightAt(x, z) + 0.30, z);
    scene.add(mesh);
  }

  // Four sides of the plaza border (~22 × 18 unit square)
  addWall(  0, -18, 44, 0.5);  // north
  addWall(  0,  18, 44, 0.5);  // south
  addWall(-22,   0, 0.5, 36);  // west
  addWall( 22,   0, 0.5, 36);  // east

  // Fountain: a short cylinder base + thin disc pool
  const fountainMat = new THREE.MeshLambertMaterial({ color: 0x9090b0 });
  const waterMat2   = new THREE.MeshLambertMaterial({ color: 0x40a0e0, transparent: true, opacity: 0.75 });

  const baseGeo = new THREE.CylinderGeometry(2.2, 2.6, 0.70, 12);
  const base    = new THREE.Mesh(baseGeo, fountainMat);
  base.position.set(0, getHeightAt(0, 0) + 0.35, 0);
  scene.add(base);

  const poolGeo = new THREE.CylinderGeometry(2.0, 2.0, 0.20, 12);
  const pool    = new THREE.Mesh(poolGeo, waterMat2);
  pool.position.set(0, getHeightAt(0, 0) + 0.68, 0);
  scene.add(pool);

  // Fountain pillar + cap
  const pillarGeo = new THREE.CylinderGeometry(0.22, 0.28, 2.0, 8);
  const pillar    = new THREE.Mesh(pillarGeo, fountainMat);
  pillar.position.set(0, getHeightAt(0, 0) + 1.8, 0);
  scene.add(pillar);

  const capGeo = new THREE.CylinderGeometry(0.55, 0.22, 0.30, 8);
  const cap    = new THREE.Mesh(capGeo, fountainMat);
  cap.position.set(0, getHeightAt(0, 0) + 2.95, 0);
  scene.add(cap);
}

// ============================================================
//  SCATTER BOULDERS  (large rocks for landmarks)
// ============================================================

function buildBoulders() {
  const rng = makeRng(0xB0DEED00);
  const mat = new THREE.MeshLambertMaterial({ color: 0x60606a });

  const spots = [
    // Landmark boulders at interesting locations
    [-65,  -5],   // deep forest
    [-48,  12],   // forest edge
    [ 10,  45],   // south plains
    [-30,  55],   // SW corner
    [ 72, -25],   // NE open area
  ];

  spots.forEach(([bx, bz]) => {
    const ground = getHeightAt(bx, bz);
    const geo    = new THREE.IcosahedronGeometry(1.8 + rng() * 1.4, 1);
    const mesh   = new THREE.Mesh(geo, mat);
    mesh.scale.set(1 + rng() * 0.4, 0.7 + rng() * 0.5, 1 + rng() * 0.4);
    mesh.position.set(bx, ground + 0.8, bz);
    mesh.rotation.y = rng() * Math.PI * 2;
    scene.add(mesh);
  });
}

// ============================================================
//  ENTRY POINT
// ============================================================
export function initObjects() {
  buildTrees();
  buildRocks();
  buildFlowers();
  buildMushrooms();
  buildCabin();
  buildFence();
  buildSigns();
  buildReeds();
  buildPlaza();
  buildBoulders();
}
