// A low hot-water roller, pale steam vents, and yellow boiling beads.
const water = [52, 184, 182], crest = [139, 245, 224];
const heat = [255, 218, 125], steam = [236, 250, 238];

function vents(plot, xs, front, rise, age, fade) {
  for (const x of xs) {
    for (let j = 0; j < 4; j++) {
      const curl = Math.sin(age * 9 + j * 1.3 + x * 2) * (0.03 + j * 0.035);
      plot(x + curl, front + j * rise, j === 3 ? '~' : ':', steam, fade * (0.9 - j * 0.14));
    }
  }
}

export default {
  id: 'scalding-wave', duration: 1.1,
  draw(effect, plot) {
    const p = Math.max(0, Math.min(1, effect.progress));
    const r = Math.max(0.7, Math.min(2.6, effect.radius));
    const fade = Math.min(1, (1 - p) * 3), age = effect.age;
    if (effect.stage === 'projectile') {
      // The small travelling crest retains two steam curls and a broken wet wake.
      for (let i = -3; i <= 3; i++) {
        const x = i * 0.15, z = 0.25 - i * i * 0.025;
        plot(x, z, '~', crest, fade);
        plot(x, z - 0.16, '=', water, fade * 0.8);
      }
      vents(plot, [-0.22, 0.22], 0.3, 0.13, age, fade);
      for (let i = 0; i < 3; i++) {
        plot(-0.2 - i * 0.05, -0.35 - i * 0.2, '.', heat, fade * (0.65 - i * 0.16));
        plot(0.2 + i * 0.05, -0.35 - i * 0.2, '~', water, fade * (0.65 - i * 0.16));
      }
      return;
    }
    if (effect.stage === 'impact') {
      // The roller breaks into a forward fan, with boiling beads at the tips.
      for (let i = -5; i <= 5; i++) {
        const a = i * 0.24;
        for (let j = 1; j <= 3; j++) {
          const distance = r * (0.15 + p * 0.9) * j / 3;
          plot(Math.sin(a) * distance, Math.cos(a) * distance - j * j * 0.035,
            j === 3 ? 'o' : '~', j === 3 ? heat : crest, fade);
        }
      }
      vents(plot, [-0.7 * r, -0.35 * r, 0, 0.35 * r, 0.7 * r], 0.2 * r,
        0.13 + p * 0.15, age, fade);
      for (let i = -6; i <= 6; i++) {
        plot(i * r / 7, -0.12 * r + Math.sin(i * 1.7 + age * 12) * 0.05,
          i % 2 === 0 ? '.' : '=', i % 2 === 0 ? heat : water, fade * 0.8);
      }
      return;
    }
    if (effect.stage === 'aura') {
      // Burnt targets simmer under steam; this never changes the burn mechanics.
      vents(plot, [-0.35 * r, 0, 0.35 * r], -0.15 * r, 0.16 + p * 0.12, age, fade);
      for (let i = 0; i < 16; i++) {
        const a = i * Math.PI / 8;
        plot(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.22,
          i % 2 ? 'o' : '.', heat, fade * (0.6 + 0.2 * Math.sin(age * 13 + i)));
      }
      return;
    }
    const front = r * (-0.4 + p * 1.4), width = r * (0.6 + p * 0.4);
    for (let i = -6; i <= 6; i++) {
      const u = i / 6, z = front + (1 - u * u) * r * 0.2;
      plot(u * width, z, '~', crest, fade);
      plot(u * width, z - r * 0.18, '=', water, fade * 0.85);
      // Separate bright heat dots alternate with round boiling fringe beads.
      plot(u * width, z + 0.11 + Math.sin(age * 14 + i * 1.8) * 0.055,
        i % 2 === 0 ? 'o' : '.', heat, fade * 0.9);
    }
    vents(plot, [-0.58 * width, 0, 0.58 * width], front + 0.2 * r,
      0.12 + p * 0.1, age, fade);
  },
  sounds: {
    cast: [
      { kind: 'noise', duration: 0.48, gain: 0.075, cutoff: 2300, filterType: 'highpass', attack: 0.075, release: 0.2 },
      { kind: 'noise', delay: 0.025, duration: 0.5, gain: 0.065, cutoff: 260, filterType: 'bandpass', attack: 0.035, release: 0.2 },
      { kind: 'tone', type: 'sine', delay: 0.07, duration: 0.11, gain: 0.045, frequency: 165, endFrequency: 69, attack: 0.006, release: 0.08 },
      { kind: 'tone', type: 'sine', delay: 0.19, duration: 0.14, gain: 0.04, frequency: 210, endFrequency: 84, attack: 0.008, release: 0.1 },
    ],
    impact: [
      { kind: 'noise', duration: 0.065, gain: 0.09, cutoff: 5200, filterType: 'highpass', attack: 0.002, release: 0.055 },
      { kind: 'noise', delay: 0.018, duration: 0.36, gain: 0.08, cutoff: 3800, filterType: 'bandpass', attack: 0.012, release: 0.28 },
      { kind: 'noise', delay: 0.04, duration: 0.25, gain: 0.05, cutoff: 390, filterType: 'bandpass', attack: 0.01, release: 0.18 },
      { kind: 'tone', type: 'sine', delay: 0.04, duration: 0.1, gain: 0.045, frequency: 230, endFrequency: 76, attack: 0.005, release: 0.075 },
      { kind: 'tone', type: 'sine', delay: 0.115, duration: 0.08, gain: 0.03, frequency: 175, endFrequency: 63, attack: 0.005, release: 0.06 },
    ],
    pulse: [
      { kind: 'noise', duration: 0.075, gain: 0.018, cutoff: 2800, filterType: 'highpass', attack: 0.015, release: 0.055 },
    ],
  },
};
