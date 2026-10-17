// Falling leaflets sew a wound closed, then grow into living branches.
const leafGreen = [135, 222, 113];
const stemGreen = [77, 170, 101];
const warmLight = [250, 239, 172];
const TAU = Math.PI * 2;

function stitch(plot, x, z, size, light) {
  plot(x, z, '+', warmLight, light);
  plot(x - size, z, '-', leafGreen, light);
  plot(x + size, z, '-', leafGreen, light);
  plot(x, z - size, '|', leafGreen, light);
  plot(x, z + size, '|', leafGreen, light);
}

function leaflet(plot, x, z, angle, size, light) {
  const dx = Math.cos(angle) * size, dz = Math.sin(angle) * size;
  plot(x, z, dx * dz >= 0 ? '\\' : '/', leafGreen, light);
  plot(x + dx, z + dz, dx >= 0 ? '>' : '<', warmLight, light * 0.85);
  plot(x - dx, z - dz, "'", stemGreen, light * 0.8);
}

function branch(plot, angle, length, light) {
  const dx = Math.sin(angle), dz = Math.cos(angle);
  for (let i = 1; i <= 5; i++) {
    const r = length * i / 5;
    plot(dx * r, dz * r, Math.abs(dx) < 0.2 ? '|' : dx > 0 ? '\\' : '/', stemGreen, light);
    if (i === 3 || i === 5) {
      const fork = length * 0.16;
      plot(dx * r - dz * fork, dz * r + dx * fork, '<', leafGreen, light);
      plot(dx * r + dz * fork, dz * r - dx * fork, '>', leafGreen, light);
    }
  }
}

export default {
  id: 'restoration',
  duration: 1.45,
  draw(effect, plot) {
    const p = effect.progress;
    const fade = Math.max(0, Math.min(1, (1 - p) * 4));
    const radius = Math.min(3.4, Math.max(1.1, effect.radius));
    if (effect.stage === 'projectile') {
      // Compact leaf shoot and a stitched wake, if carried by a projectile.
      leaflet(plot, 0, 0.25, Math.PI / 2, 0.3, fade);
      plot(0, 0.1, '|', stemGreen, fade);
      for (let i = 0; i < 4; i++) {
        plot(Math.sin(effect.age * 5 - i) * 0.12, -0.2 - i * 0.23,
          i % 2 ? '.' : '+', i % 2 ? leafGreen : warmLight, fade * (0.8 - i * 0.15));
      }
      return;
    }
    if (effect.stage === 'impact' || effect.stage === 'aura') {
      // A closed seam springs open into four forked healing branches.
      const growth = radius * (0.25 + Math.sin(Math.min(1, p * 1.6) * Math.PI / 2) * 0.8);
      for (const angle of [-2.5, -0.65, 0.65, 2.5]) branch(plot, angle, growth, fade);
      stitch(plot, 0, 0, 0.22, fade);
      for (let i = 0; i < 6; i++) {
        const angle = i * TAU / 6 + p * 0.8;
        leaflet(plot, Math.cos(angle) * growth, Math.sin(angle) * growth + p * 0.35,
          angle + 0.7, 0.13, fade * 0.8);
      }
      return;
    }

    const cast = effect.stage === 'cast';
    const turn = cast ? p * TAU * 1.15 : effect.age * 1.7;
    const spread = cast ? 1.4 : radius;
    // Increasing angle is clockwise in the local ground plane. A downward
    // drift separates each leaflet from a flat orbiting ring.
    for (let i = 0; i < 12; i++) {
      const angle = i * 0.68 + turn;
      const r = spread * (0.3 + i * 0.055) * (1 - p * 0.18);
      leaflet(plot, Math.cos(angle) * r, Math.sin(angle) * r + p * 0.55 - 0.2,
        angle + 0.8, 0.12, fade * (0.65 + i * 0.025));
    }
    const opening = cast ? p : 0.45 + Math.sin(effect.age * 3) * 0.15;
    for (let i = 0; i < 3; i++) {
      stitch(plot, (i - 1) * spread * 0.55, (i % 2 ? -0.35 : 0.25) - p * 0.2,
        0.11 + opening * 0.12, fade * 0.95);
    }
    branch(plot, -0.75, 0.3 + opening * spread, fade * opening);
    branch(plot, 0.75, 0.3 + opening * spread, fade * opening);
  },
  sounds: {
    cast: [
      { kind: 'tone', type: 'triangle', frequency: 293.66, delay: 0, duration: 0.7, gain: 0.055, attack: 0.035, release: 0.5 },
      { kind: 'tone', type: 'sine', frequency: 369.99, delay: 0.27, duration: 0.7, gain: 0.065, attack: 0.04, release: 0.48 },
      { kind: 'tone', type: 'triangle', frequency: 440, delay: 0.62, duration: 0.75, gain: 0.05, attack: 0.04, release: 0.55 },
      { kind: 'tone', type: 'sine', frequency: 587.33, delay: 1.02, duration: 0.9, gain: 0.045, attack: 0.06, release: 0.65 },
      { kind: 'noise', delay: 0.08, duration: 1.65, gain: 0.025, cutoff: 1050, filterType: 'lowpass', attack: 0.28, release: 0.6 },
    ],
    impact: [
      { kind: 'tone', type: 'sine', frequency: 293.66, duration: 0.7, gain: 0.06, attack: 0.04, release: 0.5 },
      { kind: 'tone', type: 'triangle', frequency: 440, delay: 0.08, duration: 0.8, gain: 0.045, attack: 0.045, release: 0.55 },
      { kind: 'tone', type: 'sine', frequency: 587.33, delay: 0.25, duration: 0.8, gain: 0.045, attack: 0.04, release: 0.6 },
      { kind: 'noise', delay: 0.05, duration: 0.65, gain: 0.018, cutoff: 900, filterType: 'lowpass', attack: 0.15, release: 0.35 },
    ],
    pulse: [
      { kind: 'tone', type: 'sine', frequency: 369.99, duration: 0.16, gain: 0.019, attack: 0.025, release: 0.11 },
      { kind: 'tone', type: 'sine', frequency: 440, delay: 0.12, duration: 0.17, gain: 0.014, attack: 0.025, release: 0.12 },
    ],
  },
};
