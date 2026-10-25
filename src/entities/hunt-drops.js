import { GroundItems } from '../world/items.js';
import { ASPECT, CHUNK_SIZE, WATER } from '../world/world.js';
import { SCALE, TILT } from './rig.js';

// What hunted animals leave: hide, meat and bone lying beside the body,
// kept apart from the world's own loose items. The stacks sit in a land of
// their own whose chunks start empty, so querying it never scatters loose
// items over the map; the ordinary ground-item code holds, moves and draws
// them, and a collection on the real world picks them up.

// Stacks lie this long, seconds, before they are lost, and the newest are
// kept past this many.
export const DROP_LIFETIME = 300;
export const MAX_STACKS = 48;
// Seconds before a fresh stack can be picked up.
export const PICKUP_DELAY = 0.5;
// Stacks lie this far from where the animal stood, metres, clear of the
// body as it falls, or as near as dry ground allows within the last ring.
const RINGS = [1.2, 1.6, 2, 2.5, 3];
// Failing that, the dry ground nearest the hunter, out to as far.
const HUNTER_RINGS = [0, 0.5, 1, 1.5, 2, 2.5, 3];
const AROUND = 12;

// The land the drop store keeps its stacks in. Every chunk starts with no
// items; only those holding stacks are kept, and only they count as
// loaded, so looking over empty land holds nothing in memory.
export function createCarcassLand() {
  const chunks = new Map();
  // The ground-item code keeps each changed chunk's list here.
  const loot = {
    get: (key) => chunks.get(key),
    set(key, list) {
      if (list.length) chunks.set(key, list);
      else chunks.delete(key);
    },
  };
  const chunk = () => ({ items: [], props: [] });
  const loaded = (cx, cy) => {
    const items = chunks.get(`${cx},${cy}`);
    return items ? { items, props: [] } : null;
  };
  // Lets go of lists left empty by stacks that moved away.
  const prune = () => {
    for (const [key, list] of chunks) if (!list.length) chunks.delete(key);
  };
  return { chunk, loaded, loot, chunks, prune };
}

const toCells = (mx, mz) => [(mx * SCALE) / ASPECT, mz * SCALE * TILT];

export class HuntDrops {
  constructor() {
    this.land = createCarcassLand();
    this.items = new GroundItems(this.land);
    // When each stack was laid, oldest first.
    this.laid = new Map();
  }

  // Whether a cell is open, dry ground on land that is already generated.
  static dry(world, x, y) {
    if (!world.loaded?.(Math.floor(x / CHUNK_SIZE), Math.floor(y / CHUNK_SIZE))?.props) return false;
    return world.isWalkable(x, y) && world.typeAt(x, y) !== WATER;
  }

  // The dry cells in rings round a point, nearest ring first, reachable
  // from it if it is dry itself; it stops at the first ring that brings the
  // count to `enough`.
  static around(world, centre, rings, path, enough) {
    const out = [];
    const from = HuntDrops.dry(world, centre.x, centre.y) ? centre : null;
    for (const r of rings) {
      for (let i = 0; i < (r ? AROUND : 1); i++) {
        const angle = (i / AROUND) * Math.PI * 2 + r;
        const [dx, dy] = toCells(Math.sin(angle) * r, Math.cos(angle) * r);
        const spot = { x: centre.x + dx, y: centre.y + dy };
        if (!HuntDrops.dry(world, spot.x, spot.y)) continue;
        if (from && !path(from, spot)) continue;
        out.push(spot);
      }
      if (out.length >= enough) return out;
    }
    return out;
  }

  // The cells round a body a stack may lie on: dry and reachable from where
  // the body lies, nearest first; or, the body in water, the dry ground
  // nearest the one who brought it down.
  spots(world, near, path) {
    const out = HuntDrops.around(world, near, RINGS, path, 3);
    if (out.length || !near.killer) return out;
    return HuntDrops.around(world, near.killer, HUNTER_RINGS, path, 1);
  }

  // Lays each of a body's stacks ({ x, y, killer, items }) on its own dry
  // spot beside it. `path` tells whether the way between two cells is
  // clear (the collection's own test). Returns the stacks laid.
  lay(drop, world, path = () => true) {
    const laid = [];
    const spots = this.spots(world, drop, path);
    if (!spots.length) return laid;
    drop.items.forEach((d, i) => {
      const spot = spots[(i * 5) % spots.length];
      const item = this.items.add(d.id, d.count, spot.x, spot.y, { pickupAfter: this.items.time + PICKUP_DELAY });
      if (!item) return;
      this.laid.set(item, this.items.time);
      laid.push(item);
    });
    while (this.laid.size > MAX_STACKS) this.forget(this.laid.keys().next().value);
    return laid;
  }

  forget(item) {
    this.items.remove(item);
    this.laid.delete(item);
  }

  // Loses the stacks that have lain too long, and forgets those picked up.
  expire(time = this.items.time) {
    for (const [item, at] of this.laid) {
      if (item.count <= 0 || time - at >= DROP_LIFETIME) this.forget(item);
    }
    this.land.prune();
  }

  in(x0, y0, x1, y1) {
    return this.items.in(x0, y0, x1, y1, true);
  }

  all() {
    return [...this.laid.keys()].filter((item) => item.count > 0);
  }
}
