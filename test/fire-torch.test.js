import assert from 'node:assert/strict';
import test from 'node:test';
import { Fires, FIRE_GROW_SECONDS, MAX_FIRES, STRONG_WIND, firePulse } from '../src/world/fire.js';
import { grassGust } from '../src/audio/environment.js';
import { reflector } from '../src/world/reflection.js';
import { drawGround } from '../src/world/ground.js';
import { ASPECT, DIRT, GRASS, STONE, WATER, World } from '../src/world/world.js';
import { withLayers } from './helpers/renderer.js';

const dryWorld = (overrides = {}) => ({ seed: 1, spawn: { x: 0.5, y: 0.5 },
  typeAt: () => GRASS, isWalkable: () => true, burnGrass() {}, ...overrides });
const view = { x0: -40, y0: -40, cols: 80, rows: 80 };

function buffer(type = GRASS) {
  const r = { cols: 80, rows: 80,
    fg: new Uint8ClampedArray(80 * 80 * 4), bg: new Uint8ClampedArray(80 * 80 * 4),
    mask: new Uint8Array(80 * 80).fill(type) };
  r.put = (x, y, g, red, green, blue) => {
    assert.ok([x, y, g, red, green, blue].every(Number.isFinite));
    if (x < 0 || y < 0 || x >= r.cols || y >= r.rows) return;
    r.fg.set([red, green, blue, g], (y * r.cols + x) * 4);
  };
  r.putBg = (x, y, red, green, blue) => {
    assert.ok([red, green, blue].every(Number.isFinite));
    if (x < 0 || y < 0 || x >= r.cols || y >= r.rows) return;
    r.bg.set([red, green, blue, 0], (y * r.cols + x) * 4);
  };
  return withLayers(r);
}

test('campfires require a dry, unobstructed footprint and cannot overlap', () => {
  const fires = new Fires();
  assert.equal(fires.add(dryWorld({ typeAt: (x, y) => x > 5 && y > 0 ? WATER : GRASS }), 0.5, 0.5), null);
  assert.equal(fires.add(dryWorld({ isWalkable: x => x < 5 }), 0.5, 0.5), null);
  assert.equal(fires.add(dryWorld(), NaN, 0), null);
  assert.ok(fires.add(dryWorld(), 0.2, 0.8));
  assert.deepEqual([fires.list[0].x, fires.list[0].y], [0.5, 0.5]);
  assert.equal(fires.add(dryWorld(), 3, 0), null);
  assert.ok(fires.add(dryWorld(), 30, 0));
});

test('starter fires are reproducible and stand beside real seeded spawn clearings', () => {
  for (const seed of [1, 2, 42, 1337]) {
    const world = new World(seed);
    const a = new Fires().addStarter(world);
    const b = new Fires().addStarter(new World(seed));
    assert.ok(a, `seed ${seed} has a starter fire`);
    assert.deepEqual(a, b);
    assert.ok(Math.hypot((a.x - world.spawn.x) * ASPECT, a.y - world.spawn.y) > 8);
    assert.equal(new Fires().canPlace(world, a.x, a.y), true);
  }
});

test('C creates a fire ahead, extinguishes the closest fire, and rejects water and jumping', () => {
  const fires = new Fires();
  const player = { x: 0.5, y: 0.5, heading: Math.PI / 2, air: 0 };
  assert.equal(fires.toggle(dryWorld(), player), 'lit');
  assert.ok(fires.list[0].x > player.x);
  assert.equal(fires.toggle(dryWorld(), player), 'out');
  assert.equal(fires.list.length, 0);
  assert.equal(fires.toggle(dryWorld({ typeAt: () => WATER }), player), 'water');
  assert.equal(fires.toggle(dryWorld(), { ...player, air: 0.3 }), 'air');
  assert.equal(fires.toggle(dryWorld({ isWalkable: () => false }), player), 'blocked');
});

test('fires stay bounded and distant fires do not generate render cells', () => {
  const fires = new Fires();
  for (let i = 0; i < MAX_FIRES; i++) assert.ok(fires.add(dryWorld(), i * 100, 0));
  assert.equal(fires.add(dryWorld(), MAX_FIRES * 100, 0), null);
  assert.equal(fires.toggle(dryWorld(), { x: -100, y: 0, heading: 0, air: 0 }), 'limit');
  const visible = fires.prepare(view, 1);
  assert.equal(visible.length, 1);
  assert.ok(visible[0].cells.length < 400);
  assert.equal(fires.list.at(-1).cells.length, 0);
});

