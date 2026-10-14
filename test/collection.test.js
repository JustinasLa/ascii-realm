import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Collection } from '../src/inventory/collection.js';
import { Inventory } from '../src/inventory/inventory.js';
import { GroundItems } from '../src/world/items.js';
import { Harvesting } from '../src/world/harvesting.js';
import { ASPECT, GRASS, WATER } from '../src/world/world.js';

function setup({ capacity = 40, isWalkable = () => true, typeAt = () => GRASS } = {}) {
  const chunks = new Map();
  const world = {
    isWalkable, typeAt, propsIn: () => [],
    chunk(cx, cy) {
      const key = `${cx},${cy}`;
      if (!chunks.has(key)) chunks.set(key, { cx, cy, items: [], resources: [] });
      return chunks.get(key);
    },
  };
  const inventory = new Inventory({ starter: false, capacity });
  const ground = new GroundItems(world);
  const collection = new Collection(world, inventory, ground);
  const player = { x: 0.5, y: 0.5, heading: 0, air: 0, windUp: -1, walk: 1, combat: { busy: false } };
  return { world, inventory, ground, collection, player };
}

const bagCount = (inventory, id) => inventory.slots.reduce((sum, stack) => sum + (stack?.id === id ? stack.count : 0), 0);
const metricDistance = (a, b) => Math.hypot((a.x - b.x) * ASPECT, a.y - b.y);

test('walking over a stack transfers every accepted item and emits one collection event', () => {
  const { inventory, ground, collection, player } = setup();
  const item = ground.add('ironOre', 4, player.x + 1, player.y);
  collection.update(0, player);
  assert.equal(bagCount(inventory, 'ironOre'), 4);
  assert.deepEqual(ground.of(0, 0), []);
  assert.deepEqual(collection.events, [{ type: 'pickup', id: 'ironOre', count: 4, x: item.x, y: item.y }]);
  collection.update(1, player);
  assert.equal(collection.events.length, 1, 'a removed stack cannot trigger another pickup');
});

test('a full bag leaves nearby loot stationary and E reports full without pickup events', () => {
  const { inventory, ground, collection, player } = setup({ capacity: 1000 });
  inventory.slots = Array.from({ length: 24 }, () => ({ id: 'longbow', count: 1 }));
  const item = ground.add('ironOre', 5, player.x + 4 / ASPECT, player.y);
  const before = { ...item };
  collection.update(2, player);
  assert.deepEqual(item, before);
  assert.equal(collection.interact(player).status, 'full');
  assert.equal(item.count, 5);
  assert.strictEqual(ground.of(0, 0)[0], item);
  assert.equal(collection.events.length, 0);
  assert.equal(inventory.events.length, 0);
  assert.match(collection.prompt(player), /Inventory full/);
});

test('weight-limited partial pickup conserves the remaining count until more room is available', () => {
  const { inventory, ground, collection, player } = setup({ capacity: 1.5 });
  const item = ground.add('ironOre', 7, player.x, player.y);
  collection.update(0, player);
  assert.equal(bagCount(inventory, 'ironOre'), 2);
  assert.equal(item.count, 5);
  assert.equal(bagCount(inventory, 'ironOre') + item.count, 7);
  assert.equal(collection.events[0].count, 2);
  const before = { ...item };
  collection.update(1, player);
  assert.deepEqual(item, before);
  assert.equal(collection.events.length, 1);
  inventory.capacity = 20;
  const picked = collection.interact(player);
  assert.equal(picked.status, 'picked');
  assert.equal(picked.count, 5);
  assert.equal(bagCount(inventory, 'ironOre'), 7);
  assert.deepEqual(ground.of(0, 0), []);
});

test('one free unit in an existing stack is collected while slot-limited excess stays in-world', () => {
  const { inventory, ground, collection, player } = setup({ capacity: 1000 });
  inventory.slots = Array.from({ length: 24 }, () => ({ id: 'longbow', count: 1 }));
  inventory.slots[0] = { id: 'ironOre', count: 19 };
  const item = ground.add('ironOre', 5, player.x, player.y);
  collection.update(0, player);
  assert.equal(inventory.slots[0].count, 20);
  assert.equal(item.count, 4);
  assert.equal(bagCount(inventory, 'ironOre') + item.count, 24);
  assert.equal(collection.events[0].count, 1);
});

