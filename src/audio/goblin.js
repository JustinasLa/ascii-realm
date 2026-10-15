import { noise, tone } from './voices.js';
import { nextSoundVariant, varySound } from './variations.js';

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

// A goblin's voice: a reedy cackle on spotting the player, a squeal and a
// slap of flesh when cut, and a shriek that falls away as it drops.
export function playGoblin(engine, event = {}) {
  const context = engine?.context;
  if (!context || context.state !== 'running') return [];
  if (!['goblin-spot', 'goblin-hit', 'goblin-death'].includes(event.type)) return [];
  const strength = clamp(Number.isFinite(event.strength) ? event.strength : 1, 0, 1.5);
  const variant = nextSoundVariant(engine, `goblin:${event.type}`);
  const voices = [];
  let layer = 0;
  const at = (options) => ({ bus: 'sfx', x: event.x, y: event.y, ...varySound(variant, options, layer++),
    when: context.currentTime + (options.when ?? 0) * variant.timing });
  const keep = (voice) => { if (voice) voices.push(voice); };
  // A nasal, buzzing voice: a filtered sawtooth gliding in pitch.
  const squawk = (when, from, to, duration, gain) => keep(tone(engine, at({ type: 'sawtooth', frequency: from,
    endFrequency: to, cutoff: 1900, filterType: 'bandpass', Q: 2.2, duration, gain, attack: 0.008,
    decay: duration * 0.4, sustain: 0.6, release: duration * 0.35, when })));

  switch (event.type) {
    case 'goblin-spot':
      // Heh-heh-heh, each a little higher.
      for (let i = 0; i < 4; i++) squawk(i * 0.11, 520 + i * 60, 430 + i * 50, 0.075, 0.05 * strength);
      break;
    case 'goblin-hit':
      keep(noise(engine, at({ cutoff: 420, Q: 0.8, duration: 0.09, gain: 0.14 * strength, attack: 0.001,
        decay: 0.03, sustain: 0.1, release: 0.05 })));
      squawk(0.02, 980, 640, 0.16, 0.07 * strength);
      break;
    case 'goblin-death':
      squawk(0, 900, 210, 0.55, 0.075 * strength);
      keep(noise(engine, at({ cutoff: 230, Q: 0.8, duration: 0.18, gain: 0.18 * strength, attack: 0.002,
        decay: 0.06, sustain: 0.08, release: 0.09, when: 0.5 })));
      break;
  }
  return voices;
}
