import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PLAYER, SEED, SHAFTS } from '../bench/lakeside.js';
import { TILT } from '../src/entities/rig.js';
import { MOONLIGHT } from '../src/render/palette.js';
import { AsciiRenderer } from '../src/render/renderer.js';
import {
  COLUMN_STEP, MOTE_SPEED, PEAK_LIFT, SHAFT_CACHE, SHAFT_CHANCE, SHAFT_RISE, SHAFT_TIERS, SLOT_H, SLOT_W, TINT,
  drawColumn, drawMotes, motePosition, patchStamp, shaftAt, shaftTier, shaftsNear,
} from '../src/world/moon-shafts.js';
import { MOON_HUE, moonTint, tintRgb } from '../src/world/moon-tint.js';
import { MOON, worldNormal } from '../src/world/surface-light.js';
import { ASPECT, CHUNK_SIZE, GRASS, SHORE, WATER, World } from '../src/world/world.js';

const meadow = () => ({ typeAt: () => GRASS });

// A world with its ground loaded over a box, as the game loads it around the view.
function loaded(world, x0, y0, x1, y1) {
  for (let cy = Math.floor(y0 / CHUNK_SIZE); cy <= Math.floor(y1 / CHUNK_SIZE); cy++) {
    for (let cx = Math.floor(x0 / CHUNK_SIZE); cx <= Math.floor(x1 / CHUNK_SIZE); cx++) world.chunk(cx, cy);
  }
  return world;
}

// The first slot from (0, 0) eastward holding a beam on a meadow.
function firstShaft(world, seed) {
  for (let i = 0; ; i++) {
    const shaft = shaftAt(i, 0, seed, world);
    if (shaft) return shaft;
  }
}

function renderer(cols, rows) {
  const r = Object.create(AsciiRenderer.prototype);
  r.allocate(cols, rows);
  // Colours only: no glyph is laid over another yet.
  for (let o = 0; o < r.fg.length; o++) {
    if (o % 4 === 3) continue;
    r.fg[o] = 60;
    r.bg[o] = 20;
    r.ov[o] = 40;
  }
  r.mask.fill(GRASS);
  return r;
}

test('beams stand in the same slots every time, per world and seed', () => {
  const a = loaded(new World(1), -400, -250, 400, 250), b = loaded(new World(1), -400, -250, 400, 250);
  const keys = (world, seed) => shaftsNear(-300, -150, 300, 150, seed, world).map((s) => `${s.key} ${s.cx} ${s.cy} ${s.r}`);
  const first = keys(a, 1);
  assert.ok(first.length > 6);
  assert.deepEqual(keys(a, 1), first);
  assert.deepEqual(keys(b, 1), first, 'another world of the same seed');
  assert.notDeepEqual(keys(loaded(new World(2), -400, -250, 400, 250), 2), first, 'another seed');
  // One world's slots never leak into another's, and switching back finds them again.
  const stub = meadow();
  const other = keys(stub, 7);
  assert.notDeepEqual(other, first);
  assert.deepEqual(keys(a, 1), first);
  assert.deepEqual(keys(stub, 7), other);
  // Nor do a world's slots under another seed.
  assert.notDeepEqual(keys(stub, 8), other);
  assert.deepEqual(keys(stub, 7), other);
});

test('half the slots hold a beam, each in its slot\'s middle', () => {
  const world = meadow();
  let n = 0;
  for (let j = 0; j < 40; j++) {
    for (let i = 0; i < 40; i++) {
      const s = shaftAt(i, j, 3, world);
      if (!s) continue;
      n++;
      const fx = (s.cx - i * SLOT_W) / SLOT_W, fy = (s.cy - j * SLOT_H) / SLOT_H;
      assert.ok(fx >= 0.2 && fx <= 0.8 && fy >= 0.2 && fy <= 0.8, `${s.key} at ${fx}, ${fy}`);
      assert.equal(s.key, `${i},${j}`);
    }
  }
  assert.ok(Math.abs(n / 1600 - SHAFT_CHANCE) < 0.03, `${n} of 1600`);
});

