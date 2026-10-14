import assert from 'node:assert/strict';
import test from 'node:test';
import { AsciiRenderer } from '../src/render/renderer.js';
import { Fires, MAX_FIRES } from '../src/world/fire.js';
import { Lightning, lightningPulse, MAX_BOLTS } from '../src/world/lightning.js';
import { WeatherEffects } from '../src/world/weather.js';
import { GRASS, WATER, World } from '../src/world/world.js';
import { withLayers } from './helpers/renderer.js';

const view = { x0: -40, y0: -30, cols: 100, rows: 80 };
const lake = { typeAt: () => WATER };
const meadow = { typeAt: () => GRASS };
function random(seed = 42) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
function buffer(type = WATER) {
  return withLayers({ cols: view.cols, rows: view.rows,
    fg: new Uint8ClampedArray(view.cols * view.rows * 4),
    bg: new Uint8ClampedArray(view.cols * view.rows * 4),
    mask: new Uint8Array(view.cols * view.rows).fill(type), put: AsciiRenderer.prototype.put });
}

test('lightning makes a branching path from above the view to its fixed ground target', () => {
  const lightning = new Lightning({ random: random() });
  const bolt = lightning.strike(meadow, view, { x: 12.5, y: 35.5, manual: true });
  assert.ok(bolt.cells.some(c => c.branch));
  assert.ok(bolt.cells.some(c => c.x === 12 && c.y === 35 && !c.branch));
  assert.ok(Math.min(...bolt.cells.map(c => c.y)) < view.y0);
  assert.ok(new Set(bolt.cells.filter(c => !c.branch).map(c => c.x)).size > 8);
  assert.ok(bolt.cells.length < 600);
  const cells = JSON.stringify(bolt.cells);
  const r = buffer();
  lightning.draw(r, view);
  assert.ok(r.fg.some(v => v > 210), 'the return stroke has a bright white core');
  assert.ok(r.bg.some(v => v > 20), 'the bolt has a blue glow');
  lightning.update(0.17);
  lightning.draw(r, { ...view, x0: view.x0 + 5 });
  assert.equal(JSON.stringify(bolt.cells), cells, 'pulse and camera movement do not regenerate the shape');
});

test('nearby strikes light the scene and reflect only onto water', () => {
  const lightning = new Lightning({ random: random() });
  lightning.strike(meadow, view, { x: 0.5, y: 0.5 });
  const dry = buffer(GRASS);
  const wet = buffer(WATER);
  lightning.drawSurface(dry, view, 0);
  lightning.drawSurface(wet, view, 0);
  assert.ok(dry.fg.every(v => v === 0));
  assert.ok(wet.fg.some(v => v > 30));
  const glyphs = dry.fg.filter((_, i) => i % 4 === 3);
  lightning.light(dry, view);
  assert.ok(dry.bg.some(v => v > 20));
  assert.deepEqual(dry.fg.filter((_, i) => i % 4 === 3), glyphs, 'light preserves terrain glyphs');
  assert.ok(dry.mask.every(v => v === GRASS));
});

test('lake strikes throw up a plume and clipped rings while dry and distant strikes make no splash', () => {
  const lightning = new Lightning({ random: random() });
  const wet = lightning.strike(lake, view, { x: 0.5, y: 0.5 });
  const dry = lightning.strike(meadow, view, { x: 5.5, y: 0.5 });
  const distant = lightning.strike({ typeAt: () => assert.fail('distant lightning stays in the sky') },
    view, { distant: true });
  assert.ok(wet.splashes.rings.length > 0 && wet.splashes.drops.length > 20);
  assert.equal(dry.splashes.rings.length + dry.splashes.drops.length, 0);
  assert.equal(distant.splashes.rings.length + distant.splashes.drops.length, 0);
  lightning.update(0.4);
  const r = buffer();
  for (let y = 0; y < r.rows; y++) {
    for (let x = 0; x < r.cols; x++) r.mask[y * r.cols + x] = x < r.cols / 2 ? WATER : GRASS;
  }
  lightning.drawSurface(r, view, 0.4);
  assert.ok(r.fg.some(v => v > 0));
  for (let i = 0; i < r.mask.length; i++) {
    if (r.mask[i] !== WATER) assert.ok(r.fg.slice(i * 4, i * 4 + 4).every(v => v === 0));
  }
});

test('manual strikes work in clear weather and at zero intensity without altering the saved selection', () => {
  const weather = new WeatherEffects({ random: random() });
  const settings = { preset: 'clear', intensity: 0 };
  weather.update(1 / 60, 0, lake, view, settings);
  const bolt = weather.summon(lake, view, { x: 0.5, y: 10.5 });
  assert.equal(bolt.manual, true);
  assert.equal(bolt.strength, 1);
  assert.ok(bolt.x > 0.5 && bolt.x < view.x0 + view.cols);
  for (let i = 0; i < 8; i++) weather.update(1 / 60, i / 60, lake, view, settings);
  assert.equal(weather.lightning.bolts[0], bolt);
  assert.ok(weather.flash > 0);
  assert.deepEqual(settings, { preset: 'clear', intensity: 0 });
  const r = buffer();
  weather.drawAtmosphere(r, view, 0.1);
  weather.draw(r, view);
  assert.ok(r.fg.some(v => v > 80));
  for (let i = 0; i < 150; i++) weather.update(1 / 60, i / 60, lake, view, settings);
  assert.equal(weather.lightning.bolts.length, 0);
  assert.equal(weather.flash, 0);
});

