import { dg } from '../render/glyphs.js';
import { halo } from './glow.js';
import { reflector } from './reflection.js';
import { Splashes } from './splashes.js';
import { ASPECT, WATER } from './world.js';

export const MAX_BOLTS = 4;
const LIFE = 2.2;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

// A return stroke and a weaker second pulse illuminate the same fixed path.
export function lightningPulse(age) {
  if (age < 0 || age > 0.7) return 0;
  if (age < 0.07) return 1;
  if (age < 0.16) return 0.22 * Math.exp(-(age - 0.07) * 6);
  return 0.68 * Math.exp(-Math.max(0, age - 0.23) * 9);
}

const STEPS = 5;
const BOLT = Array.from({ length: STEPS * STEPS }, (_, i) => dg(`effects.bolt.${Math.floor(i / STEPS)}${i % STEPS}`));
const FLAT = Array.from({ length: 9 }, (_, i) => dg(`effects.boltflat.${Math.floor(i / 3)}${i % 3}`));
const GLOW = dg('effects.halo.4');
const STAR = dg('sparkle.0');
const at = (frac, n) => Math.max(0, Math.min(n - 1, Math.floor(frac * n)));

// Rasterises a jagged path into cells of drawn bolt strokes. Each row the
// path crosses gets a stroke from where it enters the bottom of a cell to
// where it leaves the top, so the cells join into one continuous channel;
// where it runs sideways faster than a column per row, level strokes carry
// it across. `branch` is 0 for the main channel, then 1, 2 for forks.
function trace(path, branch, cells) {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const dy = b.y - a.y;
    if (dy <= 0) continue;
    const xAt = (y) => a.x + (b.x - a.x) * (y - a.y) / dy;
    for (let row = Math.floor(a.y); row <= Math.floor(b.y - 1e-9); row++) {
      const top = Math.max(a.y, row);
      const bottom = Math.min(b.y, row + 1);
      const xTop = xAt(top);
      const xBottom = xAt(bottom);
      const c0 = Math.floor(Math.min(xTop, xBottom));
      const c1 = Math.floor(Math.max(xTop, xBottom));
      if (c0 === c1) {
        const g = BOLT[at(xBottom - c0, STEPS) * STEPS + at(xTop - c0, STEPS)];
        cells.set(`${c0},${row}`, { x: c0, y: row, g, branch: branch > 0, depth: branch });
        continue;
      }
      // Level strokes: the path's height at each column edge, top to bottom.
      const yAt = (x) => top + (bottom - top) * (x - xTop) / (xBottom - xTop);
      const xMin = Math.min(xTop, xBottom);
      const xMax = Math.max(xTop, xBottom);
      for (let c = c0; c <= c1; c++) {
        const left = yAt(Math.max(c, xMin));
        const right = yAt(Math.min(c + 1, xMax));
        const g = FLAT[at(Math.min(1, Math.max(0, left - row)), 3) * 3 + at(Math.min(1, Math.max(0, right - row)), 3)];
        cells.set(`${c},${row}`, { x: c, y: row, g, branch: branch > 0, depth: branch });
      }
    }
  }
}

export class Lightning {
  constructor({ random = Math.random, onImpact } = {}) {
    this.random = random;
    this.onImpact = onImpact;
    this.bolts = [];
  }

  get flash() {
    return this.bolts.reduce((brightest, b) => Math.max(brightest,
      lightningPulse(b.age) * b.strength * (b.distant ? 0.06 : 0.18)), 0);
  }

  clearAutomatic() {
    this.bolts = this.bolts.filter(b => b.manual);
  }

  strike(world, view, { x, y, strength = 1, distant = false, manual = false, bearing } = {}) {
    if (!(view.cols > 0 && view.rows > 0) || !Number.isFinite(strength) || strength <= 0) return null;
    const random = this.random;
    x = Number.isFinite(x) ? x : Number.isFinite(bearing)
      ? clamp(view.x0 + view.cols / 2 + bearing * 24 / ASPECT, view.x0 + 2, view.x0 + view.cols - 2)
      : view.x0 + view.cols * (0.2 + random() * 0.6);
    y = Number.isFinite(y) ? y : view.y0 + view.rows * (distant ? 0.18 + random() * 0.15 : 0.65 + random() * 0.25);
    const height = distant ? Math.min(32, Math.max(16, view.rows * 0.4))
      : clamp(y - view.y0 + 8, 24, 120);
    const start = x + (random() - 0.5) * height * 0.3 / ASPECT;
    const segments = Math.ceil(height / 3);
    const path = [];
    for (let i = 0; i <= segments; i++) {
      const u = i / segments;
      path.push({ x: start + (x - start) * u + (random() - 0.5) * 9 / ASPECT * Math.sin(u * Math.PI),
        y: y - height + u * height });
    }
    const cells = new Map();
    const branches = distant ? 1 : 3;
    // Forks leave the channel and wander down and away; the nearer ones
    // split again into finer twigs of light.
    const fork = (root, direction, run, fall, depth) => {
      const points = [root];
      const n = depth === 1 ? 5 : 3;
      for (let j = 1; j <= n; j++) {
        points.push({ x: root.x + direction * run * j / n + (random() - 0.5) * 3 / depth,
          y: root.y + fall * j / n });
      }
      trace(points, depth, cells);
      if (depth === 1 && !distant) {
        const twig = points[1 + Math.floor(random() * (n - 1))];
        fork(twig, random() < 0.6 ? direction : -direction, run * 0.5, fall * 0.5, 2);
      }
    };
    for (let i = 0; i < branches; i++) {
      const root = path[Math.floor(segments * (0.25 + i * 0.18))];
      fork(root, random() < 0.5 ? -1 : 1, (5 + random() * 8) / ASPECT, 6 + random() * 8, 1);
    }
    trace(path, 0, cells);
    const bolt = { x, y, height, strength: Math.min(1, strength), distant, manual, age: 0,
      cells: [...cells.values()], splashes: new Splashes(), fire: null };
    // Distant flashes stay in the sky. Nearby lake strikes throw up a plume.
    if (!distant) {
      if (world.typeAt(x, y) === WATER) {
        bolt.splashes.react(world, { type: 'slam', x, y, strength: bolt.strength });
      } else {
        bolt.fire = this.onImpact?.(world, bolt) ?? null;
      }
    }
    this.bolts.push(bolt);
    if (this.bolts.length > MAX_BOLTS) this.bolts.shift();
    return bolt;
  }

