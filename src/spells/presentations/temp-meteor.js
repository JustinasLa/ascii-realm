const HOT = [255, 239, 168];
const MOLTEN = [255, 132, 39];
const EMBER = [201, 63, 25];
const STONE = [158, 118, 89];
const TAU = Math.PI * 2;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function fallingRock(plot, progress, fade, compact) {
  // The broken tail stays behind the same diagonal as the descending core.
  const approach = compact ? 0 : (1 - progress) ** 2;
  const x = -2.6 * approach, z = -3.5 * approach;
  const size = compact ? 0.8 : 1;
  const put = (dx, dz, char, color, level = 1) =>
    plot(x + dx * size, z + dz * size, char, color, fade * level);
  for (const [dx, dz, char] of [
    [-0.37, -0.18, '/'], [-0.11, -0.4, '#'], [0.19, -0.32, '\\'],
    [0.39, -0.02, '#'], [0.27, 0.29, '/'], [-0.02, 0.39, '#'],
    [-0.31, 0.2, '\\'], [0, 0, '@'], [0.1, 0.13, '/'],
  ]) put(dx, dz, char, char === '@' || char === '/' ? HOT : MOLTEN);

  for (let i = 1; i <= 10; i++) {
    if (i === 4 || i === 8) continue;
    const distance = 0.3 + i * 0.23;
    const bend = Math.sin(i * 1.7 + progress * 8) * 0.08;
    put(-distance * 0.6 + bend, -distance * 0.8, i < 4 ? '*' : '.',
      i < 5 ? MOLTEN : EMBER, 0.9 - i * 0.055);
    if (i % 2) {
      put(-distance * 0.6 - 0.2, -distance * 0.8 + 0.15, "'", EMBER, 0.58);
      put(-distance * 0.6 + 0.2, -distance * 0.8 - 0.15, '*', MOLTEN, 0.64);
    }
  }
}

function crater(plot, progress, fade, radius, stage) {
  const impact = stage === 'impact';
  const expansion = impact ? 0.5 + 0.5 * (1 - (1 - progress) ** 3) : 0.84 + progress * 0.16;
  const rim = radius * expansion;
  // Two uneven concentric rims read as a shallow crater rather than a fire ring.
  for (let i = 0; i < 28; i++) {
    const angle = i / 28 * TAU;
    const jag = 1 + (i % 3 - 1) * 0.055;
    plot(Math.cos(angle) * rim * jag, Math.sin(angle) * rim * 0.62 * jag,
      i % 4 === 0 ? '#' : '-', i % 4 === 0 ? STONE : MOLTEN, fade * 0.8);
  }
  for (let i = 0; i < 16; i++) {
    const angle = i / 16 * TAU;
    plot(Math.cos(angle) * rim * 0.55, Math.sin(angle) * rim * 0.32,
      i % 2 ? '=' : '.', EMBER, fade * 0.55);
  }
  for (let spoke = 0; spoke < 6; spoke++) {
    const angle = spoke / 6 * TAU + 0.13;
    for (let step = 1; step <= 2; step++) {
      const distance = rim * (0.62 + step * 0.25);
      plot(Math.cos(angle) * distance, Math.sin(angle) * distance * 0.62,
        spoke % 2 ? '/' : '\\', EMBER, fade * 0.7);
    }
  }
  // Rock chips follow outward ballistic arcs; hotter pinpoints trail below them.
  for (let i = 0; i < 8; i++) {
    const angle = i / 8 * TAU + 0.21;
    const travel = rim * (0.48 + progress * 0.9);
    const lift = Math.sin(Math.PI * progress) * (0.9 + (i % 3) * 0.35);
    const x = Math.cos(angle) * travel, z = Math.sin(angle) * travel * 0.62 - lift;
    plot(x, z, impact ? (i % 2 ? '^' : '#') : '*', impact ? STONE : MOLTEN, fade * 0.85);
    plot(x * 0.9, z + 0.2, '.', MOLTEN, fade * 0.5);
  }
  plot(0, 0, '+', HOT, fade * (1 - progress) * 0.8);
}

export default {
  id: 'temp-meteor',
  duration: 1.25,
  draw(effect, plot) {
    const progress = clamp(Number.isFinite(effect.progress) ? effect.progress
      : (effect.age ?? 0) / Math.max(0.001, effect.life ?? 1), 0, 1);
    const fade = Math.min(1, (1 - progress) * 3);
    if (fade <= 0) return;
    if (effect.stage === 'cast' || effect.stage === 'projectile') {
      fallingRock(plot, progress, fade, effect.stage === 'projectile');
      return;
    }
    const radius = clamp(Number.isFinite(effect.radius) ? effect.radius : 2.7, 2.1, 6);
    crater(plot, progress, fade, radius, effect.stage);
  },
  sounds: {
    cast: [
      { kind: 'tone', type: 'sawtooth', delay: 0, duration: 0.82, frequency: 165, endFrequency: 46, gain: 0.055, attack: 0.1, release: 0.34, cutoff: 190, filterType: 'lowpass' },
      { kind: 'noise', delay: 0, duration: 0.72, gain: 0.065, attack: 0.2, release: 0.24, cutoff: 900, filterType: 'lowpass' },
      { kind: 'tone', type: 'triangle', delay: 0.12, duration: 0.86, frequency: 86, endFrequency: 31, gain: 0.045, attack: 0.12, release: 0.42 },
    ],
    impact: [
      { kind: 'tone', type: 'sine', delay: 0, duration: 1.08, frequency: 104, endFrequency: 29, gain: 0.13, attack: 0.004, release: 0.91 },
      { kind: 'tone', type: 'triangle', delay: 0, duration: 0.72, frequency: 62, endFrequency: 24, gain: 0.07, attack: 0.003, release: 0.65, cutoff: 170, filterType: 'lowpass' },
      { kind: 'noise', delay: 0, duration: 0.24, gain: 0.1, attack: 0.002, release: 0.2, cutoff: 850, filterType: 'lowpass' },
      { kind: 'noise', delay: 0.13, duration: 0.1, gain: 0.048, attack: 0.002, release: 0.085, cutoff: 1850, filterType: 'bandpass' },
      { kind: 'tone', type: 'square', delay: 0.24, duration: 0.055, frequency: 220, endFrequency: 96, gain: 0.032, attack: 0.002, release: 0.045, cutoff: 900, filterType: 'lowpass' },
      { kind: 'noise', delay: 0.38, duration: 0.07, gain: 0.03, attack: 0.002, release: 0.06, cutoff: 1200, filterType: 'bandpass' },
      { kind: 'noise', delay: 0.53, duration: 0.1, gain: 0.022, attack: 0.003, release: 0.09, cutoff: 700, filterType: 'lowpass' },
    ],
    pulse: [
      { kind: 'noise', delay: 0, duration: 0.13, gain: 0.013, attack: 0.02, release: 0.1, cutoff: 550, filterType: 'lowpass' },
      { kind: 'tone', type: 'triangle', delay: 0.025, duration: 0.1, frequency: 74, endFrequency: 42, gain: 0.012, attack: 0.015, release: 0.08 },
    ],
  },
};
