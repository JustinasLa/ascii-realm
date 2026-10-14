import { valueNoise } from '../core/noise.js';
import { firePulse } from '../core/fire.js';
export { firePulse } from '../core/fire.js';
import { grassGust } from '../audio/environment.js';
import { hash2 } from '../core/rng.js';
import { SCALE, TILT } from '../entities/rig.js';
import { putCell } from '../render/cells.js';
import { dg, over } from '../render/glyphs.js';
import { BODY_SIDES, FLAME_STEPS, LICKS } from '../render/glyph-packs/effects.js';
import { softLayer, subGlyph, veil } from './glow.js';
import { ASPECT, WATER } from './world.js';

const names = (prefix, n) => Array.from({ length: n }, (_, i) => dg(`${prefix}.${i}`));
const pairs = (prefix) => Array.from({ length: FLAME_STEPS * FLAME_STEPS },
  (_, i) => dg(`${prefix}.${Math.floor(i / FLAME_STEPS)}${i % FLAME_STEPS}`));
const STROKE = pairs('effects.flame.s');
const TIP = pairs('effects.flame.tip');
const CORE = names('effects.flame.core', 3);
const LICK = names('effects.flame.lick', LICKS);
const BODY = [0, 1, 2].map((v) => BODY_SIDES.map((side) => dg(`effects.flame.body.${v}${side}`)));
const EMBER = names('effects.ember', 9);
const SPARK = names('effects.spark', 8);
const SMOKE = names('effects.smoke', 6);
const COAL = names('effects.coal', 4);
const LOG = names('effects.log', 4);
const LOG_GLOW = names('effects.logglow', 4);
const STONE = names('effects.stone', 4);
const ASH = names('speck', 16);
// Flung ash and burst embers keep to plain specks and embers.
const ASH_FLAKE = names('speck', 4);
const LIGHT_RADIUS = 23;
// The grid the flames are measured on: rows above the hearth, and columns
// either side of the middle.
const FLAME_H = 18;
const FLAME_X = 13;
const FLAME_W = FLAME_X * 2 + 1;
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
      // Two logs cross in the middle, one falling and one rising to the right.
      const falling = Math.abs(dy - dx * 0.22) < 0.55;
      const rising = Math.abs(dy + dx * 0.22) < 0.55;
      const log = !stone && (falling || rising);
      const shade = 0.7 + rnd * 0.3 - dy * 0.08;
      const v = Math.floor(rnd * 4);
      const g = stone ? STONE[v] : log ? LOG[(falling ? 1 : 0) + (v & 2)] : ASH[Math.floor(rnd * 16)];
      const cell = { dx, dy, g, stone,
        r: (stone ? 112 : log ? 88 : 70) * shade,
        gg: (stone ? 102 : log ? 56 : 52) * shade,
        b: (stone ? 92 : log ? 34 : 44) * shade, bg: stone ? [20, 15, 11] : [24, 13, 7] };
      cells.push(cell);
      // Charred logs glow along their cracks, and coals smoulder in the ash
      // around them; both pulse with the fire in prepare().
      if (log) cells.push({ dx, dy, g: over(LOG_GLOW[(falling ? 1 : 0) + (v & 2)]), glow: 0.75, seed: rnd });
      else if (!stone && d < 0.5) cells.push({ dx, dy, g: over(COAL[v]), glow: 1, seed: rnd });
    }
  }
  return cells;
}

