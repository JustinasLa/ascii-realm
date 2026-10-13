import { nextSoundVariant, ShuffleBag } from './variations.js';

const clamp = (value, fallback, minimum, maximum) =>
  Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : fallback));

async function loadRecording(url, context, fetcher) {
  const response = await fetcher(url);
  if (!response.ok) throw new Error('Recording unavailable');
  return context.decodeAudioData(await response.arrayBuffer());
}

/** Local recordings retain their real impact and runoff instead of a noise envelope. */
export class RecordedSounds {
  constructor(engine, banks, { bus = 'sfx', maxVoices = 24, fetcher = globalThis.fetch?.bind(globalThis),
    loadBuffer = loadRecording } = {}) {
    this.engine = engine;
    this.banks = banks;
    this.urls = [...new Set(Object.values(banks).flat())];
    this.bus = bus;
    this.maxVoices = Math.floor(clamp(maxVoices, 24, 1, 64));
    this.fetcher = fetcher;
    this.loadBuffer = loadBuffer;
    this.context = null;
    this.buffers = new Map();
    this.decks = new Map();
    this.loading = null;
    this.retryAt = 0;
    this.failures = 0;
    this.handles = new Set();
  }

  _syncContext() {
    const context = this.engine?.context;
    if (context !== this.context) {
      this.pause();
      this.context = context;
      this.buffers = new Map();
      this.decks = new Map();
      this.loading = null;
      this.retryAt = 0;
      this.failures = 0;
    }
    return context;
  }

  _audible() {
    return !this.engine?.muted && this.engine?.volumes?.master !== 0
      && this.engine?.volumes?.[this.bus] !== 0
      && (this.bus !== 'weather' || this.engine?.volumes?.ambience !== 0);
  }

  prepare() {
    const context = this._syncContext();
    if (context?.state !== 'running' || !this._audible()) {
      this.pause();
      return Promise.resolve(false);
    }
    const urls = this.urls;
    if (urls.every(url => this.buffers.has(url))) return Promise.resolve(true);
    if (this.loading) return this.loading;
    if (context.currentTime < this.retryAt) return Promise.resolve(false);
    const buffers = this.buffers;
    const pending = Promise.resolve().then(async () => {
      await Promise.allSettled(urls.map(async url => {
        if (buffers.has(url)) return;
        const buffer = await this.loadBuffer(url, context, this.fetcher);
        if (!Number.isFinite(buffer?.duration) || buffer.duration < 0.01 || buffer.duration > 12) {
          throw new Error('Invalid recording');
        }
        if (this.context === context && this.buffers === buffers) buffers.set(url, buffer);
      }));
      if (this.context !== context || this.buffers !== buffers) return false;
      const ready = urls.every(url => buffers.has(url));
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

  play(bank, event = {}, { gain = 0.2, key = bank, rate = 1, delay = 0 } = {}) {
    const context = this._syncContext();
    if (context?.state !== 'running' || !this._audible()) {
      this.pause();
      return [];
    }
    const strength = clamp(event?.strength, 0.6, 0, 1.5);
    const volume = clamp(event?.volume, 1, 0, 1);
    if (strength === 0 || volume === 0 || !Object.hasOwn(this.banks, bank)) return [];
    const urls = this.banks[bank];
    if (!urls.length) return [];
    if (!urls.every(url => this.buffers.has(url))) {
      void this.prepare();
      return [];
    }
    let deck = this.decks.get(bank);
    if (!deck) { deck = new ShuffleBag(urls); this.decks.set(bank, deck); }
    const buffer = this.buffers.get(deck.next());
    const variant = nextSoundVariant(this.engine, key);
    const nodes = [];
    let source;
    let route;
    let handle;
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      if (source) source.onended = null;
      for (const node of nodes) { try { node.disconnect(); } catch { /* Device closed. */ } }
      try { route?.dispose(); } catch { /* Route already gone. */ }
      this.handles.delete(handle);
    };
    try {
      const x = Number.isFinite(event?.x) ? event.x : undefined;
      const y = Number.isFinite(event?.y) ? event.y : undefined;
      route = this.engine.route(this.bus, x, y);
      if (!route?.input) { cleanup(); return []; }
      source = context.createBufferSource();
      nodes.push(source);
      const mixer = context.createGain();
      nodes.push(mixer);
      const at = context.currentTime + clamp(delay, 0, 0, 2);
      const playbackRate = clamp(rate, 1, 0.5, 2) * (0.985 + variant.id / 24 * 0.03);
      const duration = buffer.duration / playbackRate;
      const level = Math.min(0.6, clamp(gain, 0.2, 0, 0.6) * Math.sqrt(strength) * volume * variant.level);
      // Tiny boundary fades only: retain the recorded splash, bubbles and droplets.
      const fadeIn = Math.min(0.003, duration * 0.1);
      const fadeOut = Math.min(0.012, duration * 0.2);
      source.buffer = buffer;
      source.loop = false;
      source.playbackRate.setValueAtTime(playbackRate, at);
      mixer.gain.setValueAtTime(0, at);
      mixer.gain.linearRampToValueAtTime(level, at + fadeIn);
      mixer.gain.setValueAtTime(level, at + duration - fadeOut);
      mixer.gain.linearRampToValueAtTime(0, at + duration);
      source.connect(mixer);
      mixer.connect(route.input);
      source.onended = cleanup;
      source.start(at);
      handle = { context, bus: this.bus, get ended() { return cleaned; }, stop() {
        if (cleaned) return;
        try { source.stop(); } catch { /* Source ended naturally. */ }
        cleanup();
      } };
      if (cleaned) return [];
      while (this.handles.size >= this.maxVoices) this.handles.values().next().value.stop();
      this.handles.add(handle);
      return [handle];
    } catch {
      try { source?.stop(); } catch { /* Source never started. */ }
      cleanup();
      return [];
    }
  }

  pause() {
    for (const handle of this.handles) handle.stop();
    this.handles.clear();
  }
}
