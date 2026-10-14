import { valueNoise } from '../core/noise.js';
import { hash2 } from '../core/rng.js';
import { ASPECT } from './world.js';

// Night greens against the near-black ground, kept a step below rocks and
// trees so the meadow reads as background: blue-green fine blades, leafy
// tufts, curved emerald grass, seed heads, dry gold grass, and olive reeds.
export const PALETTES = [
  [38, 79, 61], [45, 84, 53], [38, 86, 57],
  [52, 83, 57], [67, 78, 52], [58, 78, 52],
];

// Wild flowers, by the number stored for a flowering root (0: none).
export const DAISY = 1;
export const BUTTERCUP = 2;
export const POPPY = 3;
export const CORNFLOWER = 4;
export const CLOVER = 5;
export const DANDELION = 6;
export const CLOCK = 7;
export const YARROW = 8;
export const FORGET_ME_NOT = 9;
export const BLUEBELL = 10;
export const LUPIN = 11;
export const FOXGLOVE = 12;
export const THISTLE = 13;
export const FLOWER_KINDS = 13;

// What else a root may carry instead of a flower (0: just its blades).
export const SEED_OAT = 1;
export const SEED_TIMOTHY = 3;
export const SEED_PLUME = 4;
export const SEED_RYE = 6;
export const CATTAIL = 7;
export const DEW = 8;
export const FERN = 9;

// Flowers grow where they would in a real meadow: low ones in short turf
// along paths, tall spikes in the lush grass, the damp-loving ones by the
// water. Each list is a weighted pick for a drift of one species.
const SHORT = [DAISY, DAISY, DAISY, BUTTERCUP, BUTTERCUP, CLOVER, CLOVER, DANDELION, CLOCK];
const FIELD = [DAISY, DAISY, POPPY, POPPY, CORNFLOWER, CORNFLOWER, YARROW, BUTTERCUP, THISTLE, CLOCK];
const LUSH = [LUPIN, LUPIN, FOXGLOVE, POPPY, CORNFLOWER, YARROW, DAISY, THISTLE, FOXGLOVE, POPPY];
const DAMP = [FORGET_ME_NOT, FORGET_ME_NOT, BUTTERCUP, BLUEBELL, BLUEBELL, FORGET_ME_NOT, DAISY];
const DRY = [THISTLE, YARROW, POPPY, YARROW, CLOCK, POPPY];
// Low flowers sit down among the blades; spikes need a tall stalk.
const LOW = new Set([BUTTERCUP, CLOVER, DANDELION, FORGET_ME_NOT]);
const TALL = new Set([LUPIN, FOXGLOVE]);

// Drifts are blobs around jittered points on a coarse grid, measured on
// the ground with the cell aspect corrected so they come out round.
const DRIFT = 24;

// Broad islands of grass, with soft, ragged edges and open ground between.
// The field retains about one fifth of roots, leaving full tufts inside
// each patch rather than scattering thin blades across the whole meadow.
export function patchAt(wx, wy, seed) {
  const n = valueNoise(wx * ASPECT * 0.045, wy * 0.045, seed + 1321);
  const u = Math.max(0, Math.min(1, (n - 0.66) / 0.14));
  return u * u * (3 - 2 * u);
}

// Blades grow in clumps. Small-scale noise thins the roots between them so
// the dark ground shows through in irregular gaps, as in a real meadow.
// Inside a clump the roots are only as dense as needed to fill it: more
// would just overdraw the same cells.
export function clumpAt(wx, wy, seed) {
  const n = valueNoise(wx * ASPECT * 0.42, wy * 0.42, seed + 1301) * 0.7 +
    valueNoise(wx * ASPECT * 0.13, wy * 0.13, seed + 1302) * 0.3;
  const u = Math.max(0, Math.min(1, (n - 0.3) / 0.16));
  return u * u * (3 - 2 * u) * 1.5;
}

const habitat = (style, height, elev) => style === 4 ? DRY : elev < 0.45 ? DAMP :
  height < 2.8 ? SHORT : height > 3.6 ? LUSH : FIELD;

// The wild flower, if any, at a ground cell. Two nearest drift centres
// decide it: inside a drift most flowers are its own species, with a few
// strays from the neighbouring drift; some drifts are a mixed sward.
export function flowerAt(wx, wy, seed, style, height, elev) {
  if (style === 5 || height < 2) return 0;
  const gx = wx * ASPECT + (valueNoise(wx * 0.05, wy * 0.08, seed + 1411) - 0.5) * 14;
  const gy = wy + (valueNoise(wx * 0.05, wy * 0.08, seed + 1412) - 0.5) * 14;
  const ix = Math.floor(gx / DRIFT);
  const iy = Math.floor(gy / DRIFT);
  let best = Infinity;
  let second = Infinity;
  let bx = 0;
  let by = 0;
  let sx = 0;
  let sy = 0;
  for (let y = iy - 1; y <= iy + 1; y++) {
    for (let x = ix - 1; x <= ix + 1; x++) {
      const px = (x + hash2(x, y, seed + 1413)) * DRIFT;
      const py = (y + hash2(x, y, seed + 1414)) * DRIFT;
      const d = (px - gx) ** 2 + (py - gy) ** 2;
      if (d < best) {
        second = best;
        sx = bx;
        sy = by;
        best = d;
        bx = x;
        by = y;
      } else if (d < second) {
        second = d;
        sx = x;
        sy = y;
      }
    }
  }
  // Richer drifts in some fields than in others, thinning to their edges,
  // and gathered within a drift into little colonies rather than sprinkled.
  const rich = hash2(bx, by, seed + 1415);
  const reach = DRIFT * (0.45 + rich * 0.35);
  const fall = Math.max(0, 1 - best / (reach * reach));
  const field = valueNoise(wx * ASPECT * 0.012, wy * 0.012, seed + 1416);
  const c = Math.max(0, Math.min(1, (valueNoise(wx * ASPECT * 0.3, wy * 0.3, seed + 1418) - 0.4) / 0.35));
  const colony = 0.2 + c * c * (3 - 2 * c) * 1.6;
  const list = habitat(style, height, elev);
  const pick = hash2(wx, wy, seed + 1402);
  let kind;
  // A third of the drifts are a mixed sward rather than one species.
  if (rich < 0.3 || fall === 0) kind = list[Math.floor(pick * list.length)];
  else {
    const own = list[Math.floor(hash2(bx, by, seed + 1417) * list.length)];
    const stray = list[Math.floor(hash2(sx, sy, seed + 1417) * list.length)];
    kind = pick < 0.8 ? own : pick < 0.93 ? stray : list[Math.floor(hash2(wx, wy, seed + 1403) * list.length)];
  }
  // Tall spikes stand further apart than the small flowers below them.
  const chance = (0.035 + fall * (0.09 + rich * rich * 0.6) * (0.5 + field) * colony) *
    (TALL.has(kind) ? 0.3 : 1);
  return hash2(wx, wy, seed + 1401) < chance ? kind : 0;
}

