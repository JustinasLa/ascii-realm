export default {
  id: 'gale',
  label: 'Gale',
  description: 'Deep wind pressure and dry turbulent gusts passing across the landscape.',
  layers: [
    { name: 'pressure', filterType: 'lowpass', cutoff: 240, Q: 0.35, gain: 0.038 },
    { name: 'dryAir', filterType: 'bandpass', cutoff: 850, Q: 0.45, gain: 0.026 },
  ],
  modulate({ now, intensity }) {
    const swell = (Math.sin(now * 0.27) + Math.sin(now * 0.113 + 1.8) + 2) / 4;
    const eddy = (Math.sin(now * 0.71 + 2.2) + 1) / 2;
    return {
      pressure: {
        gain: intensity * (0.025 + swell * 0.024),
        cutoff: 160 + swell * 150,
        pan: Math.sin(now * 0.09) * 0.24,
      },
      dryAir: {
        gain: intensity * (0.011 + swell * 0.017 + eddy * 0.005),
        cutoff: 540 + swell * 500 + eddy * 130,
        pan: Math.sin(now * 0.17 + 1.9) * 0.58,
      },
    };
  },
  events: [
    {
      interval: [5.8, 10.8],
      firstDelay: [1.8, 4.5],
      create({ intensity, random }) {
        const side = random() < 0.5 ? -1 : 1;
        const strength = intensity * (0.7 + random() * 0.3);
        // Broad pressure arrives first; the dry edge crests later across the stereo field.
        return [
          {
            kind: 'noise', delay: 0, duration: 4.2 + random() * 1.2,
            filterType: 'lowpass', cutoff: 180 + random() * 110, Q: 0.35,
            gain: 0.076 * strength, attack: 0.85, decay: 1.1,
            sustain: 0.38, release: 1.5, pan: side * 0.3,
          },
          {
            kind: 'noise', delay: 0.65 + random() * 0.4, duration: 3.5 + random() * 0.7,
            filterType: 'bandpass', cutoff: 660 + random() * 360, Q: 0.5,
            gain: 0.041 * strength, attack: 0.65, decay: 0.9,
            sustain: 0.26, release: 1.2, pan: -side * (0.5 + random() * 0.25),
          },
          {
            kind: 'noise', delay: 1.65 + random() * 0.55, duration: 2.1 + random() * 0.6,
            filterType: 'bandpass', cutoff: 1100 + random() * 550, Q: 0.4,
            gain: 0.016 * strength, attack: 0.38, decay: 0.5,
            sustain: 0.16, release: 0.9, pan: side * (0.45 + random() * 0.35),
          },
        ];
      },
    },
  ],
};
