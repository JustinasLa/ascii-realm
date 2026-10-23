import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mulberry32 } from '../src/core/rng.js';
import { GLYPH_COUNT, GLYPH_MASK, LAYER } from '../src/render/glyphs.js';
import { makeArchitectureProp } from '../src/world/architecture-props.js';
import { bakeSurface } from '../src/world/prop-art.js';
import { PROP_CATALOG } from '../src/world/prop-catalog.js';
import { PILLAR_DEFINITIONS } from '../src/world/architecture-pillars.js';
import { ASPECT } from '../src/world/world.js';

const kinds = ['stone-gate', 'stone-tower', 'column-short', 'column-broken', 'column-tall',
  'wall-low', 'wall-broken', 'rubble-small', 'rubble-large'];
const make = (kind, seed = 42, bake = bakeSurface, x = 0, y = 0) =>
  makeArchitectureProp(kind, x, y, mulberry32(seed), seed, bake);

function recipe(kind, seed = 42) {
  let surface;
  const prop = make(kind, seed, (w, top, bottom, sample) => {
    surface = { w, top, bottom, sample };
    return [];
  });
  return { prop, ...surface };
}

test('architecture palette exposes legacy recipes and new pillars, and unknown kinds consume nothing', () => {
  assert.deepEqual(PROP_CATALOG.filter(({ group }) => group === 'Architecture').map(({ kind }) => kind),
    [...kinds, ...PILLAR_DEFINITIONS.map(p => p.kind)]);
  for (const kind of kinds) assert.ok(PROP_CATALOG.find((p) => p.kind === kind).solid);
  const unused = () => assert.fail('unknown kinds must not consume randomness or bake');
  for (const kind of ['tree', '', 'constructor', '__proto__']) {
    assert.equal(makeArchitectureProp(kind, 0, 0, unused, 1, unused), null);
  }
});

test('architecture bakes are deterministic, varied by seed and independent of position', () => {
  for (const kind of kinds) {
    const prop = make(kind);
    assert.deepEqual(make(kind), prop, kind);
    assert.deepEqual(make(kind, 42, bakeSurface, -200, 400).cells, prop.cells, kind);
    assert.notDeepEqual(make(kind, 43).cells, prop.cells, kind);
    assert.ok(prop.cells.length > 0 && prop.cells.length < 7000, kind);
    const positions = new Set();
    for (const cell of prop.cells) {
      assert.ok(Number.isInteger(cell.dx) && Number.isInteger(cell.dy), kind);
      assert.ok((cell.g & GLYPH_MASK) > 0 && (cell.g & GLYPH_MASK) < GLYPH_COUNT, kind);
      assert.ok([cell.r, cell.gg, cell.b].every(Number.isFinite), kind);
      if (cell.g & LAYER) continue;
      const position = `${cell.dx},${cell.dy}`;
      assert.ok(!positions.has(position), `${kind}: duplicate base cell`);
      positions.add(position);
    }
  }
});

test('gate aperture is transparent and pier colliders use matching world coordinates', () => {
  for (const seed of [1, 8, 42, 901]) {
    const { prop, sample } = recipe('stone-gate', seed);
    const [left, right] = prop.collisionRects;
    assert.equal(left.minX, -prop.footW);
    assert.equal(right.maxX, prop.footW);
    assert.equal(left.maxX, -right.minX);
    assert.ok(right.minX * ASPECT >= 8, 'at least 16 physical units of width');
    for (const rect of prop.collisionRects) {
      assert.equal(rect.minY, -prop.footH);
      assert.equal(rect.maxY, 0.3, 'small front margin includes the anchor in strict collision bounds');
      const centerX = (rect.minX + rect.maxX) * ASPECT / 2;
      assert.ok(sample(centerX, -prop.footH / 2), 'support visible at its ground footprint');
      assert.ok(sample(centerX, -19), 'support continues up the gate');
    }
    for (let py = -25; py <= 0; py += 0.5) {
      for (let px = -4; px <= 4; px += 0.5) assert.equal(sample(px, py), null);
    }
    const lipX = right.minX * ASPECT;
    assert.equal(sample(lipX - 0.01, -1.2), null);
    assert.ok(sample(lipX + 1.2, -1.2), 'bevelled foot is solid inside the pier');
    assert.ok(sample(0, recipe('stone-gate', seed).top + 12), 'stone spans above the arched opening');
    const gate = make('stone-gate', seed);
    assert.ok(!gate.cells.some(({ dx, dy }) => Math.abs(dx * ASPECT) <= 3.5 && dy >= -24),
      'no painted darkness, shadow, or accents fill the passage');
  }
});

