import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HuntDrops, MAX_STACKS } from '../src/entities/hunt-drops.js';
import { Collection } from '../src/inventory/collection.js';
import { Inventory } from '../src/inventory/inventory.js';
import { Wallet } from '../src/inventory/wallet.js';
import { layLoot } from '../src/world/loot.js';
import { ASPECT, GRASS } from '../src/world/world.js';

// Open, loaded land, a drop store and a collection paying into a pouch.
function setup({ wallet = new Wallet({ storage: null }) } = {}) {
  const world = { isWalkable: () => true, typeAt: () => GRASS, loaded: () => ({ props: [] }) };
  const inventory = new Inventory({ starter: false });
  const drops = new HuntDrops();
  const collection = new Collection(world, inventory, drops.items, null, wallet);
  const player = { x: 0.5, y: 0.5, heading: 0, air: 0, windUp: -1, walk: 1, combat: { busy: false } };
  return { world, inventory, drops, collection, player, wallet };
}

const lay = (drops, id, count, x, y) => {
  const item = drops.items.add(id, count, x, y);
  drops.laid.set(item, drops.items.time);
  return item;
};

const fill = (inventory) => {
  inventory.slots = Array.from({ length: inventory.slots.length }, () => ({ id: 'longbow', count: 1 }));
};

test('coin walked over goes to the pouch for its count in cents and leaves the ground', () => {
  const { drops, collection, player, wallet } = setup();
  const coin = lay(drops, 'denars', 73, player.x + 0.5, player.y);
  collection.update(0, player);
  assert.equal(wallet.cents, 73);
  assert.equal(coin.count, 0);
  assert.deepEqual(drops.all(), []);
  assert.deepEqual(collection.events, [{ type: 'coin', cents: 73, x: coin.x, y: coin.y }]);
});

test('a full bag still draws coin in and takes it, while an ingot beside it stays', () => {
  const { inventory, drops, collection, player, wallet } = setup();
  fill(inventory);
  const coin = lay(drops, 'denars', 100, player.x + 4 / ASPECT, player.y);
  const ingot = lay(drops, 'ironIngot', 1, player.x + 4 / ASPECT, player.y + 0.5);
  const at = { x: ingot.x, y: ingot.y };
  for (let i = 0; i < 10; i++) collection.update(0.1, player);
  assert.equal(wallet.cents, 100);
  assert.equal(coin.count, 0);
  assert.equal(ingot.count, 1);
  assert.deepEqual({ x: ingot.x, y: ingot.y }, at, 'the ingot is not drawn in');
  assert.deepEqual(drops.all(), [ingot]);
});

test('without a pouch coin is never taken', () => {
  const { drops, collection, player } = setup({ wallet: null });
  const coin = lay(drops, 'denars', 50, player.x, player.y);
  collection.update(0, player);
  assert.equal(collection.interact(player).status, 'empty');
  assert.equal(coin.count, 50);
  assert.equal(collection.prompt(player), '');
});

test('a coin already paid is not paid again, and still leaves the ground', () => {
  const { drops, collection, player, wallet } = setup();
  const coin = lay(drops, 'denars', 40, player.x, player.y);
  assert.equal(collection.interact(player).message, '+0.40d');
  // The same stack back on the ground, as if laid twice.
  const again = lay(drops, 'denars', 40, player.x, player.y);
  again.uid = coin.uid;
  const refused = collection.interact(player);
  assert.equal(refused.ok, false);
  assert.equal(refused.status, 'paid');
  assert.equal(wallet.cents, 40);
  assert.equal(again.count, 0);
  assert.deepEqual(drops.all(), []);
  assert.equal(collection.events.length, 1);
});

test('a taken coin no longer counts against the drop store\'s room', () => {
  const { world, drops, collection, player } = setup();
  const store = drops;
  const far = { x: player.x + 40, y: player.y + 40 };
  const [kept] = layLoot(store, world, { ...far, killer: far, items: [{ id: 'bone', count: 1 }] });
  const coin = lay(store, 'denars', 60, player.x, player.y);
  coin.pickupAfter = 0;
  collection.update(0, player);
  assert.equal(coin.count, 0);
  store.expire(store.items.time);
  // Fill the store to its cap beside the kept bone: none of it is lost.
  for (let i = 0; i < MAX_STACKS - 1; i++) layLoot(store, world, { ...far, killer: far, items: [{ id: 'arrow', count: 1 }] });
  assert.ok(store.all().includes(kept), 'the bone laid before the coin is still there');
  assert.equal(store.all().length, MAX_STACKS);
});

test('E over coin offers its value, full bag or not', () => {
  const { inventory, drops, collection, player } = setup();
  lay(drops, 'denars', 73, player.x, player.y);
  assert.equal(collection.prompt(player), 'E Pick up 0.73d');
  fill(inventory);
  assert.equal(collection.prompt(player), 'E Pick up 0.73d');
});
