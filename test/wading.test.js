import assert from 'node:assert/strict';
import test from 'node:test';
import { Player } from '../src/entities/player.js';
import { dressFigure, drawFigure, drawShadow } from '../src/entities/figure.js';
import { Splashes } from '../src/world/splashes.js';
import { GRASS, MAX_WATER_DEPTH, WATER, World } from '../src/world/world.js';
import { withLayers } from './helpers/renderer.js';

const dt = 1 / 60;
const still = { x: 0, y: 0 };
const lake = { isWalkable: () => true, typeAt: () => WATER, waterDepthAt: () => MAX_WATER_DEPTH };

test('every lake is fordable while solid props still block movement', () => {
  const world = new World(1);
  assert.equal(world.typeAt(0.5, 70.5), WATER);
  assert.equal(world.isWalkable(0.5, 70.5), true);
  world.propsIn = () => [{ x: 0.5, y: 70.5, footW: 2, footH: 1 }];
  assert.equal(world.isWalkable(0.5, 70.5), false);
  assert.equal(world.isWalkable(4.5, 70.5), true);
});

test('water rises from the bank to at most knee depth, including the lowest terrain', () => {
  const world = new World(1);
  assert.equal(world.waterDepthAt(world.spawn.x, world.spawn.y), 0);
  const shallow = world.waterDepthAt(0.5, 64.5);
  assert.ok(shallow > 0 && shallow < 0.1);
  assert.equal(world.waterDepthAt(0.5, 85.5), MAX_WATER_DEPTH);
  for (let y = -70; y <= 100; y += 5) {
    for (let x = -70; x <= 70; x += 7) {
      const depth = world.waterDepthAt(x + 0.5, y + 0.5);
      assert.ok(Number.isFinite(depth) && depth >= 0 && depth <= MAX_WATER_DEPTH);
      if (world.typeAt(x + 0.5, y + 0.5) !== WATER) assert.equal(depth, 0);
    }
  }
});

test('walking crosses the shore, produces wet footfalls, and recovers on returning to land', () => {
  const world = new World(1);
  world.propsIn = () => [];
  const p = new Player(world.spawn.x, world.spawn.y);
  let wetSteps = 0;
  // Wade out into the deep middle of the spawn lake, short of its far bank.
  for (let i = 0; i < 480 && p.y < 95; i++) {
    p.update(dt, world, { x: 0, y: 1 }, false);
    wetSteps += p.events.filter((e) => e.type === 'step' && world.typeAt(e.x, e.y) === WATER).length;
    p.events.length = 0;
  }
  assert.equal(world.typeAt(p.x, p.y), WATER);
  assert.equal(p.waterDepth, MAX_WATER_DEPTH);
  assert.ok(wetSteps > 4);
  assert.ok(p.speed > 0.5 && p.speed < p.walkSpeed);
  for (let i = 0; i < 900 && p.y > world.spawn.y; i++) {
    p.update(dt, world, { x: 0, y: -1 }, false);
    p.events.length = 0;
  }
  assert.ok(p.y <= world.spawn.y, 'the bank remains traversable in the other direction');
  for (let i = 0; i < 90; i++) p.update(dt, world, still, false);
  assert.equal(p.waterDepth, 0);
  assert.equal(p.speedScale, 1);
});

test('wading slows both walking and running without stopping the gait', () => {
  for (const running of [false, true]) {
    const dry = new Player(0, 0);
    const wet = new Player(0, 0);
    const meadow = { ...lake, typeAt: () => GRASS, waterDepthAt: () => 0 };
    for (let i = 0; i < 240; i++) {
      dry.update(dt, meadow, { x: 1, y: 0 }, running);
      wet.update(dt, lake, { x: 1, y: 0 }, running);
      dry.events.length = 0;
      wet.events.length = 0;
    }
    assert.ok(wet.x > dry.x * 0.5 && wet.x < dry.x * 0.8);
    assert.ok(wet.walk > 0.9);
    assert.ok(wet.phase > 0);
  }
});

test('jumps still launch and land in knee-deep water, and resting never kneels into it', () => {
  const p = new Player(0, 0);
  for (let i = 0; i < 900; i++) {
    p.update(dt, lake, still, false);
    p.events.length = 0;
  }
  assert.equal(p.kneel, 0);
  p.jump();
  const events = [];
  let peak = 0;
  for (let i = 0; i < 90; i++) {
    p.update(dt, lake, still, false);
    peak = Math.max(peak, p.air);
    events.push(...p.events.filter((e) => e.type === 'jump' || e.type === 'land'));
    p.events.length = 0;
  }
  assert.ok(peak > MAX_WATER_DEPTH);
  assert.deepEqual(events.map((e) => e.type), ['jump', 'land']);
  assert.equal(p.air, 0);
  assert.equal(p.waterDepth, MAX_WATER_DEPTH);
});

