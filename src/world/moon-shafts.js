import { valueNoise } from '../core/noise.js';
import { hash2 } from '../core/rng.js';
import { TILT } from '../entities/rig.js';
import { dg, over } from '../render/glyphs.js';
import { MOONLIGHT } from '../render/palette.js';
import { softLayer, subGlyph } from './glow.js';
import { MOON, worldNormal } from './surface-light.js';
import { ASPECT, CHUNK_SIZE, SHORE, WATER } from './world.js';

export { PEAK_LIFT, TINT } from './moon-tint.js';

// Moonbeams: here and there the moon reaches the meadow in a pale shaft.
// Where one lands the ground and the grass are brighter and paler (the
// patch, see night-light.js), and above it a faint column of lit air rises
// toward the moon, up the screen and to the left, with a few motes of dust
// sinking down it. Each beam belongs to a fixed slot of the world, so it is
// always in the same place, the same on every device, and never moves as
// you walk or zoom.
//
// A patch is three overlapping ellipses on the ground (its lobes, in row
// units like a tree's leaf masses), seen through the view's tilt, with
// edges broken by noise fixed to the world: lobed and soft, never a disc.

// The world is cut into slots this many cells across and rows deep; this
// share of them holds a beam, its patch in the slot's middle 60 %.
export const SLOT_W = 72;
export const SLOT_H = 48;
export const SHAFT_CHANCE = 0.5;
// The share of a lobe's radius over which its edge fades: a beam's edge is
// softer than a leaf shadow's.
export const SOFT = 0.55;
// How far the noise moves an edge, as a share of the radius.
export const EDGE_JITTER = 0.25;
// How uneven the light is inside a patch.
export const GRAIN = 0.15;
// Rows of height the column rises before it has faded out.
export const SHAFT_RISE = 32;
// The column's half-width, as a share of the patch's main radius.
export const COLUMN_CORE = 0.6;
// The most the column lightens a glyph, as a share of the moonlight.
export const COLUMN_PEAK = 0.3;
// How fast the column fades with height.
export const COLUMN_FALLOFF = 1.5;
// How much the column's light varies across it, in streaks along the beam.
export const STREAKS = 0.4;
// Rows of column per mote, and how fast, in rows a second, motes sink.
export const MOTE_GAP = 8;
export const MOTE_SPEED = 0.8;
// Slots remembered per world.
export const SHAFT_CACHE = 256;

// Cells across and rows down the column moves per row of height: toward
// the moon, the light the rocks and the grass are lit by (surface-light.js).
export const COLUMN_STEP = (() => {
  const [x, y, z] = worldNormal(...MOON);
  return [x / z / ASPECT, -1 + y / z * TILT];
})();

// What each kind of device shows: at most `max` beams at once, whether
// their columns are drawn and with how many motes, and how bright.
export const SHAFT_TIERS = {
  desktop: { max: 6, column: true, motes: 4, intensity: 1 },
  phone: { max: 4, column: true, motes: 2, intensity: 1 },
  reduced: { max: 2, column: false, motes: 0, intensity: 1 },
};
export const shaftTier = ({ phone, reduced }) => (!phone ? 'desktop' : reduced ? 'reduced' : 'phone');

const MOTES = Array.from({ length: 9 }, (_, i) => over(dg(`effects.mote.${i}`)));
// How far out, as a share of its radius, noise can carry an edge.
const REACH = 1 / (1 - EDGE_JITTER);
const D2 = new Float64Array(3);

const smoothstep = (a, b, x) => {
  const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a);
  return t * t * (3 - 2 * t);
};

// Each world's slots, for the seed they were made with.
const caches = new WeakMap();

function slotsOf(world, seed) {
  let cache = caches.get(world);
  if (!cache || cache.seed !== seed) {
    cache = { seed, slots: new Map() };
    caches.set(world, cache);
  }
  return cache.slots;
}

