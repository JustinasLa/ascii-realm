import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Animals, REGION, RING } from '../src/entities/animals.js';
import { BIRD, Bird, Birds, MAX_FLOCKS, flockOf, inView, perch } from '../src/entities/birds.js';
import { toCells, toMetres } from '../src/entities/monsters.js';
import { CHUNK_SIZE, GRASS, SHORE, WATER } from '../src/world/world.js';

const dt = 1 / 30;
const metres = (a, b) => Math.hypot(...toMetres(b.x - a.x, b.y - a.y));
const at = (from, mx, mz) => {
  const [dx, dy] = toCells(mx, mz);
  return { x: from.x + dx, y: from.y + dy };
};

// Open grass unless told otherwise, every chunk loaded unless told
// otherwise; every chunk asked for is recorded.
function land({ water = () => false, shore = () => false, solid = () => false, loaded = () => true } = {}) {
  const asked = [];
  return {
    seed: 11,
    asked,
    loaded: (cx, cy) => {
      asked.push([cx, cy]);
      return loaded(cx, cy) ? { props: [] } : null;
    },
    isWalkable: (x, y) => !solid(x, y),
    typeAt: (x, y) => (water(x, y) ? WATER : shore(x, y) ? SHORE : GRASS),
    waterDepthAt: (x, y) => (water(x, y) ? 0.3 : 0),
  };
}

const still = (x, y) => ({ x, y, groundSpeed: 0, walkSpeed: 1.63 });
const walking = (x, y) => ({ x, y, groundSpeed: 1.4, walkSpeed: 1.63 });
const running = (x, y) => ({ x, y, groundSpeed: 3.6, walkSpeed: 1.63 });

// A flock of six feeding at the origin, nobody about.
function flock(world = land(), count = 6) {
  const birds = new Birds({ habitat: () => 'water' });
  const f = birds.spawn({ x: 0, y: 0, count, world });
  birds.calm();
  return { birds, f, world };
}

function run(birds, world, player, seconds, each = () => {}, extra = {}) {
  for (let t = 0; t < seconds; t += dt) {
    birds.update(dt, world, { player, ...extra });
    each(t);
  }
}

test('a region rolls the same flock every time, by its habitat, never on water', () => {
  assert.deepEqual(flockOf(5, 3, -2, 'meadow'), flockOf(5, 3, -2, 'meadow'));
  for (const h of ['meadow', 'edge', 'woodland']) {
    let n = 0;
    for (let i = 0; i < 3000; i++) {
      const roll = flockOf(9, i % 60, Math.floor(i / 60), h);
      if (!roll) continue;
      n++;
      assert.ok(roll.size >= BIRD.flock.size[0] && roll.size <= BIRD.flock.size[1]);
      assert.equal(roll.places.length, roll.size);
      assert.equal(Math.floor(roll.home.x / REGION.cols), i % 60, 'the home lies in its region');
    }
    assert.ok(Math.abs(n / 3000 - BIRD.habitat[h]) < 0.03, `${h} ${n / 3000}`);
  }
  for (let i = 0; i < 200; i++) assert.equal(flockOf(9, i, 0, 'water'), null);
});

test('flocks come in off screen in the ring, on loaded dry land, under the caps', () => {
  const world = land({ shore: (x) => x > 2000 && x < 2004 });
  const birds = new Birds({ seed: 3, habitat: () => 'meadow' });
  const player = still(0, 0);
  const view = { x0: -134, y0: -45, cols: 268, rows: 90 };
  run(birds, world, player, 2, () => {}, { view });
  assert.ok(birds.flocks.size >= 1 && birds.flocks.size <= MAX_FLOCKS);
  assert.ok(birds.list.length <= 8);
  for (const b of birds.list) {
    assert.ok(metres(player, b) >= RING.near - 2, 'never right by the player');
    assert.ok(!inView(view, b.flock.home.x, b.flock.home.y));
    assert.ok(perch(world, b.x, b.y));
  }
  // A smaller cap lets fewer in; no cap, none.
  const few = new Birds({ seed: 3, cap: 3, habitat: () => 'meadow' });
  run(few, world, player, 2, () => {}, { view });
  assert.ok(few.list.length <= 3);
  const none = new Birds({ seed: 3, cap: 0, habitat: () => 'meadow' });
  run(none, world, player, 1, () => {}, { view });
  assert.equal(none.list.length, 0);
  const off = new Birds({ seed: 3, enabled: false, habitat: () => 'meadow' });
  run(off, world, player, 1, () => {}, { view });
  assert.equal(off.list.length, 0);
});

