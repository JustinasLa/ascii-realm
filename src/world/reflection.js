import { valueNoise } from '../core/noise.js';
import { glyph } from '../render/glyphs.js';
import { WATER } from './world.js';

const RIPPLE = glyph('~');

// A writer (see render/cells.js) that draws a sprite upside down below the
// row it stands on, but only where that lands on water. Because the mirror
// line is the sprite's own base, a tree a few rows back from the shore
// correctly shows only the part of its reflection that reaches the lake.
//
// The swell is measured in world cells, so the ripples stay on the water as
// the camera scrolls or zooms instead of sliding along with the screen.
export function reflector(t, view) {
  return (r, sx, sy, g, cr, cg, cb, base) => {
    const ty = 2 * base - sy + 1;
    const wy = ty + view.y0;
    // Each row of water sways sideways on two overlapping swells.
    const tx = sx + Math.round(Math.sin(wy * 0.85 + t * 2.1) * 0.7 + Math.sin(wy * 0.31 - t * 1.3) * 0.5);
    if (tx < 0 || ty < 0 || tx >= r.cols || ty >= r.rows) return;
    const m = ty * r.cols + tx;
    if (r.mask[m] !== WATER) return;

    // Drifting gaps where the swell breaks the image up into slivers.
    const n = valueNoise((tx + view.x0) * 0.12 + t * 0.35, wy * 0.9, 5);
    if (n < 0.24) return;
    if (n < 0.34) g = RIPPLE;

    // Dimmer the further the reflected point is from the mirror line, and
    // pulled toward the colour of the night water.
    const fade = Math.max(0.35, 1 - (base - sy) / 40) * 0.42;
    const o = m * 4;
    r.fg[o] = cr * fade + 8;
    r.fg[o + 1] = cg * fade + 12;
    r.fg[o + 2] = cb * fade + 24;
    r.fg[o + 3] = g;
  };
}
