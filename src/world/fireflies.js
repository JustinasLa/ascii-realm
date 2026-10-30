import { valueNoise } from '../core/noise.js';
import { dg } from '../render/glyphs.js';
import { halo, lighten, subGlyph } from './glow.js';
import { ASPECT, GRASS } from './world.js';

const BODY = Array.from({ length: 9 }, (_, i) => dg(`effects.fly.${i}`));
// How many fireflies per screen cell, so the meadow looks equally busy at
// every zoom level.
const DENSITY = 1 / 260;
const SPAWN_RETRY = 1;
const RETRY_DISTANCE = 8;
// Fireflies wake one by one as the firefly hours come (the sky's
// `fireflies`, 0..1): each at its own point of them, over this much more.
export const WAKE_BAND = 0.1;
// A firefly that takes another's place fades in over this many seconds.
export const FADE_IN = 1.5;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// A firefly's signal: a quick rise and a slower fade, once or twice in a
// row, then dark for the rest of its own period. Returns 0..1.
export function fireflyFlash(f, t) {
  const period = f.period ?? 3;
  const p = ((t + f.phase) % period + period) % period;
  const pulse = (s) => (s < 0 ? 0 : s < 0.09 ? s / 0.09 : Math.exp(-(s - 0.09) * 4.5));
  let b = pulse(p);
  if (f.double) b = Math.max(b, pulse(p - 0.55) * 0.85);
  return b < 0.02 ? 0 : b;
}

// Little lights that wander over the meadow around the camera and signal
// in their own rhythm. Each glows through a soft halo and lights the grass
// beneath it.
export class Fireflies {
  constructor() {
    this.list = [];
    // How far into the firefly hours it is, and where the camera was last.
    this.presence = 1;
    this.cx = null;
    this.cy = 0;
  }

  // `presence` is the sky's `fireflies`: at 0 none is awake.
  update(dt, t, world, cx, cy, halfW, halfH, presence = 1) {
    // On the first frame, or when the camera jumps to a new place, the whole
    // swarm is new to the eye and shows at once; otherwise a newcomer fades in.
    this.fresh = this.cx === null || Math.abs(cx - this.cx) > halfW || Math.abs(cy - this.cy) > halfH;
    this.cx = cx;
    this.cy = cy;
    this.presence = presence;
    const count = Math.round(4 * halfW * halfH * DENSITY);
    while (this.list.length < count) this.list.push(this.spawn(world, cx, cy, halfW, halfH, t));
    if (this.list.length > count) this.list.length = count;
    if (presence <= 0) {
      for (const f of this.list) f.lit = 0;
      return;
    }
    for (let i = 0; i < this.list.length; i++) {
      const f = this.list[i];
      if (f.retryAt !== undefined) {
        // Keep failed slots dormant on barren terrain, but retry sooner when
        // the camera has moved far enough to reveal a new patch of ground.
        const dx = (cx - f.x) * ASPECT;
        const dy = cy - f.y;
        if (t >= f.retryAt || dx * dx + dy * dy >= RETRY_DISTANCE * RETRY_DISTANCE) {
          this.list[i] = this.spawn(world, cx, cy, halfW, halfH, t);
        }
        continue;
      }
      f.fade = Math.min(1, (f.fade ?? 1) + dt / FADE_IN);
      f.lit = Math.min(clamp01((presence - (f.wake ?? 0)) / WAKE_BAND), f.fade);
      // Drift along a slowly changing noise field, each on its own track,
      // bobbing up and down over the grass.
      const ax = valueNoise(f.seed, t * 0.25, 11) - 0.5;
      const ay = valueNoise(f.seed + 50, t * 0.25, 12) - 0.5;
      f.x += (ax * 6 * dt) / ASPECT;
      f.y += ay * 6 * dt;
      f.h = 1.2 + valueNoise(f.seed + 90, t * 0.4, 13) * 3.2;
      if (Math.abs(f.x - cx) > halfW * 1.3 || Math.abs(f.y - cy) > halfH * 1.3) {
        this.list[i] = this.spawn(world, cx, cy, halfW, halfH, t);
      }
    }
  }

  spawn(world, cx, cy, halfW, halfH, t) {
    for (let tries = 0; tries < 8; tries++) {
      const x = cx + (Math.random() * 2 - 1) * halfW;
      const y = cy + (Math.random() * 2 - 1) * halfH;
      if (world.typeAt(x, y) === GRASS) {
        const seed = Math.random() * 1000;
        // Its point in the firefly hours, from its seed: no more random draws.
        return { x, y, h: 2, seed, phase: Math.random() * 6, period: 2.2 + Math.random() * 2.6,
          double: Math.random() < 0.4, wake: (seed * 0.618034) % 1 * (1 - WAKE_BAND), fade: this.fresh ? 1 : 0, lit: 0 };
      }
    }
    return { x: cx, y: cy, retryAt: t + SPAWN_RETRY };
  }

  draw(r, view, t) {
    if (this.presence <= 0) return;
    for (const f of this.list) {
      if (f.retryAt !== undefined) continue;
      // Each glows softly all the time and blazes up when it signals, and
      // all of it, the pool, the halo and the body, fades as it wakes.
      const lit = f.lit ?? 1;
      if (lit <= 0) continue;
      const b = 0.45 + 0.55 * fireflyFlash(f, t);
      const glow = b * lit;
      const h = f.h ?? 2;
      const sx = Math.floor(f.x) - view.x0;
      const ground = Math.floor(f.y) - view.y0;
      const fy = f.y - h;
      const sy = Math.floor(fy) - view.y0;
      if (sx < -1 || sx > view.cols || sy < -1 || sy > view.rows + 1) continue;
      // A pool of green light on the grass below, wider than it is tall.
      for (let dy = 0; dy <= 1; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const x = sx + dx;
          const y = ground + dy;
          if (x < 0 || y < 0 || x >= r.cols || y >= r.rows) continue;
          const k = glow * 0.35 / (1 + dx * dx * 0.6 + dy * dy * 2) / (1 + h * 0.25);
          lighten(r, (y * r.cols + x) * 4, k, 120, 170, 70, 0.25);
        }
      }
      halo(r, sx, sy, glow * 0.8, 120, 175, 45);
      if (sx < 0 || sy < 0 || sx >= r.cols || sy >= r.rows) continue;
      // The body fades in from the colour of the ground behind it.
      const o = (sy * r.cols + sx) * 4;
      const k = Math.min(1, 0.2 + b * 1.1) * lit;
      r.layer(sx, sy, subGlyph(BODY, f.x, fy), r.bg[o] + (215 - r.bg[o]) * k,
        r.bg[o + 1] + (255 - r.bg[o + 1]) * k, r.bg[o + 2] + (95 - r.bg[o + 2]) * k);
    }
  }
}
