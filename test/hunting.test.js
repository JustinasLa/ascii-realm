import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mulberry32 } from '../src/core/rng.js';
import { ARROW_FLOOR, Animal, Animals, KINDS, RING, herdOf, regionOf, rollDrops } from '../src/entities/animals.js';
import { DROP_LIFETIME, HuntDrops, MAX_STACKS, PICKUP_DELAY, createCarcassLand } from '../src/entities/hunt-drops.js';
import { toCells, toMetres } from '../src/entities/monsters.js';
import { SCALE } from '../src/entities/rig.js';
import { Collection } from '../src/inventory/collection.js';
import { Inventory } from '../src/inventory/inventory.js';
import { ITEMS } from '../src/inventory/items.js';
import { itemArt } from '../src/ui/item-art.js';
import { drawItem } from '../src/world/item-draw.js';
import { Projectiles } from '../src/world/projectiles.js';
import { CHUNK_SIZE, GRASS, WATER } from '../src/world/world.js';

const dt = 1 / 30;
const metres = (a, b) => Math.hypot(...toMetres(b.x - a.x, b.y - a.y));
const at = (from, mx, mz) => {
  const [dx, dy] = toCells(mx, mz);
  return { x: from.x + dx, y: from.y + dy };
};
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Open grass unless told otherwise, every chunk loaded, nothing in the way
// of a shot. `chunk` is the real world's chunk maker, which the drop store
// must never call.
function land({ water = () => false, solid = () => false, loaded = () => true } = {}) {
  const world = {
    seed: 11,
    chunkCalls: 0,
    chunk() { world.chunkCalls++; return { items: null }; },
    loaded: (cx, cy) => (loaded(cx, cy) ? { props: [] } : null),
    isWalkable: (x, y) => !solid(x, y),
    typeAt: (x, y) => (water(x, y) ? WATER : GRASS),
    waterDepthAt: (x, y) => (water(x, y) ? 0.25 : 0),
    propsIn: () => [],
  };
  return world;
}

const walker = (x, y, groundSpeed = 0) => ({ x, y, groundSpeed, walkSpeed: 1.63, runSpeed: 3.74, heading: 0 });

function run(animals, world, player, seconds, each = () => {}) {
  for (let t = 0; t < seconds; t += dt) {
    animals.update(dt, world, { player });
    each(t);
  }
}

// A herd of a kind at the origin, settled, the player far off.
function herd(kind = 'deer', count = 3, world = land()) {
  const animals = new Animals({ habitat: () => 'water' });
  animals.spawn(kind, { x: 0, y: 0, count, world });
  animals.calm();
  return { animals, world, far: walker(0, 5000) };
}

test('drops are rolled by their chances: hide, meat and bone from deer, sometimes meat from rabbits', () => {
  const random = mulberry32(7);
  const n = 20000;
  const seen = { deer: {}, rabbit: {} };
  for (const kind of ['deer', 'rabbit']) {
    for (let i = 0; i < n; i++) {
      for (const { id, count } of rollDrops(KINDS[kind], random)) {
        assert.ok(Object.hasOwn(ITEMS, id), id);
        const [lo, hi] = KINDS[kind].drops.find((d) => d.id === id).count;
        assert.ok(count >= lo && count <= hi && Number.isInteger(count));
        seen[kind][id] = (seen[kind][id] ?? 0) + 1;
      }
    }
  }
  const share = (kind, id) => seen[kind][id] / n;
  assert.ok(Math.abs(share('deer', 'deerHide') - 0.8) < 0.015);
  assert.ok(Math.abs(share('deer', 'rawVenison') - 0.9) < 0.015);
  assert.ok(Math.abs(share('deer', 'bone') - 0.5) < 0.015);
  assert.deepEqual(Object.keys(seen.rabbit), ['rawRabbit']);
  assert.ok(Math.abs(share('rabbit', 'rawRabbit') - 0.2) < 0.015);
  assert.deepEqual(rollDrops({}, random), [], 'a kind with no table drops nothing');
});

