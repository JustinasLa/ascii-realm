import assert from 'node:assert/strict';
import test from 'node:test';
import { Fires, FIRE_GROW_SECONDS, MAX_FIRES, MAX_FIRE_PARTICLES, STRONG_WIND, drawFireLight, firePulse } from '../src/world/fire.js';
import { grassGust } from '../src/audio/environment.js';
import { reflector } from '../src/world/reflection.js';
import { drawGround } from '../src/world/ground.js';
import { Grass } from '../src/world/grass.js';
import { GLYPHS, GLYPH_MASK } from '../src/render/glyphs.js';
import { Harvesting } from '../src/world/harvesting.js';
import { GroundItems } from '../src/world/items.js';
import { drawResource } from '../src/world/item-draw.js';
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

test('a starter fire is skipped when no spot round the spawn will take one', () => {
  assert.equal(new Fires().addStarter(dryWorld({ isWalkable: () => false })), null);
});

test('fire light is a round disc in row units, brightest at the flame and clipped to the screen', () => {
  const r = { cols: 60, rows: 30, fg: new Float32Array(60 * 30 * 4), ov: new Float32Array(60 * 30 * 4), bg: new Float32Array(60 * 30 * 4) };
  const source = { x: 30, y: 15, intensity: 1, seed: 0 }, radius = 6;
  drawFireLight(r, { x0: 0, y0: 0 }, 0, source, radius, 0);
  const lit = (x, y) => r.bg[(y * r.cols + x) * 4];
  for (let y = 0; y < r.rows; y++) for (let x = 0; x < r.cols; x++) {
    const d = Math.hypot((x - 30) * ASPECT, y - 15);
    if (d >= radius) assert.equal(lit(x, y), 0, `${x},${y} is outside the disc`);
    else if (d < radius - 0.5) assert.ok(lit(x, y) > 0, `${x},${y} is inside the disc`);
  }
  assert.ok(lit(30, 15) > lit(33, 15) && lit(33, 15) > lit(36, 15));
  assert.ok(Math.abs(lit(30, 11) - lit(30, 19)) < 1e-6, 'symmetric up and down');
  // Wide enough to spill over every edge of the screen, and still in bounds.
  const edge = { ...r, fg: new Float32Array(r.fg.length), ov: new Float32Array(r.fg.length), bg: new Float32Array(r.fg.length) };
  assert.doesNotThrow(() => drawFireLight(edge, { x0: 0, y0: 0 }, 0, { x: 1, y: 1, intensity: 1, seed: 0 }, 60, 0));
  assert.ok(edge.bg[0] > 0 && edge.bg[(29 * 60 + 59) * 4] > 0);
});

test('a live hearth clears grass roots, stays clear after travel and releases its coverage when extinguished', () => {
  const world = new World(1, 16);
  const fires = new Fires();
  const fire = fires.addStarter(world);
  assert.ok(fire);
  const cleared = () => world.locate(Math.floor(fire.x), Math.floor(fire.y));
  let { c, i } = cleared();
  assert.equal(c.grassHeight[i], 0);
  assert.equal(c.burnt, null, 'a new hearth clears grass without scorching it');
  assert.ok(!c.blades.indices.includes(i), 'no blade is rooted in the hearth');
  const key = `${c.cx},${c.cy}`;
  for (let n = 0; n < 48; n++) world.chunk(n + 20, 20);
  assert.equal(world.chunks.has(key), false, 'the original chunk was evicted');
  ({ c, i } = cleared());
  assert.equal(c.grassHeight[i], 0, 'the live clearing survives terrain regeneration');
  assert.ok(!c.blades.indices.includes(i));
  fires.extinguish(world, fire);
  assert.ok(!world.bareGround.get(key).has(i), 'the removed fire no longer covers this cell');
  ({ c, i } = cleared());
  assert.ok(c.grassHeight[i] > 0, 'the original grass height is restored');
  assert.equal(c.burnt[i], 255, 'the usual ash remains after extinguishing');
  assert.ok(!c.blades.indices.includes(i), 'ash keeps tall grass out of the burnt hearth');
});

