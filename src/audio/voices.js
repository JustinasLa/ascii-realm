// Small Web Audio instruments. Nothing is allocated until audio is unlocked.
const noiseBuffers = new WeakMap();
const EPSILON = 0.0001;
const WAVEFORMS = new Set(['sine', 'square', 'sawtooth', 'triangle']);
const FILTERS = new Set(['lowpass', 'highpass', 'bandpass', 'lowshelf', 'highshelf', 'peaking', 'notch', 'allpass']);

function bounded(value, fallback, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : fallback));
}

function activeContext(engine) {
  const context = engine?.context;
  return context?.state === 'running' ? context : null;
}

function frequency(value, fallback, context) {
  return bounded(value, fallback, 20, Math.min(20000, context.sampleRate * 0.45));
}

function disconnect(node) {
  try { node?.disconnect(); } catch { /* Already disconnected. */ }
}

/** Smooth a live parameter without retaining old automation. */
export function setParam(param, value, time, smoothing = 0.08) {
  if (!param || !Number.isFinite(value) || !Number.isFinite(time)) return;
  const at = Math.max(0, time);
  const seconds = bounded(smoothing, 0.08, 0, 10);
  try {
    if (typeof param.cancelAndHoldAtTime === 'function') {
      param.cancelAndHoldAtTime(at);
    } else {
      param.cancelScheduledValues(at);
      param.setValueAtTime(Number.isFinite(param.value) ? param.value : value, at);
    }
    if (seconds === 0) param.setValueAtTime(value, at);
    else param.setTargetAtTime(value, at, Math.max(0.001, seconds / 3));
  } catch { /* A closed context must not interrupt gameplay. */ }
}

function noiseBuffer(context) {
  let buffer = noiseBuffers.get(context);
  if (buffer) return buffer;
  buffer = context.createBuffer(1, Math.max(2, Math.floor(context.sampleRate * 2)), context.sampleRate);
  const samples = buffer.getChannelData(0);
  let seed = 0x5f3759df;
  for (let index = 0; index < samples.length; index++) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    samples[index] = (seed >>> 0) / 0x80000000 - 1;
  }
  // A noise loop has no tonal boundary; matching the endpoints also removes a DC step.
  samples[samples.length - 1] = samples[0];
  noiseBuffers.set(context, buffer);
  return buffer;
}

function filtered(context, options, fallbackCutoff) {
  const filter = context.createBiquadFilter();
  filter.type = FILTERS.has(options.filterType) ? options.filterType : 'lowpass';
  filter.frequency.value = frequency(options.cutoff, fallbackCutoff, context);
  filter.Q.value = bounded(options.Q, 0.7, 0, 30);
  return filter;
}

