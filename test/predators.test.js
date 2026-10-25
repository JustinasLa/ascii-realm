import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Animal, Animals, KINDS, MAX_ANIMALS, MAX_PREDATORS, RING, footing } from '../src/entities/animals.js';
import { toCells, toMetres } from '../src/entities/monsters.js';
import { PACK_REGION, PHASES, engaged, mayWade, newPack, packHabitat, packOf, provoke, slotPoint, steer, targetOf,
  updatePack } from '../src/entities/predators.js';
import { GRASS, WATER } from '../src/world/world.js';

const dt = 1 / 30;
const W = KINDS.wolf;
const metres = (a, b) => Math.hypot(...toMetres(b.x - a.x, b.y - a.y));
const at = (from, mx, mz) => {
  const [dx, dy] = toCells(mx, mz);
  return { x: from.x + dx, y: from.y + dy };
};
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Open grass unless told otherwise, every chunk loaded unless told
// otherwise; every cell whose ground was read is recorded.
function land({ water = () => false, solid = () => false, loaded = () => true, depth = 0.25 } = {}) {
  const touched = [];
  return {
    seed: 11,
    touched,
    loaded: (cx, cy) => (loaded(cx, cy) ? { props: [] } : null),
    isWalkable: (x, y) => {
      touched.push([x, y]);
      return !solid(x, y);
    },
    typeAt: (x, y) => {
      touched.push([x, y]);
      return water(x, y) ? WATER : GRASS;
    },
    waterDepthAt: (x, y) => (water(x, y) ? depth : 0),
  };
}

// A player standing at a point, facing down the screen.
const hunter = (x = 0, y = 0) => ({ x, y, heading: 0, air: 0, groundSpeed: 0, walkSpeed: 1.35, runSpeed: 5.3,
  vitals: { health: 100 } });

// A pack of `count` wolves `away` metres down the screen from the player.
function pack({ count = 4, away = 18, world = land(), player = hunter(), counts = { wolf: 4, deer: 8, rabbit: 6 },
  seed = 3 } = {}) {
  const animals = new Animals({ seed, counts, habitat: () => 'water' });
  const p = at(player, 0, away);
  const herd = animals.spawn('wolf', { x: p.x, y: p.y, count, world });
  return { animals, herd, wolves: herd.members, world, player };
}

function run(scene, seconds, each = () => {}) {
  const { animals, world, player } = scene;
  for (let t = 0; t < seconds; t += dt) {
    animals.update(dt, world, { player });
    if (each(t, animals.events) === false) break;
    animals.events.length = 0;
  }
}

test('a pack region rolls the same pack every time, none in meadow or water, by its habitat', () => {
  assert.deepEqual(packOf(5, 3, -2, 'woodland', W), packOf(5, 3, -2, 'woodland', W));
  const rates = { meadow: 0, edge: 0, woodland: 0 };
  for (const h of Object.keys(rates)) {
    for (let i = 0; i < 2000; i++) {
      const px = i % 50;
      const py = Math.floor(i / 50);
      const roll = packOf(9, px, py, h, W);
      if (!roll) continue;
      rates[h]++;
      assert.ok(roll.size >= 2 && roll.size <= 4);
      assert.equal(roll.places.length, roll.size);
      assert.equal(Math.floor(roll.home.x / PACK_REGION.cols), px);
      assert.equal(Math.floor(roll.home.y / PACK_REGION.rows), py);
    }
  }
  assert.equal(rates.meadow, 0);
  for (const h of ['edge', 'woodland']) assert.ok(Math.abs(rates[h] / 2000 - W.habitat[h]) < 0.02, `${h} ${rates[h]}`);
  for (let i = 0; i < 100; i++) assert.equal(packOf(9, i, 0, 'water', W), null);
  assert.equal(packHabitat(['water', 'water', 'water', 'woodland']), 'water');
  assert.equal(packHabitat(['water', 'water', 'edge', 'woodland']), 'edge');
  assert.equal(packHabitat(['woodland', 'woodland', 'edge', 'meadow']), 'woodland');
  assert.deepEqual(PHASES, ['roam', 'stalk', 'surround', 'hunt', 'chase', 'feed', 'rout']);
});

test('the same seed gives the same packs whatever order the land loaded in; the cache stays small', () => {
  const homes = (order) => {
    const animals = new Animals({ seed: 4, habitat: () => 'woodland' });
    return order.map(([px, py]) => JSON.stringify(animals.packRollOf(land(), px, py)));
  };
  const order = [[0, 0], [1, 0], [0, 1], [-3, 2], [5, 5], [7, -1]];
  assert.deepEqual(homes(order), homes([...order].reverse()).reverse());
  const animals = new Animals({ habitat: () => 'edge' });
  for (let i = 0; i < 50; i++) animals.packRollOf(land(), i, 0);
  assert.equal(animals.packRolls.size, 32);
});

