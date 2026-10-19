// Seven small plates lock into a bowed shield; no world-space heading is applied here.
const ICE = [131, 216, 250];
const FROST = [221, 249, 255];
const SEAM = [78, 164, 220];
const PLATES = [
  [0, 0, 0],
  [-0.537, 0, 0.055], [0.537, 0, 0.055],
  [-0.2685, -0.465, 0.12], [0.2685, -0.465, 0.12],
  [-0.2685, 0.465, 0.18], [0.2685, 0.465, 0.18],
];
const RIM = [
  [-0.98, -0.6], [-0.64, -0.91], [0, -1], [0.64, -0.91],
  [0.98, -0.6], [1.04, -0.15], [0.96, 0.3], [0.66, 0.72],
  [0.34, 0.99], [0, 1.17], [-0.34, 0.99], [-0.66, 0.72],
  [-0.96, 0.3], [-1.04, -0.15],
];
const CORNERS = ['^', '/', '\\', 'v', '/', '\\'];
const clamp = value => Math.max(0, Math.min(1, value));

function draw(effect, plot) {
  const age = Number.isFinite(effect.age) ? effect.age : 0;
  const rawProgress = Number.isFinite(effect.progress) ? effect.progress
    : Number.isFinite(effect.life) && effect.life > 0 ? age / effect.life : 0;
  const p = clamp(rawProgress);
  const fade = Math.min(1, p / 0.08, (1 - p) / 0.24);
  if (fade <= 0) return;
  const radius = Math.max(0.55, Math.min(2.4, Number.isFinite(effect.radius) ? effect.radius : 1.4));
  const stage = effect.stage ?? 'cast';

  if (stage === 'projectile') {
    // A single plate carries the same six-sided silhouette with a snow-dust wake.
    const size = Math.min(0.45, radius * 0.38);
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 3;
      plot(Math.cos(a) * size, Math.sin(a) * size, CORNERS[i], FROST, fade);
      const b = a + Math.PI / 6;
      plot(Math.cos(b) * size * 0.866, Math.sin(b) * size * 0.866, i % 3 === 1 ? '-' : ':', ICE, fade * 0.72);
    }
    plot(0, 0, 'o', FROST, fade);
    for (let i = 1; i <= 5; i++) {
      plot((i % 2 ? 1 : -1) * 0.045, -size - i * 0.17, '.', ICE, fade * (0.48 - i * 0.065));
    }
    return;
  }

  const impact = stage === 'impact';
  const assembling = stage === 'cast';
  // Bow the sides backward, keeping a broad crown and a pointed lower rim.
  const put = (x, z, char, color, brightness) =>
    plot(x * radius, (z - 0.12 * x * x) * radius, char, color, clamp(brightness * fade));
  const recoil = impact ? 1 - 0.1 * Math.sin(p * Math.PI) : 1;
  for (const [cx, cz, delay] of PLATES) {
    const lock = assembling ? clamp((p - delay) / 0.22) : 1;
    if (lock <= 0) continue;
    const spread = 1 + (1 - lock) * 0.7;
    const x = cx * spread;
    const z = cz * spread * recoil;
    const size = 0.31 * (0.3 + lock * 0.7);
    const shimmer = 0.7 + 0.13 * Math.cos(age * 5 + cx * 6 - cz * 4);
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 3;
      put(x + Math.cos(a) * size, z + Math.sin(a) * size * recoil,
        CORNERS[i], ICE, shimmer * lock);
      if (i % 2 === 0) {
        const b = a + Math.PI / 6;
        put(x + Math.cos(b) * size * 0.866, z + Math.sin(b) * size * 0.866 * recoil,
          i === 2 ? '-' : ':', SEAM, lock * 0.66);
      }
    }
    put(x, z, 'o', FROST, lock * (impact ? 0.45 : 0.82));
  }

  const rimLock = assembling ? clamp((p - 0.19) / 0.24) : 1;
  for (let i = 0; i < RIM.length; i++) {
    const [x, z] = RIM[i];
    const glint = 0.62 + 0.25 * Math.max(0, Math.cos(i * 0.9 - age * 7));
    put(x, z * recoil, i === 2 ? '^' : i === 9 ? 'v' : '*', FROST, glint * rimLock);
  }

  if (impact) {
    // Three uneven stress cracks branch from the contact, leaving the plates intact.
    for (let arm = 0; arm < 3; arm++) {
      const angle = [-1.32, 0.68, 2.8][arm];
      for (let step = 0; step < 4; step++) {
        const distance = (0.08 + step * 0.17) * (0.5 + p * 0.8);
        const kink = step % 2 ? 0.045 : -0.025;
        put(Math.cos(angle) * distance + kink, Math.sin(angle) * distance,
          step === 0 ? 'x' : arm === 0 ? '|' : arm === 1 ? '\\' : '/', FROST, 1 - p * 0.4);
      }
    }
  }
}

export default {
  id: 'ice-shield',
  duration: 1.18,
  draw,
  sounds: {
    cast: [
      { kind: 'tone', delay: 0, duration: 0.78, gain: 0.046, attack: 0.045, release: 0.46, frequency: 493.88, endFrequency: 523.25, type: 'sine' },
      { kind: 'tone', delay: 0.09, duration: 0.82, gain: 0.036, attack: 0.055, release: 0.5, frequency: 622.25, endFrequency: 659.25, type: 'triangle', cutoff: 2800 },
      { kind: 'tone', delay: 0.18, duration: 0.88, gain: 0.027, attack: 0.065, release: 0.56, frequency: 739.99, endFrequency: 783.99, type: 'sine' },
      { kind: 'noise', delay: 0.04, duration: 0.38, gain: 0.024, attack: 0.07, release: 0.22, cutoff: 4300, filterType: 'highpass' },
      { kind: 'tone', delay: 0.22, duration: 0.92, gain: 0.028, attack: 0.08, release: 0.62, frequency: 261.63, endFrequency: 262.5, type: 'sine' },
    ],
    impact: [
      { kind: 'tone', delay: 0, duration: 0.72, gain: 0.075, attack: 0.008, release: 0.61, frequency: 220, endFrequency: 215, type: 'sine' },
      { kind: 'tone', delay: 0.012, duration: 0.56, gain: 0.034, attack: 0.006, release: 0.49, frequency: 354.2, endFrequency: 349.8, type: 'sine' },
      { kind: 'tone', delay: 0.035, duration: 0.34, gain: 0.02, attack: 0.005, release: 0.28, frequency: 580.8, endFrequency: 575, type: 'triangle', cutoff: 2200 },
      { kind: 'noise', delay: 0, duration: 0.11, gain: 0.021, attack: 0.005, release: 0.09, cutoff: 5400, filterType: 'highpass' },
    ],
    pulse: [
      { kind: 'tone', delay: 0, duration: 0.18, gain: 0.012, attack: 0.018, release: 0.14, frequency: 1046.5, endFrequency: 988, type: 'sine' },
      { kind: 'tone', delay: 0.045, duration: 0.21, gain: 0.009, attack: 0.02, release: 0.17, frequency: 523.25, type: 'sine' },
    ],
  },
};
