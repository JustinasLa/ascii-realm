import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mulberry32 } from '../src/core/rng.js';
import { LAYER, glyph, over } from '../src/render/glyphs.js';
import { makeGateGeometry, makeTowerGeometry, makeWallGeometry } from '../src/world/architecture-buildings.js';
import { makeColumnGeometry, makeRubbleGeometry } from '../src/world/architecture-columns.js';
import { project } from '../src/world/architecture-mesh.js';
import { makeArchitectureProp } from '../src/world/architecture-props.js';
import { bakeFine, fineBakesPending } from '../src/world/fine-bakes.js';
import { bakeSurface, cellBounds, makeCell, withFine } from '../src/world/prop-art.js';
import { createProp, drawProp, propDepthSlices, propInView } from '../src/world/props.js';
import { ASPECT } from '../src/world/world.js';

const kinds = ['stone-gate', 'stone-tower', 'column-short', 'column-broken', 'column-tall',
  'wall-low', 'wall-broken', 'rubble-small', 'rubble-large'];
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} ~= ${b}`);
const geometry = (kind, seed) => {
  const rand = mulberry32(seed);
  if (kind === 'stone-gate') return makeGateGeometry(rand, seed);
  if (kind === 'stone-tower') return makeTowerGeometry(rand, seed);
  if (kind.startsWith('column-')) return makeColumnGeometry(kind, rand, seed);
  if (kind.startsWith('wall-')) return makeWallGeometry(kind, rand, seed);
  return makeRubbleGeometry(kind, rand, seed);
};

// Reconstruct the hit chosen by the baker, independently of cell.depth.
// Architecture has one material, so the edge fallback is the first fine hit.
function chosenHit(sample, cell, sx, sy) {
  const at = (fx, fy) => sample((cell.dx + fx - 0.5) * ASPECT / sx, (cell.dy + fy - 1) / sy);
  const coarse = [1 / 6, 3 / 6, 5 / 6].flatMap((fy) => [0.25, 0.75].map((fx) => at(fx, fy)));
  if (coarse[2] || coarse[3]) return coarse[2] ?? coarse[3];
  const hits = coarse.filter(Boolean).length;
  if (hits > 0 && hits < 6) {
    for (const fy of [1 / 12, 3 / 12, 5 / 12, 7 / 12, 9 / 12, 11 / 12]) {
      for (const fx of [0.125, 0.375, 0.625, 0.875]) {
        const hit = at(fx, fy);
        if (hit) return hit;
      }
    }
  }
  return coarse.find(Boolean);
}

test('architecture sampler depth is the yawed mesh surface projected onto the ground', () => {
  for (const kind of kinds) for (const rotation of [0, 17, -45]) {
    const seed = 42;
    const mesh = geometry(kind, seed).mesh.yaw(rotation).compile();
    let checked = 0;
    makeArchitectureProp(kind, 0, 0, mulberry32(seed), seed, (w, top, bottom, sample) => {
      for (let y = top; y <= bottom; y += 0.6) for (let x = -w * ASPECT; x <= w * ASPECT; x += 0.55) {
        const surface = sample(x, y);
        const hit = !rotation && y > 0 ? null : mesh.sample(x, y);
        assert.equal(Boolean(surface), Boolean(hit), kind);
        if (!hit) continue;
        near(surface.depth, project([hit.point[0], 0, hit.point[2]])[1]);
        checked++;
      }
      return [];
    }, rotation);
    assert.ok(checked > 10, `${kind}/${rotation}: mesh-backed samples`);
  }
});

test('baked depths match chosen mesh hits through size, anisotropic variation and shading', () => {
  const configurations = [
    { rotation: 0, variant: 0, scale: 1 },
    { rotation: 17, variant: 1, scale: 0.25 },
    { rotation: -45, variant: 1, scale: 3 },
  ];
  for (const kind of kinds) for (const options of configurations) {
    const seed = 19;
    const source = geometry(kind, seed);
    const { sample: rawSample } = source.mesh.yaw(options.rotation).compile();
    const sample = (x, y) => !options.rotation && y > 0 ? null : rawSample(x, y);
    const prop = createProp(kind, 100.75, -20.25, { seed, ...options });
    // Colliders and art share the same width/height factors, measured without
    // relying on the variation RNG or the implementation of scaledBaker.
    const unscaled = createProp(kind, 0, 0, { seed, variant: 0, rotation: options.rotation });
    const sx = prop.footW / unscaled.footW, sy = prop.footH / unscaled.footH;
    assert.ok(prop.cells.length > 0);
    let aboveGround = 0;
    for (const cell of prop.cells) {
      const hit = chosenHit(sample, cell, sx, sy);
      assert.ok(hit, `${kind}: chosen cell has a mesh hit`);
      assert.ok(Number.isFinite(cell.depth), `${kind}: variation retains depth`);
      near(cell.depth, project([hit.point[0], 0, hit.point[2]])[1] * sy);
      if (hit.point[1] * sy > 0.1) aboveGround++;
    }
    assert.ok(aboveGround > 0, `${kind}: sorting uses ground, not the glyph's screen row`);
  }
});

