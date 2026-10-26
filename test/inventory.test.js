import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Vitals } from '../src/entities/vitals.js';
import { ITEMS, EQUIPMENT_SLOTS } from '../src/inventory/items.js';
import { Inventory } from '../src/inventory/inventory.js';

const emptyInventory = (capacity = 1000) => new Inventory({ starter: false, capacity });
const carriedCount = (inventory, id) => [...inventory.slots, ...Object.values(inventory.equipment)]
  .reduce((count, stack) => count + (stack?.id === id ? stack.count : 0), 0);
const inventoryState = (inventory) => structuredClone({
  slots: inventory.slots,
  equipment: inventory.equipment,
  hotbar: inventory.hotbar,
  selectedHotbar: inventory.selectedHotbar,
  weight: inventory.weight,
  events: inventory.events,
});

test('a new inventory exposes the required bag, equipment, and hotbar slots', () => {
  const inventory = new Inventory();
  assert.equal(inventory.slots.length, 24);
  assert.equal(inventory.hotbar.length, 9);
  assert.equal(inventory.selectedHotbar, 0);
  assert.equal(inventory.capacity, 60);
  assert.deepEqual(Object.keys(inventory.equipment).sort(),
    ['helm', 'chest', 'legs', 'hands', 'cape', 'mainHand', 'offHand'].sort());
  assert.equal(EQUIPMENT_SLOTS.length, 7);
  assert.ok(inventory.slots.some(Boolean), 'starter consumables are carried');
  assert.ok(Object.values(inventory.equipment).some(Boolean), 'starter gear is equipped');
  assert.ok(inventory.weight > 0 && inventory.weight <= inventory.capacity);
  assert.deepEqual(inventory.events, [], 'starter items do not announce new pickups');
});

test('adding stackable items splits stacks without losing items', () => {
  const inventory = emptyInventory();
  const limit = ITEMS.healingDraught.stackLimit;
  assert.ok(limit > 1);
  assert.equal(inventory.add('healingDraught', limit + 2), limit + 2);
  assert.deepEqual(inventory.slots[0], { id: 'healingDraught', count: limit });
  assert.deepEqual(inventory.slots[1], { id: 'healingDraught', count: 2 });
  assert.equal(carriedCount(inventory, 'healingDraught'), limit + 2);
  assert.equal(inventory.slots.filter(Boolean).length, 2);
});

test('a partial merge leaves the excess in the source stack', () => {
  const inventory = emptyInventory();
  const limit = ITEMS.healingDraught.stackLimit;
  inventory.add('healingDraught', limit + 2);
  const beforeWeight = inventory.weight;
  assert.equal(inventory.move(0, 1), true);
  assert.deepEqual(inventory.slots[0], { id: 'healingDraught', count: 2 });
  assert.deepEqual(inventory.slots[1], { id: 'healingDraught', count: limit });
  assert.equal(carriedCount(inventory, 'healingDraught'), limit + 2);
  assert.equal(inventory.weight, beforeWeight);

  const before = inventoryState(inventory);
  assert.equal(inventory.move(0, 1), false, 'a full destination cannot receive more');
  assert.deepEqual(inventoryState(inventory), before);
});

test('moving weapons with different materials swaps stacks without changing their materials', () => {
  const inventory = emptyInventory();
  inventory.add('spear', 1, { material: 'steel' });
  inventory.add('spear', 2, { material: 'stone' });
  const beforeWeight = inventory.weight;

  assert.equal(inventory.move(0, 1), true);
  assert.deepEqual(inventory.slots[0], { id: 'spear', count: 2, material: 'stone' });
  assert.deepEqual(inventory.slots[1], { id: 'spear', count: 1, material: 'steel' });
  assert.equal(inventory.weight, beforeWeight);
});

test('moving matching weapon materials merges up to the stack limit', () => {
  const inventory = emptyInventory();
  const limit = ITEMS.spear.stackLimit;
  inventory.add('spear', limit + 1, { material: 'steel' });

  assert.equal(inventory.move(0, 1), true);
  assert.deepEqual(inventory.slots[0], { id: 'spear', count: 1, material: 'steel' });
  assert.deepEqual(inventory.slots[1], { id: 'spear', count: limit, material: 'steel' });
});

