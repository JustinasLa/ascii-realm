// The nine instrument voices. Plucked and hammered strings are physical
// models (Karplus-Strong) rendered once per pitch into cached buffers; the
// blown, bowed and reed voices are small live graphs whose movement (vibrato,
// bow noise, beating reeds, brass bloom) is their character.
import { noiseBuffer } from './voices.js';

// String buffers are rendered at this rate at most: the highest plucked
// note is under 3 kHz, and the browser resamples on playback.
export const STRING_RATE = 24000;
// Cached string buffers per audio context, least recently used dropped first.
export const MAX_STRING_BUFFERS = 36;

const caches = new WeakMap();
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const frequencyOf = midi => 440 * 2 ** ((midi - 69) / 12);

// How each string voice is excited and how it rings.
// decay: seconds to fall 60 dB; damping: 0 (bright) to 0.5 (dull) loop
// filter; pluck: where along the string it is struck; courses: cents of each
// string tuned together; soften: low-pass on the excitation (0 = bright).
export const STRING_RECIPES = Object.freeze({
  pluck: Object.freeze({ excitation: 'noise', decay: 1.8, damping: 0.5, pluck: 1 / 5,
    courses: Object.freeze([-1.5, 1.5]), soften: 0.55 }),
  harp: Object.freeze({ excitation: 'noise', decay: 2.5, damping: 0.25, pluck: 1 / 8,
    courses: Object.freeze([0]), soften: 0 }),
  hammered: Object.freeze({ excitation: 'hammer', decay: 2.3, damping: 0.18, pluck: 1 / 7,
    courses: Object.freeze([-6, 0, 7]), soften: 0.2 }),
});
export const STRING_VOICES = new Set(Object.keys(STRING_RECIPES));

function seeded(seed) {
  let state = (seed | 0) || 0x2545f491;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x80000000 - 1;
  };
}

// One period of excitation for a string of `length` samples.
function excite(length, recipe, random, sampleRate) {
  const line = new Float32Array(length);
  if (recipe.excitation === 'hammer') {
    // A felt-less hammer: a short raised-cosine pulse with a little grit.
    const width = Math.max(2, Math.min(length - 1, Math.round(sampleRate * 0.0015)));
    for (let index = 0; index < width; index++) {
      line[index] = 0.5 - 0.5 * Math.cos(2 * Math.PI * index / width);
    }
    for (let index = 0; index < length; index++) line[index] += 0.15 * random();
  } else {
    for (let index = 0; index < length; index++) line[index] = random();
  }
  // Soften the attack: a one-pole low-pass, run twice so it wraps smoothly.
  if (recipe.soften > 0) {
    let held = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (let index = 0; index < length; index++) {
        held += (1 - recipe.soften) * (line[index] - held);
        line[index] = held;
      }
    }
  }
  // Where the string is plucked: a comb removes the harmonics with a node there.
  const offset = Math.max(1, Math.round(length * recipe.pluck));
  const copy = line.slice();
  let mean = 0;
  for (let index = 0; index < length; index++) {
    line[index] = copy[index] - copy[(index + length - offset) % length];
    mean += line[index];
  }
  mean /= length;
  for (let index = 0; index < length; index++) line[index] -= mean;
  return line;
}

/**
 * Renders a decaying string tone (Karplus-Strong with an all-pass tuner and a
 * per-pitch loop gain, so every pitch rings for the recipe's decay time).
 * Deterministic for a given seed. Peak-normalised to 1.
 */
