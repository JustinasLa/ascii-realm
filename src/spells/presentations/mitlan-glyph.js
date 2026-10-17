const water = [57, 187, 202], foam = [179, 255, 239], deep = [38, 116, 165];
const turn = Math.PI * 2;

// A water triskele: three curling prongs between two offset current tracks.
export default {
  id: 'mitlan-glyph',
  duration: 1.15,
  draw(effect, plot) {
    const p = Math.max(0, Math.min(1, effect.progress));
    const fade = Math.min(1, (1 - p) * 3);
    const spin = effect.age * 0.75;
    if (effect.stage === 'projectile') {
      for (let arm = 0; arm < 3; arm++) {
        for (let j = 0; j < 4; j++) {
          const u = j / 3, a = arm * turn / 3 + spin + u * 1.5, r = 0.1 + u * 0.32;
          plot(Math.cos(a) * r, Math.sin(a) * r, j === 3 ? 'o' : '~', j === 3 ? foam : water, fade);
        }
      }
      // Three separated beads trail the small rotating seal.
      for (let j = 0; j < 3; j++) {
        plot(Math.sin(spin - j * 0.7) * 0.12, -0.55 - j * 0.24, '.', water, fade * (0.7 - j * 0.15));
      }
      return;
    }
    if (effect.stage === 'impact') {
      const r = 0.35 + p * 2.2;
      // The seal opens into three outward crescent ripples, with airborne beads.
      for (let arm = 0; arm < 3; arm++) {
        const start = arm * turn / 3 + spin;
        for (let j = 0; j < 11; j++) {
          const a = start + j / 10 * 1.15;
          plot(Math.cos(a) * r, Math.sin(a) * r, '~', water, fade);
        }
        const a = start + 0.55;
        plot(Math.cos(a) * (r + 0.25), Math.sin(a) * (r + 0.25), 'o', foam, fade);
        plot(Math.cos(a + 0.16) * (r + 0.52), Math.sin(a + 0.16) * (r + 0.52), '.', foam, fade * 0.7);
      }
      plot(-0.16, 0, '<', foam, fade); plot(0.16, 0, '>', foam, fade);
      return;
    }
    const forming = effect.stage === 'cast' ? 0.35 + 0.65 * Math.sin(Math.min(1, p * 1.7) * Math.PI / 2) : 1;
    const size = Math.max(0.8, Math.min(3.6, effect.radius)) * forming;
    const level = effect.stage === 'pulse' ? 0.65 : 1;
    for (let arm = 0; arm < 3; arm++) {
      for (let j = 0; j < 13; j++) {
        const u = j / 12, a = arm * turn / 3 + spin + u * 1.75;
        const r = (0.12 + 0.9 * u) * size;
        plot(Math.cos(a) * r, Math.sin(a) * r, j === 12 ? '+' : '~', j === 12 ? foam : water, fade * level);
      }
      const a = arm * turn / 3 - spin * 0.7;
      plot(Math.cos(a) * size * 1.44, Math.sin(a) * size * 1.44, 'o', foam, fade * level);
      plot(Math.cos(a - 0.13) * size * 1.4, Math.sin(a - 0.13) * size * 1.4, '.', water, fade * level * 0.7);
    }
    for (let track = 0; track < 2; track++) {
      const offset = track === 0 ? -0.2 : 0.2;
      for (let j = 0; j < 20; j++) {
        const a = j / 20 * turn - spin * (track ? 0.45 : 0.3), r = size * (1.1 + track * 0.17);
        plot(Math.cos(a) * r + offset * size, Math.sin(a) * r - offset * size * 0.5,
          track ? ':' : '.', deep, fade * level * 0.72);
      }
    }
    plot(0, 0, 'o', foam, fade * level);
  },
  sounds: {
    cast: [
      { kind: 'tone', type: 'sine', frequency: 122, endFrequency: 116, duration: 1.05, gain: 0.038, attack: 0.13, release: 0.32, cutoff: 360 },
      { kind: 'tone', type: 'sine', frequency: 540, endFrequency: 360, delay: 0.06, duration: 0.23, gain: 0.075, attack: 0.004, release: 0.19 },
      { kind: 'tone', type: 'sine', frequency: 675, endFrequency: 450, delay: 0.3, duration: 0.23, gain: 0.068, attack: 0.004, release: 0.19 },
      { kind: 'tone', type: 'sine', frequency: 810, endFrequency: 540, delay: 0.54, duration: 0.27, gain: 0.062, attack: 0.004, release: 0.23 },
      { kind: 'noise', delay: 0.08, duration: 0.76, gain: 0.018, attack: 0.12, release: 0.3, cutoff: 520, filterType: 'lowpass' },
    ],
    impact: [
      { kind: 'tone', type: 'sine', frequency: 1260, endFrequency: 730, duration: 0.24, gain: 0.09, attack: 0.003, release: 0.2 },
      { kind: 'tone', type: 'sine', frequency: 365, endFrequency: 182, delay: 0.04, duration: 0.42, gain: 0.052, attack: 0.015, release: 0.33 },
      { kind: 'noise', delay: 0.015, duration: 0.21, gain: 0.027, attack: 0.008, release: 0.17, cutoff: 1100, filterType: 'bandpass' },
      { kind: 'tone', type: 'sine', frequency: 1460, endFrequency: 980, delay: 0.15, duration: 0.16, gain: 0.028, attack: 0.002, release: 0.14 },
    ],
    pulse: [
      { kind: 'tone', type: 'sine', frequency: 450, endFrequency: 360, duration: 0.12, gain: 0.016, attack: 0.004, release: 0.1 },
    ],
  },
};
