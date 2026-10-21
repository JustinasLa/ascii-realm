// Low ground fog: banks of mist, drawn as overlapping pale `o` characters,
// that drift across the land.
//
// The renderer lays the characters over the finished scene (see
// renderer.js), so fog never displaces what is under it. This class
// decides how thick it is and how far it has drifted, easing both so a
// change of weather rolls the fog in or out instead of popping, and where
// walkers have stirred it.
//
// Fog parts around anyone walking through it: they stand in a clear pocket,
// the mist nearby is pushed aside, and the path behind them stays open for a
// few seconds before the fog creeps back in.

import { WEATHER_EFFECTS } from './weather.js';
import { ASPECT } from './world.js';

// A thin, patchy mist lies over the land in any weather.
export const AMBIENT_FOG = { density: 0.75, coverage: 0.4 };
// How quickly density and coverage settle on a new weather, per second.
const EASE = 0.6;
// The banks creep along on their own, faster when the wind picks up. Speeds
// are in rows per second, with columns already scaled to rows.
const CREEP = [0.55, 0.16];
const WIND_PUSH = 9;

// The clear pocket around a walker: its radius in rows, and how far above
// the feet it is centred, so the fog parts around the whole body.
export const POCKET = 11;
const POCKET_LIFT = 3;
// A wake mark is left each time a walker has moved this many rows; marks
// close up over WAKE_LIFE seconds. The renderer takes STIRS marks at most,
// walkers included.
const WAKE_STEP = 4;
export const WAKE_LIFE = 3.5;
export const STIRS = 16;
const MAX_WALKERS = 4;

export class Fog {
  constructor() {
    this.density = AMBIENT_FOG.density;
    this.coverage = AMBIENT_FOG.coverage;
    this.driftX = 0;
    this.driftY = 0;
    this.time = 0;
    this.enabled = true;
    // Live walkers ({ x, y, speed }) and the wake marks they left behind.
    this.walkers = [];
    this.wake = [];
    // Where each walker was last frame and where they last left a mark.
    this._tracks = new Map();
    // Packed x, y, radius, strength per mark, for the renderer.
    this._stirs = new Float32Array(STIRS * 4);
  }

  // The fog wanted for a weather preset at the given intensity (0-1).
  static target(preset, intensity) {
    const extra = (WEATHER_EFFECTS[preset]?.fog ?? 0) * Math.max(0, Math.min(1, intensity || 0));
    return {
      density: AMBIENT_FOG.density + extra * 0.4,
      coverage: AMBIENT_FOG.coverage + extra * 0.6,
    };
  }

  // `walkers` lists who is moving through the fog this frame, each as
  // { id, x, y } in world cells with their feet at y.
  update(dt, weather, walkers = []) {
    dt = Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0;
    this.stir(dt, walkers);
    const want = Fog.target(weather?.preset, weather?.intensity);
    const k = 1 - Math.exp(-EASE * dt);
    this.density += (want.density - this.density) * k;
    this.coverage += (want.coverage - this.coverage) * k;
    const wind = Number.isFinite(weather?.wind) ? weather.wind : 0;
    this.driftX += (CREEP[0] + wind * WIND_PUSH) * dt;
    this.driftY += (CREEP[1] + Math.abs(wind) * WIND_PUSH * 0.15) * dt;
    this.time += dt;
  }

  stir(dt, walkers) {
    for (const mark of this.wake) mark.age += dt;
    this.wake = this.wake.filter((mark) => mark.age < WAKE_LIFE);
    this.walkers.length = 0;
    const seen = new Set();
    for (const w of walkers.slice(0, MAX_WALKERS)) {
      if (!Number.isFinite(w?.x) || !Number.isFinite(w?.y)) continue;
      const x = w.x;
      const y = w.y - POCKET_LIFT;
      seen.add(w.id);
      let track = this._tracks.get(w.id);
      // A teleport or respawn starts afresh rather than leaving a wake
      // across the map.
      if (!track || Math.hypot((x - track.x) * ASPECT, y - track.y) > POCKET * 4) {
        track = { x, y, markX: x, markY: y, speed: 0 };
        this._tracks.set(w.id, track);
      }
      const speed = dt > 0 ? Math.hypot((x - track.x) * ASPECT, y - track.y) / dt : 0;
      track.speed += (Math.min(speed, 40) - track.speed) * (1 - Math.exp(-6 * dt));
      track.x = x;
      track.y = y;
      if (Math.hypot((x - track.markX) * ASPECT, y - track.markY) >= WAKE_STEP) {
        this.wake.push({ x: track.markX, y: track.markY, age: 0 });
        track.markX = x;
        track.markY = y;
      }
      this.walkers.push(track);
    }
    for (const id of [...this._tracks.keys()]) if (!seen.has(id)) this._tracks.delete(id);
    const room = STIRS - this.walkers.length;
    if (this.wake.length > room) this.wake.splice(0, this.wake.length - room);
  }

  // Marks for the renderer: x, y (world cells), radius (rows) and strength
  // (0-1), four floats each; strength 0 pads the rest. A walker's pocket
  // widens as they speed up; a wake mark weakens and narrows as it closes.
  stirs() {
    const out = this._stirs;
    out.fill(0);
    let i = 0;
    for (const w of this.walkers) {
      out.set([w.x, w.y, POCKET * (1 + Math.min(w.speed, 30) / 60), 1], i);
      i += 4;
    }
    for (const mark of this.wake) {
      const left = 1 - mark.age / WAKE_LIFE;
      out.set([mark.x, mark.y, POCKET * (0.55 + 0.45 * left), 0.9 * left * left], i);
      i += 4;
    }
    return out;
  }

  // What the renderer needs to shade the fog over the current view.
  uniforms(view) {
    return {
      x0: view.x0,
      y0: view.y0,
      density: this.enabled ? this.density : 0,
      coverage: this.coverage,
      driftX: this.driftX,
      driftY: this.driftY,
      time: this.time,
      stirs: this.stirs(),
    };
  }
}
