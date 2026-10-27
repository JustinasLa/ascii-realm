import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { SCALE } from '../src/entities/rig.js';
import { Scenery } from '../src/editor/scenery.js';
import { mulberry32 } from '../src/core/rng.js';
import { FINE } from '../src/render/cells.js';
import { packFine } from '../src/world/fine-bakes.js';
import { PALE_CAP_FORMS, paleCaps, pickForm } from '../src/world/pale-caps.js';
import { Projectiles } from '../src/world/projectiles.js';
import { fineRecipe, fineSource } from '../src/world/prop-art.js';
import { blocks, createProp, drawProp, generateProps, rebuildProp } from '../src/world/props.js';
import { reflector } from '../src/world/reflection.js';
import { GLOSS_DRY, glossByte, normalOf, shadeFactors } from '../src/world/surface-light.js';
import { ASPECT, CHUNK_SIZE, GRASS, WATER, World } from '../src/world/world.js';
import { withLayers } from './helpers/renderer.js';

const finish = (steps) => {
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
};
const fineCells = (prop) => finish(fineRecipe(prop)());
// The clump's own small letters on its dark backdrop.
const body = (cells) => cells.filter((c) => c.br !== undefined);
// Teal gills and stems, against the pale caps.
const isTeal = (c) => c.gg - c.r > 30;
const shapeOf = (seed) => paleCaps(mulberry32(seed), seed);
const formOf = (seed) => pickForm(mulberry32(seed)());

// Seeds whose clump is a lone cap, by its form, so its outline can be
// measured without satellites beside it.
const lone = (() => {
  const out = { dome: [], bell: [], button: [] };
  for (let seed = 1; seed <= 600; seed++) {
    const shape = shapeOf(seed);
    if (shape.caps.length === 1 && out[shape.caps[0].form].length < 6) out[shape.caps[0].form].push(seed);
  }
  return out;
})();

// Width (in row units) and height (in rows) of a set of small cells.
function extent(cells) {
  const xs = cells.map((c) => c.dx);
  const ys = cells.map((c) => c.dy);
  return { w: (Math.max(...xs) - Math.min(...xs) + 1) * ASPECT / FINE, h: (Math.max(...ys) - Math.min(...ys) + 1) / FINE };
}
const mean = (list) => list.reduce((a, b) => a + b, 0) / list.length;

test('pale caps come as a dome, a bell or a button, each with its own proportions', () => {
  const forms = new Set();
  for (let seed = 1; seed <= 80; seed++) forms.add(formOf(seed));
  assert.deepEqual([...forms].sort(), ['bell', 'button', 'dome']);
  assert.equal(pickForm(0), 'dome');
  assert.equal(pickForm(0.5), 'bell');
  assert.equal(pickForm(0.9), 'button');
  assert.equal(pickForm(1), 'button');
  const measured = {};
  for (const [form, seeds] of Object.entries(lone)) {
    assert.ok(seeds.length >= 3, `${form}: ${seeds.length} lone seeds`);
    measured[form] = seeds.map((seed) => {
      const cells = fineCells(createProp('pale-caps', 0.5, 0.5, { seed, variant: 0 }));
      return { seed, ...extent(cells), n: cells.length };
    });
  }
  for (const { seed, w, h } of measured.dome) assert.ok(w / h >= 1.4, `dome ${seed}: ${w} by ${h}`);
  for (const { seed, w, h } of measured.bell) assert.ok(h / w >= 0.8, `bell ${seed}: ${w} by ${h}`);
  assert.ok(mean(measured.bell.map((m) => m.h)) > mean(measured.dome.map((m) => m.h)), 'bells stand taller than domes');
  const count = (form) => mean(measured[form].map((m) => m.n));
  assert.ok(count('button') < count('bell') && count('button') < count('dome'), 'buttons are the smallest');
});

test('a pale cap is rounded: narrow at the crown, widening to the rim, with a clean outline', () => {
  for (const [form, seeds] of Object.entries(lone)) {
    for (const seed of seeds) {
      // At twice the size, so a cap a few small rows tall is not all crown.
      const cells = fineCells(createProp('pale-caps', 0.5, 0.5, { seed, variant: 0, scale: 2 }));
      const cap = cells.filter((c) => !isTeal(c));
      // Row widths of the filled letters, without the cut outline at the ends.
      const rows = new Map();
      for (const c of body(cap)) rows.set(c.dy, (rows.get(c.dy) ?? 0) + 1);
      const widths = [...rows].sort((a, b) => a[0] - b[0]).map(([, n]) => n);
      const widest = Math.max(...widths);
      assert.ok(widths[0] < widest * 0.6, `${form} ${seed}: crown ${widths[0]} of ${widest}`);
      for (let i = 1; i <= widths.indexOf(widest); i++) {
        assert.ok(widths[i] >= widths[i - 1] - 1, `${form} ${seed}: row ${i} narrows`);
      }
      // Partly covered edge cells are cut outline glyphs, without a backdrop.
      assert.ok(cap.filter((c) => c.br === undefined).length >= 2, `${form} ${seed}: outline`);
    }
  }
});