test('17-degree gate piers have distinct near/far sorting surfaces around an actor', () => {
  for (const rotation of [17, -17, 45]) {
    const prop = createProp('stone-gate', 0, 20.5, { seed: 42, variant: 0, rotation });
    const { sample } = geometry('stone-gate', 42).mesh.yaw(rotation).compile();
    const angle = rotation * Math.PI / 180;
    const piers = [[], []];
    for (const cell of prop.cells) {
      const hit = chosenHit(sample, cell, 1, 1);
      if (hit.point[1] < 5 || hit.point[1] > 25) continue;
      const originalX = Math.cos(angle) * hit.point[0] - Math.sin(angle) * hit.point[2];
      piers[originalX < 0 ? 0 : 1].push(cell.depth);
    }
    assert.ok(piers.every((p) => p.length > 20));
    const mean = (values) => values.reduce((a, b) => a + b) / values.length;
    const left = mean(piers[0]), right = mean(piers[1]);
    assert.ok(Math.abs(right - left) > 3, `${rotation}: piers cannot sort at one anchor`);
    assert.equal(Math.sign(right - left), Math.sign(rotation));
    const actorY = prop.y + (left + right) / 2;
    const nearPier = Math.max(left, right), farPier = Math.min(left, right);
    assert.ok(prop.y + farPier < actorY && actorY < prop.y + nearPier);
    const slices = propDepthSlices(prop);
    assert.ok(slices.some((s) => prop.y + s.depth < actorY));
    assert.ok(slices.some((s) => prop.y + s.depth > actorY));
  }
});

test('the selected middle sample supplies base and accent depth, including edge fallback', () => {
  const surface = (x, y) => ({ m: 'plain', l: 1, c: [70, 90, 100], depth: 10 * x + y,
    acc: { g: glyph('*'), c: [30, 40, 50], depth: 999, edge: true } });
  for (const cutoff of [Infinity, -0.65]) {
    const cells = bakeSurface(0, 0, 0, (x, y) => y < cutoff ? surface(x, y) : null, 1);
    assert.equal(cells.length, 2);
    assert.ok(cells[1].g & LAYER);
    const expected = cutoff === Infinity ? -0.25 * ASPECT * 10 - 0.5 : -0.375 * ASPECT * 10 - 11 / 12;
    near(cells[0].depth, expected);
    assert.equal(cells[1].depth, cells[0].depth, 'accent follows its base, not its own sample/depth');
  }
});

test('generic bakes keep their exact cell shape and visual output without depth', () => {
  const sample = (x, y) => ({ m: 'stone', l: 0.6, c: [70, 90, 100],
    acc: { g: glyph('*'), c: [30, 40, 50], edge: true } });
  const plain = bakeSurface(1, -1, 0, sample, 5);
  const depth = bakeSurface(1, -1, 0, (x, y) => ({ ...sample(x, y), depth: -2.3 }), 5);
  assert.deepEqual(depth.map(({ depth, ...cell }) => cell), plain);
  assert.ok(plain.every((c) => !Object.hasOwn(c, 'depth')));
  assert.equal(propDepthSlices({ cells: plain }), null);
  assert.equal(propDepthSlices({ cells: [] }), null);
  for (const invalid of [undefined, null, '2', Infinity, NaN]) {
    assert.ok(!Object.hasOwn(makeCell(0, 0, glyph('#'), 1, 2, 3, undefined, undefined, undefined, invalid), 'depth'));
  }
});

test('slices cache sorted quarter-row bands and retain base/layer order and cell identity', () => {
  const base = (x, depth) => makeCell(x, -2, glyph('#'), 1, 2, 3, undefined, undefined, undefined, depth);
  const cells = [base(0, -0.13), { ...base(0, 99), g: over(glyph('*')) }, base(1, -0.12),
    { ...base(1), g: over(glyph('+')) }, base(2, 0.13), base(3, 0.36), base(4, -1.12)];
  const prop = { cells };
  const slices = propDepthSlices(prop);
  assert.equal(propDepthSlices(prop), slices);
  assert.equal(propDepthSlices({ cells }), slices, 'cache follows immutable source cells');
  assert.deepEqual(slices.map((s) => s.depth), [-1, -0.25, 0, 0.25]);
  assert.deepEqual(slices.find((s) => s.depth === -0.25).cells, cells.slice(0, 2));
  assert.deepEqual(slices.find((s) => s.depth === 0).cells, cells.slice(2, 4));
  const flattened = slices.flatMap((s) => s.cells);
  assert.equal(flattened.length, cells.length);
  assert.equal(new Set(flattened).size, cells.length);
  assert.ok(flattened.every((c) => cells.includes(c)), 'no copies or rounding of the source depth');
  for (const s of slices) assert.ok(Number.isInteger(s.depth * 4) && !Object.is(s.depth, -0));
  prop.cells = [...cells, base(5, 2.6)];
  assert.notEqual(propDepthSlices(prop), slices, 'replacement bake invalidates cache');
  const replacement = propDepthSlices(prop);
  prop.cells.push(base(6, 3.1));
  assert.notEqual(propDepthSlices(prop), replacement, 'changed length invalidates cache');
  prop.cells = [base(0)];
  assert.equal(propDepthSlices(prop), null);
});

