export default {
  id: 'blizzard',
  label: 'Blizzard',
  description: 'Heavy cold wind presses through slow surges of dry blowing snow.',
  layers: [
    { name: 'pressure', filterType: 'lowpass', cutoff: 180, Q: 0.35, gain: 0.032 },
    { name: 'wind', filterType: 'lowpass', cutoff: 780, Q: 0.4, gain: 0.052 },
    { name: 'powder', filterType: 'bandpass', cutoff: 1700, Q: 0.45, gain: 0.014 },
  ],
  modulate({ now, intensity }) {
    const surge = 0.5 + 0.3 * Math.sin(now * 0.083) + 0.2 * Math.sin(now * 0.147 + 1.8);
    const drift = 0.5 + 0.28 * Math.sin(now * 0.193 + 0.7) + 0.18 * Math.sin(now * 0.311);
    return {
      pressure: {
        gain: (0.027 + 0.012 * surge) * intensity,
        cutoff: 135 + 65 * surge,
        pan: 0.16 * Math.sin(now * 0.071),
      },
      wind: {
        gain: (0.043 + 0.023 * surge) * intensity,
        cutoff: 560 + 380 * surge,
        pan: 0.43 * Math.sin(now * 0.097 + 1.2),
      },
      powder: {
        gain: (0.008 + 0.011 * drift) * intensity,
        cutoff: 1250 + 700 * drift,
        pan: 0.64 * Math.sin(now * 0.129 - 0.8),
      },
    };
  },
  events: [
    {
      interval: [9, 17],
      firstDelay: [4, 8],
      create({ intensity, random }) {
        const side = random() < 0.5 ? -1 : 1;
        const duration = 6.3 + random() * 1.4;
        const strength = (0.026 + random() * 0.01) * intensity;
        return [
          {
            kind: 'noise', delay: 0, duration,
            filterType: 'lowpass', cutoff: 420 + random() * 220, Q: 0.35,
            gain: strength, attack: 2.1, decay: 1.2, sustain: 0.68, release: 2.7,
            pan: side * (0.35 + random() * 0.25),
          },
          {
            kind: 'noise', delay: 1.2 + random() * 0.6, duration: 5.8,
            filterType: 'bandpass', cutoff: 1350 + random() * 450, Q: 0.4,
            gain: strength * 0.34, attack: 1.6, decay: 1.1, sustain: 0.48, release: 2.7,
            pan: -side * (0.45 + random() * 0.35),
          },
        ];
      },
    },
  ],
};
