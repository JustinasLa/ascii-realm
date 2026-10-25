import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mulberry32 } from '../src/core/rng.js';
import { KINDS as MONSTERS, Monster } from '../src/entities/monsters.js';
import { Player } from '../src/entities/player.js';
import { BODY_RING, DEFAULT_WADE, Debris, FOOTING, HIT_REST, KINDS, RETURN_TO, RETURN_WAIT, SNAG_FREE, SPIN_KICK,
  SPIN_MAX, bodyProfile, impulse, pieceMass, segmentPoint, segmentSegment } from '../src/world/debris.js';
import { MAX_BUMP, addBump, settleBump, toCells, toGround } from '../src/world/rivers.js';
import { ASPECT, World, WATER } from '../src/world/world.js';
import { channel } from './helpers/channel.js';

// Wading bodies shove floating debris and are knocked back a little; pieces
// knock each other; a piece shoved to a bank edges back into the current.

const DT = 1 / 30;
const view = () => ({ x0: -2000, y0: -60, cols: 4000, rows: 120 });
// Still water everywhere: shoves with no current to muddle them.
const lake = () => channel({ lakeFrom: -1e9 });
const cells = (gx, gy) => {
  const c = toCells(gx, gy);
  return { x: c.cols, y: c.rows };
};
const ground = (piece, x, y) => toGround((x - piece.x) * ASPECT, y - piece.y);
const body = (x = 0, y = 0, wade = { radius: 0.15, mass: 8 }) => ({ x, y, air: 0, wade, bump: { x: 0, y: 0 } });
// A piece of `kind` at the origin, of the given size, lying at `angle`.
function piece(d, kind, { length, radius, angle = Math.PI / 2, x = 0, y = 0 } = {}) {
  const p = d.spawn(kind, { x, y, angle });
  if (length) p.length = length;
  if (radius) p.radius = radius;
  p.mass = pieceMass(kind, p.length, p.radius);
  p.vx = p.vy = p.spin = 0;
  return p;
}
// A body coming east at `v` m/s, just touching a piece lying north-south at
// the origin, `off` metres south of its middle.
function walker(p, v, off = 0, wade = { radius: 0.15, mass: 8 }) {
  const b = body(0, 0, wade);
  const at = cells(-(wade.radius + p.radius - 0.01), off);
  return { body: b, wade: bodyProfile(b), x: at.x, y: at.y, vx: v, vy: 0 };
}
const speed = (p) => Math.hypot(p.vx, p.vy);

test('closest points on segments, from the ends, the middles, and parallel, crossing or zero-length ones', () => {
  assert.deepEqual(segmentPoint(-1, 1, 0, 0, 2, 0), { x: 0, y: 0, t: 0 });
  assert.deepEqual(segmentPoint(1, 1, 0, 0, 2, 0), { x: 1, y: 0, t: 0.5 });
  assert.deepEqual(segmentPoint(5, -1, 0, 0, 2, 0), { x: 2, y: 0, t: 1 });
  assert.deepEqual(segmentPoint(3, 3, 1, 1, 1, 1), { x: 1, y: 1, t: 0 });
  const crossing = segmentSegment(-1, 0, 1, 0, 0, -1, 0, 1);
  assert.deepEqual([crossing.ax, crossing.ay, crossing.bx, crossing.by], [0, 0, 0, 0]);
  const parallel = segmentSegment(0, 0, 2, 0, 1, 1, 3, 1);
  assert.equal(parallel.ay, 0);
  assert.equal(parallel.by, 1);
  assert.equal(parallel.bx, parallel.ax);
  const ends = segmentSegment(0, 0, 1, 0, 2, 1, 3, 1);
  assert.deepEqual([ends.ax, ends.ay, ends.bx, ends.by], [1, 0, 2, 1]);
  const before = segmentSegment(0, 0, 1, 0, -2, 1, -1, 1);
  assert.deepEqual([before.ax, before.bx, before.by], [0, -1, 1]);
  const points = segmentSegment(1, 1, 1, 1, 4, 4, 4, 4);
  assert.deepEqual([points.ax, points.ay, points.bx, points.by], [1, 1, 4, 4]);
  const onPoint = segmentSegment(1, 2, 1, 2, 0, 0, 4, 0);
  assert.deepEqual([onPoint.bx, onPoint.by], [1, 0]);
  const toPoint = segmentSegment(0, 0, 4, 0, 1, 2, 1, 2);
  assert.deepEqual([toPoint.ax, toPoint.ay], [1, 0]);
  // Overlapping in line: any shared point will do, at no distance.
  const inLine = segmentSegment(0, 0, 2, 0, 1, 0, 3, 0);
  assert.equal(Math.hypot(inLine.bx - inLine.ax, inLine.by - inLine.ay), 0);
});

