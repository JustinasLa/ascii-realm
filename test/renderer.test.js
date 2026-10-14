import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AsciiRenderer } from '../src/render/renderer.js';
import { ASPECT } from '../src/world/world.js';

for (const dpr of [0.25, 0.5, 1]) {
  for (const cellH of [6, 8]) {
    test(`resize preserves the world aspect at DPR ${dpr} and cell height ${cellH}`, () => {
      const renderer = {
        canvas: { width: 0, height: 0 },
        gl: { viewport() {}, activeTexture() {}, bindTexture() {}, texImage2D() {} },
        cols: 0,
        rows: 0,
      };
      AsciiRenderer.prototype.resize.call(renderer, 1600, 900, dpr, cellH * ASPECT, cellH);

      assert.ok(Math.abs(renderer.cellW / renderer.cellH - ASPECT) < 1e-12);
      assert.ok(renderer.cellW >= 0.6 && renderer.cellH >= 1);
      // At normal density the requested zoom must stay unchanged.
      if (dpr === 1) {
        assert.equal(renderer.cellW, cellH * ASPECT);
        assert.equal(renderer.cellH, cellH);
      }
    });
  }
}

test('fully zoomed out, cells shrink below a glyph to coloured dots', () => {
  const renderer = {
    canvas: { width: 0, height: 0 },
    gl: { viewport() {}, activeTexture() {}, bindTexture() {}, texImage2D() {} },
    cols: 0,
    rows: 0,
  };
  AsciiRenderer.prototype.resize.call(renderer, 1600, 900, 1, 1.2 * ASPECT, 1.2);
  assert.equal(renderer.cellH, 1.2);
  assert.ok(renderer.cols > 2000 && renderer.rows > 700);
});
