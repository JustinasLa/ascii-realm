import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Animals, REGION, RING, lakeAt, wetAt } from '../src/entities/animals.js';
import { FISH, Fish, Fishes, MAX_SCHOOLS, homeWater, openWater, qualifies, schoolOf } from '../src/entities/fish.js';
import { toCells, toMetres } from '../src/entities/monsters.js';
import { fbm } from '../src/core/noise.js';
import { ASPECT, CHUNK_SIZE, GRASS, LAND_LIFT, SHORE_LEVEL, WATER, World } from '../src/world/world.js';

const dt = 1 / 30;
const metres = (a, b) => Math.hypot(...toMetres(b.x - a.x, b.y - a.y));
const at = (from, mx, mz) => {
  const [dx, dy] = toCells(mx, mz);
  return { x: from.x + dx, y: from.y + dy };
};
// The middle of a lake in the seed-11 terrain noise.
const LAKE = { x: -736, y: 400 };
const margin = (x, y) => SHORE_LEVEL - (fbm(x * ASPECT * 0.011, y * 0.011, 11, 5) + LAND_LIFT);

// A world over the real lake noise: water where the noise is lake, its
// depth growing out from the shore; optionally a river line with a current
// crossing it at `river` (cells across).
function lake({ river = null, flow = 0.5, loaded = () => true, shallow = false } = {}) {
  const inRiver = (x) => river !== null && Math.abs(x - river) < 3;
  const wet = (x, y) => inRiver(x) || margin(x, y) > 0.01;
  return {
    seed: 11,
    loaded: (cx, cy) => (loaded(cx, cy) ? { props: [] } : null),
    isWalkable: () => true,
    typeAt: (x, y) => (wet(x, y) ? WATER : GRASS),
    waterDepthAt: (x, y) => (!wet(x, y) ? 0 : shallow ? 0.1 : inRiver(x) ? 0.3 : Math.min(0.42, margin(x, y) * 3)),
    flowAt: (x, y, out = {}) => Object.assign(out, { speed: inRiver(x) ? flow : 0 }),
    rivers: { near: (x) => (river !== null && Math.abs(x - river) < 4 ? [{}] : []) },
  };
}

const still = (x, y, extra = {}) => ({ x, y, groundSpeed: 0, walkSpeed: 1.63, waterDepth: 0, ...extra });

function school(world = lake(), count = 4, from = LAKE) {
  const fishes = new Fishes();
  const s = fishes.spawn({ x: from.x, y: from.y, count, world });
  fishes.calm();
  return { fishes, s, world };
}

function run(fishes, world, player, seconds, each = () => {}, extra = {}) {
  for (let t = 0; t < seconds; t += dt) {
    fishes.update(dt, world, { player, ...extra });
    each(t);
  }
}

const away = still(LAKE.x + 2000, LAKE.y);

test('lakeAt is the lake noise alone, and wetAt adds the rivers to it', () => {
  const world = lake({ river: 0 });
  assert.equal(lakeAt(world, LAKE.x, LAKE.y), true);
  assert.equal(lakeAt(world, 0, 0), margin(0, 0) > 0);
  assert.equal(wetAt(world, 1, 0), true, 'the river is wet');
  assert.equal(lakeAt(world, 1, 0) || margin(1, 0) <= 0, true);
});

