const pearl = [233, 255, 212], mint = [132, 227, 151], gold = [209, 229, 127];
const tau = Math.PI * 2;

function orbs(plot, age, spread, light) {
  const angle = age * 7;
  const x = Math.cos(angle) * spread, z = Math.sin(angle) * spread * 0.65;
  for (const side of [-1, 1]) {
    plot(side * x, side * z, 'o', pearl, light);
    plot(side * x - 0.07, side * z, '(', gold, light * 0.8);
    plot(side * x + 0.07, side * z, ')', mint, light * 0.8);
  }
}

function lattice(plot, radius, samples, light) {
  for (let ring = 0; ring < 3; ring++) {
    const tilt = ring === 0 ? 0 : (ring === 1 ? 1 : -1) * Math.PI / 3;
    for (let i = 0; i < samples; i++) {
      const a = i / samples * tau;
      const x = Math.cos(a) * radius;
      const z = Math.sin(a) * radius * (ring === 0 ? 0.78 : 0.23);
      plot(x * Math.cos(tilt) - z * Math.sin(tilt),
        x * Math.sin(tilt) + z * Math.cos(tilt),
        i % (samples / 4) === 0 ? '+' : ':', ring === 0 ? mint : gold, light * (ring === 0 ? 0.85 : 0.62));
    }
  }
}

export default {
  id: 'shielding-orb',
  duration: 0.9,
  draw(effect, plot) {
    const p = Math.min(1, Math.max(0, Number.isFinite(effect.progress) ? effect.progress : 0));
    const age = Number.isFinite(effect.age) ? effect.age : 0;
    const fade = Math.min(1, (1 - p) * 4);
    if (effect.stage === 'projectile') {
      lattice(plot, 0.42, 8, fade);
      orbs(plot, age, 0.18, fade);
      // A paired bead wake keeps the travelling ward distinct from a shard.
      for (let i = 0; i < 4; i++) {
        const x = 0.12 + Math.sin(age * 8 - i * 0.6) * 0.045;
        for (const side of [-1, 1]) plot(side * x, -0.55 - i * 0.19, '.', mint, fade * (0.55 - i * 0.1));
      }
      return;
    }
    if (effect.stage === 'cast') {
      // The loose three-ring cage closes around the two orbiting cores.
      const radius = 0.52 + (1 - p) * 0.42;
      lattice(plot, radius, 16, fade);
      orbs(plot, age, radius * 0.36, fade);
      return;
    }
    const pulse = effect.stage === 'pulse';
    const radius = Math.min(2.2, Math.max(0.7, Number.isFinite(effect.radius) ? effect.radius : 1));
    const swell = effect.stage === 'impact' ? 0.6 + p * 0.65 : 0.88 + Math.sin(age * 7) * 0.05;
    const r = radius * swell;
    // Two overlapping, open arcs spring outward and hold a resilient shell.
    const samples = pulse ? 8 : 20;
    for (const side of [-1, 1]) {
      for (let i = 0; i < samples; i++) {
        const a = -2.3 + i / (samples - 1) * 4.6;
        plot(side * r * (0.28 + Math.cos(a) * 0.85), Math.sin(a) * r * 0.9,
          i === 0 || i === samples - 1 ? '+' : side < 0 ? '(' : ')', mint, fade * (pulse ? 0.5 : 0.85));
      }
    }
    if (!pulse) {
      // Small cross ties recall the lattice without obscuring the ally.
      for (const z of [-0.28, 0.28]) {
        for (const x of [-0.36, 0, 0.36]) plot(x * r, z * r, '=', gold, fade * 0.65);
      }
    }
    orbs(plot, age, r * 0.21, fade * (pulse ? 0.55 : 1));
  },
  sounds: {
    cast: [
      { kind: 'tone', type: 'sine', frequency: 660, duration: 0.65, gain: 0.065, attack: 0.004, release: 0.55 },
      { kind: 'tone', type: 'sine', frequency: 671, delay: 0.018, duration: 0.62, gain: 0.058, attack: 0.005, release: 0.52 },
      { kind: 'tone', type: 'triangle', frequency: 165, endFrequency: 170, delay: 0.06, duration: 0.48, gain: 0.035, cutoff: 800, attack: 0.04, release: 0.3 },
    ],
    impact: [
      { kind: 'tone', type: 'sine', frequency: 150, endFrequency: 112, duration: 0.34, gain: 0.085, attack: 0.007, release: 0.27 },
      { kind: 'tone', type: 'triangle', frequency: 300, endFrequency: 265, delay: 0.012, duration: 0.2, gain: 0.045, cutoff: 720, attack: 0.01, release: 0.17 },
      { kind: 'tone', type: 'sine', frequency: 440, delay: 0.07, duration: 0.44, gain: 0.035, attack: 0.018, release: 0.38 },
      { kind: 'tone', type: 'sine', frequency: 446, delay: 0.085, duration: 0.41, gain: 0.032, attack: 0.018, release: 0.35 },
    ],
    pulse: [
      { kind: 'tone', type: 'sine', frequency: 330, endFrequency: 326, duration: 0.08, gain: 0.012, attack: 0.01, release: 0.06 },
    ],
  },
};
