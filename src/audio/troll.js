import { noise, tone } from './voices.js';
import { nextSoundVariant, varySound } from './variations.js';

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

// A troll's voice: a deep, rasping roar on spotting the player or flying into
// a rage, a grunt when cut, and a long groan that ends in the thud of a
// great body hitting the ground.
export function playTroll(engine, event = {}) {
  const context = engine?.context;
  if (!context || context.state !== 'running') return [];
  if (!['troll-roar', 'troll-hit', 'troll-death'].includes(event.type)) return [];
  const strength = clamp(Number.isFinite(event.strength) ? event.strength : 1, 0, 1.5);
  const variant = nextSoundVariant(engine, `troll:${event.type}`);
  const voices = [];
  let layer = 0;
  const at = (options) => ({ bus: 'sfx', x: event.x, y: event.y, ...varySound(variant, options, layer++),
    when: context.currentTime + (options.when ?? 0) * variant.timing });
  const keep = (voice) => { if (voice) voices.push(voice); };
  // A low, throaty voice: a darkly filtered sawtooth sliding down.
  const growl = (when, from, to, duration, gain) => keep(tone(engine, at({ type: 'sawtooth', frequency: from,
    endFrequency: to, cutoff: 520, filterType: 'lowpass', Q: 1.4, duration, gain, attack: duration * 0.15,
    decay: duration * 0.3, sustain: 0.7, release: duration * 0.35, when })));
  // Breath rasping through it.
  const rasp = (when, duration, gain) => keep(noise(engine, at({ cutoff: 700, filterType: 'bandpass', Q: 0.7,
    duration, gain, attack: duration * 0.2, decay: duration * 0.3, sustain: 0.5, release: duration * 0.4, when })));
  const thud = (when, gain) => keep(noise(engine, at({ cutoff: 140, Q: 0.9, duration: 0.3, gain, attack: 0.002,
    decay: 0.08, sustain: 0.12, release: 0.16, when })));

  switch (event.type) {
    case 'troll-roar':
      growl(0, 150, 95, 0.95, 0.09 * strength);
      growl(0.02, 75, 52, 0.95, 0.07 * strength);
      rasp(0, 0.9, 0.05 * strength);
      break;
    case 'troll-hit':
      growl(0, 125, 98, 0.22, 0.08 * strength);
      thud(0, 0.12 * strength);
      break;
    case 'troll-death':
      growl(0, 135, 58, 1.3, 0.09 * strength);
      rasp(0, 1.1, 0.04 * strength);
      thud(1.05, 0.3 * strength);
      thud(1.25, 0.15 * strength);
      break;
  }
  return voices;
}