test('flames animate, brighten nearby terrain, and reflect only on water', () => {
  const fires = new Fires({ windAt: () => 0.3 });
  const fire = fires.add(dryWorld(), 0, 0);
  fires.update(FIRE_GROW_SECONDS, FIRE_GROW_SECONDS, dryWorld());
  const visible = fires.prepare(view, 1);
  const first = JSON.stringify(fire.cells);
  fires.prepare(view, 1.5);
  assert.notEqual(JSON.stringify(fire.cells), first);
  const r = buffer();
  fires.draw(r, view, fire, 1.5);
  assert.ok(r.fg.some(value => value > 200));
  const glyphs = r.fg.filter((_, i) => i % 4 === 3);
  fires.light(r, view, 1.5, visible);
  assert.deepEqual(r.fg.filter((_, i) => i % 4 === 3), glyphs);
  const near = (40 * r.cols + 40) * 4;
  assert.ok(r.bg[near] > r.bg[near + 1]);
  assert.deepEqual([...r.fg.slice(0, 4)], [0, 0, 0, 0], 'distant ground is unchanged');

  const dry = buffer();
  const water = buffer(WATER);
  fires.draw(dry, view, fire, 1.5, reflector(1.5, view));
  fires.draw(water, view, fire, 1.5, reflector(1.5, view));
  assert.equal(dry.fg.some(value => value !== 0), false);
  assert.ok(water.fg.some(value => value > 70));
  fires.draw(buffer(), { ...view, x0: 0, y0: 0 }, fire, 1.5);
});

test('fires begin small and steadily grow in size and light to a bounded full blaze', () => {
  const world = dryWorld();
  const fires = new Fires({ windAt: () => 0.3 });
  const fire = fires.add(world, 0, 0);
  const light = () => {
    const r = buffer();
    fires.light(r, view, 1, [fire]);
    return r.bg.reduce((total, value) => total + value, 0);
  };
  fires.prepare(view, 1);
  const small = { intensity: fire.intensity, cells: fire.cells.length,
    height: -Math.min(...fire.cells.map(c => c.dy)), light: light(), pulse: firePulse(fire, 1) };
  let previous = fire.intensity;
  for (let second = 1; second <= FIRE_GROW_SECONDS; second++) {
    fires.update(1, second, world);
    assert.ok(fire.intensity > previous);
    previous = fire.intensity;
  }
  fires.prepare(view, 1);
  assert.equal(fire.intensity, 1);
  assert.ok(fire.cells.length > small.cells);
  assert.ok(-Math.min(...fire.cells.map(c => c.dy)) > small.height);
  assert.ok(light() > small.light * 3);
  assert.ok(firePulse(fire, 1) > small.pulse * 3);
  fires.update(300, 320, world);
  assert.equal(fire.intensity, 1);
});

test('brief gusts weaken a fire, calmer wind restores it, and fresh fires restart small', () => {
  const world = dryWorld();
  let wind = STRONG_WIND;
  const fires = new Fires({ windAt: () => wind });
  const fire = fires.add(world, 0, 0);
  fires.update(FIRE_GROW_SECONDS, FIRE_GROW_SECONDS, world);
  assert.equal(fire.intensity, 1, 'wind below the strong-gust threshold is survivable');
  wind = 1;
  fires.update(0.1, 21, world);
  assert.equal(fires.list.length, 1);
  assert.ok(fire.intensity > 0 && fire.intensity < 1);
  wind = 0.3;
  fires.update(1, 22, world);
  assert.equal(fire.intensity, 1);
  fires.extinguish(world, fire);
  const fresh = fires.add(world, 0, 0);
  assert.equal(fresh.age, 0);
  assert.ok(fresh.intensity < 0.25);
});

test('sustained strong wind extinguishes every affected fire, including offscreen, leaving ash', () => {
  const world = grassWorld();
  let wind = 0.3;
  const fires = new Fires({ windAt: () => wind });
  const near = fires.add(world, 0, 0);
  const far = fires.add(world, 30, 30);
  fires.update(FIRE_GROW_SECONDS, FIRE_GROW_SECONDS, world);
  wind = 1;
  const extinguished = [];
  let previous = near.intensity;
  for (let frame = 0; frame < 30 && fires.list.length; frame++) {
    extinguished.push(...fires.update(0.1, 21 + frame / 10, world));
    assert.ok(near.intensity < previous);
    previous = near.intensity;
  }
  assert.equal(fires.list.length, 0);
  assert.deepEqual(new Set(extinguished), new Set([near, far]));
  for (const fire of extinguished) {
    const { c, i } = world.locate(Math.floor(fire.x), Math.floor(fire.y));
    assert.equal(c.burnt[i], 255);
    assert.equal(fire.intensity, 0);
    assert.deepEqual(fire.cells, []);
  }
  assert.deepEqual(fires.update(1, 30, world), [], 'dead fires do not repeat their extinction');
});

