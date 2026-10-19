const leaf = [164, 233, 98], vein = [241, 255, 181], wind = [119, 205, 168];

// The pointed leaf outline and its midrib remain legible in the compact trail.
const leafShape = [
  [0, 0.38, '^'], [-0.16, 0.15, '/'], [0.16, 0.15, '\\'],
  [-0.2, -0.05, '\\'], [0.2, -0.05, '/'], [0, -0.2, 'v'], [0, 0.08, '|'],
];

function drawLeaf(plot, x, z, size, brightness) {
  for (const [dx, dz, char] of leafShape) {
    plot(x + dx * size, z + dz * size, char, char === '|' ? vein : leaf, brightness);
  }
}

export default {
  id: 'blessing-of-swiftness',
  duration: 0.9,
  draw(effect, plot) {
    const p = effect.progress, fade = Math.min(1, (1 - p) * 3);
    if (effect.stage === 'projectile') {
      drawLeaf(plot, -0.14, 0.08, 0.55, fade);
      drawLeaf(plot, 0.14, -0.15, 0.55, fade);
      for (let i = 0; i < 6; i++) {
        plot(Math.sin(effect.age * 13 - i) * 0.12, -0.4 - i * 0.16,
          i % 2 ? '.' : '~', wind, fade * (0.65 - i * 0.08));
      }
      return;
    }

    // Arrival opens the leaves into a nimble forward stride; the cast gathers
    // them close together. Persistent stages retain the same foot-level crest.
    const arrival = effect.stage === 'impact' || effect.stage === 'aura';
    const reach = arrival ? 0.3 + p * 0.9 : 0.12 + p * 0.45;
    const spread = arrival ? 0.42 + p * 0.42 : 0.56 - p * 0.18;
    for (const side of [-1, 1]) {
      drawLeaf(plot, side * spread, reach + side * 0.12, 0.9, fade);
      for (let i = 0; i < 5; i++) {
        plot(side * spread + Math.sin(effect.age * 12 - i) * 0.07,
          reach - 0.35 - i * 0.19, '.', vein, fade * (0.65 - i * 0.1));
      }
    }

    // Two offset open ribbons circle the feet, rather than forming a halo.
    const radius = Math.min(1.35, Math.max(0.65, effect.radius));
    const expansion = arrival ? 0.8 + p * 0.85 : 1.1 - p * 0.25;
    for (let ribbon = 0; ribbon < 2; ribbon++) {
      for (let i = 0; i < 14; i++) {
        const t = i / 13;
        const angle = effect.age * 8 + ribbon * Math.PI + t * 2.1;
        const r = radius * expansion * (0.72 + t * 0.28);
        plot(Math.cos(angle) * r, Math.sin(angle) * r * 0.5 - 0.22,
          i === 13 ? '>' : '~', wind, fade * (0.3 + t * 0.6));
      }
    }
  },
  sounds: {
    cast: [
      { kind: 'tone', type: 'triangle', frequency: 392, endFrequency: 365, duration: 0.09, gain: 0.075, attack: 0.002, release: 0.075, cutoff: 1500 },
      { kind: 'tone', type: 'triangle', frequency: 494, endFrequency: 465, delay: 0.055, duration: 0.085, gain: 0.067, attack: 0.002, release: 0.07, cutoff: 1700 },
      { kind: 'tone', type: 'triangle', frequency: 659, endFrequency: 625, delay: 0.105, duration: 0.09, gain: 0.06, attack: 0.002, release: 0.075, cutoff: 1900 },
      { kind: 'noise', delay: 0.035, duration: 0.24, gain: 0.035, attack: 0.055, release: 0.17, cutoff: 2400, filterType: 'bandpass' },
      { kind: 'tone', type: 'sine', frequency: 1318, endFrequency: 1568, delay: 0.175, duration: 0.16, gain: 0.035, attack: 0.003, release: 0.145 },
    ],
    impact: [
      { kind: 'noise', duration: 0.18, gain: 0.04, attack: 0.012, release: 0.15, cutoff: 3100, filterType: 'bandpass' },
      { kind: 'tone', type: 'triangle', frequency: 784, endFrequency: 740, duration: 0.085, gain: 0.055, attack: 0.002, release: 0.07, cutoff: 2200 },
      { kind: 'tone', type: 'sine', frequency: 1568, endFrequency: 1760, delay: 0.07, duration: 0.17, gain: 0.035, attack: 0.003, release: 0.15 },
    ],
    pulse: [
      { kind: 'noise', duration: 0.08, gain: 0.014, attack: 0.012, release: 0.06, cutoff: 2600, filterType: 'bandpass' },
    ],
  },
};
