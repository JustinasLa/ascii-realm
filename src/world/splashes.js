import { glyph } from '../render/glyphs.js';
import { TILT } from '../entities/rig.js';
import { ASPECT, WATER } from './world.js';

const RIPPLE = glyph('~');
const DOT = glyph('.');
const DROPS = [...".'`|"].map(glyph);
const MAX_RINGS = 96;
const MAX_DROPS = 240;
const IMPACTS = {
  step: 1,
  jump: 1.25,
  land: 2.4,
  skid: 0.45,
  slam: 2.8,
  whirl: 2,
};

// Footfall-driven water: expanding surface rings and ballistic droplets.
// All positions stay in world cells, so camera movement and zoom do not
// drag an old splash along with the character.
export class Splashes {
  constructor() {
    this.rings = [];
    this.drops = [];
  }

  ring(x, y, strength, delay = 0, small = false) {
    this.rings.push({ x, y, strength, age: -delay,
      life: small ? 0.55 : 1.15 + strength * 0.25,
      speed: small ? 2 : 3 + strength * 2,
      radius: small ? 0.15 : 0.55 });
    if (this.rings.length > MAX_RINGS) this.rings.shift();
  }

  react(world, event) {
    const impact = IMPACTS[event.type];
    if (!impact || world.typeAt(event.x, event.y) !== WATER) return false;
    const weight = Math.max(0, Math.min(1.5, event.strength ?? 0.5));
    const strength = impact * (0.4 + weight * 0.6);
    this.ring(event.x, event.y, strength);
    if (event.type !== 'skid') this.ring(event.x, event.y, strength * 0.55, 0.12);
    const count = Math.round((5 + weight * 7) * impact);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (2.5 + Math.random() * 4) * (0.7 + strength * 0.5);
      this.drops.push({
        x: event.x + Math.cos(angle) * 0.35 / ASPECT,
        y: event.y + Math.sin(angle) * 0.2,
        h: 0.1,
        vx: Math.cos(angle) * speed / ASPECT,
        vy: Math.sin(angle) * speed * TILT,
        vh: 3 + Math.random() * 4 + strength * 1.5,
        age: 0,
        life: 0.8,
        glint: 0.7 + Math.random() * 0.3,
      });
    }
    if (this.drops.length > MAX_DROPS) this.drops.splice(0, this.drops.length - MAX_DROPS);
    return true;
  }

  // Small weather impacts use the same water-clipped rings as footsteps.
  // Snow melts quietly; rain and ice throw up a brief crown of droplets.
  precipitate(world, x, y, strength, kind = 'rain', random = Math.random) {
    if (!(strength > 0) || world.typeAt(x, y) !== WATER) return false;
    const weight = Math.min(1, strength);
    this.ring(x, y, 0.25 + weight * 0.7, 0, true);
    const ring = this.rings[this.rings.length - 1];
    ring.radius = 0.3;
    ring.life = 0.6 + weight * 0.35;
    ring.speed = 1.5 + weight * 2;
    const count = kind === 'snow' ? 0 : kind === 'hail' ? 3 : weight > 0.6 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const angle = random() * Math.PI * 2;
      const speed = 0.7 + random() * 1.2;
      this.drops.push({
        x, y, h: 0.1,
        vx: Math.cos(angle) * speed / ASPECT,
        vy: Math.sin(angle) * speed * TILT,
        vh: 2.5 + weight * 3 + random(),
        age: 0, life: 0.6,
        glint: 0.6 + weight * 0.4,
      });
    }
    if (this.drops.length > MAX_DROPS) this.drops.splice(0, this.drops.length - MAX_DROPS);
    return true;
  }

  update(dt) {
    for (const ring of this.rings) ring.age += dt;
    this.rings = this.rings.filter((p) => p.age < p.life);
    const drag = Math.exp(-2.8 * dt);
    for (const p of this.drops) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.h += p.vh * dt;
      p.vh -= 24 * dt;
      p.vx *= drag;
      p.vy *= drag;
      p.age += dt;
      if (p.h <= 0 && p.vh < 0) {
        // A falling droplet leaves a tiny secondary ripple on contact.
        this.ring(p.x, p.y, 0.18 * p.glint, 0, true);
        p.life = 0;
      }
    }
    this.drops = this.drops.filter((p) => p.age < p.life);
  }

  drawRing(r, view, x, y, radius, light, time) {
    const rx = radius / ASPECT;
    const ry = radius * TILT;
    for (let wy = Math.floor(y - ry - 0.5); wy <= Math.ceil(y + ry + 0.5); wy++) {
      const sy = wy - view.y0;
      if (sy < 0 || sy >= r.rows) continue;
      for (let wx = Math.floor(x - rx - 1); wx <= Math.ceil(x + rx + 1); wx++) {
        const sx = wx - view.x0;
        if (sx < 0 || sx >= r.cols) continue;
        const cell = sy * r.cols + sx;
        if (r.mask[cell] !== WATER) continue;
        const dx = (wx + 0.5 - x) * ASPECT;
        const dy = (wy + 0.5 - y) / TILT;
        const distance = Math.hypot(dx, dy);
        if (Math.abs(distance - radius) > 0.48) continue;
        // Thin, broken moonlit crests; blend with the existing reflections.
        const shimmer = 0.8 + Math.sin(wx * 1.7 + wy * 2.3 + time * 4) * 0.2;
        const k = Math.min(1, light) * shimmer;
        const o = cell * 4;
        r.fg[o] += (155 - r.fg[o]) * k;
        r.fg[o + 1] += (193 - r.fg[o + 1]) * k;
        r.fg[o + 2] += (218 - r.fg[o + 2]) * k;
        r.fg[o + 3] = Math.abs(dy) > radius * 0.45 ? RIPPLE : DOT;
      }
    }
  }

  // Draw after the reflections and before the figure, so ripples pass
  // behind the legs and remain confined to the water at the shoreline.
  drawSurface(r, view, time) {
    for (const p of this.rings) {
      if (p.age < 0) continue;
      const fade = (1 - p.age / p.life) ** 2;
      this.drawRing(r, view, p.x, p.y, p.radius + p.speed * p.age, fade * p.strength * 1.1, time);
    }
  }

  // A thin crest in front of each submerged leg hides the hard cut at the
  // surface. Unlike the spray, these quiet waterlines remain when standing.
  drawContacts(r, view, time, contacts) {
    for (const p of contacts) {
      this.drawRing(r, view, p.x, p.y, 1.1 + Math.sin(time * 3) * 0.12, 0.55, time);
    }
  }

  // Spray rises in front of the feet, then falls back into the water.
  drawSpray(r, view) {
    for (const p of this.drops) {
      const k = p.glint * (1 - p.age / p.life * 0.55);
      const g = DROPS[p.vh > 2 ? 3 : p.vh > 0 ? 2 : p.vh > -3 ? 1 : 0];
      r.put(Math.floor(p.x) - view.x0, Math.floor(p.y - p.h) - view.y0,
        g, 155 * k, 195 * k, 225 * k);
    }
  }
}
