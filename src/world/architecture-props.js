import { ASPECT } from './world.js';
import { shadeArchitecture } from './architecture-surface.js';
import { makeColumnGeometry, makeRubbleGeometry } from './architecture-columns.js';
import { makeGateGeometry, makeTowerGeometry, makeWallGeometry } from './architecture-buildings.js';
import { makePillarGeometry } from './architecture-pillars.js';
import { PILLAR_DEFINITIONS } from './pillar-catalog.js';

const GEOMETRY = {
  'stone-gate': makeGateGeometry,
  'stone-tower': makeTowerGeometry,
  ...Object.fromEntries(['column-short', 'column-broken', 'column-tall'].map(kind =>
    [kind, (rand, seed) => makeColumnGeometry(kind, rand, seed)])),
  ...Object.fromEntries(['wall-low', 'wall-broken'].map(kind =>
    [kind, (rand, seed) => makeWallGeometry(kind, rand, seed)])),
  ...Object.fromEntries(['rubble-small', 'rubble-large'].map(kind =>
    [kind, (rand, seed) => makeRubbleGeometry(kind, rand, seed)])),
  ...Object.fromEntries(PILLAR_DEFINITIONS.map(({ kind }) => [kind, (rand, seed) => makePillarGeometry(kind, rand, seed)])),
};

export const isArchitectureKind = (kind) => Object.hasOwn(GEOMETRY, kind);

// Rotate final world ground offsets about the prop anchor. World x is in
// columns, y in rows; invert the oblique ground projection before model yaw.
// Positive 45 degrees makes a wall's tangent run at 45 degrees on screen
// (accounting for glyph aspect). Variation stretches the result afterwards.
export function rotateArchitectureGround(dxWorld, dyWorld, degrees) {
  if (!degrees) return { x: dxWorld, y: dyWorld };
  const angle = (degrees % 360) * Math.PI / 180;
  const c = Math.cos(angle), s = Math.sin(angle);
  const z = -dyWorld / 0.45, x = dxWorld * ASPECT - 0.55 * z;
  const xx = c * x + s * z, zz = -s * x + c * z;
  return { x: (xx + 0.55 * zz) / ASPECT, y: -0.45 * zz };
}

// Geometry is rasterised once; existing prop variation and scene IO remain the
// source of truth for size, seed and collision. Full-size letters follow the
// reference: broad readable light bands across the sculpted stone surfaces.
export function makeArchitectureProp(kind, x, y, rand, seed, bake, rotation = 0) {
  if (!isArchitectureKind(kind)) return null;
  const { mesh, footW, footH, collisionRects, groundFootprints, polygonCollision, groundSkew = 0.55 } = GEOMETRY[kind](rand, seed);
  mesh.yaw(rotation);
  const angle = (rotation % 360) * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  // Turn actual footing corners before projecting them. A projected rectangle
  // includes empty space beside an arch, which becomes an invisible obstacle
  // when that rectangle is subsequently rotated.
  const collisionPolygons = (rotation || polygonCollision) && (groundFootprints
    ? groundFootprints.map(polygon => polygon.map(([x, z]) => {
      const xx = c * x + s * z, zz = -s * x + c * z;
      return [(xx + groundSkew * zz) / ASPECT, -0.45 * zz];
    }))
    : collisionRects?.map(({ minX, maxX, minY, maxY }) =>
    [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]].map(([dx, dy]) => {
      const p = rotateArchitectureGround(dx, dy, rotation);
      return [p.x, p.y];
    })));
  const { bounds, sample } = mesh.compile(3, groundSkew);
  const radius = Math.max(Math.abs(bounds.minX), Math.abs(bounds.maxX));
  const surface = (px, py) => {
    if (!rotation && groundSkew !== 0 && py > 0) return null;
    const hit = sample(px, py);
    return hit ? { ...shadeArchitecture(hit, seed), depth: -0.45 * hit.point[2] } : null;
  };
  const w = Math.ceil(radius / ASPECT) + 1;
  const top = Math.floor(bounds.minY) - 1;
  return { kind, x, y,
    footW: collisionPolygons ? Math.max(...collisionPolygons.flat().map(([dx]) => Math.abs(dx))) : footW / ASPECT,
    footH: collisionPolygons ? Math.max(...collisionPolygons.flat().map(([, dy]) => Math.abs(dy))) : footH,
    // Connected masonry uses this width to align pieces before yaw without
    // rasterising a second, unrotated copy just to measure its footprint.
    ...(collisionPolygons ? { collisionPolygons, rotation, unrotatedFootW: footW / ASPECT }
      : collisionRects ? { collisionRects } : {}),
    cells: bake(w, top, rotation || groundSkew === 0 ? Math.ceil(bounds.maxY) + 1 : 0, surface, seed) };
}