test('packs appear off screen in the ring, one at a time, under their own cap beside the prey', () => {
  const animals = new Animals({ seed: 2, counts: { deer: 8, rabbit: 6, wolf: 4 }, habitat: () => 'woodland' });
  const world = land();
  const player = hunter(5000, 3000);
  const view = { x0: player.x - 134, y0: player.y - 56, cols: 268, rows: 91 };
  let wolves = 0;
  for (let i = 0; i < 400 && !wolves; i++) {
    animals.update(dt, world, { player: { ...player, vitals: { health: 0 } }, view });
    wolves = animals.count('wolf');
  }
  assert.ok(wolves > 0, 'a pack came');
  assert.equal(animals.packs.length, 1);
  assert.ok(wolves <= MAX_PREDATORS);
  for (const a of animals.list.filter((x) => x.predator)) {
    assert.ok(!Animals.inView(view, a.x, a.y));
  }
  const home = animals.packs[0].pack.home;
  const d = metres(player, home);
  assert.ok(d >= RING.near && d <= RING.far, `${d}`);
  // Prey caps are their own: ten prey and four wolves live together.
  const full = new Animals({ counts: { deer: 10, wolf: 4 }, habitat: () => 'water' });
  for (let i = 0; i < 4; i++) full.spawn('deer', { x: i * 40, y: 0, count: 3 });
  assert.equal(full.list.length, 12);
  assert.equal(full.fits('deer', 1), false);
  assert.ok(MAX_ANIMALS === 10 && full.fits('wolf', 4));
  full.spawn('wolf', { x: 0, y: 200, count: 4 });
  assert.equal(full.fits('wolf', 1), false, 'one pack at a time');
  assert.equal(new Animals({ counts: { wolf: 2 } }).fits('wolf', 3), false, 'the ?wolves cap holds');
  // None where the land is not loaded, nor with wolves capped at zero.
  const none = new Animals({ seed: 2, counts: { wolf: 0 }, habitat: () => 'woodland' });
  for (let i = 0; i < 30; i++) none.update(dt, world, { player, view });
  assert.equal(none.count('wolf'), 0);
  const unloaded = new Animals({ seed: 2, counts: { wolf: 4 }, habitat: () => 'woodland' });
  for (let i = 0; i < 30; i++) unloaded.update(dt, land({ loaded: () => false }), { player, view });
  assert.equal(unloaded.count('wolf'), 0);
});

test('an engaged pack is not let go while one of it is near; a far, quiet one is', () => {
  const scene = pack({ away: 15 });
  const { animals, herd, world, player, wolves } = scene;
  herd.key = 'pack:0,0';
  run(scene, 1);
  assert.equal(herd.pack.phase, 'stalk');
  // Everyone but one at 70 m: the pack stays.
  for (const w of wolves.slice(1)) Object.assign(w, at(player, 0, 70));
  assert.equal(animals.releasable(herd, player, null), false);
  for (const w of wolves) Object.assign(w, at(player, 0, 70));
  assert.equal(animals.releasable(herd, player, null), true, 'all beyond 64 m');
  herd.pack.phase = 'roam';
  assert.equal(animals.releasable(herd, player, null), true);
  for (const w of wolves) Object.assign(w, at(player, 0, 40));
  assert.equal(animals.releasable(herd, player, null), false);
  // A routed pack goes once out of sight and 30 m off.
  herd.pack.phase = 'rout';
  assert.equal(animals.releasable(herd, player, { x0: -1e6, y0: -1e6, cols: 2e6, rows: 2e6 }), false);
  assert.equal(animals.releasable(herd, player, null), true);
  animals.release(herd);
  assert.equal(animals.count('wolf'), 0);
  assert.ok(world);
});

test('the player is taken within 20 m; a rabbit is chosen over a nearer deer; a near player over prey', () => {
  const members = [{ x: 0, y: 0 }];
  const player = (m) => ({ ref: { ...at({ x: 0, y: 0 }, 0, m), vitals: { health: 100 } }, kind: 'player' });
  const prey = (kind, m) => ({ ref: { ...at({ x: 0, y: 0 }, m, 0), alive: true, kind: KINDS[kind] }, kind });
  assert.equal(targetOf(members, [player(18)], W).kind, 'player');
  assert.equal(targetOf(members, [player(22)], W), null);
  assert.equal(targetOf(members, [prey('deer', 18), prey('rabbit', 20)], W).kind, 'rabbit');
  assert.equal(targetOf(members, [prey('rabbit', 5), player(10)], W).kind, 'player');
  assert.equal(targetOf(members, [player(15), prey('rabbit', 5)], W).kind, 'rabbit', 'beyond 12 m prey may win');
  assert.equal(targetOf(members, [prey('deer', 30)], W), null);
  assert.equal(targetOf(members, [player(10)], W, true), null, 'a wary pack lets the player be');
  const dead = player(5);
  dead.ref.vitals.health = 0;
  assert.equal(targetOf(members, [dead], W), null);
});