// Terrain is immutable. Store only roots that actually grow a visible blade,
// in row order, so drawing never scans all the empty ground between them.
// Everything about a root that does not move is settled here, once per
// chunk: its height, its flower or seed head, and its own shade of green,
// which drifts from clump to clump so neighbouring tufts differ.
export function grassRoots(chunk, seed, size) {
  const roots = [];
  const present = new Uint8Array(size * size);
  const rows = new Uint16Array(size + 1);
  const heights = [];
  const variations = [];
  const flowers = [];
  const extras = [];
  const tones = [];
  for (let y = 0; y < size; y++) {
    rows[y] = roots.length;
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const style = chunk.grassStyle[i];
      const wx = chunk.cx * size + x;
      const wy = chunk.cy * size + y;
      const grass = chunk.grassHeight[i];
      // Burnt ground keeps only its stubble and ash.
      if (chunk.burnt?.[i] || grass < 2) continue;
      // Flowers and reeds share the islands, so gaps stay visibly open.
      // Reject bare ground before the more expensive habitat lookups.
      if (hash2(wx, wy, seed + 1322) >= patchAt(wx, wy, seed)) continue;
      const elev = chunk.elev?.[i] ?? 0.55;
      const flower = flowerAt(wx, wy, seed, style, grass, elev);
      const density = chunk.grassDensity[i] * (style === 1 ? 0.72 : style === 4 ? 0.85 : 1) *
        clumpAt(wx, wy, seed);
      // Flowers grow mostly within the clumps; a few stand alone in the
      // gaps between them.
      if (chunk.rnd[i] < 1 - density && (!flower || hash2(wx, wy, seed + 1404) > 0.3)) continue;
      const variation = hash2(wx, wy, seed + 1217);
      let height = Math.min(5, Math.floor(grass + hash2(wx, wy, seed + 1101)));
      if (LOW.has(flower)) height = Math.min(height, 2 + (variation > 0.6));
      else if (TALL.has(flower)) height = Math.max(4, Math.min(5, height + 1));
      roots.push(i);
      present[i] = 1;
      heights.push(height);
      variations.push(variation);
      flowers.push(flower);
      extras.push(flower ? 0 : extraAt(wx, wy, seed, style, height, elev, chunk.shade?.[i] ?? 0.5, variation));
      // Clump-sized patches run a little brighter or darker, warmer or
      // cooler, so the meadow is not one flat green.
      const [r, g, b] = PALETTES[style];
      const bright = 0.84 + valueNoise(wx * ASPECT * 0.11, wy * 0.11, seed + 1430) * 0.32;
      const warm = (valueNoise(wx * ASPECT * 0.04, wy * 0.04, seed + 1431) - 0.5) * 18;
      tones.push((r + warm) * bright, (g + warm * 0.2) * bright, (b - warm * 0.6) * bright);
    }
  }
  rows[size] = roots.length;
  return { rows, present, indices: Uint16Array.from(roots), heights: Uint8Array.from(heights),
    variations: Float64Array.from(variations), flowers: Uint8Array.from(flowers),
    extras: Uint8Array.from(extras), tones: Float32Array.from(tones) };
}

// Seed heads on the seeding grasses, cattails on the reeds, ferns in damp
// shaded hollows near water, and dew on a scattering of the rest. A root's
// variation picks them, as it does the lean of its blade.
export function extraAt(wx, wy, seed, style, height, elev, shade, variation = hash2(wx, wy, seed + 1217)) {
  const kind = hash2(wx, wy, seed + 1422);
  if (style === 5) return height >= 4 && variation > 0.6 ? CATTAIL : variation < 0.05 ? DEW : 0;
  if (elev < 0.5 && height >= 3 && shade < 0.52 && variation < 0.35 &&
    valueNoise(wx * ASPECT * 0.06, wy * 0.06, seed + 1423) > 0.62) return FERN;
  const seeding = style === 3 ? 0.5 : style === 4 ? 0.32 : 0.05;
  if (variation > 1 - seeding && height >= 3) {
    if (style === 4) return kind < 0.6 ? SEED_RYE : SEED_PLUME + (kind > 0.8);
    return SEED_OAT + Math.floor(kind * 6);
  }
  return kind > 0.95 ? DEW : 0;
}
