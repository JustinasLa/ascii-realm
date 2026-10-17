const TAU = Math.PI * 2;
const foam = [169, 242, 235], water = [52, 180, 185], deep = [19, 99, 124];
const eye = [7, 30, 48];

function drawEye(plot, radius, rotation, fade, count = 10) {
  for (let i = 0; i < count; i++) {
    const angle = rotation + i * TAU / count;
    plot(Math.cos(angle) * radius, Math.sin(angle) * radius, 'o', deep, fade * 0.7);
  }
  plot(0, 0, '@', eye, fade);
}

export default {
  id: 'maelstrom',
  duration: 1.15,
  draw(effect, plot) {
    const p = effect.progress, fade = Math.max(0, Math.min(1, (1 - p) * 3));
    const rotation = -effect.age * (effect.stage === 'impact' ? 12 : 8);

    if (effect.stage === 'projectile') {
      // A compact spinning sinkhole carries a forked, corkscrew wake.
      for (let arm = 0; arm < 3; arm++) {
        for (let i = 0; i < 6; i++) {
          const t = i / 5, r = 0.15 + t * 0.34;
          const a = rotation + arm * TAU / 3 + (1 - t) * 3.7;
          plot(Math.cos(a) * r, Math.sin(a) * r, i === 5 ? '~' : ':', i === 5 ? foam : water, fade);
        }
      }
      for (let i = 0; i < 8; i++) {
        const z = -0.4 - i * 0.16;
        const x = Math.sin(effect.age * 17 - i * 0.8) * (0.05 + i * 0.018);
        plot(x, z, ':', water, fade * (0.75 - i * 0.07));
        if (i % 2 === 0) plot(-x - 0.13, z - 0.1, '.', deep, fade * 0.45);
      }
      drawEye(plot, 0.11, rotation, fade, 6);
      return;
    }

    const impact = effect.stage === 'impact';
    const extent = Math.max(1.05, Math.min(7, effect.radius));
    // Cast winds up an open spiral; impact contracts a foamy, tightly hooked one.
    const radius = extent * (impact ? 1.22 - p * 0.72 : effect.stage === 'cast' ? 0.65 + p * 0.35 : 1);
    const curl = impact ? 2.7 + p * 3 : 5.1;
    for (let arm = 0; arm < 5; arm++) {
      for (let i = 0; i < 10; i++) {
        const t = i / 9, r = radius * (0.24 + t * 0.76);
        const a = rotation + arm * TAU / 5 + (1 - t) * curl;
        plot(Math.cos(a) * r, Math.sin(a) * r, i === 9 ? impact ? '*' : ')' : i < 3 ? ':' : '~',
          i > 6 ? foam : water, fade * (0.6 + t * 0.4));
      }
      // Each bright head travels toward the eye, with its trailing beads outside.
      const inward = (effect.age * 1.6 + arm * 0.12) % 1;
      for (let bead = 0; bead < 3; bead++) {
        const distance = 0.93 - inward * 0.59 + bead * 0.04;
        const a = rotation + arm * TAU / 5 + (1 - distance) * curl - 0.2;
        plot(Math.cos(a) * radius * distance, Math.sin(a) * radius * distance,
          bead === 0 ? '-' : '.', bead === 0 ? foam : deep, fade * (0.95 - bead * 0.22));
      }
    }
    drawEye(plot, radius * 0.16, rotation, fade);
  },
  sounds: {
    cast: [
      { kind: 'tone', type: 'triangle', frequency: 74, endFrequency: 48, duration: 1.25, gain: 0.052, attack: 0.14, release: 0.45 },
      { kind: 'noise', cutoff: 220, filterType: 'lowpass', duration: 1.1, gain: 0.045, attack: 0.18, release: 0.5 },
      { kind: 'tone', type: 'sine', frequency: 510, endFrequency: 124, delay: 0.04, duration: 0.64, gain: 0.056, attack: 0.06, release: 0.3 },
      { kind: 'tone', type: 'sine', frequency: 390, endFrequency: 96, delay: 0.25, duration: 0.71, gain: 0.05, attack: 0.08, release: 0.35 },
      { kind: 'tone', type: 'sine', frequency: 288, endFrequency: 71, delay: 0.49, duration: 0.76, gain: 0.042, attack: 0.1, release: 0.4 },
      { kind: 'noise', cutoff: 730, filterType: 'bandpass', delay: 0.67, duration: 0.55, gain: 0.055, attack: 0.23, release: 0.28 },
    ],
    impact: [
      { kind: 'noise', cutoff: 500, filterType: 'lowpass', duration: 0.7, gain: 0.075, attack: 0.09, release: 0.46 },
      { kind: 'tone', type: 'triangle', frequency: 98, endFrequency: 35, duration: 0.7, gain: 0.07, attack: 0.025, release: 0.48 },
      { kind: 'tone', type: 'sine', frequency: 244, endFrequency: 54, delay: 0.06, duration: 0.56, gain: 0.057, attack: 0.035, release: 0.32 },
      { kind: 'tone', type: 'sine', frequency: 172, endFrequency: 44, delay: 0.19, duration: 0.51, gain: 0.044, attack: 0.05, release: 0.35 },
      { kind: 'noise', cutoff: 980, filterType: 'bandpass', delay: 0.12, duration: 0.47, gain: 0.062, attack: 0.22, release: 0.24 },
    ],
    pulse: [
      { kind: 'tone', type: 'sine', frequency: 184, endFrequency: 68, duration: 0.19, gain: 0.018, attack: 0.02, release: 0.13 },
      { kind: 'noise', cutoff: 490, filterType: 'lowpass', duration: 0.17, gain: 0.014, attack: 0.03, release: 0.11 },
    ],
  },
};
