// A bowed water shell: the rim holds droplets while currents sweep inside it.
const foam = [182, 255, 242], water = [61, 205, 211], deep = [35, 132, 182];

export default {
  id: 'tidal-shield',
  duration: 1.05,
  draw(effect, plot) {
    const p = Math.min(1, Math.max(0, effect.progress));
    const fade = Math.min(1, (1 - p) * 3);
    const phase = effect.age * 5;
    const size = Math.min(1.8, Math.max(0.9, effect.radius));

    if (effect.stage === 'projectile') {
      // A miniature bowed shell and two separated liquid wake strands.
      for (let i = 0; i < 12; i++) {
        const a = i / 12 * Math.PI * 2;
        plot(Math.sin(a) * 0.25, Math.cos(a) * 0.36,
          Math.sin(a) < 0 ? '(' : ')', water, fade);
      }
      plot(0, 0.3, 'o', foam, fade);
      for (let i = 0; i < 6; i++) {
        const x = 0.1 + i * 0.035 + Math.sin(phase - i) * 0.035;
        plot(-x, -0.32 - i * 0.13, '~', deep, fade * (0.65 - i * 0.08));
        plot(x, -0.37 - i * 0.13, '.', water, fade * (0.7 - i * 0.08));
      }
      return;
    }

    const contact = effect.stage === 'impact';
    const growth = effect.stage === 'cast' ? 0.35 + 0.65 * Math.sin(p * Math.PI / 2) : 1;
    const flex = contact ? Math.sin(p * Math.PI) * 0.22 : 0;
    // The lower half tapers, giving the rounded shell a shield silhouette.
    for (let i = 0; i < 28; i++) {
      const a = i / 28 * Math.PI * 2;
      const x = Math.sin(a) * (0.78 + Math.cos(a) * 0.2);
      const z = Math.cos(a) * 1.12;
      const dent = flex * Math.max(0, Math.sin(a)) * Math.max(0, Math.cos(a));
      plot((x - dent) * size * growth, z * size * growth,
        Math.abs(Math.sin(a)) > 0.72 ? (x < 0 ? '(' : ')') : '~', water, fade);
    }

    // Three separated streams sweep across the inside, never filling the shell.
    for (let stream = 0; stream < 3; stream++) {
      for (let i = 0; i < 8; i++) {
        const t = i / 7;
        const x = -0.55 + t * 1.1;
        const z = (stream - 1) * 0.37 + Math.sin(t * Math.PI + phase + stream) * 0.13;
        plot(x * size * growth, z * size * growth, i % 3 === 0 ? '=' : '~',
          stream === 1 ? foam : deep, fade * 0.68);
      }
    }

    if (contact) {
      // Contact sends three short, open ripples from one side of the flexing rim.
      for (let ripple = 0; ripple < 3; ripple++) {
        const r = 0.12 + p * 0.85 + ripple * 0.14;
        for (let i = 0; i < 8; i++) {
          const a = -1.2 + i / 7 * 2.4;
          plot(size * 0.58 + Math.cos(a) * r, size * 0.48 + Math.sin(a) * r,
            '~', ripple === 0 ? foam : water, fade * (0.9 - ripple * 0.2));
        }
      }
      for (let i = 0; i < 6; i++) {
        const a = -0.9 + i * 0.36, r = 0.45 + p * 1.2;
        plot(size * 0.58 + Math.cos(a) * r, size * 0.48 + Math.sin(a) * r,
          '.', foam, fade * 0.75);
      }
    } else {
      // Moving beads remain caught on the rim instead of spraying outwards.
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * Math.PI * 2 + phase * 0.34;
        const ripple = 1 + Math.sin(phase * 2 + i) * 0.035;
        plot(Math.sin(a) * (0.78 + Math.cos(a) * 0.2) * size * growth * ripple,
          Math.cos(a) * 1.12 * size * growth * ripple, 'o', foam, fade * 0.82);
      }
    }
  },
  sounds: {
    cast: [
      { kind: 'tone', type: 'sine', frequency: 160, endFrequency: 220, duration: 0.75, gain: 0.055, attack: 0.1, release: 0.24, cutoff: 1100 },
      { kind: 'tone', type: 'sine', delay: 0.035, frequency: 237, endFrequency: 330, duration: 0.73, gain: 0.04, attack: 0.12, release: 0.26, cutoff: 1400 },
      { kind: 'tone', type: 'triangle', delay: 0.07, frequency: 326, endFrequency: 440, duration: 0.68, gain: 0.025, attack: 0.1, release: 0.25, cutoff: 850 },
      { kind: 'noise', delay: 0.12, duration: 0.16, gain: 0.045, attack: 0.045, release: 0.1, cutoff: 740, filterType: 'lowpass' },
      { kind: 'noise', delay: 0.36, duration: 0.2, gain: 0.035, attack: 0.06, release: 0.12, cutoff: 970, filterType: 'lowpass' },
    ],
    impact: [
      { kind: 'tone', type: 'sine', frequency: 280, endFrequency: 125, duration: 0.32, gain: 0.08, attack: 0.004, release: 0.27 },
      { kind: 'tone', type: 'triangle', delay: 0.022, frequency: 560, endFrequency: 260, duration: 0.23, gain: 0.027, attack: 0.006, release: 0.2, cutoff: 900 },
      { kind: 'noise', delay: 0.018, duration: 0.16, gain: 0.05, attack: 0.015, release: 0.13, cutoff: 1250, filterType: 'bandpass' },
      { kind: 'tone', type: 'sine', delay: 0.14, frequency: 190, endFrequency: 95, duration: 0.22, gain: 0.035, attack: 0.015, release: 0.18 },
    ],
    pulse: [
      { kind: 'noise', duration: 0.12, gain: 0.018, attack: 0.025, release: 0.08, cutoff: 680, filterType: 'lowpass' },
      { kind: 'tone', type: 'sine', delay: 0.025, frequency: 105, endFrequency: 80, duration: 0.13, gain: 0.018, attack: 0.025, release: 0.08 },
    ],
  },
};
