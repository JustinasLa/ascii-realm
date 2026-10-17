const ICE = [172, 237, 255];
const EDGE = [231, 253, 255];
const FROST = [77, 173, 218];
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function draw(effect, plot) {
  const life = Number.isFinite(effect.life) && effect.life > 0 ? effect.life : 1.15;
  const progress = clamp(Number.isFinite(effect.progress) ? effect.progress
    : (Number.isFinite(effect.age) ? effect.age / life : 0), 0, 1);
  const fade = Math.min(1, (1 - progress) * 4);
  if (fade === 0) return;
  const size = clamp(Number.isFinite(effect.radius) ? effect.radius : 1, 0.8, 3);
  const dot = (x, z, char, color = ICE, brightness = 1) => {
    plot(x * size, z * size, char, color, brightness * fade);
  };

  if (effect.stage === 'projectile') {
    // A little travelling comb keeps the wave identity even on a projectile.
    for (let tooth = -2; tooth <= 2; tooth++) {
      const x = tooth * 0.2, z = 0.23 - Math.abs(tooth) * 0.04;
      dot(x, z, '^', EDGE);
      dot(x - 0.07, z - 0.15, '/', ICE, 0.85);
      dot(x + 0.07, z - 0.15, '\\', ICE, 0.85);
    }
    for (let i = 0; i < 8; i++) {
      dot(Math.sin(i * 0.9 + progress * 7) * 0.16, -0.2 - i * 0.12,
        i % 3 === 0 ? '~' : '.', FROST, 0.65 - i * 0.055);
    }
    return;
  }

  if (effect.stage === 'impact') {
    // The crest collapses into separated plates, with widening breaks below.
    for (let shard = -4; shard <= 4; shard++) {
      const x = shard * (0.23 + progress * 0.23);
      const z = 0.2 + progress * (0.8 - Math.abs(shard) * 0.1);
      dot(x, z, shard % 2 === 0 ? '#' : '*', EDGE);
      dot(x - 0.09, z - 0.17, '/', ICE, 0.85);
      dot(x + 0.09, z - 0.17, '\\', ICE, 0.85);
      dot(x + shard * 0.04, z + 0.19 + progress * 0.2, "'", EDGE, 0.65);
    }
    for (const side of [-1, 1]) {
      for (let i = 0; i < 7; i++) {
        dot(side * (0.16 + i * 0.19 + progress * 0.35),
          -0.19 - (i % 2) * 0.12 - progress * 0.13,
          i % 2 ? '/' : '_', FROST, 0.7);
      }
    }
    for (let i = 0; i < 12; i++) {
      const angle = i * Math.PI / 6;
      const distance = 0.5 + progress * 1.1;
      dot(Math.cos(angle) * distance, Math.sin(angle) * distance * 0.5,
        '.', ICE, 0.45);
    }
    return;
  }

  // Three offset combs roll forward; their stagger prevents a flat grid.
  const front = 0.35 + progress * 2.4;
  for (let row = 0; row < 3; row++) {
    for (let tooth = -3; tooth <= 3; tooth++) {
      const position = (tooth + (row % 2) * 0.3) / 3;
      const x = position * (1.05 + row * 0.2);
      const z = front - row * 0.48 - Math.abs(position) * 0.24
        + Math.sin(progress * Math.PI * 2 + tooth * 0.9 + row) * 0.08;
      dot(x, z + 0.2, '^', EDGE, 1 - row * 0.16);
      dot(x - 0.11, z, '/', ICE, 0.9 - row * 0.14);
      dot(x + 0.11, z, '\\', ICE, 0.9 - row * 0.14);
    }
  }
  // A curling lip and low snow scrape follow both shoulders of the crest.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 8; i++) {
      const angle = i * 0.53 + progress * 2.4;
      dot(side * (1.48 + Math.cos(angle) * 0.24),
        front - 0.58 + Math.sin(angle) * 0.27,
        i < 5 ? '~' : ':', FROST, 0.72 - i * 0.045);
    }
  }
  for (let i = 0; i < 8; i++) {
    dot((i - 3.5) * 0.34, front - 1.2 - (i % 3) * 0.14,
      '.', ICE, 0.38);
  }
}

export default {
  id: 'ice-wave',
  duration: 1.15,
  draw,
  sounds: {
    cast: [
      { kind: 'noise', delay: 0, duration: 0.82, gain: 0.07, attack: 0.19, release: 0.36, cutoff: 2400, filterType: 'highpass' },
      { kind: 'noise', delay: 0.05, duration: 0.72, gain: 0.045, attack: 0.17, release: 0.3, cutoff: 470, filterType: 'lowpass' },
      { kind: 'tone', delay: 0.14, duration: 0.12, gain: 0.03, attack: 0.002, release: 0.1, frequency: 1760, endFrequency: 1510, type: 'triangle' },
      { kind: 'tone', delay: 0.27, duration: 0.1, gain: 0.034, attack: 0.002, release: 0.085, frequency: 1290, endFrequency: 1170, type: 'triangle' },
      { kind: 'tone', delay: 0.43, duration: 0.14, gain: 0.038, attack: 0.002, release: 0.12, frequency: 2180, endFrequency: 1840, type: 'triangle' },
      { kind: 'tone', delay: 0.62, duration: 0.11, gain: 0.027, attack: 0.002, release: 0.095, frequency: 1490, endFrequency: 1340, type: 'triangle' },
    ],
    impact: [
      { kind: 'noise', delay: 0, duration: 0.23, gain: 0.09, attack: 0.003, release: 0.2, cutoff: 4100, filterType: 'bandpass' },
      { kind: 'tone', delay: 0, duration: 0.28, gain: 0.055, attack: 0.004, release: 0.24, frequency: 196, endFrequency: 83, type: 'triangle' },
      { kind: 'tone', delay: 0.015, duration: 0.13, gain: 0.04, attack: 0.002, release: 0.115, frequency: 2700, endFrequency: 2340, type: 'triangle' },
      { kind: 'tone', delay: 0.085, duration: 0.16, gain: 0.033, attack: 0.002, release: 0.14, frequency: 1890, endFrequency: 1630, type: 'triangle' },
      { kind: 'tone', delay: 0.19, duration: 0.1, gain: 0.025, attack: 0.002, release: 0.085, frequency: 3180, endFrequency: 2780, type: 'triangle' },
    ],
    pulse: [
      { kind: 'noise', delay: 0, duration: 0.11, gain: 0.014, attack: 0.012, release: 0.08, cutoff: 2600, filterType: 'highpass' },
      { kind: 'tone', delay: 0.025, duration: 0.08, gain: 0.012, attack: 0.002, release: 0.065, frequency: 1470, endFrequency: 1320, type: 'triangle' },
    ],
  },
};
