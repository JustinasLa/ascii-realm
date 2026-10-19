const ICE = [125, 211, 244];
const EDGE = [220, 249, 255];
const FROST = [80, 157, 211];

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function progressOf(effect) {
  if (Number.isFinite(effect.progress)) return clamp(effect.progress, 0, 1);
  const life = Number.isFinite(effect.life) && effect.life > 0 ? effect.life : 1.15;
  return clamp((Number.isFinite(effect.age) ? effect.age : 0) / life, 0, 1);
}

function draw(effect, plot) {
  const p = progressOf(effect);
  if (p >= 1) return;
  const fade = Math.min(1, (1 - p) * 3);
  const stage = effect.stage ?? 'cast';
  const projectile = stage === 'projectile';
  const impact = stage === 'impact';
  const field = stage === 'zone' || stage === 'aura' || stage === 'pulse';
  const radius = Number.isFinite(effect.radius) ? clamp(effect.radius, 0.4, 4) : 2;
  const scale = projectile ? 0.38 : Math.max(0.65, radius * 0.65);
  const close = 1 - (1 - p) ** 2;
  const gap = projectile ? 0.12 : impact ? 0.24 - close * 0.18
    : field ? 0.2 + Math.sin(p * Math.PI * 2) * 0.05 : 0.9 - close * 0.74;
  const depth = impact ? 0.62 - close * 0.2 : 0.75;
  const height = projectile ? 0.9 : impact ? 0.95 - close * 0.24 : 1.18;
  const dot = (x, z, char, color = ICE, brightness = 1) =>
    plot(x * scale, z * scale, char, color, clamp(brightness * fade, 0, 1));

  // Open crescent palms close toward the target; the hooked ends point inward.
  const segments = projectile ? 6 : 12;
  for (const side of [-1, 1]) {
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments * 2 - 1) * 1.3;
      const x = side * (gap + Math.cos(angle) * depth);
      const z = Math.sin(angle) * height;
      const tip = i === 0 || i === segments;
      dot(x, z, tip ? '+' : side < 0 ? '(' : ')', tip ? EDGE : ICE);
      if (tip && !projectile) dot(x - side * 0.17, z * 0.91, '-', EDGE, 0.9);
    }
  }

  if (projectile) {
    // A little paired claw travels forward, with two tapered strands behind it.
    for (let i = 0; i < 4; i++) {
      const z = -0.9 - i * 0.55 - p * 0.2;
      for (const side of [-1, 1]) dot(side * (0.2 + i * 0.07), z, '.', FROST, 0.65 - i * 0.12);
    }
    return;
  }

  // Three flattened frost bands bind the field, rather than exploding outward.
  const bands = impact || field ? 3 : 1;
  const bandWidth = impact ? 0.95 - close * 0.5 : field ? 0.78 - close * 0.12 : 1.24 - close * 0.48;
  for (let band = 0; band < bands; band++) {
    const offset = (band - (bands - 1) / 2) * 0.45;
    for (let i = 0; i < 12; i++) {
      const angle = i / 12 * Math.PI * 2;
      dot(Math.cos(angle) * bandWidth, offset + Math.sin(angle) * 0.17,
        impact || field ? '=' : '-', band === 1 ? EDGE : FROST, 0.78);
    }
  }

  // Pinpoints visibly sink into the closing claws along fixed diagonal paths.
  for (let i = 0; i < 8; i++) {
    const angle = Math.PI / 8 + i / 8 * Math.PI * 2;
    const distance = (impact ? 1.3 : 1.9) - close * 0.7;
    dot(Math.cos(angle) * distance, Math.sin(angle) * distance, '.', EDGE, 0.72);
  }
  if (impact) {
    dot(0, 0, '+', EDGE);
    for (const side of [-1, 1]) {
      dot(side * 0.15, side * 0.15, '/', EDGE, 0.8);
      dot(side * 0.15, -side * 0.15, '\\', EDGE, 0.8);
    }
  }
}

export default {
  id: 'cold-embrace',
  duration: 1.15,
  draw,
  sounds: {
    cast: [
      { kind: 'noise', delay: 0, duration: 0.56, gain: 0.038, attack: 0.28, release: 0.22, cutoff: 1650, filterType: 'bandpass' },
      { kind: 'tone', delay: 0.10, duration: 0.42, gain: 0.045, attack: 0.015, release: 0.3, frequency: 1174.66, endFrequency: 880, type: 'sine' },
      { kind: 'tone', delay: 0.14, duration: 0.4, gain: 0.032, attack: 0.012, release: 0.3, frequency: 1760, endFrequency: 1320, type: 'triangle', cutoff: 2800 },
      { kind: 'tone', delay: 0.34, duration: 0.4, gain: 0.04, attack: 0.012, release: 0.3, frequency: 880, endFrequency: 587.33, type: 'sine' },
      { kind: 'tone', delay: 0.38, duration: 0.38, gain: 0.026, attack: 0.012, release: 0.28, frequency: 1320, endFrequency: 880, type: 'triangle', cutoff: 2200 },
    ],
    impact: [
      { kind: 'tone', delay: 0, duration: 0.32, gain: 0.055, attack: 0.006, release: 0.26, frequency: 1174.66, endFrequency: 587.33, type: 'sine' },
      { kind: 'tone', delay: 0.035, duration: 0.29, gain: 0.034, attack: 0.005, release: 0.23, frequency: 1568, endFrequency: 784, type: 'triangle', cutoff: 2400 },
      { kind: 'noise', delay: 0.16, duration: 0.075, gain: 0.05, attack: 0.002, release: 0.065, cutoff: 2500, filterType: 'highpass' },
      { kind: 'tone', delay: 0.18, duration: 0.21, gain: 0.035, attack: 0.003, release: 0.19, frequency: 220, endFrequency: 110, type: 'sine' },
    ],
    pulse: [
      { kind: 'tone', delay: 0, duration: 0.12, gain: 0.018, attack: 0.005, release: 0.1, frequency: 784, endFrequency: 659.25, type: 'sine' },
      { kind: 'tone', delay: 0.045, duration: 0.11, gain: 0.012, attack: 0.005, release: 0.09, frequency: 1046.5, endFrequency: 880, type: 'sine' },
    ],
  },
};
