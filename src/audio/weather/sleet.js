export default {
  id: 'sleet',
  rainfall: 0.25,
  label: 'Sleet',
  description: 'Fine wind-slanted ice grains mingle with a damp wash and small uneven taps.',
  layers: [
    { name: 'icyGrit', filterType: 'bandpass', cutoff: 3900, Q: 0.45, gain: 0.011 },
    { name: 'dampWash', filterType: 'lowpass', cutoff: 950, Q: 0.3, gain: 0.012 },
    { name: 'grainRustle', filterType: 'bandpass', cutoff: 1650, Q: 0.6, gain: 0.006 },
  ],
  modulate({ now, intensity }) {
    const slant = Math.sin(now * 0.13) * 0.2 + Math.sin(now * 0.047 + 1.8) * 0.12;
    const pressure = 0.76 + Math.sin(now * 0.19 + 0.7) * 0.12
      + Math.sin(now * 0.071) * 0.08;
    return {
      icyGrit: {
        gain: 0.011 * pressure * intensity,
        cutoff: 3700 + Math.sin(now * 0.17) * 420,
        pan: slant,
      },
      dampWash: {
        gain: 0.012 * (0.88 + Math.sin(now * 0.11 + 2.2) * 0.12) * intensity,
        cutoff: 850 + Math.sin(now * 0.083 + 1.2) * 140,
        pan: -slant * 0.35,
      },
      grainRustle: {
        gain: 0.006 * (0.72 + Math.sin(now * 0.27 + 0.5) * 0.2) * intensity,
        cutoff: 1550 + Math.sin(now * 0.21 + 2.7) * 240,
        pan: slant * 0.65,
      },
    };
  },
  events: [
    {
      interval: [0.21, 0.83],
      firstDelay: [0.12, 0.6],
      create({ intensity, random }) {
        if (intensity === 0) return [];
        const count = 1 + Math.floor(random() * 4);
        const side = random() * 1.4 - 0.7;
        const cues = [];
        let delay = 0;
        for (let index = 0; index < count; index += 1) {
          cues.push({
            kind: 'noise',
            delay,
            duration: 0.04 + random() * 0.045,
            filterType: 'bandpass',
            cutoff: 1800 + random() * 2700,
            Q: 0.65 + random() * 0.7,
            gain: (0.007 + random() * 0.01) * intensity,
            attack: 0.0015,
            decay: 0.012,
            sustain: 0.035,
            release: 0.019,
            pan: Math.max(-1, Math.min(1, side + (random() - 0.5) * 0.3)),
          });
          delay += 0.027 + random() * 0.105;
        }
        return cues;
      },
    },
    {
      interval: [1.1, 3.4],
      firstDelay: [0.6, 1.7],
      create({ intensity, random }) {
        if (intensity === 0) return [];
        return [{
          kind: 'noise',
          delay: random() * 0.12,
          duration: 0.22 + random() * 0.18,
          filterType: 'bandpass',
          cutoff: 3100 + random() * 1400,
          Q: 0.4,
          gain: (0.006 + random() * 0.004) * intensity,
          attack: 0.055,
          decay: 0.055,
          sustain: 0.18,
          release: 0.095,
          pan: random() * 1.3 - 0.65,
        }];
      },
    },
  ],
};
