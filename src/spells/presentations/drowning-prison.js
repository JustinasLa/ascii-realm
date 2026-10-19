// Water bends into a barred cell; the pale beads rise inside its sealed caps.
const water = [42, 170, 190], edge = [117, 233, 237], bubble = [204, 255, 246];
const clamp = value => Math.max(0, Math.min(1, value));

export default {
  id: 'drowning-prison',
  duration: 1.2,
  draw(effect, plot) {
    const p = clamp(Number.isFinite(effect.progress) ? effect.progress : 0);
    const age = Number.isFinite(effect.age) ? effect.age : 0;
    const fade = clamp((1 - p) * 4);
    if (effect.stage === 'projectile') {
      // A tiny barred capsule carries its own recognisable bubble wake.
      for (const side of [-1, 1]) {
        for (let j = 0; j < 4; j++) {
          plot(side * (0.26 + Math.sin(age * 8 + j) * 0.025), j * 0.2 - 0.3, '|', water, fade);
        }
        for (let j = -2; j <= 2; j++) plot(j * 0.13, side * 0.3, '-', edge, fade);
      }
      for (let j = 0; j < 4; j++) {
        plot(Math.sin(age * 7 - j) * 0.11, -0.5 - j * 0.2, j % 2 ? '.' : 'o', bubble, fade * (0.8 - j * 0.13));
      }
      return;
    }

    const casting = effect.stage === 'cast', impact = effect.stage === 'impact';
    const size = Math.max(1, Math.min(1.65, Number.isFinite(effect.radius) ? effect.radius : 1));
    const closure = casting ? Math.min(1, p * 1.5) : impact ? Math.min(1, p * 3) : 0.8;
    const width = (1.35 - closure * 0.4) * size;
    const depth = (1.65 - closure * 0.35) * size;
    const pressure = impact ? 0.27 : 0.16;
    for (let bar = -2; bar <= 2; bar++) {
      for (let j = 0; j < 7; j++) {
        const t = j / 6;
        const bend = Math.sin(t * Math.PI) * Math.sin(age * 5 + bar * 1.1) * pressure;
        plot(bar * width / 2 + bend, (t * 2 - 1) * depth, '|', water, fade * 0.88);
      }
    }
    // The two split lids close their central gaps before the prison compresses.
    const gap = casting ? (1 - closure) * width * 0.7 : 0;
    for (const cap of [-1, 1]) {
      for (let j = -5; j <= 5; j++) {
        const x = j * width / 5;
        if (Math.abs(x) < gap) continue;
        plot(x, cap * depth, Math.abs(j) === 5 ? '+' : '-', edge, fade);
      }
      if (impact) plot(0, cap * (depth - 0.16 * (1 - p)), '#', bubble, fade);
    }
    for (let chain = -1; chain <= 1; chain++) {
      for (let bead = 0; bead < 5; bead++) {
        const rise = (bead / 5 + age * 0.38 + chain * 0.07 + 1) % 1;
        plot(chain * width * 0.62 + Math.sin(rise * 7 + age * 3) * 0.07,
          depth * (1 - 2 * rise), bead % 2 ? ':' : 'o', bubble, fade * (0.6 + rise * 0.35));
      }
    }
  },
  sounds: {
    cast: [
      { kind: 'tone', type: 'sine', frequency: 116, endFrequency: 103, duration: 0.9, gain: 0.09, attack: 0.015, release: 0.75, cutoff: 540 },
      { kind: 'tone', type: 'triangle', frequency: 273, endFrequency: 242, duration: 0.72, gain: 0.035, attack: 0.012, release: 0.65, cutoff: 600 },
      { kind: 'tone', type: 'sine', delay: 0.2, frequency: 260, endFrequency: 410, duration: 0.14, gain: 0.045, attack: 0.015, release: 0.105 },
      { kind: 'tone', type: 'sine', delay: 0.43, frequency: 350, endFrequency: 570, duration: 0.12, gain: 0.04, attack: 0.01, release: 0.09 },
      { kind: 'tone', type: 'sine', delay: 0.61, frequency: 475, endFrequency: 760, duration: 0.1, gain: 0.035, attack: 0.01, release: 0.08 },
      { kind: 'noise', delay: 0.16, duration: 0.65, gain: 0.025, attack: 0.12, release: 0.4, cutoff: 460, filterType: 'lowpass' },
    ],
    impact: [
      { kind: 'tone', type: 'sine', frequency: 94, endFrequency: 43, duration: 0.52, gain: 0.095, attack: 0.06, release: 0.4 },
      { kind: 'noise', duration: 0.33, gain: 0.065, attack: 0.025, release: 0.27, cutoff: 340, filterType: 'lowpass' },
      { kind: 'tone', type: 'triangle', delay: 0.13, frequency: 186, endFrequency: 98, duration: 0.24, gain: 0.04, attack: 0.025, release: 0.19, cutoff: 360 },
      { kind: 'tone', type: 'sine', delay: 0.26, frequency: 590, endFrequency: 860, duration: 0.1, gain: 0.025, attack: 0.01, release: 0.08 },
    ],
    pulse: [
      { kind: 'tone', type: 'sine', frequency: 225, endFrequency: 330, duration: 0.1, gain: 0.018, attack: 0.02, release: 0.07 },
    ],
  },
};