test('a piece weighs its wood: logs 2-9 kg, everything else under a kilogram', () => {
  const range = (kind) => [pieceMass(kind, KINDS[kind].length[0], KINDS[kind].radius[0]),
    pieceMass(kind, KINDS[kind].length[1], KINDS[kind].radius[1])];
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-3, `${a} vs ${b}`);
  const [logLo, logHi] = range('log');
  close(logLo, 650 * Math.PI * 0.06 ** 2 * 0.3);
  close(logHi, 650 * Math.PI * 0.09 ** 2 * 0.55);
  assert.ok(logLo > 2.2 && logHi < 9.2);
  // Every kind at both ends of its size: rods are solid, slabs flat.
  const want = {
    branch: [550 * Math.PI * 0.03 ** 2 * 0.2, 550 * Math.PI * 0.03 ** 2 * 0.4],
    reeds: [250 * Math.PI * 0.03 ** 2 * 0.15, 250 * Math.PI * 0.03 ** 2 * 0.28],
    mat: [300 * 0.12 * 0.12 * 0.03, 300 * 0.25 * 0.2 * 0.03],
    crate: [500 * 0.18 * 0.1 * 0.02, 500 * 0.26 * 0.1 * 0.02],
    stave: [600 * 0.2 * 0.08 * 0.025, 600 * 0.28 * 0.08 * 0.025],
  };
  for (const [kind, [lo, hi]] of Object.entries(want)) {
    close(range(kind)[0], lo);
    close(range(kind)[1], hi);
  }
  // The lightest log outweighs the heaviest of anything else.
  for (const kind of ['branch', 'mat', 'reeds', 'crate', 'stave']) {
    assert.ok(range(kind)[1] < 0.7, kind);
    assert.ok(range(kind)[1] < logLo, kind);
  }
  const d = new Debris({ random: () => 0.5, world: lake() });
  const p = d.spawn('log', { x: 0, y: 0 });
  assert.equal(p.mass, pieceMass('log', p.length, p.radius));
  assert.equal(p.pushed, -Infinity);
});

test('a body meets debris with its own legs and footing, its kind\'s, or a default', () => {
  assert.equal(bodyProfile({ wade: { radius: 1, mass: 2 } }).mass, 2);
  assert.equal(bodyProfile({ kind: MONSTERS.troll }).mass, 30);
  assert.equal(bodyProfile({}), DEFAULT_WADE);
  assert.equal(bodyProfile(new Player(0, 0)).mass, 8);
  assert.ok(MONSTERS.skeleton.wade.mass < MONSTERS.goblin.wade.mass);
  assert.equal(impulse(1, 0.3, 0, 0), 0);
  assert.equal(impulse(-1, 0.3, 1, 1), 0);
});

