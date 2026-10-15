import { noise } from './voices.js';
import { nextSoundVariant, varySound } from './variations.js';

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

// Dry bone: short, hollow knocks like old wood, and a loose rattle as a
// skeleton comes apart or drags itself out of the earth.
export function playBones(engine, event = {}) {
  const context = engine?.context;
  if (!context || context.state !== 'running') return [];
  if (!['bone-hit', 'bone-collapse', 'bone-rise'].includes(event.type)) return [];
  const strength = clamp(Number.isFinite(event.strength) ? event.strength : 1, 0, 1.5);
  const variant = nextSoundVariant(engine, `bones:${event.type}`);
  const voices = [];
  let layer = 0;
  const knock = (options) => {
    const voice = noise(engine, { bus: 'sfx', x: event.x, y: event.y,
      ...varySound(variant, options, layer++),
      when: context.currentTime + (options.when ?? 0) * variant.timing });
    if (voice) voices.push(voice);
  };
  // One hollow knock: a resonant band with almost no tail.
  const clack = (when, pitch, gain) => knock({ cutoff: pitch, filterType: 'bandpass', Q: 6, duration: 0.05,
    gain, attack: 0.001, decay: 0.014, sustain: 0.05, release: 0.03, when });

  switch (event.type) {
    case 'bone-hit':
      // The blade biting bone, then a splinter of high grit.
      clack(0, 1150, 0.16 * (0.6 + strength * 0.4));
      clack(0.018, 1750, 0.08 * strength);
      knock({ cutoff: 3200, filterType: 'bandpass', Q: 0.9, duration: 0.07, gain: 0.03 * strength,
        attack: 0.001, decay: 0.02, sustain: 0.08, release: 0.03 });
      break;
    case 'bone-collapse':
      // Bones tumbling over one another, slowing, then the skull's thud.
      for (let i = 0; i < 9; i++) {
        const when = 0.08 + i * 0.07 + (i * i) * 0.006;
        clack(when, 900 + ((i * 397) % 900), (0.13 - i * 0.009) * strength);
      }
      knock({ cutoff: 210, Q: 0.8, duration: 0.16, gain: 0.2 * strength, attack: 0.002,
        decay: 0.05, sustain: 0.08, release: 0.08, when: 0.55 });
      break;
    case 'bone-rise':
      // Earth giving way and a scatter of quiet rattles.
      knock({ cutoff: 360, Q: 0.6, duration: 0.6, gain: 0.05 * strength, attack: 0.08,
        decay: 0.2, sustain: 0.3, release: 0.25 });
      for (let i = 0; i < 5; i++) clack(0.2 + i * 0.13, 1000 + i * 170, 0.06 * strength);
      break;
  }
  return voices;
}
