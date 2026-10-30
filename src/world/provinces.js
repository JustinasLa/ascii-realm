// Provinces: the world is split into regions about 160 m across, each with
// one terrain, 'land', 'water' or 'bog'. They are a seeded, jittered grid:
// every grid cell holds one seed point, and a cell of the world belongs to the
// seed nearest it once its position is warped a little, so borders wander and
// never run straight. Everything is a pure function of the seed and worked
// out on demand, so nothing about provinces is saved but their ids.
//
// Positions come in world cells and are measured in ground metres (see
// rivers.js): a metre spans SCALE / ASPECT columns but only SCALE * TILT rows.

import { valueNoise } from '../core/noise.js';
import { hash2 } from '../core/rng.js';
import { SCALE, TILT } from '../entities/rig.js';
import { ASPECT, landType, SHORE, seededLand, WATER } from './world.js';

// Grid side in metres. Each seed lies in the middle half of its grid cell,
// so its own cell's seed is within 0.75·√2·S of any point and every seed two
// cells away is at least 1.25·S off: the nearest is always in the 3×3 around.
export const PROVINCE_METRES = 160;
const S = PROVINCE_METRES;
const JITTER = 0.5;
// How far, in metres, a position is warped before its seed is looked up.
export const WARP = 24;
const WARP_FREQ = 0.008;
// Bounds how much farther apart two warped points can be than the points
// themselves: one plus the warp's largest stretch (each of its four partial
// derivatives is at most 2·WARP·WARP_FREQ·15/8, the noise's steepest slope).
const LIPSCHITZ = 1 + 2 * (2 * WARP * WARP_FREQ * 15 / 8);
// Beyond this many cells from the origin there are no provinces: id 0.
export const MAX_COORD = 1e7;
// About this share of the land provinces are bog.
export const BOG_SHARE = 0.1;
// The mean bog weight of land provinces, measured over seeds 1–5 so the
// share of bogs lands near BOG_SHARE.
export const MEAN_WEIGHT = 0.6;
const MAX_BOG_CHANCE = 0.6;
// No province reaching this near spawn is bog, in metres.
export const SPAWN_CLEAR = 64;
// edgePoint stops this far inside a province's border, in metres.
export const EDGE_STAND = 6;
const HEART_RADII = [8, 16, 32];
const PROBES = 8;
// A run of cells that touch no cell of the province being bordered.
const OTHER = -1;

const zigzag = (n) => (n >= 0 ? 2 * n : -2 * n - 1);
const unzigzag = (z) => (z % 2 === 0 ? z / 2 : -(z + 1) / 2);
// One positive id per grid cell (Szudzik's pairing), a safe integer far
// past MAX_COORD; 0 means no province.
export function provinceId(i, j) {
  const a = zigzag(i);
  const b = zigzag(j);
  return 1 + (a >= b ? a * a + a + b : b * b + a);
}
export function gridOf(id) {
  const z = id - 1;
  const s = Math.floor(Math.sqrt(z));
  const r = z - s * s;
  return r < s ? { i: unzigzag(r), j: unzigzag(s) } : { i: unzigzag(s), j: unzigzag(r - s) };
}

export const toMetres = (x, y) => ({ x: x * ASPECT / SCALE, y: y / (SCALE * TILT) });
export const toCellPoint = (mx, my) => ({ x: mx * SCALE / ASPECT, y: my * SCALE * TILT });

export class Provinces {
  // `spawn` keeps its province and those near it free of bog. `bogs: false`
  // leaves every province land or water. `landTypeAt` and `elevAt` read the
  // seeded land by cell, without generating chunks.
  constructor(seed, { spawn = { x: 0, y: 0 }, bogs = true, landTypeAt, elevAt } = {}) {
    this.seed = seed;
    this.bogs = bogs;
    this.elevAt = elevAt ?? ((x, y) => seededLand(x, y, seed));
    this.landTypeAt = landTypeAt ?? ((x, y) => landType(this.elevAt(x, y)));
    this.spawn = { x: Math.floor(spawn.x), y: Math.floor(spawn.y) };
    this.info = new Map();
    this.borders = new Map();
    // What the last lookup found: the nearest seed's grid cell, the warped
    // position, and its distances in metres to the nearest seed and (at
    // least) the next nearest. No seed outside the 3×3 is nearer than 1.25·S.
    this.found = { i: 0, j: 0, wx: 0, wy: 0, d1: 0, d2: 0 };
  }

  seedOf(i, j) {
    return {
      x: (i + 0.25 + JITTER * hash2(i, j, this.seed + 9001)) * S,
      y: (j + 0.25 + JITTER * hash2(i, j, this.seed + 9002)) * S,
    };
  }

