import { midiToFrequency } from './songs.js';

const roomImpulses = new WeakMap();
const ROOM_SECONDS = 2.8;
const profiles = {
  choir: { type: 'triangle', attack: 1.5, decay: 0.8, sustain: 0.65, release: 2, cutoff: 1050 },
  bowed: { type: 'triangle', attack: 1.1, decay: 0.7, sustain: 0.72, release: 1.6, cutoff: 1400 },
  drone: { type: 'sine', attack: 2, decay: 0.8, sustain: 0.75, release: 2.5, cutoff: 600 },
  bell: { type: 'sine', attack: 0.012, decay: 1.4, sustain: 0.02, release: 1.8, cutoff: 2800 },
  breath: { type: 'sine', attack: 0.7, decay: 0.6, sustain: 0.35, release: 1.2, cutoff: 1550 },
};
const clamp = (value, fallback, low, high) => Math.min(high, Math.max(low,
  Number.isFinite(value) ? value : fallback));
const active = context => context?.state === 'running';
const disconnect = node => {
  try { node?.disconnect(); } catch { /* The context may already be closed. */ }
};

function roomImpulse(context) {
  const cached = roomImpulses.get(context);
  if (cached) return cached;
  const length = Math.max(2, Math.ceil(context.sampleRate * ROOM_SECONDS));
  const impulse = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const samples = impulse.getChannelData(channel);
    let seed = (0x45d9f3b ^ (channel + 1) * 0x27d4eb2d) | 0;
    let colored = 0;
    let energy = 0;
    for (let index = 0; index < length; index++) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      const time = index / context.sampleRate;
      // Stereo diffuse reflections darken as they decay into the stone room.
      const brightness = 0.2 - 0.13 * (time / ROOM_SECONDS);
      colored += brightness * ((seed >>> 0) / 0x80000000 - 1 - colored);
      const entrance = Math.min(1, Math.max(0, (time - 0.024 - channel * 0.007) / 0.045));
      const ending = Math.min(1, (length - index - 1) / (context.sampleRate * 0.08));
      samples[index] = colored * entrance * ending * Math.exp(-4.4 * time / ROOM_SECONDS);
      energy += samples[index] ** 2;
    }
    // Explicit energy normalization keeps room level consistent across sample rates.
    const scale = Math.sqrt(0.9 / Math.max(energy, 0.000001));
    for (let index = 0; index < length; index++) samples[index] *= scale;
  }
  roomImpulses.set(context, impulse);
  return impulse;
}

/** A shared dark room for an entire score pair, including its retiring tails. */
export function createMusicRoom(context, destination) {
  if (!active(context) || !destination) return null;
  const nodes = [];
  let convolver;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const node of nodes) disconnect(node);
    if (convolver) convolver.buffer = null;
  };
  try {
    const input = context.createGain();
    nodes.push(input);
    const dry = context.createGain();
    nodes.push(dry);
    dry.gain.value = 0.82;
    convolver = context.createConvolver();
    nodes.push(convolver);
    convolver.normalize = false;
    convolver.buffer = roomImpulse(context);
    const darkness = context.createBiquadFilter();
    nodes.push(darkness);
    darkness.type = 'lowpass';
    darkness.frequency.value = 2200;
    darkness.Q.value = 0.5;
    const wet = context.createGain();
    nodes.push(wet);
    wet.gain.value = 0.34;
    input.connect(dry);
    dry.connect(destination);
    input.connect(convolver);
    convolver.connect(darkness);
    darkness.connect(wet);
    wet.connect(destination);
    return { input, dispose };
  } catch {
    dispose();
    return null;
  }
}

