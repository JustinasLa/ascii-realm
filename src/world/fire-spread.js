import { clumpAt, patchAt } from './grass-roots.js';
import { blocks } from './props.js';
import { ASPECT, CHUNK_SIZE, GRASS, SHORE, WATER } from './world.js';

export const MAX_BURN_NODES = 384;
const MIN_HEAT = 0.22;
const NEIGHBOURS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

const within = (p, x, y, width, height) => ((x - p.x) / width) ** 2 + ((y - p.y) / height) ** 2 <= 1;

// Fuel occupies the ground, not the upward projection of a tree's sprite.
// Short turf, gaps between clumps, paths, water, rocks and ash stop the fire.
export function vegetationFuel(world, x, y, resourcesIn = () => []) {
  x = Math.floor(x); y = Math.floor(y);
  if (world.typeAt(x, y) === WATER) return null;
  const px = x + 0.5, py = y + 0.5;
  const width = Math.max(1, world.propFootW ?? 10);
  const height = Math.max(1, world.propFootH ?? 2);
  const props = world.propsIn?.(px - width, py - height, px + width, py + height) ?? [];
  for (const prop of props) {
    if (prop.chopped || prop.burnt) continue;
    if ((prop.kind === 'tree' || prop.kind === 'bush') &&
      within(prop, px, py, Math.max(0.6, prop.footW), Math.max(0.6, prop.footH))) {
      return { key: `tree:${prop.id ?? `${prop.x},${prop.y}`}`, kind: 'tree', x: prop.x, y: prop.y,
        width: Math.max(0.6, prop.footW), height: Math.max(0.6, prop.footH), prop,
        duration: 8 + Math.min(6, (prop.height ?? 24) / 8) };
    }
    if (blocks(prop, px, py)) return null;
  }
  for (const node of resourcesIn(px - 4, py - 2, px + 4, py + 2)) {
    if (node.burnt || !['grass', 'bush'].includes(node.kind) || (node.kind === 'grass' && node.harvested)) continue;
    const width = node.kind === 'grass' ? 2 : 3;
    if (!within(node, px, py, width, 1)) continue;
    return { key: `plant:${node.uid ?? `${node.kind}:${node.x},${node.y}`}`, kind: 'plant',
      x: node.x, y: node.y, width, height: 1, node, duration: 5 };
  }
  if (!world.isWalkable(px, py)) return null;
  const cx = Math.floor(x / CHUNK_SIZE), cy = Math.floor(y / CHUNK_SIZE);
  // Fuel reads do not need to regrow the render cache after each scorched cell.
  const chunk = world.chunks?.get(`${cx},${cy}`) ?? world.chunk?.(cx, cy);
  if (!chunk) return null;
  const i = (y - cy * CHUNK_SIZE) * CHUNK_SIZE + x - cx * CHUNK_SIZE;
  if (![GRASS, SHORE].includes(chunk.type[i]) || chunk.burnt?.[i] || chunk.grassHeight[i] < 2.5 ||
    !(chunk.grassDensity[i] > 0) || patchAt(x, y, world.seed) < 0.1 || clumpAt(x, y, world.seed) < 0.3) return null;
  return { key: `grass:${x},${y}`, kind: 'grass', x: px, y: py, width: 0.5, height: 0.5,
    duration: 3.5 + chunk.grassHeight[i] * 0.3 };
}

export function burnStrength(node) {
  const rise = Math.min(1, node.age / 0.6);
  const fade = Math.min(1, Math.max(0, (node.fuel.duration - node.age) / 1.5));
  return node.heat * (0.35 + rise * 0.65) * fade;
}

// One finite incident owns its burning front. Expansion is scheduled in
// time order so a slow frame cannot skip fuel or jump across an empty cell.
export class ConnectedFire {
  constructor(world, fuel, x, y, { fuelAt = vegetationFuel, resourcesIn } = {}) {
    this.world = world;
    this.fuelAt = fuelAt;
    this.resourcesIn = resourcesIn;
    this.time = 0;
    this.nodes = new Map();
    this.active = new Map();
    this.events = [];
    this.add(fuel ?? { key: `torch:${Math.floor(x)},${Math.floor(y)}`, kind: 'torch', x, y,
      width: 0.5, height: 0.5, duration: 3.5 }, 1, 0);
  }

