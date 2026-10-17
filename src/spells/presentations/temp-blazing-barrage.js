const EMBER = [255, 111, 30];
const CORE = [255, 234, 146];
const ASH = [166, 65, 37];
const SHOTS = [
  [-0.55, -0.20, 0.20], [0.55, 0.20, 0.35],
  [-1.15, -0.34, 0.50], [1.15, 0.34, 0.65],
  [-0.82, -0.13, 0.80], [0.82, 0.13, 0.95],
];
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

function draw(effect, plot) {
  const progress = clamp(Number.isFinite(effect.progress) ? effect.progress
    : (effect.age ?? 0) / Math.max(0.001, effect.life ?? 1.65), 0, 1);
  const fade = Math.min(1, (1 - progress) * 4);
  if (fade <= 0) return;
  const radius = clamp(Number.isFinite(effect.radius) ? effect.radius : 1, 0.7, 2.4);
  const point = (x, z, char, color = EMBER, light = 1) => plot(x, z, char, color, clamp(light * fade, 0, 1));

  // Forward is local +z; the runtime applies the caster/projectile heading.
  const bolt = (x, z, angle, light = 1) => {
    const sin = Math.sin(angle), cos = Math.cos(angle);
    const mark = (side, along, char, color, brightness = light) =>
      point(x + side * cos + along * sin, z - side * sin + along * cos, char, color, brightness);
    mark(0, 0.14, '*', CORE);
    mark(-0.10, -0.02, '/', EMBER);
    mark(0.10, -0.02, '\\', EMBER);
    mark(0, -0.23, ':', EMBER, light * 0.75);
    mark(0, -0.45, '.', ASH, light * 0.5);
  };

  const blast = (growth, light = 1) => {
    const reach = (0.45 + growth * 1.6) * radius;
    // Separate teeth along a broad bowed front, with short inward hot ribs.
    for (let i = 0; i <= 16; i++) {
      const a = -1.18 + i / 16 * 2.36;
      const x = Math.sin(a) * reach, z = Math.cos(a) * reach;
      point(x, z, i % 2 ? '^' : '*', i % 2 ? EMBER : CORE, light);
      if (i % 2 === 0) point(x * 0.76, z * 0.76, '|', EMBER, light * 0.7);
    }
    for (let i = 0; i < 8; i++) {
      const a = -1.35 + i / 7 * 2.7;
      point(Math.sin(a) * reach * 1.17, Math.cos(a) * reach * 1.17, '.', ASH, light * 0.5);
    }
  };

  if (effect.stage === 'projectile') {
    bolt(0, 0, 0);
    // Alternating side sparks make each moving fireball read as a volley round.
    const side = Math.sin(progress * Math.PI * 8) * 0.17;
    point(side, -0.65, '.', EMBER, 0.4);
    point(-side, -0.83, '.', ASH, 0.25);
    return;
  }

  if (effect.stage === 'cast') {
    const time = progress * 1.65;
    for (const [x, angle, delay] of SHOTS) {
      const shotAge = time - delay;
      const muzzleLight = shotAge >= 0 && shotAge < 0.14 ? 1 : 0.26;
      const sin = Math.sin(angle), cos = Math.cos(angle);
      for (const side of [-1, 1]) {
        point(x + side * 0.13 * cos, -side * 0.13 * sin, side < 0 ? '/' : '\\', EMBER, muzzleLight);
        point(x + side * 0.13 * cos - sin * 0.24, -side * 0.13 * sin - cos * 0.24, '#', ASH, muzzleLight * 0.7);
      }
      if (shotAge >= 0 && shotAge < 0.44) {
        const travel = 0.30 + shotAge * (4.5 + shotAge * 4);
        bolt(x + sin * travel, cos * travel, angle, 1 - shotAge * 0.8);
      }
    }
    // TF's six 3-tick-spaced shots resolve into a fireblast at 1.25 seconds.
    if (time >= 1.25) blast((time - 1.25) / 0.4, (1.65 - time) / 0.4);
    return;
  }

  if (effect.stage === 'impact') {
    blast(progress);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        point(side * (0.25 + i * 0.23) * (1 + progress),
          -0.20 - progress * (0.2 + i * 0.13), i % 2 ? ':' : '.', ASH, 0.65);
      }
    }
    return;
  }

  // Persistent/tick stages retain the six-barrel identity at a quieter scale.
  for (const [x, angle, delay] of SHOTS) {
    const flicker = 0.55 + Math.sin(progress * Math.PI * 6 - delay * 8) * 0.15;
    bolt(x * 0.7, 0.25 + progress * 0.6, angle, flicker);
  }
}

export default {
  id: 'temp-blazing-barrage',
  duration: 1.65,
  draw,
  sounds: {
    // The six clipped pitch drops follow the original 3-tick firing cadence.
    cast: [
      ...[280, 320, 260, 300, 240, 280].map((frequency, i) => ({
        kind: 'tone', type: i % 2 ? 'triangle' : 'square', delay: 0.20 + i * 0.15,
        frequency, endFrequency: 75 + i * 3, duration: 0.075, gain: 0.045,
        attack: 0.002, release: 0.060, cutoff: 1500,
      })),
      { kind: 'tone', type: 'triangle', delay: 1.25, frequency: 112, endFrequency: 38,
        duration: 0.30, gain: 0.095, attack: 0.004, release: 0.25, cutoff: 850 },
      { kind: 'noise', delay: 1.25, duration: 0.25, gain: 0.075,
        attack: 0.004, release: 0.22, filterType: 'lowpass', cutoff: 1700 },
    ],
    impact: [
      { kind: 'noise', delay: 0, duration: 0.065, gain: 0.055,
        attack: 0.002, release: 0.055, filterType: 'bandpass', cutoff: 2100 },
      { kind: 'tone', type: 'triangle', delay: 0.015, frequency: 150, endFrequency: 52,
        duration: 0.16, gain: 0.045, attack: 0.003, release: 0.14 },
      { kind: 'noise', delay: 0.08, duration: 0.14, gain: 0.025,
        attack: 0.004, release: 0.12, filterType: 'highpass', cutoff: 2600 },
    ],
  },
};
