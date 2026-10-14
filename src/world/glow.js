import { dg } from '../render/glyphs.js';

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
}

// A soft round halo around the cell at sx, sy: the eight neighbours take a
// slice of a drawn glow, coloured as the ground plus the light so it only
// ever brightens; every cell in the block is lifted a little as well. The
// centre cell is left for the light's own glyph.
export function halo(r, sx, sy, k, cr, cg, cb) {
  if (k <= 0.01) return;
  for (let i = 0; i < 9; i++) {
    const x = sx + (i % 3) - 1;
    const y = sy + Math.floor(i / 3) - 1;
    if (x < 0 || y < 0 || x >= r.cols || y >= r.rows) continue;
    const cell = y * r.cols + x;
    const o = cell * 4;
    lighten(r, o, k * (i === 4 ? 0.3 : 0.12), cr, cg, cb, 0.5);
    if (i === 4) continue;
    softLayer(r, cell, HALO[i], r.bg[o] + cr * k, r.bg[o + 1] + cg * k, r.bg[o + 2] + cb * k);
  }
}

// The glyph for a point at a fractional position within its cell, picked
// from nine drawn at a 3x3 grid of places.
export function subGlyph(set, x, y) {
  const fx = x - Math.floor(x);
  const fy = y - Math.floor(y);
  return set[Math.min(2, Math.floor(fx * 3)) + 3 * Math.min(2, Math.floor(fy * 3))];
}
