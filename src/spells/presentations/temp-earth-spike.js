const stone = [197, 186, 147], shadedStone = [124, 126, 92];
const soil = [163, 103, 56], leaf = [151, 218, 87];

// Three ledges make this an earthen outcrop rather than a smooth crystal dart.
function tiers(plot, growth, scale, fade, base = -0.65) {
  for (let tier = 0; tier < 3; tier++) {
    const width = (0.76 - tier * 0.19) * scale;
    const bottom = base + tier * 0.55 * growth;
    const top = base + (tier * 0.55 + 1) * growth;
    for (let j = 0; j < 4; j++) {
      const t = j / 4;
      plot(-width * (1 - t), bottom + (top - bottom) * t, '/', stone, fade);
      plot(width * (1 - t), bottom + (top - bottom) * t, '\\', shadedStone, fade);
    }
    plot(0, top, '^', stone, fade);
    plot(-width * 0.45, bottom, '_', shadedStone, fade);
    plot(width * 0.45, bottom, '_', stone, fade);
    plot(0, bottom + (top - bottom) * 0.35, '#', shadedStone, fade);
  }
}

function curls(plot, p, fade, spread) {
  for (const side of [-1, 1]) {
    for (let j = 0; j < 6; j++) {
      const a = j * 0.56 + p * 1.8;
      const r = 0.16 + j * 0.035;
      plot(side * (spread + Math.cos(a) * r), -0.35 + Math.sin(a) * r + p * 0.22,
        j === 5 ? "'" : side < 0 ? '(' : ')', leaf, fade * (0.65 + j * 0.05));
    }
  }
}

export default {
  id: 'temp-earth-spike', duration: 0.9,
  draw(effect, plot) {
    const p = effect.progress, fade = Math.max(0, Math.min(1, (1 - p) * 4));
    if (effect.stage === 'projectile') {
      tiers(plot, 0.42, 0.42, fade, -0.15);
      for (let j = 0; j < 8; j++) {
        plot((j % 2 ? 1 : -1) * (0.09 + j * 0.035), -0.45 - j * 0.15,
          j % 3 === 0 ? '#' : '.', soil, fade * (0.7 - j * 0.065));
      }
      return;
    }
    if (effect.stage === 'impact') {
      // The upright core collapses while five crooked cracks peel outwards.
      tiers(plot, 0.8 * (1 - p) + 0.15, 0.6, fade);
      for (let arm = 0; arm < 5; arm++) {
        const a = arm * Math.PI * 2 / 5 + 0.18;
        for (let j = 0; j < 4; j++) {
          const r = (0.4 + j * 0.3) * (0.5 + p);
          const kink = (j % 2 ? 0.11 : -0.11);
          plot(Math.cos(a) * r + Math.sin(a) * kink, Math.sin(a) * r - 0.65,
            j === 3 ? '#' : '/', soil, fade * (1 - j * 0.1));
        }
      }
      curls(plot, p, fade, 0.9 + p * 0.55);
      return;
    }
    // Cast, repeated travelling fissure pulses, aura and zone all grow ledges.
    const growth = 0.14 + Math.min(1, p * 3) * 1.12;
    tiers(plot, growth, effect.stage === 'cast' ? 1 : 0.82, fade);
    for (let j = 0; j < 10; j++) {
      const side = j % 2 ? 1 : -1;
      const travel = 0.25 + p * (0.55 + (j % 5) * 0.14);
      plot(side * travel, -0.6 + Math.sin(p * Math.PI) * (0.2 + (j % 3) * 0.27),
        j % 3 === 0 ? '#' : '.', soil, fade * 0.8);
    }
    curls(plot, p, fade, 0.8);
  },
  sounds: {
    cast: [
      { kind: 'noise', duration: 0.46, gain: 0.055, cutoff: 290, filterType: 'lowpass', attack: 0.08, release: 0.18 },
      { kind: 'tone', type: 'triangle', frequency: 55, endFrequency: 98, duration: 0.42, gain: 0.05, attack: 0.07, release: 0.16 },
      { kind: 'noise', delay: 0.16, duration: 0.045, gain: 0.09, cutoff: 1500, filterType: 'bandpass', attack: 0.001, release: 0.035 },
      { kind: 'noise', delay: 0.31, duration: 0.035, gain: 0.07, cutoff: 2400, filterType: 'bandpass', attack: 0.001, release: 0.028 },
    ],
    impact: [
      { kind: 'noise', duration: 0.17, gain: 0.1, cutoff: 650, filterType: 'lowpass', attack: 0.002, release: 0.14 },
      { kind: 'tone', type: 'triangle', frequency: 108, endFrequency: 39, duration: 0.18, gain: 0.085, attack: 0.002, release: 0.15 },
      { kind: 'noise', delay: 0.06, duration: 0.1, gain: 0.03, cutoff: 1900, filterType: 'bandpass', attack: 0.001, release: 0.09 },
    ],
    pulse: [
      { kind: 'noise', duration: 0.05, gain: 0.018, cutoff: 500, filterType: 'lowpass', release: 0.04 },
      { kind: 'tone', type: 'sine', frequency: 64, endFrequency: 45, duration: 0.08, gain: 0.016, release: 0.065 },
    ],
  },
};
