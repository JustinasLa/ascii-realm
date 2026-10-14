// Worn earth along the paths.

import { glyph } from '../../render/glyphs.js';
import { PATH, PATH_GAP } from '../../render/palette.js';
import { emit } from './cell.js';

const DIRT_CH = [...'.:,`'].map(glyph);

export function animated() {
  return false;
}

export function shade(out, o, chunk, i) {
  const rnd = chunk.rnd[i];
  emit(out, o, DIRT_CH[Math.floor(rnd * DIRT_CH.length)], PATH[0], PATH[1], PATH[2],
    PATH_GAP[0], PATH_GAP[1], PATH_GAP[2]);
}
