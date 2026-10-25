import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AsciiRenderer } from '../src/render/renderer.js';

// The WebGL side of the renderer, driven through a stand-in context that
// records every call, so setup, resizing and drawing run outside a browser.

function fakeGl({ compiles = true, links = true } = {}) {
  const calls = [];
  let next = 1;
  const gl = new Proxy({}, {
    get(target, name) {
      if (name in target) return target[name];
      if (typeof name !== 'string') return undefined;
      // Constants are upper case; everything else is a method.
      if (/^[A-Z0-9_]+$/.test(name)) return name;
      return (...args) => {
        calls.push([name, ...args]);
        if (name === 'getShaderParameter') return compiles;
        if (name === 'getProgramParameter') return links;
        if (name === 'getShaderInfoLog') return 'bad shader';
        if (name === 'getProgramInfoLog') return 'bad link';
        if (name === 'getAttribLocation') return 0;
        return { id: next++ };
      };
    },
  });
  return { gl, calls };
}

function setup(options) {
  const { gl, calls } = fakeGl(options);
  const canvas = { width: 0, height: 0, getContext: kind => (kind === 'webgl2' ? gl : null) };
  const atlas = {
    cols: 4, rows: 4, cellW: 8, cellH: 12, pad: 1,
    canvas: { width: 2, height: 2, getContext: () => ({ getImageData: () => ({ data: new Uint8Array(16).fill(9) }) }) },
  };
  return { canvas, atlas, calls };
}

test('the renderer compiles its shader and uploads the glyph atlas and fog noise', () => {
  const { canvas, atlas, calls } = setup();
  const r = new AsciiRenderer(canvas, atlas);
  assert.equal(r.cols, 0);
  assert.ok(r.prog && r.atlasTex && r.noiseTex && r.pushedTex && r.fineBgTex);
  assert.ok('uFg' in r.u && 'uMotionActive' in r.u);
  const atlasUpload = calls.find(([name, , , format]) => name === 'texImage2D' && format === 'R8');
  assert.deepEqual([...atlasUpload.at(-1)], [9, 9, 9, 9]);
});

test('a missing WebGL2 context or a failing shader is reported', () => {
  const { atlas } = setup();
  assert.throws(() => new AsciiRenderer({ getContext: () => null }, atlas), /WebGL2 is not available/);
  const broken = setup({ compiles: false });
  assert.throws(() => new AsciiRenderer(broken.canvas, broken.atlas), /bad shader/);
  const unlinked = setup({ links: false });
  assert.throws(() => new AsciiRenderer(unlinked.canvas, unlinked.atlas), /bad link/);
});

test('drawing uploads the cells and fog, with and without pushed fog and motion', () => {
  const { canvas, atlas, calls } = setup();
  const r = new AsciiRenderer(canvas, atlas);
  r.resize(64, 48, 1, 8, 12);
  calls.length = 0;
  r.draw();
  assert.ok(calls.some(([name, , a, b]) => name === 'uniform4f' && a === -1e6 && b === -1e6), 'nothing pushed');
  assert.equal(calls.filter(([name]) => name === 'drawArrays').length, 1);

  calls.length = 0;
  r.motionUsed = true;
  const wake = { ox: 1, oy: 2, width: 3, height: 4, w: 2, h: 2, texels: new Float32Array(8) };
  r.draw(1, 2, { density: 0.5, coverage: 0.4, time: 3, x0: 5, y0: 6, driftX: 1, driftY: 2, wake });
  assert.ok(calls.some(([name, , a, b]) => name === 'uniform4f' && a === 1 && b === 2), 'pushed area');
  assert.ok(calls.some(([name, , , , , , , , , data]) => name === 'texSubImage2D' && data === r.motion), 'motion uploaded');
  assert.ok(calls.some(([name, , a, b, c]) => name === 'uniform3f' && a === 0.5 && b === 0.4 && c === 3));
});
