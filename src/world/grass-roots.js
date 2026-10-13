import { valueNoise } from '../core/noise.js';
import { hash2 } from '../core/rng.js';
import { ASPECT } from './world.js';

export const FLOWER_KINDS = 8;

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

// Terrain is immutable. Store only roots that actually grow a visible blade,
// in row order, so drawing never scans all the empty ground between them.
// A few roots in fuller grass carry a small flower instead of a seed head.
export function grassRoots(chunk, seed, size) {
  const roots = [];
  const rows = new Uint16Array(size + 1);
  const heights = [];
  const variations = [];
  const flowers = [];
  for (let y = 0; y < size; y++) {
    rows[y] = roots.length;
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const style = chunk.grassStyle[i];
      const wx = chunk.cx * size + x;
      const wy = chunk.cy * size + y;
      const flower = chunk.grassHeight[i] >= 2.4 && style < 4 && hash2(wx, wy, seed + 1401) < 0.04;
      const density = chunk.grassDensity[i] * (style === 1 ? 0.72 : style === 4 ? 0.85 : 1) *
        clumpAt(wx, wy, seed);
      if (chunk.grassHeight[i] < 2 || (!flower && chunk.rnd[i] < 1 - density)) continue;
      roots.push(i);
      heights.push(Math.min(5, Math.floor(chunk.grassHeight[i] + hash2(wx, wy, seed + 1101))));
      variations.push(hash2(wx, wy, seed + 1217));
      flowers.push(flower ? 1 + Math.floor(hash2(wx, wy, seed + 1402) * FLOWER_KINDS) : 0);
    }
  }
  rows[size] = roots.length;
  return { rows, indices: Uint16Array.from(roots), heights: Uint8Array.from(heights),
    variations: Float64Array.from(variations), flowers: Uint8Array.from(flowers) };
}
