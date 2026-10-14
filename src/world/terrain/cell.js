// Terrain shaders write one ground cell into cached buffers laid out like
// the renderer's (see render/renderer.js): `fg` and `ov` hold rgb plus the
// low byte of a base glyph and of an optional glyph layered over it, and
// `bg` holds the ground colour plus the high bits of both glyphs.

import { GLYPH_MASK } from '../../render/glyphs.js';

// og = 0 leaves the cell without a layered glyph.
export function emit(out, o, g, r, gg, b, br, bgG, bb, og = 0, or = 0, ogG = 0, ob = 0) {
  const { fg, bg, ov } = out;
  g &= GLYPH_MASK;
  og &= GLYPH_MASK;
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
