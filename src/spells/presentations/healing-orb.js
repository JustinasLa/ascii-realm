const mint = [153, 246, 174], leaf = [83, 192, 113];
const light = [239, 255, 203], pollen = [248, 226, 133];
const petal = [[0.18, 0], [0.48, -0.18], [0.86, -0.27], [1.2, -0.16],
  [1.34, 0], [1.2, 0.16], [0.86, 0.27], [0.48, 0.18]];

// Pointed seed coat with two crossing leaf veins; coordinates remain local.
function seed(plot, scale, fade) {
  for (let i = 0; i < 16; i++) {
    const a = i * Math.PI / 8;
    plot(Math.sin(a) * 0.43 * scale, Math.cos(a) * 0.72 * scale,
      i % 8 === 0 ? 'o' : i < 8 ? ')' : '(', mint, fade);
  }
  for (let i = -2; i <= 2; i++) {
    plot(i * 0.13 * scale, i * 0.19 * scale, '/', leaf, fade * 0.85);
    plot(-i * 0.13 * scale, i * 0.19 * scale, '\\', leaf, fade * 0.85);
  }
  plot(0, 0, 'o', light, fade);
}

export default {
  id: 'healing-orb',
  duration: 0.9,
  draw(effect, plot) {
    const p = effect.progress;
    const fade = Math.max(0, Math.min(1, (1 - p) * 3));
    if (effect.stage === 'projectile') {
      // A narrow corkscrew of pollen follows the seed, never a solid bolt.
      for (let i = 0; i < 14; i++) {
        const angle = i * 0.83 - effect.age * 9;
        plot(Math.sin(angle) * (0.1 + i * 0.018), -0.65 - i * 0.14,
          i % 3 === 0 ? ':' : '.', pollen, fade * (0.68 - i * 0.035));
      }
      seed(plot, 0.78 + Math.sin(effect.age * 7) * 0.04, fade);
      return;
    }
    if (effect.stage === 'cast') {
      // Pollen is pulled into a swelling seed before it leaves the hand.
      for (let i = 0; i < 20; i++) {
        const angle = i * 0.55 + effect.age * 4;
        const radius = (1.2 - p * 0.65) * (0.45 + i / 30);
        plot(Math.cos(angle) * radius, Math.sin(angle) * radius,
          i % 5 === 0 ? ':' : '.', pollen, fade * (0.45 + i * 0.02));
      }
      seed(plot, 0.6 + Math.sin(p * Math.PI / 2) * 0.4, fade);
      return;
    }
    // Five separate leaf-shaped petals open around the restorative centre.
    // Tick pulses retain this silhouette at a quieter, smaller scale.
    const pulse = effect.stage === 'pulse';
    const opening = (0.38 + Math.sin(p * Math.PI / 2) * 0.95) * (pulse ? 0.52 : 1);
    const glow = fade * (pulse ? 0.65 : 1);
    for (let n = 0; n < 5; n++) {
      const angle = n * Math.PI * 2 / 5 - Math.PI / 2;
      const c = Math.cos(angle), s = Math.sin(angle);
      for (let j = 0; j < petal.length; j++) {
        const [r, side] = petal[j];
        plot((c * r - s * side) * opening, (s * r + c * side) * opening,
          j === 4 ? 'o' : j < 4 ? '/' : '\\', mint, glow);
      }
      for (let j = 1; j <= 3; j++) {
        plot(c * j * 0.29 * opening, s * j * 0.29 * opening, ':', leaf, glow * 0.8);
      }
      const drift = opening * 1.5 + p * 0.35;
      plot(c * drift, s * drift, '.', pollen, glow * 0.7);
      plot(c * drift - s * 0.16, s * drift + c * 0.16, '.', pollen, glow * 0.45);
    }
    plot(0, 0, '+', light, glow);
  },
  sounds: {
    cast: [
      { kind: 'tone', type: 'sine', frequency: 330, endFrequency: 392, duration: 0.38, gain: 0.065, attack: 0.015, release: 0.28 },
      { kind: 'tone', type: 'sine', frequency: 523.25, delay: 0.12, duration: 0.25, gain: 0.055, attack: 0.008, release: 0.2 },
      { kind: 'tone', type: 'sine', frequency: 659.25, delay: 0.25, duration: 0.28, gain: 0.05, attack: 0.008, release: 0.23 },
      { kind: 'tone', type: 'sine', frequency: 783.99, delay: 0.38, duration: 0.35, gain: 0.045, attack: 0.01, release: 0.29 },
    ],
    impact: [
      { kind: 'tone', type: 'sine', frequency: 523.25, duration: 0.65, gain: 0.06, attack: 0.025, release: 0.5 },
      { kind: 'tone', type: 'sine', frequency: 659.25, delay: 0.035, duration: 0.6, gain: 0.04, attack: 0.04, release: 0.46 },
      { kind: 'noise', delay: 0.04, duration: 0.5, gain: 0.035, cutoff: 1800, filterType: 'bandpass', attack: 0.1, release: 0.35 },
      { kind: 'tone', type: 'sine', frequency: 1046.5, delay: 0.12, duration: 0.48, gain: 0.025, attack: 0.02, release: 0.4 },
    ],
    pulse: [
      { kind: 'tone', type: 'sine', frequency: 783.99, duration: 0.11, gain: 0.012, attack: 0.012, release: 0.085 },
    ],
  },
};