test('schools roll only in lake regions, the same every time, and home on open lake water', () => {
  const world = lake();
  const rx = Math.floor(LAKE.x / REGION.cols);
  const ry = Math.floor(LAKE.y / REGION.rows);
  assert.deepEqual(schoolOf(5, rx, ry, world), schoolOf(5, rx, ry, world));
  let rolled = 0;
  for (let seed = 0; seed < 400; seed++) if (schoolOf(seed, rx, ry, world)) rolled++;
  assert.ok(Math.abs(rolled / 400 - FISH.chance) < 0.08, `${rolled}`);
  // Dry regions far from any lake hold none.
  const dry = { ...world, seed: 11 };
  let none = 0;
  for (let i = 0; i < 40; i++) if (!schoolOf(1, 30 + i, 0, dry) && margin((30 + i + 0.5) * REGION.cols, REGION.rows / 2) < 0) none++;
  assert.ok(none > 0);
  const roll = { start: LAKE, size: 3 };
  const home = homeWater(world, roll);
  assert.ok(home && qualifies(world, home.x, home.y));
  // Not yet loaded, the answer waits; no open water at all, there is none.
  assert.equal(homeWater(lake({ loaded: () => false }), roll), undefined);
  assert.equal(homeWater(lake({ shallow: true }), roll), null);
});

test('a school comes in off screen once its chunks load, under the caps, and is let go far off', () => {
  let ready = false;
  const world = lake({ loaded: () => ready });
  const fishes = new Fishes({ seed: 2 });
  const player = still(...Object.values(at(LAKE, 0, 20)));
  run(fishes, world, player, 1);
  assert.equal(fishes.list.length, 0, 'deferred while unloaded');
  assert.ok([...fishes.rolls].every(([key, roll]) => roll === null
    && !schoolOf(2, ...key.split(',').map(Number), world)), 'and not cached');
  ready = true;
  for (let seed = 2; seed < 40 && !fishes.list.length; seed++) {
    Object.assign(fishes, new Fishes({ seed }));
    run(fishes, world, player, 1);
  }
  assert.ok(fishes.schools.size >= 1 && fishes.schools.size <= MAX_SCHOOLS);
  assert.ok(fishes.list.length <= 8);
  for (const f of fishes.list) {
    assert.ok(qualifies(world, f.x, f.y));
    assert.ok(metres(player, f.school.home) >= RING.near);
  }
  const keys = [...fishes.schools.keys()];
  const far = still(player.x, player.y + 2000);
  run(fishes, world, far, 1);
  assert.ok(keys.every((k) => !fishes.schools.has(k) && fishes.released.has(k)));
  const off = new Fishes({ enabled: false });
  run(off, world, player, 1);
  assert.equal(off.list.length, 0);
});

test('a school over 300 s stays on open water, close behind its leader, above the bed', () => {
  const { fishes, s, world } = school();
  let close = 0;
  let frames = 0;
  let swam = false;
  run(fishes, world, away, 300, () => {
    swam ||= s.members.some((f) => f.rate > FISH.rates[0]);
    for (const f of s.members) {
      assert.ok(qualifies(world, f.x, f.y));
      assert.ok(f.swim <= world.waterDepthAt(f.x, f.y) - 0.05 + 1e-9);
      if (f === s.leader) continue;
      frames++;
      if (metres(f, s.leader) <= 2) close++;
    }
  });
  assert.ok(close / frames >= 0.95, `${close}/${frames}`);
  assert.ok(swam, 'swims');
  assert.ok(metres(s.leader, LAKE) > 0.5, 'the leader cruised about');
});

test('the player near makes every fish dart apart; they settle and follow again', () => {
  const { fishes, s, world } = school();
  const centre = { x: s.leader.x, y: s.leader.y };
  const player = still(...Object.values(at(centre, 3.5, 0)));
  const start = metres(player, centre);
  run(fishes, world, player, dt);
  assert.ok(s.members.every((f) => f.state === 'dart'));
  const heads = s.members.map((f) => f.heading);
  for (let i = 0; i < heads.length; i++) {
    for (let j = i + 1; j < heads.length; j++) {
      const d = Math.abs(Math.atan2(Math.sin(heads[i] - heads[j]), Math.cos(heads[i] - heads[j])));
      assert.ok(d >= 0.5, `headings ${d}`);
    }
  }
  run(fishes, world, player, 0.3);
  const mean = (k) => s.members.reduce((a, f) => a + f[k], 0) / s.members.length;
  assert.ok(metres(player, { x: mean('x'), y: mean('y') }) > start, 'away from the player');
  assert.ok(fishes.events.some((e) => e.type === 'dart'));
  run(fishes, world, away, 0.8);
  assert.ok(s.members.every((f) => f.state === 'settle'));
  run(fishes, world, away, 8);
  assert.ok(s.members.every((f) => f.state !== 'dart' && f.state !== 'settle'));
  assert.ok(s.members.filter((f) => f !== s.leader).every((f) => f.state === 'follow'));
});

