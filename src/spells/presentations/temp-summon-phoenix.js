const GOLD = [255, 225, 117];
const FIRE = [255, 115, 34];
const EMBER = [237, 64, 27];
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

// Local +z is the bird's flight direction. The effects adapter applies heading.
export default {
  id: 'temp-summon-phoenix',
  duration: 1.25,
  draw(effect, plot) {
    const age = Number.isFinite(effect.age) ? Math.max(0, effect.age) : 0;
    const progress = clamp(Number.isFinite(effect.progress) ? effect.progress
      : age / Math.max(0.01, effect.life || 1.25), 0, 1);
    const fade = clamp((1 - progress) / 0.36, 0, 1);
    if (!fade) return;
    const impact = effect.stage === 'impact';
    const flying = effect.stage === 'projectile';
    const small = effect.stage === 'pulse' || effect.stage === 'zone' || effect.stage === 'aura';
    const size = flying ? 0.54 : small ? 0.57 : impact ? 0.88 + progress * 0.28 : 0.65 + progress * 0.45;
    const flap = Math.sin(age * (flying ? 12 : 8.5));
    const span = impact ? 1.1 + progress * 0.22 : 0.87 + flap * 0.18;
    const lift = impact ? progress * 0.6 : Math.sin(age * 5) * 0.08;
    const mark = (x, z, char, color = GOLD, brightness = 1) =>
      plot(x * size, (z + lift) * size, char, color, clamp(brightness * fade, 0, 1));

    // A lit breast, narrow neck, round head and hooked beak remain readable
    // between wingbeats, including on the compact travelling projectile.
    for (let i = 0; i < 5; i++) mark(0, -0.35 + i * 0.27, '|');
    for (const side of [-1, 1]) {
      mark(side * 0.2, -0.12, '#', FIRE);
      mark(side * 0.17, 0.22, '#', GOLD);
    }
    mark(0.04, 1.05, '|');
    mark(0.08, 1.25, 'o');
    mark(0.31, 1.33, '>');
    mark(0.34, 1.15, 'v', FIRE);

    // Each wing has a swept leading edge, a shorter trailing edge and five
    // individually articulated primary feathers. Both wings beat together.
    for (const side of [-1, 1]) {
      for (let i = 0; i < 9; i++) {
        const t = i / 8;
        const x = (0.2 + 2.1 * t) * span;
        const z = 0.38 + Math.sin(t * Math.PI) * 0.48 + flap * t * 0.5;
        mark(side * x, z, side < 0 ? '/' : '\\');
      }
      for (let i = 0; i < 5; i++) {
        const t = i / 4;
        mark(side * (0.35 + t * 1.72) * span,
          -0.24 + Math.sin(t * Math.PI) * 0.25 + flap * t * 0.5,
          side < 0 ? '\\' : '/', FIRE, 0.82);
        const rootX = (0.72 + t * 1.42) * span;
        const rootZ = -0.08 + Math.sin(t * Math.PI) * 0.2 + flap * t * 0.5;
        mark(side * rootX, rootZ, side < 0 ? '\\' : '/', FIRE);
        mark(side * (rootX + 0.15), rootZ - 0.4 - t * 0.27,
          side < 0 ? '\\' : '/', FIRE, 0.8);
      }
    }

    // Three long tail plumes and drifting feather tips make a wake rather
    // than the generic straight spark trail used by small fire missiles.
    for (const plume of [-1, 0, 1]) {
      for (let i = 0; i < 3; i++) {
        const t = (i + 1) / 3;
        mark(plume * t * 0.4 + Math.sin(age * 7 + t * 2) * t * 0.1,
          -0.35 - t * (plume === 0 ? 1.7 : 1.25), plume === 0 ? '|' : plume < 0 ? '/' : '\\',
          FIRE, 1 - t * 0.35);
      }
    }
    for (let i = 0; i < 8; i++) {
      const t = i / 7;
      const side = i % 2 ? 1 : -1;
      mark(side * (0.4 + t * 1.2) + Math.sin(age * 4 + i) * 0.12,
        -0.8 - t * 1.9 - (age * 0.7 % 0.45), i % 3 ? '.' : '*', EMBER, 0.62 - t * 0.33);
    }

    if (impact) {
      // The rebirth flare opens out from beneath the bird in eight broken
      // flame rays, while the lifted silhouette spreads to its widest span.
      for (let i = 0; i < 8; i++) {
        const angle = i * Math.PI / 4;
        for (let j = 0; j < 2; j++) {
          const radius = 0.7 + progress * 2.2 + j * 0.32;
          mark(Math.cos(angle) * radius, -0.55 + Math.sin(angle) * radius * 0.7,
            j ? '*' : '+', j ? FIRE : GOLD, 0.85 - j * 0.2);
        }
      }
    }
  },
  sounds: {
    cast: [
      { kind: 'noise', delay: 0, duration: 0.24, gain: 0.035, attack: 0.025, release: 0.17, cutoff: 900, filterType: 'bandpass' },
      { kind: 'noise', delay: 0.18, duration: 0.27, gain: 0.048, attack: 0.025, release: 0.19, cutoff: 1700, filterType: 'bandpass' },
      { kind: 'tone', delay: 0.31, duration: 0.23, gain: 0.075, attack: 0.035, release: 0.11, frequency: 780, endFrequency: 1280, type: 'sine' },
      { kind: 'tone', delay: 0.31, duration: 0.23, gain: 0.024, attack: 0.035, release: 0.11, frequency: 390, endFrequency: 640, type: 'triangle' },
      { kind: 'tone', delay: 0.59, duration: 0.31, gain: 0.07, attack: 0.04, release: 0.18, frequency: 1160, endFrequency: 1760, type: 'sine' },
      { kind: 'tone', delay: 0.92, duration: 0.065, gain: 0.025, attack: 0.005, release: 0.05, frequency: 2480, endFrequency: 1800, type: 'triangle' },
      { kind: 'tone', delay: 1.05, duration: 0.085, gain: 0.018, attack: 0.005, release: 0.065, frequency: 3120, endFrequency: 2100, type: 'sine' },
    ],
    impact: [
      { kind: 'noise', delay: 0, duration: 0.28, gain: 0.085, attack: 0.012, release: 0.23, cutoff: 1700, filterType: 'bandpass' },
      { kind: 'tone', delay: 0, duration: 0.34, gain: 0.06, attack: 0.012, release: 0.27, frequency: 220, endFrequency: 440, type: 'triangle' },
      { kind: 'tone', delay: 0.08, duration: 0.19, gain: 0.055, attack: 0.02, release: 0.14, frequency: 1040, endFrequency: 2080, type: 'sine' },
      { kind: 'tone', delay: 0.25, duration: 0.08, gain: 0.025, attack: 0.005, release: 0.06, frequency: 2600, endFrequency: 1600, type: 'triangle' },
      { kind: 'tone', delay: 0.37, duration: 0.07, gain: 0.018, attack: 0.005, release: 0.05, frequency: 3200, endFrequency: 2100, type: 'sine' },
      { kind: 'tone', delay: 0.52, duration: 0.1, gain: 0.015, attack: 0.005, release: 0.08, frequency: 2100, endFrequency: 1400, type: 'sine' },
    ],
    pulse: [
      { kind: 'noise', delay: 0, duration: 0.1, gain: 0.018, attack: 0.008, release: 0.075, cutoff: 2000, filterType: 'highpass' },
      { kind: 'tone', delay: 0.03, duration: 0.09, gain: 0.014, attack: 0.005, release: 0.07, frequency: 1660, endFrequency: 1320, type: 'sine' },
    ],
  },
};