test('natural bolts follow intensity, cancel on preset changes and defer to the audio thunder schedule', () => {
  const weather = new WeatherEffects({ random: random() });
  const settings = { preset: 'thunderstorm', intensity: 0.4 };
  weather.update(1 / 60, 0, meadow, view, settings);
  weather._nextFlash = 0;
  weather.update(1 / 60, 0, meadow, view, settings);
  const bolt = weather.lightning.bolts[0];
  assert.equal(bolt.strength, 0.4);
  assert.equal(bolt.manual, false);
  weather.update(1 / 60, 0, meadow, view, { ...settings, intensity: 0 });
  assert.equal(weather.lightning.bolts.length, 0);
  weather._nextFlash = 0;
  weather.update(1 / 60, 0, meadow, view, { ...settings, drivesLightning: true });
  assert.equal(weather.lightning.bolts.length, 0, 'the visual clock does not double the audible thunder events');
  weather.strike(meadow, view, { strength: 0.4, bearing: -0.5 });
  assert.ok(weather.lightning.bolts[0].x < view.x0 + view.cols / 2);
  weather.summon(meadow, view, { x: 0, y: 0 });
  weather.update(1 / 60, 0, meadow, view, { preset: 'rain', intensity: 1 });
  assert.equal(weather.lightning.bolts.length, 1);
  assert.equal(weather.lightning.bolts[0].manual, true);
});

test('repeated summons stay bounded and the double flash and all water effects expire', () => {
  assert.ok(lightningPulse(0.17) > lightningPulse(0.15), 'a weaker second flash follows the first');
  assert.equal(lightningPulse(0.8), 0);
  const lightning = new Lightning({ random: random() });
  for (let i = 0; i < 100; i++) lightning.strike(lake, view, { manual: true });
  assert.equal(lightning.bolts.length, MAX_BOLTS);
  assert.ok(lightning.bolts.every(b => b.cells.length < 600 && b.splashes.rings.length <= 96
    && b.splashes.drops.length <= 240));
  lightning.update(3);
  assert.equal(lightning.bolts.length, 0);
  assert.equal(lightning.flash, 0);
  const paused = lightning.strike(meadow, view);
  for (const dt of [0, -1, NaN, Infinity]) lightning.update(dt);
  assert.equal(paused.age, 0);
});

test('automatic and summoned ground strikes ignite the hit cell and their fires survive the bolt', () => {
  const world = new World(1);
  const fires = new Fires({ windAt: () => 0.3 });
  const weather = new WeatherEffects({ random: random(),
    onImpact: (world, bolt) => fires.ignite(world, bolt.x, bolt.y) });
  const { x, y } = world.spawn;
  const bolt = weather.strike(world, view, { x, y });
  assert.equal(fires.list.length, 1);
  assert.equal(bolt.fire, fires.list[0]);
  assert.deepEqual([bolt.fire.x, bolt.fire.y], [Math.floor(x) + 0.5, Math.floor(y) + 0.5]);
  assert.equal(bolt.fire.kind, 'ground');
  const { c, i } = world.locate(Math.floor(x), Math.floor(y));
  assert.ok(c.burnt[i] > 0, 'the impact scorches the actual grass cell');
  weather.update(0.1, 1, world, view, { preset: 'clear', intensity: 0 });
  assert.equal(weather.lightning.bolts.length, 0);
  assert.equal(fires.list.length, 1, 'clearing a bolt does not extinguish its fire');
  const manual = weather.strike(world, view, { x, y, manual: true });
  assert.equal(manual.fire, bolt.fire, 'a second strike reuses the existing fire');
  assert.equal(fires.list.length, 1);
  const start = manual.fire.intensity;
  fires.update(5, 5, world);
  weather.lightning.update(3);
  assert.equal(weather.lightning.bolts.length, 0);
  assert.ok(fires.list[0].intensity > start, 'the fire continues to grow after the lightning expires');
});

test('water and distant lightning never ignite, and fire ignition happens only once per dry impact', () => {
  const calls = [];
  const lightning = new Lightning({ random: random(), onImpact: (world, bolt) => {
    calls.push({ world, x: bolt.x, y: bolt.y });
    return { id: calls.length };
  } });
  const dry = lightning.strike(meadow, view, { x: 0.5, y: 0.5 });
  assert.equal(calls.length, 1);
  assert.equal(dry.fire.id, 1);
  assert.equal(calls[0].world, meadow);
  const wet = lightning.strike(lake, view, { x: 0.5, y: 0.5 });
  const distant = lightning.strike(meadow, view, { distant: true });
  assert.equal(wet.fire, null);
  assert.equal(distant.fire, null);
  assert.equal(calls.length, 1);
  for (let i = 0; i < 180; i++) lightning.update(1 / 60);
  assert.equal(calls.length, 1, 'afterglow and branch animation cannot repeat ignition');
});

test('repeated lightning respects the fire cap and occupied tiles retain the existing placement rules', () => {
  const world = { seed: 1, typeAt: () => GRASS, isWalkable: () => true, burnGrass() {} };
  const fires = new Fires({ windAt: () => 0.3 });
  const lightning = new Lightning({ random: random(),
    onImpact: (world, bolt) => fires.ignite(world, bolt.x, bolt.y) });
  for (let i = 0; i < 100; i++) lightning.strike(world, view, { x: i * 100 + 0.5, y: 0.5 });
  assert.equal(fires.list.length, MAX_FIRES);
  assert.equal(lightning.bolts.at(-1).fire, null, 'a full fire budget does not allocate more flames');
  const blockedFires = new Fires();
  const blocked = new Lightning({ random: random(),
    onImpact: (world, bolt) => blockedFires.ignite(world, bolt.x, bolt.y) });
  assert.equal(blocked.strike({ ...world, isWalkable: () => false }, view).fire, null);
  assert.equal(blockedFires.list.length, 0);
});
