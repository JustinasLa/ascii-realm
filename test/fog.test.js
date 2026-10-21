import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AMBIENT_FOG, Fog, POCKET, STIRS, WAKE_LIFE } from '../src/world/fog.js';

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

const calm = { preset: 'clear', intensity: 0, wind: 0 };
const marks = (fog) => {
  const s = fog.stirs();
  const out = [];
  for (let i = 0; i < s.length; i += 4) if (s[i + 3] > 0) out.push([...s.slice(i, i + 4)]);
  return out;
};

test('a standing walker clears a full-strength pocket around them', () => {
  const fog = new Fog();
  fog.update(1 / 60, calm, [{ id: 'self', x: 40, y: 20 }]);
  const [pocket, ...rest] = marks(fog);
  assert.equal(rest.length, 0);
  assert.equal(pocket[0], 40);
  assert.ok(pocket[1] < 20, 'centred on the body, above the feet');
  assert.ok(Math.abs(pocket[2] - POCKET) < 1e-6);
  assert.equal(pocket[3], 1);
});

test('walking leaves a wake that weakens and closes up', () => {
  const fog = new Fog();
  let x = 0;
  for (let i = 0; i < 60; i++) {
    x += 0.5;
    fog.update(1 / 30, calm, [{ id: 'self', x, y: 0 }]);
  }
  const wake = marks(fog).slice(1);
  assert.ok(wake.length >= 3);
  assert.ok(wake.every((m) => m[0] < x));
  // Older marks (further behind) are fainter and narrower.
  assert.ok(wake[0][3] < wake.at(-1)[3] && wake[0][2] < wake.at(-1)[2]);
  for (let i = 0; i < 40; i++) fog.update(0.1, calm, [{ id: 'self', x, y: 0 }]);
  assert.equal(fog.wake.length, 0);
  assert.ok(WAKE_LIFE < 4);
});

test('the wake stays within the renderer limit and a teleport leaves no trail', () => {
  const fog = new Fog();
  let x = 0;
  for (let i = 0; i < 200; i++) {
    x += 10;
    fog.update(1 / 60, calm, [{ id: 'self', x, y: 0 }, { id: 'peer', x: -x, y: 5 }]);
  }
  assert.ok(marks(fog).length <= STIRS);
  assert.equal(fog.stirs().length, STIRS * 4);
  const teleported = new Fog();
  teleported.update(1 / 60, calm, [{ id: 'self', x: 0, y: 0 }]);
  teleported.update(1 / 60, calm, [{ id: 'self', x: 5000, y: 300 }]);
  assert.equal(teleported.wake.length, 0);
  teleported.update(1 / 60, calm, [{ id: 'self', x: NaN, y: 0 }]);
  assert.equal(marks(teleported).length, 0);
});