test('capacity checks agree with additions for matching, different, and sanitized materials', () => {
  for (const existing of [{ material: 'steel' }, {}]) {
    for (const incoming of [{ material: 'steel' }, { material: 'stone' }, {}, { material: 'unknown' }]) {
      const inventory = emptyInventory();
      inventory.add('spear', 1, existing);
      inventory.add('longbow', 23);
      const before = inventoryState(inventory);
      const expected = existing.material === 'steel'
        ? (incoming.material === 'steel' ? 2 : 0)
        : (!incoming.material || incoming.material === 'unknown' ? 2 : 0);

      assert.equal(inventory.spaceFor('spear', 3, incoming), expected);
      assert.deepEqual(inventoryState(inventory), before, 'space checks are read-only');
      assert.equal(inventory.add('spear', 3, incoming), expected);
      assert.equal(carriedCount(inventory, 'spear'), 1 + expected);
    }
  }
});

test('moving to an empty slot and swapping different items conserves their counts', () => {
  const inventory = emptyInventory();
  inventory.add('healingDraught', 3);
  inventory.add('ironOre', 2);
  const beforeWeight = inventory.weight;
  assert.equal(inventory.move(0, 5), true);
  assert.equal(inventory.slots[0], null);
  assert.deepEqual(inventory.slots[5], { id: 'healingDraught', count: 3 });
  assert.equal(inventory.move(5, 1), true);
  assert.deepEqual(inventory.slots[1], { id: 'healingDraught', count: 3 });
  assert.deepEqual(inventory.slots[5], { id: 'ironOre', count: 2 });
  assert.equal(carriedCount(inventory, 'healingDraught'), 3);
  assert.equal(carriedCount(inventory, 'ironOre'), 2);
  assert.equal(inventory.weight, beforeWeight);
});

test('a full bag accepts only the quantity that fits an existing stack', () => {
  const inventory = emptyInventory();
  const limit = ITEMS.healingDraught.stackLimit;
  inventory.add('healingDraught', limit - 1);
  inventory.add('longbow', 23);
  assert.equal(inventory.slots.filter(Boolean).length, 24);
  inventory.events.length = 0;
  assert.equal(inventory.add('healingDraught', 3), 1);
  assert.equal(carriedCount(inventory, 'healingDraught'), limit);
  assert.equal(inventory.add('ironOre', 1), 0);
  assert.equal(carriedCount(inventory, 'longbow'), 23);
  assert.deepEqual(inventory.events, [{ type: 'pickup', id: 'healingDraught', count: 1 }]);
});

test('carrying capacity allows a partial add and includes equipped gear', () => {
  const weight = ITEMS.longbow.weight;
  const inventory = emptyInventory(weight * 2);
  assert.equal(inventory.add('longbow', 3), 2);
  assert.equal(inventory.weight, weight * 2);
  assert.equal(inventory.equip(0), true);
  assert.equal(inventory.weight, weight * 2, 'equipping does not free carrying capacity');
  assert.equal(inventory.add('longbow'), 0);
  assert.equal(carriedCount(inventory, 'longbow'), 2);
});

test('equipping from a full bag frees exactly one bag slot', () => {
  const inventory = emptyInventory();
  assert.equal(inventory.add('longbow', 24), 24);
  const beforeWeight = inventory.weight;
  assert.equal(inventory.equip(0), true);
  assert.deepEqual(inventory.equipment.mainHand, { id: 'longbow', count: 1 });
  assert.equal(inventory.slots.filter(Boolean).length, 23);
  assert.equal(carriedCount(inventory, 'longbow'), 24);
  assert.equal(inventory.weight, beforeWeight);
});