  schedule(node, type, at) {
    const event = { node, type, at };
    let lo = 0, hi = this.events.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.events[mid].at <= at) lo = mid + 1;
      else hi = mid;
    }
    this.events.splice(lo, 0, event);
  }

  add(fuel, heat, at) {
    if (!fuel || heat < MIN_HEAT || this.nodes.has(fuel.key) || this.nodes.size >= MAX_BURN_NODES) return;
    if (this.world.typeAt(fuel.x, fuel.y) === WATER || (fuel.kind === 'tree' && fuel.prop.burning) ||
      (fuel.kind === 'plant' && fuel.node.burnt)) return;
    const node = { fuel, heat, litAt: at, age: 0, progress: 0 };
    this.nodes.set(fuel.key, node);
    this.active.set(fuel.key, node);
    if (fuel.kind === 'tree') this.world.beginTreeBurn?.(fuel.prop, node);
    else if (fuel.kind === 'plant') {
      fuel.node.harvested = true;
      fuel.node.burnt = true;
      const key = `${fuel.node.kind}:${Math.floor(fuel.x)}:${Math.floor(fuel.y)}`;
      this.world.gathered?.add(key);
      this.world.burntPlants?.add(key);
      for (let y = Math.floor(fuel.y - fuel.height); y <= Math.ceil(fuel.y + fuel.height); y++) {
        for (let x = Math.floor(fuel.x - fuel.width); x <= Math.ceil(fuel.x + fuel.width); x++) {
          if (within(fuel, x + 0.5, y + 0.5, fuel.width, fuel.height)) this.world.burnGrassCell?.(x, y);
        }
      }
    } else this.world.burnGrassCell?.(fuel.x, fuel.y);
    this.schedule(node, 'spread', at + (fuel.kind === 'tree' ? 1.2 : 0.55));
    this.schedule(node, 'out', at + fuel.duration);
  }

  expand(node) {
    const fuel = node.fuel;
    const heat = node.heat - (fuel.kind === 'tree' ? 0.24 : 0.08);
    if (heat < MIN_HEAT || this.nodes.size >= MAX_BURN_NODES) return;
    const cells = new Set();
    const wx = Math.floor(fuel.x), wy = Math.floor(fuel.y);
    // A tree or resource clump is one connected object. Check only the
    // edge of its actual footprint; flames never reach by a radius search.
    const rx = Math.ceil(fuel.width), ry = Math.ceil(fuel.height);
    for (let y = wy - ry; y <= wy + ry; y++) for (let x = wx - rx; x <= wx + rx; x++) {
      if (!within(fuel, x + 0.5, y + 0.5, fuel.width, fuel.height)) continue;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx, ny = y + dy;
        if (within(fuel, nx + 0.5, ny + 0.5, fuel.width, fuel.height)) continue;
        const key = `${nx},${ny}`;
        if (cells.has(key)) continue;
        cells.add(key);
        if (this.nodes.size >= MAX_BURN_NODES) return;
        this.add(this.fuelAt(this.world, nx, ny, this.resourcesIn), heat, this.time);
      }
    }
  }

  update(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    const end = this.time + dt;
    while (this.events.length && this.events[0].at <= end) {
      const event = this.events.shift();
      this.time = event.at;
      if (!this.active.has(event.node.fuel.key)) continue;
      if (this.world.typeAt(event.node.fuel.x, event.node.fuel.y) === WATER) {
        if (event.node.fuel.kind === 'tree') this.world.endTreeBurn?.(event.node.fuel.prop, event.node);
        this.active.delete(event.node.fuel.key);
        continue;
      }
      if (event.type === 'spread') this.expand(event.node);
      else {
        if (event.node.fuel.kind === 'tree') {
          this.world.burnTree?.(event.node.fuel.prop);
          this.world.endTreeBurn?.(event.node.fuel.prop, event.node);
        }
        this.active.delete(event.node.fuel.key);
      }
    }
    this.time = end;
    for (const node of this.active.values()) {
      node.age = this.time - node.litAt;
      node.progress = Math.min(1, node.age / node.fuel.duration);
    }
  }

  stop() {
    for (const node of this.active.values()) if (node.fuel.kind === 'tree') this.world.endTreeBurn?.(node.fuel.prop, node);
    this.active.clear();
    this.events.length = 0;
  }

  strength() {
    let strength = 0;
    for (const node of this.active.values()) strength = Math.max(strength, burnStrength(node));
    return strength;
  }

  nearest(x, y) {
    let point = null, distance = Infinity;
    for (const node of this.active.values()) {
      const d = Math.hypot((node.fuel.x - x) * ASPECT, node.fuel.y - y);
      if (d < distance) { point = node.fuel; distance = d; }
    }
    return point;
  }

  sources(view, limit) {
    const groups = new Map();
    for (const node of this.active.values()) {
      const { x, y, kind, key } = node.fuel;
      if (x < view.x0 - 40 || x > view.x0 + view.cols + 40 || y < view.y0 - 23 || y > view.y0 + view.rows + 32) continue;
      const group = kind === 'tree' ? key : `${Math.floor(x / 4)},${Math.floor(y / 3)}`;
      if (!groups.has(group) || burnStrength(node) > burnStrength(groups.get(group))) groups.set(group, node);
    }
    return [...groups.values()].sort((a, b) => burnStrength(b) - burnStrength(a)).slice(0, limit);
  }
}
