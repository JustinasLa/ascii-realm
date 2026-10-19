const CORE = [255, 225, 133];
const FLAME = [255, 131, 34];
const EMBER = [226, 67, 22];
const ASH = [143, 100, 75];
const LANES = [-1, -0.67, -0.34, 0, 0.34, 0.67, 1];
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;

// Local +z is the breath direction. The renderer supplies the world rotation.
function draw(effect, plot) {
  const age = Math.max(0, finite(effect.age, 0));
  const life = Math.max(0.01, finite(effect.life, 1.08));
  const progress = clamp(finite(effect.progress, age / life), 0, 1);
  const fade = Math.min(1, 0.18 + progress * 12) * Math.pow(1 - progress, 0.65);
  if (fade <= 0) return;
  const radius = clamp(finite(effect.radius, 1), 0.2, 6);
  const ink = (x, z, char, color, level = 1) => plot(x, z, char, color, clamp(fade * level, 0, 1));

  if (effect.stage === 'projectile') {
    // A small split flame tip with an unbroken, cooling tail.
    ink(0, 0.38, '^', CORE);
    ink(-0.18, 0.16, '/', FLAME);
    ink(0.18, 0.16, '\\', FLAME);
    for (let i = 0; i < 7; i++) {
      const sway = Math.sin(age * 22 - i * 0.9) * 0.09 * (i + 1) / 7;
      ink(sway, -i * 0.16, i < 2 ? '~' : '.', i < 3 ? FLAME : EMBER, 0.85 - i * 0.09);
    }
    return;
  }

  if (effect.stage === 'impact' || effect.stage === 'pulse' || effect.stage === 'aura') {
    const small = effect.stage !== 'impact';
    const reach = (small ? 0.7 : Math.min(1.8, radius)) * (0.35 + progress * 0.9);
    // Broken, curling tongues leave a charred scatter instead of a circular flash.
    for (let i = 0; i < 9; i++) {
      const angle = -1.35 + i * 0.3375;
      const bend = Math.sin(age * 19 + i * 1.7) * 0.12;
      for (let j = 1; j <= 3; j++) {
        const distance = reach * j / 3;
        ink(Math.sin(angle + bend * j) * distance,
          Math.cos(angle) * distance - reach * 0.25,
          j === 3 ? "'" : j === 2 ? '^' : '~', j === 1 ? CORE : FLAME, 1 - j * 0.12);
      }
      const scatter = reach * (0.7 + (i % 3) * 0.17);
      ink(Math.sin(i * 2.4) * scatter, Math.cos(i * 2.4) * scatter,
        i % 2 ? '.' : ',', progress > 0.4 ? ASH : EMBER, 0.6);
    }
    return;
  }

  const expansion = 0.25 + 0.75 * (1 - Math.pow(1 - progress, 3));
  const length = (effect.stage === 'zone' ? Math.min(6, radius * 2) : 6) * expansion;
  // Seven separately authored lanes keep negative space between licking tongues.
  for (let lane = 0; lane < LANES.length; lane++) {
    const side = LANES[lane];
    const tip = length * (0.84 + (lane % 3) * 0.08);
    for (let segment = 1; segment <= 8; segment++) {
      const t = segment / 8;
      const z = 0.15 + tip * t;
      const curl = Math.sin(age * 19 - segment * 0.95 + lane * 1.4) * 0.13 * t;
      const x = side * z * 0.72 + curl;
      const char = segment === 8 ? '^' : segment % 3 === 0 ? '*' : '~';
      ink(x, z, char, segment < 3 ? CORE : segment < 7 ? FLAME : EMBER, 1 - t * 0.26);
    }
  }
  // Rolling heat combs travel between the flame lanes rather than outlining a disk.
  for (let comb = 0; comb < 3; comb++) {
    const travel = (progress * 1.8 + comb / 3) % 1;
    const z = 0.4 + travel * length;
    for (let tooth = -2; tooth <= 2; tooth++) {
      ink(tooth * z * 0.27, z + Math.abs(tooth) * 0.06, '-', CORE, 0.3 + travel * 0.2);
    }
  }
  for (let i = 0; i < 8; i++) {
    const z = length * (0.3 + i * 0.08);
    ink(Math.sin(i * 3.7) * z * 0.62, z, i % 2 ? ',' : '.', ASH, 0.42);
  }
}

export default {
  id: 'fire-breath',
  duration: 1.08,
  draw,
  sounds: {
    cast: [
      { kind: 'noise', delay: 0, duration: 0.19, gain: 0.035, attack: 0.04, release: 0.09, cutoff: 640, filterType: 'highpass' },
      { kind: 'tone', delay: 0.04, duration: 0.83, gain: 0.065, attack: 0.12, release: 0.28, frequency: 87, endFrequency: 54, type: 'triangle', cutoff: 230 },
      { kind: 'noise', delay: 0.1, duration: 0.56, gain: 0.085, attack: 0.09, release: 0.24, cutoff: 1050, filterType: 'lowpass' },
      { kind: 'noise', delay: 0.27, duration: 0.57, gain: 0.065, attack: 0.08, release: 0.3, cutoff: 1550, filterType: 'bandpass' },
      { kind: 'noise', delay: 0.46, duration: 0.51, gain: 0.045, attack: 0.05, release: 0.32, cutoff: 2200, filterType: 'lowpass' },
    ],
    impact: [
      { kind: 'noise', delay: 0, duration: 0.15, gain: 0.065, attack: 0.003, release: 0.12, cutoff: 2800, filterType: 'highpass' },
      { kind: 'noise', delay: 0.062, duration: 0.1, gain: 0.035, attack: 0.002, release: 0.085, cutoff: 3900, filterType: 'bandpass' },
      { kind: 'noise', delay: 0.145, duration: 0.09, gain: 0.027, attack: 0.002, release: 0.075, cutoff: 3200, filterType: 'highpass' },
      { kind: 'tone', delay: 0.015, duration: 0.19, gain: 0.026, attack: 0.003, release: 0.15, frequency: 132, endFrequency: 67, type: 'triangle' },
    ],
    pulse: [
      { kind: 'noise', delay: 0, duration: 0.1, gain: 0.018, attack: 0.003, release: 0.08, cutoff: 1900, filterType: 'bandpass' },
      { kind: 'noise', delay: 0.045, duration: 0.065, gain: 0.009, attack: 0.002, release: 0.05, cutoff: 2700, filterType: 'highpass' },
    ],
  },
};