test('a shove grows with the walker\'s pace, by the rule of an impulse shared by mass', () => {
  let last = 0;
  for (const v of [0.5, 1.4, 4]) {
    const d = new Debris({ random: () => 0.5, world: lake() });
    const p = piece(d, 'branch', { length: 0.3 });
    d.meetBody(p, walker(p, v), d.world);
    const want = (1.3 * v / (1 / p.mass + 1 / 8)) / p.mass;
    assert.ok(Math.abs(speed(p) - want) / want < 0.1, `${speed(p)} vs ${want}`);
    assert.ok(p.vx > 0, 'sent on the way the walker went');
    assert.ok(speed(p) > last);
    last = speed(p);
  }
});

test('a light thing flies off faster than a heavy log, which only gives way', () => {
  const sizes = { log: { length: 0.45, radius: 0.075 }, branch: { length: 0.3 }, mat: { length: 0.3, radius: 0.08 } };
  const moved = {};
  for (const [kind, size] of Object.entries(sizes)) {
    const d = new Debris({ random: () => 0.5, world: lake() });
    const p = piece(d, kind, size);
    d.meetBody(p, walker(p, 1.4), d.world);
    moved[kind] = { dv: speed(p), mass: p.mass };
  }
  const order = Object.keys(moved).sort((a, b) => moved[a].mass - moved[b].mass);
  assert.deepEqual(order, ['mat', 'branch', 'log']);
  assert.ok(moved.mat.dv > moved.branch.dv && moved.branch.dv > moved.log.dv);
  assert.ok(moved.log.dv <= 0.7 * moved.branch.dv, `${moved.log.dv} vs ${moved.branch.dv}`);
  assert.ok(moved.log.dv < 1.4 && moved.mat.dv > 1.4);
});

test('struck off its middle a log turns, the way the side it was struck on sends it, and no faster than it may', () => {
  const spins = [];
  for (const off of [0.8, -0.8, 0]) {
    const d = new Debris({ random: () => 0.5, world: lake() });
    const p = piece(d, 'log', { length: 0.45, radius: 0.075 });
    d.meetBody(p, walker(p, 1.4, off * p.length / 2), d.world);
    spins.push(p.spin);
  }
  assert.ok(spins[0] < -1 && spins[1] > 1, `${spins}`);
  assert.ok(Math.abs(spins[0]) <= SPIN_KICK + 1e-9);
  assert.ok(Math.abs(spins[2]) < 0.05);
  // Struck again and again, it never spins faster than SPIN_MAX.
  const d = new Debris({ random: () => 0.5, world: lake() });
  const p = piece(d, 'log', { length: 0.45, radius: 0.075 });
  for (let i = 0; i < 5; i++) {
    p.vx = 0;
    d.meetBody(p, walker(p, 4, 0.8 * p.length / 2), d.world);
    assert.ok(Math.abs(p.spin) <= SPIN_MAX + 1e-9);
  }
  assert.equal(Math.abs(p.spin), SPIN_MAX);
});

test('debris never stops a body or moves it: it only slides it back a little, through its bump', () => {
  const world = channel({ half: 1, speed: 0.5 });
  const d = new Debris({ random: () => 0.5, world });
  const p = piece(d, 'log', { angle: 0, length: 0.5 });
  const b = body(0, -6);
  let shoved = 0;
  for (let t = 0; t < 2; t += DT) {
    const want = { x: 0, y: -6 + t * 1.4 * 6.5 };
    b.x = want.x; b.y = want.y;
    d.update(DT, world, view(), { x: 0, y: 0 }, null, null, [b]);
    assert.deepEqual({ x: b.x, y: b.y }, want, 'its own path');
    assert.ok(Math.hypot(b.bump.x, b.bump.y) <= MAX_BUMP + 1e-9);
    if (d.lastShove) shoved++;
  }
  assert.ok(shoved > 0, 'the log was met');
  assert.ok(p.y > 0.5, 'and shoved south');
  assert.ok(b.bump.y < 0, 'the walker slowed a little');
});

