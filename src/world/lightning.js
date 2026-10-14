import { glyph } from '../render/glyphs.js';
import { reflector } from './reflection.js';
import { Splashes } from './splashes.js';
import { ASPECT, WATER } from './world.js';

export const MAX_BOLTS = 4;
const LIFE = 2.2;
const SPARK = glyph('*');
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

// A return stroke and a weaker second pulse illuminate the same fixed path.
export function lightningPulse(age) {
  if (age < 0 || age > 0.7) return 0;
  if (age < 0.07) return 1;
  if (age < 0.16) return 0.22 * Math.exp(-(age - 0.07) * 6);
  return 0.68 * Math.exp(-Math.max(0, age - 0.23) * 9);
}

function trace(path, branch, cells) {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
    const ch = Math.abs(dx) < Math.abs(dy) * 0.4 ? '|'
      : Math.abs(dy) < Math.abs(dx) * 0.3 ? '-' : dx * dy < 0 ? '/' : '\\';
    for (let j = 0; j <= steps; j++) {
      const x = Math.floor(a.x + dx * j / steps);
      const y = Math.floor(a.y + dy * j / steps);
      cells.set(`${x},${y}`, { x, y, g: glyph(ch), branch });
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
    for (let i = 0; i < branches; i++) {
      const root = path[Math.floor(segments * (0.25 + i * 0.18))];
      const direction = random() < 0.5 ? -1 : 1;
      const run = (5 + random() * 8) / ASPECT;
      const fall = 6 + random() * 8;
      const fork = [root];
      for (let j = 1; j <= 5; j++) {
        fork.push({ x: root.x + direction * run * j / 5 + (random() - 0.5) * 3,
          y: root.y + fall * j / 5 });
      }
      trace(fork, true, cells);
    }
    trace(path, false, cells);
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
        const k = pulse * (c.branch ? 0.55 : 1);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const x = sx + dx;
            const y = sy + dy;
            if (x < 0 || y < 0 || x >= r.cols || y >= r.rows) continue;
            const halo = k / (1 + dx * dx * 0.7 + dy * dy * 2);
            const o = (y * r.cols + x) * 4;
            r.bg[o] += 14 * halo;
            r.bg[o + 1] += 30 * halo;
            r.bg[o + 2] += 55 * halo;
          }
        }
        r.put(sx, sy, c.g, 220 * k, 240 * k, 255 * k);
      }
      if (!bolt.distant && bolt.age < 0.3) {
        const sx = Math.floor(bolt.x) - view.x0;
        const sy = Math.floor(bolt.y) - view.y0;
        r.put(sx, sy, SPARK, 235 * pulse, 245 * pulse, 255 * pulse);
        r.put(sx - 1, sy, glyph('-'), 185 * pulse, 218 * pulse, 255 * pulse);
        r.put(sx + 1, sy, glyph('-'), 185 * pulse, 218 * pulse, 255 * pulse);
      }
    }
  }
}
