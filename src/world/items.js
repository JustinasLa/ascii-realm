import { ITEMS } from '../inventory/items.js';
import { generateLooseItems } from './gatherables.js';
import { CHUNK_SIZE } from './world.js';

// Item ownership belongs to the world, so another store for the same world
// still sees the current arrays and can move or remove their existing items.
const ownersByWorld = new WeakMap();
let nextDropUid = 1;

function validPosition(x, y) {
  return Number.isFinite(x) && Number.isFinite(y)
    && Number.isSafeInteger(Math.floor(x / CHUNK_SIZE))
    && Number.isSafeInteger(Math.floor(y / CHUNK_SIZE));
}

export class GroundItems {
  constructor(world) {
    this.world = world;
    this.time = 0;
    if (!ownersByWorld.has(world)) ownersByWorld.set(world, new WeakMap());
    this.owners = ownersByWorld.get(world);
  }

  of(cx, cy) {
    if (!Number.isSafeInteger(cx) || !Number.isSafeInteger(cy)) {
      throw new RangeError('Chunk coordinates must be safe integers.');
    }
    const chunk = this.world.chunk(cx, cy);
    // An empty array is a fully depleted chunk, not a generation request.
    if (chunk.items == null) chunk.items = generateLooseItems(this.world, cx, cy);
    for (const item of chunk.items) {
      if (item.dropOrigin === undefined) item.dropOrigin = null;
      this.owners.set(item, chunk.items);
    }
    return chunk.items;
  }

  in(x0, y0, x1, y1) {
    const out = [];
    if (!validPosition(x0, y0) || !validPosition(x1, y1) || x0 > x1 || y0 > y1) return out;
    for (let cy = Math.floor(y0 / CHUNK_SIZE); cy <= Math.floor(y1 / CHUNK_SIZE); cy++) {
      for (let cx = Math.floor(x0 / CHUNK_SIZE); cx <= Math.floor(x1 / CHUNK_SIZE); cx++) {
        for (const item of this.of(cx, cy)) {
          if (item.x >= x0 && item.x <= x1 && item.y >= y0 && item.y <= y1) out.push(item);
        }
      }
    }
    return out;
  }

  add(id, count, x, y, options = {}) {
    if (typeof id !== 'string' || !Object.hasOwn(ITEMS, id) || !Number.isSafeInteger(count) || count < 1
      || !validPosition(x, y) || !options || typeof options !== 'object') return null;
    const pickupAfter = options.pickupAfter ?? 0;
    const dropOrigin = options.dropOrigin ?? null;
    if (!Number.isFinite(pickupAfter) || pickupAfter < 0
      || (dropOrigin !== null && !validPosition(dropOrigin.x, dropOrigin.y))) return null;

    const uid = nextDropUid++;
    const item = {
      uid: `drop:${uid}`,
      id,
      count,
      x,
      y,
      phase: (uid * 2.399963229728653) % (Math.PI * 2),
      pickupAfter,
      dropOrigin: dropOrigin === null ? null : { x: dropOrigin.x, y: dropOrigin.y },
    };
    const list = this.of(Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE));
    list.push(item);
    this.owners.set(item, list);
    return item;
  }

  remove(item) {
    if (!item || typeof item !== 'object') return false;
    const list = this.owners.get(item);
    if (!list) return false;
    const index = list.indexOf(item);
    if (index < 0) return false;
    list.splice(index, 1);
    this.owners.delete(item);
    return true;
  }

  move(item, x, y) {
    if (!item || typeof item !== 'object' || !validPosition(x, y)) return false;
    const source = this.owners.get(item);
    const index = source?.indexOf(item) ?? -1;
    if (index < 0) return false;
    const destination = this.of(Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE));
    if (source !== destination) {
      source.splice(index, 1);
      destination.push(item);
      this.owners.set(item, destination);
    }
    item.x = x;
    item.y = y;
    return true;
  }
}