test('a wary pack ignores a player at 10 m until struck, then turns on them past the stalk', () => {
  const scene = pack({ away: 10 });
  const { animals, herd, wolves } = scene;
  animals.waryUntil.set(herd.key, 1000);
  run(scene, 2);
  assert.equal(herd.pack.target, null);
  assert.equal(animals.hit(wolves[0], 5, scene.player.x, scene.player.y), true);
  assert.equal(herd.pack.target.ref, scene.player);
  assert.equal(herd.pack.phase, 'surround');
  // Struck again while ringing, it goes straight in.
  herd.pack.phase = 'hunt';
  wolves[1].hurtFor = 0;
  animals.hit(wolves[1], 5, scene.player.x, scene.player.y);
  assert.equal(herd.pack.phase, 'hunt');
  provoke(herd.pack, scene.player);
  assert.equal(herd.pack.phase, 'hunt');
  herd.pack.phase = 'rout';
  provoke(herd.pack, scene.player);
  assert.equal(herd.pack.phase, 'rout', 'a routed pack keeps running');
});

test('stalk, surround, hunt: a slow low stalk, an even ring, at most two biters, mostly from behind', () => {
  const scene = pack({ away: 18 });
  const { herd, wolves, player } = scene;
  let surroundAt = null;
  let maxStalk = 0;
  let huntAt = null;
  let lunges = 0;
  let behind = 0;
  let maxBiters = 0;
  run(scene, 40, (t, events) => {
    const phase = herd.pack.phase;
    if (phase === 'stalk') for (const w of wolves) maxStalk = Math.max(maxStalk, w.groundSpeed);
    if (phase === 'surround' && surroundAt === null) {
      surroundAt = t;
      assert.ok(Math.min(...wolves.map((w) => metres(w, player))) <= W.stalk.until + 0.1);
    }
    if (phase === 'hunt' && huntAt === null) {
      huntAt = t;
      assert.ok(t - surroundAt <= 6);
      // Slots are filled, near enough, and evenly spaced.
      const angles = wolves.map((w) => Math.atan2(...toMetres(w.x - player.x, w.y - player.y))).sort((a, b) => a - b);
      const gaps = angles.map((a, i) => wrap((angles[(i + 1) % angles.length] - a) || 0)).map((g) => (g < 0 ? g + Math.PI * 2 : g));
      const placed = wolves.filter((w) => metres(w, slotPoint(herd.pack, player, w.slot, wolves.length, W)) < 1).length;
      assert.equal(placed, wolves.length);
      assert.ok(gaps.every((g) => Math.abs(g - (Math.PI * 2) / wolves.length) < 0.4), `${gaps}`);
    }
    if (phase === 'hunt') maxBiters = Math.max(maxBiters, herd.pack.biters.size);
    for (const e of events) {
      if (e.type !== 'swing') continue;
      lunges++;
      const a = e.animal;
      const from = Math.atan2(...toMetres(a.x - player.x, a.y - player.y));
      if (Math.abs(wrap(from - (player.heading + Math.PI))) < 2.2) behind++;
    }
  });
  assert.ok(maxStalk > 0.5 && maxStalk <= 1.0, `stalks at ${maxStalk}`);
  assert.ok(huntAt !== null);
  assert.ok(maxBiters <= 2 && maxBiters >= 1);
  assert.ok(lunges >= 5, `${lunges} lunges`);
  assert.ok(behind / lunges >= 0.7, `${behind}/${lunges} from behind`);
});

test('a ring place on blocked ground moves round the ring; with none clear it stays put', () => {
  const p = newPack({ x: 0, y: 0 }, 4);
  const target = { x: 0, y: 0 };
  const plain = slotPoint(p, target, 0, 4, W);
  assert.ok(Math.abs(metres(target, plain) - W.ring.radius) < 1e-6);
  const blocked = slotPoint(p, target, 0, 4, W, (x, y) => Math.hypot(x - plain.x, y - plain.y) > 0.5);
  assert.ok(Math.hypot(blocked.x - plain.x, blocked.y - plain.y) > 0.5);
  assert.deepEqual(slotPoint(p, target, 0, 4, W, () => false), plain);
});

test('the bite lands once at its wind-up, in reach and in front, and a jump or a step away dodges it', () => {
  const setup = (offset = 1.2) => {
    const scene = pack({ count: 1, away: offset });
    const wolf = scene.wolves[0];
    const p = scene.herd.pack;
    p.target = { ref: scene.player, kind: 'player' };
    p.phase = 'hunt';
    p.biters.add(wolf);
    wolf.role = 'bite';
    wolf.heading = Math.PI;
    return { ...scene, wolf, p };
  };
  const bites = (scene, seconds, each) => {
    const out = [];
    run(scene, seconds, (t, events) => {
      each?.(t);
      for (const e of events) if (e.type === 'hit-player') out.push({ t, ...e });
    });
    return out;
  };
  const a = setup();
  let swingAt = null;
  const landed = bites(a, 1.2, () => {
    if (swingAt === null && a.wolf.state === 'attack') swingAt = a.animals.time;
  });
  assert.equal(landed.length, 1);
  assert.equal(landed[0].amount, 10);
  assert.ok(Math.abs(a.animals.time - 1.2 < 0 ? 0 : swingAt + W.attack.windUp - (landed[0].t + dt)) < 0.1);
  // In the air, it misses.
  const b = setup();
  b.player.air = 0.8;
  assert.equal(bites(b, 1.2).length, 0);
  // Stepped 2 m away during the wind-up, it misses.
  const c = setup();
  const away = bites(c, 1.2, () => {
    if (c.wolf.state === 'attack' && c.wolf.stateTime > 0.1) Object.assign(c.player, at({ x: 0, y: 0 }, 0, -2.5));
  });
  assert.equal(away.length, 0);
  // Behind it, out of its arc, it misses.
  const d = setup();
  let turned = false;
  const behind = bites(d, 1.2, () => {
    if (!turned && d.wolf.state === 'attack' && d.wolf.stateTime > W.attack.windUp * 0.75) {
      d.wolf.heading = 0;
      turned = true;
    }
  });
  assert.equal(behind.length, 0);
  // Over time, no wolf bites faster than its swing and cooldown allow.
  const e = setup();
  const many = bites(e, 20);
  assert.ok(many.length >= 3);
  assert.ok(many.length <= 20 / (W.attack.cooldown + W.attack.swingTime) + 1, `${many.length}`);
});

