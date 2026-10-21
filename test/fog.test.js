import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fbm, fogAt, noise, NOISE, NOISE_SIZE } from '../src/world/fog-banks.js';
import { CELL, FogWake, REFILL } from '../src/world/fog-wake.js';
import { AMBIENT_FOG, Fog } from '../src/world/fog.js';
import { ASPECT } from '../src/world/world.js';

const view = { x0: 12, y0: -40, cols: 80, rows: 40 };

test('a thin mist lies over the land in clear weather', () => {
  const fog = new Fog();
  fog.update(1 / 60, { preset: 'clear', intensity: 0, wind: 0 });
  const u = fog.uniforms(view);
  assert.ok(Math.abs(u.density - AMBIENT_FOG.density) < 1e-9);
  assert.equal(u.x0, 12);
  assert.equal(u.y0, -40);
});

test('the fog preset rolls in thicker, wider banks gradually', () => {
  const fog = new Fog();
  const thick = Fog.target('fog', 1);
  assert.ok(thick.density > AMBIENT_FOG.density && thick.coverage > AMBIENT_FOG.coverage);
  fog.update(0.1, { preset: 'fog', intensity: 1, wind: 0 });
  assert.ok(fog.density > AMBIENT_FOG.density && fog.density < thick.density - 0.1, 'no sudden jump');
  for (let i = 0; i < 600; i++) fog.update(0.1, { preset: 'fog', intensity: 1, wind: 0 });
  assert.ok(Math.abs(fog.density - thick.density) < 1e-3);
  assert.ok(Math.abs(fog.coverage - thick.coverage) < 1e-3);
  assert.deepEqual(Fog.target('fog', 0), Fog.target('clear', 1));
});

test('banks creep on their own and faster with wind, without jumping on long frames', () => {
  const calm = new Fog();
  const windy = new Fog();
  for (let i = 0; i < 60; i++) {
    calm.update(1 / 60, { preset: 'clear', intensity: 0, wind: 0 });
    windy.update(1 / 60, { preset: 'gale', intensity: 1, wind: 0.8 });
  }
  assert.ok(calm.driftX > 0);
  assert.ok(windy.driftX > calm.driftX * 3);
  const before = calm.driftX;
  calm.update(30, { preset: 'clear', intensity: 0, wind: 0 });
  calm.update(NaN, { preset: 'clear', intensity: 0, wind: NaN });
  assert.ok(calm.driftX - before < 0.2);
  assert.ok(Number.isFinite(calm.driftX) && Number.isFinite(calm.time));
});

test('disabled fog is drawn clear', () => {
  const fog = new Fog();
  fog.enabled = false;
  assert.equal(fog.uniforms(view).density, 0);
});

// Walkers are given in world cells with their feet at y; the field works in
// rows with columns scaled by ASPECT, the body a few rows above the feet.
const still = { driftX: 0, driftY: 0, time: 0, coverage: 1 };
const even = () => new FogWake({ banks: () => 0.6 });
const body = (wake, x, y) => wake.fogAt(x * ASPECT, y - 3);

test('walking through fog pushes it aside without losing any', () => {
  const wake = even();
  let x = 100;
  wake.update(1 / 60, [{ id: 'self', x, y: 50 }], still);
  const before = wake.total();
  for (let i = 0; i < 120; i++) {
    x += 0.25;
    wake.update(1 / 60, [{ id: 'self', x, y: 50 }], still);
  }
  assert.ok(Math.abs(wake.total() - before) < before * 0.005, `${before} -> ${wake.total()}`);
  assert.ok(body(wake, x, 50) < 0.15, 'the walker is in a gap');
  assert.ok(Math.max(...wake.fog) > 1, 'the fog they moved piled up nearby');
});

test('standing still only nudges the fog, and pushed fog settles back', () => {
  const standing = even();
  for (let i = 0; i < 120; i++) standing.update(1 / 60, [{ id: 'self', x: 100, y: 50 }], still);
  const walking = even();
  let x = 100;
  for (let i = 0; i < 120; i++) {
    x += 0.25;
    walking.update(1 / 60, [{ id: 'self', x, y: 50 }], still);
  }
  assert.ok(body(standing, 100, 50) > 2 * body(walking, x, 50));
  for (let i = 0; i < 40 * REFILL; i++) walking.update(0.1, [], still);
  assert.ok(walking.fog.every((v) => Math.abs(v - 0.6) < 0.02));
});

test('the field follows the player in whole cells and ignores bad input', () => {
  const wake = even();
  wake.update(1 / 60, [{ id: 'self', x: 0, y: 0 }], still);
  const ox = wake.ox;
  wake.update(1 / 60, [{ id: 'self', x: 3, y: 0 }], still);
  assert.equal(wake.ox, ox, 'small steps do not move the field');
  wake.update(1 / 60, [{ id: 'self', x: 200, y: 400 }], still);
  assert.equal(wake.ox % CELL, 0);
  assert.ok(Math.abs(wake.ox + wake.size / 2 - 200 * ASPECT) <= CELL);
  wake.update(NaN, [{ id: 'self', x: NaN, y: 0 }, null], still);
  wake.update(1 / 60, [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 1, y: 1 }, { id: 'c', x: 2, y: 2 },
    { id: 'd', x: 3, y: 3 }, { id: 'e', x: 4, y: 4 }], still);
  assert.ok(wake.tracks.size <= 4);
  assert.ok(wake.texels.every((v) => Number.isFinite(v) && v >= 0));
  assert.equal(even().fogAt(0, 0), null);
});

test('the banks the game reads match the shader noise and stay in range', () => {
  assert.equal(NOISE.length, NOISE_SIZE * NOISE_SIZE);
  // Whole coordinates land exactly on a texel, as the shader's lookup does.
  assert.equal(noise(3, 5), NOISE[5 * NOISE_SIZE + 3] / 255);
  assert.equal(noise(3 + NOISE_SIZE, 5 - NOISE_SIZE), noise(3, 5));
  for (let i = 0; i < 200; i++) {
    const v = fbm(i * 1.37, -i * 0.91);
    assert.ok(v >= 0 && v <= 1);
    const f = fogAt(i * 3.1, i * 1.7, { ...still, coverage: 1 });
    assert.ok(f >= 0 && f <= 1.45);
  }
  assert.equal(fogAt(0, 0, { ...still, coverage: 0 }) <= fogAt(0, 0, still), true);
});