test('magnet uses the world aspect, pulls close loot gradually, and leaves out-of-range loot alone', () => {
  const { inventory, ground, collection, player } = setup();
  const item = ground.add('ironOre', 2, player.x + 5 / ASPECT, player.y);
  const outside = ground.add('oakLog', 1, player.x + 6.01 / ASPECT, player.y);
  const outsideX = outside.x;
  collection.update(0.1, player);
  assert.ok(metricDistance(item, player) < 5);
  assert.ok(metricDistance(item, player) > 1.3);
  assert.equal(bagCount(inventory, 'ironOre'), 0);
  assert.equal(outside.x, outsideX);
  collection.update(0.4, player);
  assert.equal(bagCount(inventory, 'ironOre'), 2);
  assert.equal(outside.x, outsideX);
  assert.strictEqual(ground.of(0, 0)[0], outside);
});

for (const condition of ['blocked', 'air', 'windUp', 'combat']) {
  test(`${condition} suppresses collection while item time continues advancing`, () => {
    const { inventory, ground, collection, player } = setup();
    const item = ground.add('ironOre', 1, player.x, player.y);
    if (condition === 'air') player.air = 0.1;
    if (condition === 'windUp') player.windUp = 0;
    if (condition === 'combat') player.combat.busy = true;
    collection.update(2, player, { blocked: condition === 'blocked' });
    assert.equal(bagCount(inventory, 'ironOre'), 0);
    assert.equal(item.count, 1);
    assert.equal(collection.events.length, 0);
    assert.equal(collection.time, 2);
    assert.equal(ground.time, 2);
    assert.equal(collection.interact(player).status, 'busy');
    assert.equal(collection.prompt(player), '');
  });
}

test('props between walkable endpoints block attraction and manual pickup', () => {
  const { inventory, ground, collection, player } = setup({ isWalkable: (x) => x < 2 || x > 3 });
  const item = ground.add('ironOre', 3, 4.5, player.y);
  collection.update(2, player);
  assert.equal(item.x, 4.5);
  assert.equal(item.count, 3);
  assert.equal(bagCount(inventory, 'ironOre'), 0);
  assert.equal(collection.interact(player).status, 'empty');
  assert.equal(collection.prompt(player), '');
});

test('water and an obstructed source cannot be pulled or picked up', () => {
  for (const obstacle of ['water', 'source']) {
    const { inventory, ground, collection, player } = setup({
      typeAt: (x) => obstacle === 'water' && x >= 2 && x <= 3 ? WATER : GRASS,
      isWalkable: (x) => obstacle !== 'source' || x < 4,
    });
    const item = ground.add('ironOre', 3, 4.5, player.y);
    collection.update(3, player);
    assert.equal(item.x, 4.5);
    assert.equal(item.count, 3);
    assert.equal(bagCount(inventory, 'ironOre'), 0);
    assert.equal(collection.events.length, 0);
    assert.equal(collection.interact(player).status, 'empty');
  }
});

test('dropping conserves counts and waiting in place never automatically reacquires the drop', () => {
  const { inventory, ground, collection, player } = setup();
  inventory.add('ironOre', 5);
  const dropped = collection.drop(player, 0, 2);
  assert.equal(dropped.ok, true);
  assert.equal(bagCount(inventory, 'ironOre'), 3);
  assert.equal(dropped.item.count, 2);
  collection.update(4, player);
  assert.equal(bagCount(inventory, 'ironOre'), 3);
  assert.equal(dropped.item.count, 2);
  assert.match(collection.prompt(player), /^E Pick up Iron Ore/);
  assert.equal(collection.events.length, 0);
  player.x += 30;
  collection.update(0.1, player);
  assert.equal(dropped.item.dropOrigin, null, 'leaving must be recorded outside query range');
  player.x -= 30;
  collection.update(0.2, player);
  assert.equal(bagCount(inventory, 'ironOre'), 5);
  assert.deepEqual(ground.of(0, 0), []);
  assert.equal(collection.events[0].count, 2);
});

