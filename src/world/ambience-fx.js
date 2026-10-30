import { valueNoise } from '../core/noise.js';
import { hash2 } from '../core/rng.js';
import { MIST_HEIGHTS } from '../render/glyph-packs/effects.js';
import { dg, over } from '../render/glyphs.js';
import { softLayer, subGlyph, veil } from './glow.js';
import { ASPECT, grassLike, SHORE, WATER } from './world.js';

// The small life of the night air: pollen and spores drifting over the
// meadow, moths circling every flame, bats flickering across the sky now
// and then, and low veils of mist creeping over the water. Counts are
// bounded and everything layers over the scene rather than replacing it.

const names = (prefix, n) => Array.from({ length: n }, (_, i) => dg(`${prefix}.${i}`));
const MOTE = names('effects.mote', 9).map(over);
const MOTH = names('effects.moth', 3).map(over);
const BAT = [0, 1, 2].map((f) => [0, 1, 2].map((p) => dg(`effects.bat.${f}.${p}`)));
const BAT_RIM = [0, 1, 2].map((f) => [0, 1, 2].map((p) => over(dg(`effects.batrim.${f}.${p}`))));
const MIST = Array.from({ length: MIST_HEIGHTS }, (_, row) => [0, 1].map((k) => dg(`effects.mist.${row}.${k}`)));
// Wing beats run up, level, down, level.
const BEAT = [0, 1, 2, 1];

const MOTE_DENSITY = 1 / 170;
export const MAX_MOTES = 160;
export const MAX_MOTHS = 4;
export const MAX_BATS = 3;
export const MAX_WISPS = 10;
const MIST_COLOR = [128, 142, 164];

// The flames moths gather at: campfires and torches, at the height of
// their flames.
export function lightsOf(fires = [], torches = []) {
  return [
    ...fires.map((f) => ({ id: f.id, x: f.x, y: f.y, h: 4 + 7 * (f.intensity ?? 1), intensity: f.intensity })),
    ...torches.map((t) => ({ id: t.id, x: t.x + (t.flameX ?? 0), y: t.y, h: (t.flameH ?? 0) + 3, intensity: 0.8 })),
  ];
}

export class Ambience {
  constructor({ random = Math.random } = {}) {
    this.random = random;
    this.motes = [];
    this.moths = new Map();
    this.bats = [];
    this.wisps = [];
    this.nextBat = 4 + random() * 8;
  }

