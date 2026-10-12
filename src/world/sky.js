import { valueNoise } from '../core/noise.js';
import { hash2 } from '../core/rng.js';
import { glyph } from '../render/glyphs.js';
import { ASPECT, WATER } from './world.js';

// The sky is never drawn directly (the camera looks down at the ground), but
// it shows up mirrored in every lake. Things in the sky are infinitely far
// away, so their reflections stay put on screen while the world scrolls.

const STAR_CH = [...'.\'+*'].map(glyph);
const MOON_CH = [...'.:-=+*#%@'].map(glyph);

// Where the moon's reflection sits, as a fraction of the screen, and its
// radius in rows.
const MOON_X = 0.3;
const MOON_Y = 0.8;
const MOON_R = 9;

export function drawSkyReflection(r, t) {
  const { fg, mask, cols, rows } = r;
  for (let sy = 0; sy < rows; sy++) {
    // Each row of water wobbles sideways a little, breaking up the image.
    const wobble = Math.round(Math.sin(sy * 0.9 + t * 1.5) * 0.8);
    for (let sx = 0; sx < cols; sx++) {
      const m = sy * cols + sx;
      if (mask[m] !== WATER) continue;
      const o = m * 4;
      if (moon(fg, o, sx + wobble, sy, cols, rows, t)) continue;
      const h = hash2(sx + wobble, sy, 4242);
      if (h < 0.993) continue;
      const tw = 0.45 + 0.35 * Math.sin(t * (1.5 + h * 3) + h * 500);
      fg[o] = 170 * tw;
      fg[o + 1] = 180 * tw;
      fg[o + 2] = 215 * tw;
      fg[o + 3] = STAR_CH[Math.floor(h * 1e5) % STAR_CH.length];
    }
  }
}

// A pale disc with darker maria, cut into horizontal slivers by the ripples.
function moon(fg, o, sx, sy, cols, rows, t) {
  const dx = (sx + 0.5 - cols * MOON_X) * ASPECT / MOON_R;
  const dy = (sy + 0.5 - rows * MOON_Y) / MOON_R;
  const d2 = dx * dx + dy * dy;
  if (d2 > 1) return false;

  const maria = valueNoise(dx * 2.6 + 10, dy * 2.6 + 10, 77);
  const limb = Math.sqrt(1 - d2);
  const sliver = valueNoise(sx * 0.15 + t * 0.4, sy * 1.1, 91);
  const b = (0.35 + limb * 0.55 - Math.max(0, maria - 0.55) * 0.9) * (0.55 + sliver * 0.6);
  if (b < 0.12) return false;

  const k = Math.min(1, b);
  fg[o] = 185 * k;
  fg[o + 1] = 192 * k;
  fg[o + 2] = 210 * k;
  fg[o + 3] = MOON_CH[Math.min(MOON_CH.length - 1, Math.floor(k * MOON_CH.length))];
  return true;
}
