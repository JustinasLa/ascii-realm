import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hash2 } from '../src/core/rng.js';
import { glyph } from '../src/render/glyphs.js';
import { drawSkyReflection } from '../src/world/sky.js';
import { ASPECT, GRASS, WATER } from '../src/world/world.js';
import { withLayers } from './helpers/renderer.js';

function renderer(cellH, dpr = 1) {
  const cellW = cellH * ASPECT * dpr;
  cellH *= dpr;
  const canvas = { width: 600 * dpr, height: 360 * dpr };
  const cols = Math.ceil(canvas.width / cellW) + 1;
  const rows = Math.ceil(canvas.height / cellH) + 1;
  return withLayers({
    canvas, cols, rows, cellW, cellH, dpr,
    fg: new Uint8ClampedArray(cols * rows * 4),
    mask: new Uint8Array(cols * rows).fill(GRASS),
  });
}

function star(gx, gy, dpr) {
  const h = hash2(gx, gy, 4242);
  assert.ok(h >= 0.92, 'the chosen grid square contains a star');
  return {
    x: (gx + hash2(gx, gy, 4243)) * 26 * dpr,
    y: (gy + hash2(gx, gy, 4244)) * 26 * dpr,
    glyph: glyph([...'.\'+*'][Math.floor(h * 1e5) % 4]),
  };
}

function starCell(r, view, s) {
  const y = Math.floor((s.y + view.offY) / r.cellH);
  const wobble = Math.round(Math.sin((y + view.y0) * 0.9) * 0.8);
  const x = Math.floor((s.x + view.offX) / r.cellW) - wobble;
  return { x, y, index: y * r.cols + x };
}

test('stars near grid boundaries remain visible through scrolling, zoom and pixel ratios', () => {
  for (const dpr of [1, 1.5, 2]) {
    for (const cellH of [6, 8, 13.25, 24]) {
      for (const [fx, fy] of [[0, 0], [0, 0.5], [0.49, 0.83], [0.93, 0.17]]) {
        for (const [gx, gy] of [[7, 1], [2, 1], [13, 4]]) {
          const r = renderer(cellH, dpr);
          const view = { y0: -17, offX: r.cellW * fx, offY: r.cellH * fy };
          const s = star(gx, gy, dpr);
          const { index } = starCell(r, view, s);
          r.mask[index] = WATER;
          drawSkyReflection(r, view, 0);
          assert.equal(r.fg[index * 4 + 3], s.glyph,
            `star ${gx},${gy}; cell height ${cellH}; DPR ${dpr}; offset ${fx},${fy}`);
        }
      }
    }
  }
});

test('a star exactly on a cell boundary is drawn only in the cell containing it', () => {
  const r = renderer(10);
  const s = star(7, 1, r.dpr);
  const view = {
    y0: 0,
    offX: (r.cellW - s.x % r.cellW) % r.cellW,
    offY: (r.cellH - s.y % r.cellH) % r.cellH,
  };
  const { x, y, index } = starCell(r, view, s);
  for (let sy = y - 1; sy <= y + 1; sy++) {
    for (let sx = x - 2; sx <= x + 2; sx++) r.mask[sy * r.cols + sx] = WATER;
  }
  drawSkyReflection(r, view, 0);
  assert.equal(r.fg[index * 4 + 3], s.glyph);
  const drawn = Array.from(r.fg).filter((value, i) => i % 4 === 3 && value !== 0);
  assert.equal(drawn.length, 1);
});

test('sky reflections leave land unchanged', () => {
  const r = renderer(8);
  r.fg.fill(19);
  drawSkyReflection(r, { y0: 0, offX: 0, offY: 0 }, 0);
  assert.ok(r.fg.every((value) => value === 19));
});