test('a slot is decided only once the world has loaded its ground, without loading it', () => {
  const world = new World(1);
  const before = world.chunks.size;
  assert.deepEqual(shaftsNear(-300, -150, 300, 150, 1, world), []);
  assert.equal(world.chunks.size, before, 'no ground was generated');
  loaded(world, -400, -250, 400, 250);
  assert.ok(shaftsNear(-300, -150, 300, 150, 1, world).length > 6);
});

test('no beam lands on the water or the shore', () => {
  for (const type of [WATER, SHORE]) {
    const world = { typeAt: () => type };
    for (let i = 0; i < 20; i++) assert.equal(shaftAt(i, 0, 3, world), null);
  }
});

test('the slot memory is bounded, and a forgotten slot comes back the same', () => {
  const world = meadow();
  const first = firstShaft(world, 4);
  const again = { ...first, stamp: null };
  for (let i = 0; i < SHAFT_CACHE + 10; i++) shaftAt(1000 + i, 5, 4, world);
  const back = shaftAt(first.i, first.j, 4, world);
  assert.notEqual(back, first, 'it was forgotten');
  assert.deepEqual({ ...back, stamp: null }, again);
});

test('a patch is soft, bright at its heart, zero outside its stamp and lobed, not round', () => {
  const world = meadow();
  for (const seed of [1, 2, 3, 4, 5]) {
    const shaft = firstShaft(world, seed);
    const stamp = patchStamp(shaft, seed);
    assert.equal(patchStamp(shaft, seed), stamp, 'baked once');
    assert.equal(stamp.work, stamp.w * stamp.h * 3);
    const bx = Math.floor(shaft.cx), by = Math.floor(shaft.cy);
    assert.deepEqual([bx + stamp.x0, by + stamp.y0, bx + stamp.x0 + stamp.w, by + stamp.y0 + stamp.h],
      [shaft.box.x0, shaft.box.y0, shaft.box.x1, shaft.box.y1]);
    // The stamp's rim is dark: nothing was cut off.
    for (let x = 0; x < stamp.w; x++) assert.equal(stamp.lift[x] + stamp.lift[(stamp.h - 1) * stamp.w + x], 0);
    for (let y = 0; y < stamp.h; y++) assert.equal(stamp.lift[y * stamp.w] + stamp.lift[y * stamp.w + stamp.w - 1], 0);
    const at = (dx, dy) => {
      const x = dx - stamp.x0, y = dy - stamp.y0;
      if (x < 0 || y < 0 || x >= stamp.w || y >= stamp.h) return 0;
      return stamp.lift[y * stamp.w + x] / 255;
    };
    const fx = shaft.cx - bx, fy = shaft.cy - by;
    let peak = 0;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -8; dx <= 8; dx++) {
        if (Math.hypot(dx * ASPECT, dy / TILT) < shaft.r / 2) peak = Math.max(peak, at(Math.floor(fx + dx), Math.floor(fy + dy)));
      }
    }
    assert.ok(peak >= 0.9, `peak ${peak}`);
    // Soft: many cells part-lit.
    const values = [...stamp.lift].filter((v) => v > 0);
    assert.ok(values.filter((v) => v < 200).length > values.length / 4);
    // The outline's radius at 32 angles, in a plan with the tilt undone.
    const radii = [];
    for (let k = 0; k < 32; k++) {
      const a = k / 32 * Math.PI * 2;
      let r = 0;
      while (r < 100 && at(Math.floor(fx + Math.cos(a) * r / ASPECT), Math.floor(fy + Math.sin(a) * r * TILT)) >= 0.1) r += 0.25;
      radii.push(r);
    }
    const mean = radii.reduce((a, b) => a + b) / radii.length;
    const sd = Math.sqrt(radii.reduce((a, b) => a + (b - mean) ** 2, 0) / radii.length);
    assert.ok(sd / mean > 0.08, `seed ${seed} outline varies (${(sd / mean).toFixed(3)})`);
  }
});

