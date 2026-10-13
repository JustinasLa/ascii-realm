import { hash2 } from '../core/rng.js';
import { ASPECT, CHUNK_SIZE, DIRT, GRASS, SHORE, STONE, WATER } from './world.js';
import { rockTypeAt } from './geology.js';

const LOOSE_STEP = 8;
const RESOURCE_STEP = 14;
const TAU = Math.PI * 2;

function context(world, cx, cy) {
  const x0 = cx * CHUNK_SIZE;
  const y0 = cy * CHUNK_SIZE;
  return {
    world, cx, cy, x0, y0,
    // Neighbouring trunks and boulders can obstruct the edge, and sticks
    // around their footprints can belong to this chunk.
    props: world.propsIn(x0 - 24, y0 - 10, x0 + CHUNK_SIZE + 24, y0 + CHUNK_SIZE + 10),
  };
}

function owned(ctx, x, y) {
  return Math.floor(x / CHUNK_SIZE) === ctx.cx && Math.floor(y / CHUNK_SIZE) === ctx.cy;
}

function open(ctx, x, y) {
  // Match the player's collision width so a collectible is not stranded on
  // a narrow bank or inside a trunk. Props keep their original footprint
  // here: harvesting a neighbour must not change future chunk generation.
  for (const offset of [-1.2, 0, 1.2]) {
    if (ctx.world.typeAt(x + offset, y) === WATER) return false;
    for (const prop of ctx.props) {
      const dx = (x + offset - prop.x) / prop.footW;
      const dy = (y - prop.y) / prop.footH;
      if (dx * dx + dy * dy < 1) return false;
    }
  }
  return true;
}

function nearWater(world, x, y) {
  for (const [dx, dy] of [[0, -1], [0, 1], [-2, 0], [2, 0], [0, -3], [0, 3],
    [-4, 0], [4, 0], [-3, -2], [3, -2], [-3, 2], [3, 2]]) {
    if (world.typeAt(x + dx, y + dy) === WATER) return true;
  }
  return false;
}

function distance(x0, y0, x1, y1) {
  return Math.hypot((x1 - x0) * ASPECT, y1 - y0);
}

function outsideStart(world, x, y) {
  return !world.spawn || distance(world.spawn.x, world.spawn.y, x, y) >= 6;
}

function phase(world, x, y, salt) {
  return hash2(Math.floor(x), Math.floor(y), world.seed + salt) * TAU;
}

function item(world, id, x, y, count = 1) {
  return { uid: `loose:${id}:${Math.floor(x)}:${Math.floor(y)}`, id, count, x, y,
    phase: phase(world, x, y, 1510), pickupAfter: 0 };
}

function resource(world, kind, x, y) {
  return { uid: `resource:${kind}:${Math.floor(x)}:${Math.floor(y)}`, kind, x, y,
    harvested: false, phase: phase(world, x, y, 1511) };
}

function add(out, occupied, entry) {
  const key = `${Math.floor(entry.x)},${Math.floor(entry.y)}`;
  if (occupied.has(key)) return;
  occupied.add(key);
  out.push(entry);
}

// Starter finds are part of generation, so they belong to their actual chunk
// and never respawn when that chunk is revisited. Every nearby chunk computes
// the same positions before selecting only the ones it owns.
function starterPositions(ctx, definitions, angleOffset) {
  const { world } = ctx;
  const spawn = world.spawn;
  if (!spawn || distance(spawn.x, spawn.y,
    ctx.x0 + CHUNK_SIZE / 2, ctx.y0 + CHUNK_SIZE / 2) > 75) return [];
  const around = {
    ...ctx,
    props: world.propsIn(spawn.x - 38, spawn.y - 23, spawn.x + 38, spawn.y + 23),
  };
  const selected = [];
  for (let i = 0; i < definitions.length; i++) {
    const definition = definitions[i];
    let found = null;
    for (const radius of [10, 13, 16]) {
      for (let j = 0; j < 24; j++) {
        const angle = angleOffset + i * TAU / definitions.length + j * TAU / 24;
        const x = Math.floor(spawn.x + Math.cos(angle) * radius / ASPECT) + 0.5;
        const y = Math.floor(spawn.y + Math.sin(angle) * radius) + 0.5;
        if (!open(around, x, y) || (definition.grass && world.typeAt(x, y) !== GRASS)) continue;
        if (selected.some(p => distance(p.x, p.y, x, y) < 3)) continue;
        found = { ...definition, x, y };
        break;
      }
      if (found) break;
    }
    if (found) selected.push(found);
  }
  return selected.filter(p => owned(ctx, p.x, p.y));
}

