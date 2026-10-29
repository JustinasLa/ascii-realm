import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Player } from '../src/entities/player.js';
import { Collection } from '../src/inventory/collection.js';
import { Inventory, stackExtras } from '../src/inventory/inventory.js';
import { playerState, PROTOCOL_VERSION, readEquipment, readPlayerState } from '../src/multiplayer/protocol.js';
import { GroundItems } from '../src/world/items.js';
import { GRASS } from '../src/world/world.js';

const FORGED = {
  metal: 'Blackiron', colour: '5E6568', quality: 'gleaming', hits: 92,
  stats: { attackDamage: 3.84, bluntRating: 46.25, durability: 429.5, projectileDamage: 0.3 },
  inputs: { a1: 3, ironIngot: 1 },
};
const IRON = { metal: 'Iron', quality: 'tempered', hits: 60, stats: { attackDamage: 3.5, durability: 500 }, inputs: { ironIngot: 4 } };

test('a stack keeps its forging after its other properties, and only a valid one', () => {
  const extras = stackExtras({ id: 'shortSword', forged: FORGED, material: 'iron', inputs: { ironIngot: 1 }, alloy: 'a1' });
  assert.deepEqual(Object.keys(extras), ['material', 'alloy', 'inputs', 'forged']);
  assert.deepEqual(extras.forged, FORGED);
  assert.ok(Object.isFrozen(extras.forged));
  assert.deepEqual(stackExtras({ id: 'shortSword', forged: { ...FORGED, hits: 101 } }), {});
  assert.deepEqual(stackExtras({ id: 'shortSword', material: 'forged' }), {});
});

test('a forged sword keeps its forging through the bag and the hands, and never merges', () => {
  const inventory = new Inventory({ starter: false });
  inventory.add('shortSword', 1, { forged: FORGED });
  inventory.add('shortSword', 1, { material: 'iron', forged: IRON });
  inventory.add('shortSword', 1);
  assert.deepEqual(inventory.slots.slice(0, 4).map((s) => s && (s.forged?.metal ?? 'plain')), ['Blackiron', 'Iron', 'plain', null]);
  assert.equal(inventory.move(0, 5), true);
  assert.equal(inventory.equip(5), true);
  assert.deepEqual(inventory.equipment.mainHand, { id: 'shortSword', count: 1, forged: FORGED });
  assert.equal(inventory.equip(1), true, 'the forged iron sword replaces it');
  assert.deepEqual(inventory.equipment.mainHand, { id: 'shortSword', count: 1, material: 'iron', forged: IRON });
  assert.ok(inventory.slots.some((s) => s?.forged?.metal === 'Blackiron'), 'the alloy sword went back to the bag');
  assert.equal(inventory.unequip('mainHand'), true);
  const back = inventory.slots.find((s) => s?.forged?.metal === 'Iron');
  assert.deepEqual(back, { id: 'shortSword', count: 1, material: 'iron', forged: IRON });
  assert.deepEqual(inventory.remove(inventory.slots.indexOf(back), 1), { id: 'shortSword', count: 1, material: 'iron', forged: IRON });
});

test('a forged alloy sword dropped and walked back over comes back with every property', () => {
  const chunks = new Map();
  const world = {
    isWalkable: () => true, typeAt: () => GRASS, propsIn: () => [],
    chunk(cx, cy) {
      const key = `${cx},${cy}`;
      if (!chunks.has(key)) chunks.set(key, { cx, cy, items: [], resources: [] });
      return chunks.get(key);
    },
  };
  const inventory = new Inventory({ starter: false });
  const collection = new Collection(world, inventory, new GroundItems(world));
  const player = { x: 0.5, y: 0.5, heading: 0, air: 0, windUp: -1, walk: 1, combat: { busy: false } };
  inventory.add('shortSword', 1, { forged: FORGED });
  const dropped = collection.drop(player, 0);
  assert.deepEqual(dropped.item.extras, { forged: FORGED });
  assert.equal(inventory.slots[0], null);
  player.y += 20;
  collection.update(1, player);
  player.x = dropped.item.x;
  player.y = dropped.item.y;
  collection.update(0, player);
  assert.deepEqual(inventory.slots[0], { id: 'shortSword', count: 1, forged: FORGED });
});

test('friends get a forged weapon\'s look, never its stats; old stacks read as before', () => {
  assert.equal(PROTOCOL_VERSION, 5);
  for (const material of ['stone', 'copper', 'bronze', 'iron', 'steel']) {
    assert.deepEqual(readEquipment({ mainHand: { id: 'shortSword', material } }).mainHand, { id: 'shortSword', count: 1, material });
  }
  assert.deepEqual(readEquipment({ mainHand: { id: 'shortSword', material: 'gold' } }).mainHand, { id: 'shortSword', count: 1 });
  assert.deepEqual(readEquipment({ mainHand: { id: 'shortSword', count: 1, forged: FORGED } }).mainHand,
    { id: 'shortSword', count: 1, forged: { metal: 'Blackiron', colour: '5E6568' } });
  assert.deepEqual(readEquipment({ mainHand: { id: 'dagger', material: 'iron', forged: IRON } }).mainHand,
    { id: 'dagger', count: 1, material: 'iron', forged: { metal: 'Iron' } });
  for (const forged of [{ metal: 'Blackiron', colour: '5e6568' }, { metal: 'Black1ron' }, { colour: '5E6568' }, 'Blackiron']) {
    assert.deepEqual(readEquipment({ mainHand: { id: 'shortSword', forged } }).mainHand, { id: 'shortSword', count: 1 }, JSON.stringify(forged));
  }
  // What a player sends, and what a friend reads back.
  const player = new Player(0, 0);
  player.equipment = { ...new Inventory().equipment, mainHand: { id: 'shortSword', count: 1, forged: FORGED } };
  const state = playerState(player);
  assert.deepEqual(state.equipment.mainHand, { id: 'shortSword', count: 1, forged: { metal: 'Blackiron', colour: '5E6568' } });
  const sent = JSON.stringify(state.equipment.mainHand);
  assert.ok(sent.length < 80, `${sent.length} bytes`);
  const friend = new Player(0, 0);
  friend.equipment = readPlayerState(JSON.parse(JSON.stringify(state))).equipment;
  assert.deepEqual(friend.weapon.materialColor, [0x5e, 0x65, 0x68]);
});