test('replacing equipped gear works with a full bag without duplicating or dropping it', () => {
  const inventory = emptyInventory();
  inventory.add('longbow');
  inventory.equip(0);
  inventory.add('longbow', 24);
  const beforeWeight = inventory.weight;
  assert.equal(inventory.equip(0), true);
  assert.equal(inventory.slots.filter(Boolean).length, 24);
  assert.deepEqual(inventory.equipment.mainHand, { id: 'longbow', count: 1 });
  assert.equal(carriedCount(inventory, 'longbow'), 25);
  assert.equal(inventory.weight, beforeWeight);
});

test('unequipping into a full bag fails transactionally and succeeds after space is freed', () => {
  const inventory = emptyInventory();
  inventory.add('outlawHood');
  inventory.equip(0);
  inventory.add('longbow', 24);
  const before = inventoryState(inventory);
  assert.equal(inventory.unequip('helm'), false);
  assert.deepEqual(inventoryState(inventory), before);

  assert.equal(inventory.equip(0), true);
  assert.equal(inventory.unequip('helm'), true);
  assert.equal(inventory.equipment.helm, null);
  assert.equal(carriedCount(inventory, 'outlawHood'), 1);
  assert.equal(carriedCount(inventory, 'longbow'), 24);
  assert.equal(inventory.weight, before.weight);
});

test('invalid item IDs, quantities, and bag indices do not mutate inventory', () => {
  const inventory = emptyInventory();
  inventory.add('healingDraught', 2);
  const before = inventoryState(inventory);
  for (const id of ['missing-item', 'constructor', '__proto__', undefined, null]) {
    assert.equal(inventory.add(id), 0, `invalid item ${String(id)}`);
  }
  for (const quantity of [0, -1, 1.25, NaN, Infinity, '3', null]) {
    assert.equal(inventory.add('healingDraught', quantity), 0, `invalid quantity ${String(quantity)}`);
  }
  for (const index of [-1, 24, 1.5, NaN, Infinity, '0', null, undefined]) {
    assert.equal(inventory.move(index, 1), false);
    assert.equal(inventory.move(0, index), false);
    assert.equal(inventory.equip(index), false);
    assert.equal(inventory.getItem(index), null);
  }
  assert.equal(inventory.move(0, 0), false);
  assert.equal(inventory.move(3, 0), false);
  assert.equal(inventory.equip(0), false, 'a consumable cannot be equipped');
  for (const slot of ['missing-slot', 'constructor', '__proto__', null]) {
    assert.equal(inventory.unequip(slot), false);
  }
  assert.deepEqual(inventoryState(inventory), before);
});

test('hotbar bindings follow item IDs through bag moves and stack merges', () => {
  const inventory = emptyInventory();
  const limit = ITEMS.healingDraught.stackLimit;
  inventory.add('healingDraught', limit + 2);
  inventory.assignHotbar(3, 'healingDraught');
  inventory.selectHotbar(3);
  assert.equal(inventory.hotbar[3], 'healingDraught');
  assert.equal(inventory.getHotbar().item, ITEMS.healingDraught);
  assert.equal(inventory.getHotbar().count, limit + 2);

  inventory.move(0, 10);
  inventory.move(10, 1);
  const entry = inventory.getHotbar();
  assert.equal(entry.item, ITEMS.healingDraught);
  assert.equal(entry.count, limit + 2);
  assert.equal(entry.source, 'inventory');
  assert.equal(entry.stack, inventory.slots[entry.index]);
  assert.equal(inventory.hotbar[3], 'healingDraught');
});

test('a gear hotbar binding resolves equipped gear and returns to the bag after unequipping', () => {
  const inventory = emptyInventory();
  inventory.add('longbow', 2);
  inventory.assignHotbar(0, 'longbow');
  inventory.equip(0);
  let entry = inventory.getHotbar();
  assert.equal(entry.item, ITEMS.longbow);
  assert.equal(entry.count, 2, 'the count includes both equipped and carried copies');
  assert.equal(entry.source, 'equipment');
  assert.equal(entry.stack, inventory.equipment.mainHand);
  assert.equal(entry.slot, 'mainHand');

  inventory.unequip('mainHand');
  entry = inventory.getHotbar();
  assert.equal(entry.source, 'inventory');
  assert.equal(entry.count, 2);
  assert.equal(entry.stack, inventory.slots[entry.index]);
  assert.equal(inventory.hotbar[0], 'longbow');
});

