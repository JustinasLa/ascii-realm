import { SCALE, TILT } from '../entities/rig.js';
import { valueNoise } from '../core/noise.js';
import { createProp } from './props.js';

// Raised ground. The land stays a grid of ground cells; a cell `h` metres
// high is only drawn that much higher on screen, and everything standing on
// it with it (see docs/terrain.md).

// Rows a metre of height rises on screen: the character's own scale at the
// camera's pitch, as a jump lifts it.
export const LIFT_PER_METRE = SCALE * Math.sqrt(1 - TILT * TILT);
// The most a cell is ever lifted, in rows.
export const MAX_LIFT = 24;
const SHORE = 1;

// The hill scene, by offset from spawn: x in cells, y in rows, heights in
// metres. A ridge runs across the land north of spawn, with lower meadow
// behind it, and a knoll rises east of spawn as a spur off its foot.
export const HILL = {
  ridge: { dy: -24, height: 1.6, front: 18, back: 12, x0: -70, x1: 330, taper: 60, wander: 3 },
  knoll: { dx: 75, dy: -6, rx: 65, ry: 13, height: 1 },
  props: [{ kind: 'tree', dx: 75, dy: -8 }, { kind: 'rock', dx: 45, dy: -4 }, { kind: 'rock', dx: 108, dy: -10 }],
};

const smooth = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

// The hill scene's relief round `spawn`: its bounds, its height in metres
// at any point, and the scenery standing on it.
export function hillRelief(spawn, seed, scene = HILL) {
  const { ridge, knoll } = scene;
  const sx = Math.floor(spawn.x);
  const sy = Math.floor(spawn.y);
  const kx = sx + knoll.dx + 0.5;
  const ky = sy + knoll.dy + 0.5;
  const heightAt = (x, y) => {
    let h = 0;
    const along = x - sx;
    if (along > ridge.x0 && along < ridge.x1) {
      const crest = sy + ridge.dy + ridge.wander * (2 * valueNoise(x * 0.02, 0, seed + 2181) - 1);
      const across = y >= crest ? smooth((crest + ridge.front - y) / ridge.front) : smooth((ridge.back - crest + y) / ridge.back);
      h = ridge.height * across * smooth((along - ridge.x0) / ridge.taper) * smooth((ridge.x1 - along) / ridge.taper);
    }
    const r2 = ((x - kx) / knoll.rx) ** 2 + ((y - ky) / knoll.ry) ** 2;
    return Math.max(h, knoll.height * smooth(1 - r2));
  };
  const props = scene.props.map((p, k) => {
    const prop = createProp(p.kind, sx + p.dx + 0.5, sy + p.dy + 0.5, { seed: seed + 2200 + k });
    prop.id = `h:${k}`;
    return prop;
  });
  return {
    x0: sx + Math.min(ridge.x0, knoll.dx - knoll.rx) - 1,
    x1: sx + Math.max(ridge.x1, knoll.dx + knoll.rx) + 1,
    y0: sy + ridge.dy - ridge.back - ridge.wander - 1,
    y1: Math.max(sy + ridge.dy + ridge.front + ridge.wander, sy + knoll.dy + knoll.ry) + 1,
    heightAt,
    props,
  };
}

// How many rows the ground cell (x, y) is lifted.
export function liftRows(relief, x, y) {
  if (x < relief.x0 || x > relief.x1 || y < relief.y0 || y > relief.y1) return 0;
  return Math.min(MAX_LIFT, Math.round(relief.heightAt(x + 0.5, y + 0.5) * LIFT_PER_METRE));
}

// A chunk's lift per cell (water and shore are never raised) and the most
// any cell of each row is lifted, or null when the relief misses it.
export function chunkLift(relief, cx, cy, size, type) {
  const x0 = cx * size;
  const y0 = cy * size;
  if (x0 + size <= relief.x0 || x0 > relief.x1 || y0 + size <= relief.y0 || y0 > relief.y1) return null;
  const lift = new Uint8Array(size * size);
  const rows = new Uint8Array(size);
  for (let ly = 0; ly < size; ly++) {
    for (let lx = 0; lx < size; lx++) {
      const i = ly * size + lx;
      if (type[i] <= SHORE) continue;
      lift[i] = liftRows(relief, x0 + lx, y0 + ly);
      if (lift[i] > rows[ly]) rows[ly] = lift[i];
    }
  }
  return { lift, rows };
}

// Brings a chunk's lift at cell `i` in line with its terrain after an edit.
export function reliftCell(relief, c, size, i) {
  const ly = Math.floor(i / size);
  c.lift[i] = c.type[i] <= SHORE ? 0 : liftRows(relief, c.cx * size + i - ly * size, c.cy * size + ly);
  c.liftRows[ly] = Math.max(...c.lift.subarray(ly * size, (ly + 1) * size));
}

// Moonlight on a raised cell `lift` rows up whose neighbour in front is
// lifted `front`: higher ground catches more of it, and a slope falling
// toward the viewer, away from the moon in the north, less.
export const reliefLight = (lift, front) => 1 + lift * 0.025 - Math.max(0, lift - front) * 0.25;
