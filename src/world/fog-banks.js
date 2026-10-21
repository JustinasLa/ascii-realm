// Where the fog banks lie, worked out on the CPU exactly as the renderer's
// shader does (see fogAt in render/renderer.js), so the game can tell how
// much fog sits on a patch of ground before walkers push it around.
//
// Both read the same tiling field of random bytes. On the GPU it is a
// texture read with bilinear filtering; here the same blend is done by hand.

import { mulberry32 } from '../core/rng.js';

export const NOISE_SIZE = 256;
export const NOISE = (() => {
  const random = mulberry32(0xf06);
  const values = new Uint8Array(NOISE_SIZE * NOISE_SIZE);
  for (let i = 0; i < values.length; i++) values[i] = Math.floor(random() * 256);
  return values;
})();

const wrap = (i) => i & (NOISE_SIZE - 1);
const ease = (t) => t * t * (3 - 2 * t);

export function noise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = ease(x - xi);
  const fy = ease(y - yi);
  const x0 = wrap(xi);
  const x1 = wrap(xi + 1);
  const r0 = wrap(yi) * NOISE_SIZE;
  const r1 = wrap(yi + 1) * NOISE_SIZE;
  const top = NOISE[r0 + x0] + (NOISE[r0 + x1] - NOISE[r0 + x0]) * fx;
  const bottom = NOISE[r1 + x0] + (NOISE[r1 + x1] - NOISE[r1 + x0]) * fx;
  return (top + (bottom - top) * fy) / 255;
}

// Four octaves, each turned and shifted (the shader's TURN matrix).
export function fbm(x, y) {
  let sum = 0.5 * noise(x, y);
  let nx = 1.6 * x - 1.2 * y + 17.3;
  let ny = 1.2 * x + 1.6 * y + 17.3;
  sum += 0.25 * noise(nx, ny);
  x = 1.6 * nx - 1.2 * ny + 31.7;
  y = 1.2 * nx + 1.6 * ny + 31.7;
  sum += 0.125 * noise(x, y);
  nx = 1.6 * x - 1.2 * y + 5.9;
  ny = 1.2 * x + 1.6 * y + 5.9;
  sum += 0.0625 * noise(nx, ny);
  return sum / 0.9375;
}

function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// How thick the undisturbed fog is at a point of the ground, in rows with
// columns scaled to rows. `fog` carries driftX, driftY, time and coverage.
export function fogAt(gx, gy, fog) {
  const t = fog.time;
  const qx = (gx + fog.driftX) / 28;
  const qy = (gy + fog.driftY) / 28;
  const wx = fbm(qx * 1.7, qy * 1.7 + t * 0.021);
  const wy = fbm(qx * 1.7 + 5.2 - t * 0.017, qy * 1.7 + 1.3 - t * 0.017);
  const bank = fbm(qx + 1.4 * wx + t * 0.006, qy + 1.4 * wy);
  const edge = 0.52 - 0.22 * fog.coverage;
  const thick = smoothstep(edge, edge + 0.34, bank);
  if (thick === 0) return 0;
  const streak = fbm((gx + fog.driftX * 1.35) / 5.5 + 2.5 * wx, (gy + fog.driftY) / 2.4 + 2.5 * wy);
  return thick * (0.35 + 1.1 * streak);
}