test('a log carried into a standing body knocks it on downstream a little; a troll barely', () => {
  const bumps = {};
  for (const [who, wade] of Object.entries({ player: { radius: 0.15, mass: 8 }, troll: MONSTERS.troll.wade })) {
    const world = channel({ half: 1, speed: 0.55 });
    const d = new Debris({ random: () => 0.5, world });
    const p = piece(d, 'log', { angle: 0, x: -10 });
    p.vx = 0.55;
    const b = body(0, 0, wade);
    for (let t = 0; t < 10 && !d.lastShove; t += DT) d.update(DT, world, view(), b, null, null, [b]);
    assert.ok(d.lastShove, `${who} met`);
    assert.ok(b.bump.x > 0 && Math.abs(b.bump.y) < 1e-9, 'knocked downstream');
    bumps[who] = Math.hypot(b.bump.x, b.bump.y);
  }
  assert.ok(bumps.player >= 0.05 && bumps.player <= 0.2, `${bumps.player}`);
  assert.ok(bumps.troll <= bumps.player / 2, `${bumps.troll}`);
  const bump = { x: bumps.player, y: 0 };
  settleBump(bump, 1);
  assert.deepEqual(bump, { x: 0, y: 0 });
  // A bump never grows past the river's own carry.
  const b = {};
  addBump(b, 1, 1);
  assert.ok(Math.abs(Math.hypot(b.bump.x, b.bump.y) - MAX_BUMP) < 1e-12);
});

test('a minute of knocks hurts nobody and staggers no monster', () => {
  const world = channel({ half: 1, speed: 0.55 });
  const d = new Debris({ random: mulberry32(3), world });
  const player = new Player(0, 0);
  const skeleton = new Monster(0, 1, { risen: true });
  const health = [player.vitals.health, skeleton.health];
  const state = skeleton.state;
  for (let i = 0; i < 4; i++) piece(d, 'log', { angle: 0, x: -10 - i * 6, y: (i % 2) - 0.5 });
  let knocks = 0;
  for (let t = 0; t < 60; t += DT) {
    // The two wade on the spot, to and fro across the current.
    player.y = Math.sin(t * 2) * 2;
    skeleton.y = Math.cos(t * 2) * 2;
    for (const p of d.list) if (p.x > 12) { p.x = -12; p.vx = 0.55; }
    d.update(DT, world, view(), player, null, { ring() { knocks++; } }, [player, skeleton]);
  }
  assert.ok(knocks > 3, `${knocks} knocks`);
  assert.deepEqual([player.vitals.health, skeleton.health], health);
  assert.equal(skeleton.state, state);
  assert.ok(d.events.every((e) => e.type === 'splash'));
  assert.deepEqual(player.events.filter((e) => /hurt|damage|hit/.test(e.type)), []);
  assert.deepEqual(skeleton.events, []);
});

test('a jump clears the feet of a piece, and landing on it shoves it', () => {
  const world = lake();
  const d = new Debris({ random: () => 0.5, world });
  piece(d, 'branch', { length: 0.3 });
  // Leaping clean over it, east and back west.
  const b = body(-8, 0);
  b.air = 0.5;
  for (const dx of [1, -1]) {
    for (let i = 0; i < 16; i++) {
      b.x += dx;
      d.update(DT, world, view(), b, null, null, [b]);
    }
  }
  assert.equal(d.lastShove, null, 'passed over');
  // Coming down on it.
  b.x = -5;
  d.update(DT, world, view(), b, null, null, [b]);
  b.air = 0;
  b.x = -3;
  d.update(DT, world, view(), b, null, null, [b]);
  assert.ok(d.lastShove, 'landed in it');
});

