import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Animal, Animals, KINDS, LOUDNESS, MAX_ANIMALS, REGION, RING, footing, forestAt, habitatAt, herdOf,
  ready, regionHabitat, regionOf, wetAt } from '../src/entities/animals.js';
import { Monster, Monsters, toCells, toMetres } from '../src/entities/monsters.js';
import { Player } from '../src/entities/player.js';
import { playerState } from '../src/multiplayer/protocol.js';
import { RemotePlayers } from '../src/multiplayer/remote-players.js';
import { CHUNK_SIZE, GRASS, SHORE, WATER, World } from '../src/world/world.js';
import { runeScene } from '../test-support/spells.js';

const dt = 1 / 30;
const metres = (a, b) => Math.hypot(...toMetres(b.x - a.x, b.y - a.y));
const at = (from, mx, mz) => {
  const [dx, dy] = toCells(mx, mz);
  return { x: from.x + dx, y: from.y + dy };
};
const chunkOf = (x, y) => [Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE)];

// A stand-in for the world: open grass unless told otherwise, every chunk
// loaded unless told otherwise. It records every cell whose ground was
// read, so tests can check that no unloaded chunk was ever touched.
function land({ water = () => false, shore = () => false, solid = () => false, loaded = () => true, depth = 0.25,
  flow = null } = {}) {
  const touched = [];
  const world = {
    seed: 11,
    touched,
    loaded: (cx, cy) => (loaded(cx, cy) ? { props: [] } : null),
    isWalkable: (x, y) => {
      touched.push([x, y]);
      return !solid(x, y);
    },
    typeAt: (x, y) => {
      touched.push([x, y]);
      return water(x, y) ? WATER : shore(x, y) ? SHORE : GRASS;
    },
    waterDepthAt: (x, y) => (water(x, y) ? depth : 0),
  };
  if (flow) world.flowAt = (x, y, out = {}) => Object.assign(out, water(x, y) ? flow : { x: 0, y: 0, speed: 0 });
  return world;
}

// A player standing still, walking or running at a point.
const walker = (x, y, groundSpeed = 0) => ({ x, y, groundSpeed, walkSpeed: 1.63, runSpeed: 3.74 });

function run(animals, world, player, seconds, each = () => {}, extra = {}) {
  for (let t = 0; t < seconds; t += dt) {
    animals.update(dt, world, { player, ...extra });
    each(t);
  }
}

// A lone animal of a kind at the origin, its herd of one.
function lone(kind = 'deer', world = land()) {
  const animals = new Animals({ habitat: () => 'water' });
  animals.spawn(kind, { x: 0, y: 0, count: 1, world });
  animals.calm();
  return { animals, animal: animals.list[0], world };
}

test('a region rolls the same group every time, at most one, by its habitat', () => {
  assert.deepEqual(herdOf(5, 3, -2, 'meadow'), herdOf(5, 3, -2, 'meadow'));
  const tally = { meadow: { deer: 0, rabbit: 0 }, edge: { deer: 0, rabbit: 0 }, woodland: { deer: 0, rabbit: 0 } };
  for (const h of Object.keys(tally)) {
    for (let i = 0; i < 2000; i++) {
      const roll = herdOf(9, i % 50, Math.floor(i / 50), h);
      if (!roll) continue;
      tally[h][roll.kind.id]++;
      assert.ok(roll.size >= roll.kind.herd.size[0] && roll.size <= roll.kind.herd.size[1]);
      assert.equal(roll.places.length, roll.size);
      const { rx, ry } = regionOf(roll.home.x, roll.home.y);
      assert.deepEqual([rx, ry], [i % 50, Math.floor(i / 50)], 'the home lies inside its region');
      if (roll.kind.id === 'rabbit') assert.equal(roll.stag, false);
    }
  }
  for (const h of Object.keys(tally)) {
    const rate = tally[h].deer / 2000;
    assert.ok(Math.abs(rate - KINDS.deer.habitat[h]) < 0.04, `${h} deer ${rate}`);
  }
  assert.equal(tally.woodland.rabbit, 0, 'no rabbits in deep woods');
  assert.ok(tally.meadow.rabbit > tally.edge.rabbit);
  for (let i = 0; i < 200; i++) assert.equal(herdOf(9, i, 0, 'water'), null);
});

