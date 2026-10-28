import { generateResources } from './gatherables.js';
import { blocks } from './props.js';
import { ASPECT, CHUNK_SIZE, TREE_HITS, WATER } from './world.js';

const INTERACT_REACH = 6;
const STRIKE_RADIUS = 3.5;
const PICKUP_DELAY = 0.25;

const LABELS = {
  bush: { name: 'Berry bush', action: 'Gather berries' },
  grass: { name: 'Tall grass', action: 'Gather fibre' },
  tree: { name: 'Tree', action: 'Chop with your sword' },
};

// Trees are named for their species, e.g. "Birch tree".
function treeName(node) {
  const species = typeof node.species === 'string' ? node.species : 'oak';
  return `${species[0].toUpperCase()}${species.slice(1)} tree`;
}

// Plants are remembered by kind and cell once gathered.
const plantKey = (node) => `${node.kind}:${Math.floor(node.x)}:${Math.floor(node.y)}`;

const distance = (a, b) => Math.hypot((a.x - b.x) * ASPECT, a.y - b.y);

// Generated bushes carry their seeded yield. Older or externally supplied
// nodes keep the original reward rather than accepting an unbounded count.
const berryYield = (node) => Number.isInteger(node.berryCount) && node.berryCount >= 4 && node.berryCount <= 7
  ? node.berryCount : 2;

// The blade travels from the warrior towards the emitted strike point. A
// narrow corridor catches trunks near the hands as well as the blade tip,
// preserving the strike's original circular footprint at its impact centre.
export function inStrike(player, event, node) {
  const dx = (event.x - player.x) * ASPECT;
  const dy = event.y - player.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return node.x === player.x && node.y === player.y;
  const nx = (node.x - player.x) * ASPECT;
  const ny = node.y - player.y;
  const along = (nx * dx + ny * dy) / lengthSquared;
  if (along < 0) return false;
  const closest = Math.min(1, along);
  return Math.hypot(nx - closest * dx, ny - closest * dy) <= STRIKE_RADIUS;
}

// Resources live on the same cached chunks as terrain and loose items. Their
// depleted state survives leaving the area and drawing the chunk again.
// Without a store for loose items nothing is gathered: the sword still mows
// grass and fells trees, but they drop nothing.
export class Harvesting {
  // `wild: false` keeps the land free of grass tufts and berry bushes.
  constructor(world, groundItems, { wild = true } = {}) {
    this.world = world;
    this.wild = wild;
    this.groundItems = groundItems;
    this.gathering = Boolean(groundItems);
    this.strikes = new WeakSet();
  }

  resourcesOf(cx, cy) {
    const chunk = this.world.chunk(cx, cy);
    if (!chunk.resources) {
      chunk.resources = this.wild ? generateResources(this.world, cx, cy) : [];
      // Gathering preserves berry leaves; burning consumes the whole plant.
      // Both states survive regeneration after chunk eviction.
      for (const node of chunk.resources) {
        const key = plantKey(node);
        if (this.world.gathered?.has(key)) node.harvested = true;
        if (this.world.burntPlants?.has(key)) node.burnt = true;
      }
    }
    return chunk.resources;
  }

  // `loadedOnly` skips chunks not generated yet, for wide views that load
  // them a few at a time.
  resourcesIn(x0, y0, x1, y1, loadedOnly = false) {
    const resources = [];
    for (let cy = Math.floor(y0 / CHUNK_SIZE); cy <= Math.floor(y1 / CHUNK_SIZE); cy++) {
      for (let cx = Math.floor(x0 / CHUNK_SIZE); cx <= Math.floor(x1 / CHUNK_SIZE); cx++) {
        if (loadedOnly && !this.world.loaded?.(cx, cy)?.props) continue;
        for (const node of this.resourcesOf(cx, cy)) {
          if (node.x >= x0 && node.x <= x1 && node.y >= y0 && node.y <= y1) resources.push(node);
        }
      }
    }
    return resources;
  }

