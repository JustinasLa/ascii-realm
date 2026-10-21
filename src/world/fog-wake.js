// How walkers stir the ground fog: a small fluid-like field, laid on the
// ground around the player, that says how much of the fog has been swept
// out of each patch.
//
// A walker sweeps fog out of a ragged patch around their body and drags the
// air there along with them. The swept patches then ride that moving air,
// curl into eddies and slowly fill back in, so the fog thins, swirls and
// closes behind a walker the way real mist does instead of opening in a
// clean circle. The renderer samples the field with its edges frayed by
// noise (see renderer.js).
//
// The field is square in rows (columns are scaled by ASPECT), one cell per
// row, and moves with the player in whole cells so it never smears.

import { valueNoise } from '../core/noise.js';
import { ASPECT } from './world.js';

// Side of the field, in rows.
export const WAKE_SIZE = 96;
// How far above the feet a walker's body is centred, and the rough radius
// of the patch a walker sweeps clear, in rows.
const BODY_LIFT = 3;
export const SWEEP = 7;
// Swept fog creeps back with this time constant, in seconds; the air a
// walker stirs settles a little faster.
export const REFILL = 2.4;
const SETTLE = 1.4;
// How much of a walker's velocity the air around them picks up, and how
// hard the eddies stirred into swept patches turn.
const DRAG = 0.75;
const SWIRL = 7;
// The field fades out over this many cells at its edge so its border never
// shows as a line.
const BORDER = 8;
const MAX_WALKERS = 4;

export class FogWake {
  constructor(size = WAKE_SIZE) {
    this.size = size;
    const n = size * size;
    this.clear = new Float32Array(n);
    this.vx = new Float32Array(n);
    this.vy = new Float32Array(n);
    this._clear = new Float32Array(n);
    this._vx = new Float32Array(n);
    this._vy = new Float32Array(n);
    // The cleared amount as bytes for the renderer's texture.
    this.bytes = new Uint8Array(n);
    // The ground (in rows) under the field's first cell.
    this.ox = NaN;
    this.oy = NaN;
    this.time = 0;
    this.tracks = new Map();
  }

  // `walkers` lists who is moving through the fog, each as { id, x, y } in
  // world cells with their feet at y. The first is the player, whom the
  // field follows.
  update(dt, walkers = []) {
    this.time += dt;
    const live = walkers.filter((w) => Number.isFinite(w?.x) && Number.isFinite(w?.y)).slice(0, MAX_WALKERS);
    if (live.length) this.follow(live[0].x * ASPECT, live[0].y - BODY_LIFT);
    if (Number.isNaN(this.ox)) return;
    const seen = new Set();
    for (const w of live) {
      seen.add(w.id);
      this.sweep(dt, w.id, w.x * ASPECT, w.y - BODY_LIFT);
    }
    for (const id of [...this.tracks.keys()]) if (!seen.has(id)) this.tracks.delete(id);
    if (dt > 0) this.flow(dt);
    this.pack();
  }

  // Keeps the player near the middle, shifting the field by whole cells.
  follow(gx, gy) {
    const half = this.size / 2;
    const ox = Math.round(gx - half);
    const oy = Math.round(gy - half);
    if (Number.isNaN(this.ox)) {
      this.ox = ox;
      this.oy = oy;
      return;
    }
    const dx = ox - this.ox;
    const dy = oy - this.oy;
    if (Math.abs(dx) < this.size / 8 && Math.abs(dy) < this.size / 8) return;
    for (const field of ['clear', 'vx', 'vy']) {
      const from = this[field];
      const to = this['_' + field];
      to.fill(0);
      for (let j = 0; j < this.size; j++) {
        const sj = j + dy;
        if (sj < 0 || sj >= this.size) continue;
        for (let i = 0; i < this.size; i++) {
          const si = i + dx;
          if (si >= 0 && si < this.size) to[j * this.size + i] = from[sj * this.size + si];
        }
      }
      this[field] = to;
      this['_' + field] = from;
    }
    this.ox = ox;
    this.oy = oy;
  }

