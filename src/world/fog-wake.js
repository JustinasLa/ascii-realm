// How walkers push the ground fog around: a small fluid-like field, laid on
// the ground around the player, holding how much fog each patch really has.
//
// Fog is never destroyed. A walker moving through it shoves the fog ahead
// of them aside like a bow wave and drags the air behind along with them;
// the fog rides that air, so it piles up thicker in the fog around their
// path and curls into the gap behind them in eddies. Standing still, they
// only nudge it gently, so the fog creeps back around their legs. Over a few seconds the piles spread back and the
// patches fill in, until the fog lies as the undisturbed banks would.
//
// The field stores the fog as a difference from the undisturbed banks (see
// fog-banks.js), so the banks keep drifting and churning everywhere else.
// It is square in rows (columns are scaled by ASPECT), CELL rows per cell,
// and moves with the player in whole cells so it never smears.

import { valueNoise } from '../core/noise.js';
import { fogAt } from './fog-banks.js';
import { ASPECT } from './world.js';

// Cells across the field and their side in rows.
export const WAKE_CELLS = 48;
export const CELL = 2;
// How far above the feet a walker's body is centred, and the rough radius of
// the patch a walker shoves the fog out of, in rows.
const BODY_LIFT = 3;
export const SWEEP = 7;
// How fast fog is shoved out of the patch (rows per second), how much of a
// walker's own velocity the air near them picks up, and how hard the eddies
// in stirred air turn.
const PUSH = 16;
const STANDING_PUSH = 0.2;
const DRAG = 0.7;
const SWIRL = 14;
// Stirred air settles with this time constant (seconds). Piles of pushed fog
// spread at SPREAD (rows squared per second) and the field eases back to the
// undisturbed banks with time constant REFILL.
const SETTLE = 0.9;
const SPREAD = 4;
export const REFILL = 5;
// The field blends back into the undisturbed banks over this many cells at
// its edge, so its border never shows.
const BORDER = 5;
// The player, friends, spells in flight and the nearest monsters all stir
// the fog.
export const MAX_WALKERS = 20;
// Spells burst the fog outward and whirl it about. A burst's shove starts at
// this many times its radius per second; any air is held under MAX_WIND rows
// per second so a pile of spells cannot fling fog out of the field at once.
const BURST = 4;
const MAX_WIND = 60;
// A fast walker drags the air at no more than this, in rows per second.
const MAX_DRAG = 30;
// How hard something flying fast flings the fog out from its path, in rows
// per second for each stamp of its patch.
const FLING = 26;

export class FogWake {
  // `banks` gives the undisturbed fog at a point (see fog-banks.js).
  constructor({ cells = WAKE_CELLS, banks = fogAt } = {}) {
    this.cells = cells;
    this.size = cells * CELL;
    this.banks = banks;
    const n = cells * cells;
    // The fog's difference from the undisturbed banks, and the air's motion.
    this.delta = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this.base = new Float32Array(n);
    this.fog = new Float32Array(n);
    this._a = new Float32Array(n);
    this._b = new Float32Array(n);
    this._c = new Float32Array(n);
    // Per cell, the fog as it now lies and as the banks alone would put it,
    // for the renderer's texture.
    this.texels = new Float32Array(n * 2);
    // The ground (in rows) under the field's first cell's corner.
    this.ox = NaN;
    this.oy = NaN;
    this.time = 0;
    this.tracks = new Map();
  }

