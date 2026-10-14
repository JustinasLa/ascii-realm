// The floor of the meadow beneath the animated blades (see world/grass.js).

import { glyph } from '../../render/glyphs.js';
import { NIGHT } from '../../render/palette.js';
import { emit } from './cell.js';

const G = (s) => [...s].map(glyph);

const STUBBLE = G(`',"\``);
const ASH = G(".,:`'");
const DEW = glyph('.');
const STAR = glyph('*');
const GREENS = [
  [34, 92, 48],
  [46, 122, 62],
  [58, 140, 74],
  [74, 150, 70],
  [40, 108, 70],
];

// Dew drops twinkle, so their cells are reshaded every frame.
export function animated(chunk, i) {
  return chunk.rnd[i] > 0.985;
}

export function shade(out, o, chunk, i, wx, wy, seed, t) {
  const shadeV = chunk.shade[i];
  const rnd = chunk.rnd[i];
  // The same quiet undergrowth beneath every height, including verges.
  // Animated blades are drawn together later in rooted depth order; the
  // ground between their clumps stays near-black navy so they stand out.
  let ch = STUBBLE[Math.floor(rnd * 33) % STUBBLE.length];
  const tone = GREENS[Math.floor(rnd * 997) % GREENS.length];
  const l = 0.04 + shadeV * shadeV * 0.08;
  let cr = tone[0] * l;
  let cg = tone[1] * l;
  let cb = tone[2] * l;
  // A few cells hold a dew drop or tiny flower that twinkles.
  if (rnd > 0.985) {
    const tw = 0.6 + 0.4 * Math.sin(t * 3 + rnd * 977);
    ch = rnd > 0.996 ? STAR : DEW;
    cr = 200 * tw;
    cg = 215 * tw;
    cb = 200 * tw;
  }
  let br = NIGHT[0];
  let bgG = NIGHT[1];
  let bb = NIGHT[2];
  const burnt = (chunk.burnt?.[i] ?? 0) / 255;
  if (burnt > 0) {
    // A charcoal and ash centre fades into short, browned grass at
    // the ragged edge. Dew and flowers disappear with the blades.
    const family = burnt > 0.6 ? ASH : STUBBLE;
    ch = family[Math.floor(rnd * family.length)];
    const ash = 0.7 + rnd * 0.3;
    cr += (78 * ash - cr) * burnt;
    cg += (64 * ash - cg) * burnt;
    cb += (52 * ash - cb) * burnt;
    br += (8 - br) * burnt;
    bgG += (6 - bgG) * burnt;
    bb += (4 - bb) * burnt;
  }
  emit(out, o, ch, cr, cg, cb, br, bgG, bb);
}