test('wading in scares them from 5 m; standing dry on the bank at 5 m does not', () => {
  const dry = school();
  const centre = { x: dry.s.leader.x, y: dry.s.leader.y };
  run(dry.fishes, dry.world, still(...Object.values(at(centre, 5, 0))), 0.1);
  assert.ok(dry.s.members.every((f) => f.state !== 'dart'));
  const wet = school();
  run(wet.fishes, wet.world, still(...Object.values(at(centre, 5, 0)), { waterDepth: 0.2 }), 0.1);
  assert.ok(wet.s.members.every((f) => f.state === 'dart'));
  const runner = school();
  run(runner.fishes, runner.world, still(...Object.values(at(centre, 6, 0)), { groundSpeed: 3.6 }), 0.1);
  assert.ok(runner.s.members.every((f) => f.state === 'dart'));
  const friend = school();
  run(friend.fishes, friend.world, away, 0.1, () => {}, { peers: [{ player: still(...Object.values(at(centre, 2, 0))) }] });
  assert.ok(friend.s.members.every((f) => f.state === 'dart'));
});

test('a shaft landing 3 m off, or a loud noise near, scares them; far ones do not', () => {
  const shot = school();
  const c = { x: shot.s.leader.x, y: shot.s.leader.y };
  shot.fishes.landed(...Object.values(at(c, 3, 0)));
  run(shot.fishes, shot.world, away, dt);
  assert.ok(shot.s.members.every((f) => f.state === 'dart'));
  const miss = school();
  miss.fishes.landed(...Object.values(at(c, 9, 0)));
  run(miss.fishes, miss.world, away, dt);
  assert.ok(miss.s.members.every((f) => f.state !== 'dart'));
  for (const e of [{ type: 'strike' }, { type: 'slam', strength: 1 }, { type: 'land' }, { type: 'spell', stage: 'impact' },
    { type: 'lightning' }]) {
    const one = school();
    one.fishes.hear({ ...e, ...at(c, 8, 0) });
    run(one.fishes, one.world, away, dt);
    assert.ok(one.s.members.every((f) => f.state === 'dart'), e.type);
    const far = school();
    far.fishes.hear({ ...e, ...at(c, 20, 0) });
    run(far.fishes, far.world, away, dt);
    assert.ok(far.s.members.every((f) => f.state !== 'dart'), `${e.type} far`);
  }
  const quiet = school();
  for (const e of [{ type: 'step' }, { type: 'slam', strength: 0.2 }, { type: 'spell', stage: 'cast' }]) quiet.fishes.hear({ ...e, ...c });
  quiet.fishes.focus = c;
  quiet.fishes.hear({ type: 'strike' });
  assert.equal(quiet.fishes.noises.length, 1, 'only the cut, at the focus');
  const nowhere = new Fishes();
  nowhere.hear({ type: 'strike' });
  const deaf = new Fishes({ enabled: false });
  deaf.hear({ type: 'strike', x: 0, y: 0 });
  deaf.landed(0, 0);
  assert.equal(nowhere.noises.length + deaf.noises.length, 0);
});

test('about three darts in ten break the surface, and only from shallow-swimming fish', () => {
  let rings = 0;
  let total = 0;
  for (let i = 0; i < 200; i++) {
    const f = new Fish(0, 0, { seed: 1000 + i });
    f.swim = i % 2 ? 0.1 : 0.25;
    f.dart(0);
    total += i % 2;
    for (const e of f.events) {
      if (!e.ring) continue;
      assert.ok(f.swim < 0.15);
      rings++;
    }
  }
  assert.ok(Math.abs(rings / total - FISH.dart.ring) <= 0.08, `${rings}/${total}`);
});

