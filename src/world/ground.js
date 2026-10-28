import { NIGHT } from '../render/palette.js';
import { CHUNK_SIZE, GRASS, WATER } from './world.js';
import { atCell } from './terrain/cell.js';
import { reliefLight } from './relief.js';
import { TERRAIN_SHADERS } from './terrain/index.js';

// Static terrain is shaded once per chunk, including the expensive stone
// tessellation. Only cells a terrain marks as animated (water, dew) are
// reshaded each frame; row copies restore the ground before sprites draw,
// without retaining any of their pixels in the cache.
const terrain = new WeakMap();
// The ground is a backdrop: its characters are dimmed so rocks, trees and
// people stand out on it. Water keeps its own moonlit swell.
const GROUND_DIM = 0.7;

function groundOf(chunk, seed) {
  // Burns and scenery edits bump the chunk's version to reshade it.
  const version = chunk.version ?? 0;
  let cached = terrain.get(chunk);
  if (cached?.version === version) return cached;
  const n = CHUNK_SIZE * CHUNK_SIZE * 4;
  // cellLit: how riverbed stones face the light (see surface-light.js).
  const out = { fg: new Uint8ClampedArray(n), bg: new Uint8ClampedArray(n), ov: new Uint8ClampedArray(n),
    cellLit: new Uint8Array(n) };
  const animated = [];
  for (let y = 0; y < CHUNK_SIZE; y++) {
    const row = [];
    for (let x = 0; x < CHUNK_SIZE; x++) {
      const i = y * CHUNK_SIZE + x;
      const wx = chunk.cx * CHUNK_SIZE + x;
      const wy = chunk.cy * CHUNK_SIZE + y;
      const shader = TERRAIN_SHADERS[chunk.type[i]];
      atCell(wx, wy);
      shader.shade(out, i * 4, chunk, i, wx, wy, seed, 0);
      if (chunk.type[i] !== WATER) {
        for (let k = i * 4; k < i * 4 + 3; k++) {
          out.fg[k] *= GROUND_DIM;
          out.ov[k] *= GROUND_DIM;
        }
      }
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
  // The ground starts each frame afresh, and so does the fine grid of
  // small cells that trees and rocks are drawn into.
  r.clearFine?.();
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
          r.ov[o + 3] = 0;
          r.bg[o] = NIGHT[0];
          r.bg[o + 1] = NIGHT[1];
          r.bg[o + 2] = NIGHT[2];
          r.bg[o + 3] = 0;
          if (r.cellLit) r.cellLit[o + 2] = 0;
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
      r.cellLit?.set(cached.cellLit.subarray(src * 4, (src + count) * 4), dest * 4);
      r.mask.set(chunk.type.subarray(src, src + count), dest);
      for (const x of cached.animated[ly]) {
        if (x < lx || x >= lx + count) continue;
        const i = ly * CHUNK_SIZE + x;
        atCell(cx * CHUNK_SIZE + x, wy);
        TERRAIN_SHADERS[chunk.type[i]].shade(r, (dest + x - lx) * 4, chunk, i,
          cx * CHUNK_SIZE + x, wy, world.seed, t, wind);
      }
      sx += count;
    }
  }
}

// Raised ground (see relief.js) is drawn again among the sprites, one
// ground row at a time: each cell's top its lift higher, then the slope it
// uncovers down to the cell in front. Ridges in front hide what stands
// behind them, and whatever stands on a row is drawn over its ground.
const SLOPE = [0.8, 0.8, 0.8];
// Below a slope's first rows, a steep drop shows earth.
const FACE = [0.62, 0.55, 0.48];
const LIT = [1, 1, 1];

// Copies ground cell `i` of `chunk` to screen `cell`, read from `src` at
// `from`: the chunk's shading cache, or the screen itself.
function copyCell(r, src, from, chunk, i, cell, tint) {
  const o = cell * 4;
  const s = from * 4;
  for (let k = 0; k < 4; k++) {
    const t = k < 3 ? tint[k] : 1;
    r.fg[o + k] = src.fg[s + k] * t;
    r.ov[o + k] = src.ov[s + k] * t;
    r.bg[o + k] = src.bg[s + k];
    if (r.cellLit) r.cellLit[o + k] = src.cellLit[s + k];
  }
  r.mask[cell] = chunk.type[i];
  if (r.motionUsed) {
    r.motion[o] = r.motion[o + 1] = 0;
    r.motion[o + 2] = (r.motionPass * 2) & 255;
    r.motion[o + 3] = (r.motionPass * 2) >> 8;
  }
  // Solid ground hides the small letters of a sprite behind it.
  if (r.fineMark?.[cell]) r.overFine(cell, 0);
}

export function drawRaisedRow(r, world, view, wy) {
  const cy = Math.floor(wy / CHUNK_SIZE);
  const ly = wy - cy * CHUNK_SIZE;
  const ny = (ly + 1) % CHUNK_SIZE;
  for (let cx = Math.floor(view.x0 / CHUNK_SIZE); cx * CHUNK_SIZE < view.x0 + view.cols; cx++) {
    const chunk = world.loaded(cx, cy);
    if (!chunk?.liftRows?.[ly]) continue;
    const front = ny ? chunk : world.loaded(cx, cy + 1);
    const cached = groundOf(chunk, world.seed);
    const from = Math.max(0, view.x0 - cx * CHUNK_SIZE);
    const to = Math.min(CHUNK_SIZE, view.x0 + view.cols - cx * CHUNK_SIZE);
    for (let lx = from; lx < to; lx++) {
      const i = ly * CHUNK_SIZE + lx;
      const lift = chunk.lift[i];
      if (!lift) continue;
      const sx = cx * CHUNK_SIZE + lx - view.x0;
      const top = wy - lift - view.y0;
      // A top whose own row is on screen is taken from there, as the flat
      // pass drew it: with its dew, and the shadows, tracks, footprints and
      // tree shade laid on it since. Its slope rows show the bare ground.
      const flat = wy - view.y0 < view.rows ? (wy - view.y0) * r.cols + sx : -1;
      const ahead = front?.lift?.[ny * CHUNK_SIZE + lx] ?? 0;
      const drop = Math.max(0, lift - ahead);
      LIT[0] = LIT[1] = LIT[2] = reliefLight(lift, ahead);
      for (let k = Math.max(0, -top); k <= drop && top + k < view.rows; k++) {
        // Slope rows take a neighbouring column's letter, so no letter
        // repeats straight down the slope.
        const side = lx + (k & 1 ? 1 : -1);
        const j = k ? ly * CHUNK_SIZE + (side < 0 || side >= CHUNK_SIZE ? 2 * lx - side : side) : i;
        const own = !k && flat >= 0;
        copyCell(r, own ? r : cached, own ? flat : j, chunk, j, (top + k) * r.cols + sx, !k ? LIT : k <= 2 ? SLOPE : FACE);
      }
    }
  }
}

// The painter's drawables for every raised ground row whose cells can show
// in the view, which reaches up to MAX_LIFT rows below it.
export function raisedRows(r, world, view) {
  const rows = [];
  for (let wy = view.y0; wy < view.y0 + view.rows + world.maxLift; wy++) {
    const cy = Math.floor(wy / CHUNK_SIZE);
    const ly = wy - cy * CHUNK_SIZE;
    for (let cx = Math.floor(view.x0 / CHUNK_SIZE); cx * CHUNK_SIZE < view.x0 + view.cols; cx++) {
      if (!world.loaded(cx, cy)?.liftRows?.[ly]) continue;
      rows.push({ y: wy, draw: () => drawRaisedRow(r, world, view, wy) });
      break;
    }
  }
  return rows;
}
