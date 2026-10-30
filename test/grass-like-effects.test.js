import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Ambience } from '../src/world/ambience-fx.js';
import { Dust } from '../src/world/dust.js';
import { ConnectedFire } from '../src/world/fire-spread.js';

// A renderer that records what is put and layered on a 20×20 view.
function recorder() {
  const calls = [];
  return { cols: 20, rows: 20, bg: new Float32Array(20 * 20 * 4).fill(10), calls,
    put: (...args) => calls.push(['put', ...args]), layer: (...args) => calls.push(['layer', ...args]) };
}
const view = { x0: 0, y0: 0, cols: 20, rows: 20 };

test('motes, moths and bats are drawn in view and skipped outside it', () => {
  const ambience = new Ambience();
  ambience.motes = [{ x: 5, y: 6, h: 1, age: 1, life: 4, seed: 2, spore: true },
    { x: 50, y: 6, h: 1, age: 1, life: 4, seed: 3, spore: false }];
  ambience.moths = new Map([['lamp', [{ x: 8, y: 8, seed: 1, near: 0.5, glow: 1 }]]]);
  ambience.bats = [{ x: 10, y: 3, beat: 1.5 }, { x: 0, y: 3, beat: 0 }];
  const r = recorder();
  ambience.draw(r, view, 2);
  // One mote, one moth, a bat of three cells and one cut off at the edge.
  assert.equal(r.calls.filter((c) => c[0] === 'put').length, 5);
  assert.equal(r.calls.filter((c) => c[0] === 'layer').length, 2 + 5);
});

test('sparks streak out from where steel strikes and are drawn by their heading', () => {
  const dust = new Dust();
  dust.sparks(10, 10, 6);
  assert.equal(dust.list.length, 6);
  assert.ok(dust.list.every((p) => p.color[0] === 255 && p.life > 0.2));
  const r = recorder();
  dust.draw(r, view);
  assert.equal(r.calls.length, 6);
});

test('grit kicked up from stone settles and fades in as it lands', () => {
  const dust = new Dust();
  dust.burst({ typeAt: () => 4 }, 10, 10, 3, 1);
  const grit = dust.list.filter((p) => p.mode === 1);
  assert.ok(grit.length > 0);
  for (const p of grit) Object.assign(p, { x: 10, y: 10, h: 0 });
  const r = recorder();
  dust.draw(r, view);
  assert.ok(r.calls.length >= grit.length);
});

test('a fire\'s strength is its hottest node, and its nearest point is the closest fuel', () => {
  const fire = new ConnectedFire({ typeAt: () => 2 }, null, 5, 5, { fuelAt: () => null });
  assert.ok(fire.strength() >= 0);
  assert.deepEqual([fire.nearest(0, 0).x, fire.nearest(0, 0).y], [5, 5]);
  fire.active.clear();
  assert.equal(fire.strength(), 0);
  assert.equal(fire.nearest(0, 0), null);
});
