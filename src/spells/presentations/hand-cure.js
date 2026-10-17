// Five cupped fingers gather stitches; healing opens into a four-petal cross.
const leaf = [94, 214, 133], light = [183, 248, 175], gold = [255, 226, 159];
const tips = [[-1.05, 0.4], [-0.56, 1.04], [0, 1.28], [0.52, 1.12], [0.9, 0.75]];

export default {
  id: 'hand-cure',
  duration: 0.95,
  draw(effect, plot) {
    const p = effect.progress, fade = Math.max(0, Math.min(1, (1 - p) * 4));
    const scale = Math.min(1.25, Math.max(0.75, effect.radius));
    const put = (x, z, char, color = leaf, strength = 1) => plot(x * scale, z * scale, char, color, fade * strength);
    if (effect.stage === 'cast' || effect.stage === 'projectile') {
      const flying = effect.stage === 'projectile', size = flying ? 0.36 : 1;
      const hand = (x, z, char, color = leaf) => put(x * size, z * size, char, color);
      const segments = flying ? 4 : 6;
      // Unequal finger lengths and a shorter thumb keep this a hand, not a star.
      for (let finger = 0; finger < tips.length; finger++) {
        const [tx, tz] = tips[finger], root = (finger - 2) * 0.13;
        for (let j = 1; j <= segments; j++) {
          const t = j / segments;
          const x = root + (tx * (1 - p * 0.22) - root) * t + Math.sin(t * Math.PI) * (finger - 2) * 0.035;
          const z = -0.28 + Math.abs(finger - 2) * 0.08 + (tz + 0.28 + p * 0.12) * t;
          hand(x, z, j === segments ? "'" : finger === 2 ? '|' : finger < 2 ? '/' : '\\', j === segments ? gold : light);
        }
      }
      const palmSteps = flying ? 6 : 10;
      for (let i = 0; i <= palmSteps; i++) {
        const angle = -Math.PI / 2 + i / palmSteps * Math.PI;
        hand(Math.sin(angle) * 0.53, -0.22 - Math.cos(angle) * 0.34, i === palmSteps / 2 ? '_' : '.', leaf);
      }
      for (const side of [-1, 1]) {
        hand(side * 0.2, -0.7, '|', light);
        if (!flying) hand(side * 0.2, -0.9, '|', leaf);
      }
      if (flying) {
        for (let i = 0; i < 8; i++) put(Math.sin(effect.age * 9 + i) * 0.06, -0.38 - i * 0.13, i % 2 ? ':' : '-', leaf, 0.65 - i * 0.06);
      } else {
        // Opposed stitches travel inward toward the cupped palm.
        for (const side of [-1, 1]) for (let row = 0; row < 3; row++) {
          const x = side * (1.12 - p * 0.82), z = -0.38 + row * 0.28;
          put(x, z, '-', light);
          put(x + side * 0.08, z - 0.07, '/', leaf);
          put(x - side * 0.08, z + 0.07, '\\', leaf);
        }
      }
      hand(0, -0.2, '+', gold);
      return;
    }
    const quiet = effect.stage === 'pulse', bloom = (quiet ? 0.65 : 1) * (0.72 + p * 0.5);
    const petalSteps = quiet ? 3 : 5;
    for (let arm = 0; arm < 4; arm++) {
      const angle = arm * Math.PI / 2, dx = Math.cos(angle), dz = Math.sin(angle);
      for (let j = 1; j < petalSteps; j++) {
        const t = j / petalSteps, r = (0.12 + t * 0.63) * bloom, width = Math.sin(t * Math.PI) * 0.22 * bloom;
        put(dx * r - dz * width, dz * r + dx * width, '(', light);
        put(dx * r + dz * width, dz * r - dx * width, ')', leaf);
      }
      put(dx * 0.75 * bloom, dz * 0.75 * bloom, '*', gold);
      put(dx * 0.3 * bloom, dz * 0.3 * bloom, arm % 2 ? '|' : '-', light);
    }
    for (const x of [-1, 1]) for (const z of [-1, 1]) {
      const stitch = (0.8 - p * 0.55) * bloom;
      put(x * stitch, z * stitch, x === z ? '/' : '\\', leaf, 0.8);
      put(x * stitch * 0.8, z * stitch, '-', light, 0.8);
    }
    put(0, 0, '+', gold);
  },
  sounds: {
    cast: [
      { kind: 'tone', type: 'triangle', frequency: 261.63, endFrequency: 254, delay: 0, duration: 0.27, gain: 0.055, attack: 0.002, release: 0.25, cutoff: 1500 },
      { kind: 'tone', type: 'triangle', frequency: 329.63, endFrequency: 320, delay: 0.09, duration: 0.3, gain: 0.045, attack: 0.002, release: 0.28, cutoff: 1600 },
      { kind: 'tone', type: 'triangle', frequency: 392, endFrequency: 384, delay: 0.23, duration: 0.35, gain: 0.04, attack: 0.003, release: 0.33, cutoff: 1800 },
      { kind: 'tone', type: 'sine', frequency: 196, delay: 0.03, duration: 0.52, gain: 0.035, attack: 0.035, release: 0.43 },
      { kind: 'tone', type: 'sine', frequency: 784, delay: 0.36, duration: 0.38, gain: 0.022, attack: 0.004, release: 0.36 },
    ],
    impact: [
      { kind: 'tone', type: 'triangle', frequency: 554.37, endFrequency: 548, delay: 0, duration: 0.28, gain: 0.05, attack: 0.002, release: 0.26, cutoff: 2000 },
      { kind: 'tone', type: 'triangle', frequency: 440, endFrequency: 432, delay: 0.06, duration: 0.32, gain: 0.04, attack: 0.002, release: 0.3, cutoff: 1800 },
      { kind: 'tone', type: 'triangle', frequency: 349.23, endFrequency: 344, delay: 0.18, duration: 0.38, gain: 0.035, attack: 0.003, release: 0.36, cutoff: 1600 },
      { kind: 'tone', type: 'sine', frequency: 220, delay: 0.02, duration: 0.55, gain: 0.032, attack: 0.03, release: 0.46 },
      { kind: 'tone', type: 'sine', frequency: 1046.5, delay: 0.26, duration: 0.42, gain: 0.019, attack: 0.003, release: 0.4 },
    ],
    pulse: [
      { kind: 'tone', type: 'triangle', frequency: 329.63, delay: 0, duration: 0.15, gain: 0.016, attack: 0.002, release: 0.14, cutoff: 1200 },
      { kind: 'tone', type: 'sine', frequency: 659.26, delay: 0.055, duration: 0.18, gain: 0.01, attack: 0.003, release: 0.17 },
    ],
  },
};
