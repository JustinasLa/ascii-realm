import assert from 'node:assert/strict';
import test from 'node:test';
import { LAYER } from '../src/render/glyphs.js';
import { Ambience, lightsOf, MAX_BATS, MAX_MOTES, MAX_WISPS } from '../src/world/ambience-fx.js';
import { Dust, MAX_DUST } from '../src/world/dust.js';
import { flameCell } from '../src/world/fire.js';
import { fireflyFlash } from '../src/world/fireflies.js';
import { bootStamp, Footprints, MAX_PRINTS } from '../src/world/footprints.js';
import { WeatherEffects } from '../src/world/weather.js';
import { DIRT, GRASS, WATER } from '../src/world/world.js';
import { withLayers } from './helpers/renderer.js';

const view = { x0: 0, y0: 0, cols: 80, rows: 50 };
function buffer(type = GRASS) {
  const r = withLayers({ cols: view.cols, rows: view.rows, mask: new Uint8Array(view.cols * view.rows).fill(type) });
  for (let i = 0; i < r.cols * r.rows; i++) {
    r.putAt(i, 7, 60, 90, 60);
    r.bg.set([20, 24, 30], i * 4);
  }
  return r;
}
const baseGlyphs = (r) => Array.from({ length: r.cols * r.rows }, (_, i) => r.glyphAt(i));
function random(seed = 7) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

test('fireflies signal in flashes with dark gaps on their own rhythm', () => {
  const fly = { phase: 0, period: 3, double: true };
  const samples = Array.from({ length: 300 }, (_, i) => fireflyFlash(fly, i / 100));
  assert.ok(samples.every((b) => b >= 0 && b <= 1));
  assert.ok(Math.max(...samples) > 0.95, 'a flash reaches full brightness');
  assert.ok(samples.filter((b) => b === 0).length > 100, 'most of the period is dark');
  assert.equal(fireflyFlash(fly, 0.5), fireflyFlash(fly, 3.5), 'the rhythm repeats every period');
});

test('boot prints turn with the walker, layer over dirt only and stay bounded', () => {
  assert.equal(bootStamp(0), 0);
  assert.equal(bootStamp(Math.PI / 2), 2);
  assert.equal(bootStamp(-Math.PI / 2), 6);
  assert.equal(bootStamp(Math.PI * 2), 0);
  const dirt = { typeAt: () => DIRT };
  const prints = new Footprints();
  prints.add({ typeAt: () => GRASS }, 10, 10, 0, 0);
  assert.equal(prints.list.length, 0, 'no prints in the meadow');
  for (let i = 0; i < MAX_PRINTS + 30; i++) prints.add(dirt, 40, 25, 0, 0);
  assert.equal(prints.list.length, MAX_PRINTS);
  // Without a heading the print follows the line of travel.
  const walker = new Footprints();
  walker.add(dirt, 10, 20, 0, 0);
  walker.add(dirt, 25, 20, 0);
  assert.equal(walker.list[1].stamp, 2);

  const r = buffer(DIRT);
  const before = baseGlyphs(r);
  const one = new Footprints();
  one.add(dirt, 40.5, 25.5, 0, Math.PI / 2);
  one.draw(r, view, 1);
  const marked = [...Array(r.cols * r.rows).keys()].filter((i) => r.hasLayer(i));
  const changed = before.filter((g, i) => r.glyphAt(i) !== g).length;
  assert.ok(changed < marked.length, 'outside the pressed rim the ground glyph stays under the print');
  assert.ok(marked.length >= 3, 'a sideways boot spans several cells');
  assert.ok(marked.every((i) => Math.abs((i % r.cols) - 40) <= 4 && Math.abs(Math.floor(i / r.cols) - 25) <= 2));
});

test('flames build a body with a white heart inside and loose licks at the edge', () => {
  const hot = [];
  flameCell(hot, 0, 0, 0.9, 0.9, 0.9, 0.9, 0, 0, false, 0.3, 1);
  assert.equal(hot.length, 2);
  assert.equal(hot[0].g & LAYER, 0, 'the body replaces the cell');
  assert.ok(hot[1].g & LAYER, 'the core is layered over it');
  assert.ok(hot[1].gg > 230 && hot[1].b > 180, 'the heart is near white');
  const edge = [];
  flameCell(edge, 3, 0, 0.22, 0, 0, 0, 2, 2, false, 0.3, 1);
  assert.equal(edge.length, 1);
  assert.ok(edge[0].g & LAYER, 'the fringe is layered over the scene behind');
  assert.ok(edge[0].gg < hot[1].gg, 'cooler than the heart');
});

