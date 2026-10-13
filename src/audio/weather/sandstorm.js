export default {
  id: 'sandstorm',
  label: 'Sandstorm',
  description: 'Muffled desert wind carries dry sand hiss, rubbing grit, and tiny irregular abrasions.',
  layers: [
    { name: 'buriedWind', filterType: 'lowpass', cutoff: 420, Q: 0.35, gain: 0.043 },
    { name: 'sandFriction', filterType: 'bandpass', cutoff: 1250, Q: 0.4, gain: 0.025 },
    { name: 'fineDust', filterType: 'bandpass', cutoff: 3200, Q: 0.45, gain: 0.009 },
  ],
  modulate({ now, intensity }) {
    const pressure = 0.5 + 0.3 * Math.sin(now * 0.19) + 0.2 * Math.sin(now * 0.073 + 1.4);
    const friction = 0.5 + 0.3 * Math.sin(now * 0.63 + 0.6) + 0.2 * Math.sin(now * 1.17);
    return {
      buriedWind: {
        gain: (0.025 + 0.023 * pressure) * intensity,
        cutoff: 270 + 230 * pressure,
        pan: Math.sin(now * 0.11) * 0.23,
      },
      sandFriction: {
        gain: (0.013 + 0.019 * pressure + 0.006 * friction) * intensity,
        cutoff: 920 + 650 * friction,
        pan: Math.sin(now * 0.17 + 1.8) * 0.38,
      },
      fineDust: {
        gain: (0.003 + 0.008 * friction * pressure) * intensity,
        cutoff: 2700 + 1000 * friction,
        pan: Math.sin(now * 0.23 + 3.1) * 0.46,
      },
    };
  },
  events: [
    {
      interval: [0.23, 0.92],
      firstDelay: [0.16, 0.65],
      create({ intensity, random }) {
        const count = 2 + Math.floor(random() * 4);
        const side = random() * 1.3 - 0.65;
        return Array.from({ length: count }, () => ({
          kind: 'noise',
          delay: random() * 0.22,
          duration: 0.04 + random() * 0.07,
          filterType: 'bandpass',
          cutoff: 1700 + random() * 2300,
          Q: 0.45,
          gain: (0.004 + random() * 0.009) * intensity,
          attack: 0.002,
          decay: 0.01,
          sustain: 0.08,
          release: 0.018,
          pan: side + random() * 0.3 - 0.15,
        }));
      },
    },
    {
      interval: [2.3, 6.7],
      firstDelay: [0.8, 3.4],
      create({ intensity, random }) {
        return [{
          kind: 'noise',
          delay: 0,
          duration: 0.26 + random() * 0.28,
          filterType: 'bandpass',
          cutoff: 650 + random() * 950,
          Q: 0.35,
          gain: (0.011 + random() * 0.014) * intensity,
          attack: 0.025,
          decay: 0.09,
          sustain: 0.32,
          release: 0.1,
          pan: random() * 1.6 - 0.8,
        }];
      },
    },
  ],
};