test('a full pack against a standing player: about one skeleton\'s pressure', () => {
  // Measured from the start of the hunt, over 20 s.
  const scene = pack({ away: 9 });
  let total = 0;
  let from = null;
  run(scene, 40, (t, events) => {
    if (from === null && scene.herd.pack.phase === 'hunt') from = t;
    if (from === null) return true;
    for (const e of events) if (e.type === 'hit-player') total += e.amount;
    return t - from < 20;
  });
  assert.ok(total >= 80 && total <= 200, `${total} in 20 s`);
});

test('struck, a wolf flinches still, its bite lost; badly cut it slinks off once, then rejoins', () => {
  const scene = pack({ count: 3, away: 1.2 });
  const { animals, herd, player } = scene;
  const wolf = herd.members[0];
  herd.pack.target = { ref: player, kind: 'player' };
  herd.pack.phase = 'hunt';
  herd.pack.biters.add(wolf);
  wolf.role = 'bite';
  wolf.heading = Math.PI;
  run(scene, 0.2, () => wolf.state !== 'attack');
  assert.equal(wolf.state, 'attack');
  const before = { x: wolf.x, y: wolf.y };
  const hit = animals.strike({ type: 'strike', swing: 'a' }, { ...player, heading: 0, feel: { reach: 1.5 } }, 22);
  assert.deepEqual(hit, [wolf]);
  assert.ok(wolf.flinch && wolf.bit);
  let bitten = 0;
  run(scene, W.flinch - dt, (t, events) => {
    bitten += events.filter((e) => e.type === 'hit-player' && e.animal === wolf).length;
  });
  assert.ok(metres(before, wolf) < 0.05, 'stands in its flinch');
  assert.equal(bitten, 0, 'its bite is lost');
  assert.ok(wolf.panicked && wolf.retreatFor >= 3 - W.flinch);
  // It slinks off: the distance grows for three seconds.
  let last = metres(wolf, player);
  let grew = 0;
  run(scene, 3, () => {
    const d = metres(wolf, player);
    if (d > last + 1e-6) grew++;
    last = d;
  });
  assert.ok(grew > 60, `${grew}`);
  assert.equal(wolf.state, 'retreat');
  assert.ok(mayWade(wolf));
  run(scene, 3);
  assert.equal(wolf.retreatFor, 0);
  assert.notEqual(wolf.state, 'retreat');
  // Cut again it does not panic a second time; two cuts kill it.
  wolf.hurtFor = 0;
  const left = wolf.retreatFor;
  wolf.health = 30;
  animals.hit(wolf, 12, player.x, player.y);
  assert.equal(wolf.retreatFor, left);
  wolf.hurtFor = 0;
  animals.hit(wolf, 22, player.x, player.y);
  assert.equal(wolf.alive, false);
});

test('two sword cuts 0.6 s apart kill a wolf; an arrow on a roaming pack sets them all on the archer', () => {
  const scene = pack({ count: 3, away: 1 });
  const { animals, wolves, player } = scene;
  const wolf = wolves[0];
  animals.hit(wolf, 22, player.x, player.y);
  run(scene, 0.6);
  animals.hit(wolf, 22, player.x, player.y);
  assert.equal(wolf.alive, false);
  const far = pack({ count: 3, away: 30 });
  far.animals.update(dt, far.world, { player: far.player });
  assert.equal(far.herd.pack.phase, 'roam');
  far.animals.hit(far.wolves[1], 10, far.player.x, far.player.y);
  assert.equal(far.herd.pack.target.ref, far.player);
  let reached = false;
  run(far, 6, () => {
    reached = far.wolves.every((w) => w.state === 'trot' || w.state === 'run' || w.state === 'snarl' || w.state === 'attack');
    return !reached;
  });
  assert.ok(reached, 'every wolf comes for the archer');
});