test('a pale cap\'s crown faces the moon, so it is lit above its rim', () => {
  for (const seeds of Object.values(lone)) {
    for (const seed of seeds) {
      const shape = shapeOf(seed);
      const [cap] = shape.caps;
      const crown = shape.sample(cap.cx, cap.oy - cap.sh - cap.ch * 0.9);
      const rim = shape.sample(cap.cx, cap.oy - cap.sh - 0.05);
      assert.equal(crown.m, 'cap');
      assert.equal(rim.m, 'cap');
      assert.ok(crown.l > rim.l + 0.1, `seed ${seed}: crown ${crown.l}, rim ${rim.l}`);
      assert.equal(shape.sample(cap.cx, 0.01), null, 'nothing stands below the base');
    }
  }
});

test('pale caps are pale above and teal below, whatever their seed or variation', () => {
  for (const seed of [...Array.from({ length: 40 }, (_, i) => i + 1), ...Object.values(lone).flat()]) {
    for (const variant of [0, 1]) {
      const cells = body(fineCells(createProp('pale-caps', 0.5, 0.5, { seed, variant })));
      const ys = cells.map((c) => c.dy);
      const top = Math.min(...ys);
      const third = (Math.max(...ys) - top + 1) / 3;
      const colour = (list) => [mean(list.map((c) => c.r)), mean(list.map((c) => c.gg)), mean(list.map((c) => c.b))];
      const [r, g, b] = colour(cells.filter((c) => c.dy < top + third));
      assert.ok(Math.min(r, g, b) >= 120, `seed ${seed}/${variant}: upper ${r} ${g} ${b}`);
      assert.ok((Math.max(r, g, b) - Math.min(r, g, b)) / Math.max(r, g, b) < 0.2, `seed ${seed}/${variant}: upper is pale`);
      // A satellite's pale cap can reach down into the clump's lower third,
      // so a lone cap is held to more teal there than a clump of three.
      const [lr, lg, lb] = colour(cells.filter((c) => c.dy >= top + third * 2));
      const [dg, db] = shapeOf(seed).caps.length === 1 ? [50, 30] : [40, 20];
      assert.ok(lg - lr >= dg && lb - lr >= db, `seed ${seed}/${variant}: lower ${lr} ${lg} ${lb}`);
    }
  }
});

test('the teal underside keeps its own light while the cap is shaded by the moon', () => {
  const brightness = (c) => c.r + c.gg + c.b;
  for (const seed of lone.dome) {
    const cells = body(fineCells(createProp('pale-caps', 0.5, 0.5, { seed, variant: 0 })));
    const teal = cells.filter(isTeal);
    const mid = mean(teal.map((c) => c.dx));
    const byRow = (list, side) => list.filter((c) => (side < 0 ? c.dx < mid : c.dx > mid));
    // Compare row by row, so the stem's fall to the ground cancels out.
    for (const dy of new Set(teal.map((c) => c.dy))) {
      const row = teal.filter((c) => c.dy === dy);
      const [left, right] = [byRow(row, -1), byRow(row, 1)];
      if (!left.length || !right.length) continue;
      const [l, r] = [mean(left.map(brightness)), mean(right.map(brightness))];
      assert.ok(Math.abs(l - r) / Math.max(l, r) < 0.1, `seed ${seed} row ${dy}: ${l} and ${r}`);
    }
    const cap = cells.filter((c) => !isTeal(c));
    const centre = mean(cap.map((c) => c.dx));
    const [l, r] = [mean(byRow(cap, -1).filter((c) => c.dx < centre).map(brightness)),
      mean(cap.filter((c) => c.dx > centre).map(brightness))];
    assert.ok(l > r * 1.15, `seed ${seed}: cap left ${l}, right ${r}`);
  }
});

