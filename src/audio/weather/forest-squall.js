export default {
  id: 'forest-squall',
  label: 'Forest squall',
  description: 'Wind rolls through the canopy, rattling dry leaves and straining old branches.',
  layers: [
    { name: 'canopy', filterType: 'lowpass', cutoff: 380, Q: 0.45, gain: 0.036 },
    { name: 'foliage', filterType: 'bandpass', cutoff: 1750, Q: 0.6, gain: 0.012 },
    { name: 'trunks', filterType: 'bandpass', cutoff: 205, Q: 0.65, gain: 0.009 },
  ],
  modulate({ now, intensity }) {
    const pressure = 0.5 + 0.31 * Math.sin(now * 0.23 + 0.8)
      + 0.19 * Math.sin(now * 0.61 - 0.4);
    const flutter = 0.5 + 0.5 * Math.sin(now * 1.27 + Math.sin(now * 0.37));
    return {
      canopy: {
        gain: (0.023 + pressure * 0.026) * intensity,
        cutoff: 230 + pressure * 290,
        pan: Math.sin(now * 0.17) * 0.32,
      },
      foliage: {
        gain: (0.004 + pressure * 0.012 + flutter * 0.005) * intensity,
        cutoff: 1300 + flutter * 950 + pressure * 300,
        pan: Math.sin(now * 0.31 + 1.9) * 0.6,
      },
      trunks: {
        gain: (0.004 + pressure * 0.008) * intensity,
        cutoff: 155 + pressure * 110,
        pan: Math.sin(now * 0.11 - 1.3) * 0.23,
      },
    };
  },
  events: [
    {
      interval: [2.8, 6.7],
      firstDelay: [1.4, 3.2],
      create({ intensity, random }) {
        const pan = random() * 1.4 - 0.7;
        const cues = [{
          kind: 'noise', delay: 0, duration: 1.8 + random() * 0.8,
          filterType: 'bandpass', cutoff: 170 + random() * 190, Q: 0.55,
          gain: (0.026 + random() * 0.015) * intensity,
          attack: 0.38, decay: 0.5, sustain: 0.38, release: 0.62, pan,
        }];
        // Loose, unequal rattles ride a canopy surge instead of a flat open-field hiss.
        const count = 3 + Math.floor(random() * 3);
        for (let index = 0; index < count; index++) {
          cues.push({
            kind: 'noise', delay: 0.22 + index * 0.19 + random() * 0.11,
            duration: 0.09 + random() * 0.08,
            filterType: 'highpass', cutoff: 2000 + random() * 1800, Q: 0.45,
            gain: (0.009 + random() * 0.012) * intensity,
            attack: 0.006, decay: 0.025, sustain: 0.08, release: 0.045,
            pan: Math.max(-1, Math.min(1, pan + random() * 0.46 - 0.23)),
          });
        }
        return cues;
      },
    },
    {
      interval: [5.3, 12.6],
      firstDelay: [3.8, 7.5],
      create({ intensity, random }) {
        const pan = random() * 1.6 - 0.8;
        return [
          {
            kind: 'noise', delay: 0, duration: 0.46 + random() * 0.18,
            filterType: 'bandpass', cutoff: 250 + random() * 230, Q: 0.85,
            gain: (0.009 + random() * 0.007) * intensity,
            attack: 0.06, decay: 0.15, sustain: 0.12, release: 0.17, pan,
          },
          {
            kind: 'noise', delay: 0.17 + random() * 0.15, duration: 0.105,
            filterType: 'bandpass', cutoff: 610 + random() * 420, Q: 0.7,
            gain: (0.014 + random() * 0.014) * intensity,
            attack: 0.002, decay: 0.038, sustain: 0.03, release: 0.052, pan,
          },
          {
            kind: 'noise', delay: 0.35 + random() * 0.16, duration: 0.065,
            filterType: 'highpass', cutoff: 1900 + random() * 1100, Q: 0.4,
            gain: (0.005 + random() * 0.007) * intensity,
            attack: 0.002, decay: 0.02, sustain: 0.02, release: 0.035, pan,
          },
        ];
      },
    },
  ],
};