test('a region takes its commonest land, and water-logged regions hold nothing', () => {
  const world = land();
  let n = 0;
  assert.equal(regionHabitat(world, 0, 0, () => (n++ < 5 ? 'water' : 'meadow')), 'water');
  n = 0;
  assert.equal(regionHabitat(world, 0, 0, () => ['edge', 'edge', 'water', 'woodland'][n++ % 4]), 'edge');
  assert.equal(regionHabitat(world, 0, 0, () => 'woodland'), 'woodland');
});

test('habitat follows the forest field and the water, from the seed alone', () => {
  const world = { seed: 3, rivers: { near: () => [] } };
  const seen = new Set();
  for (let x = -4000; x < 4000; x += 97) {
    for (let y = -2000; y < 2000; y += 89) {
      const h = habitatAt(world, x, y);
      seen.add(h);
      const forest = forestAt(3, x, y);
      if (h === 'woodland') assert.ok(forest > 0.54);
      if (h === 'meadow') assert.ok(forest <= 0.42);
    }
  }
  assert.deepEqual([...seen].sort(), ['edge', 'meadow', 'water', 'woodland']);
  // A river channel is water wherever the land is.
  const river = { seed: 3, rivers: { near: () => [{ dist: 0 }] } };
  assert.equal(wetAt(river, 120, 40), true);
  assert.equal(habitatAt(river, 120, 40), 'water');
  assert.equal(wetAt({ seed: 3 }, 0, -100000) || true, true);
});

test('the same seed gives the same herds whatever order the land loaded in', () => {
  const homes = (order) => {
    const animals = new Animals({ seed: 4, habitat: () => 'meadow' });
    const world = land();
    for (const [rx, ry] of order) animals.rollOf(world, rx, ry);
    return order.map(([rx, ry]) => JSON.stringify(animals.rollOf(world, rx, ry)));
  };
  const order = [[0, 0], [1, 0], [0, 1], [-3, 2]];
  assert.deepEqual(homes(order), homes([...order].reverse()).reverse());
  // The cache keeps only the newest rolls.
  const animals = new Animals({ habitat: () => 'edge' });
  for (let i = 0; i < 80; i++) animals.rollOf(land(), i, 0);
  assert.equal(animals.rolls.size, 64);
});

test('herds appear off screen in the ring round the player, under the caps', () => {
  const animals = new Animals({ seed: 2, habitat: () => 'meadow' });
  const world = land();
  const player = walker(5000, 3000);
  const view = { x0: player.x - 134, y0: player.y - 56, cols: 268, rows: 91 };
  run(animals, world, player, 3, () => {}, { view });
  assert.ok(animals.herds.size > 0);
  for (const herd of animals.herds.values()) {
    const d = metres(player, herd.members[0]);
    assert.ok(d >= RING.near && d <= RING.far + 3, `home at ${d} m`);
    for (const a of herd.members) {
      assert.equal(Animals.inView(view, a.x, a.y), false);
      assert.ok(metres(player, a) >= RING.near - 2);
    }
  }
  assert.ok(animals.list.length <= MAX_ANIMALS);
  assert.ok(animals.count('deer') <= 8 && animals.count('rabbit') <= 6);
  const capped = new Animals({ seed: 2, counts: { deer: 3, rabbit: 2 }, habitat: () => 'meadow' });
  run(capped, world, player, 3, () => {}, { view });
  assert.ok(capped.count('deer') <= 3 && capped.count('rabbit') <= 2);
});

test('nothing spawns or moves onto land that is not loaded', () => {
  const animals = new Animals({ seed: 2, habitat: () => 'meadow' });
  const world = land({ loaded: () => false });
  run(animals, world, walker(0, 0), 2);
  assert.equal(animals.list.length, 0);
  assert.deepEqual(world.touched, []);
  assert.equal(ready({}, 0, 0), false, 'a world that cannot say counts as unloaded');
  // A herd at the edge of loaded land never steps off it.
  const edge = land({ loaded: (cx) => cx < 3 });
  const herd = new Animals({ habitat: () => 'water' });
  herd.spawn('deer', { x: 2 * CHUNK_SIZE, y: 0, count: 3, world: edge });
  herd.calm();
  const player = walker(2 * CHUNK_SIZE - toCells(4, 0)[0], 0);
  run(herd, edge, player, 8);
  for (const [x, y] of edge.touched) assert.ok(chunkOf(x, y)[0] < 3, 'only loaded chunks are read');
});

