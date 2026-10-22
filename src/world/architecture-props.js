import { ASPECT } from './world.js';
import { shadeArchitecture } from './architecture-surface.js';
import { makeColumnGeometry, makeRubbleGeometry } from './architecture-columns.js';
import { makeGateGeometry, makeTowerGeometry, makeWallGeometry } from './architecture-buildings.js';

const GEOMETRY = {
  'stone-gate': makeGateGeometry,
  'stone-tower': makeTowerGeometry,
  ...Object.fromEntries(['column-short', 'column-broken', 'column-tall'].map(kind =>
    [kind, (rand, seed) => makeColumnGeometry(kind, rand, seed)])),
  ...Object.fromEntries(['wall-low', 'wall-broken'].map(kind =>
    [kind, (rand, seed) => makeWallGeometry(kind, rand, seed)])),
  ...Object.fromEntries(['rubble-small', 'rubble-large'].map(kind =>
    [kind, (rand, seed) => makeRubbleGeometry(kind, rand, seed)])),
};

// Geometry is rasterised once; existing prop variation and scene IO remain the
// source of truth for size, seed and collision. Full-size letters follow the
// reference: broad readable light bands across the sculpted stone surfaces.
export function makeArchitectureProp(kind, x, y, rand, seed, bake) {
  if (!Object.hasOwn(GEOMETRY, kind)) return null;
  const { mesh, footW, footH, collisionRects } = GEOMETRY[kind](rand, seed);
  const { bounds, sample } = mesh.compile();
  const radius = Math.max(Math.abs(bounds.minX), Math.abs(bounds.maxX));
  const surface = (px, py) => {
    if (py > 0) return null;
    const hit = sample(px, py);
    return hit ? shadeArchitecture(hit, seed) : null;
  };
  const w = Math.ceil(radius / ASPECT) + 1;
  const top = Math.floor(bounds.minY) - 1;
  return { kind, x, y, footW: footW / ASPECT, footH,
    ...(collisionRects ? { collisionRects } : {}),
    cells: bake(w, top, 0, surface, seed) };
}