test('hotbar cycling wraps in both directions and invalid selections cannot corrupt it', () => {
  const inventory = emptyInventory();
  inventory.selectHotbar(8);
  inventory.cycleHotbar(1);
  assert.equal(inventory.selectedHotbar, 0);
  inventory.cycleHotbar(-1);
  assert.equal(inventory.selectedHotbar, 8);
  inventory.selectHotbar(4);
  assert.equal(inventory.selectedHotbar, 4);
  for (const index of [-1, 9, 1.5, NaN, Infinity, '0', null]) {
    inventory.selectHotbar(index);
    inventory.assignHotbar(index, 'longbow');
  }
  assert.equal(inventory.selectedHotbar, 4);
  assert.equal(inventory.hotbar.length, 9);
  assert.ok(inventory.hotbar.every((binding) => binding === null));

  inventory.add('longbow');
  inventory.assignHotbar(4, 'longbow');
  for (const id of ['missing-item', 'constructor', '__proto__']) inventory.assignHotbar(4, id);
  assert.equal(inventory.hotbar[4], 'longbow');
  inventory.assignHotbar(4, null);
  assert.equal(inventory.getHotbar(), null);
});

test('a healing quick item consumes exactly once when needed and clamps actual restoration', () => {
  const inventory = emptyInventory();
  const vitals = new Vitals();
  inventory.add('healingDraught', 2);
  inventory.assignHotbar(0, 'healingDraught');
  vitals.spendStamina(10);
  const fullHealthState = inventoryState(inventory);
  assert.equal(inventory.useSelected(vitals), false, 'missing stamina does not justify a healing item');
  assert.deepEqual(inventoryState(inventory), fullHealthState);

  vitals.takeDamage(1);
  assert.equal(inventory.useSelected(vitals), true);
  assert.equal(vitals.health, vitals.maxHealth);
  assert.equal(vitals.stamina, vitals.maxStamina - 10);
  assert.equal(carriedCount(inventory, 'healingDraught'), 1);
  assert.equal(inventory.getHotbar().count, 1);
  assert.ok(Math.abs(inventory.weight - ITEMS.healingDraught.weight) < 1e-9);

  assert.equal(inventory.useSelected(vitals), false);
  assert.equal(carriedCount(inventory, 'healingDraught'), 1);
  vitals.takeDamage(1);
  assert.equal(inventory.useSelected(vitals), true);
  assert.equal(carriedCount(inventory, 'healingDraught'), 0);
  assert.equal(inventory.slots.filter(Boolean).length, 0);
  assert.equal(inventory.getHotbar(), null, 'an exhausted item binding resolves as empty');
  assert.equal(inventory.useSelected(vitals), false);
  assert.equal(inventory.weight, 0);
});

test('quick item use finds consumables after their original bag slot is moved', () => {
  const inventory = emptyInventory();
  const vitals = new Vitals();
  inventory.add('staminaTonic', 2);
  inventory.assignHotbar(2, 'staminaTonic');
  inventory.selectHotbar(2);
  inventory.move(0, 23);
  vitals.spendStamina(1);
  vitals.takeDamage(5);
  assert.equal(inventory.useSelected(vitals), true);
  assert.equal(vitals.stamina, vitals.maxStamina);
  assert.equal(vitals.health, vitals.maxHealth - 5);
  assert.deepEqual(inventory.slots[23], { id: 'staminaTonic', count: 1 });
  assert.equal(inventory.slots[0], null);
  assert.equal(inventory.useSelected(vitals), false);
  assert.equal(carriedCount(inventory, 'staminaTonic'), 1);
});

test('a refused restoration never consumes an item', () => {
  const inventory = emptyInventory();
  inventory.add('healingDraught');
  inventory.assignHotbar(0, 'healingDraught');
  const before = inventoryState(inventory);
  const vitals = { health: 50, maxHealth: 100, stamina: 100, maxStamina: 100, heal: () => 0 };
  assert.equal(inventory.useSelected(vitals), false);
  assert.equal(vitals.health, 50);
  assert.deepEqual(inventoryState(inventory), before);
});

