// ============================================================
//  WalkWorld — world.js
//  Defines the tile map, decorations, and collision data.
//  All layout is deterministic (seeded RNG) so every player
//  sees the exact same world.
// ============================================================

// ── Tile constants ───────────────────────────────────────────
export const TILE = Object.freeze({
  GRASS:      0,
  DARK_GRASS: 1,
  WATER:      2,
  SAND:       3,
  STONE_PATH: 4,
  WOOD_FLOOR: 5,
});

// Visual definition for each tile type
export const TILE_DEF = {
  [TILE.GRASS]:      { base: '#4a8c3a', alt: '#3f7d31', solid: false },
  [TILE.DARK_GRASS]: { base: '#2d5a27', alt: '#264d21', solid: false },
  [TILE.WATER]:      { base: '#1a5fa8', alt: '#1b6dbf', solid: true  },
  [TILE.SAND]:       { base: '#c9a262', alt: '#b8933f', solid: false },
  [TILE.STONE_PATH]: { base: '#7a7a8c', alt: '#6b6b7d', solid: false },
  [TILE.WOOD_FLOOR]: { base: '#8b6438', alt: '#7a5830', solid: false },
};

// ── World dimensions ─────────────────────────────────────────
export const TILE_SIZE = 32;   // pixels per tile
export const WORLD_W   = 100;  // tiles wide
export const WORLD_H   = 75;   // tiles tall
export const WORLD_PX  = WORLD_W * TILE_SIZE;
export const WORLD_PY  = WORLD_H * TILE_SIZE;

// ── Decoration types ─────────────────────────────────────────
export const DECO = Object.freeze({
  TREE:     'tree',
  BUSH:     'bush',
  ROCK:     'rock',
  FLOWER:   'flower',
  MUSHROOM: 'mushroom',
  SIGN:     'sign',
});

// ── Seeded RNG (LCG) — same output every run ─────────────────
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = Math.imul(s, 1664525) + 1013904223 >>> 0;
    return s / 0x100000000;
  };
}
const rng = makeRng(0xDEADBEEF);

// ── Build tile map ───────────────────────────────────────────
export const tileMap = (() => {
  // Start with all grass
  const map = Array.from({ length: WORLD_H }, () =>
    new Uint8Array(WORLD_W).fill(TILE.GRASS)
  );

  const set = (x, y, t) => {
    if (x >= 0 && x < WORLD_W && y >= 0 && y < WORLD_H) map[y][x] = t;
  };
  const fill = (x0, y0, x1, y1, t) => {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) set(x, y, t);
  };
  const circle = (cx, cy, r, t) => {
    for (let y = cy - r; y <= cy + r; y++)
      for (let x = cx - r; x <= cx + r; x++)
        if ((x-cx)**2 + (y-cy)**2 <= r*r) set(x, y, t);
  };

  // ── Dark grass forest (NW quadrant) ──
  fill(0, 0, 42, 34, TILE.DARK_GRASS);

  // ── Water lake (SE area) ──
  circle(78, 58, 11, TILE.WATER);
  // Sand ring around lake
  circle(78, 58, 14, TILE.SAND);
  // Overwrite center back to water
  circle(78, 58, 11, TILE.WATER);

  // ── Small pond (center-west) ──
  circle(18, 52, 5, TILE.WATER);
  circle(18, 52, 7, TILE.SAND);
  circle(18, 52, 5, TILE.WATER);

  // ── Central stone plaza ──
  fill(43, 31, 57, 44, TILE.STONE_PATH);

  // ── Main cross-paths ──
  // Horizontal
  fill(0,  36, WORLD_W - 1, 39, TILE.STONE_PATH);
  // Vertical
  fill(48, 0,  51, WORLD_H - 1, TILE.STONE_PATH);

  // ── Diagonal paths (NW → plaza, SE → lake shore) ──
  for (let i = 0; i < 30; i++) {
    const x = 20 + i;
    const y = 20 + Math.round(i * 0.4);
    fill(x, y, x + 2, y + 1, TILE.STONE_PATH);
  }

  // ── Wood cabin floor (NE area) ──
  fill(68, 8, 82, 18, TILE.WOOD_FLOOR);

  // ── Dark grass patches scattered in grass areas ──
  for (let i = 0; i < 20; i++) {
    const px = Math.floor(rng() * WORLD_W);
    const py = Math.floor(rng() * WORLD_H);
    if (map[py][px] === TILE.GRASS) {
      const r = 2 + Math.floor(rng() * 4);
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++)
          if (dx*dx + dy*dy <= r*r && map[py+dy]?.[px+dx] === TILE.GRASS)
            set(px+dx, py+dy, TILE.DARK_GRASS);
    }
  }

  return map;
})();

