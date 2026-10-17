// A liquid spear gathers into a pointed drop, then opens into a bead-tipped crown.
const foam = [202, 255, 249], water = [48, 219, 218], deep = [32, 116, 177];

export default {
  id: 'tide-shard',
  duration: 0.78,
  draw(effect, plot) {
    const p = effect.progress, fade = Math.max(0, Math.min(1, (1 - p) * 4));
    if (effect.stage === 'impact') {
      const size = Math.min(1.4, effect.radius), rim = (0.28 + p * 1.15) * size;
      // A scalloped water rim remains inside the outward, bead-tipped splash.
      for (let i = 0; i < 24; i++) {
        const a = i * Math.PI / 12, r = rim * (1 + 0.08 * Math.cos(a * 8));
        plot(Math.sin(a) * r, Math.cos(a) * r * 0.72, '~', water, fade * 0.75);
      }
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4, reach = rim + (0.25 + Math.sin(p * Math.PI) * 0.7) * size;
        for (let j = 0; j < 3; j++) {
          const t = j / 3, r = rim + (reach - rim) * t;
          const bend = a + Math.sin(t * Math.PI) * 0.16;
          plot(Math.sin(bend) * r, Math.cos(bend) * r * 0.72,
            j === 0 ? 'u' : ':', water, fade * (0.8 - t * 0.2));
        }
        plot(Math.sin(a) * reach, Math.cos(a) * reach * 0.72, 'o', foam, fade);
      }
      plot(0, 0, 'o', deep, fade * (1 - p));
      return;
    }

    if (effect.stage === 'cast' || effect.stage === 'projectile') {
      const flying = effect.stage === 'projectile';
      const scale = flying ? 0.65 : 0.9 + p * 0.2, forward = flying ? 0 : p * 0.35;
      const outline = [[0.09, 0.67], [0.18, 0.4], [0.28, 0.12], [0.29, -0.15], [0.21, -0.36], [0.09, -0.47]];
      for (const [x, z] of outline) {
        plot(-x * scale, z * scale + forward, '/', water, fade);
        plot(x * scale, z * scale + forward, '\\', water, fade);
      }
      plot(0, 0.94 * scale + forward, '^', foam, fade);
      plot(0, -0.5 * scale + forward, 'u', water, fade);
      plot(-0.07 * scale, 0.12 * scale + forward, 'o', foam, fade * 0.9);
      for (let i = 0; i < 4; i++) plot(0, (i * 0.2 - 0.3) * scale + forward, '|', water, fade * 0.7);
      // Two separately curling wake strands are wider at their trailing ends.
      for (let i = 0; i < 7; i++) {
        const width = 0.12 + i * (flying ? 0.065 : 0.08 + (1 - p) * 0.05);
        const curl = Math.sin(effect.age * 18 - i * 0.8) * 0.035;
        const z = forward - 0.55 * scale - i * 0.17;
        plot(-width + curl, z, i % 2 ? '.' : '~', deep, fade * (0.7 - i * 0.075));
        plot(width + curl, z, i % 2 ? '.' : '~', water, fade * (0.7 - i * 0.075));
      }
      return;
    }

    // Tick, aura and zone effects leave small, travelling water ripples.
    const ripple = (0.18 + p * 0.65) * Math.min(1.5, effect.radius);
    for (let i = 0; i < 18; i++) {
      const a = i * Math.PI / 9, r = ripple + Math.sin(a * 3 + effect.age * 12) * 0.04;
      plot(Math.sin(a) * r, Math.cos(a) * r * 0.55, '~', water, fade * 0.65);
    }
    plot(-ripple * 0.7, ripple * 0.4, 'o', foam, fade * 0.7);
    plot(ripple * 0.7, -ripple * 0.4, 'o', foam, fade * 0.7);
  },
  sounds: {
    cast: [
      { kind: 'tone', type: 'sine', frequency: 1320, endFrequency: 410, duration: 0.1, gain: 0.08, attack: 0.001, release: 0.09 },
      { kind: 'tone', type: 'sine', frequency: 230, endFrequency: 135, delay: 0.065, duration: 0.12, gain: 0.065, attack: 0.012, release: 0.09 },
      { kind: 'tone', type: 'sine', frequency: 135, endFrequency: 205, delay: 0.155, duration: 0.15, gain: 0.045, attack: 0.025, release: 0.11 },
      { kind: 'noise', delay: 0.035, duration: 0.12, gain: 0.027, cutoff: 1800, filterType: 'bandpass', attack: 0.02, release: 0.09 },
    ],
    impact: [
      { kind: 'noise', duration: 0.075, gain: 0.095, cutoff: 3600, filterType: 'highpass', attack: 0.001, release: 0.065 },
      { kind: 'noise', delay: 0.04, duration: 0.26, gain: 0.065, cutoff: 1000, filterType: 'bandpass', attack: 0.015, release: 0.22 },
      { kind: 'tone', type: 'sine', frequency: 540, endFrequency: 180, delay: 0.02, duration: 0.13, gain: 0.065, attack: 0.002, release: 0.12 },
      { kind: 'tone', type: 'sine', frequency: 960, endFrequency: 420, delay: 0.14, duration: 0.08, gain: 0.025, attack: 0.001, release: 0.07 },
    ],
    pulse: [
      { kind: 'tone', type: 'sine', frequency: 680, endFrequency: 300, duration: 0.055, gain: 0.014, attack: 0.001, release: 0.05 },
    ],
  },
};
