const stem = [103, 169, 60], leaf = [176, 224, 104], bark = [137, 113, 63];

function hook(plot, x, z, side, fade) {
  plot(x + side * 0.15, z + 0.05, '-', stem, fade);
  plot(x + side * 0.32, z + 0.15, side > 0 ? ')' : '(', leaf, fade);
  plot(x + side * 0.24, z + 0.28, side > 0 ? '/' : '\\', leaf, fade);
}

export default {
  id: 'temp-vine-wave',
  duration: 1.05,
  draw(effect, plot) {
    const p = Math.max(0, Math.min(1, effect.progress));
    const phase = effect.age * 8;
    const fade = Math.min(1, (1 - p) * 3);

    if (effect.stage === 'impact' || effect.stage === 'aura') {
      // Opposing tendrils close around the hit, their leaves hooked inward.
      const width = (0.95 - p * 0.6) * Math.min(1.5, effect.radius);
      for (let side = -1; side <= 1; side += 2) {
        for (let i = 0; i < 19; i++) {
          const t = i / 18;
          const x = side * (0.12 + Math.sin(t * Math.PI) * width)
            + Math.sin(t * Math.PI * 4 + phase) * 0.1;
          const z = (t - 0.5) * 2.4 + side * Math.sin(t * Math.PI * 2) * 0.12;
          plot(x, z, i % 3 === 0 ? '~' : side > 0 ? ')' : '(', stem, fade);
          if (i === 4 || i === 10 || i === 15) hook(plot, x, z, -side, fade);
        }
      }
      plot(-0.13, -1.25, '#', bark, fade);
      plot(0.13, -1.25, '#', bark, fade);
      return;
    }

    const flying = effect.stage === 'projectile';
    const samples = flying ? 14 : 20;
    const length = flying ? 1.8 : 1.15 + p * 2.2;
    const start = flying ? -1.6 : -0.55;
    const width = flying ? 0.16 : 0.23 + p * 0.18;
    // Two stems repeatedly cross while a travelling bend carries the braid.
    for (let i = 0; i < samples; i++) {
      const t = i / (samples - 1), turn = t * Math.PI * 4 - phase;
      const center = Math.sin(t * Math.PI * 1.5 - phase * 0.45) * width * 0.65;
      const weave = Math.sin(turn) * width;
      const z = start + t * length;
      const brightness = fade * (flying ? 0.42 + t * 0.58 : 1);
      plot(center + weave, z, Math.cos(turn) > 0 ? '/' : '\\', stem, brightness);
      plot(center - weave, z, Math.cos(turn) > 0 ? '\\' : '/', leaf, brightness * 0.88);
      if (i > 0 && i % 4 === 0) {
        const side = (i / 4) % 2 === 0 ? -1 : 1;
        hook(plot, center + side * Math.abs(weave), z, side, brightness);
      }
    }
    const tipX = Math.sin(Math.PI * 1.5 - phase * 0.45) * width * 0.65;
    plot(tipX, start + length + 0.12, '^', leaf, fade);
    if (!flying) plot(0, start - 0.15, '#', bark, fade);
  },
  sounds: {
    cast: [
      { kind: 'noise', duration: 0.32, gain: 0.06, cutoff: 920, filterType: 'bandpass', attack: 0.025, release: 0.12 },
      { kind: 'tone', type: 'triangle', frequency: 310, endFrequency: 180, delay: 0.06, duration: 0.075, gain: 0.06, attack: 0.002, release: 0.06 },
      { kind: 'tone', type: 'triangle', frequency: 235, endFrequency: 145, delay: 0.18, duration: 0.08, gain: 0.055, attack: 0.002, release: 0.065 },
      { kind: 'tone', type: 'triangle', frequency: 310, endFrequency: 180, delay: 0.31, duration: 0.07, gain: 0.05, attack: 0.002, release: 0.06 },
      { kind: 'noise', delay: 0.22, duration: 0.23, gain: 0.035, cutoff: 1200, filterType: 'bandpass', attack: 0.035, release: 0.15 },
      { kind: 'tone', type: 'triangle', frequency: 180, endFrequency: 76, delay: 0.38, duration: 0.26, gain: 0.075, attack: 0.008, release: 0.2 },
    ],
    impact: [
      { kind: 'noise', duration: 0.13, gain: 0.075, cutoff: 690, filterType: 'bandpass', attack: 0.003, release: 0.1 },
      { kind: 'tone', type: 'sawtooth', frequency: 185, endFrequency: 58, duration: 0.23, gain: 0.07, cutoff: 800, attack: 0.003, release: 0.19 },
      { kind: 'tone', type: 'sine', frequency: 350, endFrequency: 200, delay: 0.035, duration: 0.055, gain: 0.045, attack: 0.002, release: 0.045 },
      { kind: 'tone', type: 'triangle', frequency: 240, endFrequency: 135, delay: 0.11, duration: 0.07, gain: 0.04, attack: 0.002, release: 0.06 },
      { kind: 'noise', delay: 0.08, duration: 0.26, gain: 0.055, cutoff: 1300, filterType: 'bandpass', attack: 0.025, release: 0.18 },
      { kind: 'noise', delay: 0.23, duration: 0.13, gain: 0.02, cutoff: 2500, filterType: 'highpass', attack: 0.01, release: 0.1 },
    ],
    pulse: [
      { kind: 'tone', type: 'triangle', frequency: 205, endFrequency: 145, duration: 0.07, gain: 0.025, attack: 0.002, release: 0.06 },
      { kind: 'noise', delay: 0.025, duration: 0.065, gain: 0.015, cutoff: 1050, filterType: 'bandpass', attack: 0.005, release: 0.05 },
    ],
  },
};
