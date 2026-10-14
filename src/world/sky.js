import { valueNoise } from '../core/noise.js';
import { hash2 } from '../core/rng.js';
import { dg, family } from '../render/glyphs.js';
import { MOON, STARLIGHT } from '../render/palette.js';
import { FLOATING, SHEEN } from './terrain/water.js';
import { WATER } from './world.js';

// The sky is never drawn directly (the camera looks down at the ground), but
// it shows up mirrored in every lake. Things in the sky are infinitely far
// away, so their reflections stay put on screen while the world scrolls.
//
// The moon is a mottled face with craters and darker seas, cut into slivers
// by the swell, inside a soft halo; a column of glitter runs through it where
// the wavelets catch its light. Stars vary in size, colour and twinkle.
// Floating lily pads cover the sky beneath them.

// Bars by thickness, at the top or the bottom of a cell, and half bars that
// end at the moon's left or right limb.
const BAR = Array.from({ length: 4 }, (_, k) => [dg(`water.bar.${k}.0`), dg(`water.bar.${k}.1`)]);
const BAR_END = family('water.barend.');
const HAZE = family('water.haze.');
const GLITTER = family('water.glitter.');
export const STAR_GLYPHS = family('water.star.');

// Where the moon's reflection sits, as a fraction of the screen, and its
// radius in CSS pixels. Both are measured on the screen rather than in cells:
// the sky is so far away that zooming the camera must not move or resize it.
const MOON_X = 0.3;
const MOON_Y = 0.8;
const MOON_R = 90;
// The halo's reach and the glitter column's extent, in moon radii.
const HALO = 2;
const COLUMN_UP = 3.4;
const COLUMN_DOWN = 2.6;
const COLUMN_HALF = 0.55;

// Craters on the face, in moon radii from its middle, and their size.
const CRATERS = [
  [-0.38, -0.32, 0.2], [0.34, 0.22, 0.14], [0.05, -0.6, 0.1], [-0.52, 0.34, 0.12],
  [0.58, -0.22, 0.09], [0.2, 0.62, 0.1], [-0.08, 0.08, 0.08], [0.42, -0.55, 0.07],
];

// Stars are scattered on a fixed grid of screen pixels for the same reason.
const STAR_GRID = 26;
const STAR_TINTS = [STARLIGHT, [232, 214, 184], [168, 196, 255], STARLIGHT, STARLIGHT];
const starGrids = new WeakMap();

function starsOf(r, grid) {
  const pad = Math.ceil(Math.max(r.cellW, r.cellH) / grid) + 2;
  const cols = Math.ceil(r.canvas.width / grid) + pad * 2 + 1;
  const rows = Math.ceil(r.canvas.height / grid) + pad * 2 + 1;
  let cached = starGrids.get(r);
  if (cached?.cols === cols && cached.rows === rows && cached.pad === pad) return cached;
  const cells = new Array(cols * rows);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const gx = x - pad, gy = y - pad;
    const star = starAt(gx, gy);
    cells[y * cols + x] = star && { ...star,
      x: gx + hash2(gx, gy, 4243), y: gy + hash2(gx, gy, 4244) };
  }
  cached = { cells, cols, rows, pad };
  starGrids.set(r, cached);
  return cached;
}

// Which star glyph and colour a sky grid square holds, if it holds one.
export function starAt(gx, gy) {
  const h = hash2(gx, gy, 4242);
  if (h < 0.92) return null;
  const mag = hash2(gx, gy, 4245);
  return {
    h,
    glyph: STAR_GLYPHS[mag > 0.86 ? 2 : mag > 0.5 ? 1 : 0],
    bright: mag > 0.86 ? 1 : mag > 0.5 ? 0.8 : 0.65,
    tint: STAR_TINTS[Math.floor(hash2(gx, gy, 4246) * STAR_TINTS.length)],
  };
}