test('the new items are defined, with bag pictures that fit the slot', () => {
  for (const id of ['deerHide', 'rawVenison', 'rawRabbit', 'bone']) {
    const item = ITEMS[id];
    assert.ok(item.name && item.description && item.weight > 0 && item.stackLimit > 0);
    const rows = itemArt(id).split('\n');
    assert.ok(rows.length <= 9 && rows.every((r) => r.length <= 11), id);
  }
});

test('a hit only lands once in its hurt window, unless harder, and then only by the difference', () => {
  const { animals, world, far } = herd('deer', 1);
  const deer = animals.list[0];
  assert.equal(animals.hit(deer, 10, 0, -20), true);
  assert.equal(deer.health, 30);
  run(animals, world, far, 0.3);
  assert.equal(animals.hit(deer, 10, 0, -20), false, 'the same blow 0.3 s later does nothing');
  assert.equal(animals.hit(deer, 15, 0, -20), true);
  assert.equal(deer.health, 25, 'a harder one lands its difference');
  run(animals, world, far, 0.6);
  assert.equal(animals.hit(deer, 10, 0, -20), true);
  assert.equal(deer.health, 15, 'after the window a blow lands in full');
  assert.equal(animals.hit(deer, 0, 0, -20), false);
  const events = [];
  run(animals, world, far, dt, () => events.push(...animals.events.splice(0)));
  assert.deepEqual(events.filter((e) => e.type === 'hurt').map((e) => e.amount), [10, 5, 10]);
  assert.ok(events.every((e) => e.animal === deer));
});

test('two cuts of 22 a second apart bring down a deer, which then refuses hits', () => {
  const { animals, world, far } = herd('deer', 1);
  const deer = animals.list[0];
  animals.hit(deer, 22, 0, -20);
  run(animals, world, far, 0.4);
  assert.equal(animals.hit(deer, 22, 0, -20), false);
  run(animals, world, far, 0.7);
  assert.equal(animals.hit(deer, 22, 0, -20), true);
  assert.equal(deer.alive, false);
  assert.equal(deer.health, 0);
  assert.equal(animals.hit(deer, 22, 0, -20), false);
  assert.ok(deer.events.some((e) => e.type === 'death'));
  const rabbit = new Animal(KINDS.rabbit, 0, 0);
  assert.equal(rabbit.takeHit(1, 0, 1), true);
  assert.equal(rabbit.takeHit(8, 0, 1), true);
  assert.equal(rabbit.alive, false);
});

test('a struck deer flinches toward the blow, then bolts away from the hitter; its herd follows', () => {
  const { animals, world, far } = herd('deer', 3);
  const deer = animals.list[0];
  const start = { x: deer.x, y: deer.y };
  deer.heading = 0;
  // A blow from its left (east of a deer facing down the screen).
  const hitter = at(deer, 3, 0);
  animals.hit(deer, 5, hitter.x, hitter.y);
  assert.equal(deer.flinch.side, 'L');
  run(animals, world, far, KINDS.deer.flinch - dt * 2);
  assert.notEqual(deer.state, 'flee');
  assert.ok(metres(start, deer) < 0.05, 'it stands where it was struck');
  assert.ok(deer.heading > 0.2, 'turning toward the blow');
  run(animals, world, far, dt * 3);
  assert.equal(deer.state, 'flee');
  assert.equal(deer.flinch, null);
  const away = Math.atan2(...toMetres(deer.x - hitter.x, deer.y - hitter.y));
  assert.ok(Math.abs(wrap(deer.heading - away)) < 0.3, 'straight away from the hitter');
  run(animals, world, far, 0.45);
  assert.ok(animals.list.every((a) => a.state === 'flee'), 'the alarm ran through the herd');
  // A blow from the right flinches the other way.
  const other = herd('deer', 1).animals.list[0];
  other.heading = 0;
  const right = at(other, -3, 0);
  other.takeHit(5, right.x, right.y);
  assert.equal(other.flinch.side, 'R');
});

test('a sword cut\'s own noise does not cut the struck deer\'s flinch short, but sends its mates off', () => {
  const { animals, world, far } = herd('deer', 3);
  const deer = animals.list[0];
  const hitter = at(deer, 0, -1);
  animals.hit(deer, 5, hitter.x, hitter.y);
  animals.hear({ type: 'strike', x: hitter.x, y: hitter.y });
  run(animals, world, far, dt);
  assert.notEqual(deer.state, 'flee');
  assert.ok(deer.flinch && deer.boltIn > 0, 'still flinching, its bolt still due');
  assert.ok(animals.list.slice(1).every((a) => a.state === 'flee'));
  run(animals, world, far, KINDS.deer.flinch);
  assert.equal(deer.state, 'flee');
});

