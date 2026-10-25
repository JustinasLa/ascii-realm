import assert from 'node:assert/strict';
import test from 'node:test';
import { mulberry32 } from '../src/core/rng.js';
import { HuntDrops, MAX_STACKS } from '../src/entities/hunt-drops.js';
import { ITEMS } from '../src/inventory/items.js';
import { GATHER_PAY, layLoot, logsOf, lootSpots, LOOT, LOOT_CREDIT, LootCredit, nearestDry, rollLoot, rollPay, TIER_CHANCE, TIERS }
  from '../src/world/loot.js';
import { Harvesting } from '../src/world/harvesting.js';
import { WATER } from '../src/world/world.js';

// Rolls a kind many times and counts how often each item came, and in what counts.
function tally(kind, n = 20000, seed = 7) {
  const random = mulberry32(seed);
  const seen = {};
  for (let i = 0; i < n; i++) {
    for (const { id, count } of rollLoot(kind, random)) {
      seen[id] ??= { kills: 0, counts: {} };
      seen[id].kills++;
      seen[id].counts[count] = (seen[id].counts[count] ?? 0) + 1;
    }
  }
  return { seen, n };
}

const near = (actual, expected, slack = 0.015) => assert.ok(Math.abs(actual - expected) <= slack, `${actual} ≈ ${expected}`);

test('a skeleton always leaves 1–2 bones, arrows 60 % of the time and a hood 1 % of the time', () => {
  const { seen, n } = tally('skeleton');
  assert.equal(seen.bone.kills, n);
  near(seen.bone.counts[1] / n, 0.5);
  near(seen.bone.counts[2] / n, 0.5);
  near(seen.arrow.kills / n, 0.6);
  assert.deepEqual(Object.keys(seen.arrow.counts).sort(), ['1', '2']);
  near(seen.outlawHood.kills / n, 0.01, 0.004);
  assert.deepEqual(Object.keys(seen.outlawHood.counts), ['1']);
  assert.equal(ITEMS.outlawHood.equipmentSlot, 'helm');
});

test('goblins and elves leave an ingot or a denar, trolls four of either, one or the other, never both', () => {
  assert.equal(TIER_CHANCE, 0.2);
  for (const [kind, count] of [['goblin', 1], ['elf', 1], ['troll', 4]]) {
    const random = mulberry32(11);
    const n = 20000;
    const kills = { ironIngot: 0, denars: 0 };
    for (let i = 0; i < n; i++) {
      const loot = rollLoot(kind, random);
      assert.ok(loot.length <= 1, 'one item at most');
      for (const { id, count: c } of loot) {
        kills[id]++;
        assert.equal(c, id === 'denars' ? count * 100 : count, `${kind} ${id}`);
      }
    }
    near(kills.ironIngot / n, 0.16);
    near(kills.denars / n, 0.04, 0.008);
  }
  assert.ok(!LOOT.skeleton.some((e) => e.table || e.id === 'denars'), 'skeletons pay nothing');
});

test('a tier picks by weight, the last item taking a roll at the very top', () => {
  const rolls = (...values) => () => values.shift();
  assert.deepEqual(rollLoot('goblin', rolls(0, 0.79)), [{ id: 'ironIngot', count: 1 }]);
  assert.deepEqual(rollLoot('goblin', rolls(0, 0.81)), [{ id: 'denars', count: 100 }]);
  assert.deepEqual(rollLoot('goblin', rolls(0, 1)), [{ id: 'denars', count: 100 }]);
  for (const entries of Object.values(TIERS)) for (const e of entries) assert.ok(e.weight > 0);
  assert.deepEqual(TIERS.medium.map((e) => e.count), [2, 200]);
});

