import { noise, setParam } from './voices.js';
import { nextSoundVariant, varySound } from './variations.js';

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const chargeBuffers = new WeakMap();

function chargeBuffer(context) {
  let buffer = chargeBuffers.get(context);
  if (buffer) return buffer;
  buffer = context.createBuffer(1, Math.max(2, Math.floor(context.sampleRate * 1.5)), context.sampleRate);
  const samples = buffer.getChannelData(0);
  let seed = 0xa341316c;
  for (let i = 0; i < samples.length; i += 1) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    samples[i] = (seed >>> 0) / 0x80000000 - 1;
  }
  samples[samples.length - 1] = samples[0];
  chargeBuffers.set(context, buffer);
  return buffer;
}

/** Weathered steel, leather and low air pressure; one cue per sword action. */
export function playSword(engine, event = {}) {
  const context = engine?.context;
  if (!context || context.state !== 'running') return null;

  const position = { bus: 'sword', x: event.x, y: event.y };
  const strength = Math.sqrt(clamp(finite(event.strength, 1), 0, 2));
  const speed = clamp(finite(event.speed, 1), 0, 2) / 2;
  const voices = [];
  if (!['draw', 'sheathe', 'swing', 'slam', 'whirl'].includes(event.type)) return null;
  const variant = nextSoundVariant(engine, `sword:${event.type}`);
  let layer = 0;
  const scheduled = options => ({ ...position, ...varySound(variant, options, layer++),
    when: context.currentTime + (options.when ?? 0) * variant.timing });
  const air = (options) => voices.push(noise(engine, scheduled(options)));

  switch (event.type) {
    case 'draw':
      // Rough steel friction sits close to soft, dry leather handling.
      air({ cutoff: 1250, filterType: 'bandpass', Q: 0.85, duration: 0.19, gain: 0.046, attack: 0.012, decay: 0.09, sustain: 0.22, release: 0.055 });
      air({ cutoff: 440, Q: 0.6, duration: 0.21, gain: 0.043, attack: 0.02, decay: 0.11, sustain: 0.2, release: 0.065 });
      air({ cutoff: 1900, filterType: 'bandpass', Q: 0.7, duration: 0.065, gain: 0.014, attack: 0.004, decay: 0.024, sustain: 0.1, release: 0.025, when: 0.075 });
      break;
    case 'sheathe':
      air({ cutoff: 820, filterType: 'bandpass', Q: 0.65, duration: 0.17, gain: 0.037, attack: 0.014, decay: 0.065, sustain: 0.18, release: 0.045 });
      air({ cutoff: 350, Q: 0.6, duration: 0.19, gain: 0.036, attack: 0.017, decay: 0.085, sustain: 0.14, release: 0.055 });
      air({ cutoff: 235, Q: 0.8, duration: 0.065, gain: 0.14, attack: 0.001, decay: 0.018, sustain: 0.08, release: 0.035, when: 0.115 });
      break;
    case 'swing':
      // Broad rush and a darker pressure wake carry the blade's weight.
      air({ cutoff: 660 + speed * 1000, filterType: 'bandpass', Q: 0.65, duration: 0.23 - speed * 0.1, gain: (0.035 + speed * 0.027) * strength, attack: 0.027 - speed * 0.014, decay: 0.065 - speed * 0.025, sustain: 0.18, release: 0.055 });
      air({ cutoff: 220 + speed * 140, Q: 0.8, duration: 0.22 - speed * 0.065, gain: (0.065 + speed * 0.026) * strength, attack: 0.019, decay: 0.075, sustain: 0.16, release: 0.065 });
      break;
    case 'slam':
      // A deeply damped stone/steel contact: mass, grit, then a small dark tail.
      air({ cutoff: 185, Q: 0.85, duration: 0.18, gain: 0.26 * strength, attack: 0.001, decay: 0.045, sustain: 0.09, release: 0.09 });
      air({ cutoff: 650, filterType: 'bandpass', Q: 1.1, duration: 0.12, gain: 0.081 * strength, attack: 0.001, decay: 0.025, sustain: 0.1, release: 0.055 });
      air({ cutoff: 1650, filterType: 'bandpass', Q: 0.7, duration: 0.055, gain: 0.035 * strength, attack: 0.001, decay: 0.018, sustain: 0.06, release: 0.025 });
      break;
    case 'whirl':
      for (let i = 0; i < 3; i += 1) {
        air({ cutoff: 720 + i * 230, filterType: 'bandpass', Q: 0.7, duration: 0.23 - i * 0.02, gain: (0.042 - i * 0.007) * strength, attack: 0.025, decay: 0.075, sustain: 0.17, release: 0.075, when: i * 0.095 });
      }
      air({ cutoff: 275, Q: 0.9, duration: 0.34, gain: 0.076 * strength, attack: 0.03, decay: 0.1, sustain: 0.2, release: 0.115 });
      break;
    default:
      return null;
  }
  return voices;
}

