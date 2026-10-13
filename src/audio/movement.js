import { noise } from './voices.js';

// Dark, close textures under leather boots. The body of a landing comes from
// unpitched weight, leaving room for the distant, arcane musical atmosphere.
const SURFACES = {
  grass: { cutoff: 750, filterType: 'lowpass', Q: 0.45, duration: 0.135, gain: 0.027 },
  dirt: { cutoff: 1100, filterType: 'lowpass', Q: 0.55, duration: 0.105, gain: 0.034 },
  sand: { cutoff: 1500, filterType: 'bandpass', Q: 0.45, duration: 0.18, gain: 0.026 },
  rock: { cutoff: 1700, filterType: 'bandpass', Q: 0.85, duration: 0.065, gain: 0.022 },
  water: { cutoff: 650, filterType: 'lowpass', Q: 0.7, duration: 0.23, gain: 0.05 },
};

const skids = new WeakMap();

/** Play an original synthesized jump, landing, or sprint scrape. */
export function playMovement(engine, event, surface = 'dirt') {
  if (engine?.context?.state !== 'running' || !event) return [];
  const { type, x, y } = event;
  if (type !== 'jump' && type !== 'land' && type !== 'skid') return [];
  const voices = [];
  const retain = voice => { if (voice) voices.push(voice); };
  const playNoise = options => retain(noise(engine, options));
  const strength = Number.isFinite(event.strength)
    ? Math.max(0, Math.min(1.2, event.strength))
    : 0.6;
  const position = { bus: 'sfx', x, y };
  const texture = SURFACES[surface] || SURFACES.dirt;

  if (type === 'jump') {
    // A restrained cloth pull and leather flex at takeoff.
    playNoise({
      ...position, cutoff: 720, filterType: 'bandpass', Q: 0.5,
      duration: 0.095, gain: 0.022 + strength * 0.011, attack: 0.003,
      decay: 0.028, sustain: 0.07, release: 0.055,
    });
    playNoise({
      ...position, cutoff: 360, filterType: 'lowpass', Q: 0.5,
      duration: 0.075, gain: 0.016 + strength * 0.008, attack: 0.002,
      decay: 0.022, sustain: 0.04, release: 0.045,
    });
    return voices;
  }

  if (type === 'land') {
    const weight = 0.3 + strength * 0.7;
    // A short low impulse with damped material resonance, never a pitch glide.
    playNoise({
      ...position, cutoff: 300, filterType: 'lowpass', Q: 0.65,
      duration: 0.105 + strength * 0.025, gain: 0.09 * weight, attack: 0.002,
      decay: 0.025, sustain: 0.025, release: 0.075,
    });
    playNoise({
      ...position, cutoff: 155, filterType: 'bandpass', Q: 1.3,
      duration: 0.095, gain: 0.065 * weight, attack: 0.002,
      decay: 0.023, sustain: 0.02, release: 0.06,
    });
    playNoise({
      ...position, ...texture, gain: texture.gain * weight, attack: 0.003,
      decay: texture.duration * 0.24, sustain: surface === 'water' ? 0.12 : 0.045,
      release: texture.duration * 0.62,
    });
    return voices;
  }

  // Skid particles arrive every simulation frame. A quiet brush releases before
  // the next grain, at most ten per second, including one at time 0.
  const context = engine.context;
  const now = context.currentTime;
  const previous = skids.get(engine);
  if (previous?.context === context && now - previous.time < 0.1) return voices;
  if (strength <= 0.025) return voices;
  skids.set(engine, { context, time: now });
  playNoise({
    ...position, ...texture,
    duration: surface === 'water' ? 0.11 : 0.085,
    gain: texture.gain * strength * 0.4,
    attack: 0.003, decay: 0.019, sustain: 0.045,
    release: surface === 'water' ? 0.075 : 0.055,
  });
  if (surface !== 'water') {
    playNoise({
      ...position, cutoff: 460, filterType: 'lowpass', Q: 0.45,
      duration: 0.065, gain: 0.009 * strength, attack: 0.002,
      decay: 0.018, sustain: 0.03, release: 0.04,
    });
  }
  return voices;
}
