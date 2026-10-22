// The strip between meadow and lake: pale, dry sand and pebbles up the
// bank, a tide line of dark weed and shells, and dark wet sand at the water's
// edge with ripple marks and glossy glints of moonlight.

import { fbm } from '../../core/noise.js';
import { hash2 } from '../../core/rng.js';
import { over } from '../../render/glyphs.js';
import { ASPECT, CHUNK_SIZE as CHUNK, WATER, WATER_LEVEL } from '../world.js';
import { emit } from './cell.js';
import { clamp01, fam, headingIndex, pick } from './surface.js';

// Shore lies between the water and this elevation (see world.js).
const SHORE_TOP = 0.415;

const SAND = fam('terrain.sand.');
const RIPPLE = fam('terrain.ripple.');
const SHELL = fam('terrain.shell.');
const WRACK = fam('terrain.wrack.');
const GLINT = fam('terrain.glint.');
const CHIPS = fam('terrain.chips.');
const PEBBLE = fam('pebble.');
const GRAVEL = fam('gravel.');
const TWIG = fam('twig.');

const DRY_BG = [32, 29, 34];
const WET_BG = [14, 16, 30];
const DRY_SAND = [152, 142, 128];
const WET_SAND = [74, 84, 108];
const STONES = [[140, 138, 146], [86, 90, 108], [136, 118, 98], [110, 106, 112], [160, 152, 140]];
const SHELL_C = [184, 172, 160];
const WRACK_C = [60, 70, 42];
const WOOD = [128, 116, 100];
const GLINT_C = [160, 182, 220];

// How wet a shore cell is: 0 at the top of the bank, 1 at the water.
export function wetness(chunk, i) {
  let wet = clamp01((SHORE_TOP - chunk.elev[i]) / (SHORE_TOP - WATER_LEVEL));
  const lx = i % CHUNK;
  const ly = (i - lx) / CHUNK;
  // Right beside open water the sand is soaked whatever the elevation says.
  for (let dy = -1; dy <= 1; dy++) {
    const y = ly + dy;
    if (y < 0 || y >= CHUNK) continue;
    for (let dx = -1; dx <= 1; dx++) {
      const x = lx + dx;
      if (x < 0 || x >= CHUNK || (dx === 0 && dy === 0)) continue;
      if (chunk.type[y * CHUNK + x] === WATER) return Math.max(wet, dx === 0 || dy === 0 ? 0.85 : 0.7);
    }
  }
  return wet;
}

// A few glints on the wet sand twinkle.
export function animated(chunk, i, wx, wy, seed) {
  return hash2(wx, wy, seed + 4301) > 0.975 && wetness(chunk, i) > 0.55;
}

const elevation = (wx, wy, seed) => fbm(wx * ASPECT * 0.011, wy * 0.011, seed, 5);

export function shade(out, o, chunk, i, wx, wy, seed, t = 0) {
  const rnd = chunk.rnd[i];
  const r1 = hash2(wx, wy, seed + 4302);
  const r2 = hash2(wx, wy, seed + 4303);
  const wet = wetness(chunk, i);
  const w = wet * wet * (3 - 2 * wet);
  const lift = 1 + (chunk.shade[i] - 0.5) * 0.3;

  let br = (DRY_BG[0] + (WET_BG[0] - DRY_BG[0]) * w) * lift;
  let bgG = (DRY_BG[1] + (WET_BG[1] - DRY_BG[1]) * w) * lift;
  let bb = (DRY_BG[2] + (WET_BG[2] - DRY_BG[2]) * w) * lift;
  const sk = (0.7 + rnd * 0.35) * lift;
  let g = pick(SAND, r1);
  let cr = (DRY_SAND[0] + (WET_SAND[0] - DRY_SAND[0]) * w) * sk;
  let cg = (DRY_SAND[1] + (WET_SAND[1] - DRY_SAND[1]) * w) * sk;
  let cb = (DRY_SAND[2] + (WET_SAND[2] - DRY_SAND[2]) * w) * sk;
  let og = 0;
  let or = 0;
  let og2 = 0;
  let ob = 0;
  const layer = (lg, c, m) => {
    og = over(lg);
    or = c[0] * m;
    og2 = c[1] * m;
    ob = c[2] * m;
  };

  if (wet > 0.55 && r1 < 0.5) {
    // Ripple marks run along the waterline.
    const ex = elevation(wx + 1, wy, seed) - elevation(wx - 1, wy, seed);
    const ey = elevation(wx, wy + 1, seed) - elevation(wx, wy - 1, seed);
    g = RIPPLE[headingIndex(-ey, ex / ASPECT, RIPPLE.length)];
    cr *= 0.8;
    cg *= 0.8;
    cb *= 0.8;
  }

  const tide = wet > 0.3 && wet < 0.62;
  if (wet > 0.5 && r2 < 0.12) {
    // Moonlight caught on the wet sand.
    const tw = animated(chunk, i, wx, wy, seed) ? 0.55 + 0.45 * Math.sin(t * 2.3 + rnd * 40) : 0.75 + rnd * 0.25;
    layer(pick(GLINT, rnd), GLINT_C, tw);
  } else if (tide && r2 < 0.55) {
    // The tide line: dark weed with shells caught in it.
    if (r1 < 0.15) layer(pick(SHELL, rnd), SHELL_C, 0.6 + rnd * 0.25);
    else layer(pick(WRACK, rnd), WRACK_C, 0.6 + rnd * 0.4);
  } else if (r2 > 0.68 - (1 - wet) * 0.12) {
    // Pebbles, glossier and darker where wet.
    const c = STONES[Math.floor(rnd * 997) % STONES.length];
    const m = (0.55 + rnd * 0.35) * (1 - w * 0.35);
    const which = r1 * 3;
    layer(which < 1.3 ? pick(PEBBLE, rnd) : which < 2.2 ? pick(GRAVEL, rnd) : pick(CHIPS, rnd),
      [c[0], c[1], c[2] + w * 20], m);
  } else if (wet < 0.5 && r2 < 0.05) {
    layer(pick(SHELL, rnd), SHELL_C, 0.55 + rnd * 0.3);
  } else if (wet < 0.4 && r2 < 0.075) {
    // Bleached driftwood.
    layer(pick(TWIG, rnd), WOOD, 0.6 + rnd * 0.25);
  }
  emit(out, o, g, cr, cg, cb, br, bgG, bb, og, or, og2, ob);
}