test('battlements have alternating stone and sky and columns have distinct heights', () => {
  for (const kind of ['stone-gate', 'stone-tower']) {
    const { prop, sample, top } = recipe(kind);
    let transitions = 0;
    // Depth projects the merlons' back edges upward; inspect the upper crown
    // instead of assuming every tooth starts at one flat screen-space row.
    for (let y = top + 0.5; y < top + 4; y += 0.25) {
      const row = [];
      for (let x = -prop.footW * ASPECT; x < prop.footW * ASPECT; x += 0.2) {
        row.push(Boolean(sample(x, y)));
      }
      transitions = Math.max(transitions, row.filter((v, i) => i && v !== row[i - 1]).length);
    }
    assert.ok(transitions >= 4, kind);
  }
  const heights = ['column-short', 'column-broken', 'column-tall'].map((kind) => -recipe(kind).top);
  assert.ok(heights[0] + 5 < heights[1] && heights[1] + 5 < heights[2]);
  const { sample, top } = recipe('column-broken');
  const edge = [];
  for (let x = -2; x <= 2; x += 0.4) {
    for (let y = top; y < -10; y += 0.1) {
      if (sample(x, y)) { edge.push(Math.round(y * 10)); break; }
    }
  }
  assert.ok(new Set(edge).size >= 3, 'broken shaft has a chipped top');
});

test('rendered stone uses strong directional contrast and almost black opaque backing', () => {
  for (const kind of kinds) {
    const cells = make(kind).cells.filter((c) => c.br !== undefined);
    const bright = cells.filter((c) => c.b > 165);
    const dark = cells.filter((c) => c.b < 65);
    assert.ok(bright.length >= 2, `${kind}: visible lit top/left surfaces`);
    assert.ok(dark.length >= 2, `${kind}: visible shaded side surfaces`);
    assert.ok(cells.every((c) => c.br < 12 && c.bgG < 12 && c.bb < 14), `${kind}: solid dark backing`);
    assert.ok(cells.every((c) => c.g > 0 && c.g < 95), `${kind}: interior glyphs are ordinary ASCII`);
    assert.ok(new Set(cells.map((c) => c.g)).size >= 5, `${kind}: density changes across the form`);
  }
});

test('cylinders shade radially, with a bright left flank and dark right flank at every height', () => {
  for (const kind of ['column-short', 'column-broken', 'column-tall']) {
    const { sample } = recipe(kind);
    for (const y of [-12, -16]) {
      const left = sample(-2.5, y), right = sample(2.5, y);
      assert.ok(left && right, `${kind}: solid shaft cross section`);
      assert.ok(left.c[2] > right.c[2] * 2.5, `${kind}: radial surface contrast`);
      assert.notEqual(left.g, right.g, `${kind}: glyph weight follows the light`);
    }
  }
});

test('samplers retain their geometry under resampling without consuming more randomness', () => {
  for (const kind of kinds) {
    let draws = 0;
    let drawCountAtBake;
    const random = mulberry32(8);
    makeArchitectureProp(kind, 0, 0, () => { draws++; return random(); }, 8, (w, top, bottom, sample, seed) => {
      drawCountAtBake = draws;
      const original = sample(1.2, -3.5);
      for (const scale of [0.25, 0.5, 1, 3]) {
        const scaled = bakeSurface(Math.ceil(w * scale) + 1, Math.floor(top * scale) - 1, bottom,
          (px, py) => sample(px / scale, py / scale), seed);
        assert.ok(scaled.length > 0 && scaled.length < 60000, `${kind} at scale ${scale}`);
      }
      assert.deepEqual(sample(1.2, -3.5), original, kind);
      return [];
    });
    assert.equal(draws, drawCountAtBake, `${kind}: sampler must be pure`);
  }
});