test('local wind matches the grass field and invalid or paused time cannot advance fires', () => {
  const world = dryWorld();
  const fires = new Fires();
  const fire = fires.add(world, 0, 0);
  fires.update(0.1, 1, world);
  assert.equal(fire.gust, grassGust(world, fire.x, fire.y, 1));
  const state = { ...fire };
  for (const dt of [0, -1, NaN, Infinity]) assert.deepEqual(fires.update(dt, 2, world), []);
  assert.deepEqual(fires.update(1, NaN, world), []);
  assert.deepEqual(fire, state);
});

test('storm wind can blow out a fire even when local meadow gusts are gentle', () => {
  const world = dryWorld();
  const fires = new Fires({ windAt: () => 0.3 });
  const fire = fires.add(world, 0, 0);
  fires.update(FIRE_GROW_SECONDS, FIRE_GROW_SECONDS, world);
  fires.update(5, 25, world, 0.2);
  assert.equal(fire.intensity, 1, 'gentle weather wind lets the fire keep burning');
  for (let frame = 0; frame < 60 && fires.list.length; frame++) fires.update(0.1, 26 + frame / 10, world, 1);
  assert.equal(fires.list.length, 0, 'a strong gale adds to the local gust field');
});

function grassWorld() {
  const world = new World(1);
  for (const cy of [-1, 0]) {
    for (const cx of [-1, 0]) {
      const c = world.chunk(cx, cy);
      c.type.fill(GRASS);
      c.props = [];
    }
  }
  return world;
}

test('extinguishing leaves burnt terrain at the fire, and rebuilding preserves it', () => {
  const world = grassWorld();
  const fires = new Fires();
  const fire = fires.add(world, 0.5, 0.5);
  const { c, i } = world.locate(0, 0);
  assert.equal(c.burnt, null, 'lighting alone does not scorch the terrain');
  const player = { x: 0.5, y: 0.5, heading: 0, air: 0 };
  assert.equal(fires.toggle(world, player), 'out');
  assert.equal(c.burnt[i], 255);
  assert.equal(fires.list.length, 0);
  const patch = c.burnt.slice();
  world.chunk(20, 20);
  assert.equal(world.locate(0, 0).c.burnt[i], 255, 'the mark survives exploring other chunks');
  assert.ok(fires.add(world, fire.x, fire.y));
  assert.deepEqual(c.burnt, patch);
  assert.equal(fires.toggle(world, player), 'out');
  assert.deepEqual(c.burnt, patch, 'repeated use keeps the existing burn');
});

test('burn marks cross negative chunk boundaries, affect only grass, and never weaken', () => {
  const world = grassWorld();
  for (const [x, y, type] of [[1, 0, WATER], [-1, 0, DIRT], [0, 1, STONE]]) {
    const { c, i } = world.locate(x, y);
    c.type[i] = type;
  }
  world.burnGrass(0.5, 0.5);
  for (const cy of [-1, 0]) {
    for (const cx of [-1, 0]) assert.ok(world.chunk(cx, cy).burnt.some(value => value > 0));
  }
  for (const [x, y, type] of [[1, 0, WATER], [-1, 0, DIRT], [0, 1, STONE]]) {
    const { c, i } = world.locate(x, y);
    assert.equal(c.type[i], type);
    assert.equal(c.burnt[i], 0);
  }
  const { c, i } = world.locate(0, 0);
  world.burnGrass(9.5, 0.5);
  assert.equal(c.burnt[i], 255, 'a later patch edge cannot dilute the original centre');
  assert.equal(world.chunk(2, 2).burnt, null, 'unaffected chunks allocate no burn map');
});

test('burnt grass renders as static ash at its world position beneath other scenery', () => {
  const world = grassWorld();
  const bend = { x: 30, y: 30 };
  const r = buffer();
  drawGround(r, world, view, 5, bend);
  const before = r.fg.slice();
  world.burnGrass(0.5, 0.5);
  drawGround(r, world, view, 5, bend);
  const center = (40 * r.cols + 40) * 4;
  assert.ok(r.fg[center] > r.fg[center + 1], 'charred centre is brown instead of green');
  assert.notDeepEqual(r.fg.slice(center, center + 4), before.slice(center, center + 4));
  assert.deepEqual(r.fg.slice(0, 4), before.slice(0, 4), 'distant grass is unchanged');
  assert.equal(r.mask[center / 4], GRASS, 'the patch remains walkable grass terrain');
  const ash = r.fg.slice(center, center + 4);
  const shifted = { ...view, x0: -36, y0: -36 };
  drawGround(r, world, shifted, 500, bend);
  const shiftedCenter = (36 * r.cols + 36) * 4;
  assert.deepEqual(r.fg.slice(shiftedCenter, shiftedCenter + 4), ash, 'ash stays fixed across time and camera movement');
});
