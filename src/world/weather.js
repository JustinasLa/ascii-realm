import { valueNoise } from '../core/noise.js';
import { RAIN_SLANTS } from '../render/glyph-packs/effects.js';
import { dg, over } from '../render/glyphs.js';
import { Lightning } from './lightning.js';
import { Splashes } from './splashes.js';
import { ASPECT, WATER } from './world.js';

// Density is per world cell, so zoom changes the area covered by the weather.
// Fall speeds and wind are in rows per second; all particles stay in the world.
export const WEATHER_EFFECTS = Object.freeze({
  clear: {},
  drizzle: { kind: 'rain', density: 0.008, fall: 43, wind: 0.08, haze: 0.07, shade: 0.04, impact: 0.28, streak: 1 },
  rain: { kind: 'rain', density: 0.016, fall: 56, wind: 0.18, haze: 0.045, shade: 0.07, impact: 0.65, streak: 3 },
  'heavy-rain': { kind: 'rain', density: 0.040, fall: 90, wind: 0.35, haze: 0.10, shade: 0.20, impact: 0.9, streak: 4 },
  thunderstorm: { kind: 'rain', density: 0.036, fall: 83, wind: 0.85, haze: 0.10, shade: 0.24, impact: 1, streak: 4, lightning: 0.18 },
  'distant-thunder': { kind: 'leaf', density: 0.0008, fall: 5, wind: 0.16, haze: 0.02, shade: 0.18, lightning: 0.06 },
  hail: { kind: 'hail', density: 0.014, fall: 65, wind: 0.35, haze: 0.06, shade: 0.16, impact: 1 },
  sleet: { kind: 'sleet', density: 0.018, fall: 52, wind: 0.5, haze: 0.10, shade: 0.13, impact: 0.58, streak: 2 },
  'light-snow': { kind: 'snow', density: 0.006, fall: 8, wind: 0.08, haze: 0.04, shade: 0.02, impact: 0.12 },
  snowstorm: { kind: 'snow', density: 0.018, fall: 12, wind: 0.55, haze: 0.24, shade: 0.13, impact: 0.17 },
  blizzard: { kind: 'snow', density: 0.035, fall: 16, wind: 1, haze: 0.5, shade: 0.20, impact: 0.2 },
  'wind-gusts': { kind: 'leaf', density: 0.0012, fall: 5, wind: 0.5 },
  gale: { kind: 'leaf', density: 0.003, fall: 8, wind: 1, haze: 0.02, shade: 0.15 },
  sandstorm: { kind: 'sand', density: 0.014, fall: 9, wind: 1, haze: 0.45, shade: 0.13, tint: [143, 109, 70] },
  'ocean-storm': { kind: 'rain', density: 0.026, fall: 76, wind: 1, haze: 0.20, shade: 0.18, impact: 0.75, streak: 4 },
  fog: { haze: 0.6 },
  'ice-storm': { kind: 'rain', density: 0.016, fall: 68, wind: 0.45, haze: 0.16, shade: 0.16, impact: 0.7, streak: 2 },
  'forest-squall': { kind: 'leaf', density: 0.006, fall: 7, wind: 0.9, haze: 0.08, shade: 0.13 },
});

const MAX_PARTICLES = 1200;
const HEIGHT = 22;
const COLORS = {
  rain: [144, 178, 207],
  hail: [182, 206, 228],
  snow: [201, 216, 231],
  leaf: [126, 145, 88],
  sand: [169, 136, 85],
};
const names = (prefix, n) => Array.from({ length: n }, (_, i) => dg(`${prefix}.${i}`));
const RAIN = names('effects.rain', RAIN_SLANTS).map(over);
const DRIZZLE = names('effects.drizzle', 3).map(over);
const FLAKES = names('effects.flake', 6).map(over);
const SETTLED = names('effects.settled', 4).map(over);
const CROWN = names('effects.crown', 3).map(over);
const HAIL = over(dg('effects.hail'));
const LEAVES = names('leaf', 8).map(over);
const GRIT = names('speck', 8).map(over);
const LEAF_COLORS = [[126, 145, 88], [150, 128, 70], [112, 96, 60], [138, 104, 62]];
const MAX_CROWNS = 160;
const MAX_SETTLED = 420;
// Fog is shaded on a coarse grid of drifting noise, then blended per cell.
const FOG_STEP_X = 6;
const FOG_STEP_Y = 3;

