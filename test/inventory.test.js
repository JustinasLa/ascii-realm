import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Vitals } from '../src/entities/vitals.js';
import { ITEMS, EQUIPMENT_SLOTS, STACK_SLOTS, fitsSlot, slotsFor } from '../src/inventory/items.js';
import { Inventory, stackExtras } from '../src/inventory/inventory.js';

const emptyInventory = (capacity = 1000) => new Inventory({ starter: false, capacity });
const carriedCount = (inventory, id) => [...inventory.slots, ...Object.values(inventory.equipment)]
  .reduce((count, stack) => count + (stack?.id === id ? stack.count : 0), 0);
const inventoryState = (inventory) => structuredClone({
  slots: inventory.slots,
  equipment: inventory.equipment,
  weight: inventory.weight,
  events: inventory.events,
});

test('a new inventory exposes the bag and the twelve equipment slots, and no quick slots', () => {
  const inventory = new Inventory();
  assert.equal(inventory.slots.length, 24);
  assert.equal(inventory.capacity, 60);
  assert.deepEqual(Object.keys(inventory.equipment), [...EQUIPMENT_SLOTS]);
  assert.deepEqual(EQUIPMENT_SLOTS, ['helm', 'chest', 'legs', 'hands', 'cape', 'mainHand', 'offHand',
    'feet', 'amulet', 'ringLeft', 'ringRight', 'quiver']);
  for (const name of ['hotbar', 'selectedHotbar', 'assignHotbar', 'selectHotbar', 'cycleHotbar', 'getHotbar',
    'useSelected', 'findCarried']) assert.equal(inventory[name], undefined, name);
  assert.deepEqual(inventory.equipment.feet, { id: 'ridingBoots', count: 1 }, 'the starter boots are on the feet');
  assert.equal(inventory.equipment.legs, null);
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
  inventory.add('rawIron', 2);
  const beforeWeight = inventory.weight;
  assert.equal(inventory.move(0, 5), true);
  assert.equal(inventory.slots[0], null);
  assert.deepEqual(inventory.slots[5], { id: 'healingDraught', count: 3 });
  assert.equal(inventory.move(5, 1), true);
  assert.deepEqual(inventory.slots[1], { id: 'healingDraught', count: 3 });
  assert.deepEqual(inventory.slots[5], { id: 'rawIron', count: 2 });
  assert.equal(carriedCount(inventory, 'healingDraught'), 3);
  assert.equal(carriedCount(inventory, 'rawIron'), 2);
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
  assert.equal(inventory.add('rawIron', 1), 0);
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

test('a healing item consumes exactly once when needed and clamps actual restoration', () => {
  const inventory = emptyInventory();
  const vitals = new Vitals();
  inventory.add('healingDraught', 2);
  vitals.spendStamina(10);
  const fullHealthState = inventoryState(inventory);
  assert.equal(inventory.useItem(0, vitals), false, 'missing stamina does not justify a healing item');
  assert.deepEqual(inventoryState(inventory), fullHealthState);

  vitals.takeDamage(1);
  assert.equal(inventory.useItem(0, vitals), true);
  assert.equal(vitals.health, vitals.maxHealth);
  assert.equal(vitals.stamina, vitals.maxStamina - 10);
  assert.equal(carriedCount(inventory, 'healingDraught'), 1);
  assert.equal(inventory.countOf('healingDraught'), 1);
  assert.ok(Math.abs(inventory.weight - ITEMS.healingDraught.weight) < 1e-9);

  assert.equal(inventory.useItem(0, vitals), false);
  assert.equal(carriedCount(inventory, 'healingDraught'), 1);
  vitals.takeDamage(1);
  assert.equal(inventory.useItem(0, vitals), true);
  assert.equal(carriedCount(inventory, 'healingDraught'), 0);
  assert.equal(inventory.slots.filter(Boolean).length, 0);
  assert.equal(inventory.useItem(0, vitals), false, 'an exhausted stack is gone');
  assert.equal(inventory.weight, 0);
});

test('a refused restoration never consumes an item', () => {
  const inventory = emptyInventory();
  inventory.add('healingDraught');
  const before = inventoryState(inventory);
  const vitals = { health: 50, maxHealth: 100, stamina: 100, maxStamina: 100, heal: () => 0 };
  assert.equal(inventory.useItem(0, vitals), false);
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

  const bucklerIndex = inventory.slots.findIndex((stack) => stack?.id === 'woodenBuckler');
  assert.equal(inventory.equip(bucklerIndex), true);
  assert.deepEqual(inventory.equipment.mainHand, { id: 'shortSword', count: 1 }, 'a one-handed sword stays drawn');
  assert.deepEqual(inventory.equipment.offHand, { id: 'woodenBuckler', count: 1 });

  const bowIndex = inventory.slots.findIndex((stack) => stack?.id === 'longbow');
  assert.equal(inventory.equip(bowIndex), true);
  assert.deepEqual(inventory.equipment.mainHand, { id: 'longbow', count: 1 });
  assert.equal(inventory.equipment.offHand, null);
  assert.ok(inventory.slots.some((stack) => stack?.id === 'shortSword'), 'the sword is stowed');
  assert.ok(inventory.slots.some((stack) => stack?.id === 'woodenBuckler'), 'the buckler is stowed');
  assert.deepEqual(totals(), beforeCounts);
  assert.equal(inventory.weight, beforeWeight);

  const swordIndex = inventory.slots.findIndex((stack) => stack?.id === 'shortSword');
  assert.equal(inventory.equip(swordIndex), true);
  assert.deepEqual(inventory.equipment.mainHand, { id: 'shortSword', count: 1 });
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

test('alloy ids and scrap inputs are kept only when well formed', () => {
  for (const alloy of ['a1', 'a9', 'a42', 'a9999']) assert.deepEqual(stackExtras({ alloy }), { alloy });
  for (const alloy of ['b1', 'a0', 'a01', 'a12345', 'A1', ' a1', 1, null, ['a1']]) {
    assert.deepEqual(stackExtras({ alloy }), {}, String(alloy));
  }
  const inputs = stackExtras({ inputs: { rawTin: 1, ironIngot: 2, lapisLazuli: 1 } }).inputs;
  assert.deepEqual(Object.keys(inputs), ['ironIngot', 'lapisLazuli', 'rawTin']);
  assert.ok(Object.isFrozen(inputs));
  for (const bad of [
    { nothing: 1 }, { rawTin: 0 }, { rawTin: 6 }, { rawTin: 1.5 }, { rawTin: '1' }, {},
    { ironIngot: 1, steelIngot: 1, bronzeIngot: 1, copperIngot: 1, rawTin: 1, lapisLazuli: 1 },
    [['rawTin', 1]], 'rawTin', null, { toString: 1 },
  ]) assert.deepEqual(stackExtras({ inputs: bad }), {}, JSON.stringify(bad));
  assert.deepEqual(Object.keys(stackExtras({ inputs: { rawTin: 1 }, alloy: 'a2', material: 'steel', other: 1 })),
    ['material', 'alloy', 'inputs']);
});

test('different alloys and scrap from different mixes never merge', () => {
  const inventory = emptyInventory();
  const tin = { ironIngot: 1, rawTin: 1 };
  assert.equal(inventory.add('alloyIngot', 2, { alloy: 'a1' }), 2);
  assert.equal(inventory.add('alloyIngot', 1, { alloy: 'a2' }), 1);
  assert.equal(inventory.add('alloyIngot', 3, { alloy: 'a1' }), 3);
  assert.equal(inventory.add('unusableScrap', 1, { inputs: tin }), 1);
  assert.equal(inventory.add('unusableScrap', 1, { inputs: { rawTin: 1, ironIngot: 1 } }), 1);
  assert.equal(inventory.add('unusableScrap', 1, { inputs: { ironIngot: 1, lapisLazuli: 1 } }), 1);
  assert.deepEqual(inventory.slots.slice(0, 4), [
    { id: 'alloyIngot', count: 5, alloy: 'a1' }, { id: 'alloyIngot', count: 1, alloy: 'a2' },
    { id: 'unusableScrap', count: 2, inputs: tin }, { id: 'unusableScrap', count: 1, inputs: { ironIngot: 1, lapisLazuli: 1 } },
  ]);
  assert.equal(inventory.move(1, 0), true);
  assert.deepEqual(inventory.slots.slice(0, 2).map((stack) => stack.alloy), ['a2', 'a1'], 'swapped, not merged');
  assert.deepEqual(inventory.remove(1, 2), { id: 'alloyIngot', count: 2, alloy: 'a1' });

  inventory.slots = Array.from({ length: 24 }, () => ({ id: 'longbow', count: 1 }));
  inventory.slots[0] = { id: 'alloyIngot', count: 1, alloy: 'a2' };
  assert.equal(inventory.spaceFor('alloyIngot', 1, { alloy: 'a1' }), 0);
  assert.equal(inventory.spaceFor('alloyIngot', 1, { alloy: 'a2' }), 1);
});

test('boots go on the feet and leave the legs empty', () => {
  const inventory = emptyInventory();
  inventory.add('ridingBoots');
  assert.equal(inventory.targetSlotFor('ridingBoots'), 'feet');
  assert.equal(inventory.equip(0), true);
  assert.deepEqual(inventory.equipment.feet, { id: 'ridingBoots', count: 1 });
  assert.equal(inventory.equipment.legs, null);
  assert.equal(inventory.unequip('legs'), false);
  assert.equal(inventory.unequip('feet'), true);
});

test('a ring kind fills the left ring, then the right, then replaces the left', () => {
  const ring = { equipmentSlot: 'ring' };
  assert.deepEqual(slotsFor(ring), ['ringLeft', 'ringRight']);
  assert.ok(fitsSlot(ring, 'ringRight'));
  assert.equal(fitsSlot(ring, 'helm'), false);
  for (const slot of ['constructor', '__proto__', 'toString', 'nowhere', undefined, 7]) {
    assert.deepEqual(slotsFor({ equipmentSlot: slot }), [], String(slot));
  }
  assert.deepEqual(slotsFor(null), []);
  assert.deepEqual(slotsFor(ITEMS.arrow), ['quiver']);
  assert.deepEqual(STACK_SLOTS, ['quiver']);

  const inventory = emptyInventory();
  assert.equal(inventory.targetSlot(ring), 'ringLeft');
  inventory.equipment.ringLeft = { id: 'ring', count: 1 };
  assert.equal(inventory.targetSlot(ring), 'ringRight');
  inventory.equipment.ringRight = { id: 'ring', count: 1 };
  assert.equal(inventory.targetSlot(ring), 'ringLeft');
  assert.equal(inventory.targetSlot(ring, 'ringRight'), 'ringRight');
  assert.equal(inventory.targetSlot(ring, 'helm'), null);
  assert.equal(inventory.targetSlot({}), null);
  assert.equal(inventory.targetSlotFor('missing-item'), null);
  assert.equal(inventory.targetSlotFor('outlawHood', 'helm'), 'helm');
  inventory.add('outlawHood');
  assert.equal(inventory.equip(0, 'chest'), false, 'gear never goes into a slot it does not fit');
  assert.equal(inventory.equip(0, 'helm'), true);
});

test('arrows fill the quiver as a whole stack, merge up to 40 and swap other stacks', () => {
  const inventory = emptyInventory();
  inventory.add('arrow', 30);
  const weight = inventory.weight;
  assert.equal(inventory.equip(0), true);
  assert.deepEqual(inventory.equipment.quiver, { id: 'arrow', count: 30 });
  assert.equal(inventory.slots[0], null);
  assert.equal(inventory.weight, weight);

  // Placed by hand, as a pickup would top the quiver up first.
  inventory.slots[0] = { id: 'arrow', count: 25 };
  assert.equal(inventory.equip(0), true);
  assert.equal(inventory.equipment.quiver.count, 40);
  assert.deepEqual(inventory.slots[0], { id: 'arrow', count: 15 });
  const full = inventoryState(inventory);
  assert.equal(inventory.equip(0), false, 'a full quiver of the same arrows refuses');
  assert.deepEqual(inventoryState(inventory), full);

  // Arrows of another make swap places with the quiver's.
  inventory.slots[0].material = 'iron';
  assert.equal(inventory.equip(0), true);
  assert.deepEqual(inventory.equipment.quiver, { id: 'arrow', count: 15, material: 'iron' });
  assert.deepEqual(inventory.slots[0], { id: 'arrow', count: 40 });

  assert.equal(inventory.unequip('quiver'), true);
  assert.equal(inventory.equipment.quiver, null);
  assert.equal(inventory.countOf('arrow'), 55);
  assert.equal(inventory.weight, weight + 25 * ITEMS.arrow.weight);
});

test('taking the quiver off refuses when the bag cannot take the whole stack', () => {
  const inventory = emptyInventory();
  inventory.add('arrow', 20);
  inventory.equip(0);
  inventory.add('outlawHood', 24);
  const before = inventoryState(inventory);
  assert.equal(inventory.unequip('quiver'), false);
  assert.deepEqual(inventoryState(inventory), before);
});

test('shots take arrows from the quiver first, then from the first bag stack', () => {
  const inventory = emptyInventory();
  inventory.add('arrow', 2, { material: 'iron' });
  inventory.equip(0);
  inventory.add('longbow');
  inventory.add('arrow', 1);
  inventory.move(1, 5);
  inventory.add('arrow', 1, { material: 'steel' });
  assert.equal(inventory.countOf('arrow'), 4);
  assert.equal(inventory.nextAmmo('arrow'), inventory.equipment.quiver);
  assert.deepEqual(inventory.takeAmmo('arrow'), { id: 'arrow', count: 1, material: 'iron' });
  assert.deepEqual(inventory.takeAmmo('arrow'), { id: 'arrow', count: 1, material: 'iron' });
  assert.equal(inventory.equipment.quiver, null, 'an empty quiver is cleared');
  assert.deepEqual(inventory.takeAmmo('arrow'), { id: 'arrow', count: 1, material: 'steel' }, 'the lowest bag slot goes first');
  assert.deepEqual(inventory.takeAmmo('arrow'), { id: 'arrow', count: 1 });
  assert.equal(inventory.takeAmmo('arrow'), null);
  assert.equal(inventory.countOf('arrow'), 0);
  assert.deepEqual(inventory.slots.filter(Boolean), [{ id: 'longbow', count: 1 }]);
});

test('pickups top up a quiver of the same arrows first, but never fill an empty one', () => {
  const inventory = emptyInventory();
  assert.equal(inventory.add('arrow', 10), 10);
  assert.equal(inventory.equipment.quiver, null, 'an empty quiver stays empty');
  inventory.add('arrow', 25);
  inventory.equip(0);
  assert.equal(inventory.equipment.quiver.count, 35);
  assert.equal(inventory.add('arrow', 10), 10);
  assert.equal(inventory.equipment.quiver.count, 40);
  assert.deepEqual(inventory.slots[0], { id: 'arrow', count: 5 });
  assert.deepEqual(inventory.events.at(-1), { type: 'pickup', id: 'arrow', count: 10 });
  // Arrows of another make go to the bag.
  assert.equal(inventory.add('arrow', 1, { material: 'iron' }), 1);
  assert.equal(inventory.equipment.quiver.count, 40);

  // The quiver's room counts with a full bag, and the carrying limit still applies.
  const full = emptyInventory();
  full.add('arrow', 30);
  full.equip(0);
  full.add('outlawHood', 24);
  assert.equal(full.spaceFor('arrow', 20), 10);
  assert.equal(full.add('arrow', 20), 10);
  assert.equal(full.equipment.quiver.count, 40);
  const heavy = emptyInventory(ITEMS.arrow.weight * 35);
  heavy.add('arrow', 30);
  heavy.equip(0);
  assert.equal(heavy.spaceFor('arrow', 20), 5);
  assert.equal(heavy.add('arrow', 20), 5);
  assert.equal(heavy.equipment.quiver.count, 35);
  assert.equal(heavy.slots.filter(Boolean).length, 0);
});