test('a body on dry land, a rising or dead monster, or a fallen player never shoves', () => {
  const world = channel({ half: 1, grass: (x) => x < -1 });
  for (const make of [() => body(-2.5, 0), () => ({ ...body(), state: 'rise' }), () => ({ ...body(), state: 'dead' }),
    () => ({ ...body(), alive: false })]) {
    const d = new Debris({ random: () => 0.5, world });
    piece(d, 'mat', { x: -1.2 });
    const b = make();
    d.update(DT, world, view(), b, null, null, [b]);
    b.x += b.x < -1 ? 1 : 0.5;
    d.update(DT, world, view(), b, null, null, [b]);
    assert.equal(d.lastShove, null);
  }
});

test('shoved hard at the bank, a mat never ends up on the land, nor any of its hull deeper into it', () => {
  const random = mulberry32(11);
  const world = channel({ half: 0.3 });
  for (let run = 0; run < 500; run++) {
    const d = new Debris({ random, world });
    const p = piece(d, 'mat', { angle: random() * Math.PI * 2, x: 0, y: (random() - 0.5) });
    const v = 0.5 + random() * 4;
    const heading = (random() < 0.5 ? -1 : 1) * Math.PI / 2 + (random() - 0.5);
    const b = body(0, p.y + Math.sin(heading) * -1.5);
    for (let t = 0; t < 0.6; t += DT) {
      const step = cells(Math.cos(heading) * v * DT, Math.sin(heading) * v * DT);
      b.x += step.x; b.y += step.y;
      if (world.typeAt(b.x, b.y) !== WATER) break;
      d.update(DT, world, view(), b, null, null, [b]);
      assert.equal(world.typeAt(p.x, p.y), WATER, `run ${run}`);
    }
  }
});

test('the hull is never shoved onto the land or a stone, even pressed there by a body or another piece', () => {
  const stone = { x: 8, y: 0, r: 0.6 };
  const world = channel({ half: 0.3, stones: [stone] });
  const d = new Debris({ random: () => 0.5, world });
  // Two logs side by side along the north bank, the outer one against it.
  const outer = piece(d, 'log', { angle: 0, length: 0.4, radius: 0.06, y: -0.95 });
  const inner = piece(d, 'log', { angle: 0, length: 0.4, radius: 0.06, y: -0.1 });
  const start = d.penetration(outer, world);
  const b = body(0, 1.2);
  for (let t = 0; t < 1; t += DT) {
    b.y -= 0.5 * 6.5 * DT;
    if (b.y < -0.6) b.y = -0.6;
    d.advance([outer, inner], DT, world, view(), d.wading([b], DT, world));
    outer.x = inner.x = 0;
    assert.ok(d.penetration(outer, world) <= start + 0.05, `${d.penetration(outer, world)}`);
  }
  // A push that would drive a hull into a stone is cut short, or dropped.
  const p = piece(d, 'branch', { angle: Math.PI / 2, x: 6.3 });
  const before = d.penetration(p, world);
  assert.equal(before, 0);
  const share = d.shift(p, world, 0.04, 0);
  assert.ok(share < 1);
  assert.ok(d.penetration(p, world) <= before + 1e-9);
});

