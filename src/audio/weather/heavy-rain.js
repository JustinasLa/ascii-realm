export default {
  id: 'heavy-rain',
  rainfall: 1,
  label: 'Heavy rain',
  description: 'Dense downpour with a low rushing roar and scattered ground impacts.',
  layers: [
    { name: 'downpour', filterType: 'lowpass', cutoff: 3400, Q: 0.35, gain: 0.052 },
    { name: 'rainRoar', filterType: 'lowpass', cutoff: 510, Q: 0.45, gain: 0.03 },
    { name: 'rainSpray', filterType: 'bandpass', cutoff: 2400, Q: 0.4, gain: 0.01 },
  ],
  modulate({ now, intensity }) {
    // Uneven pressure moves the whole shower without a repeating drip pattern.
    const pressure = 0.76 + Math.sin(now * 0.193 + 0.9) * 0.12
      + Math.sin(now * 0.071 + 3.1) * 0.08
      + Math.sin(now * 0.457 + 1.7) * 0.04;
    const spray = 0.82 + Math.sin(now * 0.283 + 2.4) * 0.1
      + Math.sin(now * 0.613 + 0.5) * 0.06;
    return {
      downpour: {
        gain: 0.058 * pressure * intensity,
        cutoff: 2700 + pressure * 1100,
        pan: Math.sin(now * 0.047) * 0.12,
      },
      rainRoar: {
        gain: 0.035 * pressure * intensity,
        cutoff: 350 + pressure * 210,
        pan: Math.sin(now * 0.039 + 1.5) * 0.08,
      },
      rainSpray: {
        gain: 0.012 * spray * intensity,
        cutoff: 1950 + spray * 650,
        pan: Math.sin(now * 0.061 + 3.7) * 0.2,
      },
    };
  },
  events: [
    {
      interval: [0.85, 2.3],
      firstDelay: [0.35, 1.8],
      create({ intensity, random }) {
        const count = 2 + Math.floor(random() * 3);
        return Array.from({ length: count }, () => ({
          kind: 'noise',
          delay: random() * 0.55,
          duration: 0.045 + random() * 0.035,
          filterType: 'bandpass',
          cutoff: 850 + random() * 1750,
          Q: 0.45 + random() * 0.25,
          gain: (0.005 + random() * 0.006) * intensity,
          attack: 0.002,
          decay: 0.013,
          sustain: 0.04,
          release: 0.022,
          pan: random() * 1.5 - 0.75,
        }));
      },
    },
  ],
};