export function drawSkyReflection(r, view, t) {
  const { mask, cols, rows, cellW, cellH } = r;
  const moonX = r.canvas.width * MOON_X;
  const moonY = r.canvas.height * MOON_Y;
  const moonR = MOON_R * r.dpr;
  const grid = STAR_GRID * r.dpr;
  // Screen-anchored star positions do not change while the lake moves.
  const stars = starsOf(r, grid);
  const x0 = view.x0 ?? 0;
  const glitterTick = Math.floor(t * 5);
  for (let sy = 0; sy < rows; sy++) {
    // Each row of water wobbles sideways a little, breaking up the image.
    // The ripple belongs to the water, so it follows world rows.
    const wy = sy + view.y0;
    const wobble = Math.round(Math.sin(wy * 0.9 + t * 1.5) * 0.8);
    const py = (sy + 0.5) * cellH - view.offY;
    const dy = (py - moonY) / moonR;
    const top = sy * cellH - view.offY;
    const bottom = top + cellH;
    const gy0 = Math.floor(top / grid);
    const gy1 = Math.ceil(bottom / grid) - 1;
    const nearMoon = dy > -HALO && dy < HALO;
    const inColumn = dy > -COLUMN_UP && dy < COLUMN_DOWN;
    const columnHalf = COLUMN_HALF * (1 + Math.abs(dy) * 0.25);
    // How the swell slices this row of the moon: a gap, a cut or whole.
    const sliceRow = valueNoise(t * 0.5, py / r.dpr * 0.11, 91);
    for (let sx = 0; sx < cols; sx++) {
      const m = sy * cols + sx;
      if (mask[m] !== WATER || FLOATING[r.glyphAt(m)]) continue;
      const px = (sx + wobble + 0.5) * cellW - view.offX;
      const dx = (px - moonX) / moonR;
      if (nearMoon && dx > -HALO && dx < HALO && sky(r, m, dx, dy, px, py, sliceRow, t)) continue;
      if (inColumn && dx > -columnHalf && dx < columnHalf) glitter(r, m, dx, dy, sx + x0, wy, glitterTick, t);

      // A cell can straddle star-grid squares. Check every square it touches
      // so stars near their edges do not disappear as the view scrolls.
      const left = (sx + wobble) * cellW - view.offX;
      const right = left + cellW;
      const gx0 = Math.floor(left / grid);
      const gx1 = Math.ceil(right / grid) - 1;
      let found = false;
      for (let gy = gy0; gy <= gy1 && !found; gy++) {
        for (let gx = gx0; gx <= gx1; gx++) {
          const star = stars.cells[(gy + stars.pad) * stars.cols + gx + stars.pad];
          if (!star) continue;
          const starX = star.x * grid;
          const starY = star.y * grid;
          // Half-open bounds assign a star on an edge to exactly one cell.
          if (starX < left || starX >= right || starY < top || starY >= bottom) continue;
          const { h, tint } = star;
          let tw = (0.5 + 0.35 * Math.sin(t * (1.5 + h * 3) + h * 500)) * star.bright;
          // The brightest flash as a wavelet tips them toward the eye.
          if (star.bright === 1) tw *= 0.8 + 0.25 * Math.sin(t * 9 + h * 99);
          r.layerAt(m, star.glyph, tint[0] * tw, tint[1] * tw, tint[2] * tw);
          found = true;
          break;
        }
      }
    }
  }
}

