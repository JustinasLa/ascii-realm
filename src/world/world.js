import { fbm, valueNoise } from '../core/noise.js';
import { hash2 } from '../core/rng.js';
import { rockTypeAt } from './geology.js';
import { blocks, generateProps } from './props.js';
import { DEADWOOD_REACH_X, DEADWOOD_REACH_Y } from './deadwood.js';
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
// Blows needed to fell a tree.
export const TREE_HITS = 3;
// Rows of bare ground kept in front of a rock so grass cannot hide its face.
const ROCK_APRON = 4;
export const WATER_LEVEL = 0.4;
// All lakes are fordable: even their lowest beds are only knee deep.
export const MAX_WATER_DEPTH = 0.42;
const SHORE_LEVEL = 0.415;
// Raises the whole landscape, so only about a twelfth of it lies under water.
const LAND_LIFT = 0.09;
const LAKE_SHELF = 1.6;
const EDIT_ELEVATION = [0.36, (WATER_LEVEL + SHORE_LEVEL) / 2, 0.54, 0.54, 0.78];
const cellKey = (x, y) => `${x},${y}`;
const chunkKey = (cx, cy) => `${cx},${cy}`;
const smoothRange = (a, b, x) => {
  const u = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

export class World {
  constructor(seed = 1, options = {}) {
    // A bare number is the chunk cache size.
    // `flora` brings back the wild flowers, ferns and cattails among the grass.
    const { season = 'summer', maxChunks = 128, flora = false, meadow = false } = typeof options === 'number' ? { maxChunks: options } : options;
    this.seed = seed;
    this.flora = flora;
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
    this.spawn = this.findSpawn();
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
    const elev = new Float32Array(n);
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

        // The land is lifted so only the deepest hollows hold a lake. It is
        // a meadow throughout: no dirt tracks or bare stone, just grass
        // around the odd lake.
        let e = fbm(nx * 0.011, y * 0.011, s, 5) + LAND_LIFT;
        // The fewer, smaller lakes shelve away more steeply, so they still
        // open onto deep water rather than being shallows from bank to bank.
        if (e < WATER_LEVEL) e = WATER_LEVEL - (WATER_LEVEL - e) * LAKE_SHELF;

        let t = GRASS;
        if (e < WATER_LEVEL) t = WATER;
        else if (e < SHORE_LEVEL) t = SHORE;

        type[i] = t;
        elev[i] = e;
        shade[i] = fbm(nx * 0.05, y * 0.05, s + 31, 3);
        rnd[i] = hash2(x, y, s + 5);
        if (t === GRASS || t === SHORE) {
          // Fractional heights are dithered per root when drawn, so even the
          // cell grid has no hard height bands.
          const meadow = fbm(nx * 0.022, y * 0.022, s + 701, 3);
          const wet = 1 - smoothRange(0.41, 0.45, e);
          const lush = smoothRange(0.35, 0.68, meadow);
          let reed = false;
          if (t === GRASS) {
            const fieldHeight = this.meadow ? 3.1 + lush * 1.4 : 2.6 + lush * 1.3;
            const bank = wet * smoothRange(0.35, 0.6, meadow);
            const target = fieldHeight + (4.7 - fieldHeight) * bank;
            grassHeight[i] = target;
            grassDensity[i] = this.meadow ? 0.34 + lush * 0.08 : 0.255 + lush * 0.025;
          } else if (meadow > 0.43) {
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
    const baseType = type.slice();
    const baseElev = elev.slice();
    const chunk = { cx, cy, type, elev, baseType, baseElev, shade, rnd, grassHeight, grassDensity, grassStyle,
      baseGrass: null, props: null, burnt: this.burns.get(chunkKey(cx, cy)) ?? null, version: 0 };
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
    this.coverGrass(prop, 1);
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
    const rock = prop.kind === 'rock';
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
  }

  // Metres below the surface, rising gently from the bank and capped at
  // the knee regardless of how low the terrain noise goes.
  waterDepthAt(x, y) {
    const { c, i } = this.locate(Math.floor(x), Math.floor(y));
    if (c.type[i] !== WATER) return 0;
    return Math.min(MAX_WATER_DEPTH, Math.max(0, (WATER_LEVEL - c.elev[i]) / 0.065) * MAX_WATER_DEPTH);
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
        typeAt: (x, y) => this.originalTypeAt(x, y),
      };
      c.props = generateProps(original, cx, cy, CHUNK);
      c.props.forEach((prop, i) => {
        prop.id = `p:${cx}:${cy}:${i}`;
        const hits = this.treeHits.get(prop.id);
        if (hits) {
          prop.hits = hits;
          prop.chopped = hits >= TREE_HITS;
        }
        if (this.burntTrees.has(prop.id)) prop.burnt = true;
        const burning = this.burningTrees.get(prop.id);
        if (burning) prop.burning = burning;
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
