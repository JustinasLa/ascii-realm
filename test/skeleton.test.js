import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SKELETON, Skeleton, Skeletons, toCells, toMetres } from '../src/entities/skeleton.js';
import { GRASS, MAX_WATER_DEPTH, WATER } from '../src/world/world.js';

const open = { isWalkable: () => true, typeAt: () => GRASS };
const dt = 1 / 60;
const distance = (a, b) => Math.hypot(...toMetres(a.x - b.x, a.y - b.y));
const player = (x, y, extra = {}) => ({ x, y, air: 0, heading: 0, runSpeed: 5, feel: { reach: 0.95 }, ...extra });
const risen = (mx, mz) => new Skeleton(...toCells(mx, mz), { risen: true });

test('a skeleton climbs out of the ground before it moves', () => {
  const s = new Skeleton(0, 0);
  const target = player(...toCells(10, 0));
  s.update(0.5, open, target);
  assert.equal(s.state, 'rise');
  assert.equal(s.x, 0);
  for (let t = 0; t < SKELETON.rise; t += dt) s.update(dt, open, target);
  assert.notEqual(s.state, 'rise');
});

test('a skeleton runs at the player and stops within reach', () => {
  const s = risen(0, 0);
  const target = player(...toCells(12, 6));
  const start = distance(s, target);
  let fastest = 0;
  for (let t = 0; t < 6; t += dt) {
    s.update(dt, open, target);
    fastest = Math.max(fastest, s.groundSpeed);
  }
  assert.ok(distance(s, target) < SKELETON.reach + 0.2, `ended ${distance(s, target)} m away from ${start}`);
  assert.ok(distance(s, target) > 0.5, 'it does not walk into the player');
  // It runs, but a sprinting player can still get away.
  assert.ok(fastest > 3, `ran at ${fastest} m/s`);
  assert.ok(fastest < target.runSpeed);
});

test('a skeleton ignores a player far away and loses interest when they flee', () => {
  const s = risen(0, 0);
  const far = player(...toCells(SKELETON.notice + 5, 0));
  for (let t = 0; t < 1; t += dt) s.update(dt, open, far);
  assert.equal(s.state, 'idle');
  const near = player(...toCells(10, 0));
  s.update(dt, open, near);
  assert.equal(s.state, 'chase');
  const gone = player(...toCells(SKELETON.forget + 10, 0));
  s.update(dt, open, gone);
  assert.equal(s.state, 'idle');
});

test('a skeleton swings at a player within reach and the blow lands', () => {
  const s = risen(0, 0);
  const target = player(...toCells(1, 0));
  const events = [];
  for (let t = 0; t < 1.5; t += dt) {
    s.update(dt, open, target);
    events.push(...s.events.splice(0));
  }
  assert.ok(events.some((e) => e.type === 'swing'));
  const hit = events.find((e) => e.type === 'hit-player');
  assert.ok(hit, 'the blow lands');
  assert.equal(hit.amount, SKELETON.damage);
});

test('stepping back out of reach makes a skeleton miss', () => {
  const s = risen(0, 0);
  const target = player(...toCells(1, 0));
  const events = [];
  for (let t = 0; t < SKELETON.windUp * 0.8; t += dt) {
    s.update(dt, open, target);
    events.push(...s.events.splice(0));
  }
  assert.equal(s.state, 'attack');
  [target.x, target.y] = toCells(4, 0);
  for (let t = 0; t < 0.5; t += dt) {
    s.update(dt, open, target);
    events.push(...s.events.splice(0));
  }
  assert.ok(!events.some((e) => e.type === 'hit-player'));
  assert.ok(events.some((e) => e.type === 'miss'));
});

test('a skeleton wades through water knee deep, slowed like the player, splashing as it goes', () => {
  const lake = { isWalkable: () => true, typeAt: (x) => (x > 20 ? WATER : GRASS),
    waterDepthAt: (x) => (x > 20 ? MAX_WATER_DEPTH : 0) };
  const s = risen(0, 0);
  const target = player(...toCells(30, 0));
  const steps = [];
  let wet = Infinity;
  for (let t = 0; t < 10 && s.state === 'chase' || t === 0; t += dt) {
    s.update(dt, lake, target);
    steps.push(...s.events.splice(0).filter((e) => e.type === 'step'));
    if (s.x > 40 && s.waterDepth === MAX_WATER_DEPTH) wet = Math.min(wet, s.groundSpeed);
  }
  assert.ok(s.x > 40, `waded in to ${s.x}`);
  assert.equal(s.waterDepth, MAX_WATER_DEPTH, 'never deeper than the knee');
  assert.ok(Math.abs(s.speedScale - 0.62) < 1e-9);
  // Its 4 m/s run slows by the same share as the player's at knee depth.
  const run = target.runSpeed * SKELETON.runShare;
  assert.ok(Math.abs(wet - run * 0.62) < 0.05, `wading at ${wet} m/s`);
  assert.ok(steps.some((e) => e.x > 20), 'footfalls in the water');
  assert.ok(steps.some((e) => e.x < 20), 'and on land');
});