function oneShot(engine, options, createSource) {
  const context = activeContext(engine);
  if (!context) return null;
  const route = engine.route(options.bus ?? 'sfx', options.x, options.y);
  if (!route?.input) return null;
  const nodes = [];
  let source;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    for (const node of nodes) disconnect(node);
    route.dispose();
  };
  try {
    const at = Math.max(context.currentTime, bounded(options.when, context.currentTime, 0, context.currentTime + 60));
    const duration = bounded(options.duration, 0.2, 0.005, 60);
    const level = bounded(options.gain, 0.1, 0, 1);
    const attack = bounded(options.attack, 0.005, 0.001, duration * 0.5);
    const release = bounded(options.release, Math.min(0.08, duration * 0.4),
      0.001, duration - attack);
    const availableDecay = Math.max(0, duration - attack - release);
    const decay = bounded(options.decay,
      Number.isFinite(options.sustain) ? Math.min(0.03, availableDecay) : 0,
      0, availableDecay);
    const sustain = bounded(options.sustain, 1, 0, 1);
    const gain = context.createGain();
    nodes.push(gain);
    gain.gain.setValueAtTime(0, at);
    // With no decay, attack directly to the held level. This avoids an
    // abrupt gain change at release when a caller requests sustain < 1.
    gain.gain.linearRampToValueAtTime(decay > 0 ? level : level * sustain, at + attack);
    if (decay > 0) {
      gain.gain.linearRampToValueAtTime(level * sustain, at + attack + decay);
    }
    gain.gain.setValueAtTime(level * sustain, at + duration - release);
    gain.gain.linearRampToValueAtTime(0, at + duration);
    source = createSource(context, at, duration);
    nodes.push(source);
    let tail = source;
    if (options.cutoff !== undefined || options.noise) {
      const filter = filtered(context, options, options.noise ? 1000 : 12000);
      nodes.push(filter);
      tail.connect(filter);
      tail = filter;
    }
    tail.connect(gain);
    gain.connect(route.input);
    source.onended = cleanup;
    if (options.noise) {
      // Each contact samples a different patch of the shared noise texture.
      // This varies the grain itself without allocating a new buffer.
      const offset = bounded(options.offset, Math.random(), 0, 0.999999999);
      source.start(at, offset * source.buffer.length / context.sampleRate);
    } else {
      source.start(at);
    }
    source.stop(at + duration + 0.01);
    return {
      get ended() { return cleaned; },
      stop() {
        if (cleaned) return;
        try { source.stop(); } catch { /* A scheduled source may have ended. */ }
        cleanup();
      },
    };
  } catch {
    try { source?.stop(); } catch { /* A source may not have started. */ }
    cleanup();
    return null;
  }
}

/** Play an enveloped oscillator, optionally with a pitch glide. */
export function tone(engine, options = {}) {
  return oneShot(engine, options, (context, at, duration) => {
    const oscillator = context.createOscillator();
    oscillator.type = WAVEFORMS.has(options.type) ? options.type : 'sine';
    const startFrequency = frequency(options.frequency, 440, context);
    const endFrequency = frequency(options.endFrequency, startFrequency, context);
    oscillator.frequency.setValueAtTime(startFrequency, at);
    if (endFrequency !== startFrequency) {
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(EPSILON, endFrequency), at + duration);
    }
    oscillator.detune.setValueAtTime(bounded(options.detune, 0, -4800, 4800), at);
    return oscillator;
  });
}

/** Play a short filtered burst from a context-local noise buffer. */
export function noise(engine, options = {}) {
  return oneShot(engine, { ...options, noise: true }, context => {
    const source = context.createBufferSource();
    source.buffer = noiseBuffer(context);
    source.loop = true;
    source.playbackRate?.setValueAtTime(bounded(options.playbackRate, 1, 0.5, 2), context.currentTime);
    return source;
  });
}

/** Sustained ambience; callers can smoothly animate the returned gain/filter. */
export function loopNoise(engine, options = {}) {
  const context = activeContext(engine);
  if (!context) return null;
  const route = engine.route(options.bus ?? 'ambience', options.x, options.y);
  if (!route?.input) return null;
  const nodes = [];
  let source;
  let stopped = false;
  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    for (const node of nodes) disconnect(node);
    route.dispose();
  };
  try {
    source = context.createBufferSource();
    nodes.push(source);
    source.buffer = noiseBuffer(context);
    source.loop = true;
    source.playbackRate?.setValueAtTime(bounded(options.playbackRate, 1, 0.5, 2), context.currentTime);
    const filter = filtered(context, options, 400);
    const gain = context.createGain();
    nodes.push(filter, gain);
    gain.gain.value = bounded(options.gain, 0, 0, 1);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(route.input);
    source.onended = cleanup;
    source.start(context.currentTime, bounded(options.offset, Math.random(), 0, 0.999999999)
      * source.buffer.length / context.sampleRate);
    return {
      gain,
      filter,
      pan: route.pan ?? null,
      stop() {
        if (stopped) return;
        try { source.stop(); } catch { /* Stop remains safe after context closure. */ }
        cleanup();
      },
    };
  } catch {
    try { source?.stop(); } catch { /* A source may not have started. */ }
    cleanup();
    return null;
  }
}
