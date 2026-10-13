import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BLOSSOM, BUD, FLAT_GLYPHS, GLYPHS, MIRRORED, STROKE_STEPS, buildAtlas, flatGlyph, glyph,
  strokeGlyph } from '../src/render/glyphs.js';
import { reflector } from '../src/world/reflection.js';
import { WATER } from '../src/world/world.js';

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
  const ctx = { measureText: () => ({ width: 60 }), fillRect() {}, fillText() {},
    rect: (...args) => clips.push(args) };
  for (const name of ['save', 'restore', 'beginPath', 'clip', 'moveTo', 'lineTo', 'closePath', 'fill', 'stroke',
    'arc']) ctx[name] = () => {};
  const canvas = { getContext: () => ctx };
  const original = globalThis.document;
  globalThis.document = { createElement: () => canvas };
  t.after(() => { globalThis.document = original; });
  const atlas = buildAtlas('monospace');
  const drawn = [...strokes, ...FLAT_GLYPHS, BLOSSOM, BUD];
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
  const r = { cols: 8, rows: 8, fg: new Float32Array(256), mask: new Uint8Array(64).fill(WATER) };
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