test('a rabbit bolts at once when struck; one hurt in flight runs on for longer', () => {
  const { animals, world, far } = herd('rabbit', 1);
  const rabbit = animals.list[0];
  animals.hit(rabbit, 1, 0, -5);
  assert.equal(rabbit.flinch, null);
  run(animals, world, far, dt);
  assert.equal(rabbit.state, 'flee');
  const { animals: deer, world: w2 } = herd('deer', 1);
  const d = deer.list[0];
  d.bolt(w2, { x: 0, y: -5 });
  d.stateTime = d.duration - 0.1;
  deer.hit(d, 5, 0, -5);
  assert.ok(d.duration >= d.stateTime + KINDS.deer.flee.min);
  assert.equal(d.flinch, null, 'running, it does not stop to flinch');
});

test('a deer hit late in its flight runs on four more seconds, even from a hunter far off', () => {
  const { animals, world, far } = herd('deer', 1);
  const deer = animals.list[0];
  const hunter = at(deer, 0, -40);
  deer.bolt(world, hunter);
  deer.duration = KINDS.deer.flee.min + 0.1;
  run(animals, world, far, KINDS.deer.flee.min - 0.2);
  assert.equal(deer.state, 'flee');
  animals.hit(deer, 5, hunter.x, hunter.y);
  let last = metres(hunter, deer);
  run(animals, world, far, KINDS.deer.flee.min - 0.2, () => {
    assert.equal(deer.state, 'flee', 'still running');
    const now = metres(hunter, deer);
    assert.ok(now > last, 'and still away');
    last = now;
  });
  run(animals, world, far, 0.5);
  assert.notEqual(deer.state, 'flee', 'then safe, it settles');
});

test('a kill sends the herd from the killer, not from the body\'s cry', () => {
  const { animals, world, far } = herd('deer', 3);
  const [deer, mate] = animals.list;
  // The hunter stands beyond the mate, so a flight from the body would
  // run at them.
  const off = toMetres(mate.x - deer.x, mate.y - deer.y);
  const length = Math.hypot(...off);
  const hunter = at(mate, (off[0] / length) * 8, (off[1] / length) * 8);
  animals.hit(deer, 999, hunter.x, hunter.y);
  // The frame hears the body's hurt and death noises, as the game does.
  for (const e of deer.events) animals.hear({ ...e, animal: deer });
  deer.events.length = 0;
  const before = animals.list.slice(1).map((a) => metres(hunter, a));
  run(animals, world, far, 2);
  animals.list.slice(1).forEach((a, i) => {
    assert.equal(a.state, 'flee');
    assert.deepEqual([a.threat.x, a.threat.y], [hunter.x, hunter.y], 'from the hunter');
    assert.ok(metres(hunter, a) > before[i] + 3, 'and away from them');
  });
  // Once off, a mate hears noises again.
  assert.equal(mate.alarmed, false);
  animals.calm();
  assert.equal(mate.alarmed, false);
});

test('the fallen lie still, sink away and are cleared; the next living one leads; corpses take no slot', () => {
  const { animals, world, far } = herd('deer', 3);
  const [leader, second] = animals.list;
  const h = leader.herd;
  const spot = { x: leader.x, y: leader.y };
  animals.hurt(0);
  assert.equal(leader.alive, false);
  assert.equal(h.leader, second);
  assert.equal(animals.count('deer'), 2);
  animals.counts.deer = 2;
  assert.equal(animals.fits('deer', 1), false);
  animals.counts.deer = 3;
  assert.equal(animals.fits('deer', 1), true, 'the body does not hold a place');
  // Threats and noises close by move nothing.
  const near = walker(leader.x, leader.y - 1, 4);
  animals.hear({ type: 'strike', x: leader.x, y: leader.y });
  run(animals, world, near, 2);
  assert.deepEqual({ x: leader.x, y: leader.y }, spot);
  assert.equal(leader.speed, 0);
  run(animals, world, far, KINDS.deer.linger - 2 + KINDS.deer.sink / 2);
  assert.ok(leader.sunk > 0.3 && leader.sunk < 0.7, `${leader.sunk}`);
  run(animals, world, far, KINDS.deer.sink);
  assert.equal(animals.list.includes(leader), false);
  assert.equal(h.members.includes(leader), false);
  assert.equal(animals.herds.size, 1);
  // When all are gone, so is the herd.
  animals.hurt(animals.list[0]);
  animals.hurt(animals.list[1]);
  assert.equal(h.leader, null);
  run(animals, world, far, KINDS.deer.linger + KINDS.deer.sink + 1);
  assert.equal(animals.herds.size, 0);
  assert.equal(animals.hurt(5), false, 'no animal there');
});