  // A walker sweeps a ragged patch clear and drags the air there along.
  sweep(dt, id, gx, gy) {
    let track = this.tracks.get(id);
    // A teleport or respawn starts afresh rather than dragging the air.
    if (!track || Math.hypot(gx - track.x, gy - track.y) > SWEEP * 4) {
      track = { x: gx, y: gy, vx: 0, vy: 0, seed: this.tracks.size * 17.3 };
      this.tracks.set(id, track);
    }
    if (dt > 0) {
      const k = 1 - Math.exp(-8 * dt);
      track.vx += ((gx - track.x) / dt - track.vx) * k;
      track.vy += ((gy - track.y) / dt - track.vy) * k;
    }
    track.x = gx;
    track.y = gy;
    const speed = Math.hypot(track.vx, track.vy);
    const reach = SWEEP * (1 + Math.min(speed, 25) / 50);
    const lx = gx - this.ox;
    const ly = gy - this.oy;
    const take = Math.min(1, dt * 7);
    const pull = Math.min(1, dt * 5);
    const t = this.time * 0.6;
    for (let j = Math.max(0, Math.floor(ly - reach * 1.3)); j <= Math.min(this.size - 1, Math.ceil(ly + reach * 1.3)); j++) {
      for (let i = Math.max(0, Math.floor(lx - reach * 1.3)); i <= Math.min(this.size - 1, Math.ceil(lx + reach * 1.3)); i++) {
        const ax = i + 0.5 - lx;
        const ay = j + 0.5 - ly;
        const d = Math.hypot(ax, ay);
        // The edge of the patch wanders with the direction around the body
        // and with time, so it is never round.
        const u = d > 1e-6 ? ax / d : 1;
        const v = d > 1e-6 ? ay / d : 0;
        const r = reach * (0.7 + 0.6 * valueNoise(u * 1.4 + t + track.seed, v * 1.4 - t * 0.7, 913));
        const f = 1 - smooth(r * 0.3, r * 1.1, d);
        if (f <= 0) continue;
        const c = j * this.size + i;
        this.clear[c] += (0.92 - this.clear[c]) * f * take;
        this.vx[c] += (track.vx * DRAG - this.vx[c]) * f * pull;
        this.vy[c] += (track.vy * DRAG - this.vy[c]) * f * pull;
      }
    }
  }

  // Carries the swept fog and the air along the air's own motion, stirs
  // eddies into it, and lets both settle.
  flow(dt) {
    const n = this.size;
    const { clear, vx, vy, _clear, _vx, _vy } = this;
    const fade = Math.exp(-dt / REFILL);
    const calm = Math.exp(-dt / SETTLE);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const c = j * n + i;
        const bx = i - vx[c] * dt;
        const by = j - vy[c] * dt;
        _clear[c] = sample(clear, n, bx, by) * fade;
        _vx[c] = sample(vx, n, bx, by) * calm;
        _vy[c] = sample(vy, n, bx, by) * calm;
      }
    }
    // Eddies: a slowly turning curl of noise, only where fog was swept.
    const t = this.time * 0.35;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const c = j * n + i;
        if (_clear[c] < 0.02) continue;
        const gx = (this.ox + i) * 0.16;
        const gy = (this.oy + j) * 0.16;
        const e = 0.5;
        const dny = valueNoise(gx, gy + e + t, 377) - valueNoise(gx, gy - e + t, 377);
        const dnx = valueNoise(gx + e - t, gy, 377) - valueNoise(gx - e - t, gy, 377);
        const w = SWIRL * _clear[c] * dt;
        _vx[c] += dny * w;
        _vy[c] -= dnx * w;
      }
    }
    this.clear = _clear;
    this.vx = _vx;
    this.vy = _vy;
    this._clear = clear;
    this._vx = vx;
    this._vy = vy;
  }

  pack() {
    const n = this.size;
    for (let j = 0; j < n; j++) {
      const ej = Math.min(j, n - 1 - j);
      for (let i = 0; i < n; i++) {
        const edge = Math.min(1, Math.min(ej, i, n - 1 - i) / BORDER);
        const c = j * n + i;
        this.bytes[c] = Math.round(Math.max(0, Math.min(1, this.clear[c] * edge)) * 255);
      }
    }
  }

  // How much fog has been swept from a point of the ground (rows), 0-1.
  clearedAt(gx, gy) {
    if (Number.isNaN(this.ox)) return 0;
    return sample(this.bytes, this.size, gx - this.ox - 0.5, gy - this.oy - 0.5) / 255;
  }
}

function smooth(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// Bilinear sample at a cell position, zero beyond the field.
function sample(field, n, x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = x - x0;
  const ty = y - y0;
  const at = (i, j) => (i < 0 || j < 0 || i >= n || j >= n ? 0 : field[j * n + i]);
  const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
  const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
  return top + (bottom - top) * ty;
}
