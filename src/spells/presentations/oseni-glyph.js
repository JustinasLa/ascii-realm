const TAU = Math.PI * 2;
const EMBER = [255, 90, 24];
const GOLD = [255, 187, 58];
const SEAL = [255, 232, 156];
const SPOKE = [[0.13, 0], [0.53, 0], [0.53, -0.24], [0.83, -0.24], [0.83, 0.04]];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// The three bent arms are a fire rune, rather than a circular area marker.
function draw(effect, plot) {
  const age = Number.isFinite(effect.age) ? Math.max(0, effect.age) : 0;
  const progress = clamp(Number.isFinite(effect.progress) ? effect.progress : 0, 0, 1);
  const fade = Math.min(1, (1 - progress) * 4);
  if (fade <= 0) return;
  const radius = clamp(Number.isFinite(effect.radius) ? effect.radius : 2, 0.4, 6);
  const stage = effect.stage;
  const rotation = age * (stage === 'cast' ? 0.85 : 0.38);
  const size = stage === 'projectile' ? 0.64
    : radius * (stage === 'cast' ? 0.3 + Math.min(1, progress * 1.7) * 0.7 : 1);

  const mark = (x, z, angle, char, color = GOLD, light = 1) => {
    const c = Math.cos(angle), s = Math.sin(angle);
    plot((x * c - z * s) * size, (x * s + z * c) * size,
      char, color, fade * light);
  };
  const stroke = (a, b, angle, char, color = GOLD, light = 1) => {
    for (let step = 0; step < 3; step++) {
      const t = step / 2;
      mark(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t,
        angle, char, color, light);
    }
  };

  if (stage === 'projectile') {
    // A pocket-sized pinwheel retains the three-arm identity while in flight.
    for (let arm = 0; arm < 3; arm++) {
      const angle = rotation + arm * TAU / 3;
      stroke([0.08, 0], [0.6, 0], angle, '-', SEAL);
      stroke([0.6, 0], [0.6, -0.3], angle, '+', EMBER, 0.85);
    }
    for (let spark = 0; spark < 5; spark++) {
      plot(Math.sin(age * 8 - spark) * 0.07, -0.25 - spark * 0.2,
        '.', EMBER, fade * (0.6 - spark * 0.09));
    }
    mark(0, 0, 0, '*', SEAL);
    return;
  }

  if (stage === 'impact') {
    // The sealed rune splits into three outward, forked fractures.
    const outward = progress * 0.65;
    for (let arm = 0; arm < 3; arm++) {
      const angle = -rotation + arm * TAU / 3;
      const root = [0.12 + outward, 0], tip = [0.65 + outward, 0];
      stroke(root, tip, angle, '#', SEAL);
      stroke(tip, [0.91 + outward, -0.2], angle, '/', GOLD, 0.9);
      stroke(tip, [0.91 + outward, 0.2], angle, '\\', EMBER, 0.8);
      for (let spark = 0; spark < 3; spark++) {
        mark(0.8 + outward + spark * 0.13, (spark - 1) * 0.2, angle,
          '*', EMBER, 0.7 - spark * 0.12);
      }
    }
    mark(0, 0, 0, '*', SEAL);
    return;
  }

  for (let arm = 0; arm < 3; arm++) {
    const angle = rotation + arm * TAU / 3;
    for (let segment = 0; segment < SPOKE.length - 1; segment++) {
      stroke(SPOKE[segment], SPOKE[segment + 1], angle,
        segment % 2 ? '|' : '-', segment === 0 ? SEAL : GOLD);
    }
    // An intersecting triangle and a short cross-stroke bind the arms together.
    stroke([0.34, -0.2], [-0.34, -0.2], angle, '/', EMBER, 0.8);
    stroke([0.4, -0.1], [0.4, 0.1], angle, '+', SEAL, 0.9);

    const orbit = angle + age * 0.9 + 0.45;
    mark(1.03, 0, orbit, '*', SEAL, 0.85);
    mark(1.05, -0.12, orbit, '.', EMBER, 0.55);
  }
}

export default {
  id: 'oseni-glyph',
  duration: 1.16,
  draw,
  sounds: {
    cast: [
      { kind: 'tone', type: 'triangle', frequency: 110, endFrequency: 82.4, delay: 0,
        duration: 1.1, gain: 0.045, attack: 0.1, release: 0.35, cutoff: 780 },
      { kind: 'tone', type: 'sine', frequency: 640, endFrequency: 620, delay: 0.14,
        duration: 0.14, gain: 0.04, attack: 0.003, release: 0.12 },
      { kind: 'tone', type: 'sine', frequency: 1043, endFrequency: 1010, delay: 0.14,
        duration: 0.12, gain: 0.018, attack: 0.002, release: 0.1 },
      { kind: 'tone', type: 'sine', frequency: 640, endFrequency: 620, delay: 0.4,
        duration: 0.14, gain: 0.04, attack: 0.003, release: 0.12 },
      { kind: 'tone', type: 'sine', frequency: 1043, endFrequency: 1010, delay: 0.4,
        duration: 0.12, gain: 0.018, attack: 0.002, release: 0.1 },
      { kind: 'tone', type: 'sine', frequency: 640, endFrequency: 620, delay: 0.66,
        duration: 0.14, gain: 0.04, attack: 0.003, release: 0.12 },
      { kind: 'tone', type: 'sine', frequency: 1043, endFrequency: 1010, delay: 0.66,
        duration: 0.12, gain: 0.018, attack: 0.002, release: 0.1 },
      { kind: 'tone', type: 'sine', frequency: 1280, endFrequency: 1600, delay: 0.92,
        duration: 0.44, gain: 0.045, attack: 0.008, release: 0.4 },
    ],
    impact: [
      { kind: 'tone', type: 'triangle', frequency: 165, endFrequency: 82.4, delay: 0,
        duration: 0.32, gain: 0.065, attack: 0.004, release: 0.28, cutoff: 950 },
      { kind: 'noise', filterType: 'bandpass', cutoff: 1700, delay: 0,
        duration: 0.075, gain: 0.035, attack: 0.002, release: 0.065 },
      { kind: 'tone', type: 'sine', frequency: 960, endFrequency: 880, delay: 0.035,
        duration: 0.4, gain: 0.045, attack: 0.003, release: 0.37 },
      { kind: 'tone', type: 'sine', frequency: 1564, endFrequency: 1434, delay: 0.035,
        duration: 0.28, gain: 0.018, attack: 0.002, release: 0.25 },
    ],
    pulse: [
      { kind: 'tone', type: 'triangle', frequency: 220, endFrequency: 165, delay: 0,
        duration: 0.12, gain: 0.012, attack: 0.006, release: 0.1, cutoff: 650 },
    ],
  },
};