test('shoved out to the bank a piece lies there a moment, then edges back into the current', () => {
  const half = 0.3;
  const across = (p) => -(p.y / 6.5) / half;
  for (const returning of [true, false]) {
    const world = channel({ half, speed: 0.5 });
    const d = new Debris({ random: () => 0.5, world });
    if (!returning) d.returnSpeed = 0;
    const p = piece(d, 'branch', { angle: 0, length: 0.3 });
    p.vx = 0.5;
    // Walked into from the south, it is shoved up toward the north bank.
    const b = body(p.x, 0.9);
    for (let t = 0; t < 0.5; t += DT) {
      b.x = p.x;
      b.y = Math.max(-0.55, b.y - 0.8 * 6.5 * DT);
      d.update(DT, world, view(), b, null, null, [b]);
    }
    const out = across(p);
    assert.ok(out > 0.8, `shoved out to ${out}`);
    const x0 = p.x;
    let held = 0, back = Infinity;
    for (let t = 0; t < 20; t += DT) {
      d.update(DT, world, view(), b, null, null, []);
      if (across(p) > 0.75) held = t;
      if (across(p) < 0.6 && back === Infinity) back = t;
    }
    assert.ok(p.x > x0 + 50, 'still drifting downstream');
    if (returning) {
      assert.ok(held >= RETURN_WAIT - DT, `lay there ${held} s`);
      assert.ok(back < 20, 'back in the current');
      assert.ok(across(p) >= RETURN_TO - 0.02, 'and no further in than it needs');
    } else assert.ok(across(p) > 0.75, 'with no return it stays by the bank');
  }
  // A piece just inside RETURN_TO is left where it is.
  const world = channel({ half, speed: 0.5 });
  const d = new Debris({ random: () => 0.5, world });
  const p = piece(d, 'branch', { angle: 0, length: 0.3, y: -0.45 * half * 6.5 });
  d.update(10, world, view(), p, null, null, []);
  for (let t = 0; t < 10; t += DT) d.update(DT, world, view(), p, null, null, []);
  assert.ok(Math.abs(across(p) - 0.45) < 0.01, `${across(p)}`);
});

test('a hard shove frees a snagged log; a soft one does not, nor moves it', () => {
  for (const [v, freed] of [[0.4, true], [0.1, false]]) {
    const world = channel({ half: 1, speed: 0.5 });
    const d = new Debris({ random: () => 0.5, world });
    const p = piece(d, 'log', { angle: Math.PI / 2 });
    p.snag = { end: 0, until: 1e9, aligned: 0, x: p.x, y: p.y - toCells(0, p.length / 2).rows };
    const pos = { x: p.x, y: p.y };
    const w = walker(p, v);
    const b = w.body;
    b.x = w.x - v * DT * 13 / ASPECT;
    b.y = w.y;
    d.update(DT, world, view(), b, null, null, [b]);
    b.x = w.x;
    d.update(DT, world, view(), b, null, null, [b]);
    assert.equal(!p.snag, freed, `at ${v} m/s`);
    if (!freed) {
      assert.equal(p.vx, 0);
      assert.ok(Math.hypot(p.x - pos.x, p.y - pos.y) < 0.3, 'held where it was caught');
      assert.ok(b.bump.x < 0, 'and the walker felt it');
    } else assert.ok(p.vx > 0 && p.lastSnag > 0, 'and sent on its way');
  }
  assert.ok(SNAG_FREE > 0.1 && SNAG_FREE < 0.4);
});

test('a knock splashes once, rings no more often than HIT_REST, and a soft touch makes none', () => {
  const world = lake();
  const rings = [];
  const splashes = { ring: (...a) => rings.push(a) };
  const d = new Debris({ random: () => 0.5, world });
  const p = piece(d, 'log', { length: 0.45, radius: 0.075 });
  const draft = p.draft;
  d.splashes = splashes;
  d.meetBody(p, walker(p, 0.6), world);
  assert.equal(rings.length, 1);
  assert.equal(d.events.length, 1);
  assert.equal(d.events[0].type, 'splash');
  assert.ok(d.events[0].strength > 0.15 && d.events[0].strength <= 0.8);
  assert.ok(p.draft > draft && p.goingDown, 'it dips');
  // Pressed on for a second, step by step.
  rings.length = 0;
  const b = body(-3.5, 0);
  for (let t = 0; t < 1; t += DT) {
    b.x += 0.6 * DT * 13 / ASPECT;
    d.update(DT, world, view(), b, null, splashes, [b]);
  }
  assert.ok(rings.length >= 1 && rings.length <= Math.ceil(1 / HIT_REST), `${rings.length} rings`);
  // A soft touch.
  const quiet = new Debris({ random: () => 0.5, world });
  quiet.splashes = splashes;
  const q = piece(quiet, 'log', { length: 0.45, radius: 0.075 });
  rings.length = 0;
  quiet.meetBody(q, walker(q, BODY_RING * 0.8), world);
  assert.equal(rings.length, 0);
  assert.equal(quiet.events.length, 0);
});