  // Fills `found` for a cell; false outside the provinces' bounds.
  lookup(x, y) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (Math.abs(x) > MAX_COORD || Math.abs(y) > MAX_COORD) return false;
    const mx = x * ASPECT / SCALE;
    const my = y / (SCALE * TILT);
    const wx = mx + WARP * (2 * valueNoise(mx * WARP_FREQ, my * WARP_FREQ, this.seed + 9003) - 1);
    const wy = my + WARP * (2 * valueNoise(mx * WARP_FREQ, my * WARP_FREQ, this.seed + 9004) - 1);
    const gi = Math.floor(wx / S);
    const gj = Math.floor(wy / S);
    const f = this.found;
    let d1 = Infinity;
    let d2 = 1.25 * S;
    for (let j = gj - 1; j <= gj + 1; j++) {
      for (let i = gi - 1; i <= gi + 1; i++) {
        const dx = wx - (i + 0.25 + JITTER * hash2(i, j, this.seed + 9001)) * S;
        const dy = wy - (j + 0.25 + JITTER * hash2(i, j, this.seed + 9002)) * S;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < d1) {
          d2 = Math.min(d2, d1);
          d1 = d;
          f.i = i;
          f.j = j;
        } else if (d < d2) d2 = d;
      }
    }
    f.wx = wx;
    f.wy = wy;
    f.d1 = d1;
    f.d2 = d2;
    return true;
  }

  // The id of the province holding a cell: a positive integer, stable for a
  // seed, or 0 beyond MAX_COORD.
  idAt(x, y) {
    return this.lookup(x, y) ? provinceId(this.found.i, this.found.j) : 0;
  }

  // How far round a cell, in ground metres, every cell surely shares its
  // province: half the gap between the nearest two seeds, which no border
  // comes nearer than in warped space, brought back through the warp.
  safeRadius() {
    return (this.found.d2 - this.found.d1) / (2 * LIPSCHITZ);
  }

  // The province of the cell `metres` from a cell along the k-th of 8
  // directions on the ground.
  probe(x, y, metres, k) {
    const a = (k / PROBES) * Math.PI * 2;
    return this.idAt(x + Math.cos(a) * metres * SCALE / ASPECT, y + Math.sin(a) * metres * SCALE * TILT);
  }

  // Whether 8 probes on a ground circle of `metres` round a cell are all in
  // province `id`.
  ringInside(id, x, y, metres) {
    for (let k = 0; k < PROBES; k++) if (this.probe(x, y, metres, k) !== id) return false;
    return true;
  }

  // A province's terrain, worked out once from the samples of a 7×7 lattice
  // 32 m apart round its seed that fall inside it.
  details(id) {
    let d = this.info.get(id);
    if (d) return d;
    d = { terrain: 'land', samples: [], heart: null };
    this.info.set(id, d);
    if (!id) return d;
    const { i, j } = gridOf(id);
    const seed = this.seedOf(i, j);
    let water = 0, lake = 0, elev = 0;
    for (let sy = -3; sy <= 3; sy++) {
      for (let sx = -3; sx <= 3; sx++) {
        const c = toCellPoint(seed.x + sx * 0.2 * S, seed.y + sy * 0.2 * S);
        const p = { x: Math.floor(c.x), y: Math.floor(c.y), away: sx * sx + sy * sy };
        if (this.idAt(p.x, p.y) !== id) continue;
        const t = this.landTypeAt(p.x, p.y);
        if (t === WATER) water++;
        if (t === WATER || t === SHORE) lake++;
        elev += this.elevAt(p.x, p.y);
        d.samples.push(p);
      }
    }
    // The seed itself always lies in its province (no warp moves a point half
    // way to another seed), so there is at least one sample.
    const kept = d.samples.length;
    if (water > kept / 2) d.terrain = 'water';
    else if (this.bogs && !this.nearSpawn(id)) {
      const low = Math.max(0, Math.min(1, (0.56 - elev / kept) / 0.12));
      const weight = 0.35 + 2.2 * (lake / kept) + 0.9 * low;
      const chance = Math.min(MAX_BOG_CHANCE, BOG_SHARE * weight / MEAN_WEIGHT);
      if (hash2(i, j, this.seed + 9101) < chance) d.terrain = 'bog';
    }
    return d;
  }

  // Whether a province holds spawn or reaches within SPAWN_CLEAR of it.
  nearSpawn(id) {
    const { x, y } = this.spawn;
    if (this.idAt(x, y) === id) return true;
    for (let k = 0; k < PROBES; k++) if (this.probe(x, y, SPAWN_CLEAR, k) === id) return true;
    return false;
  }

  terrain(id) {
    return this.details(id).terrain;
  }

  // A cell well inside a province, or null for id 0: of its lattice samples,
  // the one whose probe ring stays inside at the largest of 8, 16 and 32 m,
  // the nearest the seed of those.
  heart(id) {
    const d = this.details(id);
    if (!d.heart && d.samples.length) {
      let best = -1;
      for (const p of d.samples) {
        let depth = 0;
        while (depth < HEART_RADII.length && this.ringInside(id, p.x, p.y, HEART_RADII[depth])) depth++;
        if (depth > best || depth === best && p.away < d.heart.away) {
          best = depth;
          d.heart = p;
        }
      }
    }
    return d.heart && { x: d.heart.x, y: d.heart.y };
  }

  // The provinces sharing a border with `id`: those owning a cell 4-adjacent
  // to one of its cells, sorted. Worked out once per id, row by row.
  neighbours(id) {
    let list = this.borders.get(id);
    if (list) return list;
    const found = new Set();
    if (id) {
      // The province's cells lie within its seed's grid cell grown by S, and
      // then by the warp, on every side.
      const { i, j } = gridOf(id);
      const seed = this.seedOf(i, j);
      const lo = toCellPoint((i - 1) * S - WARP, (j - 1) * S - WARP);
      const hi = toCellPoint((i + 2) * S + WARP, (j + 2) * S + WARP);
      const x0 = Math.floor(lo.x) - 1, x1 = Math.ceil(hi.x) + 1;
      let above = null;
      for (let y = Math.floor(lo.y) - 1; y <= Math.ceil(hi.y) + 1; y++) {
        const row = this.runs(y, x0, x1, id, seed);
        for (let k = 0; k + 2 < row.length; k += 2) {
          if (row[k + 1] === id) found.add(row[k + 3]);
          else if (row[k + 3] === id) found.add(row[k + 1]);
        }
        // Runs above and below that overlap.
        for (let a = 0, b = 0; above && a < above.length && b < row.length;) {
          const top = above[a + 1], bottom = row[b + 1];
          if (top === id && bottom !== id) found.add(bottom);
          else if (bottom === id && top !== id) found.add(top);
          const endA = a + 2 < above.length ? above[a + 2] : Infinity;
          const endB = b + 2 < row.length ? row[b + 2] : Infinity;
          if (endA <= endB) a += 2;
          if (endB <= endA) b += 2;
        }
        above = row;
      }
    }
    list = [...found].sort((a, b) => a - b);
    this.borders.set(id, list);
    return list;
  }

  // A row's cells from x0 to x1 as [start, id, start, id, ...] runs, exact
  // wherever a cell touches province `id`. Each lookup vouches for the cells
  // within its safe radius; away from `id`, it also vouches that no cell of
  // `id` lies within half the gap to `id`'s seed (brought back through the
  // warp), and the cells whose neighbours are all that far in become an
  // OTHER run, whatever province they are in.
  runs(y, x0, x1, id, seed) {
    const perCol = ASPECT / SCALE;
    const perRow = 1 / (SCALE * TILT);
    const f = this.found;
    const out = [];
    for (let x = x0, last = OTHER; x <= x1;) {
      const here = this.idAt(x, y);
      if (here !== last) out.push(x, last = here);
      let step = Math.max(1, Math.ceil(this.safeRadius() / perCol) - 1);
      if (here !== id) {
        const away = (Math.hypot(f.wx - seed.x, f.wy - seed.y) - f.d1) / (2 * LIPSCHITZ) - perRow;
        const skip = Math.ceil(away / perCol) - 1;
        if (skip > step) {
          out.push(x + 1, last = OTHER);
          step = skip + 1;
        }
      }
      x += step;
    }
    return out;
  }

  // The province of `terrain` whose heart is nearest a cell, searching up to
  // `rings` grid cells out, or null.
  nearest(terrain, x, y, rings = 16) {
    const m = toMetres(x, y);
    const gi = Math.floor(m.x / S);
    const gj = Math.floor(m.y / S);
    let best = null;
    let bestDist = Infinity;
    for (let r = 0; r <= rings; r++) {
      // A heart lies within 1.35 S of its seed's grid cell.
      if ((r - 2) * S > bestDist) break;
      for (let j = gj - r; j <= gj + r; j++) {
        for (let i = gi - r; i <= gi + r; i++) {
          if (Math.max(Math.abs(i - gi), Math.abs(j - gj)) !== r) continue;
          const id = provinceId(i, j);
          if (this.terrain(id) !== terrain) continue;
          const heart = this.heart(id);
          const h = toMetres(heart.x, heart.y);
          const dist = Math.hypot(h.x - m.x, h.y - m.y);
          if (dist < bestDist) {
            bestDist = dist;
            best = id;
          }
        }
      }
    }
    return best;
  }

  // A cell just inside province `id`'s border on the side facing `from`:
  // walking from its heart in 2 m steps, the first point with a border within
  // EDGE_STAND of it. Every province is bounded, so the walk ends.
  edgePoint(id, from) {
    const heart = this.heart(id);
    const h = toMetres(heart.x, heart.y);
    const f = toMetres(from.x, from.y);
    const len = Math.hypot(f.x - h.x, f.y - h.y);
    const ux = len > 0 ? (f.x - h.x) / len : 1;
    const uy = len > 0 ? (f.y - h.y) / len : 0;
    let p = heart;
    for (let t = 2; this.ringInside(id, p.x, p.y, EDGE_STAND); t += 2) {
      const c = toCellPoint(h.x + ux * t, h.y + uy * t);
      p = { x: Math.floor(c.x), y: Math.floor(c.y) };
    }
    return p;
  }
}