  // `walkers` lists who is moving through the fog, each as { id, x, y } in
  // world cells with their feet at y, optionally `size` (1 for the player)
  // and `lift`, how far above y the fog is pushed from (the body's middle
  // unless given); the first is the player, whom the field follows. `state`
  // places the banks: driftX, driftY, time and coverage. `spells` lists what
  // spells do to the fog this frame: `bursts` and `whirls`, each { x, y }
  // in world cells with a `radius` in rows and a `strength` (1 is full);
  // whirls also have a `spin`, positive clockwise on screen.
  update(dt, walkers, state, spells = {}) {
    this.time += dt;
    const live = (walkers ?? []).filter((w) => Number.isFinite(w?.x) && Number.isFinite(w?.y)).slice(0, MAX_WALKERS);
    if (live.length) this.follow(live[0].x * ASPECT, live[0].y - BODY_LIFT * sizeOf(live[0]));
    if (Number.isNaN(this.ox)) return;
    this.measure(state);
    const seen = new Set();
    for (const w of live) {
      seen.add(w.id);
      const size = sizeOf(w);
      const lift = Number.isFinite(w.lift) ? w.lift : BODY_LIFT * size;
      this.stir(dt, w.id, w.x * ASPECT, w.y - lift, size);
    }
    for (const b of (spells.bursts ?? []).slice(0, 32)) {
      if (Number.isFinite(b?.x) && Number.isFinite(b?.y)) this.burst(b.x * ASPECT, b.y, b.radius, b.strength);
    }
    if (dt > 0) {
      for (const w of (spells.whirls ?? []).slice(0, 32)) {
        if (Number.isFinite(w?.x) && Number.isFinite(w?.y)) this.whirl(dt, w.x * ASPECT, w.y, w.radius, w.spin, w.strength);
      }
    }
    for (const id of [...this.tracks.keys()]) if (!seen.has(id)) this.tracks.delete(id);
    if (dt > 0) {
      this.swirl(dt);
      this.carryAir(dt);
      this.carryFog(dt);
      this.settle(dt);
    }
    this.pack();
  }

  // Keeps the player near the middle, shifting the field by whole cells.
  follow(gx, gy) {
    const ox = Math.round((gx - this.size / 2) / CELL) * CELL;
    const oy = Math.round((gy - this.size / 2) / CELL) * CELL;
    if (Number.isNaN(this.ox)) {
      this.ox = ox;
      this.oy = oy;
      return;
    }
    const dx = (ox - this.ox) / CELL;
    const dy = (oy - this.oy) / CELL;
    if (Math.abs(dx) < this.cells / 8 && Math.abs(dy) < this.cells / 8) return;
    const n = this.cells;
    for (const field of ['delta', 'vx', 'vy']) {
      const from = this[field];
      const to = this._a;
      to.fill(0);
      for (let j = Math.max(0, -dy); j < Math.min(n, n - dy); j++) {
        for (let i = Math.max(0, -dx); i < Math.min(n, n - dx); i++) to[j * n + i] = from[(j + dy) * n + i + dx];
      }
      this[field] = to;
      this._a = from;
    }
    this.ox = ox;
    this.oy = oy;
  }

