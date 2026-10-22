import { hash2, mulberry32 } from '../core/rng.js';
import { createProp } from './props.js';
import { ASPECT, DIRT, GRASS, STONE } from './world.js';

// These slots belong to the generated landmark, including after an editor
// deletes or moves one. Keep them independent of chunk order and prop seeds.
export function isSpawnRuinId(id) {
  return typeof id === 'string' && /^r:spawn:[0-7]$/.test(id);
}

function footprint(prop) {
  if (prop.collisionRects?.length) {
    return {
      minX: prop.x + Math.min(...prop.collisionRects.map(r => r.minX)),
      maxX: prop.x + Math.max(...prop.collisionRects.map(r => r.maxX)),
      minY: prop.y + Math.min(...prop.collisionRects.map(r => r.minY)),
      maxY: prop.y + Math.max(...prop.collisionRects.map(r => r.maxY)),
    };
  }
  return { minX: prop.x - (prop.footW ?? 0), maxX: prop.x + (prop.footW ?? 0),
    minY: prop.y - (prop.footH ?? 0), maxY: prop.y + (prop.footH ?? 0) };
}

const overlaps = (a, b) => a.minX <= b.maxX && a.maxX >= b.minX
  && a.minY <= b.maxY && a.maxY >= b.minY;

export function createSpawnRuins(seed, spawn) {
  const { x, y } = spawn;
  const random = mulberry32(Math.floor(hash2(0, 0, seed + 3109) * 2 ** 32));
  const props = [];
  const add = (kind, dx, dy, scale = 1) => {
    const prop = createProp(kind, x + dx, y + dy,
      { seed: Math.floor(random() * 2 ** 32), scale });
    prop.id = `r:spawn:${props.length}`;
    props.push(prop);
    return prop;
  };

  const gate = add('stone-gate', 0, -12, 0.72);
  const left = add('wall-broken', 0, -12, 0.85);
  const right = add('wall-broken', 0, -12, 0.85);
  // Use the final, varied collision widths. Each wall bites into its gate
  // pier by 2.5 columns, leaving the central passage completely open.
  const gateFoot = footprint(gate);
  left.x = gateFoot.minX - (footprint(left).maxX - left.x) + 2.5;
  right.x = gateFoot.maxX + (right.x - footprint(right).minX) - 2.5;
  add('column-tall', -38, 2);
  add('column-broken', 38, 2);
  add('column-short', 60, -23);
  add('rubble-large', -65, 1, 1.5);
  add('rubble-large', 65, 1, 1.5);

  const feet = props.map(footprint);
  // Only the ground plane needs reclaiming: the tall silhouettes extend
  // north on screen without requiring a matching expanse of cleared land.
  const bounds = {
    minX: Math.floor(Math.min(x - 85, ...feet.map(f => f.minX - 5))),
    maxX: Math.ceil(Math.max(x + 85, ...feet.map(f => f.maxX + 5))),
    minY: Math.floor(Math.min(y - 36, ...feet.map(f => f.minY - 3))),
    maxY: Math.ceil(Math.max(y + 6, ...feet.map(f => f.maxY + 2))),
  };
  const inside = (px, py) => px >= bounds.minX && px <= bounds.maxX
    && py >= bounds.minY && py <= bounds.maxY;

  const terrainAt = (px, py) => {
    if (!inside(px, py)) return undefined;
    // A narrow old causeway runs from spawn north through the actual arch.
    const edge = (hash2(Math.floor(px), Math.floor(py), seed + 3113) - 0.5) * 0.7;
    if (Math.abs(px - x) <= 6 + edge) return STONE;
    if (feet.some(f => px >= f.minX - 1.5 && px <= f.maxX + 1.5
      && py >= f.minY - 1 && py <= f.maxY + 1)) return DIRT;
    return GRASS;
  };

  const exclude = (prop) => {
    if (overlaps(footprint(prop), bounds)) return true;
    // Fallen logs may reach into the approach from a base outside it.
    // Their capsule endpoints/radii are physical row units, unlike world X.
    return prop.colliders?.some(s => overlaps({
      minX: prop.x + (Math.min(s.ax, s.bx) - s.r) / ASPECT,
      maxX: prop.x + (Math.max(s.ax, s.bx) + s.r) / ASPECT,
      minY: prop.y + Math.min(s.ay, s.by) - s.r,
      maxY: prop.y + Math.max(s.ay, s.by) + s.r,
    }, bounds)) ?? false;
  };

  return { props, bounds, terrainAt, exclude };
}
