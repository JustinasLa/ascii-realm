import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LINE_ANGLES, LINE_OFFSETS } from '../src/render/glyph-packs/terrain.js';
import { GLYPHS } from '../src/render/glyphs.js';
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

test('stone slabs are drawn as characters weighted by their light, with joints left dark', () => {
  const world = new World(1);
  const c = world.chunk(-1, 0);
  const n = CHUNK_SIZE * CHUNK_SIZE;
  const out = { fg: new Uint8ClampedArray(n * 4), bg: new Uint8ClampedArray(n * 4), ov: new Uint8ClampedArray(n * 4) };
  let stone = 0;
  let letters = 0;
  let joints = 0;
  let heavy = 0;
  let layered = 0;
  for (let i = 0; i < n; i++) {
    if (c.type[i] !== STONE) continue;
    stone++;
    TERRAIN_SHADERS[STONE].shade(out, i * 4, c, i, -CHUNK_SIZE + (i % CHUNK_SIZE), Math.floor(i / CHUNK_SIZE), 1, 0);
    const g = out.fg[i * 4 + 3] | ((out.bg[i * 4 + 3] & 15) << 8);
    if (g > 0) letters++;
    if ('#@M&8$0OQ'.includes(GLYPHS[g])) heavy++;
    // Joints are gaps: no character where slabs meet.
    if (g === 0) joints++;
    if (out.ov[i * 4 + 3] || out.bg[i * 4 + 3] >> 4) layered++;
  }
  assert.ok(stone > 100, 'the chunk holds rock');
  assert.ok(letters > stone * 0.5, `rock is drawn with characters (${letters}/${stone}, ${joints} gaps)`);
  assert.ok(heavy > stone * 0.05, 'moonlit faces carry heavy characters');
  assert.ok(joints > stone * 0.05, 'joints run between the slabs');
  assert.equal(layered, 0, 'one character per cell');
});

test('ground not generated yet is drawn as bare night, clearing any glyph layered there', async () => {
  const { drawGround } = await import('../src/world/ground.js');
  const { withLayers } = await import('./helpers/renderer.js');
  const { dg, over } = await import('../src/render/glyphs.js');
  const world = new World(1);
  const view = { x0: 100000, y0: 100000, cols: 4, rows: 2 };
  const r = withLayers({ cols: 4, rows: 2, mask: new Uint8Array(8) });
  r.put(1, 1, dg('crack.3'), 9, 9, 9);
  r.put(1, 1, over(dg('flower.ring5')), 9, 9, 9);
  drawGround(r, world, view, 0, null, 0, true);
  assert.ok(!world.loaded(Math.floor(100000 / CHUNK_SIZE), Math.floor(100000 / CHUNK_SIZE)));
  for (let cell = 0; cell < 8; cell++) {
    assert.equal(r.glyphAt(cell), 0);
    assert.equal(r.hasLayer(cell), false);
  }
});
