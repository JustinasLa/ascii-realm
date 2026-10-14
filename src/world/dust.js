import { dg, over } from '../render/glyphs.js';
import { ASPECT, DIRT, GRASS, SHORE, STONE } from './world.js';

// Little bursts kicked up by the wanderer: puffs of dust from footsteps and
// landings with grit and pebbles skittering out of them, and clipped bits
// of blade when running through the meadow. Positions are in world cells;
// `h` is height above the ground in rows. Everything is layered over the
// cell it passes, so the ground and grass stay visible underneath.

const names = (prefix, n) => Array.from({ length: n }, (_, i) => dg(`${prefix}.${i}`));
const PUFF = names('effects.puff', 5).map(over);
const CLIP = names('effects.clip', 8).map(over);
const PEBBLE = names('pebble', 8).map(over);
const GRIT = names('speck', 8).map(over);
const SPARK = names('effects.spark', 8).map(over);
const VAPOUR = names('effects.wisp', 4).map(over);
// Puffs swell and thin; motes of grit stay the same; sparks and clips turn.
const SWELL = 0;
const STILL = 1;
const HEADING = 2;
const SPIN = 3;
export const MAX_DUST = 360;

const DUST_COLORS = {
  [DIRT]: [150, 118, 80],
  [SHORE]: [124, 124, 112],
  [STONE]: [128, 130, 138],
  [GRASS]: [96, 104, 84],
};

export class Dust {
  constructor() {
    this.list = [];
  }

