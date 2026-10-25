import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mulberry32 } from '../src/core/rng.js';
import { SCALE, TILT } from '../src/entities/rig.js';
import { FINE } from '../src/render/cells.js';
import { AsciiRenderer } from '../src/render/renderer.js';
import { bakePiece, pieceModel, sampler } from '../src/world/debris-art.js';
import { AFTER_STORM, BEACH_TIME, BUCKETS, CAP, CAP_STORM, Debris, EVERY, KINDS, LIFETIME, NEAR, RETRY, SIM_MARGIN,
  bobStep, footprintLoaded, orientationBucket, spawnPoint, stormy } from '../src/world/debris.js';
import { crossSpeed, toCells } from '../src/world/rivers.js';
import { ASPECT, GRASS, WATER, World } from '../src/world/world.js';

// Debris floats down the rivers: spawned upstream now and then, carried by
// the current, knocked about by banks and stones, and gone again far away.

const ROW = SCALE * TILT;
const RIVER = { id: 7 };

// A straight river running east along row 0, `half` metres wide either side,
// that empties into still water past column `lakeFrom`. Land beyond the
// banks; `grass` paints cells over. Stones are { x, y, r } (cells, layout r).
function channel({ half = 0.3, speed = 0.5, bend = 0, secondary = 0, lakeFrom = Infinity, stones = [], grass = null,
  loaded = () => true, dir = 0, spring = -5000 } = {}) {
  const dx = Math.cos(dir), dy = Math.sin(dir);
  // Where a cell lies across the river: metres to its left (north) bank.
  const across = (x, y) => {
    const gx = x * ASPECT / SCALE, gy = y / ROW;
    return -(-dy * gx + dx * gy) / half;
  };
  const world = {
    generated: 0,
    loaded: (cx, cy) => loaded(cx, cy),
    typeAt(x, y) {
      if (grass?.(x, y)) return GRASS;
      if (x >= lakeFrom) return WATER;
      return Math.abs(across(x, y)) <= 1 ? WATER : GRASS;
    },
    waterDepthAt: (x, y) => world.typeAt(x, y) === WATER ? 0.3 : 0,
    flowAt(x, y, out = {}) {
      Object.assign(out, { x: 0, y: 0, speed: 0, river: 0, across: 0, secondary: 0, halfWidth: 0, bend: 0, depth: 0 });
      if (world.typeAt(x, y) !== WATER) return out;
      out.depth = 0.3;
      if (x >= lakeFrom) return out;
      const q = across(x, y);
      return Object.assign(out, { x: dx, y: dy, speed: speed * crossSpeed(q), river: RIVER.id, across: q,
        secondary, halfWidth: half, bend });
    },
    rivers: {
      near: (x, y, radius) => {
        const s = (x - spring) * ASPECT / SCALE;
        const dist = Math.max(0, Math.abs(y) / ROW * SCALE - half * SCALE);
        return dist <= radius ? [{ river: RIVER, s, speed, x, y: 0, dist }] : [];
      },
      pointAt: (river, s) => ({ x: spring + s * SCALE / ASPECT * dx, y: s * SCALE * dy * TILT, halfWidth: half }),
      stonesNear: () => stones,
    },
  };
  return world;
}

const view = (x0 = -100, y0 = -30, cols = 200, rows = 60) => ({ x0, y0, cols, rows });
const heading = (p) => Math.atan2(p.vy, p.vx);
const run = (d, world, v, seconds, player = { x: 0, y: 0 }, weather = null, splashes = null, dt = 1 / 30) => {
  for (let t = 0; t < seconds; t += dt) d.update(dt, world, v, player, weather, splashes);
};
const keepOne = (d, world, v, piece, seconds, dt = 1 / 30) => {
  for (let t = 0; t < seconds && !piece.gone; t += dt) d.step(piece, dt, world, v);
};
const angleGap = (a, b, period) => {
  const d = ((a - b) % period + period) % period;
  return Math.min(d, period - d);
};

