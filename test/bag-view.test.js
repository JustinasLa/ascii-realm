import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeWeapon, makeWeapon } from '../src/crafting/smithing.js';
import { INSTRUMENT_ITEMS } from '../src/inventory/instrument-items.js';
import { Inventory } from '../src/inventory/inventory.js';
import { ITEMS } from '../src/inventory/items.js';
import { BAG_TABS, bagView, cardLabel, itemKind, materialOf } from '../src/ui/bag-view.js';

test('every item falls under one of the bag tabs', () => {
  const kinds = (ids) => ids.map((id) => itemKind(ITEMS[id]));
  const all = (ids, kind) => assert.deepEqual(kinds(ids), ids.map(() => kind), kind);
  all(['shortSword', 'longbow', 'stonePickaxe', 'javelin', 'dagger'], 'weapons');
  all(['outlawHood', 'leatherJerkin', 'ridingBoots', 'leatherBracers', 'woodenBuckler'], 'armor');
  all(['travelCloak'], 'cloaks');
  all(['arrow'], 'ammo');
  all(['healingDraught', 'staminaTonic', 'bandage'], 'consumables');
  all(INSTRUMENT_ITEMS.map((item) => item.id), 'instruments');
  all(['rawIron', 'ironIngot', 'oakLog', 'flint', 'unusableScrap', 'alloyIngot'], 'materials');
  // Forage and raw meat have no use yet, so they are materials too.
  for (const item of Object.values(ITEMS).filter((entry) => entry.tags.includes('food'))) {
    assert.equal(itemKind(item), 'materials', item.id);
  }
  assert.equal(itemKind(undefined), 'materials', 'an unknown item');
  assert.equal(itemKind({ equipmentSlot: 'ring' }), 'armor');
  assert.equal(itemKind({ equipmentSlot: 'amulet' }), 'armor');
  assert.equal(itemKind({ tags: ['ammo'] }), 'ammo');

  const tabs = BAG_TABS.map((tab) => tab.id).filter((id) => id !== 'all');
  for (const item of Object.values(ITEMS)) assert.ok(tabs.includes(itemKind(item)), item.id);
  assert.ok(Object.isFrozen(BAG_TABS) && BAG_TABS.every(Object.isFrozen));
});

test('the bag view counts stacks per tab and lists the shown cards in slot order', () => {
  const inventory = new Inventory();
  const view = bagView(inventory.slots);
  assert.equal(view.used, 15);
  assert.equal(view.total, 24);
  assert.equal(view.filter, 'all');
  assert.deepEqual(view.tabs.map(({ id, count }) => `${id} ${count}`),
    ['all 15', 'weapons 8', 'armor 1', 'cloaks 0', 'ammo 1', 'consumables 3', 'materials 2']);
  assert.deepEqual(view.visible, inventory.slots.flatMap((stack, index) => stack ? [index] : []));
  assert.deepEqual(view.tabs[0], { id: 'all', label: 'All', count: 15 });

  const at = (id) => inventory.slots.findIndex((stack) => stack?.id === id);
  assert.deepEqual(bagView(inventory.slots, 'consumables').visible,
    [at('healingDraught'), at('staminaTonic'), at('bandage')], 'three draughts are one stack');
  assert.deepEqual(bagView(inventory.slots, 'armor').visible, [at('woodenBuckler')]);
  const cloaks = bagView(inventory.slots, 'cloaks');
  assert.equal(cloaks.filter, 'cloaks', 'a fixed tab stays chosen while empty');
  assert.deepEqual(cloaks.visible, []);

  // Optional tabs show only while the bag holds their kind.
  assert.equal(view.tabs.some((tab) => tab.id === 'instruments'), false);
  assert.equal(bagView(inventory.slots, 'instruments').filter, 'all');
  inventory.add('lute');
  const lute = bagView(inventory.slots, 'instruments');
  assert.equal(lute.filter, 'instruments');
  assert.deepEqual(lute.visible, [at('lute')]);
  assert.deepEqual(lute.tabs.map((tab) => tab.id).slice(4), ['ammo', 'consumables', 'instruments', 'materials']);

  for (const junk of ['constructor', '__proto__', '', undefined]) assert.equal(bagView(inventory.slots, junk).filter, 'all');
  // Unknown stacks are not counted.
  const odd = [null, { id: 'nothing', count: 1 }, { id: 'arrow', count: 2 }];
  assert.deepEqual(bagView(odd), { used: 1, total: 3, filter: 'all', visible: [2],
    tabs: [['all', 'All', 1], ['weapons', 'Weapons', 0], ['armor', 'Armor', 0], ['cloaks', 'Cloaks', 0], ['ammo', 'Ammo', 1]]
      .map(([id, label, count]) => ({ id, label, count })) });
});

test('a card reads the stack count for stackables and the material for gear', () => {
  const label = (stack, own) => cardLabel(stack, ITEMS[stack.id], own);
  assert.equal(label({ id: 'arrow', count: 30 }), '×30');
  assert.equal(label({ id: 'healingDraught', count: 1 }), '×1', 'even one of a stackable');
  assert.equal(label({ id: 'shortSword', count: 1 }), 'iron');
  assert.equal(label({ id: 'longbow', count: 1 }), 'yew');
  assert.equal(label({ id: 'outlawHood', count: 1 }), 'wool');
  assert.equal(label({ id: 'shortSword', count: 1 }, { stats: { Material: 'Blackiron' } }), 'blackiron');
  assert.equal(label({ id: 'shortSword', count: 1 }, { stats: null }), 'iron', 'an alloy book without the entry');
  assert.equal(cardLabel({ id: 'x', count: 1 }, { stackLimit: 1, stats: {} }), '');
  assert.equal(cardLabel({ id: 'x', count: 1 }, { stackLimit: 1 }), '');

  // A forged sword reports its own metal, not its iron base's.
  const book = { get: () => null };
  const { id, count, ...extras } = makeWeapon('shortSword', ['steelIngot', 'steelIngot', 'steelIngot', 'ironIngot'], 92,
    book.get);
  const sword = { id, count, ...extras };
  const own = describeWeapon(sword, book);
  assert.equal(own.stats.Material, 'Steel');
  assert.equal(label(sword, own), 'steel');
  assert.equal(materialOf(ITEMS.shortSword, own), 'Steel');
  assert.equal(materialOf(ITEMS.shortSword), 'Iron');
  assert.equal(materialOf({ stats: { Material: 'Bone' } }), 'Bone');
  assert.equal(materialOf(undefined), null);
});
