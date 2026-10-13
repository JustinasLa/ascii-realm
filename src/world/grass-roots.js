import { hash2 } from '../core/rng.js';

// Terrain is immutable. Store only roots that actually grow a visible blade,
// in row order, so drawing never scans all the empty ground between them.
export function grassRoots(chunk, seed, size) {
  const roots = [];
  const rows = new Uint16Array(size + 1);
  const heights = [];
  const variations = [];
  for (let y = 0; y < size; y++) {
    rows[y] = roots.length;
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const style = chunk.grassStyle[i];
      const density = chunk.grassDensity[i] * (style === 1 ? 0.72 : style === 4 ? 0.85 : 1);
      if (chunk.grassHeight[i] < 2 || chunk.rnd[i] < 1 - density) continue;
      const wx = chunk.cx * size + x;
      const wy = chunk.cy * size + y;
      roots.push(i);
      heights.push(Math.min(5, Math.floor(chunk.grassHeight[i] + hash2(wx, wy, seed + 1101))));
      variations.push(hash2(wx, wy, seed + 1217));
    }
  }
  rows[size] = roots.length;
  return { rows, indices: Uint16Array.from(roots), heights: Uint8Array.from(heights),
    variations: Float64Array.from(variations) };
}
