import assert from 'node:assert/strict';
import test from 'node:test';
import { AsciiRenderer } from '../src/render/renderer.js';
import { glyph } from '../src/render/glyphs.js';
import { drawFurnaceGlow, glowCells, lightFurnace } from '../src/world/furnace-glow.js';
import { ASPECT } from '../src/world/world.js';

const GLOW = { x: 0, y: -1.35, rx: 1.05, ry: 0.85 };
const view = { x0: 0, y0: 0, cols: 40, rows: 24 };
const furnace = () => ({ kind: 'furnace', x: 20.5, y: 16.5, seed: 9, glow: GLOW, cells: [] });

// A renderer that records the letters laid over ordinary cells.
function recorder() {
  const calls = [];
  return { calls, fine: null, layer: (...args) => calls.push(args), fineAt: () => assert.fail('no fine grid') };
}

test('the glow covers the mouth ellipse, embers along its bottom row', () => {
  for (const fine of [false, true]) {
    const k = fine ? 2 : 1;
    const cells = glowCells(GLOW, fine);
    assert.ok(cells.length >= (fine ? 12 : 3));
    const bottom = Math.max(...cells.map(([, dy]) => dy));
    for (const [dx, dy, ember] of cells) {
      const nx = (dx * ASPECT / k - GLOW.x) / GLOW.rx;
      const ny = ((dy - 0.5) / k - GLOW.y) / GLOW.ry;
      assert.ok(nx * nx + ny * ny <= 1);
      assert.equal(ember, dy === bottom);
    }
    if (fine) assert.ok(cells.filter(([, , ember]) => !ember).length > 6, 'flames over the embers');
  }
});

test('without a fine bake the glow is laid over ordinary cells, flickering', () => {
  const r = recorder();
  drawFurnaceGlow(r, view, furnace(), 0);
  const first = r.calls.splice(0);
  assert.equal(first.length, glowCells(GLOW, false).length);
  const letters = new Set([...'*o.^\'",'].map((ch) => glyph(ch)));
  for (const [x, y, g] of first) {
    assert.ok(letters.has(g));
    assert.ok(Math.abs(x - 20) <= 2 && y < 16 && y >= 13);
  }
  drawFurnaceGlow(r, view, furnace(), 0.3);
  assert.notDeepEqual(r.calls.map((c) => c.slice(2)), first.map((c) => c.slice(2)), 'letters and colours change');
  // The same view a frame later lays the same cells.
  assert.deepEqual(r.calls.map((c) => c.slice(0, 2)), first.map((c) => c.slice(0, 2)));
});

test('the furnace lights the ground in front of it and nothing past its reach', () => {
  const r = Object.create(AsciiRenderer.prototype);
  r.allocate(view.cols, view.rows);
  lightFurnace(r, view, furnace(), 0.2);
  const at = (x, y) => r.fg[(y * view.cols + x) * 4];
  const bgAt = (x, y) => r.bg[(y * view.cols + x) * 4];
  assert.ok(at(20, 16) > 20 && bgAt(20, 16) > 0, 'in front of the mouth');
  assert.ok(at(20, 16) > at(26, 16), 'brightest at the mouth');
  for (let y = 0; y < view.rows; y++) {
    for (let x = 0; x < view.cols; x++) {
      const d = Math.hypot((x - 20.5) * ASPECT, y - (16.5 - 1.35));
      if (d >= 11) assert.equal(at(x, y) + bgAt(x, y), 0, `(${x}, ${y})`);
    }
  }
});
