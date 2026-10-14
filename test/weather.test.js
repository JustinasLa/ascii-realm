import assert from 'node:assert/strict';
import test from 'node:test';
import { WeatherAudio } from '../src/audio/weather.js';
import { WEATHER_PRESETS } from '../src/audio/weather/presets.js';
import { AsciiRenderer } from '../src/render/renderer.js';
import { Splashes } from '../src/world/splashes.js';
import { WeatherEffects, WEATHER_EFFECTS } from '../src/world/weather.js';
import { GRASS, WATER } from '../src/world/world.js';
import { withLayers } from './helpers/renderer.js';

const view = { x0: -40, y0: -30, cols: 100, rows: 70 };
const lake = { typeAt: () => WATER };
const meadow = { typeAt: () => GRASS };
const dt = 1 / 60;

function random(seed = 42) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

const effects = () => new WeatherEffects({ random: random() });
function advance(weather, settings, world = lake, frames = 120, area = view) {
  for (let i = 0; i < frames; i++) weather.update(dt, i * dt, world, area, settings);
}

function buffer(area = view) {
  const { cols, rows } = area;
  return withLayers({ cols, rows, fg: new Uint8ClampedArray(cols * rows * 4),
    bg: new Uint8ClampedArray(cols * rows * 4), mask: new Uint8Array(cols * rows).fill(WATER),
    put: AsciiRenderer.prototype.put });
}

test('every selectable weather has matching visual effects that render without changing terrain masks', () => {
  assert.deepEqual(Object.keys(WEATHER_EFFECTS).sort(), ['clear', ...WEATHER_PRESETS.map(p => p.id)].sort());
  for (const preset of WEATHER_PRESETS) {
    const weather = effects();
    advance(weather, { preset: preset.id, intensity: 0.6 });
    const r = buffer();
    weather.drawSurface(r, view, 2);
    weather.drawAtmosphere(r, view, 2);
    weather.draw(r, view);
    assert.ok(r.fg.some(value => value > 0) || r.bg.some(value => value > 0), preset.id);
    assert.ok(r.mask.every(value => value === WATER), preset.id);
    assert.ok(weather.particles.every(p => [p.x, p.y, p.h, p.fall].every(Number.isFinite)), preset.id);
  }
});

test('saved weather is visible before audio unlock and does not depend on sound volume', () => {
  const engine = { context: null, muted: true, volumes: { master: 0, weather: 0 } };
  const settings = new WeatherAudio(engine, { storage: {
    getItem: () => JSON.stringify({ preset: 'heavy-rain', intensity: 0.8 }),
  } });
  const weather = effects();
  advance(weather, settings);
  assert.equal(engine.context, null);
  assert.equal(weather.preset, 'heavy-rain');
  assert.equal(weather.intensity, 0.8);
  assert.ok(weather.particles.length > 0);
  assert.ok(weather.splashes.rings.length > 0);
});

test('intensity controls density, wind, haze and splash strength, while heavier presets are denser', () => {
  const low = effects();
  const high = effects();
  advance(low, { preset: 'rain', intensity: 0.2 });
  advance(high, { preset: 'rain', intensity: 1 });
  assert.ok(high.particles.length > low.particles.length * 4);
  assert.ok(high.wind > low.wind * 4);
  const lowRing = low.splashes.rings.find(p => p.radius === 0.3);
  const highRing = high.splashes.rings.find(p => p.radius === 0.3);
  assert.ok(highRing.strength > lowRing.strength);
  assert.ok(highRing.speed > lowRing.speed);
  const lowBuffer = buffer();
  const highBuffer = buffer();
  low.drawAtmosphere(lowBuffer, view, 2);
  high.drawAtmosphere(highBuffer, view, 2);
  assert.ok(highBuffer.bg.reduce((a, b) => a + b) > lowBuffer.bg.reduce((a, b) => a + b));
  const drizzle = effects();
  const heavy = effects();
  advance(drizzle, { preset: 'drizzle', intensity: 1 });
  advance(heavy, { preset: 'heavy-rain', intensity: 1 });
  assert.ok(heavy.particles.length > high.particles.length);
  assert.ok(high.particles.length > drizzle.particles.length);
});

test('rain, ice and snow strike water across the view and never splash dry ground', () => {
  for (const preset of ['drizzle', 'rain', 'heavy-rain', 'thunderstorm', 'hail', 'sleet',
    'light-snow', 'snowstorm', 'blizzard', 'ice-storm', 'ocean-storm']) {
    const wet = effects();
    const dry = effects();
    advance(wet, { preset, intensity: 1 }, lake, 240);
    advance(dry, { preset, intensity: 1 }, meadow, 240);
    assert.ok(wet.splashes.rings.length > 0, preset);
    assert.equal(dry.splashes.rings.length + dry.splashes.drops.length, 0, preset);
    if (WEATHER_EFFECTS[preset].kind === 'snow') assert.equal(wet.splashes.drops.length, 0, preset);
    else assert.ok(wet.splashes.drops.length > 0, preset);
  }
});

