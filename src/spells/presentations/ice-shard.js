const ICE = [207, 249, 255];
const EDGE = [99, 210, 255];
const FROST = [119, 181, 220];
const RAYS = [[0, 1], [0.8660254, 0.5], [0.8660254, -0.5],
  [0, -1], [-0.8660254, -0.5], [-0.8660254, 0.5]];

function bounded(value, fallback, min, max) {
  const number = Number.isFinite(value) ? value : Number.isFinite(fallback) ? fallback : min;
  return Math.max(min, Math.min(max, number));
}

export default {
  id: 'ice-shard',
  duration: 0.86,
  draw(effect, plot) {
    const life = bounded(effect.life, 0.86, 0.001, 60);
    const progress = bounded(effect.progress, (effect.age ?? 0) / life, 0, 1);
    if (progress >= 1) return;
    const fade = (1 - progress) ** 0.72;
    const impact = ['impact', 'pulse', 'zone'].includes(effect.stage);

    if (impact) {
      // Six individual jagged cracks, each with a side branch and flying chip.
      const spread = bounded(effect.radius, 2, 0.4, 3) * (0.24 + progress * 0.91);
      const kinks = [0, 0.045, -0.07, 0.035, 0];
      for (let ray = 0; ray < RAYS.length; ray++) {
        const [x, z] = RAYS[ray];
        const handedness = ray % 2 ? 1 : -1;
        for (let step = 0; step < kinks.length; step++) {
          const distance = (0.16 + step * 0.18) * spread;
          const kink = kinks[step] * spread * handedness;
          plot(x * distance - z * kink, z * distance + x * kink,
            step === 4 ? '+' : ray % 3 === 0 ? '|' : x * z > 0 ? '/' : '\\',
            step === 4 ? ICE : EDGE, fade);
        }
        plot((x * 0.52 - z * 0.17 * handedness) * spread,
          (z * 0.52 + x * 0.17 * handedness) * spread, '-', EDGE, fade * 0.7);
        const chip = spread * (1.04 + progress * 0.2);
        plot(x * chip - z * 0.06, z * chip + x * 0.06, '/', ICE, fade * 0.75);
        plot(x * chip + z * 0.06, z * chip - x * 0.06, '\\', EDGE, fade * 0.65);
      }
      plot(-0.1 * spread, 0, '<', ICE, fade);
      plot(0.1 * spread, 0, '>', ICE, fade);
      return;
    }

    const projectile = effect.stage === 'projectile';
    const size = projectile ? 0.49 : (0.48 + Math.min(1, progress * 2.8) * 0.5)
      * bounded(effect.radius, 0.8, 0.55, 1.2);
    const diamond = [[0, 1.1], [0.43, 0], [0, -0.78], [-0.43, 0]];
    const line = (start, end, char, color, light = 1) => {
      for (let step = 0; step < 5; step++) {
        const t = step / 4;
        plot((start[0] + (end[0] - start[0]) * t) * size,
          (start[1] + (end[1] - start[1]) * t) * size, char, color, fade * light);
      }
    };
    for (let edge = 0; edge < diamond.length; edge++) {
      line(diamond[edge], diamond[(edge + 1) % diamond.length],
        edge % 2 ? '/' : '\\', ICE);
    }
    // Crossed facets distinguish the solid diamond from its frost dust.
    line(diamond[0], diamond[2], '|', EDGE, 0.85);
    line(diamond[1], diamond[3], '-', EDGE, 0.75);
    for (const side of [-1, 1]) {
      for (let edge = 0; edge < 3; edge++) {
        const z = 0.57 - edge * 0.48;
        const x = side * (edge === 1 ? 0.43 : 0.24);
        plot(x * size, z * size, side < 0 ? '/' : '\\', EDGE, fade * 0.85);
        plot((x + side * 0.2) * size, (z + 0.1) * size, '*', ICE, fade);
      }
    }
    for (let mote = 0; mote < 10; mote++) {
      const drift = (progress * 1.9 + mote * 0.13) % 0.34;
      const x = Math.sin(mote * 2.4) * (0.09 + mote * 0.018);
      plot(x * size, (-0.9 - mote * 0.14 - drift) * size, '.', FROST,
        fade * (0.56 - mote * 0.043));
    }
    plot(0, 1.1 * size, '*', ICE, fade);
  },
  sounds: {
    cast: [
      { kind: 'tone', type: 'sine', delay: 0, duration: 0.11, gain: 0.055,
        attack: 0.001, release: 0.095, frequency: 2840, endFrequency: 2160 },
      { kind: 'tone', type: 'triangle', delay: 0.022, duration: 0.066, gain: 0.018,
        attack: 0.001, release: 0.06, frequency: 4320, endFrequency: 3160 },
      { kind: 'tone', type: 'sine', delay: 0.07, duration: 0.3, gain: 0.035,
        attack: 0.045, release: 0.12, frequency: 980, endFrequency: 1830 },
      { kind: 'noise', delay: 0.09, duration: 0.16, gain: 0.018,
        attack: 0.025, release: 0.11, filterType: 'highpass', cutoff: 5900 },
    ],
    impact: [
      { kind: 'noise', delay: 0, duration: 0.075, gain: 0.07,
        attack: 0.001, release: 0.065, filterType: 'highpass', cutoff: 6800 },
      { kind: 'tone', type: 'sine', delay: 0.006, duration: 0.13, gain: 0.04,
        attack: 0.001, release: 0.12, frequency: 3200, endFrequency: 1320 },
      { kind: 'tone', type: 'sine', delay: 0.021, duration: 0.09, gain: 0.025,
        attack: 0.001, release: 0.08, frequency: 4720, endFrequency: 2270 },
      { kind: 'tone', type: 'triangle', delay: 0.044, duration: 0.1, gain: 0.025,
        attack: 0.001, release: 0.09, frequency: 2170, endFrequency: 880 },
      { kind: 'noise', delay: 0.081, duration: 0.1, gain: 0.026,
        attack: 0.001, release: 0.09, filterType: 'highpass', cutoff: 4100 },
      { kind: 'tone', type: 'sine', delay: 0.128, duration: 0.17, gain: 0.018,
        attack: 0.001, release: 0.16, frequency: 1650, endFrequency: 1510 },
    ],
  },
};