test('the bob rises at its speed, sinks at half of it, and turns at its two drafts', () => {
  // Too deep: rises, and keeps rising from the deepest draft.
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  const deep = bobStep(0.7, true, 0.4, 0.6, 0.2, 1);
  assert.ok(near(deep.draft, 0.5) && deep.goingDown === false);
  const edge = bobStep(0.6, true, 0.4, 0.6, 0.2, 1);
  assert.ok(near(edge.draft, 0.4) && edge.goingDown === false);
  // Too high: sinks, at half the speed, from the shallowest draft too.
  const up = bobStep(0.3, false, 0.4, 0.6, 0.2, 1);
  assert.equal(up.goingDown, true);
  assert.ok(Math.abs(up.draft - 0.4) < 1e-9);
  assert.ok(Math.abs(bobStep(0.4, false, 0.4, 0.6, 0.2, 1).draft - 0.5) < 1e-9);
  // In between it keeps its way.
  assert.equal(bobStep(0.5, true, 0.4, 0.6, 0.2, 0.1).goingDown, true);
  assert.equal(bobStep(0.5, false, 0.4, 0.6, 0.2, 0.1).goingDown, false);
  // A whole cycle takes 3.6 s, a third of it rising.
  let s = { draft: 0.6, goingDown: false };
  let rising = 0, t = 0;
  const speed = 0.2 / 1.2;
  const turns = [];
  for (; t < 12; t += 0.001) {
    const was = s.goingDown;
    s = bobStep(s.draft, s.goingDown, 0.4, 0.6, speed, 0.001);
    if (!s.goingDown) rising += 0.001;
    if (s.goingDown !== was) turns.push(t);
  }
  const cycle = turns[2] - turns[0];
  assert.ok(Math.abs(cycle - 3.6) < 0.1, `cycle ${cycle}`);
  assert.ok(Math.abs((turns[2] - turns[1]) - cycle / 3) < 0.05);
  assert.ok(rising > 0);
});

test('storms are rain, hail or sleet at intensity 0.6 or more', () => {
  assert.equal(stormy({ preset: 'heavy-rain', intensity: 0.8 }), true);
  assert.equal(stormy({ preset: 'hail', intensity: 0.6 }), true);
  assert.equal(stormy({ preset: 'sleet', intensity: 0.7 }), true);
  assert.equal(stormy({ preset: 'rain', intensity: 0.4 }), false);
  assert.equal(stormy({ preset: 'blizzard', intensity: 1 }), false);
  assert.equal(stormy(null), false);
});

test('a log has 16 headings over half a turn, and other pieces 24 over a whole one', () => {
  const log = { symmetric: true, angle: 0.2 };
  assert.equal(orientationBucket(log), 1);
  assert.equal(orientationBucket({ ...log, angle: 0.2 + Math.PI }), 1);
  assert.equal(orientationBucket({ ...log, angle: -0.2 }), BUCKETS.symmetric - 1);
  const mat = { symmetric: false, angle: Math.PI };
  assert.equal(orientationBucket(mat), 12);
  assert.equal(orientationBucket({ ...mat, angle: 0 }), 0);
});

test('a spawn waits 20-60 s near a running river, twice as fast in and after a storm', () => {
  const world = channel();
  const d = new Debris({ random: mulberry32(3), world });
  const draws = Array.from({ length: 200 }, () => d.interval());
  assert.ok(draws.every((x) => x >= EVERY[0] && x <= EVERY[1]));
  // Far from any river, or by a slack one, the timer holds.
  const v = view();
  const timer = d.timer;
  d.update(1, world, v, { x: 0, y: (NEAR + 30) / SCALE * ROW + 40 });
  assert.equal(d.timer, timer);
  d.update(1, channel({ speed: 0.1 }), v, { x: 0, y: 0 });
  assert.equal(d.timer, timer);
  d.update(1, world, v, { x: 0, y: 0 });
  assert.ok(Math.abs(d.timer - (timer - 1)) < 1e-9);
  // A storm doubles the rate, and the boost lasts three minutes after it.
  const storm = { preset: 'thunderstorm', intensity: 0.9 };
  d.update(1, world, v, { x: 0, y: 0 }, storm);
  assert.ok(Math.abs(d.timer - (timer - 3)) < 1e-9);
  assert.equal(d.cap, CAP_STORM);
  const clear = { preset: 'clear', intensity: 0 };
  d.update(AFTER_STORM - 1, world, v, { x: 0, y: 0 }, clear);
  assert.equal(d.boosted, true);
  d.update(2, world, v, { x: 0, y: 0 }, clear);
  assert.equal(d.boosted, false);
  assert.equal(d.cap, CAP);
});

