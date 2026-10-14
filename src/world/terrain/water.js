// Open water: drifting swell, depth and lapping foam at the bank.

import { valueNoise } from '../../core/noise.js';
import { glyph } from '../../render/glyphs.js';
import { FOAM, SWELL, WATER_DEEP, WATER_SHALLOW } from '../../render/palette.js';
import { ASPECT, WATER_LEVEL } from '../world.js';
import { emit } from './cell.js';

const WAVE_HI = glyph('≈');
const WAVE_MID = glyph('~');
const WAVE_LO = glyph('-');
const WAVE_DOT = glyph('·');

export function animated() {
  return true;
}

export function shade(out, o, chunk, i, wx, wy, seed, t, wind = 0) {
  const rnd = chunk.rnd[i];
  let ch = 0;
  // Long horizontal streaks that drift slowly, like moonlight broken up
  // by a gentle swell.
  const depth = Math.min(1, (WATER_LEVEL - chunk.elev[i]) * 12);
  const v = valueNoise(wx * ASPECT * 0.09 + t * 0.25, wy * 0.7 - t * 0.05, seed + 300) +
    Math.sin(wx * ASPECT * 0.4 + wy * 1.3 + t * 1.2) * 0.12 +
    wind * Math.sin(wx * ASPECT * 0.7 + wy * 0.9 + t * 2.7) * 0.14;
  if (v > 0.74) ch = WAVE_HI;
  else if (v > 0.63) ch = WAVE_MID;
  else if (v > 0.53) ch = WAVE_LO;
  else if (v > 0.47 && rnd < 0.4) ch = WAVE_DOT;
  const k = (0.3 + Math.max(0, v - 0.47) * 2.2) * (1 - depth * 0.3);
  let cr = SWELL[0] * k;
  let cg = SWELL[1] * k;
  let cb = SWELL[2] * k;
  // Thin lapping foam right where the water meets the shore.
  if (depth < 0.07) {
    const lap = Math.sin(t * 1.8 + wx * ASPECT * 0.5 + rnd * 2);
    ch = lap > 0.1 ? WAVE_MID : WAVE_LO;
    const f = 0.6 + 0.4 * Math.max(0, lap);
    cr = FOAM[0] * f;
    cg = FOAM[1] * f;
    cb = FOAM[2] * f;
  }
  emit(out, o, ch, cr, cg, cb,
    WATER_DEEP[0] + (WATER_SHALLOW[0] - WATER_DEEP[0]) * (1 - depth),
    WATER_DEEP[1] + (WATER_SHALLOW[1] - WATER_DEEP[1]) * (1 - depth),
    WATER_DEEP[2] + (WATER_SHALLOW[2] - WATER_DEEP[2]) * (1 - depth));
}
