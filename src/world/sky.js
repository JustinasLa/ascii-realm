import { valueNoise } from '../core/noise.js';
import { hash2 } from '../core/rng.js';
import { glyph } from '../render/glyphs.js';
import { MOON, STARLIGHT } from '../render/palette.js';
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
  const { mask, cols, rows, cellW, cellH } = r;
  const moonX = r.canvas.width * MOON_X;
  const moonY = r.canvas.height * MOON_Y;
  const moonR = MOON_R * r.dpr;
  const grid = STAR_GRID * r.dpr;
  for (let sy = 0; sy < rows; sy++) {
    // Each row of water wobbles sideways a little, breaking up the image.
    // The ripple belongs to the water, so it follows world rows.
    const wobble = Math.round(Math.sin((sy + view.y0) * 0.9 + t * 1.5) * 0.8);
    const py = (sy + 0.5) * cellH - view.offY;
    const top = sy * cellH - view.offY;
    const bottom = top + cellH;
    const gy0 = Math.floor(top / grid);
    const gy1 = Math.ceil(bottom / grid) - 1;
    for (let sx = 0; sx < cols; sx++) {
      const m = sy * cols + sx;
      if (mask[m] !== WATER) continue;
      const px = (sx + wobble + 0.5) * cellW - view.offX;
      if (moon(r, m, (px - moonX) / moonR, (py - moonY) / moonR, px / r.dpr, py / r.dpr, t)) continue;

      // A cell can straddle star-grid squares. Check every square it touches
      // so stars near their edges do not disappear as the view scrolls.
      const left = (sx + wobble) * cellW - view.offX;
      const right = left + cellW;
      const gx0 = Math.floor(left / grid);
      const gx1 = Math.ceil(right / grid) - 1;
      let found = false;
      for (let gy = gy0; gy <= gy1 && !found; gy++) {
        for (let gx = gx0; gx <= gx1; gx++) {
          const h = hash2(gx, gy, 4242);
          if (h < 0.92) continue;
          const starX = (gx + hash2(gx, gy, 4243)) * grid;
          const starY = (gy + hash2(gx, gy, 4244)) * grid;
          // Half-open bounds assign a star on an edge to exactly one cell.
          if (starX < left || starX >= right || starY < top || starY >= bottom) continue;
          const tw = 0.45 + 0.35 * Math.sin(t * (1.5 + h * 3) + h * 500);
          r.putAt(m, STAR_CH[Math.floor(h * 1e5) % STAR_CH.length],
            STARLIGHT[0] * tw, STARLIGHT[1] * tw, STARLIGHT[2] * tw);
          found = true;
          break;
        }
      }
    }
  }
}

// A pale disc with darker maria, cut into horizontal slivers by the ripples.
// dx, dy are the offset from the moon's centre in moon radii; x, y the
// position on screen in CSS pixels.
function moon(r, m, dx, dy, x, y, t) {
  const d2 = dx * dx + dy * dy;
  if (d2 > 1) return false;

  const maria = valueNoise(dx * 2.6 + 10, dy * 2.6 + 10, 77);
  const limb = Math.sqrt(1 - d2);
  const sliver = valueNoise(x * 0.025 + t * 0.4, y * 0.11, 91);
  const b = (0.35 + limb * 0.55 - Math.max(0, maria - 0.55) * 0.9) * (0.55 + sliver * 0.6);
  if (b < 0.12) return false;

  const k = Math.min(1, b);
  r.putAt(m, MOON_CH[Math.min(MOON_CH.length - 1, Math.floor(k * MOON_CH.length))],
    MOON[0] * k, MOON[1] * k, MOON[2] * k);
  return true;
}