// The beam in slot (i, j), or null. { key, i, j, cx, cy, r, lobes, half,
// patch, box, reach, stamp, column }: the patch's centre in world cells and rows,
// its main radius in row units, its lobes (dx, dy, radius in row units
// from the centre), the column's half-width in cells, the patch's stamp
// bounds from Math.floor of the centre, and the world boxes (end
// exclusive) of the patch alone and of the patch with its column, and its
// stamps once baked (patchStamp, columnStamp).
// A slot whose ground the world has not loaded yet has none for now: it is
// decided once its chunk is loaded, so looking for beams never makes the
// world generate ground nobody sees.
export function shaftAt(i, j, seed, world) {
  const slots = slotsOf(world, seed);
  const key = i * 1048576 + j;
  let shaft = slots.get(key);
  if (shaft === undefined) {
    shaft = makeShaft(i, j, seed, world);
    if (shaft === undefined) return null;
    if (slots.size >= SHAFT_CACHE) slots.delete(slots.keys().next().value);
    slots.set(key, shaft);
  }
  return shaft;
}

function makeShaft(i, j, seed, world) {
  if (hash2(i, j, seed + 2290) >= SHAFT_CHANCE) return null;
  const cx = i * SLOT_W + SLOT_W * (0.2 + 0.6 * hash2(i, j, seed + 2291));
  const cy = j * SLOT_H + SLOT_H * (0.2 + 0.6 * hash2(i, j, seed + 2292));
  const fx = Math.floor(cx), fy = Math.floor(cy);
  if (world.loaded && !world.loaded(Math.floor(fx / CHUNK_SIZE), Math.floor(fy / CHUNK_SIZE))) return undefined;
  // Never on the water: a beam there would fight the moon's reflection.
  const type = world.typeAt(fx, fy);
  if (type === WATER || type === SHORE) return null;
  const r = 7 + 4 * hash2(i, j, seed + 2293);
  const lobes = new Float32Array(9);
  lobes[2] = r;
  for (let k = 1; k < 3; k++) {
    const angle = Math.PI * 2 * hash2(i * 3 + k, j, seed + 2294);
    const d = r * (0.45 + 0.25 * hash2(i, j * 3 + k, seed + 2294));
    lobes[k * 3] = Math.cos(angle) * d;
    lobes[k * 3 + 1] = Math.sin(angle) * d;
    lobes[k * 3 + 2] = r * (0.5 + 0.2 * hash2(i * 3 + k, j * 3 + k, seed + 2299));
  }
  const bx = fx, by = fy;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let k = 0; k < 3; k++) {
    const x = cx + lobes[k * 3] / ASPECT, y = cy + lobes[k * 3 + 1] * TILT;
    const ax = lobes[k * 3 + 2] / ASPECT * REACH, ay = lobes[k * 3 + 2] * TILT * REACH;
    minX = Math.min(minX, x - ax);
    maxX = Math.max(maxX, x + ax);
    minY = Math.min(minY, y - ay);
    maxY = Math.max(maxY, y + ay);
  }
  const patch = { x0: Math.floor(minX) - bx, y0: Math.floor(minY) - by };
  patch.w = Math.floor(maxX) - bx - patch.x0 + 1;
  patch.h = Math.floor(maxY) - by - patch.y0 + 1;
  const box = { x0: bx + patch.x0, y0: by + patch.y0, x1: bx + patch.x0 + patch.w, y1: by + patch.y0 + patch.h };
  const half = COLUMN_CORE * r / ASPECT;
  const [stepX, stepY] = COLUMN_STEP;
  const reach = {
    x0: Math.min(box.x0, Math.floor(cx + stepX * SHAFT_RISE - half * REACH)),
    y0: Math.min(box.y0, Math.floor(cy + stepY * SHAFT_RISE)),
    x1: Math.max(box.x1, Math.floor(cx + half * REACH) + 1),
    y1: box.y1,
  };
  return { key: `${i},${j}`, i, j, cx, cy, r, lobes, half, patch, box, reach, stamp: null, column: null };
}

const overlaps = (b, x0, y0, x1, y1) => b.x0 < x1 && b.x1 > x0 && b.y0 < y1 && b.y1 > y0;

