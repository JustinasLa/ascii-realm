// A single white-hot, faceted shard with a split ember wake. No assets or timers.
const white = [255, 243, 192], orange = [255, 116, 31], ember = [208, 48, 20];

export default {
  id: 'fire-shard', duration: 0.55,
  draw(effect, plot) {
    const p = effect.progress, fade = Math.min(1, (1 - p) * 3);
    if (effect.stage === 'projectile') {
      for (let i = 0; i < 10; i++) {
        const z = -i * 0.16, side = Math.sin(i * 1.8 + effect.age * 28) * i * 0.024;
        plot(side, z, i < 3 ? '^' : ':', i < 3 ? white : orange, 1 - i * 0.075);
        if (i > 3) plot(-side - 0.12, z - 0.12, '.', ember, 0.7 - i * 0.035);
      }
      plot(-0.16, -0.2, '/', orange); plot(0.16, -0.2, '\\', orange); plot(0, 0.25, '^', white);
      return;
    }
    if (effect.stage === 'impact') {
      for (let ray = 0; ray < 7; ray++) {
        const angle = ray * 2.39996;
        for (let j = 0; j < 4; j++) {
          const r = (0.15 + p * 2.3) * (0.4 + j * 0.22);
          plot(Math.sin(angle) * r, Math.cos(angle) * r, j === 3 ? '*' : ':', j === 0 ? white : orange, fade);
        }
      }
      plot(0, 0, '#', white, fade);
      return;
    }
    // Casting squeezes two angular jaws into a needle before release.
    const spread = 0.15 + (1 - p) * 0.75;
    for (let i = 0; i < 7; i++) {
      const z = i * 0.18 - 0.4, x = spread * (1 - i / 8);
      plot(-x, z, '/', orange, fade); plot(x, z, '\\', orange, fade);
    }
    plot(0, 0.45 + p * 0.65, '^', white, fade);
  },
  sounds: {
    cast: [
      { kind: 'noise', duration: 0.18, gain: 0.09, cutoff: 2100, filterType: 'highpass', attack: 0.025, release: 0.12 },
      { kind: 'tone', type: 'sawtooth', frequency: 380, endFrequency: 1150, duration: 0.14, gain: 0.055, cutoff: 1900 },
      { kind: 'tone', type: 'triangle', frequency: 1300, endFrequency: 440, delay: 0.06, duration: 0.17, gain: 0.04 },
    ],
    impact: [
      { kind: 'noise', duration: 0.17, gain: 0.15, cutoff: 2600, filterType: 'bandpass', release: 0.14 },
      { kind: 'tone', type: 'triangle', frequency: 240, endFrequency: 70, duration: 0.2, gain: 0.12 },
      { kind: 'noise', delay: 0.055, duration: 0.23, gain: 0.055, cutoff: 4700, filterType: 'highpass' },
    ],
    pulse: [{ kind: 'noise', duration: 0.06, gain: 0.025, cutoff: 3200, filterType: 'highpass' }],
  },
};
