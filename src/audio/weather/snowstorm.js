export default {
  id: 'snowstorm',
  label: 'Snowstorm',
  description: 'Muted cold wind carries fine, dry powder in soft uneven sweeps.',
  layers: [
    { name: 'coldWind', filterType: 'lowpass', cutoff: 780, Q: 0.35, gain: 0.024 },
    { name: 'powder', filterType: 'bandpass', cutoff: 2300, Q: 0.45, gain: 0.009 },
  ],
  modulate({ now, intensity }) {
    const gust = 0.5 + 0.3 * Math.sin(now * 0.19 + 0.6)
      + 0.2 * Math.sin(now * 0.47 + 2.1);
    const sweep = Math.sin(now * 0.13 + 0.8);
    return {
      coldWind: {
        gain: (0.014 + 0.012 * gust) * intensity,
        cutoff: 620 + 360 * gust,
        pan: sweep * 0.36,
      },
      powder: {
        gain: (0.004 + 0.011 * gust * gust) * intensity,
        cutoff: 1900 + 700 * gust,
        pan: sweep * 0.78 + Math.sin(now * 0.31) * 0.12,
      },
    };
  },
  events: [
    {
      interval: [4.2, 8.8],
      firstDelay: [2.5, 5.5],
      create({ intensity, random }) {
        if (intensity === 0) return [];
        const pan = random() * 1.5 - 0.75;
        return [{
          kind: 'noise',
          delay: 0,
          duration: 1.8 + random() * 1.2,
          filterType: 'bandpass',
          cutoff: 2100 + random() * 1000,
          Q: 0.4,
          gain: (0.008 + random() * 0.006) * intensity,
          attack: 0.3,
          decay: 0.45,
          sustain: 0.32,
          release: 0.7,
          pan,
        }];
      },
    },
  ],
};