// The beams whose patch (and column, with `columns`) reach into the world
// box x0..x1, y0..y1 (end exclusive), added to `out`. A patch and its
// column stay within a slot of their own.
export function shaftsNear(x0, y0, x1, y1, seed, world, columns = true, out = []) {
  for (let j = Math.floor(y0 / SLOT_H) - 1; j <= Math.floor((y1 - 1) / SLOT_H) + 1; j++) {
    for (let i = Math.floor(x0 / SLOT_W) - 1; i <= Math.floor((x1 - 1) / SLOT_W) + 1; i++) {
      const shaft = shaftAt(i, j, seed, world);
      if (shaft && overlaps(columns ? shaft.reach : shaft.box, x0, y0, x1, y1)) out.push(shaft);
    }
  }
  return out;
}

// A beam's patch, baked once and kept on the beam: { x0, y0, w, h, lift,
// work } in world cells and rows from Math.floor of its centre, lift as
// bytes of the full lift, 0 outside, and `work`, what baking it cost.
export function patchStamp(shaft, seed) {
  if (shaft.stamp) return shaft.stamp;
  const { cx, cy, lobes, patch: { x0, y0, w, h } } = shaft;
  const bx = Math.floor(cx), by = Math.floor(cy);
  const lx = [], ly = [], ax = [], ay = [];
  for (let k = 0; k < 3; k++) {
    lx.push(cx - bx + lobes[k * 3] / ASPECT);
    ly.push(cy - by + lobes[k * 3 + 1] * TILT);
    ax.push(lobes[k * 3 + 2] / ASPECT);
    ay.push(lobes[k * 3 + 2] * TILT);
  }
  const lift = new Uint8Array(w * h);
  for (let dy = 0; dy < h; dy++) {
    const py = y0 + dy + 0.5, wy = by + y0 + dy;
    for (let dx = 0; dx < w; dx++) {
      const px = x0 + dx + 0.5, wx = bx + x0 + dx;
      let near = Infinity;
      for (let k = 0; k < 3; k++) {
        const u = (px - lx[k]) / ax[k], v = (py - ly[k]) / ay[k];
        D2[k] = u * u + v * v;
        near = Math.min(near, D2[k]);
      }
      // Beyond every lobe's reach, however the noise moves its edge.
      if (near >= REACH * REACH) continue;
      const jitter = 1 + EDGE_JITTER * (2 * valueNoise(wx * ASPECT * 0.18, wy * 0.3, seed + 2289) - 1);
      // The lobes overlap softly: none of them adds light another already gave.
      let dark = 1;
      for (let k = 0; k < 3; k++) if (D2[k] < REACH * REACH) dark *= smoothstep(1 - SOFT, 1, Math.sqrt(D2[k]) * jitter);
      if (dark >= 1) continue;
      const lit = (1 - dark) * (1 - GRAIN + GRAIN * valueNoise(wx * ASPECT * 0.3, wy * 0.5, seed + 2297));
      lift[dy * w + dx] = Math.round(lit * 255);
    }
  }
  shaft.stamp = { x0, y0, w, h, lift, work: w * h * 3 };
  return shaft.stamp;
}

// A beam's column of air, baked once and kept on the beam: how much it
// lightens each cell (1 at full strength is COLUMN_PEAK of the moonlight),
// row by row from world row y0: row i's cells start at world cell x0[i] and
// are k[at[i]] .. k[at[i + 1] - 1]. `work` is what baking it cost.
export function columnStamp(shaft, seed) {
  if (shaft.column) return shaft.column;
  const [stepX, stepY] = COLUMN_STEP;
  const { cx, cy, half } = shaft;
  const y0 = Math.ceil(cy + stepY * SHAFT_RISE), y1 = Math.floor(cy);
  const n = Math.max(0, y1 - y0 + 1);
  const x0 = new Int32Array(n), at = new Int32Array(n + 1), values = [];
  for (let i = 0; i < n; i++) {
    const wy = y0 + i;
    // The row's height up the beam, from where it meets the ground.
    const height = Math.max(0, (cy - wy - 0.5) / -stepY);
    const fade = (1 - height / SHAFT_RISE) ** COLUMN_FALLOFF;
    const axis = cx + stepX * height;
    x0[i] = Math.floor(axis - half * REACH);
    const last = Math.floor(axis + half * REACH);
    for (let wx = x0[i]; wx <= last; wx++) {
      const across = wx + 0.5 - axis;
      const d = Math.abs(across) / half * (1 + EDGE_JITTER * (2 * valueNoise(wx * ASPECT * 0.2, wy * 0.25, seed + 2295) - 1));
      values.push(d >= 1 ? 0 : COLUMN_PEAK * fade * (1 - smoothstep(0.5, 1, d)) *
        (1 - STREAKS + STREAKS * valueNoise(across * ASPECT * 0.5, height * 0.08, seed + 2300)));
    }
    at[i + 1] = values.length;
  }
  shaft.column = { y0, x0, at, k: Float32Array.from(values), work: values.length * 2 };
  return shaft.column;
}

