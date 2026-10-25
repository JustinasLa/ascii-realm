import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gridSize } from '../src/core/layout.js';
import { AsciiRenderer } from '../src/render/renderer.js';

// A WebGL2 context that accepts every call and records a few of them, so the
// renderer's set-up, resize and draw run without a GPU.
function fakeGl({ compiles = true, links = true } = {}) {
  const calls = [];
  let next = 1;
  const gl = new Proxy({}, {
    get(target, key) {
      if (key in target) return target[key];
      if (typeof key !== 'string') return undefined;
      if (/^[A-Z0-9_]+$/.test(key)) return key.length;
      return (...args) => {
        calls.push([key, ...args]);
        if (key === 'getShaderParameter') return compiles;
        if (key === 'getProgramParameter') return links;
        if (key.endsWith('InfoLog')) return `${key} failed`;
        if (key === 'getAttribLocation') return 0;
        return { id: next++ };
      };
    },
  });
  return { gl, calls };
}

const atlas = { cols: 16, rows: 16, cellW: 8, cellH: 12, pad: 1,
  canvas: { width: 128, height: 192, getContext: () => ({ getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) }) } };
const canvas = (gl) => ({ width: 300, height: 150, getContext: kind => (kind === 'webgl2' ? gl : null) });

test('the renderer sets up, sizes its grid with the shared formula and draws', () => {
  const { gl, calls } = fakeGl();
  const r = new AsciiRenderer(canvas(gl), atlas);
  r.resize(393, 852, 2, 6.5 * 0.6, 6.5);
  assert.deepEqual([r.canvas.width, r.canvas.height], [786, 1704]);
  const grid = gridSize(786, 1704, r.cellH, r.cellW);
  assert.deepEqual([r.cols, r.rows], [grid.cols, grid.rows]);
  const allocated = r.fg;
  r.resize(393, 852, 2, 6.5 * 0.6, 6.5);
  assert.equal(r.fg, allocated, 'the same grid is not reallocated');
  r.outlineCell(1, 1, 10, 10, 10);
  r.outlineCell(-1, 0, 10, 10, 10);
  r.motionUsed = true;
  r.draw(1, 2, { density: 0.5, coverage: 0.4, time: 1, x0: 3, y0: 4, driftX: 0.1, driftY: 0.2,
    wake: { ox: 0, oy: 0, width: 4, height: 4, w: 2, h: 2, texels: new Float32Array(8) } });
  r.motionUsed = false;
  r.draw();
  assert.ok(calls.filter(([k]) => k === 'drawArrays').length === 2);
  r.restore();
});

test('the renderer reports a missing context, a failed compile and a failed link', () => {
  assert.throws(() => new AsciiRenderer({ getContext: () => null }, atlas), /WebGL2 is not available/);
  assert.throws(() => new AsciiRenderer(canvas(fakeGl({ compiles: false }).gl), atlas), /getShaderInfoLog failed/);
  assert.throws(() => new AsciiRenderer(canvas(fakeGl({ links: false }).gl), atlas), /getProgramInfoLog failed/);
});
