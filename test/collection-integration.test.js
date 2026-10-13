import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Player } from '../src/entities/player.js';
import { Collection } from '../src/inventory/collection.js';
import { Inventory } from '../src/inventory/inventory.js';
import { ITEMS } from '../src/inventory/items.js';
import { Harvesting } from '../src/world/harvesting.js';
import { GroundItems } from '../src/world/items.js';
import { ASPECT, CHUNK_SIZE, GRASS, WATER, World } from '../src/world/world.js';

// Keep the real terrain cache and collision queries, with a controlled local
// clearing so procedural scenery cannot decide which transfer is under test.
function scene({ x = 20, y = 20, capacity = 1000 } = {}) {
  const world = new World(1);
  for (let cy = -1; cy <= 1; cy++) {
    for (let cx = -1; cx <= 1; cx++) {
      const chunk = world.chunk(cx, cy);
      chunk.type.fill(GRASS);
      chunk.props = [];
      chunk.items = [];
      chunk.resources = [];
    }
  }
  const inventory = new Inventory({ starter: false, capacity });
  const items = new GroundItems(world);
  const harvesting = new Harvesting(world, items);
  return {
    world, inventory, items, harvesting,
    collection: new Collection(world, inventory, items, harvesting),
    player: new Player(x, y),
  };
}

const carried = (inventory, id) => inventory.slots.reduce(
  (total, stack) => total + (stack?.id === id ? stack.count : 0), 0);
const loose = (items, id) => items.in(-CHUNK_SIZE, -CHUNK_SIZE,
  CHUNK_SIZE * 2 - 0.01, CHUNK_SIZE * 2 - 0.01)
  .reduce((total, item) => total + (item.id === id ? item.count : 0), 0);
const pickups = (collection) => collection.events.filter((event) => event.type === 'pickup');

function walk(state, dt, move = { x: 0, y: 0 }, blocked = false) {
  state.player.update(dt, state.world, move, false);
  state.player.events.length = 0;
  state.collection.update(dt, state.player, { blocked });
}

function visitDistantChunk(state) {
  state.items.of(9, -9);
  state.harvesting.resourcesOf(9, -9);
  state.world.propsOf(9, -9);
}

function finishSwing(state) {
  const events = [];
  for (let frame = 0; frame < 240 && state.player.combat.busy; frame++) {
    state.player.update(1 / 120, state.world, { x: 0, y: 0 }, false);
    for (const event of state.player.events.splice(0)) {
      if (event.type === 'strike' || event.type === 'slam') events.push(event);
      state.harvesting.react(event, state.player);
    }
  }
  assert.equal(state.player.combat.busy, false, 'swing must finish');
  return events;
}

test('walking accepts only the weight that fits and keeps the rejected stack until E collects it', () => {
  const state = scene({ capacity: ITEMS.stick.weight * 3.5 });
  const item = state.items.add('stick', 5, 24, 20);
  const cached = state.items.of(0, 0);

  walk(state, 0.1, { x: 1, y: 0 });
  assert.ok(state.player.x > 20, 'the real player must move while collecting');
  assert.equal(state.player.moving, true);
  assert.equal(carried(state.inventory, 'stick'), 3);
  assert.equal(item.count, 2);
  assert.equal(carried(state.inventory, 'stick') + loose(state.items, 'stick'), 5);
  assert.deepEqual(pickups(state.collection).map(({ id, count }) => ({ id, count })), [
    { id: 'stick', count: 3 },
  ]);
  assert.ok(state.inventory.weight <= state.inventory.capacity);

  state.collection.events.length = 0;
  const position = { x: item.x, y: item.y };
  walk(state, 0.2);
  assert.equal(state.collection.interact(state.player).status, 'full');
  assert.equal(item.count, 2);
  assert.deepEqual({ x: item.x, y: item.y }, position, 'a full bag must not attract the remainder');
  assert.deepEqual(pickups(state.collection), []);

  state.inventory.capacity = 1;
  const collected = state.collection.interact(state.player);
  assert.equal(collected.ok, true);
  assert.equal(collected.count, 2);
  assert.equal(carried(state.inventory, 'stick'), 5);
  assert.equal(loose(state.items, 'stick'), 0);
  visitDistantChunk(state);
  assert.equal(state.items.of(0, 0), cached);
  assert.deepEqual(cached, [], 'a depleted loose-item array must not regenerate');
});

