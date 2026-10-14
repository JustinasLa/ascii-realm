import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProp } from '../src/world/props.js';
import { GRASS, World } from '../src/world/world.js';

test('travelling evicts terrain, and revisiting regenerates identical terrain and props', () => {
  const world = new World(19, 16);
  const props = world.propsOf(-2, 1).map((p) => ({ x: p.x, y: p.y, cells: p.cells }));
  // Placing props clears the grass under them; the chunk regrows lazily.
  const original = world.chunk(-2, 1);
  for (let i = 0; i < 48; i++) world.chunk(i + 10, 10);
  assert.ok(world.chunks.size <= 16);
  const revisited = world.chunk(-2, 1);
  assert.notEqual(revisited, original);
  for (const name of ['type', 'elev', 'shade', 'rnd', 'grassHeight', 'grassStyle', 'grassDensity', 'blades']) {
    assert.deepEqual(revisited[name], original[name]);
  }
  assert.deepEqual(world.propsOf(-2, 1).map((p) => ({ x: p.x, y: p.y, cells: p.cells })), props);
});

test('distant chunk coordinates do not alias and recently used chunks survive eviction', () => {
  const world = new World(1, 16);
  assert.notEqual(world.chunk(0, 65536), world.chunk(1, 0));
  const active = world.chunk(0, 0);
  for (let i = 0; i < 32; i++) {
    world.chunk(0, 0);
    world.chunk(i + 20, 20);
  }
  assert.equal(world.chunk(0, 0), active);
  assert.ok(world.chunks.size <= 16);
});

test('no grass grows through a placed rock, and it grows back when the rock is removed', () => {
  const world = new World(1);
  const { x, y } = world.spawn;
  const { c, i } = world.locate(Math.floor(x), Math.floor(y));
  assert.equal(c.type[i], GRASS);
  const height = c.grassHeight[i];
  assert.ok(height > 0);
  const rock = createProp('rock', Math.floor(x) + 0.5, Math.floor(y) + 0.5, { seed: 7 });
  rock.id = 'test-rock';
  world.addProp(rock);
  assert.equal(c.grassHeight[i], 0);
  world.deleteProp('test-rock');
  assert.equal(c.grassHeight[i], height);
});