  // The fog every cell holds: the undisturbed banks plus what was pushed.
  measure(state) {
    const n = this.cells;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const c = j * n + i;
        const b = this.banks(this.ox + (i + 0.5) * CELL, this.oy + (j + 0.5) * CELL, state);
        this.base[c] = b;
        this.fog[c] = Math.max(0, b + this.delta[c]);
      }
    }
  }

  // A walker blows the air in a ragged patch around them outward and drags
  // it along their way.
  stir(dt, id, gx, gy, size = 1) {
    let track = this.tracks.get(id);
    // A teleport or respawn starts afresh rather than dragging the air.
    if (!track || Math.hypot(gx - track.x, gy - track.y) > SWEEP * 9) {
      track = { x: gx, y: gy, vx: 0, vy: 0, seed: (this.tracks.size + 1) * 17.3 };
      this.tracks.set(id, track);
    }
    if (dt > 0) {
      // Footsteps are smoothed; something flying fast is read at once.
      const vx = (gx - track.x) / dt;
      const vy = (gy - track.y) / dt;
      const k = Math.hypot(vx, vy) > 40 ? 1 : 1 - Math.exp(-8 * dt);
      track.vx += (vx - track.vx) * k;
      track.vy += (vy - track.vy) * k;
    }
    const fromX = track.x;
    const fromY = track.y;
    track.x = gx;
    track.y = gy;
    const speed = Math.hypot(track.vx, track.vy);
    const held = Math.min(1, MAX_DRAG / Math.max(speed, 1e-6));
    const moving = Math.min(1, speed / 6);
    const fx = speed > 1e-3 ? track.vx / speed : 0;
    const fy = speed > 1e-3 ? track.vy / speed : 0;
    const reach = SWEEP * size * (1 + Math.min(speed, 25) / 50);
    // Something fast, like a spell in flight, kicks the air harder.
    const pull = Math.min(1, dt * 8 * (1 + speed / 30));
    // A fast walker, like a spell in flight, covers more than its own patch
    // in a frame, so the patch is laid all along the way it came.
    const steps = Math.min(12, Math.max(1, Math.ceil(Math.hypot(gx - fromX, gy - fromY) / (reach * 0.5))));
    // Past a run, the fog beside the path is flung out sideways too, so a
    // spell in flight leaves a channel rather than a smear.
    const fast = Math.max(0, Math.min(1, (speed - 30) / 60));
    const shape = { track, reach, held, moving, fast, fx, fy, pull };
    for (let s = 1; s <= steps; s++) {
      this.stamp(fromX + (gx - fromX) * s / steps, fromY + (gy - fromY) * s / steps, shape);
    }
  }

  stamp(gx, gy, { track, reach, held, moving, fast, fx, fy, pull }) {
    const n = this.cells;
    const t = this.time * 0.6;
    const lx = (gx - this.ox) / CELL;
    const ly = (gy - this.oy) / CELL;
    const span = (reach * 1.4) / CELL;
    for (let j = Math.max(0, Math.floor(ly - span)); j <= Math.min(n - 1, Math.ceil(ly + span)); j++) {
      for (let i = Math.max(0, Math.floor(lx - span)); i <= Math.min(n - 1, Math.ceil(lx + span)); i++) {
        const ax = (i + 0.5 - lx) * CELL;
        const ay = (j + 0.5 - ly) * CELL;
        const d = Math.hypot(ax, ay);
        // The patch's edge wanders with direction and time, so it is never
        // round; right under the body the fog goes the way the walker faces
        // or, standing, some way the noise picks.
        const angle = d > 0.5 ? Math.atan2(ay, ax) : Math.atan2(track.vy, track.vx) || t;
        const ux = Math.cos(angle);
        const uy = Math.sin(angle);
        const r = reach * (0.5 + 1.0 * valueNoise(ux * 1.6 + t + track.seed, uy * 1.6 - t * 0.7, 913));
        const within = 1 - smooth(r * 0.9, r * 1.4, d);
        if (within <= 0) continue;
        // Fog ahead is shoved forward and aside; fog behind is not pushed
        // but dragged along into the gap the walker leaves.
        const ahead = ux * fx + uy * fy;
        const bow = moving * Math.max(0, 0.35 + ahead);
        const blow = PUSH * (STANDING_PUSH + bow) * (1 - smooth(r * 0.55, r * 1.15, d));
        const drag = DRAG * (1 - smooth(r * 0.3, r * 1.1, d));
        const px = ux + fx * 0.6 * moving;
        const py = uy + fy * 0.6 * moving;
        const c = j * n + i;
        this.vx[c] += (px * blow + track.vx * held * drag - this.vx[c]) * within * pull;
        this.vy[c] += (py * blow + track.vy * held * drag - this.vy[c]) * within * pull;
        if (fast > 0) {
          // Flung straight out from the path, added to whatever the air is
          // already doing so later stamps cannot undo it.
          const sx = ux - ahead * fx;
          const sy = uy - ahead * fy;
          const side = Math.hypot(sx, sy);
          if (side > 1e-3) {
            const fling = FLING * fast * within * (1 - smooth(r * 0.5, r * 1.2, d)) / side;
            this.vx[c] += sx * fling;
            this.vy[c] += sy * fling;
            limit(this.vx, this.vy, c);
          }
        }
      }
    }
  }

  // A spell going off throws the fog outward from a point, hardest a little
  // way out from the middle, in a ragged ring that the air then carries.
  burst(gx, gy, radius, strength = 1) {
    radius = clampRadius(radius);
    strength = Math.max(0, Math.min(1.5, Number.isFinite(strength) ? strength : 1));
    if (!radius || !strength) return;
    const seed = gx * 0.37 + gy * 0.71;
    this.around(gx, gy, radius * 1.4, (c, ux, uy, d) => {
      const r = radius * (0.55 + 0.6 * valueNoise(ux * 1.8 + seed, uy * 1.8, 541)
        + 0.25 * valueNoise(ux * 5 - seed, uy * 5, 542));
      const k = smooth(0, r * 0.3, d) * (1 - smooth(r * 0.7, r * 1.4, d));
      this.vx[c] += ux * BURST * radius * strength * k;
      this.vy[c] += uy * BURST * radius * strength * k;
      limit(this.vx, this.vy, c);
    });
  }

  // A lasting spell turns the fog around it, easing the air toward a ring of
  // wind that dies away at its middle and past its edge.
  whirl(dt, gx, gy, radius, spin = 1, strength = 1) {
    radius = clampRadius(radius);
    strength = Math.max(0, Math.min(1.5, Number.isFinite(strength) ? strength : 1));
    spin = Number.isFinite(spin) ? Math.max(-3, Math.min(3, spin)) : 1;
    if (!radius || !strength) return;
    const pull = Math.min(1, dt * 4) * strength;
    this.around(gx, gy, radius * 1.3, (c, ux, uy, d) => {
      const k = smooth(0, radius * 0.35, d) * (1 - smooth(radius * 0.7, radius * 1.3, d));
      const speed = radius * 2.5 * spin;
      const tx = -uy * speed + ux * radius * 0.3;
      const ty = ux * speed + uy * radius * 0.3;
      this.vx[c] += (tx - this.vx[c]) * k * pull;
      this.vy[c] += (ty - this.vy[c]) * k * pull;
      limit(this.vx, this.vy, c);
    });
  }

  // Calls `each(cell, ux, uy, distance)` for every cell within `reach` rows
  // of a point of the ground, with the unit direction out from it.
  around(gx, gy, reach, each) {
    const n = this.cells;
    const lx = (gx - this.ox) / CELL;
    const ly = (gy - this.oy) / CELL;
    const span = reach / CELL;
    for (let j = Math.max(0, Math.floor(ly - span)); j <= Math.min(n - 1, Math.ceil(ly + span)); j++) {
      for (let i = Math.max(0, Math.floor(lx - span)); i <= Math.min(n - 1, Math.ceil(lx + span)); i++) {
        const ax = (i + 0.5 - lx) * CELL;
        const ay = (j + 0.5 - ly) * CELL;
        const d = Math.hypot(ax, ay);
        if (d > reach) continue;
        each(j * n + i, d > 1e-6 ? ax / d : 1, d > 1e-6 ? ay / d : 0, d);
      }
    }
  }

  // Eddies: a slowly turning curl of noise, only where the air is moving.
  swirl(dt) {
    const n = this.cells;
    const t = this.time * 0.35;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const c = j * n + i;
        const moving = Math.hypot(this.vx[c], this.vy[c]);
        if (moving < 0.3) continue;
        const gx = (this.ox + (i + 0.5) * CELL) * 0.14;
        const gy = (this.oy + (j + 0.5) * CELL) * 0.14;
        const e = 0.5;
        const dny = valueNoise(gx, gy + e + t, 377) - valueNoise(gx, gy - e + t, 377);
        const dnx = valueNoise(gx + e - t, gy, 377) - valueNoise(gx - e - t, gy, 377);
        const w = SWIRL * Math.min(1, moving / 6) * dt / e;
        this.vx[c] += dny * w;
        this.vy[c] -= dnx * w;
      }
    }
  }

  // The air carries itself along and settles.
  carryAir(dt) {
    const n = this.cells;
    const calm = Math.exp(-dt / SETTLE);
    const vx = this._a;
    const vy = this._b;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const c = j * n + i;
        const bx = i - (this.vx[c] * dt) / CELL;
        const by = j - (this.vy[c] * dt) / CELL;
        vx[c] = sample(this.vx, n, bx, by) * calm;
        vy[c] = sample(this.vy, n, bx, by) * calm;
      }
    }
    this._a = this.vx;
    this._b = this.vy;
    this.vx = vx;
    this.vy = vy;
  }

  // The air carries the fog. Each cell hands a share of its fog to the
  // neighbours downwind, so fog is only ever moved, never lost.
  carryFog(dt) {
    const n = this.cells;
    const fog = this.fog;
    const next = this._c;
    next.set(fog);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const c = j * n + i;
        if (fog[c] <= 0) continue;
        let ax = (this.vx[c] * dt) / CELL;
        let ay = (this.vy[c] * dt) / CELL;
        const out = Math.abs(ax) + Math.abs(ay);
        if (out > 0.45) {
          ax *= 0.45 / out;
          ay *= 0.45 / out;
        }
        const ti = i + Math.sign(ax);
        const tj = j + Math.sign(ay);
        if (ax !== 0 && ti >= 0 && ti < n) {
          const m = fog[c] * Math.abs(ax);
          next[c] -= m;
          next[j * n + ti] += m;
        }
        if (ay !== 0 && tj >= 0 && tj < n) {
          const m = fog[c] * Math.abs(ay);
          next[c] -= m;
          next[tj * n + i] += m;
        }
      }
    }
    this._c = fog;
    this.fog = next;
  }

  // Piles of pushed fog spread out and everything eases back to the banks.
  settle(dt) {
    const n = this.cells;
    const delta = this._a;
    for (let c = 0; c < n * n; c++) delta[c] = this.fog[c] - this.base[c];
    const spread = Math.min(0.2, (SPREAD * dt) / (CELL * CELL));
    const ease = Math.exp(-dt / REFILL);
    const next = this.delta;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const c = j * n + i;
        const d = delta[c];
        const around = (i > 0 ? delta[c - 1] : d) + (i < n - 1 ? delta[c + 1] : d)
          + (j > 0 ? delta[c - n] : d) + (j < n - 1 ? delta[c + n] : d);
        next[c] = (d + spread * (around - 4 * d)) * ease;
      }
    }
    this._a = delta;
  }

  pack() {
    const n = this.cells;
    for (let j = 0; j < n; j++) {
      const ej = Math.min(j, n - 1 - j);
      for (let i = 0; i < n; i++) {
        const edge = Math.min(1, Math.min(ej, i, n - 1 - i) / BORDER);
        const c = j * n + i;
        const base = this.base[c];
        this.texels[c * 2] = Math.max(0, base + this.delta[c] * edge);
        this.texels[c * 2 + 1] = base;
      }
    }
  }

  // How much fog lies at a point of the ground (rows), as now pushed about.
  fogAt(gx, gy) {
    if (Number.isNaN(this.ox)) return null;
    return sample(this.fog, this.cells, (gx - this.ox) / CELL - 0.5, (gy - this.oy) / CELL - 0.5);
  }

  // All the fog in the field, which pushing never changes.
  total() {
    let sum = 0;
    for (const v of this.fog) sum += v;
    return sum;
  }
}

// Spell radii are held to what the field can show.
const clampRadius = (r) => (Number.isFinite(r) && r > 0 ? Math.min(r, 30) : 0);

function limit(vx, vy, c) {
  const speed = Math.hypot(vx[c], vy[c]);
  if (speed <= MAX_WIND) return;
  vx[c] *= MAX_WIND / speed;
  vy[c] *= MAX_WIND / speed;
}

const sizeOf = (w) => (Number.isFinite(w.size) && w.size > 0 ? Math.min(w.size, 3) : 1);

function smooth(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// Bilinear sample at a cell position, clamped to the field.
function sample(field, n, x, y) {
  x = Math.max(0, Math.min(n - 1, x));
  y = Math.max(0, Math.min(n - 1, y));
  const x0 = Math.min(n - 2, Math.floor(x));
  const y0 = Math.min(n - 2, Math.floor(y));
  const tx = x - x0;
  const ty = y - y0;
  const c = y0 * n + x0;
  const top = field[c] + (field[c + 1] - field[c]) * tx;
  const bottom = field[c + n] + (field[c + n + 1] - field[c + n]) * tx;
  return top + (bottom - top) * ty;
}