export function renderString(sampleRate, frequency, recipe, seconds, seed = 1) {
  const total = Math.max(2, Math.round(sampleRate * seconds));
  const out = new Float32Array(total);
  const random = seeded(seed);
  for (const cents of recipe.courses) {
    const pitch = Math.min(frequency * 2 ** (cents / 1200), sampleRate * 0.45);
    const period = sampleRate / pitch;
    // Loss per trip round the loop so the fundamental falls 60 dB in `decay`
    // seconds at any pitch. High notes go round so often that the loop filter
    // alone would kill them, so it may take at most half the loss.
    const target = 0.001 ** (1 / (recipe.decay * pitch));
    const bend = 2 * (1 - Math.cos(2 * Math.PI * pitch / sampleRate));
    const room = (1 - target) / bend;
    const damping = Math.min(clamp(recipe.damping, 0, 0.5), room >= 0.25 ? 0.5 : (1 - Math.sqrt(1 - 4 * room)) / 2);
    const filterLoss = Math.sqrt(1 - damping * (1 - damping) * bend);
    const loop = target / filterLoss;
    // The delay line, the loop filter's delay and the all-pass make one period.
    const length = Math.max(2, Math.floor(period - damping - 0.1));
    const fraction = period - damping - length;
    const tune = (1 - fraction) / (1 + fraction);
    const line = excite(length, recipe, random, sampleRate);
    let index = 0;
    let previous = 0;
    let tuneIn = 0;
    let tuneOut = 0;
    for (let sample = 0; sample < total; sample++) {
      const value = line[index];
      out[sample] += value;
      const filtered = (1 - damping) * value + damping * previous;
      previous = value;
      const tuned = tune * filtered + tuneIn - tune * tuneOut;
      tuneIn = filtered;
      tuneOut = tuned;
      line[index] = tuned * loop;
      index = index + 1 === length ? 0 : index + 1;
    }
  }
  // Remove any DC, fade the last 30 ms and normalise.
  let input = 0;
  let output = 0;
  let peak = 0;
  const fade = Math.min(total, Math.round(sampleRate * 0.03));
  for (let sample = 0; sample < total; sample++) {
    output = out[sample] - input + 0.995 * output;
    input = out[sample];
    const left = total - 1 - sample;
    out[sample] = left <= fade ? output * (0.5 - 0.5 * Math.cos(Math.PI * left / fade)) : output;
    peak = Math.max(peak, Math.abs(out[sample]));
  }
  if (peak > 0) for (let sample = 0; sample < total; sample++) out[sample] /= peak;
  return out;
}

function cacheOf(context) {
  let cache = caches.get(context);
  if (!cache) caches.set(context, cache = new Map());
  return cache;
}

/** The cached buffer for an instrument's string at a MIDI pitch, rendered on first use. */
export function stringBuffer(context, instrument, midi) {
  const cache = cacheOf(context);
  const key = `${instrument.id}:${midi}`;
  let buffer = cache.get(key);
  if (buffer) {
    cache.delete(key);
    cache.set(key, buffer);
    return buffer;
  }
  const rate = Math.min(context.sampleRate, STRING_RATE);
  const samples = renderString(rate, frequencyOf(midi), STRING_RECIPES[instrument.voice],
    instrument.length, midi * 7919 + instrument.id.length * 104729);
  buffer = context.createBuffer(1, samples.length, rate);
  buffer.getChannelData(0).set(samples);
  cache.set(key, buffer);
  while (cache.size > MAX_STRING_BUFFERS) cache.delete(cache.keys().next().value);
  return buffer;
}

/** Renders the given pitches a few at a time, between frames. */
export function prepareStrings(context, instrument, midis) {
  const pending = [...midis];
  return new Promise(resolve => {
    const slice = () => {
      try {
        for (const midi of pending.splice(0, 4)) stringBuffer(context, instrument, midi);
      } catch {
        resolve(false);
        return;
      }
      if (pending.length) setTimeout(slice, 0);
      else resolve(true);
    };
    setTimeout(slice, 0);
  });
}

// Graph helpers. Every node created is listed so the caller can disconnect it.
function graph(context) {
  const nodes = [];
  const sources = [];
  const offsets = new Map();
  const keep = node => { nodes.push(node); return node; };
  return {
    nodes,
    sources,
    offsets,
    gain(value) {
      const node = keep(context.createGain());
      node.gain.value = value;
      return node;
    },
    filter(type, frequency, Q = 0.7, gain = 0) {
      const node = keep(context.createBiquadFilter());
      node.type = type;
      node.frequency.value = clamp(frequency, 20, context.sampleRate * 0.45);
      node.Q.value = Q;
      if (gain) node.gain.value = gain;
      return node;
    },
    // Audible oscillators stay in the hearing range; a slow LFO may go lower.
    oscillator(type, frequency, at, slow = false) {
      const node = keep(context.createOscillator());
      node.type = type;
      node.frequency.setValueAtTime(clamp(frequency, slow ? 0.1 : 20, context.sampleRate * 0.45), at);
      sources.push(node);
      return node;
    },
    noise() {
      const node = keep(context.createBufferSource());
      node.buffer = noiseBuffer(context);
      node.loop = true;
      sources.push(node);
      // Each note reads a different stretch of the shared noise.
      offsets.set(node, Math.random() * 1.5);
      return node;
    },
    buffer(buffer, rate) {
      const node = keep(context.createBufferSource());
      node.buffer = buffer;
      node.playbackRate.value = rate;
      sources.push(node);
      return node;
    },
    chain(...items) {
      for (let index = 1; index < items.length; index++) items[index - 1].connect(items[index]);
    },
  };
}