// The moon and its halo. dx, dy are the offset from the moon's centre in
// moon radii; x, y the cell's position on screen in device pixels. Returns
// true when the cell shows the moon itself.
function sky(r, m, dx, dy, x, y, sliceRow, t) {
  const d2 = dx * dx + dy * dy;
  if (d2 > HALO * HALO) return false;
  const o = m * 4;
  if (d2 > 1) {
    // The halo: a soft glow in the water, broken into hazy bands.
    const d = Math.sqrt(d2);
    const glow = ((HALO - d) / (HALO - 1)) ** 2;
    const band = 0.5 + 0.3 * Math.sin(x * 0.045 / r.dpr + t * 0.6 + sliceRow * 9) + 0.2 * (sliceRow - 0.5);
    const k = glow * (0.5 + band * 0.7);
    r.bg[o] += 10 * k;
    r.bg[o + 1] += 12 * k;
    r.bg[o + 2] += 20 * k;
    if (band * glow > 0.28) {
      const hk = k * 0.55;
      r.layerAt(m, HAZE[Math.floor(band * 40) & 3], MOON[0] * hk, MOON[1] * hk, MOON[2] * hk);
    }
    return false;
  }

  // Darker seas, a bright limb toward the light (upper left), and craters
  // shadowed on their upper-left inner wall with the far wall lit.
  const limb = Math.sqrt(1 - d2);
  const maria = valueNoise(dx * 2.6 + 10, dy * 2.6 + 10, 77);
  let b = 0.6 + 0.35 * limb + (-dx - dy) * 0.1 - Math.max(0, maria - 0.5) * 0.8;
  for (const [cx, cy, size] of CRATERS) {
    const u = (dx - cx) / size;
    const v = (dy - cy) / size;
    const q = u * u + v * v;
    if (q < 1) b += (u + v) * 0.22 * (1 - q) - 0.06;
  }
  b = Math.max(0.25, Math.min(0.95, b));

  // The swell slices the image into two slivers per cell, each its own
  // thickness; where a sliver falls into a trough the water shows through.
  const step = r.cellW / (MOON_R * r.dpr);
  const leftEdge = (dx - step) * (dx - step) + dy * dy > 1;
  const rightEdge = (dx + step) * (dx + step) + dy * dy > 1;
  const sx = x / r.dpr;
  let drawn = false;
  for (let half = 0; half < 2; half++) {
    const sy = (y + (half - 0.5) * r.cellH * 0.5) / r.dpr;
    const sliver = valueNoise(sx * 0.03 + t * 0.4, sy * 0.21, 92) * 0.55 + sliceRow * 0.45 + limb * 0.15;
    if (sliver < 0.32) continue;
    const k = Math.min(1, b * (0.7 + sliver * 0.45));
    let g;
    if (leftEdge !== rightEdge) g = BAR_END[(leftEdge ? 2 : 0) + half];
    else g = BAR[Math.min(3, Math.floor((sliver - 0.32) * 4 + b * 2.2))][half];
    const cr = MOON[0] * k;
    const cg = MOON[1] * k * 0.99;
    const cb = MOON[2] * k * 0.97;
    if (drawn) r.layerAt(m, g, cr, cg, cb);
    else r.putAt(m, g, cr, cg, cb);
    drawn = true;
  }
  // A faint lift of the water between the slivers.
  r.bg[o] += 18 * b;
  r.bg[o + 1] += 20 * b;
  r.bg[o + 2] += 30 * b;
  return true;
}

// The glitter path: the column of water between the moon and the viewer
// whose wavelets flash with its light. Glints gather on wave crests.
function glitter(r, m, dx, dy, wx, wy, tick, t) {
  const width = COLUMN_HALF * (1 + Math.abs(dy) * 0.25);
  const across = Math.abs(dx) / width;
  if (across >= 1) return;
  const along = 1 - (dy < 0 ? -dy / COLUMN_UP : dy / COLUMN_DOWN);
  const k = (1 - across * across) * along;
  const o = m * 4;
  r.bg[o] += 10 * k;
  r.bg[o + 1] += 13 * k;
  r.bg[o + 2] += 22 * k;
  const sheen = SHEEN[r.glyphAt(m)];
  const h = hash2(wx, wy, tick);
  if (h > k * (0.08 + sheen * 0.5)) return;
  const f = 0.8 + 0.2 * Math.sin(t * 13 + h * 70);
  const b = (0.45 + 0.55 * k) * f;
  r.layerAt(m, GLITTER[h < k * 0.12 ? 0 : h < k * 0.3 ? 1 : 2], MOON[0] * b, MOON[1] * b, MOON[2] * b);
}