test('tall foreground grass cannot overwrite a campfire stone ring', () => {
  const world = grassWorld();
  for (const c of world.chunks.values()) {
    c.grassHeight.fill(5);
    c.grassDensity.fill(1);
    world.touched(c);
  }
  const fires = new Fires({ windAt: () => 0.42 });
  const fire = fires.add(world, 0.5, 0.5);
  const r = buffer();
  const grass = new Grass();
  for (const intensity of [0.18, 1]) {
    fire.intensity = intensity;
    fires.prepare(view, 1);
    grass.drawLayered(r, world, view, 1, [{ y: fire.y, draw: () => fires.draw(r, view, fire, 1) }]);
    for (const c of fire.hearth.filter(c => c.stone && c.dy === 2)) {
      const i = (40 + c.dy) * r.cols + 40 + c.dx;
      assert.equal(r.glyphAt(i), c.g, 'front stones stay visible at every fire size');
    }
    const flames = fire.cells.filter(c => c.dy < -2 && c.r > 180);
    assert.ok(flames.length >= 8, 'even a newly lit fire has a visible flame');
    assert.ok(flames.every(c => (c.g & GLYPH_MASK) < GLYPHS.length), 'flames use full-strength font characters');
  }
});

test('campfires choose a clear hearth instead of building beneath foreground resource plants', () => {
  const world = new World(1);
  const harvesting = new Harvesting(world, new GroundItems(world));
  const fires = new Fires({ resourcesIn: (...bounds) => harvesting.resourcesIn(...bounds) });
  const { x, y } = world.spawn;
  const bushes = harvesting.resourcesIn(x - 60, y - 40, x + 60, y + 40).filter(n => n.kind === 'bush');
  assert.ok(bushes.length > 0, 'the meadow around the spawn has berry bushes');
  assert.equal(fires.add(world, bushes[0].x, bushes[0].y), null, 'a hearth is never built beneath a berry bush');
  // Build in a clear spot just beside one of them.
  let fire = null;
  for (const bush of bushes) {
    for (let r = 3; r < 9 && !fire; r++) {
      for (let k = 0; k < 16 && !fire; k++) {
        const a = k * Math.PI / 8;
        fire = fires.add(world, Math.floor(bush.x + Math.cos(a) * r / 0.6) + 0.5, Math.floor(bush.y + Math.sin(a) * r) + 0.5);
      }
    }
    if (fire) break;
  }
  assert.ok(fire, 'a clear hearth is found nearby');
  const nearby = harvesting.resourcesIn(fire.x - 14, fire.y - 12, fire.x + 14, fire.y + 12);
  assert.ok(nearby.some(n => n.kind === 'bush'), 'the campsite remains in the same planted meadow');
  const fireView = { x0: Math.floor(fire.x) - 40, y0: Math.floor(fire.y) - 40, cols: 80, rows: 80 };
  const r = buffer();
  fires.prepare(fireView, 1);
  const draws = nearby.map(node => ({ y: node.y, draw: () => drawResource(r, fireView, node, 1) }));
  draws.push({ y: fire.y, draw: () => fires.draw(r, fireView, fire, 1) });
  draws.sort((a, b) => a.y - b.y);
  new Grass().drawLayered(r, world, fireView, 1, draws);
  for (const c of fire.hearth.filter(c => c.stone && c.dy === 2)) {
    assert.equal(r.glyphAt((40 + c.dy) * r.cols + 40 + c.dx), c.g, 'plants leave the front stone ring visible');
  }
  const nodes = [{ kind: 'grass', x: 0.5, y: 4.5, harvested: false }];
  const placement = new Fires({ resourcesIn: () => nodes });
  assert.equal(placement.add(dryWorld(), 0.5, 0.5), null, 'standing resource grass would cover the hearth');
  nodes[0].harvested = true;
  assert.ok(placement.add(dryWorld(), 0.5, 0.5), 'cut stubble leaves room for a fire');
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

test('sword reactions follow reach and heading, while spins reach all directions', () => {
  const world = dryWorld();
  const fires = new Fires({ windAt: () => 0.3, random: () => 0.5 });
  const fire = fires.add(world, 0.5, 0.5);
  fires.update(20, 20, world);
  const swing = { type: 'swing', x: -14.5, y: 0.5, strength: 1, move: 'a' };
  assert.equal(fires.react(world, swing, { heading: -Math.PI / 2 }), false);
  assert.equal(fires.react(world, { ...swing, x: -100 }, { heading: Math.PI / 2 }), false);
  assert.equal(fires.react(world, swing, { heading: Math.PI / 2 }), true);
  assert.ok(fire.flare > 0 && fire.leanX > 0 && fires.particles.length > 0);
  assert.equal(fires.events[0].cause, 'swing');
  assert.equal(fires.react(world, { ...swing, move: 'spin' }, { heading: -Math.PI / 2 }), true);
  assert.equal(fires.react(world, { type: 'breath', x: 0, y: 0 }), false);
  assert.equal(fires.react(world, { ...swing, x: NaN }), false);
  fires.update(3, 23, world);
  assert.ok(fire.flare < 0.001 && Math.abs(fire.leanX) < 0.001);
  assert.equal(fire.intensity, 1, 'an undisturbed fire settles back into its normal burn');
});

test('running across a fire scatters more embers than walking and detects skipped footfalls', () => {
  const cross = run => {
    const world = dryWorld();
    const fires = new Fires({ windAt: () => 0.3, random: () => 0.5 });
    const fire = fires.add(world, 0.5, 0.5);
    fires.update(20, 20, world);
    const player = { x: 30, y: 0.5, air: 0, run, speed: run ? 5 : 1, runSpeed: 5 };
    assert.equal(fires.pass(world, player, -30, 0.5), true, 'the path hits despite both endpoints lying outside');
    assert.equal(fires.pass(world, player, -30, 0.5), false, 'contacts share a cooldown');
    assert.equal(fires.pass(world, { ...player, air: 0.3 }, -30, 0.5), false);
    assert.equal(fires.pass(world, player, -30, 0.5, 0.3), false);
    assert.equal(fires.pass(world, player, player.x, player.y), false, 'standing still does not stomp');
    return { particles: fires.particles.length, smother: fire.smother };
  };
  const walk = cross(0);
  const run = cross(1);
  assert.ok(run.particles > walk.particles);
  assert.ok(run.smother > walk.smother);
});

test('footsteps stir only the hearth and do not repeat through overlapping body contacts', () => {
  const world = dryWorld();
  const fires = new Fires({ windAt: () => 0.3 });
  const fire = fires.add(world, 0.5, 0.5);
  fires.update(20, 20, world);
  assert.equal(fires.react(world, { type: 'step', x: 8.5, y: 0.5, strength: 0.3 }), false);
  assert.equal(fires.react(world, { type: 'step', x: 0.5, y: 3, strength: 0.3 }), false);
  assert.equal(fires.react(world, { type: 'step', x: 0.5, y: 0.5, strength: 0.3 }, {air: 0.2}), false);
  assert.equal(fires.react(world, { type: 'step', x: 0.5, y: 0.5, strength: 0.3 }), true);
  assert.equal(fires.react(world, { type: 'skid', x: 0.5, y: 0.5, strength: 1 }), false);
  assert.equal(fires.events.length, 1);
  fires.update(0.3, 20.3, world);
  assert.equal(fires.react(world, { type: 'skid', x: 0.5, y: 0.5, strength: 1 }), true);
  assert.ok(fire.smother > 0);
});

test('heavy landings smother weak fires, and sword impacts can extinguish a full blaze', () => {
  const world = grassWorld();
  const fires = new Fires({ windAt: () => 0.3 });
  const weak = fires.add(world, 0.5, 0.5);
  assert.equal(fires.react(world, { type: 'land', x: weak.x, y: weak.y, strength: 1 }), true);
  assert.equal(fires.list.length, 0);
  assert.equal(fires.events[0].extinguished, true);
  assert.ok(fires.particles.length > 0, 'coals linger after the live fire disappears');
  const { c, i } = world.locate(0, 0);
  assert.equal(c.burnt[i], 255);
  const full = fires.add(world, 0.5, 0.5);
  fires.update(20, 20, world);
  assert.equal(fires.react(world, { type: 'slam', x: full.x, y: full.y, strength: 1 }), true);
  assert.equal(fires.list.length, 0);
  assert.equal(fires.events.at(-1).extinguished, true);
});

test('reaction particles and notices stay bounded, render at clipped edges and expire', () => {
  const world = dryWorld();
  const fires = new Fires({ windAt: () => 0.3 });
  for (let hit = 0; hit < 500; hit++) {
    if (!fires.list.length) fires.add(world, 0.5, 0.5);
    fires.react(world, { type: 'slam', x: 0.5, y: 0.5, strength: 1 });
  }
  assert.ok(fires.particles.length > 0 && fires.particles.length <= MAX_FIRE_PARTICLES);
  assert.ok(fires.events.length <= 64);
  const r = buffer();
  fires.drawParticles(r, { ...view, x0: 0, y0: 0 });
  fires.update(3, 3, world);
  assert.equal(fires.particles.length, 0);
});

test('on raised ground a spark rises from the ground under it', () => {
  const fires = new Fires();
  fires.particles.push({ x: 3.5, y: 20.5, h: 2, life: 1, max: 1, ash: true, g: 0 });
  const rows = [];
  const r = { layer: (_x, y) => rows.push(y) };
  fires.drawParticles(r, { x0: 0, y0: 0 });
  fires.drawParticles(r, { x0: 0, y0: 0 }, (x, y) => (x === 3.5 && y === 20.5 ? 5 : 0));
  assert.deepEqual(rows, [18, 13]);
});

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
