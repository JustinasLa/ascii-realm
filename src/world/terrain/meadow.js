// The floor of the meadow beneath the animated blades (see world/grass.js):
// dead grass and leaf litter, clover patches, moss in the shade, fallen
// petals and small stones, rare fairy rings of toadstools, and dew that
// twinkles. It stays darker than the blades so the meadow reads as grass.
// Near a path, a lake or bare rock the floor takes on their soil, sand or
// stone chips, so the ground changes softly beneath the grass.

import { fbm, valueNoise } from '../../core/noise.js';
import { hash2 } from '../../core/rng.js';
import { dg, over } from '../../render/glyphs.js';
import { NIGHT } from '../../render/palette.js';
import { ASPECT } from '../world.js';
import { emit } from './cell.js';
import { clamp01, fam, pick, smooth } from './surface.js';

const LITTER = fam('terrain.litter.');
const SOIL = fam('terrain.soil.');
const SAND = fam('terrain.sand.');
const PETAL = fam('terrain.petal.');
const CHIPS = fam('terrain.chips.');
const ASH = fam('terrain.ash.');
const CHAR = ['terrain.char.0', 'terrain.char.1', 'terrain.char.2', 'terrain.char.3'].map(dg);
const CLOVER = fam('terrain.clover.');
const MOSS = fam('moss.');
const PEBBLE = fam('pebble.');
const GRAVEL = fam('gravel.');
const SPECK = fam('speck.');
const SHELL = fam('terrain.shell.');
const MUSH = dg('mush.small');
const MUSH_CAP = dg('mush.cap');
const MUSH_STEM = dg('mush.stem');
const DEW = dg('sparkle.2');
const DEW_BIG = dg('sparkle.1');
const BLOSSOM = dg('flower.small5');

const LITTER_C = [[52, 56, 34], [60, 52, 36], [42, 58, 40], [56, 62, 40]];
const CLOVER_C = [30, 74, 48];
const MOSS_C = [26, 62, 54];
const SOIL_C = [96, 74, 54];
const SAND_C = [104, 98, 92];
const STONE_C = [96, 94, 112];
const PETAL_C = [[150, 130, 150], [160, 150, 120], [140, 140, 160], [150, 110, 120]];
const MUSH_C = [150, 136, 116];
const CAP_C = [[150, 92, 70], [156, 130, 96]];

// The terrain thresholds in world.js the floor fades toward.
const PATH_HALF = 0.009;
const SHORE_TOP = 0.415;
const STONE_LEVEL = 0.7;

// Fairy rings sit one at most to a block of this many cells.
const RING_W = 46;
const RING_H = 28;

// Dew drops twinkle, so their cells are reshaded every frame.
export function animated(chunk, i) {
  return chunk.rnd[i] > 0.988 && !(chunk.burnt?.[i] > 0);
}

// Distance in world units from a fairy ring's circle, or Infinity. A ring
// stays well inside its own block, so only that block is checked.
function fairyRing(wx, wy, seed) {
  const bx = Math.floor(wx / RING_W);
  const by = Math.floor(wy / RING_H);
  if (hash2(bx, by, seed + 4601) > 0.22) return Infinity;
  const rx = (bx + 0.25 + 0.5 * hash2(bx, by, seed + 4602)) * RING_W;
  const ry = (by + 0.25 + 0.5 * hash2(bx, by, seed + 4603)) * RING_H;
  const radius = 2 + hash2(bx, by, seed + 4604) * 2.5;
  return Math.abs(Math.hypot((wx - rx) * ASPECT, wy - ry) - radius);
}

