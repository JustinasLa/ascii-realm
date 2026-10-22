// A small inward ripple and rising blue motes mark the returning mana.
export default {
  id: 'mana-spring', duration: 0.7,
  draw(effect, plot) {
    const { progress: p, age, heading } = effect;
    const fade = Math.sin(Math.PI * p), radius = (effect.stage === 'cast' ? 1 : 0.65) * (1 - p * 0.45);
    const c = Math.cos(heading), s = Math.sin(heading);
    const put = (x, z, char, color, light) => plot(x * c - z * s, x * s + z * c, char, color, light);
    for (let i = 0; i < 24; i++) {
      const a = i / 24 * Math.PI * 2 + age * 0.6;
      put(Math.cos(a) * radius, Math.sin(a) * radius * 0.5, '~', [64, 178, 236], fade * 0.55);
    }
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2 + age;
      put(Math.cos(a) * radius * 0.7, -p * 2.5 + Math.sin(a) * 0.3,
        i % 2 ? '.' : '+', [142, 224, 255], fade * 0.75);
    }
  },
  sounds: {
    cast: [{ kind: 'recording', url: '/assets/audio/spells/mitlan/spring-draw.wav', gain: 0.18, rate: 1.15, delay: 0 }],
    impact: [{ kind: 'recording', url: '/assets/audio/spells/mitlan/spring-return.wav', gain: 0.1, rate: 1.12, delay: 0 }],
    pulse: [{ kind: 'recording', url: '/assets/audio/spells/mitlan/spring-return.wav', gain: 0.05, rate: 1.18, delay: 0 }],
  },
};
