// Real foley is decoded once per context. Pending voices remain cancellable so
// a late download can never resurrect a paused, reset or interrupted spell.
const states = new WeakMap();
const localRecording = url => typeof url === 'string' && /^\/assets\/audio\/spells\/[a-z]+\/[a-z0-9-]+\.wav$/.test(url);
const clamp = (v, fallback, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : fallback));
const audible = engine => engine.context?.state === 'running' && !engine.muted
  && engine.volumes?.master !== 0 && engine.volumes?.sfx !== 0;
const disconnect = node => { try { node?.disconnect(); } catch { /* Already released. */ } };

function stateFor(engine) {
  let state = states.get(engine);
  if (!state) {
    state = { context: engine.context, urls: new Set(), buffers: new Map(), pending: new Map(), retry: new Map(), voices: new Set(), options: {} };
    states.set(engine, state);
  }
  if (state.context !== engine.context) {
    for (const voice of state.voices) voice.stop();
    state.context = engine.context;
    state.buffers = new Map(); state.pending = new Map(); state.retry = new Map();
  }
  return state;
}

function load(state, url) {
  if (state.buffers.has(url)) return Promise.resolve(state.buffers.get(url));
  if (state.pending.has(url)) return state.pending.get(url);
  const context = state.context;
  if (!context || context.currentTime < (state.retry.get(url) ?? -Infinity)) return Promise.resolve(null);
  const buffers = state.buffers, pending = state.pending;
  const promise = Promise.resolve().then(async () => {
    let buffer;
    if (state.options.loadBuffer) buffer = await state.options.loadBuffer(url, context);
    else {
      const response = await (state.options.fetcher ?? globalThis.fetch)(url);
      if (!response.ok) throw new Error('Spell recording unavailable');
      buffer = await context.decodeAudioData(await response.arrayBuffer());
    }
    if (!Number.isFinite(buffer?.duration) || buffer.duration < 0.01 || buffer.duration > 12) throw new Error('Invalid spell recording');
    if (state.context !== context || state.buffers !== buffers) return null;
    buffers.set(url, buffer); state.retry.delete(url);
    return buffer;
  }).catch(() => {
    if (state.context === context) state.retry.set(url, context.currentTime + 5);
    return null;
  }).finally(() => pending.delete(url));
  pending.set(url, promise);
  return promise;
}

/** Register profiles even while locked; decode only after the first gesture. */
export function prepareSpellSounds(engine, presentations = [], options) {
  const state = stateFor(engine);
  if (options) state.options = { ...state.options, ...options };
  for (const entry of Array.isArray(presentations) ? presentations : [presentations]) {
    const profile = entry?.presentation ?? entry;
    for (const recipe of Object.values(profile?.sounds ?? {})) {
      if (!Array.isArray(recipe)) continue;
      for (const layer of recipe.slice(0, 8)) if (layer?.kind === 'recording' && localRecording(layer.url)) state.urls.add(layer.url);
    }
  }
  if (!audible(engine)) return Promise.resolve(false);
  return Promise.all([...state.urls].map(url => load(state, url))).then(buffers => buffers.every(Boolean));
}

export function playSpellRecording(engine, event, spec) {
  if (!audible(engine) || !localRecording(spec.url)) return null;
  const state = stateFor(engine), context = state.context;
  state.urls.add(spec.url);
  const requestedAt = context.currentTime;
  let ended = false, source, mixer, route;
  const cleanup = () => {
    if (ended) return;
    ended = true;
    if (source) source.onended = null;
    disconnect(source); disconnect(mixer);
    try { route?.dispose(); } catch { /* Context already closed. */ }
    state.voices.delete(handle);
  };
  const handle = { get ended() { return ended; }, stop() {
    if (ended) return;
    try { source?.stop(); } catch { /* Not started or already ended. */ }
    cleanup();
  } };
  while (state.voices.size >= 64) state.voices.values().next().value.stop();
  state.voices.add(handle);
  const start = buffer => {
    if (ended) return;
    if (!buffer || state.context !== context || engine.context !== context || !audible(engine)
      || context.currentTime - requestedAt > 0.35) { cleanup(); return; }
    try {
      route = engine.route('sfx', event.x, event.y);
      if (!route?.input) { cleanup(); return; }
      source = context.createBufferSource(); mixer = context.createGain();
      const rate = clamp(spec.rate, 1, 0.75, 1.2), duration = buffer.duration / rate;
      const at = Math.max(context.currentTime, requestedAt + clamp(spec.delay, 0, 0, 2));
      const gain = clamp(spec.gain, 0.4, 0, 0.8);
      source.buffer = buffer; source.loop = false;
      source.playbackRate.setValueAtTime(rate, at);
      mixer.gain.setValueAtTime(0, at);
      mixer.gain.linearRampToValueAtTime(gain, at + Math.min(0.004, duration / 4));
      mixer.gain.setValueAtTime(gain, at + duration - Math.min(0.025, duration / 4));
      mixer.gain.linearRampToValueAtTime(0, at + duration);
      source.connect(mixer); mixer.connect(route.input);
      source.onended = cleanup;
      source.start(at); source.stop(at + duration + 0.01);
    } catch { handle.stop(); }
  };
  if (state.buffers.has(spec.url)) start(state.buffers.get(spec.url));
  else void load(state, spec.url).then(start);
  return handle;
}