test('a calm, sinking or dead animal ignores the debug calm', () => {
  const { animals } = herd('deer', 1);
  animals.hurt(0);
  animals.calm();
  assert.equal(animals.list[0].state, 'dead');
});

test('a kill leaves its drops beside the body for the game to lay', () => {
  const { animals } = herd('deer', 1);
  const deer = animals.list[0];
  animals.random = () => 0;
  animals.hurt(deer, 999, { x: deer.x, y: deer.y - 4 });
  assert.equal(animals.drops.length, 1);
  const [drop] = animals.drops;
  assert.deepEqual(drop.items.map((d) => d.id), ['deerHide', 'rawVenison', 'bone']);
  assert.deepEqual([drop.x, drop.y, drop.kind], [deer.x, deer.y, 'deer']);
  assert.deepEqual(drop.killer, { x: deer.x, y: deer.y - 4 });
  const { animals: unlucky } = herd('rabbit', 1);
  unlucky.random = () => 0.99;
  unlucky.hurt(0);
  assert.equal(unlucky.drops.length, 0, 'nothing rolled, nothing to lay');
});

test('a sword cut hits an animal ahead in reach, not one behind, unless spinning', () => {
  const animals = new Animals({ habitat: () => 'water' });
  const player = walker(0, 0);
  player.feel = { reach: 0.95 };
  const ahead = animals.spawn('deer', { ...at(player, 0, 1.2), count: 1 }).members[0];
  const behind = animals.spawn('deer', { ...at(player, 0, -1.2), count: 1 }).members[0];
  const far = animals.spawn('deer', { ...at(player, 0, 1.6), count: 1 }).members[0];
  assert.deepEqual(animals.strike({ swing: 'cut' }, player, 10), [ahead]);
  assert.equal(behind.health, 40);
  assert.equal(far.health, 40, 'beyond reach and body');
  const spin = new Animals({ habitat: () => 'water' });
  const back = spin.spawn('rabbit', { ...at(player, 0, -0.8), count: 1 }).members[0];
  assert.deepEqual(spin.strike({ swing: 'spin' }, player, 10), [back]);
  assert.equal(back.alive, false);
  assert.deepEqual(spin.strike({ swing: 'spin' }, player, 10), [], 'the dead are not hit again');
  // A default reach serves a player without a feel.
  const close = new Animals({ habitat: () => 'water' });
  close.spawn('deer', { ...at(player, 0.5, 1), count: 1 });
  assert.equal(close.strike({}, { x: 0, y: 0, heading: 0 }, 5).length, 1);
});

// Shoots from the player at a ground point, flying the shaft frame by frame
// and testing each frame's path against the animals; returns the ids struck.
function shoot(animals, world, from, aim, { kind = 'arrow', strength = 1, damage = 22 } = {}) {
  const projectiles = new Projectiles();
  const p = projectiles.launch({ x: from.x, y: from.y, h: SCALE * 1.1, aimTarget: aim, projectile: { kind },
    strength, damage });
  const struck = new Set();
  for (let i = 0; i < 120 && projectiles.list.length; i++) {
    const before = new Map(projectiles.list.map((q) => [q, { x: q.x, y: q.y, h: q.h }]));
    projectiles.update(1 / 60, world);
    for (const id of animals.shots(projectiles, before, from)) struck.add(id);
  }
  return { projectiles, p, struck };
}

