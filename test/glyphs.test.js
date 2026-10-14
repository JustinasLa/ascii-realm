import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BLANK_GLYPH, BLOSSOM, BUD, FLAT_GLYPHS, GLYPH_KIND, GRASS_GLYPH, GLYPH_COUNT, GLYPHS, LAYER, MIRRORED, STROKE_STEPS, buildAtlas, dg, flatGlyph,
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

test('every drawn glyph is clipped to its own padded atlas cell and detail glyphs show as characters', (t) => {
  const clips = [];
  const canvas = {};
  const ctx = new Proxy({
    measureText: () => ({ width: 60 }),
    rect: (...args) => clips.push(args),
    getImageData: () => ({ data: new Uint8ClampedArray(canvas.width * canvas.height * 4) }),
  }, { get: (target, name) => target[name] ?? (() => {}) });
  canvas.getContext = () => ctx;
  const original = globalThis.document;
  globalThis.document = { createElement: () => canvas };
  t.after(() => { globalThis.document = original; });
  const atlas = buildAtlas('monospace');
  const cells = new Set(clips.map(([x, y, w, h]) => {
    assert.equal(w, atlas.cellW);
    assert.equal(h, atlas.cellH);
    assert.ok(x >= 0 && y >= 0 && x + w <= canvas.width && y + h <= canvas.height);
    return (y / atlas.cellH) * atlas.cols + x / atlas.cellW;
  }));
  assert.equal(cells.size, clips.length, 'no glyph is drawn twice');
  for (const g of [...strokes, ...FLAT_GLYPHS]) assert.ok(cells.has(g), 'grass strokes are drawn');
  assert.equal(atlas.ascii.size, GLYPH_COUNT - BUD - 1);
  for (const [name, ch] of atlas.ascii) {
    if (name.startsWith('flora.stem.')) assert.equal(ch, null, 'flower stems are drawn like grass');
    else assert.ok(ch === '' || (ch.length === 1 && GLYPHS.includes(ch)), `${name} shows as a character`);
  }
  assert.equal(atlas.ascii.get('pebble.0'), 'o');
  assert.equal(atlas.ascii.get('props.cut.s.0.0'), '(');
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

test('a cell shows one character: a layered glyph replaces it, except grass over grass', () => {
  const r = withLayers({ cols: 2, rows: 1, fg: new Uint8ClampedArray(8) });
  const grass = strokeGlyph(1, 2);
  const blade = strokeGlyph(3, 4);
  const petals = dg('flower.ring5');
  r.put(0, 0, grass, 10, 20, 30);
  r.put(0, 0, over(blade), 40, 50, 60);
  assert.equal(r.glyphAt(0), grass);
  assert.equal(r.ov[3] | ((r.bg[3] >> 4) << 8), blade, 'grass grows over grass');
  r.layer(0, 0, petals, 200, 200, 200);
  assert.equal(r.glyphAt(0), petals, 'a flower takes the cell');
  assert.equal(r.hasLayer(0), false);
  assert.deepEqual([...r.fg.slice(0, 3)], [200, 200, 200]);
  r.layer(0, 0, dg('veil.0'), 1, 2, 3);
  assert.equal(r.glyphAt(0), petals, 'a blank glyph leaves the cell as it was');
  assert.equal(GLYPH_KIND[dg('veil.0')], BLANK_GLYPH);
  assert.equal(GLYPH_KIND[grass], GRASS_GLYPH);
});
