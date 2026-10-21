import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FogWake, REFILL, SWEEP, WAKE_SIZE } from '../src/world/fog-wake.js';
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

// The field works in rows with columns scaled by ASPECT; walkers are given
// in world cells with their feet at y, the body a few rows above.
const sweptNear = (wake, x, y) => wake.clearedAt(x * ASPECT, y - 3);

test('a standing walker sweeps a ragged, not round, patch of fog clear', () => {
  const wake = new FogWake();
  for (let i = 0; i < 60; i++) wake.update(1 / 60, [{ id: 'self', x: 100, y: 50 }]);
  assert.ok(sweptNear(wake, 100, 50) > 0.6);
  assert.equal(sweptNear(wake, 100 + 40 / ASPECT, 50), 0);
  // Where the patch ends differs with direction around the body.
  const reach = (ux, uy) => {
    let d = 0;
    while (d < SWEEP * 3 && wake.clearedAt(100 * ASPECT + ux * d, 47 + uy * d) > 0.3) d += 0.25;
    return d;
  };
  const reaches = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7]].map(([ux, uy]) => reach(ux, uy));
  assert.ok(Math.max(...reaches) - Math.min(...reaches) > 1, `edge varies: ${reaches}`);
});

test('a walker leaves a trail of thinned fog that fills back in', () => {
  const wake = new FogWake();
  let x = 0;
  for (let i = 0; i < 90; i++) {
    x += 0.6;
    wake.update(1 / 30, [{ id: 'self', x, y: 0 }]);
  }
  const behind = sweptNear(wake, x - 15 / ASPECT, 0);
  assert.ok(behind > 0.2, `trail behind: ${behind}`);
  assert.ok(sweptNear(wake, x - 15 / ASPECT, 0) > sweptNear(wake, x - 40 / ASPECT, 0));
  // The swept air was dragged along, so it keeps moving after the walker.
  const centre = (WAKE_SIZE / 2) * WAKE_SIZE + WAKE_SIZE / 2;
  assert.ok(Math.max(...wake.vx.slice(centre - 20, centre + 20)) > 0);
  // Once everyone has gone, the fog closes up again.
  for (let i = 0; i < 50 * REFILL; i++) wake.update(0.1, []);
  assert.ok(Math.max(...wake.bytes) < 3);
});

test('the field follows the player in whole cells and ignores bad input', () => {
  const wake = new FogWake();
  wake.update(1 / 60, [{ id: 'self', x: 0, y: 0 }]);
  const ox = wake.ox;
  wake.update(1 / 60, [{ id: 'self', x: 3, y: 0 }]);
  assert.equal(wake.ox, ox, 'small steps do not move the field');
  wake.update(1 / 60, [{ id: 'self', x: 200, y: 400 }]);
  assert.ok(Number.isInteger(wake.ox) && Number.isInteger(wake.oy));
  assert.ok(Math.abs(wake.ox + WAKE_SIZE / 2 - 200 * ASPECT) <= 1);
  wake.update(NaN, [{ id: 'self', x: NaN, y: 0 }, null]);
  wake.update(1 / 60, [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 1, y: 1 }, { id: 'c', x: 2, y: 2 },
    { id: 'd', x: 3, y: 3 }, { id: 'e', x: 4, y: 4 }]);
  assert.ok(wake.tracks.size <= 4);
  assert.ok(wake.bytes.every((v) => Number.isFinite(v)));
  assert.equal(new FogWake().clearedAt(0, 0), 0);
});
