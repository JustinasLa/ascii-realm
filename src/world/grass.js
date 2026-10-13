import { valueNoise } from '../core/noise.js';
import { hash2 } from '../core/rng.js';
import { SCALE, TILT } from '../entities/rig.js';
import { putCell } from '../render/cells.js';
import { glyph } from '../render/glyphs.js';
import { ASPECT, CHUNK_SIZE, WATER } from './world.js';

export const MAX_GRASS_HEIGHT = 5;
const SIDE_PAD = 6;
const SOLE_RADIUS = SCALE * 0.1;
const HOLD = 0.25;
const LIFE = 2;
const MAX_BENDS = 1024;
const MAX_TRACKS = 8192;
const TRACK_MEMORY = 45;
const STEM = glyph('|');
const LEFT = glyph('\\');
const RIGHT = glyph('/');
const SEED_HEAD = glyph('"');
const FLAT = glyph('-');
const LEAF = glyph('Y');
const DOT = glyph('.');
const SEED = glyph(':');
const FINE = glyph("'");
const DRY = glyph('`');
// Fine blue-green blades, leafy tufts, curved emerald grass, seed heads,
// dry gold grass, and olive shoreline reeds.
const PALETTES = [
  [54, 126, 104], [78, 144, 64], [46, 134, 72],
  [100, 142, 82], [138, 132, 72], [106, 134, 72],
];

function drawBlade(r, view, write, x, y, height, lean, press, light, tone, head) {
  const rise = (height - 1) * (1 - Math.min(1, press) * 0.88);
  const base = y - view.y0;
  const steps = Math.ceil(height + Math.abs(lean) * 2);
  let lastX = 0;
  let lastY = 0;
  for (let k = 0; k <= steps; k++) {
    const u = k / steps;
    const offset = Math.round(lean * u * u);
    const sy = base - Math.round(rise * u);
    if (k && offset === lastX && sy === lastY && k !== steps) continue;
    let ch = k && sy === lastY && offset !== lastX ? FLAT :
      offset < lastX ? LEFT : offset > lastX ? RIGHT : STEM;
    if (k === steps) ch = press > 0.6 ? FLAT : head || (lean < 0 ? LEFT : RIGHT);
    const l = light * (0.55 + u * 0.6);
    write(r, x - view.x0 + offset, sy, ch, tone[0] * l, tone[1] * l, tone[2] * l, base);
    lastX = offset;
    lastY = sy;
  }
}

// One gust per rooted blade: upper segments follow the same wave as the base.
export function grassWind(x, y, t, seed, rnd) {
  return (valueNoise(x * ASPECT * 0.035 - t * 0.18, y * 0.035 + t * 0.04,
    seed + 900) - 0.42) * 2.4 + Math.sin(t * 2.6 + rnd * 40) * 0.1;
}

export class Grass {
  constructor() {
    this.bends = new Map();
    this.previous = null;
    this.previousSword = null;
    this.tracks = new Map();
    this.previousFeet = new Map();
  }

  bendAt(x, y, t) {
    return this.effectAt(x, y, t, 'lean');
  }

  pressAt(x, y, t) {
    return this.effectAt(x, y, t, 'press');
  }

  effectAt(x, y, t, field) {
    const bend = this.bends.get(`${x},${y}`);
    // A short hold followed by a smooth, critically damped spring-back.
    const age = bend ? Math.max(0, t - bend.t - HOLD) : 0;
    const transient = bend && t - bend.t < LIFE ? (1 + age * 5) * Math.exp(-age * 5) : 0;
    const track = this.tracks.get(`${x},${y}`);
    const lasting = this.trackRecovery(track, t);
    return (track?.press || 0) * lasting > (bend?.press || 0) * transient ?
      (track[field] || 0) * lasting : (bend?.[field] || 0) * transient;
  }

  trackRecovery(track, t) {
    if (!track) return 0;
    const u = Math.max(0, Math.min(1, (t - track.until) / track.recover));
    return 1 - u * u * (3 - 2 * u);
  }