test('clear and intensity zero immediately clear particles, spray, rings, wind and lightning', () => {
  const weather = effects();
  advance(weather, { preset: 'thunderstorm', intensity: 1 });
  assert.ok(weather.splashes.rings.length > 0);
  weather.flash = 0.18;
  weather.update(dt, 3, lake, view, { preset: 'thunderstorm', intensity: 0 });
  assert.equal(weather.particles.length + weather.splashes.rings.length + weather.splashes.drops.length, 0);
  assert.equal(weather.flash + weather.wind, 0);
  const r = buffer();
  weather.drawSurface(r, view, 3);
  weather.drawAtmosphere(r, view, 3);
  weather.draw(r, view);
  assert.ok(r.fg.every(value => value === 0) && r.bg.every(value => value === 0));
  advance(weather, { preset: 'heavy-rain', intensity: 1 });
  weather.update(dt, 3, lake, view, { preset: 'clear', intensity: 1 });
  assert.equal(weather.particles.length + weather.splashes.rings.length + weather.splashes.drops.length, 0);
  assert.equal(weather.wind, 0);
});

test('switching from rain to fog or dry wind discards precipitation and makes no terrain queries', () => {
  const world = { typeAt: () => assert.fail('dry weather must not sample impacts') };
  const weather = effects();
  advance(weather, { preset: 'rain', intensity: 1 });
  for (const preset of ['fog', 'wind-gusts', 'gale', 'forest-squall', 'sandstorm', 'distant-thunder']) {
    advance(weather, { preset, intensity: 1 }, world);
    assert.equal(weather.splashes.rings.length + weather.splashes.drops.length, 0, preset);
  }
});

test('weather rings remain anchored in world space and clip to the lake across a shoreline', () => {
  const area = { x0: 0, y0: 0, cols: 24, rows: 16 };
  const r = buffer(area);
  for (let y = 0; y < r.rows; y++) {
    for (let x = 0; x < r.cols; x++) r.mask[y * r.cols + x] = x < 12 ? WATER : GRASS;
  }
  const weather = effects();
  weather.splashes.precipitate(lake, 11.5, 8.5, 1, 'hail', random());
  weather.splashes.update(0.3);
  const ring = { ...weather.splashes.rings[0] };
  weather.drawSurface(r, { ...area, x0: 1 }, 0.3);
  assert.deepEqual(weather.splashes.rings[0], ring, 'drawing from a shifted camera never moves the ring');
  assert.ok(r.fg.some(value => value > 0));
  for (let i = 0; i < r.mask.length; i++) {
    if (r.mask[i] !== WATER) assert.ok(r.fg.slice(i * 4, i * 4 + 4).every(value => value === 0));
  }
});

test('fog drifts without changing scene glyphs and lightning respects intensity and preset switches', () => {
  const weather = effects();
  weather.update(dt, 0, lake, view, { preset: 'fog', intensity: 0.6 });
  const r = buffer();
  r.fg.fill(60);
  const first = buffer();
  first.fg.fill(60);
  weather.drawAtmosphere(first, view, 0);
  weather.drawAtmosphere(r, view, 6);
  assert.notDeepEqual(r.bg, first.bg);
  assert.ok(r.fg.filter((_, i) => i % 4 === 3).every(value => value === 60));
  weather.update(dt, 7, lake, view, { preset: 'thunderstorm', intensity: 0.4 });
  weather._nextFlash = 0;
  weather.update(dt, 7, lake, view, { preset: 'thunderstorm', intensity: 0.4 });
  assert.ok(weather.flash > 0 && weather.flash < 0.1);
  weather.update(dt, 7, lake, view, { preset: 'rain', intensity: 1 });
  assert.equal(weather.flash, 0);
});

test('long frame gaps, large views and camera jumps keep all weather allocations bounded', () => {
  const weather = effects();
  const huge = { ...view, cols: 1500, rows: 800 };
  advance(weather, { preset: 'heavy-rain', intensity: 1 }, lake, 300, huge);
  assert.ok(weather.particles.length <= 1200);
  assert.ok(weather.splashes.rings.length <= 96);
  assert.ok(weather.splashes.drops.length <= 240);
  const moved = { ...view, x0: 3000, y0: -3000 };
  weather.update(3600, 3600, lake, moved, { preset: 'heavy-rain', intensity: 1 });
  assert.ok(weather.particles.every(p => p.x >= moved.x0 && p.x <= moved.x0 + moved.cols));
  assert.ok(weather.particles.length < 1200, 'zooming to a smaller area reduces density');
  weather.update(dt, 3600, lake, view, { preset: 'unknown', intensity: 1 });
  assert.equal(weather.preset, 'clear');
  assert.equal(weather.particles.length, 0);
});

test('weather splash traffic cannot evict player footfall rings, and all impact effects expire', () => {
  const footsteps = new Splashes();
  footsteps.react(lake, { type: 'step', x: 0.5, y: 0.5, strength: 1 });
  const ring = footsteps.rings[0];
  const weather = effects();
  advance(weather, { preset: 'heavy-rain', intensity: 1 }, lake, 300);
  assert.equal(footsteps.rings[0], ring);
  for (let i = 0; i < 180; i++) weather.splashes.update(dt);
  assert.equal(weather.splashes.rings.length + weather.splashes.drops.length, 0);
});
