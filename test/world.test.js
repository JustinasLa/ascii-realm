import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blocks } from '../src/world/props.js';
import { GRASS, World } from '../src/world/world.js';

test('wide rocks block movement across either side of a chunk boundary', () => {
  const world = new World(1);
  const cases = [
    { cx: -9, cy: -12, propX: -514.5, y: -746.5, x: -508 },
    { cx: 8, cy: -12, propX: 513.5, y: -731.5, x: 505.25 },
  ];
  for (const { cx, cy, propX, x, y } of cases) {
    const rock = world.propsOf(cx, cy).find((p) => p.kind === 'rock' && p.x === propX && p.y === y);
    assert.ok(rock, `expected seeded rock at ${propX},${y}`);
    assert.equal(world.typeAt(x, y), GRASS);
    assert.equal(blocks(rock, x, y), true);
    assert.equal(world.isWalkable(x, y), false, `rock must block ${x},${y}`);
  }
});

test('queries include procedural props jittered beyond their source chunk', () => {
  const world = new World(1);
  const tree = world.propsOf(-8, -8).find((p) => p.kind === 'tree' && p.x === -437.5 && p.y === -492.5);
  assert.ok(tree, 'expected seeded tree east of its source chunk');
  assert.ok(world.propsIn(tree.x, tree.y, tree.x, tree.y).includes(tree));
  assert.equal(world.typeAt(-439.5, -492.5), GRASS);
  assert.equal(blocks(tree, -439.5, -492.5), true);
  assert.equal(world.isWalkable(-439.5, -492.5), false);
});

test('distant chunks retain distinct terrain and coordinates', () => {
  const coordinates = [[200, 65536], [201, 0]];
  for (const order of [coordinates, [...coordinates].reverse()]) {
    const world = new World(1);
    const chunks = order.map(([cx, cy]) => world.chunk(cx, cy));
    assert.ok(chunks[0] !== chunks[1], 'distinct coordinates must not share a chunk');
    chunks.forEach((chunk, i) => {
      assert.deepEqual([chunk.cx, chunk.cy], order[i]);
      assert.equal(world.chunk(...order[i]), chunk);
    });
  }
});