test('a flock is never placed on unloaded land, and never asks for chunks it would make', () => {
  const world = land({ loaded: () => false });
  const birds = new Birds({ seed: 3, habitat: () => 'meadow' });
  run(birds, world, still(0, 0), 2);
  assert.equal(birds.list.length, 0);
  assert.equal(perch(land({ water: () => true }), 0, 0), false);
  assert.equal(perch(land({ shore: () => true }), 0, 0), false);
  assert.equal(perch(land({ solid: () => true }), 0, 0), false);
});

test('a flock let go beyond the ring rests, then is back at home', () => {
  const world = land();
  // Only one region holds a flock, so no other takes its place.
  let only = null;
  const birds = new Birds({ seed: 3, habitat: (w, x, y) => {
    const key = `${Math.floor(x / REGION.cols)},${Math.floor(y / REGION.rows)}`;
    return !only || key === only ? 'meadow' : 'water';
  } });
  const player = still(0, 0);
  run(birds, world, player, 1);
  const [key, f] = [...birds.flocks.entries()][0];
  only = key;
  birds.rolls.clear();
  const home = { ...f.home };
  const far = { ...player, ...at(player, 0, 400) };
  // Far off, every region it could hold flocks in is out of reach.
  run(birds, world, far, 1);
  assert.ok(!birds.flocks.has(key));
  run(birds, world, player, 10);
  assert.ok(!birds.flocks.has(key), 'resting');
  run(birds, world, player, RING.cooldown);
  assert.deepEqual(birds.flocks.get(key).home, home);
});

test('a calm flock never moves on its feet; one bird at a time flutters a short way', () => {
  const { birds, f, world } = flock();
  const player = still(...Object.values(at({ x: 0, y: 0 }, 40, 0)));
  const last = new Map(f.members.map((b) => [b, { x: b.x, y: b.y, state: b.state }]));
  let flutters = 0;
  const starts = new Map();
  run(birds, world, player, 300, () => {
    const now = f.members.filter((b) => b.state === 'flutter');
    assert.ok(now.length <= 1, 'never two at once');
    for (const b of f.members) {
      const was = last.get(b);
      if (b.state === 'feed' && was.state === 'feed') assert.ok(b.x === was.x && b.y === was.y, 'no sliding');
      if (b.state === 'flutter' && was.state !== 'flutter') {
        flutters++;
        starts.set(b, { x: was.x, y: was.y });
      }
      if (b.state !== 'flutter' && was.state === 'flutter') {
        const d = metres(starts.get(b), b);
        assert.ok(d <= BIRD.feed.flutter[1] + 0.5, `flutter ${d}`);
        for (const o of f.members) if (o !== b) assert.ok(metres(o, b) >= BIRD.flock.spacing - 1e-6);
      }
      last.set(b, { x: b.x, y: b.y, state: b.state });
    }
  });
  assert.ok(flutters >= 8, `${flutters} flutters`);
});