test('felling pays now and then: 5 % a log for 0.50–1.00d, as many logs as felling gives', () => {
  assert.deepEqual(GATHER_PAY.tree, { chance: 0.05, cents: [50, 100] });
  const random = mulberry32(5);
  let hits = 0;
  const n = 20000;
  for (let i = 0; i < n; i++) {
    for (const { id, count } of rollPay('tree', 3, random)) {
      hits++;
      assert.equal(id, 'denars');
      assert.ok(Number.isInteger(count) && count >= 50 && count <= 100, count);
    }
  }
  near(hits / (3 * n), 0.05, 0.005);
  assert.deepEqual(rollPay('rock', 3, () => 0), []);
  assert.equal(rollPay('tree', 1, () => 0).length, 1);
  assert.deepEqual(rollPay('tree', 2, () => 0.99), []);
  assert.ok(Array.isArray(rollPay('tree', 1)), 'Math.random by default');
  // The count matches what felling really gives.
  for (const growth of ['sapling', 'mature']) {
    const tree = { kind: 'tree', x: 1, y: 1, growth, hits: 0 };
    const world = { propsIn: () => [tree], isWalkable: () => true, gathered: new Set(), typeAt: () => 1 };
    const harvesting = new Harvesting(world, null, { wild: false });
    harvesting.gathering = true;
    harvesting.drop = () => {};
    harvesting.reachable = () => true;
    harvesting.resourcesIn = () => [];
    let felled = null;
    for (let i = 0; i < 10 && !felled; i++) {
      felled = harvesting.react({ type: 'strike', swing: 'cut', x: 1, y: 1, chop: 99, heading: 0 }, { x: 1, y: 1, heading: 0 })
        .find((r) => r.status === 'harvested');
    }
    assert.ok(felled, growth);
    assert.equal(logsOf(tree), felled.rewards[0].count, growth);
  }
});

test('every item in the tables exists, unknown kinds leave nothing and rolls repeat for a seed', () => {
  for (const entries of Object.values(LOOT)) for (const e of entries) if (e.id) assert.ok(ITEMS[e.id], e.id);
  for (const tier of Object.values(TIERS)) for (const e of tier) assert.ok(ITEMS[e.id], e.id);
  assert.equal(ITEMS.ironIngot.name, 'Iron Ingot');
  assert.deepEqual(rollLoot('dragon', () => 0), []);
  const a = mulberry32(3);
  const b = mulberry32(3);
  for (let i = 0; i < 50; i++) assert.deepEqual(rollLoot('skeleton', a), rollLoot('skeleton', b));
  // Equal items merge; unknown items are passed over.
  const tables = { x: [{ id: 'bone', chance: 1, count: [1, 1] }, { id: 'bone', chance: 1, count: [2, 2] },
    { id: 'nothing', chance: 1, count: [1, 1] }, { table: 'medium', chance: 1 }] };
  // (One roll of 0 also picks the tier's first item, the iron.)
  assert.deepEqual(rollLoot('x', () => 0, tables), [{ id: 'bone', count: 3 }, { id: 'ironIngot', count: 2 }]);
  assert.ok(rollLoot('skeleton').some((d) => d.id === 'bone'), 'Math.random by default');
});

test('loot is earned by taking 1 % of the health off a monster, and claimed once', () => {
  assert.equal(LOOT_CREDIT, 0.01);
  const credit = new LootCredit();
  const m = { maxHealth: 200, health: 200 };
  assert.equal(credit.earned(m), false, 'untouched');
  m.health = 199;
  assert.equal(credit.observe(m, true), 1);
  assert.equal(credit.earned(m), false, '0.5 %');
  m.health = 198;
  credit.observe(m, true);
  assert.equal(credit.earned(m), true, '1 %');
  assert.equal(credit.claim(m), true);
  assert.equal(credit.claim(m), false, 'only once');
});

test('only the health a blow really removed counts, and others\' blows earn the player nothing', () => {
  const credit = new LootCredit();
  const troll = { maxHealth: 150, health: 150 };
  // A spell said to deal 5 but mostly resisted: 0.2 health gone.
  troll.health = 149.8;
  credit.observe(troll, true);
  troll.health = 0;
  credit.observe(troll, false);
  assert.equal(credit.claim(troll), false);

  const other = { maxHealth: 150, health: 150 };
  other.health = 120;
  credit.observe(other, false);
  other.health = 118;
  assert.equal(credit.observe(other, true), 2, 'what the friend took first is not the player\'s');
  other.health = 0;
  credit.observe(other, false);
  assert.equal(credit.claim(other), true);
  // Healing never takes credit away.
  other.health = 50;
  assert.equal(credit.observe(other, true), 0);
});

// A world of dry land, with water and walls where the given tests say.
function land({ water = () => false, wall = () => false, loaded = true } = {}) {
  return {
    loaded: () => (loaded ? { props: [] } : null),
    isWalkable: (x, y) => !wall(x, y),
    typeAt: (x, y) => (water(x, y) ? WATER : 1),
  };
}

