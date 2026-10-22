// Worn earth along the paths: a packed crown between two wheel ruts, loose
// soil and gravel on the shoulders, prints of boots and hooves, patches of
// dried, cracked mud, the odd puddle in a rut, and grass and clover creeping
// in from the verges.

import { fbm, valueNoise } from '../../core/noise.js';
import { hash2 } from '../../core/rng.js';
import { dg, over } from '../../render/glyphs.js';
import { NIGHT } from '../../render/palette.js';
import { ASPECT } from '../world.js';
import { surface } from './cell.js';
import { clamp01, fam, headingIndex, lineCell, LX, LY, pick } from './surface.js';

// The path noise in world.js: cells within PATH_HALF of the middle of the
// noise are path.
const PATH_HALF = 0.009;
// Ruts run this far across from the middle, as a fraction of the half width.
const RUT_AT = 0.42;
// Half width of a rut, in world units.
const RUT_W = 0.65;

const PRINT = fam('terrain.print.');
const HOOF = fam('terrain.hoof.');
const CHIPS = fam('terrain.chips.');
const PEBBLE = fam('pebble.');
const GRAVEL = fam('gravel.');
const TUFT = ['tuft.0', 'tuft.1', 'tuft.2', 'tuft.3'].map(dg);
const CLOVER = fam('clover.');
const LEAF = fam('leaf.');
const GLINT = dg('sparkle.2');

// Earth under moonlight: a dusky brown ground with paler, warmer crumbs.
const EARTH = [36, 26, 23];
const SOIL_C = [132, 100, 70];
const STONES = [[118, 114, 120], [92, 88, 98], [132, 112, 90], [104, 96, 86]];
const GRASS_C = [42, 96, 56];
const CLOVER_C = [36, 86, 54];
const FINE = fam('terrain.fine.');

export function animated() {
  return false;
}

const pathNoise = (wx, wy, seed) => fbm(wx * ASPECT * 0.004, wy * 0.004, seed + 77, 3) - 0.5;

