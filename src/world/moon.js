import { hash2 } from '../core/rng.js';
import { FINE } from '../render/cells.js';
import { glyph } from '../render/glyphs.js';
import { MOON } from '../render/palette.js';
import { MOON_MAP, MOON_MAP_SIZE as SIZE } from './moon-map.js';

// Real characters, chosen within density bands rather than repeating the
// same bar across a whole row. The face stays fixed while water distorts it.
const INK = [".,:'-", ':;!ir=', 'xvsco*+', 'oae023%', '08QMW@#'].map(s => [...s].map(glyph));
// Earth's real near side, orthographically projected from NASA's LROC map.
// Lunar north is up and west is left: Imbrium upper-left, Crisium upper-right,
// and Tycho's rays below centre. Preserve this familiar Northern Hemisphere
// orientation in the stylized water image rather than flipping the albedo.
// Stretch the photograph's contrast for readable ASCII, preserving geography.
// How much of the moon's dark side still shows, so a new moon is a faint
// ashen disc rather than a hole, and how soft the edge between the two is.
const EARTHSHINE = 0.1;
const TERMINATOR = 0.05;
// How soon a setting moon's dim parts give way to the water.
const FADE_CUT = 0.25;
const smoothstep = (v) => { const x = Math.min(1, Math.max(0, (v + TERMINATOR) / (2 * TERMINATOR))); return x * x * (3 - 2 * x); };
const FACE = Float32Array.from(MOON_MAP, v => v ? Math.max(0.18, Math.min(1, 0.22 + (v - 110) * 0.0072)) : 0);

// Draw into the existing fine grid so fog, shores, floating leaves and
// foreground objects retain their normal painter's order. No sprite halo:
// moonlight has a soft water glow, not the dark outline used for scenery.
// `phase` (a sky state's `moonPhase`) darkens the side turned from the sun,
// leaving it faintly lit by the earth; the full moon skips this. `fade`
// dims the face as the moon sets.
export function drawMoon(r, m, dx, dy, x, y, radius, t, phase = null, fade = 1) {
  const detail = r.fineAt ? FINE : 1;
  const stepX = r.cellW / (detail * r.dpr);
  const stepY = r.cellH / (detail * r.dpr);
  const fx = (m % r.cols) * detail;
  const fy = Math.floor(m / r.cols) * detail;
  const texture = FACE;
  let drawn = false;
  for (let j = 0; j < detail; j++) {
    const oy = (j + 0.5 - detail / 2) * stepY;
    const py = y / r.dpr + oy;
    // Subtle, continuous ripples preserve the circular silhouette. Narrow
    // dark wave crests break its light without erasing entire rows.
    const warp = Math.sin(py * 0.19 + t * 1.5) * 1.2 + Math.sin(py * 0.43 - t * 0.9) * 0.45;
    const ripple = 0.93 + 0.07 * Math.sin(py * 0.9 + t * 1.8);
    for (let i = 0; i < detail; i++) {
      const ox = (i + 0.5 - detail / 2) * stepX;
      const u = dx + (ox + warp) / radius;
      const v = dy + oy / radius;
      const d2 = u * u + v * v;
      if (d2 > 1) continue;
      const tx = Math.min(SIZE - 1, Math.max(0, Math.floor((u + 1) * SIZE / 2)));
      const ty = Math.min(SIZE - 1, Math.max(0, Math.floor((v + 1) * SIZE / 2)));
      const b = texture[ty * SIZE + tx];
      const h = hash2(Math.floor(u * 140), Math.floor(v * 140), 812);
      const band = INK[Math.min(INK.length - 1, Math.floor(b * INK.length))];
      const g = band[Math.floor(h * band.length)];
      const edge = Math.min(1, (1 - Math.sqrt(d2)) * radius / Math.max(0.5, stepX * 0.4));
      let k = Math.min(1, (0.22 + b * 0.83) * ripple) * edge;
      if (phase && phase.index !== 0) {
        // The sun lies off to the left while the moon wanes (lit on the
        // left) and to the right while it waxes.
        const lit = -phase.sin * u + phase.cos * Math.sqrt(1 - d2);
        k *= EARTHSHINE + (1 - EARTHSHINE) * smoothstep(lit);
      }
      // A setting moon dissolves into the water, its darkest parts first.
      if (fade !== 1) {
        if (k * fade < FADE_CUT * (1 - fade)) continue;
        k *= fade;
      }
      const cr = Math.min(255, MOON[0] * 1.12) * k;
      const cg = Math.min(255, MOON[1] * 1.1) * k;
      const cb = Math.min(255, MOON[2] * 1.04) * k;
      if (detail > 1) r.fineAt(fx + i, fy + j, g, cr, cg, cb, 6, 7, 18, 0);
      else r.putAt(m, g, cr, cg, cb);
      drawn = true;
    }
  }
  return drawn;
}