test('the column rises toward the moon, up and to the left, and skips the water and the sprites', () => {
  const [x, y, z] = worldNormal(...MOON);
  assert.ok(Math.abs(COLUMN_STEP[0] - x / z / ASPECT) < 1e-12 && Math.abs(COLUMN_STEP[1] - (-1 + y / z * TILT)) < 1e-12);
  assert.ok(Math.abs(COLUMN_STEP[0] + 1.02) < 0.01 && Math.abs(COLUMN_STEP[1] + 1.18) < 0.01);
  const world = meadow();
  const shaft = firstShaft(world, 6);
  const view = { x0: Math.floor(shaft.cx) - 80, y0: Math.floor(shaft.cy) - 60, cols: 120, rows: 70 };
  const r = renderer(view.cols, view.rows);
  const water = (Math.floor(shaft.cy) - 2 - view.y0) * view.cols + Math.floor(shaft.cx) - view.x0;
  r.mask[water] = WATER;
  r.fineMark[water + 1] = 1;
  const before = r.fg.slice();
  drawColumn(r, view, shaft, 1, 6);
  let sx = 0, n = 0, top = Infinity;
  for (let cell = 0; cell < view.cols * view.rows; cell++) {
    const o = cell * 4;
    if (r.fg[o] === before[o]) continue;
    const wx = view.x0 + cell % view.cols, wy = view.y0 + Math.floor(cell / view.cols);
    assert.ok(wy <= Math.floor(shaft.cy), `row ${wy} under the patch's heart`);
    assert.ok(wx <= shaft.cx + shaft.half * 1.4, `column ${wx} right of the beam`);
    assert.ok(r.fg[o + 1] - before[o + 1] >= r.fg[o] - before[o], 'pale blue-green moonlight');
    assert.equal(r.bg[o], 20, 'the ground behind is left alone');
    sx += wx;
    n++;
    top = Math.min(top, wy);
  }
  assert.ok(n > 200);
  assert.ok(sx / n < shaft.cx - 8, 'it leans left');
  assert.ok(top < shaft.cy - SHAFT_RISE * 0.8, 'and rises high');
  assert.equal(r.fg[water * 4], 60, 'not on the water');
  assert.equal(r.fg[(water + 1) * 4], 60, 'not over a sprite');
  // Off the view, nothing.
  const off = renderer(20, 20);
  drawColumn(off, { x0: shaft.cx + 500, y0: shaft.cy, cols: 20, rows: 20 }, shaft, 1, 6);
  assert.ok(off.fg.every((v, i) => v === (i % 4 === 3 ? 0 : 60)));
});

test('motes sink down the column, glint, keep to their place and never push out a flower', () => {
  const world = meadow();
  const shaft = firstShaft(world, 6);
  const a = motePosition(shaft, 0, 4, 1, 6), b = motePosition(shaft, 0, 4, 2, 6);
  const sank = (a.height - b.height + SHAFT_RISE) % SHAFT_RISE;
  assert.ok(Math.abs(sank - MOTE_SPEED) < 1e-9, 'sinks at its speed');
  assert.deepEqual(motePosition(shaft, 0, 4, 1, 6), a, 'the same at the same time');
  const heights = [0, 1, 2, 3].map((m) => motePosition(shaft, m, 4, 0, 6).height).sort((p, q) => p - q);
  for (let m = 1; m < 4; m++) assert.ok(heights[m] - heights[m - 1] > 1, 'spread along the beam');
  const view = { x0: Math.floor(shaft.cx) - 80, y0: Math.floor(shaft.cy) - 60, cols: 120, rows: 70 };
  const draw = (prepare) => {
    const r = renderer(view.cols, view.rows);
    prepare?.(r);
    drawMotes(r, view, shaft, 4, 1, 3, 6);
    return r;
  };
  const plain = draw();
  const laid = [];
  for (let cell = 0; cell < view.cols * view.rows; cell++) if (plain.fg[cell * 4 + 3]) laid.push(cell);
  assert.ok(laid.length >= 3 && laid.length <= 4, `${laid.length} motes`);
  for (const cell of laid) assert.ok(plain.fg[cell * 4] >= 20 && plain.fg[cell * 4 + 2] >= plain.fg[cell * 4], 'pale moonlight over the dark ground');
  // A glyph already layered keeps its place; water and sprites take no mote.
  const [flower, wet, sprite] = laid;
  const kept = draw((r) => {
    r.ov[flower * 4 + 3] = 7;
    r.mask[wet] = WATER;
    r.fineMark[sprite] = 1;
  });
  assert.equal(kept.fg[flower * 4 + 3], 0);
  assert.equal(kept.ov[flower * 4 + 3], 7);
  assert.equal(kept.fg[wet * 4 + 3], 0);
  assert.equal(kept.fg[sprite * 4 + 3], 0);
  // Off the view, nothing.
  const off = renderer(10, 10);
  drawMotes(off, { x0: shaft.cx + 500, y0: shaft.cy, cols: 10, rows: 10 }, shaft, 4, 1, 3, 6);
  assert.ok(off.ov.every((v, i) => v === (i % 4 === 3 ? 0 : 40)));
});

