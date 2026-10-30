import { BLANK_GLYPH, dg, GLYPH_KIND, GLYPH_MASK } from '../render/glyphs.js';
import { BG_KEEP, NIGHT } from '../render/palette.js';

// Shared ways for effects to add light and haze over a finished cell
// without wiping out what is drawn there.

export const HALO = Array.from({ length: 9 }, (_, i) => dg(`effects.halo.${i}`));

// Layers a glyph over the cell only when the cell holds a single glyph, so
// a flower over grass is never pushed out by a passing effect. Returns
// whether the glyph went down.
export function softLayer(r, cell, g, cr, cg, cb) {
  if (r.hasLayer(cell)) return false;
  r.layerAt(cell, g, cr, cg, cb);
  return true;
}

// Layers a glyph as softLayer does (or over anything, if not `soft`), faded
// by `lit` (0..1) with no pop. A glyph the colour of the ground the screen
// shows between letters (the night tinted by the cell's ground, see BG_KEEP)
// cannot be seen, so the glyphs swap there: down to half the glyph sinks
// into that colour, and below that the cell keeps its own glyph, sunk as
// far and rising back as `lit` falls, so at 0 it is untouched. A cell where
// a glyph would also hide a sprite's small cells (a tree, a rock) or cut off
// a soft sprite's letter drifting in takes only the light, never the glyph:
// there it returns false. A blank glyph leaves the cell alone, as layerAt
// does.
export function fadeLayer(r, cell, g, cr, cg, cb, lit, soft = true) {
  const o = cell * 4;
  if ((soft && r.hasLayer(cell)) || GLYPH_KIND[g & GLYPH_MASK] === BLANK_GLYPH) return true;
  if (r.fineMark?.[cell] || (r.motionUsed && r.motion[o + 3] & 128)) return false;
  const { fg, bg } = r;
  const ground = (c) => NIGHT[c] + (bg[o + c] - NIGHT[c]) * BG_KEEP;
  if (lit < 0.5) {
    for (let c = 0; c < 3; c++) fg[o + c] += (ground(c) - fg[o + c]) * 2 * lit;
    return true;
  }
  const k = 2 * lit - 1;
  if (k < 1) [cr, cg, cb] = [ground(0) + (cr - ground(0)) * k, ground(1) + (cg - ground(1)) * k, ground(2) + (cb - ground(2)) * k];
  r.layerAt(cell, g, cr, cg, cb);
  return true;
}

// Lightens a cell toward a colour: k = 1 adds the full colour. The ground,
// glyph and any layered glyph all brighten together.
export function lighten(r, o, k, cr, cg, cb, ground = 0.2) {
  r.fg[o] += cr * k;
  r.fg[o + 1] += cg * k;
  r.fg[o + 2] += cb * k;
  r.ov[o] += cr * k;
  r.ov[o + 1] += cg * k;
  r.ov[o + 2] += cb * k;
  r.bg[o] += cr * k * ground;
  r.bg[o + 1] += cg * k * ground;
  r.bg[o + 2] += cb * k * ground;
  if (r.fineMark?.[o >> 2]) r.lightFine(o >> 2, cr * k, cg * k, cb * k, ground);
}

// Darkens a cell, as a shadow falling over it does: k = 1 is black. Its
// glyphs stay, so grass in the shade is still grass.
export function shade(r, o, k) {
  const keep = 1 - k;
  for (let c = 0; c < 3; c++) {
    r.fg[o + c] *= keep;
    r.ov[o + c] *= keep;
    r.bg[o + c] *= keep;
  }
  if (r.fineMark?.[o >> 2]) r.blendFine(o >> 2, keep, 0, 0, 0, 0, 0, 0, 0, 1);
}

// Blends a cell toward a colour, as a veil of mist or smoke does: the glyphs
// lose contrast and the ground takes the tint.
export function veil(r, o, k, cr, cg, cb, ground = 0.55) {
  const fg = r.fg;
  const ov = r.ov;
  const bg = r.bg;
  fg[o] += (cr - fg[o]) * k;
  fg[o + 1] += (cg - fg[o + 1]) * k;
  fg[o + 2] += (cb - fg[o + 2]) * k;
  ov[o] += (cr - ov[o]) * k;
  ov[o + 1] += (cg - ov[o + 1]) * k;
  ov[o + 2] += (cb - ov[o + 2]) * k;
  bg[o] += (cr * ground - bg[o]) * k;
  bg[o + 1] += (cg * ground - bg[o + 1]) * k;
  bg[o + 2] += (cb * ground - bg[o + 2]) * k;
  if (r.fineMark?.[o >> 2]) r.blendFine(o >> 2, 1, k, cr, cg, cb, 0, 0, 0, ground);
}

// A soft round halo around the cell at sx, sy: the eight neighbours take a
// slice of a drawn glow, coloured as the ground plus the light so it only
// ever brightens; every cell in the block is lifted a little as well. The
// centre cell is left for the light's own glyph. A light that fades in and
// out gives its `lit` (0..1), and its halo's glyphs fade with it (see
// fadeLayer).
export function halo(r, sx, sy, k, cr, cg, cb, lit) {
  if (k <= 0.01 * (lit ?? 1)) return;
  for (let i = 0; i < 9; i++) {
    const x = sx + (i % 3) - 1;
    const y = sy + Math.floor(i / 3) - 1;
    if (x < 0 || y < 0 || x >= r.cols || y >= r.rows) continue;
    const cell = y * r.cols + x;
    const o = cell * 4;
    lighten(r, o, k * (i === 4 ? 0.3 : 0.12), cr, cg, cb, 0.5);
    if (i === 4) continue;
    const colour = [r.bg[o] + cr * k, r.bg[o + 1] + cg * k, r.bg[o + 2] + cb * k];
    if (lit === undefined) softLayer(r, cell, HALO[i], ...colour);
    else fadeLayer(r, cell, HALO[i], ...colour, lit);
  }
}

// The glyph for a point at a fractional position within its cell, picked
// from nine drawn at a 3x3 grid of places.
export function subGlyph(set, x, y) {
  const fx = x - Math.floor(x);
  const fy = y - Math.floor(y);
  return set[Math.min(2, Math.floor(fx * 3)) + 3 * Math.min(2, Math.floor(fy * 3))];
}