test('in the real world, footing and movement never generate a chunk', () => {
  const world = new World(3, { rivers: false });
  for (let cy = -1; cy <= 1; cy++) for (let cx = 3; cx <= 5; cx++) world.propsOf(cx, cy);
  let made = 0;
  const generate = world.generate.bind(world);
  world.generate = (...args) => {
    made++;
    return generate(...args);
  };
  // Near a chunk's west edge the walkability query reaches two chunks west.
  assert.equal(ready(world, 4 * CHUNK_SIZE + 5, 0), false);
  assert.equal(footing(world, KINDS.deer, 4 * CHUNK_SIZE + 5, 0), false);
  assert.equal(made, 0);
  const x = 4 * CHUNK_SIZE + CHUNK_SIZE / 2;
  assert.equal(ready(world, x, 0), true);
  const animals = new Animals({ habitat: () => 'water' });
  animals.spawn('deer', { x, y: 0, count: 3, world });
  animals.spawn('rabbit', { x, y: 4, count: 2, world });
  assert.ok(animals.list.length > 0);
  run(animals, world, walker(x - toCells(3, 0)[0], 0, 3.7), 4);
  assert.equal(made, 0, 'no chunk was generated');
});

test('an animal whose chunk is let go stands still and never makes it again', () => {
  const world = new World(3, { rivers: false });
  for (let cy = -1; cy <= 1; cy++) for (let cx = 3; cx <= 5; cx++) world.propsOf(cx, cy);
  const x = 4 * CHUNK_SIZE + CHUNK_SIZE / 2;
  const animals = new Animals({ habitat: () => 'water' });
  animals.spawn('deer', { x, y: 0, count: 2, world });
  const player = walker(x - toCells(20, 0)[0], 0);
  run(animals, world, player, 1);
  let made = 0;
  const generate = world.generate.bind(world);
  world.generate = (...args) => {
    made++;
    return generate(...args);
  };
  const [deer] = animals.list;
  const [cx, cy] = chunkOf(deer.x, deer.y);
  for (const [key, c] of world.chunks) if (c.cx === cx && c.cy === cy) world.chunks.delete(key);
  assert.equal(world.loaded(cx, cy), null);
  const was = { x: deer.x, y: deer.y };
  // Even a noise beside it only starts a flight it cannot yet run.
  animals.hear({ type: 'strike', x: deer.x, y: deer.y });
  run(animals, world, player, 2);
  assert.equal(made, 0, 'no chunk was generated');
  assert.deepEqual({ x: deer.x, y: deer.y }, was);
  assert.equal(deer.state, 'flee');
  assert.equal(deer.stateTime, 0, 'its time stands still too');
  assert.equal(deer.groundSpeed, 0);
  // Its land back, it carries on.
  world.propsOf(cx, cy);
  run(animals, world, player, 0.5);
  assert.ok(deer.stateTime > 0);
});

test('a herd far behind is let go, rests, then returns home as it was', () => {
  const player = walker(5000, 3000);
  // The one region round the player that holds a herd at a fair distance.
  let region = null;
  for (let ry = 21; ry <= 25 && !region; ry++) {
    for (let rx = 7; rx <= 12 && !region; rx++) {
      const roll = herdOf(2, rx, ry, 'meadow');
      const d = roll && metres(player, roll.home);
      if (d > RING.near + 2 && d < RING.far - 2) region = { rx, ry };
    }
  }
  const habitat = (world, x, y) => {
    const { rx, ry } = regionOf(x, y);
    return rx === region.rx && ry === region.ry ? 'meadow' : 'water';
  };
  const animals = new Animals({ seed: 2, habitat });
  const world = land();
  run(animals, world, player, 1);
  const key = `${region.rx},${region.ry}`;
  const herd = animals.herds.get(key);
  const before = [herd.home, herd.members.map((a) => [a.kind.id, a.variant])];
  player.x += toCells(500, 0)[0];
  run(animals, world, player, 1);
  assert.equal(animals.herds.has(key), false);
  player.x = 5000;
  run(animals, world, player, RING.cooldown - 5);
  assert.equal(animals.herds.has(key), false, 'the region rests');
  run(animals, world, player, 6);
  const again = animals.herds.get(key);
  assert.deepEqual([again.home, again.members.map((a) => [a.kind.id, a.variant])], before);
});

