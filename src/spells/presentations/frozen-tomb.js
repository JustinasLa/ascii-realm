// Six-sided ice slabs rise, close into a coffin, then fracture at the corners.
const ice = [119, 195, 232];
const rim = [221, 249, 255];
const seam = [65, 121, 176];
const corners = [[-0.34, 1.25], [0.34, 1.25], [0.78, 0.62],
  [0.55, -1.25], [-0.55, -1.25], [-0.78, 0.62]];

export default {
  id: 'frozen-tomb',
  duration: 1.18,
  draw(effect, plot) {
    const p = Math.max(0, Math.min(1, effect.progress));
    const fade = Math.min(1, (1 - p) * 4);
    if (effect.stage === 'projectile') {
      // A miniature coffin travels with a dotted, alternating frost wake.
      for (let side = 0; side < corners.length; side++) {
        const a = corners[side], b = corners[(side + 1) % corners.length];
        for (let step = 0; step < 2; step++) {
          const t = step / 2;
          plot((a[0] + (b[0] - a[0]) * t) * 0.34,
            (a[1] + (b[1] - a[1]) * t) * 0.34, side % 3 === 0 ? '-' : '/', rim, fade);
        }
      }
      plot(0, 0, '|', ice, fade);
      for (let i = 0; i < 6; i++) {
        plot((i % 2 ? -1 : 1) * (0.04 + i * 0.025),
          -0.52 - i * 0.17 - (effect.age * 1.4 % 0.17), '.', ice, fade * (0.68 - i * 0.08));
      }
      return;
    }

    const casting = effect.stage === 'cast';
    const impact = effect.stage === 'impact';
    const growth = casting ? 0.3 + 0.7 * Math.min(1, p * 1.8) : 1;
    const gap = casting ? 0.55 * (1 - Math.min(1, p * 2.5)) : 0;
    const size = impact ? 1 + p * 0.12 : 1;
    const slab = (x, z, char, color, brightness = 1) => plot(
      (x + Math.sign(x) * gap) * size,
      (-1.25 + (z + 1.25) * growth) * size, char, color, brightness * fade);

    for (let side = 0; side < corners.length; side++) {
      const a = corners[side], b = corners[(side + 1) % corners.length];
      const char = side === 0 || side === 3 ? '-' : side === 1 || side === 4 ? '\\' : '/';
      for (let step = 0; step < 6; step++) {
        const t = step / 6;
        slab(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, char, ice);
      }
      slab(a[0], a[1], '+', rim);
    }

    // The dark lid spine and three transverse seams distinguish solid slabs
    // from a hollow shield outline. The spine brightens as the lid locks.
    for (let i = 0; i < 9; i++) slab(0, -1.02 + i * 0.25, '|', gap > 0.02 ? seam : rim, 0.84);
    for (const z of [-0.7, -0.05, 0.62]) {
      for (const x of [-0.3, 0, 0.3]) slab(x, z, '-', seam, 0.82);
    }

    if (impact) {
      slab(0, -0.05, '#', rim);
      // Each corner opens a short forked fault; no radial ring or generic burst.
      for (const [x, z] of corners) {
        const reach = 0.1 + p * 0.65;
        for (let step = 1; step <= 3; step++) {
          const t = step / 3;
          plot(x * size + Math.sign(x) * reach * t,
            z * size + Math.sign(z) * reach * t * 0.65,
            step === 3 ? '*' : x * z > 0 ? '/' : '\\', rim, fade * (1 - t * 0.32));
        }
      }
    } else if (!casting) {
      // A glint crawls up the sealed lid while a zone or root persists.
      slab(0, -1.05 + (effect.age * 0.9 % 2.1), ':', rim, 0.85);
    }
  },
  sounds: {
    cast: [
      { kind: 'tone', type: 'triangle', frequency: 57, endFrequency: 126, duration: 0.98,
        gain: 0.055, attack: 0.18, release: 0.36 },
      { kind: 'noise', delay: 0.03, duration: 0.86, gain: 0.045, cutoff: 420,
        filterType: 'lowpass', attack: 0.14, release: 0.4 },
      { kind: 'tone', type: 'sine', delay: 0.2, frequency: 680, endFrequency: 595,
        duration: 0.12, gain: 0.048, attack: 0.002, release: 0.1 },
      { kind: 'tone', type: 'sine', delay: 0.39, frequency: 1015, endFrequency: 920,
        duration: 0.1, gain: 0.042, attack: 0.002, release: 0.085 },
      { kind: 'tone', type: 'sine', delay: 0.65, frequency: 1530, endFrequency: 1390,
        duration: 0.09, gain: 0.035, attack: 0.002, release: 0.075 },
    ],
    impact: [
      { kind: 'tone', type: 'triangle', frequency: 120, endFrequency: 46,
        duration: 0.38, gain: 0.09, attack: 0.003, release: 0.31 },
      { kind: 'noise', duration: 0.17, gain: 0.1, cutoff: 600,
        filterType: 'bandpass', attack: 0.002, release: 0.145 },
      { kind: 'noise', duration: 0.06, gain: 0.06, cutoff: 3500,
        filterType: 'highpass', attack: 0.001, release: 0.05 },
      { kind: 'tone', type: 'sine', delay: 0.04, frequency: 735, endFrequency: 420,
        duration: 0.24, gain: 0.048, attack: 0.002, release: 0.21 },
      { kind: 'noise', delay: 0.19, duration: 0.08, gain: 0.028, cutoff: 2300,
        filterType: 'bandpass', attack: 0.002, release: 0.065 },
    ],
    pulse: [
      { kind: 'tone', type: 'sine', frequency: 980, endFrequency: 870,
        duration: 0.07, gain: 0.018, attack: 0.002, release: 0.06 },
    ],
  },
};