test('a pack that loses half its number routs, grows wary, and comes back short and still wary', () => {
  const scene = pack({ count: 4, away: 6 });
  const { animals, herd, wolves, player } = scene;
  herd.key = 'pack:3,3';
  run(scene, 1);
  animals.hit(wolves[1], 999, player.x, player.y);
  assert.notEqual(herd.pack.phase, 'rout');
  animals.hit(wolves[2], 999, player.x, player.y);
  assert.equal(herd.pack.phase, 'rout');
  assert.equal(herd.pack.lost, 2);
  const living = wolves.filter((w) => w.alive);
  let last = Math.min(...living.map((w) => metres(w, player)));
  let shrank = 0;
  run(scene, W.routFor - 0.2, () => {
    const d = Math.min(...living.map((w) => metres(w, player)));
    if (d < last - 1e-6) shrank++;
    last = d;
  });
  assert.ok(shrank < 10, `${shrank}`);
  assert.ok(living.every((w) => metres(w, player) > 30));
  // Out of view and well away, a routed pack may be let go.
  assert.equal(animals.releasable(herd, player, null), true);
  run(scene, 0.5);
  assert.equal(herd.pack.phase, 'roam');
  assert.equal(animals.wary(herd.key), true);
  // Let go, its region rests; back after the rest but inside the 90 s, it is
  // still wary; after them it is not.
  animals.release(herd);
  assert.deepEqual(animals.culled.get('pack:3,3'), { count: 2, stag: false });
  animals.time += 40;
  assert.equal(animals.wary('pack:3,3'), true);
  animals.time += 60;
  assert.equal(animals.wary('pack:3,3'), false);
  assert.equal(animals.waryUntil.size, 0, 'expired wariness is forgotten');
  // The leader down with two or fewer left routs it too.
  const small = pack({ count: 3, away: 6 });
  small.animals.hit(small.wolves[0], 999, small.player.x, small.player.y);
  assert.equal(small.herd.pack.phase, 'rout');
});

test('a region\'s pack comes back short of the wolves killed, and wary while it is', () => {
  const animals = new Animals({ seed: 2, counts: { wolf: 4 }, habitat: () => 'woodland' });
  const world = land();
  const player = hunter(5000, 3000);
  const asleep = { ...player, vitals: { health: 0 } };
  const view = { x0: player.x - 134, y0: player.y - 56, cols: 268, rows: 91 };
  for (let i = 0; i < 200 && !animals.packs.length; i++) animals.update(dt, world, { player: asleep, view });
  const herd = animals.packs[0];
  const size = herd.members.length;
  animals.hit(herd.members[0], 999, player.x, player.y);
  animals.waryUntil.set(herd.key, animals.time + 90);
  animals.release(herd);
  animals.time += RING.cooldown + 1;
  animals.scanIn = 0;
  animals.update(dt, world, { player: asleep, view });
  const back = animals.packs.find((h) => h.key === herd.key);
  if (size > 1) {
    assert.ok(back, 'it came back');
    assert.equal(back.members.length, size - 1);
    assert.equal(animals.wary(back.key), true);
  }
  // Wiped out, it never returns.
  animals.culled.set(herd.key, { count: 9, stag: false });
  animals.release(back ?? herd);
  animals.time += RING.cooldown + 1;
  animals.scanIn = 0;
  animals.update(dt, world, { player: asleep, view });
  assert.ok(!animals.packs.some((h) => h.key === herd.key));
});

test('a pack hunts deer: the herd notices the stalk, bolts, is run down; the kill drops nothing and is fed on', () => {
  const world = land();
  const player = hunter(0, -3000);
  const animals = new Animals({ seed: 5, counts: { wolf: 4, deer: 8 }, habitat: () => 'water' });
  const deer = animals.spawn('deer', { x: 0, y: 0, count: 3, world });
  animals.calm();
  const p = at({ x: 0, y: 0 }, 0, 22);
  const herd = animals.spawn('wolf', { x: p.x, y: p.y, count: 4, world });
  let noticedAt = null;
  let boltAt = null;
  let killed = null;
  let drops = 0;
  const near = () => Math.min(...herd.members.flatMap((w) => deer.members.map((d) => metres(w, d))));
  run({ animals, world, player }, 60, (t, events) => {
    for (const e of events) {
      if (e.type === 'alert' && noticedAt === null) noticedAt = near();
      if (e.type === 'bolt' && boltAt === null) boltAt = near();
    }
    drops += animals.drops.length;
    if (!killed) killed = deer.members.find((d) => !d.alive) ?? null;
    return !(killed && herd.pack.phase === 'feed' && herd.members.every((w) => w.state === 'feed'));
  });
  assert.ok(noticedAt === null || noticedAt <= 10.5, `noticed at ${noticedAt}`);
  assert.ok(boltAt <= 12.5, `bolted at ${boltAt}`);
  assert.ok(killed, 'a deer came down');
  assert.equal(drops, 0, 'a wolf kill leaves nothing');
  assert.deepEqual(animals.culled.size, 0, 'debug herds are not culled');
  assert.equal(herd.pack.carcass, killed);
  assert.ok(killed.linger >= W.feed + 2);
  for (const w of herd.members) assert.ok(metres(w, killed) < 1.5);
  // A player who comes close is taken for a thief.
  Object.assign(player, at(killed, 0, -6));
  animals.update(dt, world, { player });
  assert.equal(herd.pack.target.ref, player);
  assert.equal(herd.pack.phase, 'surround');
});