function drawCalls(prop, view, cells, reflected = false) {
  const calls = [];
  const write = (_r, ...args) => calls.push(args);
  drawProp({}, view, prop, write, 0, null, 1, reflected, cells);
  return calls;
}
const canonical = (calls) => calls.map((c) => JSON.stringify(c)).sort();

test('subset drawing reassembles every glyph/background/layer and preserves reflection anchor behavior', () => {
  for (const rotation of [0, 17, -45]) {
    const prop = createProp('stone-gate', 12.75, 90.5, { seed: 19, rotation, scale: 0.75 });
    prop.cells = prop.cells.flatMap((c, i) => i % 11 ? [c] : [c, { ...c, g: over(glyph('*')), br: undefined }]);
    const view = { x0: -100, y0: -100, cols: 400, rows: 400 };
    const whole = drawCalls(prop, view);
    assert.equal(whole.length, prop.cells.length);
    assert.deepEqual(drawCalls(prop, view, prop.cells), whole, 'explicit full bake matches default');
    const slices = propDepthSlices(prop);
    const split = slices.flatMap((s) => drawCalls(prop, view, s.cells));
    assert.deepEqual(canonical(split), canonical(whole));
    // Per-spot order must remain base then accent even after depth sorting.
    const spots = (calls) => {
      const out = new Map();
      for (const c of calls) {
        const key = `${c[0]},${c[1]}`;
        if (!out.has(key)) out.set(key, []);
        out.get(key).push(c);
      }
      return out;
    };
    assert.deepEqual(spots(split), spots(whole));
    assert.deepEqual(drawCalls(prop, view, undefined, true), whole);
    assert.ok(split.every((c) => c[6] === Math.floor(prop.y) - view.y0));
  }
});

test('surface depth never moves cell positions or clips slices when the anchor is outside the view', () => {
  for (const rotation of [17, -45]) for (const scale of [0.25, 3]) {
    const prop = createProp('stone-gate', 192.75, -64.25, { seed: 73, rotation, scale });
    assert.deepEqual(prop.bounds, cellBounds(prop.cells));
    const slices = propDepthSlices(prop);
    const b = prop.bounds;
    const views = [
      { x0: Math.floor(prop.x) + b.minX, y0: Math.floor(prop.y) + b.minY, cols: 1, rows: 1 },
      { x0: Math.floor(prop.x) + b.maxX - 2, y0: Math.floor(prop.y) + b.maxY - 2, cols: 3, rows: 3 },
      { x0: Math.floor(prop.x) - 8, y0: Math.floor(prop.y) - 40 * scale, cols: 16, rows: 10 },
    ];
    for (const view of views) {
      const calls = (subset) => {
        const out = [];
        const record = (kind, args) => {
          const [x, y] = args;
          if (x >= 0 && x < view.cols && y >= 0 && y < view.rows) out.push([kind, ...args]);
        };
        const r = { put: (...args) => record('glyph', args), putBg: (...args) => record('back', args) };
        drawProp(r, view, prop, undefined, 0, null, 1, false, subset);
        return out;
      };
      assert.deepEqual(canonical(slices.flatMap((s) => calls(s.cells))), canonical(calls()));
      const visible = prop.cells.filter((c) => {
        const x = Math.floor(prop.x) + c.dx - view.x0, y = Math.floor(prop.y) + c.dy - view.y0;
        return x >= 0 && x < view.cols && y >= 0 && y < view.rows;
      });
      if (visible.length) {
        assert.equal(propInView(view, prop), true);
        assert.ok(calls().length > 0, 'visible masonry survives conservative prop/row culling');
      }
    }
    for (const slice of slices) for (const c of slice.cells) {
      assert.ok(c.dx >= b.minX && c.dx <= b.maxX && c.dy >= b.minY && c.dy <= b.maxY);
      assert.ok(Math.abs(c.depth - slice.depth) <= 0.125 + 1e-8);
    }
  }
});

test('subset drawing skips fine lookup while default whole-prop drawing keeps it', () => {
  const cells = [makeCell(0, -1, glyph('#'), 1, 2, 3, undefined, undefined, undefined, 0.25)];
  let bakes = 0;
  const prop = withFine({ x: 1.5, y: 2.5, cells, bounds: cellBounds(cells) }, function* () {
    bakes++;
    return [];
  });
  const drawn = [];
  const r = { fine: new Uint8Array(1), put: (...args) => drawn.push(args), putBg() {} };
  const view = { x0: 0, y0: 0, cols: 4, rows: 4 };
  assert.equal(fineBakesPending(), false);
  drawProp(r, view, prop, undefined, 0, null, 1, false, propDepthSlices(prop)[0].cells);
  assert.equal(drawn.length, 1);
  assert.equal(fineBakesPending(), false, 'a subset must not queue a whole-prop fine bake');
  drawProp(r, view, prop);
  assert.equal(fineBakesPending(), true, 'the default draw still requests its fine bake');
  bakeFine();
  assert.equal(bakes, 1);
});
