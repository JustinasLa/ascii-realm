export default {
  id: 'drizzle',
  rainfall: 0.2,
  label: 'Drizzle',
  description: 'Fine rain on foliage, with a thin misty hush and scattered dry ticks.',
  layers: [
    { name: 'mist', filterType: 'bandpass', cutoff: 3800, Q: 0.42, gain: 0.0043 },
  ],
  modulate({ now, intensity }) {
    const drift = 0.5 + 0.5 * Math.sin(now * 0.19 + Math.sin(now * 0.057));
    return {
      mist: {
        gain: (0.0032 + 0.0011 * drift) * intensity,
        cutoff: 3500 + 650 * drift,
        pan: Math.sin(now * 0.083) * 0.14,
      },
    };
  },
  events: [
    {
      interval: [0.38, 1.9],
      firstDelay: [0.3, 1.6],
      create({ intensity, random }) {
        if (intensity <= 0) return [];
        const count = random() < 0.18 ? 2 : 1;
        return Array.from({ length: count }, (_, index) => ({
          kind: 'noise',
          delay: index === 0 ? 0 : 0.06 + random() * 0.17,
          duration: 0.025 + random() * 0.023,
          filterType: 'bandpass',
          cutoff: 3300 + random() * 2400,
          Q: 0.45 + random() * 0.3,
          gain: (0.006 + random() * 0.006) * intensity * (index === 0 ? 1 : 0.6),
          attack: 0.001,
          decay: 0.007,
          sustain: 0.025,
          release: 0.009,
          pan: random() * 1.6 - 0.8,
        }));
      },
    },
  ],
};
