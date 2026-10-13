const STORAGE_KEY = 'ascii-realm.audio';
const DEFAULT_LEVELS = { master: 0.7, sfx: 0.8 };
const MAX_VOICES = 8;

function level(value, fallback) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

function disconnect(node) {
  try { node?.disconnect(); } catch { /* A closed graph is already silent. */ }
}

// A small, optional pickup cue. Context creation is reserved for input gestures;
// simulation events never unlock audio or replay pickups that happened earlier.
export class PickupAudio {
  constructor({ contextFactory, storage } = {}) {
    this.context = null;
    this._output = null;
    this._buffer = null;
    this._voices = new Set();
    this._unlockPromise = null;
    this._disposed = false;
    this._contextFactory = contextFactory ?? (() => {
      const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
      return Context ? new Context() : null;
    });
    try { this._storage = storage === undefined ? globalThis.localStorage : storage; } catch { /* Optional storage. */ }
    const saved = this._preferences();
    this._muted = saved.muted === true;
    this.volumes = {
      master: level(saved.volumes?.master, DEFAULT_LEVELS.master),
      sfx: level(saved.volumes?.sfx, DEFAULT_LEVELS.sfx),
    };
  }

  get muted() { return this._muted; }

  setMuted(muted) {
    this._muted = Boolean(muted);
    if (this._muted) this.pause();
    this._applyVolume();
    try {
      // Read again so another audio control's newer settings remain intact.
      this._storage?.setItem(STORAGE_KEY, JSON.stringify({ ...this._preferences(), muted: this._muted }));
    } catch { /* Sound controls work without writable storage. */ }
    return this._muted;
  }

  async unlock() {
    if (this._disposed) return false;
    if (this._unlockPromise) return this._unlockPromise;
    try {
      if (!this.context) {
        const context = this._contextFactory();
        if (!context) return false;
        let output;
        try {
          output = context.createGain();
          output.gain.value = this._muted ? 0 : this.volumes.master * this.volumes.sfx;
          output.connect(context.destination);
        } catch {
          disconnect(output);
          try { Promise.resolve(context.close()).catch(() => {}); } catch { /* Optional close. */ }
          return false;
        }
        this.context = context;
        this._output = output;
      }
      const context = this.context;
      // Call resume synchronously while the keyboard/pointer activation is live.
      const resume = context.state === 'running' ? undefined : context.resume();
      this._unlockPromise = Promise.resolve(resume)
        .then(() => !this._disposed && this.context === context && context.state === 'running')
        .catch(() => false);
      return await this._unlockPromise;
    } catch {
      return false;
    } finally {
      this._unlockPromise = null;
    }
  }

  play(event) {
    const context = this.context;
    if (this._disposed || context?.state !== 'running' || this._muted
        || this.volumes.master === 0 || this.volumes.sfx === 0
        || event?.type !== 'pickup' || event.success === false
        || (event.count !== undefined && (!Number.isFinite(event.count) || event.count <= 0))) return false;
    while (this._voices.size >= MAX_VOICES) this._voices.values().next().value.stop();

    const nodes = [];
    const sources = [];
    const ended = new Set();
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      for (const node of nodes) disconnect(node);
      this._voices.delete(voice);
    };
    const voice = { stop: () => {
      if (cleaned) return;
      for (const source of sources) {
        try { source.stop(); } catch { /* An ended source needs only disconnection. */ }
      }
      cleanup();
    } };
    const retain = node => { nodes.push(node); return node; };
    try {
      const now = context.currentTime;
      if (!this._buffer) {
        const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * 0.24), context.sampleRate);
        const samples = buffer.getChannelData(0);
        let seed = 0x2f6e2b1;
        for (let i = 0; i < samples.length; i++) {
          seed ^= seed << 13;
          seed ^= seed >>> 17;
          seed ^= seed << 5;
          samples[i] = (seed >>> 0) / 0x80000000 - 1;
        }
        this._buffer = buffer;
      }
      const rustle = retain(context.createBufferSource());
      sources.push(rustle);
      rustle.buffer = this._buffer;
      const filter = retain(context.createBiquadFilter());
      filter.type = 'lowpass';
      filter.frequency.value = 1150;
      filter.Q.value = 0.55;
      const brush = retain(context.createGain());
      brush.gain.setValueAtTime(0, now);
      brush.gain.linearRampToValueAtTime(0.055, now + 0.008);
      brush.gain.linearRampToValueAtTime(0.008, now + 0.05);
      brush.gain.linearRampToValueAtTime(0, now + 0.2);
      rustle.connect(filter);
      filter.connect(brush);
      brush.connect(this._output);

      // A very quiet, damped contact beneath the short cloth/leaf brush.
      const contact = retain(context.createOscillator());
      sources.push(contact);
      contact.type = 'sine';
      contact.frequency.value = 145;
      const tap = retain(context.createGain());
      tap.gain.setValueAtTime(0, now);
      tap.gain.linearRampToValueAtTime(0.022, now + 0.003);
      tap.gain.linearRampToValueAtTime(0.002, now + 0.035);
      tap.gain.linearRampToValueAtTime(0, now + 0.09);
      contact.connect(tap);
      tap.connect(this._output);
      for (const source of sources) source.onended = () => {
        ended.add(source);
        if (ended.size === sources.length) cleanup();
      };
      this._voices.add(voice);
      rustle.start(now);
      rustle.stop(now + 0.21);
      contact.start(now);
      contact.stop(now + 0.1);
      return true;
    } catch {
      voice.stop();
      return false;
    }
  }

  pause() {
    for (const voice of this._voices) voice.stop();
  }

  async dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.pause();
    disconnect(this._output);
    const context = this.context;
    this.context = null;
    this._output = null;
    this._buffer = null;
    try { if (context?.state !== 'closed') await context?.close(); } catch { /* Teardown stays optional. */ }
  }

  _applyVolume() {
    if (!this._output) return;
    try { this._output.gain.value = this._muted ? 0 : this.volumes.master * this.volumes.sfx; } catch { /* Closed context. */ }
  }

  _preferences() {
    try {
      const value = JSON.parse(this._storage?.getItem(STORAGE_KEY) || 'null');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch { return {}; }
  }
}
