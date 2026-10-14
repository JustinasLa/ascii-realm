import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ITEMS } from '../src/inventory/items.js';
import { Inventory } from '../src/inventory/inventory.js';

const bag = (capacity = 1000) => new Inventory({ starter: false, capacity });
const countOf = (inventory, id) => inventory.slots.reduce(
  (count, stack) => count + (stack?.id === id ? stack.count : 0), 0);
const stateOf = (inventory) => structuredClone({
  slots: inventory.slots,
  equipment: inventory.equipment,
  hotbar: inventory.hotbar,
  selectedHotbar: inventory.selectedHotbar,
  capacity: inventory.capacity,
  events: inventory.events,
  weight: inventory.weight,
});

test('every collectible has immutable ground rendering and inventory metadata', () => {
  const resources = ['granite', 'basalt', 'limestone', 'flint', 'stick', 'berries',
    'mushroom', 'reed', 'clay', 'oakLog', 'straw', 'fibre'];
  for (const id of resources) assert.ok(Object.hasOwn(ITEMS, id), `missing resource ${id}`);
  assert.ok(Object.isFrozen(ITEMS));
  for (const [id, item] of Object.entries(ITEMS)) {
    assert.equal(item.id, id);
    assert.equal(typeof item.name, 'string');
    assert.ok(item.name.length > 0);
    assert.equal(typeof item.glyph, 'string');
    assert.equal(item.groundGlyph.length, 1);
    assert.match(item.groundGlyph, /^[\x21-\x7e]$/);
    assert.equal(item.colour.length, 3);
    assert.ok(item.colour.every((channel) => Number.isInteger(channel) && channel >= 0 && channel <= 255));
    assert.ok(Number.isFinite(item.weight) && item.weight > 0);
    assert.ok(Number.isSafeInteger(item.stackLimit) && item.stackLimit > 0);
    assert.ok(item.tags.length > 0 && item.tags.every((tag) => typeof tag === 'string'));
    assert.ok(Object.isFrozen(item) && Object.isFrozen(item.colour) && Object.isFrozen(item.tags));
  }
  assert.ok(ITEMS.granite.tags.includes('igneous'));
  assert.ok(ITEMS.limestone.tags.includes('sedimentary'));
});

test('a new collection bag is empty and emits no starter pickups', () => {
  const inventory = new Inventory({ starter: false });
  assert.equal(inventory.slots.length, 24);
  assert.ok(inventory.slots.every((stack) => stack === null));
  assert.ok(Object.values(inventory.equipment).every((stack) => stack === null));
  assert.ok(inventory.hotbar.every((id) => id === null));
  assert.equal(inventory.capacity, 60);
  assert.equal(inventory.weight, 0);
  assert.deepEqual(inventory.events, []);
});

test('space checks do not mutate live stacks, bindings or pickup events', () => {
  const inventory = bag();
  inventory.add('stick', 4);
  inventory.assignHotbar(2, 'stick');
  const stack = inventory.slots[0];
  const before = stateOf(inventory);
  assert.equal(inventory.spaceFor('stick', 50), 50);
  assert.equal(inventory.spaceFor('granite'), 1);
  assert.deepEqual(stateOf(inventory), before);
  assert.equal(inventory.slots[0], stack);
  assert.equal(inventory.add('stick', 50), 50);
  assert.equal(countOf(inventory, 'stick'), 54);
  assert.deepEqual(inventory.events.at(-1), { type: 'pickup', id: 'stick', count: 50 });
});

test('a full bag merges only what fits and leaves the rest in the world', () => {
  const inventory = bag();
  const limit = ITEMS.granite.stackLimit;
  inventory.add('granite', limit - 1);
  inventory.add('longbow', 23);
  assert.equal(inventory.slots.filter(Boolean).length, 24);
  let worldCount = 5;
  assert.equal(inventory.spaceFor('granite', worldCount), 1);
  assert.equal(inventory.spaceFor('basalt'), 0);
  worldCount -= inventory.add('granite', worldCount);
  assert.equal(countOf(inventory, 'granite'), limit);
  assert.equal(worldCount, 4);
  assert.equal(countOf(inventory, 'granite') + worldCount, limit + 4);
  const before = stateOf(inventory);
  assert.equal(inventory.add('granite', worldCount), 0);
  assert.deepEqual(stateOf(inventory), before);
});

test('collection accepts a partial weight fit without exceeding decimal capacity', () => {
  const inventory = bag(0.35);
  assert.equal(inventory.spaceFor('stick', 5), 3);
  assert.equal(inventory.add('stick', 5), 3);
  assert.equal(inventory.weight, 0.3);
  assert.equal(inventory.spaceFor('straw', 2), 1);
  assert.equal(inventory.add('straw', 2), 1);
  assert.equal(inventory.weight, 0.35);
  assert.equal(inventory.spaceFor('fibre'), 0);
  assert.equal(inventory.add('fibre'), 0);
  assert.deepEqual(inventory.events, [
    { type: 'pickup', id: 'stick', count: 3 },
    { type: 'pickup', id: 'straw', count: 1 },
  ]);
});

