import { ASPECT } from '../../world/world.js';

const clamp01 = value => Math.max(0, Math.min(1, value));

// The runtime applies water proximity to a shared splash gate, which also
// fades existing tails when the player leaves the shoreline.
export const rainSplashes = {
  interval: [0.22, 0.65],
  firstDelay: [0.08, 0.3],
  create({ intensity, random, water, rainfall } = {}) {
    if (!water || !Number.isFinite(water.x) || !Number.isFinite(water.y)
        || !Number.isFinite(water.strength) || water.strength <= 0
        || !Number.isFinite(intensity) || intensity <= 0
        || !Number.isFinite(rainfall) || rainfall <= 0) return [];
    const draw = () => {
      try {
        const value = typeof random === 'function' ? random() : 0.5;
        return Number.isFinite(value) ? Math.min(0.999999999, clamp01(value)) : 0.5;
      } catch { return 0.5; }
    };
    const strength = clamp01(intensity) * clamp01(rainfall);
    const impacts = 1 + Math.floor(draw() * (1 + 2 * clamp01(rainfall)));
    const cues = [];
    for (let index = 0; index < impacts; index++) {
      const angle = draw() * Math.PI * 2;
      const radius = 0.25 + draw() * 1.55;
      const position = {
        surface: 'water',
        x: water.x + Math.cos(angle) * radius / ASPECT,
        y: water.y + Math.sin(angle) * radius,
      };
      const delay = index * (0.025 + draw() * 0.025) + draw() * 0.012;
      // Broad, damped noise gives a small liquid impact without a pitched plop.
      cues.push({
        kind: 'noise', ...position, delay,
        duration: 0.09 + draw() * 0.04,
        filterType: 'bandpass', cutoff: 760 + draw() * 860,
        Q: 0.35 + draw() * 0.15,
        gain: (0.017 + draw() * 0.017) * strength,
        attack: 0.0015, decay: 0.022, sustain: 0.05, release: 0.042,
      });
      // A quieter, thin spray follows each impact at the same water location.
      cues.push({
        kind: 'noise', ...position,
        delay: delay + 0.009 + draw() * 0.019,
        duration: 0.06 + draw() * 0.035,
        filterType: 'bandpass', cutoff: 2500 + draw() * 2300, Q: 0.22,
        gain: (0.004 + draw() * 0.005) * strength,
        attack: 0.004, decay: 0.014, sustain: 0.018, release: 0.03,
      });
    }
    return cues;
  },
};
