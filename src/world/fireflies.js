import { valueNoise } from '../core/noise.js';
import { glyph } from '../render/glyphs.js';
import { ASPECT, GRASS } from './world.js';

const BODY = [glyph('.'), glyph('*'), glyph('o')];
const COUNT = 60;

// Little lights that wander over the meadow around the camera and pulse on
// and off. Each one also tints the cells around it to fake a glow.
export class Fireflies {
  constructor() {
    this.list = [];
  }

  update(dt, t, world, cx, cy, halfW, halfH) {
    while (this.list.length < COUNT) this.list.push(this.spawn(world, cx, cy, halfW, halfH));
    for (let i = 0; i < this.list.length; i++) {
      const f = this.list[i];
      // Drift along a slowly changing noise field, each on its own track.
      const ax = valueNoise(f.seed, t * 0.25, 11) - 0.5;
      const ay = valueNoise(f.seed + 50, t * 0.25, 12) - 0.5;
      f.x += (ax * 6 * dt) / ASPECT;
      f.y += ay * 6 * dt;
      if (Math.abs(f.x - cx) > halfW * 1.3 || Math.abs(f.y - cy) > halfH * 1.3) {
        this.list[i] = this.spawn(world, cx, cy, halfW, halfH);
      }
    }
  }

  spawn(world, cx, cy, halfW, halfH) {
    for (let tries = 0; tries < 8; tries++) {
      const x = cx + (Math.random() * 2 - 1) * halfW;
      const y = cy + (Math.random() * 2 - 1) * halfH;
      if (world.typeAt(x, y) === GRASS) {
        return { x, y, seed: Math.random() * 1000, phase: Math.random() * Math.PI * 2 };
      }
    }
    return { x: cx, y: cy - halfH * 2, seed: Math.random() * 1000, phase: 0 };
  }

  draw(r, view, t) {
    const { fg, bg, cols } = r;
    for (const f of this.list) {
      const pulse = Math.max(0, Math.sin(t * 1.4 + f.phase));
      const b = pulse * pulse;
      if (b < 0.05) continue;
      const sx = Math.floor(f.x) - view.x0;
      const sy = Math.floor(f.y) - view.y0;

      // Halo: lift the neighbouring cells toward a warm green.
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const x = sx + dx;
          const y = sy + dy;
          if (x < 0 || y < 0 || x >= view.cols || y >= view.rows) continue;
          const k = b * 0.5 / (1 + dx * dx * 0.5 + dy * dy);
          const o = (y * cols + x) * 4;
          fg[o] += 120 * k;
          fg[o + 1] += 160 * k;
          fg[o + 2] += 80 * k;
          bg[o] += 18 * k;
          bg[o + 1] += 26 * k;
          bg[o + 2] += 10 * k;
        }
      }
      r.put(sx, sy, BODY[Math.min(2, Math.floor(b * 3))], 200 + 55 * b, 255, 160 + 60 * b);
    }
  }
}