test('an arrow hits a deer it is aimed at, or just behind, but not one to the side', () => {
  const world = land();
  const player = walker(0, 0);
  for (const [behind, side, hits] of [[0, 0, true], [1, 0, true], [0, 3, false]]) {
    const animals = new Animals({ habitat: () => 'water' });
    const deer = animals.spawn('deer', { ...at(player, 0, 8), count: 1 }).members[0];
    const { projectiles, p, struck } = shoot(animals, world, player, at(deer, side, behind));
    assert.equal(deer.health < 40, hits, `${behind} behind, ${side} aside`);
    assert.equal(struck.has(p.id), hits);
    if (hits) {
      assert.equal(deer.health, 18, 'a full draw lands the bow\'s damage');
      assert.equal(projectiles.list.includes(p) || projectiles.landed.includes(p), false, 'the arrow is spent');
    } else assert.ok(projectiles.landed.includes(p), 'a miss lies where it fell');
  }
  const animals = new Animals({ habitat: () => 'water' });
  const rabbit = animals.spawn('rabbit', { ...at(player, 0, 8), count: 1 }).members[0];
  shoot(animals, world, player, rabbit);
  assert.equal(rabbit.alive, false, 'an arrow brings down a rabbit');
  const stag = new Animals({ habitat: () => 'water' });
  const big = stag.spawn('deer', { ...at(player, 0, 6), count: 1, variant: 'stag' }).members[0];
  shoot(stag, world, player, big);
  assert.equal(big.health, 18);
});

test('a shot\'s damage grows with its draw; spears and javelins fall at the animal\'s feet', () => {
  const world = land();
  const player = walker(0, 0);
  const weak = new Animals({ habitat: () => 'water' });
  const deer = weak.spawn('deer', { ...at(player, 0, 4), count: 1 }).members[0];
  shoot(weak, world, player, deer, { strength: 0 });
  assert.equal(40 - deer.health, Math.round(22 * ARROW_FLOOR));
  assert.equal(40 - deer.health, 8);
  const thrown = new Animals({ habitat: () => 'water' });
  const target = thrown.spawn('deer', { ...at(player, 0, 5), count: 1 }).members[0];
  const { projectiles, p, struck } = shoot(thrown, world, player, target, { kind: 'javelin', damage: 30 });
  assert.ok(struck.has(p.id));
  assert.equal(target.health, 10);
  assert.equal(projectiles.list.includes(p), false);
  assert.ok(projectiles.landed.includes(p), 'the javelin lies to be taken up again');
  assert.deepEqual([p.x, p.y, p.h, p.depth], [target.x, target.y, 0, target.y]);
  // A spell bolt, and a shaft at a dead or out-of-window animal, fly on.
  const before = new Map([[{ kind: 'magic', x: 0, y: 0, h: 0 }, { x: 0, y: 0, h: 0 }]]);
  assert.equal(thrown.shots({ list: [], landed: [] }, before).size, 0);
  const again = shoot(thrown, world, player, target, { kind: 'arrow', damage: 5 });
  assert.equal(again.struck.size, 0, 'a weaker shot inside the hurt window passes on');
});

test('a shaft landing near animals startles them: close ones bolt, those further off look up', () => {
  const world = land();
  const far = walker(0, 5000);
  for (const [distance, want] of [[3, 'flee'], [6, 'alert'], [12, 'idle']]) {
    const animals = new Animals({ habitat: () => 'water' });
    const deer = animals.spawn('deer', { x: 0, y: 0, count: 1 }).members[0];
    animals.calm();
    deer.setState('idle', 100);
    const spot = at(deer, distance, 0);
    animals.landed(spot.x, spot.y);
    run(animals, world, far, dt);
    assert.equal(deer.state, want, `${distance} m`);
  }
  const off = new Animals({ enabled: false });
  off.landed(0, 0);
  assert.equal(off.noises.length, 0);
});

test('a hurt or dying animal is heard by the others', () => {
  const { animals, world, far } = herd('rabbit', 2);
  const [a, b] = animals.list;
  animals.hear({ type: 'death', animal: a, x: a.x, y: a.y });
  run(animals, world, far, dt);
  assert.equal(b.state, 'flee');
});

