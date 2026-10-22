import { hash2 } from '../core/rng.js';
import { DEADWOOD_REACH_X, DEADWOOD_REACH_Y } from '../world/deadwood.js';
import { ASPECT, DIRT, GRASS, STONE } from '../world/world.js';

// The video reference: a towering foreground column, another behind the court,
// broken shafts to the right, and low fallen stones in the foreground.
// The gate and tower stand farther north, outside the initial composition.
export const RUIN_PROPS = Object.freeze([
  { kind: 'stone-gate', x: 0, y: -170 },
  { kind: 'stone-tower', x: 75, y: -165 },
  { kind: 'column-tall', x: -50, y: 5 },
  { kind: 'column-tall', x: -18, y: -55 },
  { kind: 'column-short', x: 80, y: -8 },
  { kind: 'column-broken', x: 40, y: -20 },
  { kind: 'wall-low', x: -46, y: -150 },
  { kind: 'wall-low', x: 58, y: -150 },
  { kind: 'wall-broken', x: -60, y: -145 },
  { kind: 'rubble-small', x: -24, y: 38, scale: 3 },
  { kind: 'rubble-small', x: 52, y: 38, scale: 3 },
  { kind: 'rubble-large', x: 82, y: 3, scale: 2.6 },
].map(Object.freeze));

export const RUIN_CLEARING = Object.freeze({ minX: -75, maxX: 100, minY: -185, maxY: 65 });
export const RUIN_COURT = Object.freeze({ minX: -14, maxX: 14, minY: -7, maxY: 18 });

function overlaps(prop, bounds) {
  // Deadwood has segment colliders that can extend far beyond its stump foot.
  let minX = -prop.footW, maxX = prop.footW;
  let minY = -prop.footH, maxY = prop.footH;
  for (const segment of prop.colliders ?? []) {
    minX = Math.min(minX, (Math.min(segment.ax, segment.bx) - segment.r) / ASPECT);
    maxX = Math.max(maxX, (Math.max(segment.ax, segment.bx) + segment.r) / ASPECT);
    minY = Math.min(minY, Math.min(segment.ay, segment.by) - segment.r);
    maxY = Math.max(maxY, Math.max(segment.ay, segment.by) + segment.r);
  }
  return prop.x + maxX >= bounds.minX && prop.x + minX <= bounds.maxX
    && prop.y + maxY >= bounds.minY && prop.y + minY <= bounds.maxY;
}

// Merge a prepared snapshot through Scenery.load: validation/baking happens
// before any edits, and terrain, removals and additions share one undo entry.
// Existing authored props are never erased to make room for the preset.
export function placeRuinScene(scene, centre) {
  if (!Number.isFinite(centre?.x) || !Number.isFinite(centre?.y)
      || Math.abs(centre.x) > 999_800 || Math.abs(centre.y) > 999_800) {
    throw new Error('Choose a ruin site within the world limits.');
  }
  const origin = { x: Math.floor(centre.x) + 0.5, y: Math.floor(centre.y) + 0.5 };
  const bounds = {
    minX: origin.x + RUIN_CLEARING.minX, maxX: origin.x + RUIN_CLEARING.maxX,
    minY: origin.y + RUIN_CLEARING.minY, maxY: origin.y + RUIN_CLEARING.maxY,
  };
  const { world } = scene;
  if ([...world.addedProps.values()].some(prop => overlaps(prop, bounds))) {
    throw new Error('Ruin site overlaps placed props. Pan to an empty area, then add ruins.');
  }
  const data = scene.serialize();
  const terrain = new Map(data.terrain.map(cell => [`${cell.x},${cell.y}`, cell]));
  for (let dy = RUIN_CLEARING.minY; dy <= RUIN_CLEARING.maxY; dy++) {
    for (let dx = RUIN_CLEARING.minX; dx <= RUIN_CLEARING.maxX; dx++) {
      const x = Math.floor(origin.x) + dx, y = Math.floor(origin.y) + dy;
      // A worn crossing in a meadow, rather than a rectangular platform.
      // Irregular path verges and scattered paving let grass grow between ruins.
      const grain = hash2(x, y, world.seed + 222);
      const northSouth = Math.abs(dx - Math.sin(dy * 0.07) * 2.5);
      const eastWest = Math.abs(dy - 8 - Math.sin(dx * 0.045) * 1.7);
      const court = (dx / 20) ** 2 + ((dy - 5) / 13) ** 2;
      const paving = northSouth < 3.5 + grain * 1.8 || eastWest < 1.6 + grain * 1.1
        || (court < 0.8 + grain * 0.2 && grain > 0.82);
      const verge = northSouth < 5.5 + grain * 1.8 || eastWest < 3 + grain;
      const base = RUIN_PROPS.some(prop => Math.abs(dy - prop.y) < 2.5
        && Math.abs((dx - prop.x) * ASPECT) < (prop.kind.startsWith('wall') ? 12
          : prop.kind === 'stone-tower' ? 9 : prop.kind.startsWith('column') ? 4.5 : 0));
      const type = paving ? STONE : base || (verge && grain > 0.55) ? DIRT : GRASS;
      const key = `${x},${y}`;
      if (world.originalTypeAt(x, y) === type) terrain.delete(key);
      else terrain.set(key, { x, y, type });
    }
  }
  data.terrain = [...terrain.values()];
  const removed = new Set(data.removed);
  const reachX = Math.max(world.propFootW, DEADWOOD_REACH_X);
  const reachY = Math.max(world.propFootH, DEADWOOD_REACH_Y);
  for (const prop of world.propsIn(bounds.minX - reachX, bounds.minY - reachY,
    bounds.maxX + reachX, bounds.maxY + reachY)) {
    if (!world.addedProps.has(prop.id) && overlaps(prop, bounds)) removed.add(prop.id);
  }
  data.removed = [...removed];
  const usedIds = new Set(data.props.map(prop => prop.id));
  let nextId = 1;
  for (const [index, prop] of RUIN_PROPS.entries()) {
    while (usedIds.has(`s:${nextId}`)) nextId++;
    data.props.push({ ...prop, id: `s:${nextId++}`, x: origin.x + prop.x, y: origin.y + prop.y,
      scale: prop.scale ?? 1, variant: 1,
      seed: Math.floor(hash2(Math.floor(origin.x) + index, Math.floor(origin.y), world.seed + 221) * 2 ** 32) });
  }
  scene.load(data);
  return { origin, bounds, count: RUIN_PROPS.length };
}
