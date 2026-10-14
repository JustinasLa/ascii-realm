export default {
  id: 'ice-storm',
  rainfall: 0.35,
  label: 'Ice storm',
  description: 'Fine freezing rain over low storm air, with brittle ice and strained frozen branches.',
  layers: [
    { name: 'freezingRain', filterType: 'bandpass', cutoff: 3200, Q: 0.38, gain: 0.019 },
    { name: 'frozenGrain', filterType: 'highpass', cutoff: 5300, Q: 0.2, gain: 0.004 },
    { name: 'stormAir', filterType: 'lowpass', cutoff: 480, Q: 0.4, gain: 0.012 },
  ],
  modulate({ now, intensity }) {
    const pressure = 0.78 + 0.14 * Math.sin(now * 0.089 + 0.4) + 0.08 * Math.sin(now * 0.031);
    return {
      freezingRain: {
        gain: 0.019 * pressure * intensity,
        cutoff: 3200 + 420 * Math.sin(now * 0.067 + 1.2),
        pan: 0.17 * Math.sin(now * 0.039),
      },
      frozenGrain: {
        gain: 0.004 * (0.85 + 0.15 * Math.sin(now * 0.19)) * intensity,
        cutoff: 5300 + 300 * Math.sin(now * 0.047),
        pan: -0.2 * Math.sin(now * 0.052 + 0.8),
      },
      stormAir: {
        gain: 0.012 * (0.7 + 0.3 * pressure) * intensity,
        cutoff: 480 + 95 * Math.sin(now * 0.055 + 2),
        pan: 0.12 * Math.sin(now * 0.025 + 1.3),
      },
    };
  },
  events: [
    {
      interval: [0.65, 2.3],
      firstDelay: [0.3, 1.4],
      create({ intensity, random }) {
        const pan = random() * 1.7 - 0.85;
        const count = 1 + Math.floor(random() * 3);
        return Array.from({ length: count }, (_, index) => ({
          kind: 'noise',
          delay: index * (0.025 + random() * 0.095),
          duration: 0.045 + random() * 0.04,
          filterType: 'bandpass',
          cutoff: 3500 + random() * 2000,
          Q: 0.36,
          gain: (0.004 + random() * 0.006) * intensity,
          attack: 0.002,
          decay: 0.014,
          sustain: 0.015,
          release: 0.022,
          pan,
        }));
      },
    },
    {
      interval: [8, 23],
      firstDelay: [4, 12],
      create({ intensity, random }) {
        const pan = random() * 1.6 - 0.8;
        const crackAt = 0.23 + random() * 0.32;
        return [
          {
            kind: 'noise', delay: 0, duration: 0.85,
            filterType: 'bandpass', cutoff: 230 + random() * 190, Q: 0.65,
            gain: (0.009 + random() * 0.006) * intensity,
            attack: 0.13, decay: 0.22, sustain: 0.18, release: 0.33, pan,
          },
          {
            kind: 'noise', delay: crackAt, duration: 0.115,
            filterType: 'bandpass', cutoff: 1500 + random() * 1400, Q: 0.48,
            gain: (0.019 + random() * 0.017) * intensity,
            attack: 0.002, decay: 0.028, sustain: 0.025, release: 0.06, pan,
          },
          {
            kind: 'noise', delay: crackAt + 0.07 + random() * 0.15, duration: 0.09,
            filterType: 'highpass', cutoff: 2800 + random() * 1600, Q: 0.24,
            gain: (0.005 + random() * 0.006) * intensity,
            attack: 0.003, decay: 0.019, sustain: 0.02, release: 0.04, pan,
          },
        ];
      },
    },
  ],
};