// Read the existing saved selection, independently of audio unlock and volume.
// Weather has its own splash budget so a downpour cannot evict footstep rings.
export class WeatherEffects {
  constructor({ random = Math.random, onImpact } = {}) {
    this.random = random;
    this.preset = 'clear';
    this.intensity = 0;
    this.particles = [];
    // Drops bursting on dry ground and flakes lying where they fell.
    this.crowns = [];
    this.settled = [];
    this._fog = null;
    this.splashes = new Splashes();
    this.lightning = new Lightning({ random, onImpact });
    this.wind = 0;
    this.flash = 0;
    this._nextFlash = 0;
  }

  clear() {
    this.particles.length = 0;
    this.crowns.length = 0;
    this.settled.length = 0;
    this.splashes.rings.length = 0;
    this.splashes.drops.length = 0;
    this.lightning.clearAutomatic();
    this.flash = this.lightning.flash;
  }

  strike(world, view, options = {}) {
    const bolt = this.lightning.strike(world, view, options);
    this.flash = this.lightning.flash;
    return bolt;
  }

  summon(world, view, player) {
    // Put the test strike beside the player and within the current view.
    const x = Math.max(view.x0 + 2, Math.min(view.x0 + view.cols - 3, player.x + 18 / ASPECT));
    const y = Math.max(view.y0 + 2, Math.min(view.y0 + view.rows - 3, player.y + 3));
    return this.strike(world, view, { x, y, strength: 1, manual: true });
  }

  spawn(view, profile, scattered = false) {
    const random = this.random;
    return {
      x: view.x0 + random() * view.cols,
      y: view.y0 + random() * (view.rows + HEIGHT),
      h: scattered ? random() * HEIGHT : HEIGHT,
      fall: profile.fall * (0.75 + random() * 0.5),
      phase: random() * Math.PI * 2,
      glint: 0.55 + random() * 0.45,
      shape: Math.floor(random() * 8),
      kind: profile.kind === 'sleet' ? (random() < 0.5 ? 'rain' : 'hail') : profile.kind,
    };
  }