test('debug herds are placed at once, and none with nowhere to stand', () => {
  const animals = new Animals();
  const herd = animals.spawn('deer', { x: 0, y: 0, count: 4 });
  assert.equal(herd.members.length, 4);
  assert.equal(herd.leader.variant, 'stag');
  assert.ok(herd.members.slice(1).every((a) => a.variant === 'hind'));
  assert.equal(animals.spawn('rabbit', { x: 0, y: 0, world: land({ solid: () => true }) }), null);
  assert.equal(animals.spawn('deer', { x: 0, y: 0, count: 1, variant: 'hind' }).leader.variant, 'hind');
  run(animals, land(), walker(1e6, 0), 1);
  assert.ok(herd.members.every((a) => animals.list.includes(a)), 'debug herds stay however far the player goes');
});

test('a calm herd grazes much of the time, keeps together and stays dry', () => {
  const stream = (x) => x > 400 && x < 430;
  const world = land({ water: stream });
  const animals = new Animals({ seed: 3, habitat: () => 'water' });
  animals.spawn('deer', { x: 300, y: 0, count: 4, world });
  animals.calm();
  const player = walker(300, toCells(0, 80)[1]);
  let grazing = 0;
  let together = 0;
  let frames = 0;
  run(animals, world, player, 300, () => {
    const leader = animals.herds.values().next().value.leader;
    for (const a of animals.list) {
      frames++;
      if (a.state === 'graze') grazing++;
      if (a === leader || metres(a, leader) <= KINDS.deer.herd.cohesion + 2) together++;
      assert.equal(world.typeAt(a.x, a.y) === WATER, false, 'a calm deer never wades');
      assert.ok(a.calm, a.state);
    }
  });
  assert.ok(grazing / frames > 0.38 && grazing / frames < 0.62, `grazing ${grazing / frames}`);
  assert.ok(together / frames > 0.95, `together ${together / frames}`);
});

test('a walking player who stops at 8 m is watched, not fled', () => {
  const { animals, animal, world } = lone();
  const player = walker(...Object.values(at(animal, 9, 0)), 1.4);
  run(animals, world, player, 0.4, () => { player.x -= toCells(1.4 * dt, 0)[0]; });
  player.x = at(animal, 8, 0).x;
  player.groundSpeed = 0;
  run(animals, world, player, 1);
  assert.equal(animal.state, 'alert');
  assert.ok(Math.abs(animal.heading - Math.PI / 2) < 0.2, 'it turns to watch');
  run(animals, world, player, 5);
  assert.notEqual(animal.state, 'flee');
  assert.notEqual(animal.state, 'alert', 'it settles once the player keeps their distance');
});

test('deer bolt at 4.5 m from a walker and 8.5 m from a runner, the whole herd in a ripple', () => {
  const { animals, animal, world } = lone();
  const near = walker(...Object.values(at(animal, 4.5, 0)), 1.4);
  run(animals, world, near, dt);
  assert.equal(animal.state, 'flee');
  const second = lone();
  run(second.animals, second.world, walker(...Object.values(at(second.animal, 8.5, 0)), 3.7), dt);
  assert.equal(second.animal.state, 'flee');

  const herd = new Animals({ habitat: () => 'water' });
  const ground = land();
  herd.spawn('deer', { x: 0, y: 0, count: 4, world: ground });
  herd.calm();
  const player = walker(toCells(-6.5, 0)[0], 0, 3.7);
  const started = new Map();
  let time = 0;
  const distances = [];
  run(herd, ground, player, 4, (t) => {
    time = t;
    for (const a of herd.list) if (a.state === 'flee' && !started.has(a)) started.set(a, time);
    if (Math.abs(t - Math.round(t)) < dt / 2) distances.push(Math.min(...herd.list.map((a) => metres(player, a))));
  });
  assert.equal(started.size, 4, 'every member flees');
  const times = [...started.values()];
  assert.ok(Math.max(...times) - Math.min(...times) <= 0.5);
  assert.ok(new Set(times.map((t) => t.toFixed(3))).size > 1, 'they go in a ripple, not as one');
  for (let i = 1; i < distances.length; i++) assert.ok(distances[i] > distances[i - 1], 'the gap opens every second');
  // They gallop well clear of a running player.
  assert.ok(KINDS.deer.fleeSpeed >= 1.5 * 3.736);
  const flight = herd.herds.values().next().value.flight;
  assert.ok(herd.list.every((a) => Math.abs(Math.atan2(Math.sin(a.heading - flight), Math.cos(a.heading - flight))) < 0.6),
    'they run the same way');
});