test('over 20 seeded runs, wolves bring down a deer or rabbit in at least a third', () => {
  let caught = 0;
  for (let run = 0; run < 20; run++) {
    const world = land();
    const player = hunter(0, -3000);
    const animals = new Animals({ seed: run + 1, counts: { wolf: 4, deer: 8, rabbit: 6 }, habitat: () => 'water' });
    const kind = run % 2 ? 'rabbit' : 'deer';
    animals.spawn(kind, { x: 0, y: 0, count: 3, world });
    animals.calm();
    const p = at({ x: 0, y: 0 }, (run % 5) - 2, 20);
    animals.spawn('wolf', { x: p.x, y: p.y, count: 2 + (run % 3), world });
    for (let t = 0; t < 45; t += dt) {
      animals.update(dt, world, { player });
      animals.events.length = 0;
      if (animals.list.some((a) => !a.predator && !a.alive)) {
        caught++;
        break;
      }
    }
  }
  assert.ok(caught >= 7, `${caught} of 20`);
});

test('a feeding pack goes back to roaming after its meal, or when the body is gone', () => {
  const scene = pack({ count: 2, away: 30 });
  const { herd, wolves } = scene;
  const body = new Animal(KINDS.rabbit, wolves[0].x, wolves[0].y);
  body.takeHit(999, 0, 0);
  herd.pack.carcass = body;
  herd.pack.phase = 'feed';
  run(scene, W.feed + 0.2);
  assert.equal(herd.pack.phase, 'roam');
  herd.pack.carcass = body;
  herd.pack.phase = 'feed';
  herd.pack.phaseTime = 0;
  body.sunk = 1;
  run(scene, dt);
  assert.equal(herd.pack.phase, 'roam');
});

test('a fleeing player is chased by the whole pack, ringed again once caught; a chase gives up in time', () => {
  const scene = pack({ away: 6 });
  const { herd, player } = scene;
  run(scene, 2);
  assert.ok(['surround', 'hunt'].includes(herd.pack.phase));
  player.groundSpeed = 5;
  Object.assign(player, at(player, 0, -9));
  run(scene, dt * 2);
  assert.equal(herd.pack.phase, 'chase');
  assert.ok(herd.members.some((w) => w.state === 'run'));
  player.groundSpeed = 0;
  run(scene, 1);
  assert.equal(herd.pack.phase, 'surround');
  // A chase with no bite for twelve seconds is given up.
  herd.pack.phase = 'chase';
  herd.pack.chaseFor = W.attack.chase + 1;
  updatePack(herd.pack, herd.members, { player, prey: [], kind: W, wary: false, makeWary() {}, clear: () => true }, dt);
  assert.equal(herd.pack.target, null);
});

test('a target that gets away or leads the pack too far from home is let go', () => {
  const scene = pack({ away: 15 });
  const { herd, player } = scene;
  run(scene, 1);
  assert.equal(herd.pack.phase, 'stalk');
  Object.assign(player, at(player, 0, -40));
  run(scene, dt);
  assert.equal(herd.pack.target, null);
  assert.equal(herd.pack.phase, 'roam');
  // Prey dying out of sight of the pack's notice sends it home too.
  herd.pack.target = { ref: player, kind: 'player' };
  herd.pack.home = at(herd.members[0], 0, 70);
  Object.assign(player, at(herd.members[0], 0, -10));
  run(scene, dt);
  assert.equal(herd.pack.target, null, 'leashed');
  // A player struck down is let be.
  herd.pack.home = { x: herd.members[0].x, y: herd.members[0].y };
  herd.pack.target = { ref: player, kind: 'player' };
  herd.pack.phase = 'hunt';
  player.vitals.health = 0;
  run(scene, dt);
  assert.equal(herd.pack.phase, 'roam');
  // A stalk that runs long turns into a ring.
  player.vitals.health = 100;
  Object.assign(player, at(herd.members[0], 0, -15));
  herd.pack.target = { ref: player, kind: 'player' };
  herd.pack.phase = 'stalk';
  herd.pack.phaseTime = W.stalk.max;
  updatePack(herd.pack, herd.members, { player, prey: [], kind: W, wary: false, makeWary() {}, clear: () => true }, dt);
  assert.equal(herd.pack.phase, 'surround');
});

test('prey stalked too long, or that bolts, is chased', () => {
  const p = newPack({ x: 0, y: 0 }, 2);
  const members = [{ x: 0, y: 0, alive: true }];
  const deer = new Animal(KINDS.deer, ...Object.values(at({ x: 0, y: 0 }, 0, 20)));
  p.target = { ref: deer, kind: 'deer' };
  p.phase = 'stalk';
  p.phaseTime = W.stalk.max;
  const ctx = { player: null, prey: [deer], kind: W, wary: false, makeWary() {}, clear: () => true };
  updatePack(p, members, ctx, dt);
  assert.equal(p.phase, 'chase');
  p.phase = 'stalk';
  p.phaseTime = 0;
  deer.state = 'flee';
  updatePack(p, members, ctx, dt);
  assert.equal(p.phase, 'chase');
  updatePack(p, [], ctx, dt);
  assert.equal(p.phase, 'chase', 'a pack with nobody left decides nothing');
});

