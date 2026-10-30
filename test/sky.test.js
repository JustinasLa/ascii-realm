import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { hash2 } from '../src/core/rng.js';
import { drawSkyReflection, starAt } from '../src/world/sky.js';
import { ASPECT, GRASS, WATER } from '../src/world/world.js';
import { withLayers } from './helpers/renderer.js';
import { AsciiRenderer } from '../src/render/renderer.js';
import { family, GLYPHS } from '../src/render/glyphs.js';
import { MOON_MAP, MOON_MAP_SIZE } from '../src/world/moon-map.js';
import { NIGHT_SKY, skyAt } from '../src/world/clock.js';

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
  const found = starAt(gx, gy);
  assert.ok(found, 'the chosen grid square contains a star');
  return {
    x: (gx + hash2(gx, gy, 4243)) * 26 * dpr,
    y: (gy + hash2(gx, gy, 4244)) * 26 * dpr,
    glyph: found.glyph,
  };
}

// Stars take the place of the water's own surface marks: the glyph the
// cell shows, layered or not.
const layered = (r, i) => (r.hasLayer(i) ? r.ov[i * 4 + 3] | ((r.bg[i * 4 + 3] >> 4) << 8) : r.glyphAt(i));

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
          assert.equal(layered(r, index), s.glyph,
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
  assert.equal(layered(r, index), s.glyph);
  let drawn = 0;
  for (let i = 0; i < r.cols * r.rows; i++) if (layered(r, i)) drawn++;
  assert.equal(drawn, 1);
});

test('sky reflections leave land unchanged', () => {
  const r = renderer(8);
  r.fg.fill(19);
  drawSkyReflection(r, { y0: 0, offX: 0, offY: 0 }, 0);
  assert.ok(r.fg.every((value) => value === 19));
});

function lunarRenderer(cell = 8, dpr = 1) {
  const r = Object.assign(Object.create(AsciiRenderer.prototype), {
    canvas: { width: 600 * dpr, height: 600 * dpr },
    cellW: cell * ASPECT * dpr, cellH: cell * dpr, dpr,
  });
  r.allocate(Math.ceil(600 / (cell * ASPECT)) + 1, Math.ceil(600 / cell) + 1);
  r.clear();
  r.mask.fill(WATER);
  return r;
}

const moonView = { x0: 0, y0: 0, offX: 0, offY: 0 };

test('real near-side geography is north up, west left, with Tycho in the south', () => {
  assert.equal(MOON_MAP.length, MOON_MAP_SIZE ** 2);
  const at = (x, y) => MOON_MAP[Math.floor((y + 1) * MOON_MAP_SIZE / 2) * MOON_MAP_SIZE
    + Math.floor((x + 1) * MOON_MAP_SIZE / 2)];
  // Named landmarks catch accidental image rotation, mirroring, far-side
  // projection, or a return to invented maria. Coordinates are disc radii.
  for (const [name, x, y] of [['Imbrium', -0.23, -0.54],
    ['Tranquillitatis', 0.51, -0.15], ['Crisium', 0.82, -0.29]]) {
    assert.ok(at(x, y) < 150, `${name} is a dark mare in its actual position`);
  }
  assert.ok(at(-0.14, 0.686) > 220, 'Tycho is bright below and left of centre');
  assert.ok(at(-0.33, -0.17) > 200, 'Copernicus is bright west of centre');
  assert.ok(at(0.3, 0.55) > 180, 'southern highlands stay bright');
});

test('moon uses varied fine ASCII with bright highlands and darker seas', () => {
  const r = lunarRenderer();
  drawSkyReflection(r, moonView, 3);
  const chars = new Set();
  const brightness = [];
  for (let i = 0; i < r.fine.length; i += 4) {
    if (r.fineBg[i + 3] < 16) continue;
    chars.add(r.fine[i + 3]);
    brightness.push(r.fine[i]);
  }
  assert.ok(brightness.length > 2000, 'the face has four fine samples per world cell');
  assert.ok(chars.size > 15, 'density bands keep rows from repeating one character');
  assert.ok([...chars].every(g => g < GLYPHS.length), 'moon uses real font characters');
  assert.ok(Math.max(...brightness) > 210, 'highlands catch bright moonlight');
  assert.ok(brightness.filter(b => b > 50 && b < 145).length > 100, 'dark seas remain readable');
});

