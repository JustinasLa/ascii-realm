import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Harvesting } from '../src/world/harvesting.js';
import { GroundItems } from '../src/world/items.js';
import { TREE_HITS, World } from '../src/world/world.js';

// Visits enough distant chunks that the first ones are dropped from memory.
function evict(world, cx, cy) {
  for (let i = 0; i < world.maxChunks + 4; i++) world.chunk(cx + 50 + i, cy + 50);
  assert.equal(world.chunks.has(`${cx},${cy}`), false, 'the chunk was dropped from memory');
}

test('felled trees stay felled after their chunk is unloaded and generated again', () => {
  const world = new World(7, { maxChunks: 16 });
  let found = null;
  for (let cx = -3; cx <= 3 && !found; cx++) {
    const tree = world.propsOf(cx, 2).find((p) => p.kind === 'tree');
    if (tree) found = { cx, tree };
  }
  assert.ok(found, 'the fixture has a tree');
  for (let i = 0; i < TREE_HITS; i++) world.hitTree(found.tree);
  assert.equal(found.tree.chopped, true);
  evict(world, found.cx, 2);
  const again = world.propsOf(found.cx, 2).find((p) => p.id === found.tree.id);
  assert.notEqual(again, found.tree, 'the prop was generated again');
  assert.equal(again.chopped, true);
});

test('taken loot and gathered plants stay gone after their chunk is unloaded', () => {
  const world = new World(7, { maxChunks: 16 });
  const items = new GroundItems(world);
  const harvesting = new Harvesting(world, items);
  let cx = 0;
  let loose = items.of(cx, 0);
  while (!loose.length && cx < 20) loose = items.of(++cx, 0);
  assert.ok(loose.length > 0, 'the fixture has loose items');
  const taken = loose[0];
  assert.equal(items.remove(taken), true);
  let plant = null;
  for (let x = cx; x < cx + 20 && !plant; x++) plant = harvesting.resourcesOf(x, 0).find((n) => !n.harvested) ?? null;
  assert.ok(plant, 'the fixture has a plant');
  harvesting.harvest(plant);
  const plantChunk = [Math.floor(plant.x / 64), Math.floor(plant.y / 64)];
  evict(world, cx, 0);
  assert.equal(items.of(cx, 0).some((item) => item.uid === taken.uid), false);
  const regrown = harvesting.resourcesOf(...plantChunk)
    .find((n) => n.kind === plant.kind && Math.floor(n.x) === Math.floor(plant.x) && Math.floor(n.y) === Math.floor(plant.y));
  assert.equal(regrown.harvested, true);
});
