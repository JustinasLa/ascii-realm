// Four teardrop leaves woven together, with squared root curls at the corners.
const LEAF = [
  [-0.08, 0.18, '/'], [-0.30, 0.48, '/'], [-0.28, 0.85, '|'],
  [-0.15, 1.07, '\\'], [0, 1.24, '^'], [0.15, 1.07, '/'],
  [0.28, 0.85, '|'], [0.30, 0.48, '\\'],
];
const ROOT = [
  [0.48, 0.48, '+'], [0.75, 0.48, '-'], [1.03, 0.48, '+'],
  [1.03, 0.78, '|'], [1.03, 1.06, '+'], [0.75, 1.06, '-'],
  [0.48, 1.06, '+'], [0.48, 0.78, '|'], [0.72, 0.78, '-'], [0.72, 0.93, '+'],
];
const green = [131, 225, 106], weave = [216, 240, 157];
const wood = [178, 143, 84], pollen = [247, 222, 126];

// These turns copy the four leaves; the shared renderer applies world heading.
function turn(x, z, quarter) {
  return quarter === 0 ? [x, z] : quarter === 1 ? [z, -x]
    : quarter === 2 ? [-x, -z] : [-z, x];
}
function turnChar(char, quarter) {
  if (char === '^') return ['^', '>', 'v', '<'][quarter];
  if (!(quarter % 2)) return char;
  return char === '/' ? '\\' : char === '\\' ? '/' : char === '-' ? '|' : char === '|' ? '-' : char;
}

export default {
  id: 'cerrith-glyph',
  duration: 1.15,
  draw(effect, plot) {
    const p = Number.isFinite(effect.progress) ? Math.max(0, Math.min(1, effect.progress)) : 0;
    const age = Number.isFinite(effect.age) ? effect.age : 0;
    const fade = Math.min(1, (1 - p) * 5);
    const radius = Math.max(0.65, Math.min(2.6, Number.isFinite(effect.radius) ? effect.radius : 1));
    const projectile = effect.stage === 'projectile';
    const impact = effect.stage === 'impact';
    const casting = effect.stage === 'cast';
    const scale = projectile ? 0.29 : radius * (casting ? 0.42 + 0.58 * Math.min(1, p * 2.5)
      : impact ? 0.75 + 0.25 * Math.sin(p * Math.PI) : 0.9 + 0.035 * Math.sin(age * 2.3));
    const copy = (x, z, char, color, light, quarter) => {
      const [tx, tz] = turn(x * scale, z * scale, quarter);
      plot(tx, tz, turnChar(char, quarter), color, light * fade);
    };

    for (let leaf = 0; leaf < 4; leaf++) {
      // Leaves open away from the binding knot when the glyph lands.
      const opening = impact ? p * 0.55 : 0;
      for (let i = 0; i < LEAF.length; i++) {
        if (projectile && i % 2) continue;
        const [x, z, char] = LEAF[i];
        copy(x * (1 + opening), z + opening, char, green, 0.9, leaf);
      }
      if (!projectile) {
        copy(0, 0.47 + opening, '|', weave, 0.65, leaf);
        copy(0, 0.81 + opening, '|', weave, 0.8, leaf);
        if (impact) {
          // Two squared root hooks snap outward, instead of the casting spirals.
          for (const side of [-1, 1]) {
            copy(side * 0.43, 0.72, '|', wood, 0.85, leaf);
            copy(side * 0.43, 1.3 + p * 0.8, '+', wood, 0.9, leaf);
            copy(side * 0.18, 1.3 + p * 0.8, '-', wood, 0.75, leaf);
          }
        } else {
          for (const [x, z, char] of ROOT) copy(x, z, char, wood, 0.72, leaf);
        }
      }
      copy(0.13, 0.13, '/', weave, 1, leaf);
    }

    if (projectile) {
      // A compact clover seed trails alternating pollen beads behind its flight.
      for (let i = 0; i < 7; i++) {
        plot(Math.sin(age * 8 - i) * 0.10, -0.45 - i * 0.13, i % 3 ? '.' : 'o',
          pollen, (0.65 - i * 0.075) * fade);
      }
      return;
    }
    const orbit = scale * (impact ? 1.55 + p * 1.25 : 1.58);
    for (let bead = 0; bead < 8; bead++) {
      const angle = bead * Math.PI / 4 + age * (impact ? 1.6 : 0.65);
      plot(Math.cos(angle) * orbit, Math.sin(angle) * orbit, 'o', pollen,
        (0.64 + 0.18 * Math.sin(bead * 1.7 + age * 4)) * fade);
    }
  },
  sounds: {
    cast: [
      // A gently rolled G-major wooden chord: root, third, fifth and octave.
      { kind: 'tone', type: 'triangle', frequency: 196, duration: 0.56, gain: 0.065, attack: 0.004, release: 0.42, cutoff: 1250 },
      { kind: 'tone', type: 'triangle', frequency: 245, delay: 0.025, duration: 0.51, gain: 0.047, attack: 0.004, release: 0.39, cutoff: 1250 },
      { kind: 'tone', type: 'triangle', frequency: 294, delay: 0.05, duration: 0.47, gain: 0.044, attack: 0.004, release: 0.36, cutoff: 1250 },
      { kind: 'tone', type: 'triangle', frequency: 392, delay: 0.075, duration: 0.43, gain: 0.033, attack: 0.004, release: 0.33, cutoff: 1250 },
      { kind: 'noise', delay: 0.04, duration: 0.62, gain: 0.018, attack: 0.12, release: 0.36, cutoff: 560, filterType: 'bandpass' },
    ],
    impact: [
      { kind: 'tone', type: 'sine', frequency: 180, endFrequency: 82, duration: 0.12, gain: 0.085, attack: 0.002, release: 0.10 },
      { kind: 'noise', duration: 0.065, gain: 0.038, attack: 0.002, release: 0.055, cutoff: 740, filterType: 'lowpass' },
      { kind: 'tone', type: 'triangle', frequency: 147, delay: 0.065, duration: 0.30, gain: 0.036, attack: 0.006, release: 0.25, cutoff: 950 },
      { kind: 'tone', type: 'triangle', frequency: 196, delay: 0.095, duration: 0.36, gain: 0.031, attack: 0.006, release: 0.29, cutoff: 950 },
    ],
    pulse: [
      { kind: 'tone', type: 'triangle', frequency: 294, endFrequency: 280, duration: 0.10, gain: 0.010, attack: 0.012, release: 0.08, cutoff: 850 },
      { kind: 'noise', duration: 0.08, gain: 0.006, attack: 0.018, release: 0.05, cutoff: 450, filterType: 'bandpass' },
    ],
  },
};