test('pieces knock each other apart, trading momentum, and a snagged one holds against a light one', () => {
  const world = lake();
  const d = new Debris({ random: () => 0.5, world });
  const a = piece(d, 'log', { angle: Math.PI / 2, length: 0.4, radius: 0.07, x: 0 });
  const b = piece(d, 'log', { angle: Math.PI / 2, length: 0.5, radius: 0.08, x: 0.14 * 13 / ASPECT });
  a.vx = 0.5; b.vx = -0.3;
  const before = a.mass * a.vx + b.mass * b.vx;
  const rings = [];
  d.splashes = { ring: (...r) => rings.push(r) };
  d.meetPiece(a, b, world);
  const after = a.mass * a.vx + b.mass * b.vx;
  assert.ok(Math.abs(after - before) <= 0.02 * Math.abs(before) + 1e-9, `${before} -> ${after}`);
  assert.ok(a.vx < b.vx, 'they part');
  assert.equal(rings.length, 1);
  const gap = Math.abs(ground(a, b.x, b.y).x) - a.radius - b.radius;
  assert.ok(gap > -0.01, `overlap ${-gap}`);
  // Driven head-on in the water, they never pass through each other.
  const e = new Debris({ random: () => 0.5, world });
  const l = piece(e, 'log', { angle: Math.PI / 2, x: -4 });
  const r = piece(e, 'log', { angle: Math.PI / 2, x: 4 });
  l.vx = 0.8; r.vx = -0.8;
  let worst = 0;
  for (let t = 0; t < 3; t += DT) {
    e.update(DT, world, view(), l, null, null, []);
    worst = Math.max(worst, l.radius + r.radius - Math.abs(ground(l, r.x, r.y).x));
  }
  assert.ok(l.x < r.x, 'still apart');
  assert.ok(worst < 0.03, `overlapped ${worst} m at worst`);
  // A light mat drifting gently into a snagged log leaves it be.
  const f = new Debris({ random: () => 0.5, world });
  const held = piece(f, 'log', { angle: Math.PI / 2 });
  held.snag = { end: 0, until: 1e9, aligned: 0, x: 0, y: -toCells(0, held.length / 2).rows };
  const mat = piece(f, 'mat', { angle: Math.PI / 2, x: -(held.radius + 0.07) * 13 / ASPECT });
  mat.vx = 0.15;
  const pos = { x: held.x, y: held.y, vx: held.vx };
  f.meetPiece(mat, held, world);
  f.meetPiece(held, mat, world);
  assert.deepEqual({ x: held.x, y: held.y, vx: held.vx }, pos);
  assert.ok(held.snag);
  assert.ok(mat.vx < 0, 'the mat bounced off');
  // Two held pieces do nothing to each other.
  const g = piece(f, 'log', { angle: Math.PI / 2 });
  g.snag = { ...held.snag };
  g.vx = 0.1;
  f.meetPiece(held, g, world);
  assert.equal(g.vx, 0.1);
});

