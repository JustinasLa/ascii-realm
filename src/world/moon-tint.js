import { MOONLIGHT } from '../render/palette.js';

// The pale moonlight that pours through a moonbeam (see moon-shafts.js):
// how much brighter the ground is at a beam's heart, and how far its
// colours turn toward the moon's own. Kept apart from the beams themselves
// so the grass and the props can tint by it without loading the world.

// The ground at a beam's heart takes 1 + PEAK_LIFT of the night's light.
export const PEAK_LIFT = 1;
// And turns this far toward the moonlight's colour there.
export const TINT = 0.3;

const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
// The moonlight's colour at a brightness of one.
export const MOON_HUE = MOONLIGHT.map((c) => c / luma(...MOONLIGHT));

// Turns an rgb triple at arr[o..o+2] a share t toward the moonlight's
// colour at the triple's own brightness: paler and bluer, never brighter.
export function moonTint(arr, o, t) {
  const y = luma(arr[o], arr[o + 1], arr[o + 2]);
  arr[o] += (y * MOON_HUE[0] - arr[o]) * t;
  arr[o + 1] += (y * MOON_HUE[1] - arr[o + 1]) * t;
  arr[o + 2] += (y * MOON_HUE[2] - arr[o + 2]) * t;
}

// The same for three numbers, written into `out`.
export function tintRgb(out, r, g, b, t) {
  const y = luma(r, g, b);
  out[0] = r + (y * MOON_HUE[0] - r) * t;
  out[1] = g + (y * MOON_HUE[1] - g) * t;
  out[2] = b + (y * MOON_HUE[2] - b) * t;
  return out;
}
