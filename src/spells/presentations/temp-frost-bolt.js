const CORE = [223, 249, 255];
const RIB = [132, 215, 255];
const BLUE = [66, 131, 246];
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function comet(plot, progress, age, radius, projectile, fade) {
  const scale = projectile ? 0.6 : (0.62 + progress * 0.4) * radius;
  const advance = projectile ? 0 : progress * 0.55;
  const point = (x, z, char, color, light = 1) =>
    plot(x * scale, (z + advance) * scale, char, color, fade * light);

  // The narrow bright keel and pointed nose remain legible between the ribs.
  for (let i = 0; i < 10; i++) point(0, 0.88 - i * 0.23, '|', i < 4 ? CORE : BLUE, 1 - i * 0.045);
  point(0, 1.22, '^', CORE);
  point(-0.17, 0.95, '/', CORE);
  point(0.17, 0.95, '\\', CORE);

  // Five disconnected, backward-swept frost ribs give this bolt its fluting.
  for (let rib = 0; rib < 5; rib++) {
    const z = 0.67 - rib * 0.42;
    const width = 0.32 + Math.sin((rib + 1) / 6 * Math.PI) * 0.25;
    const flex = Math.sin(age * 19 - rib * 0.8) * 0.035;
    for (const side of [-1, 1]) {
      point(side * (width + flex), z, side < 0 ? '[' : ']', RIB, 0.9);
      point(side * (width * 0.66 + flex), z - 0.18, side < 0 ? '\\' : '/', RIB, 0.75);
      point(side * (width * 0.3), z - 0.28, '.', BLUE, 0.65);
    }
  }

  // A thin blue vapour tail streams behind the last rib rather than a halo.
  for (let i = 0; i < 8; i++) {
    const drift = Math.sin(age * 15 - i * 1.2) * (0.05 + i * 0.026);
    point(drift, -1.6 - i * 0.2, i % 3 === 0 ? ':' : '.', BLUE, 0.62 - i * 0.055);
  }
}

function snappedRibs(plot, progress, radius, fade) {
  const spread = radius * (0.18 + progress * 1.6);
  // The same rib pairs snap apart, leaving a fractured seam between them.
  for (let rib = 0; rib < 5; rib++) {
    const z = (rib - 2) * radius * 0.34;
    const bow = 1 - Math.abs(rib - 2) * 0.16;
    for (const side of [-1, 1]) {
      const x = side * spread * bow;
      plot(x, z, side < 0 ? '[' : ']', RIB, fade * 0.9);
      plot(x + side * radius * 0.16, z - radius * 0.15, side < 0 ? '\\' : '/', BLUE, fade * 0.7);
      plot(x + side * radius * 0.25, z + radius * 0.16, '-', CORE, fade * 0.8);
    }
  }
  for (let i = 0; i < 9; i++) {
    const z = (i - 4) * radius * (0.16 + progress * 0.11);
    const x = (i % 2 ? -1 : 1) * radius * 0.09 * (1 - progress);
    plot(x, z, i % 2 ? '/' : '\\', CORE, fade * (1 - progress * 0.6));
  }
  for (let i = 0; i < 8; i++) {
    const side = i % 2 ? -1 : 1;
    const x = side * radius * (0.55 + progress * (1.2 + i * 0.035));
    const z = (Math.floor(i / 2) - 1.5) * radius * (0.4 + progress * 0.55);
    plot(x, z, i % 3 === 0 ? 'x' : "'", i % 2 ? RIB : CORE, fade * 0.65);
  }
}

export default {
  id: 'temp-frost-bolt',
  duration: 0.85,
  draw(effect, plot) {
    const age = Number.isFinite(effect.age) ? Math.max(0, effect.age) : 0;
    const life = Number.isFinite(effect.life) && effect.life > 0 ? effect.life : 1;
    const progress = clamp(Number.isFinite(effect.progress) ? effect.progress : age / life, 0, 1);
    const radius = clamp(Number.isFinite(effect.radius) ? effect.radius : 1, 0.45, 2.5);
    const fade = Math.min(1, (1 - progress) * 4);
    if (fade <= 0) return;
    if (effect.stage === 'cast' || effect.stage === 'projectile') {
      comet(plot, progress, age, radius, effect.stage === 'projectile', fade);
    } else {
      snappedRibs(plot, progress, radius, fade);
    }
  },
  sounds: {
    cast: [
      // A plucked icy string snaps, then releases a falling cold-air whistle.
      { kind: 'tone', type: 'triangle', delay: 0, duration: 0.09, gain: 0.072, attack: 0.002, release: 0.078, frequency: 1180, endFrequency: 280 },
      { kind: 'noise', delay: 0, duration: 0.035, gain: 0.038, attack: 0.001, release: 0.03, cutoff: 4200, filterType: 'highpass' },
      { kind: 'tone', type: 'sine', delay: 0.015, duration: 0.11, gain: 0.026, attack: 0.002, release: 0.1, frequency: 1880, endFrequency: 1080 },
      { kind: 'tone', type: 'sine', delay: 0.055, duration: 0.43, gain: 0.043, attack: 0.025, release: 0.22, frequency: 1540, endFrequency: 430 },
      { kind: 'noise', delay: 0.065, duration: 0.28, gain: 0.025, attack: 0.025, release: 0.18, cutoff: 2100, filterType: 'bandpass' },
    ],
    impact: [
      // A low crystal crunch is followed by two unevenly spaced frozen chips.
      { kind: 'noise', delay: 0, duration: 0.15, gain: 0.084, attack: 0.002, release: 0.12, cutoff: 1200, filterType: 'bandpass' },
      { kind: 'tone', type: 'triangle', delay: 0, duration: 0.19, gain: 0.061, attack: 0.002, release: 0.17, frequency: 410, endFrequency: 105 },
      { kind: 'tone', type: 'triangle', delay: 0.025, duration: 0.12, gain: 0.032, attack: 0.001, release: 0.11, frequency: 690, endFrequency: 420 },
      { kind: 'tone', type: 'sine', delay: 0.085, duration: 0.13, gain: 0.024, attack: 0.001, release: 0.12, frequency: 850, endFrequency: 350 },
      { kind: 'noise', delay: 0.085, duration: 0.08, gain: 0.028, attack: 0.001, release: 0.07, cutoff: 2400, filterType: 'highpass' },
    ],
  },
};