test('pieces come down from upstream, off the screen, and never more than the cap', () => {
  const world = channel({ half: 0.4 });
  const d = new Debris({ random: mulberry32(9), world });
  const v = view();
  const player = { x: 0, y: 0 };
  let most = 0, spawned = 0, last = 0;
  for (let t = 0; t < 1800; t += 0.25) {
    d.timer = Math.min(d.timer, 0.5);
    const before = d.list.length, top = last, cap = d.cap;
    d.update(0.25, world, v, player, t < 600 ? { preset: 'rain', intensity: 1 } : null);
    // At the cap nothing new comes down.
    if (before >= cap) assert.ok(d.list.every((p) => p.id <= top));
    if (d.list.length) most = Math.max(most, d.list.length);
    for (const p of d.list) {
      if (p.id <= last) continue;
      last = p.id;
      spawned++;
      // Upstream (west) of the player, outside the view, inside the update zone.
      assert.ok(p.x < player.x);
      assert.ok(p.x < v.x0 && p.x >= v.x0 - SIM_MARGIN.cols);
      assert.equal(world.typeAt(p.x, p.y), WATER);
    }
    assert.ok(d.list.length <= CAP_STORM);
  }
  assert.ok(spawned > 20);
  assert.equal(most, CAP_STORM);
});

test('a river lying on the screen up to its spring sends pieces out of the spring, fading in', () => {
  const world = channel({ half: 0.4, spring: -40 });
  const d = new Debris({ random: mulberry32(4), world });
  const v = view(-30, -30, 200, 60);
  const hit = world.rivers.near(10, 0, NEAR)[0];
  const p = spawnPoint(world, v, hit);
  assert.equal(p.inView, true);
  const piece = d.spawn(null, null, v, hit);
  assert.equal(piece.fade, 0);
  d.step(piece, 0.75, world, v);
  assert.ok(piece.fade > 0.4 && piece.fade < 0.6);
  // Nothing to spawn at: no point upstream, or none loaded.
  assert.equal(spawnPoint(world, v, { ...hit, s: 0.5 }), null);
  assert.equal(spawnPoint(channel({ loaded: () => false, spring: -40 }), v, hit), null);
  assert.equal(new Debris({ world }).spawn('log'), null);
  // An update with no spawn point retries in a few seconds.
  const e = new Debris({ random: mulberry32(1), world: channel({ loaded: () => false }) });
  e.timer = 0.1;
  e.update(0.2, e.world, v, { x: 10, y: 0 });
  assert.equal(e.timer, RETRY);
});

test('a reach too narrow for a log gets something smaller, and the narrowest nothing', () => {
  const world = channel({ half: 0.2 });
  const d = new Debris({ random: mulberry32(2), world });
  const v = view();
  const hit = world.rivers.near(0, 0, NEAR)[0];
  for (let i = 0; i < 40; i++) {
    const p = d.spawn('log', null, v, hit);
    assert.notEqual(p.kind, 'log');
    assert.ok(p.length <= 1.2 * 0.2 + 1e-9);
  }
  const narrow = new Debris({ random: mulberry32(2), world: channel({ half: 0.08 }) });
  assert.equal(narrow.spawn('mat', null, v, hit), null);
  // Weighted kinds all turn up.
  const kinds = new Set(Array.from({ length: 400 }, () => d.pick()));
  assert.deepEqual([...kinds].sort(), Object.keys(KINDS).sort());
  d.random = () => 0.999999;
  assert.equal(d.pick(), 'stave');
  d.random = () => 1;
  assert.equal(d.pick(), 'mat');
});

test('a piece follows the current at the water\'s own pace and turns to lie along it', () => {
  for (const kind of ['log', 'mat', 'branch']) {
    const world = channel({ half: 0.6, speed: 0.5 });
    const d = new Debris({ random: mulberry32(11), world });
    const v = view(-2000, -40, 4000, 80);
    const p = d.spawn(kind, { x: -800, y: 0, angle: 0.3 });
    keepOne(d, world, v, p, 10);
    const f = world.flowAt(p.x, p.y);
    assert.ok(Math.cos(heading(p)) > 0.97, kind);
    assert.ok(Math.abs(Math.hypot(p.vx, p.vy) - f.speed) < 0.15 * f.speed, kind);
    const before = p.x;
    keepOne(d, world, v, p, 1);
    const expect = toCells(f.speed, 0).cols;
    assert.ok(Math.abs(p.x - before - expect) < 0.15 * expect, kind);
    assert.ok(angleGap(p.angle, 0, p.symmetric ? Math.PI : Math.PI * 2) < 15 * Math.PI / 180, kind);
  }
});

