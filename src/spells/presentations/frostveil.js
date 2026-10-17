// Fine hanging threads and open eyelets, rather than a solid ice shell.
const frost = [137, 211, 238], glint = [224, 250, 255], shade = [88, 153, 200];

function eyelet(plot, x, z, width, height, brightness) {
  for (const side of [-1, 1]) {
    plot(x + side * width * 0.5, z - height * 0.5, side < 0 ? '/' : '\\', glint, brightness);
    plot(x + side * width, z, side < 0 ? '<' : '>', frost, brightness);
    plot(x + side * width * 0.5, z + height * 0.5, side < 0 ? '\\' : '/', glint, brightness);
  }
  plot(x, z - height, '.', glint, brightness);
  plot(x, z + height, '.', glint, brightness);
}

export default {
  id: 'frostveil', duration: 1.25,
  draw(effect, plot) {
    const p = effect.progress, t = effect.age;
    const fade = Math.min(1, (1 - p) * 3);
    if (effect.stage === 'projectile') {
      eyelet(plot, 0, 0.08, 0.19, 0.29, fade);
      for (let thread = -1; thread <= 1; thread++) {
        for (let j = 0; j < 4; j++) {
          plot(thread * 0.12 + Math.sin(t * 7 + j * 0.9) * j * 0.035,
            -0.22 - j * 0.18, j % 2 ? ':' : '.', frost, fade * (0.7 - j * 0.12));
        }
      }
      return;
    }

    if (effect.stage === 'impact') {
      // Contact parts the two curtains; the eyelets lift through the opening.
      for (const side of [-1, 1]) {
        for (let thread = 0; thread < 3; thread++) {
          for (let row = 0; row < 7; row++) {
            const z = row * 0.27 - 0.85;
            const x = side * (0.35 + p * 1.5 + thread * 0.23 + row * row * 0.008);
            plot(x, z + Math.sin(row * 0.7 + t * 3) * 0.11, row % 2 ? ':' : '|', frost, fade * 0.75);
          }
        }
      }
      for (let i = -1; i <= 1; i++) eyelet(plot, i * (0.55 + p * 0.6), -p * 0.8,
        0.12 + p * 0.17, 0.22 + p * 0.2, fade);
      for (let i = 0; i < 8; i++) {
        const angle = i * Math.PI / 4 + t * 0.6;
        plot(Math.cos(angle) * (0.9 + p), Math.sin(angle) * (0.6 + p), '+', glint, fade * 0.6);
      }
      return;
    }

    const field = ['zone', 'aura', 'pulse'].includes(effect.stage);
    const size = field ? Math.min(5, Math.max(0.8, effect.radius)) : 1;
    const spread = size * (0.25 + p * 0.12);
    // Seven draping threads with a sagging hem and slowly travelling glints.
    for (let thread = -3; thread <= 3; thread++) {
      for (let row = 0; row < 7; row++) {
        const sag = (1 - (thread / 3) ** 2) * 0.38;
        const drift = Math.sin(t * 2.5 + row * 0.6 + thread * 0.8) * 0.07 * size;
        plot(thread * spread + drift, size * (row * 0.24 - 0.8 + sag),
          row % 3 === 0 ? ':' : '|', row === Math.floor(p * 6) ? glint : frost, fade * 0.72);
      }
    }
    for (let i = -1; i <= 1; i++) eyelet(plot, i * spread * 1.9, size * (0.02 + i * i * 0.1),
      size * (0.05 + p * 0.13), size * (0.12 + p * 0.2), fade);
    for (let i = 0; i < 8; i++) {
      const angle = i * Math.PI / 4 + t * 0.45;
      plot(Math.cos(angle) * size * 1.2, Math.sin(angle) * size * 0.82,
        i % 2 ? '+' : '.', shade, fade * 0.58);
    }
  },
  sounds: {
    cast: [
      { kind: 'noise', duration: 0.86, gain: 0.032, attack: 0.18, release: 0.44, cutoff: 4300, filterType: 'highpass' },
      { kind: 'tone', type: 'sine', frequency: 1568, endFrequency: 1480, duration: 0.92, gain: 0.027, attack: 0.16, release: 0.48 },
      { kind: 'tone', type: 'sine', frequency: 2352, endFrequency: 2217, delay: 0.17, duration: 0.76, gain: 0.018, attack: 0.18, release: 0.4 },
      { kind: 'tone', type: 'triangle', frequency: 1110, endFrequency: 410, delay: 0.32, duration: 0.88, gain: 0.033, attack: 0.2, release: 0.43, cutoff: 2400, filterType: 'lowpass' },
    ],
    impact: [
      { kind: 'tone', type: 'sine', frequency: 1175, endFrequency: 784, duration: 0.42, gain: 0.035, attack: 0.06, release: 0.28 },
      { kind: 'tone', type: 'sine', frequency: 1762, endFrequency: 1175, delay: 0.08, duration: 0.48, gain: 0.023, attack: 0.08, release: 0.32 },
      { kind: 'noise', delay: 0.12, duration: 0.56, gain: 0.032, attack: 0.13, release: 0.36, cutoff: 5400, filterType: 'highpass' },
    ],
    pulse: [
      { kind: 'noise', duration: 0.11, gain: 0.009, attack: 0.025, release: 0.07, cutoff: 6100, filterType: 'highpass' },
      { kind: 'tone', type: 'sine', frequency: 2093, endFrequency: 1976, duration: 0.13, gain: 0.008, attack: 0.025, release: 0.085 },
    ],
  },
};