/** Quiet low air texture builds tension without an electronic charging tone. */
export class ChargeHum {
  constructor(engine) {
    this.engine = engine;
    this.voice = null;
    this.retiring = new Set();
    this.disposed = false;
  }

  update(charge, x, y) {
    if (this.disposed) return;
    const context = this.engine?.context;
    if ((this.voice && this.voice.context !== context)
      || [...this.retiring].some(voice => voice.context !== context)) this.pause();
    if (!context || context.state !== 'running') {
      this.pause();
      return;
    }
    if (!(charge > 0)) {
      this.release();
      return;
    }

    if (!this.voice) {
      const route = this.engine.route('sword', x, y);
      if (!route?.input) return;
      const voice = { context, route, nodes: [], cleaned: false,
        variant: nextSoundVariant(this.engine, 'sword:charge') };
      try {
        voice.source = context.createBufferSource();
        voice.nodes.push(voice.source);
        voice.lowpass = context.createBiquadFilter();
        voice.nodes.push(voice.lowpass);
        voice.highpass = context.createBiquadFilter();
        voice.nodes.push(voice.highpass);
        voice.gain = context.createGain();
        voice.nodes.push(voice.gain);
        voice.source.buffer = chargeBuffer(context);
        voice.source.loop = true;
        voice.lowpass.type = 'lowpass';
        voice.lowpass.frequency.setValueAtTime(235, context.currentTime);
        voice.lowpass.Q.value = 0.7;
        voice.highpass.type = 'highpass';
        voice.highpass.frequency.value = 58;
        voice.highpass.Q.value = 0.5;
        voice.gain.gain.setValueAtTime(0, context.currentTime);
        voice.source.connect(voice.lowpass);
        voice.lowpass.connect(voice.highpass);
        voice.highpass.connect(voice.gain);
        voice.gain.connect(route.input);
        voice.source.onended = () => this.cleanup(voice);
        voice.source.start(context.currentTime, voice.variant.offset * voice.source.buffer.length / context.sampleRate);
        this.voice = voice;
      } catch {
        try { voice.source?.stop(); } catch { /* A source may not have started. */ }
        this.cleanup(voice);
        return;
      }
    }

    const voice = this.voice;
    const now = context.currentTime;
    const progress = clamp(charge / 0.5, 0, 1);
    voice.route.update?.(x, y);
    // Slow movement in the low texture feels uneasy without becoming a note.
    const drift = Math.sin(now * 0.7) * 15;
    setParam(voice.lowpass.frequency, (235 + progress * 125 + drift) * voice.variant.color, now, 0.18);
    setParam(voice.lowpass.Q, 0.7 + progress * 0.12, now, 0.2);
    setParam(voice.source.playbackRate, (0.8 + Math.sin(now * 0.33) * 0.035) * voice.variant.rate, now, 0.3);
    setParam(voice.gain.gain, (0.021 + progress * 0.024) * voice.variant.level, now, 0.12);
  }

  release() {
    const voice = this.voice;
    if (!voice) return;
    this.voice = null;
    const context = voice.context;
    this.retiring.add(voice);
    if (!context || context !== this.engine?.context || context.state !== 'running') {
      try { voice.source.stop(); } catch { /* Already ended. */ }
      this.cleanup(voice);
      return;
    }
    setParam(voice.gain.gain, 0, context.currentTime, 0.075);
    try { voice.source.stop(context.currentTime + 0.14); }
    catch { this.cleanup(voice); }
  }

  cleanup(voice) {
    if (voice.cleaned) return;
    voice.cleaned = true;
    if (voice.source) voice.source.onended = null;
    for (const node of voice.nodes) {
      try { node.disconnect(); } catch { /* Context teardown may have disconnected it. */ }
    }
    voice.route.dispose();
    this.retiring.delete(voice);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.pause();
  }

  pause() {
    if (this.voice) {
      const voice = this.voice;
      this.voice = null;
      try { voice.source.stop(); } catch { /* Already ended. */ }
      this.cleanup(voice);
    }
    for (const voice of this.retiring) {
      try { voice.source.stop(); } catch { /* Already ended. */ }
      this.cleanup(voice);
    }
  }
}
