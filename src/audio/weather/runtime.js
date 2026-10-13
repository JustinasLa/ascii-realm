import { ASPECT } from '../../world/world.js';
import { loopNoise, noise, setParam, tone } from '../voices.js';
import { rainSplashes } from './rain-splashes.js';
import { nextSoundVariant, seededRandom, varySound } from '../variations.js';

const FILTERS = new Set(['lowpass', 'highpass', 'bandpass']);
const bounded = (value, fallback, minimum, maximum) =>
  Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : Number.isFinite(fallback) ? fallback : minimum));
const disconnect = node => { try { node?.disconnect(); } catch { /* Context already closed. */ } };

function range(value, fallback, minimum = 0.05) {
  const low = bounded(value?.[0], fallback[0], minimum, 120);
  return [low, bounded(value?.[1], fallback[1], low, 120)];
}

// Each selection owns a mixer, its own source routes, and every voice it starts.
// The manager supplies one shared budget so fading selections cannot multiply
// the maximum number of short voices.
export class WeatherGroup {
  constructor(engine, definition, { random = Math.random, budget, intensity = 0.6 } = {}) {
    this.engine = engine;
    this.definition = definition;
    this.context = engine.context;
    this.random = () => {
      try { return bounded(random(), 0.5, 0, 0.999999999); } catch { return 0.5; }
    };
    this.budget = budget ?? { voices: new Set(), limit: 64 };
    this.layers = [];
    this.voices = [];
    this.routes = new Set();
    this.events = [];
    this.disposed = false;
    this.ready = false;
    this._intensity = bounded(intensity, 0.6, 0, 1);
    this.rainfall = bounded(definition.rainfall, 0, 0, 1);
    this._water = null;
    this._lastNow = this.context?.currentTime ?? 0;
    this._fade = { from: 0, to: 0, start: this._lastNow, end: this._lastNow };
    this.facade = {
      context: this.context,
      get listener() { return engine.listener; },
      spatial: (x, y) => this._spatial(x, y),
      route: (bus, x, y) => this._route(x, y, bus === 'rain-splashes'),
    };
    if (this.context?.state !== 'running') return;
    try {
      this.rootRoute = engine.route('weather');
      if (!this.rootRoute?.input) return;
      this.mix = this.context.createGain();
      this.gate = this.context.createGain();
      this.mix.gain.value = 0;
      this.gate.gain.value = this._intensity > 0 ? 1 : 0;
      this.mix.connect(this.gate);
      this.gate.connect(this.rootRoute.input);
      if (this.rainfall > 0) {
        this.splashGate = this.context.createGain();
        this.splashGate.gain.value = 0;
        this.splashGate.connect(this.mix);
      }
      const names = new Set();
      for (const layer of (Array.isArray(definition.layers) ? definition.layers : []).slice(0, 3)) {
        if (!layer || typeof layer.name !== 'string' || names.has(layer.name)) continue;
        names.add(layer.name);
        const base = {
          name: layer.name,
          filterType: FILTERS.has(layer.filterType) ? layer.filterType : 'lowpass',
          cutoff: bounded(layer.cutoff, 1400, 20, 10000),
          Q: bounded(layer.Q, 0.45, 0, 8),
          gain: bounded(layer.gain, 0, 0, 0.14),
        };
        const variant = nextSoundVariant(engine, `weather:${definition.id}:bed:${base.name}`, this.random);
        const handle = loopNoise(this.facade, varySound(variant, { ...base, gain: base.gain * this._intensity }));
        if (handle) this.layers.push({ name: base.name, base, handle, variant });
      }
      const eventDefinitions = (Array.isArray(definition.events) ? definition.events : []).slice(0, 2);
      if (this.rainfall > 0) eventDefinitions.push(rainSplashes);
      for (const event of eventDefinitions) {
        if (!event || typeof event.create !== 'function') continue;
        const interval = range(event.interval, [2, 5]);
        const firstDelay = range(event.firstDelay, interval, 0);
        this.events.push({ definition: event, interval, next: this._lastNow + this._between(firstDelay) });
      }
      this.ready = true;
    } catch {
      this.dispose();
    }
  }

  _between([low, high]) { return low + (high - low) * this.random(); }

  _listener() {
    return {
      x: bounded(this.engine.listener?.x, 0, -1e9, 1e9),
      y: bounded(this.engine.listener?.y, 0, -1e9, 1e9),
    };
  }

  _spatial(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { gain: 1, pan: 0 };
    const listener = this._listener();
    const dx = (x - listener.x) * ASPECT;
    const dy = y - listener.y;
    const fallback = { gain: 1 / (1 + (Math.hypot(dx, dy) / 24) ** 2), pan: dx / 24 };
    let position = fallback;
    try { position = this.engine.spatial?.(x, y) ?? fallback; } catch { /* Use local spatial fallback. */ }
    return {
      gain: bounded(position.gain, fallback.gain, 0, 1),
      pan: bounded(position.pan, fallback.pan, -1, 1),
    };
  }

