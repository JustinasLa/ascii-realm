// Bog ground: the last layer painted on a chunk's terrain. Inside a bog
// province (see provinces.js), meadow cells well away from its border become
// BOG, with a ragged margin where the meadow gives way. It is a drawing layer
// only: props, veins and groves read the land as it lay before it.

import { valueNoise } from '../core/noise.js';
import { hash2 } from '../core/rng.js';
import { ASPECT, BOG, GRASS } from './world.js';

// The probe ring radii, in metres, that measure how far inside a bog a cell is.
const STEPS = [2, 4, 6, 8, 10, 12];
// Sedge, the bog's own olive grass style (see grass-roots.js PALETTES).
export const SEDGE = 6;

// How far inside its bog a cell is, in ground metres: the largest probe ring
// in STEPS, tried from the smallest up, that stays inside the province, or 0.
// Cells deep inside skip the rings their province's seed gap already vouches for.
export function bogDepth(provinces, id, x, y) {
  provinces.lookup(x, y);
  const safe = provinces.safeRadius();
  let e = 0;
  for (const r of STEPS) {
    if (r > safe && !provinces.ringInside(id, x, y, r)) break;
    e = r;
  }
  return e;
}

const smoothRange = (a, b, x) => {
  const u = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

// How wet a cell is, 0 at the margin to 1 deep inside: noise frays the margin
// over 3–9 m, and no cell within 3 m of the border is wet at all.
export const wetness = (e, x, y, seed) => smoothRange(3, 9, e - 3 * valueNoise(x * ASPECT * 0.02, y * 0.02, seed + 9201));

// How finely depth is measured, in columns and rows: about 0.4 m by 0.3 m,
// far finer than its 2 m steps. The lattice is the world's, so chunks agree.
const LATTICE_X = 8;
const LATTICE_Y = 2;

// Paints BOG over the chunk's meadow inside a bog province. Returns null when
// no bog reaches the chunk, which a 3×3 lattice of lookups settles for most;
// otherwise each cell's wetness (0–255) and the land before the bog.
export function paintBog(world, cx, cy, size, type, land) {
  const provinces = world.provinces;
  let any = false;
  for (let j = 0; j < 3 && !any; j++) {
    for (let k = 0; k < 3 && !any; k++) {
      any = provinces.terrain(provinces.idAt(cx * size + k * (size >> 1), cy * size + j * (size >> 1))) === 'bog';
    }
  }
  if (!any) return null;
  const wet = new Uint8Array(size * size);
  const before = land ?? type.slice();
  const cols = size / LATTICE_X;
  const depth = new Uint8Array(cols * (size / LATTICE_Y));
  for (let q = 0; q < depth.length; q++) {
    const x = cx * size + (q % cols) * LATTICE_X + (LATTICE_X >> 1);
    const y = cy * size + Math.floor(q / cols) * LATTICE_Y;
    const id = provinces.idAt(x, y);
    depth[q] = provinces.terrain(id) === 'bog' ? bogDepth(provinces, id, x, y) : 0;
  }
  for (let i = 0; i < wet.length; i++) {
    const lx = i % size;
    const ly = Math.floor(i / size);
    const e = depth[Math.floor(ly / LATTICE_Y) * cols + Math.floor(lx / LATTICE_X)];
    if (!e) continue;
    const w = wetness(e, cx * size + lx, cy * size + ly, world.seed);
    wet[i] = Math.round(w * 255);
    if (type[i] === GRASS && w > 0.5) type[i] = BOG;
  }
  return { wet, land: before };
}

// The grass style of a cell in a bog's band: mostly sedge on the bog, and
// sedge thinning out into the meadow's own species across its margin.
export function bogStyle(style, t, w, x, y, seed) {
  return hash2(x, y, seed + 9202) < w + (t === BOG ? 0.35 : 0) ? SEDGE : style;
}
