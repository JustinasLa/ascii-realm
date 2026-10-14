import { valueNoise } from '../core/noise.js';

const ASPECT = 6 / 10;

// The shared gust field keeps grass and whole tree crowns moving together.
export function windGust(seed, x, y, t) {
  return valueNoise(x * ASPECT * 0.035 - t * 0.55, y * 0.035 + t * 0.12, seed + 900);
}

// Horizontal crown displacement in cells; sample once per tree each frame.
export function treeWind(prop, t, seed = 1) {
  const gust = windGust(seed, prop.x, prop.y, t);
  const phase = prop.phase ?? 0;
  const offset = ((gust - 0.5) * 1.6 + Math.sin(t * 0.65 + phase) * 0.3) * (prop.sway ?? 1);
  return Math.max(-1.5, Math.min(1.5, offset));
}
