import { fbm, valueNoise } from '../core/noise.js';
import { hash2 } from '../core/rng.js';
import { blocks, generateProps } from './props.js';
import { grassRoots } from './grass-roots.js';

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
const SHORE_LEVEL = 0.415;
const STONE_LEVEL = 0.7;
const smoothRange = (a, b, x) => {
  const u = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

export class World {
  constructor(seed = 1, maxChunks = 128) {
    this.seed = seed;
    this.maxChunks = Math.max(16, Math.floor(maxChunks));
    this.clock = 0;
    this.chunks = new Map();
    this.spawn = this.findSpawn();
  }

  chunk(cx, cy) {
    const key = `${cx},${cy}`;
    let c = this.chunks.get(key);
    if (!c) {
      if (this.chunks.size >= this.maxChunks) {
        let oldestKey;
        let oldest = Infinity;
        for (const [k, chunk] of this.chunks) {
          if (chunk.used < oldest) { oldest = chunk.used; oldestKey = k; }
        }
        this.chunks.delete(oldestKey);
      }
      c = this.generate(cx, cy);
      this.chunks.set(key, c);
    }
    c.used = ++this.clock;
    return c;
  }

  generate(cx, cy) {
    const n = CHUNK * CHUNK;
    const type = new Uint8Array(n);
    const elev = new Float32Array(n);
    const shade = new Float32Array(n);
    const rnd = new Float32Array(n);
    const grassHeight = new Float32Array(n);
    const grassDensity = new Float32Array(n);
    const grassStyle = new Uint8Array(n);
    const reeds = new Uint8Array(n);
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
        if (t === GRASS || t === SHORE) {
          // Blend the verge into the meadow instead of cutting out a lawn
          // at one noise threshold. Fractional heights are dithered per root
          // when drawn, so even the cell grid has no hard height bands.
          const meadow = fbm(nx * 0.022, y * 0.022, s + 701, 3);
          const wet = 1 - smoothRange(0.41, 0.45, e);
          const lush = smoothRange(0.35, 0.68, meadow);
          if (t === GRASS) {
            const verge = smoothRange(0.009, 0.035, path);
            const fieldHeight = 2.6 + lush * 1.3;
            const bank = wet * smoothRange(0.35, 0.6, meadow);
            const target = fieldHeight + (4.7 - fieldHeight) * bank;
            grassHeight[i] = 2 + (target - 2) * verge;
            grassDensity[i] = 0.22 + verge * (0.035 + lush * 0.025);
            reeds[i] = wet > 0.5 && meadow > 0.48 && verge > 0.3 ? 1 : 0;
          } else if (meadow > 0.43) {
            grassHeight[i] = 3.3 + lush * 1.3;
            grassDensity[i] = 0.15 + lush * 0.06;
            reeds[i] = 1;
          }
          const species = valueNoise(nx * 0.012, y * 0.012, s + 1801);
          const edge = (hash2(x, y, s + 1802) - 0.5) * 0.7;
          grassStyle[i] = reeds[i] ? 5 : Math.max(0, Math.min(4, Math.floor(species * 5 + edge)));
        }
      }
    }
    const chunk = { cx, cy, type, elev, shade, rnd, grassHeight, grassDensity, grassStyle, reeds, props: null };
    chunk.blades = grassRoots(chunk, s, CHUNK);
    return chunk;
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

  isWalkable(x, y) {
    if (this.typeAt(x, y) === WATER) return false;
    // Wide boulders can cross a chunk edge. Visit just the nearby chunks,
    // without building a temporary list on every movement substep.
    for (let cy = Math.floor((y - 2) / CHUNK); cy <= Math.floor((y + 2) / CHUNK); cy++) {
      for (let cx = Math.floor((x - 10) / CHUNK); cx <= Math.floor((x + 10) / CHUNK); cx++) {
        for (const p of this.propsOf(cx, cy)) if (blocks(p, x, y)) return false;
      }
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