test('pale caps grow alone or in twos and threes, the main cap the largest', () => {
  const counts = new Set();
  let overlapping = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const { caps } = shapeOf(seed);
    if (seed <= 80) counts.add(caps.length);
    const [main, ...satellites] = caps;
    assert.equal(main.oy, -0.5);
    for (const sat of satellites) {
      assert.ok(['bell', 'button'].includes(sat.form));
      assert.ok(sat.sh + sat.ch <= 0.8 * (main.sh + main.ch) + 1e-9, `seed ${seed}: satellite height`);
      assert.ok(sat.rx <= 0.85 * main.rx + 1e-9, `seed ${seed}: satellite width`);
      assert.equal(sat.oy, sat.front ? 0 : -0.5);
      if (sat.front && Math.abs(sat.ox) - sat.rx < main.rx) overlapping++;
    }
    if (satellites.length === 2) assert.equal(Math.sign(satellites[0].ox), -Math.sign(satellites[1].ox), `seed ${seed}: sides`);
  }
  assert.deepEqual([...counts].sort(), [1, 2, 3]);
  assert.ok(overlapping > 10, `${overlapping} front satellites overlap the main cap`);
});

test('pale caps grow with the scale slider and are never clipped', () => {
  for (const seed of [1, 4, 7]) {
    const heights = [0.5, 1, 2].map((scale) => extent(fineCells(createProp('pale-caps', 0.5, 0.5, { seed, scale, variant: 0 }))).h);
    assert.ok(heights[0] < heights[1] && heights[1] < heights[2], `seed ${seed}: ${heights}`);
  }
  for (let seed = 1; seed <= 40; seed++) {
    const small = createProp('pale-caps', 0.5, 0.5, { seed, scale: 0.25 });
    assert.ok(body(small.cells).length + small.cells.length > 0 && fineCells(small).length > 0, `seed ${seed}: empty at 0.25`);
    const shape = shapeOf(seed);
    const big = fineCells(createProp('pale-caps', 0.5, 0.5, { seed, scale: 3, variant: 0 }));
    // The scaled bake spans these columns and rows; nothing may reach its edge.
    const w = Math.ceil(shape.w * FINE * 3) + 1;
    const top = Math.floor(shape.top * FINE * 3) - 1;
    assert.ok(big.every((c) => Math.abs(c.dx) < w && c.dy > top), `seed ${seed}: clipped`);
  }
});

test('pale caps are the same for their seed wherever they stand, and rebuild in a worker', () => {
  const a = createProp('pale-caps', 10.5, 20.5, { seed: 9 });
  const b = createProp('pale-caps', 10.5, 20.5, { seed: 9 });
  const moved = createProp('pale-caps', -40.5, 3.5, { seed: 9 });
  assert.deepEqual(a.cells, b.cells);
  assert.deepEqual(moved.cells, a.cells);
  assert.notDeepEqual(createProp('pale-caps', 10.5, 20.5, { seed: 10 }).cells, a.cells);
  assert.deepEqual(fineCells(a), fineCells(b));
  assert.equal(a.kind, 'pale-caps');
  assert.equal(a.solid, false);
  const source = fineSource(a);
  assert.deepEqual(structuredClone(source), source);
  assert.deepEqual(packFine(fineCells(rebuildProp(structuredClone(source), true))), packFine(fineCells(a)));
  assert.ok(Object.isFrozen(PALE_CAP_FORMS) && Object.values(PALE_CAP_FORMS).every(Object.isFrozen));
});

test('adding pale caps leaves rocks and generated worlds as they were', () => {
  const rocks = [];
  for (let seed = 1; seed <= 5; seed++) {
    for (const variant of [0, 1]) rocks.push(createProp('rock', 10.5, 10.5, { seed, variant }).cells);
  }
  // Both taken on the code before pale caps.
  assert.equal(createHash('sha256').update(rocks.map((c) => JSON.stringify(c)).join('')).digest('hex').slice(0, 16),
    'e843b0e5d9aff3f4');
  const world = new World(7);
  const generated = createHash('sha256');
  for (let cy = 0; cy <= 2; cy++) {
    for (let cx = 0; cx <= 2; cx++) {
      for (const p of generateProps(world, cx, cy, CHUNK_SIZE)) generated.update(JSON.stringify([p.kind, p.x, p.y, p.cells]));
    }
  }
  assert.equal(generated.digest('hex').slice(0, 16), '9571dfd19b5d8226');
});