  // lights: { x, y, h, id, intensity } points of flame moths gather at.
  update(dt, time, world, view, { lights = [], wind = 0 } = {}) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    dt = Math.min(dt, 0.1);
    this.updateMotes(dt, time, world, view, wind);
    this.updateMoths(dt, time, lights);
    this.updateBats(dt, time, view);
    this.updateMist(dt, time, world, view, wind);
  }

  updateMotes(dt, time, world, view, wind) {
    const random = this.random;
    const count = Math.min(MAX_MOTES, Math.round(view.cols * view.rows * MOTE_DENSITY));
    if (this.motes.length > count) this.motes.length = count;
    // A few spawn attempts per frame keep the cost flat on barren ground.
    for (let tries = 0; tries < 6 && this.motes.length < count; tries++) {
      const x = view.x0 + random() * view.cols;
      const y = view.y0 + random() * view.rows + 4;
      if (!grassLike(world.typeAt(x, y))) continue;
      const life = 7 + random() * 9;
      this.motes.push({ x, y, h: 1 + random() * 7, seed: random() * 1000, age: 0, life,
        spore: random() < 0.35 });
    }
    for (const m of this.motes) {
      m.age += dt;
      const ax = valueNoise(m.seed, time * 0.2, 21) - 0.5;
      m.x += (ax * 2.2 + wind * 9 + 0.35) * dt / ASPECT;
      m.y += (valueNoise(m.seed + 7, time * 0.2, 22) - 0.5) * 0.8 * dt;
      m.h += (valueNoise(m.seed + 3, time * 0.3, 23) - 0.45) * 1.4 * dt;
      m.h = Math.max(0.5, Math.min(9, m.h));
    }
    this.motes = this.motes.filter((m) => m.age < m.life && m.x > view.x0 - 6 && m.x < view.x0 + view.cols + 6
      && m.y > view.y0 - 4 && m.y < view.y0 + view.rows + 14);
  }

  updateMoths(dt, time, lights) {
    const random = this.random;
    const seen = new Set();
    for (const light of lights.slice(0, 8)) {
      const key = light.id ?? `${Math.round(light.x)},${Math.round(light.y)}`;
      seen.add(key);
      let swarm = this.moths.get(key);
      if (!swarm) {
        swarm = Array.from({ length: 2 + Math.floor(random() * (MAX_MOTHS - 1)) }, () => ({
          angle: random() * Math.PI * 2, speed: (2 + random() * 3) * (random() < 0.5 ? -1 : 1),
          radius: 2 + random() * 4, seed: random() * 1000, x: light.x, y: light.y - light.h }));
        this.moths.set(key, swarm);
      }
      for (const m of swarm) {
        // Each moth loops the flame on a wobbling orbit, darting in and out.
        m.angle += m.speed * dt * (0.7 + valueNoise(m.seed, time * 1.5, 31) * 0.9);
        const reach = m.radius * (0.6 + valueNoise(m.seed + 5, time * 0.8, 32) * 0.9) * (0.5 + 0.5 * (light.intensity ?? 1));
        m.x = light.x + Math.cos(m.angle) * reach / ASPECT;
        m.y = light.y - light.h + Math.sin(m.angle) * reach * 0.55 + (valueNoise(m.seed + 9, time, 33) - 0.5) * 2;
        m.glow = light.intensity ?? 1;
        m.near = 1 - Math.min(1, reach / 7);
      }
    }
    for (const key of this.moths.keys()) if (!seen.has(key)) this.moths.delete(key);
  }

  updateBats(dt, time, view) {
    const random = this.random;
    this.nextBat -= dt;
    if (this.nextBat <= 0 && this.bats.length < MAX_BATS) {
      this.nextBat = 7 + random() * 14;
      const fromLeft = random() < 0.5;
      const group = random() < 0.35 ? 2 : 1;
      const row = view.y0 + view.rows * (0.08 + random() * 0.55);
      for (let i = 0; i < group && this.bats.length < MAX_BATS; i++) {
        this.bats.push({ x: fromLeft ? view.x0 - 4 - i * 9 : view.x0 + view.cols + 4 + i * 9,
          y: row + (random() - 0.5) * 6, base: row, dir: fromLeft ? 1 : -1, speed: 26 + random() * 12,
          seed: random() * 1000, beat: random() * 4, age: 0 });
      }
    }
    for (const b of this.bats) {
      b.age += dt;
      // Bats jink: a quick erratic weave over a slow swoop.
      b.x += b.dir * b.speed * (0.8 + valueNoise(b.seed, time * 2, 41) * 0.5) * dt / ASPECT;
      b.y = b.base + Math.sin(b.age * 1.3 + b.seed) * 4 + (valueNoise(b.seed + 3, time * 3.2, 42) - 0.5) * 7;
      b.beat += dt * 13;
    }
    this.bats = this.bats.filter((b) => b.age < 20 && (b.dir > 0 ? b.x < view.x0 + view.cols + 8 : b.x > view.x0 - 8));
  }

  updateMist(dt, time, world, view, wind) {
    const random = this.random;
    // Wisps form over open water and drift slowly with the air.
    if (this.wisps.length < MAX_WISPS) {
      const x = view.x0 + random() * view.cols;
      const y = view.y0 + random() * view.rows;
      if (world.typeAt(x, y) === WATER) {
        this.wisps.push({ x, y, len: 9 + random() * 16, rows: 1.5 + random() * 1.8, seed: random() * 1000,
          age: 0, life: 22 + random() * 26, vx: 0.4 + random() * 0.7 });
      }
    }
    for (const w of this.wisps) {
      w.age += dt;
      w.x += (w.vx + wind * 6) * dt / ASPECT;
      w.y += (valueNoise(w.seed, time * 0.05, 51) - 0.5) * 0.3 * dt;
      // A wisp that has drifted well onto dry land thins out sooner.
      const ground = world.typeAt(w.x, w.y);
      if (ground !== WATER && ground !== SHORE) w.age += dt * 2;
    }
    this.wisps = this.wisps.filter((w) => w.age < w.life && w.x - w.len / ASPECT < view.x0 + view.cols + 40
      && w.x + w.len / ASPECT > view.x0 - 40 && w.y > view.y0 - 20 && w.y < view.y0 + view.rows + 20);
  }

  // Mist lies low on the ground, so it goes down before anything that
  // stands up through it.
  drawMist(r, view, time) {
    for (const w of this.wisps) {
      const fade = Math.min(1, w.age / 6, (w.life - w.age) / 6);
      if (fade <= 0) continue;
      const halfW = w.len / ASPECT;
      const x0 = Math.max(0, Math.floor(w.x - halfW) - view.x0);
      const x1 = Math.min(r.cols - 1, Math.ceil(w.x + halfW) - view.x0);
      const y0 = Math.max(0, Math.floor(w.y - w.rows) - view.y0);
      const y1 = Math.min(r.rows - 1, Math.ceil(w.y + w.rows) - view.y0);
      for (let sy = y0; sy <= y1; sy++) {
        const wy = sy + view.y0;
        const ny = (wy + 0.5 - w.y) / w.rows;
        const across = 1 - ny * ny;
        if (across <= 0) continue;
        // Each row of the wisp keeps one streak height along its length.
        const streaks = MIST[Math.floor(hash2(wy, 0, w.seed) * MIST_HEIGHTS)];
        for (let sx = x0; sx <= x1; sx++) {
          const wx = sx + view.x0;
          const nx = (wx + 0.5 - w.x) / halfW;
          const along = 1 - nx * nx;
          if (along <= 0) continue;
          const swirl = valueNoise(wx * 0.12 - time * 0.25, wy * 0.45 + time * 0.05, w.seed);
          const k = fade * along * across * (0.35 + swirl * 0.9) * 0.42;
          if (k < 0.03) continue;
          const cell = sy * r.cols + sx;
          const o = cell * 4;
          veil(r, o, k * 0.55, MIST_COLOR[0], MIST_COLOR[1], MIST_COLOR[2]);
          if (k < 0.1) continue;
          const m = Math.min(1, k * 2.2);
          softLayer(r, cell, streaks[k > 0.22 ? 1 : 0], r.bg[o] + (MIST_COLOR[0] * 1.15 - r.bg[o]) * m,
            r.bg[o + 1] + (MIST_COLOR[1] * 1.15 - r.bg[o + 1]) * m, r.bg[o + 2] + (MIST_COLOR[2] * 1.15 - r.bg[o + 2]) * m);
        }
      }
    }
  }

  // Motes, moths and bats fly above everything else.
  draw(r, view, time) {
    for (const m of this.motes) {
      const fade = Math.min(1, m.age / 1.5, (m.life - m.age) / 1.5);
      // Now and then a mote turns and catches the moonlight.
      const glint = Math.max(0, Math.sin(time * 1.7 + m.seed)) ** 12;
      const k = fade * (0.35 + glint * 0.6);
      const y = m.y - m.h;
      const color = m.spore ? [170, 190, 150] : [215, 205, 150];
      this.point(r, view, m.x, y, subGlyph(MOTE, m.x, y), color, k);
    }
    for (const swarm of this.moths.values()) {
      for (const m of swarm) {
        const frame = BEAT[Math.floor(time * 22 + m.seed) & 3];
        // Lit warm from below by the flame they circle.
        const k = Math.min(1, 0.45 + m.near * 0.5) * Math.min(1, 0.4 + m.glow * 0.7);
        this.point(r, view, m.x, m.y, MOTH[frame], [235, 205, 160], k);
      }
    }
    for (const b of this.bats) {
      const frame = BEAT[Math.floor(b.beat) & 3];
      const sx = Math.floor(b.x) - view.x0;
      const sy = Math.floor(b.y) - view.y0;
      for (let p = 0; p < 3; p++) {
        const x = sx + p - 1;
        const part = p;
        if (x < 0 || sy < 0 || x >= r.cols || sy >= r.rows) continue;
        const o = (sy * r.cols + x) * 4;
        r.put(x, sy, BAT[frame][part], 5, 6, 10);
        r.layer(x, sy, BAT_RIM[frame][part], r.bg[o] * 0.3 + 100, r.bg[o + 1] * 0.3 + 116, r.bg[o + 2] * 0.3 + 150);
      }
    }
  }

  point(r, view, x, y, g, color, k) {
    const sx = Math.floor(x) - view.x0;
    const sy = Math.floor(y) - view.y0;
    if (sx < 0 || sy < 0 || sx >= r.cols || sy >= r.rows) return;
    const o = (sy * r.cols + sx) * 4;
    r.layer(sx, sy, g, r.bg[o] + (color[0] - r.bg[o]) * k, r.bg[o + 1] + (color[1] - r.bg[o + 1]) * k,
      r.bg[o + 2] + (color[2] - r.bg[o + 2]) * k);
  }
}
