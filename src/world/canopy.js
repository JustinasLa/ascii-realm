import { valueNoise } from '../core/noise.js';
import { TILT } from '../entities/rig.js';
import { canopyOf, turnOf } from './prop-art.js';
import { MOON, worldNormal } from './surface-light.js';
import { EVERGREEN, MAX_TREE_HALF_WIDTH } from './trees.js';
import { ASPECT } from './world.js';

// The ground a tree's crown keeps the night's light from. Each leaf mass
// over a cell is one layer of leaves; each layer lets LEAF_GAIN of the
// light through (see night-light.js). A tree's footprint is its leaf
// masses seen from above, each a circle of its own radius squashed by the
// view's tilt, leaned a little away from the moon by its height, with an
// edge broken by noise fixed to the world, so a crown's shadow is lobed
// like the crown and never a disc.
//
// A tree's canopy (canopyOf in prop-art.js) lists its leaf masses, four
// numbers each: x across from the trunk and the radius rx, both in row
// units, the height h above the base in rows, and the vertical radius ry.

// The light kept under one layer of leaves.
export const LEAF_GAIN = 0.75;
// The darkest any cell gets, however many crowns overlap, so the night
// ground's glyphs stay readable.
export const GAIN_FLOOR = 0.55;
// Layers at a leaf mass's core.
export const LOBE_LAYERS = 1;
// The share of a mass's radius over which its edge fades.
export const SOFT = 0.35;
// How far the noise moves an edge, as a share of the radius.
export const EDGE_JITTER = 0.25;
// How much a gap between the leaves thins the layers.
export const DAPPLE = 0.5;
// How far a mass's shadow is thrown along the ground, per row of its height.
export const SHADOW_SLANT = 0.1;
// Columns at the stamp's edge over which it fades out when its tree is too
// wide for MAX_TREE_HALF_WIDTH: a clipped shadow has no hard edge.
export const CLIP_FADE = 4;
// Layers are stored as bytes, this many to a layer.
export const LAYER_UNIT = 64;

// The light kept by a cell under i / LAYER_UNIT layers of leaves.
export const GAIN = Float32Array.from({ length: 256 },
  (_, i) => Math.max(GAIN_FLOOR, LEAF_GAIN ** (i / LAYER_UNIT)));

// Which way along the ground a shadow falls: away from the moon. The moon's
// direction is the one the rocks and grass are lit from (surface-light.js).
export const MOON_GROUND = (() => {
  const [x, y] = worldNormal(...MOON);
  const k = Math.hypot(x, y);
  return [-x / k, -y / k];
})();

const smoothstep = (a, b, x) => {
  const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a);
  return t * t * (3 - 2 * t);
};

// How much shadow a tree throws: none once felled or burnt to a stump,
// less as it burns, and a bare winter crown only a little. A tree turning
// to another season (see season-turn.js) goes from one to the other.
const crownStrength = (season, species) => (season === 'winter' && species && !EVERGREEN.has(species) ? 0.35 : 1);
export function stampStrength(prop) {
  if (prop.chopped || prop.burnt) return 0;
  if (prop.burning) return 1 - 0.75 * prop.burning.progress;
  const now = crownStrength(prop.season, prop.species);
  const turn = turnOf(prop);
  return turn ? now + (crownStrength(turn.from, prop.species) - now) * (1 - turn.k) : now;
}

const stamps = new WeakMap();

// A tree's footprint, baked once: { x0, y0, w, h, layers } in world cells
// and rows from its base (Math.floor of its position), layers as bytes of
// LAYER_UNIT to a layer, 0 outside, and `work`, what baking it cost (cells
// times leaf masses). Null for a prop without a canopy.
export function canopyStamp(prop, seed = 1) {
  let stamp = stamps.get(prop);
  if (stamp === undefined) {
    const masses = canopyOf(prop);
    stamp = masses ? bakeStamp(prop, masses, seed) : null;
    stamps.set(prop, stamp);
  }
  return stamp;
}

