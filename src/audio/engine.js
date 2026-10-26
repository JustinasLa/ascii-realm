import { ASPECT } from '../world/world.js';

export const DEFAULT_VOLUMES = Object.freeze({ master: 0.7, music: 0.35, sfx: 0.8, ambience: 0.6, sword: 0.65, weather: 0.6, records: 0.8 });
const STORAGE_KEY = 'ascii-realm.audio';
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

// A soft ceiling for the records bus: unity below 0.6, then easing towards
// just under 0.9, so 24 stacked instrument voices can't go past full scale.
export function ceilingCurve(points = 1025) {
  const curve = new Float32Array(points);
  for (let index = 0; index < points; index++) {
    const x = -1 + 2 * index / (points - 1);
    const size = Math.abs(x);
    curve[index] = size <= 0.6 ? x : Math.sign(x) * (0.6 + 0.38 * Math.tanh((size - 0.6) / 0.38));
  }
  return curve;
}

// The constructor only reads preferences. Call unlock() from a player gesture;
// sources may then connect to route(...).input and dispose their route on end.
export class AudioEngine {
  constructor({ contextFactory, storage } = {}) {
    this.context = null;
    this.buses = {};
    this.volumes = { ...DEFAULT_VOLUMES };
    this.muted = false;
    this.listener = { x: 0, y: 0 };
    this._contextFactory = contextFactory || (() => {
      const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
      return Context ? new Context() : null;
    });
    this._routes = new Set();
    this._disposed = false;
    try {
      this._storage = storage === undefined ? globalThis.localStorage : storage;
      const saved = JSON.parse(this._storage?.getItem(STORAGE_KEY) || 'null');
      for (const bus of Object.keys(this.volumes)) {
        if (Number.isFinite(saved?.volumes?.[bus])) {
          this.volumes[bus] = clamp(saved.volumes[bus], 0, 1);
        }
      }
      if (typeof saved?.muted === 'boolean') this.muted = saved.muted;
    } catch {
      // Private browsing, denied storage and old preferences are harmless.
    }
  }

  async unlock() {
    if (this._disposed) return false;
    try {
      if (!this.context) {
        const context = this._contextFactory();
        if (!context) return false;
        this.context = context;
        try {
          this.buses.master = context.createGain();
          this.buses.master.connect(context.destination);
          for (const bus of ['music', 'sfx', 'ambience']) {
            this.buses[bus] = context.createGain();
            this.buses[bus].connect(this.buses.master);
          }
          // Instruments reach Master through the soft ceiling, where there is one.
          this.buses.records = context.createGain();
          this._ceiling = context.createWaveShaper?.() ?? null;
          if (this._ceiling) {
            this._ceiling.curve = ceilingCurve();
            this._ceiling.oversample = '2x';
            this._ceiling.connect(this.buses.master);
          }
          this.buses.records.connect(this._ceiling ?? this.buses.master);
          this.buses.sword = context.createGain();
          this.buses.sword.connect(this.buses.sfx);
          this.buses.weather = context.createGain();
          this.buses.weather.connect(this.buses.ambience);
          // Apply saved mute/levels before any source can become audible.
          this._applyVolumes(true);
        } catch {
          this.context = null;
          this.buses = {};
          try { Promise.resolve(context.close()).catch(() => {}); } catch { /* Unsupported close. */ }
          return false;
        }
      }
      // Invoke resume before yielding so the browser sees the user activation.
      // An autoplay-blocked resume may stay pending until a later gesture
      // retries it, so pending attempts must not suppress another resume.
      if (this.context.state !== 'running') await this.context.resume();
      return !this._disposed && this.context?.state === 'running';
    } catch {
      return false;
    }
  }

  setVolume(bus, value) {
    if (!Object.hasOwn(this.volumes, bus) || !Number.isFinite(value)) return;
    this.volumes[bus] = clamp(value, 0, 1);
    this._applyVolumes();
    this._save();
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    this._applyVolumes();
    this._save();
    return this.muted;
  }

  toggleMute() {
    return this.setMuted(!this.muted);
  }

  setListener(x, y) {
    if (Number.isFinite(x) && Number.isFinite(y)) this.listener = { x, y };
  }

  spatial(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { pan: 0, gain: 1 };
    const dx = (x - this.listener.x) * ASPECT;
    const dy = y - this.listener.y;
    const distance = Math.hypot(dx, dy);
    return { pan: clamp(dx / 24, -1, 1), gain: 1 / (1 + (distance / 24) ** 2) };
  }

  // Returns null until successfully unlocked or while suspended. Unpositioned
  // music/UI sounds get full gain; older browsers simply omit stereo panning.
  route(bus = 'sfx', x, y) {
    if (this._disposed || this.context?.state !== 'running' || !this.buses[bus]) return null;
    const input = this.context.createGain();
    const { pan, gain } = this.spatial(x, y);
    input.gain.value = gain;
    const panner = typeof this.context.createStereoPanner === 'function'
      ? this.context.createStereoPanner() : null;
    if (panner) {
      panner.pan.value = pan;
      input.connect(panner);
      panner.connect(this.buses[bus]);
    } else {
      input.connect(this.buses[bus]);
    }
    let disposed = false;
    const route = { input, pan: panner, update: (nextX, nextY) => {
      if (disposed || !this.context) return;
      const position = this.spatial(nextX, nextY);
      this._setParam(input.gain, position.gain);
      if (panner) this._setParam(panner.pan, position.pan);
    }, dispose: () => {
      if (disposed) return;
      disposed = true;
      input.disconnect();
      panner?.disconnect();
      this._routes.delete(route);
    } };
    this._routes.add(route);
    return route;
  }

  async suspend() {
    if (!this.context || this._disposed) return false;
    try {
      await this.context.suspend();
      return true;
    } catch {
      return false;
    }
  }

  async dispose() {
    if (this._disposed) return;
    this._disposed = true;
    for (const route of this._routes) route.dispose();
    for (const node of Object.values(this.buses)) node.disconnect();
    this._ceiling?.disconnect();
    const context = this.context;
    this.context = null;
    this.buses = {};
    try {
      if (context && context.state !== 'closed') await context.close();
    } catch {
      // Closing audio must never break the game's teardown.
    }
  }

  _applyVolumes(immediate = false) {
    for (const [bus, node] of Object.entries(this.buses)) {
      const volume = bus === 'master' && this.muted ? 0 : this.volumes[bus];
      if (immediate) node.gain.value = volume;
      else this._setParam(node.gain, volume);
    }
  }

  _setParam(param, value) {
    if (typeof param.setTargetAtTime === 'function') {
      const now = this.context.currentTime;
      if (typeof param.cancelAndHoldAtTime === 'function') {
        param.cancelAndHoldAtTime(now);
      } else {
        const held = Number.isFinite(param.value) ? param.value : value;
        param.cancelScheduledValues?.(now);
        param.setValueAtTime?.(held, now);
      }
      param.setTargetAtTime(value, now, 0.015);
    } else {
      param.value = value;
    }
  }

  _save() {
    try {
      this._storage?.setItem(STORAGE_KEY, JSON.stringify({ volumes: this.volumes, muted: this.muted }));
    } catch {
      // Sound controls still work when persistence is unavailable.
    }
  }
}
