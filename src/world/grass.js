import { valueNoise } from '../core/noise.js';
import { SCALE, TILT } from '../entities/rig.js';
import { putCell } from '../render/cells.js';
import { glyph } from '../render/glyphs.js';
import { ASPECT, CHUNK_SIZE, WATER } from './world.js';

export const MAX_GRASS_HEIGHT = 12;
const SIDE_PAD = 6;
const RADIUS = 3.2;
const HOLD = 0.25;
const LIFE = 2;
const MAX_BENDS = 1024;
const DENSITY = 0.82;
const STEM = glyph('|');
const LEFT = glyph('\\');
const RIGHT = glyph('/');
const SEED_HEAD = glyph('"');

// One gust per rooted blade: upper segments follow the same wave as the base.
export function grassWind(x, y, t, seed, rnd) {
  return (valueNoise(x * ASPECT * 0.035 - t * 0.18, y * 0.035 + t * 0.04,
    seed + 900) - 0.42) * 2.4 + Math.sin(t * 2.6 + rnd * 40) * 0.1;
}

export class Grass {
  constructor() {
    this.bends = new Map();
    this.previous = null;
  }

  bendAt(x, y, t) {
    const bend = this.bends.get(`${x},${y}`);
    if (!bend || t - bend.t >= LIFE) return 0;
    // A short hold followed by a smooth, critically damped spring-back.
    const age = Math.max(0, t - bend.t - HOLD);
    return bend.lean * (1 + age * 7) * Math.exp(-age * 7);
  }

  update(world, player, t) {
    for (const [key, bend] of this.bends) {
      if (t - bend.t >= LIFE) this.bends.delete(key);
    }
    const prev = this.previous;
    this.previous = { x: player.x, y: player.y, air: player.air, t };
    if (player.air > 0) return;

    // Sweep actual grounded movement, but never leave a trail across a jump
    // or a debug teleport. The margin allows the game's fastest running step.
    const elapsed = prev ? Math.max(0, t - prev.t) : 0;
    const sweep = prev && !prev.air && Math.hypot((player.x - prev.x) * ASPECT / SCALE,
      (player.y - prev.y) / (SCALE * TILT)) <= 3.5 * Math.min(elapsed, 0.1) + 0.05;
    const ax = sweep ? prev.x : player.x;
    const ay = sweep ? prev.y : player.y;
    const dx = (player.x - ax) * ASPECT;
    const dy = player.y - ay;
    const length2 = dx * dx + dy * dy;
    for (let y = Math.floor(Math.min(ay, player.y) - RADIUS);
      y <= Math.ceil(Math.max(ay, player.y) + RADIUS); y++) {
      for (let x = Math.floor(Math.min(ax, player.x) - RADIUS / ASPECT);
        x <= Math.ceil(Math.max(ax, player.x) + RADIUS / ASPECT); x++) {
        const { c, i } = world.locate(x, y);
        if (!c.grassHeight[i]) continue;
        const px = (x + 0.5 - ax) * ASPECT;
        const py = y + 0.5 - ay;
        const u = length2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / length2)) : 0;
        const side = px - u * dx;
        const distance2 = side * side + (py - u * dy) ** 2;
        if (distance2 >= RADIUS * RADIUS) continue;
        const lean = (Math.sign(side) || (c.rnd[i] < 0.5 ? -1 : 1)) *
          (1 - distance2 / (RADIUS * RADIUS));
        const key = `${x},${y}`;
        // Refresh insertion order too, so the oldest contact is evicted first.
        this.bends.delete(key);
        this.bends.set(key, { lean, t });
        if (this.bends.size > MAX_BENDS) this.bends.delete(this.bends.keys().next().value);
      }
    }
  }

  drawRow(r, world, view, t, y, write = putCell) {
    const cy = Math.floor(y / CHUNK_SIZE);
    let chunk = null;
    let lastCx;
    for (let x = view.x0 - SIDE_PAD; x < view.x0 + view.cols + SIDE_PAD; x++) {
      const cx = Math.floor(x / CHUNK_SIZE);
      if (!chunk || cx !== lastCx) {
        chunk = world.chunk(cx, cy);
        lastCx = cx;
      }
      const i = (y - cy * CHUNK_SIZE) * CHUNK_SIZE + x - cx * CHUNK_SIZE;
      const height = chunk.grassHeight[i];
      const rnd = chunk.rnd[i];
      if (height < 2 || rnd < DENSITY) continue;
      const bend = this.bendAt(x, y, t);
      const wind = grassWind(x, y, t, world.seed, rnd);
      const lean = Math.max(-4, Math.min(4, wind * Math.min(2.3, height * 0.24) +
        bend * Math.min(3.3, height * 0.7)));
      const rows = Math.max(2, height - Math.floor(Math.abs(bend) * height * 0.25));
      const base = y - view.y0;
      const reed = chunk.reeds[i];
      const light = 0.48 + chunk.shade[i] * 0.65 + Math.max(0, wind) * 0.1;
      let offset = 0;
      for (let k = 0; k < rows; k++) {
        const u = k / (rows - 1);
        const next = Math.max(offset - 1, Math.min(offset + 1, Math.round(lean * u * u)));
        let ch = next < offset ? LEFT : next > offset ? RIGHT : STEM;
        if (k === rows - 1) ch = reed ? SEED_HEAD : lean < 0 ? LEFT : RIGHT;
        const l = light * (0.55 + u * 0.6);
        write(r, x - view.x0 + next, base - k, ch,
          (reed ? 106 : 58) * l, (reed ? 134 : 142) * l, (reed ? 72 : 76) * l, base);
        if (!reed && height >= 7 && rnd > 0.9 && k === rows - 3) {
          const side = rnd < 0.95 ? -1 : 1;
          write(r, x - view.x0 + next + side, base - k, side < 0 ? LEFT : RIGHT,
            58 * l, 142 * l, 76 * l, base);
        }
        offset = next;
      }
    }
  }

  drawReflections(r, world, view, t, write, drawables = []) {
    if (!r.mask.includes(WATER)) return;
    this.drawRows(r, world, view, t, view.y0 - MAX_GRASS_HEIGHT - 1,
      view.y0 + view.rows, drawables, write);
  }

  // Interleave root rows with the existing small list of sorted sprites.
  // This avoids allocating and sorting a drawable for every meadow blade.
  drawLayered(r, world, view, t, drawables) {
    this.drawRows(r, world, view, t, view.y0,
      view.y0 + view.rows + MAX_GRASS_HEIGHT, drawables, putCell);
  }

  drawRows(r, world, view, t, first, last, drawables, write) {
    let i = 0;
    for (let y = first; y < last; y++) {
      while (i < drawables.length && drawables[i].y <= y + 0.5) drawables[i++].draw();
      this.drawRow(r, world, view, t, y, write);
    }
    while (i < drawables.length) drawables[i++].draw();
  }
}