test('the starter sword and buckler are worn together, and the longbow stows both', () => {
  const inventory = new Inventory();
  inventory.add('longbow');
  inventory.events.length = 0;
  const totals = () => Object.fromEntries(Object.keys(ITEMS)
    .map((id) => [id, carriedCount(inventory, id)]));
  const beforeCounts = totals();
  const beforeWeight = inventory.weight;
  assert.ok(!ITEMS.shortSword.twoHanded);
  assert.equal(inventory.equipment.mainHand.id, 'shortSword');
  assert.equal(inventory.equipment.offHand, null);
  inventory.assignHotbar(4, 'woodenBuckler');

  const bucklerIndex = inventory.slots.findIndex((stack) => stack?.id === 'woodenBuckler');
  assert.equal(inventory.equip(bucklerIndex), true);
  assert.deepEqual(inventory.equipment.mainHand, { id: 'shortSword', count: 1 }, 'a one-handed sword stays drawn');
  assert.deepEqual(inventory.equipment.offHand, { id: 'woodenBuckler', count: 1 });
  assert.equal(inventory.getHotbar(4).source, 'equipment');

  const bowIndex = inventory.slots.findIndex((stack) => stack?.id === 'longbow');
  assert.equal(inventory.equip(bowIndex), true);
  assert.deepEqual(inventory.equipment.mainHand, { id: 'longbow', count: 1 });
  assert.equal(inventory.equipment.offHand, null);
  assert.equal(inventory.getHotbar(0).source, 'inventory', 'the stowed sword remains bound');
  assert.equal(inventory.getHotbar(4).source, 'inventory', 'the stowed buckler remains bound');
  assert.deepEqual(totals(), beforeCounts);
  assert.equal(inventory.weight, beforeWeight);

  const swordIndex = inventory.slots.findIndex((stack) => stack?.id === 'shortSword');
  assert.equal(inventory.equip(swordIndex), true);
  assert.deepEqual(inventory.equipment.mainHand, { id: 'shortSword', count: 1 });
  assert.equal(inventory.getHotbar(0).source, 'equipment');
  assert.deepEqual(totals(), beforeCounts);
  assert.equal(inventory.weight, beforeWeight);
  assert.deepEqual(inventory.events, [], 'equipment transfers are not new pickups');
});

test('a full bag can exchange conflicting sword and buckler in the vacated source slot', () => {
  for (const [initial, replacement, slot, clearedSlot] of [
    ['longbow', 'woodenBuckler', 'offHand', 'mainHand'],
    ['woodenBuckler', 'longbow', 'mainHand', 'offHand'],
  ]) {
    const inventory = emptyInventory();
    inventory.add(initial);
    inventory.equip(0);
    inventory.add(replacement);
    inventory.add('outlawHood', 23);
    assert.equal(inventory.slots.filter(Boolean).length, 24);
    const beforeWeight = inventory.weight;
    inventory.events.length = 0;

    assert.equal(inventory.equip(0), true, `equip ${replacement} over ${initial}`);
    assert.deepEqual(inventory.equipment[slot], { id: replacement, count: 1 });
    assert.equal(inventory.equipment[clearedSlot], null);
    assert.equal(inventory.slots.filter(Boolean).length, 24);
    assert.equal(carriedCount(inventory, initial), 1);
    assert.equal(carriedCount(inventory, replacement), 1);
    assert.equal(carriedCount(inventory, 'outlawHood'), 23);
    assert.equal(inventory.weight, beforeWeight);
    assert.deepEqual(inventory.events, []);
  }
});

