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
const SHORE_LEVEL = 0.415;
const STONE_LEVEL = 0.7;
const EDIT_ELEVATION = [0.36, (WATER_LEVEL + SHORE_LEVEL) / 2, 0.54, 0.54, 0.78];
const cellKey = (x, y) => `${x},${y}`;
const chunkKey = (cx, cy) => `${cx},${cy}`;

export class World {
  constructor(seed = 1) {
    this.seed = seed;
    this.chunks = new Map();
    this.terrainEdits = new Map();
    this.addedProps = new Map();
    this.removedProps = new Set();
    this.addedPropChunks = new Map();
    this.propRenderW = 30;
    this.propRenderH = 50;
    this.propFootW = 10;
    this.propFootH = 2;
    this.spawn = this.findSpawn();
  }

  chunk(cx, cy) {
    const key = chunkKey(cx, cy);
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
    const baseType = type.slice();
    const baseElev = elev.slice();
    // Ground rendering reads these arrays directly, so overrides must live in
    // the chunk as well as in the editor's portable scene description.
    for (let ly = 0; ly < CHUNK; ly++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const edit = this.terrainEdits.get(cellKey(cx * CHUNK + lx, cy * CHUNK + ly));
        if (edit === undefined) continue;
        const i = ly * CHUNK + lx;
        type[i] = edit;
        elev[i] = EDIT_ELEVATION[edit];
      }
    }
    return { cx, cy, type, elev, baseType, baseElev, shade, rnd, props: null };
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

  originalTypeAt(x, y) {
    const { c, i } = this.locate(Math.floor(x), Math.floor(y));
    return c.baseType[i];
  }

  setTerrain(x, y, type) {
    const { c, i } = this.locate(x, y);
    const key = cellKey(x, y);
    if (type === c.baseType[i]) {
      this.terrainEdits.delete(key);
      c.type[i] = c.baseType[i];
      c.elev[i] = c.baseElev[i];
    } else {
      this.terrainEdits.set(key, type);
      c.type[i] = type;
      c.elev[i] = EDIT_ELEVATION[type];
    }
  }

  addProp(prop) {
    if (this.addedProps.has(prop.id)) this.deleteProp(prop.id);
    this.addedProps.set(prop.id, prop);
    for (const cell of prop.cells) {
      this.propRenderW = Math.max(this.propRenderW, Math.abs(cell.dx));
      this.propRenderH = Math.max(this.propRenderH, -cell.dy);
    }
    this.propFootW = Math.max(this.propFootW, prop.footW);
    this.propFootH = Math.max(this.propFootH, prop.footH);
    const key = chunkKey(Math.floor(prop.x / CHUNK), Math.floor(prop.y / CHUNK));
    if (!this.addedPropChunks.has(key)) this.addedPropChunks.set(key, new Map());
    this.addedPropChunks.get(key).set(prop.id, prop);
  }

  deleteProp(id) {
    const prop = this.addedProps.get(id);
    if (!prop) return false;
    this.addedProps.delete(id);
    const key = chunkKey(Math.floor(prop.x / CHUNK), Math.floor(prop.y / CHUNK));
    const list = this.addedPropChunks.get(key);
    list.delete(id);
    if (!list.size) this.addedPropChunks.delete(key);
    return true;
  }

  clearScenery() {
    for (const key of this.terrainEdits.keys()) {
      const [x, y] = key.split(',').map(Number);
      const { c, i } = this.locate(x, y);
      c.type[i] = c.baseType[i];
      c.elev[i] = c.baseElev[i];
    }
    this.terrainEdits.clear();
    this.addedProps.clear();
    this.addedPropChunks.clear();
    this.removedProps.clear();
    this.propRenderW = 30;
    this.propRenderH = 50;
    this.propFootW = 10;
    this.propFootH = 2;
  }

  // Props are generated on first request rather than with the terrain,
  // because placing them needs the spawn point, which needs terrain first.
  propsOf(cx, cy) {
    const c = this.chunk(cx, cy);
    if (!c.props) {
      // Procedural scenery belongs to the original seeded landscape, even if
      // a brush changed this chunk before its props were first requested.
      const original = {
        seed: this.seed,
        spawn: this.spawn,
        typeAt: (x, y) => this.originalTypeAt(x, y),
      };
      c.props = generateProps(original, cx, cy, CHUNK);
      c.props.forEach((prop, i) => { prop.id = `p:${cx}:${cy}:${i}`; });
    }
    const added = this.addedPropChunks.get(chunkKey(cx, cy));
    if (!added && !this.removedProps.size) return c.props;
    const props = c.props.filter((prop) => !this.removedProps.has(prop.id));
    if (added) props.push(...added.values());
    return props;
  }

  // Every prop whose base lies in the chunks touching the given cell range.
  propsIn(x0, y0, x1, y1) {
    const out = [];
    for (let cy = Math.floor(y0 / CHUNK); cy <= Math.floor(y1 / CHUNK); cy++) {
      // The jittered final procedural grid column can put bases up to 11
      // cells into the next chunk; its props still belong to the source chunk.
      for (let cx = Math.floor((x0 - 11) / CHUNK); cx <= Math.floor(x1 / CHUNK); cx++) {
        for (const p of this.propsOf(cx, cy)) out.push(p);
      }
    }
    return out;
  }

  // A tall prop can reach the viewport directly from below, or reflect into
  // water from above. Include both silhouettes plus the horizontal ripple.
  propsInView(view) {
    return this.propsIn(view.x0 - this.propRenderW - 2,
      view.y0 - Math.max(view.rows, this.propRenderH) - 1,
      view.x0 + view.cols + this.propRenderW + 2,
      view.y0 + view.rows + this.propRenderH);
  }

  isWalkable(x, y) {
    if (this.typeAt(x, y) === WATER) return false;
    // A large prop may straddle a chunk edge while its base lies outside the
    // old fixed query radius. Include every possible collision footprint.
    const width = this.propFootW;
    const height = this.propFootH;
    for (const p of this.propsIn(x - width, y - height, x + width, y + height)) {
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