test('a log released square across the current swings round within 8 s, either way', () => {
  for (const bias of [-1, 1]) {
    const world = channel({ half: 0.8, speed: 0.5 });
    const d = new Debris({ random: mulberry32(5), world });
    const v = view(-2000, -40, 4000, 80);
    const p = d.spawn('log', { x: -800, y: 0, angle: Math.PI / 2 });
    p.bias = bias;
    p.length = 0.3;
    keepOne(d, world, v, p, 8);
    assert.ok(angleGap(p.angle, 0, Math.PI) < 15 * Math.PI / 180, `bias ${bias}: ${p.angle}`);
  }
});

test('on a bend the water sets a mat toward the outer bank, whichever way it turns', () => {
  for (const secondary of [-1, 1]) {
    const world = channel({ half: 0.8, speed: 0.5, secondary, bend: 0.2 });
    const d = new Debris({ random: mulberry32(5), world });
    const v = view(-2000, -40, 4000, 80);
    const p = d.spawn('mat', { x: -800, y: 0, angle: 0 });
    keepOne(d, world, v, p, 4);
    const q = world.flowAt(p.x, p.y).across;
    assert.ok(Math.sign(q) === secondary && Math.abs(q) > 0.2, `secondary ${secondary}: ${q}`);
  }
});

test('banks keep a piece on the water, knocks cut one ring each, and a glancing touch slides on', () => {
  let offWater = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const rings = [];
    const world = channel({ half: 0.35, speed: 0.6 });
    const d = new Debris({ random: mulberry32(seed), world });
    d.update(0, world, view(), { x: 0, y: 0 }, null, { ring: (...a) => rings.push(a) });
    const v = view(-2000, -40, 4000, 80);
    const r = mulberry32(seed * 7);
    const p = d.spawn(['log', 'branch', 'mat', 'reeds'][seed % 4], { x: -800, y: (r() - 0.5) * 3, angle: (r() - 0.5) * 2 });
    p.length = Math.min(p.length, 0.4);
    p.vy = (r() - 0.5) * 0.6;
    const knocks = [];
    for (let t = 0; t < 10; t += 1 / 30) {
      const n = rings.length;
      d.step(p, 1 / 30, world, v);
      if (rings.length > n) knocks.push(t);
      if (world.typeAt(p.x, p.y) !== WATER) offWater += 1 / 30;
    }
    for (let i = 1; i < knocks.length; i++) assert.ok(knocks[i] - knocks[i - 1] >= 0.4 - 1e-6);
  }
  assert.ok(offWater < 0.5, `off water ${offWater}`);
  // Sliding along a bank keeps most of the speed along it.
  const world = channel({ half: 0.35, speed: 0 });
  const d = new Debris({ random: mulberry32(1), world });
  const p = d.spawn('mat', { x: 0, y: 0, angle: 0 });
  p.vx = 0.4; p.vy = -0.05;
  d.contact(p, 0, 1, p.x, p.y - 1, 0, 0.1, 'bank', world.flowAt(0, 0));
  assert.ok(p.vx > 0.4 * 0.5);
  assert.ok(p.vy >= 0);
});

test('a stone stops a piece running into it, cuts a ring, and lets it slide past', () => {
  const rings = [];
  const stone = { x: -700, y: 0, r: 1.2 };
  const world = channel({ half: 0.8, speed: 0.6, stones: [stone] });
  const d = new Debris({ random: () => 0.9, world });
  d.splashes = { ring: (...a) => rings.push(a) };
  const v = view(-2000, -40, 4000, 80);
  const p = d.spawn('log', { x: -730, y: 0.4, angle: 0 });
  let deepest = 0;
  for (let t = 0; t < 20 && p.x < -680; t += 1 / 30) {
    d.step(p, 1 / 30, world, v);
    const lx = p.x * ASPECT, half = toCells(p.length / 2, 0).cols * ASPECT;
    const cx = Math.max(lx - half, Math.min(lx + half, stone.x * ASPECT));
    // The hull's half-thickness across a log lying east, foreshortened.
    const rl = p.radius * SCALE * TILT;
    deepest = Math.max(deepest, stone.r + rl - Math.hypot(cx - stone.x * ASPECT, p.y - stone.y));
  }
  assert.ok(rings.length >= 1);
  assert.ok(deepest < 0.3, `overlap ${deepest}`);
  assert.ok(p.x > -680, 'slid round the stone');
  // The stone list is looked up once per chunk, and only a few are kept.
  for (let i = 0; i < 20; i++) d.stonesNear(world, i * 64, 0);
  assert.ok(d.stones.size <= 16);
});