test('an open inventory suppresses pickup and gathering while a selected bag drop still conserves items', () => {
  const state = scene();
  state.inventory.add('stick', 2);
  state.inventory.events.length = 0;
  const item = state.items.add('flint', 1, state.player.x, state.player.y);
  const bush = { kind: 'bush', x: 21, y: 20, harvested: false };
  state.world.chunk(0, 0).resources.push(bush);

  walk(state, 0.2, { x: 0, y: 0 }, true);
  assert.equal(state.collection.interact(state.player).status, 'busy');
  assert.equal(carried(state.inventory, 'flint'), 0);
  assert.equal(item.count, 1);
  assert.equal(bush.harvested, false);
  assert.deepEqual(pickups(state.collection), []);

  const dropped = state.collection.drop(state.player, 0);
  assert.equal(dropped.ok, true);
  assert.equal(carried(state.inventory, 'stick'), 1);
  assert.equal(loose(state.items, 'stick'), 1);
  assert.equal(carried(state.inventory, 'stick') + loose(state.items, 'stick'), 2);
  assert.deepEqual(state.inventory.events, [], 'dropping must not emit a pickup');

  state.collection.update(0, state.player);
  assert.equal(carried(state.inventory, 'flint'), 1);
  assert.equal(bush.harvested, false);
  assert.deepEqual(pickups(state.collection).map(({ id, count }) => ({ id, count })), [
    { id: 'flint', count: 1 },
  ]);
});

test('magnet movement across both negative chunk boundaries transfers ownership before pickup', () => {
  const state = scene({ x: 6, y: 3 });
  const item = state.items.add('reed', 4, -0.2, -0.2);
  const source = state.items.of(-1, -1);
  const destination = state.items.of(0, 0);
  assert.equal(source.includes(item), true);

  walk(state, 0.05);
  assert.ok(item.x > 0 && item.y > 0, 'magnet must cross the x and y boundaries');
  assert.ok(Math.hypot((item.x - state.player.x) * ASPECT, item.y - state.player.y) > 1.3);
  assert.equal(source.includes(item), false);
  assert.equal(destination.filter((candidate) => candidate === item).length, 1);
  assert.deepEqual(state.items.in(-1, -1, 0, 0), []);
  assert.deepEqual(state.items.in(0, 0, 7, 4), [item]);
  assert.equal(carried(state.inventory, 'reed') + loose(state.items, 'reed'), 4);

  walk(state, 0.5);
  assert.equal(carried(state.inventory, 'reed'), 4);
  assert.equal(loose(state.items, 'reed'), 0);
  assert.deepEqual(source, []);
  assert.deepEqual(destination, []);
  assert.equal(pickups(state.collection).length, 1);
});

