import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fbm, fogAt, noise, NOISE, NOISE_SIZE } from '../src/world/fog-banks.js';
import { CELL_SIZES, FogWake, MAX_CELLS, MAX_WALKERS, REFILL } from '../src/world/fog-wake.js';
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

test('the field covers the whole view and its margin, coarser when zoomed out', () => {
  for (const [w, h] of [[161, 91], [286, 161], [430, 242], [2000, 1000]]) {
    const wake = even();
    const area = { x: 1000.3, y: -500.7, w, h };
    wake.update(1 / 60, [], still, {}, area);
    assert.ok(wake.w * wake.h <= MAX_CELLS || wake.cell === CELL_SIZES.at(-1));
    assert.equal(wake.ox % wake.cell, 0);
    if (wake.cell === CELL_SIZES.at(-1) && wake.w * wake.h > MAX_CELLS) continue;
    // Several cells of margin beyond every edge, where the fade lies.
    assert.ok(wake.ox <= area.x - 5 * wake.cell && wake.oy <= area.y - 5 * wake.cell, `${w}x${h}`);
    assert.ok(wake.ox + wake.width >= area.x + area.w + 5 * wake.cell);
    assert.ok(wake.oy + wake.height >= area.y + area.h + 5 * wake.cell);
  }
  const close = even();
  close.update(1 / 60, [], still, {}, { x: 0, y: 0, w: 161, h: 91 });
  assert.equal(close.cell, CELL_SIZES[0], 'the usual view keeps the finest cells');
});

test('a monster far from the player but on screen still pushes the fog', () => {
  const wake = even();
  const area = { x: 0, y: 0, w: 161, h: 91 };
  // The player stands at the left of the view; a troll strides at the right.
  let x = 230;
  for (let i = 0; i < 60; i++) {
    x += 0.4;
    wake.update(1 / 60, [{ id: 'self', x: 20, y: 45 }, { id: 'troll', x, y: 50, size: 1.45 }], still, {}, area);
  }
  assert.ok(wake.fogAt(x * ASPECT, 46) < 0.3, `fog at the troll: ${wake.fogAt(x * ASPECT, 46)}`);
});

test('panning with a sprinting player shifts the field a cell at a time without jumps', () => {
  const wake = even();
  // What the renderer is given at a point of the ground.
  const shown = (gx, gy) => {
    const i = Math.floor((gx - wake.ox) / wake.cell);
    const j = Math.floor((gy - wake.oy) / wake.cell);
    return wake.texels[(j * wake.w + i) * 2];
  };
  let x = 0;
  let last = null;
  let biggest = 0;
  for (let i = 0; i < 240; i++) {
    x += 0.9;
    const area = { x: x * ASPECT - 80, y: 0, w: 161, h: 91 };
    const ox = wake.ox;
    wake.update(1 / 60, [{ id: 'self', x, y: 48 }], still, {}, area);
    if (!Number.isNaN(ox)) assert.ok(Math.abs(wake.ox - ox) <= wake.cell, 'never more than a cell a frame');
    // A point on the trail the player passed before i = 107, which stays
    // inside the view to the end.
    if (i >= 120) {
      const now = shown(58, 45);
      if (last !== null) biggest = Math.max(biggest, Math.abs(now - last));
      last = now;
    }
  }
  assert.ok(biggest < 0.06, `largest jump between frames: ${biggest}`);
  assert.ok(wake.fogAt(58, 45) < 0.55, 'the trail behind the sprinter is still there');
});

test('the field ignores bad input', () => {
  const wake = even();
  wake.update(1 / 60, [{ id: 'self', x: 0, y: 0 }], still);
  wake.update(1 / 60, [{ id: 'self', x: 0, y: 0 }], still, {}, { x: NaN, y: 0, w: -4, h: 9 });
  assert.ok(wake.w > 0 && Number.isFinite(wake.ox));
  wake.update(NaN, [{ id: 'self', x: NaN, y: 0 }, null], still);
  wake.update(1 / 60, [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 1, y: 1 }, { id: 'c', x: 2, y: 2 },
    { id: 'd', x: 3, y: 3 }, { id: 'e', x: 4, y: 4 }], still);
  assert.ok(wake.tracks.size <= MAX_WALKERS);
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

test('monsters push the fog too, bigger ones over a wider patch', () => {
  const pushed = (size) => {
    const wake = even();
    // The player stands still well off to one side, inside the field.
    let x = 100;
    for (let i = 0; i < 90; i++) {
      x += 0.25;
      wake.update(1 / 60, [{ id: 'self', x: 100, y: 20 }, { id: 'troll', x, y: 60, size }], still);
    }
    // Only count the monster's half of the field.
    wake.fog.fill(0.6, 0, wake.w * Math.floor(wake.h / 2));
    let thinned = 0;
    for (const v of wake.fog) if (v < 0.3) thinned++;
    return thinned;
  };
  assert.ok(pushed(1) > 0, 'a monster walking through the fog parts it');
  assert.ok(pushed(1.45) > pushed(0.62) * 1.5);
  const crowd = even();
  const many = Array.from({ length: MAX_WALKERS + 5 }, (_, i) => ({ id: i, x: i * 4, y: 50 }));
  crowd.update(1 / 60, many, still);
  assert.equal(crowd.tracks.size, MAX_WALKERS);
});

test('fog covers about a quarter of the ground in clear weather and half in full fog', () => {
  // The banks the game draws, sampled over a wide stretch of ground.
  const measure = ({ density, coverage }) => {
    let sum = 0;
    let covered = 0;
    let n = 0;
    for (let gy = 0; gy < 1600; gy += 8) {
      for (let gx = 0; gx < 1600; gx += 8) {
        const f = fogAt(gx, gy, { ...still, coverage }) * density;
        sum += f;
        if (f > 0.1) covered++;
        n++;
      }
    }
    return { amount: sum / n, covered: covered / n };
  };
  const clear = measure(Fog.target('clear', 0));
  const full = measure(Fog.target('fog', 1));
  // Half of what each used to be (0.181 and 0.600 on average).
  assert.ok(Math.abs(clear.amount - 0.0905) < 0.01, `clear ${clear.amount}`);
  assert.ok(Math.abs(full.amount - 0.300) < 0.02, `full ${full.amount}`);
  assert.ok(clear.covered > 0.2 && clear.covered < 0.35, `clear covers ${clear.covered}`);
  assert.ok(full.covered > 0.45 && full.covered < 0.6, `full covers ${full.covered}`);
});
