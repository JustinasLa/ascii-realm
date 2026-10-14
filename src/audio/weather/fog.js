// Fog has no sound of its own: sheltered air and occasional distant foliage
// leave the ordinary world ambience plenty of space.
export default {
  id: 'fog',
  label: 'Foggy stillness',
  description: 'Quiet sheltered air, with rare distant leaf and reed brushes.',
  layers: [
    { name: 'sheltered-air', filterType: 'lowpass', cutoff: 220, Q: 0.2, gain: 0.005 },
  ],
  modulate({ now, intensity }) {
    const swell = (1 + Math.sin(now * 0.065 + Math.sin(now * 0.019) * 0.7)) / 2;
    return {
      'sheltered-air': {
        gain: (0.0035 + swell * 0.002) * intensity,
        cutoff: 185 + swell * 65,
        pan: Math.sin(now * 0.027) * 0.12,
      },
    };
  },
  events: [
    {
      interval: [15, 32],
      firstDelay: [8, 18],
      create({ intensity, random }) {
        if (intensity === 0) return [];
        const reed = random() < 0.4;
        return [{
          kind: 'noise',
          delay: 0,
          duration: 0.9 + random() * 0.45,
          filterType: 'bandpass',
          cutoff: (reed ? 650 : 1050) + random() * 350,
          Q: 0.35,
          gain: (0.006 + random() * 0.003) * intensity,
          attack: 0.16,
          decay: 0.24,
          sustain: 0.18,
          release: 0.35,
          pan: random() * 1.4 - 0.7,
        }];
      },
    },
  ],
};