test('bag drops persist in their destination chunk and require both leaving and cooldown before re-collection', () => {
  const state = scene({ x: -0.5, y: -0.5 });
  state.player.heading = Math.PI / 2;
  state.inventory.add('stick', 5);
  state.inventory.events.length = 0;
  const dropped = state.collection.drop(state.player, 0, 2);
  assert.equal(dropped.ok, true);
  const item = dropped.item;
  const cached = state.items.of(0, -1);
  assert.equal(Math.floor(item.x / CHUNK_SIZE), 0);
  assert.equal(Math.floor(item.y / CHUNK_SIZE), -1);
  assert.equal(cached.includes(item), true);
  assert.equal(carried(state.inventory, 'stick') + loose(state.items, 'stick'), 5);

  const position = { x: item.x, y: item.y };
  state.collection.update(1.25, state.player);
  assert.equal(carried(state.inventory, 'stick'), 3);
  assert.deepEqual({ x: item.x, y: item.y }, position, 'waiting at the drop origin must not pull it back');
  assert.deepEqual(pickups(state.collection), []);
  for (let frame = 0; frame < 4; frame++) walk(state, 0.1, { x: 1, y: 0 });
  assert.ok(Math.hypot((state.player.x + 0.5) * ASPECT, state.player.y + 0.5) > 6);
  assert.ok(Math.hypot((state.player.x - item.x) * ASPECT, state.player.y - item.y) < 6);
  assert.equal(carried(state.inventory, 'stick'), 3, 'walking ahead must leave the full drop influence before collection');
  assert.deepEqual({ x: item.x, y: item.y }, position);
  assert.deepEqual(pickups(state.collection), []);
  visitDistantChunk(state);
  assert.equal(state.items.of(0, -1), cached);
  assert.equal(cached.includes(item), true);

  state.player.x = 100;
  state.player.y = 100;
  state.collection.update(0, state.player);
  assert.equal(item.dropOrigin, null, 'leaving must be recorded outside the magnet query');
  Object.assign(state.player, position);
  state.collection.update(0, state.player);
  assert.equal(carried(state.inventory, 'stick'), 5);
  assert.deepEqual(cached, []);

  state.collection.events.length = 0;
  const second = state.collection.drop(state.player, 0, 2).item;
  const secondPosition = { x: second.x, y: second.y };
  state.player.x = 100;
  state.player.y = 100;
  state.collection.update(0, state.player);
  Object.assign(state.player, secondPosition);
  state.collection.update(0.25, state.player);
  assert.equal(carried(state.inventory, 'stick'), 3, 'leaving alone must not bypass the cooldown');
  assert.equal(second.count, 2);
  assert.deepEqual(pickups(state.collection), []);
  state.collection.update(1, state.player);
  assert.equal(carried(state.inventory, 'stick'), 5);
  assert.equal(loose(state.items, 'stick'), 0);
  assert.equal(pickups(state.collection).length, 1);
});

test('a drop with no walkable destination preserves the selected stack and produces no world item', () => {
  const state = scene();
  state.inventory.add('clay', 3);
  state.inventory.events.length = 0;
  const selected = state.inventory.slots[0];
  for (let cy = -1; cy <= 1; cy++) {
    for (let cx = -1; cx <= 1; cx++) state.world.chunk(cx, cy).type.fill(WATER);
  }

  const dropped = state.collection.drop(state.player, 0, 2);
  assert.equal(dropped.ok, false);
  assert.equal(state.inventory.slots[0], selected);
  assert.deepEqual(selected, { id: 'clay', count: 3 });
  assert.equal(loose(state.items, 'clay'), 0);
  assert.deepEqual(state.inventory.events, []);
  assert.deepEqual(state.collection.events, []);
});

