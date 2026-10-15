import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KINDS, Monster, Monsters, toCells, toMetres } from '../src/entities/monsters.js';
import { GRASS, MAX_WATER_DEPTH, WATER } from '../src/world/world.js';

const SKELETON = KINDS.skeleton;
const open = { isWalkable: () => true, typeAt: () => GRASS };
const dt = 1 / 60;
const distance = (a, b) => Math.hypot(...toMetres(a.x - b.x, a.y - b.y));
const player = (x, y, extra = {}) => ({ x, y, air: 0, heading: 0, runSpeed: 5, feel: { reach: 0.95 }, ...extra });
const risen = (mx, mz) => new Monster(...toCells(mx, mz), { risen: true });

test('a skeleton climbs out of the ground before it moves', () => {
  const s = new Monster(0, 0);
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
  const monsters = new Monsters({ counts: { skeleton: 3 }, first: Infinity });
  const s = risen(0, 1.2);
  monsters.list.push(s);
  const p = player(0, 0, { heading: 0 });
  const behind = player(0, 0, { heading: Math.PI });
  const cut = { type: 'strike', swing: 'a' };
  assert.equal(monsters.strike(cut, behind, 22).length, 0, 'a cut the other way misses');
  assert.equal(monsters.strike({ ...cut, swing: 'spin' }, behind, 22).length, 1, 'a spin hits all round');
  assert.equal(s.state, 'stagger');
  assert.ok(s.alive);
  monsters.strike(cut, p, 22);
  assert.ok(s.alive);
  monsters.strike(cut, p, 22);
  assert.equal(s.alive, false);
  assert.equal(s.state, 'dead');
  assert.equal(monsters.kills, 1);
  assert.ok(monsters.events.some((e) => e.type === 'death'));
  // The dead neither move nor take further hits.
  assert.equal(monsters.strike(cut, p, 22).length, 0);
});

test('a staggered skeleton is knocked back and recovers', () => {
  const monsters = new Monsters({ counts: { skeleton: 3 }, first: Infinity });
  const s = risen(0, 1);
  monsters.list.push(s);
  const p = player(0, 0);
  monsters.strike({ type: 'strike', swing: 'a' }, p, 10);
  const before = distance(s, p);
  for (let t = 0; t < 0.3; t += dt) monsters.update(dt, open, p);
  assert.ok(distance(s, p) > before + 0.3, 'pushed away');
  for (let t = 0; t < SKELETON.stagger; t += dt) monsters.update(dt, open, p);
  assert.notEqual(s.state, 'stagger');
});

test('the fallen lie a while, then sink away and are removed', () => {
  const monsters = new Monsters({ counts: { skeleton: 3 }, first: Infinity });
  const s = risen(0, 1);
  monsters.list.push(s);
  monsters.strike({ type: 'strike', swing: 'a' }, player(0, 0), 1000);
  const [x, y] = [s.x, s.y];
  monsters.update(SKELETON.linger - 1, open, player(0, 0));
  assert.equal(monsters.list.length, 1);
  assert.equal(s.sunk, 0);
  assert.deepEqual([s.x, s.y], [x, y]);
  for (let t = 0; t < 1 + SKELETON.sink + 0.1; t += 0.1) monsters.update(0.1, open, player(0, 0));
  assert.equal(monsters.list.length, 0);
});

test('monsters rise near the player, out of the water, up to the limit', () => {
  const lakeSide = { isWalkable: () => true, typeAt: (x) => (x < 0 ? WATER : GRASS) };
  const monsters = new Monsters({ counts: { skeleton: 2 }, first: 1, every: 2, seed: 4 });
  const p = player(0, 0);
  for (let t = 0; t < 0.9; t += 0.1) monsters.update(0.1, lakeSide, p);
  assert.equal(monsters.list.length, 0);
  for (let t = 0; t < 10; t += 0.1) monsters.update(0.1, lakeSide, { ...p, x: 0, y: 0 });
  assert.equal(monsters.living.length, 2);
  for (const s of monsters.list) assert.ok(s.x >= 0);
  // A far spawn keeps out of sight but not out of mind.
  const fresh = new Monsters({ counts: { skeleton: 3 }, first: Infinity, seed: 9 });
  const s = fresh.spawnNear(open, p);
  const d = distance(s, p);
  assert.ok(d >= 14 && d <= 26, `${d} m away`);
});

test('monsters do not attack a player who has fallen', () => {
  const s = risen(0, 0);
  const target = player(...toCells(1, 0), { alive: false });
  for (let t = 0; t < 2; t += dt) s.update(dt, open, target);
  assert.ok(!s.events.some((e) => e.type === 'hit-player'));
});

const GOBLIN = KINDS.goblin;
const goblin = (mx, mz) => new Monster(...toCells(mx, mz), { kind: GOBLIN });

