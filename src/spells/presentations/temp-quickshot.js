const vein = [222, 242, 137], leaf = [123, 210, 82], wood = [200, 161, 91];

// The straight midrib stays legible while the alternating leaflets fold to fly.
function arrow(plot, scale, spread, flutter, fade) {
  for (let i = 0; i < 11; i++) {
    plot(0, (-1.05 + i * 0.19) * scale, '|', i < 5 ? wood : vein, fade);
  }
  for (let i = 1; i < 6; i++) {
    const t = i / 6, width = Math.sin(t * Math.PI) * 0.28 * spread;
    const z = (0.04 + t * 0.92) * scale;
    plot(-width * scale, z, '/', leaf, fade);
    plot(width * scale, z, '\\', leaf, fade);
  }
  plot(0, 1.08 * scale, '^', vein, fade);
  for (let i = 0; i < 4; i++) {
    const side = i % 2 === 0 ? -1 : 1, z = -0.96 + i * 0.2;
    const width = (0.25 + flutter * side * 0.045) * spread;
    plot(side * width * 0.5 * scale, (z - 0.1) * scale, side < 0 ? '\\' : '/', leaf, fade);
    plot(side * width * scale, (z - 0.21) * scale, side < 0 ? '<' : '>', leaf, fade * 0.85);
  }
}

export default {
  id: 'temp-quickshot',
  duration: 0.65,
  draw(effect, plot) {
    const p = effect.progress, fade = Math.min(1, (1 - p) * 3);
    if (effect.stage === 'impact') {
      // Five veined leaves separate into a small star, then curl and disappear.
      for (let petal = 0; petal < 5; petal++) {
        const angle = petal * Math.PI * 2 / 5 + p * 0.32;
        const dx = Math.sin(angle), dz = Math.cos(angle);
        for (let j = 1; j <= 4; j++) {
          const t = j / 4, r = 0.08 + p * 0.2 + t * (0.52 + p * 0.58);
          const width = Math.sin(t * Math.PI) * (0.16 - p * 0.05);
          plot(dx * r, dz * r, j === 4 ? '^' : ':', vein, fade);
          if (j < 4) {
            plot(dx * r + dz * width, dz * r - dx * width, '/', leaf, fade);
            plot(dx * r - dz * width, dz * r + dx * width, '\\', leaf, fade);
          }
        }
      }
      plot(0, 0, '*', wood, fade);
      return;
    }
    if (effect.stage === 'projectile') {
      arrow(plot, 0.72, 0.8, Math.sin(effect.age * 35), fade);
      for (let i = 0; i < 5; i++) {
        plot(Math.sin(effect.age * 24 - i) * i * 0.027, -0.96 - i * 0.23,
          i === 3 ? ',' : '.', i === 3 ? leaf : wood, fade * (0.6 - i * 0.09));
      }
      return;
    }
    // The cast draws back and folds broad leaves against the wooden shaft.
    // Aura/zone/pulse use this same compact signature without new effects.
    arrow(plot, 0.68 + p * 0.25, 1.8 - p, Math.sin(effect.age * 18), fade);
    const tension = (1 - p) * 0.65;
    plot(-tension, -1.15, '<', wood, fade * 0.6);
    plot(tension, -1.15, '>', wood, fade * 0.6);
  },
  sounds: {
    cast: [
      { kind: 'tone', type: 'triangle', frequency: 294, endFrequency: 132, duration: 0.12, gain: 0.085, attack: 0.001, release: 0.1 },
      { kind: 'tone', type: 'sine', frequency: 672, endFrequency: 336, delay: 0.008, duration: 0.055, gain: 0.025, attack: 0.001, release: 0.05 },
      { kind: 'noise', delay: 0.045, duration: 0.09, gain: 0.047, cutoff: 3200, filterType: 'bandpass', attack: 0.005, release: 0.07 },
    ],
    impact: [
      { kind: 'noise', duration: 0.035, gain: 0.055, cutoff: 3900, filterType: 'highpass', attack: 0.001, release: 0.03 },
      { kind: 'noise', delay: 0.026, duration: 0.04, gain: 0.037, cutoff: 5200, filterType: 'bandpass', attack: 0.001, release: 0.035 },
      { kind: 'noise', delay: 0.068, duration: 0.03, gain: 0.022, cutoff: 2700, filterType: 'highpass', attack: 0.001, release: 0.026 },
      { kind: 'tone', type: 'sine', frequency: 840, endFrequency: 280, duration: 0.035, gain: 0.018, attack: 0.001, release: 0.03 },
    ],
  },
};