  update(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    for (const bolt of this.bolts) {
      bolt.age += dt;
      bolt.splashes.update(dt);
    }
    this.bolts = this.bolts.filter(b => b.age < LIFE);
  }

  drawSurface(r, view, time) {
    const mirror = reflector(time, view);
    for (const bolt of this.bolts) {
      const pulse = lightningPulse(bolt.age) * bolt.strength;
      if (pulse > 0.025) {
        const base = Math.floor(bolt.y) - view.y0;
        for (const c of bolt.cells) {
          const k = pulse * (c.branch ? 0.55 : 1);
          mirror(r, c.x - view.x0, c.y - view.y0, c.g, 220 * k, 240 * k, 255 * k, base);
        }
      }
      bolt.splashes.drawSurface(r, view, time);
    }
  }

  light(r, view) {
    for (const bolt of this.bolts) {
      const pulse = lightningPulse(bolt.age) * bolt.strength;
      if (bolt.distant || pulse < 0.025) continue;
      const radius = 16 + bolt.strength * 6;
      const bx = Math.floor(bolt.x) - view.x0;
      const by = Math.floor(bolt.y) - view.y0;
      for (let sy = Math.max(0, by - 12); sy <= Math.min(r.rows - 1, by + 12); sy++) {
        for (let sx = Math.max(0, bx - 38); sx <= Math.min(r.cols - 1, bx + 38); sx++) {
          const d = Math.hypot((sx - bx) * ASPECT, (sy - by) * 2);
          if (d >= radius) continue;
          const k = (1 - d / radius) ** 2 * pulse;
          const o = (sy * r.cols + sx) * 4;
          r.fg[o] += 55 * k;
          r.fg[o + 1] += 95 * k;
          r.fg[o + 2] += 145 * k;
          r.ov[o] += 55 * k;
          r.ov[o + 1] += 95 * k;
          r.ov[o + 2] += 145 * k;
          if (r.fineMark?.[o >> 2]) r.lightFine(o >> 2, 55 * k, 95 * k, 145 * k);
          r.bg[o] += 14 * k;
          r.bg[o + 1] += 27 * k;
          r.bg[o + 2] += 48 * k;
        }
      }
    }
  }

  draw(r, view) {
    for (const bolt of this.bolts) {
      bolt.splashes.drawSpray(r, view);
      const pulse = lightningPulse(bolt.age) * (0.5 + bolt.strength * 0.5);
      if (pulse < 0.025) continue;
      for (const c of bolt.cells) {
        const sx = c.x - view.x0;
        const sy = c.y - view.y0;
        if (sx < 0 || sy < 0 || sx >= r.cols || sy >= r.rows) continue;
        const k = pulse * (c.depth === 2 ? 0.38 : c.branch ? 0.6 : 1);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const x = sx + dx;
            const y = sy + dy;
            if (x < 0 || y < 0 || x >= r.cols || y >= r.rows) continue;
            const glow = k / (1 + dx * dx * 0.7 + dy * dy * 2);
            const o = (y * r.cols + x) * 4;
            r.bg[o] += 14 * glow;
            r.bg[o + 1] += 30 * glow;
            r.bg[o + 2] += 55 * glow;
          }
        }
        // A soft violet-blue glow under a white-hot core.
        const o = (sy * r.cols + sx) * 4;
        r.put(sx, sy, GLOW, r.bg[o] + 90 * k, r.bg[o + 1] + 120 * k, r.bg[o + 2] + 200 * k);
        r.layer(sx, sy, c.g, 220 * k + 35, 240 * k + 15, 255 * k);
      }
      if (!bolt.distant && bolt.age < 0.3) {
        // The strike point flares in a starburst and a halo of light.
        const sx = Math.floor(bolt.x) - view.x0;
        const sy = Math.floor(bolt.y) - view.y0;
        if (r.layer && r.ov) halo(r, sx, sy, pulse * 1.2, 120, 160, 230);
        r.put(sx, sy, STAR, 235 * pulse, 245 * pulse, 255 * pulse);
      }
    }
  }
}