  _route(x, y, splash = false) {
    if (this.disposed || !this.mix || this.engine.context !== this.context || this.context.state !== 'running') return null;
    const destination = splash ? this.splashGate : this.mix;
    if (!destination) return null;
    let input;
    let panner;
    try {
      input = this.context.createGain();
      panner = typeof this.context.createStereoPanner === 'function' ? this.context.createStereoPanner() : null;
      const position = this._spatial(x, y);
      input.gain.value = position.gain;
      if (panner) {
        panner.pan.value = position.pan;
        input.connect(panner);
        panner.connect(destination);
      } else input.connect(destination);
      const listener = this._listener();
      // Rain hits stay at the lake; other weather cues travel with the listener.
      let anchor = Number.isFinite(x) && Number.isFinite(y)
        ? { x: splash ? x : x - listener.x, y: splash ? y : y - listener.y } : null;
      let disposed = false;
      const route = {
        input,
        pan: panner,
        update: (nextX, nextY) => {
          if (disposed || this.disposed) return;
          const current = this._listener();
          anchor = Number.isFinite(nextX) && Number.isFinite(nextY)
            ? { x: splash ? nextX : nextX - current.x, y: splash ? nextY : nextY - current.y } : null;
          const next = this._spatial(nextX, nextY);
          setParam(input.gain, next.gain, this.context.currentTime, 0.08);
          setParam(panner?.pan, next.pan, this.context.currentTime, 0.08);
        },
        follow: now => {
          if (disposed || this.disposed || !anchor) return;
          const current = this._listener();
          const next = this._spatial(splash ? anchor.x : current.x + anchor.x,
            splash ? anchor.y : current.y + anchor.y);
          setParam(input.gain, next.gain, now, 0.08);
          setParam(panner?.pan, next.pan, now, 0.08);
        },
        dispose: () => {
          if (disposed) return;
          disposed = true;
          disconnect(input);
          disconnect(panner);
          this.routes.delete(route);
        },
      };
      this.routes.add(route);
      return route;
    } catch {
      disconnect(input);
      disconnect(panner);
      return null;
    }
  }

  _fadeLevel(now) {
    const fade = this._fade;
    if (now >= fade.end) return fade.to;
    const progress = bounded((now - fade.start) / (fade.end - fade.start), 1, 0, 1);
    return fade.from + (fade.to - fade.from) * progress;
  }

  fadeTo(value, seconds = 1.2) {
    if (this.disposed || !this.mix) return;
    const now = this.context.currentTime;
    const from = this._fadeLevel(now);
    const to = bounded(value, 0, 0, 1);
    const duration = bounded(seconds, 1.2, 0, 4);
    this._fade = { from, to, start: now, end: now + duration };
    try {
      const param = this.mix.gain;
      param.cancelScheduledValues(now);
      param.setValueAtTime(from, now);
      if (duration > 0) param.linearRampToValueAtTime(to, now + duration);
      else param.setValueAtTime(to, now);
    } catch { this.mix.gain.value = to; }
  }

  get fadeEnd() { return this._fade.end; }

  setIntensity(intensity) {
    if (this.disposed) return;
    this._intensity = bounded(intensity, this._intensity, 0, 1);
    // Authored gains already contain intensity. A separate binary gate silences
    // existing and delayed one-shots as well as beds without squaring that gain.
    setParam(this.gate?.gain, this._intensity > 0 ? 1 : 0, this.context.currentTime, 0.06);
  }

  prune(now) {
    for (let index = this.voices.length - 1; index >= 0; index--) {
      const voice = this.voices[index];
      if (voice.handle.ended || voice.end <= now) {
        voice.handle.stop();
        this.budget.voices.delete(voice);
        this.voices.splice(index, 1);
      }
    }
  }

