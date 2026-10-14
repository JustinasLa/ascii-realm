import { valueNoise } from '../core/noise.js';
import { firePulse } from '../core/fire.js';
export { firePulse } from '../core/fire.js';
import { grassGust } from '../audio/environment.js';
import { hash2 } from '../core/rng.js';
import { SCALE, TILT } from '../entities/rig.js';
import { putCell } from '../render/cells.js';
import { glyph } from '../render/glyphs.js';
import { ASPECT, WATER } from './world.js';

const FLAME = ['.,^', '^/\\vx', '*ox%', '#@&'].map(s => [...s].map(glyph));
const EMBER = [...".*+'"].map(glyph);
const SMOKE = [...'.:~'].map(glyph);
const LIGHT_RADIUS = 23;
export const MAX_FIRES = 24;
export const FIRE_GROW_SECONDS = 20;
export const STRONG_WIND = 0.8;
const WIND_OUT_SECONDS = 1.6;
const START_INTENSITY = 0.18;
export const MAX_FIRE_PARTICLES = 240;
const CONTACTS = {
  step: { reach: 0, force: 0.55, damage: 0.12 },
  pass: { reach: 0, force: 0.8, damage: 0.22 },
  skid: { reach: 1, force: 0.9, damage: 0.28 },
  jump: { reach: 1, force: 0.55, damage: 0.06 },
  land: { reach: 2, force: 1.3, damage: 0.7 },
  swing: { reach: SCALE * 1.1, force: 0.9, damage: 0.14 },
  slam: { reach: 3, force: 1.5, damage: 0.8 },
  whirl: { reach: SCALE * 1.3, force: 1.25, damage: 0.25 },
};

function growthAt(age) {
  const progress = Math.min(1, age / FIRE_GROW_SECONDS);
  return START_INTENSITY + (1 - START_INTENSITY) * progress * progress * (3 - 2 * progress);
}

function hearth(seed) {
  const cells = [];
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -7; dx <= 7; dx++) {
      const d = (dx / 7) ** 2 + (dy / 2.3) ** 2;
      if (d > 1) continue;
      const rnd = hash2(dx, dy, seed);
      const stone = d > 0.58;
      const log = !stone && (Math.abs(dy - dx * 0.22) < 0.55 || Math.abs(dy + dx * 0.22) < 0.55);
      const shade = 0.7 + rnd * 0.3 - dy * 0.08;
      cells.push({ dx, dy, g: glyph(stone ? 'oO@'[Math.floor(rnd * 3)] : log ? '=x'[dx & 1] : '.,'[dx & 1]),
        r: (stone ? 105 : log ? 94 : 54) * shade,
        gg: (stone ? 96 : log ? 48 : 28) * shade,
        b: (stone ? 84 : log ? 20 : 12) * shade, bg: [15, 10, 7] });
    }
  }
  return cells;
}

// Warm light is also used by carried and flying torches. Distances are in
// row units so the glow stays round despite the narrow character cells.
export function drawFireLight(r, view, time, source, radius, height = 2) {
  const bx = source.x - view.x0;
  const by = source.y - height - view.y0;
  const pulse = firePulse(source, time);
  const x0 = Math.max(0, Math.floor(bx - radius / ASPECT));
  const x1 = Math.min(r.cols - 1, Math.ceil(bx + radius / ASPECT));
  const y0 = Math.max(0, Math.floor(by - radius));
  const y1 = Math.min(r.rows - 1, Math.ceil(by + radius));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const distance = Math.hypot((x - bx) * ASPECT, y - by);
      if (distance >= radius) continue;
      const k = pulse * (1 - distance / radius) ** 2;
      const o = (y * r.cols + x) * 4;
      r.fg[o] += 156 * k;
      r.fg[o + 1] += 72 * k;
      r.fg[o + 2] += 12 * k;
      r.bg[o] += 34 * k;
      r.bg[o + 1] += 16 * k;
      r.bg[o + 2] += 4 * k;
    }
  }
}

export class Fires {
  constructor({ windAt = grassGust, random = Math.random } = {}) {
    this.list = [];
    this.nextId = 1;
    this.windAt = windAt;
    this.random = random;
    this.particles = [];
    this.events = [];
  }

