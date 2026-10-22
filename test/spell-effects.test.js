import assert from 'node:assert/strict';
import test from 'node:test';
import { SpellEffects } from '../src/spells/effects.js';
import healing from '../src/spells/presentations/blessing-of-healing.js';

test('invisible presentation points preserve previously painted cells', () => {
  const effects = new SpellEffects();
  effects.add({ x: 0, y: 0 }, { presentation: { draw(effect, plot) {
    plot(0, 0, '*', [255, 255, 255], 0.7);
    plot(0, 0, '.', [255, 255, 255], 0);
  } } });
  const cells = new Map();
  effects.paint((x, y, char) => cells.set(`${x},${y}`, char));
  assert.equal(cells.get('0,0'), '*');
});

test('a healing aura before its fade-in leaves the scene untouched', () => {
  const effects = new SpellEffects();
  effects.add({ x: 30, y: 30 }, { presentation: healing, stage: 'aura' });
  const writes = [];
  effects.draw({ cols: 60, rows: 60, put: (...args) => writes.push(args) }, { x0: 0, y0: 0 });
  assert.deepEqual(writes, []);
});

test('generic projectile heads and trails share the remaining frame budget', () => {
  const profile = count => ({ draw(effect, plot) {
    for (let i = 0; i < count; i++) plot(0, 0, '*', [255, 255, 255]);
  } });
  for (const remaining of [1, 2, 4]) {
    for (const trailLength of [0, 1, 5]) {
      const effects = new SpellEffects();
      for (let i = 0; i < 15; i++) effects.add({ x: 0, y: 0 }, { presentation: profile(256) });
      effects.add({ x: 0, y: 0 }, { presentation: profile(256 - remaining) });
      const projectiles = Array.from({ length: 8 }, (_, i) => ({
        x: i + 1, y: 0, h: 0, ctx: { spell: { element: 'seithr' } },
        trail: Array.from({ length: trailLength }, () => ({ x: 0, y: 0 })),
      }));
      const dots = [];
      effects.paint((...point) => dots.push(point), projectiles);
      assert.equal(dots.length, 4096, `remaining=${remaining}, trail=${trailLength}`);
      assert.ok(dots.some(point => point[2] === '+'), 'reserve room for a projectile head');
    }
  }
});
