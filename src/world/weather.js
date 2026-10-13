import { glyph } from '../render/glyphs.js';
import { Lightning } from './lightning.js';
import { Splashes } from './splashes.js';
import { ASPECT } from './world.js';

// Density is per world cell, so zoom changes the area covered by the weather.
// Fall speeds and wind are in rows per second; all particles stay in the world.
export const WEATHER_EFFECTS = Object.freeze({
  clear: {},
  drizzle: { kind: 'rain', density: 0.003, fall: 43, wind: 0.08, haze: 0.07, shade: 0.04, impact: 0.28, streak: 1 },
  rain: { kind: 'rain', density: 0.007, fall: 56, wind: 0.18, haze: 0.045, shade: 0.07, impact: 0.65, streak: 2 },
  'heavy-rain': { kind: 'rain', density: 0.020, fall: 90, wind: 0.35, haze: 0.10, shade: 0.20, impact: 0.9, streak: 3 },
  thunderstorm: { kind: 'rain', density: 0.018, fall: 83, wind: 0.85, haze: 0.10, shade: 0.24, impact: 1, streak: 3, lightning: 0.18 },
  'distant-thunder': { kind: 'leaf', density: 0.0008, fall: 5, wind: 0.16, haze: 0.02, shade: 0.18, lightning: 0.06 },
  hail: { kind: 'hail', density: 0.008, fall: 65, wind: 0.35, haze: 0.06, shade: 0.16, impact: 1 },
  sleet: { kind: 'sleet', density: 0.009, fall: 52, wind: 0.5, haze: 0.10, shade: 0.13, impact: 0.58, streak: 2 },
  'light-snow': { kind: 'snow', density: 0.003, fall: 8, wind: 0.08, haze: 0.04, shade: 0.02, impact: 0.12 },
  snowstorm: { kind: 'snow', density: 0.010, fall: 12, wind: 0.55, haze: 0.24, shade: 0.13, impact: 0.17 },
  blizzard: { kind: 'snow', density: 0.022, fall: 16, wind: 1, haze: 0.5, shade: 0.20, impact: 0.2 },
  'wind-gusts': { kind: 'leaf', density: 0.0012, fall: 5, wind: 0.5 },
  gale: { kind: 'leaf', density: 0.003, fall: 8, wind: 1, haze: 0.02, shade: 0.15 },
  sandstorm: { kind: 'sand', density: 0.014, fall: 9, wind: 1, haze: 0.45, shade: 0.13, tint: [143, 109, 70] },
  'ocean-storm': { kind: 'rain', density: 0.013, fall: 76, wind: 1, haze: 0.20, shade: 0.18, impact: 0.75, streak: 3 },
  fog: { haze: 0.6 },
  'ice-storm': { kind: 'rain', density: 0.008, fall: 68, wind: 0.45, haze: 0.16, shade: 0.16, impact: 0.7, streak: 2 },
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
const RAIN = glyph('|');
const SLANT = glyph('\\');
const DOT = glyph('.');
const FLAKE = glyph('*');
const PELLET = glyph('o');
const LEAVES = [..."'`,~-"].map(glyph);
const GRIT = [...".:,'"].map(glyph);

// Read the existing saved selection, independently of audio unlock and volume.
// Weather has its own splash budget so a downpour cannot evict footstep rings.
export class WeatherEffects {
  constructor({ random = Math.random, onImpact } = {}) {
    this.random = random;
    this.preset = 'clear';
    this.intensity = 0;
    this.particles = [];
    this.splashes = new Splashes();
    this.lightning = new Lightning({ random, onImpact });
    this.wind = 0;
    this.flash = 0;
    this._nextFlash = 0;
  }

  clear() {
    this.particles.length = 0;
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
        if (profile.impact && p.x >= view.x0 && p.x < view.x0 + view.cols
            && p.y >= view.y0 && p.y < view.y0 + view.rows) {
          this.splashes.precipitate(world, p.x, p.y,
            profile.impact * this.intensity * p.glint, p.kind, this.random);
        }
        this.particles[i] = this.spawn(view, profile);
      } else if (p.x < view.x0 - 4 || p.x > view.x0 + view.cols + 4
          || p.y - p.h < view.y0 - HEIGHT || p.y - p.h > view.y0 + view.rows + HEIGHT) {
        // Refill newly exposed terrain after walking, zooming or teleporting.
        this.particles[i] = this.spawn(view, profile, true);
      }
    }
  }

  drawSurface(r, view, time) {
    this.splashes.drawSurface(r, view, time);
    this.lightning.drawSurface(r, view, time);
  }

  // Drifting fog bands and storm light blend with the whole finished scene.
  // Keep the glyphs, including reflected scenery, intact under the haze.
  drawAtmosphere(r, view, time) {
    const profile = WEATHER_EFFECTS[this.preset];
    const haze = (profile.haze ?? 0) * this.intensity;
    const shade = (profile.shade ?? 0) * this.intensity;
    if (!haze && !shade && this.flash < 0.001) return;
    const tint = profile.tint ?? [68, 80, 96];
    const light = 1 - shade;
    for (let sy = 0; sy < view.rows; sy++) {
      const band = 0.6 + Math.sin((view.y0 + sy) * 0.14 + time * 0.22) * 0.25
        + Math.sin((view.y0 + sy) * 0.047 - time * 0.13) * 0.15;
      const k = haze * band;
      for (let sx = 0; sx < view.cols; sx++) {
        const o = (sy * r.cols + sx) * 4;
        for (let c = 0; c < 3; c++) {
          r.fg[o + c] = r.fg[o + c] * light * (1 - k) + tint[c] * k + 180 * this.flash;
          r.bg[o + c] = r.bg[o + c] * light * (1 - k) + tint[c] * k * 0.35 + 80 * this.flash;
        }
      }
    }
    this.lightning.light(r, view);
  }

  draw(r, view) {
    const profile = WEATHER_EFFECTS[this.preset];
    this.splashes.drawSpray(r, view);
    for (const p of this.particles) {
      const sx = Math.floor(p.x) - view.x0;
      const sy = Math.floor(p.y - p.h) - view.y0;
      const color = COLORS[p.kind];
      const brightness = p.glint * (0.45 + this.intensity * 0.55) * Math.min(1, 0.5 + p.h * 0.25);
      let g = DOT;
      if (p.kind === 'snow') g = p.glint > 0.78 ? FLAKE : DOT;
      else if (p.kind === 'hail') g = p.glint > 0.85 ? PELLET : DOT;
      else if (p.kind === 'leaf') g = LEAVES[Math.floor(p.phase * 1.5) % LEAVES.length];
      else if (p.kind === 'sand') g = GRIT[Math.floor(p.phase) % GRIT.length];
      else if (p.kind === 'rain') g = this.preset === 'drizzle' ? DOT : this.wind > 0.2 ? SLANT : RAIN;
      const length = p.kind === 'rain' ? profile.streak ?? 1 : 1;
      for (let j = 0; j < length; j++) {
        const k = brightness * (1 - j / (length + 1));
        r.put(sx - Math.floor(this.wind * j), sy - j, g, color[0] * k, color[1] * k, color[2] * k);
      }
    }
    this.lightning.draw(r, view);
  }
}