/** Soft, drifting score instruments with a complete release after the note gate. */
export function playMusicNote(engine, event = {}, when, duration) {
  const context = engine?.context;
  if (!active(context)) return null;
  const level = clamp(event.gain, 0.014, 0, 0.15);
  if (level === 0) return null;
  const route = engine.route('music');
  if (!route?.input) return null;
  const profile = profiles[event.voice] ?? profiles.breath;
  const at = clamp(when, context.currentTime, context.currentTime, context.currentTime + 60);
  const gate = clamp(duration, 2, 0.06, 60);
  const attack = clamp(event.attack, profile.attack, 0.005, gate * 0.55);
  const decay = clamp(event.decay, profile.decay, 0.01, Math.max(0.01, gate - attack));
  const sustain = clamp(event.sustain, profile.sustain, 0, 1);
  const release = clamp(event.release, profile.release, 0.08, 8);
  const end = at + gate + release;
  const nodes = [];
  const sources = [];
  let ended = false;
  let remaining = 0;
  const cleanup = () => {
    if (ended) return;
    ended = true;
    for (const node of nodes) disconnect(node);
    try { route.dispose(); } catch { /* Route teardown is idempotent. */ }
  };
  const stop = () => {
    if (ended) return;
    for (const source of sources) {
      try { source.stop(); } catch { /* Scheduled or naturally ended sources. */ }
    }
    cleanup();
  };
  try {
    const envelope = context.createGain();
    nodes.push(envelope);
    const floor = level * 0.0001;
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(level, at + attack);
    envelope.gain.exponentialRampToValueAtTime(Math.max(floor, level * sustain), at + attack + decay);
    envelope.gain.setValueAtTime(Math.max(floor, level * sustain), at + gate);
    envelope.gain.exponentialRampToValueAtTime(floor, end - 0.02);
    envelope.gain.linearRampToValueAtTime(0, end);
    const filter = context.createBiquadFilter();
    nodes.push(filter);
    filter.type = 'lowpass';
    filter.Q.value = event.voice === 'bowed' ? 0.8 : 0.5;
    const cutoff = clamp(event.cutoff, profile.cutoff, 120, Math.min(12000, context.sampleRate * 0.45));
    filter.frequency.setValueAtTime(cutoff, at);
    filter.frequency.linearRampToValueAtTime(cutoff * 0.8, end);
    filter.connect(envelope);
    envelope.connect(route.input);
    const fundamental = clamp(midiToFrequency(event.note), 440, 20, Math.min(10000, context.sampleRate * 0.4));
    const detune = clamp(event.detune, 0, -100, 100);
    const spread = clamp(event.spread, 0, 0, 30);
    const addOscillator = (ratio, weight, cents, waveform, drift = 0) => {
      const oscillator = context.createOscillator();
      sources.push(oscillator);
      nodes.push(oscillator);
      oscillator.type = waveform;
      oscillator.frequency.setValueAtTime(Math.min(context.sampleRate * 0.45, fundamental * ratio), at);
      oscillator.detune.setValueAtTime(detune + cents, at);
      oscillator.detune.linearRampToValueAtTime(detune + cents + drift, end);
      const mix = context.createGain();
      nodes.push(mix);
      mix.gain.value = weight;
      oscillator.connect(mix);
      mix.connect(filter);
    };
    if (['choir', 'bowed', 'drone'].includes(event.voice) && spread > 0) {
      addOscillator(1, 0.5, -spread / 2, profile.type, spread * 0.15);
      addOscillator(1, 0.5, spread / 2, event.voice === 'drone' ? 'triangle' : profile.type, -spread * 0.15);
    } else if (event.voice === 'bell') {
      addOscillator(1, 0.89, 0, 'sine');
      addOscillator(clamp(event.ratio, 2.71, 1.05, 5), 0.11, 3, 'sine');
    } else if (event.voice === 'breath') {
      addOscillator(1, 0.88, 0, 'sine', -2);
      addOscillator(2, 0.12, 4, 'triangle', 1);
    } else {
      addOscillator(1, 1, 0, profile.type);
    }
    remaining = sources.length;
    for (const source of sources) {
      source.onended = () => {
        remaining--;
        if (remaining <= 0) cleanup();
      };
      source.start(at);
      source.stop(end + 0.01);
    }
    return { stop, get ended() { return ended; }, end: end + 0.01 };
  } catch {
    stop();
    return null;
  }
}
