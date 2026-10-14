// Rocky ground: a field of irregular slabs split by dark cracks.

import { hash2 } from '../../core/rng.js';
import { glyph } from '../../render/glyphs.js';
import { STONE_DARK, STONE_GAP, STONE_LIT, STONE_MID } from '../../render/palette.js';
import { ASPECT } from '../world.js';
import { emit } from './cell.js';

const SLAB = 4;
const SLAB_FAMILIES = [':;-', '+=xo', 'aedbqp', 'Q0O8&$', '@#%WM'].map((s) => [...s].map(glyph));
const CRACK_A = glyph('.');
const CRACK_B = glyph(',');

export function animated() {
  return false;
}

export function shade(out, o, chunk, i, wx, wy) {
  const shadeV = chunk.shade[i];
  const rnd = chunk.rnd[i];
  // Find the nearest two jittered seed points and draw a dark crack where
  // they tie.
  const px = wx * ASPECT;
  const gx = Math.floor(px / SLAB);
  const gy = Math.floor(wy / SLAB);
  let d1 = 1e9;
  let d2 = 1e9;
  let id = 0;
  let ox = 0;
  let oy = 0;
  for (let j = -1; j <= 1; j++) {
    for (let k = -1; k <= 1; k++) {
      const hx = (gx + k + hash2(gx + k, gy + j, 13)) * SLAB;
      const hy = (gy + j + hash2(gx + k, gy + j, 14)) * SLAB;
      const d = Math.hypot(px - hx, wy - hy);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id = hash2(gx + k, gy + j, 15);
        ox = px - hx;
        oy = wy - hy;
      } else if (d < d2) d2 = d;
    }
  }
  if (d2 - d1 < 0.3) {
    emit(out, o, rnd < 0.5 ? CRACK_A : CRACK_B, STONE_DARK[0], STONE_DARK[1], STONE_DARK[2],
      STONE_GAP[0], STONE_GAP[1], STONE_GAP[2]);
    return;
  }
  const l = Math.max(0, Math.min(0.999, 0.35 + id * 0.4 - (ox + oy) * 0.08 + shadeV * 0.2));
  const fam = SLAB_FAMILIES[Math.floor(l * SLAB_FAMILIES.length)];
  // Slabs facing the moon are lit toward a pale lavender; the rest sink
  // into blue-grey shade.
  const lit = l * l;
  const k = 0.45 + l * 0.75;
  emit(out, o, fam[Math.floor(rnd * 101) % fam.length],
    (STONE_MID[0] + (STONE_LIT[0] - STONE_MID[0]) * lit) * k,
    (STONE_MID[1] + (STONE_LIT[1] - STONE_MID[1]) * lit) * k,
    (STONE_MID[2] + (STONE_LIT[2] - STONE_MID[2]) * lit) * k,
    STONE_GAP[0], STONE_GAP[1], STONE_GAP[2]);
}
