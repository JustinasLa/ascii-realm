import { WEATHER_PRESETS } from './weather/presets.js';
import { WeatherGroup } from './weather/runtime.js';
import { WATER_RADIUS } from './environment.js';

const STORAGE_KEY = 'ascii-realm.weather';
const FADE_SECONDS = 1.2;
const SPLASH_RADIUS = 12;
const presets = new Map(WEATHER_PRESETS.map(preset => [preset.id, preset]));
const clamp01 = value => Math.max(0, Math.min(1, value));

function nearbyWater(water) {
  if (!water || ![water.x, water.y, water.strength].every(Number.isFinite)) return null;
  const distance = (1 - clamp01(water.strength)) * WATER_RADIUS;
  const strength = clamp01(1 - distance / SPLASH_RADIUS);
  return strength > 0 ? { x: water.x, y: water.y, strength } : null;
}

// Preferences are available before unlock; audio allocation stays inside the
// running-context path and all scheduling follows the game/audio clock.
export class WeatherAudio {
  constructor(engine, { storage, random = Math.random } = {}) {
    this.engine = engine;
    this.preset = 'clear';
    this.intensity = 0.6;
    this._random = typeof random === 'function' ? random : Math.random;
    this._context = null;
    this._active = null;
    this._retiring = [];
    this._budget = { voices: new Set(), limit: 64 };
    this._time = 0;
    this._water = null;
    this._disposed = false;
    try {
      this._storage = storage === undefined ? globalThis.localStorage : storage;
      const saved = JSON.parse(this._storage?.getItem(STORAGE_KEY) || 'null');
      if (saved?.preset === 'clear' || presets.has(saved?.preset)) this.preset = saved.preset;
      if (Number.isFinite(saved?.intensity)) this.intensity = clamp01(saved.intensity);
    } catch { /* Denied storage or old preferences leave useful defaults. */ }
  }

  get presets() { return WEATHER_PRESETS; }

  get hasRain() {
    const rainfall = presets.get(this.preset)?.rainfall;
    return !this._disposed && Number.isFinite(rainfall) && rainfall > 0;
  }

  setPreset(id) {
    if (this._disposed || (id !== 'clear' && !presets.has(id))) return false;
    if (this.preset === id) return true;
    this.preset = id;
    this._save();
    if (this.engine.context?.state === 'running') this._synchronize();
    else this.pause();
    return true;
  }

  setIntensity(value) {
    if (this._disposed || !Number.isFinite(value)) return false;
    this.intensity = clamp01(value);
    this._active?.setIntensity(this.intensity);
    for (const group of this._retiring) group.setIntensity(this.intensity);
    this._save();
    return true;
  }

  _synchronize() {
    const context = this.engine.context;
    if (this._disposed || context?.state !== 'running') return;
    if (context !== this._context) {
      const water = this._water;
      this.pause();
      this._context = context;
      this._water = water;
    }
    if (this._active?.definition.id === this.preset) return;
    if (this._active) {
      this._active.fadeTo(0, FADE_SECONDS);
      this._retiring.push(this._active);
      this._active = null;
    }
    // Quick selection changes may retain two fading groups, never an
    // unbounded queue of beds, source routes, or thunder tails.
    while (this._retiring.length > 2) this._retiring.shift().dispose();
    if (this.preset === 'clear') return;
    const definition = presets.get(this.preset);
    if (!definition) return;
    const group = new WeatherGroup(this.engine, definition, {
      intensity: this.intensity, random: this._random, budget: this._budget,
    });
    if (!group.ready) { group.dispose(); return; }
    this._active = group;
    group.fadeTo(1, FADE_SECONDS);
    group.update({ time: this._time, intensity: this.intensity, water: this._water });
  }

  update({ time = 0, water = null } = {}) {
    if (this._disposed) return;
    if (this.engine.context?.state !== 'running') {
      this.pause();
      return;
    }
    this._time = Number.isFinite(time) ? time : this._time;
    this._water = nearbyWater(water);
    this._synchronize();
    const now = this.engine.context.currentTime;
    for (let index = this._retiring.length - 1; index >= 0; index--) {
      const group = this._retiring[index];
      if (now >= group.fadeEnd) {
        group.dispose();
        this._retiring.splice(index, 1);
      } else group.update({ now, time: this._time, intensity: this.intensity, water: this._water, events: false });
    }
    this._active?.update({ now, time: this._time, intensity: this.intensity, water: this._water });
  }

  pause() {
    this._active?.dispose();
    this._active = null;
    for (const group of this._retiring) group.dispose();
    this._retiring.length = 0;
    this._budget.voices.clear();
    this._context = null;
    this._water = null;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.pause();
  }

  _save() {
    try {
      this._storage?.setItem(STORAGE_KEY, JSON.stringify({ preset: this.preset, intensity: this.intensity }));
    } catch { /* Selection still works without persistent storage. */ }
  }
}
