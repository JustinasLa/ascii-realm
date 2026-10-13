export default {
  id: 'hail',
  label: 'Hail',
  description: 'Hard ice pellets rattle and bounce across the ground under a cold storm.',
  layers: [
    { name: 'coldStorm', filterType: 'lowpass', cutoff: 620, Q: 0.45, gain: 0.018 },
    { name: 'distantHail', filterType: 'bandpass', cutoff: 2400, Q: 0.5, gain: 0.006 },
  ],
  modulate({ now, intensity }) {
    const pressure = 0.76 + 0.14 * Math.sin(now * 0.19) + 0.1 * Math.sin(now * 0.43 + 1.8);
    return {
      coldStorm: {
        gain: 0.018 * intensity * pressure,
        cutoff: 530 + 150 * pressure,
        pan: 0.14 * Math.sin(now * 0.11),
      },
      distantHail: {
        gain: 0.006 * intensity * (0.65 + 0.35 * pressure),
        cutoff: 2150 + 400 * Math.sin(now * 0.17 + 0.9),
        pan: -0.18 * Math.sin(now * 0.13 + 0.6),
      },
    };
  },
  events: [
    {
      interval: [0.24, 0.78],
      firstDelay: [0.08, 0.3],
      create({ intensity, random }) {
        const cues = [];
        const pellets = 2 + Math.floor(random() * 2);
        for (let pellet = 0; pellet < pellets; pellet += 1) {
          const start = random() * 0.19;
          const position = random() * 1.7 - 0.85;
          const hardness = 2600 + random() * 2600;
          const strength = (0.026 + random() * 0.022) * intensity;
          const bounces = 2 + Math.floor(random() * 2);
          let delay = start;
          for (let bounce = 0; bounce < bounces; bounce += 1) {
            if (bounce > 0) delay += (0.045 + random() * 0.055) / bounce;
            cues.push({
              kind: 'noise',
              delay,
              duration: bounce === 0 ? 0.044 : 0.027,
              filterType: 'bandpass',
              cutoff: hardness * (1 - bounce * 0.1),
              Q: 0.65,
              gain: strength * Math.pow(0.46, bounce),
              attack: 0.001,
              decay: bounce === 0 ? 0.012 : 0.008,
              sustain: 0.025,
              release: bounce === 0 ? 0.025 : 0.016,
              pan: Math.max(-1, Math.min(1, position + bounce * (random() - 0.5) * 0.08)),
            });
          }
        }
        return cues;
      },
    },
  ],
};
