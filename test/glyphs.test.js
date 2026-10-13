import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GLYPHS, buildAtlas, glyph } from '../src/render/glyphs.js';

test('every atlas glyph is a font character, including all the grass and flower marks', (t) => {
  const text = [];
  const ctx = { measureText: () => ({ width: 60 }), fillRect() {}, fillText: (ch) => text.push(ch) };
  const canvas = { getContext: () => ctx };
  const original = globalThis.document;
  globalThis.document = { createElement: () => canvas };
  t.after(() => { globalThis.document = original; });
  const atlas = buildAtlas('monospace');
  assert.deepEqual(text, [...GLYPHS], 'only fillText draws into the atlas, once per glyph');
  assert.ok(atlas.rows * atlas.cols >= GLYPHS.length);
  for (const ch of "|/\\'`,.:_-~*o\"") {
    const g = glyph(ch);
    assert.equal(GLYPHS[g], ch);
    assert.ok(ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) <= 126, `${ch} is printable ASCII`);
  }
});
