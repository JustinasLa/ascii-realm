import { tone, noise } from './voices.js';

/** A short footfall; returned voices can be stopped when gameplay pauses. */
export function playFootstep(engine, surface, event = {}) {
  if (!engine?.context) return [];

  const strength = Number.isFinite(event?.strength)
    ? Math.max(0, Math.min(1.5, event.strength))
    : 1;
  if (strength === 0) return [];

  const position = {
    x: Number.isFinite(event?.x) ? event.x : undefined,
    y: Number.isFinite(event?.y) ? event.y : undefined,
  };
  const variation = 0.94 + Math.random() * 0.12;
  const weight = Math.sqrt(strength);
  const handles = [];
  const track = (handle) => { if (handle) handles.push(handle); };
  const hit = (options) => track(tone(engine, { ...position, ...options }));
  const brush = (options) => track(noise(engine, { ...position, ...options }));

  switch (surface) {
    case 'grass':
      // No oscillator: a cushioned contact, air swish, and uneven leaf grains.
      // The grains continue briefly after contact as blades bend and spring back.
      brush({ cutoff: 260 * variation, filterType: 'lowpass',
        duration: 0.058, gain: 0.072 * weight, attack: 0.004 });
      brush({ cutoff: 1450 * variation, filterType: 'lowpass',
        duration: 0.235, gain: 0.065 * weight, attack: 0.028 });
      for (const grain of [
        { delay: 0.014, duration: 0.046, cutoff: 2700, gain: 0.048 },
        { delay: 0.068, duration: 0.079, cutoff: 1950, gain: 0.059 },
        { delay: 0.153, duration: 0.067, cutoff: 3150, gain: 0.036 },
      ]) {
        brush({ cutoff: grain.cutoff * variation, filterType: 'bandpass',
          duration: grain.duration, gain: grain.gain * weight, attack: 0.009,
          when: engine.context.currentTime + grain.delay * variation });
      }
      break;
    case 'sand':
      // Sand absorbs the impact and leaves a broad, gentle brushing sound.
      hit({ frequency: 73 * variation, endFrequency: 39, type: 'sine',
        duration: 0.07, gain: 0.024 * weight, attack: 0.007 });
      brush({ cutoff: 950 * variation, filterType: 'lowpass',
        duration: 0.15, gain: 0.048 * weight, attack: 0.014 });
      break;
    case 'rock':
      // A brief hard click over a small, low sole thump.
      hit({ frequency: 195 * variation, endFrequency: 90, type: 'triangle',
        duration: 0.043, gain: 0.047 * weight, attack: 0.002 });
      brush({ cutoff: 2850 * variation, filterType: 'highpass',
        duration: 0.026, gain: 0.031 * weight, attack: 0.002 });
      break;
    case 'water':
      // A rounded plop and filtered splash for shallow water.
      hit({ frequency: 240 * variation, endFrequency: 64, type: 'sine',
        duration: 0.11, gain: 0.04 * weight, attack: 0.006 });
      brush({ cutoff: 1750 * variation, filterType: 'bandpass',
        duration: 0.19, gain: 0.068 * weight, attack: 0.011 });
      break;
    case 'dirt':
    default:
      // A dry granular crunch with the weight of a shoe against packed soil.
      hit({ frequency: 108 * variation, endFrequency: 48, type: 'triangle',
        duration: 0.065, gain: 0.034 * weight, attack: 0.003 });
      brush({ cutoff: 2100 * variation, filterType: 'lowpass',
        duration: 0.075, gain: 0.057 * weight, attack: 0.003 });
      break;
  }
  return handles;
}