test('stowing two pieces of an incompatible existing loadout is atomic when the bag is full', () => {
  const inventory = emptyInventory();
  // Earlier loadouts could hold the two-handed sword and buckler together.
  inventory.equipment.mainHand = { id: 'longbow', count: 1 };
  inventory.equipment.offHand = { id: 'woodenBuckler', count: 1 };
  inventory.add('longbow');
  inventory.add('outlawHood', 23);
  inventory.assignHotbar(0, 'longbow');
  inventory.assignHotbar(1, 'woodenBuckler');
  const before = inventoryState(inventory);

  assert.equal(inventory.equip(0), false, 'one vacated slot cannot hold two displaced pieces');
  assert.deepEqual(inventoryState(inventory), before);
  assert.equal(carriedCount(inventory, 'longbow'), 2);
  assert.equal(carriedCount(inventory, 'woodenBuckler'), 1);

  assert.equal(inventory.equip(1), true, 'equipping a helm opens the second bag slot');
  assert.equal(inventory.equip(0), true);
  assert.deepEqual(inventory.equipment.mainHand, { id: 'longbow', count: 1 });
  assert.equal(inventory.equipment.offHand, null);
  assert.equal(inventory.slots.filter(Boolean).length, 24);
  assert.equal(carriedCount(inventory, 'longbow'), 2);
  assert.equal(carriedCount(inventory, 'woodenBuckler'), 1);
  assert.equal(carriedCount(inventory, 'outlawHood'), 23);
  assert.equal(inventory.weight, before.weight);
  assert.equal(inventory.getHotbar(0).source, 'equipment');
  assert.equal(inventory.getHotbar(1).source, 'inventory');
  assert.deepEqual(inventory.events, before.events);
});

test('pickup events report actual quantities and failed adds or equipment transfers are silent', () => {
  const inventory = emptyInventory(ITEMS.longbow.weight * 2);
  assert.equal(inventory.add('longbow', 3), 2);
  assert.deepEqual(inventory.events, [{ type: 'pickup', id: 'longbow', count: 2 }]);
  assert.equal(inventory.add('longbow'), 0);
  assert.equal(inventory.add('missing-item'), 0);
  assert.deepEqual(inventory.events, [{ type: 'pickup', id: 'longbow', count: 2 }]);
  inventory.events.length = 0;

  assert.equal(inventory.move(0, 5), true);
  assert.equal(inventory.equip(5), true);
  assert.equal(inventory.unequip('mainHand'), true);
  assert.deepEqual(inventory.events, []);
  assert.equal(carriedCount(inventory, 'longbow'), 2);
});

test('the nine instruments are off-hand items that leave the main hand alone', async () => {
  const { INSTRUMENT_IDS } = await import('../src/audio/instruments.js');
  const { heldWeapon } = await import('../src/entities/loadout.js');
  for (const id of INSTRUMENT_IDS) {
    const item = ITEMS[id];
    assert.equal(item.equipmentSlot, 'offHand', id);
    assert.ok(item.tags.includes('instrument') && item.tags.includes('equipment'));
    assert.equal(item.stackLimit, 1);
    for (const key of ['weapon', 'twoHanded', 'use', 'durability']) assert.equal(item[key], undefined, `${id} ${key}`);
    assert.ok(item.name && item.shortName && item.description.endsWith('Carry it in the off hand to play.'));
    assert.ok(item.weight > 0 && item.weight < 5);
    assert.ok(Object.isFrozen(item) && Object.isFrozen(item.stats));
  }
  const inventory = emptyInventory();
  inventory.add('shortSword');
  inventory.equip(0);
  inventory.add('lute');
  assert.equal(inventory.equip(0), true);
  assert.deepEqual(inventory.equipment.offHand, { id: 'lute', count: 1 });
  assert.deepEqual(inventory.equipment.mainHand, { id: 'shortSword', count: 1 });
  assert.equal(heldWeapon(inventory.equipment).type, heldWeapon({ mainHand: { id: 'shortSword' } }).type);
  // A two-handed bow takes the instrument off, as it does the buckler.
  inventory.add('longbow');
  assert.equal(inventory.equip(inventory.slots.findIndex(stack => stack?.id === 'longbow')), true);
  assert.equal(inventory.equipment.offHand, null);
  assert.equal(carriedCount(inventory, 'lute'), 1);
  // All nine and the sword fit in a fresh bag.
  const bag = new Inventory({ starter: false });
  bag.add('shortSword');
  for (const id of INSTRUMENT_IDS) assert.equal(bag.add(id), 1, id);
});
