export default {
  id: 'thunderstorm',
  rainfall: 0.9,
  label: 'Thunderstorm',
  description: 'Wind-driven rain beneath nearby rolling thunder and heavy, spreading rumbles.',
  layers: [
    { name: 'storm-rain', filterType: 'lowpass', cutoff: 2800, Q: 0.35, gain: 0.053 },
    { name: 'storm-wind', filterType: 'lowpass', cutoff: 460, Q: 0.4, gain: 0.023 },
    { name: 'storm-spray', filterType: 'bandpass', cutoff: 2200, Q: 0.55, gain: 0.011 },
  ],
  modulate({ now, intensity }) {
    const gust = 0.5 + 0.28 * Math.sin(now * 0.19) + 0.22 * Math.sin(now * 0.071 + 1.3);
    const rain = 0.5 + 0.5 * Math.sin(now * 0.31 + Math.sin(now * 0.043));
    return {
      'storm-rain': {
        gain: (0.043 + 0.017 * rain + 0.006 * gust) * intensity,
        cutoff: 2400 + 700 * rain,
        pan: Math.sin(now * 0.087) * 0.16,
      },
      'storm-wind': {
        gain: (0.012 + 0.021 * gust) * intensity,
        cutoff: 290 + 290 * gust,
        pan: Math.sin(now * 0.12 + 0.8) * 0.38,
      },
      'storm-spray': {
        gain: (0.005 + 0.008 * gust) * intensity,
        cutoff: 1700 + 700 * rain,
        pan: Math.sin(now * 0.14 - 0.6) * 0.3,
      },
    };
  },
  events: [
    {
      interval: [10, 24],
      firstDelay: [3, 8],
      create({ intensity, random }) {
        if (intensity <= 0) return [];
        const strength = (0.72 + random() * 0.28) * intensity;
        const direction = random() * 1.2 - 0.6;
        const spread = random() < 0.5 ? -1 : 1;
        return [
          // A soft noisy pressure front keeps the onset substantial without a sharp crack.
          { kind: 'noise', delay: 0, duration: 0.95,
            filterType: 'lowpass', cutoff: 440 + random() * 160, Q: 0.35,
            gain: 0.098 * strength, attack: 0.045, decay: 0.27,
            sustain: 0.24, release: 0.48, pan: direction },
          { kind: 'noise', delay: 0.035, duration: 0.46,
            filterType: 'bandpass', cutoff: 610 + random() * 240, Q: 0.45,
            gain: 0.024 * strength, attack: 0.025, decay: 0.12,
            sustain: 0.12, release: 0.25, pan: direction * 0.85 },
          // Delayed low bands roll outward, with progressively slower envelopes.
          { kind: 'noise', delay: 0.13 + random() * 0.18, duration: 3.7,
            filterType: 'lowpass', cutoff: 175 + random() * 85, Q: 0.5,
            gain: 0.086 * strength, attack: 0.18, decay: 0.9,
            sustain: 0.35, release: 1.9, pan: direction * 0.65 },
          { kind: 'noise', delay: 0.62 + random() * 0.3, duration: 4.3,
            filterType: 'lowpass', cutoff: 90 + random() * 65, Q: 0.55,
            gain: 0.069 * strength, attack: 0.48, decay: 1,
            sustain: 0.3, release: 2.2, pan: direction * 0.3 - spread * 0.22 },
          { kind: 'noise', delay: 1.55 + random() * 0.5, duration: 2.7,
            filterType: 'lowpass', cutoff: 210 + random() * 100, Q: 0.4,
            gain: 0.05 * strength, attack: 0.32, decay: 0.65,
            sustain: 0.2, release: 1.5, pan: direction * 0.35 + spread * 0.42 },
          { kind: 'noise', delay: 2.35 + random() * 0.75, duration: 3.2,
            filterType: 'lowpass', cutoff: 115 + random() * 70, Q: 0.45,
            gain: 0.038 * strength, attack: 0.6, decay: 0.75,
            sustain: 0.15, release: 1.7, pan: -direction * 0.4 - spread * 0.35 },
        ];
      },
    },
  ],
};