  update(dt, time, world, view, settings) {
    dt = Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0;
    this.lightning.update(dt);
    time = Number.isFinite(time) ? time : 0;
    const preset = Object.hasOwn(WEATHER_EFFECTS, settings.preset) ? settings.preset : 'clear';
    const profile = WEATHER_EFFECTS[preset];
    if (preset !== this.preset) {
      this.clear();
      this._nextFlash = 3 + this.random() * 8;
      this.preset = preset;
    }
    this.intensity = Number.isFinite(settings.intensity) ? Math.max(0, Math.min(1, settings.intensity)) : 0;
    const gust = 0.7 + Math.sin(time * 0.8) * 0.2 + Math.sin(time * 2.1) * 0.1;
    this.wind = (profile.wind ?? 0) * this.intensity * gust;
    if (preset === 'clear' || this.intensity === 0) {
      this.clear();
      return;
    }

    if (profile.lightning && !settings.drivesLightning) {
      this._nextFlash -= dt * (0.3 + this.intensity * 0.7);
      if (this._nextFlash <= 0) {
        this.strike(world, view, { strength: this.intensity, distant: preset === 'distant-thunder' });
        this._nextFlash = 6 + this.random() * 14;
      }
    }
    this.flash = this.lightning.flash;
    this.splashes.update(dt);
    for (const c of this.crowns) c.age += dt;
    this.crowns = this.crowns.filter((c) => c.age < c.life);
    for (const f of this.settled) f.age += dt;
    this.settled = this.settled.filter((f) => f.age < f.life);
    const count = Math.min(MAX_PARTICLES, Math.floor(view.cols * view.rows * (profile.density ?? 0) * this.intensity));
    if (this.particles.length > count) this.particles.length = count;
    while (this.particles.length < count) this.particles.push(this.spawn(view, profile, true));

    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.phase += dt * (p.kind === 'leaf' ? 6 : 2);
      const flutter = p.kind === 'snow' || p.kind === 'leaf' ? Math.sin(p.phase) * 3 : 0;
      p.x += (this.wind * 32 + flutter) * dt / ASPECT;
      p.y += this.wind * 3 * dt;
      p.h -= p.fall * (0.75 + this.intensity * 0.25) * dt;
      if (p.h <= 0) {
        // Only sample actual on-screen ground impacts, not the falling glyph.
        if (p.x >= view.x0 && p.x < view.x0 + view.cols && p.y >= view.y0 && p.y < view.y0 + view.rows) {
          if (profile.impact) {
            this.splashes.precipitate(world, p.x, p.y,
              profile.impact * this.intensity * p.glint, p.kind, this.random);
          }
          this.land(world, p);
        }
        this.particles[i] = this.spawn(view, profile);
      } else if (p.x < view.x0 - 4 || p.x > view.x0 + view.cols + 4
          || p.y - p.h < view.y0 - HEIGHT || p.y - p.h > view.y0 + view.rows + HEIGHT) {
        // Refill newly exposed terrain after walking, zooming or teleporting.
        this.particles[i] = this.spawn(view, profile, true);
      }
    }
  }

  // Rain and hail burst into a crown of droplets on dry ground (the lake
  // takes rings from the splashes); snow settles and lies a while.
  land(world, p) {
    if (p.kind !== 'snow' && p.kind !== 'rain' && p.kind !== 'hail') return;
    const water = world.typeAt(p.x, p.y) === WATER;
    if (p.kind === 'snow') {
      if (water || this.random() > 0.55) return;
      this.settled.push({ x: Math.floor(p.x), y: Math.floor(p.y), age: 0, life: 5 + this.random() * 7,
        g: SETTLED[p.shape & 3] });
      if (this.settled.length > MAX_SETTLED) this.settled.shift();
    } else if ((p.kind === 'rain' || p.kind === 'hail') && !water && this.random() < 0.7) {
      this.crowns.push({ x: Math.floor(p.x), y: Math.floor(p.y), age: 0,
        life: p.kind === 'hail' ? 0.3 : 0.22, kind: p.kind, glint: p.glint });
      if (this.crowns.length > MAX_CROWNS) this.crowns.shift();
    }
  }

  drawSurface(r, view, time) {
    this.splashes.drawSurface(r, view, time);
    this.lightning.drawSurface(r, view, time);
  }

  // Drifting fog banks and storm light blend with the whole finished
  // scene. Keep the glyphs, including reflected scenery, intact under the
  // haze. The banks come from slow noise sampled on a coarse grid that is
  // anchored to the world, so they roll across the land with the wind.
  drawAtmosphere(r, view, time) {
    const profile = WEATHER_EFFECTS[this.preset];
    const haze = (profile.haze ?? 0) * this.intensity;
    const shade = (profile.shade ?? 0) * this.intensity;
    if (!haze && !shade && this.flash < 0.001) return;
    const tint = profile.tint ?? [68, 80, 96];
    const light = 1 - shade;
    const gx0 = Math.floor(view.x0 / FOG_STEP_X);
    const gy0 = Math.floor(view.y0 / FOG_STEP_Y);
    const gw = Math.ceil(view.cols / FOG_STEP_X) + 2;
    const gh = Math.ceil(view.rows / FOG_STEP_Y) + 2;
    if (!this._fog || this._fog.length < gw * gh) this._fog = new Float32Array(gw * gh);
    const fog = this._fog;
    const drift = time * (0.05 + Math.abs(this.wind) * 0.25);
    for (let j = 0; j < gh; j++) {
      const wy = (gy0 + j) * FOG_STEP_Y;
      for (let i = 0; i < gw; i++) {
        const wx = (gx0 + i) * FOG_STEP_X;
        const n = valueNoise(wx * 0.018 - drift * 1.6, wy * 0.045 + time * 0.02, 71) * 0.65
          + valueNoise(wx * 0.05 - drift * 3, wy * 0.11, 72) * 0.35;
        fog[j * gw + i] = haze * Math.max(0, Math.min(1.25, 0.25 + (n - 0.3) * 1.9));
      }
    }
    const flashFg = 180 * this.flash;
    const flashBg = 80 * this.flash;
    for (let sy = 0; sy < view.rows; sy++) {
      const gy = (view.y0 + sy) / FOG_STEP_Y - gy0;
      const j = Math.floor(gy);
      const ty = gy - j;
      for (let sx = 0; sx < view.cols; sx++) {
        const gx = (view.x0 + sx) / FOG_STEP_X - gx0;
        const i = Math.floor(gx);
        const tx = gx - i;
        const q = j * gw + i;
        const top = fog[q] + (fog[q + 1] - fog[q]) * tx;
        const bottom = fog[q + gw] + (fog[q + gw + 1] - fog[q + gw]) * tx;
        const k = Math.min(0.9, top + (bottom - top) * ty);
        const o = (sy * r.cols + sx) * 4;
        for (let c = 0; c < 3; c++) {
          r.fg[o + c] = r.fg[o + c] * light * (1 - k) + tint[c] * k + flashFg;
          r.ov[o + c] = r.ov[o + c] * light * (1 - k) + tint[c] * k + flashFg;
          r.bg[o + c] = r.bg[o + c] * light * (1 - k) + tint[c] * k * 0.35 + flashBg;
        }
      }
    }
    this.lightning.light(r, view);
  }

  draw(r, view) {
    const profile = WEATHER_EFFECTS[this.preset];
    this.splashes.drawSpray(r, view);
    const bright = 0.45 + this.intensity * 0.55;
    // Settled snow first, then the drops bursting on the ground.
    for (const f of this.settled) {
      const k = Math.min(1, f.age * 4) * (1 - (f.age / f.life) ** 2) * bright;
      this.speck(r, f.x - view.x0, f.y - view.y0, f.g, 205, 218, 232, k);
    }
    for (const c of this.crowns) {
      const u = c.age / c.life;
      const k = (1 - u * 0.6) * c.glint * bright;
      const [cr, cg, cb] = COLORS[c.kind];
      this.speck(r, c.x - view.x0, c.y - view.y0, CROWN[Math.min(2, Math.floor(u * 3))], cr, cg, cb, k);
    }
    // Streaks lean with the wind: how far a drop moves sideways for each
    // row it falls, in columns.
    const slant = this.wind * 32 / ASPECT / Math.max(1, profile.fall ?? 1);
    const rainGlyph = RAIN[Math.max(0, Math.min(RAIN_SLANTS - 1, Math.round((RAIN_SLANTS - 1) / 2 - slant * 3.1)))];
    for (const p of this.particles) {
      const sx = Math.floor(p.x) - view.x0;
      const sy = Math.floor(p.y - p.h) - view.y0;
      const [cr, cg, cb] = COLORS[p.kind];
      const k = p.glint * bright * Math.min(1, 0.5 + p.h * 0.25);
      if (p.kind === 'rain') {
        if (this.preset === 'drizzle') {
          this.speck(r, sx, sy, DRIZZLE[p.shape % 3], cr, cg, cb, k);
          continue;
        }
        const length = profile.streak ?? 1;
        for (let j = 0; j < length; j++) {
          this.speck(r, sx - Math.round(slant * j), sy - j, rainGlyph, cr, cg, cb, k * (1 - j / (length + 1)));
        }
      } else if (p.kind === 'snow') {
        // Big branched flakes are rarer than grains and small stars.
        const shape = p.glint > 0.9 ? 0 : p.glint > 0.8 ? 1 : 2 + (p.shape & 3);
        this.speck(r, sx, sy, FLAKES[shape], cr, cg, cb, k);
      } else if (p.kind === 'hail') {
        this.speck(r, sx, sy, HAIL, cr, cg, cb, k);
      } else if (p.kind === 'leaf') {
        const [lr, lg, lb] = LEAF_COLORS[p.shape & 3];
        this.speck(r, sx, sy, LEAVES[Math.floor(p.phase * 1.5 + p.shape) & 7], lr, lg, lb, k);
      } else {
        this.speck(r, sx, sy, GRIT[Math.floor(p.phase + p.shape) & 7], cr, cg, cb, k);
      }
    }
    this.lightning.draw(r, view);
  }

  // Layers a particle over a cell, fading in from the cell's own ground so
  // a faint one never darkens what is behind it.
  speck(r, sx, sy, g, cr, cg, cb, k) {
    if (sx < 0 || sy < 0 || sx >= r.cols || sy >= r.rows) return;
    const o = (sy * r.cols + sx) * 4;
    const m = Math.min(1, k);
    r.layer(sx, sy, g, r.bg[o] + (cr - r.bg[o]) * m, r.bg[o + 1] + (cg - r.bg[o + 1]) * m,
      r.bg[o + 2] + (cb - r.bg[o + 2]) * m);
  }
}
