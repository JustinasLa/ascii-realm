import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LINE_ANGLES, LINE_OFFSETS } from '../src/render/glyph-packs/terrain.js';
import { lineCell } from '../src/world/terrain/surface.js';
import { TERRAIN_SHADERS } from '../src/world/terrain/index.js';
import { wetness } from '../src/world/terrain/shore.js';
import { CHUNK_SIZE, DIRT, SHORE, STONE, WATER, World } from '../src/world/world.js';

test('a line crossing a cell maps to a heading and offset, and misses cells it does not cross', () => {
  // A horizontal joint through the middle of a cell.
  const mid = lineCell(0, 1, 0);
  assert.equal(Math.floor(mid / LINE_OFFSETS), 0);
  assert.equal(mid % LINE_OFFSETS, (LINE_OFFSETS - 1) / 2);
  // Shifted down toward the cell's bottom edge, the offset index grows.
  assert.ok(lineCell(0, 1, 0.4) % LINE_OFFSETS > mid % LINE_OFFSETS);
  // A vertical joint has the quarter-turn heading.
  assert.equal(Math.floor(lineCell(1, 0, 0) / LINE_OFFSETS), LINE_ANGLES / 2);
  // Half a row away the line has left the cell.
  assert.equal(lineCell(0, 1, 0.55), -1);
  assert.equal(lineCell(1, 0, 0.35), -1);
});

test('shore sand is soaked beside the water and dry at the top of the bank', () => {
  const n = CHUNK_SIZE * CHUNK_SIZE;
  const chunk = { type: new Uint8Array(n).fill(SHORE), elev: new Float32Array(n).fill(0.414) };
  assert.ok(wetness(chunk, 200) < 0.1);
  chunk.type[201] = WATER;
  assert.ok(wetness(chunk, 200) >= 0.85);
  chunk.elev[300] = 0.401;
  assert.ok(wetness(chunk, 300) > 0.9);
});

test('bare ground is shaded deterministically, independent of time and the order chunks are visited', () => {
  const shadeChunk = (world, cx, cy, t) => {
    const c = world.chunk(cx, cy);
    const out = {
      fg: new Uint8ClampedArray(n * 4), bg: new Uint8ClampedArray(n * 4), ov: new Uint8ClampedArray(n * 4),
    };
    for (let i = 0; i < n; i++) {
      const shader = TERRAIN_SHADERS[c.type[i]];
      const wx = cx * CHUNK_SIZE + (i % CHUNK_SIZE);
      const wy = cy * CHUNK_SIZE + Math.floor(i / CHUNK_SIZE);
      if (shader.animated(c, i, wx, wy, world.seed)) continue;
      shader.shade(out, i * 4, c, i, wx, wy, world.seed, t);
    }
    return { c, out };
  };
  const n = CHUNK_SIZE * CHUNK_SIZE;
  const a = new World(1);
  const b = new World(1);
  b.chunk(3, 3);
  const seen = new Set();
  for (const [cx, cy] of [[-1, 0], [0, 0], [2, 0], [-1, -1]]) {
    const first = shadeChunk(a, cx, cy, 0);
    const second = shadeChunk(b, cx, cy, 37);
    assert.deepEqual(first.out.fg, second.out.fg);
    assert.deepEqual(first.out.bg, second.out.bg);
    assert.deepEqual(first.out.ov, second.out.ov);
    for (const t of first.c.type) seen.add(t);
  }
  assert.ok(seen.has(STONE) && seen.has(SHORE) && seen.has(DIRT), 'the sample covers rock, shore and path');
});

test('stone slabs are textured surfaces with dark joints rather than letters', () => {
  const world = new World(1);
  const c = world.chunk(-1, 0);
  const n = CHUNK_SIZE * CHUNK_SIZE;
  const out = { fg: new Uint8ClampedArray(n * 4), bg: new Uint8ClampedArray(n * 4), ov: new Uint8ClampedArray(n * 4) };
  let stone = 0;
  let letters = 0;
  let joints = 0;
  let layered = 0;
  for (let i = 0; i < n; i++) {
    if (c.type[i] !== STONE) continue;
    stone++;
    TERRAIN_SHADERS[STONE].shade(out, i * 4, c, i, -CHUNK_SIZE + (i % CHUNK_SIZE), Math.floor(i / CHUNK_SIZE), 1, 0);
    const g = out.fg[i * 4 + 3] | ((out.bg[i * 4 + 3] & 15) << 8);
    if (g > 32 && g < 127) letters++;
    // Joints are drawn darker than the slab surface they cross.
    if (out.fg[i * 4] < out.bg[i * 4]) joints++;
    if (out.ov[i * 4 + 3] || out.bg[i * 4 + 3] >> 4) layered++;
  }
  assert.ok(stone > 100, 'the chunk holds rock');
  assert.equal(letters, 0);
  assert.ok(joints > stone * 0.05, 'joints run between the slabs');
  assert.ok(layered > stone * 0.1, 'lips, grit, moss and lichen are layered over the rock');
});
