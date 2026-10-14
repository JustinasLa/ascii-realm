import { hash2 } from './rng.js';

const smooth = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;

// Value noise in [0, 1).
export function valueNoise(x, y, seed = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const tx = smooth(x - xi);
  const ty = smooth(y - yi);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
}

// Exact value noise along a fixed row. Neighbouring grass/water samples
// share their vertical interpolation and usually the same lattice corners.
// Keep those scalars instead of hashing all four corners for every cell.
export function valueNoiseRow(y, seed = 0) {
  const yi = Math.floor(y);
  const ty = smooth(y - yi);
  let previous = NaN, a, b, c, d;
  return (x) => {
    const xi = Math.floor(x);
    if (xi !== previous) {
      a = hash2(xi, yi, seed);
      b = hash2(xi + 1, yi, seed);
      c = hash2(xi, yi + 1, seed);
      d = hash2(xi + 1, yi + 1, seed);
      previous = xi;
    }
    const tx = smooth(x - xi);
    return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
  };
}

// Fractal sum of octaves, normalised back to [0, 1).
export function fbm(x, y, seed = 0, octaves = 4) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(x, y, seed + o * 1013) * amp;
    norm += amp;
    amp *= 0.5;
    x *= 2.03;
    y *= 2.03;
  }
  return sum / norm;
}
