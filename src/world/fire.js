import { valueNoise } from '../core/noise.js';
import { firePulse } from '../core/fire.js';
export { firePulse } from '../core/fire.js';
import { grassGust } from '../audio/environment.js';
import { hash2 } from '../core/rng.js';
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
  constructor({ windAt = grassGust } = {}) {
    this.list = [];
    this.nextId = 1;
    this.windAt = windAt;
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
  // Near an existing fire it joins that fire instead of stacking flames.
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
      age: 0, intensity: START_INTENSITY, windStress: 0, gust: 0.42 };
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

  update(dt, time, world, weatherWind = 0) {
    const extinguished = [];
    if (!Number.isFinite(dt) || dt <= 0 || !Number.isFinite(time)) return extinguished;
    // Update all fires, including those beyond the camera. Wind damage is
    // accumulated over time, so a single gust cannot instantly erase a fire.
    for (let index = this.list.length - 1; index >= 0; index--) {
      const fire = this.list[index];
      fire.age += dt;
      const growth = growthAt(fire.age);
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
      fire.intensity = growth * Math.max(0, 1 - fire.windStress);
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
      const size = 0.3 + strength * 0.7;
      const brightness = 0.25 + Math.sqrt(strength) * 0.75;
      const wind = (fire.gust - 0.42) * 2.4;
      for (let h = 0; h < 15; h++) {
        for (let dx = -9; dx <= 9; dx++) {
          let heat = 0;
          for (let tongue = -1; tongue <= 1; tongue++) {
            const height = (9 + (tongue === 0 ? 3 : 0) + Math.sin(time * 4.5 + tongue * 2 + fire.seed) * 1.8) * size;
            if (h >= height) continue;
            const u = h / height;
            const center = (tongue * 2.8 + Math.sin(time * 6 - h * 0.6 + tongue * 3 + fire.seed) * (0.4 + u)) * size
              + wind * u * 3 * size;
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
          cells.push({ dx, dy: -h - 2, g: family[Math.floor(rnd * family.length)],
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
        const drift = (fire.gust - 0.42) * age * 12 + Math.sin(i + age * 3) * age * 4;
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
}