  // A resource across water or behind a boulder should not be gathered from
  // the other side. Ignore only the target tree's own blocking trunk.
  reachable(player, node) {
    const props = this.world.propsIn(
      Math.min(player.x, node.x) - 4,
      Math.min(player.y, node.y) - 2,
      Math.max(player.x, node.x) + 4,
      Math.max(player.y, node.y) + 2,
    );
    const steps = Math.max(1, Math.ceil(distance(player, node) * 2));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = player.x + (node.x - player.x) * t;
      const y = player.y + (node.y - player.y) * t;
      if (this.world.typeAt(x, y) === WATER) return false;
      if (props.some((prop) => prop !== node && blocks(prop, x, y))) return false;
    }
    return true;
  }

  nearby(player) {
    const xReach = INTERACT_REACH / ASPECT;
    const resources = this.resourcesIn(player.x - xReach, player.y - INTERACT_REACH,
      player.x + xReach, player.y + INTERACT_REACH);
    const trees = this.world.propsIn(player.x - xReach, player.y - INTERACT_REACH,
      player.x + xReach, player.y + INTERACT_REACH).filter((prop) => prop.kind === 'tree');
    let nearest = null;
    let nearestDistance = INTERACT_REACH;
    for (const node of [...resources, ...trees]) {
      if (node.harvested || node.chopped || !LABELS[node.kind]) continue;
      const d = distance(player, node);
      if (d > nearestDistance || !this.reachable(player, node)) continue;
      nearestDistance = d;
      nearest = { kind: node.kind, node, x: node.x, y: node.y, ...LABELS[node.kind] };
      if (node.kind === 'tree') nearest.name = treeName(node);
      if (node.kind === 'bush' && berryYield(node) > 2) nearest.action = `Gather ${berryYield(node)} berries`;
    }
    return nearest;
  }

  drop(node, rewards) {
    if (!this.gathering) return;
    const pickupAfter = this.groundItems.time + PICKUP_DELAY;
    for (let i = 0; i < rewards.length; i++) {
      const reward = rewards[i];
      const offset = (i - (rewards.length - 1) / 2) * 0.8;
      this.groundItems.add(reward.id, reward.count, node.x + offset, node.y, { pickupAfter });
    }
  }

  harvest(node) {
    if (node.harvested) return null;
    if (!this.gathering) {
      node.harvested = true;
      this.world.gathered?.add(plantKey(node));
      return { ok: true, status: 'cut', name: LABELS[node.kind].name, x: node.x, y: node.y, node, rewards: [], count: 0 };
    }
    const rewards = node.kind === 'bush'
      ? [{ id: 'berries', count: berryYield(node) }]
      : [{ id: 'straw', count: 1 }, { id: 'fibre', count: 1 }];
    node.harvested = true;
    this.world.gathered?.add(plantKey(node));
    this.drop(node, rewards);
    return {
      ok: true,
      status: 'harvested',
      name: LABELS[node.kind].name,
      x: node.x,
      y: node.y,
      node,
      rewards,
      id: rewards.length === 1 ? rewards[0].id : undefined,
      count: rewards.reduce((total, reward) => total + reward.count, 0),
      message: node.kind === 'bush' ? `Gathered ${rewards[0].count} berries.` : 'Gathered straw and fibre.',
    };
  }

  interact(player) {
    if (!this.gathering) return { ok: false, status: 'empty', message: 'Nothing nearby to gather.' };
    const target = this.nearby(player);
    if (!target) return { ok: false, status: 'empty', message: 'Nothing nearby to gather.' };
    if (target.kind === 'tree') {
      return { ...target, ok: false, status: 'tree', message: 'Chop this tree with your sword.' };
    }
    return this.harvest(target.node);
  }

  react(event, player) {
    // The overhead strike also produces a slam for dust and camera shake;
    // that visual effect must not deal another hit to the same tree.
    if (event.type !== 'strike' || this.strikes.has(event)) return [];
    this.strikes.add(event);
    if (!Number.isFinite(event.x) || !Number.isFinite(event.y)) return [];
    const xReach = STRIKE_RADIUS / ASPECT;
    const x0 = Math.min(player.x, event.x) - xReach;
    const x1 = Math.max(player.x, event.x) + xReach;
    const y0 = Math.min(player.y, event.y) - STRIKE_RADIUS;
    const y1 = Math.max(player.y, event.y) + STRIKE_RADIUS;
    const results = [];
    for (const node of this.resourcesIn(x0, y0, x1, y1)) {
      if (node.kind !== 'grass' || node.harvested || !inStrike(player, event, node)) continue;
      if (!this.reachable(player, node)) continue;
      results.push(this.harvest(node));
    }

    let tree = null;
    let nearestDistance = Infinity;
    for (const node of this.world.propsIn(x0, y0, x1, y1)) {
      if (node.kind !== 'tree' || node.chopped || !inStrike(player, event, node)) continue;
      const d = distance(player, node);
      if (d > nearestDistance || !this.reachable(player, node)) continue;
      tree = node;
      nearestDistance = d;
    }
    if (tree) {
      const power = Math.max(1, Math.floor(event.chop ?? 1));
      if (typeof this.world.hitTree === 'function') this.world.hitTree(tree, power);
      else {
        tree.hits = Math.min(TREE_HITS, (tree.hits ?? 0) + power);
        tree.chopped = tree.hits >= TREE_HITS;
      }
      // Saplings give a single length of timber.
      const logs = tree.growth === 'sapling' ? 1 : 3;
      const rewards = tree.chopped && this.gathering ? [{ id: 'oakLog', count: logs }] : [];
      if (tree.chopped) this.drop(tree, rewards);
      const name = treeName(tree);
      results.push({
        ok: true,
        status: tree.chopped ? 'harvested' : 'hit',
        name,
        x: tree.x,
        y: tree.y,
        node: tree,
        hits: tree.hits,
        rewards,
        message: tree.chopped ? `Felled a ${name.toLowerCase()}.` : `Chopping ${name.toLowerCase()}: ${tree.hits}/${TREE_HITS}.`,
      });
    }
    return results;
  }
}