test('wolves and monsters ignore each other; a rabbit still flees the monster', () => {
  const run2 = (monsters) => {
    const scene = pack({ count: 1, away: 30, player: hunter(0, -9000) });
    const wolf = scene.wolves[0];
    const animals = scene.animals;
    const rabbit = animals.spawn('rabbit', { x: wolf.x + 4000, y: wolf.y, count: 1 }).members[0];
    const states = [];
    for (let t = 0; t < 3; t += dt) {
      animals.update(dt, scene.world, { player: scene.player, monsters: monsters(wolf, rabbit) });
      states.push(`${wolf.state}${wolf.x.toFixed(3)}`);
    }
    return { states, rabbit, pack: scene.herd.pack };
  };
  const without = run2(() => []);
  const withSkeleton = run2((w, r) => [{ x: w.x + 2, y: w.y, groundSpeed: 0 }, { x: r.x + 2, y: r.y, groundSpeed: 0 }]);
  assert.deepEqual(withSkeleton.states, without.states);
  assert.equal(withSkeleton.pack.target, null);
  assert.equal(withSkeleton.rabbit.state, 'flee');
});

test('deer fear wolves: a running wolf at 8 m bolts a deer; a sword cut does not scare a wolf', () => {
  assert.ok(KINDS.deer.fears.includes('predator') && KINDS.rabbit.fears.includes('predator'));
  const world = land();
  const animals = new Animals({ counts: { wolf: 4, deer: 8 }, habitat: () => 'water' });
  const deer = animals.spawn('deer', { x: 0, y: 0, count: 1, world }).members[0];
  animals.calm();
  const p = at(deer, 0, 8);
  const wolf = animals.spawn('wolf', { x: p.x, y: p.y, count: 1, world }).members[0];
  wolf.groundSpeed = 5;
  wolf.update = () => {};
  animals.update(dt, world, { player: hunter(0, -9000) });
  assert.equal(deer.state, 'flee');
  // The noise of a cut 3 m away leaves a wolf as it was.
  const scene = pack({ count: 1, away: 3 });
  scene.animals.hear({ type: 'strike', x: scene.player.x, y: scene.player.y });
  scene.animals.update(dt, scene.world, { player: { ...scene.player, vitals: { health: 0 } } });
  assert.notEqual(scene.wolves[0].state, 'flee');
});

test('wolves never step onto unloaded land, never stroll into water, and wade only on the hunt', () => {
  const stream = (x) => x > 40 && x < 52;
  const world = land({ water: (x) => stream(x), loaded: (cx) => cx < 6 });
  const scene = pack({ count: 3, away: 1, world, player: hunter(30, 0) });
  const { herd, wolves } = scene;
  // Roaming and stalking, nobody enters water or unloaded land.
  herd.pack.target = null;
  scene.animals.waryUntil.set(herd.key, 1e9);
  run(scene, 20, () => {
    for (const w of wolves) {
      assert.ok(!stream(w.x), 'no stroll into the stream');
      assert.ok(Math.floor(w.x / 16) < 6);
    }
  });
  const wolf = wolves[0];
  assert.equal(footing(world, W, 45, wolf.y, wolf.inFlight), false, 'a roaming wolf may not stand in it');
  herd.pack.phase = 'chase';
  assert.equal(wolf.inFlight, true);
  assert.equal(footing(world, W, 45, wolf.y, wolf.inFlight), true, 'a chasing one may');
  // A chase that ends mid-stream wades out to the bank.
  Object.assign(wolf, { x: 46, y: wolf.y });
  herd.pack.phase = 'roam';
  herd.pack.target = null;
  let out = false;
  run(scene, 8, () => {
    if (!stream(wolf.x)) out = true;
    return !out;
  });
  assert.ok(out, 'it waded out');
  // A wolf wading when its pack takes to the hunt again carries on.
  Object.assign(wolf, { x: 46 });
  wolf.setState('wade');
  wolf.retreatFor = 2;
  steer(wolf, { world, player: scene.player, kind: W, clear: () => true }, dt);
  assert.notEqual(wolf.state, 'wade');
  wolf.retreatFor = 0;
  wolf.setState('wade');
  wolf.target = null;
  const move = steer(wolf, { world, player: scene.player, kind: W, clear: () => true }, dt);
  assert.equal(move.speed, W.trotSpeed);
});

test('when the player falls, packs let them be and go home to rest', () => {
  const scene = pack({ away: 6 });
  const { animals, herd, player } = scene;
  run(scene, 2);
  assert.ok(herd.pack.target);
  herd.members[1].retreatFor = 2;
  animals.disengage();
  assert.equal(herd.pack.target, null);
  assert.equal(herd.pack.phase, 'roam');
  assert.ok(herd.members.every((w) => w.retreatFor === 0 && w.role === 'ring'));
  const land2 = pack({ away: 6 });
  land2.herd.key = 'pack:1,1';
  land2.animals.disengage();
  assert.equal(land2.animals.count('wolf'), 0);
  assert.ok(land2.animals.released.has('pack:1,1'));
  assert.ok(player);
});

