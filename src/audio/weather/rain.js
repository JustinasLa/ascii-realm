export default {
  id: 'rain',
  label: 'Gentle rain',
  description: 'A soft airy shower, scattered fine patter, and faint drips from nearby leaves.',
  layers: [
    { name: 'rainVeil', filterType: 'bandpass', cutoff: 2700, Q: 0.45, gain: 0.026 },
    { name: 'fineRain', filterType: 'highpass', cutoff: 5100, Q: 0.25, gain: 0.006 },
  ],
  modulate({ now, intensity }) {
    const swell = 0.89 + 0.07 * Math.sin(now * 0.13) + 0.04 * Math.sin(now * 0.037 + 1.8);
    return {
      rainVeil: {
        gain: 0.026 * swell * intensity,
        cutoff: 2700 + 340 * Math.sin(now * 0.053 + 0.7),
        pan: 0.11 * Math.sin(now * 0.041),
      },
      fineRain: {
        gain: 0.006 * (0.87 + 0.13 * Math.sin(now * 0.091 + 2.1)) * intensity,
        cutoff: 5100 + 380 * Math.sin(now * 0.029),
        pan: -0.15 * Math.sin(now * 0.032 + 0.9),
      },
    };
  },
  events: [
    {
      interval: [0.3, 0.95],
      firstDelay: [0.1, 0.7],
      create({ intensity, random }) {
        const count = random() < 0.36 ? 2 : 1;
        return Array.from({ length: count }, (_, index) => ({
          kind: 'noise',
          delay: index === 0 ? 0 : 0.04 + random() * 0.18,
          duration: 0.075 + random() * 0.055,
          filterType: 'bandpass',
          cutoff: 3300 + random() * 2100,
          Q: 0.35 + random() * 0.18,
          gain: (0.004 + random() * 0.007) * intensity,
          attack: 0.004,
          decay: 0.022,
          sustain: 0.08,
          release: 0.036,
          pan: random() * 1.8 - 0.9,
        }));
      },
    },
    {
      interval: [2.3, 6.8],
      firstDelay: [1.4, 4.2],
      create({ intensity, random }) {
        const pan = random() * 1.5 - 0.75;
        const cutoff = 2100 + random() * 1700;
        const gain = (0.012 + random() * 0.012) * intensity;
        const cues = [{
          kind: 'noise', delay: 0, duration: 0.15,
          filterType: 'bandpass', cutoff, Q: 0.43,
          gain, attack: 0.003, decay: 0.042, sustain: 0.06,
          release: 0.065, pan,
        }];
        if (random() < 0.58) cues.push({
          kind: 'noise', delay: 0.09 + random() * 0.26,
          duration: 0.095, filterType: 'bandpass',
          cutoff: cutoff + 650, Q: 0.32,
          gain: gain * (0.24 + random() * 0.25),
          attack: 0.005, decay: 0.026, sustain: 0.04,
          release: 0.045, pan: Math.max(-1, Math.min(1, pan + random() * 0.2 - 0.1)),
        });
        return cues;
      },
    },
  ],
};
