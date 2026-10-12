import { glyph } from '../render/glyphs.js';
import { ASPECT, DIRT, GRASS, SHORE, STONE } from './world.js';

// Little bursts kicked up by the warrior: puffs of dust from footsteps and
// landings, and flecks of grass when running through the meadow. Positions
// are in world cells; `h` is height above the ground in rows.

const PUFF = [...'.:oO°'].map(glyph);
const FLECK = [...`',\`"`].map(glyph);
const SPARK = [...`*+'.`].map(glyph);

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

  // A burst of `n` motes at a point, spreading at up to `speed` rows/s.
  burst(world, x, y, n, speed) {
    const type = world.typeAt(x, y);
    const color = DUST_COLORS[type];
    if (!color) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.6);
      const life = 0.35 + Math.random() * 0.45;
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
      });
    }
    // Running through grass flicks up bits of blade as well.
    if (type === GRASS) {
      for (let i = 0; i < n; i++) {
        const life = 0.4 + Math.random() * 0.3;
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
          glyphs: FLECK,
        });
      }
    }
  }

  // Bright sparks struck from the ground by steel; they arc up, fall and
  // die out quickly.
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
      });
    }
  }

  update(dt) {
    const drag = Math.exp(-4 * dt);
    for (const p of this.list) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.h = Math.max(0, p.h + p.vh * dt);
      p.vh -= p.g * dt;
      p.vx *= drag;
      p.vy *= drag;
      p.life -= dt;
    }
    this.list = this.list.filter((p) => p.life > 0);
  }

  draw(r, view) {
    for (const p of this.list) {
      const t = p.life / p.max;
      const sx = Math.floor(p.x) - view.x0;
      const sy = Math.floor(p.y - p.h) - view.y0;
      // Puffs swell and thin out as they fade.
      const g = p.glyphs[Math.min(p.glyphs.length - 1, Math.floor((1 - t) * p.glyphs.length))];
      const k = 0.35 + 0.65 * t;
      r.put(sx, sy, g, p.color[0] * k, p.color[1] * k, p.color[2] * k);
    }
  }
}