test('a goblin arrives on its feet and cackles when it spots the player', () => {
  const g = goblin(0, 0);
  assert.equal(g.state, 'idle');
  const target = player(...toCells(GOBLIN.notice - 2, 0));
  g.update(dt, open, target);
  assert.equal(g.state, 'chase');
  assert.deepEqual(g.events.map((e) => e.type), ['spot']);
});

test('a goblin is quicker than a skeleton but a sprinting player still escapes it', () => {
  const g = goblin(0, 0);
  const s = risen(0, 0);
  const target = player(...toCells(20, 0));
  let fastest = { g: 0, s: 0 };
  for (let t = 0; t < 3; t += dt) {
    g.update(dt, open, target);
    s.update(dt, open, target);
    fastest = { g: Math.max(fastest.g, g.groundSpeed), s: Math.max(fastest.s, s.groundSpeed) };
  }
  assert.ok(fastest.g > fastest.s + 0.4, `goblin ${fastest.g} m/s, skeleton ${fastest.s} m/s`);
  assert.ok(fastest.g < target.runSpeed);
});

test('a goblin stabs, skips back out of reach to circle, then rushes in again', () => {
  const g = goblin(0, 0);
  const target = player(...toCells(0.9, 0));
  const states = [];
  const hits = [];
  let farthest = 0;
  let backedOff = false;
  for (let t = 0; t < 6; t += dt) {
    g.update(dt, open, target, [], () => 0.3);
    for (const e of g.events.splice(0)) if (e.type === 'hit-player') hits.push(t);
    if (states.at(-1) !== g.state) states.push(g.state);
    if (g.state === 'skirmish') {
      backedOff = true;
      farthest = Math.max(farthest, distance(g, target));
    }
  }
  assert.ok(backedOff, `states: ${states.join(' > ')}`);
  assert.ok(farthest > GOBLIN.backOff * 0.8, `backed off to ${farthest} m`);
  assert.ok(hits.length >= 2, 'and came back to stab again');
  assert.equal(hits.length > 0 && GOBLIN.damage < SKELETON.damage, true, 'a goblin stab is lighter than a sword cut');
  const first = states.indexOf('attack');
  assert.equal(states[first + 1], 'skirmish');
  assert.equal(states[first + 2], 'chase');
});

test('a wounded goblin panics and flees, then comes back; two cuts finish it', () => {
  const monsters = new Monsters({ counts: { goblin: 1 }, first: Infinity });
  const g = goblin(1, 0);
  monsters.list.push(g);
  const p = player(0, 0, { heading: Math.PI / 2 });
  assert.equal(monsters.strike({ type: 'strike', swing: 'a' }, p, 22).length, 1);
  assert.ok(g.alive);
  const before = distance(g, p);
  for (let t = 0; t < GOBLIN.stagger + 1.2; t += dt) monsters.update(dt, open, p);
  assert.equal(g.state, 'flee');
  assert.ok(distance(g, p) > before + 2, `fled to ${distance(g, p)} m`);
  for (let t = 0; t < GOBLIN.flee; t += dt) monsters.update(dt, open, p);
  assert.equal(g.state, 'chase', 'back for more');
  // It only panics once.
  [g.x, g.y] = toCells(1, 0);
  monsters.strike({ type: 'strike', swing: 'a' }, p, 10);
  assert.ok(g.alive);
  for (let t = 0; t < GOBLIN.stagger + 0.1; t += dt) monsters.update(dt, open, p);
  assert.notEqual(g.state, 'flee');
  [g.x, g.y] = toCells(1, 0);
  monsters.strike({ type: 'strike', swing: 'a' }, p, 22);
  assert.equal(g.alive, false);
  assert.ok(monsters.events.some((e) => e.type === 'death' && e.monster === g));
});

test('skeletons and goblins each come in up to their own number', () => {
  const monsters = new Monsters({ counts: { skeleton: 2, goblin: 1 }, seed: 3 });
  const p = player(0, 0);
  for (let t = 0; t < GOBLIN.spawn.first - 1; t += 0.1) monsters.update(0.1, open, { ...p });
  assert.ok(monsters.of('skeleton').length >= 1);
  assert.equal(monsters.of('goblin').length, 0, 'goblins come later');
  for (let t = 0; t < 30; t += 0.1) monsters.update(0.1, open, { ...p, alive: false });
  assert.equal(monsters.of('skeleton').length, 2);
  assert.equal(monsters.of('goblin').length, 1);
  const g = monsters.of('goblin')[0];
  const d = distance(g, p);
  assert.ok(d >= GOBLIN.spawn.near - 0.01 && d <= GOBLIN.spawn.far + 0.01, `${d} m away`);
  assert.ok(!monsters.events.some((e) => e.type === 'rise' && e.monster === g), 'goblins do not climb out of the ground');
});

const TROLL = KINDS.troll;
const troll = (mx, mz) => new Monster(...toCells(mx, mz), { kind: TROLL });

