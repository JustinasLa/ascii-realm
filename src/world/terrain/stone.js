// Rocky ground: bedrock split into slabs. Each slab is shaded as a surface,
// pillowed so the rim facing the moon is lit and the far rim falls into
// shadow, and is drawn with its own texture: speckled granite, banded
// sandstone, pitted basalt or smooth worn flag. Crisp dark joints follow the
// true edges between slabs, with a lit lip on one side and a shaded lip on
// the other; some slabs have fused, leaving only a hairline crack. Grit and
// moss settle in the joints, and lichen and moss spread over the slabs.

import { fbm, valueNoise } from '../../core/noise.js';
import { hash2 } from '../../core/rng.js';
import { dg, glyph, over } from '../../render/glyphs.js';
import { NIGHT } from '../../render/palette.js';
import { ASPECT } from '../world.js';
import { emit } from './cell.js';
import { clamp01, fam, lineCell, LX, LY, pick, smooth } from './surface.js';

const SLAB = 5.2;
const BEVEL = 1.2;
// How far inside a slab its lip runs beside the joint, in world units.
const LIP = 0.2;
const BLANK = glyph(' ');

const JOINT = fam('terrain.joint.');
const FINE = fam('terrain.fine.');
const JGRIT = fam('terrain.jgrit.');
const GRAIN = fam('terrain.grain.');
const MOTTLE = fam('terrain.mottle.');
const PIT = fam('terrain.pit.');
const STRATA = fam('terrain.strata.');
const FISSURE = fam('terrain.fissure.');
const LICHEN = fam('terrain.lichen.');
const CHIPS = fam('terrain.chips.');
const MOSS = fam('moss.');
const GRAVEL = fam('gravel.');
const TUFT = ['tuft.0', 'tuft.1', 'tuft.2', 'tuft.3'].map(dg);
const MICA = dg('sparkle.2');

// Rock under moonlight drifts between a cool blue-grey and a warmer grey
// across the land; each slab shifts it a little.
const COOL = [104, 108, 142];
const WARM = [124, 114, 122];
const GAP = [6, 5, 12];
const MOSS_C = [50, 100, 80];
const LICHEN_C = [[132, 146, 112], [146, 126, 84], [124, 138, 140]];
const GRIT_C = [100, 94, 108];
const GRASS_C = [46, 104, 62];

// Nearest three slab seeds for a point, reused between calls.
const near = { d: [0, 0, 0], x: [0, 0, 0], y: [0, 0, 0], id: [0, 0, 0] };

function seeds(px, py, seed) {
  const gx = Math.floor(px / SLAB);
  const gy = Math.floor(py / SLAB);
  const { d, x, y, id } = near;
  d[0] = d[1] = d[2] = 1e9;
  for (let j = -1; j <= 1; j++) {
    for (let k = -1; k <= 1; k++) {
      const cx = gx + k;
      const cy = gy + j;
      const hx = (cx + 0.1 + 0.8 * hash2(cx, cy, seed + 13)) * SLAB;
      const hy = (cy + 0.1 + 0.8 * hash2(cx, cy, seed + 14)) * SLAB;
      const dd = (px - hx) * (px - hx) + (py - hy) * (py - hy);
      if (dd >= d[2]) continue;
      let s = 2;
      while (s > 0 && dd < d[s - 1]) {
        d[s] = d[s - 1];
        x[s] = x[s - 1];
        y[s] = y[s - 1];
        id[s] = id[s - 1];
        s--;
      }
      d[s] = dd;
      x[s] = hx;
      y[s] = hy;
      id[s] = Math.floor(hash2(cx, cy, seed + 15) * 0x7fffffff);
    }
  }
}

// The edges from the nearest slab to the second and third: unit normal
// pointing out of the slab, distance from the point, and whether the two
// slabs have fused so only a hairline crack is left.
const edges = [
  { nx: 0, ny: 0, e: 0, fused: false },
  { nx: 0, ny: 0, e: 0, fused: false },
];
function edgeTo(k, px, py, seed) {
  const ed = edges[k - 1];
  const ax = near.x[0];
  const ay = near.y[0];
  let nx = near.x[k] - ax;
  let ny = near.y[k] - ay;
  const len = Math.hypot(nx, ny) || 1;
  nx /= len;
  ny /= len;
  ed.nx = nx;
  ed.ny = ny;
  ed.e = ((ax + near.x[k]) / 2 - px) * nx + ((ay + near.y[k]) / 2 - py) * ny;
  const a = near.id[0];
  const b = near.id[k];
  ed.fused = hash2(Math.min(a, b), Math.max(a, b), seed + 4400) < 0.38;
  return ed;
}

export function animated() {
  return false;
}