test('a hunted herd comes back smaller, without its stag if the stag fell, and not at all if wiped out', () => {
  const player = walker(5000, 3000);
  // A region near the player holding a stag-led herd of four.
  let region = null;
  for (let seed = 1; seed < 60 && !region; seed++) {
    for (let ry = 19; ry <= 27 && !region; ry++) {
      for (let rx = 5; rx <= 14 && !region; rx++) {
        const roll = herdOf(seed, rx, ry, 'meadow');
        const d = roll && metres(player, roll.home);
        if (roll?.kind.id === 'deer' && roll.size === 4 && roll.stag && d > RING.near + 2 && d < RING.far - 2) {
          region = { rx, ry, seed };
        }
      }
    }
  }
  assert.ok(region);
  const habitat = (world, x, y) => {
    const { rx, ry } = regionOf(x, y);
    return rx === region.rx && ry === region.ry ? 'meadow' : 'water';
  };
  const key = `${region.rx},${region.ry}`;
  const world = land();
  const cycle = (animals) => {
    player.x += toCells(500, 0)[0];
    run(animals, world, player, 1);
    assert.equal(animals.herds.has(key), false);
    player.x = 5000;
    run(animals, world, player, RING.cooldown + 1);
    return animals.herds.get(key);
  };
  const animals = new Animals({ seed: region.seed, habitat });
  run(animals, world, player, 1);
  let h = animals.herds.get(key);
  assert.equal(h.members.length, 4);
  assert.equal(h.members[0].variant, 'stag');
  // Two hinds taken: the herd returns with two, the stag still leading.
  animals.hurt(h.members[1]);
  animals.hurt(h.members[2]);
  assert.deepEqual(animals.culled.get(key), { count: 2, stag: false });
  h = cycle(animals);
  assert.equal(h.members.length, 2);
  assert.equal(h.members[0].variant, 'stag');
  // The stag taken: back without one.
  animals.hurt(h.members[0]);
  h = cycle(animals);
  assert.deepEqual(h.members.map((a) => a.variant), ['hind']);
  // The last taken: the region stays empty.
  animals.hurt(h.members[0]);
  assert.equal(cycle(animals), undefined);
  // Debug herds keep no tally.
  const debugHerd = animals.spawn('deer', { x: 0, y: 0, count: 1 });
  animals.hurt(debugHerd.members[0]);
  assert.equal(animals.culled.has(debugHerd.key), false);
  // A lone animal outside any herd falls without a tally.
  const stray = new Animal(KINDS.deer, 0, 0);
  assert.equal(animals.hit(stray, 999, 0, 0), true);
});

test('the carcass land starts every chunk empty, and keeps only those holding stacks', () => {
  const landOf = createCarcassLand();
  assert.deepEqual(landOf.chunk(3, 4), { items: [], props: [] });
  assert.equal(landOf.loaded(3, 4), null, 'an empty chunk is not loaded');
  const drops = new HuntDrops();
  const [item] = drops.lay({ x: 100, y: 50, killer: null, items: [{ id: 'bone', count: 1 }] }, land());
  assert.equal(drops.land.chunks.size, 1);
  const key = [...drops.land.chunks.keys()][0];
  const [cx, cy] = key.split(',').map(Number);
  assert.deepEqual(drops.land.loaded(cx, cy).items, [item]);
  // A stack moved to the next chunk leaves its old one empty, let go of.
  drops.items.move(item, item.x + CHUNK_SIZE, item.y);
  drops.expire();
  assert.deepEqual([...drops.land.chunks.keys()], [`${cx + 1},${cy}`]);
  drops.forget(item);
  assert.equal(drops.land.chunks.size, 0, 'picked up or lost, its chunk goes');
});

test('exploring without hunting holds no chunks in the drop store', () => {
  const world = land();
  const drops = new HuntDrops();
  const collection = new Collection(world, new Inventory({ starter: false }), drops.items);
  for (let i = 0; i < 200; i++) {
    const x = i * 50;
    const y = (i % 7) * 40;
    assert.equal(drops.in(x - 100, y - 60, x + 100, y + 60).length, 0);
    collection.update(1 / 30, walker(x, y));
  }
  assert.equal(drops.land.chunks.size, 0);
  assert.equal(world.chunkCalls, 0);
});

