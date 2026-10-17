// Two open mana gates exchange paired packets; the receiver closes around them.
const blue = [89, 187, 255], green = [112, 242, 164], pale = [201, 255, 236];

function gate(plot, z, width, color, light) {
  // Outer and inner brackets remain open towards the packet channel.
  for (const side of [-1, 1]) {
    const char = side < 0 ? '[' : ']';
    plot(side * width, z, char, color, light);
    plot(side * (width - 0.16), z, char, pale, light * 0.8);
    plot(side * width, z - 0.23, side < 0 ? '/' : '\\', color, light * 0.7);
    plot(side * width, z + 0.23, side < 0 ? '\\' : '/', color, light * 0.7);
  }
}

export default {
  id: 'mana-transfer', duration: 1.12,
  draw(effect, plot) {
    const p = effect.progress, fade = Math.max(0, Math.min(1, (1 - p) * 3));
    const clock = effect.age;
    if (effect.stage === 'projectile') {
      // Compact paired packet silhouette, with an alternating bead wake.
      plot(-0.28, 0.05, '[', blue, fade); plot(0.28, 0.05, ']', green, fade);
      plot(-0.1, 0.12, 'o', pale, fade); plot(0.1, 0.12, 'o', green, fade);
      for (let i = 0; i < 6; i++) {
        const sway = Math.sin(clock * 12 - i * 0.8) * 0.07;
        plot(-0.1 + sway, -0.18 - i * 0.17, i < 2 ? 'o' : '.', i % 2 ? green : blue, fade * (0.7 - i * 0.08));
        plot(0.1 - sway, -0.25 - i * 0.17, '.', i % 2 ? blue : green, fade * (0.6 - i * 0.075));
      }
      return;
    }
    if (effect.stage === 'impact') {
      const width = 0.65 - p * 0.3;
      gate(plot, 0, width, green, fade);
      // Receiving reservoirs swell into two round notes, then shed paired sparks.
      plot(-0.15 - p * 0.1, 0, 'O', blue, fade);
      plot(0.15 + p * 0.1, 0, 'O', green, fade);
      for (let i = 0; i < 5; i++) {
        const z = 0.28 + i * 0.13 + p * 0.6;
        plot(-0.2 - i * 0.055, z, i === 0 ? '+' : ':', blue, fade * (0.9 - i * 0.12));
        plot(0.2 + i * 0.055, z, i === 0 ? '+' : ':', green, fade * (0.9 - i * 0.12));
      }
      return;
    }
    const active = effect.stage !== 'cast';
    const span = active ? 1 : 0.72 + p * 0.38;
    const width = active ? 0.5 : 0.36 + p * 0.19;
    gate(plot, -span, width, blue, fade);
    gate(plot, span, width, green, fade);
    // Offset lanes make visibly travelling packets, rather than a static beam.
    for (let i = 0; i < 6; i++) {
      const travel = ((clock * 1.5 + i / 6) % 1 + 1) % 1;
      const z = -span + travel * span * 2;
      const bend = Math.sin(travel * Math.PI * 2) * 0.08;
      const color = i % 2 ? green : blue;
      plot(-0.14 + bend, z, 'o', color, fade * 0.95);
      plot(0.14 - bend, z - 0.09, 'o', i % 2 ? blue : green, fade * 0.85);
      plot(-0.14 + bend, z - 0.12, '.', color, fade * 0.35);
      plot(0.14 - bend, z - 0.21, '.', pale, fade * 0.3);
    }
  },
  sounds: {
    cast: [
      { kind: 'tone', type: 'sine', frequency: 238, endFrequency: 177, duration: 0.12, gain: 0.075, attack: 0.002, release: 0.1 },
      { kind: 'tone', type: 'sine', frequency: 356, endFrequency: 248, delay: 0.13, duration: 0.13, gain: 0.065, attack: 0.002, release: 0.11 },
      { kind: 'tone', type: 'sine', frequency: 238, endFrequency: 177, delay: 0.29, duration: 0.12, gain: 0.055, attack: 0.002, release: 0.1 },
      { kind: 'tone', type: 'sine', frequency: 356, endFrequency: 248, delay: 0.42, duration: 0.13, gain: 0.05, attack: 0.002, release: 0.11 },
      { kind: 'tone', type: 'sine', frequency: 520, endFrequency: 1160, delay: 0.16, duration: 0.44, gain: 0.032, attack: 0.06, release: 0.13 },
    ],
    impact: [
      { kind: 'tone', type: 'triangle', frequency: 784, endFrequency: 780, duration: 0.23, gain: 0.055, attack: 0.003, release: 0.2, cutoff: 1800 },
      { kind: 'tone', type: 'triangle', frequency: 1176, endFrequency: 1168, delay: 0.095, duration: 0.28, gain: 0.04, attack: 0.003, release: 0.24, cutoff: 2400 },
    ],
    pulse: [
      { kind: 'tone', type: 'sine', frequency: 356, endFrequency: 310, duration: 0.075, gain: 0.018, attack: 0.002, release: 0.06 },
      { kind: 'tone', type: 'sine', frequency: 534, endFrequency: 465, delay: 0.065, duration: 0.075, gain: 0.015, attack: 0.002, release: 0.06 },
    ],
  },
};
