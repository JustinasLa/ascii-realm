import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AsciiRenderer } from '../src/render/renderer.js';
import { ASPECT } from '../src/world/world.js';
import { glyph } from '../src/render/glyphs.js';

for (const dpr of [0.25, 0.5, 1]) {
  for (const cellH of [6, 8]) {
    test(`resize preserves the world aspect at DPR ${dpr} and cell height ${cellH}`, () => {
      const renderer = {
        canvas: { width: 0, height: 0 },
        gl: { viewport() {}, activeTexture() {}, bindTexture() {}, texImage2D() {} },
        cols: 0,
        rows: 0,
        allocate: AsciiRenderer.prototype.allocate,
      };
      AsciiRenderer.prototype.resize.call(renderer, 1600, 900, dpr, cellH * ASPECT, cellH);

      assert.ok(Math.abs(renderer.cellW / renderer.cellH - ASPECT) < 1e-12);
      assert.ok(renderer.cellW >= 2 && renderer.cellH >= 3);
      // At normal density the requested zoom must stay unchanged.
      if (dpr === 1) {
        assert.equal(renderer.cellW, cellH * ASPECT);
        assert.equal(renderer.cellH, cellH);
      }
    });
  }
}

test('fully zoomed out, the furthest zoom keeps its cell size', () => {
  const renderer = {
    canvas: { width: 0, height: 0 },
    gl: { viewport() {}, activeTexture() {}, bindTexture() {}, texImage2D() {} },
    cols: 0,
    rows: 0,
    allocate: AsciiRenderer.prototype.allocate,
  };
  AsciiRenderer.prototype.resize.call(renderer, 1600, 900, 1, 4.5 * ASPECT, 4.5);
  assert.equal(renderer.cellH, 4.5);
  assert.ok(renderer.cols > 590 && renderer.rows > 200);
});

test('fractional glyph motion preserves later foreground writes and clears every frame', () => {
  const r = Object.create(AsciiRenderer.prototype);
  r.allocate(12, 8);
  r.beginFloating();
  r.putFloating(4.25, 3.1, glyph('Q'), 180, 200, 190);
  const offset = (3 * r.cols + 4) * 4;
  assert.ok(r.motion[offset] > 128);
  assert.ok(r.motion[offset + 1] > 128);
  assert.ok(r.motion[offset + 2] & 1, 'the source cell holds a freely moving character');
  r.put(4, 3, glyph('M'), 200, 100, 100);
  assert.equal(r.motion[offset + 2] & 1, 0, 'foreground replaces the floating character');
  assert.equal(r.motion[offset + 3] & 128, 0, 'a foreground cell rejects neighbouring floating ink');
  r.putFloating(5.15, 3.2, glyph('Q'), 180, 200, 190);
  r.setGlyph(3 * r.cols + 5, glyph('X'));
  assert.equal(r.motion[(3 * r.cols + 5) * 4 + 2] & 1, 0);
  r.clearFine();
  assert.equal(r.motionUsed, false);
  assert.equal(r.motionPass, 0);
  assert.ok(r.motion.every(v => v === 0));
});