  update(world, player, t) {
    for (const [key, bend] of this.bends) {
      if (t - bend.t >= LIFE) this.bends.delete(key);
    }
    for (const [key, track] of this.tracks) {
      if (t - track.t > TRACK_MEMORY) this.tracks.delete(key);
    }
    const prev = this.previous;
    this.previous = { x: player.x, y: player.y, air: player.air, t };
    // A sword wake follows the animated blade's swept ground footprint,
    // including the strip between frames. Idle/drawn swords produce no wake.
    const sword = player.swordSweep;
    const lastSword = this.previousSword;
    this.previousSword = sword;
    if (sword && player.air < 0.25 && (!lastSword || sword.t !== lastSword.t)) {
      this.disturb(world, sword.hx, sword.hy, sword.tx, sword.ty, 2.4, t, 0, 1);
      if (lastSword && sword.t - lastSword.t < 0.12 &&
        Math.hypot((sword.hx - lastSword.hx) * ASPECT, sword.hy - lastSword.hy) < 8) {
        const push = Math.sign(sword.tx - lastSword.tx);
        for (let i = 0; i <= 4; i++) {
          const u = i / 4;
          this.disturb(world,
            lastSword.hx + (lastSword.tx - lastSword.hx) * u,
            lastSword.hy + (lastSword.ty - lastSword.hy) * u,
            sword.hx + (sword.tx - sword.hx) * u,
            sword.hy + (sword.ty - sword.hy) * u, 2.4, t, push, 1);
        }
      }
    }
    // Only grounded boot soles touch grass. Sweep each planted sole, not the
    // character's centre, so the untouched ground between/beside steps stays up.
    const elapsed = prev ? Math.max(0, t - prev.t) : 0;
    const continuous = prev && !prev.air && !player.air && Math.hypot((player.x - prev.x) * ASPECT / SCALE,
      (player.y - prev.y) / (SCALE * TILT)) <= 3.5 * Math.min(elapsed, 0.1) + 0.05;
    const oldFeet = this.previousFeet;
    this.previousFeet = new Map();
    for (const foot of player.feet || []) {
      this.previousFeet.set(foot.id, foot);
      if (player.air > 0 || !foot.grounded) continue;
      const old = oldFeet.get(foot.id);
      const from = continuous && old?.grounded && old.plant === foot.plant ? old : null;
      const direction = continuous ? Math.sign(player.x - prev.x) : 0;
      this.trample(world, foot, from, t, direction);
    }
  }

  trample(world, foot, from, t, direction) {
    const stamp = (ax, ay, bx, by) => this.contactRoots(world, ax, ay, bx, by,
      SOLE_RADIUS, 1 / TILT, (x, y, rnd, side, weight) => {
        const key = `${x},${y}`;
        const old = this.tracks.get(key);
        const lastPlant = old?.plants[foot.id];
        const fresh = lastPlant?.id !== foot.plant;
        const added = fresh ? weight : Math.max(0, weight - lastPlant.weight);
        const wear = Math.min(10, (fresh && old ? old.wear * Math.exp(-(t - old.passAt) / 30) : old?.wear || 0) + added);
        const pressure = Math.max(old ? old.press * this.trackRecovery(old, t) : 0, 0.75 + weight * 0.25);
        const plants = old?.plants || {};
        plants[foot.id] = { id: foot.plant, weight: fresh ? weight : Math.max(weight, lastPlant.weight) };
        const lean = (direction || Math.sign(side) || (rnd < 0.5 ? -1 : 1)) * pressure;
        this.tracks.delete(key);
        this.tracks.set(key, { x, y, press: pressure, lean, wear, plants, t,
          passAt: added > 0 ? t : old.passAt, until: t + 2 + wear * 1.15, recover: 1.7 + wear * 0.4 });
        if (this.tracks.size > MAX_TRACKS) this.tracks.delete(this.tracks.keys().next().value);
      });
    stamp(foot.hx, foot.hy, foot.tx, foot.ty);
    if (from) {
      // Corresponding points cover the thin strip swept by a sliding sole.
      for (let i = 0; i <= 2; i++) {
        const u = i / 2;
        stamp(from.hx + (from.tx - from.hx) * u, from.hy + (from.ty - from.hy) * u,
          foot.hx + (foot.tx - foot.hx) * u, foot.hy + (foot.ty - foot.hy) * u);
      }
    }
  }

  disturb(world, ax, ay, bx, by, radius, t, push, strength) {
    this.contactRoots(world, ax, ay, bx, by, radius, 1, (x, y, rnd, side, weight) => {
      const press = weight * strength;
      const lean = ((Math.sign(side) || (rnd < 0.5 ? -1 : 1)) + push) * press;
      const key = `${x},${y}`;
      const old = this.bends.get(key);
      if (old?.t === t && old.press > press) return;
      this.bends.delete(key);
      this.bends.set(key, { lean, press, t });
      if (this.bends.size > MAX_BENDS) this.bends.delete(this.bends.keys().next().value);
    });
  }

