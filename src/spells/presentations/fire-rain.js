const GOLD = [255, 202, 91];
const FLAME = [255, 113, 28];
const EMBER = [216, 58, 22];
const DROPS = [
  [-0.74, 0.07], [-0.38, 0.49], [0.02, 0.83], [0.37, 0.26], [0.69, 0.65],
];
const LANDINGS = [[-0.75, 0.28], [-0.3, -0.24], [0.16, 0.16], [0.64, -0.12], [0.34, 0.65]];
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

// Each drop opens like a little umbrella when it strikes the ground.
function splash(put, x, z, width, height) {
  put(x, z - height, '^', GOLD, 1);
  put(x - width * 0.55, z - height * 0.7, '/', FLAME, 0.9);
  put(x + width * 0.55, z - height * 0.7, '\\', FLAME, 0.9);
  put(x - width, z - height * 0.12, '.', EMBER, 0.6);
  put(x + width, z - height * 0.12, '.', EMBER, 0.6);
  put(x, z, '|', FLAME, 0.75);
}

export default {
  id: 'fire-rain',
  duration: 1.35,
  draw(effect, plot) {
    const age = Math.max(0, Number.isFinite(effect.age) ? effect.age : 0);
    const life = Number.isFinite(effect.life) && effect.life > 0 ? effect.life : 1.35;
    const progress = clamp(Number.isFinite(effect.progress) ? effect.progress : age / life, 0, 1);
    const fade = (1 - progress) ** 0.8;
    if (fade === 0) return;
    const radius = clamp(Number.isFinite(effect.radius) ? effect.radius : 2, 1.4, 4);
    const put = (x, z, char, color, brightness = 1) => plot(x, z, char, color, brightness * fade);

    if (effect.stage === 'projectile') {
      // A single oblique falling ember, with its long tail above and to the left.
      put(0.13, 0.19, '*', GOLD);
      put(0, 0, '\\', FLAME, 0.95);
      put(-0.12, -0.2, '\\', FLAME, 0.85);
      put(-0.08, 0.18, '<', FLAME, 0.8);
      put(0.3, 0.19, '>', FLAME, 0.8);
      for (let i = 1; i <= 4; i++) {
        put(-0.12 - i * 0.13, -0.2 - i * 0.23, '.', EMBER, 0.65 - i * 0.1);
      }
      return;
    }

    if (effect.stage === 'impact') {
      const spread = 0.22 + progress * 0.75;
      for (let i = 0; i < LANDINGS.length; i++) {
        const [x, z] = LANDINGS[i];
        const lift = radius * (0.16 + Math.sin(progress * Math.PI) * 0.24);
        const cx = x * radius * spread, cz = z * radius * spread;
        splash(put, cx, cz, radius * (0.1 + progress * 0.2), lift);
        put(cx - radius * progress * 0.2, cz - lift * 1.45, "'", GOLD, 0.6);
        put(cx + radius * progress * 0.24, cz - lift * 1.1, '.', EMBER, 0.5);
      }
      return;
    }

    // A broken lintel and three hanging runes suspend the rain above the field.
    const open = Math.min(1, 0.35 + progress * 3);
    const top = -radius * (1.1 + Math.sin(progress * Math.PI) * 0.13);
    for (let i = 0; i <= 10; i++) {
      put((i / 10 * 1.8 - 0.9) * radius * open, top,
        i === 0 || i === 10 || i === 5 ? '+' : '-', GOLD, 0.8);
    }
    for (const side of [-1, 1]) {
      for (let i = 1; i <= 4; i++) {
        put(side * radius * 0.9 * open, top + i * radius * 0.15, i === 4 ? '+' : '|', FLAME, 0.7);
      }
    }
    for (let i = -1; i <= 1; i++) {
      put(i * radius * 0.48 * open, top + radius * 0.24, i === 0 ? '|' : 'V', GOLD, 0.9);
    }

    for (const [lane, offset] of DROPS) {
      const fall = (age * 1.65 + offset) % 1;
      const x = radius * (lane + fall * 0.28);
      const z = top + radius * (0.34 + fall * 1.45);
      put(x, z, '*', GOLD);
      put(x - radius * 0.045, z - radius * 0.13, '\\', FLAME, 0.8);
      put(x - radius * 0.09, z - radius * 0.26, '\\', EMBER, 0.5);
      if (fall > 0.76) {
        const bloom = (fall - 0.76) / 0.24;
        splash(put, radius * (lane + 0.28), top + radius * 1.79,
          radius * (0.08 + bloom * 0.24), radius * (0.08 + bloom * 0.19));
      }
    }
  },
  sounds: {
    cast: [
      { kind: 'noise', delay: 0, duration: 0.34, gain: 0.035, attack: 0.13, release: 0.17, cutoff: 1500, filterType: 'bandpass' },
      { kind: 'tone', delay: 0, duration: 0.34, gain: 0.026, attack: 0.12, release: 0.16, frequency: 310, endFrequency: 1480, type: 'triangle', cutoff: 2400 },
      { kind: 'tone', delay: 0.24, duration: 0.23, gain: 0.034, attack: 0.025, release: 0.12, frequency: 1800, endFrequency: 530, type: 'sine' },
      { kind: 'noise', delay: 0.42, duration: 0.13, gain: 0.043, attack: 0.006, release: 0.11, cutoff: 2300, filterType: 'highpass' },
      { kind: 'tone', delay: 0.55, duration: 0.25, gain: 0.032, attack: 0.025, release: 0.14, frequency: 1540, endFrequency: 420, type: 'sine' },
      { kind: 'noise', delay: 0.75, duration: 0.14, gain: 0.04, attack: 0.006, release: 0.12, cutoff: 1800, filterType: 'highpass' },
      { kind: 'tone', delay: 0.89, duration: 0.23, gain: 0.031, attack: 0.025, release: 0.12, frequency: 2080, endFrequency: 640, type: 'sine' },
      { kind: 'noise', delay: 1.07, duration: 0.17, gain: 0.04, attack: 0.006, release: 0.14, cutoff: 2600, filterType: 'highpass' },
    ],
    impact: [
      { kind: 'tone', delay: 0, duration: 0.16, gain: 0.044, attack: 0.006, release: 0.12, frequency: 1050, endFrequency: 180, type: 'triangle' },
      { kind: 'noise', delay: 0.07, duration: 0.24, gain: 0.072, attack: 0.008, release: 0.2, cutoff: 2100, filterType: 'highpass' },
      { kind: 'tone', delay: 0.18, duration: 0.15, gain: 0.033, attack: 0.006, release: 0.11, frequency: 1340, endFrequency: 240, type: 'sine' },
      { kind: 'noise', delay: 0.25, duration: 0.22, gain: 0.054, attack: 0.008, release: 0.18, cutoff: 2800, filterType: 'highpass' },
      { kind: 'tone', delay: 0.39, duration: 0.16, gain: 0.028, attack: 0.006, release: 0.12, frequency: 890, endFrequency: 150, type: 'sine' },
      { kind: 'noise', delay: 0.46, duration: 0.28, gain: 0.044, attack: 0.008, release: 0.23, cutoff: 1600, filterType: 'highpass' },
    ],
    pulse: [
      { kind: 'noise', delay: 0, duration: 0.075, gain: 0.022, attack: 0.004, release: 0.065, cutoff: 2400, filterType: 'highpass' },
    ],
  },
};
