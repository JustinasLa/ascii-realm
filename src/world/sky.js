import { hash2 } from '../core/rng.js';
import { glyph } from '../render/glyphs.js';
import { WATER } from './world.js';

// The sky is never drawn directly (the camera looks down at the ground), but
// it shows up mirrored in every lake. Things in the sky are infinitely far
// away, so their reflections stay put on screen while the world scrolls.

const STAR_CH = [...'.\'+*'].map(glyph);

export function drawSkyReflection(r, t) {
  const { fg, mask, cols, rows } = r;
  for (let sy = 0; sy < rows; sy++) {
    // Each row of water wobbles sideways a little, breaking up the image.
    const wobble = Math.round(Math.sin(sy * 0.9 + t * 1.5) * 0.8);
    for (let sx = 0; sx < cols; sx++) {
      const m = sy * cols + sx;
      if (mask[m] !== WATER) continue;
      const h = hash2(sx + wobble, sy, 4242);
      if (h < 0.993) continue;
      const tw = 0.45 + 0.35 * Math.sin(t * (1.5 + h * 3) + h * 500);
      const o = m * 4;
      fg[o] = 170 * tw;
      fg[o + 1] = 180 * tw;
      fg[o + 2] = 215 * tw;
      fg[o + 3] = STAR_CH[Math.floor(h * 1e5) % STAR_CH.length];
    }
  }
}
