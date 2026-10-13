import { noise } from './voices.js';
import { nextSoundVariant, varySound } from './variations.js';

// Close, shallow water: a displaced body of water, a soft spray, then
// separated droplets falling back. Delayed tails belong to this contact,
// rather than a timer that would keep splashing after the player stops.
const IMPACT = [
  { cutoff: 330, duration: 0.15, gain: 0.14, attack: 0.004, decay: 0.037, sustain: 0.12, release: 0.085 },
  { cutoff: 1050, filterType: 'bandpass', Q: 0.65, delay: 0.006, duration: 0.23, gain: 0.13, attack: 0.008, decay: 0.065, sustain: 0.17, release: 0.14 },
  { cutoff: 2900, filterType: 'bandpass', Q: 0.4, delay: 0.021, duration: 0.18, gain: 0.065, attack: 0.008, decay: 0.04, sustain: 0.08, release: 0.12 },
  { cutoff: 680, delay: 0.065, duration: 0.34, gain: 0.08, attack: 0.023, decay: 0.09, sustain: 0.18, release: 0.21 },
  { cutoff: 1450, filterType: 'bandpass', Q: 1.1, delay: 0.16, duration: 0.095, gain: 0.028, attack: 0.004, decay: 0.022, sustain: 0.06, release: 0.065 },
  { cutoff: 2100, filterType: 'bandpass', Q: 0.85, delay: 0.235, duration: 0.11, gain: 0.02, attack: 0.006, decay: 0.026, sustain: 0.05, release: 0.075 },
];

const PROFILES = {
  step: [
    { cutoff: 420, duration: 0.14, gain: 0.1, attack: 0.005, decay: 0.037, sustain: 0.1, release: 0.085 },
    { cutoff: 1700, filterType: 'bandpass', Q: 0.6, delay: 0.01, duration: 0.18, gain: 0.095, attack: 0.008, decay: 0.05, sustain: 0.15, release: 0.11 },
    { cutoff: 850, delay: 0.055, duration: 0.25, gain: 0.078, attack: 0.018, decay: 0.065, sustain: 0.2, release: 0.155 },
    { cutoff: 1850, filterType: 'bandpass', Q: 1, delay: 0.15, duration: 0.12, gain: 0.035, attack: 0.006, decay: 0.026, sustain: 0.07, release: 0.08 },
  ],
  jump: [
    // Pulling the boots free has a rising wash rather than a heavy impact.
    { cutoff: 580, filterType: 'bandpass', Q: 0.65, duration: 0.14, gain: 0.06, attack: 0.015, decay: 0.04, sustain: 0.14, release: 0.075 },
    { cutoff: 1150, filterType: 'bandpass', Q: 0.7, delay: 0.012, duration: 0.2, gain: 0.078, attack: 0.023, decay: 0.055, sustain: 0.13, release: 0.12 },
    { cutoff: 2600, filterType: 'bandpass', Q: 0.35, delay: 0.045, duration: 0.13, gain: 0.045, attack: 0.008, decay: 0.035, sustain: 0.07, release: 0.085 },
    { cutoff: 1550, filterType: 'bandpass', Q: 1.15, delay: 0.17, duration: 0.085, gain: 0.024, attack: 0.004, decay: 0.021, sustain: 0.05, release: 0.055 },
  ],
  land: IMPACT,
  splash: IMPACT,
  slam: IMPACT,
  skid: [
    { cutoff: 620, duration: 0.115, gain: 0.037, attack: 0.008, decay: 0.025, sustain: 0.12, release: 0.075 },
    { cutoff: 1350, filterType: 'bandpass', Q: 0.6, delay: 0.012, duration: 0.09, gain: 0.024, attack: 0.006, decay: 0.023, sustain: 0.07, release: 0.055 },
  ],
  whirl: [
    { cutoff: 850, filterType: 'bandpass', Q: 0.55, duration: 0.23, gain: 0.07, attack: 0.024, decay: 0.07, sustain: 0.18, release: 0.12 },
    { cutoff: 1200, filterType: 'bandpass', Q: 0.65, delay: 0.09, duration: 0.24, gain: 0.06, attack: 0.024, decay: 0.065, sustain: 0.15, release: 0.14 },
    { cutoff: 700, delay: 0.19, duration: 0.26, gain: 0.065, attack: 0.028, decay: 0.075, sustain: 0.17, release: 0.15 },
    { cutoff: 2200, filterType: 'bandpass', Q: 0.4, delay: 0.065, duration: 0.3, gain: 0.034, attack: 0.018, decay: 0.09, sustain: 0.08, release: 0.18 },
  ],
};

const skids = new WeakMap();
const clamp = (value, fallback, maximum) => Math.max(0, Math.min(maximum, Number.isFinite(value) ? value : fallback));

/** One positional water cue for a footfall, takeoff, landing or splash. */
export function playWaterSound(engine, event = {}) {
  const context = engine?.context;
  const type = event?.type;
  if (context?.state !== 'running' || !Object.hasOwn(PROFILES, type)
      || engine.muted || engine.volumes?.master === 0 || engine.volumes?.sfx === 0) return [];
  const strength = clamp(event.strength, 0.6, 1.5);
  const volume = clamp(event.volume, 1, 1);
  if (strength === 0 || volume === 0) return [];
  const at = context.currentTime;
  if (type === 'skid') {
    const previous = skids.get(engine);
    const elapsed = previous?.context === context ? at - previous.time : Infinity;
    if (elapsed >= 0 && elapsed < 0.12) return [];
    skids.set(engine, { context, time: at });
  }
  const position = {
    bus: 'sfx',
    x: Number.isFinite(event.x) ? event.x : undefined,
    y: Number.isFinite(event.y) ? event.y : undefined,
  };
  // Keep the layers of each splash together while varying its wash and
  // runoff. The shared noise voice also chooses a fresh patch of grain.
  const variant = nextSoundVariant(engine, `water:${type}`);
  const weight = Math.sqrt(strength) * volume;
  const handles = [];
  for (const [index, layer] of PROFILES[type].entries()) {
    const options = varySound(variant, {
      ...layer, filterType: layer.filterType ?? 'lowpass', Q: layer.Q ?? 0.6,
      gain: layer.gain * weight,
    }, index);
    const handle = noise(engine, {
      ...position, ...options, when: at + (options.delay ?? 0),
    });
    if (handle) handles.push(handle);
  }
  return handles;
}
