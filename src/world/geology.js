import { fbm } from '../core/noise.js';
import { ASPECT } from './world.js';

// A broad, continuous surface layer. Loose stones and scenery can share this
// query without generating a chunk or depending on exploration order.
export function rockTypeAt(world, x, y) {
  const layer = fbm(x * ASPECT * 0.002, y * 0.002, world.seed + 1401, 3);
  return layer < 0.42 ? 'basalt' : layer > 0.58 ? 'limestone' : 'granite';
}
