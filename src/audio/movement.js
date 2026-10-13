import { tone, noise } from './voices.js';

// Surface colors are deliberately soft: the body of a landing comes from
// weight, while these short layers describe what is under the boots.
const SURFACES = {
  grass: { cutoff: 1250, filterType: 'lowpass', duration: 0.13, gain: 0.035 },
  dirt: { cutoff: 1800, filterType: 'lowpass', duration: 0.11, gain: 0.042 },
  sand: { cutoff: 2600, filterType: 'bandpass', duration: 0.17, gain: 0.04 },
  rock: { cutoff: 3400, filterType: 'highpass', duration: 0.065, gain: 0.025 },
  water: { cutoff: 950, filterType: 'lowpass', duration: 0.23, gain: 0.065 },
};

const skids = new WeakMap();

/** Play an original synthesized jump, landing, or sprint scrape. */
export function playMovement(engine, event, surface = 'dirt') {
  if (engine?.context?.state !== 'running' || !event) return [];
  const { type, x, y } = event;
  if (type !== 'jump' && type !== 'land' && type !== 'skid') return [];
  const voices = [];
  const retain = voice => { if (voice) voices.push(voice); };
  const playTone = options => retain(tone(engine, options));
  const playNoise = options => retain(noise(engine, options));
  const strength = Number.isFinite(event.strength)
    ? Math.max(0, Math.min(1.2, event.strength))
    : 0.6;
  const position = { bus: 'sfx', x, y };
  const texture = SURFACES[surface] || SURFACES.dirt;

  if (type === 'jump') {
    // Cloth tension followed by a breath of air, without a pitched arcade cue.
    playNoise({
      ...position, cutoff: 1300, filterType: 'bandpass',
      duration: 0.075, gain: 0.025 + strength * 0.015, attack: 0.008,
    });
    playNoise({
      ...position, cutoff: 2400, filterType: 'lowpass',
      duration: 0.17, gain: 0.018 + strength * 0.012, attack: 0.025,
    });
    return voices;
  }

  if (type === 'land') {
    const weight = 0.3 + strength * 0.7;
    playTone({
      ...position, frequency: 105, endFrequency: 42, type: 'sine',
      duration: 0.12 + strength * 0.055, gain: 0.085 * weight, attack: 0.004,
    });
    playNoise({
      ...position, cutoff: 270, filterType: 'lowpass',
      duration: 0.085, gain: 0.075 * weight, attack: 0.003,
    });
    playNoise({
      ...position, ...texture, gain: texture.gain * weight, attack: 0.004,
    });
    if (surface === 'water') {
      playTone({
        ...position, frequency: 260, endFrequency: 115, type: 'sine',
        duration: 0.08, gain: 0.019 * weight, attack: 0.005,
      });
    }
    return voices;
  }

  // Skid particles arrive every simulation frame. Keep the scrape continuous
  // with at most ten overlapping grains per second, including one at time 0.
  const context = engine.context;
  const now = context.currentTime;
  const previous = skids.get(engine);
  if (previous?.context === context && now - previous.time < 0.1) return voices;
  if (strength <= 0.025) return voices;
  skids.set(engine, { context, time: now });
  playNoise({
    ...position, ...texture,
    duration: surface === 'water' ? 0.18 : 0.14,
    gain: texture.gain * strength * 0.65,
    attack: 0.012,
  });
  if (surface !== 'water') {
    playNoise({
      ...position, cutoff: 420, filterType: 'lowpass',
      duration: 0.11, gain: 0.018 * strength, attack: 0.018,
    });
  }
  return voices;
}