const metres = (a, b) => Math.hypot(((b.x - a.x) * 0.6) / 13, (b.y - a.y) / 6.5);

test('loot lies 1.2–3 m from the body on dry ground the player can reach', () => {
  const world = land();
  const body = { x: 1000, y: 1000 };
  const spots = lootSpots(world, body, { x: 1030, y: 1000 });
  assert.ok(spots.length >= 3);
  for (const s of spots) {
    const d = metres(body, s);
    assert.ok(d >= 1.19 && d <= 3.01, `${d}`);
  }
  // The default path test lets every spot through.
  assert.equal(lootSpots(world, body, body).length, spots.length);
});

test('a troll slain mid-river beside an unreachable islet leaves its loot on the bank the player stands on', () => {
  // The river runs from x 900 to 1100; an islet at 990–1010 in its middle.
  const islet = (x) => x >= 990 && x <= 1010;
  const water = (x) => x > 900 && x < 1100 && !islet(x);
  const world = land({ water });
  const path = (a, b) => {
    for (let t = 0; t <= 1; t += 0.02) {
      const x = a.x + (b.x - a.x) * t;
      if (water(x)) return false;
    }
    return true;
  };
  const bank = { x: 880, y: 1000 };
  const body = { x: 1000, y: 1000 };
  const spots = lootSpots(world, body, bank, path);
  assert.ok(spots.length);
  for (const s of spots) {
    assert.ok(s.x <= 900, `on the player's bank: ${s.x}`);
    assert.ok(path(bank, s));
  }
});

test('a player wading in water finds the dry ground nearest them; with none near, nothing is laid', () => {
  const shore = land({ water: (x) => x > 900 });
  const wading = { x: 950, y: 1000 };
  const stand = nearestDry(shore, wading);
  assert.ok(stand.x <= 900 && metres(wading, stand) <= 8.01);
  const sea = land({ water: () => true });
  assert.equal(nearestDry(sea, wading), null);
  assert.deepEqual(lootSpots(sea, wading, wading), []);
  const store = new HuntDrops();
  assert.deepEqual(layLoot(store, sea, { ...wading, killer: wading, items: [{ id: 'bone', count: 1 }] }), []);
  // Walls all round the player but where they stand: the loot lies at their feet.
  const box = land({ wall: (x, y) => x !== 500 || y !== 500 });
  assert.deepEqual(lootSpots(box, { x: 400, y: 400 }, { x: 500, y: 500 }), [{ x: 500, y: 500 }]);
  // The body round a corner from the player: beside the player instead.
  const corner = land({ wall: (x) => x > 600 && x < 700 });
  const beside = lootSpots(corner, { x: 750, y: 500 }, { x: 550, y: 500 }, (a, b) => !(Math.max(a.x, b.x) > 600));
  assert.ok(beside.length && beside.every((s) => s.x <= 600));
});

test('laid loot goes in the drop store once each, after the pickup delay, keeping the newest', () => {
  const store = new HuntDrops();
  const world = land();
  const laid = layLoot(store, world, { x: 1000, y: 1000, killer: { x: 1030, y: 1000 },
    items: [{ id: 'bone', count: 2 }, { id: 'arrow', count: 1 }, { id: 'nothing', count: 1 }] });
  assert.deepEqual(laid.map((i) => [i.id, i.count]), [['bone', 2], ['arrow', 1]]);
  assert.deepEqual(store.all(), laid);
  assert.ok(laid.every((i) => i.pickupAfter === 0.5));
  assert.notDeepEqual([laid[0].x, laid[0].y], [laid[1].x, laid[1].y], 'spread round the body');
  assert.deepEqual(layLoot(store, world, { x: 0, y: 0, killer: { x: 0, y: 0 }, items: [] }), []);
  for (let i = 0; i < MAX_STACKS; i++) {
    layLoot(store, world, { x: 1000, y: 1000, killer: { x: 1000, y: 1000 }, items: [{ id: 'bone', count: 1 }] });
  }
  assert.equal(store.all().length, MAX_STACKS);
  assert.ok(!store.all().includes(laid[0]), 'the oldest went first');
});
