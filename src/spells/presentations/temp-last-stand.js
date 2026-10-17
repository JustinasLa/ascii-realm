// A martial crest climbs out of its boot shockwave, then lands as a five-point crown.
const GOLD = [255, 205, 91];
const IVORY = [255, 239, 192];
const COPPER = [237, 128, 49];

function progress(effect) {
  const value = Number.isFinite(effect.progress) ? effect.progress
    : Number.isFinite(effect.age) && effect.life > 0 ? effect.age / effect.life : 0;
  return Math.max(0, Math.min(1, value));
}

function draw(effect, plot) {
  const p = progress(effect);
  const fade = Math.min(1, (1 - p) * 3);
  if (fade <= 0) return;
  const radius = Number.isFinite(effect.radius) ? effect.radius : 1;
  const size = Math.max(0.7, Math.min(2.6, radius * 0.45));
  const mark = (x, z, char, color = GOLD, brightness = 1) =>
    plot(x * size, z * size, char, color, brightness * fade);
  const ring = (r, z, strength = 1) => {
    for (let i = 0; i < 18; i++) {
      const a = i / 18 * Math.PI * 2;
      mark(Math.cos(a) * r, z + Math.sin(a) * r * 0.3, i % 3 ? '-' : '+', COPPER, strength);
    }
  };

  if (effect.stage === 'projectile') {
    // A compact sword carries two laurel shoulders; three dashes read as its wake.
    mark(0, 0.6, '^', IVORY);
    mark(0, 0.3, '|', IVORY);
    mark(0, 0, '+');
    mark(-0.24, 0.05, '/');
    mark(0.24, 0.05, '\\');
    mark(0, -0.25, '|');
    for (let i = 0; i < 3; i++) mark(0, -0.55 - i * 0.3 - p * 0.2, ':', COPPER, 0.6 - i * 0.14);
    return;
  }

  if (effect.stage === 'impact') {
    // The sword has landed: a low crown spreads on a stamped, elliptical shockwave.
    const spread = 0.65 + p * 1.1;
    ring(spread + 0.25, -0.5, 0.85);
    for (let i = 0; i < 5; i++) {
      const x = (i - 2) * spread * 0.45;
      const tip = i === 2 ? 0.7 : i % 2 ? 0.42 : 0.58;
      mark(x, tip * (1 - p * 0.25), '^', IVORY);
      mark(x - 0.13, -0.05, '/');
      mark(x + 0.13, -0.05, '\\');
      mark(x, -0.38, '=', GOLD, 0.9);
    }
    mark(0, -0.7, '+', IVORY);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        mark(side * (0.8 + p * 1.3 + i * 0.18), 0.15 + Math.sin(p * Math.PI) * (0.6 + i * 0.1), '.', COPPER, 0.7);
      }
    }
    return;
  }

  const quiet = effect.stage === 'aura' || effect.stage === 'zone' || effect.stage === 'pulse';
  const lift = quiet ? Math.sin(p * Math.PI * 2) * 0.08 : p * 0.9;
  ring(0.55 + p * 1.15, -0.85, quiet ? 0.35 : 0.7 * (1 - p * 0.5));

  // The six paired leaves form a visibly open laurel, with a straight sword inside.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const a = -0.8 + i * 0.36;
      const x = side * (0.5 + Math.cos(a) * 0.45);
      const z = Math.sin(a) * 0.95 + lift;
      mark(x, z, side < 0 ? '/' : '\\', GOLD, quiet ? 0.65 : 0.9);
      mark(x + side * 0.18, z + 0.15, side < 0 ? '\\' : '/', GOLD, quiet ? 0.5 : 0.75);
    }
  }
  for (let i = 0; i < 6; i++) mark(0, -0.55 + i * 0.24 + lift, '|', IVORY);
  mark(0, 1.05 + lift, '^', IVORY);
  mark(-0.25, -0.25 + lift, '-');
  mark(0, -0.25 + lift, '+', IVORY);
  mark(0.25, -0.25 + lift, '-');
  mark(0, -0.8 + lift, '*');
  if (!quiet) {
    for (let i = 0; i < 3; i++) {
      const z = -0.4 + i * 0.55 + p * 0.7;
      mark(-0.3, z, '/', COPPER, 0.6);
      mark(0, z + 0.2, '^', GOLD, 0.8);
      mark(0.3, z, '\\', COPPER, 0.6);
    }
  }
}

export default {
  id: 'temp-last-stand',
  duration: 1.45,
  draw,
  sounds: {
    cast: [
      { kind: 'tone', delay: 0, type: 'sawtooth', frequency: 98, endFrequency: 110, cutoff: 560, duration: 0.48, gain: 0.04, attack: 0.07, release: 0.16 },
      { kind: 'tone', delay: 0.04, type: 'triangle', frequency: 147, endFrequency: 147, duration: 0.34, gain: 0.035, attack: 0.04, release: 0.13 },
      { kind: 'tone', delay: 0.16, type: 'triangle', frequency: 196, endFrequency: 196, duration: 0.12, gain: 0.055, attack: 0.012, release: 0.06 },
      { kind: 'tone', delay: 0.27, type: 'triangle', frequency: 247, endFrequency: 247, duration: 0.12, gain: 0.05, attack: 0.012, release: 0.06 },
      { kind: 'tone', delay: 0.43, type: 'triangle', frequency: 294, endFrequency: 294, duration: 0.12, gain: 0.055, attack: 0.012, release: 0.06 },
      { kind: 'tone', delay: 0.54, type: 'triangle', frequency: 392, endFrequency: 392, duration: 0.19, gain: 0.045, attack: 0.012, release: 0.11 },
      { kind: 'noise', delay: 0.36, filterType: 'bandpass', cutoff: 1900, duration: 0.36, gain: 0.04, attack: 0.08, release: 0.17 },
    ],
    impact: [
      { kind: 'tone', delay: 0, type: 'sine', frequency: 92, endFrequency: 42, duration: 0.25, gain: 0.1, attack: 0.004, release: 0.2 },
      { kind: 'noise', delay: 0, filterType: 'lowpass', cutoff: 680, duration: 0.12, gain: 0.075, attack: 0.004, release: 0.1 },
      { kind: 'tone', delay: 0.015, type: 'triangle', frequency: 392, endFrequency: 294, duration: 0.17, gain: 0.028, attack: 0.003, release: 0.14 },
      { kind: 'tone', delay: 0.055, type: 'triangle', frequency: 588, endFrequency: 392, duration: 0.15, gain: 0.022, attack: 0.003, release: 0.12 },
      { kind: 'noise', delay: 0.11, filterType: 'lowpass', cutoff: 1200, duration: 0.1, gain: 0.023, attack: 0.008, release: 0.08 },
    ],
    pulse: [
      { kind: 'tone', delay: 0, type: 'triangle', frequency: 196, endFrequency: 147, duration: 0.1, gain: 0.015, attack: 0.012, release: 0.07 },
    ],
  },
};
