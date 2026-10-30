// The floor of a bog beneath its sedge (see world/bogs.js): the meadow's
// litter gone dark and olive with peat, clumps of moss, patches of wet soil
// and the odd pale glint of standing water. It never twinkles, so it is shaded
// once per chunk. Burnt bog chars and ashes like the meadow.

import { valueNoise } from '../../core/noise.js';
import { hash2 } from '../../core/rng.js';
import { over } from '../../render/glyphs.js';
import { NIGHT } from '../../render/palette.js';
import { ASPECT } from '../world.js';
import { emit } from './cell.js';
import * as meadow from './meadow.js';
import { fam, pick } from './surface.js';

const LITTER = fam('terrain.litter.');
const SOIL = fam('terrain.soil.');
const MOSS = fam('moss.');
const SPECK = fam('speck.');

const PEAT_C = [[44, 46, 28], [50, 44, 30], [38, 48, 32]];
const MOSS_C = [34, 66, 44];
const SOIL_C = [70, 58, 40];
const GLINT_C = [120, 126, 128];

export const animated = () => false;

export function shade(out, o, chunk, i, wx, wy, seed, t) {
  if (chunk.burnt?.[i]) {
    meadow.shade(out, o, chunk, i, wx, wy, seed, t);
    return;
  }
  const shadeV = chunk.shade[i];
  const rnd = chunk.rnd[i];
  const r1 = hash2(wx, wy, seed + 9301);
  const r2 = hash2(wx, wy, seed + 9302);
  const l = 0.3 + shadeV * shadeV * 0.35;
  const c = PEAT_C[Math.floor(rnd * 997) % PEAT_C.length];
  let g = pick(LITTER, r1);
  let cr = c[0] * l;
  let cg = c[1] * l;
  let cb = c[2] * l;
  let og = 0;
  let col = MOSS_C;
  let m = 0;
  // Moss grows in clumps over about a fifth of the floor.
  const clump = valueNoise(wx * ASPECT * 0.09, wy * 0.09, seed + 9303);
  if (clump > 0.6 && r2 < 0.25 + (clump - 0.6) * 2) {
    og = over(pick(MOSS, rnd));
    m = 0.4 + rnd * 0.3;
  } else if (r2 > 0.9) {
    g = pick(SOIL, r1);
    const s = 0.4 + rnd * 0.2;
    cr = SOIL_C[0] * s;
    cg = SOIL_C[1] * s;
    cb = SOIL_C[2] * s;
  } else if (r2 > 0.885) {
    og = over(pick(SPECK, rnd));
    col = GLINT_C;
    m = 0.45 + rnd * 0.2;
  }
  emit(out, o, g, cr, cg, cb, NIGHT[0], NIGHT[1], NIGHT[2], og, col[0] * m, col[1] * m, col[2] * m);
}