export function shade(out, o, chunk, i, wx, wy, seed, t) {
  const shadeV = chunk.shade[i];
  const rnd = chunk.rnd[i];
  const r1 = hash2(wx, wy, seed + 4701);
  const r2 = hash2(wx, wy, seed + 4702);
  const nx = wx * ASPECT;
  // Some callers build bare chunks without elevation; treat them as open meadow.
  const elev = chunk.elev?.[i] ?? 0.55;


  // The floor is near-black, so the blades over it stand out.
  const l = 0.36 + shadeV * shadeV * 0.4;
  let g = pick(LITTER, r1);
  let c = LITTER_C[Math.floor(rnd * 997) % LITTER_C.length];
  let cr = c[0] * l;
  let cg = c[1] * l;
  let cb = c[2] * l;
  let br = NIGHT[0];
  let bgG = NIGHT[1];
  let bb = NIGHT[2];
  let og = 0;
  let or = 0;
  let og2 = 0;
  let ob = 0;
  const layer = (lg, col, m) => {
    og = over(lg);
    or = col[0] * m;
    og2 = col[1] * m;
    ob = col[2] * m;
  };

  const burnt = (chunk.burnt?.[i] ?? 0) / 255;
  if (burnt > 0) {
    // A charcoal and ash centre fades into short, browned grass at the
    // ragged edge, with the odd ember still glowing. Dew and flowers are gone.
    const ash = 0.7 + rnd * 0.3;
    if (burnt > 0.6 || r1 < burnt) {
      g = r2 < 0.55 ? pick(ASH, r1) : pick(CHAR, r1);
      cr += (78 * ash - cr) * burnt;
      cg += (64 * ash - cg) * burnt;
      cb += (52 * ash - cb) * burnt;
      if (r2 < 0.55 && burnt > 0.5 && r1 < 0.5) layer(pick(CHAR, rnd), [34, 26, 22], 1);
      else if (burnt > 0.75 && r1 > 0.96) layer(pick(SPECK, rnd), [190, 80, 30], 0.7 + rnd * 0.3);
    } else {
      cr += (96 * ash - cr) * burnt;
      cg += (80 * ash - cg) * burnt;
      cb += (52 * ash - cb) * burnt;
    }
    br += (8 - br) * burnt;
    bgG += (6 - bgG) * burnt;
    bb += (4 - bb) * burnt;
    emit(out, o, g, cr, cg, cb, br, bgG, bb, og, or, og2, ob);
    return;
  }

  if (rnd > 0.988) {
    // Dew on a blade tip, or a tiny star of a flower, twinkling. These cells
    // are reshaded every frame, so they skip the rest of the floor.
    const tw = 0.55 + 0.45 * Math.sin(t * 3 + rnd * 977);
    layer(rnd > 0.997 ? DEW_BIG : DEW, [200, 215, 225], tw);
    emit(out, o, g, cr, cg, cb, br, bgG, bb, og, or, og2, ob);
    return;
  }

  // How close the meadow comes to the neighbouring ground.
  const pathV = Math.abs(fbm(nx * 0.004, wy * 0.004, seed + 77, 3) - 0.5);
  const nearPath = smooth(PATH_HALF * 2.2, PATH_HALF, pathV);
  const nearShore = smooth(SHORE_TOP + 0.012, SHORE_TOP, elev);
  const nearStone = smooth(STONE_LEVEL - 0.02, STONE_LEVEL, elev);

  if (nearPath > 0 && r1 < nearPath * 0.8) {
    // Trodden soil spilling out from the path.
    g = pick(SOIL, r2);
    const m = 0.4 + rnd * 0.25;
    cr = SOIL_C[0] * m;
    cg = SOIL_C[1] * m;
    cb = SOIL_C[2] * m;
    br += (26 - br) * nearPath * 0.5;
    bgG += (19 - bgG) * nearPath * 0.5;
    bb += (18 - bb) * nearPath * 0.5;
  } else if (nearShore > 0 && r1 < nearShore * 0.85) {
    // Sand washed up into the grass.
    g = pick(SAND, r2);
    const m = 0.45 + rnd * 0.25;
    cr = SAND_C[0] * m;
    cg = SAND_C[1] * m;
    cb = SAND_C[2] * m;
    br += (24 - br) * nearShore * 0.6;
    bgG += (22 - bgG) * nearShore * 0.6;
    bb += (28 - bb) * nearShore * 0.6;
  }

  // Patches of clover, and moss in the shade.
  const clover = valueNoise(nx * 0.11, wy * 0.11, seed + 4703);
  const mossy = shadeV < 0.42 ? (0.42 - shadeV) * 6 : 0;
  const ring = fairyRing(wx, wy, seed);
  if (ring < 0.32 && r2 < 0.7) {
    // A fairy ring of pale toadstools.
    if (r1 < 0.6) {
      layer(MUSH, MUSH_C, 0.65 + rnd * 0.25);
    } else {
      g = MUSH_STEM;
      cr = MUSH_C[0] * 0.6;
      cg = MUSH_C[1] * 0.6;
      cb = MUSH_C[2] * 0.6;
      layer(MUSH_CAP, CAP_C[Math.floor(rnd * 2)], 0.6 + rnd * 0.2);
    }
  } else if (nearStone > 0 && r2 < nearStone * 0.3) {
    // Stone chips weathered off the rock nearby.
    layer(r1 < 0.6 ? pick(CHIPS, rnd) : pick(GRAVEL, rnd), STONE_C, 0.5 + rnd * 0.3);
  } else if ((clover > 0.62 || ring < 1.2) && r2 < 0.3 + (clover - 0.62) * 2) {
    layer(pick(CLOVER, rnd), CLOVER_C, 0.4 + rnd * 0.3 + (clover - 0.62) * 0.5);
    if (r1 < 0.04) {
      g = BLOSSOM;
      cr = 120;
      cg = 110;
      cb = 120;
    }
  } else if (mossy > 0 && r2 < mossy) {
    layer(pick(MOSS, rnd), MOSS_C, 0.45 + rnd * 0.3);
  } else if (nearShore > 0.3 && r2 > 0.97) {
    layer(pick(SHELL, rnd), [170, 160, 150], 0.45);
  } else if (r2 > 0.985) {
    layer(pick(PEBBLE, rnd), STONE_C, 0.45 + rnd * 0.2);
  } else if (r2 > 0.975) {
    layer(pick(PETAL, rnd), PETAL_C[Math.floor(rnd * 4)], 0.5 + rnd * 0.2);
  }
  emit(out, o, g, cr, cg, cb, br, bgG, bb, og, or, og2, ob);
}