test('a large collection request fills bounded stacks and conserves rejected quantity', () => {
  const inventory = bag();
  const requested = Number.MAX_SAFE_INTEGER;
  const fits = 24 * ITEMS.fibre.stackLimit;
  assert.equal(inventory.spaceFor('fibre', requested), fits);
  const accepted = inventory.add('fibre', requested);
  assert.equal(accepted, fits);
  assert.equal(countOf(inventory, 'fibre'), fits);
  assert.ok(inventory.slots.every((stack) => stack.count === ITEMS.fibre.stackLimit));
  assert.equal(requested - accepted + countOf(inventory, 'fibre'), requested);
});

test('equipped gear still uses capacity and cannot be removed through a bag index', () => {
  const inventory = bag(ITEMS.longbow.weight + 0.3);
  inventory.add('longbow');
  inventory.assignHotbar(0, 'longbow');
  inventory.equip(0);
  const before = stateOf(inventory);
  assert.equal(inventory.remove(0), null);
  assert.deepEqual(stateOf(inventory), before);
  assert.equal(inventory.spaceFor('stick', 10), 3);
  assert.equal(inventory.add('stick', 10), 3);
  assert.equal(inventory.getHotbar().source, 'equipment');
  assert.deepEqual(inventory.equipment.mainHand, { id: 'longbow', count: 1 });
  assert.ok(Math.abs(inventory.weight - inventory.capacity) < 1e-9);
});

test('dropping from a selected bag stack conserves quantities across re-collection', () => {
  const inventory = bag();
  const limit = ITEMS.fibre.stackLimit;
  inventory.add('fibre', limit + 3);
  inventory.assignHotbar(4, 'fibre');
  inventory.selectHotbar(4);
  const priorEvents = structuredClone(inventory.events);
  const dropped = inventory.remove(1, 2);
  assert.deepEqual(dropped, { id: 'fibre', count: 2 });
  assert.deepEqual(inventory.slots[0], { id: 'fibre', count: limit });
  assert.deepEqual(inventory.slots[1], { id: 'fibre', count: 1 });
  assert.equal(countOf(inventory, 'fibre') + dropped.count, limit + 3);
  assert.deepEqual(inventory.events, priorEvents, 'removal does not invent pickup events');
  assert.equal(inventory.hotbar[4], 'fibre');
  assert.equal(inventory.add(dropped.id, dropped.count), 2);
  assert.equal(countOf(inventory, 'fibre'), limit + 3);
  assert.equal(inventory.selectedHotbar, 4);
});

test('exhausting a stack frees weight and space while retaining its hotbar binding', () => {
  const inventory = bag();
  inventory.add('clay', 3);
  inventory.assignHotbar(0, 'clay');
  assert.deepEqual(inventory.remove(0, 100), { id: 'clay', count: 3 });
  assert.equal(inventory.slots[0], null);
  assert.equal(inventory.weight, 0);
  assert.equal(inventory.hotbar[0], 'clay');
  assert.equal(inventory.getHotbar(), null);
  assert.equal(inventory.remove(0), null);
  inventory.add('clay');
  assert.equal(inventory.getHotbar().count, 1);
});

test('invalid collection and removal requests leave all inventory state unchanged', () => {
  const inventory = bag();
  inventory.add('berries', 3);
  const before = stateOf(inventory);
  for (const id of ['missing', 'constructor', '__proto__', null, undefined, 0]) {
    assert.equal(inventory.spaceFor(id), 0);
    assert.equal(inventory.add(id), 0);
  }
  for (const count of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '2', null]) {
    assert.equal(inventory.spaceFor('berries', count), 0);
    assert.equal(inventory.add('berries', count), 0);
    assert.equal(inventory.remove(0, count), null);
  }
  for (const index of [-1, 24, 0.5, NaN, Infinity, '0', null, undefined]) {
    assert.equal(inventory.remove(index), null);
  }
  assert.deepEqual(stateOf(inventory), before);
});

test('removal rejects malformed stacks rather than creating invalid world items', () => {
  const inventory = bag();
  for (const stack of [
    { id: 'unknown', count: 1 },
    { id: 'stick', count: 0 },
    { id: 'stick', count: 0.5 },
    { id: 'stick', count: ITEMS.stick.stackLimit + 1 },
  ]) {
    inventory.slots[0] = stack;
    const before = stateOf(inventory);
    assert.equal(inventory.remove(0), null);
    assert.deepEqual(stateOf(inventory), before);
  }
});

test('invalid or exhausted weight capacity refuses collection without pickup events', () => {
  const inventory = bag(0);
  for (const capacity of [0, -1, NaN, Infinity]) {
    inventory.capacity = capacity;
    const before = stateOf(inventory);
    assert.equal(inventory.spaceFor('reed', 3), 0);
    assert.equal(inventory.add('reed', 3), 0);
    assert.deepEqual(stateOf(inventory), before);
  }
});