  update({ now = this.context.currentTime, time = now, intensity = this._intensity, water = null, events = true } = {}) {
    if (this.disposed || !this.ready || this.context.state !== 'running') return;
    now = bounded(now, this.context.currentTime, 0, 1e12);
    time = bounded(time, now, -1e12, 1e12);
    this.setIntensity(intensity);
    this._water = this.rainfall > 0 && water && [water.x, water.y, water.strength].every(Number.isFinite)
      && water.strength > 0 ? { x: water.x, y: water.y, strength: bounded(water.strength, 0, 0, 1) } : null;
    setParam(this.splashGate?.gain, this._water?.strength ?? 0, now, 0.2);
    this.prune(now);
    for (const route of this.routes) route.follow(now);
    let updates = null;
    try { updates = this.definition.modulate?.({ now, time, intensity: this._intensity }); } catch { /* Keep safe base beds. */ }
    for (const { name, base, handle, variant } of this.layers) {
      const update = updates?.[name];
      const gain = this._intensity === 0 ? 0
        : bounded(update?.gain, base.gain * this._intensity, 0, 0.14) * variant.level;
      setParam(handle.gain.gain, gain, now, 0.4);
      setParam(handle.filter.frequency, bounded((update?.cutoff ?? base.cutoff) * variant.color, base.cutoff, 20, 10000), now, 0.65);
      setParam(handle.filter.Q, bounded(update?.Q, base.Q, 0, 8), now, 0.5);
      setParam(handle.pan?.pan, bounded(update?.pan, 0, -1, 1), now, 0.2);
    }
    const gap = now < this._lastNow || now - this._lastNow > 1;
    for (const event of this.events) {
      if (now < event.next) continue;
      const late = now - event.next > 0.5;
      event.next = now + this._between(event.interval);
      // One callback at most per update; a clock jump never replays old rain
      // impacts or thunder that should already have happened.
      if (!events || gap || late || this._intensity === 0) continue;
      let cues;
      const index = this.events.indexOf(event);
      const variant = nextSoundVariant(this.engine, `weather:${this.definition.id}:event:${index}`, this.random);
      try {
        cues = event.definition.create({ now, time, intensity: this._intensity, random: seededRandom(variant.seed),
          water: this._water, rainfall: this.rainfall });
      } catch { continue; }
      if (!Array.isArray(cues)) continue;
      for (const [layer, cue] of cues.slice(0, 16).entries()) this._play(varySound(variant, cue, layer), now);
    }
    this._lastNow = now;
  }

  _play(cue, now) {
    if (!cue || !['noise', 'tone'].includes(cue.kind) || this._intensity === 0
        || this.budget.voices.size >= Math.min(64, this.budget.limit ?? 64)) return;
    const splash = cue.surface === 'water';
    if (splash && !this._water) return;
    const duration = bounded(cue.duration, 0.2, 0.01, 8);
    const delay = bounded(cue.delay, 0, 0, 4);
    const pan = bounded(cue.pan, 0, -1, 1);
    const listener = this._listener();
    const cutoff = bounded(cue.cutoff, 1400, 20, 10000);
    const filterType = FILTERS.has(cue.filterType) ? cue.filterType : 'lowpass';
    const peakLimit = cue.kind === 'noise' && filterType === 'lowpass' && cutoff <= 250 ? 0.3 : 0.25;
    const gain = bounded(cue.gain, 0, 0, peakLimit);
    if (gain === 0) return;
    const attack = bounded(cue.attack, 0.005, 0.001, duration * 0.5);
    const release = bounded(cue.release, Math.min(0.08, duration * 0.4), 0.001, duration - attack);
    const options = {
      bus: splash ? 'rain-splashes' : 'weather',
      when: now + delay,
      duration,
      gain,
      filterType,
      cutoff,
      Q: bounded(cue.Q, 0.45, 0, 8),
      attack,
      decay: bounded(cue.decay, 0, 0, Math.max(0, duration - attack - release)),
      sustain: bounded(cue.sustain, 1, 0, 1),
      release,
      offset: bounded(cue.offset, 0.5, 0, 0.999999999),
      playbackRate: bounded(cue.playbackRate, 1, 0.5, 2),
      x: bounded(cue.x, listener.x + pan * 24 / ASPECT, -1e9, 1e9),
      y: bounded(cue.y, listener.y, -1e9, 1e9),
      frequency: bounded(cue.frequency, 440, 20, 10000),
      endFrequency: bounded(cue.endFrequency, cue.frequency ?? 440, 20, 10000),
      type: ['sine', 'square', 'triangle', 'sawtooth'].includes(cue.type) ? cue.type : 'sine',
    };
    const handle = (cue.kind === 'tone' ? tone : noise)(this.facade, options);
    if (handle) {
      const voice = { handle, end: now + delay + duration + 0.04 };
      this.voices.push(voice);
      this.budget.voices.add(voice);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const { handle } of this.layers) handle.stop();
    for (const voice of this.voices) {
      voice.handle.stop();
      this.budget.voices.delete(voice);
    }
    this.layers.length = 0;
    this.voices.length = 0;
    this.events.length = 0;
    for (const route of this.routes) route.dispose();
    this.routes.clear();
    disconnect(this.mix);
    disconnect(this.gate);
    disconnect(this.splashGate);
    try { this.rootRoute?.dispose(); } catch { /* Engine may already have disposed its routes. */ }
    this.ready = false;
  }
}
