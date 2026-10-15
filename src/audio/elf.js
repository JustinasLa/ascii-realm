import { noise, tone } from './voices.js';
import { nextSoundVariant, varySound } from './variations.js';

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

// An elf's sounds: a clear two-note call on spotting the player, the twang
// of a bowstring, a sharp gasp when cut and a falling cry as it drops.
export function playElf(engine, event = {}) {
  const context = engine?.context;
  if (!context || context.state !== 'running') return [];
  if (!['elf-spot', 'elf-hit', 'elf-death', 'elf-shoot'].includes(event.type)) return [];
  const strength = clamp(Number.isFinite(event.strength) ? event.strength : 1, 0, 1.5);
  const variant = nextSoundVariant(engine, `elf:${event.type}`);
  const voices = [];
  let layer = 0;
  const at = (options) => ({ bus: 'sfx', x: event.x, y: event.y, ...varySound(variant, options, layer++),
    when: context.currentTime + (options.when ?? 0) * variant.timing });
  const keep = (voice) => { if (voice) voices.push(voice); };
  const sing = (when, from, to, duration, gain, type = 'sine') => keep(tone(engine, at({ type, frequency: from,
    endFrequency: to, duration, gain, attack: 0.02, decay: duration * 0.3, sustain: 0.6, release: duration * 0.4,
    when })));

  switch (event.type) {
    case 'elf-spot':
      sing(0, 880, 880, 0.14, 0.035 * strength);
      sing(0.15, 1175, 1320, 0.2, 0.035 * strength);
      break;
    case 'elf-shoot':
      // The string's twang and the shaft hissing away.
      sing(0, 196, 150, 0.16, 0.06 * strength, 'triangle');
      keep(noise(engine, at({ cutoff: 2600, filterType: 'bandpass', Q: 0.8, duration: 0.18, gain: 0.03 * strength,
        attack: 0.01, decay: 0.06, sustain: 0.3, release: 0.08, when: 0.02 })));
      break;
    case 'elf-hit':
      keep(noise(engine, at({ cutoff: 1300, filterType: 'bandpass', Q: 1.2, duration: 0.12, gain: 0.07 * strength,
        attack: 0.004, decay: 0.04, sustain: 0.3, release: 0.05 })));
      sing(0.01, 720, 560, 0.14, 0.03 * strength, 'triangle');
      break;
    case 'elf-death':
      sing(0, 860, 290, 0.6, 0.04 * strength, 'triangle');
      keep(noise(engine, at({ cutoff: 260, Q: 0.8, duration: 0.16, gain: 0.12 * strength, attack: 0.002,
        decay: 0.05, sustain: 0.08, release: 0.08, when: 0.55 })));
      break;
  }
  return voices;
}