// The glyphs for one cell of flame. heat: 0..1 at the cell, with the heat
// of the cells above, left and right of it; off, offTop: where the
// tongue's axis crosses the cell's bottom and top edges, in columns from
// the cell's centre; top: the tongue ends in this cell. Inside the fire a
// continuous glowing body carries a white heart or a bright spine; where
// the heat above runs out it breaks into tongues, and the cooler fringe
// into loose licks over whatever stands behind.
const step = (off) => Math.max(0, Math.min(FLAME_STEPS - 1, Math.floor((off + 0.5) * FLAME_STEPS)));
export function flameCell(cells, dx, dy, heat, up, left, right, off, offTop, top, rnd, brightness, glow = 1) {
  const hot = Math.min(1, heat / 0.8);
  const r = (190 + hot * 65) * brightness;
  const g = (34 + hot * hot * 196) * brightness;
  const b = (4 + hot ** 4 * 120) * brightness;
  const axis = Math.abs(off) < 0.5 || Math.abs(offTop) < 0.5;
  const pair = step(off) * FLAME_STEPS + step(offTop);
  const light = Math.min(1.15, brightness * 1.08);
  const lick = LICK[Math.floor(rnd * 97) % LICK.length];
  if (top && axis && heat < 0.45) {
    cells.push({ dx, dy, g: over(TIP[pair]), r, gg: g + 25, b });
  } else if (heat >= 0.4) {
    const bg = [hot * 70 * glow, hot * 26 * glow, hot * 4 * glow];
    // Body where the fire goes on above; a tongue where it gives out.
    const side = left < 0.3 && right >= 0.3 ? 1 : right < 0.3 && left >= 0.3 ? 2 : 0;
    const base = up >= 0.3 ? BODY[Math.floor(rnd * 3)][side] : lick;
    cells.push({ dx, dy, g: base, r, gg: g * 0.84, b: b * 0.6, bg });
    if (heat >= 0.78) {
      cells.push({ dx, dy, g: over(CORE[Math.floor(rnd * 7) % 3]), r: 255 * light, gg: 244 * light, b: 196 * light });
    } else if (axis) {
      cells.push({ dx, dy, g: over(top ? TIP[pair] : STROKE[pair]), r: 255 * light,
        gg: (150 + hot * 95) * light, b: (30 + hot * 70) * light });
    }
  } else if (axis && heat >= 0.25) {
    cells.push({ dx, dy, g: over(STROKE[pair]), r, gg: g, b });
  } else if (heat >= 0.2 || rnd < 0.5) {
    cells.push({ dx, dy, g: over(lick), r: r * 0.95, gg: g * 0.8, b });
  }
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
      r.ov[o] += 156 * k;
      r.ov[o + 1] += 72 * k;
      r.ov[o + 2] += 12 * k;
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
        life, max: life, ash, g: ash ? ASH_FLAKE[Math.floor(this.random() * ASH_FLAKE.length)] : null });
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
      const strength = fire.intensity;
      const cells = [];
      // The hearth: stones, logs and ash, with the cracks in the logs and
      // the coals breathing brighter and dimmer on their own slow rhythms.
      const ember = Math.min(1, 0.35 + strength * 0.8);
      for (const c of fire.hearth) {
        if (!c.glow) { cells.push(c); continue; }
        const pulse = 0.55 + 0.45 * valueNoise(time * 1.7 + c.seed * 40, c.dx * 0.6 + c.dy, fire.seed);
        const k = pulse * ember * c.glow;
        cells.push({ dx: c.dx, dy: c.dy, g: c.g, r: 90 + 165 * k, gg: 24 + 112 * k * k, b: 8 + 30 * k * k * k });
      }
      const size = (0.3 + strength * 0.7) * (1 + fire.flare * 0.25);
      const brightness = Math.min(1.15, 0.25 + Math.sqrt(strength) * 0.75 + fire.flare * 0.2);
      const wind = (fire.gust - 0.42) * 2.4;
      const frame = Math.floor(time * 12);
      // Each of three tongues sways and stretches; axisAt gives its centre
      // line at height h.
      const tongues = [-1, 0, 1].map((tongue) => ({
        tongue,
        height: (9 + (tongue === 0 ? 3 : 0) + Math.sin(time * 4.5 + tongue * 2 + fire.seed) * 1.8) * size,
      }));
      const axisAt = (t, h) => {
        const u = h / t.height;
        return (t.tongue * 2.8 + Math.sin(time * 6 - h * 0.6 + t.tongue * 3 + fire.seed) * (0.4 + u)) * size
          + wind * u * 3 * size + fire.leanX * u / ASPECT;
      };
      // Measure the heat over the whole flame first, so each cell can see
      // whether the fire goes on above and beside it.
      const heats = this._heat ??= new Float32Array(FLAME_W * FLAME_H);
      const owner = this._owner ??= new Array(FLAME_W * FLAME_H);
      for (let h = 0; h < FLAME_H; h++) {
        for (let dx = -FLAME_X; dx <= FLAME_X; dx++) {
          let heat = 0;
          let best = null;
          for (const t of tongues) {
            if (h >= t.height) continue;
            const u = h / t.height;
            const center = axisAt(t, h);
            const width = (1 - u) ** 0.7 * (2.7 + Math.sin(time * 8 + h + t.tongue) * 0.35) * size;
            const core = 1 - Math.abs(dx - center) / width;
            if (core <= 0) continue;
            const turbulence = valueNoise(dx * 0.7, h * 0.5 - time * 7, fire.seed);
            const value = core * (0.9 - u * 0.3) + turbulence * 0.25 - 0.13;
            if (value > heat) { heat = value; best = t; }
          }
          const i = h * FLAME_W + dx + FLAME_X;
          heats[i] = heat;
          owner[i] = best;
        }
      }
      const heatAt = (h, dx) => (h < 0 || h >= FLAME_H || dx < -FLAME_X || dx > FLAME_X ? 0
        : heats[h * FLAME_W + dx + FLAME_X]);
      for (let h = 0; h < FLAME_H; h++) {
        for (let dx = -FLAME_X; dx <= FLAME_X; dx++) {
          const i = h * FLAME_W + dx + FLAME_X;
          const heat = heats[i];
          if (heat < 0.09) continue;
          const best = owner[i];
          const off = axisAt(best, h) - dx;
          const offTop = axisAt(best, h + 1) - dx;
          const rnd = hash2(dx, h, fire.seed + frame);
          flameCell(cells, dx, -h - 2 + Math.round(fire.leanY * h / 15 * TILT), heat,
            heatAt(h + 1, dx), heatAt(h, dx - 1), heatAt(h, dx + 1), off, offTop,
            h + 1 >= best.height, rnd, brightness, strength);
        }
      }
      // The front stones sit in front of the burning logs.
      cells.push(...fire.hearth.filter(c => c.dy >= 1 && c.stone));
      // Embers ride the updraft, wink as they tumble and redden as they cool.
      for (let i = 0; i < Math.ceil(16 * strength); i++) {
        const phase = hash2(i, 0, fire.seed);
        const age = (time / (1.4 + phase * 1.6) + phase) % 1;
        const h = age * (14 + phase * 13) * size;
        const x = Math.sin(i * 12.3 + h * 0.18) * (1 + age * 4) + wind * h * 0.3;
        const wink = hash2(i, Math.floor(time * 9 + phase * 7), fire.seed) < 0.22 ? 0.3 : 1;
        const fade = Math.sin(age * Math.PI) ** 0.6 * brightness * wink;
        const y = -h - 3;
        cells.push({ dx: Math.floor(x + 0.5), dy: Math.floor(y), g: over(subGlyph(EMBER, x + 0.5, y)),
          r: 255 * fade, gg: (150 + phase * 90) * (1 - age * 0.6) * fade, b: (50 - age * 40) * fade });
      }
      // Now and then a knot pops and throws a spark out in a quick arc.
      for (let i = 0; i < Math.ceil(5 * strength); i++) {
        const phase = hash2(i, 7, fire.seed);
        const period = 1.6 + phase * 2.4;
        const t = ((time + phase * 13) % period) * 1.7;
        if (t > 0.45) continue;
        const vx = (hash2(i, Math.floor((time + phase * 13) / period), fire.seed) - 0.5) * 34;
        const vy = -22 - phase * 14;
        const x = vx * t;
        const y = -4 + vy * t + 46 * t * t;
        const heading = Math.round(Math.atan2(vy + 92 * t, vx * ASPECT) / (Math.PI * 2) * 8 + 8) % 8;
        const fade = (1 - t / 0.45) * brightness;
        cells.push({ dx: Math.round(x), dy: Math.floor(y), g: over(SPARK[heading]),
          r: 255 * fade, gg: 225 * fade, b: 140 * fade });
      }
      fire.cells = cells;
    }
    return visible;
  }

  draw(r, view, fire, time, write = putCell) {
    const bx = Math.floor(fire.x) - view.x0;
    const by = Math.floor(fire.y) - view.y0;
    // Smoke billows up in soft puffs that swell, cool and drift with the
    // wind: warm where the fire lights them from below, grey above, with a
    // moonlit upper left. The scene shows through the thin parts.
    if (write === putCell && r.ov) {
      const settle = fire.intensity * Math.min(1, fire.age / 3);
      for (let i = 0; i < 12; i++) {
        const phase = hash2(i, 1, fire.seed);
        const age = (time / 5.2 + phase) % 1;
        const alpha = Math.sin(age * Math.PI) ** 0.8 * 0.42 * settle;
        if (alpha < 0.02) continue;
        const h = 5 + fire.intensity * 7 + age * (12 + fire.intensity * 14);
        const drift = (fire.gust - 0.42) * age * 14 + Math.sin(i * 1.7 + age * 3) * age * 4 + fire.leanX * age / ASPECT;
        const cx = bx + 0.5 + drift;
        const cy = by + 0.5 - h;
        const rx = (0.9 + age * 3.4) / ASPECT;
        const ry = 0.7 + age * 1.9;
        const warm = Math.max(0, 1 - age * 1.8);
        const sr = 112 + warm * 40;
        const sg = 106 + warm * 8;
        const sb = 104 - warm * 22;
        for (let y = Math.max(0, Math.floor(cy - ry)); y <= Math.min(r.rows - 1, Math.ceil(cy + ry)); y++) {
          for (let x = Math.max(0, Math.floor(cx - rx)); x <= Math.min(r.cols - 1, Math.ceil(cx + rx)); x++) {
            const nx = (x + 0.5 - cx) / rx;
            const ny = (y + 0.5 - cy) / ry;
            const d = nx * nx + ny * ny;
            if (d >= 1) continue;
            const k = alpha * (1 - d);
            const lit = nx + ny < -0.5 ? 18 : 0;
            const cell = y * r.cols + x;
            const o = cell * 4;
            veil(r, o, k * 0.45, sr + lit, sg + lit, sb + lit, 0.3);
            if (k < 0.07) continue;
            const v = (k > 0.2 ? 2 : k > 0.12 ? 1 : 0) + 3 * (hash2(x + view.x0, i, fire.seed) < 0.5 ? 0 : 1);
            const m = Math.min(1, k * 2.4);
            softLayer(r, cell, SMOKE[v], r.bg[o] + (sr + lit - r.bg[o]) * m,
              r.bg[o + 1] + (sg + lit - r.bg[o + 1]) * m, r.bg[o + 2] + (sb + lit - r.bg[o + 2]) * m);
          }
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
      const y = p.y - p.h;
      const sx = Math.floor(p.x) - view.x0;
      const sy = Math.floor(y) - view.y0;
      const fade = Math.max(0, p.life / p.max);
      if (p.ash) r.layer(sx, sy, p.g, 135 * fade, 112 * fade, 90 * fade);
      else r.layer(sx, sy, subGlyph(EMBER, p.x, y), 255 * fade, (120 + 80 * fade) * fade, 40 * fade);
    }
  }
}
