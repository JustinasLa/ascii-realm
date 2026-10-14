import { valueNoise } from '../core/noise.js';
import { LAYER, MIRRORED, family } from '../render/glyphs.js';
import { REFLECTION_TINT } from '../render/palette.js';
import { FLOATING } from './terrain/water.js';
import { WATER } from './world.js';

// Moonlit wavelets that cross a reflection, drawn over the mirrored image.
const RIPPLE = family('water.line.');
const RIPPLE_COLOUR = [50, 66, 108];
const buffers = new WeakMap();

// A writer (see render/cells.js) that draws a sprite upside down below the
// row it stands on, but only where that lands on water. Because the mirror
// line is the sprite's own base, a tree a few rows back from the shore
// correctly shows only the part of its reflection that reaches the lake.
//
// The swell is measured in world cells, so the ripples stay on the water as
// the camera scrolls or zooms instead of sliding along with the screen.
export function reflector(t, view) {
  let prepared = null;
  let sums;
  let shifts;
  let lights;
  let noise;
  function prepare(r) {
    if (prepared === r) return;
    let buffer = buffers.get(r);
    const size = (r.cols + 1) * (r.rows + 1);
    if (!buffer || buffer.sums.length !== size || buffer.shifts.length !== r.rows) {
      buffer = { sums: new Uint32Array(size), shifts: new Int8Array(r.rows), lights: new Float32Array(r.rows),
        noise: new Float64Array(r.cols * r.rows) };
      buffers.set(r, buffer);
    }
    ({ sums, shifts, lights, noise } = buffer);
    // Every overlapping sprite samples the same swell at a water cell.
    // Resolve it lazily once this frame, retaining full numeric precision.
    noise.fill(NaN);
    sums.fill(0, 0, r.cols + 1);
    const stride = r.cols + 1;
    for (let y = 0; y < r.rows; y++) {
      const wy = y + view.y0;
      shifts[y] = Math.round(Math.sin(wy * 0.85 + t * 2.1) * 0.7 + Math.sin(wy * 0.31 - t * 1.3) * 0.5);
      // Rows on the face of a swell catch more light than those behind it,
      // so the image shimmers in bands as the swell rolls through.
      lights[y] = 0.8 + 0.32 * (0.5 + 0.5 * Math.sin(wy * 1.37 + t * 2.3)) + 0.1 * Math.sin(wy * 0.43 - t * 0.9);
      const row = (y + 1) * stride;
      sums[row] = 0;
      let count = 0;
      for (let x = 0; x < r.cols; x++) {
        count += r.mask[y * r.cols + x] === WATER ? 1 : 0;
        sums[row + x + 1] = sums[row - stride + x + 1] + count;
      }
    }
    prepared = r;
  }
  const write = (r, sx, sy, g, cr, cg, cb, base) => {
    const ty = 2 * base - sy + 1;
    if (ty < 0 || ty >= r.rows) return;
    prepare(r);
    const wy = ty + view.y0;
    // Each row of water sways sideways on two overlapping swells.
    const tx = sx + shifts[ty];
    if (tx < 0 || tx >= r.cols) return;
    const m = ty * r.cols + tx;
    // Water that cannot mirror: off the lake, or under a floating pad.
    if (r.mask[m] !== WATER || FLOATING[r.glyphAt(m)]) return;

    // Drifting gaps where the swell breaks the image up into slivers.
    let n = noise[m];
    if (Number.isNaN(n)) noise[m] = n = valueNoise((tx + view.x0) * 0.12 + t * 0.35, wy * 0.9, 5);
    if (n < 0.24) return;

    // Dimmer the further the reflected point is from the mirror line, a
    // little washed out, and pulled toward the colour of the night water.
    // Upside down, a drawn blade stroke leans the other way.
    const fade = Math.max(0.35, 1 - (base - sy) / 40) * 0.42 * lights[ty];
    const grey = (cr + cg + cb) * 0.1;
    let k = fade;
    // Where a wavelet crest crosses the image it shows through dimmer, with
    // the moonlit ripple drawn over it.
    const crest = n < 0.36 && !(g & LAYER);
    if (crest) k *= 0.7;
    r.putAt(m, MIRRORED[g], (cr * 0.7 + grey) * k + REFLECTION_TINT[0],
      (cg * 0.7 + grey) * k + REFLECTION_TINT[1],
      (cb * 0.7 + grey) * k + REFLECTION_TINT[2]);
    if (crest) {
      const c = 1.4 - n * 2;
      r.layerAt(m, RIPPLE[(((wy * 7 + ((tx + view.x0) >> 2)) % 3) + 3) % 3], RIPPLE_COLOUR[0] * c, RIPPLE_COLOUR[1] * c, RIPPLE_COLOUR[2] * c);
    }
  };
  // A summed water mask rejects whole blades/sprites before rasterisation.
  // Expand sideways for the swell; keep the object's own reflection base.
  write.visible = (r, x0, y0, x1, y1, base) => {
    const left = Math.max(0, Math.floor(x0) - 2);
    const right = Math.min(r.cols, Math.ceil(x1) + 3);
    const top = Math.max(0, Math.floor(2 * base - y1 + 1));
    const bottom = Math.min(r.rows, Math.ceil(2 * base - y0 + 1) + 1);
    if (left >= right || top >= bottom) return false;
    prepare(r);
    const stride = r.cols + 1;
    return sums[bottom * stride + right] - sums[top * stride + right] -
      sums[bottom * stride + left] + sums[top * stride + left] > 0;
  };
  return write;
}