test('dust stays bounded and grit settles on bare ground', () => {
  const dust = new Dust();
  const dirt = { typeAt: () => DIRT };
  for (let i = 0; i < 40; i++) dust.burst(dirt, 10, 10, 20, 12);
  assert.ok(dust.list.length <= MAX_DUST);
  assert.ok(dust.list.some((p) => p.bounce), 'pebbles skip out of a heavy burst');
  for (let i = 0; i < 30; i++) dust.update(1 / 30);
  assert.ok(dust.list.every((p) => p.h >= 0));
  const r = buffer(DIRT);
  const before = baseGlyphs(r);
  const puff = new Dust();
  puff.breath(40, 25, 3, 1, 0);
  puff.list.length = 1;
  puff.draw(r, view);
  assert.deepEqual(baseGlyphs(r), before, 'a lone mote layers over the ground');
  assert.equal([...Array(r.cols * r.rows).keys()].filter((i) => r.hasLayer(i)).length, 1);
});

test('ambient life stays bounded, gathers at flames and never wipes layered detail', () => {
  const ambience = new Ambience({ random: random() });
  const lake = { typeAt: (x) => (x < 40 ? WATER : GRASS) };
  const fires = [{ id: 1, x: 60, y: 30, intensity: 1 }];
  const torches = [{ id: 'torch-held', x: 20, y: 30, flameX: 1, flameH: 8 }];
  const lights = lightsOf(fires, torches);
  assert.equal(lights.length, 2);
  assert.equal(lights[1].x, 21);
  const big = { x0: 0, y0: 0, cols: 400, rows: 200 };
  for (let i = 0; i < 600; i++) ambience.update(1 / 20, i / 20, lake, big, { lights, wind: 0.2 });
  assert.ok(ambience.motes.length <= MAX_MOTES);
  assert.ok(ambience.bats.length <= MAX_BATS);
  assert.ok(ambience.wisps.length <= MAX_WISPS && ambience.wisps.length > 0);
  assert.equal(ambience.moths.size, 2);
  for (const swarm of ambience.moths.values()) {
    assert.ok(swarm.every((m) => Math.abs(m.x - swarm[0].x) < 30 && Math.abs(m.y - swarm[0].y) < 15));
  }
  ambience.update(1 / 20, 31, lake, big, { lights: [] });
  assert.equal(ambience.moths.size, 0, 'moths leave with the flame');

  const r = buffer(WATER);
  r.layerAt(5, 9, 200, 200, 200);
  const before = baseGlyphs(r);
  ambience.wisps = [{ x: 10, y: 5, len: 8, rows: 3, seed: 3, age: 10, life: 40, vx: 0 }];
  ambience.drawMist(r, view, 1);
  assert.deepEqual(baseGlyphs(r), before, 'mist veils the scene without replacing it');
  assert.equal(r.ov[5 * 4 + 3], 9, 'a layered glyph keeps its place under mist');
  assert.ok(r.bg[(5 * r.cols + 10) * 4] > 20, 'the mist lightens the ground');
});

test('rain bursts on dry ground, snow settles, and both clear with the weather', () => {
  const weather = new WeatherEffects({ random: random(3) });
  const meadow = { typeAt: () => GRASS };
  const settings = { preset: 'heavy-rain', intensity: 1 };
  for (let i = 0; i < 120; i++) weather.update(1 / 30, i / 30, meadow, view, settings);
  assert.ok(weather.crowns.length > 0 && weather.crowns.length <= 160);
  const r = buffer();
  const before = baseGlyphs(r);
  weather.draw(r, view);
  const layered = [...Array(r.cols * r.rows).keys()].filter((i) => r.hasLayer(i)).length;
  const replaced = before.filter((g, i) => r.glyphAt(i) !== g).length;
  assert.ok(layered > 50 && replaced < layered / 2, 'rain streaks layer over the scene');
  for (let i = 0; i < 300; i++) weather.update(1 / 30, 4 + i / 30, meadow, view, { preset: 'blizzard', intensity: 1 });
  assert.equal(weather.crowns.length, 0);
  assert.ok(weather.settled.length > 0 && weather.settled.length <= 420);
  weather.update(1 / 30, 20, meadow, view, { preset: 'clear', intensity: 1 });
  assert.equal(weather.settled.length, 0);
});