// ── Build decorations ────────────────────────────────────────
export const decorations = (() => {
  const decos = [];
  const r2 = makeRng(0xCAFEBABE);

  const occupied = new Set();
  const key = (x, y) => `${x},${y}`;
  const place = (x, y, type, extra = {}) => {
    if (x < 1 || x >= WORLD_W-1 || y < 1 || y >= WORLD_H-1) return;
    if (occupied.has(key(x, y))) return;
    occupied.add(key(x, y));
    decos.push({ x, y, type, ...extra });
  };

  const tileAt = (x, y) => tileMap[y]?.[x] ?? TILE.GRASS;
  const onSolidTile = (x, y) => TILE_DEF[tileAt(x, y)]?.solid ?? false;
  const onPath = (x, y) => tileAt(x,y) === TILE.STONE_PATH || tileAt(x,y) === TILE.WOOD_FLOOR;

  // Border trees around the whole map
  for (let x = 0; x < WORLD_W; x++) {
    place(x, 0, DECO.TREE);
    place(x, 1, DECO.TREE);
    place(x, WORLD_H-1, DECO.TREE);
    place(x, WORLD_H-2, DECO.TREE);
  }
  for (let y = 0; y < WORLD_H; y++) {
    place(0, y, DECO.TREE);
    place(1, y, DECO.TREE);
    place(WORLD_W-1, y, DECO.TREE);
    place(WORLD_W-2, y, DECO.TREE);
  }

  // Dense forest trees in dark grass areas
  for (let y = 2; y < WORLD_H-2; y++) {
    for (let x = 2; x < WORLD_W-2; x++) {
      if (tileAt(x,y) !== TILE.DARK_GRASS) continue;
      if (onPath(x,y)) continue;
      if (r2() < 0.14) place(x, y, DECO.TREE);
      else if (r2() < 0.06) place(x, y, DECO.BUSH);
      else if (r2() < 0.03) place(x, y, DECO.MUSHROOM);
    }
  }

  // Flowers in open grass
  for (let y = 2; y < WORLD_H-2; y++) {
    for (let x = 2; x < WORLD_W-2; x++) {
      if (tileAt(x,y) !== TILE.GRASS) continue;
      if (onPath(x,y)) continue;
      if (onSolidTile(x,y)) continue;
      if (r2() < 0.06) {
        const colours = ['#ff6b9d','#ffdd57','#7c6cf7','#ff4757','#ffffff','#ffa502'];
        place(x, y, DECO.FLOWER, { colour: colours[Math.floor(r2()*colours.length)] });
      }
    }
  }

  // Rocks near sand + scattered
  for (let y = 2; y < WORLD_H-2; y++) {
    for (let x = 2; x < WORLD_W-2; x++) {
      const t = tileAt(x,y);
      if (t === TILE.SAND && r2() < 0.07) place(x, y, DECO.ROCK);
      if (t === TILE.GRASS && r2() < 0.008) place(x, y, DECO.ROCK);
    }
  }

  // Trees around water edges (not in water)
  for (let y = 2; y < WORLD_H-2; y++) {
    for (let x = 2; x < WORLD_W-2; x++) {
      if (tileAt(x,y) !== TILE.SAND) continue;
      if (r2() < 0.05) place(x, y, DECO.TREE);
    }
  }

  // Signpost at plaza entrance (4 cardinal entrances)
  place(49, 31, DECO.SIGN);
  place(49, 44, DECO.SIGN);
  place(43, 37, DECO.SIGN);
  place(57, 37, DECO.SIGN);

  return decos;
})();

// ── Collidable decoration set (pixel coords) ─────────────────
const _solidDecos = new Set(
  decorations
    .filter(d => d.type === DECO.TREE || d.type === DECO.ROCK)
    .map(d => `${d.x},${d.y}`)
);

// ── Collision API ─────────────────────────────────────────────
/**
 * Returns true if the given WORLD PIXEL position (px, py) is blocked.
 * Accounts for a player radius so collisions feel fair.
 */
export function isBlocked(px, py, radius = 10) {
  // Check each corner + centre of the bounding box
  const checks = [
    [px,          py         ],
    [px - radius, py - radius],
    [px + radius, py - radius],
    [px - radius, py + radius],
    [px + radius, py + radius],
  ];

  for (const [cx, cy] of checks) {
    const tx = Math.floor(cx / TILE_SIZE);
    const ty = Math.floor(cy / TILE_SIZE);
    if (tx < 0 || tx >= WORLD_W || ty < 0 || ty >= WORLD_H) return true;
    if (TILE_DEF[tileMap[ty][tx]]?.solid) return true;
    if (_solidDecos.has(`${tx},${ty}`)) return true;
  }
  return false;
}

// Player spawn point: center of plaza
export const SPAWN = {
  x: (50 * TILE_SIZE) + TILE_SIZE / 2,
  y: (37 * TILE_SIZE) + TILE_SIZE / 2,
};

