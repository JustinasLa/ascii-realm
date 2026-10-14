// Shared helpers for the ground shaders: glyph families, oriented lines that
// cross a cell, and the moonlight direction used to shade surfaces.

import { family } from '../../render/glyphs.js';
import { halfExtent, LINE_ANGLES, LINE_OFFSETS } from '../../render/glyph-packs/terrain.js';

export const fam = (prefix) => family(prefix);
export const pick = (list, r) => list[Math.floor(r * list.length) % list.length];

// Moonlight falls from the upper left; a surface tilted toward (LX, LY)
// catches it. Units are world units with y pointing down.
export const LX = -0.62;
export const LY = -0.78;

// Glyph pixels per world unit (see glyph-packs/terrain.js).
const PX = 50;

// Index into a lineVariants family (terrain.joint.*, terrain.jgrit.*) for a
// straight line whose unit normal is (nx, ny) and which passes `d` world
// units from the cell centre along that normal. Returns -1 when the line
// misses the cell.
export function lineCell(nx, ny, d) {
  let a = Math.atan2(ny, nx) + Math.PI / 2;
  a = ((a % Math.PI) + Math.PI) % Math.PI;
  const ai = Math.round(a / Math.PI * LINE_ANGLES) % LINE_ANGLES;
  const q = ai / LINE_ANGLES * Math.PI;
  const qx = -Math.sin(q);
  const qy = Math.cos(q);
  const f = d * PX * (nx * qx + ny * qy) / halfExtent(qx, qy);
  if (f <= -1 || f >= 1) return -1;
  const oi = Math.min(LINE_OFFSETS - 1, Math.floor((f + 1) / 2 * LINE_OFFSETS));
  return ai * LINE_OFFSETS + oi;
}

// Twelve headings over half a turn for a direction (dx, dy).
export function headingIndex(dx, dy, count = LINE_ANGLES, turn = Math.PI) {
  let a = Math.atan2(dy, dx);
  a = ((a % turn) + turn) % turn;
  return Math.round(a / turn * count) % count;
}

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smooth = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