// Whether a prop's stamp is baked yet (or known to be none).
export const hasStamp = (prop) => stamps.has(prop);

function bakeStamp(prop, masses, seed) {
  const n = masses.length >> 2;
  const bx = Math.floor(prop.x), by = Math.floor(prop.y);
  const fx = prop.x - bx, fy = prop.y - by;
  const [gx, gy] = MOON_GROUND;
  // How far out, as a share of its radius, noise can carry a mass's edge.
  const reach = 1 / (1 - EDGE_JITTER);
  // Wide crowns lean less, so most of the shadow stays within the
  // tree's reach; whatever is left beyond it is clipped below.
  const limit = (MAX_TREE_HALF_WIDTH - CLIP_FADE) * ASPECT;
  let lean = 1;
  for (let i = 0; i < n; i++) {
    const x = masses[i * 4], h = masses[i * 4 + 1], rx = masses[i * 4 + 2];
    const thrown = SHADOW_SLANT * h * gx;
    if (thrown > 0) lean = Math.min(lean, Math.max(0, (limit - x - rx * reach) / thrown));
  }
  // Each mass's ellipse on the ground, in cells across and rows down.
  const cx = new Float64Array(n), cy = new Float64Array(n), ax = new Float64Array(n), ay = new Float64Array(n);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const throwing = SHADOW_SLANT * masses[i * 4 + 1] * lean;
    const rx = masses[i * 4 + 2];
    cx[i] = (masses[i * 4] + throwing * gx) / ASPECT + fx;
    cy[i] = throwing * gy * TILT + fy;
    ax[i] = rx / ASPECT;
    ay[i] = Math.max(0.5, rx * TILT);
    minX = Math.min(minX, cx[i] - ax[i] * reach);
    maxX = Math.max(maxX, cx[i] + ax[i] * reach);
    minY = Math.min(minY, cy[i] - ay[i] * reach);
    maxY = Math.max(maxY, cy[i] + ay[i] * reach);
  }
  const x0 = Math.max(-MAX_TREE_HALF_WIDTH, Math.floor(minX) - 1);
  const x1 = Math.min(MAX_TREE_HALF_WIDTH, Math.ceil(maxX) + 1);
  const y0 = Math.max(-MAX_TREE_HALF_WIDTH, Math.floor(minY) - 1);
  const y1 = Math.min(MAX_TREE_HALF_WIDTH, Math.ceil(maxY) + 1);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const layers = new Uint8Array(w * h);
  for (let dy = y0; dy <= y1; dy++) {
    const wy = by + dy;
    // The middle of the cell, measured from the tree's own point.
    const py = dy + 0.5;
    for (let dx = x0; dx <= x1; dx++) {
      const wx = bx + dx;
      const px = dx + 0.5;
      const jitter = 1 + EDGE_JITTER * (2 * valueNoise(wx * ASPECT * 0.18, wy * 0.3, seed + 1907) - 1);
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const u = (px - cx[i]) / ax[i], v = (py - cy[i]) / ay[i];
        const d2 = u * u + v * v;
        if (d2 >= reach * reach) continue;
        sum += (1 - smoothstep(1 - SOFT, 1, Math.sqrt(d2) * jitter)) * LOBE_LAYERS;
      }
      if (sum <= 0) continue;
      sum *= 1 - DAPPLE * smoothstep(0.62, 0.8, valueNoise(wx * ASPECT * 0.45, wy * 0.7, seed + 1913));
      // A shadow too wide for the tree's reach fades out before its edge.
      sum *= smoothstep(0, CLIP_FADE, MAX_TREE_HALF_WIDTH - Math.abs(dx));
      layers[(dy - y0) * w + dx - x0] = Math.min(255, Math.round(sum * LAYER_UNIT));
    }
  }
  return { x0, y0, w, h, layers, work: w * h * n };
}
