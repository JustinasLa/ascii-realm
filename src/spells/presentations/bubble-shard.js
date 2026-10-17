const water = [92, 218, 229], film = [210, 248, 255], lilac = [198, 182, 248];
const rimGlyphs = [')', '\\', '\\', '-', '/', '/', '(', '\\', '\\', '-', '/', '/'];

// Hollow rims and a separate curved highlight keep each bubble transparent.
function bubble(plot, x, z, radius, light) {
  for (let i = 0; i < 12; i++) {
    const angle = i * Math.PI / 6;
    plot(x + Math.cos(angle) * radius, z + Math.sin(angle) * radius,
      rimGlyphs[i], water, light);
  }
  for (let i = 0; i < 4; i++) {
    const angle = 3.65 + i * 0.27;
    plot(x + Math.cos(angle) * radius * 0.76, z + Math.sin(angle) * radius * 0.76,
      "'", i % 2 ? lilac : film, light * 0.85);
  }
  plot(x - radius * 0.24, z - radius * 0.36, 'o', film, light);
}

export default {
  id: 'bubble-shard',
  duration: 0.86,
  draw(effect, plot) {
    const p = effect.progress, fade = Math.min(1, (1 - p) * 4);
    if (effect.stage === 'projectile') {
      // The little satellite bubbles bob independently behind the leading film.
      bubble(plot, 0, 0.12, 0.27 + Math.sin(effect.age * 11) * 0.025, fade);
      bubble(plot, -0.23 + Math.sin(effect.age * 9) * 0.045, -0.38, 0.14, fade * 0.78);
      bubble(plot, 0.16, -0.7 + Math.sin(effect.age * 8) * 0.04, 0.085, fade * 0.6);
      for (let i = 0; i < 5; i++) {
        plot(Math.sin(effect.age * 12 - i) * 0.12, -0.95 - i * 0.16,
          i % 2 ? 'o' : '.', water, fade * (0.45 - i * 0.075));
      }
      return;
    }
    if (effect.stage === 'impact') {
      // The three films rupture in order, leaving open cups, teeth and beads.
      for (let i = 0; i < 3; i++) {
        const q = Math.max(0, Math.min(1, (p - i * 0.11) / (1 - i * 0.11)));
        const x = (i - 1) * 0.65, z = i === 1 ? 0.32 : -0.2;
        const width = (0.22 + q * 0.72) * (1 - i * 0.13);
        const light = fade * (p < i * 0.11 ? 0.35 : 1);
        for (let j = 0; j < 7; j++) {
          const angle = j * Math.PI / 6;
          plot(x + Math.cos(angle) * width, z - Math.sin(angle) * width * 0.42,
            j === 3 ? '_' : 'u', water, light * (1 - q * 0.55));
        }
        for (let j = 0; j < 5; j++) {
          const side = (j - 2) / 2;
          const rise = (1 - Math.abs(side) * 0.38) * (0.18 + q * 0.62);
          plot(x + side * width, z + rise, '^', film, light);
          plot(x + side * width * (1 + q * 0.5), z + rise + q * 0.42,
            j % 2 ? '.' : 'o', j % 2 ? lilac : water, light * (1 - q * 0.3));
        }
      }
      return;
    }
    const small = effect.stage === 'pulse', count = small ? 2 : 3;
    const scale = small ? 0.42 : Math.min(1.35, 0.72 + effect.radius * 0.15);
    const lift = p * (small ? 0.35 : 0.85);
    const swell = 0.72 + Math.sin(p * Math.PI / 2) * 0.5;
    for (let i = 0; i < count; i++) {
      const x = [-0.62, 0.5, 0.12][i] * scale + Math.sin(effect.age * 6 + i * 2) * 0.07;
      const z = [-0.3, 0.08, 0.72][i] * scale + lift + Math.sin(effect.age * 5 + i) * 0.06;
      const radius = [0.5, 0.31, 0.18][i] * scale * swell;
      bubble(plot, x, z, radius, fade * (small ? 0.55 : 1));
    }
  },
  sounds: {
    cast: [
      { kind: 'tone', type: 'sine', frequency: 470, endFrequency: 155, delay: 0, duration: 0.14, gain: 0.075, attack: 0.008, release: 0.1 },
      { kind: 'tone', type: 'sine', frequency: 730, endFrequency: 285, delay: 0.14, duration: 0.105, gain: 0.063, attack: 0.006, release: 0.08 },
      { kind: 'tone', type: 'sine', frequency: 350, endFrequency: 115, delay: 0.38, duration: 0.17, gain: 0.07, attack: 0.01, release: 0.13 },
      { kind: 'noise', delay: 0.025, duration: 0.07, gain: 0.014, cutoff: 1700, filterType: 'lowpass', attack: 0.008, release: 0.05 },
    ],
    impact: [
      { kind: 'tone', type: 'sine', frequency: 820, endFrequency: 235, delay: 0, duration: 0.085, gain: 0.067, attack: 0.004, release: 0.065 },
      { kind: 'tone', type: 'sine', frequency: 570, endFrequency: 190, delay: 0.065, duration: 0.11, gain: 0.057, attack: 0.006, release: 0.08 },
      { kind: 'tone', type: 'sine', frequency: 960, endFrequency: 310, delay: 0.19, duration: 0.075, gain: 0.044, attack: 0.004, release: 0.055 },
      { kind: 'noise', delay: 0.035, duration: 0.08, gain: 0.022, cutoff: 1400, filterType: 'bandpass', attack: 0.004, release: 0.06 },
    ],
    pulse: [{ kind: 'tone', type: 'sine', frequency: 380, endFrequency: 220, duration: 0.045, gain: 0.012, attack: 0.003, release: 0.035 }],
  },
};
