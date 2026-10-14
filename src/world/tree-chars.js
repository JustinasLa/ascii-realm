// Trees are drawn with plain characters, like a shaded picture turned into
// text: how much ink a character carries follows how much moonlight that
// spot of bark or leaf catches, and the outline is drawn with brackets and
// slashes that follow the shape. Each ramp runs from shadow to light; a
// level holds a few characters of about the same weight so neighbouring
// cells vary without changing the shading.

import { flatGlyph, glyph, STROKE_STEPS, strokeGlyph } from '../render/glyphs.js';

const levels = (...sets) => sets.map((s) => [...s].map(glyph));

// Bark: thin punctuation and small letters on the shaded side up to heavy
// letters and signs where the trunk faces the moon.
export const BARK_RAMP = levels('.:', ':-', 'rcz', 'vuxs', 'aeno', 'hdbpqk', 'QD0%8', '$&#H', '@MWB');
// Pale birch bark is mostly light, with dark lenticels picked out by `=-`.
export const BIRCH_RAMP = levels('.:', ':;', '=-', 'il', 'oec', 'udbq', 'QD8', '0O@', 'MW@');
// Leaves: specks in the deep shade of the crown, round heavy clumps where
// the leaf masses face the moon.
export const LEAF_RAMP = levels(".'", '.,', ':o', 'oc', 'oea', 'O0Q', 'Q0@', '@Q8');
// Blossom reads rounder than leaves.
export const BLOOM_RAMP = levels(".'", '.,:', ':o', 'o*', '*%o', '%&@', '@&8', '@8O');
// Needles are spiky.
export const NEEDLE_RAMP = levels(".'", '.,', ':;', '^*', 'x*', '#*%', '#%&', '#@&');
// Hanging strands of willow and vine.
export const STRAND_RAMP = levels(".'", ':', '!:', '|!', '|l', 'lI', 'I|');

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// A character of the ramp for a lighting level in 0..1; `r` in 0..1 picks
// among the characters of equal weight.
export function rampChar(ramp, light, r) {
  const level = ramp[Math.min(ramp.length - 1, Math.floor(clamp01(light) * ramp.length))];
  return level[Math.floor(r * level.length) % level.length];
}

// The same weight, another character: what a leaf turns into as it rustles.
export function rampNeighbour(ramp, light, r) {
  return rampChar(ramp, light, (r + 0.37) % 1);
}

// The outline of a trunk or bough on its left (side < 0) or right edge.
// `slant` is how far the edge moves outward per row going down, in cells.
export function edgeChar(side, slant, r) {
  if (slant > 0.45) return glyph(side < 0 ? '/' : '\\');
  if (slant < -0.45) return glyph(side < 0 ? '\\' : '/');
  if (r < 0.7) return glyph(side < 0 ? '(' : ')');
  return glyph(side < 0 ? '[' : ']');
}

// A thin branch crossing a cell from (x0, y0) to (x1, y1), in cells with y
// down: the stroke character closest to its direction.
export function strokeChar(dx, dy) {
  const a = Math.atan2(-dy, dx);
  const t = ((a % Math.PI) + Math.PI) % Math.PI;
  if (t < Math.PI / 8 || t > Math.PI * 7 / 8) return glyph('-');
  if (t < Math.PI * 3 / 8) return glyph('/');
  if (t < Math.PI * 5 / 8) return glyph('|');
  return glyph('\\');
}

export const char = glyph;

const clampStep = (v) => Math.max(0, Math.min(STROKE_STEPS - 1, Math.round(v)));

// A short leaf stroke lying along (ax, ay) - world units across, rows down -
// for cells `aspect` world units wide. Steep leaves are upright strokes,
// leaves lying near flat are flat ones. `tip` 0 is a full stroke, 1 and 2
// taper off higher or lower in the cell, so leaves end at different lengths.
export function leafStroke(ax, ay, tip, aspect) {
  const perRow = ax / (Math.abs(ay) < 1e-3 ? (ay < 0 ? -1e-3 : 1e-3) : ay) / aspect;
  if (Math.abs(perRow) > 1.8) {
    const d = Math.max(-2, Math.min(2, Math.round(ay / ax * aspect * 3)));
    const l = Math.max(0, Math.min(2, 1 - Math.ceil(d / 2)));
    return flatGlyph(l, Math.max(0, Math.min(2, l + d)));
  }
  const shift = Math.max(1 - STROKE_STEPS, Math.min(STROKE_STEPS - 1, Math.round(-perRow * STROKE_STEPS)));
  const bottom = clampStep((STROKE_STEPS - 1) / 2 - shift / 2);
  return strokeGlyph(bottom, clampStep(bottom + shift), tip);
}