test('pale caps are walked through: they block nothing, keep the grass and let arrows pass', () => {
  const world = new World(42);
  const scene = new Scenery(world);
  const x = Math.floor(world.spawn.x) + 30, y = Math.floor(world.spawn.y) + 12;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -6; dx <= 6; dx++) scene.paint(x + dx + 0.5, y + dy + 0.5, 0, GRASS);
  const caps = scene.place('pale-caps', x + 0.5, y + 0.5, { seed: 7, scale: 3 });
  assert.equal(blocks(caps, caps.x, caps.y), false);
  assert.equal(world.isWalkable(caps.x, caps.y), true);
  const bare = () => JSON.stringify([...world.bareGround].map(([key, cells]) => [key, [...cells]]));
  const before = bare();
  world.coverGrass(caps, 1);
  assert.equal(bare(), before, 'the grass stays');
  const arrow = { type: 'projectile', weapon: 'bow', material: 'bronze', x: caps.x - 30, y: caps.y, h: SCALE * 0.75,
    dx: SCALE / ASPECT, dy: 0, projectile: { kind: 'arrow', speed: 12, gravity: 5, lifetime: 3, count: 1 } };
  const projectiles = new Projectiles();
  assert.ok(projectiles.launch(arrow));
  projectiles.update(10, { propsIn: () => [caps] });
  assert.ok(projectiles.landed.every((a) => a.prop !== caps), 'the arrow flies through');
});

test('a torch beside pale caps lights the side of the cap that faces it', () => {
  const flanks = (side) => {
    const cells = body(fineCells(createProp('pale-caps', 0.5, 0.5, { seed: lone.dome[0], variant: 0 }))).filter((c) => !isTeal(c));
    assert.ok(packFine(cells).bump.every(Boolean), 'every cap cell carries a normal');
    const out = { diffuse: 0, spec: 0 };
    const sums = { left: [0, 0], right: [0, 0] };
    const mid = mean(cells.map((c) => c.dx));
    for (const c of cells) {
      shadeFactors(normalOf(Math.round(c.nx * 127) + 128), normalOf(Math.round(c.ny * 127) + 128),
        (side * 6 - c.dx / FINE) * ASPECT, 0.5, 2, glossByte(GLOSS_DRY), out);
      const sum = sums[c.dx < mid ? 'left' : 'right'];
      sum[0] += out.diffuse;
      sum[1]++;
    }
    return [sums.left[0] / sums.left[1], sums.right[0] / sums.right[1]];
  };
  const [westLeft, westRight] = flanks(-1);
  assert.ok(westLeft > westRight * 1.2, `torch west: ${westLeft} over ${westRight}`);
  const [eastLeft, eastRight] = flanks(1);
  assert.ok(eastRight > eastLeft * 1.2, `torch east: ${eastRight} over ${eastLeft}`);
});

test('pale caps on the shore reflect into the pool below', () => {
  const world = new World(42);
  const scene = new Scenery(world);
  const caps = scene.place('pale-caps', 20.5, 9.5, { seed: lone.bell[0] });
  const view = { x0: 0, y0: 0, cols: 40, rows: 24 };
  const mask = new Uint8Array(view.cols * view.rows).fill(GRASS);
  mask.fill(WATER, 10 * view.cols);
  const renderer = withLayers({ cols: view.cols, rows: view.rows, mask, fg: new Float32Array(view.cols * view.rows * 4) });
  drawProp(renderer, view, caps, reflector(0, view));
  let deepest = -1;
  for (let i = 0; i < view.cols * view.rows; i++) if (renderer.fg[i * 4 + 3] > 0) deepest = Math.max(deepest, Math.floor(i / view.cols));
  assert.ok(deepest - 9 >= 3, `reflection reaches ${deepest - 9} rows into the water`);
  assert.ok(renderer.fg.every((v, i) => i % 4 !== 3 || !v || mask[Math.floor(i / 4)] === WATER), 'only onto water');
});

test('pale caps cast no light on what is around them', () => {
  const view = { x0: 0, y0: 0, cols: 40, rows: 24 };
  const caps = createProp('pale-caps', 20.5, 12.5, { seed: lone.dome[0] });
  const scene = () => {
    const r = withLayers({ cols: view.cols, rows: view.rows, mask: new Uint8Array(view.cols * view.rows).fill(GRASS),
      backs: [], putBg(sx, sy) { this.backs.push(sy * view.cols + sx); } });
    for (let i = 0; i < r.fg.length; i++) r.fg[i] = (i * 37) % 200;
    return r;
  };
  const before = scene();
  const after = scene();
  drawProp(after, view, caps);
  const own = new Set(caps.cells.map((c) => (Math.floor(caps.y) + c.dy) * view.cols + Math.floor(caps.x) + c.dx));
  for (let i = 0; i < view.cols * view.rows; i++) {
    if (own.has(i)) continue;
    for (let k = 0; k < 4; k++) assert.equal(after.fg[i * 4 + k], before.fg[i * 4 + k], `cell ${i}`);
  }
  assert.ok(after.backs.length && after.backs.every((i) => own.has(i)), 'backdrops only behind its own letters');
  assert.ok(own.size > 10);
});
