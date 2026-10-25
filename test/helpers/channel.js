import { SCALE, TILT } from '../../src/entities/rig.js';
import { crossSpeed } from '../../src/world/rivers.js';
import { ASPECT, GRASS, WATER } from '../../src/world/world.js';

// A stand-in world for the river debris tests.

const ROW = SCALE * TILT;
const RIVER = { id: 7 };

// A straight river running east along row 0, `half` metres wide either side,
// that empties into still water past column `lakeFrom`. Land beyond the
// banks; `grass` paints cells over. Stones are { x, y, r } (cells, layout r).
export function channel({ half = 0.3, speed = 0.5, bend = 0, secondary = 0, lakeFrom = Infinity, stones = [], grass = null,
  loaded = () => true, dir = 0, spring = -5000 } = {}) {
  const dx = Math.cos(dir), dy = Math.sin(dir);
  // Where a cell lies across the river: metres to its left (north) bank.
  const across = (x, y) => {
    const gx = x * ASPECT / SCALE, gy = y / ROW;
    return -(-dy * gx + dx * gy) / half;
  };
  const world = {
    generated: 0,
    loaded: (cx, cy) => loaded(cx, cy),
    typeAt(x, y) {
      if (grass?.(x, y)) return GRASS;
      if (x >= lakeFrom) return WATER;
      return Math.abs(across(x, y)) <= 1 ? WATER : GRASS;
    },
    waterDepthAt: (x, y) => world.typeAt(x, y) === WATER ? 0.3 : 0,
    flowAt(x, y, out = {}) {
      Object.assign(out, { x: 0, y: 0, speed: 0, river: 0, across: 0, secondary: 0, halfWidth: 0, bend: 0, depth: 0 });
      if (world.typeAt(x, y) !== WATER) return out;
      out.depth = 0.3;
      if (x >= lakeFrom) return out;
      const q = across(x, y);
      return Object.assign(out, { x: dx, y: dy, speed: speed * crossSpeed(q), river: RIVER.id, across: q,
        secondary, halfWidth: half, bend });
    },
    rivers: {
      near: (x, y, radius) => {
        const s = (x - spring) * ASPECT / SCALE;
        const dist = Math.max(0, Math.abs(y) / ROW * SCALE - half * SCALE);
        return dist <= radius ? [{ river: RIVER, s, speed, x, y: 0, dist }] : [];
      },
      pointAt: (river, s) => ({ x: spring + s * SCALE / ASPECT * dx, y: s * SCALE * dy * TILT, halfWidth: half }),
      stonesNear: () => stones,
    },
  };
  return world;
}
