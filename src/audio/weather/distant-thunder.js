export default {
  id: 'distant-thunder',
  label: 'Distant thunder',
  description: 'Dark rolls of thunder drift beyond the horizon over a restrained wind.',
  layers: [
    { name: 'far-wind', filterType: 'lowpass', cutoff: 340, Q: 0.35, gain: 0.01 },
  ],
  modulate({ now, intensity }) {
    const swell = 0.5 + 0.5 * Math.sin(now * 0.047 + Math.sin(now * 0.013));
    return {
      'far-wind': {
        gain: (0.006 + 0.005 * swell) * intensity,
        cutoff: 260 + 150 * swell,
        pan: Math.sin(now * 0.019) * 0.22,
      },
    };
  },
  events: [
    {
      interval: [19, 46],
      firstDelay: [6, 15],
      create({ now, intensity, random }) {
        const strength = 0.65 + random() * 0.35;
        const bearing = Math.sin(now * 0.011) * 0.55 + (random() - 0.5) * 0.3;
        const drift = (random() - 0.5) * 0.22;
        const cues = [
          {
            kind: 'noise', delay: 0, duration: 6.6 + random() * 1.2,
            filterType: 'lowpass', cutoff: 150 + random() * 90, Q: 0.35,
            gain: 0.14 * strength * intensity,
            attack: 0.8 + random() * 0.5, decay: 1.5,
            sustain: 0.42, release: 2.6, pan: bearing,
          },
          {
            kind: 'noise', delay: 0.9 + random() * 0.8, duration: 5.2 + random() * 1.3,
            filterType: 'lowpass', cutoff: 95 + random() * 65, Q: 0.3,
            gain: 0.065 * strength * intensity,
            attack: 1.1, decay: 1.0, sustain: 0.4,
            release: 2.5, pan: bearing + drift,
          },
        ];
        if (random() > 0.3) {
          cues.push({
            kind: 'noise', delay: 2.2 + random() * 0.9, duration: 4.4 + random() * 1.1,
            filterType: 'lowpass', cutoff: 180 + random() * 110, Q: 0.3,
            gain: 0.032 * strength * intensity,
            attack: 0.9, decay: 0.8, sustain: 0.3,
            release: 2.1, pan: bearing + drift * 1.6,
          });
        }
        return cues;
      },
    },
  ],
};
