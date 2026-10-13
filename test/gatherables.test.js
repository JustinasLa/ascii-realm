import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateLooseItems, generateResources } from '../src/world/gatherables.js';
import { rockTypeAt } from '../src/world/geology.js';
import { ASPECT, CHUNK_SIZE, DIRT, GRASS, SHORE, STONE, WATER, World } from '../src/world/world.js';

function fixture(seed = 1, typeAt = () => GRASS, props = [], spawn = { x: 10000.5, y: 10000.5 }) {
  return {
    seed, spawn,
    typeAt(x, y) { return typeAt(Math.floor(x), Math.floor(y)); },
    propsIn(x0, y0, x1, y1) {
      return props.filter(p => {
        // Allow a fixture prop to retain an old jittered source chunk so
        // tree-associated items also cover bases across an ownership edge.
        const cx = p.cx ?? Math.floor(p.x / CHUNK_SIZE);
        const cy = p.cy ?? Math.floor(p.y / CHUNK_SIZE);
        return cx >= Math.floor(x0 / CHUNK_SIZE) && cx <= Math.floor(x1 / CHUNK_SIZE)
          && cy >= Math.floor(y0 / CHUNK_SIZE) && cy <= Math.floor(y1 / CHUNK_SIZE);
      });
    },
  };
}

function snapshot(world, chunks) {
  return new Map(chunks.map(([cx, cy]) => [`${cx},${cy}`,
    { items: generateLooseItems(world, cx, cy), resources: generateResources(world, cx, cy) }]));
}

test('real-world gatherables are deterministic regardless of chunk exploration order', () => {
  const first = new World(37);
  const second = new World(37);
  const cx = Math.floor(first.spawn.x / CHUNK_SIZE);
  const cy = Math.floor(first.spawn.y / CHUNK_SIZE);
  const chunks = [[cx, cy], [cx - 1, cy], [cx, cy - 1], [cx + 1, cy + 1]];
  const forward = snapshot(first, chunks);
  const backward = snapshot(second, [...chunks].reverse());
  for (const [key, value] of forward) {
    assert.deepEqual(value, backward.get(key), key);
    const [x, y] = key.split(',').map(Number);
    assert.deepEqual(value.items, generateLooseItems(first, x, y), 'a query does not consume generation RNG');
  }
  assert.notDeepEqual(generateLooseItems(fixture(37), 0, 0), generateLooseItems(fixture(38), 0, 0));
});

test('geology is continuous, seed-dependent, and independent of generated chunks', () => {
  const world = fixture(12);
  const types = new Set();
  let changed = 0;
  for (let y = -1500; y <= 1500; y += 250) {
    for (let x = -1500; x <= 1500; x += 250) {
      const rock = rockTypeAt(world, x, y);
      types.add(rock);
      assert.equal(rock, rockTypeAt(fixture(12), x, y));
      assert.equal(rockTypeAt(world, x - 0.001, y), rockTypeAt(world, x + 0.001, y),
        'a chunk boundary does not reset a rock layer');
      changed += rock !== rockTypeAt(fixture(13), x, y);
    }
  }
  assert.deepEqual([...types].sort(), ['basalt', 'granite', 'limestone']);
  assert.ok(changed > 20);
});

test('loose items respect dry, reachable terrain and their local rock layer', () => {
  const typeAt = (x, y) => y >= 60 ? WATER : y >= 54 ? SHORE : x >= 48 ? STONE : x >= 32 ? DIRT : GRASS;
  const tree = { kind: 'tree', x: 20.5, y: 24.5, footW: 2.4, footH: 1.2 };
  const found = new Set();
  for (let seed = 1; seed <= 12; seed++) {
    const world = fixture(seed, typeAt, [tree]);
    for (const entry of generateLooseItems(world, 0, 0)) {
      found.add(entry.id);
      for (const offset of [-1.2, 0, 1.2]) {
        assert.notEqual(world.typeAt(entry.x + offset, entry.y), WATER, entry.id);
        assert.ok(((entry.x + offset - tree.x) / tree.footW) ** 2
          + ((entry.y - tree.y) / tree.footH) ** 2 >= 1, 'the player can reach the item');
      }
      if (['granite', 'basalt', 'limestone'].includes(entry.id)) {
        assert.equal(entry.id, rockTypeAt(world, entry.x, entry.y));
      }
      if (entry.id === 'berries' || entry.id === 'mushroom') assert.equal(world.typeAt(entry.x, entry.y), GRASS);
      if (entry.id === 'clay' || entry.id === 'reed') assert.ok(entry.y >= 57 && entry.y < 60, 'water-edge items sit on land near water');
      if (entry.id === 'stick') assert.ok(Math.hypot((entry.x - tree.x) * ASPECT, entry.y - tree.y) < 6);
      assert.equal(entry.pickupAfter, 0);
      assert.equal(entry.count, 1);
      assert.ok(Number.isFinite(entry.phase));
    }
    for (const node of generateResources(world, 0, 0)) {
      assert.equal(world.typeAt(node.x, node.y), GRASS);
      assert.equal(node.harvested, false);
    }
  }
  for (const id of ['flint', 'berries', 'mushroom', 'reed', 'clay', 'stick']) assert.ok(found.has(id), id);
});

