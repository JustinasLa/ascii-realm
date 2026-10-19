// A horned woodland anvil, a falling wooden mallet, and squared earth fractures.
const face = [225, 241, 151], body = [136, 174, 100], wood = [205, 149, 77], soil = [158, 126, 78];
const outline = [
  [-1.85, 0.3, '<'], [-1.55, 0.3, '-'], [-1.25, 0.3, '='], [-0.95, 0.3, '='],
  [-0.65, 0.3, '='], [-0.35, 0.3, '='], [-0.05, 0.3, '='], [0.25, 0.3, '='],
  [0.55, 0.3, '='], [0.85, 0.3, ']'], [-1.5, 0.05, '/'], [-1.2, -0.12, '_'],
  [-0.9, -0.12, '_'], [-0.6, -0.15, '/'], [0.65, -0.05, '\\'],
  [-0.45, -0.4, '|'], [0.5, -0.4, '|'], [-0.65, -0.65, '\\'], [0.7, -0.65, '/'],
  [-0.9, -0.85, '['], [-0.6, -0.85, '='], [-0.3, -0.85, '='], [0, -0.85, '='],
  [0.3, -0.85, '='], [0.6, -0.85, '='], [0.9, -0.85, ']'],
];

function anvil(plot, scale, fade, settle = 0) {
  for (const [x, z, char] of outline) plot(x * scale, z * scale + settle, char, z > 0.2 ? face : body, fade);
}

function slab(plot, width, depth, z, fade) {
  for (let i = -2; i <= 2; i++) {
    plot(i * width / 2, z + depth, i === -2 ? '+' : i === 2 ? '+' : '-', soil, fade);
    plot(i * width / 2, z - depth, i === -2 ? '+' : i === 2 ? '+' : '-', soil, fade);
  }
  plot(-width, z, '|', body, fade); plot(width, z, '|', body, fade);
}

export default {
  id: 'temp-shock-wave', duration: 1.1,
  draw(effect, plot) {
    const p = Math.max(0, Math.min(1, effect.progress));
    const fade = Math.min(1, (1 - p) * 3);
    if (effect.stage === 'projectile') {
      // The travelling earthquake carries a compact horned face and blocky wake.
      anvil(plot, 0.42, fade);
      for (let i = 0; i < 4; i++) {
        const z = -0.65 - i * 0.28;
        plot(-0.24 - i * 0.08, z, '[', soil, fade * (0.65 - i * 0.1));
        plot(0.24 + i * 0.08, z, ']', soil, fade * (0.65 - i * 0.1));
      }
      return;
    }
    if (effect.stage === 'cast') {
      anvil(plot, 1, fade);
      const descent = Math.min(1, p / 0.56);
      const head = 2.5 - 1.9 * descent * descent + Math.max(0, p - 0.56) * 0.3;
      for (const x of [-0.5, -0.25, 0, 0.25, 0.5]) {
        plot(x, head, '=', wood, fade); plot(x, head + 0.32, '=', wood, fade);
      }
      plot(-0.5, head + 0.16, '[', wood, fade); plot(0.5, head + 0.16, ']', wood, fade);
      for (let i = 1; i <= 3; i++) plot(0, head + 0.32 + i * 0.25, '|', wood, fade);
      if (p > 0.5 && p < 0.74) {
        plot(0, 0.43, '*', face, fade); plot(-0.65, 0.5, '/', face, fade); plot(0.65, 0.5, '\\', face, fade);
      }
      return;
    }
    // Impact keeps the anvil planted while rectangular slabs lift and spread.
    const impact = effect.stage === 'impact';
    anvil(plot, impact ? 0.9 : 0.55, fade, -p * 0.12);
    for (let i = 0; i < (impact ? 3 : 2); i++) {
      const travel = p * (impact ? 2.4 : 1.4);
      slab(plot, 0.85 + i * 0.38 + p * 0.8, 0.16 + i * 0.04,
        0.7 + i * 0.78 + travel, fade * (1 - i * 0.15));
    }
    if (impact) for (let i = 0; i < 6; i++) {
      const side = i % 2 ? 1 : -1;
      plot(side * (0.7 + p * (1.4 + i * 0.1)), 0.2 + i * 0.28 + Math.sin(p * Math.PI) * 0.6,
        i % 3 ? '.' : '#', soil, fade * 0.7);
    }
  },
  sounds: {
    cast: [
      { kind: 'noise', duration: 0.3, gain: 0.025, cutoff: 520, filterType: 'bandpass', attack: 0.06, release: 0.15 },
      { kind: 'tone', type: 'sine', frequency: 86, endFrequency: 68, duration: 0.4, gain: 0.035, attack: 0.08, release: 0.2 },
      { kind: 'noise', delay: 0.6, duration: 0.075, gain: 0.095, cutoff: 620, filterType: 'bandpass', attack: 0.002, release: 0.065 },
      { kind: 'tone', type: 'triangle', delay: 0.6, frequency: 146, endFrequency: 72, duration: 0.24, gain: 0.085, attack: 0.002, release: 0.22 },
      { kind: 'tone', type: 'sine', delay: 0.615, frequency: 114, endFrequency: 101, duration: 0.58, gain: 0.06, attack: 0.004, release: 0.55 },
      { kind: 'tone', type: 'sine', delay: 0.62, frequency: 173, endFrequency: 164, duration: 0.39, gain: 0.035, attack: 0.004, release: 0.37 },
    ],
    impact: [
      { kind: 'noise', duration: 0.07, gain: 0.11, cutoff: 720, filterType: 'bandpass', attack: 0.002, release: 0.065 },
      { kind: 'tone', type: 'triangle', frequency: 164, endFrequency: 73, duration: 0.17, gain: 0.1, attack: 0.002, release: 0.16 },
      { kind: 'tone', type: 'sine', frequency: 107, endFrequency: 91, duration: 0.62, gain: 0.07, attack: 0.004, release: 0.59 },
      { kind: 'tone', type: 'sine', delay: 0.012, frequency: 159, endFrequency: 149, duration: 0.4, gain: 0.04, attack: 0.004, release: 0.38 },
      { kind: 'noise', delay: 0.22, duration: 0.34, gain: 0.07, cutoff: 180, filterType: 'lowpass', attack: 0.03, release: 0.28 },
      { kind: 'tone', type: 'sine', delay: 0.24, frequency: 52, endFrequency: 32, duration: 0.4, gain: 0.055, attack: 0.02, release: 0.36 },
    ],
    pulse: [
      { kind: 'noise', duration: 0.075, gain: 0.025, cutoff: 280, filterType: 'lowpass', attack: 0.004, release: 0.065 },
      { kind: 'tone', type: 'sine', frequency: 73, endFrequency: 48, duration: 0.12, gain: 0.025, attack: 0.004, release: 0.11 },
    ],
  },
};