test('after a flight deer slow to a trot, a walk, then stand; rabbits freeze upright first', () => {
  const { animals, animal, world } = lone();
  animal.bolt(world, at(animal, -3, 0));
  const states = new Set();
  run(animals, world, walker(1e6, 0), 14, () => states.add(animal.state));
  assert.ok(states.has('calm') && states.has('idle'));
  const rabbit = lone('rabbit');
  rabbit.animal.bolt(rabbit.world, at(rabbit.animal, -2, 0));
  const seen = [];
  run(rabbit.animals, rabbit.world, walker(1e6, 0), 12, () => {
    if (seen.at(-1) !== rabbit.animal.state) seen.push(rabbit.animal.state);
  });
  assert.deepEqual(seen.slice(0, 3), ['flee', 'freeze', 'idle']);
});

test('rabbits scatter each their own way, jinking as they go', () => {
  const world = land();
  const animals = new Animals({ habitat: () => 'water' });
  animals.spawn('rabbit', { x: 0, y: 0, count: 3, world });
  animals.calm();
  const player = walker(toCells(-3, 0)[0], 0);
  const turns = new Map();
  const last = new Map();
  const headings = new Map();
  run(animals, world, player, 3, () => {
    for (const a of animals.list) {
      if (a.state !== 'flee') continue;
      if (!headings.has(a) && a.stateTime > 0.03) headings.set(a, a.heading);
      if (last.has(a) && Math.abs(a.heading - last.get(a)) > 0.05) turns.set(a, (turns.get(a) ?? 0) + 1);
      last.set(a, a.heading);
    }
  });
  const hs = [...headings.values()];
  assert.equal(hs.length, 3);
  for (let i = 0; i < hs.length; i++) {
    for (let j = i + 1; j < hs.length; j++) {
      const d = Math.abs(Math.atan2(Math.sin(hs[i] - hs[j]), Math.cos(hs[i] - hs[j])));
      assert.ok(d >= 0.6, `headings ${hs[i]} and ${hs[j]}`);
    }
  }
  for (const a of animals.list) assert.ok((turns.get(a) ?? 0) >= 2, 'it jinks at least twice');
});

test('a rabbit fleeing toward a lake keeps to the dry grass, never the shore or water', () => {
  const lake = (x) => x > 60;
  const shore = (x) => x > 52 && x <= 60;
  const world = land({ water: lake, shore });
  const animals = new Animals({ habitat: () => 'water' });
  animals.spawn('rabbit', { x: 40, y: 0, count: 3, world });
  animals.calm();
  const player = walker(40 - toCells(2.5, 0)[0], 0, 3.7);
  run(animals, world, player, 8, () => {
    for (const a of animals.list) assert.ok(a.x <= 52, `a rabbit at ${a.x}`);
  });
  assert.ok(animals.list.some((a) => Math.abs(a.y) > 20), 'they run along the shore instead');
});