test('a piece knocked against the outer bank of a bend snags there, swings round and frees itself', () => {
  const world = channel({ half: 0.5, speed: 0.5, secondary: 1, bend: 0.6 });
  const d = new Debris({ random: () => 0, world });
  const v = view(-2000, -40, 4000, 80);
  const p = d.spawn('branch', { x: -800, y: 0, angle: 0.4 });
  // Hit on the left (outer) bank: the normal points away from it, right.
  const flow = world.flowAt(p.x, p.y);
  p.vx = 0.3; p.vy = -0.3;
  d.contact(p, 0, 1, p.x, p.y - 1, 0, 1 / 30, 'bank', flow);
  assert.ok(p.snag);
  const pin = { x: p.snag.x, y: p.snag.y };
  const start = p.angle;
  for (let t = 0; t < 0.5; t += 1 / 30) d.step(p, 1 / 30, world, v);
  const half = toCells(Math.cos(p.angle) * p.length / 2, Math.sin(p.angle) * p.length / 2);
  const end = p.snag.end ? [p.x + half.cols, p.y + half.rows] : [p.x - half.cols, p.y - half.rows];
  assert.ok(Math.hypot(end[0] - pin.x, end[1] - pin.y) < 0.05);
  assert.notEqual(p.angle, start);
  keepOne(d, world, v, p, 6.5);
  assert.equal(p.snag, null);
  // Not again for a while, nor on a straight bank, nor the inner one.
  d.contact(p, 0, 1, p.x, p.y - 1, 0, 1 / 30, 'bank', flow);
  assert.equal(p.snag, null);
  p.lastSnag = -Infinity;
  p.vx = 0.3; p.vy = -0.3; p.knock = 0;
  d.contact(p, 0, 1, p.x, p.y - 1, 0, 1 / 30, 'bank', { ...flow, bend: 0.1 });
  assert.equal(p.snag, null);
  p.vx = 0.3; p.vy = 0.3; p.knock = 0;
  d.contact(p, 0, -1, p.x, p.y + 1, 0, 1 / 30, 'bank', flow);
  assert.equal(p.snag, null);
  // A stone may snag it anywhere, and so may it at the other end.
  p.vx = -0.3; p.vy = 0; p.knock = 0;
  d.contact(p, 1, 0, p.x - 3, p.y, 0, 1 / 30, 'stone', flow);
  assert.equal(p.snag.end, 0);
  assert.ok(p.snag.until - p.age >= 1.5 && p.snag.until - p.age <= 4);
  // Snag odds: no luck, no snag.
  const e = new Debris({ random: () => 0.99, world });
  const q = e.spawn('mat', { x: 0, y: 0, angle: 0 });
  q.vx = 0.5;
  e.contact(q, -1, 0, q.x + 1, q.y, 0, 1 / 30, 'stone', flow);
  assert.equal(q.snag, null);
});

test('a piece snagged on a stone keeps clear of the banks as it swings round', () => {
  // A long log in a narrow reach, caught by its downstream end: swinging
  // round to trail the current, its free end meets the bank and stops there.
  const stone = { x: -700, y: 0, r: 0.6 };
  const world = channel({ half: 0.3, speed: 0.6, stones: [stone] });
  const d = new Debris({ random: mulberry32(4), world });
  const rings = [];
  d.splashes = { ring: (...a) => rings.push(a) };
  const v = view(-2000, -40, 4000, 80);
  const p = d.spawn('log', { x: -712, y: 0.6, angle: 0.5 });
  p.length = 0.5;
  // It snags at the first knock, and stays caught for the longest time.
  const odds = [0, 0.999];
  d.random = () => odds.shift() ?? 0.5;
  let snagged = 0, start = null, worst = 0, dry = 0;
  for (let t = 0; t < 12 && !p.gone; t += 1 / 30) {
    d.step(p, 1 / 30, world, v);
    if (!p.snag) {
      if (snagged) break;
      continue;
    }
    snagged++;
    start ??= d.embedded(d.freeHalf(p), world);
    worst = Math.max(worst, d.embedded(d.freeHalf(p), world) - start);
    const half = toCells(Math.cos(p.angle) * p.length / 2, Math.sin(p.angle) * p.length / 2);
    const free = p.snag.end ? [p.x - half.cols, p.y - half.rows] : [p.x + half.cols, p.y + half.rows];
    if (world.typeAt(free[0], free[1]) !== WATER) dry++;
  }
  assert.ok(snagged > 30, `snagged for ${snagged} steps`);
  assert.equal(dry, 0);
  assert.ok(worst <= 1e-9, `driven ${worst} deeper into the bank`);
  assert.ok(rings.length >= 2, 'knocked on the stone, then on the bank');
});