test('stacks lie on dry ground beside the body, are drawn, and never bring loose items to the world', () => {
  const world = land();
  const drops = new HuntDrops();
  const body = { x: 100, y: 50, killer: { x: 100, y: 40 },
    items: [{ id: 'deerHide', count: 2 }, { id: 'rawVenison', count: 1 }, { id: 'bone', count: 1 }] };
  const laid = drops.lay(body, world);
  assert.equal(laid.length, 3);
  for (const item of laid) {
    assert.ok(metres(body, item) >= 1.2 - 1e-9 && metres(body, item) <= 1.6 + 1e-9);
    assert.equal(item.pickupAfter, PICKUP_DELAY);
  }
  assert.equal(new Set(laid.map((i) => `${i.x},${i.y}`)).size, 3, 'each on its own spot');
  const shown = drops.in(40, 30, 160, 70);
  assert.deepEqual(new Set(shown), new Set(laid), 'the on-screen query returns them');
  assert.deepEqual(new Set(drops.all()), new Set(laid));
  const writes = [];
  for (const item of shown) drawItem({ cols: 200, rows: 200 }, { x0: 0, y0: 0 }, item, 0, (...a) => writes.push(a));
  assert.ok(writes.length >= 3, 'and drawn');
  assert.equal(world.chunkCalls, 0, 'the real world\'s chunks are never touched');
  assert.equal(drops.in(1000, 1000, 1100, 1100).length, 0, 'empty land holds nothing');
  // An empty roll lays nothing.
  assert.deepEqual(drops.lay({ ...body, items: [] }, world), []);
});

test('a body in water drops on the bank; with no dry ground near, beside the hunter; else not at all', () => {
  const water = (x) => x < 100;
  const world = land({ water });
  const drops = new HuntDrops();
  const inventory = new Inventory({ starter: false });
  const collection = new Collection(world, inventory, drops.items);
  const body = { x: 99, y: 50, killer: { x: 90, y: 50 }, items: [{ id: 'deerHide', count: 1 }] };
  const [item] = drops.lay(body, world, (a, b) => collection.pathClear(a, b));
  assert.ok(item.x >= 100, 'on the bank');
  assert.ok(metres(body, item) <= 3);
  const player = walker(item.x + 2, item.y);
  collection.update(1, player);
  for (let i = 0; i < 30; i++) collection.update(1 / 30, player);
  assert.equal(inventory.slots.find((s) => s?.id === 'deerHide')?.count, 1, 'picked up from the bank');
  const lake = land({ water: (x) => x < 200 && x > 0 });
  const [byHunter] = drops.lay({ x: 100, y: 50, killer: { x: -5, y: 50 }, items: [{ id: 'bone', count: 1 }] }, lake);
  assert.deepEqual([byHunter.x, byHunter.y], [-5, 50]);
  const sea = land({ water: (x) => x < 400 && x > 0 });
  assert.deepEqual(drops.lay({ x: 100, y: 50, killer: { x: 200, y: 50 }, items: [{ id: 'bone', count: 1 }] }, sea), []);
  assert.deepEqual(drops.lay({ x: 100, y: 50, killer: null, items: [{ id: 'bone', count: 1 }] }, lake), []);
  // Nor on land that isn't loaded, or behind a wall from the body.
  const unloaded = land({ loaded: () => false });
  assert.deepEqual(drops.lay({ x: 100, y: 50, killer: null, items: [{ id: 'bone', count: 1 }] }, unloaded), []);
  const walled = land({ solid: (x, y) => Math.abs(x - 100) > 0.5 || Math.abs(y - 50) > 0.5 });
  const fenced = drops.lay({ x: 100, y: 50, killer: null, items: [{ id: 'bone', count: 1 }] }, walled,
    (a, b) => collection.pathClear(a, b));
  assert.deepEqual(fenced, []);
});

