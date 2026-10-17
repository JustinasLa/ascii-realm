// A hooked breaker rolls forward, then spills into a broad sheet of foam.
const water = [35, 151, 177], current = [65, 205, 209], foam = [222, 255, 246];
const lip = [
  [-1.4, -0.7], [-1.55, -0.1], [-1.45, 0.55], [-1.1, 1.16],
  [-0.55, 1.58], [0.15, 1.74], [0.8, 1.56], [1.15, 1.12],
  [1.08, 0.72], [0.73, 0.5], [0.35, 0.61], [0.23, 0.89], [0.47, 1.1],
];

function breaker(plot, scale, rise, offset, age, fade) {
  // Follow the lip around and back inside its own crest: an open curl, not a ring.
  for (let i = 0; i < lip.length - 1; i++) {
    for (let j = 0; j < 2; j++) {
      const t = j / 2, x = lip[i][0] * (1 - t) + lip[i + 1][0] * t;
      const z = lip[i][1] * (1 - t) + lip[i + 1][1] * t;
      plot(x * scale, z * scale * rise + offset, i < 3 ? '/' : j ? '.' : '-', i < 3 ? water : foam, fade);
    }
  }
  // Three curved current ribs climb the face below the foam.
  for (let rib = 0; rib < 3; rib++) {
    for (let i = 0; i < 5; i++) {
      const x = -1.2 + i * 0.29 + rib * 0.08;
      const z = -0.52 + rib * 0.35 + Math.sin(i * 0.48) * 0.35;
      plot(x * scale, z * scale * rise + offset, '~', current, fade * 0.68);
    }
  }
  for (let i = 0; i < 8; i++) {
    const drift = (age * 1.7 + i * 0.17) % 1;
    plot((-1.35 + i * 0.35) * scale, (-0.75 - drift * 0.9) * scale + offset,
      i % 2 ? '.' : '_', i % 2 ? foam : water, fade * (0.48 - drift * 0.3));
  }
}

export default {
  id: 'crashing-wave', duration: 1.15,
  draw(effect, plot) {
    const p = Math.max(0, Math.min(1, Number.isFinite(effect.progress) ? effect.progress : 0));
    const age = Number.isFinite(effect.age) ? effect.age : 0;
    const fade = Math.min(1, (1 - p) * 3);
    if (effect.stage === 'impact') {
      const spread = 0.8 + p * 2.9;
      // Dashed wash front bows forward; separate droplets tumble beyond it.
      for (let i = 0; i < 13; i++) {
        const side = (i - 6) / 6, front = (1 - side * side) * (0.5 + p * 1.3);
        plot(side * spread, front, i % 2 ? '.' : '-', foam, fade);
        plot(side * spread * 0.9, front - 0.32 - p * 0.7, '~', current, fade * 0.6);
      }
      for (let lane = 0; lane < 7; lane++) {
        const side = (lane - 3) / 3;
        for (let bead = 0; bead < 4; bead++) {
          const tumble = (p + bead * 0.12 + lane * 0.025) % 1;
          const x = side * (0.6 + tumble * 2.8) + Math.sin(tumble * 8 + lane) * 0.16;
          const z = 0.2 + tumble * 2.4 + Math.sin(tumble * Math.PI) * (0.9 - Math.abs(side) * 0.3);
          plot(x, z, bead === 0 ? 'o' : '.', foam, fade * (0.85 - bead * 0.12));
        }
      }
      return;
    }
    if (effect.stage === 'projectile') {
      breaker(plot, 0.58, 1, 0, age, fade);
      return;
    }
    // Cast gathers height before release. Pulses/zones retain the same curling motif.
    breaker(plot, effect.stage === 'cast' ? 1.05 : 0.7,
      0.45 + Math.min(1, p * 1.7) * 0.55, p * 0.35, age, fade);
  },
  sounds: {
    cast: [
      { kind: 'noise', duration: 0.68, gain: 0.07, cutoff: 520, filterType: 'lowpass', attack: 0.3, release: 0.3 },
      { kind: 'noise', delay: 0.12, duration: 0.56, gain: 0.055, cutoff: 950, filterType: 'bandpass', attack: 0.18, release: 0.3 },
      { kind: 'tone', type: 'sine', frequency: 80, endFrequency: 48, duration: 0.66, gain: 0.032, attack: 0.2, release: 0.4 },
      { kind: 'noise', delay: 0.35, duration: 0.38, gain: 0.04, cutoff: 2300, filterType: 'highpass', attack: 0.12, release: 0.22 },
    ],
    impact: [
      { kind: 'tone', type: 'sine', frequency: 104, endFrequency: 34, duration: 0.42, gain: 0.12, attack: 0.006, release: 0.38 },
      { kind: 'noise', duration: 0.32, gain: 0.08, cutoff: 340, filterType: 'lowpass', attack: 0.005, release: 0.28 },
      { kind: 'noise', delay: 0.035, duration: 0.9, gain: 0.1, cutoff: 1400, filterType: 'bandpass', attack: 0.012, release: 0.7 },
      { kind: 'noise', delay: 0.13, duration: 1.45, gain: 0.055, cutoff: 2900, filterType: 'highpass', attack: 0.16, release: 1.12 },
    ],
    pulse: [{ kind: 'noise', duration: 0.08, gain: 0.016, cutoff: 1200, filterType: 'bandpass', attack: 0.015, release: 0.06 }],
  },
};