test('engaged wolves are marked for drawing first, and only while living', () => {
  const scene = pack({ away: 6 });
  const wolf = scene.wolves[0];
  assert.equal(engaged(wolf), false);
  scene.herd.pack.phase = 'hunt';
  assert.equal(engaged(wolf), true);
  scene.herd.pack.phase = 'roam';
  wolf.state = 'attack';
  assert.equal(engaged(wolf), true);
  wolf.state = 'dead';
  assert.equal(engaged(wolf), false);
  assert.equal(engaged(new Animal(KINDS.deer, 0, 0)), false);
});

test('a roaming pack keeps near home, the leader turning back from too far', () => {
  const scene = pack({ count: 2, away: 40, player: hunter(0, -9000) });
  const { herd, wolves } = scene;
  herd.pack.home = at(wolves[0], 0, 0);
  Object.assign(wolves[0], at(herd.pack.home, 25, 0));
  run(scene, 60);
  assert.ok(metres(wolves[0], herd.pack.home) < 30);
  // Hemmed in on every side, the leader stands idle.
  const spot = at(hunter(0, -9000), 0, 40);
  const boxed = pack({ count: 1, away: 40, player: hunter(0, -9000),
    world: land({ solid: (x, y) => Math.abs(x - spot.x) > 1.5 || Math.abs(y - spot.y) > 0.5 }) });
  const w = boxed.wolves[0];
  w.setState('idle', 0);
  steer(w, { world: boxed.world, player: boxed.player, kind: W, clear: () => true }, dt);
  assert.equal(w.state, 'idle');
});

test('a pack let go mid-rout is wary from the moment it broke, and still wary when it comes back', () => {
  const scene = pack({ count: 4, away: 6 });
  const { animals, herd, wolves, player } = scene;
  herd.key = 'pack:4,4';
  run(scene, 1);
  animals.hit(wolves[1], 999, player.x, player.y);
  animals.hit(wolves[2], 999, player.x, player.y);
  assert.equal(herd.pack.phase, 'rout');
  assert.equal(animals.wary(herd.key), true);
  run(scene, 2);
  assert.ok(herd.pack.phaseTime < W.routFor);
  animals.release(herd);
  animals.time += RING.cooldown + 1;
  assert.equal(animals.wary('pack:4,4'), true);
  animals.time += W.wary;
  assert.equal(animals.wary('pack:4,4'), false);
});

test('a killing blow from the player turns the rest of the pack off its prey and onto them', () => {
  const scene = pack({ count: 4, away: 6 });
  const { animals, herd, wolves, player } = scene;
  run(scene, 0.5);
  const deer = { x: player.x + 40, y: player.y, alive: true, kind: KINDS.deer };
  herd.pack.target = { ref: deer, kind: 'deer' };
  herd.pack.phase = 'chase';
  const victim = wolves.find((w) => w !== herd.leader);
  animals.hit(victim, 999, player.x, player.y);
  assert.equal(victim.alive, false);
  assert.notEqual(herd.pack.phase, 'rout');
  assert.equal(herd.pack.target.ref, player);
  assert.equal(herd.pack.phase, 'surround');
});

test('a deer tires only when wolves run it: after its wind, back once rested, never below the player\'s run', () => {
  const world = land();
  const animals = new Animals({ counts: { deer: 8 }, habitat: () => 'water' });
  const deer = animals.spawn('deer', { x: 0, y: 0, count: 1, world }).members[0];
  animals.calm();
  const D = KINDS.deer;
  const chase = (kind, seconds) => {
    const from = at(deer, 0, 6);
    deer.bolt(world, from);
    deer.duration = 99;
    const speeds = [];
    for (let t = 0; t < seconds; t += dt) {
      const threat = { kind, ...at(deer, 0, 6), moving: true, running: true, distance: 6 };
      speeds.push({ t, speed: deer.think(dt, world, threat).speed });
    }
    return speeds;
  };
  const wolves = chase('predator', D.flee.wind + 1);
  assert.ok(wolves.filter((s) => s.t < D.flee.wind - 0.1).every((s) => s.speed === D.fleeSpeed));
  assert.ok(wolves.filter((s) => s.t > D.flee.wind + 0.1).every((s) => s.speed === D.fleeSpeed * D.flee.tired));
  // Out of the chase it gets its breath back at half the rate it lost it.
  deer.setState('idle', 99);
  for (let t = 0; t < (D.flee.wind + 1) * 2 + 0.5; t += dt) deer.think(dt, world, null);
  assert.equal(deer.spent, 0);
  assert.equal(chase('predator', 1).at(-1).speed, D.fleeSpeed);
  // From the player alone it runs on fresh, past the player's sprint.
  deer.setState('idle', 99);
  deer.spent = 0;
  const player = chase('player', D.flee.wind * 2);
  assert.ok(player.every((s) => s.speed === D.fleeSpeed));
  assert.ok(D.flee.tired * D.fleeSpeed < hunter().runSpeed && D.fleeSpeed > hunter().runSpeed);
  assert.equal(deer.spent, 0);
});