  contactRoots(world, ax, ay, bx, by, radius, yScale, visit) {
    const dx = (bx - ax) * ASPECT;
    const dy = (by - ay) * yScale;
    const length2 = dx * dx + dy * dy;
    for (let y = Math.floor(Math.min(ay, by) - radius / yScale);
      y <= Math.ceil(Math.max(ay, by) + radius / yScale); y++) {
      for (let x = Math.floor(Math.min(ax, bx) - radius / ASPECT);
        x <= Math.ceil(Math.max(ax, bx) + radius / ASPECT); x++) {
        const { c, i } = world.locate(x, y);
        if (!c.grassHeight[i]) continue;
        const px = (x + 0.5 - ax) * ASPECT;
        const py = (y + 0.5 - ay) * yScale;
        const u = length2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / length2)) : 0;
        const side = px - u * dx;
        const distance2 = side * side + (py - u * dy) ** 2;
        if (distance2 >= radius * radius) continue;
        visit(x, y, c.rnd[i], side, Math.sqrt(1 - distance2 / (radius * radius)));
      }
    }
  }

  drawTracks(r, view, t) {
    for (const track of this.tracks.values()) {
      const sx = track.x - view.x0;
      const sy = track.y - view.y0;
      if (sx < 0 || sy < 0 || sx >= view.cols || sy >= view.rows) continue;
      const pressure = track.press * this.trackRecovery(track, t);
      if (pressure < 0.1) continue;
      const o = (sy * r.cols + sx) * 4;
      const dim = 1 - pressure * 0.18;
      r.fg[o] *= dim;
      r.fg[o + 1] *= dim;
      r.fg[o + 2] *= dim;
      if (pressure > 0.5) r.fg[o + 3] = FLAT;
    }
  }

  drawRow(r, world, view, t, y, write = putCell) {
    const cy = Math.floor(y / CHUNK_SIZE);
    let chunk = null;
    let lastCx;
    for (let x = view.x0 - SIDE_PAD; x < view.x0 + view.cols + SIDE_PAD; x++) {
      const cx = Math.floor(x / CHUNK_SIZE);
      if (!chunk || cx !== lastCx) {
        chunk = world.chunk(cx, cy);
        lastCx = cx;
      }
      const i = (y - cy * CHUNK_SIZE) * CHUNK_SIZE + x - cx * CHUNK_SIZE;
      const rnd = chunk.rnd[i];
      const profile = chunk.grassHeight[i];
      const style = chunk.grassStyle?.[i] ?? (chunk.reeds[i] ? 5 : 0);
      const density = (chunk.grassDensity?.[i] ?? 0.26) * (style === 1 ? 0.72 : style === 4 ? 0.85 : 1);
      if (profile < 2 || rnd < 1 - density) continue;
      const height = Math.min(MAX_GRASS_HEIGHT,
        Math.floor(profile + hash2(x, y, world.seed + 1101)));
      const bend = this.bendAt(x, y, t);
      const press = this.pressAt(x, y, t);
      const wind = grassWind(x, y, t, world.seed, rnd);
      const variation = hash2(x, y, world.seed + 1217);
      const curve = (variation - 0.5) * (style === 2 ? 2.2 : 0.6) * (1 - press);
      const lean = Math.max(-4, Math.min(4, wind * Math.min(1.3, height * 0.35) + curve + bend * 2.8));
      const light = (0.48 + chunk.shade[i] * 0.65 + Math.max(0, wind) * 0.1) * (0.85 + variation * 0.3);
      const head = style === 5 ? SEED_HEAD : style === 3 ? (variation < 0.5 ? DOT : SEED) :
        style === 4 ? DRY : style === 0 && variation > 0.6 ? FINE : style === 1 && variation > 0.75 ? LEAF : 0;
      const tone = PALETTES[style];
      drawBlade(r, view, write, x, y, height, lean, press, light, tone, head);
      if (style === 1 || (style === 4 && variation > 0.55)) {
        const fan = Math.max(-4, Math.min(4, lean + (variation < 0.5 ? -1.6 : 1.6) * (1 - press * 0.7)));
        drawBlade(r, view, write, x, y, Math.max(2, height - 1), fan, press, light * 0.85,
          tone, style === 4 ? FINE : 0);
      }
    }
  }

  drawReflections(r, world, view, t, write, drawables = []) {
    if (!r.mask.includes(WATER)) return;
    this.drawRows(r, world, view, t, view.y0 - MAX_GRASS_HEIGHT - 1,
      view.y0 + view.rows, drawables, write);
  }

  // Interleave root rows with the existing small list of sorted sprites.
  // This avoids allocating and sorting a drawable for every meadow blade.
  drawLayered(r, world, view, t, drawables) {
    this.drawRows(r, world, view, t, view.y0,
      view.y0 + view.rows + MAX_GRASS_HEIGHT, drawables, putCell);
  }

  drawRows(r, world, view, t, first, last, drawables, write) {
    let i = 0;
    for (let y = first; y < last; y++) {
      while (i < drawables.length && drawables[i].y <= y + 0.5) drawables[i++].draw();
      this.drawRow(r, world, view, t, y, write);
    }
    while (i < drawables.length) drawables[i++].draw();
  }
}
