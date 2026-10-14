import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dg, family } from '../src/render/glyphs.js';
import { reflector } from '../src/world/reflection.js';
import { drawSkyReflection } from '../src/world/sky.js';
import { FLOATING, shade } from '../src/world/terrain/water.js';
import { ASPECT, WATER, World } from '../src/world/world.js';
import { withLayers } from './helpers/renderer.js';

function shadeChunk(world, cx, cy, t) {
  const chunk = world.chunk(cx, cy);
  const n = 64 * 64 * 4;
  const out = { fg: new Uint8ClampedArray(n), bg: new Uint8ClampedArray(n), ov: new Uint8ClampedArray(n) };
  for (let i = 0; i < 4096; i++) {
    if (chunk.type[i] === WATER) shade(out, i * 4, chunk, i, cx * 64 + (i & 63), cy * 64 + (i >> 6), world.seed, t, 0);
  }
  return { chunk, out };
}

const glyphOf = (out, i) => out.fg[i * 4 + 3] | ((out.bg[i * 4 + 3] & 15) << 8);
const layerOf = (out, i) => out.ov[i * 4 + 3] | ((out.bg[i * 4 + 3] >> 4) << 8);

test('lake detail is deterministic and floating pads stay put while the water moves', () => {
  const a = shadeChunk(new World(1), 0, 1, 2.5);
  const b = shadeChunk(new World(1), 0, 1, 2.5);
  assert.deepEqual(a.out.fg, b.out.fg);
  assert.deepEqual(a.out.ov, b.out.ov);
  const later = shadeChunk(new World(1), 0, 1, 7.25);
  let pads = 0;
  let moved = 0;
  for (let i = 0; i < 4096; i++) {
    if (a.chunk.type[i] !== WATER) continue;
    if (FLOATING[glyphOf(a.out, i)] && glyphOf(a.out, i) !== glyphOf(later.out, i)) {
      // Only foam laps in and out; pads never move.
      assert.ok(family('water.foam.').includes(glyphOf(a.out, i)), 'a pad stays where it grows');
    }
    if (FLOATING[glyphOf(a.out, i)]) pads++;
    if (glyphOf(a.out, i) !== glyphOf(later.out, i)) moved++;
  }
  assert.ok(pads > 0, 'the spawn lake has some floating detail');
  assert.ok(moved > 500, 'the surface swell moves');
});

test('every water cell is shaded with a surface mark or lake-bed detail, and fish rise in rings', () => {
  const world = new World(1);
  const rings = new Set(family('water.ring.'));
  let marked = 0;
  let cells = 0;
  let risen = 0;
  for (let t = 0; t < 20; t += 0.5) {
    const { chunk, out } = shadeChunk(world, 0, 1, t);
    for (let i = 0; i < 4096; i++) {
      if (chunk.type[i] !== WATER) continue;
      if (t === 0) { cells++; if (glyphOf(out, i)) marked++; }
      if (rings.has(layerOf(out, i))) risen++;
    }
  }
  assert.ok(marked / cells > 0.85, `most of the lake carries detail (${marked}/${cells})`);
  assert.ok(risen > 0, 'a fish rise ring spreads somewhere within twenty seconds');
});

test('reflections, the moon and stars pass under floating lily pads', () => {
  const cols = 120;
  const rows = 60;
  const r = withLayers({ cols, rows, cellW: 8 * ASPECT, cellH: 8, dpr: 1, canvas: { width: cols * 8 * ASPECT, height: rows * 8 },
    mask: new Uint8Array(cols * rows).fill(WATER) });
  const pad = dg('water.pad.0');
  for (let m = 0; m < cols * rows; m++) r.putAt(m, pad, 40, 90, 60);
  drawSkyReflection(r, { x0: 0, y0: 0, offX: 0, offY: 0 }, 1);
  const mirror = reflector(1, { x0: 0, y0: 0 });
  for (let x = 0; x < cols; x++) for (let y = 0; y < 20; y++) mirror(r, x, y, dg('water.line.0'), 200, 200, 200, 25);
  for (let m = 0; m < cols * rows; m++) {
    assert.equal(r.glyphAt(m), pad);
    assert.equal(r.hasLayer(m), false);
  }
});