test('a piece wedged fast in running water works itself free', () => {
  const world = channel({ half: 0.5, speed: 0.5 });
  const d = new Debris({ random: mulberry32(1), world });
  const v = view(-2000, -40, 4000, 80);
  const p = d.spawn('mat', { x: -800, y: 2, angle: Math.PI / 2 });
  // Held still by hand for 9 s.
  const move = d.move.bind(d);
  let held = true;
  d.move = (piece, ...rest) => {
    move(piece, ...rest);
    if (held) { piece.x = -800; piece.vx = piece.vy = 0; }
  };
  keepOne(d, world, v, p, 8.5);
  const y = p.y;
  keepOne(d, world, v, p, 0.5);
  assert.ok(p.slow > 8);
  assert.ok(Math.abs(p.y) < Math.abs(y), 'eased toward the middle');
  held = false;
  keepOne(d, world, v, p, 2);
  assert.ok(Math.hypot(p.vx, p.vy) > 0.1);
});

test('carried into a lake a piece slows, sinks with a last ring, and is gone', () => {
  const rings = [];
  const world = channel({ half: 0.5, speed: 0.5, lakeFrom: -780 });
  const d = new Debris({ random: mulberry32(1), world });
  d.splashes = { ring: (...a) => rings.push(a) };
  const v = view(-2000, -40, 4000, 80);
  const p = d.spawn('mat', { x: -800, y: 0, angle: 0 });
  let rest = null;
  for (let t = 0; t < 40 && !p.gone; t += 1 / 30) {
    d.step(p, 1 / 30, world, v);
    if (rest === null && Math.hypot(p.vx, p.vy) < 0.02) rest = t;
    if (!p.gone) assert.ok(d.drawDraft(p) >= p.draft - 1e-9);
  }
  assert.equal(p.gone, true);
  assert.ok(rest !== null);
  assert.equal(rings.length, 1);
  assert.equal(p.bakes.size, 0);
});

test('a piece stranded on land stops, fades and is gone after 10 s', () => {
  const world = channel({ half: 0.5, speed: 0.5, grass: (x) => x > -790 });
  const d = new Debris({ random: mulberry32(1), world });
  const v = view(-2000, -40, 4000, 80);
  const p = d.spawn('log', { x: -789, y: 0, angle: 0 });
  keepOne(d, world, v, p, BEACH_TIME / 2);
  assert.equal(p.vx, 0);
  assert.ok(p.fade > 0.4 && p.fade < 0.6);
  keepOne(d, world, v, p, BEACH_TIME / 2 + 0.2);
  assert.equal(p.gone, true);
  // On still water a shore pushes it back toward its own middle.
  const lake = channel({ lakeFrom: -900, grass: (x, y) => y > 3 });
  const e = new Debris({ random: mulberry32(1), world: lake });
  const q = e.spawn('mat', { x: -800, y: 2.6, angle: 0 });
  q.vy = 0.2;
  const y = q.y;
  keepOne(e, lake, v, q, 0.5);
  assert.ok(q.y < y + 0.5 && q.vy < 0.2);
});

test('pieces leave the simulation beyond the update zone, at the edge of the loaded land, and when old', () => {
  const world = channel({ half: 0.5, speed: 0.5 });
  const d = new Debris({ random: mulberry32(1), world });
  const v = view();
  const far = d.spawn('mat', { x: v.x0 + v.cols + SIM_MARGIN.cols + 1, y: 0, angle: 0 });
  const edge = d.spawn('mat', { x: 0, y: 0, angle: 0 });
  const old = d.spawn('reeds', { x: -60, y: 0, angle: 0 });
  d.update(1 / 30, world, v, { x: 0, y: 5000 });
  assert.equal(far.gone, true);
  assert.ok(!d.list.includes(far));
  edge.x = 10 * 64 + 5;
  const loaded = world.loaded;
  world.loaded = (cx) => cx < 10;
  d.step(edge, 1 / 30, world, view(0, -30, 1400, 60));
  assert.equal(edge.gone, true);
  world.loaded = loaded;
  old.age = LIFETIME;
  keepOne(d, world, v, old, 0.5);
  assert.ok(old.fade > 0 && old.fade < 1);
  keepOne(d, world, v, old, 0.6);
  assert.equal(old.gone, true);
  // Nothing to do without rivers, or switched off.
  const off = new Debris({ enabled: false, world });
  off.update(1, world, v, { x: 0, y: 0 });
  assert.equal(off.world, world);
  new Debris().update(1, { rivers: null }, v, { x: 0, y: 0 });
});

