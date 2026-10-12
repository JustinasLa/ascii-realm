import { valueNoise } from '../core/noise.js';
import { hash2 } from '../core/rng.js';
import { glyph } from '../render/glyphs.js';
import { WATER } from './world.js';

// The sky is never drawn directly (the camera looks down at the ground), but
// it shows up mirrored in every lake. Things in the sky are infinitely far
// away, so their reflections stay put on screen while the world scrolls.

const STAR_CH = [...'.\'+*'].map(glyph);
const MOON_CH = [...'.:-=+*#%@'].map(glyph);

// Where the moon's reflection sits, as a fraction of the screen, and its
// radius in CSS pixels. Both are measured on the screen rather than in cells:
// the sky is so far away that zooming the camera must not move or resize it.
const MOON_X = 0.3;
const MOON_Y = 0.8;
const MOON_R = 90;

// Stars are scattered on a fixed grid of screen pixels for the same reason.
const STAR_GRID = 26;

export function drawSkyReflection(r, view, t) {
  const { fg, mask, cols, rows, cellW, cellH } = r;
  const moonX = r.canvas.width * MOON_X;
  const moonY = r.canvas.height * MOON_Y;
  const moonR = MOON_R * r.dpr;
  const grid = STAR_GRID * r.dpr;
  for (let sy = 0; sy < rows; sy++) {
    // Each row of water wobbles sideways a little, breaking up the image.
    const wobble = Math.round(Math.sin(sy * 0.9 + t * 1.5) * 0.8);
    const py = (sy + 0.5) * cellH - view.offY;
    for (let sx = 0; sx < cols; sx++) {
      const m = sy * cols + sx;
      if (mask[m] !== WATER) continue;
      const o = m * 4;
      const px = (sx + wobble + 0.5) * cellW - view.offX;
      if (moon(fg, o, (px - moonX) / moonR, (py - moonY) / moonR, px / r.dpr, py / r.dpr, t)) continue;

      // The star of the grid square this cell's centre lies in, drawn only by
      // the one cell that contains it.
      const gx = Math.floor(px / grid);
      const gy = Math.floor(py / grid);
      const h = hash2(gx, gy, 4242);
      if (h < 0.92) continue;
      const starX = (gx + hash2(gx, gy, 4243)) * grid;
      const starY = (gy + hash2(gx, gy, 4244)) * grid;
      if (Math.abs(starX - px) > cellW / 2 || Math.abs(starY - py) > cellH / 2) continue;
      const tw = 0.45 + 0.35 * Math.sin(t * (1.5 + h * 3) + h * 500);
      fg[o] = 170 * tw;
      fg[o + 1] = 180 * tw;
      fg[o + 2] = 215 * tw;
      fg[o + 3] = STAR_CH[Math.floor(h * 1e5) % STAR_CH.length];
    }
  }
}

// A pale disc with darker maria, cut into horizontal slivers by the ripples.
// dx, dy are the offset from the moon's centre in moon radii; x, y the
// position on screen in CSS pixels.
function moon(fg, o, dx, dy, x, y, t) {
  const d2 = dx * dx + dy * dy;
  if (d2 > 1) return false;

  const maria = valueNoise(dx * 2.6 + 10, dy * 2.6 + 10, 77);
  const limb = Math.sqrt(1 - d2);
  const sliver = valueNoise(x * 0.025 + t * 0.4, y * 0.11, 91);
  const b = (0.35 + limb * 0.55 - Math.max(0, maria - 0.55) * 0.9) * (0.55 + sliver * 0.6);
  if (b < 0.12) return false;

  const k = Math.min(1, b);
  fg[o] = 185 * k;
  fg[o + 1] = 192 * k;
  fg[o + 2] = 210 * k;
  fg[o + 3] = MOON_CH[Math.min(MOON_CH.length - 1, Math.floor(k * MOON_CH.length))];
  return true;
}
