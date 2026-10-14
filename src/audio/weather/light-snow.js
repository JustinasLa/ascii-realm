export default {
  id: 'light-snow',
  label: 'Light snowfall',
  description: 'Sheltered cold air and rare soft brushes of powder from branches.',
  layers: [
    { name: 'shelteredAir', filterType: 'lowpass', cutoff: 480, Q: 0.3, gain: 0.004 },
  ],
  modulate({ now, intensity }) {
    const breath = 0.5 + 0.5 * Math.sin(now * 0.071 + Math.sin(now * 0.023));
    return {
      shelteredAir: {
        gain: (0.0015 + breath * 0.0025) * intensity,
        cutoff: 330 + breath * 210,
        pan: Math.sin(now * 0.037) * 0.18,
      },
    };
  },
  events: [
    {
      interval: [9, 23],
      firstDelay: [6, 15],
      create({ intensity, random }) {
        if (intensity <= 0) return [];
        const pan = random() * 1.4 - 0.7;
        const duration = 0.38 + random() * 0.42;
        const cues = [{
          kind: 'noise', delay: 0, duration,
          filterType: 'bandpass', cutoff: 850 + random() * 850, Q: 0.35,
          gain: (0.004 + random() * 0.005) * intensity,
          attack: 0.07, decay: 0.1, sustain: 0.14, release: 0.17,
          pan,
        }];
        // A little powder follows the initial brush, with no crunchy impact.
        if (random() < 0.28) {
          cues.push({
            kind: 'noise', delay: 0.3 + random() * 0.4, duration: 0.34,
            filterType: 'lowpass', cutoff: 1000 + random() * 700, Q: 0.2,
            gain: (0.002 + random() * 0.002) * intensity,
            attack: 0.045, decay: 0.06, sustain: 0.08, release: 0.18,
            pan: pan * 0.8,
          });
        }
        return cues;
      },
    },
  ],
};
