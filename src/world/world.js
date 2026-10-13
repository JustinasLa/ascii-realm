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

const CHUNK = 64;
export const WATER_LEVEL = 0.4;
// All lakes are fordable: even their lowest beds are only knee deep.
export const MAX_WATER_DEPTH = 0.42;
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

  // Scorched grass belongs to the terrain, so it survives leaving the view.
  burnGrass(x, y) {
    const bx = Math.floor(x);
    const by = Math.floor(y);
    for (let dy = -5; dy <= 5; dy++) {
      for (let dx = -11; dx <= 11; dx++) {
        const wx = bx + dx;
        const wy = by + dy;
        const distance = Math.hypot(dx / 11, dy / 4.8);
        const edge = 0.88 + hash2(wx, wy, this.seed + 919) * 0.18;
        if (distance >= edge) continue;
        const { c, i } = this.locate(wx, wy);
        if (c.type[i] !== GRASS) continue;
        if (!c.burnt) c.burnt = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
        const strength = Math.round(Math.min(1, (edge - distance) * 2.3) * 255);
        c.burnt[i] = Math.max(c.burnt[i], strength);
      }
    }
  }

  // Metres below the surface, rising gently from the bank and capped at
  // the knee regardless of how low the terrain noise goes.
  waterDepthAt(x, y) {
    const { c, i } = this.locate(Math.floor(x), Math.floor(y));
    if (c.type[i] !== WATER) return 0;
    return Math.min(MAX_WATER_DEPTH, Math.max(0, (WATER_LEVEL - c.elev[i]) / 0.065) * MAX_WATER_DEPTH);
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

  isWalkable(x, y) {
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