test('a walker watched at 8 m puts the flock up at 5.5 m; a runner from 9.5 m', () => {
  const { birds, f, world } = flock();
  run(birds, world, walking(...Object.values(at({ x: 0, y: 0 }, 8.4, 0))), 0.5);
  assert.ok(f.members.some((b) => b.state === 'alert'));
  assert.equal(f.phase, 'ground');
  // Stood still, it is watched only from half as far.
  const quiet = flock();
  run(quiet.birds, quiet.world, still(...Object.values(at({ x: 0, y: 0 }, 8.4, 0))), 0.5);
  assert.ok(quiet.f.members.every((b) => b.state === 'feed'));
  run(birds, world, walking(...Object.values(at({ x: 0, y: 0 }, 5.5, 0))), 0.05);
  assert.equal(f.phase, 'air');
  const r = flock();
  run(r.birds, r.world, running(...Object.values(at({ x: 0, y: 0 }, 9.5, 0))), 0.05);
  assert.equal(r.f.phase, 'air');
});

test('lift-off ripples through the flock within a quarter second and climbs away', () => {
  const { birds, f, world } = flock();
  const player = walking(...Object.values(at({ x: 0, y: 0 }, 5, 0)));
  const firsts = new Map();
  let t = 0;
  const climbing = new Map(f.members.map((b) => [b, 0]));
  run(birds, world, player, 0.4, () => {
    t += dt;
    for (const b of f.members) if (b.state === 'takeoff' && !firsts.has(b)) firsts.set(b, t);
  });
  assert.equal(firsts.size, f.members.length);
  const times = [...firsts.values()];
  assert.ok(Math.max(...times) - Math.min(...times) <= 0.3);
  assert.ok(new Set(times).size > 2, 'staggered');
  let lastD = Math.min(...f.members.map((b) => metres(player, b)));
  let second = 0;
  run(birds, world, player, 3, (tt) => {
    for (const b of f.members) {
      if (b.alt < 1.5 && b.alt > 0) {
        assert.ok(b.alt >= climbing.get(b) - 1e-9, 'rising');
        climbing.set(b, b.alt);
      }
    }
    if (Math.floor(tt) > second) {
      second = Math.floor(tt);
      const d = Math.min(...f.members.map((b) => metres(player, b)));
      assert.ok(d > lastD, 'further every second');
      lastD = d;
    }
  });
  assert.ok(f.members.every((b) => b.state === 'fly'));
  assert.ok(birds.events.some((e) => e.type === 'takeoff'));
});

test('noises: a cut 18 m off puts them up, lightning at 55 m only alerts, arrows by 6 m', () => {
  const cut = flock();
  const away = still(...Object.values(at({ x: 0, y: 0 }, 40, 0)));
  cut.birds.hear({ type: 'strike', ...at({ x: 0, y: 0 }, 18, 0) });
  run(cut.birds, cut.world, away, 0.1);
  assert.equal(cut.f.phase, 'air');
  const storm = flock();
  storm.birds.hear({ type: 'lightning', ...at({ x: 0, y: 0 }, 55, 0) });
  run(storm.birds, storm.world, away, 0.1);
  assert.equal(storm.f.phase, 'ground');
  assert.ok(storm.f.members.some((b) => b.state === 'alert'));
  const shot = flock();
  shot.birds.landed(...Object.values(at({ x: 0, y: 0 }, 5, 0)));
  run(shot.birds, shot.world, away, 0.1);
  assert.equal(shot.f.phase, 'air');
  const miss = flock();
  miss.birds.landed(...Object.values(at({ x: 0, y: 0 }, 9, 0)));
  run(miss.birds, miss.world, away, 0.1);
  assert.equal(miss.f.phase, 'ground');
  // Quiet noises, and others the flock pays no mind, change nothing.
  const quiet = flock();
  for (const e of [{ type: 'step', strength: 0.2 }, { type: 'slam', strength: 0.2 }, { type: 'hurt' },
    { type: 'spell', stage: 'charge' }, { type: 'swing' }]) quiet.birds.hear({ ...e, x: 0, y: 0 });
  run(quiet.birds, quiet.world, away, 0.1);
  assert.equal(quiet.f.phase, 'ground');
  // Loud ones each count, the focus standing in for a missing place.
  for (const e of [{ type: 'slam', strength: 1 }, { type: 'death', monster: {} }, { type: 'spell', stage: 'cast' },
    { type: 'spell', stage: 'impact' }, { type: 'step', strength: 0.9 }, { type: 'whirl' }]) {
    const one = flock();
    one.birds.focus = { x: 0, y: 0 };
    one.birds.hear({ ...e, ...(e.type === 'whirl' ? {} : { x: 0, y: 0 }) });
    run(one.birds, one.world, away, 0.1);
    assert.equal(one.f.phase, 'air', e.type);
  }
  const unheard = new Birds({ enabled: false });
  unheard.hear({ type: 'strike', x: 0, y: 0 });
  unheard.landed(0, 0);
  assert.equal(unheard.noises.length, 0);
  const nowhere = new Birds();
  nowhere.hear({ type: 'strike' });
  assert.equal(nowhere.noises.length, 0);
});

