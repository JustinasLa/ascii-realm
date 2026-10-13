export default {
  id: 'wind-gusts',
  label: 'Meadow wind gusts',
  description: 'Rolling breezes lift dry meadow blades and brush through nearby foliage.',
  layers: [
    { name: 'meadow-air', filterType: 'lowpass', cutoff: 620, Q: 0.22, gain: 0.022 },
    { name: 'dry-blades', filterType: 'bandpass', cutoff: 2400, Q: 0.42, gain: 0.006 },
  ],
  modulate({ now, intensity }) {
    const swell = (Math.sin(now * 0.19) + Math.sin(now * 0.071 + 1.7) + 2) / 4;
    const flutter = (Math.sin(now * 0.63 + 0.8) + 1) / 2;
    return {
      'meadow-air': {
        gain: (0.009 + swell * 0.024) * intensity,
        cutoff: 380 + swell * 540,
        pan: Math.sin(now * 0.087) * 0.34,
      },
      'dry-blades': {
        gain: (0.002 + swell * 0.008) * (0.72 + flutter * 0.28) * intensity,
        cutoff: 1800 + swell * 1100,
        pan: Math.sin(now * 0.13 + 1.4) * 0.52,
      },
    };
  },
  events: [
    {
      interval: [8, 18],
      firstDelay: [2, 6],
      create({ intensity, random }) {
        if (intensity === 0) return [];
        const duration = 4.8 + random() * 2;
        const pan = random() * 1.1 - 0.55;
        return [
          {
            kind: 'noise', delay: 0, duration,
            filterType: 'lowpass', cutoff: 680 + random() * 430, Q: 0.18,
            gain: (0.025 + random() * 0.018) * intensity,
            attack: 1.4, decay: 1.2, sustain: 0.52, release: 1.8, pan,
          },
          {
            kind: 'noise', delay: 0.7 + random() * 0.8, duration: 3.3,
            filterType: 'bandpass', cutoff: 2200 + random() * 1200, Q: 0.38,
            gain: (0.009 + random() * 0.007) * intensity,
            attack: 0.75, decay: 0.65, sustain: 0.3, release: 1.1,
            pan: -pan * 0.7,
          },
        ];
      },
    },
  ],
};