test('leaving the origin early still requires the full drop cooldown before collection', () => {
  const { inventory, collection, player } = setup();
  inventory.add('ironOre', 2);
  const dropped = collection.drop(player, 0);
  player.x += 20;
  collection.update(0.1, player);
  assert.equal(dropped.item.dropOrigin, null);
  assert.equal(bagCount(inventory, 'ironOre'), 1);
  player.x = dropped.item.x;
  player.y = dropped.item.y;
  collection.update(0.89, player);
  assert.equal(bagCount(inventory, 'ironOre'), 1);
  collection.update(0.02, player);
  assert.equal(bagCount(inventory, 'ironOre'), 2);
});

test('E can intentionally recover a nearby drop after cooldown without automatic recollection', () => {
  const { inventory, ground, collection, player } = setup();
  inventory.add('ironOre', 5);
  const dropped = collection.drop(player, 0, 2);
  assert.equal(collection.interact(player).status, 'empty');
  collection.update(0.99, player);
  assert.equal(collection.interact(player).status, 'empty');
  assert.equal(collection.prompt(player), '');
  assert.equal(bagCount(inventory, 'ironOre'), 3);
  assert.equal(dropped.item.count, 2);
  collection.update(0.01, player);
  assert.equal(bagCount(inventory, 'ironOre'), 3, 'auto collection must still honour the drop origin');
  assert.notEqual(dropped.item.dropOrigin, null);
  assert.match(collection.prompt(player), /^E Pick up Iron Ore x2/);
  const picked = collection.interact(player);
  assert.equal(picked.status, 'picked');
  assert.equal(picked.count, 2);
  assert.equal(bagCount(inventory, 'ironOre'), 5);
  assert.deepEqual(ground.of(0, 0), []);
  assert.equal(collection.events.length, 1);
  assert.equal(collection.events[0].count, 2);
  collection.update(1, player);
  assert.equal(collection.events.length, 1);
});

test('stepping away within magnet range does not undo a drop, including with another controller', () => {
  const { world, inventory, ground, collection, player } = setup();
  inventory.add('ironOre', 2);
  const dropped = collection.drop(player, 0);
  const resumed = new Collection(world, inventory, new GroundItems(world));
  player.y += 3;
  resumed.update(2, player);
  assert.equal(bagCount(inventory, 'ironOre'), 1);
  assert.notEqual(dropped.item.dropOrigin, null);
  assert.equal(dropped.item.y, 2.3);
  player.y += 9;
  resumed.update(0.1, player);
  assert.equal(dropped.item.dropOrigin, null);
  player.y -= 12;
  resumed.update(0.2, player);
  assert.equal(bagCount(inventory, 'ironOre'), 2);
  assert.deepEqual(ground.of(0, 0), []);
});

test('recreating a controller after a long session preserves the absolute drop cooldown', () => {
  const { world, inventory, collection, player } = setup();
  inventory.add('ironOre', 2);
  collection.update(100, player, { blocked: true });
  const dropped = collection.drop(player, 0);
  assert.equal(dropped.item.pickupAfter, 101);
  const resumedGround = new GroundItems(world);
  const resumed = new Collection(world, inventory, resumedGround);
  player.x += 20;
  resumed.update(0.5, player);
  assert.equal(resumed.time, 100.5);
  assert.equal(resumedGround.time, 100.5);
  player.x = dropped.item.x;
  player.y = dropped.item.y;
  resumed.update(0.4, player);
  assert.equal(bagCount(inventory, 'ironOre'), 1);
  resumed.update(0.2, player);
  assert.equal(bagCount(inventory, 'ironOre'), 2);
});

