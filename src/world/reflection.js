import { WATER } from './world.js';

// A writer (see render/cells.js) that draws a sprite upside down below the
// row it stands on, but only where that lands on water. Because the mirror
// line is the sprite's own base, a tree a few rows back from the shore
// correctly shows only the part of its reflection that reaches the lake.
export function reflector() {
  return (r, sx, sy, g, cr, cg, cb, base) => {
    const ty = 2 * base - sy + 1;
    if (sx < 0 || ty < 0 || sx >= r.cols || ty >= r.rows) return;
    const m = ty * r.cols + sx;
    if (r.mask[m] !== WATER) return;

    // Dim the reflection and pull it toward the colour of the night water.
    const o = m * 4;
    r.fg[o] = cr * 0.4 + 8;
    r.fg[o + 1] = cg * 0.4 + 12;
    r.fg[o + 2] = cb * 0.4 + 24;
    r.fg[o + 3] = g;
  };
}