test('a dart toward the shore slides along it and never beaches', () => {
  const { fishes, s, world } = school();
  // Drive the school toward the nearest bank and keep scaring it.
  for (let k = 0; k < 20; k++) {
    for (const f of s.members) f.dart(Math.PI / 2);
    run(fishes, world, away, 0.5, () => {
      for (const f of s.members) assert.ok(world.waterDepthAt(f.x, f.y) >= FISH.minDepth);
    });
  }
});

test('a lake region with a slow river: the fish keep to the lake and stop at the river', () => {
  // A river through the lake, slow enough to pass for still water, still
  // never counts: no river line may lie within a cell.
  const river = LAKE.x + 60;
  const world = lake({ river, flow: 0.02 });
  assert.equal(openWater(world, river, LAKE.y), false);
  const home = homeWater(world, { start: { x: river, y: LAKE.y }, size: 3 });
  assert.ok(home && Math.abs(home.x - river) > 4, 'homed in the lake');
  const { fishes, s } = school(world, 3, { x: river - 40, y: LAKE.y });
  for (let k = 0; k < 10; k++) {
    for (const f of s.members) f.dart(Math.PI / 2);
    run(fishes, world, away, 0.5, () => {
      for (const f of s.members) assert.ok(f.x < river - 3, 'never into the river');
    });
  }
  // A fast one is not still water at all.
  assert.equal(openWater(lake({ river, flow: 0.5 }), river, LAKE.y), false);
  assert.equal(openWater({ ...world, loaded: () => null }, LAKE.x, LAKE.y), false);
  const noFlow = { ...world };
  delete noFlow.flowAt;
  delete noFlow.rivers;
  assert.equal(openWater(noFlow, LAKE.x, LAKE.y), true);
});

test('open water at the edge of a loaded chunk is refused, never generating the next', () => {
  // Deep lake right up to the corner and the east edge of one chunk of the
  // real seed-11 world; the current's blend reaches half a cell over.
  const world = new World(11, { rivers: false });
  world.chunk(-12, 6);
  const edges = [[-767.8, 384.2], [-767.8, 400.5], [-704.3, 400.5], [-740.5, 384.3]];
  for (const [x, y] of edges) {
    assert.equal(world.typeAt(x, y), WATER);
    assert.equal(openWater(world, x, y), false, `${x},${y}`);
    assert.equal(qualifies(world, x, y), false);
    assert.equal(world.chunks.size, 1, 'no chunk generated');
  }
  assert.equal(homeWater(world, { start: { x: -767, y: 385 }, size: 3 }), undefined);
  assert.equal(world.chunks.size, 1);
  // With its neighbours there too, the same water qualifies.
  for (const [cx, cy] of [[-13, 5], [-12, 5], [-13, 6], [-11, 6]]) world.chunk(cx, cy);
  assert.equal(openWater(world, -767.8, 384.2), true);
  assert.equal(openWater(world, -704.3, 400.5), true);
  assert.equal(world.chunks.size, 5);
});

test('spawning snaps to open water within 6 m, or finds none on dry land', () => {
  const world = lake();
  const fishes = new Fishes();
  assert.equal(fishes.spawn({ x: 0, y: 0, world: { ...world, typeAt: () => GRASS } }), null);
  const s = fishes.spawn({ x: LAKE.x, y: LAKE.y, count: 3, world });
  assert.equal(s.members.length, 3);
  assert.equal(fishes.debugGroups, 1);
});

test('fish are never in the animals list', () => {
  const animals = new Animals();
  const { fishes, world } = school();
  run(fishes, world, away, 1);
  assert.ok(!animals.list.some((a) => a instanceof Fish));
  assert.ok(fishes.list.every((f) => f.alive));
  assert.equal(CHUNK_SIZE > 0, true);
});