// Attack to the peak, settle to `sustain`, and release so the note is silent at `end`.
function shape(param, at, end, peak, { attack, sustain = 1, settle = 0.12, release }) {
  const top = at + attack;
  const fall = Math.max(top + 0.001, end - release);
  param.setValueAtTime(0, at);
  param.linearRampToValueAtTime(peak, top);
  if (sustain !== 1) param.linearRampToValueAtTime(peak * sustain, Math.min(fall, top + settle));
  param.setValueAtTime(peak * sustain, fall);
  param.linearRampToValueAtTime(0, end);
}

// A slow vibrato that fades in, driving each oscillator's detune in cents.
function vibrato(g, at, rate, cents, from, to, targets) {
  const lfo = g.oscillator('sine', rate, at, true);
  const depth = g.gain(0);
  depth.gain.setValueAtTime(0, at);
  depth.gain.setValueAtTime(0, at + from);
  depth.gain.linearRampToValueAtTime(cents, at + to);
  lfo.connect(depth);
  for (const target of targets) depth.connect(target.detune);
}

const ENVELOPES = {
  // A short tine: a pure decaying tone, a soft inharmonic partial and a click.
  tine: { attack: 0.002, release: 0.06 },
  reed: { attack: 0.035, sustain: 0.85, release: 0.2 },
  bowed: { attack: 0.09, sustain: 0.85, settle: 0.2, release: 0.35 },
  chanter: { attack: 0.015, release: 0.15 },
  breath: { attack: 0.06, release: 0.3 },
  brass: { attack: 0.025, sustain: 0.8, release: 0.2 },
};

// Each live voice connects its sound into `envelope`, which shapes the note.
const LIVE = {
  tine(g, context, f, at, end, envelope) {
    const body = g.gain(0);
    g.chain(g.oscillator('sine', f, at), body, envelope);
    body.gain.setValueAtTime(0, at);
    body.gain.linearRampToValueAtTime(1, at + 0.002);
    body.gain.setTargetAtTime(0, at + 0.002, 0.35);
    if (f * 5.95 < context.sampleRate * 0.45) {
      const partial = g.gain(0);
      g.chain(g.oscillator('sine', f * 5.95, at), partial, envelope);
      partial.gain.setValueAtTime(0, at);
      partial.gain.linearRampToValueAtTime(0.08, at + 0.002);
      partial.gain.setTargetAtTime(0, at + 0.002, 0.05);
    }
    const click = g.gain(0);
    g.chain(g.noise(), g.filter('highpass', 2500, 0.7), click, envelope);
    click.gain.setValueAtTime(0.05, at);
    click.gain.linearRampToValueAtTime(0, at + 0.008);
  },
  // A bowed string: two close sawtooths, a bridge resonance and bow hair.
  bowed(g, context, f, at, end, envelope) {
    const tone = g.filter('lowpass', 2400, 0.7);
    const strings = [g.oscillator('sawtooth', f, at), g.oscillator('sawtooth', f, at)];
    strings[1].detune.setValueAtTime(4, at);
    for (const string of strings) g.chain(string, g.gain(0.5), tone);
    g.chain(tone, g.filter('peaking', 2800, 1, 3), envelope);
    vibrato(g, at, 5.5, 8, 0.3, 0.6, strings);
    const hair = g.gain(0);
    g.chain(g.noise(), g.filter('bandpass', 3000, 1.2), hair, envelope);
    hair.gain.setValueAtTime(0.12, at);
    hair.gain.linearRampToValueAtTime(0.04, at + 0.25);
  },
  // Two reeds tuned apart, so the note beats like a musette accordion.
  reed(g, context, f, at, end, envelope) {
    const mix = g.gain(0.5);
    for (const cents of [-7, 7]) {
      const reed = g.oscillator('sawtooth', f, at);
      reed.detune.setValueAtTime(cents, at);
      reed.connect(mix);
    }
    g.chain(mix, g.filter('highpass', 150, 0.7), g.filter('lowpass', 3000, 0.6), envelope);
  },
  // A nasal chanter opened by a grace note, over the pipe's quiet drone. A
  // bagpipe has one drone, so notes played over others bring less of it.
  chanter(g, context, f, at, end, envelope, instrument, company) {
    const chanter = g.oscillator('sawtooth', f * 1.5, at);
    chanter.frequency.setValueAtTime(clamp(f, 20, context.sampleRate * 0.45), at + 0.022);
    g.chain(chanter, g.filter('highpass', 350, 0.7), g.filter('peaking', 1300, 2.5, 8), g.gain(0.82), envelope);
    const drone = g.oscillator('sawtooth', frequencyOf(instrument.root - 12), at);
    g.chain(drone, g.filter('lowpass', 500, 0.7), g.gain(0.12 / (1 + company)), envelope);
  },
  // A breathy flute: near-sine tone with a chiff at the start and a vibrato.
  breath(g, context, f, at, end, envelope) {
    const mix = g.gain(1);
    const tone = g.oscillator('sine', f, at);
    const overtone = g.oscillator('sine', f * 2, at);
    g.chain(tone, mix);
    g.chain(overtone, g.gain(0.12), mix);
    vibrato(g, at, 5, 10, 0.25, 0.6, [tone, overtone]);
    const air = g.gain(0);
    g.chain(g.noise(), g.filter('bandpass', f * 2, 1.5), air, mix);
    air.gain.setValueAtTime(0.14, at);
    air.gain.linearRampToValueAtTime(0.035, at + 0.05);
    mix.connect(envelope);
  },
  // Bright brass: the filter opens as the lips buzz, after a small pitch scoop.
  brass(g, context, f, at, end, envelope) {
    const mix = g.gain(0.5);
    for (const cents of [0, 3]) {
      const horn = g.oscillator('sawtooth', f, at);
      horn.detune.setValueAtTime(cents - 30, at);
      horn.detune.linearRampToValueAtTime(cents, at + 0.04);
      horn.connect(mix);
    }
    const bell = g.filter('lowpass', f * 1.5, 1.1);
    const top = context.sampleRate * 0.45;
    bell.frequency.setValueAtTime(Math.min(top, f * 1.5), at);
    bell.frequency.linearRampToValueAtTime(Math.min(top, f * 8), at + 0.045);
    bell.frequency.linearRampToValueAtTime(Math.min(top, f * 5), at + 0.2);
    g.chain(mix, bell, envelope);
  },
};