test('three real player swings deplete a tree, cut grass once, and leave collected rewards depleted after a distant visit', () => {
  const state = scene();
  state.inventory.add('greatsword');
  state.inventory.equip(0);
  state.inventory.events.length = 0;
  const tree = { kind: 'tree', x: 20, y: 25.5, footW: 2.4, footH: 1.2, cells: [] };
  const grass = { kind: 'grass', x: 23.5, y: 24.3, harvested: false };
  const chunk = state.world.chunk(0, 0);
  chunk.props.push(tree);
  chunk.resources.push(grass);
  const resources = state.harvesting.resourcesOf(0, 0);
  assert.equal(state.world.isWalkable(tree.x, tree.y), false);

  state.player.attack();
  for (let frame = 0; frame < 120 && state.player.combat.move === 'draw'; frame++) {
    state.player.update(1 / 120, state.world, { x: 0, y: 0 }, false);
    for (const event of state.player.events.splice(0)) state.harvesting.react(event, state.player);
  }
  assert.equal(state.player.combat.move, 'a');
  assert.equal(tree.hits ?? 0, 0, 'drawing the sword must not harvest');
  assert.equal(grass.harvested, false);

  const events = finishSwing(state);
  assert.equal(tree.hits, 1);
  assert.equal(tree.chopped, false);
  assert.equal(grass.harvested, true);
  assert.equal(loose(state.items, 'straw'), 1);
  assert.equal(loose(state.items, 'fibre'), 1);
  assert.equal(loose(state.items, 'oakLog'), 0);
  state.player.attack();
  events.push(...finishSwing(state));
  assert.equal(tree.hits, 2);
  assert.equal(tree.chopped, false);
  assert.equal(loose(state.items, 'oakLog'), 0);
  state.player.attack();
  events.push(...finishSwing(state));
  assert.deepEqual(events.filter((event) => event.type === 'strike').map((event) => event.swing), ['a', 'b', 'c']);
  assert.equal(events.filter((event) => event.type === 'slam').length, 1);
  assert.equal(tree.hits, 3, 'the overhead slam must not apply a fourth hit');
  assert.equal(tree.chopped, true);
  assert.equal(state.world.isWalkable(tree.x, tree.y), true);
  assert.equal(loose(state.items, 'oakLog'), 3);
  assert.equal(loose(state.items, 'straw'), 1);
  assert.equal(loose(state.items, 'fibre'), 1);

  state.player.x = tree.x;
  state.player.y = tree.y;
  state.collection.update(1, state.player);
  assert.equal(carried(state.inventory, 'oakLog'), 3);
  assert.equal(carried(state.inventory, 'straw'), 1);
  assert.equal(carried(state.inventory, 'fibre'), 1);
  const cachedItems = state.items.of(0, 0);
  visitDistantChunk(state);
  assert.equal(state.world.chunk(0, 0), chunk);
  assert.equal(state.harvesting.resourcesOf(0, 0), resources);
  assert.equal(state.items.of(0, 0), cachedItems);
  assert.equal(state.world.propsOf(0, 0)[0], tree);
  assert.equal(tree.chopped, true);
  assert.equal(grass.harvested, true);
  assert.deepEqual(cachedItems, []);
  assert.equal(state.harvesting.nearby(state.player), null);
});

test('E gathering emits persistent loose berries and a depleted bush cannot be gathered again', () => {
  const state = scene({ x: -10, y: -10 });
  const bush = { kind: 'bush', x: -10, y: -8, harvested: false };
  const chunk = state.world.chunk(-1, -1);
  chunk.resources.push(bush);
  const resources = state.harvesting.resourcesOf(-1, -1);

  const gathered = state.collection.interact(state.player);
  assert.equal(gathered.ok, true);
  assert.equal(gathered.status, 'harvested');
  assert.equal(bush.harvested, true);
  assert.equal(loose(state.items, 'berries'), 2);
  assert.equal(carried(state.inventory, 'berries'), 0);
  assert.deepEqual(pickups(state.collection), [], 'harvested loot must be collected before a pickup event');

  state.player.y = bush.y;
  state.collection.update(0.1, state.player);
  assert.equal(carried(state.inventory, 'berries'), 0, 'new harvest rewards have a short settling delay');
  state.collection.update(0.2, state.player);
  assert.equal(carried(state.inventory, 'berries'), 2);
  assert.equal(loose(state.items, 'berries'), 0);
  visitDistantChunk(state);
  assert.equal(state.world.chunk(-1, -1), chunk);
  assert.equal(state.harvesting.resourcesOf(-1, -1), resources);
  assert.equal(resources[0], bush);
  assert.equal(state.collection.interact(state.player).status, 'empty');
  assert.equal(carried(state.inventory, 'berries') + loose(state.items, 'berries'), 2);
});