test('water effects follow footfall events, ignore dry ground, and scale up for landings', () => {
  const splashes = new Splashes();
  const meadow = { typeAt: () => GRASS };
  const step = { type: 'step', x: 10.5, y: 8.5, strength: 0.3 };
  assert.equal(splashes.react(meadow, step), false);
  assert.equal(splashes.react(lake, { ...step, type: 'breath' }), false);
  assert.equal(splashes.rings.length + splashes.drops.length, 0);
  assert.equal(splashes.react(lake, step), true);
  assert.equal(splashes.rings[0].x, step.x);
  assert.equal(splashes.rings[0].y, step.y);
  const footDrops = splashes.drops.length;
  const landing = new Splashes();
  landing.react(lake, { ...step, type: 'land', strength: 1 });
  assert.ok(landing.drops.length > footDrops * 2);
  assert.ok(landing.rings[0].speed > splashes.rings[0].speed);
});

test('spray falls back into secondary ripples, expires, and stays bounded during repeated impacts', () => {
  const splashes = new Splashes();
  splashes.react(lake, { type: 'step', x: 10.5, y: 8.5, strength: 1 });
  for (let i = 0; i < 60; i++) splashes.update(dt);
  assert.equal(splashes.drops.length, 0);
  assert.ok(splashes.rings.some((p) => p.radius < 0.5));
  for (let i = 0; i < 120; i++) splashes.update(dt);
  assert.equal(splashes.rings.length, 0);
  for (let i = 0; i < 500; i++) {
    splashes.react(lake, { type: 'land', x: 10.5, y: 8.5, strength: 1 });
  }
  assert.ok(splashes.rings.length <= 96);
  assert.ok(splashes.drops.length <= 240);
});

test('surface rings and knee waterlines stay clipped to water across a shore and view boundary', () => {
  const cols = 24;
  const rows = 16;
  const r = withLayers({ cols, rows, fg: new Uint8ClampedArray(cols * rows * 4), mask: new Uint8Array(cols * rows) });
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) r.mask[y * cols + x] = x < 12 ? WATER : GRASS;
  }
  const splashes = new Splashes();
  splashes.react(lake, { type: 'step', x: 11.5, y: 8.5, strength: 1 });
  splashes.update(0.45);
  const view = { x0: 0, y0: 0, cols, rows };
  splashes.drawSurface(r, view, 0.45);
  splashes.drawContacts(r, view, 0.45,
    [{ x: 11.5, y: 8.5 }, { x: -0.5, y: 0.5 }]);
  assert.ok(r.fg.some((v, i) => i % 4 === 3 && v > 0), 'water shows visible crests');
  for (let i = 0; i < r.mask.length; i++) {
    if (r.mask[i] !== WATER) {
      assert.deepEqual([...r.fg.slice(i * 4, i * 4 + 4)], [0, 0, 0, 0]);
      assert.deepEqual([...r.ov.slice(i * 4, i * 4 + 4)], [0, 0, 0, 0]);
    }
  }
});

test('the fallback figure also sinks to knee depth and clips its submerged boots', () => {
  const p = new Player(30.5, 30.5);
  const view = { x0: 0, y0: 0, cols: 80, rows: 80 };
  const cells = () => {
    const out = [];
    drawFigure({}, view, p, dressFigure(p), (r, x, y) => out.push({ x, y }));
    return out;
  };
  const dry = cells();
  p.waterDepth = MAX_WATER_DEPTH;
  const wet = cells();
  assert.ok(wet.length > 50 && wet.length < dry.length * 0.9);
  assert.ok(Math.min(...wet.map((c) => c.y)) > Math.min(...dry.map((c) => c.y)), 'the body sinks into the bed');
  assert.ok(Math.max(...wet.map((c) => c.y)) <= Math.floor(p.y) + 1, 'no submerged cells extend below the waterline');
});

test('the solid ground shadow leaves water and its reflections untouched', () => {
  const cols = 24;
  const rows = 16;
  const r = { cols, rows, fg: new Uint8ClampedArray(cols * rows * 4).fill(80),
    bg: new Uint8ClampedArray(cols * rows * 4).fill(20), mask: new Uint8Array(cols * rows).fill(WATER) };
  drawShadow(r, { x0: 0, y0: 0, cols, rows }, 12.5, 8.5);
  assert.ok(r.fg.every((v) => v === 80));
  assert.ok(r.bg.every((v) => v === 20));
});

test('breath stays with the lowered head instead of floating above a wading character', () => {
  const dry = new Player(0, 0);
  const wet = new Player(0, 0);
  dry.nextBreath = wet.nextBreath = 0;
  wet.waterDepth = MAX_WATER_DEPTH;
  dry.update(dt, { ...lake, waterDepthAt: () => 0 }, still, false);
  wet.update(dt, lake, still, false);
  const dryBreath = dry.events.find((e) => e.type === 'breath');
  const wetBreath = wet.events.find((e) => e.type === 'breath');
  assert.ok(wetBreath.h < dryBreath.h - 4);
  assert.equal(wetBreath.x, dryBreath.x);
});