test('a deer fleeing across a river wades and is carried downstream; on dry land it never is', () => {
  const river = (x) => x > 30 && x < 90;
  const world = land({ water: river, flow: { x: 0, y: 1, speed: 1.2 } });
  const { animals, animal } = lone('deer', world);
  animal.x = 0;
  const player = walker(toCells(-3, 0)[0], 0, 3.7);
  let waded = false;
  let carried = 0;
  run(animals, world, player, 4, () => {
    if (animal.waterDepth > 0.05) waded = true;
    if (animal.carry.y > 0) carried = Math.max(carried, animal.carry.y);
    if (world.typeAt(animal.x, animal.y) !== WATER) return;
    assert.ok(animal.inFlight, 'only a deer in flight wades');
  });
  assert.ok(waded, 'it wades the river');
  assert.ok(carried > 0.05, 'the current pushes it downstream');
  const dry = lone('deer', land({ flow: { x: 0, y: 1, speed: 1.2 } }));
  run(dry.animals, dry.world, walker(toCells(-3, 0)[0], 0, 3.7), 3);
  assert.deepEqual(dry.animal.carry, { x: 0, y: 0 });
  // Only a shallow ford: deep water turns even a fleeing deer away.
  assert.equal(footing(land({ water: () => true, depth: 0.4 }), KINDS.deer, 0, 0, true), false);
  assert.equal(footing(land({ water: () => true, depth: 0.2 }), KINDS.deer, 0, 0, true), true);
  assert.equal(footing(land({ water: () => true, depth: 0.2 }), KINDS.deer, 0, 0, false), false);
});

test('a deer whose flight ends mid-stream wades on out to the bank, then calms', () => {
  const [bank] = toCells(4, 0);
  const river = (x) => Math.abs(x) < bank;
  const world = land({ water: river });
  // Placed on dry land, then the stream rises round it.
  const { animals, animal } = lone('deer');
  animal.bolt(world, at(animal, 0, -3));
  animal.duration = 0.2;
  let waded = false;
  run(animals, world, walker(1e6, 0), 10, () => {
    if (animal.state === 'wade') waded = true;
    if (river(animal.x)) assert.ok(animal.inFlight, `a ${animal.state} deer in the water`);
  });
  assert.ok(waded, 'it wades out');
  assert.ok(!river(animal.x), 'it reaches the bank');
  assert.ok(animal.calm || animal.state === 'calm');
  // With no bank in reach it keeps on its way, and looks again when stopped.
  const wide = lone('deer');
  wide.world = land({ water: () => true, solid: (x) => x > 3 });
  wide.animal.heading = Math.PI / 2;
  wide.animal.away = Math.PI / 2;
  wide.animal.setState('wade');
  run(wide.animals, wide.world, walker(1e6, 0), 1);
  assert.equal(wide.animal.state, 'wade');
  assert.equal(wide.animal.target, null);
  assert.ok(wide.animal.x <= 3);
});

test('a hemmed-in deer stops and looks for another way', () => {
  const box = (x, y) => Math.abs(x) > 12 || Math.abs(y) > 4;
  const { animals, animal, world } = lone('deer', land({ solid: box }));
  animal.bolt(world, at(animal, -2, 0));
  run(animals, world, walker(1e6, 0), 1);
  assert.ok(Math.abs(animal.x) <= 12 && Math.abs(animal.y) <= 4);
  // Side-steps get round a post in the way.
  const post = lone('deer', land({ solid: (x, y) => x > 5 && x < 9 && Math.abs(y) < 1 }));
  post.animal.heading = Math.PI / 2;
  assert.equal(post.animal.step(post.world, 6, 0), true);
  assert.ok(Math.abs(post.animal.y) > 0.5);
});

test('a friend across the network is judged by the pace they send', () => {
  const remotes = new RemotePlayers();
  const join = (id, from, mx, speed) => {
    const friend = new Player(...Object.values(at(from, mx, 0)));
    friend.speed = speed;
    remotes.sync([{ id, name: id, color: 1, state: playerState(friend) }], 'self', 1000);
    return remotes.peers.get(id);
  };
  const running = lone('deer');
  const runner = join('runner', running.animal, 8.5, 3.7);
  assert.equal(runner.player.groundSpeed, 0, 'ground covered is not sent');
  run(running.animals, running.world, walker(1e6, 0), dt, () => {}, { peers: [runner] });
  assert.equal(running.animal.state, 'flee', 'a running friend bolts deer at 8.5 m');
  const walking = lone('deer');
  const strider = join('walker', walking.animal, 8, 1.6);
  run(walking.animals, walking.world, walker(1e6, 0), dt, () => {}, { peers: [strider] });
  assert.equal(walking.animal.state, 'alert', 'a walking friend at 8 m is watched');
});

