// Recorded dry foley stays unfiltered. Samples load only after unlock;
// contacts missed while loading are deliberately discarded.
export const GRASS_SAMPLE_URLS = Object.freeze([
  'grass-L1.wav', 'grass-R1.wav', 'grass-L2.wav',
  'grass-R2.wav', 'grass-L3.wav', 'grass-R3.wav',
].map(name => new URL(`../../assets/audio/grass/${name}`, import.meta.url)));

const players = new WeakMap();
const clamp = (value, fallback, min, max) =>
  Math.max(min, Math.min(max, Number.isFinite(value) ? value : fallback));

async function loadRecording(url, context, fetcher) {
  const response = await fetcher(url);
  if (!response.ok) throw new Error('Grass recording unavailable');
  return context.decodeAudioData(await response.arrayBuffer());
}

/** Context-local loader and playback owner, with injectable IO for tests. */
export class GrassFootsteps {
  constructor(engine, { fetcher = globalThis.fetch?.bind(globalThis), loadBuffer = loadRecording } = {}) {
    this.engine = engine;
    this.fetcher = fetcher;
    this.loadBuffer = loadBuffer;
    this.context = null;
    this.buffers = [];
    this.loading = null;
    this.retryAt = 0;
    this.failures = 0;
    this.nextVariant = 0;
    this.handles = new Set();
  }

  _syncContext() {
    const context = this.engine?.context;
    if (context !== this.context) {
      this.pause();
      this.context = context;
      this.buffers = Array(GRASS_SAMPLE_URLS.length).fill(null);
      this.loading = null;
      this.retryAt = 0;
      this.failures = 0;
      this.nextVariant = 0;
    }
    return context;
  }

  prepare() {
    const context = this._syncContext();
    if (context?.state !== 'running') {
      this.pause();
      return Promise.resolve(false);
    }
    if (this.engine.muted || this.engine.volumes?.master === 0 || this.engine.volumes?.sfx === 0) this.pause();
    if (this.buffers.every(Boolean)) return Promise.resolve(true);
    if (this.loading) return this.loading;
    if (context.currentTime < this.retryAt) return Promise.resolve(false);

    const buffers = this.buffers;
    const pending = Promise.resolve().then(async () => {
      await Promise.allSettled(GRASS_SAMPLE_URLS.map(async (url, index) => {
        if (buffers[index]) return;
        const buffer = await this.loadBuffer(url, context, this.fetcher);
        if (!Number.isFinite(buffer?.duration) || buffer.duration < 0.01 || buffer.duration > 3) {
          throw new Error('Invalid grass recording');
        }
        if (this.context === context && this.buffers === buffers) buffers[index] = buffer;
      }));
      if (this.context !== context || this.buffers !== buffers) return false;
      const ready = buffers.every(Boolean);
      if (!ready) {
        this.failures = Math.min(5, this.failures + 1);
        this.retryAt = context.currentTime + Math.min(60, 5 * 2 ** (this.failures - 1));
      }
      return ready;
    }).finally(() => {
      if (this.loading === pending) this.loading = null;
    });
    this.loading = pending;
    return pending;
  }

  play(event = {}) {
    const context = this._syncContext();
    if (context?.state !== 'running' || this.engine.muted
      || this.engine.volumes?.master === 0 || this.engine.volumes?.sfx === 0) {
      this.pause();
      return [];
    }
    const strength = clamp(event?.strength, 1, 0, 1.5);
    const volume = clamp(event?.volume, 1, 0, 1);
    if (strength === 0 || volume === 0) return [];
    if (!this.buffers.every(Boolean)) {
      void this.prepare();
      return [];
    }

    const buffer = this.buffers[this.nextVariant];
    const nodes = [];
    let route;
    let source;
    let handle;
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      if (source) source.onended = null;
      for (const node of nodes) {
        try { node.disconnect(); } catch { /* A closed device is harmless. */ }
      }
      try { route?.dispose(); } catch { /* Route may already be gone. */ }
      this.handles.delete(handle);
    };
    try {
      const x = Number.isFinite(event?.x) ? event.x : undefined;
      const y = Number.isFinite(event?.y) ? event.y : undefined;
      route = this.engine.route('sfx', x, y);
      if (!route?.input) {
        cleanup();
        return [];
      }
      source = context.createBufferSource();
      nodes.push(source);
      const gain = context.createGain();
      nodes.push(gain);
      const at = context.currentTime;
      const rate = 0.98 + Math.random() * 0.04;
      const duration = buffer.duration / rate;
      const level = Math.min(0.12, 0.095 * Math.sqrt(strength) * volume);
      const fadeIn = Math.min(0.003, duration * 0.1);
      const fadeOut = Math.min(0.008, duration * 0.2);
      source.buffer = buffer;
      source.loop = false;
      source.playbackRate.setValueAtTime(rate, at);
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(level, at + fadeIn);
      gain.gain.setValueAtTime(level, at + duration - fadeOut);
      gain.gain.linearRampToValueAtTime(0, at + duration);
      source.connect(gain);
      gain.connect(route.input);
      source.onended = cleanup;
      source.start(at);
      this.nextVariant = (this.nextVariant + 1) % this.buffers.length;
      handle = {
        context,
        get ended() { return cleaned; },
        stop() {
          if (cleaned) return;
          try { source.stop(); } catch { /* Source may have naturally ended. */ }
          cleanup();
        },
      };
      if (cleaned) return [];
      this.handles.add(handle);
      return [handle];
    } catch {
      try { source?.stop(); } catch { /* Source may not have started. */ }
      cleanup();
      return [];
    }
  }

  pause() {
    for (const handle of this.handles) handle.stop();
    this.handles.clear();
  }
}

function playerFor(engine, options) {
  if (!engine || (typeof engine !== 'object' && typeof engine !== 'function')) return null;
  let player = players.get(engine);
  if (!player) {
    player = new GrassFootsteps(engine, options);
    players.set(engine, player);
  }
  return player;
}

export function prepareGrassFootsteps(engine, options) {
  return playerFor(engine, options)?.prepare() ?? Promise.resolve(false);
}

export function playGrassFootstep(engine, event = {}) {
  return playerFor(engine)?.play(event) ?? [];
}
