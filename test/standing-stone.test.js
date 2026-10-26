import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { SCALE } from '../src/entities/rig.js';
import { Scenery } from '../src/editor/scenery.js';
import { FINE } from '../src/render/cells.js';
import { packFine } from '../src/world/fine-bakes.js';
import { Projectiles } from '../src/world/projectiles.js';
import { fineRecipe } from '../src/world/prop-art.js';
import { createProp, drawProp, generateProps, isStoneProp } from '../src/world/props.js';
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
// The stone's own small letters: the cells drawn on its dark backdrop, not
// its contact shadow or the pebbles at its foot.
const body = (cells) => cells.filter((c) => c.br !== undefined);
const digest = (values) => createHash('sha256').update(JSON.stringify(values)).digest('hex').slice(0, 16);

test('a standing stone is tall and slender, and narrows from its foot to its crown', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const stone = createProp('standing-stone', 0.5, 0.5, { seed });
    const cells = body(stone.cells);
    const xs = cells.map((c) => c.dx);
    const ys = cells.map((c) => c.dy);
    const height = Math.max(...ys) - Math.min(...ys) + 1;
    const width = (Math.max(...xs) - Math.min(...xs) + 1) * ASPECT;
    assert.ok(height >= 7, `seed ${seed}: ${height} rows tall`);
    assert.ok(height >= 2.2 * width, `seed ${seed}: ${height} rows over ${width}`);
    // Small rows of the fine bake, from the foot up.
    const rows = new Map();
    for (const c of body(fineCells(stone))) rows.set(c.dy, (rows.get(c.dy) ?? 0) + 1);
    const widths = [...rows].sort((a, b) => b[0] - a[0]).map(([, n]) => n);
    for (let i = 1; i < widths.length; i++) assert.ok(widths[i] <= widths[i - 1] + 1, `seed ${seed}: row ${i} widens`);
    assert.ok(widths.at(-1) < widths[0] / 2, `seed ${seed}: crown ${widths.at(-1)}, foot ${widths[0]}`);
  }
});

test('a standing stone is the same for its seed wherever it stands', () => {
  const a = createProp('standing-stone', 10.5, 20.5, { seed: 9 });
  const b = createProp('standing-stone', 10.5, 20.5, { seed: 9 });
  const moved = createProp('standing-stone', -40.5, 3.5, { seed: 9 });
  assert.deepEqual(a.cells, b.cells);
  assert.deepEqual(moved.cells, a.cells);
  assert.notDeepEqual(createProp('standing-stone', 10.5, 20.5, { seed: 10 }).cells, a.cells);
  assert.deepEqual(fineCells(a), fineCells(b));
  assert.equal(a.kind, 'standing-stone');
  assert.equal(a.solid, true);
  assert.ok(isStoneProp(a) && isStoneProp({ kind: 'rock' }) && !isStoneProp({ kind: 'tree' }));
});

test('adding standing stones leaves rocks and generated worlds as they were', () => {
  const rocks = [];
  for (let seed = 1; seed <= 5; seed++) {
    for (const variant of [0, 1]) rocks.push(createProp('rock', 10.5, 10.5, { seed, variant }).cells);
  }
  // Both taken on the code before standing stones.
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

test('a standing stone\'s small letters carry normals that face out of either flank', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const cells = body(fineCells(createProp('standing-stone', 0.5, 0.5, { seed })));
    const packed = packFine(cells);
    assert.ok(packed.bump.reduce((a, b) => a + b, 0) >= cells.length * 0.6, `seed ${seed}: normals`);
    const xs = cells.map((c) => c.dx);
    const [lo, hi] = [Math.min(...xs), Math.max(...xs)];
    const third = (hi - lo + 1) / 3;
    const mean = (list) => list.reduce((a, c) => a + c.nx, 0) / list.length;
    const left = mean(cells.filter((c) => c.dx < lo + third));
    const right = mean(cells.filter((c) => c.dx >= hi + 1 - third));
    assert.ok(left < right, `seed ${seed}: left ${left}, right ${right}`);
  }
});

