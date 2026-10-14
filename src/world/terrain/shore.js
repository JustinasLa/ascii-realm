// The pebbly strip between meadow and lake.

import { glyph } from '../../render/glyphs.js';
import { PEBBLE_GAP, PEBBLES } from '../../render/palette.js';
import { emit } from './cell.js';

const SHORE_CH = [...'.,:;'].map(glyph);

export function animated() {
  return false;
}

export function shade(out, o, chunk, i) {
  const rnd = chunk.rnd[i];
  emit(out, o, SHORE_CH[Math.floor(rnd * SHORE_CH.length)], PEBBLES[0], PEBBLES[1], PEBBLES[2],
    PEBBLE_GAP[0], PEBBLE_GAP[1], PEBBLE_GAP[2]);
}
