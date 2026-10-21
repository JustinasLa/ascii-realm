// How walkers push the ground fog around: a small fluid-like field, laid on
// the ground under the whole view, holding how much fog each patch really
// has.
//
// Fog is never destroyed. A walker moving through it shoves the fog ahead
// of them aside like a bow wave and drags the air behind along with them;
// the fog rides that air, so it piles up thicker in the fog around their
// path and curls into the gap behind them in eddies. Standing still, they
// only nudge it gently, so the fog creeps back around their legs. Over a few
// seconds the piles spread back and the patches fill in, until the fog lies
// as the undisturbed banks would.
//
// The field stores the fog as a difference from the undisturbed banks (see
// fog-banks.js), so the banks keep drifting and churning everywhere else.
// It works in rows (columns are scaled by ASPECT) and covers the view with a
// margin beyond every edge, where it fades back into the banks out of
// sight. It moves with the view a cell at a time so it never smears, and
// its cells are coarser when zoomed out so its cost stays bounded.

import { valueNoise } from '../core/noise.js';
import { fogAt } from './fog-banks.js';
import { ASPECT } from './world.js';

// The side of a cell in rows, finest first, and the most cells the field
// may have; the finest size that fits is used.
export const CELL_SIZES = [2, 3, 4, 6, 8];
export const MAX_CELLS = 6000;
// Cells of margin beyond each edge of the view: the fade and a little room.
const MARGIN = 7;
// Where nothing gives the view, the field is this many rows each way around
// the first walker.
const DEFAULT_SPAN = 96;
// The undisturbed banks drift slowly, so a third of the rows are worked out
// afresh each frame.
const REFRESH = 3;
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
// its edge, which lies beyond the view.
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
  constructor({ banks = fogAt, maxCells = MAX_CELLS } = {}) {
    this.banks = banks;
    this.maxCells = maxCells;
    // The side of a cell in rows.
    this.cell = CELL_SIZES[0];
    // The ground (in rows) under the field's first cell's corner.
    this.ox = NaN;
    this.oy = NaN;
    this.time = 0;
    this.frame = 0;
    this.tracks = new Map();
    this.allocate(0, 0);
  }

  // Makes room for a field `w` cells across and `h` down.
  allocate(w, h) {
    const n = w * h;
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
    this.w = w;
    this.h = h;
  }

  // The field's extent in rows.
  get width() { return this.w * this.cell; }
  get height() { return this.h * this.cell; }

  // `walkers` lists who is moving through the fog, each as { id, x, y } in
  // world cells with their feet at y, optionally `size` (1 for the player)
  // and `lift`, how far above y the fog is pushed from (the body's middle
  // unless given). `state` places the banks: driftX, driftY, time and
  // coverage. `spells` lists what spells do to the fog this frame: `bursts`
  // and `whirls`, each { x, y } in world cells with a `radius` in rows and a
  // `strength` (1 is full); whirls also have a `spin`, positive clockwise on
  // screen. `area` is the ground the view shows, { x, y, w, h } in rows;
  // without it the field centres on the first walker.
  update(dt, walkers, state, spells = {}, area = null) {
    this.time += dt;
    this.frame++;
    const live = (walkers ?? []).filter((w) => Number.isFinite(w?.x) && Number.isFinite(w?.y)).slice(0, MAX_WALKERS);
    if (!validArea(area) && live.length) {
      const gx = live[0].x * ASPECT;
      const gy = live[0].y - BODY_LIFT * sizeOf(live[0]);
      area = { x: gx - DEFAULT_SPAN / 2, y: gy - DEFAULT_SPAN / 2, w: DEFAULT_SPAN, h: DEFAULT_SPAN };
    }
    if (validArea(area)) this.cover(area, state);
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

  // Lays the field over the view and its margin, in whole cells of the
  // finest size that fits. Panning shifts what is already there; a new cell
  // size or shape carries it over by resampling.
  cover(area, state) {
    const pad = 2 * MARGIN;
    const cell = CELL_SIZES.find((c) => (Math.ceil(area.w / c) + pad) * (Math.ceil(area.h / c) + pad) <= this.maxCells)
      ?? CELL_SIZES.at(-1);
    // Rounded up so a little zooming does not remake the field every frame.
    const w = Math.ceil((Math.ceil(area.w / cell) + pad) / 4) * 4;
    const h = Math.ceil((Math.ceil(area.h / cell) + pad) / 4) * 4;
    const ox = Math.floor((area.x + area.w / 2) / cell - w / 2) * cell;
    const oy = Math.floor((area.y + area.h / 2) / cell - h / 2) * cell;
    if (Number.isNaN(this.ox)) {
      this.cell = cell;
      this.allocate(w, h);
      this.ox = ox;
      this.oy = oy;
      this.refresh(state, 0, h);
      return;
    }
    if (cell !== this.cell || w !== this.w || h !== this.h) {
      this.regrid(cell, w, h, ox, oy, state);
      return;
    }
    const dx = (ox - this.ox) / cell;
    const dy = (oy - this.oy) / cell;
    if (!dx && !dy) return;
    for (const field of ['delta', 'vx', 'vy', 'base']) {
      const from = this[field];
      const to = this._a;
      to.fill(0);
      for (let j = Math.max(0, -dy); j < Math.min(h, h - dy); j++) {
        for (let i = Math.max(0, -dx); i < Math.min(w, w - dx); i++) to[j * w + i] = from[(j + dy) * w + i + dx];
      }
      this[field] = to;
      this._a = from;
    }
    this.ox = ox;
    this.oy = oy;
    // The banks under the cells that just came into the field.
    if (Math.abs(dx) >= w || Math.abs(dy) >= h) {
      this.refresh(state, 0, h);
      return;
    }
    if (dy > 0) this.refresh(state, h - dy, h);
    if (dy < 0) this.refresh(state, 0, -dy);
    if (dx) {
      const from = dx > 0 ? w - dx : 0;
      const to = dx > 0 ? w : -dx;
      for (let j = 0; j < h; j++) {
        for (let i = from; i < to; i++) this.base[j * w + i] = this.bankAt(i, j, state);
      }
    }
  }

  // Remakes the field at a new cell size or shape, carrying the pushed fog
  // and the moving air over.
  regrid(cell, w, h, ox, oy, state) {
    const old = { w: this.w, h: this.h, cell: this.cell, ox: this.ox, oy: this.oy,
      delta: this.delta, vx: this.vx, vy: this.vy };
    this.cell = cell;
    this.allocate(w, h);
    this.ox = ox;
    this.oy = oy;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const x = (ox + (i + 0.5) * cell - old.ox) / old.cell - 0.5;
        const y = (oy + (j + 0.5) * cell - old.oy) / old.cell - 0.5;
        if (x < -0.5 || y < -0.5 || x > old.w - 0.5 || y > old.h - 0.5) continue;
        const c = j * w + i;
        this.delta[c] = sample(old.delta, old.w, old.h, x, y);
        this.vx[c] = sample(old.vx, old.w, old.h, x, y);
        this.vy[c] = sample(old.vy, old.w, old.h, x, y);
      }
    }
    this.refresh(state, 0, h);
  }

  bankAt(i, j, state) {
    return this.banks(this.ox + (i + 0.5) * this.cell, this.oy + (j + 0.5) * this.cell, state);
  }

  // Works out the undisturbed banks afresh for rows `from` up to `to`.
  refresh(state, from, to) {
    for (let j = from; j < to; j++) {
      for (let i = 0; i < this.w; i++) this.base[j * this.w + i] = this.bankAt(i, j, state);
    }
  }

  // The fog every cell holds: the undisturbed banks plus what was pushed.
  // The banks drift slowly, so each frame only every REFRESH-th row of them
  // is worked out again.
  measure(state) {
    for (let j = this.frame % REFRESH; j < this.h; j += REFRESH) this.refresh(state, j, j + 1);
    for (let c = 0; c < this.w * this.h; c++) this.fog[c] = Math.max(0, this.base[c] + this.delta[c]);
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
    const t = this.time * 0.6;
    this.around(gx, gy, reach * 1.4, (c, ux, uy, d) => {
      // The patch's edge wanders with direction and time, so it is never
      // round; right under the body the fog goes the way the walker faces
      // or, standing, some way the noise picks.
      if (d <= 0.5) {
        const angle = Math.atan2(track.vy, track.vx) || t;
        ux = Math.cos(angle);
        uy = Math.sin(angle);
      }
      const r = reach * (0.5 + 1.0 * valueNoise(ux * 1.6 + t + track.seed, uy * 1.6 - t * 0.7, 913));
      const within = 1 - smooth(r * 0.9, r * 1.4, d);
      if (within <= 0) return;
      // Fog ahead is shoved forward and aside; fog behind is not pushed
      // but dragged along into the gap the walker leaves.
      const ahead = ux * fx + uy * fy;
      const bow = moving * Math.max(0, 0.35 + ahead);
      const blow = PUSH * (STANDING_PUSH + bow) * (1 - smooth(r * 0.55, r * 1.15, d));
      const drag = DRAG * (1 - smooth(r * 0.3, r * 1.1, d));
      const px = ux + fx * 0.6 * moving;
      const py = uy + fy * 0.6 * moving;
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
    });
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
    const { w, h, cell } = this;
    const lx = (gx - this.ox) / cell;
    const ly = (gy - this.oy) / cell;
    const span = reach / cell;
    for (let j = Math.max(0, Math.floor(ly - span)); j <= Math.min(h - 1, Math.ceil(ly + span)); j++) {
      for (let i = Math.max(0, Math.floor(lx - span)); i <= Math.min(w - 1, Math.ceil(lx + span)); i++) {
        const ax = (i + 0.5 - lx) * cell;
        const ay = (j + 0.5 - ly) * cell;
        const d = Math.hypot(ax, ay);
        if (d > reach) continue;
        each(j * w + i, d > 1e-6 ? ax / d : 1, d > 1e-6 ? ay / d : 0, d);
      }
    }
  }

  // Eddies: a slowly turning curl of noise, only where the air is moving.
  swirl(dt) {
    const { w, h, cell } = this;
    const t = this.time * 0.35;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const c = j * w + i;
        const moving = Math.hypot(this.vx[c], this.vy[c]);
        if (moving < 0.3) continue;
        const gx = (this.ox + (i + 0.5) * cell) * 0.14;
        const gy = (this.oy + (j + 0.5) * cell) * 0.14;
        const e = 0.5;
        const dny = valueNoise(gx, gy + e + t, 377) - valueNoise(gx, gy - e + t, 377);
        const dnx = valueNoise(gx + e - t, gy, 377) - valueNoise(gx - e - t, gy, 377);
        const k = SWIRL * Math.min(1, moving / 6) * dt / e;
        this.vx[c] += dny * k;
        this.vy[c] -= dnx * k;
      }
    }
  }

  // The air carries itself along and settles.
  carryAir(dt) {
    const { w, h, cell } = this;
    const calm = Math.exp(-dt / SETTLE);
    const vx = this._a;
    const vy = this._b;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const c = j * w + i;
        const bx = i - (this.vx[c] * dt) / cell;
        const by = j - (this.vy[c] * dt) / cell;
        vx[c] = sample(this.vx, w, h, bx, by) * calm;
        vy[c] = sample(this.vy, w, h, bx, by) * calm;
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
    const { w, h, cell } = this;
    const fog = this.fog;
    const next = this._c;
    next.set(fog);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const c = j * w + i;
        if (fog[c] <= 0) continue;
        let ax = (this.vx[c] * dt) / cell;
        let ay = (this.vy[c] * dt) / cell;
        const out = Math.abs(ax) + Math.abs(ay);
        if (out > 0.45) {
          ax *= 0.45 / out;
          ay *= 0.45 / out;
        }
        const ti = i + Math.sign(ax);
        const tj = j + Math.sign(ay);
        if (ax !== 0 && ti >= 0 && ti < w) {
          const m = fog[c] * Math.abs(ax);
          next[c] -= m;
          next[j * w + ti] += m;
        }
        if (ay !== 0 && tj >= 0 && tj < h) {
          const m = fog[c] * Math.abs(ay);
          next[c] -= m;
          next[tj * w + i] += m;
        }
      }
    }
    this._c = fog;
    this.fog = next;
  }

  // Piles of pushed fog spread out and everything eases back to the banks.
  settle(dt) {
    const { w, h, cell } = this;
    const delta = this._a;
    for (let c = 0; c < w * h; c++) delta[c] = this.fog[c] - this.base[c];
    const spread = Math.min(0.2, (SPREAD * dt) / (cell * cell));
    const ease = Math.exp(-dt / REFILL);
    const next = this.delta;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const c = j * w + i;
        const d = delta[c];
        const around = (i > 0 ? delta[c - 1] : d) + (i < w - 1 ? delta[c + 1] : d)
          + (j > 0 ? delta[c - w] : d) + (j < h - 1 ? delta[c + w] : d);
        next[c] = (d + spread * (around - 4 * d)) * ease;
      }
    }
    this._a = delta;
  }

  pack() {
    const { w, h } = this;
    for (let j = 0; j < h; j++) {
      const ej = Math.min(j, h - 1 - j);
      for (let i = 0; i < w; i++) {
        const edge = Math.min(1, Math.min(ej, i, w - 1 - i) / BORDER);
        const c = j * w + i;
        const base = this.base[c];
        this.texels[c * 2] = Math.max(0, base + this.delta[c] * edge);
        this.texels[c * 2 + 1] = base;
      }
    }
  }

  // How much fog lies at a point of the ground (rows), as now pushed about.
  fogAt(gx, gy) {
    if (Number.isNaN(this.ox)) return null;
    return sample(this.fog, this.w, this.h, (gx - this.ox) / this.cell - 0.5, (gy - this.oy) / this.cell - 0.5);
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

const validArea = (a) => a && [a.x, a.y, a.w, a.h].every(Number.isFinite) && a.w > 0 && a.h > 0;

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

// Bilinear sample at a cell position, clamped to a field `w` by `h` cells.
function sample(field, w, h, x, y) {
  x = Math.max(0, Math.min(w - 1, x));
  y = Math.max(0, Math.min(h - 1, y));
  const x0 = Math.max(0, Math.min(w - 2, Math.floor(x)));
  const y0 = Math.max(0, Math.min(h - 2, Math.floor(y)));
  const tx = x - x0;
  const ty = y - y0;
  const c = y0 * w + x0;
  const top = field[c] + (field[c + 1] - field[c]) * tx;
  const bottom = field[c + w] + (field[c + w + 1] - field[c + w]) * tx;
  return top + (bottom - top) * ty;
}