test('a torch beside a standing stone lights the flank that faces it', () => {
  // A light low on the ground, six cells to one side of the foot, as
  // renderer.lightFineLit sees it.
  const flanks = (side) => {
    const cells = body(fineCells(createProp('standing-stone', 0.5, 0.5, { seed: 3 })));
    const out = { diffuse: 0, spec: 0 };
    const sums = { left: [0, 0], right: [0, 0] };
    const mid = cells.reduce((a, c) => a + c.dx, 0) / cells.length;
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
  assert.ok(westLeft > westRight * 1.3, `torch west: ${westLeft} over ${westRight}`);
  const [eastLeft, eastRight] = flanks(1);
  assert.ok(eastRight > eastLeft * 1.3, `torch east: ${eastRight} over ${eastLeft}`);
});

// A pool painted on open grass well away from spawn, its north shore row
// at y0 - 1.
function pool(world, scene, x0, y0) {
  for (let y = y0; y < y0 + 6; y++) for (let x = x0; x < x0 + 16; x++) scene.paint(x + 0.5, y + 0.5, 0, WATER);
}

test('a standing stone is damp only where it stands in water, and solid at its foot', () => {
  const world = new World(42);
  const scene = new Scenery(world);
  const x0 = world.spawn.x + 30, y0 = world.spawn.y + 12;
  pool(world, scene, Math.floor(x0), Math.floor(y0));
  const inPool = scene.place('standing-stone', Math.floor(x0) + 8.5, Math.floor(y0) + 2.5, { seed: 3 });
  assert.equal(inPool.damp, true);
  const shore = scene.place('standing-stone', Math.floor(x0) + 3.5, Math.floor(y0) - 0.5, { seed: 4 });
  assert.equal(world.typeAt(Math.floor(shore.x), Math.floor(shore.y)), GRASS);
  assert.ok(world.byWater(shore), 'a rock there would be damp');
  assert.equal(shore.damp, undefined);
  assert.equal(world.isWalkable(shore.x, shore.y), false);
  assert.equal(world.isWalkable(shore.x - 3, shore.y), true);
  assert.equal(world.isWalkable(shore.x + 3, shore.y), true);
});

test('a standing stone dampens and dries as water is painted and cleared beneath it', () => {
  const world = new World(42);
  const scene = new Scenery(world);
  const x = Math.floor(world.spawn.x) + 30, y = Math.floor(world.spawn.y) + 12;
  const stone = scene.place('standing-stone', x + 0.5, y + 0.5, { seed: 3 });
  const rock = scene.place('rock', x + 8.5, y + 0.5, { seed: 3 });
  assert.equal(world.typeAt(x, y), GRASS);
  assert.equal(stone.damp, undefined);
  assert.equal(rock.damp, undefined);
  scene.paint(x + 0.5, y + 0.5, 0, WATER);
  assert.equal(stone.damp, true);
  // Water beside the stone's foot leaves it as it was.
  scene.paint(x + 1.5, y + 0.5, 0, WATER);
  scene.paint(x + 8.5, y + 0.5, 0, WATER);
  assert.equal(rock.damp, undefined, 'a rock keeps the dampness it was placed with');
  scene.paint(x + 0.5, y + 0.5, 0, GRASS);
  assert.equal(stone.damp, undefined);
  assert.equal(world.typeAt(x + 1, y), WATER);
  // Undo and redo rebuild the stone from the scene, damp as its cell is now.
  assert.equal(scene.undo(), true);
  assert.equal(world.addedProps.get(stone.id).damp, true);
  assert.equal(scene.redo(), true);
  assert.equal(world.addedProps.get(stone.id).damp, undefined);
});

test('a standing stone above the view still reflects into the water at its top', () => {
  const world = new World(42);
  const scene = new Scenery(world);
  const view = { x0: 0, y0: 0, cols: 40, rows: 24 };
  const stone = scene.place('standing-stone', 20.5, -3.5, { seed: 5 });
  const queried = world.propsInView(view).find(({ id }) => id === stone.id);
  assert.ok(queried, 'the stone above the view stays queryable');
  const mask = new Uint8Array(view.cols * view.rows).fill(WATER);
  const direct = withLayers({ cols: view.cols, rows: view.rows, mask, fg: new Float32Array(view.cols * view.rows * 4) });
  drawProp(direct, view, queried);
  assert.ok(direct.fg.every((v, i) => i % 4 !== 3 || !v), 'the stone itself is off screen');
  const renderer = withLayers({ cols: view.cols, rows: view.rows, mask, fg: new Float32Array(view.cols * view.rows * 4) });
  drawProp(renderer, view, queried, reflector(0, view));
  assert.ok(renderer.fg.some((v, i) => i % 4 === 3 && v > 0), 'its reflection reaches the visible water');
});

test('a standing stone on the shore reflects its full height into the pool below', () => {
  const world = new World(42);
  const scene = new Scenery(world);
  const stone = scene.place('standing-stone', 20.5, 9.5, { seed: 5 });
  const view = { x0: 0, y0: 0, cols: 40, rows: 24 };
  // Water from the row below the base down.
  const mask = new Uint8Array(view.cols * view.rows).fill(GRASS);
  mask.fill(WATER, 10 * view.cols);
  const renderer = withLayers({ cols: view.cols, rows: view.rows, mask, fg: new Float32Array(view.cols * view.rows * 4) });
  drawProp(renderer, view, stone, reflector(0, view));
  let deepest = -1;
  for (let i = 0; i < view.cols * view.rows; i++) if (renderer.fg[i * 4 + 3] > 0) deepest = Math.max(deepest, Math.floor(i / view.cols));
  assert.ok(deepest - 9 >= 5, `reflection reaches ${deepest - 9} rows into the water`);
  assert.ok(renderer.fg.every((v, i) => i % 4 !== 3 || !v || mask[Math.floor(i / 4)] === WATER), 'only onto water');
});

test('arrows stop on a standing stone, one at a time or a pair from a double shot', () => {
  const stone = createProp('standing-stone', 40.5, 20.5, { seed: 2 });
  const world = { propsIn: () => [stone] };
  const arrow = (count) => ({ type: 'projectile', weapon: 'bow', material: 'bronze', x: 10, y: 20.5, h: SCALE * 0.75,
    dx: SCALE / ASPECT, dy: 0, projectile: { kind: 'arrow', speed: 12, gravity: 5, lifetime: 3, count } });
  const projectiles = new Projectiles();
  assert.ok(projectiles.launch(arrow(1)));
  projectiles.update(10, world);
  assert.equal(projectiles.landed.at(-1).prop, stone);
  assert.ok(projectiles.landed.at(-1).x < stone.x);
  const pair = new Projectiles();
  assert.ok(pair.launch(arrow(2)));
  assert.equal(pair.list.length, 2);
  pair.update(10, world);
  assert.deepEqual(pair.landed.map((a) => a.prop), [stone, stone]);
});