test('footprints count only loaded chunks', () => {
  const seen = [];
  const world = { loaded: (cx, cy) => { seen.push([cx, cy]); return cx !== 1; } };
  assert.equal(footprintLoaded(world, 10, 10, 0.2), true);
  assert.equal(footprintLoaded(world, 62, 10, 0.4), false);
});

test('one heading is baked a frame, and until then the nearest baked one is drawn', () => {
  const world = channel({ half: 0.5 });
  const d = new Debris({ random: mulberry32(1), world });
  const v = view();
  const pieces = ['log', 'branch', 'mat'].map((k, i) => d.spawn(k, { x: i * 10, y: 0, angle: 0 }));
  for (const p of pieces) assert.equal(p.bakes.size, 1);
  for (const p of pieces) p.angle = 1.3;
  d.update(0, world, v, { x: 0, y: 900 });
  const baked = pieces.map((p) => d.bakeFor(p));
  assert.equal(pieces.reduce((n, p) => n + p.bakes.size, 0), 4);
  // The ones still waiting are drawn at their only heading so far.
  assert.equal(baked[1], pieces[1].bakes.get(0));
  assert.equal(baked[2], pieces[2].bakes.get(0));
  d.update(0, world, v, { x: 0, y: 900 });
  d.bakeFor(pieces[1]);
  assert.equal(pieces[1].bakes.size, 2);
  // A cleared cache draws nothing.
  pieces[2].bakes.clear();
  d.bakesLeft = 0;
  assert.equal(d.bakeFor(pieces[2]), null);
});

function renderer(cols = 60, rows = 30) {
  const r = Object.create(AsciiRenderer.prototype);
  r.allocate(cols, rows);
  r.mask.fill(WATER);
  return r;
}

const fineCells = (r) => {
  let solid = 0, set = 0;
  for (let i = 3; i < r.fineBg.length; i += 4) {
    if (r.fineBg[i] & 16) set++;
    if (r.fineBg[i] & 32) solid++;
  }
  return { set, solid };
};

test('a piece is drawn in small letters on a dark backdrop above the water, dim below it', () => {
  const world = channel({ half: 0.5 });
  const d = new Debris({ random: mulberry32(1), world });
  const v = view(-30, -15, 60, 30);
  const p = d.spawn('log', { x: 0, y: 0, angle: 0 });
  const r = renderer();
  d.draw(r, v, p);
  const high = fineCells(r);
  assert.ok(high.solid > 10 && high.set > high.solid);
  // Sunk deeper, fewer small cells keep their backdrop.
  p.sinking = 0.8;
  const r2 = renderer();
  d.draw(r2, v, p);
  assert.ok(fineCells(r2).solid < high.solid);
  // Without a fine grid it is drawn in ordinary cells.
  const r3 = renderer();
  r3.fine = null;
  p.sinking = 0;
  d.draw(r3, v, p);
  assert.ok(r3.fg.some((x, i) => i % 4 === 3 && x));
  // Its reflection: only what is above the water, each about its waterline.
  const calls = [];
  d.reflect(r, v, p, (rr, x, y, g, cr, cg, cb, base) => calls.push([y, base]));
  assert.ok(calls.length > 0 && calls.every(([y, base]) => y <= base + 1));
  p.bakes.clear();
  d.bakesLeft = 0;
  d.draw(r, v, p);
  d.reflect(r, v, p, () => assert.fail('nothing baked'));
});