test('monsters and friends count as threats', () => {
  const { animals, animal, world } = lone('rabbit');
  const skeleton = new Monster(...Object.values(at(animal, 3, 0)), { risen: true });
  run(animals, world, walker(1e6, 0), dt, () => {}, { monsters: [skeleton] });
  assert.equal(animal.state, 'flee');
  const deer = lone('deer');
  const friend = { player: { ...at(deer.animal, 7, 0), groundSpeed: 4 } };
  run(deer.animals, deer.world, walker(1e6, 0), dt, () => {}, { peers: [friend] });
  assert.equal(deer.animal.state, 'flee');
  const ignored = lone('deer');
  run(ignored.animals, ignored.world, walker(1e6, 0), dt, () => {},
    { monsters: [{ ...at(ignored.animal, 7, 0), speed: 0 }], peers: [{ ...at(ignored.animal, 20, 0) }] });
  assert.equal(ignored.animal.state, 'idle', 'a still monster further off is only watched for');
});

// The noises the game really makes, captured from their emitters.
function strikeEvent() {
  const player = new Player(0, 0);
  player.attack();
  const meadow = { isWalkable: () => true, typeAt: () => GRASS };
  for (let t = 0; t < 2.5; t += 1 / 120) {
    player.update(1 / 120, meadow, { x: 0, y: 0 }, false);
    const strike = player.events.find((e) => e.type === 'strike');
    if (strike) return strike;
    player.events.length = 0;
  }
  throw new Error('no strike');
}

function sprintStep() {
  const player = new Player(0, 0);
  const meadow = { isWalkable: () => true, typeAt: () => GRASS };
  for (let t = 0; t < 3; t += 1 / 60) {
    player.update(1 / 60, meadow, { x: 1, y: 0 }, true);
    const step = player.events.find((e) => e.type === 'step' && e.strength > 0.6);
    if (step) return step;
    player.events.length = 0;
  }
  throw new Error('no step');
}

async function spellEvents() {
  const spell = (await import('../src/spells/definitions/lightning.js')).default;
  const scene = runeScene(spell, { range: 3 });
  const sounds = [];
  const bolts = [];
  scene.casting.onSound = (e) => sounds.push(e);
  scene.casting.onLightning = (e) => bolts.push({ type: 'lightning', ...e });
  assert.equal(scene.cast().ok, true);
  scene.advance(3);
  return { cast: sounds.find((e) => e.type === 'spell' && e.stage === 'cast'),
    impact: sounds.find((e) => e.type === 'spell' && e.stage === 'impact'), lightning: bolts[0] };
}

function monsterEvents() {
  const monsters = new Monsters({ counts: {} });
  const m = new Monster(0, 0, { risen: true });
  m.health = 10;
  monsters.list.push(m);
  m.takeHit(4, 10, 0);
  m.takeHit(40, 10, 0);
  monsters.collect(m);
  return { hurt: monsters.events.find((e) => e.type === 'hurt'), death: monsters.events.find((e) => e.type === 'death') };
}

// Animals of a kind at a distance from a noise, after it is heard.
function hearAt(kind, e, distance, count = 1) {
  const world = land();
  const animals = new Animals({ habitat: () => 'water' });
  const spot = at(e, distance, 0);
  animals.spawn(kind, { ...spot, count, world });
  animals.calm();
  animals.hear(e);
  animals.update(dt, world, { player: walker(1e6, 0) });
  return animals.list;
}

test('a sword cut scatters rabbits 17 m off; a deer 50 m off ignores it', () => {
  const strike = strikeEvent();
  assert.ok(hearAt('rabbit', strike, 17, 3).every((a) => a.state === 'flee' || a.boltIn !== null));
  assert.equal(hearAt('deer', strike, 50)[0].state, 'idle');
  assert.equal(hearAt('deer', strike, 25)[0].state, 'alert', 'a little further off it only looks up');
});

test('a spell cast puts deer to flight 28 m away, its impact and lightning further still', async () => {
  const { cast, impact, lightning } = await spellEvents();
  assert.equal(hearAt('deer', cast, 28)[0].state, 'flee');
  assert.equal(hearAt('deer', cast, 31)[0].state, 'alert');
  assert.equal(hearAt('rabbit', impact, 17)[0].state, 'flee');
  assert.equal(hearAt('deer', lightning, 29)[0].state, 'flee');
  assert.equal(LOUDNESS.lightning > LOUDNESS.cast, true);
});

