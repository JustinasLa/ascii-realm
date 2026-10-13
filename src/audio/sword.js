import { tone, noise, setParam } from './voices.js';

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

/** Short material and air textures: one cue per sword action, not per frame. */
export function playSword(engine, event = {}) {
  const context = engine?.context;
  if (!context || context.state !== 'running') return null;

  const position = { bus: 'sword', x: event.x, y: event.y };
  const strength = Math.sqrt(clamp(finite(event.strength, 1), 0, 2));
  const speed = clamp(finite(event.speed, 1), 0, 2) / 2;
  const voices = [];
  const scheduled = (options) => ({ ...position, ...options, when: context.currentTime + (options.when ?? 0) });
  const pitched = (options) => voices.push(tone(engine, scheduled(options)));
  const air = (options) => voices.push(noise(engine, scheduled(options)));

  switch (event.type) {
    case 'draw':
      // Dry blade friction over a softer leather/cloth movement.
      air({ cutoff: 1700, filterType: 'bandpass', duration: 0.16, gain: 0.042, attack: 0.015 });
      air({ cutoff: 620, duration: 0.19, gain: 0.033, attack: 0.02 });
      air({ cutoff: 2800, filterType: 'bandpass', duration: 0.055, gain: 0.012, attack: 0.006, when: 0.07 });
      break;
    case 'sheathe':
      air({ cutoff: 1050, filterType: 'bandpass', duration: 0.14, gain: 0.032, attack: 0.013 });
      air({ cutoff: 480, duration: 0.17, gain: 0.03, attack: 0.016 });
      air({ cutoff: 270, duration: 0.038, gain: 0.12, attack: 0.001, when: 0.115 });
      break;
    case 'swing':
      // Air and a low pressure rush carry speed without a pitched laser sweep.
      air({ cutoff: 800 + speed * 1300, filterType: 'bandpass', duration: 0.2 - speed * 0.09, gain: (0.033 + speed * 0.027) * strength, attack: 0.023 - speed * 0.013 });
      air({ cutoff: 280 + speed * 160, duration: 0.18 - speed * 0.06, gain: (0.045 + speed * 0.022) * strength, attack: 0.018 });
      break;
    case 'slam':
      // Weight lives in the short dull impact; metal is a damped contact edge.
      air({ cutoff: 210, duration: 0.105, gain: 0.23 * strength, attack: 0.001 });
      air({ cutoff: 850, duration: 0.07, gain: 0.075 * strength, attack: 0.001 });
      air({ cutoff: 2350, filterType: 'bandpass', duration: 0.045, gain: 0.036 * strength, attack: 0.001 });
      pitched({ frequency: 653, duration: 0.047, gain: 0.0035 * strength, attack: 0.001 });
      pitched({ frequency: 1091, duration: 0.033, gain: 0.002 * strength, attack: 0.001 });
      break;
    case 'whirl':
      for (let i = 0; i < 3; i += 1) {
        air({ cutoff: 1000 + i * 320, filterType: 'bandpass', duration: 0.185 - i * 0.015, gain: (0.044 - i * 0.008) * strength, attack: 0.022, when: i * 0.085 });
      }
      air({ cutoff: 390, duration: 0.27, gain: 0.065 * strength, attack: 0.026 });
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
    const context = this.engine.context;
    if (!context || context.state !== 'running' || !(charge > 0)) {
      this.release();
      return;
    }

    if (!this.voice) {
      const route = this.engine.route('sword', x, y);
      if (!route?.input) return;
      const source = context.createBufferSource();
      const lowpass = context.createBiquadFilter();
      const highpass = context.createBiquadFilter();
      const gain = context.createGain();
      source.buffer = chargeBuffer(context);
      source.loop = true;
      lowpass.type = 'lowpass';
      lowpass.frequency.setValueAtTime(280, context.currentTime);
      lowpass.Q.value = 0.45;
      highpass.type = 'highpass';
      highpass.frequency.value = 70;
      highpass.Q.value = 0.45;
      gain.gain.setValueAtTime(0, context.currentTime);
      source.connect(lowpass);
      lowpass.connect(highpass);
      highpass.connect(gain);
      gain.connect(route.input);
      const voice = { source, lowpass, highpass, gain, route, cleaned: false };
      source.onended = () => this.cleanup(voice);
      this.voice = voice;
      source.start();
    }

    const voice = this.voice;
    const now = context.currentTime;
    const progress = clamp(charge / 0.5, 0, 1);
    voice.route.update?.(x, y);
    setParam(voice.lowpass.frequency, 280 + progress * 340, now, 0.135);
    setParam(voice.gain.gain, 0.019 + progress * 0.023, now, 0.09);
  }

  release() {
    const voice = this.voice;
    if (!voice) return;
    this.voice = null;
    const context = this.engine.context;
    this.retiring.add(voice);
    if (!context || context.state !== 'running') {
      try { voice.source.stop(); } catch { /* Already ended. */ }
      this.cleanup(voice);
      return;
    }
    setParam(voice.gain.gain, 0, context.currentTime, 0.045);
    voice.source.stop(context.currentTime + 0.09);
  }

  cleanup(voice) {
    if (voice.cleaned) return;
    voice.cleaned = true;
    voice.source.onended = null;
    voice.source.disconnect();
    voice.lowpass.disconnect();
    voice.highpass.disconnect();
    voice.gain.disconnect();
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
