import { randomSeed } from '../core/rng.js';
import { createProp } from '../world/props.js';
import { isArchitectureKind } from '../world/architecture-props.js';
import { PROP_KINDS } from '../world/prop-catalog.js';
import { ASPECT, STONE, WATER } from '../world/world.js';
import { isSpawnRuinId } from '../world/spawn-ruins.js';

const HISTORY_LIMIT = 64;
const COORD_LIMIT = 1_000_000;
const TERRAIN_LIMIT = 50_000;
const CHUNK_LIMIT = 128;
const PROP_LIMIT = 250;
const REMOVED_LIMIT = 5_000;
const MAX_PROP_ID = 1_000_000_000;
const validCoordinate = (value) => Number.isFinite(value) && Math.abs(value) <= COORD_LIMIT;
const validSeed = (value) => Number.isSafeInteger(value);

function checkPoint(x, y) {
  if (!validCoordinate(x) || !validCoordinate(y)) throw new Error('Scenery coordinates must be finite and within the world limits.');
}

function checkRadius(radius) {
  if (!Number.isFinite(radius) || radius < 0 || radius > 24) throw new Error('Brush radius must be between 0 and 24.');
}

function checkType(type) {
  if (!Number.isInteger(type) || type < WATER || type > STONE) throw new Error('Terrain type must be an integer from 0 to 4.');
}

function checkProp(kind, x, y, scale, seed, variant = 1, rotation = 0) {
  checkPoint(x, y);
  if (!PROP_KINDS.has(kind)) throw new Error('Unknown scenery prop kind.');
  if (!Number.isFinite(scale) || scale < 0.25 || scale > 3) throw new Error('Prop scale must be between 0.25 and 3.');
  if (!validSeed(seed)) throw new Error('Prop seed must be a safe integer.');
  if (variant !== 0 && variant !== 1) throw new Error('Unknown scenery variation version.');
  if (!Number.isFinite(rotation)) throw new Error('Prop rotation must be finite degrees.');
  if (rotation && !isArchitectureKind(kind)) throw new Error('Only architecture props support rotation.');
}

function checkTerrainBudget(terrain) {
  if (terrain.size > TERRAIN_LIMIT) throw new Error(`Scenery supports up to ${TERRAIN_LIMIT} edited terrain cells.`);
  const chunks = new Set();
  for (const key of terrain.keys()) {
    const [x, y] = key.split(',').map(Number);
    chunks.add(`${Math.floor(x / 64)},${Math.floor(y / 64)}`);
    if (chunks.size > CHUNK_LIMIT) throw new Error(`Scenery supports up to ${CHUNK_LIMIT} edited terrain chunks.`);
  }
}

// Scene changes are independent of input or DOM. The World stays the source
// for rendering and collision while this model handles transactions and IO.
export class Scenery {
  constructor(world, { seedSource = randomSeed } = {}) {
    this.world = world;
    this.seedSource = seedSource;
    this._undo = [];
    this._redo = [];
    this._stroke = null;
    this._nextId = 1;
  }

  get canUndo() { return this._undo.length > 0; }
  get canRedo() { return this._redo.length > 0; }
  get counts() {
    return {
      terrain: this.world.terrainEdits.size,
      props: this.world.addedProps.size,
      removed: this.world.removedProps.size,
    };
  }

  nextPropSeed(preferred = this.seedSource()) {
    if (!validSeed(preferred)) throw new Error('Prop seed must be a safe integer.');
    const used = new Set([...this.world.addedProps.values()].map((prop) => prop.seed >>> 0));
    let seed = preferred >>> 0;
    // Normalize to the factory's 32-bit stream and avoid duplicates even when
    // loading older scenes or when the random source happens to repeat.
    while (used.has(seed)) seed = (seed + 1) >>> 0;
    return seed;
  }

  beginStroke() {
    if (this._stroke) return false;
    this._stroke = this.serialize();
    return true;
  }

  endStroke() {
    if (!this._stroke) return false;
    const before = this._stroke;
    this._stroke = null;
    const after = this.serialize();
    if (JSON.stringify(before) === JSON.stringify(after)) return false;
    this._undo.push({ before, after });
    if (this._undo.length > HISTORY_LIMIT) this._undo.shift();
    this._redo.length = 0;
    return true;
  }

  _change(action) {
    const automatic = !this._stroke;
    if (automatic) this.beginStroke();
    try {
      return action();
    } finally {
      if (automatic) this.endStroke();
    }
  }