test('a body seen for the first time, or put down far away, goes nowhere', () => {
  const world = lake();
  const d = new Debris({ random: () => 0.5, world });
  const b = body(0, 0);
  assert.deepEqual([d.wading([b], DT, world)[0].vx, d.wading([b], DT, world)[0].vy], [0, 0]);
  b.y += 30;
  assert.equal(d.wading([b], DT, world)[0].vy, 0, 'teleported');
  b.x += 5;
  const w = d.wading([b], DT, world)[0];
  assert.ok(Math.abs(w.vx - 5 * ASPECT / 13 / DT) < 1e-9, 'walked');
  b.x += 30;
  assert.ok(Math.abs(d.wading([b], DT, world)[0].vx - 8) < 1e-9, 'a rush is held to 8 m/s');
  assert.equal(d.wading([b], 0, world)[0].vx, 0, 'no time, no speed');
  assert.deepEqual(d.wading([{ x: 0, y: 0 }], DT, { typeAt: () => WATER }), [], 'no water depth, no wading');
  // A piece shoved by nobody, with a body far off, drifts exactly as alone.
  const runs = [[], [body(-1500, 0)]].map((bodies) => {
    const river = channel({ half: 1 });
    const e = new Debris({ random: mulberry32(5), world: river });
    const p = e.spawn('log', { x: 0, y: 0 });
    e.spawn('branch', { x: 6, y: 0.5 });
    for (let t = 0; t < 4; t += DT) {
      for (const q of bodies) q.x += 0.2;
      e.update(DT, river, view(), { x: 0, y: 0 }, null, null, bodies);
    }
    return [p.x, p.y, p.angle];
  });
  assert.deepEqual(runs[0], runs[1]);
});

test('the player and monsters slide with a bump, which settles and never counts as walking', () => {
  const open = { isWalkable: () => true, waterDepthAt: () => 0, flowAt: (x, y, out = {}) => Object.assign(out, { speed: 0 }) };
  const p = new Player(0, 0);
  p.bump = { x: 0.2, y: 0 };
  p.drift(1 / 60, open, 0);
  assert.ok(p.x > 0 && p.y === 0, 'slid east');
  assert.ok(p.bump.x < 0.2);
  for (let i = 0; i < 60; i++) p.drift(1 / 60, open, 0);
  assert.deepEqual(p.bump, { x: 0, y: 0 });
  const x = p.x;
  p.drift(1 / 60, open, 0);
  assert.equal(p.x, x, 'and then stays put');

  // In the real game loop, bumped on a lake, the legs stay still.
  const lakeWorld = new World(1);
  lakeWorld.propsIn = () => [];
  const q = new Player(0.5, 85.5);
  q.bump = { x: 0.3, y: 0 };
  for (let i = 0; i < 30; i++) q.update(1 / 60, lakeWorld, { x: 0, y: 0 }, false);
  assert.ok(q.x > 0.5, 'slid');
  assert.ok(q.groundSpeed < 0.05 && q.walk < 0.05, 'not walking');
  assert.deepEqual(q.events.filter((e) => e.type === 'step'), []);

  const m = new Monster(0, 0, { risen: true });
  m.bump = { x: 0, y: 0.2 };
  m.drift(1 / 60, open, 0);
  assert.ok(m.y > 0 && m.x === 0);
  // Against a face it slides along whatever way is open, or stays put.
  const face = { ...open, isWalkable: (px, py) => py < 0.01 };
  const n = new Monster(0, 0, { risen: true });
  n.bump = { x: 0.2, y: 0.2 };
  n.drift(1 / 60, face, 0);
  assert.ok(n.x > 0 && n.y === 0);
  assert.equal(m.groundSpeed, 0);
});

test('meeting bodies keeps the debris cheap', () => {
  const world = channel({ half: 1.5, speed: 0.5 });
  const d = new Debris({ random: mulberry32(9), world });
  for (let i = 0; i < 6; i++) piece(d, i % 2 ? 'log' : 'branch', { angle: 0, x: i * 3 - 9, y: (i % 3) - 1 });
  const bodies = [0, 1, 2, 3, 4].map((i) => body(i * 3 - 6, -2));
  const times = [];
  for (let f = 0; f < 240; f++) {
    for (const [i, b] of bodies.entries()) b.y = Math.sin(f / 20 + i) * 3;
    for (const p of d.list) if (p.x > 30) p.x -= 60;
    const t0 = performance.now();
    d.update(DT, world, view(), bodies[0], null, null, bodies);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  assert.ok(times[120] < 0.5, `median ${times[120]} ms`);
  assert.equal(FOOTING, 0.25);
});
