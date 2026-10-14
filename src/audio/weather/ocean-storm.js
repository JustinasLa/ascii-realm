export default {
  id: 'ocean-storm',
  label: 'Coastal storm',
  description: 'Deep offshore surf rolls beneath tearing wind and long, gritty breakers.',
  layers: [
    { name: 'surf', filterType: 'lowpass', cutoff: 390, Q: 0.35, gain: 0.052 },
    { name: 'coastal-wind', filterType: 'bandpass', cutoff: 1100, Q: 0.4, gain: 0.023 },
    { name: 'shore-grit', filterType: 'bandpass', cutoff: 2700, Q: 0.35, gain: 0.004 },
  ],
  modulate({ now, intensity }) {
    const swell = (Math.sin(now * 0.43) + Math.sin(now * 0.173 + 1.7) + 2) / 4;
    const gust = (Math.sin(now * 0.71 + 0.9) + Math.sin(now * 0.287) + 2) / 4;
    return {
      surf: {
        gain: (0.023 + swell * 0.038) * intensity,
        cutoff: 250 + swell * 240,
        pan: Math.sin(now * 0.081) * 0.2,
      },
      'coastal-wind': {
        gain: (0.009 + gust * 0.025) * intensity,
        cutoff: 650 + gust * 1100,
        pan: Math.sin(now * 0.117 + 1.2) * 0.48,
      },
      'shore-grit': {
        gain: (0.001 + swell * gust * 0.005) * intensity,
        cutoff: 2100 + gust * 1500,
        pan: Math.sin(now * 0.093 + 2) * 0.35,
      },
    };
  },
  events: [
    {
      interval: [6.5, 13.5],
      firstDelay: [2.5, 6],
      create({ intensity, random }) {
        if (intensity <= 0) return [];
        const strength = 0.75 + random() * 0.25;
        const pan = random() * 0.9 - 0.45;
        return [
          {
            kind: 'noise', delay: 0, duration: 6.2 + random() * 1.1,
            filterType: 'lowpass', cutoff: 280 + random() * 160, Q: 0.3,
            gain: 0.079 * strength * intensity, attack: 1.2, decay: 2.5,
            sustain: 0.22, release: 2.2, pan,
          },
          {
            kind: 'noise', delay: 0.45 + random() * 0.35, duration: 5.5,
            filterType: 'bandpass', cutoff: 680 + random() * 350, Q: 0.38,
            gain: 0.048 * strength * intensity, attack: 0.9, decay: 2.1,
            sustain: 0.13, release: 2, pan: pan * 0.8,
          },
          {
            kind: 'noise', delay: 1.6 + random() * 0.4, duration: 3.2,
            filterType: 'bandpass', cutoff: 1900 + random() * 1100, Q: 0.45,
            gain: 0.013 * strength * intensity, attack: 0.55, decay: 1.1,
            sustain: 0.12, release: 1.4, pan: pan * 0.7,
          },
        ];
      },
    },
    {
      interval: [9, 18],
      firstDelay: [4, 9],
      create({ intensity, random }) {
        if (intensity <= 0) return [];
        return [{
          kind: 'noise', delay: 0, duration: 4.3 + random() * 1.4,
          filterType: 'bandpass', cutoff: 1100 + random() * 1200, Q: 0.35,
          gain: (0.014 + random() * 0.014) * intensity,
          attack: 1.1, decay: 0.9, sustain: 0.38, release: 2,
          pan: random() * 1.3 - 0.65,
        }];
      },
    },
  ],
};
