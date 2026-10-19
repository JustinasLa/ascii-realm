const ICE = [206, 250, 255];
const EDGE = [112, 202, 242];
const DUST = [145, 224, 245];

// Uneven spacing makes the volley read as separate needles rather than a wall.
const LANES = [
  [-0.76, 0], [0.3, 0.13], [-0.24, 0.29], [0.8, 0.43], [0.04, 0.62],
];

function quill(plot, x, z, length, light) {
  plot(x, z, 'v', ICE, light);
  for (let step = 1; step <= 3; step++) {
    plot(x, z - length * step / 3, '|', step === 1 ? ICE : EDGE, light);
  }
  plot(x - 0.11, z - length * 0.65, '/', EDGE, light * 0.8);
  plot(x + 0.11, z - length * 0.65, '\\', EDGE, light * 0.8);
}

function draw(effect, plot) {
  const raw = Number.isFinite(effect.progress) ? effect.progress
    : (Number.isFinite(effect.age) && effect.life > 0 ? effect.age / effect.life : 0);
  const progress = Math.max(0, Math.min(1, raw));
  if (progress >= 1) return;
  const fade = (1 - progress) ** 0.65;
  const radius = Number.isFinite(effect.radius) ? effect.radius : 1;
  const scale = Math.max(0.7, Math.min(1.25, radius));

  if (effect.stage === 'impact') {
    // Three offset contact points crack into short, angular crystal chips.
    const clusters = [[-0.46, -0.12], [0.06, 0.17], [0.53, -0.05]];
    const chips = [[-0.55, -0.35, '\\'], [0.4, -0.52, '/'], [0.58, 0.23, '-'], [-0.18, 0.54, '|']];
    for (let index = 0; index < clusters.length; index++) {
      const age = progress - index * 0.055;
      if (age < 0) continue;
      const [cx, cz] = clusters[index];
      const spread = 0.13 + age * 0.85;
      plot(cx * scale, cz * scale, '*', ICE, fade);
      for (const [dx, dz, glyph] of chips) {
        plot((cx + dx * spread) * scale, (cz + dz * spread) * scale, glyph, ICE, fade);
        plot((cx + dx * spread * 1.55) * scale, (cz + dz * spread * 1.55) * scale, '.', DUST, fade * 0.55);
      }
    }
    return;
  }

  if (effect.stage === 'projectile') {
    // A single long needle and two offset pinpoints keep flight compact.
    quill(plot, 0, 0.33, 0.79, fade);
    plot(-0.23, -0.08, '|', EDGE, fade * 0.65);
    plot(0.23, -0.26, 'v', ICE, fade * 0.7);
    plot(-0.04, -0.79, ':', DUST, fade * 0.6);
    plot(0.06, -1.03, '.', DUST, fade * 0.35);
    plot(progress < 0.5 ? -0.18 : 0.18, -0.2, '+', ICE, fade * 0.85);
    return;
  }

  // Cast, pulse, aura and zone share the staggered ascending volley motif.
  for (let index = 0; index < LANES.length; index++) {
    const [lane, start] = LANES[index];
    const flight = (progress - start) / 0.37;
    if (flight < 0 || flight > 1) continue;
    const x = lane * scale;
    const z = (-0.35 + flight * 2.05) * scale;
    const light = fade * (1 - flight * 0.5);
    quill(plot, x, z, 0.72 * scale, light);
    const side = index % 2 === 0 ? -1 : 1;
    const glyph = (Math.floor(flight * 5) + index) % 2 === 0 ? '+' : '*';
    plot(x + side * 0.22 * scale, z - 0.24 * scale, glyph, ICE, light * 0.9);
    plot(x, z - 1.03 * scale, ':', DUST, light * 0.45);
  }
}

export default {
  id: 'temp-icicle-blitz',
  duration: 1.02,
  draw,
  sounds: {
    cast: [
      { kind: 'tone', delay: 0, duration: 0.08, gain: 0.045, attack: 0.002, release: 0.065, frequency: 1820, endFrequency: 1680, type: 'triangle' },
      { kind: 'noise', delay: 0.025, duration: 0.065, gain: 0.026, attack: 0.006, release: 0.045, cutoff: 4200, filterType: 'highpass' },
      { kind: 'tone', delay: 0.061, duration: 0.075, gain: 0.039, attack: 0.002, release: 0.06, frequency: 2460, endFrequency: 2220, type: 'sine' },
      { kind: 'tone', delay: 0.155, duration: 0.09, gain: 0.047, attack: 0.002, release: 0.07, frequency: 2160, endFrequency: 2050, type: 'triangle' },
      { kind: 'noise', delay: 0.178, duration: 0.08, gain: 0.023, attack: 0.008, release: 0.055, cutoff: 4900, filterType: 'highpass' },
      { kind: 'tone', delay: 0.229, duration: 0.065, gain: 0.037, attack: 0.001, release: 0.05, frequency: 3020, endFrequency: 2710, type: 'sine' },
      { kind: 'noise', delay: 0.303, duration: 0.075, gain: 0.028, attack: 0.005, release: 0.055, cutoff: 3500, filterType: 'highpass' },
      { kind: 'tone', delay: 0.346, duration: 0.105, gain: 0.043, attack: 0.002, release: 0.085, frequency: 2640, endFrequency: 2310, type: 'triangle' },
    ],
    impact: [
      { kind: 'noise', delay: 0, duration: 0.115, gain: 0.072, attack: 0.001, release: 0.1, cutoff: 2900, filterType: 'bandpass' },
      { kind: 'tone', delay: 0.012, duration: 0.065, gain: 0.035, attack: 0.001, release: 0.055, frequency: 1460, endFrequency: 960, type: 'triangle' },
      { kind: 'noise', delay: 0.043, duration: 0.055, gain: 0.032, attack: 0.001, release: 0.045, cutoff: 5900, filterType: 'highpass' },
      { kind: 'tone', delay: 0.072, duration: 0.09, gain: 0.022, attack: 0.001, release: 0.08, frequency: 3330, endFrequency: 2280, type: 'sine' },
    ],
    pulse: [
      { kind: 'tone', delay: 0, duration: 0.055, gain: 0.018, attack: 0.002, release: 0.045, frequency: 2380, endFrequency: 2100, type: 'sine' },
      { kind: 'noise', delay: 0.018, duration: 0.045, gain: 0.012, attack: 0.002, release: 0.035, cutoff: 4700, filterType: 'highpass' },
    ],
  },
};