function grid(ctx, step, salt, visit) {
  for (let ly = 0; ly < CHUNK_SIZE; ly += step) {
    for (let lx = 0; lx < CHUNK_SIZE; lx += step) {
      const ox = ctx.x0 + lx;
      const oy = ctx.y0 + ly;
      // The last jitter tile is clipped instead of spilling into a neighbour.
      const x = ox + Math.floor(hash2(ox, oy, ctx.world.seed + salt) * Math.min(step, CHUNK_SIZE - lx)) + 0.5;
      const y = oy + Math.floor(hash2(ox, oy, ctx.world.seed + salt + 1) * Math.min(step, CHUNK_SIZE - ly)) + 0.5;
      if (outsideStart(ctx.world, x, y) && open(ctx, x, y)) visit(x, y);
    }
  }
}

export function generateLooseItems(world, cx, cy) {
  const ctx = context(world, cx, cy);
  const items = [];
  const occupied = new Set();
  for (const p of starterPositions(ctx, [{ id: 'rock' }, { id: 'flint' },
    { id: 'berries', grass: true }, { id: 'mushroom', grass: true }], -Math.PI * 0.8)) {
    add(items, occupied, item(world, p.id === 'rock' ? rockTypeAt(world, p.x, p.y) : p.id, p.x, p.y));
  }

  grid(ctx, LOOSE_STEP, 1520, (x, y) => {
    const type = world.typeAt(x, y);
    const roll = hash2(Math.floor(x), Math.floor(y), world.seed + 1522);
    let id;
    if ((type === SHORE || type === GRASS || type === DIRT) && nearWater(world, x, y) && roll < 0.55) {
      id = roll < 0.28 ? 'reed' : 'clay';
    } else if (type === GRASS) {
      if (roll < 0.13) id = rockTypeAt(world, x, y);
      else if (roll < 0.19) id = 'flint';
      else if (roll < 0.25) id = 'berries';
      else if (roll < 0.31) id = 'mushroom';
    } else if (type === STONE || type === DIRT || type === SHORE) {
      if (roll < 0.3) id = rockTypeAt(world, x, y);
      else if (roll < 0.38) id = 'flint';
    }
    if (id) add(items, occupied, item(world, id, x, y));
  });

  const trees = ctx.props.filter(p => p.kind === 'tree').sort((a, b) => a.y - b.y || a.x - b.x);
  for (const tree of trees) {
    if (tree.x < ctx.x0 - 7 || tree.x > ctx.x0 + CHUNK_SIZE + 7
      || tree.y < ctx.y0 - 5 || tree.y > ctx.y0 + CHUNK_SIZE + 5) continue;
    const tx = Math.floor(tree.x);
    const ty = Math.floor(tree.y);
    const count = 1 + (hash2(tx, ty, world.seed + 1530) < 0.45 ? 1 : 0);
    for (let i = 0; i < count; i++) {
      const start = hash2(tx, ty, world.seed + 1531 + i) * TAU;
      for (let attempt = 0; attempt < 16; attempt++) {
        const angle = start + attempt * TAU / 16;
        const x = Math.floor(tree.x + Math.cos(angle) * (tree.footW + 3)) + 0.5;
        const y = Math.floor(tree.y + Math.sin(angle) * (tree.footH + 2.2)) + 0.5;
        if (!outsideStart(world, x, y) || !open(ctx, x, y)) continue;
        // Decide the world position before applying chunk ownership, so a
        // tree crossing a boundary cannot create a second stick there.
        if (owned(ctx, x, y)) add(items, occupied, item(world, 'stick', x, y));
        break;
      }
    }
  }
  return items;
}

export function generateResources(world, cx, cy) {
  const ctx = context(world, cx, cy);
  const resources = [];
  const occupied = new Set();
  for (const p of starterPositions(ctx, [{ kind: 'grass', grass: true },
    { kind: 'bush', grass: true }], -Math.PI / 2)) {
    add(resources, occupied, resource(world, p.kind, p.x, p.y));
  }
  grid(ctx, RESOURCE_STEP, 1540, (x, y) => {
    if (world.typeAt(x, y) !== GRASS) return;
    const roll = hash2(Math.floor(x), Math.floor(y), world.seed + 1542);
    if (roll < 0.52) add(resources, occupied, resource(world, roll < 0.34 ? 'grass' : 'bush', x, y));
  });
  return resources;
}