  // A burst of `n` puffs at a point, spreading at up to `speed` rows/s.
  burst(world, x, y, n, speed) {
    const type = world.typeAt(x, y);
    const color = DUST_COLORS[type];
    if (!color) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.6);
      const life = 0.45 + Math.random() * 0.5;
      this.list.push({
        x: x + Math.cos(a) * 0.5 / ASPECT,
        y: y + Math.sin(a) * 0.3,
        h: 0.2,
        vx: (Math.cos(a) * v) / ASPECT,
        vy: Math.sin(a) * v * 0.45,
        vh: 1 + Math.random() * 2,
        g: 3,
        life,
        max: life,
        color,
        glyphs: PUFF,
        mode: SWELL,
      });
    }
    // Grit and small stones skip out of the puff on bare ground, bouncing
    // once before they settle; fine motes hang a moment longer.
    if (type !== GRASS) {
      const stones = Math.round(n * 0.6 + speed * 0.12);
      for (let i = 0; i < stones; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = speed * (0.6 + Math.random() * 0.8);
        const pebble = Math.random() < 0.35;
        const life = pebble ? 0.7 + Math.random() * 0.4 : 0.9 + Math.random() * 0.9;
        const shade = 0.75 + Math.random() * 0.35;
        this.list.push({
          x, y, h: 0.3,
          vx: (Math.cos(a) * v) / ASPECT,
          vy: Math.sin(a) * v * 0.4,
          vh: pebble ? 3 + Math.random() * 4 : 0.8 + Math.random() * 1.6,
          g: pebble ? 30 : 1.5,
          bounce: pebble,
          life,
          max: life,
          color: color.map((c) => c * shade),
          glyphs: pebble ? PEBBLE : GRIT,
          mode: STILL,
          pick: Math.floor(Math.random() * 8),
        });
      }
    }
    // Running through grass flicks up bits of blade as well.
    if (type === GRASS) {
      for (let i = 0; i < n * 1.5; i++) {
        const life = 0.45 + Math.random() * 0.35;
        this.list.push({
          x: x + (Math.random() - 0.5) / ASPECT,
          y,
          h: 0.3,
          vx: ((Math.random() - 0.5) * speed) / ASPECT,
          vy: (Math.random() - 0.5) * speed * 0.3,
          vh: 4 + Math.random() * 4,
          g: 22,
          life,
          max: life,
          color: [70 + Math.random() * 30, 140 + Math.random() * 40, 70],
          glyphs: CLIP,
          mode: SPIN,
          pick: Math.floor(Math.random() * 8),
          spin: (Math.random() - 0.5) * 40,
        });
      }
    }
    this.trim();
  }

  // Bright sparks struck from the ground by steel; they streak out, arc
  // and die quickly.
  sparks(x, y, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 6 + Math.random() * 10;
      const life = 0.25 + Math.random() * 0.3;
      this.list.push({
        x,
        y,
        h: 0.5,
        vx: (Math.cos(a) * v) / ASPECT,
        vy: Math.sin(a) * v * 0.35,
        vh: 6 + Math.random() * 9,
        g: 40,
        life,
        max: life,
        color: [255, 220 + Math.random() * 35, 140 + Math.random() * 80],
        glyphs: SPARK,
        mode: HEADING,
      });
    }
    this.trim();
  }

  // A breath fogging in the cold night air: a few pale curls from the mouth
  // that drift the way the wanderer faces, rise and loosen away. `h` is the
  // height of the mouth in rows; dx, dy the facing direction.
  breath(x, y, h, dx, dy) {
    for (let i = 0; i < 6; i++) {
      const life = 0.7 + Math.random() * 0.6;
      this.list.push({
        x: x + (Math.random() - 0.5) * 0.6,
        y,
        h: h + (Math.random() - 0.5) * 0.4,
        vx: (dx * (2 + Math.random() * 2)) / ASPECT,
        vy: dy * (1 + Math.random()),
        vh: 0.6 + Math.random() * 0.8,
        g: -0.4,
        life,
        max: life,
        color: [190, 200, 215],
        glyphs: VAPOUR,
        mode: SWELL,
      });
    }
    this.trim();
  }

  trim() {
    if (this.list.length > MAX_DUST) this.list.splice(0, this.list.length - MAX_DUST);
  }

  update(dt) {
    const drag = Math.exp(-4 * dt);
    for (const p of this.list) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.h += p.vh * dt;
      p.vh -= p.g * dt;
      if (p.h < 0) {
        p.h = 0;
        // A pebble skips once, then lies still.
        if (p.bounce && p.vh < -2) { p.vh *= -0.35; p.vx *= 0.5; p.vy *= 0.5; } else { p.vh = 0; p.vx *= 0.3; p.vy *= 0.3; }
      }
      p.vx *= drag;
      p.vy *= drag;
      if (p.spin) p.pick += p.spin * dt;
      p.life -= dt;
    }
    this.list = this.list.filter((p) => p.life > 0);
  }

  draw(r, view) {
    for (const p of this.list) {
      const t = p.life / p.max;
      const sx = Math.floor(p.x) - view.x0;
      const sy = Math.floor(p.y - p.h) - view.y0;
      if (sx < 0 || sy < 0 || sx >= r.cols || sy >= r.rows) continue;
      let g;
      let k = 0.35 + 0.65 * t;
      if (p.mode === SWELL) {
        g = p.glyphs[Math.min(p.glyphs.length - 1, Math.floor((1 - t) * p.glyphs.length))];
        k = 0.5 + 0.5 * t;
      } else if (p.mode === HEADING) {
        const a = Math.atan2(p.vy - p.vh, p.vx * ASPECT);
        g = p.glyphs[Math.round(a / (Math.PI * 2) * 8 + 8) % 8];
      } else {
        g = p.glyphs[(Math.floor(p.pick) % 8 + 8) % 8];
        if (p.mode === STILL) k = Math.min(1, t * 2.5);
      }
      // Fade from the colour of the ground so a dying mote never darkens it.
      const o = (sy * r.cols + sx) * 4;
      r.layer(sx, sy, g, r.bg[o] + (p.color[0] - r.bg[o]) * k,
        r.bg[o + 1] + (p.color[1] - r.bg[o + 1]) * k, r.bg[o + 2] + (p.color[2] - r.bg[o + 2]) * k);
    }
  }
}
