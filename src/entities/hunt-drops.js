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
const AROUND = 12;

// The chunks the drop store keeps its stacks in: each starts with no items
// and counts as loaded, so the store's on-screen query keeps it.
export function createCarcassLand() {
  const chunks = new Map();
  const chunk = (cx, cy) => {
    const key = `${cx},${cy}`;
    let c = chunks.get(key);
    if (!c) {
      c = { items: [], props: [] };
      chunks.set(key, c);
    }
    return c;
  };
  return { chunk, loaded: chunk, loot: null, chunks };
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

  // The cells round a body a stack may lie on: dry and reachable from where
  // the body lies, nearest first; or, the body in water, the dry ground
  // nearest the one who brought it down.
  spots(world, near, path) {
    const out = [];
    const from = HuntDrops.dry(world, near.x, near.y) ? near : null;
    for (const r of RINGS) {
      for (let i = 0; i < AROUND; i++) {
        const angle = (i / AROUND) * Math.PI * 2 + r;
        const [dx, dy] = toCells(Math.sin(angle) * r, Math.cos(angle) * r);
        const spot = { x: near.x + dx, y: near.y + dy };
        if (!HuntDrops.dry(world, spot.x, spot.y)) continue;
        if (from && !path(from, spot)) continue;
        out.push(spot);
      }
      if (out.length >= 3) return out;
    }
    if (out.length) return out;
    const killer = near.killer;
    if (killer && HuntDrops.dry(world, killer.x, killer.y)) return [{ x: killer.x, y: killer.y }];
    return [];
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
  }

  in(x0, y0, x1, y1) {
    return this.items.in(x0, y0, x1, y1, true);
  }

  all() {
    return [...this.laid.keys()].filter((item) => item.count > 0);
  }
}
