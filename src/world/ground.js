import { CHUNK_SIZE } from './world.js';
import { TERRAIN_SHADERS } from './terrain/index.js';

// Static terrain is shaded once per chunk, including the expensive stone
// tessellation. Only cells a terrain marks as animated (water, dew) are
// reshaded each frame; row copies restore the ground before sprites draw,
// without retaining any of their pixels in the cache.
const terrain = new WeakMap();

function groundOf(chunk, seed) {
  // Burns and scenery edits bump the chunk's version to reshade it.
  const version = chunk.version ?? 0;
  let cached = terrain.get(chunk);
  if (cached?.version === version) return cached;
  const n = CHUNK_SIZE * CHUNK_SIZE * 4;
  const out = { fg: new Uint8ClampedArray(n), bg: new Uint8ClampedArray(n), ov: new Uint8ClampedArray(n) };
  const animated = [];
  for (let y = 0; y < CHUNK_SIZE; y++) {
    const row = [];
    for (let x = 0; x < CHUNK_SIZE; x++) {
      const i = y * CHUNK_SIZE + x;
      const wx = chunk.cx * CHUNK_SIZE + x;
      const wy = chunk.cy * CHUNK_SIZE + y;
      const shader = TERRAIN_SHADERS[chunk.type[i]];
      shader.shade(out, i * 4, chunk, i, wx, wy, seed, 0);
      if (shader.animated(chunk, i, wx, wy, seed)) row.push(x);
    }
    animated.push(Uint8Array.from(row));
  }
  cached = { ...out, animated, version };
  terrain.set(chunk, cached);
  return cached;
}

// `loadedOnly` leaves chunks that are not generated yet as night ground.
export function drawGround(r, world, view, t, bend, wind = 0, loadedOnly = false) {
  for (let sy = 0; sy < view.rows; sy++) {
    const wy = view.y0 + sy;
    const cy = Math.floor(wy / CHUNK_SIZE);
    const ly = wy - cy * CHUNK_SIZE;
    for (let sx = 0; sx < view.cols;) {
      const wx = view.x0 + sx;
      const cx = Math.floor(wx / CHUNK_SIZE);
      const lx = wx - cx * CHUNK_SIZE;
      const count = Math.min(CHUNK_SIZE - lx, view.cols - sx);
      const chunk = loadedOnly ? world.loaded(cx, cy) : world.chunk(cx, cy);
      if (!chunk) {
        // Not generated yet: plain night ground until it loads.
        for (let i = 0; i < count; i++) {
          const o = (sy * r.cols + sx + i) * 4;
          r.fg[o + 3] = 0;
          r.bg[o] = NIGHT[0];
          r.bg[o + 1] = NIGHT[1];
          r.bg[o + 2] = NIGHT[2];
          r.mask[sy * r.cols + sx + i] = GRASS;
        }
        sx += count;
        continue;
      }
      const cached = groundOf(chunk, world.seed);
      const src = ly * CHUNK_SIZE + lx;
      const dest = sy * r.cols + sx;
      r.fg.set(cached.fg.subarray(src * 4, (src + count) * 4), dest * 4);
      r.bg.set(cached.bg.subarray(src * 4, (src + count) * 4), dest * 4);
      r.ov.set(cached.ov.subarray(src * 4, (src + count) * 4), dest * 4);
      r.mask.set(chunk.type.subarray(src, src + count), dest);
      for (const x of cached.animated[ly]) {
        if (x < lx || x >= lx + count) continue;
        const i = ly * CHUNK_SIZE + x;
        TERRAIN_SHADERS[chunk.type[i]].shade(r, (dest + x - lx) * 4, chunk, i,
          cx * CHUNK_SIZE + x, wy, world.seed, t, wind);
      }
      sx += count;
    }
  }
}
