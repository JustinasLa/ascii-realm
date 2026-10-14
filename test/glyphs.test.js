import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BLOSSOM, BUD, FLAT_GLYPHS, GLYPH_COUNT, GLYPHS, LAYER, MIRRORED, STROKE_STEPS, buildAtlas, dg, flatGlyph,
  glyph, over, strokeGlyph } from '../src/render/glyphs.js';
import { reflector } from '../src/world/reflection.js';
import { WATER } from '../src/world/world.js';
import { withLayers } from './helpers/renderer.js';

const strokes = [];
for (let tip = 0; tip < 3; tip++) {
  for (let b = 0; b < STROKE_STEPS; b++) {
    for (let t = 0; t < STROKE_STEPS; t++) strokes.push(strokeGlyph(b, t, tip));
  }
}

test('stroke glyphs are distinct, follow the font glyphs and flip upside down in reflections', () => {
  const all = [...strokes, ...FLAT_GLYPHS, BLOSSOM, BUD];
  assert.equal(new Set(all).size, all.length);
  assert.ok(Math.min(...all) >= GLYPHS.length && Math.max(...all) < 256, 'one byte still addresses every glyph');
  assert.equal(MIRRORED[strokeGlyph(1, 4)], strokeGlyph(4, 1));
  assert.equal(MIRRORED[strokeGlyph(0, 5, 1)], strokeGlyph(5, 0), 'a mirrored tip hangs down as a plain stroke');
  assert.equal(MIRRORED[glyph('/')], glyph('/'));
  assert.equal(MIRRORED[flatGlyph(0, 2)], flatGlyph(0, 2));
});

test('every drawn glyph is clipped to its own padded atlas cell', (t) => {
  const clips = [];
  const ctx = new Proxy({ measureText: () => ({ width: 60 }), rect: (...args) => clips.push(args) }, {
    get: (target, name) => target[name] ?? (() => {}),
  });
  const canvas = { getContext: () => ctx };
  const original = globalThis.document;
  globalThis.document = { createElement: () => canvas };
  t.after(() => { globalThis.document = original; });
  const atlas = buildAtlas('monospace');
  const packs = Array.from({ length: GLYPH_COUNT - BUD - 1 }, (_, i) => BUD + 1 + i);
  const drawn = [...strokes, ...FLAT_GLYPHS, BLOSSOM, BUD, ...packs];
  assert.equal(clips.length, drawn.length);
  assert.ok(atlas.rows * atlas.cols >= Math.max(...drawn) + 1);
  const cells = new Set(clips.map(([x, y, w, h]) => {
    assert.equal(w, atlas.cellW);
    assert.equal(h, atlas.cellH);
    assert.ok(x >= 0 && y >= 0 && x + w <= canvas.width && y + h <= canvas.height);
    return (y / atlas.cellH) * atlas.cols + x / atlas.cellW;
  }));
  assert.deepEqual([...cells].sort((a, b) => a - b), drawn.sort((a, b) => a - b));
});

test('reflected blade strokes lean the other way in the water', () => {
  const view = { x0: 0, y0: 0, cols: 8, rows: 8 };
  const r = withLayers({ cols: 8, rows: 8, fg: new Float32Array(256), mask: new Uint8Array(64).fill(WATER) });
  const mirror = reflector(0, view);
  const seen = new Set();
  for (let x = 0; x < 8; x++) {
    r.fg.fill(0);
    mirror(r, x, 1, strokeGlyph(1, 4), 100, 100, 100, 2);
    for (let i = 0; i < 64; i++) if (r.fg[i * 4 + 3]) seen.add(r.fg[i * 4 + 3]);
  }
  assert.ok(seen.has(strokeGlyph(4, 1)), 'the mirrored stroke runs from the other side');
  assert.ok(!seen.has(strokeGlyph(1, 4)));
});

test('detail glyphs are named, flipped twins mirror each other, and layered glyphs keep their flag', () => {
  assert.throws(() => dg('no.such.glyph'));
  const cup = dg('flower.cup');
  assert.equal(MIRRORED[cup], dg('flower.cup~'));
  assert.equal(MIRRORED[dg('flower.cup~')], cup);
  assert.equal(MIRRORED[over(cup)], over(dg('flower.cup~')));
  assert.equal(MIRRORED[dg('flower.eye')], dg('flower.eye'));
  assert.ok(GLYPH_COUNT <= LAYER);
});

test('a layered glyph stacks over the base and the two most recent layers stay visible', () => {
  const r = withLayers({ cols: 2, rows: 1, fg: new Uint8ClampedArray(8) });
  const grass = strokeGlyph(1, 2);
  const petals = dg('flower.ring5');
  const eye = dg('flower.eye');
  r.put(0, 0, grass, 10, 20, 30);
  r.put(0, 0, over(petals), 200, 200, 200);
  assert.equal(r.glyphAt(0), grass);
  assert.equal(r.ov[3] | ((r.bg[3] >> 4) << 8), petals);
  r.layer(0, 0, eye, 250, 200, 0);
  assert.equal(r.glyphAt(0), petals, 'the earlier layer sinks to the base');
  assert.deepEqual([...r.fg.slice(0, 3)], [200, 200, 200]);
  assert.equal(r.ov[3] | ((r.bg[3] >> 4) << 8), eye);
  r.put(0, 0, glyph('#'), 1, 2, 3);
  assert.equal(r.glyphAt(0), glyph('#'));
  assert.equal(r.hasLayer(0), false, 'a plain glyph covers the layers beneath it');
});