test('the flock lands together on open ground 25 to 45 m off, then rests with dulled senses', () => {
  const { birds, f, world } = flock();
  const player = walking(...Object.values(at({ x: 0, y: 0 }, 5, 0)));
  run(birds, world, player, 0.1);
  const spot = f.landing;
  assert.ok(spot && perch(world, spot.x, spot.y));
  const d = metres({ x: 0, y: 0 }, spot);
  assert.ok(d >= 25 - 1e-6 && d <= 45 + 1e-6, `${d}`);
  let apart = 0;
  let frames = 0;
  run(birds, world, player, 12, () => {
    const air = f.members.filter((b) => b.state === 'fly');
    if (air.length < 2) return;
    frames++;
    const ok = air.every((b) => air.every((o) => o === b || metres(o, b) >= 0.4));
    if (ok) apart++;
  });
  assert.ok(apart / frames >= 0.95, `${apart}/${frames}`);
  assert.equal(f.phase, 'ground');
  for (const b of f.members) {
    assert.ok(metres(b, spot) <= 3, 'by the landing spot');
    assert.equal(b.alt, 0);
  }
  assert.equal(birds.keen(f), 0.5);
  // The player walking up to 5.5 m no longer startles a resting flock.
  run(birds, world, walking(...Object.values(at(spot, 5, 0))), 0.1);
  assert.equal(f.phase, 'ground');
  run(birds, world, still(...Object.values(at(spot, 40, 0))), BIRD.rest);
  assert.equal(birds.keen(f), 1);
});

test('with nowhere open to land the flock flies off and is let go', () => {
  const world = land({ shore: (x, y) => Math.hypot(...toMetres(x, y)) > 10 });
  const birds = new Birds({ habitat: () => 'water' });
  const f = birds.spawn({ x: 0, y: 0, count: 3, world });
  birds.calm();
  birds.flocks.delete(f.key);
  f.key = 'land:1';
  birds.flocks.set(f.key, f);
  run(birds, world, walking(...Object.values(at({ x: 0, y: 0 }, 4, 0))), 0.1);
  assert.equal(f.landing, null);
  run(birds, world, still(...Object.values(at({ x: 0, y: 0 }, 4, 0))), 15);
  assert.equal(birds.flocks.size, 0, 'released once far off');
});

test('wolves and monsters put a flock up too; friends as well', () => {
  const away = still(...Object.values(at({ x: 0, y: 0 }, 40, 0)));
  const near = at({ x: 0, y: 0 }, 5, 0);
  const wolf = flock();
  run(wolf.birds, wolf.world, away, 0.1, () => {}, { predators: [{ ...near, groundSpeed: 1 }] });
  assert.equal(wolf.f.phase, 'air');
  const monster = flock();
  run(monster.birds, monster.world, away, 0.1, () => {}, { monsters: [{ ...near, speed: 0 }] });
  assert.equal(monster.f.phase, 'air');
  const friend = flock();
  run(friend.birds, friend.world, away, 0.1, () => {}, { peers: [{ player: { ...near, speed: 1 } }] });
  assert.equal(friend.f.phase, 'air');
  const bare = flock();
  run(bare.birds, bare.world, away, 0.1, () => {}, { peers: [{ ...near }] });
  assert.equal(bare.f.phase, 'air');
});