// Lightens the glyphs in a beam's column of air by `strength` (1 at full),
// all but the water's and the sprites': fixed to the world, it lies over the
// same cells however the view moves.
export function drawColumn(r, view, shaft, strength, seed) {
  const { y0, x0, at, k } = columnStamp(shaft, seed);
  const { fg, ov, mask, fineMark } = r;
  const cols = Math.min(view.cols, r.cols);
  const first = Math.max(0, view.y0 - y0), last = Math.min(x0.length, view.y0 + Math.min(view.rows, r.rows) - y0);
  const [mr, mg, mb] = MOONLIGHT;
  for (let i = first; i < last; i++) {
    const row = (y0 + i - view.y0) * r.cols - view.x0;
    const from = Math.max(x0[i], view.x0), to = Math.min(x0[i] + at[i + 1] - at[i], view.x0 + cols);
    for (let wx = from, j = at[i] + from - x0[i]; wx < to; wx++, j++) {
      const v = k[j];
      if (!v) continue;
      const cell = row + wx;
      if (mask[cell] === WATER || fineMark?.[cell]) continue;
      const kk = v * strength;
      const o = cell * 4;
      fg[o] += mr * kk;
      fg[o + 1] += mg * kk;
      fg[o + 2] += mb * kk;
      ov[o] += mr * kk;
      ov[o + 1] += mg * kk;
      ov[o + 2] += mb * kk;
    }
  }
}

// Where mote m of a beam is at `time`: { x, y, height, phase }.
export function motePosition(shaft, m, n, time, seed) {
  const [stepX, stepY] = COLUMN_STEP;
  const phase = (m + 0.6 * hash2(shaft.i * 7 + m, shaft.j, seed + 2296)) / n;
  const f = phase - time * MOTE_SPEED / SHAFT_RISE;
  const height = SHAFT_RISE * (f - Math.floor(f));
  const across = (hash2(shaft.i * 7 + m, shaft.j, seed + 2298) - 0.5) * 1.2 * shaft.half;
  return { x: shaft.cx + stepX * height + across, y: shaft.cy + stepY * height, height, phase };
}

// Lays a beam's `n` motes of dust over the scene, sinking down its column
// and now and then catching the moon. They never push out a glyph already
// layered there (a flower, a seed head).
export function drawMotes(r, view, shaft, n, strength, time, seed) {
  const { bg, mask, fineMark } = r;
  for (let m = 0; m < n; m++) {
    const { x, y, height, phase } = motePosition(shaft, m, n, time, seed);
    const sx = Math.floor(x) - view.x0, sy = Math.floor(y) - view.y0;
    if (sx < 0 || sy < 0 || sx >= Math.min(view.cols, r.cols) || sy >= Math.min(view.rows, r.rows)) continue;
    const cell = sy * r.cols + sx;
    if (mask[cell] === WATER || fineMark?.[cell]) continue;
    const glint = Math.max(0, Math.sin(time * 1.7 + phase * 997)) ** 12;
    const k = (0.35 + 0.5 * glint) * strength * (1 - height / SHAFT_RISE);
    const o = cell * 4;
    softLayer(r, cell, subGlyph(MOTES, x, y), bg[o] + (MOONLIGHT[0] - bg[o]) * k,
      bg[o + 1] + (MOONLIGHT[1] - bg[o + 1]) * k, bg[o + 2] + (MOONLIGHT[2] - bg[o + 2]) * k);
  }
}