  paint(x, y, radius, type) {
    checkPoint(x, y);
    checkRadius(radius);
    checkType(type);
    checkPoint(x - radius / ASPECT, y - radius);
    checkPoint(x + radius / ASPECT, y + radius);
    return this._change(() => {
      const cells = [];
      // Track only what this stamp adds, so long strokes over a large
      // scene stay cheap instead of copying every earlier edit.
      const edits = this.world.terrainEdits;
      let added = 0;
      const newChunks = new Set();
      const consider = (cx, cy) => {
        if (this.world.typeAt(cx, cy) === type) return;
        cells.push({ x: cx, y: cy });
        const key = `${cx},${cy}`;
        if (this.world.originalTypeAt(cx, cy) === type) {
          if (edits.has(key)) added--;
        } else if (!edits.has(key)) {
          added++;
          const chunk = `${Math.floor(cx / 64)},${Math.floor(cy / 64)}`;
          if (!this.world.editChunks.has(chunk)) newChunks.add(chunk);
        }
      };
      if (radius === 0) {
        consider(Math.floor(x), Math.floor(y));
      } else {
        const left = Math.floor(x - radius / ASPECT);
        const right = Math.floor(x + radius / ASPECT);
        const top = Math.floor(y - radius);
        const bottom = Math.floor(y + radius);
        for (let cy = top; cy <= bottom; cy++) {
          for (let cx = left; cx <= right; cx++) {
            if (Math.hypot((cx + 0.5 - x) * ASPECT, cy + 0.5 - y) > radius) continue;
            consider(cx, cy);
          }
        }
      }
      if (edits.size + added > TERRAIN_LIMIT) {
        throw new Error(`Scenery supports up to ${TERRAIN_LIMIT} edited terrain cells.`);
      }
      if (this.world.editChunks.size + newChunks.size > CHUNK_LIMIT) {
        throw new Error(`Scenery supports up to ${CHUNK_LIMIT} edited terrain chunks.`);
      }
      for (const cell of cells) this.world.setTerrain(cell.x, cell.y, type);
      return cells.length;
    });
  }

  place(kind, x, y, { scale = 1, seed, variant = 1, rotation = 0 } = {}) {
    if (seed === undefined) seed = this.nextPropSeed();
    checkProp(kind, x, y, scale, seed, variant, rotation);
    if (this.world.addedProps.size >= PROP_LIMIT) throw new Error(`Scenery supports up to ${PROP_LIMIT} placed props.`);
    // Bake before starting the transaction so a factory error changes nothing.
    const prop = createProp(kind, x, y, { scale, seed, variant, rotation });
    return this._change(() => {
      do {
        if (this._nextId > MAX_PROP_ID) this._nextId = 1;
        prop.id = `s:${this._nextId++}`;
      } while (this.world.addedProps.has(prop.id));
      prop.scale = scale;
      prop.seed = seed;
      this.world.addProp(prop);
      return prop;
    });
  }

  erase(x, y, radius) {
    checkPoint(x, y);
    checkRadius(radius);
    return this._change(() => {
      let removed = 0;
      const props = this.world.propsIn(x - radius / ASPECT, y - radius, x + radius / ASPECT, y + radius);
      const targets = props.filter((prop) => Math.hypot((prop.x - x) * ASPECT, prop.y - y) <= radius);
      const originalCount = targets.filter((prop) => !this.world.addedProps.has(prop.id)).length;
      if (this.world.removedProps.size + originalCount > REMOVED_LIMIT) throw new Error(`Scenery supports up to ${REMOVED_LIMIT} erased generated props.`);
      for (const prop of targets) {
        if (this.world.addedProps.has(prop.id)) this.world.deleteProp(prop.id);
        else this.world.removedProps.add(prop.id);
        removed++;
      }
      return removed;
    });
  }

  undo() {
    this.endStroke();
    const entry = this._undo.pop();
    if (!entry) return false;
    this._apply(entry.before);
    this._redo.push(entry);
    return true;
  }

  redo() {
    this.endStroke();
    const entry = this._redo.pop();
    if (!entry) return false;
    this._apply(entry.after);
    this._undo.push(entry);
    return true;
  }

  reset() {
    return this._change(() => {
      const changed = this.world.terrainEdits.size + this.world.addedProps.size + this.world.removedProps.size > 0;
      this.world.clearScenery();
      this._nextId = 1;
      return changed;
    });
  }