test('a skeleton will not walk through blocked ground', () => {
  const target = player(40, 0);
  const wall = { isWalkable: (x) => x < 10, typeAt: () => GRASS };
  const t2 = risen(0, 0);
  for (let t = 0; t < 8; t += dt) t2.update(dt, wall, target);
  assert.ok(t2.x < 10);
});

test('a skeleton finds its way round a tree in its path', () => {
  // A solid trunk square across the straight line to the player.
  const tree = { isWalkable: (x, y) => !(x > 25 && x < 35 && Math.abs(y) < 4), typeAt: () => GRASS };
  const s = risen(0, 0);
  const target = player(...toCells(6, 0));
  for (let t = 0; t < 8; t += dt) s.update(dt, tree, target);
  assert.ok(distance(s, target) < SKELETON.reach + 0.3, `ended ${distance(s, target)} m away`);
});

test('a skeleton caught inside an obstacle can walk out of it', () => {
  const rock = { isWalkable: (x, y) => Math.hypot(x, y) > 6, typeAt: () => GRASS };
  const s = risen(0, 0);
  const target = player(...toCells(5, 0));
  for (let t = 0; t < 4; t += dt) s.update(dt, rock, target);
  assert.ok(Math.hypot(s.x, s.y) > 6);
});

test('sword cuts in front of the player hit, and three bring a skeleton down', () => {
  const skeletons = new Skeletons({ firstAfter: Infinity });
  const s = risen(0, 1.2);
  skeletons.list.push(s);
  const p = player(0, 0, { heading: 0 });
  const behind = player(0, 0, { heading: Math.PI });
  const cut = { type: 'strike', swing: 'a' };
  assert.equal(skeletons.strike(cut, behind, 22).length, 0, 'a cut the other way misses');
  assert.equal(skeletons.strike({ ...cut, swing: 'spin' }, behind, 22).length, 1, 'a spin hits all round');
  assert.equal(s.state, 'stagger');
  assert.ok(s.alive);
  skeletons.strike(cut, p, 22);
  assert.ok(s.alive);
  skeletons.strike(cut, p, 22);
  assert.equal(s.alive, false);
  assert.equal(s.state, 'dead');
  assert.equal(skeletons.kills, 1);
  assert.ok(skeletons.events.some((e) => e.type === 'bone-collapse'));
  // The dead neither move nor take further hits.
  assert.equal(skeletons.strike(cut, p, 22).length, 0);
});

test('a staggered skeleton is knocked back and recovers', () => {
  const skeletons = new Skeletons({ firstAfter: Infinity });
  const s = risen(0, 1);
  skeletons.list.push(s);
  const p = player(0, 0);
  skeletons.strike({ type: 'strike', swing: 'a' }, p, 10);
  const before = distance(s, p);
  for (let t = 0; t < 0.3; t += dt) skeletons.update(dt, open, p);
  assert.ok(distance(s, p) > before + 0.3, 'pushed away');
  for (let t = 0; t < SKELETON.stagger; t += dt) skeletons.update(dt, open, p);
  assert.notEqual(s.state, 'stagger');
});

test('the fallen lie a while, then sink away and are removed', () => {
  const skeletons = new Skeletons({ firstAfter: Infinity });
  const s = risen(0, 1);
  skeletons.list.push(s);
  skeletons.strike({ type: 'strike', swing: 'a' }, player(0, 0), 1000);
  const [x, y] = [s.x, s.y];
  skeletons.update(SKELETON.linger - 1, open, player(0, 0));
  assert.equal(skeletons.list.length, 1);
  assert.equal(s.sunk, 0);
  assert.deepEqual([s.x, s.y], [x, y]);
  for (let t = 0; t < 1 + SKELETON.sink + 0.1; t += 0.1) skeletons.update(0.1, open, player(0, 0));
  assert.equal(skeletons.list.length, 0);
});

test('skeletons rise near the player, out of the water, up to the limit', () => {
  const lakeSide = { isWalkable: () => true, typeAt: (x) => (x < 0 ? WATER : GRASS) };
  const skeletons = new Skeletons({ max: 2, firstAfter: 1, respawn: 2, seed: 4 });
  const p = player(0, 0);
  for (let t = 0; t < 0.9; t += 0.1) skeletons.update(0.1, lakeSide, p);
  assert.equal(skeletons.list.length, 0);
  for (let t = 0; t < 10; t += 0.1) skeletons.update(0.1, lakeSide, { ...p, x: 0, y: 0 });
  assert.equal(skeletons.living.length, 2);
  for (const s of skeletons.list) assert.ok(s.x >= 0);
  // A far spawn keeps out of sight but not out of mind.
  const fresh = new Skeletons({ firstAfter: Infinity, seed: 9 });
  const s = fresh.spawnNear(open, p);
  const d = distance(s, p);
  assert.ok(d >= 14 && d <= 26, `${d} m away`);
});

test('skeletons do not attack a player who has fallen', () => {
  const s = risen(0, 0);
  const target = player(...toCells(1, 0), { alive: false });
  for (let t = 0; t < 2; t += dt) s.update(dt, open, target);
  assert.ok(!s.events.some((e) => e.type === 'hit-player'));
});
