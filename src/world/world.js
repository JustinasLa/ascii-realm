import { fbm, valueNoise } from '../core/noise.js';
import { hash2, mulberry32 } from '../core/rng.js';
import { rockTypeAt } from './geology.js';
import { blocks, generateProps, isStoneProp, makeOreBlock, makeRiverStone } from './props.js';
import { minedKey, placeVeins } from './ore-veins.js';
import { DEADWOOD_REACH_X, DEADWOOD_REACH_Y } from './deadwood.js';
import { grassRoots } from './grass-roots.js';
import { ACROSS, groundHalfWidth, RiverNetwork, WIDTH } from './rivers.js';
import { createSpawnRuins } from './spawn-ruins.js';
import { groveField, groveProps } from './woodland.js';

export const WATER = 0;
export const SHORE = 1;
export const GRASS = 2;
export const DIRT = 3;
export const STONE = 4;

// Cells are taller than they are wide, so horizontal distances are squashed
// before sampling noise. Without this every lake would look stretched.
export const ASPECT = 6 / 10;

const CHUNK = 64;
// How near water a rock stands to be damp, in cells.
const DAMP_REACH = 3;
// Blows needed to fell a tree.
export const TREE_HITS = 3;
// Rows of bare ground kept in front of a rock so grass cannot hide its face.
const ROCK_APRON = 4;
export const WATER_LEVEL = 0.4;
// All lakes are fordable: even their lowest beds are only knee deep.
export const MAX_WATER_DEPTH = 0.42;
export const SHORE_LEVEL = 0.415;
// Raises the whole landscape, so only about a twelfth of it lies under water.
export const LAND_LIFT = 0.09;
const LAKE_SHELF = 1.6;
const EDIT_ELEVATION = [0.36, (WATER_LEVEL + SHORE_LEVEL) / 2, 0.54, 0.54, 0.78];
const cellKey = (x, y) => `${x},${y}`;
const LINE_AT = { x: 0, y: 0, speed: 0, tau: 0 };
const chunkKey = (cx, cy) => `${cx},${cy}`;
const smoothRange = (a, b, x) => {
  const u = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

// The seeded land's elevation at a cell. The land is lifted so only the
// deepest hollows hold a lake. It is a meadow throughout: no dirt tracks or
// bare stone, just grass around the odd lake. The fewer, smaller lakes shelve
// away more steeply, so they still open onto deep water rather than being
// shallows from bank to bank.
export function seededLand(x, y, seed) {
  const e = fbm(x * ASPECT * 0.011, y * 0.011, seed, 5) + LAND_LIFT;
  return e < WATER_LEVEL ? WATER_LEVEL - (WATER_LEVEL - e) * LAKE_SHELF : e;
}

export const landType = (e) => (e < WATER_LEVEL ? WATER : e < SHORE_LEVEL ? SHORE : GRASS);

export class World {
  constructor(seed = 1, options = {}) {
    // A bare number is the chunk cache size.
    // `flora` brings back the wild flowers, ferns and cattails among the grass.
    // `rivers: false` leaves the land without rivers.
    // `woodland: 'dense'` grows groves around the trees (see woodland.js) and
    // brings the flowers unless `flora` says otherwise.
    const { season = 'summer', maxChunks = 128, woodland, flora, meadow = false, spawnRuins = false, rivers = true } = typeof options === 'number' ? { maxChunks: options } : options;
    this.seed = seed;
    this.woodland = woodland === 'dense' ? 'dense' : 'sparse';
    this.flora = !!(flora ?? this.woodland === 'dense');
    // Tree sites are pure positions; each chunk's are worked out once.
    this.siteCache = new Map();
    this.meadow = meadow;
    this.sceneryBatchDepth = 0;
    this.season = ['spring', 'summer', 'autumn', 'winter'].includes(season) ? season : 'summer';
    this.maxChunks = Math.max(16, Math.floor(maxChunks));
    this.clock = 0;
    this.chunks = new Map();
    this.terrainEdits = new Map();
    // Changes the player makes to the land, kept here so they outlive chunk
    // eviction: hits on trees by prop id, loose items of chunks whose items
    // changed, and gathered plants.
    this.treeHits = new Map();
    this.burntTrees = new Set();
    this.burningTrees = new Map();
    this.loot = new Map();
    this.gathered = new Set();
    // Ore blocks mined out, by base cell (see ore-veins.js).
    this.mined = new Set();
    this.burntPlants = new Set();
    // How many edited cells each chunk holds, so budgets need no full scan.
    this.editChunks = new Map();
    // Scorch maps by chunk, kept here so they outlive chunk eviction.
    this.burns = new Map();
    this.addedProps = new Map();
    this.removedProps = new Set();
    this.addedPropChunks = new Map();
    // Ground beneath solid props, where no grass grows: by chunk, each cell's
    // own grass height and how many props cover it.
    this.bareGround = new Map();
    this.coveredChunks = new Set();
    this.propRenderW = 30;
    this.propRenderH = 50;
    this.propFootW = 10;
    this.propFootH = 2;
    // Spawn is found on the land as it lies before rivers and ruins, so it
    // is the same whether or not they are there; both then keep clear of it.
    this.rivers = null;
    this.spawn = this.findSpawn();
    this.rivers = new RiverNetwork(seed, this.spawn, { enabled: rivers });
    if (spawnRuins) {
      this.spawnRuins = createSpawnRuins(seed, this.spawn);
      for (const prop of this.spawnRuins.props) this.measureProp(prop);
    }
    // Rebuild the few chunks spawn discovery made with their rivers and
    // the starter site's dry ground as their baseline.
    this.chunks.clear();
    this.siteCache.clear();
  }

  chunk(cx, cy) {
    const key = chunkKey(cx, cy);
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
    // Edits and burns mark the grass for regrowing once, not per cell.
    if (c.stale && !this.sceneryBatchDepth) {
      c.blades = grassRoots(c, this.seed, CHUNK, { flora: this.flora, meadow: this.meadow });
      c.stale = false;
    }
    return c;
  }

  // Drops the least recently used chunks beyond the cache size, e.g. after
  // zooming back in from a wide view.
  trim() {
    if (this.chunks.size <= this.maxChunks) return;
    const byUse = [...this.chunks].sort((a, b) => a[1].used - b[1].used);
    for (let i = 0; i < byUse.length - this.maxChunks; i++) this.chunks.delete(byUse[i][0]);
  }

  generate(cx, cy) {
    const n = CHUNK * CHUNK;
    const type = new Uint8Array(n);
    // Elevation is worked in full precision until the grass has grown.
    const height = new Float64Array(n);
    const shade = new Float32Array(n);
    const rnd = new Float32Array(n);
    const grassHeight = new Float32Array(n);
    const grassDensity = new Float32Array(n);
    const grassStyle = new Uint8Array(n);
    const s = this.seed;

    for (let ly = 0; ly < CHUNK; ly++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const x = cx * CHUNK + lx;
        const y = cy * CHUNK + ly;
        const nx = x * ASPECT;
        const i = ly * CHUNK + lx;
        let e = seededLand(x, y, s);
        let t = landType(e);
        const starter = this.spawnRuins?.terrainAt(x, y);
        if (starter !== undefined) {
          t = starter;
          e = EDIT_ELEVATION[starter];
        }

        type[i] = t;
        height[i] = e;
        shade[i] = fbm(nx * 0.05, y * 0.05, s + 31, 3);
        rnd[i] = hash2(x, y, s + 5);
      }
    }
    // Rivers cut their channels, banks and damp valleys into the land before
    // the grass grows, so lush bank grass and reeds follow them.
    const preRiverType = this.rivers?.reaches(cx, cy) ? type.slice() : null;
    const facing = preRiverType ? new Float32Array(n) : null;
    const flow = preRiverType ? this.rivers.carve(cx, cy, type, height, facing) : null;
    for (let ly = 0; ly < CHUNK; ly++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const x = cx * CHUNK + lx;
        const y = cy * CHUNK + ly;
        const nx = x * ASPECT;
        const i = ly * CHUNK + lx;
        const t = type[i];
        const e = height[i];
        if (t === GRASS || t === SHORE) {
          // Fractional heights are dithered per root when drawn, so even the
          // cell grid has no hard height bands.
          const meadow = fbm(nx * 0.022, y * 0.022, s + 701, 3);
          // A river's near bank, in front of it on screen, grows no taller
          // than the open meadow, so its grass does not hide the water.
          const open = facing ? 1 - facing[i] : 1;
          const wet = (1 - smoothRange(0.41, 0.45, e)) * open;
          const lush = smoothRange(0.35, 0.68, meadow);
          let reed = false;
          if (t === GRASS) {
            const fieldHeight = this.meadow ? 3.1 + lush * 1.4 : 2.6 + lush * 1.3;
            const bank = wet * smoothRange(0.35, 0.6, meadow);
            const target = fieldHeight + (4.7 - fieldHeight) * bank;
            grassHeight[i] = target;
            grassDensity[i] = this.meadow ? 0.34 + lush * 0.08 : 0.255 + lush * 0.025;
          } else if (meadow > 0.43 && open > 0.5) {
            // Reeds fringe the lakes.
            grassHeight[i] = 3.3 + lush * 1.3;
            grassDensity[i] = 0.15 + lush * 0.06;
            reed = true;
          }
          const species = valueNoise(nx * 0.012, y * 0.012, s + 1801);
          const edge = (hash2(x, y, s + 1802) - 0.5) * 0.7;
          grassStyle[i] = reed ? 5 : Math.max(0, Math.min(4, Math.floor(species * 5 + edge)));
        }
      }
    }
    // A grove's sward stands taller and fuller around its trees. Spawn is
    // still being looked for while this.spawn is unset; those chunks go.
    const grove = this.woodland === 'dense' && this.spawn ? groveField(this, cx, cy, CHUNK) : null;
    for (let i = 0; grove && i < n; i++) {
      if (!grove[i] || type[i] !== GRASS) continue;
      const g = grove[i] / 255;
      grassHeight[i] = Math.min(4.4, grassHeight[i] + 0.7 * g);
      grassDensity[i] *= 1 + 0.45 * g;
    }
    const elev = Float32Array.from(height);
    const baseType = type.slice();
    const baseElev = elev.slice();
    const chunk = { cx, cy, type, elev, baseType, baseElev, shade, rnd, grassHeight, grassDensity, grassStyle,
      grove, baseGrass: null, props: null, burnt: this.burns.get(chunkKey(cx, cy)) ?? null, version: 0,
      flow, preRiverType, riverStones: flow ? this.rivers.stonesNear(cx, cy) : null,
      // The water shader times a river's foam by its water's own lines.
      rivers: flow ? this.rivers : null };
    // Ground rendering reads these arrays directly, so overrides must live in
    // the chunk as well as in the editor's portable scene description.
    for (let ly = 0; ly < CHUNK; ly++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const edit = this.terrainEdits.get(cellKey(cx * CHUNK + lx, cy * CHUNK + ly));
        if (edit !== undefined) this.applyTerrain(chunk, ly * CHUNK + lx, edit);
      }
    }
    for (const i of this.bareGround.get(chunkKey(cx, cy))?.keys() ?? []) grassHeight[i] = 0;
    chunk.blades = grassRoots(chunk, s, CHUNK, { flora: this.flora, meadow: this.meadow });
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

  originalTypeAt(x, y) {
    const { c, i } = this.locate(Math.floor(x), Math.floor(y));
    return c.baseType[i];
  }

  setTerrain(x, y, type) {
    const { c, i } = this.locate(x, y);
    const key = cellKey(x, y);
    const had = this.terrainEdits.has(key);
    const chunk = chunkKey(c.cx, c.cy);
    if (type === c.baseType[i]) {
      if (had) {
        this.terrainEdits.delete(key);
        const left = this.editChunks.get(chunk) - 1;
        if (left > 0) this.editChunks.set(chunk, left);
        else this.editChunks.delete(chunk);
      }
    } else {
      this.terrainEdits.set(key, type);
      if (!had) this.editChunks.set(chunk, (this.editChunks.get(chunk) ?? 0) + 1);
    }
    this.applyTerrain(c, i, type);
    this.touched(c);
    // A standing stone follows the ground painted beneath its foot.
    for (const prop of this.addedPropChunks.get(chunk)?.values() ?? []) {
      if (prop.kind === 'standing-stone' && Math.floor(prop.x) === x && Math.floor(prop.y) === y) this.wetStone(prop);
    }
  }

  // Sets one cell's terrain and the grass growing on it. Painted meadow
  // gets a plain verge-height lawn; restoring a cell restores its own grass.
  applyTerrain(c, i, type) {
    const base = type === c.baseType[i];
    c.type[i] = type;
    c.elev[i] = base ? c.baseElev[i] : EDIT_ELEVATION[type];
    if (!c.baseGrass) {
      c.baseGrass = { height: c.grassHeight.slice(), density: c.grassDensity.slice(), style: c.grassStyle.slice() };
      if (this.meadow) {
        for (const [covered, ground] of this.bareGround.get(chunkKey(c.cx, c.cy)) ?? []) {
          c.baseGrass.height[covered] = ground.height;
        }
      }
    }
    const g = c.baseGrass;
    if (base) {
      c.grassHeight[i] = g.height[i];
      c.grassDensity[i] = g.density[i];
      c.grassStyle[i] = g.style[i];
    } else if (type === GRASS) {
      c.grassHeight[i] = this.meadow ? 3.8 : 2.6;
      c.grassDensity[i] = this.meadow ? 0.38 : 0.22;
      c.grassStyle[i] = 0;
    } else {
      c.grassHeight[i] = 0;
    }
    // Painting or restoring meadow beneath a solid still respects its footprint.
    const cover = this.meadow && this.bareGround.get(chunkKey(c.cx, c.cy))?.get(i);
    if (cover) {
      cover.height = c.grassHeight[i];
      c.grassHeight[i] = 0;
    }
  }

  // Reshades a chunk's ground and regrows its grass after a change.
  touched(c) {
    c.version = (c.version ?? 0) + 1;
    c.stale = true;
  }

  addProp(prop) {
    if (this.addedProps.has(prop.id)) this.deleteProp(prop.id);
    this.addedProps.set(prop.id, prop);
    // A builder's rock beside water is damp, as a generated one is.
    this.wetStone(prop);
    this.coverGrass(prop, 1);
    this.measureProp(prop);
    const key = chunkKey(Math.floor(prop.x / CHUNK), Math.floor(prop.y / CHUNK));
    if (!this.addedPropChunks.has(key)) this.addedPropChunks.set(key, new Map());
    this.addedPropChunks.get(key).set(prop.id, prop);
  }

  measureProp(prop) {
    for (const cell of prop.cells) {
      this.propRenderW = Math.max(this.propRenderW, Math.abs(cell.dx));
      this.propRenderH = Math.max(this.propRenderH, -cell.dy);
    }
    this.propFootW = Math.max(this.propFootW, prop.footW);
    this.propFootH = Math.max(this.propFootH, prop.footH);
  }

  deleteProp(id) {
    const prop = this.addedProps.get(id);
    if (!prop) return false;
    this.addedProps.delete(id);
    this.coverGrass(prop, -1);
    const key = chunkKey(Math.floor(prop.x / CHUNK), Math.floor(prop.y / CHUNK));
    const list = this.addedPropChunks.get(key);
    list.delete(id);
    if (!list.size) this.addedPropChunks.delete(key);
    return true;
  }

  // Nothing grows through a rock, a trunk or a crate: blades rooted inside a
  // solid prop's footprint would be drawn over its base. Covering (+1) clears
  // the grass there; uncovering (-1) lets it grow back once no prop is left.
  // A rock also keeps an apron of bare ground in front of it, so tall grass
  // rooted just below it cannot grow up over its face and hide it.
  coverGrass(prop, change) {
    if (prop.chopped || prop.solid === false || (prop.kind === 'bush' && prop.solid !== true)) return;
    const deadwood = prop.kind === 'deadwood';
    const rock = isStoneProp(prop);
    const lowStone = rock || prop.kind === 'rubble-small' || prop.kind === 'rubble-large';
    const rx = Math.ceil(deadwood ? DEADWOOD_REACH_X : (prop.footW ?? 0) + (lowStone ? 1 : 0));
    const ry = Math.ceil(deadwood ? DEADWOOD_REACH_Y : prop.footH ?? 0);
    const x0 = Math.floor(prop.x);
    const y0 = Math.floor(prop.y);
    const below = lowStone ? ROCK_APRON : 0;
    const bare = (x, y) => blocks(prop, x, y) || (lowStone && y > prop.y && y < prop.y + ROCK_APRON
      && Math.abs(x - prop.x) < prop.footW + 1);
    const changed = new Set();
    for (let y = y0 - ry; y <= y0 + ry + below; y++) {
      for (let x = x0 - rx; x <= x0 + rx; x++) {
        if (!bare(x + 0.5, y + 0.5)) continue;
        const { c, i } = this.locate(x, y);
        const key = chunkKey(c.cx, c.cy);
        let cleared = this.bareGround.get(key);
        if (!cleared) this.bareGround.set(key, cleared = new Map());
        const cell = cleared.get(i);
        if (change > 0) {
          if (cell) cell.count++;
          else cleared.set(i, { height: c.grassHeight[i], count: 1 });
          if (c.grassHeight[i]) changed.add(c);
          c.grassHeight[i] = 0;
        } else if (cell && --cell.count <= 0) {
          cleared.delete(i);
          if (c.type[i] === GRASS || c.type[i] === SHORE) c.grassHeight[i] = cell.height;
          changed.add(c);
        }
      }
    }
    for (const c of changed) this.touched(c);
  }

  batchScenery(action) {
    this.sceneryBatchDepth++;
    try { return action(); }
    finally { this.sceneryBatchDepth--; }
  }

  clearScenery() {
    return this.batchScenery(() => this._clearScenery());
  }

  _clearScenery() {
    for (const prop of this.addedProps.values()) this.coverGrass(prop, -1);
    for (const key of this.terrainEdits.keys()) {
      const [x, y] = key.split(',').map(Number);
      const { c, i } = this.locate(x, y);
      this.applyTerrain(c, i, c.baseType[i]);
      this.touched(c);
    }
    this.terrainEdits.clear();
    this.editChunks.clear();
    this.addedProps.clear();
    this.addedPropChunks.clear();
    this.removedProps.clear();
    this.propRenderW = 30;
    this.propRenderH = 50;
    this.propFootW = 10;
    this.propFootH = 2;
    for (const prop of this.spawnRuins?.props ?? []) this.measureProp(prop);
  }

  // Metres below the surface, rising gently from the bank and capped at
  // the knee regardless of how low the terrain noise goes.
  waterDepthAt(x, y) {
    const { c, i } = this.locate(Math.floor(x), Math.floor(y));
    if (c.type[i] !== WATER) return 0;
    return Math.min(MAX_WATER_DEPTH, Math.max(0, (WATER_LEVEL - c.elev[i]) / 0.065) * MAX_WATER_DEPTH);
  }

  // The river current at a point, in `out` so callers allocate nothing:
  // its unit direction on the ground (east, south), its surface speed in
  // metres a second and the seconds the water took to get here down its own
  // line through the river, all at the point itself; how deep the water is;
  // which river it is and where across it the point lies (-1 to 1, + on the
  // left bank); the outward set of the water on a bend; the river's
  // half-width in metres; and how sharply it bends. Still everywhere but on river water, including river
  // cells painted over with other ground.
  flowAt(x, y, out = {}) {
    out.x = 0; out.y = 0; out.speed = 0; out.river = 0; out.across = 0; out.secondary = 0;
    out.halfWidth = 0; out.bend = 0; out.tau = 0;
    out.depth = this.waterDepthAt(x, y);
    if (!out.depth && this.typeAt(x, y) !== WATER) return out;
    const fx = x - 0.5;
    const fy = y - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    let near = 0;
    let across = 0, secondary = 0, half = 0, bend = 0, weight = 0;
    for (let k = 0; k < 4; k++) {
      const cx = x0 + (k & 1);
      const cy = y0 + (k >> 1);
      const w = (1 - Math.abs(fx - cx)) * (1 - Math.abs(fy - cy));
      if (w <= 0) continue;
      const { c, i } = this.locate(cx, cy);
      const f = c.flow;
      // Banks carry the river's layout too, so the blend runs right up to
      // the edge; only river water counts as being in the current.
      if (!f?.width[i]) continue;
      if (f.river[i] && c.type[i] === WATER && w > near) { near = w; out.river = f.river[i]; }
      across += f.across[i] / ACROSS * w;
      secondary += f.secondary[i] / 127 * w;
      half += f.width[i] / WIDTH * w;
      bend += f.bend[i] / 255 * w;
      weight += w;
    }
    if (!out.river) return out;
    // The way the water runs, how fast, and the time it took come from its
    // own line through the river at the point itself, so whatever the
    // current carries keeps exactly to that clock.
    this.rivers.lineAt(x, y, LINE_AT);
    out.x = LINE_AT.x;
    out.y = LINE_AT.y;
    out.tau = LINE_AT.tau;
    out.speed = LINE_AT.speed;
    out.across = across / weight;
    out.secondary = secondary / weight;
    out.bend = bend / weight;
    out.halfWidth = groundHalfWidth(out.x, out.y, half / weight);
    return out;
  }

  // The nearest river to a cell within `radius` layout units, or null:
  // a point on its middle line, for debugging and tests.
  nearestRiver(x, y, radius = 600) {
    return this.rivers?.near(x, y, radius)[0] ?? null;
  }

  // The seeded land's terrain at a cell before rivers, worked out without
  // generating its chunk: the same as preRiverTypeAt, safe while one is made.
  landTypeAt(x, y) {
    x = Math.floor(x);
    y = Math.floor(y);
    return this.spawnRuins?.terrainAt(x, y) ?? landType(seededLand(x, y, this.seed));
  }

  // The terrain the seeded land had before rivers were cut into it.
  preRiverTypeAt(x, y) {
    const { c, i } = this.locate(Math.floor(x), Math.floor(y));
    return (c.preRiverType ?? c.baseType)[i];
  }

  // Whether a cell is river water in the seeded land.
  riverAt(x, y) {
    const { c, i } = this.locate(Math.floor(x), Math.floor(y));
    return !!c.flow?.river[i] || (!!c.preRiverType && c.baseType[i] === WATER && c.preRiverType[i] !== WATER);
  }

  // Scorched grass belongs to the terrain, so it survives leaving the view.
  // Only affected chunks allocate a burn map; overlapping fires deepen it.
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
        if (!c.burnt) {
          c.burnt = new Uint8Array(CHUNK * CHUNK);
          this.burns.set(chunkKey(c.cx, c.cy), c.burnt);
        }
        const strength = Math.round(Math.min(1, (edge - distance) * 2.3) * 255);
        c.burnt[i] = Math.max(c.burnt[i], strength);
        this.touched(c);
      }
    }
  }

  // Natural fires consume exact fuel cells instead of scorching a radius.
  burnGrassCell(x, y) {
    x = Math.floor(x); y = Math.floor(y);
    const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK);
    const key = chunkKey(cx, cy);
    const c = this.chunks.get(key) ?? this.chunk(cx, cy);
    const i = (y - cy * CHUNK) * CHUNK + x - cx * CHUNK;
    if (c.type[i] !== GRASS && c.type[i] !== SHORE) return;
    if (!c.burnt) { c.burnt = new Uint8Array(CHUNK * CHUNK); this.burns.set(key, c.burnt); }
    if (c.burnt[i] === 255) return;
    c.burnt[i] = 255;
    this.touched(c);
  }

  beginTreeBurn(prop, burn) {
    prop.burning = burn;
    if (prop.id) this.burningTrees.set(prop.id, burn);
  }

  endTreeBurn(prop, burn) {
    if (prop.id && this.burningTrees.get(prop.id) === burn) this.burningTrees.delete(prop.id);
    const copies = [prop, ...this.addedProps.values()];
    for (const c of this.chunks.values()) copies.push(...(c.props ?? []));
    for (const p of copies) if ((p === prop || (prop.id && p.id === prop.id)) && p.burning === burn) delete p.burning;
  }

  burnTree(prop) {
    if (prop.burnt || prop.chopped) return;
    this.coverGrass(prop, -1);
    if (prop.id) { this.burntTrees.add(prop.id); this.treeHits.set(prop.id, TREE_HITS); }
    const copies = [prop, ...this.addedProps.values()];
    for (const c of this.chunks.values()) copies.push(...(c.props ?? []));
    for (const p of copies) if (p === prop || (prop.id && p.id === prop.id)) {
      p.burnt = true; p.chopped = true; p.hits = TREE_HITS;
    }
    for (let y = Math.floor(prop.y - prop.footH); y <= Math.ceil(prop.y + prop.footH); y++) {
      for (let x = Math.floor(prop.x - prop.footW); x <= Math.ceil(prop.x + prop.footW); x++) {
        if (((x + 0.5 - prop.x) / prop.footW) ** 2 + ((y + 0.5 - prop.y) / prop.footH) ** 2 <= 1) this.burnGrassCell(x, y);
      }
    }
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
        season: this.season,
        spawn: this.spawn,
        // Generated on the land as it was before rivers cut it, so the
        // numbered ids of props away from a river never change.
        typeAt: (x, y) => this.preRiverTypeAt(x, y),
        landTypeAt: (x, y) => this.landTypeAt(x, y),
        siteCache: this.siteCache,
        grove: this.grove,
        // Whether a generated prop outlasts the river and ruin filters below.
        keeps: (prop) => !((this.rivers?.reaches(cx, cy) || c.preRiverType) && this.inRiver(prop))
          && !this.spawnRuins?.exclude(prop),
      };
      c.props = generateProps(original, cx, cy, CHUNK);
      // Dense woods come after the sparse props, which keep their ids.
      if (this.woodland === 'dense') c.props.push(...groveProps(original, cx, cy, CHUNK, c.props));
      // Ore veins come last, so every other prop keeps its id.
      c.props.push(...placeVeins(original, cx, cy, CHUNK, c.props).map((b) => makeOreBlock(b)));
      c.props.forEach((prop, i) => { prop.id = `p:${cx}:${cy}:${i}`; });
      if (this.mined.size) c.props = c.props.filter((p) => !p.ore || !this.mined.has(minedKey(p)));
      if (this.rivers?.reaches(cx, cy) || c.preRiverType) {
        c.props = c.props.filter(prop => !this.inRiver(prop));
        this.rivers.stonesIn(cx, cy).forEach((stone, k) => {
          const prop = makeRiverStone(stone.x, stone.y, mulberry32(stone.seed), stone.seed);
          prop.id = `v:${cx}:${cy}:${k}`;
          c.props.push(prop);
        });
      }
      if (this.spawnRuins) {
        c.props = c.props.filter(prop => !this.spawnRuins.exclude(prop));
        c.props.push(...this.spawnRuins.props.filter(prop =>
          Math.floor(prop.x / CHUNK) === cx && Math.floor(prop.y / CHUNK) === cy));
      }
      c.props.forEach((prop) => {
        const hits = this.treeHits.get(prop.id);
        if (hits) {
          prop.hits = hits;
          prop.chopped = hits >= TREE_HITS;
        }
        if (this.burntTrees.has(prop.id)) prop.burnt = true;
        const burning = this.burningTrees.get(prop.id);
        if (burning) prop.burning = burning;
        if (this.dampStone(prop)) prop.damp = true;
        // Grass is only cleared the first time; it stays bare after eviction.
        if (!this.coveredChunks.has(chunkKey(cx, cy))) this.coverGrass(prop, 1);
      });
      this.coveredChunks.add(chunkKey(cx, cy));
    }
    const added = this.addedPropChunks.get(chunkKey(cx, cy));
    if (!added && !this.removedProps.size) return c.props;
    const props = c.props.filter((prop) => !this.removedProps.has(prop.id));
    if (added) props.push(...added.values());
    return props;
  }

  // A blow on a tree, worth `power` hits; enough of them fell it. Returns
  // the hits so far.
  hitTree(prop, power = 1) {
    prop.hits = Math.min(TREE_HITS, (prop.hits ?? 0) + Math.max(1, Math.floor(power) || 1));
    prop.chopped = prop.hits >= TREE_HITS;
    if (prop.id) this.treeHits.set(prop.id, prop.hits);
    return prop.hits;
  }

  // The local surface layer determines which loose stones are scattered here.
  rockTypeAt(x, y) {
    return rockTypeAt(this, x, y);
  }

  // Whether a stone glints damp in torchlight: a rock by the water, a
  // standing stone only where it stands in water.
  dampStone(prop) {
    if (prop.kind === 'standing-stone') return this.typeAt(Math.floor(prop.x), Math.floor(prop.y)) === WATER;
    return prop.kind === 'rock' && !prop.wet && this.byWater(prop);
  }

  // Marks a stone damp where dampStone says so. A rock stays damp once it
  // is; a standing stone dries again when its cell is no longer water.
  wetStone(prop) {
    if (this.dampStone(prop)) prop.damp = true;
    else if (prop.kind === 'standing-stone') delete prop.damp;
  }

  // Whether water lies within DAMP_REACH cells of a prop's foot: a rock
  // there is damp, and glints a little in torchlight.
  byWater(prop) {
    const w = (prop.footW ?? 0) + DAMP_REACH;
    const h = (prop.footH ?? 0) + DAMP_REACH;
    for (let a = 0; a < 16; a++) {
      const x = prop.x + Math.cos(a * Math.PI / 8) * w;
      const y = prop.y + Math.sin(a * Math.PI / 8) * h;
      if (this.typeAt(Math.floor(x), Math.floor(y)) === WATER) return true;
    }
    return false;
  }

  // Whether a prop's footing reaches into river water.
  inRiver(prop) {
    const w = prop.footW ?? 0;
    const h = prop.footH ?? 0;
    for (let y = Math.floor(prop.y - h); y <= Math.floor(prop.y + h); y++) {
      for (let x = Math.floor(prop.x - w); x <= Math.floor(prop.x + w); x++) {
        const dx = w ? (x + 0.5 - prop.x) / w : 0;
        const dy = h ? (y + 0.5 - prop.y) / h : 0;
        if (dx * dx + dy * dy <= 1.2 && this.riverAt(x, y)) return true;
      }
    }
    return false;
  }

  // Every prop whose base lies in the chunks touching the given cell range.
  // `loadedOnly` skips chunks whose scenery has not been generated yet.
  propsIn(x0, y0, x1, y1, loadedOnly = false) {
    const out = [];
    for (let cy = Math.floor(y0 / CHUNK); cy <= Math.floor(y1 / CHUNK); cy++) {
      // The jittered final procedural grid column can put bases up to 11
      // cells into the next chunk; its props still belong to the source chunk.
      for (let cx = Math.floor((x0 - 11) / CHUNK); cx <= Math.floor(x1 / CHUNK); cx++) {
        if (loadedOnly && !this.loaded(cx, cy)?.props) continue;
        for (const p of this.propsOf(cx, cy)) out.push(p);
      }
    }
    return out;
  }

  // The chunk if it has been generated, without generating it.
  loaded(cx, cy) {
    const c = this.chunks.get(chunkKey(cx, cy));
    if (!c) return null;
    c.used = ++this.clock;
    return c;
  }

  // Generates the chunks and scenery of a cell range nearest its centre
  // first, until about `budgetMs` has passed, so a wide view fills in over a
  // few frames instead of stalling. Returns how many chunks are still missing.
  load(x0, y0, x1, y1, budgetMs, now = () => performance.now()) {
    const missing = [];
    const mx = (x0 + x1) / 2 / CHUNK;
    const my = (y0 + y1) / 2 / CHUNK;
    for (let cy = Math.floor(y0 / CHUNK); cy <= Math.floor(y1 / CHUNK); cy++) {
      for (let cx = Math.floor(x0 / CHUNK); cx <= Math.floor(x1 / CHUNK); cx++) {
        if (!this.loaded(cx, cy)?.props) missing.push([cx, cy, ((cx + 0.5 - mx) * ASPECT) ** 2 + (cy + 0.5 - my) ** 2]);
      }
    }
    missing.sort((a, b) => a[2] - b[2]);
    const until = now() + budgetMs;
    let done = 0;
    for (const [cx, cy] of missing) {
      if (done > 0 && now() >= until) break;
      this.propsOf(cx, cy);
      done++;
    }
    return missing.length - done;
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
    // A large prop may straddle a chunk edge while its base lies outside the
    // old fixed query radius, and fallen trunks reach far along the ground.
    // Include every possible collision footprint.
    const width = Math.max(this.propFootW, DEADWOOD_REACH_X);
    const height = Math.max(this.propFootH, DEADWOOD_REACH_Y);
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
