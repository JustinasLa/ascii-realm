import { fbm } from '../core/noise.js';
import { hash2 } from '../core/rng.js';
import { blocks, generateProps } from './props.js';

export const WATER = 0;
export const SHORE = 1;
export const GRASS = 2;
export const DIRT = 3;
export const STONE = 4;

// Cells are taller than they are wide, so horizontal distances are squashed
// before sampling noise. Without this every lake would look stretched.
export const ASPECT = 6 / 10;

export const TREE_DURABILITY = 3;
export const CHOP_RADIUS = 3;

const CHUNK = 64;
export const WATER_LEVEL = 0.4;
const SHORE_LEVEL = 0.415;
const STONE_LEVEL = 0.7;

export class World {
  constructor(seed = 1) {
    this.seed = seed;
    this.chunks = new Map();
    this.spawn = this.findSpawn();
  }

  chunk(cx, cy) {
    const key = (cx + 32768) * 65536 + (cy + 32768);
    let c = this.chunks.get(key);
    if (!c) {
      c = this.generate(cx, cy);
      this.chunks.set(key, c);
    }
    return c;
  }

  generate(cx, cy) {
    const n = CHUNK * CHUNK;
    const type = new Uint8Array(n);
    const elev = new Float32Array(n);
    const shade = new Float32Array(n);
    const rnd = new Float32Array(n);
    const s = this.seed;

    for (let ly = 0; ly < CHUNK; ly++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const x = cx * CHUNK + lx;
        const y = cy * CHUNK + ly;
        const nx = x * ASPECT;
        const i = ly * CHUNK + lx;

        const e = fbm(nx * 0.011, y * 0.011, s, 5);
        const path = Math.abs(fbm(nx * 0.004, y * 0.004, s + 77, 3) - 0.5);

        let t = GRASS;
        if (e < WATER_LEVEL) t = WATER;
        else if (e < SHORE_LEVEL) t = SHORE;
        else if (e > STONE_LEVEL) t = STONE;
        else if (path < 0.009) t = DIRT;

        type[i] = t;
        elev[i] = e;
        shade[i] = fbm(nx * 0.05, y * 0.05, s + 31, 3);
        rnd[i] = hash2(x, y, s + 5);
      }
    }
    return { cx, cy, type, elev, shade, rnd, props: null };
  }

  // Returns the chunk and index for a cell; callers read whichever arrays
  // they need, which avoids allocating an object per cell.
  locate(x, y) {
    const cx = Math.floor(x / CHUNK);
    const cy = Math.floor(y / CHUNK);
    const c = this.chunk(cx, cy);
    return { c, i: (y - cy * CHUNK) * CHUNK + (x - cx * CHUNK) };
  }

  typeAt(x, y) {
    const { c, i } = this.locate(Math.floor(x), Math.floor(y));
    return c.type[i];
  }

  // Props are generated on first request rather than with the terrain,
  // because placing them needs the spawn point, which needs terrain first.
  propsOf(cx, cy) {
    const c = this.chunk(cx, cy);
    if (!c.props) c.props = generateProps(this, cx, cy, CHUNK);
    return c.props;
  }

  // Every prop whose base lies in the chunks touching the given cell range.
  propsIn(x0, y0, x1, y1) {
    const out = [];
    for (let cy = Math.floor(y0 / CHUNK); cy <= Math.floor(y1 / CHUNK); cy++) {
      for (let cx = Math.floor(x0 / CHUNK); cx <= Math.floor(x1 / CHUNK); cx++) {
        for (const p of this.propsOf(cx, cy)) out.push(p);
      }
    }
    return out;
  }

  // A chop can hit a trunk near its landing point, or anywhere along the
  // swing when the player's ground position is supplied as its origin.
  // Distances are measured in rows, with columns corrected for cell aspect.
  chopTree(x, y, strength = 1, origin = null) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(strength) || strength <= 0) {
      return null;
    }
    const from = origin && Number.isFinite(origin.x) && Number.isFinite(origin.y) ? origin : { x, y };
    const dx = (x - from.x) * ASPECT;
    const dy = y - from.y;
    const length2 = dx * dx + dy * dy;
    let tree = null;
    let closest = Infinity;
    for (const prop of this.propsIn(
      Math.min(from.x, x) - CHOP_RADIUS / ASPECT,
      Math.min(from.y, y) - CHOP_RADIUS,
      Math.max(from.x, x) + CHOP_RADIUS / ASPECT,
      Math.max(from.y, y) + CHOP_RADIUS,
    )) {
      if (prop.kind !== 'tree') continue;
      const px = (prop.x - from.x) * ASPECT;
      const py = prop.y - from.y;
      const along = length2 > 0 ? (px * dx + py * dy) / length2 : 0;
      if (along < 0 || along > 1) continue;
      const distance = Math.hypot(px - dx * along, py - dy * along);
      if (distance > CHOP_RADIUS) continue;
      // The first trunk along the swing absorbs the blow. For a point hit,
      // the nearest trunk wins; props in neighbouring chunks cannot steal it.
      const score = Math.hypot(px, py);
      if (score >= closest) continue;
      tree = prop;
      closest = score;
    }
    if (!tree) return null;

    tree.durability = Math.max(0, (tree.durability ?? TREE_DURABILITY) - strength);
    const felled = tree.durability === 0;
    if (felled) {
      const props = this.propsOf(Math.floor(tree.x / CHUNK), Math.floor(tree.y / CHUNK));
      const index = props.indexOf(tree);
      if (index !== -1) props.splice(index, 1);
    }
    return { x: tree.x, y: tree.y, tree, felled, health: tree.durability };
  }

  isWalkable(x, y) {
    if (this.typeAt(x, y) === WATER) return false;
    for (const p of this.propsIn(x - 4, y - 2, x + 4, y + 2)) {
      if (blocks(p, x, y)) return false;
    }
    return true;
  }

  // Walks outward from the origin until it finds grass a short way north of
  // a lake, so the player starts somewhere scenic.
  findSpawn() {
    for (let r = 0; r < 600; r += 3) {
      for (let a = 0; a < 24; a++) {
        const x = Math.round(Math.cos((a / 24) * Math.PI * 2) * r / ASPECT);
        const y = Math.round(Math.sin((a / 24) * Math.PI * 2) * r);
        if (this.typeAt(x, y) !== GRASS) continue;
        let ok = true;
        for (let dy = -4; dy <= 2 && ok; dy++) {
          for (let dx = -6; dx <= 6; dx++) {
            if (this.typeAt(x + dx, y + dy) !== GRASS) {
              ok = false;
              break;
            }
          }
        }
        if (!ok) continue;
        for (let dy = 6; dy < 16; dy++) {
          if (this.typeAt(x, y + dy) === WATER) return { x: x + 0.5, y: y + 0.5 };
        }
      }
    }
    return { x: 0.5, y: 0.5 };
  }
}

export const CHUNK_SIZE = CHUNK;
