const TAU = Math.PI * 2;
const ICE = [176, 232, 255];
const RUNE = [111, 183, 249];
const CORE = [234, 252, 255];
const clamp = value => Math.max(0, Math.min(1, value));

function snowArm(plot, angle, length, base, light, reveal = 1) {
  const ux = Math.cos(angle), uz = Math.sin(angle);
  const vx = -uz, vz = ux;
  for (const fraction of [0.28, 0.62, 1]) {
    if (fraction > reveal) continue;
    const distance = base + length * fraction;
    plot(ux * distance, uz * distance, fraction === 1 ? '*' : '+', ICE, light);
  }
  // Two paired back-facing branches make a snowflake rather than a plain star.
  for (const fork of [0.57, 0.85]) {
    if (fork > reveal) continue;
    for (const side of [-1, 1]) {
      const distance = base + length * (fork - 0.16);
      const offset = length * 0.18 * side;
      plot(ux * distance + vx * offset, uz * distance + vz * offset,
        side < 0 ? '/' : '\\', ICE, light * 0.86);
    }
  }
}

function squareRune(plot, x, z, half, light) {
  for (const side of [-1, 1]) {
    plot(x + side * half, z - half, '+', RUNE, light);
    plot(x + side * half, z + half, '+', RUNE, light);
    plot(x + side * half, z, '|', RUNE, light);
    plot(x, z + side * half, '-', RUNE, light);
  }
}

export default {
  id: 'seithr-glyph',
  duration: 1.35,
  draw(effect, plot) {
    const p = clamp(Number.isFinite(effect.progress) ? effect.progress : 0);
    const fade = Math.min(1, p * 12) * Math.min(1, (1 - p) * 4);
    if (fade <= 0) return;

    if (effect.stage === 'projectile') {
      for (let arm = 0; arm < 6; arm++) {
        snowArm(plot, arm * TAU / 6, 0.36, 0, fade);
      }
      for (let index = 1; index <= 5; index++) {
        plot(index % 2 ? -0.07 : 0.07, -0.3 - index * 0.15,
          index % 2 ? '.' : '+', RUNE, fade * (0.58 - index * 0.075));
      }
      plot(0, 0, '*', CORE, fade);
      return;
    }

    const size = Math.max(1.2, Math.min(4.8,
      Number.isFinite(effect.radius) ? effect.radius : 2.8));
    const impact = effect.stage === 'impact';
    const casting = effect.stage === 'cast';
    const pulse = effect.stage === 'pulse';
    const turn = casting ? p * 0.24 : impact ? Math.PI / 6 : p * 0.42;
    const length = size * (casting ? 0.55 + p * 0.45
      : impact ? 0.75 - p * 0.2 : 0.92 + Math.sin(p * TAU) * 0.035);
    const base = impact ? size * (0.12 + p * 0.65) : 0;
    const orbit = size * (impact ? 0.9 + p * 0.7 : 1.14);
    const light = fade * (pulse ? 0.65 : 1);

    for (let arm = 0; arm < 6; arm++) {
      const angle = arm * TAU / 6 - Math.PI / 2 + turn;
      const reveal = casting ? clamp(p * 2.5 - arm * 0.16) : 1;
      snowArm(plot, angle, length, base, light, reveal);

      const runeAngle = angle + Math.PI / 6 + (impact ? -p * 0.2 : p * 0.35);
      const runeLight = light * (casting ? reveal : 0.8);
      if (runeLight > 0) {
        squareRune(plot, Math.cos(runeAngle) * orbit, Math.sin(runeAngle) * orbit,
          size * (impact ? 0.075 + p * 0.035 : 0.075), runeLight);
      }
    }
    plot(0, 0, impact ? 'x' : '*', CORE, light * (impact ? 1 - p : 1));
  },
  sounds: {
    cast: [
      // Six even glass steps trace the six arms; a quiet lower partial holds them together.
      ...[784, 988, 1175, 1568, 1976, 2350].map((frequency, index) => ({
        kind: 'tone', type: 'sine', delay: index * 0.105, duration: 0.31,
        frequency, endFrequency: frequency * 0.997, gain: 0.043 - index * 0.002,
        attack: 0.003, release: 0.25,
      })),
      { kind: 'tone', type: 'triangle', delay: 0, duration: 1.04,
        frequency: 392, endFrequency: 392, gain: 0.018, attack: 0.16, release: 0.4,
        cutoff: 1100, filterType: 'lowpass' },
    ],
    impact: [
      // The sealing chord arrives together, unlike the arm-by-arm cast.
      ...[587, 784, 1175].map(frequency => ({
        kind: 'tone', type: 'triangle', delay: 0, duration: 0.65,
        frequency, endFrequency: frequency * 0.993, gain: 0.037,
        attack: 0.004, release: 0.52, cutoff: 3400, filterType: 'lowpass',
      })),
      { kind: 'tone', type: 'sine', delay: 0.065, duration: 0.38,
        frequency: 3136, endFrequency: 2349, gain: 0.022, attack: 0.002, release: 0.32 },
    ],
    pulse: [
      { kind: 'tone', type: 'sine', delay: 0, duration: 0.13,
        frequency: 1568, endFrequency: 1560, gain: 0.012, attack: 0.003, release: 0.1 },
    ],
  },
};
