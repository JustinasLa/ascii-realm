import assert from 'node:assert/strict';
import test from 'node:test';
import { GLOW_BUDGET, paintPresentation } from '../src/spells/presentation.js';
import { SpellEffects } from '../src/spells/effects.js';
import { AsciiRenderer } from '../src/render/renderer.js';
import { glyph } from '../src/render/glyphs.js';
import { toCells } from '../src/entities/monsters.js';

// Profiles may light the ground through an optional third `glow` argument;
// following effects carry a stable seed and a smoothed drift.

function renderer(cols = 80, rows = 40) {
  const r = Object.create(AsciiRenderer.prototype);
  r.allocate(cols, rows);
  r.clear(10, 12, 10);
  return r;
}
const glowing = (calls, extra = {}) => ({ duration: 1, ...extra, draw(effect, plot, glow) {
  for (const call of calls) glow(...call);
} });

test('glow calls are rotated like plot, bounded, clamped and capped per effect', () => {
  const lights = [], dots = [];
  const profile = { duration: 1, draw(effect, plot, glow) {
    plot(1, 0.5, '*', [255, 200, 100]);
    glow(1, 0.5, 0.5, 0.5);
    glow(NaN, 0, 1); glow(0, Infinity, 1); glow(60, 0, 1); glow(0, 0, NaN); glow(0, 0, 0.005);
    glow(0, 0, 5, 99); glow(0, 0, -5, 0.01); glow(0, 0, 0.3);
    for (let i = 0; i < 100; i++) glow(0, 0, 0.2, 1);
  } };
  paintPresentation(profile, { x: 10, y: 20, stage: 'zone', heading: 2.1 }, (...p) => dots.push(p), 256,
    (...l) => lights.push(l));
  assert.equal(lights.length, GLOW_BUDGET);
  assert.equal(GLOW_BUDGET, 32);
  assert.ok(Math.abs(lights[0][0] - dots[0][0]) < 1e-9 && Math.abs(lights[0][1] - dots[0][1]) < 1e-9, 'same rotation as plot');
  assert.deepEqual(lights[0].slice(2), [0.5, 0.5]);
  assert.deepEqual(lights[1].slice(2), [1, 3], 'k and reach are clamped');
  assert.deepEqual(lights[2].slice(2), [-1, 0.2]);
  assert.deepEqual(lights[3].slice(2), [0.3, 1], 'reach defaults to a metre');
  // Without a light sink the glow is a no-op, and older two-argument profiles are untouched.
  assert.doesNotThrow(() => paintPresentation(profile, { x: 0, y: 0 }, () => {}));
});

test('one frame allows 128 glow calls across all effects; the arena paints without light', () => {
  const effects = new SpellEffects();
  for (let i = 0; i < 6; i++) effects.add({ x: i, y: 0 }, { presentation: glowing(Array.from({ length: 32 }, () => [0, 0, 0.5, 1])) });
  const lights = [];
  effects.paint(() => {}, [], (...l) => lights.push(l));
  assert.equal(lights.length, 128);
  assert.equal(lights[0][4], effects.list[0], 'the sink learns which effect lit the ground');
  assert.doesNotThrow(() => effects.paint(() => {}));
});

test('warm glow lights a cell without changing its glyph; negative glow shades it', () => {
  const effects = new SpellEffects();
  effects.add({ x: 40, y: 20 }, { presentation: glowing([[0, 0, 1, 0.5]]), seed: 3 });
  const r = renderer(), cell = (20 * r.cols + 40) * 4;
  r.put(40, 20, glyph('|'), 40, 90, 30);
  const before = [r.fg[cell], r.ov[cell], r.bg[cell], r.fg[cell + 3]];
  effects.draw(r, { x0: 0, y0: 0 });
  assert.ok(r.fg[cell] > before[0] && r.ov[cell] > before[1] && r.bg[cell] > before[2], 'fg, ov and bg rise');
  assert.equal(r.fg[cell + 3], before[3], 'the grass blade stays');

  const dark = new SpellEffects();
  dark.add({ x: 40, y: 20 }, { presentation: glowing([[0, 0, -0.8, 0.5]]) });
  const s = renderer();
  s.put(40, 20, glyph('|'), 40, 90, 30);
  s.put(79, 39, glyph('|'), 40, 90, 30);
  dark.draw(s, { x0: 0, y0: 0 });
  assert.ok(s.fg[cell + 1] < 90 * 0.5, 'the middle is darkened');
  assert.equal(s.fg[cell + 3], glyph('|') & 255);
  assert.equal(s.fg[(39 * s.cols + 79) * 4 + 1], 90, 'far cells are untouched');
  // A shade disc at the screen edge stays inside the buffer.
  const edge = new SpellEffects();
  edge.add({ x: 0, y: 0 }, { presentation: glowing([[0, 0, -1, 3]]) });
  assert.doesNotThrow(() => edge.draw(renderer(), { x0: 0, y0: 0 }));
});

test('scenery-keeping profiles never cover fine-grid letters; other profiles still do', () => {
  const r = renderer(20, 10), cell = 5 * r.cols + 10;
  r.fineAt(10 * 2, 5 * 2, glyph('@'), 200, 180, 160, 10, 12, 20);
  assert.equal(r.hasFineGlyph(cell), true);
  const plotAt = keep => ({ keepScenery: keep, draw(effect, plot) { plot(0, 0, 'o', [255, 160, 40]); } });
  const keep = new SpellEffects();
  keep.add({ x: 10, y: 5 }, { presentation: plotAt(true) });
  keep.draw(r, { x0: 0, y0: 0 });
  assert.notEqual(r.fg[cell * 4 + 3], glyph('o') & 255, 'the flame passes behind the tree');
  const cover = new SpellEffects();
  cover.add({ x: 10, y: 5 }, { presentation: plotAt(false) });
  cover.draw(r, { x0: 0, y0: 0 });
  assert.equal(r.fg[cell * 4 + 3], glyph('o') & 255);
  // Arena output receives the flag only for profiles that ask for it.
  const args = [];
  keep.paint((...p) => args.push(p));
  assert.equal(args[0][5], true);
});

test('following effects keep their seed and learn a smoothed, capped velocity', () => {
  const effects = new SpellEffects(), walker = { x: 0, y: 0 }, still = { x: 0, y: 0 };
  effects.add(walker, { follow: walker, seed: 42, life: 10 });
  effects.add(still, { seed: 7, life: 10 });
  const [moving, fixed] = effects.list;
  for (let t = 0; t < 0.5; t += 0.025) {
    const [dx, dy] = toCells(4 * 0.025, -2 * 0.025);
    walker.x += dx; walker.y += dy;
    effects.update(0.025);
  }
  assert.equal(moving.seed, 42);
  assert.ok(Math.abs(moving.vx - 4) < 0.4 && Math.abs(moving.vy + 2) < 0.2, `${moving.vx}, ${moving.vy}`);
  assert.equal(moving.x, walker.x);
  assert.deepEqual([fixed.vx, fixed.vy], [0, 0]);
  walker.x += toCells(100, 0)[0];
  effects.update(0.025);
  assert.ok(Math.hypot(moving.vx, moving.vy) <= 12 + 1e-9, 'a teleport is capped');
  effects.add({ x: 0, y: 0 }, { seed: NaN });
  assert.equal(effects.list.at(-1).seed, 0);
});
