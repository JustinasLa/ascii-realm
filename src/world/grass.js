import { valueNoise } from '../core/noise.js';
import { hash2 } from '../core/rng.js';
import { SCALE, TILT } from '../entities/rig.js';
import { putCell } from '../render/cells.js';
import { glyph } from '../render/glyphs.js';
import { ASPECT, CHUNK_SIZE, WATER } from './world.js';

export const MAX_GRASS_HEIGHT = 5;
const SIDE_PAD = 6;
const RADIUS = 4.2;
const HOLD = 0.25;
const LIFE = 2;
const MAX_BENDS = 1024;
const STEM = glyph('|');
const LEFT = glyph('\\');
const RIGHT = glyph('/');
const SEED_HEAD = glyph('"');
const FLAT = glyph('-');

// One gust per rooted blade: upper segments follow the same wave as the base.
export function grassWind(x, y, t, seed, rnd) {
  return (valueNoise(x * ASPECT * 0.035 - t * 0.18, y * 0.035 + t * 0.04,
    seed + 900) - 0.42) * 2.4 + Math.sin(t * 2.6 + rnd * 40) * 0.1;
}

export class Grass {
  constructor() {
    this.bends = new Map();
    this.previous = null;
    this.previousSword = null;
  }

  bendAt(x, y, t) {
    return this.effectAt(x, y, t, 'lean');
  }

  pressAt(x, y, t) {
    return this.effectAt(x, y, t, 'press');
  }

  effectAt(x, y, t, field) {
    const bend = this.bends.get(`${x},${y}`);
    if (!bend || t - bend.t >= LIFE) return 0;
    // A short hold followed by a smooth, critically damped spring-back.
    const age = Math.max(0, t - bend.t - HOLD);
    return (bend[field] || 0) * (1 + age * 5) * Math.exp(-age * 5);
  }

  update(world, player, t) {
    for (const [key, bend] of this.bends) {
      if (t - bend.t >= LIFE) this.bends.delete(key);
    }
    const prev = this.previous;
    this.previous = { x: player.x, y: player.y, air: player.air, t };
    // A sword wake follows the animated blade's swept ground footprint,
    // including the strip between frames. Idle/drawn swords produce no wake.
    const sword = player.swordSweep;
    const lastSword = this.previousSword;
    this.previousSword = sword;
    if (sword && player.air < 0.25 && (!lastSword || sword.t !== lastSword.t)) {
      this.disturb(world, sword.hx, sword.hy, sword.tx, sword.ty, 2.4, t, 0, 1);
      if (lastSword && sword.t - lastSword.t < 0.12 &&
        Math.hypot((sword.hx - lastSword.hx) * ASPECT, sword.hy - lastSword.hy) < 8) {
        const push = Math.sign(sword.tx - lastSword.tx);
        for (let i = 0; i <= 4; i++) {
          const u = i / 4;
          this.disturb(world,
            lastSword.hx + (lastSword.tx - lastSword.hx) * u,
            lastSword.hy + (lastSword.ty - lastSword.hy) * u,
            sword.hx + (sword.tx - sword.hx) * u,
            sword.hy + (sword.ty - sword.hy) * u, 2.4, t, push, 1);
        }
      }
    }
    if (player.air > 0) return;

    // Sweep actual grounded movement, but never leave a trail across a jump
    // or a debug teleport. The margin allows the game's fastest running step.
    const elapsed = prev ? Math.max(0, t - prev.t) : 0;
    const sweep = prev && !prev.air && Math.hypot((player.x - prev.x) * ASPECT / SCALE,
      (player.y - prev.y) / (SCALE * TILT)) <= 3.5 * Math.min(elapsed, 0.1) + 0.05;
    const ax = sweep ? prev.x : player.x;
    const ay = sweep ? prev.y : player.y;
    const distance = Math.hypot((player.x - ax) * ASPECT, player.y - ay);
    const moving = distance > 0.01;
    this.disturb(world, ax, ay, player.x, player.y, RADIUS, t,
      moving ? (player.x - ax) * ASPECT / distance * 0.45 : 0, moving ? 1 : 0.8);
  }

  disturb(world, ax, ay, bx, by, radius, t, push, strength) {
    const dx = (bx - ax) * ASPECT;
    const dy = by - ay;
    const length2 = dx * dx + dy * dy;
    for (let y = Math.floor(Math.min(ay, by) - radius);
      y <= Math.ceil(Math.max(ay, by) + radius); y++) {
      for (let x = Math.floor(Math.min(ax, bx) - radius / ASPECT);
        x <= Math.ceil(Math.max(ax, bx) + radius / ASPECT); x++) {
        const { c, i } = world.locate(x, y);
        if (!c.grassHeight[i]) continue;
        const px = (x + 0.5 - ax) * ASPECT;
        const py = y + 0.5 - ay;
        const u = length2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / length2)) : 0;
        const side = px - u * dx;
        const distance2 = side * side + (py - u * dy) ** 2;
        if (distance2 >= radius * radius) continue;
        const press = Math.sqrt(1 - distance2 / (radius * radius)) * strength;
        const lean = ((Math.sign(side) || (c.rnd[i] < 0.5 ? -1 : 1)) + push) * press;
        const key = `${x},${y}`;
        const old = this.bends.get(key);
        // Several blade segments may touch a root in one frame. Keep the
        // strongest contact, rather than overwriting it with a distant edge.
        if (old?.t === t && old.press > press) continue;
        // Refresh insertion order too, so the oldest contact is evicted first.
        this.bends.delete(key);
        this.bends.set(key, { lean, press, t });
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
      const rnd = chunk.rnd[i];
      const profile = chunk.grassHeight[i];
      if (profile < 2 || rnd < 1 - (chunk.grassDensity?.[i] ?? 0.26)) continue;
      const height = Math.min(MAX_GRASS_HEIGHT,
        Math.floor(profile + hash2(x, y, world.seed + 1101)));
      const bend = this.bendAt(x, y, t);
      const press = this.pressAt(x, y, t);
      const wind = grassWind(x, y, t, world.seed, rnd);
      const lean = Math.max(-4, Math.min(4, wind * Math.min(1.3, height * 0.35) + bend * 2.8));
      const rise = (height - 1) * (1 - Math.min(1, press) * 0.8);
      const base = y - view.y0;
      const reed = chunk.reeds[i];
      const light = 0.48 + chunk.shade[i] * 0.65 + Math.max(0, wind) * 0.1;
      // Sample the curved stalk densely enough to keep horizontal, flattened
      // grass connected too. A two-row blade can now lie several cells wide.
      const steps = Math.ceil(height + Math.abs(lean) * 2);
      let lastX = 0;
      let lastY = 0;
      for (let k = 0; k <= steps; k++) {
        const u = k / steps;
        const offset = Math.round(lean * u * u);
        const sy = base - Math.round(rise * u);
        if (k && offset === lastX && sy === lastY && k !== steps) continue;
        let ch = k && sy === lastY && offset !== lastX ? FLAT :
          offset < lastX ? LEFT : offset > lastX ? RIGHT : STEM;
        if (k === steps) ch = press > 0.6 ? FLAT : reed ? SEED_HEAD : lean < 0 ? LEFT : RIGHT;
        const l = light * (0.55 + u * 0.6);
        write(r, x - view.x0 + offset, sy, ch,
          (reed ? 106 : 58) * l, (reed ? 134 : 142) * l, (reed ? 72 : 76) * l, base);
        lastX = offset;
        lastY = sy;
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
