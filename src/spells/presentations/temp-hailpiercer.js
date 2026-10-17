// A drawn hail harpoon: narrow spine, swept barbs, then a puncture in the ice.
const core = [227, 252, 255];
const ice = [126, 215, 251];
const shadow = [74, 141, 205];

function harpoon(plot, length, width, offset, fade) {
  for (let i = 0; i < 12; i++) {
    plot(0, offset + length * (i / 11 - 0.65), i > 8 ? '|' : ':', core, fade);
  }
  plot(0, offset + length * 0.51, '^', core, fade);
  for (const shoulder of [0.18, -0.14]) {
    for (let i = 1; i <= 4; i++) {
      const x = width * i / 4;
      const z = offset + length * shoulder - x * 0.85;
      plot(-x, z, '/', ice, fade * (1 - i * 0.06));
      plot(x, z, '\\', ice, fade * (1 - i * 0.06));
    }
  }
}

export default {
  id: 'temp-hailpiercer',
  duration: 1.45,
  draw(effect, plot) {
    const p = effect.progress;
    const fade = Math.min(1, Math.max(0, (1 - p) * 4));
    if (['impact', 'pulse', 'zone', 'aura'].includes(effect.stage)) {
      // Two broken ripples spread from one tiny hole, rather than a full blast.
      const radius = 0.16 + p * 2.45;
      for (let ring = 0; ring < 2; ring++) {
        const r = radius * (ring ? 0.61 : 1);
        for (let i = 0; i < 24; i++) {
          if (i === 0 || i === 12 || (ring && i % 3 === 0)) continue;
          const angle = i * Math.PI / 12;
          plot(Math.sin(angle) * r, Math.cos(angle) * r * 0.72,
            ring ? '.' : '-', ring ? shadow : ice, fade * (ring ? 0.6 : 0.85));
        }
      }
      for (const side of [-1, 1]) {
        for (let i = 0; i < 6; i++) {
          const distance = 0.3 + p * (1.2 + i * 0.15);
          plot(side * (0.06 + i * 0.025), distance * (i % 2 ? -1 : 1),
            i < 2 ? '|' : ':', i < 2 ? core : ice, fade * (1 - i * 0.1));
        }
      }
      plot(-0.08, 0.08, '\\', core, fade);
      plot(0.08, 0.08, '/', core, fade);
      plot(-0.08, -0.08, '/', core, fade);
      plot(0.08, -0.08, '\\', core, fade);
      return;
    }
    if (effect.stage === 'projectile') {
      harpoon(plot, 1.45, 0.34, 0.1, fade);
      for (let i = 0; i < 9; i++) {
        const x = Math.sin(i * 2.3 + effect.age * 19) * (0.04 + i * 0.012);
        plot(x, -1.05 - i * 0.16, i % 3 ? '.' : ':', shadow, fade * (0.65 - i * 0.055));
      }
      return;
    }
    // Inhale: small hail chips travel inward while the shoulders close on the spine.
    harpoon(plot, 1.6 + p * 1.1, 0.36 + (1 - p) * 0.45, p * 0.25, fade);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        const travel = (p * 1.7 + i * 0.2) % 1;
        plot(side * (0.2 + (1 - travel) * 1.1), i * 0.3 - 0.55,
          travel > 0.65 ? ':' : '.', shadow, fade * (0.35 + travel * 0.45));
      }
    }
  },
  sounds: {
    cast: [
      { kind: 'tone', type: 'triangle', frequency: 238, endFrequency: 82, duration: 0.24, gain: 0.075, attack: 0.001, release: 0.21 },
      { kind: 'tone', type: 'sine', frequency: 126, endFrequency: 104, delay: 0.009, duration: 0.32, gain: 0.024, attack: 0.002, release: 0.29 },
      { kind: 'tone', type: 'sine', frequency: 2700, endFrequency: 3800, delay: 0.025, duration: 0.22, gain: 0.042, attack: 0.025, release: 0.15 },
      { kind: 'noise', delay: 0.03, duration: 0.26, gain: 0.038, cutoff: 4300, filterType: 'highpass', attack: 0.015, release: 0.21 },
    ],
    impact: [
      { kind: 'noise', duration: 0.035, gain: 0.095, cutoff: 3200, filterType: 'highpass', attack: 0.001, release: 0.03 },
      { kind: 'tone', type: 'triangle', frequency: 1970, endFrequency: 910, duration: 0.07, gain: 0.06, attack: 0.001, release: 0.065 },
      { kind: 'noise', delay: 0.075, duration: 0.035, gain: 0.042, cutoff: 6100, filterType: 'bandpass', attack: 0.001, release: 0.03 },
      { kind: 'noise', delay: 0.135, duration: 0.028, gain: 0.028, cutoff: 5200, filterType: 'bandpass', attack: 0.001, release: 0.024 },
      { kind: 'noise', delay: 0.225, duration: 0.03, gain: 0.016, cutoff: 4400, filterType: 'bandpass', attack: 0.001, release: 0.025 },
    ],
    pulse: [
      { kind: 'tone', type: 'sine', frequency: 1550, endFrequency: 1120, duration: 0.05, gain: 0.018, attack: 0.001, release: 0.045 },
    ],
  },
};