test('moon stays circular and screen anchored through zoom and DPR', () => {
  for (const cell of [4.5, 8, 13.25, 24]) for (const dpr of [1, 1.5, 2]) {
    const r = lunarRenderer(cell, dpr);
    drawSkyReflection(r, moonView, 3);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let y = 0; y < r.fineRows; y++) for (let x = 0; x < r.fineCols; x++) {
      if (r.fineBg[(y * r.fineCols + x) * 4 + 3] < 16) continue;
      const px = (x + 0.5) * r.cellW / 2 / dpr;
      const py = (y + 0.5) * r.cellH / 2 / dpr;
      minX = Math.min(minX, px); maxX = Math.max(maxX, px);
      minY = Math.min(minY, py); maxY = Math.max(maxY, py);
    }
    assert.ok(Math.abs((minX + maxX) / 2 - 180) < cell);
    assert.ok(Math.abs((minY + maxY) / 2 - 480) < cell);
    assert.ok(Math.abs(maxX - minX - 180) < cell * 1.5);
    assert.ok(Math.abs(maxY - minY - 180) < cell * 1.5);
  }
});

test('moon respects land and floating leaves, and later objects occlude its fine cells', () => {
  const r = lunarRenderer();
  const sx = Math.floor(180 / r.cellW), sy = Math.floor(480 / r.cellH);
  const m = sy * r.cols + sx;
  const empty = () => {
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      assert.equal(r.fineBg[((sy * 2 + j) * r.fineCols + sx * 2 + i) * 4 + 3], 0);
    }
  };
  r.mask[m] = GRASS;
  drawSkyReflection(r, moonView, 0);
  empty();
  r.clear(); r.mask[m] = WATER;
  r.putAt(m, family('water.pad.')[0], 20, 40, 50);
  drawSkyReflection(r, moonView, 0);
  empty();
  r.clear();
  drawSkyReflection(r, moonView, 0);
  assert.equal(r.fineMark[m], 1);
  r.putAt(m, 15, 100, 110, 120);
  assert.ok(r.fineBg[((sy * 2) * r.fineCols + sx * 2) * 4 + 3] & 64,
    'later full-size objects cover the lunar glyphs through normal painter order');
});

// A sky state at a tick and moon phase, with any part overridden.
const skyOf = (tick, phase = 0, over = {}) => Object.assign(skyAt(tick, phase, phase), over);

// The moon's face: the brightness of its fine cells left and right of its
// centre (180 CSS px across), and in all.
function face(r) {
  let left = 0, right = 0;
  for (let y = 0; y < r.fineRows; y++) for (let x = 0; x < r.fineCols; x++) {
    const i = (y * r.fineCols + x) * 4;
    if (r.fineBg[i + 3] < 16) continue;
    const b = r.fine[i] + r.fine[i + 1] + r.fine[i + 2];
    if ((x + 0.5) * r.cellW / 2 / r.dpr < 180) left += b; else right += b;
  }
  return { left, right, total: left + right };
}

// What the sky drew before it had a clock, recorded from the older code.
const BEFORE_CLOCK = JSON.parse(readFileSync(new URL('./fixtures/night-sky-before-clock.json', import.meta.url), 'utf8'));

test('the full-night sky draws exactly what the sky drew before it had a clock', () => {
  for (const sky of [undefined, NIGHT_SKY, skyOf(14000)]) {
    const r = lunarRenderer();
    drawSkyReflection(r, moonView, 3, sky);
    for (const key of ['fg', 'bg', 'ov', 'fine', 'fineBg']) {
      assert.equal(createHash('sha256').update(r[key]).digest('hex'), BEFORE_CLOCK[key], `${key} at tick ${sky?.tick}`);
    }
  }
});