test('a monster struck or slain nearby, and a sprinting footfall, are heard', () => {
  const { hurt, death } = monsterEvents();
  assert.equal(hearAt('deer', hurt, 15)[0].state, 'flee');
  assert.equal(hearAt('deer', death, 19)[0].state, 'flee');
  const step = sprintStep();
  assert.equal(hearAt('rabbit', step, 9)[0].state, 'flee');
  assert.equal(hearAt('rabbit', { ...step, strength: 0.4 }, 9)[0].state, 'idle', 'a walking step is not');
});

test('quiet noises, unknown ones and the player hurting pass unheard; placeless ones come from the player', () => {
  for (const e of [{ type: 'slam', strength: 0.25, x: 0, y: 0 }, { type: 'draw', x: 0, y: 0 },
    { type: 'spell', stage: 'pulse', x: 0, y: 0 }, { type: 'hurt', x: 0, y: 0, amount: 3 }]) {
    assert.equal(hearAt('deer', e, 3)[0].state, 'idle', e.type);
  }
  assert.equal(hearAt('deer', { type: 'whirl', x: 0, y: 0, strength: 1 }, 20)[0].state, 'flee');
  assert.equal(hearAt('deer', { type: 'land', x: 0, y: 0, strength: 0.6 }, 20)[0].state, 'flee');
  const world = land();
  const animals = new Animals({ habitat: () => 'water' });
  animals.hear({ type: 'whirl' });
  animals.spawn('deer', { x: 0, y: 0, count: 1, world });
  animals.calm();
  const player = walker(at({ x: 0, y: 0 }, 20, 0).x, 0);
  animals.update(dt, world, { player });
  animals.hear({ type: 'whirl' });
  animals.update(dt, world, { player });
  assert.equal(animals.list[0].state, 'flee');
});

test('turned off, wildlife hears nothing and keeps no noises', () => {
  const off = new Animals({ enabled: false });
  for (let i = 0; i < 100; i++) off.hear({ type: 'lightning', x: 0, y: 0 });
  assert.equal(off.noises.length, 0);
  run(off, land(), walker(0, 0), dt);
  assert.equal(off.noises.length, 0);
});

test('no wildlife when it is turned off or capped at zero', () => {
  const off = new Animals({ enabled: false, habitat: () => 'meadow' });
  off.spawn('deer', { x: 0, y: 0 });
  run(off, land(), walker(0, 0), 2);
  assert.equal(off.list.length, 0);
  const none = new Animals({ counts: { deer: 0, rabbit: 0 }, habitat: () => 'meadow' });
  run(none, land(), walker(0, 0), 2);
  assert.equal(none.list.length, 0);
});

test('a lone animal wanders off on its own and back toward its herd', () => {
  const world = land();
  const animals = new Animals({ seed: 5, habitat: () => 'water' });
  const herd = animals.spawn('deer', { x: 0, y: 0, count: 2, world });
  animals.calm();
  const [leader, stray] = herd.members;
  stray.x = leader.x + toCells(KINDS.deer.herd.cohesion + 3, 0)[0];
  const target = stray.pickTarget(world);
  assert.ok(metres(target, leader) < metres(stray, leader), 'a stray heads back');
  assert.equal(new Animal(KINDS.rabbit, 0, 0).pickTarget(land({ solid: () => true })), null);
  // With nowhere to go it stays put.
  const penned = lone('rabbit', land({ solid: (x, y) => Math.abs(x) > 1 || Math.abs(y) > 1 }));
  run(penned.animals, penned.world, walker(1e6, 0), 40, () => assert.notEqual(penned.animal.state, 'wander'));
  // A rabbit's stroll is a run of short lopes with pauses between.
  const bunny = lone('rabbit');
  const speeds = new Set();
  bunny.animal.target = at(bunny.animal, 3, 0);
  bunny.animal.setState('wander', 12);
  run(bunny.animals, bunny.world, walker(1e6, 0), 2, () => speeds.add(bunny.animal.speed));
  assert.ok(speeds.has(0) && speeds.has(KINDS.rabbit.walkSpeed));
  assert.equal(REGION.cols, CHUNK_SIZE * 8);
});
