import assert from 'node:assert/strict';
import test from 'node:test';
import { HuntDrops } from '../src/entities/hunt-drops.js';
import { Collection } from '../src/inventory/collection.js';
import { Inventory } from '../src/inventory/inventory.js';
import { Harvesting } from '../src/world/harvesting.js';
import { layLoot } from '../src/world/loot.js';
import { blowsFor, canHarvest, Mining, OTHER_BLOWS, rollDrops, toolOf } from '../src/world/mining.js';
import { minedKey, ORES } from '../src/world/ore-veins.js';
import { mulberry32 } from '../src/core/rng.js';
import { World } from '../src/world/world.js';

// A world with an ore block found near spawn; chunk (-1, -2) of seed 1 holds
// a tin vein beside a big rock and a coal vein in front of it.
function field(options = {}) {
  const world = new World(1);
  const ores = world.propsOf(-1, -2).filter((p) => p.ore);
  const drops = [];
  const mining = new Mining(world, { drop: (items, block) => drops.push([items, block]), random: () => 0, ...options });
  return { world, ores, drops, mining };
}
const of = (ores, kind) => ores.find((b) => b.ore === kind);
// A player standing `rows` below a block, facing it (north is heading π).
const below = (block, rows = 3) => ({ x: block.x, y: block.y + rows, heading: Math.PI, feel: { reach: 0.95 } });
const swing = (player, rows = 3) => ({ type: 'strike', x: player.x, y: player.y - rows });

test('blows and tiers follow the classic pickaxes', () => {
  assert.deepEqual([blowsFor('stone'), blowsFor('wood'), blowsFor(null), blowsFor('bogus')], [3, 6, 40, OTHER_BLOWS]);
  for (const ore of Object.keys(ORES)) {
    assert.equal(canHarvest('stone', ore), true);
    assert.equal(canHarvest('wood', ore), ore === 'coal');
    assert.equal(canHarvest(null, ore), false);
  }
  assert.equal(toolOf({ mainHand: { id: 'stonePickaxe', count: 1 } }), 'stone');
  assert.equal(toolOf({ mainHand: { id: 'shortSword', count: 1 } }), null);
  assert.equal(toolOf({ mainHand: null }), null);
  assert.equal(toolOf({}), null);
  assert.equal(toolOf(undefined), null);
});

test('drops are the classic counts, within their bounds', () => {
  const ends = (ore) => [rollDrops(ore, () => 0)[0].count, rollDrops(ore, () => 0.9999)[0].count];
  assert.deepEqual(ends('copper'), [2, 5]);
  assert.deepEqual(ends('lapis'), [4, 9]);
  for (const ore of ['coal', 'iron', 'tin']) assert.deepEqual(ends(ore), [1, 1]);
  assert.deepEqual(rollDrops('iron')[0], { id: 'rawIron', count: 1 });
  assert.equal(rollDrops('coal')[0].id, 'coal');
  const random = mulberry32(7);
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const { id, count } = rollDrops('lapis', random)[0];
    assert.equal(id, 'lapisLazuli');
    assert.ok(count >= 4 && count <= 9);
    seen.add(count);
  }
  assert.ok(seen.has(4) && seen.has(9));
});

test('a stone pickaxe breaks a block in three blows; it is gone for good and the grass grows back', () => {
  const { world, ores, drops, mining } = field();
  const tin = of(ores, 'tin');
  const cell = world.locate(Math.floor(tin.x), Math.floor(tin.y));
  assert.equal(cell.c.grassHeight[cell.i], 0, 'bare under the block');
  assert.deepEqual([1, 2].map(() => mining.strike(tin, 'stone')).map((r) => [r.status, r.message]),
    [['hit', 'Mining tin ore: 1/3'], ['hit', 'Mining tin ore: 2/3']]);
  const done = mining.strike(tin, 'stone');
  assert.deepEqual([done.status, done.message, done.rewards], ['mined', 'Mined tin ore.', [{ id: 'rawTin', count: 1 }]]);
  assert.deepEqual(drops, [[[{ id: 'rawTin', count: 1 }], tin]]);
  assert.ok(!world.propsIn(tin.x - 1, tin.y - 1, tin.x + 1, tin.y + 1).includes(tin));
  assert.ok(world.mined.has(minedKey(tin)) && tin.mined);
  assert.ok(world.isWalkable(tin.x, tin.y));
  assert.ok(cell.c.grassHeight[cell.i] > 0, 'grass is back');
  // The vein's other blocks stay; leaving the chunk and coming back keeps
  // this one gone and forgets unfinished blows on the others.
  const other = ores.find((b) => b !== tin);
  mining.strike(other, 'stone');
  world.chunks.delete('-1,-2');
  const again = world.propsOf(-1, -2).filter((p) => p.ore);
  assert.equal(again.length, ores.length - 1);
  assert.ok(!again.some((b) => b.x === tin.x && b.y === tin.y));
  assert.equal(again.find((b) => b.x === other.x && b.y === other.y).hits, undefined);
});