test('a flock spawned in the air flies, lands and feeds; calm settles it', () => {
  const world = land();
  const birds = new Birds();
  const f = birds.spawn({ x: 0, y: 0, count: 4, airborne: true, world, heading: 1 });
  assert.ok(f.members.every((b) => b.state === 'fly' && b.alt > 1));
  assert.ok(f.landing);
  run(birds, world, still(...Object.values(at({ x: 0, y: 0 }, -60, 0))), 12);
  assert.ok(f.members.every((b) => b.state === 'feed'));
  const again = birds.spawn({ x: 0, y: 0, count: 2, airborne: true });
  assert.equal(again.landing, null);
  birds.calm();
  assert.ok(again.members.every((b) => b.state === 'feed' && b.alt === 0));
  assert.equal(birds.spawn({ x: 0, y: 0, count: 2, world: land({ water: () => true }) }), null);
});

test('birds are never in the animals list, so nothing can strike or shoot them', () => {
  const animals = new Animals({ habitat: () => 'meadow' });
  const { birds, world } = flock();
  run(birds, world, walking(...Object.values(at({ x: 0, y: 0 }, 5, 0))), 2);
  assert.ok(!animals.list.some((a) => a instanceof Bird));
  assert.equal(animals.strike({ swing: 'spin' }, { x: 0, y: 0, heading: 0 }, 50).length, 0);
});

test('a bird alert decays; a bird on the ground stays grounded', () => {
  const b = new Bird(0, 0);
  b.alert({ x: 10, y: 0 });
  assert.equal(b.state, 'alert');
  const flockStub = { heading: 0, members: [b] };
  for (let t = 0; t < 3.2; t += dt) b.update(dt, land(), flockStub);
  assert.equal(b.state, 'feed');
  assert.ok(b.grounded && !b.airborne && b.alive);
  // A feeding bout ends in another bout, standing still.
  b.duration = 0;
  b.update(dt, land(), flockStub);
  assert.equal(b.state, 'feed');
  assert.equal(b.x, 0);
  // A bird alerted while in the air pays it no mind.
  b.setState('fly');
  b.alert({ x: 1, y: 1 });
  assert.equal(b.state, 'fly');
});

test('a flutter rises on the takeoff and comes down on the landing clip', () => {
  const b = new Bird(0, 0);
  const to = at({ x: 0, y: 0 }, 2, 0);
  b.flutter(to);
  const clips = [];
  for (let t = 0; t < 1.1; t += dt) {
    b.update(dt, land(), { heading: 0, members: [b] });
    clips.push(`${b.clip}:${Math.sign(Math.round(b.va * 100))}`);
  }
  assert.ok(clips.includes('takeoff:1'));
  assert.ok(clips.includes('land:-1'));
  assert.equal(b.state, 'feed');
  assert.ok(metres(b, to) < 1e-6);
});

test('regions of chunks: the region grid is the animals\' own', () => {
  assert.equal(REGION.cols, CHUNK_SIZE * 8);
});

test('a bird far from its place in the flock flies no faster than its top speed', () => {
  const world = land();
  const birds = new Birds();
  const f = birds.spawn({ x: 0, y: 0, count: 2, airborne: true, world, heading: 0 });
  f.members[1].x += 2000;
  run(birds, world, still(-3000, 0), 1);
  assert.ok(f.members[1].speed <= BIRD.flight.cruise * 1.3 + 1e-6);
});
