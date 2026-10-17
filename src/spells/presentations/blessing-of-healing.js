// A sheltering bough releases petals onto a flower of roots. Local metres only.
const leaf = [139, 221, 126], petal = [246, 245, 184], root = [109, 182, 117];

function rosette(plot, size, z, brightness) {
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3;
    plot(Math.cos(a) * size, z + Math.sin(a) * size * 0.55, '+', petal, brightness);
    plot(Math.cos(a + 0.2) * size * 1.5, z + Math.sin(a + 0.2) * size * 0.8, ',', root, brightness * 0.65);
  }
}

export default {
  id: 'blessing-of-healing', duration: 1.35,
  draw(effect, plot) {
    const p = Math.min(1, Math.max(0, effect.progress));
    const fade = Math.min(1, (1 - p) * 4), age = effect.age;
    if (effect.stage === 'projectile') {
      // A hanging petal bud rather than a generic sphere, followed by paired pollen.
      plot(0, 0.28, 'v', petal, fade);
      for (const side of [-1, 1]) {
        plot(side * 0.13, 0.04, side < 0 ? '(' : ')', leaf, fade);
        plot(side * 0.08, -0.15, ',', petal, fade);
        for (let i = 1; i <= 4; i++) {
          plot(side * (0.08 + i * 0.035), -0.22 - i * 0.14,
            '.', leaf, fade * (0.7 - i * 0.1));
        }
      }
      return;
    }

    if (effect.stage === 'impact') {
      // The small root flower opens into six paired petal paths at the healed ally.
      const bloom = 0.16 + Math.sin(p * Math.PI / 2) * 0.85;
      rosette(plot, bloom, -0.45, fade);
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3;
        for (const side of [-1, 1]) {
          const r = bloom * 0.66;
          plot(Math.cos(a) * r + Math.sin(a) * side * 0.13,
            -0.45 + Math.sin(a) * r * 0.55 - Math.cos(a) * side * 0.1,
            side < 0 ? '(' : ')', leaf, fade);
        }
        plot((i - 2.5) * 0.3, 0.95 - p * 1.3 + Math.sin(i * 1.7) * 0.12,
          'v', petal, fade * 0.85);
      }
      plot(0, -0.45, '+', petal, fade);
      return;
    }

    // Two stems split into a broad arch; short upward forks make the canopy.
    const growth = effect.stage === 'cast' ? 0.45 + p * 0.55 : 1;
    for (const side of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        plot(side * (0.16 + i * 0.1) * growth, -0.55 + i * 0.25 * growth,
          side < 0 ? '\\' : '/', root, fade * 0.8);
      }
      for (let i = 0; i < 8; i++) {
        const t = i / 7;
        plot(side * (0.3 + t * 1.02) * growth, (0.52 + Math.sin(t * Math.PI) * 0.45) * growth,
          side < 0 ? '/' : '\\', leaf, fade);
        if (i === 2 || i === 4 || i === 6) {
          plot(side * (0.42 + t * 1.02) * growth, (0.8 + Math.sin(t * Math.PI) * 0.45) * growth,
            'Y', leaf, fade * 0.9);
        }
      }
    }
    for (let i = 0; i < 5; i++) {
      const fall = (age * 0.65 + i * 0.23) % 1;
      const x = (i - 2) * 0.42 + Math.sin(age * 2 + i) * 0.06;
      plot(x, 0.8 - fall * 1.5, 'v', petal, fade * 0.9);
      plot(x - 0.045, 0.9 - fall * 1.5, '.', leaf, fade * 0.5);
    }
    rosette(plot, 0.17 + Math.sin(p * Math.PI) * 0.07, -0.65, fade);
  },
  sounds: {
    cast: [
      { kind: 'tone', type: 'triangle', frequency: 1046.5, endFrequency: 1032, delay: 0, duration: 0.42, gain: 0.055, attack: 0.004, release: 0.37, cutoff: 3400 },
      { kind: 'tone', type: 'triangle', frequency: 880, endFrequency: 870, delay: 0.13, duration: 0.45, gain: 0.06, attack: 0.004, release: 0.4, cutoff: 3000 },
      { kind: 'tone', type: 'triangle', frequency: 698.46, endFrequency: 692, delay: 0.29, duration: 0.49, gain: 0.065, attack: 0.005, release: 0.44, cutoff: 2600 },
      { kind: 'tone', type: 'sine', frequency: 523.25, endFrequency: 520, delay: 0.49, duration: 0.65, gain: 0.075, attack: 0.007, release: 0.6 },
    ],
    impact: [
      { kind: 'tone', type: 'sine', frequency: 261.63, duration: 0.85, gain: 0.075, attack: 0.045, release: 0.66 },
      { kind: 'tone', type: 'triangle', frequency: 329.63, duration: 0.78, gain: 0.045, attack: 0.045, release: 0.6, cutoff: 2100 },
      { kind: 'tone', type: 'sine', frequency: 392, duration: 0.85, gain: 0.055, attack: 0.045, release: 0.66 },
      { kind: 'tone', type: 'sine', frequency: 523.25, delay: 0.34, duration: 0.67, gain: 0.045, attack: 0.04, release: 0.55 },
      { kind: 'tone', type: 'sine', frequency: 261.63, delay: 0.57, duration: 0.7, gain: 0.06, attack: 0.04, release: 0.58 },
    ],
    pulse: [
      { kind: 'tone', type: 'sine', frequency: 659.25, endFrequency: 523.25, duration: 0.16, gain: 0.014, attack: 0.007, release: 0.14 },
    ],
  },
};