  serialize() {
    const terrain = [...this.world.terrainEdits].map(([key, type]) => {
      const [x, y] = key.split(',').map(Number);
      return { x, y, type };
    }).sort((a, b) => a.y - b.y || a.x - b.x);
    const props = [...this.world.addedProps.values()].map(({ id, kind, x, y, scale, seed, variant = 0, rotation = 0 }) =>
      ({ id, kind, x, y, scale, seed, variant, ...(rotation ? { rotation } : {}) }))
      .sort((a, b) => Number(a.id.slice(2)) - Number(b.id.slice(2)));
    return { version: 1, seed: this.world.seed, terrain, props, removed: [...this.world.removedProps].sort() };
  }

  load(data) {
    const { scene, props } = this._validate(data);
    return this._change(() => {
      this._apply(scene, props);
      return true;
    });
  }

  _validate(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.version !== 1) throw new Error('Unsupported scenery file version.');
    if (!validSeed(data.seed) || data.seed !== this.world.seed) throw new Error('Scenery seed does not match this world.');
    if (!Array.isArray(data.terrain) || !Array.isArray(data.props) || !Array.isArray(data.removed)) throw new Error('Scenery file must contain terrain, props, and removed arrays.');
    if (data.terrain.length > TERRAIN_LIMIT || data.props.length > PROP_LIMIT || data.removed.length > REMOVED_LIMIT) throw new Error('Scenery file exceeds the editing limits.');
    const terrainKeys = new Set();
    const terrain = data.terrain.map((entry) => {
      if (!entry || typeof entry !== 'object') throw new Error('Invalid terrain entry.');
      const { x, y, type } = entry;
      checkPoint(x, y);
      if (!Number.isInteger(x) || !Number.isInteger(y)) throw new Error('Terrain coordinates must be integers.');
      checkType(type);
      const key = `${x},${y}`;
      if (terrainKeys.has(key)) throw new Error('Duplicate terrain cell.');
      terrainKeys.add(key);
      return { x, y, type };
    });
    checkTerrainBudget(new Map(terrain.map(({ x, y, type }) => [`${x},${y}`, type])));
    const propIds = new Set();
    const definitions = data.props.map((entry) => {
      if (!entry || typeof entry !== 'object') throw new Error('Invalid prop entry.');
      // Scenes saved before per-item variation retain their original shapes.
      const { id, kind, x, y, scale, seed, variant = 0, rotation = 0 } = entry;
      if (typeof id !== 'string' || !/^s:[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id.slice(2))) || Number(id.slice(2)) > MAX_PROP_ID) throw new Error('Invalid placed prop identifier.');
      if (propIds.has(id)) throw new Error('Duplicate prop identifier.');
      propIds.add(id);
      checkProp(kind, x, y, scale, seed, variant, rotation);
      return { id, kind, x, y, scale, seed, variant, ...(rotation ? { rotation } : {}) };
    });
    const removedIds = new Set();
    const removed = data.removed.map((id) => {
      if (!isSpawnRuinId(id)) {
        if (typeof id !== 'string' || !/^p:-?\d+:-?\d+:\d+$/.test(id)) throw new Error('Invalid removed prop identifier.');
        const [, cx, cy, index] = id.split(':').map(Number);
        if (!Number.isSafeInteger(cx) || !Number.isSafeInteger(cy) || Math.abs(cx) > COORD_LIMIT / 64 + 1 || Math.abs(cy) > COORD_LIMIT / 64 + 1 || !Number.isSafeInteger(index) || index >= 40) throw new Error('Invalid removed prop identifier.');
      }
      if (removedIds.has(id)) throw new Error('Duplicate removed prop identifier.');
      removedIds.add(id);
      return id;
    });
    // All definitions have passed validation before any potentially expensive
    // rasterization, and every prop is baked before changing the live world.
    const props = definitions.map((definition) => this._restoreProp(definition));
    return { scene: { version: 1, seed: data.seed, terrain, props: definitions, removed }, props };
  }

  _restoreProp(definition) {
    // Fine-bake recipes are keyed by the factory object's identity.
    return Object.assign(createProp(definition.kind, definition.x, definition.y, definition), definition);
  }

  _apply(scene, preparedProps) {
    const props = preparedProps ?? scene.props.map((definition) => this._restoreProp(definition));
    // Regrow each touched chunk after the complete snapshot is installed,
    // rather than rebuilding its thousands of blades after every cell edit.
    this.world.batchScenery(() => {
      this.world.clearScenery();
      for (const { x, y, type } of scene.terrain) this.world.setTerrain(x, y, type);
      for (const prop of props) this.world.addProp(prop);
      for (const id of scene.removed) this.world.removedProps.add(id);
    });
    this._nextId = 1;
    for (const prop of props) this._nextId = Math.max(this._nextId, Number(prop.id.slice(2)) + 1);
  }
}