test('a hunter wading when the body falls far out finds the loot on the nearest bank', () => {
  const lake = land({ water: (x) => x < 200 && x > 0 });
  const drops = new HuntDrops();
  const inventory = new Inventory({ starter: false });
  const collection = new Collection(lake, inventory, drops.items);
  const hunter = { x: 20, y: 50 };
  const laid = drops.lay({ x: 100, y: 50, killer: hunter, items: [{ id: 'deerHide', count: 1 }, { id: 'bone', count: 1 }] },
    lake, (a, b) => collection.pathClear(a, b));
  assert.equal(laid.length, 2);
  for (const item of laid) {
    assert.ok(item.x <= 0, 'on dry ground');
    assert.ok(metres(hunter, item) <= 1 + 1e-9, 'the nearest to the hunter');
  }
  const player = walker(laid[0].x - 1, laid[0].y);
  for (let i = 0; i < 60; i++) collection.update(1 / 30, player);
  assert.equal(inventory.slots.find((s) => s?.id === 'deerHide')?.count, 1, 'picked up from the bank');
  // A hunter on dry ground has it laid at their feet.
  const walled = land({ water: (x) => x < 200 && x > 0, solid: (x) => x < -5 });
  const stuck = drops.lay({ x: 100, y: 50, killer: { x: -3, y: 50 }, items: [{ id: 'bone', count: 1 }] }, walled,
    (a, b) => collection.pathClear(a, b));
  assert.deepEqual([stuck[0].x, stuck[0].y], [-3, 50]);
});

test('stacks are lost after five minutes, the oldest first past the cap, and once picked up', () => {
  const world = land();
  const drops = new HuntDrops();
  const body = (x) => ({ x, y: 50, killer: null, items: [{ id: 'bone', count: 1 }] });
  const [first] = drops.lay(body(10), world);
  drops.items.time = DROP_LIFETIME - 1;
  const [second] = drops.lay(body(20), world);
  drops.expire();
  assert.deepEqual(drops.all(), [first, second]);
  drops.expire(DROP_LIFETIME);
  assert.deepEqual(drops.all(), [second]);
  for (let i = 0; i < MAX_STACKS + 5; i++) drops.lay(body(30 + i * 4), world);
  assert.equal(drops.laid.size, MAX_STACKS);
  assert.equal(drops.laid.has(second), false);
  const one = drops.all()[0];
  one.count = 0;
  drops.expire();
  assert.equal(drops.laid.has(one), false);
});

test('hide in reach is drawn into the bag after its short delay; a full bag leaves it lying', () => {
  const world = land();
  const drops = new HuntDrops();
  const inventory = new Inventory({ starter: false });
  const collection = new Collection(world, inventory, drops.items);
  const [item] = drops.lay({ x: 100, y: 50, killer: null, items: [{ id: 'deerHide', count: 2 }] }, world);
  const player = walker(item.x + toCells(0.3, 0)[0], item.y);
  collection.update(0.25, player);
  assert.equal(collection.events.length, 0, 'not yet');
  collection.update(0.3, player);
  assert.deepEqual(collection.events.map((e) => [e.type, e.id, e.count]), [['pickup', 'deerHide', 2]]);
  assert.equal(drops.all().length, 0);
  const heavy = new Inventory({ starter: false, capacity: 1 });
  const full = new Collection(world, heavy, drops.items);
  const [hide] = drops.lay({ x: 200, y: 50, killer: null, items: [{ id: 'deerHide', count: 1 }] }, world);
  const by = walker(hide.x, hide.y);
  for (let i = 0; i < 30; i++) full.update(1 / 30, by);
  assert.equal(full.events.length, 0);
  assert.deepEqual(drops.all(), [hide]);
  assert.equal(CHUNK_SIZE > 0, true);
});

test('a wolf drops a pelt four times in five and a bone half the time, all real items', () => {
  const random = mulberry32(77);
  const tally = { wolfPelt: 0, bone: 0 };
  for (let i = 0; i < 20000; i++) for (const { id, count } of rollDrops(KINDS.wolf, random)) tally[id] += count > 0 ? 1 : 0;
  assert.ok(Math.abs(tally.wolfPelt / 20000 - 0.8) < 0.015, `${tally.wolfPelt}`);
  assert.ok(Math.abs(tally.bone / 20000 - 0.5) < 0.015, `${tally.bone}`);
  for (const id of Object.keys(tally)) assert.ok(ITEMS[id], id);
  assert.equal(ITEMS.wolfPelt.name, 'Wolf Pelt');
});