export function shade(out, o, chunk, i, wx, wy, seed) {
  const rnd = chunk.rnd[i];
  const px = (wx + 0.5) * ASPECT;
  const py = wy + 0.5;
  seeds(px, py, seed);
  const id = near.id[0];
  const r1 = hash2(wx, wy, seed + 4101);
  const r2 = hash2(wx, wy, seed + 4102);
  const slabR = hash2(id, 0, seed + 4103);
  edgeTo(1, px, py, seed);
  edgeTo(2, px, py, seed);

  // A pillowed slab: tilted a little as a whole, with rims that roll off
  // toward open joints. The rim facing the moon is lit, the far rim shaded.
  const tiltX = (hash2(id, 1, 7) - 0.5) * 0.1;
  const tiltY = (hash2(id, 2, 7) - 0.5) * 0.1;
  let l = 0.48 + (slabR - 0.5) * 0.5 + (px - near.x[0]) * tiltX + (py - near.y[0]) * tiltY +
    (chunk.shade[i] - 0.5) * 0.35;
  let rim = 0;
  for (const ed of edges) {
    if (ed.fused) continue;
    const b = clamp01(1 - ed.e / BEVEL);
    rim += b * b * (ed.nx * LX + ed.ny * LY);
  }
  l = clamp01(l + rim * 0.18);

  const warm = clamp01(valueNoise(px * 0.035, py * 0.035, seed + 4405) * 1.6 - 0.3 + (slabR - 0.5) * 0.4);
  const tr = COOL[0] + (WARM[0] - COOL[0]) * warm;
  const tg = COOL[1] + (WARM[1] - COOL[1]) * warm;
  const tb = COOL[2] + (WARM[2] - COOL[2]) * warm;
  const lit = l * l;
  // The bedrock is a dim surface; texture glyphs draw lighter grain on it.
  const bk = 0.16 + 0.2 * l + 0.14 * lit;
  let br = tr * bk;
  let bgG = tg * bk;
  let bb = tb * bk;
  const gk = 0.5 + 0.45 * l + 0.4 * lit;
  let cr = tr * gk;
  let cg = tg * gk;
  let cb = tb * gk;

  // Damp hollows grow moss; dry, lit tops grow lichen. Toward the stone's
  // edge the rock breaks up and grass takes over the joints.
  const damp = fbm(px * 0.11, py * 0.11, seed + 4401, 2) + (0.5 - chunk.shade[i]) * 0.4 - rim * 0.2;
  const growth = valueNoise(px * 0.45, py * 0.45, seed + 4404);
  const edgeness = smooth(0.716, 0.7, chunk.elev[i]);
  const mossy = damp > 0.6 ? clamp01((damp - 0.6) * 5) * (0.4 + growth * 0.6) : 0;
  if (damp > 0.6) {
    // Moss darkens and greens the rock beneath it.
    const k = clamp01((damp - 0.6) * 5) * 0.5;
    br += (MOSS_C[0] * 0.18 - br) * k;
    bgG += (MOSS_C[1] * 0.18 - bgG) * k;
    bb += (MOSS_C[2] * 0.18 - bb) * k;
  }

  if (edgeness > 0) {
    // The rock thins out into the meadow's dark soil at its edge.
    const k = edgeness * 0.55;
    br += (NIGHT[0] - br) * k;
    bgG += (NIGHT[1] - bgG) * k;
    bb += (NIGHT[2] - bb) * k;
  }

  // The layered glyph, chosen below.
  let og = 0;
  let or = 0;
  let og2 = 0;
  let ob = 0;
  const layer = (g, r, gg, b) => {
    og = over(g);
    or = r;
    og2 = gg;
    ob = b;
  };
  // A slab's lip: lit where its rim faces the moon, shaded where it faces away.
  const lip = (ed) => {
    if (ed.fused || ed.e > 0.85) return false;
    const j = lineCell(ed.nx, ed.ny, ed.e - LIP);
    if (j < 0) return false;
    const face = ed.nx * LX + ed.ny * LY;
    if (face > 0.15) {
      const k = 0.55 + l * 0.35 + face * 0.35;
      layer(FINE[j], tr * k, tg * k, tb * k);
      return true;
    }
    if (face < -0.25) {
      const k = 0.4 - face * 0.5;
      layer(FINE[j], br + (GAP[0] - br) * k, bgG + (GAP[1] - bgG) * k, bb + (GAP[2] - bb) * k);
      return true;
    }
    return false;
  };

  // Joints: crisp dark lines along the true slab edges.
  const ab = edges[0];
  const ac = edges[1];
  const jAB = ab.e < 0.6 ? lineCell(ab.nx, ab.ny, ab.e) : -1;
  if (jAB >= 0) {
    const jAC = ac.e < 0.6 ? lineCell(ac.nx, ac.ny, ac.e) : -1;
    if (ab.fused) {
      // A hairline crack where two slabs have fused into one.
      if (jAC >= 0 && !ac.fused) layer(JOINT[jAC], GAP[0], GAP[1], GAP[2]);
      else if (mossy > 0.3 && r1 < mossy) layer(JGRIT[jAB], MOSS_C[0] * 0.7, MOSS_C[1] * 0.7, MOSS_C[2] * 0.7);
      emit(out, o, FINE[jAB], br * 0.35, bgG * 0.35, bb * 0.4, br, bgG, bb, og, or, og2, ob);
      return;
    }
    if (jAC >= 0 && jAC !== jAB) {
      layer(ac.fused ? FINE[jAC] : JOINT[jAC], GAP[0], GAP[1], GAP[2]);
    } else if (edgeness > 0.3 && r1 < edgeness * 0.8) {
      layer(pick(TUFT, r2), GRASS_C[0] * 0.75, GRASS_C[1] * 0.75, GRASS_C[2] * 0.75);
    } else if (mossy > 0 && r1 < mossy * 1.4) {
      const k = 0.55 + growth * 0.35;
      layer(JGRIT[jAB], MOSS_C[0] * k, MOSS_C[1] * k, MOSS_C[2] * k);
    } else if (!lip(ab) && hash2(id, near.id[1], seed + 4402) < 0.6 && r1 < 0.8) {
      const k = 0.55 + r2 * 0.4;
      layer(JGRIT[jAB], GRIT_C[0] * k, GRIT_C[1] * k, GRIT_C[2] * k);
    }
    emit(out, o, JOINT[jAB], GAP[0], GAP[1], GAP[2], br, bgG, bb, og, or, og2, ob);
    return;
  }

  // Slab texture by rock kind.
  const kind = Math.floor(hash2(id, 3, 7) * 4);
  let g = BLANK;
  let gk2 = 1;
  if (kind === 0) {
    // Speckled granite with the odd pit.
    g = r1 < 0.05 ? pick(PIT, r2) : r1 < 0.75 ? pick(GRAIN, r2) : pick(MOTTLE, r2);
  } else if (kind === 1) {
    // Banded sandstone: one band pattern per row of the slab.
    const row = hash2(Math.floor(py), id, seed + 4403);
    g = row < 0.75 ? pick(STRATA, row / 0.75) : r1 < 0.5 ? pick(GRAIN, r2) : BLANK;
    gk2 = 0.9;
  } else if (kind === 2) {
    // Pitted, darker basalt.
    g = r1 < 0.2 ? pick(PIT, r2) : r1 < 0.6 ? pick(GRAIN, r2) : BLANK;
    br *= 0.82;
    bgG *= 0.82;
    bb *= 0.88;
    gk2 = 0.85;
  } else {
    // Smooth, worn flag with hairline fissures.
    g = r1 < 0.05 ? pick(FISSURE, r2) : r1 < 0.5 ? pick(MOTTLE, r2) : BLANK;
  }
  if (g !== BLANK && (FISSURE.includes(g) || PIT.includes(g))) gk2 *= 0.8;
  if (edgeness > 0.25 && r1 > 1 - edgeness * 0.5) {
    // Weathered to grit at the edge of the rock.
    g = pick(GRAVEL, r2);
    gk2 = 0.8;
  }
  cr *= gk2;
  cg *= gk2;
  cb *= gk2;

  if (edgeness > 0.2 && r2 < edgeness * 0.35) {
    // Broken rock and grass at the edge of the stony ground.
    if (r1 < 0.5) layer(pick(CHIPS, rnd), tr * (0.5 + l * 0.5), tg * (0.5 + l * 0.5), tb * (0.5 + l * 0.5));
    else layer(pick(TUFT, rnd), GRASS_C[0] * 0.7, GRASS_C[1] * 0.7, GRASS_C[2] * 0.7);
  } else if (lip(ab) || lip(ac)) {
    // The lip of the slab beside a joint (set by lip()).
  } else if (mossy > 0.25 && r2 < mossy * 0.8) {
    const k = 0.4 + growth * 0.45;
    layer(pick(MOSS, rnd), MOSS_C[0] * k, MOSS_C[1] * k, MOSS_C[2] * k);
  } else if (damp < 0.5 && growth > 0.6 && r2 < 0.14) {
    const c = LICHEN_C[Math.floor(hash2(Math.floor(growth * 6), id, 9) * 3)];
    const k = 0.5 + l * 0.4;
    layer(pick(LICHEN, rnd), c[0] * k, c[1] * k, c[2] * k);
  } else if (r2 > 0.988) {
    // A glint of mica.
    layer(MICA, 170 + l * 40, 180 + l * 40, 215 + l * 30);
  }
  emit(out, o, g, cr, cg, cb, br, bgG, bb, og, or, og2, ob);
}