test('tree sticks use their actual owning chunk across positive and negative edges', () => {
  const trees = [
    { kind: 'tree', x: 72.5, y: -0.5, cx: 0, cy: -1, footW: 2.4, footH: 1.2 },
    { kind: 'tree', x: -0.5, y: -64.5, footW: 2.4, footH: 1.2 },
  ];
  const world = fixture(6, () => GRASS, trees);
  const all = [];
  for (let cy = -2; cy <= 0; cy++) {
    for (let cx = -1; cx <= 1; cx++) {
      const items = generateLooseItems(world, cx, cy);
      const nodes = generateResources(world, cx, cy);
      assert.ok(items.length <= 72 && nodes.length <= 27, 'generation has bounded density');
      for (const entry of [...items, ...nodes]) {
        assert.equal(Math.floor(entry.x / CHUNK_SIZE), cx);
        assert.equal(Math.floor(entry.y / CHUNK_SIZE), cy);
      }
      all.push(...items);
    }
  }
  const sticks = all.filter(p => p.id === 'stick');
  assert.ok(sticks.length >= 2);
  assert.ok(sticks.some(p => p.x >= 64), 'a stick around the old east-overflow tree belongs to the next chunk');
  assert.ok(sticks.some(p => p.x < 0 && p.y < -64), 'negative edges use floor ownership');
  assert.equal(new Set(all.map(p => p.uid)).size, all.length, 'no cross-border duplicates');
  assert.equal(new Set(all.map(p => `${p.x},${p.y}`)).size, all.length, 'one loose item per cell');
});

test('spawn clearing has discoverable starter finds and harvest nodes without items underfoot', () => {
  const world = fixture(1, () => GRASS, [], { x: 0.5, y: 0.5 });
  const chunks = [[-1, -1], [-1, 0], [0, -1], [0, 0]];
  const generated = [...snapshot(world, chunks).values()];
  const items = generated.flatMap(p => p.items);
  const nodes = generated.flatMap(p => p.resources);
  const nearbyItems = items.filter(p => Math.hypot((p.x - world.spawn.x) * ASPECT, p.y - world.spawn.y) < 17);
  const nearbyNodes = nodes.filter(p => Math.hypot((p.x - world.spawn.x) * ASPECT, p.y - world.spawn.y) < 17);
  for (const id of ['flint', 'berries', 'mushroom']) {
    assert.ok(nearbyItems.some(p => p.id === id), `${id} is discoverable at spawn`);
  }
  assert.ok(nearbyItems.some(p => ['granite', 'basalt', 'limestone'].includes(p.id)));
  assert.ok(nearbyNodes.some(p => p.kind === 'grass'));
  assert.ok(nearbyNodes.some(p => p.kind === 'bush'));
  assert.ok([...items, ...nodes].every(p => Math.hypot((p.x - world.spawn.x) * ASPECT, p.y - world.spawn.y) >= 6));
});

test('water-only chunks produce no loose items or harvest nodes', () => {
  const world = fixture(1, () => WATER,
    [{ kind: 'tree', x: -0.5, y: 0.5, footW: 2.4, footH: 1.2 }], { x: 0.5, y: 0.5 });
  for (const [cx, cy] of [[0, 0], [-1, 0], [0, -1]]) {
    assert.deepEqual(generateLooseItems(world, cx, cy), []);
    assert.deepEqual(generateResources(world, cx, cy), []);
  }
});