test('the tiers: fewer beams on phones, and no columns on a phone at its reduced cells', () => {
  assert.equal(shaftTier({ phone: false }), 'desktop');
  assert.equal(shaftTier({ phone: false, reduced: true }), 'desktop');
  assert.equal(shaftTier({ phone: true }), 'phone');
  assert.equal(shaftTier({ phone: true, reduced: true }), 'reduced');
  assert.deepEqual(SHAFT_TIERS, {
    desktop: { max: 6, column: true, motes: 4, intensity: 1 },
    phone: { max: 4, column: true, motes: 2, intensity: 1 },
    reduced: { max: 2, column: false, motes: 0, intensity: 1 },
  });
});

test('a patch that only its column brings near is found only when columns are drawn', () => {
  const world = meadow();
  const shaft = firstShaft(world, 6);
  // A box over the top of the column, above the patch.
  const box = [Math.floor(shaft.cx - 30), shaft.reach.y0, Math.floor(shaft.cx - 25), shaft.reach.y0 + 3];
  assert.ok(shaftsNear(...box, 6, world, true).includes(shaft));
  assert.ok(!shaftsNear(...box, 6, world, false).includes(shaft));
});

test('the moon\'s tint turns colours paler and bluer at their own brightness', () => {
  const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  assert.ok(Math.abs(luma(...MOON_HUE) - 1) < 1e-12);
  assert.ok(Math.abs(MOON_HUE[2] / MOON_HUE[0] - MOONLIGHT[2] / MOONLIGHT[0]) < 1e-12);
  const out = tintRgb([0, 0, 0], 40, 90, 30, TINT);
  assert.ok(Math.abs(luma(...out) - luma(40, 90, 30)) < 1e-9);
  assert.ok(out[2] > 30 && out[1] < 90, 'bluer, less green');
  assert.deepEqual(tintRgb([0, 0, 0], 40, 90, 30, 0), [40, 90, 30]);
  const arr = [0, 40, 90, 30];
  moonTint(arr, 1, TINT);
  assert.deepEqual(arr.slice(1), out);
  assert.ok(PEAK_LIFT > 0 && TINT > 0);
});

test('the lakeside scene keeps its three moonbeams', () => {
  const view = { x0: Math.floor(PLAYER.x - 134), y0: Math.floor(PLAYER.y - 11 - 45), cols: 268, rows: 91 };
  const world = loaded(new World(SEED), view.x0 - 80, view.y0 - 60, view.x0 + view.cols + 80, view.y0 + view.rows + 60);
  const found = shaftsNear(view.x0, view.y0, view.x0 + view.cols, view.y0 + view.rows, SEED, world, false);
  for (const at of SHAFTS) {
    assert.ok(found.some((s) => Math.abs(s.cx - at.x) < 0.5 && Math.abs(s.cy - at.y) < 0.5), `a beam at ${at.x}, ${at.y}`);
    assert.equal(world.typeAt(Math.floor(at.x), Math.floor(at.y)), GRASS);
  }
  // A phone's portrait view, about the wanderer, has one too.
  const phone = shaftsNear(PLAYER.x - 41, PLAYER.y - 64, PLAYER.x + 42, PLAYER.y + 43, SEED, world, true);
  assert.ok(phone.length >= 1);
});
