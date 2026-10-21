import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AMBIENT_FOG, Fog } from '../src/world/fog.js';

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