test('stars show only while the sky has them', () => {
  const r = renderer(10);
  const s = star(7, 1, r.dpr);
  const view = { y0: 0, offX: 0, offY: 0 };
  const { index } = starCell(r, view, s);
  r.mask[index] = WATER;
  drawSkyReflection(r, view, 0, skyOf(18000, 0, { stars: 0 }));
  assert.equal(r.hasLayer(index), false);
  drawSkyReflection(r, view, 0, skyOf(18000, 0, { stars: 0.5 }));
  assert.equal(layered(r, index), s.glyph);
  const bright = renderer(10);
  bright.mask[index] = WATER;
  drawSkyReflection(bright, view, 0, skyOf(18000));
  assert.ok(Math.abs(bright.ov[index * 4] - r.ov[index * 4] * 2) <= 1, 'half the starlight, half as bright');
});

test('by day the sun glints warm in the water and the moon is gone', () => {
  const r = lunarRenderer();
  drawSkyReflection(r, moonView, 3, skyOf(6000));
  assert.equal(face(r).total, 0, 'no moon face');
  const glints = new Set(family('water.glitter.'));
  let warm = 0;
  // On open water a glint is the cell's own glyph.
  for (let i = 0; i < r.cols * r.rows; i++) {
    if (glints.has(r.glyphAt(i)) && r.fg[i * 4] > r.fg[i * 4 + 2] * 1.15) warm++;
  }
  assert.ok(warm > 20, `${warm} sun glints`);
  const o = (Math.floor(480 / r.cellH) * r.cols + Math.floor(180 / r.cellW)) * 4;
  assert.ok(r.bg[o] > r.bg[o + 2], 'the glare warms the water under the sun');
});

test('at dusk a warm afterglow fills the water around the setting moon', () => {
  const night = lunarRenderer();
  drawSkyReflection(night, moonView, 3, skyOf(18000, 0, { moon: 0 }));
  const r = lunarRenderer();
  drawSkyReflection(r, moonView, 3, skyOf(12800, 0, { moon: 0 }));
  const o = (Math.floor(480 / r.cellH) * r.cols + Math.floor(330 / r.cellW)) * 4;
  assert.ok(r.bg[o] - night.bg[o] > r.bg[o + 2] - night.bg[o + 2] + 2, 'warm light beside the anchor');
  const dawn = lunarRenderer();
  drawSkyReflection(dawn, moonView, 3, skyOf(23200, 0, { moon: 0 }));
  const blue = (x) => x.fg.reduce((sum, v, i) => (i % 4 === 2 ? sum + v : sum), 0);
  assert.ok(blue(dawn) > blue(r) * 1.5, 'dawn is rosier than dusk');
});

test('the moon wanes and waxes: new is faint, quarters lit on the proper side', () => {
  const draw = (phase, over) => { const r = lunarRenderer(); drawSkyReflection(r, moonView, 3, skyOf(18000, phase, over)); return face(r); };
  const full = draw(0);
  assert.ok(draw(4).total < full.total * 0.105, 'a new moon is a faint disc');
  assert.ok(draw(4).total > 0, 'but still there');
  const last = draw(2), first = draw(6);
  assert.ok(last.left > last.right * 4, 'the last quarter is lit on the left');
  assert.ok(first.right > first.left * 4, 'the first quarter is lit on the right');
  assert.ok(draw(1).total > last.total && last.total > draw(3).total, 'it thins as it wanes');
});

test('a setting moon fades out rather than popping off', () => {
  const draw = (moon) => { const r = lunarRenderer(); drawSkyReflection(r, moonView, 3, skyOf(18000, 0, { moon })); return face(r).total; };
  const full = draw(1);
  const half = draw(0.5);
  assert.ok(half < full * 0.55 && half > full * 0.25, `half: ${half / full}`);
  assert.ok(draw(0.02) < full * 0.01, 'almost nothing the moment before it sets');
  assert.equal(draw(0), 0);
});

test('without a fine grid the moon is drawn in whole cells, phases and all', () => {
  const brightness = (phase) => {
    const r = renderer(8);
    r.mask.fill(WATER);
    drawSkyReflection(r, { x0: 0, y0: 0, offX: 0, offY: 0 }, 3, skyOf(18000, phase));
    const m = Math.floor(288 / r.cellH) * r.cols + Math.floor(180 / r.cellW);
    return r.fg[m * 4] + r.fg[m * 4 + 1] + r.fg[m * 4 + 2];
  };
  assert.ok(brightness(0) > 300, 'the full moon is bright');
  assert.ok(brightness(4) < brightness(0) * 0.2, 'the new moon is dim');
});