test('drops search for a dry walkable location when the facing direction is water', () => {
  const { inventory, ground, collection, player, world } = setup({ typeAt: (_x, y) => y > 1 ? WATER : GRASS });
  inventory.add('ironOre', 2);
  const dropped = collection.drop(player, 0);
  assert.equal(dropped.ok, true);
  assert.equal(world.typeAt(dropped.item.x, dropped.item.y), GRASS);
  assert.ok(world.isWalkable(dropped.item.x, dropped.item.y));
  assert.equal(bagCount(inventory, 'ironOre') + ground.of(0, 0).reduce((sum, item) => sum + item.count, 0)
    + ground.of(-1, 0).reduce((sum, item) => sum + item.count, 0), 2);
});

test('invalid quantities, unsafe terrain and rejected ground allocations preserve the bag', () => {
  for (const failure of ['quantity', 'terrain', 'allocation', 'removal']) {
    const { inventory, ground, collection, player } = setup({
      isWalkable: failure === 'terrain' ? () => false : () => true,
    });
    inventory.add('ironOre', 3);
    const before = inventory.slots.map((stack) => stack ? { ...stack } : null);
    if (failure === 'allocation') ground.add = () => null;
    if (failure === 'removal') inventory.remove = () => null;
    const dropped = collection.drop(player, 0, failure === 'quantity' ? 4 : 2);
    assert.equal(dropped.ok, false, failure);
    assert.deepEqual(inventory.slots, before, failure);
    assert.deepEqual(ground.of(0, 0), [], failure);
    assert.equal(collection.events.length, 0, failure);
  }
});

test('airborne, jumping and busy players cannot drop, but an open inventory permits dropping', () => {
  for (const condition of ['air', 'windUp', 'combat', 'blocked']) {
    const { inventory, collection, player } = setup();
    inventory.add('ironOre', 2);
    if (condition === 'air') player.air = 0.1;
    if (condition === 'windUp') player.windUp = 0;
    if (condition === 'combat') player.combat.busy = true;
    collection.update(0, player, { blocked: condition === 'blocked' });
    const dropped = collection.drop(player, 0);
    assert.equal(dropped.ok, condition === 'blocked');
    assert.equal(bagCount(inventory, 'ironOre'), condition === 'blocked' ? 1 : 2);
  }
});

test('E and the prompt choose a closer bush over farther loot even when the bag is full', () => {
  const { world, inventory, ground, collection, player } = setup({ capacity: 0.75 });
  inventory.add('ironOre');
  const farItem = ground.add('ironOre', 3, player.x, player.y + 5);
  const bush = { kind: 'bush', x: player.x, y: player.y + 1, harvested: false };
  world.chunk(0, 0).resources.push(bush);
  collection.harvesting = new Harvesting(world, ground);
  assert.equal(collection.prompt(player), 'E Gather berries');
  assert.equal(collection.interact(player).status, 'harvested');
  assert.equal(bush.harvested, true);
  assert.equal(farItem.count, 3);
  assert.equal(bagCount(inventory, 'ironOre'), 1);
  const berries = ground.of(0, 0).find((item) => item.id === 'berries');
  assert.equal(berries.count, 2, 'the bush reward remains loose with no bag capacity');
  collection.update(1, player);
  assert.equal(berries.count, 2);
  assert.equal(collection.events.length, 0);
});

test('E prioritizes nearer loose loot and keeps the farther resource intact', () => {
  const { world, inventory, ground, collection, player } = setup();
  const bush = { kind: 'bush', x: player.x, y: player.y + 4, harvested: false };
  world.chunk(0, 0).resources.push(bush);
  collection.harvesting = new Harvesting(world, ground);
  ground.add('ironOre', 3, player.x, player.y + 2);
  assert.match(collection.prompt(player), /^E Pick up Iron Ore/);
  const picked = collection.interact(player);
  assert.equal(picked.status, 'picked');
  assert.equal(picked.count, 3);
  assert.equal(bagCount(inventory, 'ironOre'), 3);
  assert.equal(bush.harvested, false);
});

test('nearby trees advertise the strike control rather than implying E chops them', () => {
  const { collection, player } = setup();
  collection.harvesting = {
    nearby: () => ({ kind: 'tree', name: 'Oak tree', action: 'Chop with your sword', x: player.x, y: player.y + 1 }),
  };
  assert.equal(collection.prompt(player), 'J / click Chop Oak tree');
});