  canPlace(world, x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    // The entire stone ring needs dry, unobstructed ground.
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -7; dx <= 7; dx++) {
        if ((dx / 7) ** 2 + (dy / 2.3) ** 2 > 1) continue;
        if (world.typeAt(x + dx, y + dy) === WATER || !world.isWalkable(x + dx, y + dy)) return false;
      }
    }
    return !this.nearest(x, y, 7);
  }

  add(world, x, y) {
    x = Math.floor(x) + 0.5;
    y = Math.floor(y) + 0.5;
    if (this.list.length >= MAX_FIRES || !this.canPlace(world, x, y)) return null;
    return this.create(world, x, y, 'campfire');
  }

  // A thrown torch ignites its landing spot without building a stone ring.
  // Near an existing fire it feeds that fire instead of stacking flames.
  ignite(world, x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    x = Math.floor(x) + 0.5;
    y = Math.floor(y) + 0.5;
    if (world.typeAt(x, y) === WATER || !world.isWalkable(x, y)) return null;
    const nearby = this.nearest(x, y, 7);
    if (nearby) return nearby;
    if (this.list.length >= MAX_FIRES) return null;
    world.burnGrass(x, y);
    return this.create(world, x, y, 'ground');
  }

  create(world, x, y, kind) {
    const seed = Math.floor(hash2(x, y, world.seed + 910) * 0x7fffffff);
    const base = hearth(seed);
    const fire = { id: this.nextId++, x, y, seed, kind,
      hearth: kind === 'campfire' ? base : base.filter(c => Math.abs(c.dx) <= 3 && Math.abs(c.dy) <= 1), cells: [],
      age: 0, intensity: START_INTENSITY, windStress: 0, gust: 0.42,
      flare: 0, leanX: 0, leanY: 0, smother: 0, nextContact: 0 };
    this.list.push(fire);
    return fire;
  }

  nearest(x, y, radius = 10) {
    let nearest = null;
    for (const fire of this.list) {
      const distance = Math.hypot((fire.x - x) * ASPECT, fire.y - y);
      if (distance <= radius) { radius = distance; nearest = fire; }
    }
    return nearest;
  }

  extinguish(world, fire) {
    const index = this.list.indexOf(fire);
    if (index < 0) return false;
    world.burnGrass(fire.x, fire.y);
    this.list.splice(index, 1);
    fire.intensity = 0;
    fire.cells = [];
    return true;
  }

  // Sweep movement between frames, so a fast run cannot skip a small fire.
  pass(world, player, fromX, fromY, fromAir = 0) {
    if (player.air > 0.05 || fromAir > 0.05) return false;
    const dx = (player.x - fromX) * ASPECT;
    const dy = (player.y - fromY) / TILT;
    const distance2 = dx * dx + dy * dy;
    if (!Number.isFinite(distance2) || distance2 < 0.001) return false;
    let touched = false;
    for (const fire of [...this.list]) {
      const t = Math.max(0, Math.min(1, ((fire.x - fromX) * ASPECT * dx + (fire.y - fromY) / TILT * dy) / distance2));
      const point = { x: fromX + (player.x - fromX) * t, y: fromY + (player.y - fromY) * t };
      const strength = 0.25 + Math.min(1, Math.max(player.run ?? 0, (player.speed ?? 0) / (player.runSpeed || 5))) * 0.75;
      touched = this.react(world, { type: 'pass', ...point, strength, dx, dy }, player, fire) || touched;
    }
    return touched;
  }

  react(world, event, player = {}, onlyFire = null) {
    const contact = CONTACTS[event.type];
    if (!contact || ![event.x, event.y].every(Number.isFinite) || event.strength === 0) return false;
    const heading = Number.isFinite(player.heading) ? player.heading : 0;
    const weight = Number.isFinite(event.strength) ? Math.max(0, Math.min(1.5, event.strength)) : 1;
    const foot = ['step', 'pass', 'skid'].includes(event.type);
    if (foot && player.air > 0.05) return false;
    let reacted = false;
    for (const fire of onlyFire ? [onlyFire] : [...this.list]) {
      if (!this.list.includes(fire) || (foot && fire.age < fire.nextContact)) continue;
      const dx = (fire.x - event.x) * ASPECT;
      const dy = (fire.y - event.y) / TILT;
      const distance = Math.hypot(dx, dy);
      const radius = (fire.kind === 'ground' ? 2.5 : 4.5) + contact.reach;
      if (distance > radius) continue;
      const spin = event.type === 'whirl' || event.move === 'spin';
      if (event.type === 'swing' && !spin) {
        const forward = dx * Math.sin(heading) + dy * Math.cos(heading);
        if (forward < -1.5) continue;
        if (event.move === 'thrust' && Math.abs(dx * Math.cos(heading) - dy * Math.sin(heading)) > 5) continue;
      }
      const power = contact.force * (0.35 + weight * 0.65) * (0.35 + 0.65 * (1 - distance / radius));
      let pushX = Number.isFinite(event.dx) ? event.dx : Math.sin(heading);
      let pushY = Number.isFinite(event.dy) ? event.dy : Math.cos(heading);
      if (spin || event.type === 'land' || event.type === 'slam') {
        pushX = distance > 0.1 ? dx / distance : Math.sin(heading);
        pushY = distance > 0.1 ? dy / distance : Math.cos(heading);
      }
      const length = Math.hypot(pushX, pushY) || 1;
      pushX /= length;
      pushY /= length;
      fire.leanX = Math.max(-3.5, Math.min(3.5, fire.leanX + pushX * power * 3));
      fire.leanY = Math.max(-3.5, Math.min(3.5, fire.leanY + pushY * power * 3));
      fire.flare = Math.min(1, fire.flare + power * 0.8);
      this.burst(fire, power, pushX, pushY);
      fire.smother = Math.min(1, fire.smother + contact.damage * power / (0.45 + fire.intensity * 0.55));
      if (foot) fire.nextContact = fire.age + 0.22;
      const out = fire.smother >= 1;
      if (out) this.extinguish(world, fire);
      else fire.intensity = growthAt(fire.age) * Math.max(0, 1 - fire.windStress) * (1 - fire.smother);
      this.events.push({ type: 'fire-stir', x: fire.x, y: fire.y, strength: Math.min(1.5, power),
        cause: event.type, extinguished: out });
      if (this.events.length > 64) this.events.shift();
      reacted = true;
    }
    return reacted;
  }

  burst(fire, strength, dx, dy) {
    for (let i = 0; i < Math.round(7 + strength * 15); i++) {
      const angle = this.random() * Math.PI * 2;
      const speed = (2 + this.random() * 6) * strength;
      const ash = this.random() < 0.25;
      const life = (ash ? 1.2 : 0.6) + this.random() * 0.6;
      this.particles.push({ x: fire.x, y: fire.y, h: 0.5,
        vx: (dx * speed * 1.7 + Math.cos(angle) * speed) / ASPECT,
        vy: (dy * speed * 1.7 + Math.sin(angle) * speed) * TILT,
        vh: 4 + this.random() * 6 + strength * 4,
        life, max: life, ash, g: ash ? SMOKE[Math.floor(this.random() * SMOKE.length)] : EMBER[Math.floor(this.random() * EMBER.length)] });
    }
    if (this.particles.length > MAX_FIRE_PARTICLES) this.particles.splice(0, this.particles.length - MAX_FIRE_PARTICLES);
  }

  update(dt, time, world, weatherWind = 0) {
    const extinguished = [];
    if (!Number.isFinite(dt) || dt <= 0 || !Number.isFinite(time)) return extinguished;
    const drag = Math.exp(-3 * dt);
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.h = Math.max(0, p.h + p.vh * dt);
      p.vh -= (p.ash ? 8 : 22) * dt;
      p.vx *= drag;
      p.vy *= drag;
      p.life -= dt;
    }
    this.particles = this.particles.filter(p => p.life > 0);
    // Update all fires, including those beyond the camera. Wind damage is
    // accumulated over time, so a single gust cannot instantly erase a fire.
    for (let index = this.list.length - 1; index >= 0; index--) {
      const fire = this.list[index];
      fire.age += dt;
      const growth = growthAt(fire.age);
      fire.flare *= Math.exp(-6 * dt);
      fire.leanX *= Math.exp(-5 * dt);
      fire.leanY *= Math.exp(-5 * dt);
      fire.smother = Math.max(0, fire.smother - dt * 0.22);
      const gust = this.windAt(world, fire.x, fire.y, time);
      const localWind = Number.isFinite(gust) ? Math.max(0, Math.min(1, gust)) : 0;
      const stormWind = Number.isFinite(weatherWind) ? Math.min(1, Math.abs(weatherWind)) : 0;
      fire.gust = Math.min(1, localWind + stormWind * 0.75);
      if (fire.gust > STRONG_WIND) {
        const pressure = (fire.gust - STRONG_WIND) / (1 - STRONG_WIND);
        // A newly lit fire is more vulnerable than an established blaze.
        fire.windStress += dt * (0.4 + pressure * 0.6) / (WIND_OUT_SECONDS * (0.55 + growth * 0.45));
      } else {
        fire.windStress = Math.max(0, fire.windStress - dt / 2);
      }
      fire.intensity = growth * Math.max(0, 1 - fire.windStress) * (1 - fire.smother);
      if (fire.windStress >= 1) {
        this.extinguish(world, fire);
        extinguished.push(fire);
      }
    }
    return extinguished;
  }

  addStarter(world) {
    // Prefer the side of the clearing, leaving the wanderer's silhouette open.
    for (const radius of [11, 15, 19, 23]) {
      for (let i = 0; i < 16; i++) {
        const a = -0.2 + i * Math.PI / 8;
        const fire = this.add(world, world.spawn.x + Math.cos(a) * radius / ASPECT,
          world.spawn.y + Math.sin(a) * radius);
        if (fire) return fire;
      }
    }
    return null;
  }

  toggle(world, player) {
    if (player.air > 0.05) return 'air';
    const nearby = this.nearest(player.x, player.y, 12);
    if (nearby) {
      this.extinguish(world, nearby);
      return 'out';
    }
    if (world.typeAt(player.x, player.y) === WATER) return 'water';
    if (this.list.length >= MAX_FIRES) return 'limit';
    for (const turn of [0, -Math.PI / 4, Math.PI / 4, -Math.PI / 2, Math.PI / 2, Math.PI]) {
      const angle = player.heading + turn;
      if (this.add(world, player.x + Math.sin(angle) * 9 / ASPECT, player.y + Math.cos(angle) * 9)) return 'lit';
    }
    return 'blocked';
  }

  // Bake only visible flames once per frame; the same cells go into the lake.
  prepare(view, time) {
    const visible = this.list.filter(f => f.x >= view.x0 - 40 && f.x <= view.x0 + view.cols + 40
      && f.y >= view.y0 - LIGHT_RADIUS && f.y <= view.y0 + view.rows + 32);
    for (const fire of visible) {
      const cells = [...fire.hearth];
      const strength = fire.intensity;
      const size = (0.3 + strength * 0.7) * (1 + fire.flare * 0.25);
      const brightness = Math.min(1.15, 0.25 + Math.sqrt(strength) * 0.75 + fire.flare * 0.2);
      const wind = (fire.gust - 0.42) * 2.4;
      for (let h = 0; h < 18; h++) {
        for (let dx = -13; dx <= 13; dx++) {
          let heat = 0;
          for (let tongue = -1; tongue <= 1; tongue++) {
            const height = (9 + (tongue === 0 ? 3 : 0) + Math.sin(time * 4.5 + tongue * 2 + fire.seed) * 1.8) * size;
            if (h >= height) continue;
            const u = h / height;
            const center = (tongue * 2.8 + Math.sin(time * 6 - h * 0.6 + tongue * 3 + fire.seed) * (0.4 + u)) * size
              + wind * u * 3 * size + fire.leanX * u / ASPECT;
            const width = (1 - u) ** 0.7 * (2.7 + Math.sin(time * 8 + h + tongue) * 0.35) * size;
            const core = 1 - Math.abs(dx - center) / width;
            if (core <= 0) continue;
            const turbulence = valueNoise(dx * 0.7, h * 0.5 - time * 7, fire.seed);
            heat = Math.max(heat, core * (0.9 - u * 0.3) + turbulence * 0.25 - 0.13);
          }
          if (heat < 0.09) continue;
          const family = FLAME[Math.min(3, Math.floor(heat * 4.5))];
          const rnd = hash2(dx, h, fire.seed + Math.floor(time * 12));
          const hot = Math.min(1, heat / 0.8);
          cells.push({ dx, dy: -h - 2 + Math.round(fire.leanY * h / 15 * TILT), g: family[Math.floor(rnd * family.length)],
            r: (225 + hot * 30) * brightness, gg: (55 + hot * 184) * brightness, b: (6 + hot ** 3 * 137) * brightness,
            bg: [hot * 62 * strength, hot * 22 * strength, hot * 3 * strength] });
        }
      }
      // The front stones sit in front of the burning logs.
      cells.push(...fire.hearth.filter(c => c.dy >= 1));
      for (let i = 0; i < Math.ceil(16 * strength); i++) {
        const phase = hash2(i, 0, fire.seed);
        const age = (time / (1.4 + phase * 1.6) + phase) % 1;
        const h = age * (14 + phase * 13) * size;
        const dx = Math.sin(i * 12.3 + h * 0.18) * (1 + age * 4) + wind * h * 0.3;
        const fade = Math.sin(age * Math.PI) ** 0.6 * brightness;
        cells.push({ dx: Math.round(dx), dy: -Math.floor(h) - 3,
          g: EMBER[Math.floor(phase * EMBER.length)], r: 255 * fade, gg: (125 + phase * 100) * fade, b: 30 * fade });
      }
      fire.cells = cells;
    }
    return visible;
  }

  draw(r, view, fire, time, write = putCell) {
    const bx = Math.floor(fire.x) - view.x0;
    const by = Math.floor(fire.y) - view.y0;
    // Translucent wisps rise and broaden, leaving bright objects visible.
    if (write === putCell) {
      for (let i = 0; i < 14; i++) {
        const phase = hash2(i, 1, fire.seed);
        const age = (time / 4.8 + phase) % 1;
        const h = 4 + fire.intensity * 7 + age * (10 + fire.intensity * 12);
        const drift = (fire.gust - 0.42) * age * 12 + Math.sin(i + age * 3) * age * 4 + fire.leanX * age / ASPECT;
        const sy = by - Math.floor(h);
        const alpha = Math.sin(age * Math.PI) * 0.2 * fire.intensity * Math.min(1, fire.age / 3);
        for (let dx = -1; dx <= 1; dx++) {
          const sx = bx + Math.round(drift) + dx;
          if (sx < 0 || sy < 0 || sx >= r.cols || sy >= r.rows) continue;
          const o = (sy * r.cols + sx) * 4;
          const k = alpha / (1 + Math.abs(dx));
          for (let channel = 0; channel < 3; channel++) {
            const color = [112, 106, 100][channel];
            r.fg[o + channel] += (color - r.fg[o + channel]) * k;
            r.bg[o + channel] += (color * 0.3 - r.bg[o + channel]) * k;
          }
          if (r.fg[o] < 130 && Math.abs(dx) < 1) r.fg[o + 3] = SMOKE[Math.floor(phase * SMOKE.length)];
        }
      }
    }
    for (const c of fire.cells) {
      write(r, bx + c.dx, by + c.dy, c.g, c.r, c.gg, c.b, by, ...(c.bg ?? []));
    }
  }

  light(r, view, time, visible) {
    for (const fire of visible) {
      const radius = LIGHT_RADIUS * (0.45 + 0.55 * Math.sqrt(fire.intensity));
      drawFireLight(r, view, time, fire, radius);
    }
  }

  drawParticles(r, view) {
    for (const p of this.particles) {
      const sx = Math.floor(p.x) - view.x0;
      const sy = Math.floor(p.y - p.h) - view.y0;
      const fade = Math.max(0, p.life / p.max);
      r.put(sx, sy, p.g, (p.ash ? 135 : 255) * fade, (p.ash ? 112 : 175) * fade, (p.ash ? 90 : 45) * fade);
    }
  }
}
