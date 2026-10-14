import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mulberry32 } from '../src/core/rng.js';
import { GLYPHS } from '../src/render/glyphs.js';
import { DEADWOOD_CONDITIONS, DEADWOOD_REACH_X, DEADWOOD_REACH_Y,
  deadwoodInClearing, makeDeadwood } from '../src/world/deadwood.js';
import { blocks, deadwoodConditionAt, drawProp, generateProps, nearWater } from '../src/world/props.js';
import { makeTree } from '../src/world/trees.js';
import { ASPECT, GRASS, WATER, World } from '../src/world/world.js';

const remains = (condition, x = 63.5, y = 24.5) =>
  makeDeadwood(x, y, mulberry32(9281), { condition, seed: 42 });

test('trunk girth varies independently of height and stays seeded', () => {
  const tree = girth => makeTree(100.5, 300.5, mulberry32(42), { species: 'oak', seed: 42, girth });
  const thin = tree(0.6), thick = tree(2);
  assert.equal(thin.height, thick.height);
  assert.ok(thick.footW > thin.footW * 3);
  const lowerWood = p => p.cells.filter(c => !c.foliage && c.dy > -20).length;
  assert.ok(lowerWood(thick) > lowerWood(thin) * 1.5);
  assert.deepEqual(tree(2), thick);
  const variants = new Set();
  for (let i = 0; i < 8; i++) {
    const options = { species: 'oak', seed: i };
    const a = makeTree(100.5, 300.5, mulberry32(42), options);
    const b = makeTree(100.5, 300.5, mulberry32(42), options);
    assert.equal(a.girth, b.girth);
    assert.ok(a.girth >= 0.6 && a.girth <= 2);
    variants.add(a.girth.toFixed(2));
  }
  assert.ok(variants.size >= 6, 'different seeds produce noticeably different girths');
});

test('fallen, broken, cut and gnawed trees have distinct stable wood sprites', () => {
  const silhouettes = new Set();
  for (const condition of DEADWOOD_CONDITIONS) {
    const p = remains(condition);
    assert.deepEqual(remains(condition), p);
    assert.equal(p.kind, 'deadwood');
    assert.equal(p.condition, condition);
    assert.ok(p.cells.length > 10);
    silhouettes.add(JSON.stringify(p.cells.map(c => [c.dx, c.dy])));
    for (const c of p.cells) {
      assert.equal(c.foliage, false);
      assert.equal(c.flex, 0);
      assert.ok(c.g > 0 && c.g < [...GLYPHS].length);
      assert.ok([c.r, c.gg, c.b].every(v => Number.isFinite(v) && v >= 0 && v <= 255));
      assert.ok(c.dx >= p.bounds.minX && c.dx <= p.bounds.maxX);
      assert.ok(c.dy >= p.bounds.minY && c.dy <= p.bounds.maxY);
    }
    const writes = t => {
      const cells = [];
      drawProp({}, { x0: 0, y0: 0 }, p, (_r, ...cell) => cells.push(cell), t);
      return cells;
    };
    assert.deepEqual(writes(0), writes(18), 'dead wood is stationary in the wind');
    for (const s of p.colliders) {
      assert.ok(Math.max(Math.abs(s.ax), Math.abs(s.bx)) / ASPECT + s.r / ASPECT < DEADWOOD_REACH_X);
      assert.ok(Math.max(Math.abs(s.ay), Math.abs(s.by)) + s.r < DEADWOOD_REACH_Y);
    }
  }
  assert.equal(silhouettes.size, 4);
  const log = remains('fallen');
  assert.ok(log.bounds.maxX - log.bounds.minX > 40, 'fallen wood lies across the ground');
  assert.ok(remains('snag').height > remains('stump').height * 2);
});

test('a fallen log blocks its far end across chunk boundaries', () => {
  const p = remains('fallen');
  const s = p.colliders[0];
  const far = { x: p.x + s.bx / ASPECT, y: p.y + s.by };
  assert.ok(far.x >= 64, 'far end reaches the neighboring chunk');
  const world = new World(42);
  world.typeAt = () => GRASS;
  world.propsOf = (cx, cy) => cx === 0 && cy === 0 ? [p] : [];
  assert.equal(blocks(p, far.x, far.y), true);
  assert.equal(world.isWalkable(far.x, far.y), false);
  assert.equal(world.isWalkable(far.x, far.y + 12), true, 'grass beside the log stays walkable');
  assert.equal(deadwoodInClearing(p, { x: far.x + 30 / ASPECT, y: far.y }), true,
    'clearing test checks endpoints as well as the owning base');
  assert.equal(deadwoodInClearing(p, { x: p.x, y: p.y + 100 }), false);
});

test('beaver damage is selected only near water while dry forests retain other remains', () => {
  const dry = { seed: 42, typeAt: () => GRASS }, wet = { seed: 42, typeAt: () => WATER };
  const found = new Set();
  for (let x = -100; x < 100; x++) {
    assert.notEqual(deadwoodConditionAt(dry, x, 20), 'beaver');
    const condition = deadwoodConditionAt(wet, x, 20);
    if (condition) found.add(condition);
  }
  assert.deepEqual(found, new Set(DEADWOOD_CONDITIONS));
  const world = new World(42);
  for (let cy = -2; cy <= 2; cy++) for (let cx = -2; cx <= 2; cx++) {
    for (const p of generateProps(world, cx, cy, 64).filter(p => p.kind === 'deadwood')) {
      assert.equal(deadwoodInClearing(p, world.spawn), false);
      if (p.condition === 'beaver') assert.ok(nearWater(world, Math.floor(p.x), Math.floor(p.y)));
    }
  }
});
