import { hash2, mulberry32 } from '../core/rng.js';
import { createProp } from './props.js';
import { rotateArchitectureGround } from './architecture-props.js';
import { ASPECT, GRASS, STONE } from './world.js';

// These slots belong to the generated landmark, including after an editor
// deletes or moves one. Keep them independent of chunk order and prop seeds.
export const SPAWN_SLOTS = 12;
export function isSpawnRuinId(id) {
  const slot = typeof id === 'string' && /^r:spawn:(0|[1-9]\d?)$/.exec(id);
  return !!slot && Number(slot[1]) < SPAWN_SLOTS;
}

function footprint(prop) {
  if (prop.collisionPolygons?.length) {
    const points = prop.collisionPolygons.flat();
    return {
      minX: prop.x + Math.min(...points.map(p => p[0])),
      maxX: prop.x + Math.max(...points.map(p => p[0])),
      minY: prop.y + Math.min(...points.map(p => p[1])),
      maxY: prop.y + Math.max(...points.map(p => p[1])),
    };
  }
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
  const add = (kind, dx, dy, scale = 1, variant = 1, rotation = 0) => {
    const prop = createProp(kind, x + dx, y + dy,
      { seed: Math.floor(random() * 2 ** 32), scale, variant, rotation });
    prop.id = `r:spawn:${props.length}`;
    props.push(prop);
    return prop;
  };

  const gateY = y - 30;
  // In this oblique view, 17 degrees retains about 80% of the front span
  // while revealing the thickness of the arch and its adjoining masonry.
  const rotation = 17;
  // Match widths before turning the entire connected wall. Uniform variation
  // keeps its separate pieces on the same ground plane after projection.
  const gate = add('stone-gate', 0, -30, 0.72, 0, rotation);
  const left = add('wall-broken', 0, -30, 0.85, 0, rotation);
  const right = add('wall-broken', 0, -30, 0.85, 0, rotation);
  // The pier's actual projected footing is slanted even before yaw. Seat the
  // wall deeply enough into it to join both the front and rear stone faces.
  const pierOverlap = 7, wallOverlap = 2.5;
  for (const [prop, side] of [[left, -1], [right, 1]]) {
    const distance = gate.unrotatedFootW + prop.unrotatedFootW - pierOverlap;
    const { x: dx, y: dy } = rotateArchitectureGround(side * distance, 0, rotation);
    prop.x = x + dx;
    prop.y = gateY + dy;
  }
  // Match the centred footing and projection of the new foreground pillar.
  // Keep the original anchors and slots so saved removals still apply.
  add('column-circular-chipped', -84, -4);
  add('column-square-snapped', 90, -9, 1, 1, 45);
  add('column-circular-collapsed', 108, -72);
  add('rubble-large', -126, -34, 1.5);
  add('rubble-large', 130, -36, 1.5);

  // Keep the original eight slots stable for saved removals. New outer
  // courses lengthen both walls into a low, continuous ruined enclosure.
  for (const [inner, side] of [[left, -1], [right, 1]]) {
    const outer = add('wall-low', 0, -30, 0.85, 0, rotation);
    const distance = gate.unrotatedFootW + 2 * inner.unrotatedFootW + outer.unrotatedFootW - pierOverlap - wallOverlap;
    const { x: dx, y: dy } = rotateArchitectureGround(side * distance, 0, rotation);
    outer.x = x + dx;
    outer.y = gateY + dy;
  }

  // Append a new slot so existing saved removals keep their identities.
  add('column-square', 0, 28, 1, 0, 45);
  // A furnace on the forecourt's east side, in view from spawn and clear of
  // the starter glowcap.
  add('furnace', 34, -12);

  // Approach the arch along its rotated tunnel, with an open forecourt
  // between spawn and the wall rather than a tight cluster around the player.
  const through = (localY) => {
    const { x: dx, y: dy } = rotateArchitectureGround(0, localY, rotation);
    return { x: x + dx, y: gateY + dy };
  };
  const route = [{ x, y }, through(10), through(-14), through(-22)];

  const feet = props.map(footprint);
  // Only the ground plane needs reclaiming: the tall silhouettes extend
  // north on screen without requiring a matching expanse of cleared land.
  const bounds = {
    minX: Math.floor(Math.min(x - 145, ...feet.map(f => f.minX - 5))),
    maxX: Math.ceil(Math.max(x + 145, ...feet.map(f => f.maxX + 5))),
    minY: Math.floor(Math.min(y - 88, ...feet.map(f => f.minY - 3))),
    maxY: Math.ceil(Math.max(y + 8, ...feet.map(f => f.maxY + 2))),
  };
  const inside = (px, py) => px >= bounds.minX && px <= bounds.maxX
    && py >= bounds.minY && py <= bounds.maxY;

  const terrainAt = (px, py) => {
    if (!inside(px, py)) return undefined;
    // An old causeway bends towards the diagonal passage. Measure distance
    // in physical row units so its width is consistent in every direction.
    const edge = (hash2(Math.floor(px), Math.floor(py), seed + 3113) - 0.5) * 0.7;
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1], b = route[i];
      const dx = (b.x - a.x) * ASPECT, dy = b.y - a.y;
      const qx = (px - a.x) * ASPECT, qy = py - a.y;
      const t = Math.max(0, Math.min(1, (qx * dx + qy * dy) / (dx * dx + dy * dy)));
      if (Math.hypot(qx - t * dx, qy - t * dy) <= 3.6 + edge) return STONE;
    }
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

  return { props, bounds, route, terrainAt, exclude };
}
