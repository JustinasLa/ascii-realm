// Five separate ice blades unfold around a bowed rim, then break into a fan of chips.
const ice = [218, 253, 255], edge = [100, 211, 250], frost = [68, 135, 205];

function blade(plot, angle, base, tip, width, brightness, broken = false) {
  const sx = Math.sin(angle), cz = Math.cos(angle);
  const tx = sx * tip, tz = cz * tip;
  for (const side of [-1, 1]) {
    const bx = sx * base + cz * width * side, bz = cz * base - sx * width * side;
    for (let i = 0; i < 4; i++) {
      const t = i / 4;
      plot(bx + (tx - bx) * t, bz + (tz - bz) * t, side < 0 ? '/' : '\\', edge, brightness);
    }
  }
  for (let i = -1; i <= 1; i++) {
    plot(sx * base + cz * width * i, cz * base - sx * width * i, '-', frost, brightness * 0.8);
  }
  plot(tx, tz, broken ? '*' : '^', ice, brightness);
}

export default {
  id: 'temp-glacial-fan',
  duration: 1.05,
  draw(effect, plot) {
    const p = effect.progress, fade = Math.max(0, Math.min(1, (1 - p) * 4));
    if (effect.stage === 'projectile') {
      // Each of the five gameplay projectiles carries one compact triangular blade.
      blade(plot, 0, -0.12, 0.58, 0.26, fade);
      plot(0, 0.16, '|', ice, fade);
      for (let i = 0; i < 5; i++) {
        const z = -0.38 - i * 0.2, x = Math.sin(effect.age * 16 + i) * 0.05;
        plot(x - 0.1, z, ':', edge, fade * (0.7 - i * 0.1));
        plot(-x + 0.1, z - 0.08, '.', frost, fade * (0.6 - i * 0.1));
      }
      return;
    }
    if (effect.stage === 'impact') {
      // Detached triangular chips retain the bowed fan instead of becoming a circle.
      for (let i = -2; i <= 2; i++) {
        const angle = i * 0.53, base = 0.3 + p * 2.1;
        blade(plot, angle, base, base + 0.48, 0.14, fade, true);
        for (let j = 0; j < 3; j++) {
          const r = base * 0.6 + j * 0.16;
          plot(Math.sin(angle + j * 0.07) * r, Math.cos(angle + j * 0.07) * r,
            j === 0 ? 'x' : '.', j === 0 ? ice : frost, fade * (0.8 - j * 0.2));
        }
      }
      return;
    }
    const cast = effect.stage === 'cast';
    const open = 0.48 + Math.sin(Math.min(1, p * 1.7) * Math.PI / 2) * 0.52;
    const tip = (cast ? 1.2 : 0.75) + Math.sin(p * Math.PI / 2) * (cast ? 2.1 : 0.85);
    for (let i = -2; i <= 2; i++) {
      blade(plot, i * 0.48 * open, tip * 0.35, tip, tip * 0.065, fade);
    }
    // Dotted outer contour is bowed toward the target, with gaps between blade tips.
    for (let i = -6; i <= 6; i++) {
      const a = i * 0.17 * open;
      plot(Math.sin(a) * (tip + 0.16), Math.cos(a) * (tip + 0.16), '.', edge, fade * 0.55);
    }
    plot(-0.13, -0.1, '/', ice, fade); plot(0.13, -0.1, '\\', ice, fade);
    plot(0, -0.32, '|', edge, fade);
  },
  sounds: {
    cast: [
      // Three shorter, closer swishes make the unfolding fan audibly accelerate.
      { kind: 'noise', delay: 0, duration: 0.22, gain: 0.065, cutoff: 1500, filterType: 'bandpass', attack: 0.055, release: 0.12 },
      { kind: 'noise', delay: 0.23, duration: 0.17, gain: 0.075, cutoff: 2400, filterType: 'bandpass', attack: 0.035, release: 0.1 },
      { kind: 'noise', delay: 0.38, duration: 0.12, gain: 0.085, cutoff: 3700, filterType: 'highpass', attack: 0.018, release: 0.085 },
      { kind: 'tone', type: 'triangle', frequency: 460, endFrequency: 920, delay: 0.02, duration: 0.44, gain: 0.025, attack: 0.06, release: 0.16 },
    ],
    impact: [
      { kind: 'noise', duration: 0.14, gain: 0.105, cutoff: 4600, filterType: 'highpass', attack: 0.002, release: 0.13 },
      { kind: 'tone', type: 'triangle', frequency: 622, endFrequency: 540, duration: 0.36, gain: 0.05, attack: 0.003, release: 0.3 },
      { kind: 'tone', type: 'sine', frequency: 932, endFrequency: 854, delay: 0.012, duration: 0.4, gain: 0.04, attack: 0.003, release: 0.32 },
      { kind: 'tone', type: 'triangle', frequency: 1480, endFrequency: 1250, delay: 0.026, duration: 0.3, gain: 0.028, attack: 0.002, release: 0.26 },
      { kind: 'noise', delay: 0.075, duration: 0.25, gain: 0.03, cutoff: 2600, filterType: 'bandpass', attack: 0.004, release: 0.23 },
    ],
    pulse: [{ kind: 'noise', duration: 0.055, gain: 0.018, cutoff: 3300, filterType: 'highpass', attack: 0.003, release: 0.045 }],
  },
};