test('the wrong tool or tier takes longer and the block crumbles to nothing', () => {
  const { ores, drops, mining } = field();
  const [tin, coal] = [of(ores, 'tin'), of(ores, 'coal')];
  let result;
  for (let i = 0; i < 39; i++) assert.equal(mining.strike(coal, null).status, 'hit');
  result = mining.strike(coal, null);
  assert.deepEqual([result.status, result.message], ['crumbled', 'The coal ore crumbles: it needs a pickaxe.']);
  for (let i = 0; i < 6; i++) result = mining.strike(tin, 'wood');
  assert.deepEqual([result.status, result.message], ['crumbled', 'The tin ore crumbles: it needs a stone pickaxe.']);
  assert.equal(drops.length, 0);
  const wooden = ores.filter((b) => b.ore === 'coal')[1];
  for (let i = 0; i < 6; i++) result = mining.strike(wooden, 'wood');
  assert.deepEqual([result.status, result.rewards], ['mined', [{ id: 'coal', count: 1 }]]);
});

test('a strike hits the nearest reachable block in its path, once', () => {
  const { ores, mining } = field();
  const coal = ores.filter((b) => b.ore === 'coal').sort((a, b) => a.y - b.y || a.x - b.x);
  const front = coal.at(-1);
  const player = below(front);
  assert.deepEqual(mining.react({ type: 'slam', x: front.x, y: front.y }, player, 'stone'), []);
  const event = swing(player);
  const [result] = mining.react(event, player, 'stone');
  assert.equal(result.block, front);
  assert.deepEqual(mining.react(event, player, 'stone'), [], 'the same strike counts once');
  assert.deepEqual(mining.react({ type: 'strike', x: player.x, y: player.y + 6 }, player, 'stone'), [], 'swung away');
  // A block nobody can reach is passed over.
  const walled = new Mining(field().world, { reachable: () => false });
  assert.deepEqual(walled.react(swing(player), player, 'stone'), []);
});

test('the prompt names the block the player faces and what it needs', () => {
  const { ores, mining } = field();
  const coal = ores.filter((b) => b.ore === 'coal').sort((a, b) => b.y - a.y)[0];
  const player = below(coal);
  assert.equal(mining.nearby(player, 'stone').prompt, 'Coal ore · stone pickaxe');
  assert.equal(mining.nearby(player, null).prompt, 'Coal ore · needs a pickaxe');
  assert.equal(mining.nearby(player, 'wood').ok, true);
  // Turned around, the block behind is not offered.
  assert.equal(mining.nearby({ ...player, heading: 0 }, 'stone'), null);
  assert.equal(mining.nearby({ ...player, y: coal.y + 12 }, 'stone'), null, 'out of reach');
  const tin = of(ores, 'tin');
  const facing = { x: tin.x + 6, y: tin.y, heading: -Math.PI / 2 };
  assert.equal(mining.nearby(facing, null).prompt, 'Tin ore · needs a stone pickaxe');
  assert.equal(mining.nearby(facing, 'stone').prompt, 'Tin ore · stone pickaxe');
});

test('mined ore lies with the loot; a full bag leaves it there until there is room', () => {
  const world = new World(1);
  const store = new HuntDrops();
  const bag = new Inventory({ starter: false });
  for (let i = 0; i < 200 && bag.spaceFor('rawTin', 1) > 0; i++) bag.add('outlawHood');
  const collection = new Collection(world, bag, store.items);
  const ores = world.propsOf(-1, -2).filter((p) => p.ore);
  const tin = of(ores, 'tin');
  const player = { x: tin.x + 4, y: tin.y + 1 };
  const mining = new Mining(world, { random: () => 0,
    drop: (items, block) => layLoot(store, world, { x: block.x, y: block.y, killer: player, items }, (a, b) => collection.pathClear(a, b)) });
  for (let i = 0; i < 3; i++) mining.strike(tin, 'stone');
  const [stack] = store.all();
  assert.deepEqual([stack.id, stack.count], ['rawTin', 1]);
  stack.pickupAfter = 0;
  const stand = { x: stack.x, y: stack.y, heading: 0, vx: 0, vy: 0 };
  collection.update(1, stand);
  assert.equal(store.all().length, 1, 'still on the ground');
  bag.slots[bag.slots.findIndex((s) => s?.id === 'outlawHood')] = null;
  collection.update(1, stand);
  assert.equal(store.all().length, 0);
  assert.ok(bag.slots.some((s) => s?.id === 'rawTin'));
});

test('without gathering a cut plant is remembered and yields nothing', () => {
  const world = new World(1);
  const harvesting = new Harvesting(world, null);
  const node = { kind: 'grass', x: 3.5, y: 4.5 };
  assert.deepEqual(harvesting.harvest(node).rewards, []);
  assert.ok(world.gathered.has('grass:3:4'));
});
