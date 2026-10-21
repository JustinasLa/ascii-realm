// Low ground fog: banks of mist, drawn as overlapping pale `o` characters,
// that drift across the land.
//
// The renderer lays the characters over the finished scene (see
// renderer.js), so fog never displaces what is under it. This class
// decides how thick it is and how far it has drifted, easing both so a
// change of weather rolls the fog in or out instead of popping, and keeps
// the field of fog that walkers have stirred (see fog-wake.js).

import { FogWake } from './fog-wake.js';
import { WEATHER_EFFECTS } from './weather.js';

// A thin, patchy mist lies over the land in any weather.
export const AMBIENT_FOG = { density: 0.75, coverage: 0.4 };
// How quickly density and coverage settle on a new weather, per second.
const EASE = 0.6;
// The banks creep along on their own, faster when the wind picks up. Speeds
// are in rows per second, with columns already scaled to rows.
const CREEP = [0.55, 0.16];
const WIND_PUSH = 9;

export class Fog {
  constructor() {
    this.density = AMBIENT_FOG.density;
    this.coverage = AMBIENT_FOG.coverage;
    this.driftX = 0;
    this.driftY = 0;
    this.time = 0;
    this.enabled = true;
    this.wake = new FogWake();
  }

  // The fog wanted for a weather preset at the given intensity (0-1).
  static target(preset, intensity) {
    const extra = (WEATHER_EFFECTS[preset]?.fog ?? 0) * Math.max(0, Math.min(1, intensity || 0));
    return {
      density: AMBIENT_FOG.density + extra * 0.4,
      coverage: AMBIENT_FOG.coverage + extra * 0.6,
    };
  }

  // `walkers` lists who is moving through the fog this frame and `spells`
  // the bursts and whirls spells make in it (see FogWake.update).
  update(dt, weather, walkers = [], spells = {}) {
    dt = Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0;
    const want = Fog.target(weather?.preset, weather?.intensity);
    const k = 1 - Math.exp(-EASE * dt);
    this.density += (want.density - this.density) * k;
    this.coverage += (want.coverage - this.coverage) * k;
    const wind = Number.isFinite(weather?.wind) ? weather.wind : 0;
    this.driftX += (CREEP[0] + wind * WIND_PUSH) * dt;
    this.driftY += (CREEP[1] + Math.abs(wind) * WIND_PUSH * 0.15) * dt;
    this.time += dt;
    this.wake.update(dt, walkers, this, spells);
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
      wake: this.wake,
    };
  }
}
