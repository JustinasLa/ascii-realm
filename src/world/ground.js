import { valueNoise } from '../core/noise.js';
import { hash2 } from '../core/rng.js';
import { glyph } from '../render/glyphs.js';
import {
  FOAM, NIGHT, PATH, PATH_GAP, PEBBLE_GAP, PEBBLES, STONE_DARK, STONE_GAP, STONE_LIT, STONE_MID, SWELL,
  WATER_DEEP, WATER_SHALLOW,
} from '../render/palette.js';
import { ASPECT, CHUNK_SIZE, DIRT, GRASS, SHORE, STONE, WATER, WATER_LEVEL } from './world.js';
import { PALETTES } from './grass.js';

const G = (s) => [...s].map(glyph);

const STUBBLE = G(`',"\``);
const ASH = G(".,:`'");
const DEW = glyph('.');
const STAR = glyph('*');
const GREENS = [
  [34, 92, 48],
  [46, 122, 62],
  [58, 140, 74],
  [74, 150, 70],
  [40, 108, 70],
];

const SHORE_CH = G('.,:;');
const DIRT_CH = G('.:,`');
const SLAB = 4;
const SLAB_FAMILIES = [':;-', '+=xo', 'aedbqp', 'Q0O8&$', '@#%WM'].map(G);
const CRACK_A = glyph('.');
const CRACK_B = glyph(',');
const WAVE_HI = glyph('≈');
const WAVE_MID = glyph('~');
const WAVE_LO = glyph('-');
const WAVE_DOT = glyph('·');

// Static terrain is shaded once per chunk, including the expensive stone
// tessellation. Only water and dew are animated; row copies restore the ground
// before sprites draw, without retaining any of their pixels in the cache.
const terrain = new WeakMap();

function groundOf(chunk, seed) {
  // Burns and scenery edits bump the chunk's version to reshade it.
  const version = chunk.version ?? 0;
  let cached = terrain.get(chunk);
  if (cached?.version === version) return cached;
  const fg = new Uint8ClampedArray(CHUNK_SIZE * CHUNK_SIZE * 4);
  const bg = new Uint8ClampedArray(fg.length);
  const animated = [];
  for (let y = 0; y < CHUNK_SIZE; y++) {
    const row = [];
    for (let x = 0; x < CHUNK_SIZE; x++) {
      const i = y * CHUNK_SIZE + x;
      shadeCell(fg, bg, i * 4, chunk, i, chunk.cx * CHUNK_SIZE + x,
        chunk.cy * CHUNK_SIZE + y, seed, 0);
      if (chunk.type[i] === WATER || (chunk.type[i] === GRASS && chunk.rnd[i] > 0.985)) row.push(x);
    }
    animated.push(Uint8Array.from(row));
  }
  cached = { fg, bg, animated, version };
  terrain.set(chunk, cached);
  return cached;
}

// Fully zoomed out a cell is a dot of colour and blades are far too small
// to draw, so meadows bake their blades' colour into a second still image.
const MEADOW = glyph('#');
function farOf(chunk, cached) {
  if (cached.far) return cached.far;
  const fg = cached.fg.slice();
  const bg = cached.bg.slice();
  for (let i = 0; i < CHUNK_SIZE * CHUNK_SIZE; i++) {
    if (chunk.type[i] !== GRASS || chunk.burnt?.[i] || chunk.grassHeight[i] < 2) continue;
    const tone = PALETTES[chunk.grassStyle[i]] ?? PALETTES[0];
    const cover = Math.min(1, chunk.grassDensity[i] * 2.5) * (0.6 + chunk.grassHeight[i] * 0.1);
    const o = i * 4;
    fg[o] = tone[0] * cover;
    fg[o + 1] = tone[1] * cover;
    fg[o + 2] = tone[2] * cover;
    fg[o + 3] = MEADOW;
    bg[o] = tone[0] * cover * 0.3;
    bg[o + 1] = tone[1] * cover * 0.3;
    bg[o + 2] = tone[2] * cover * 0.3;
  }
  cached.far = { fg, bg };
  return cached.far;
}