test('foam hugs a piece and a snagged one throws a V-wake downstream', () => {
  const world = channel({ half: 0.8, speed: 0.6 });
  const d = new Debris({ random: mulberry32(2), world });
  const v = view(-30, -15, 60, 30);
  const drifting = d.spawn('log', { x: 0, y: 0, angle: 0 });
  const count = (r) => r.ov.filter((x, i) => i % 4 === 3 && x).length + r.fg.filter((x, i) => i % 4 === 3 && x).length;
  const r = renderer();
  d.drawSurface(r, v, 0.5);
  const calm = count(r);
  drifting.vx = drifting.vy = 0;
  const r2 = renderer();
  d.drawSurface(r2, v, 0.5);
  assert.ok(count(r2) > calm + 3, `${count(r2)} vs ${calm}`);
  // Downstream of it, not upstream.
  let east = 0, west = 0;
  for (let y = 0; y < r2.rows; y++) {
    for (let x = 0; x < r2.cols; x++) {
      const i = (y * r2.cols + x) * 4 + 3;
      if (!(r2.fg[i] || r2.ov[i])) continue;
      if (x - 30 > 4) east++;
      if (x - 30 < -4) west++;
    }
  }
  assert.ok(east > west);
  // Nothing on land, nothing off the screen, nothing without a world.
  const land = renderer();
  land.mask.fill(GRASS);
  d.drawSurface(land, v, 0.5);
  assert.equal(count(land), 0);
  d.drawSurface(renderer(), view(500, 500), 0.5);
  d.drawWake(renderer(4, 4), view(-2, -2, 4, 4), drifting, 1, 0, 0.5, 0);
  new Debris().drawSurface(renderer(), v, 0);
  assert.deepEqual(d.visible(view(500, 500)), []);
  assert.deepEqual(d.visible(v), [drifting]);
});

test('debris art: each kind bakes into small letters, low on the hull first, in every season', () => {
  for (const season of ['summer', 'autumn', 'winter', 'spring', 'unknown']) {
    for (const kind of Object.keys(KINDS)) {
      const k = KINDS[kind];
      const piece = { kind, length: k.length[1], radius: k.radius[1], seed: 77 };
      const model = pieceModel(piece, season);
      assert.ok(model.prims.length > 0 && model.top > 0 && model.reach >= piece.length / 2);
      for (const angle of [0, 0.6, Math.PI / 2, 2.4]) {
        const { cells, fine } = bakePiece(model, angle);
        assert.ok(fine.length >= cells.length && cells.length > 0, `${season} ${kind} ${angle}`);
        assert.ok(fine.filter((c) => c.h !== undefined).every((c) => c.h >= 0 && c.h <= 1));
      }
    }
  }
  // A log seen end on shows its rings of end grain; from the side, bark.
  const log = pieceModel({ kind: 'log', length: 0.5, radius: 0.09, seed: 3 });
  const end = sampler(log, Math.PI / 2)(0, 0.5 * 0.5 * SCALE * TILT - 0.09 * SCALE);
  assert.equal(end?.m, 'cut');
  const side = sampler(log, 0)(0, -0.09 * SCALE);
  assert.ok(['barkh', 'birch', 'plankh'].includes(side.m));
  assert.equal(sampler(log, 0)(40, 40), null);
  // Lower rows of a log lie lower on its hull.
  const { fine } = bakePiece(log, 0);
  const at = (dy) => fine.filter((c) => c.dy === dy && c.h !== undefined).map((c) => c.h);
  const rows = [...new Set(fine.map((c) => c.dy))].sort((a, b) => a - b).filter((y) => at(y).length);
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  assert.ok(mean(at(rows[0])) > mean(at(rows[rows.length - 1])));
  assert.ok(FINE >= 1);
});

test('debris is the game\'s own and never part of the world', async () => {
  const world = new World(1, { maxChunks: 64 });
  const d = new Debris({ random: mulberry32(1), world });
  assert.ok(!Object.values(world).includes(d));
  // Over a real river, spawning and drifting build no new land.
  let river = null;
  for (let ry = -2; ry <= 2 && !river; ry++) for (let rx = -2; rx <= 2 && !river; rx++) river = world.rivers.region(rx, ry);
  const k = 2 * Math.floor(river.mouthFrom / 2);
  const player = { x: river.points[k] / ASPECT, y: river.points[k + 1] };
  const v = view(Math.floor(player.x - 60), Math.floor(player.y - 20), 120, 40);
  world.load(v.x0 - 70, v.y0 - 40, v.x0 + v.cols + 70, v.y0 + v.rows + 40, Infinity);
  const chunks = world.chunks.size;
  for (let t = 0; t < 240; t += 0.1) {
    d.timer = Math.min(d.timer, 1);
    d.update(0.1, world, v, player, null, { ring() {} });
  }
  assert.equal(world.chunks.size, chunks);
  assert.ok(d.nextId > 1);
  for (const p of d.list) assert.equal(world.typeAt(p.x, p.y), WATER);
});
