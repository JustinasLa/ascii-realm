// Terrain shaders write one ground cell into cached buffers laid out like
// the renderer's (see render/renderer.js): `fg` and `ov` hold rgb plus the
// low byte of a base glyph and of an optional glyph layered over it, and
// `bg` holds the ground colour plus the high bits of both glyphs.
//
// The renderer does not paint cells in, so ground is drawn with characters
// alone: a lit surface (a slab of rock, a packed path) becomes characters
// whose weight follows its brightness, a mark darker than the surface under
// it (a joint, a crack) becomes the gap between them, and each cell shows a
// single character. Dim ground stays night.

import { glyph, GLYPH_MASK } from '../../render/glyphs.js';

const levels = (...sets) => sets.map((s) => [...s].map(glyph));
// The ground is a backdrop: it stops at light letters and leaves the heavy
// characters (O0Q, 8&$, #@M) to rocks, trees and the people on it.
const FILL = levels('.', '.:', ':-', '-=+', 'co', 'aeu');
// Ground at least this bright (luma 0..255) is drawn as a filled surface.
const FILL_FROM = 34;
const FILL_TO = 150;
// Characters cover a fraction of their cell, so they carry a brighter
// colour than the fill they stand for.
const INK = 0.9;
const SUBTLE = 1.5;

const luma = (r, g, b) => r * 0.3 + g * 0.59 + b * 0.11;

// Ground shading is cached per chunk and the same chunk layout repeats, so
// the shaders say which world cell they shade to vary the fill characters.
let place = 0;
export function atCell(wx, wy) {
  place = Math.imul(wx, 0x27d4eb2d) ^ Math.imul(wy, 0x165667b1);
}

// og = 0 leaves the cell without a layered glyph.
export function emit(out, o, g, r, gg, b, br, bgG, bb, og = 0, or = 0, ogG = 0, ob = 0) {
  const { fg, bg, ov } = out;
  g &= GLYPH_MASK;
  og &= GLYPH_MASK;
  const ground = luma(br, bgG, bb);
  let seam = false;
  if (og && luma(or, ogG, ob) < ground * 0.85) og = 0;
  if (g && luma(r, gg, b) < ground * 0.85) {
    g = 0;
    seam = true;
  }
  // On a lit surface, a mark only a little brighter than the ground was
  // texture painted on its fill; the fill's own characters replace it.
  // Clearly brighter marks (glints, pebbles, moss, petals) stay.
  if (ground > FILL_FROM) {
    if (og && luma(or, ogG, ob) < ground * SUBTLE) og = 0;
    if (g && luma(r, gg, b) < ground * SUBTLE) g = 0;
  }
  if (og) {
    // The mark on top wins: one character per cell.
    g = og;
    r = or;
    gg = ogG;
    b = ob;
    og = 0;
  } else if (!g && !seam && ground > FILL_FROM) {
    const v = Math.min(0.999, (ground - FILL_FROM) / (FILL_TO - FILL_FROM));
    const level = FILL[Math.floor(v * FILL.length)];
    const h = Math.imul(place ^ o, 0x9e3779b1) >>> 0;
    g = level[(h >>> 7) % level.length];
    r = br * INK;
    gg = bgG * INK;
    b = bb * INK;
  }
  fg[o] = r;
  fg[o + 1] = gg;
  fg[o + 2] = b;
  fg[o + 3] = g & 255;
  bg[o] = br;
  bg[o + 1] = bgG;
  bg[o + 2] = bb;
  bg[o + 3] = (g >> 8) | ((og >> 8) << 4);
  ov[o] = or;
  ov[o + 1] = ogG;
  ov[o + 2] = ob;
  ov[o + 3] = og & 255;
}

// A surface whose texture glyph carries its lit colour (rock, a packed
// path): the texture becomes a character weighted by that colour, unless
// a brighter mark is layered on it (moss, a pebble, a glint of mica).
const SURFACE = levels(' ', '.', '.:', ':-', '=+', 'oc', 'aeu');
const SURFACE_FROM = 22;
const SURFACE_TO = 128;

export function surface(out, o, r, gg, b, br, bgG, bb, og = 0, or = 0, ogG = 0, ob = 0) {
  const lit = luma(r, gg, b);
  if (og && luma(or, ogG, ob) > lit * 1.1) {
    emit(out, o, og, or, ogG, ob, br, bgG, bb);
    return;
  }
  const v = Math.max(0, Math.min(0.999, (lit - SURFACE_FROM) / (SURFACE_TO - SURFACE_FROM)));
  const level = SURFACE[Math.floor(v * SURFACE.length)];
  const h = Math.imul(place ^ o, 0x9e3779b1) >>> 0;
  emit(out, o, level[(h >>> 7) % level.length], r * 0.9, gg * 0.9, b * 0.9, 0, 0, 0);
  out.bg[o] = br;
  out.bg[o + 1] = bgG;
  out.bg[o + 2] = bb;
}