export function shade(out, o, chunk, i, wx, wy, seed) {
  const rnd = chunk.rnd[i];
  const r1 = hash2(wx, wy, seed + 4201);
  const r2 = hash2(wx, wy, seed + 4202);
  // Where the cell sits across the path, from the path noise and its slope.
  const v = pathNoise(wx, wy, seed);
  const gx = (pathNoise(wx + 1, wy, seed) - v) / ASPECT;
  const gy = pathNoise(wx, wy + 1, seed) - v;
  const grad = Math.hypot(gx, gy) || 1e-9;
  const nx = gx / grad;
  const ny = gy / grad;
  let u = v / PATH_HALF;
  // Painted dirt away from a path has no lanes, only loose soil.
  const lanes = Math.abs(u) < 1.1;
  if (!lanes) u = 0.75;
  const au = Math.abs(u);
  const half = PATH_HALF / grad;
  // World units from the nearer rut's centre line, signed along the normal.
  const rutOff = (u - Math.sign(u || 1) * RUT_AT) * half;
  const rut = lanes ? clamp01(1 - Math.abs(rutOff) / RUT_W) : 0;

  // Ground: a lighter packed crown, darker grooves, and the verges fading
  // into the meadow's night.
  const crown = clamp01(1 - au / 0.3);
  const verge = clamp01((au - 0.7) / 0.3);
  let k = 1 + crown * 0.18 - rut * 0.4 + (chunk.shade[i] - 0.5) * 0.3;
  // The groove's far wall faces the moon and catches a little light.
  const wall = rut > 0 && rut < 0.75 ? Math.sign(rutOff) * (nx * LX + ny * LY) : 0;
  if (wall < -0.2) k += 0.18;
  let br = EARTH[0] * k;
  let bgG = EARTH[1] * k;
  let bb = EARTH[2] * k;
  br += (NIGHT[0] - br) * verge * 0.7;
  bgG += (NIGHT[1] - bgG) * verge * 0.7;
  bb += (NIGHT[2] - bb) * verge * 0.7;

  const sk = (0.62 + rnd * 0.3) * (1 + crown * 0.12 - rut * 0.25) * (1 - verge * 0.3);
  let cr = SOIL_C[0] * sk;
  let cg = SOIL_C[1] * sk;
  let cb = SOIL_C[2] * sk;
  let og = 0;
  let or = 0;
  let og2 = 0;
  let ob = 0;
  const layer = (lg, c, m) => {
    og = over(lg);
    or = c[0] * m;
    og2 = c[1] * m;
    ob = c[2] * m;
  };

  // The walls of a rut as thin lines: the far wall, facing the moon, pale;
  // the near wall dark.
  const wallLine = (off, wnx, wny) => {
    if (!lanes || Math.abs(off) > RUT_W + 0.6) return false;
    for (const side of [-1, 1]) {
      const j = lineCell(wnx, wny, side * RUT_W * 0.8 - off);
      if (j < 0) continue;
      const facing = side * (wnx * LX + wny * LY);
      if (facing < -0.15) layer(FINE[j], SOIL_C, 0.55 + rnd * 0.15);
      else if (facing > 0.15) layer(FINE[j], [10, 7, 9], 1);
      else continue;
      return true;
    }
    return false;
  };
  const puddle = rut > 0.55 && valueNoise(wx * ASPECT * 0.3, wy * 0.3, seed + 4501) > 0.86;
  const mud = !puddle && au < 0.6 &&
    valueNoise(wx * ASPECT * 0.12, wy * 0.12, seed + 4502) > 0.72 + (r2 - 0.5) * 0.06 + au * 0.06;
  if (puddle) {
    // A film of water in the rut, catching a little moonlight.
    br *= 0.75;
    bgG *= 0.8;
    bb *= 1.1;
    cr = 64;
    cg = 78;
    cb = 118;
    if (r2 > 0.8) layer(GLINT, [190, 205, 235], 0.75);
  } else if (mud) {
    // Dried mud split into plates; the cracks show the dark ground.
    const m = 0.3 + rnd * 0.08;
    cr = SOIL_C[0] * m;
    cg = SOIL_C[1] * m;
    cb = SOIL_C[2] * m;
    br *= 0.75;
    bgG *= 0.75;
    bb *= 0.75;
    if (r2 < 0.06) layer(pick(PRINT, rnd), [12, 9, 10], 1);
  } else if (wallLine(rutOff, nx, ny)) {
    // A crisp wall of the groove (set by wallLine()).
  } else if (rut > 0.3) {
    // Wheel grooves are darker than the surrounding earth.
    cr *= 0.85;
    cg *= 0.85;
    cb *= 0.85;
    if (r2 < 0.05) layer(pick(GRAVEL, rnd), STONES[Math.floor(rnd * 4)], 0.6);
  } else if (lanes && au < 0.3 && r2 < 0.09) {
    // Prints along the crown: boots one way on one side, hooves the other.
    const forward = u > 0 ? 0 : 4;
    const head = (headingIndex(-ny, nx, 8, Math.PI * 2) + forward) % 8;
    layer(r1 < 0.65 ? PRINT[head] : HOOF[head], [14, 10, 11], 1);
  } else if (verge > 0) {
    // Grass and clover creeping in at the edges.
    const creep = verge * verge;
    if (r2 < creep * 0.55) layer(pick(TUFT, rnd), GRASS_C, 0.5 + rnd * 0.4);
    else if (r2 < creep * 0.8) layer(pick(CLOVER, rnd), CLOVER_C, 0.55 + rnd * 0.3);
  }

  if (og === 0 && !puddle) {
    // Loose stones: few on the packed crown, more on the shoulders.
    const loose = 0.05 + clamp01((au - 0.45) / 0.3) * 0.14 * (1 - verge) + (rut > 0.2 && rut < 0.6 ? 0.05 : 0);
    if (r2 > 1 - loose) {
      const c = STONES[Math.floor(rnd * 997) % STONES.length];
      const which = rnd * 3;
      layer(which < 1 ? pick(PEBBLE, r1) : which < 2 ? pick(GRAVEL, r1) : pick(CHIPS, r1), c, 0.55 + rnd * 0.3);
    } else if (r2 < 0.006) {
      layer(pick(LEAF, r1), [110, 80, 52], 0.55);
    }
  }
  surface(out, o, cr, cg, cb, br, bgG, bb, og, or, og2, ob);
}
