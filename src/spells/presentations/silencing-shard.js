// A broken crystal carried inside a struck-through, closing sound ring.
const PURPLE = [157, 121, 191];
const EDGE = [220, 202, 237];
const DUSK = [115, 98, 150];
const TAU = Math.PI * 2;

function line(plot, x1, z1, x2, z2, count, char, color, brightness) {
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    plot(x1 + (x2 - x1) * t, z1 + (z2 - z1) * t, char, color, brightness);
  }
}

function ring(plot, radius, brightness, count = 24) {
  for (let i = 0; i < count; i++) {
    const angle = i / count * TAU;
    // Leave deliberate gaps where the muting slash cuts the sound wave.
    if (Math.abs(Math.sin(angle - Math.PI / 4)) < 0.2) continue;
    const x = Math.cos(angle), z = Math.sin(angle);
    const char = Math.abs(x) > 0.85 ? (x > 0 ? ')' : '(')
      : Math.abs(z) > 0.85 ? '-' : x * z > 0 ? '/' : '\\';
    plot(x * radius, z * radius, char, PURPLE, brightness);
  }
}

function crystal(plot, scale, split, brightness) {
  // The top and bottom are offset across a dark diagonal fracture.
  const point = (x, z) => [x * scale + (z > 0 ? split : -split), z * scale];
  const edge = (a, b, char, color = EDGE) => line(plot, ...point(...a), ...point(...b), 3, char, color, brightness);
  edge([0, 0.95], [-0.23, 0.22], '/');
  edge([0, 0.95], [0.23, 0.22], '\\');
  edge([-0.23, 0.22], [0.12, 0.1], '-', PURPLE);
  edge([-0.12, -0.1], [0.22, -0.22], '-', PURPLE);
  edge([-0.12, -0.1], [-0.22, -0.35], '\\');
  edge([-0.22, -0.35], [0, -0.78], '\\');
  edge([0.22, -0.22], [0, -0.78], '/');
  plot(...point(0.01, 0.5), '|', EDGE, brightness);
  plot(...point(-0.01, -0.46), '|', PURPLE, brightness);
}

function draw(effect, plot) {
  const p = Math.max(0, Math.min(1, Number.isFinite(effect.progress) ? effect.progress
    : (Number.isFinite(effect.age) && effect.life > 0 ? effect.age / effect.life : 0)));
  if (p >= 1) return;
  const fade = Math.pow(1 - p, 0.65);
  const radius = Math.max(0.5, Math.min(3, Number.isFinite(effect.radius) ? effect.radius : 1));

  if (effect.stage === 'projectile') {
    const flicker = 0.92 + Math.sin(p * TAU * 2) * 0.08;
    crystal(plot, 0.66, 0.045, fade * flicker);
    ring(plot, 0.58, fade * 0.68, 16);
    line(plot, -0.45, -0.45, 0.45, 0.45, 5, '/', EDGE, fade * 0.85);
    for (let i = 0; i < 6; i++) {
      const z = -0.95 - i * 0.27;
      plot(Math.sin(i * 1.8 + p * TAU) * 0.12, z, i % 2 ? '-' : '.', DUSK,
        fade * (0.44 - i * 0.055));
    }
    return;
  }

  if (effect.stage === 'cast' || !effect.stage) {
    const closing = (1.55 - p * 0.8) * Math.min(1.25, radius);
    const appear = Math.min(1, 0.35 + p * 8);
    ring(plot, closing, fade * appear * 0.9);
    line(plot, -closing * 0.8, -closing * 0.8, closing * 0.8, closing * 0.8,
      9, '/', EDGE, fade * appear);
    crystal(plot, 0.84 + p * 0.16, 0.15 * (1 - p), fade * appear);
    return;
  }

  // Impact snaps the slash into an X; lingering stages keep the closed seal.
  const impact = effect.stage === 'impact';
  const seal = (impact ? 0.75 + Math.sin(Math.min(1, p * 3) * Math.PI / 2) * 0.5 : 0.9)
    * Math.min(1.6, radius);
  ring(plot, seal * (1 - p * 0.22), fade * 0.7);
  line(plot, -seal * 0.65, -seal * 0.65, seal * 0.65, seal * 0.65, 9, '/', EDGE, fade);
  line(plot, -seal * 0.65, seal * 0.65, seal * 0.65, -seal * 0.65, 9, '\\', PURPLE, fade);
  plot(0, 0, 'X', EDGE, fade);
  if (impact) {
    for (let i = 0; i < 6; i++) {
      const angle = (i + 0.25) / 6 * TAU;
      const drift = seal * (0.9 + p * 0.6);
      const x = Math.cos(angle) * drift, z = Math.sin(angle) * drift;
      plot(x, z, i % 2 ? '/' : '\\', PURPLE, fade * 0.72);
      plot(x * 1.13, z * 1.13, '.', DUSK, fade * 0.45);
    }
  }
}

export default {
  id: 'silencing-shard',
  duration: 0.92,
  draw,
  sounds: {
    cast: [
      // Two non-harmonic partials make a hollow, deliberately damped bell.
      { kind: 'tone', delay: 0, duration: 0.27, gain: 0.07, attack: 0.003, release: 0.2,
        frequency: 428, endFrequency: 397, type: 'sine', cutoff: 1200, filterType: 'lowpass' },
      { kind: 'tone', delay: 0.012, duration: 0.19, gain: 0.032, attack: 0.002, release: 0.16,
        frequency: 677, endFrequency: 628, type: 'triangle', cutoff: 1000, filterType: 'lowpass' },
      // Descending notch centres remove successively lower bands of breath.
      { kind: 'noise', delay: 0.13, duration: 0.11, gain: 0.035, attack: 0.025, release: 0.07,
        cutoff: 1750, filterType: 'notch' },
      { kind: 'noise', delay: 0.22, duration: 0.1, gain: 0.027, attack: 0.018, release: 0.06,
        cutoff: 880, filterType: 'notch' },
      { kind: 'noise', delay: 0.30, duration: 0.075, gain: 0.02, attack: 0.012, release: 0.009,
        cutoff: 390, filterType: 'notch' },
    ],
    impact: [
      { kind: 'tone', delay: 0, duration: 0.105, gain: 0.06, attack: 0.003, release: 0.009,
        frequency: 262, endFrequency: 106, type: 'sine', cutoff: 650, filterType: 'lowpass' },
      { kind: 'noise', delay: 0.018, duration: 0.075, gain: 0.035, attack: 0.01, release: 0.008,
        cutoff: 680, filterType: 'notch' },
      { kind: 'tone', delay: 0.105, duration: 0.018, gain: 0.022, attack: 0.001, release: 0.012,
        frequency: 1020, endFrequency: 740, type: 'triangle', cutoff: 1500, filterType: 'lowpass' },
    ],
  },
};
