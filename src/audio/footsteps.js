import { noise } from './voices.js';
import { playGrassFootstep } from './grass-steps.js';

// Close material textures stay below the music's bells. Broad, low-Q filters
// give shoes weight without an oscillator or a hollow resonant pitch.
const MATERIALS = {
  dirt: [
    // Damp soil compresses; small grains scrape after the weight lands.
    { cutoff: 340, duration: 0.07, gain: 0.1, attack: 0.005, decay: 0.027, sustain: 0.18, release: 0.03 },
    { cutoff: 850, filterType: 'bandpass', delay: 0.013, duration: 0.083, gain: 0.061, attack: 0.006, decay: 0.034, sustain: 0.23, release: 0.033 },
    { cutoff: 1400, delay: 0.053, duration: 0.085, gain: 0.037, attack: 0.012, decay: 0.03, sustain: 0.17, release: 0.035 },
  ],
  sand: [
    // A buried sole and a dense drag; little sharp grit reaches the surface.
    { cutoff: 230, duration: 0.075, gain: 0.095, attack: 0.007, decay: 0.025, sustain: 0.2, release: 0.032 },
    { cutoff: 700, delay: 0.009, duration: 0.19, gain: 0.078, attack: 0.024, decay: 0.055, sustain: 0.32, release: 0.061 },
    { cutoff: 1000, filterType: 'bandpass', delay: 0.057, duration: 0.093, gain: 0.045, attack: 0.016, decay: 0.029, sustain: 0.2, release: 0.035 },
  ],
  rock: [
    // Hard low stone contact, a compact sole scrape, and a little loose grit.
    { cutoff: 600, duration: 0.055, gain: 0.12, attack: 0.002, decay: 0.016, sustain: 0.12, release: 0.028 },
    { cutoff: 1300, filterType: 'bandpass', delay: 0.006, duration: 0.045, gain: 0.048, attack: 0.002, decay: 0.014, sustain: 0.15, release: 0.022 },
    { cutoff: 780, delay: 0.027, duration: 0.065, gain: 0.03, attack: 0.006, decay: 0.023, sustain: 0.14, release: 0.027 },
  ],
  water: [
    // Low shallow splash, displaced water, and the damp brush of heavy cloth.
    { cutoff: 480, duration: 0.104, gain: 0.105, attack: 0.008, decay: 0.037, sustain: 0.24, release: 0.045 },
    { cutoff: 950, filterType: 'bandpass', delay: 0.02, duration: 0.177, gain: 0.082, attack: 0.018, decay: 0.049, sustain: 0.3, release: 0.066 },
    { cutoff: 680, delay: 0.06, duration: 0.11, gain: 0.047, attack: 0.016, decay: 0.031, sustain: 0.2, release: 0.044 },
    { cutoff: 1300, delay: 0.083, duration: 0.22, gain: 0.038, attack: 0.028, decay: 0.064, sustain: 0.19, release: 0.072 },
  ],
};

/** Gait-synchronized material contact; returned voices stop cleanly on pause. */
export function playFootstep(engine, surface, event = {}) {
  if (surface === 'grass') return playGrassFootstep(engine, event);
  if (engine?.context?.state !== 'running') return [];

  const strength = Number.isFinite(event?.strength)
    ? Math.max(0, Math.min(1.5, event.strength))
    : 1;
  if (strength === 0) return [];

  const x = Number.isFinite(event?.x) ? event.x : undefined;
  const y = Number.isFinite(event?.y) ? event.y : undefined;
  const weight = Math.sqrt(strength);
  const at = engine.context.currentTime;
  const handles = [];
  const layers = Object.hasOwn(MATERIALS, surface) ? MATERIALS[surface] : MATERIALS.dirt;
  for (const layer of layers) {
    // A few percent changes the texture without turning steps into random notes.
    const timing = 0.97 + Math.random() * 0.06;
    const cutoffVariation = 0.95 + Math.random() * 0.1;
    const levelVariation = 0.96 + Math.random() * 0.08;
    const handle = noise(engine, {
      bus: 'sfx', x, y,
      filterType: layer.filterType ?? 'lowpass',
      cutoff: layer.cutoff * cutoffVariation,
      Q: 0.45,
      when: at + (layer.delay ?? 0) * timing,
      duration: layer.duration * timing,
      attack: layer.attack * timing,
      decay: layer.decay * timing,
      sustain: layer.sustain,
      release: layer.release * timing,
      gain: layer.gain * weight * levelVariation,
    });
    if (handle) handles.push(handle);
  }
  return handles;
}