test('a troll lumbers: slower than a skeleton, easily outrun', () => {
  const t = troll(0, 0);
  const s = risen(0, 0);
  const target = player(...toCells(25, 0));
  let fastest = { t: 0, s: 0 };
  for (let time = 0; time < 4; time += dt) {
    t.update(dt, open, target);
    s.update(dt, open, target);
    fastest = { t: Math.max(fastest.t, t.groundSpeed), s: Math.max(fastest.s, s.groundSpeed) };
  }
  assert.ok(fastest.t < fastest.s * 0.75, `troll ${fastest.t} m/s, skeleton ${fastest.s} m/s`);
  assert.ok(fastest.t < target.runSpeed * 0.6);
});

test('a troll raises its club slowly and smashes the ground where it lands', () => {
  const t = troll(0, 0);
  const target = player(...toCells(1.8, 0));
  const events = [];
  let swungAt = null;
  for (let time = 0; time < 2.5; time += dt) {
    t.update(dt, open, target);
    for (const e of t.events.splice(0)) {
      events.push({ ...e, time });
      if (e.type === 'swing') swungAt ??= time;
    }
  }
  const slam = events.find((e) => e.type === 'slam');
  const hit = events.find((e) => e.type === 'hit-player');
  assert.ok(slam && hit, events.map((e) => e.type).join());
  assert.ok(hit.time - swungAt > 0.8, 'a long, readable wind-up');
  assert.equal(hit.amount, TROLL.damage);
  assert.ok(TROLL.damage > SKELETON.damage * 2);
  // The smash lands out in front, where the player stands.
  assert.ok(Math.hypot(...toMetres(slam.x - target.x, slam.y - target.y)) < 0.8);
});

test('stepping aside from the smash dodges it', () => {
  const t = troll(0, 0);
  const target = player(...toCells(1.8, 0));
  const events = [];
  for (let time = 0; time < TROLL.windUp * 0.8; time += dt) {
    t.update(dt, open, target);
    events.push(...t.events.splice(0));
  }
  assert.equal(t.state, 'attack');
  // Round behind its shoulder, out of the club's arc.
  [target.x, target.y] = toCells(-0.4, 1.6);
  for (let time = 0; time < 0.6; time += dt) {
    t.update(dt, open, target);
    events.push(...t.events.splice(0));
  }
  assert.ok(events.some((e) => e.type === 'slam'), 'the club still comes down');
  assert.ok(!events.some((e) => e.type === 'hit-player'));
});

test('a troll shrugs off cuts, reeling only from every third, and rages when badly hurt', () => {
  const monsters = new Monsters({ counts: { troll: 1 }, first: Infinity });
  const t = troll(1.9, 0);
  monsters.list.push(t);
  const p = player(0, 0, { heading: Math.PI / 2 });
  const cut = () => {
    [t.x, t.y] = toCells(1.9, 0);
    return monsters.strike({ type: 'strike', swing: 'a' }, p, 22).length;
  };
  monsters.update(dt, open, p);
  assert.equal(cut(), 1, 'a cut finds a troll further off than a skeleton');
  assert.notEqual(t.state, 'stagger');
  cut();
  assert.notEqual(t.state, 'stagger');
  cut();
  assert.equal(t.state, 'stagger', 'the third cut makes it reel');
  assert.ok(!monsters.events.some((e) => e.type === 'enrage'));
  cut();
  assert.equal(t.enraged, true);
  assert.equal(monsters.events.filter((e) => e.type === 'enrage').length, 1);
  cut();
  cut();
  assert.ok(t.alive, 'six cuts are not enough');
  cut();
  assert.equal(t.alive, false, 'seven bring it down');
  // A skeleton as far off is out of reach of the same cut.
  const s = risen(1.9, 0);
  monsters.list.push(s);
  assert.equal(monsters.strike({ type: 'strike', swing: 'a' }, p, 22).length, 0);
});

test('an enraged troll is quicker', () => {
  const calm = troll(0, 0);
  const angry = troll(0, 5);
  angry.enraged = true;
  const target = player(...toCells(20, 2.5));
  let fastest = { calm: 0, angry: 0 };
  for (let time = 0; time < 4; time += dt) {
    calm.update(dt, open, target);
    angry.update(dt, open, target);
    fastest = { calm: Math.max(fastest.calm, calm.groundSpeed), angry: Math.max(fastest.angry, angry.groundSpeed) };
  }
  assert.ok(fastest.angry > fastest.calm * 1.25, JSON.stringify(fastest));
});

test('one troll at most comes, well after the first skeletons, and not too close', () => {
  const monsters = new Monsters({ seed: 5 });
  const p = player(0, 0, { alive: false });
  for (let t = 0; t < TROLL.spawn.first - 1; t += 0.5) monsters.update(0.5, open, { ...p });
  assert.equal(monsters.of('troll').length, 0);
  for (let t = 0; t < 120; t += 0.5) monsters.update(0.5, open, { ...p });
  assert.equal(monsters.of('troll').length, 1);
  assert.ok(distance(monsters.of('troll')[0], p) >= TROLL.spawn.near - 0.01);
});