// `far` draws the still, blade-coloured image without animating water;
// `loadedOnly` leaves chunks that are not generated yet as night ground.
export function drawGround(r, world, view, t, bend, wind = 0, far = false, loadedOnly = far) {
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
      const image = far ? farOf(chunk, cached) : cached;
      const src = ly * CHUNK_SIZE + lx;
      const dest = sy * r.cols + sx;
      r.fg.set(image.fg.subarray(src * 4, (src + count) * 4), dest * 4);
      r.bg.set(image.bg.subarray(src * 4, (src + count) * 4), dest * 4);
      r.mask.set(chunk.type.subarray(src, src + count), dest);
      if (far) {
        sx += count;
        continue;
      }
      for (const x of cached.animated[ly]) {
        if (x < lx || x >= lx + count) continue;
        shadeCell(r.fg, r.bg, (dest + x - lx) * 4, chunk, ly * CHUNK_SIZE + x,
          cx * CHUNK_SIZE + x, wy, world.seed, t, wind);
      }
      sx += count;
    }
  }
}

function shadeCell(fg, bg, o, chunk, i, wx, wy, seed, t, wind = 0) {
  const type = chunk.type[i];
  const shade = chunk.shade[i];
  const rnd = chunk.rnd[i];

  let ch = 0;
  let cr = 0;
  let cg = 0;
  let cb = 0;
  let br = 0;
  let bgG = 0;
  let bb = 0;

  if (type === GRASS) {
    // The same quiet undergrowth beneath every height, including verges.
    // Animated blades are drawn together later in rooted depth order; the
    // ground between their clumps stays near-black navy so they stand out.
    ch = STUBBLE[Math.floor(rnd * 33) % STUBBLE.length];
    const tone = GREENS[Math.floor(rnd * 997) % GREENS.length];
    const l = 0.04 + shade * shade * 0.08;
    cr = tone[0] * l;
    cg = tone[1] * l;
    cb = tone[2] * l;
    // A few cells hold a dew drop or tiny flower that twinkles.
    if (rnd > 0.985) {
      const tw = 0.6 + 0.4 * Math.sin(t * 3 + rnd * 977);
      ch = rnd > 0.996 ? STAR : DEW;
      cr = 200 * tw;
      cg = 215 * tw;
      cb = 200 * tw;
    }
    br = NIGHT[0];
    bgG = NIGHT[1];
    bb = NIGHT[2];
    const burnt = (chunk.burnt?.[i] ?? 0) / 255;
    if (burnt > 0) {
      // A charcoal and ash centre fades into short, browned grass at
      // the ragged edge. Dew and flowers disappear with the blades.
      const family = burnt > 0.6 ? ASH : STUBBLE;
      ch = family[Math.floor(rnd * family.length)];
      const ash = 0.7 + rnd * 0.3;
      cr += (78 * ash - cr) * burnt;
      cg += (64 * ash - cg) * burnt;
      cb += (52 * ash - cb) * burnt;
      br += (8 - br) * burnt;
      bgG += (6 - bgG) * burnt;
      bb += (4 - bb) * burnt;
    }
  } else if (type === WATER) {
    // Long horizontal streaks that drift slowly, like moonlight broken up
    // by a gentle swell.
    const depth = Math.min(1, (WATER_LEVEL - chunk.elev[i]) * 12);
    const v = valueNoise(wx * ASPECT * 0.09 + t * 0.25, wy * 0.7 - t * 0.05, seed + 300) +
      Math.sin(wx * ASPECT * 0.4 + wy * 1.3 + t * 1.2) * 0.12 +
      wind * Math.sin(wx * ASPECT * 0.7 + wy * 0.9 + t * 2.7) * 0.14;
    if (v > 0.74) ch = WAVE_HI;
    else if (v > 0.63) ch = WAVE_MID;
    else if (v > 0.53) ch = WAVE_LO;
    else if (v > 0.47 && rnd < 0.4) ch = WAVE_DOT;
    const k = (0.3 + Math.max(0, v - 0.47) * 2.2) * (1 - depth * 0.3);
    cr = SWELL[0] * k;
    cg = SWELL[1] * k;
    cb = SWELL[2] * k;
    // Thin lapping foam right where the water meets the shore.
    if (depth < 0.07) {
      const lap = Math.sin(t * 1.8 + wx * ASPECT * 0.5 + rnd * 2);
      ch = lap > 0.1 ? WAVE_MID : WAVE_LO;
      const f = 0.6 + 0.4 * Math.max(0, lap);
      cr = FOAM[0] * f;
      cg = FOAM[1] * f;
      cb = FOAM[2] * f;
    }
    br = WATER_DEEP[0] + (WATER_SHALLOW[0] - WATER_DEEP[0]) * (1 - depth);
    bgG = WATER_DEEP[1] + (WATER_SHALLOW[1] - WATER_DEEP[1]) * (1 - depth);
    bb = WATER_DEEP[2] + (WATER_SHALLOW[2] - WATER_DEEP[2]) * (1 - depth);
  } else if (type === SHORE) {
    ch = SHORE_CH[Math.floor(rnd * SHORE_CH.length)];
    cr = PEBBLES[0];
    cg = PEBBLES[1];
    cb = PEBBLES[2];
    br = PEBBLE_GAP[0];
    bgG = PEBBLE_GAP[1];
    bb = PEBBLE_GAP[2];
  } else if (type === DIRT) {
    ch = DIRT_CH[Math.floor(rnd * DIRT_CH.length)];
    cr = PATH[0];
    cg = PATH[1];
    cb = PATH[2];
    br = PATH_GAP[0];
    bgG = PATH_GAP[1];
    bb = PATH_GAP[2];
  } else if (type === STONE) {
    // Rocky ground is a field of irregular slabs: find the nearest two
    // jittered seed points and draw a dark crack where they tie.
    const px = wx * ASPECT;
    const gx = Math.floor(px / SLAB);
    const gy = Math.floor(wy / SLAB);
    let d1 = 1e9;
    let d2 = 1e9;
    let id = 0;
    let ox = 0;
    let oy = 0;
    for (let j = -1; j <= 1; j++) {
      for (let k = -1; k <= 1; k++) {
        const hx = (gx + k + hash2(gx + k, gy + j, 13)) * SLAB;
        const hy = (gy + j + hash2(gx + k, gy + j, 14)) * SLAB;
        const d = Math.hypot(px - hx, wy - hy);
        if (d < d1) {
          d2 = d1;
          d1 = d;
          id = hash2(gx + k, gy + j, 15);
          ox = px - hx;
          oy = wy - hy;
        } else if (d < d2) d2 = d;
      }
    }
    if (d2 - d1 < 0.3) {
      ch = rnd < 0.5 ? CRACK_A : CRACK_B;
      cr = STONE_DARK[0];
      cg = STONE_DARK[1];
      cb = STONE_DARK[2];
    } else {
      const l = Math.max(0, Math.min(0.999, 0.35 + id * 0.4 - (ox + oy) * 0.08 + shade * 0.2));
      const fam = SLAB_FAMILIES[Math.floor(l * SLAB_FAMILIES.length)];
      ch = fam[Math.floor(rnd * 101) % fam.length];
      // Slabs facing the moon are lit toward a pale lavender; the rest
      // sink into blue-grey shade.
      const lit = l * l;
      cr = (STONE_MID[0] + (STONE_LIT[0] - STONE_MID[0]) * lit) * (0.45 + l * 0.75);
      cg = (STONE_MID[1] + (STONE_LIT[1] - STONE_MID[1]) * lit) * (0.45 + l * 0.75);
      cb = (STONE_MID[2] + (STONE_LIT[2] - STONE_MID[2]) * lit) * (0.45 + l * 0.75);
    }
    br = STONE_GAP[0];
    bgG = STONE_GAP[1];
    bb = STONE_GAP[2];
  }
  fg[o] = cr;
  fg[o + 1] = cg;
  fg[o + 2] = cb;
  fg[o + 3] = ch;
  bg[o] = br;
  bg[o + 1] = bgG;
  bg[o + 2] = bb;
}