const STRINGS = {
  // A lute: paired courses through a warm wooden body.
  pluck(g, source, envelope) {
    g.chain(source, g.filter('peaking', 220, 1, 4), g.filter('lowpass', 3800, 0.7), envelope);
  },
  // A harp: one bright, long string with a little extra sparkle.
  harp(g, source, envelope) {
    g.chain(source, g.filter('highshelf', 3000, 0.7, 3), envelope);
  },
  // A dulcimer: three struck strings beating, partly through a soundboard.
  hammered(g, source, envelope) {
    g.chain(source, g.gain(0.7), envelope);
    g.chain(source, g.filter('bandpass', 600, 0.7), g.gain(0.3), envelope);
  },
};

/**
 * Builds one pitch of an instrument into `destination`, starting at `at`,
 * with `company` voices of the same instrument already sounding.
 * Returns { sources, nodes, envelope }, or null if the graph can't be made
 * (every node made so far is then disconnected).
 */
export function buildVoice(context, destination, instrument, midi, at, company = 0) {
  const g = graph(context);
  const pitch = clamp(instrument.pitch, 0.5, 2);
  const end = at + instrument.length;
  try {
    const envelope = g.gain(0);
    if (STRING_VOICES.has(instrument.voice)) {
      const source = g.buffer(stringBuffer(context, instrument, midi), pitch);
      shape(envelope.gain, at, end, instrument.level, { attack: 0.002, release: 0.05 });
      STRINGS[instrument.voice](g, source, envelope);
    } else {
      shape(envelope.gain, at, end, instrument.level, ENVELOPES[instrument.voice]);
      LIVE[instrument.voice](g, context, frequencyOf(midi) * pitch, at, end, envelope, instrument, company);
    }
    envelope.connect(destination);
    for (const source of g.sources) {
      if (g.offsets.has(source)) source.start(at, g.offsets.get(source));
      else source.start(at);
      source.stop(end + 0.01);
    }
    return { sources: g.sources, nodes: g.nodes, envelope };
  } catch {
    for (const source of g.sources) {
      try { source.stop(); } catch { /* Not started. */ }
    }
    for (const node of g.nodes) {
      try { node.disconnect(); } catch { /* Not connected. */ }
    }
    return null;
  }
}
