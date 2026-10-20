// A blessing of living light. The caster gathers motes into a six-petal rosette,
// a halo garland beats with every channelled pulse, each healing bolt is a seed
// of light trailing a twisted vine, and the bolt's path stays lit as a braided
// ribbon that tiles from tick to tick. Local metres only; +z is the cast heading.
const TAU = Math.PI * 2;
const RAMP = '.:+*@';
const STOPS = [[62, 150, 92], [112, 206, 108], [190, 238, 124], [255, 234, 150], [255, 252, 232]];
// Deep leaf -> fresh green -> lime -> gold -> white light, precomputed once.
const HEAT = Array.from({ length: 33 }, (_, i) => {
  const t = i / 32 * (STOPS.length - 1), k = Math.min(STOPS.length - 2, Math.floor(t)), f = t - k;
  return STOPS[k].map((c, j) => Math.round(c + (STOPS[k + 1][j] - c) * f));
});
const PETAL = [255, 214, 226], BLUSH = [246, 178, 204];

const clamp01 = v => Math.min(1, Math.max(0, v));
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const outCubic = t => 1 - (1 - clamp01(t)) ** 3;
const inCubic = t => clamp01(t) ** 3;
const outBack = t => { const u = clamp01(t) - 1; return 1 + 2.2 * u * u * u + 1.2 * u * u; };
const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const heat = t => HEAT[Math.round(clamp01(t) * 32)];
const glyph = t => RAMP[Math.min(4, Math.floor(clamp01(t) * 4.999))];

// One twisted strand pair; depth makes the near strand bright and the far one dim.
function braid(plot, { z0, z1, samples, amplitude, wavelength, twist, light, taper = 0.4, thin = 0, seed = 0 }) {
  const k = TAU / wavelength;
  for (let s = 0; s < 2; s++) {
    for (let i = 0; i < samples; i++) {
      const u = i / (samples - 1), z = z0 + (z1 - z0) * u;
      const ends = smooth(0, taper, u) * smooth(1, 1 - taper * 0.35, u);
      const keep = clamp01((hash(i * 2 + s + seed) - thin) * 6);
      const phase = k * z + twist + s * Math.PI, depth = Math.cos(phase);
      const level = light(u) * ends * keep;
      if (level <= 0.01) continue;
      const near = 0.5 + depth * 0.5;
      plot(Math.sin(phase) * amplitude(u), z, glyph(0.15 + near * 0.62 * Math.min(1, level * 1.4)),
        heat(0.22 + near * 0.5 * level), level * (0.45 + near * 0.55));
    }
  }
}

function drawCast(effect, plot) {
  const p = effect.progress, age = effect.age, end = clamp01((1 - p) * 3.2);
  // Anticipation: motes spiral inward and a faint ring sweeps closed around the caster.
  // Delayed motes (up to 0.21 behind) keep converging past the release until each fades out.
  const gatherRaw = p / 0.3, gather = clamp01(gatherRaw);
  if (gatherRaw < 1.21) {
    for (let i = 0; i < 14; i++) {
      const start = 1.55 + hash(i) * 0.5, a0 = i / 14 * TAU + hash(i + 40) * 0.4;
      for (let trail = 0; trail < 3; trail++) {
        const t = clamp01(gatherRaw - trail * 0.045 - hash(i + 9) * 0.12);
        if (t >= 1) continue;
        const r = start * (1 - inCubic(t) * 0.94), a = a0 + t * 2.4;
        const level = (0.15 + 0.85 * smooth(0, 0.25, t)) * (1 - smooth(0.82, 1, t)) * (1 - trail * 0.32) * smooth(0, 0.06, p + 0.02);
        if (level > 0.02 || !trail) plot(Math.cos(a) * r, Math.sin(a) * r, trail ? '.' : glyph(0.35 + t * 0.5), heat(0.3 + t * 0.6), level);
      }
    }
  }
  const ringLevel = smooth(0, 0.3, p) * (1 - smooth(0.4, 0.8, p));
  if (ringLevel > 0.01) {
    const sweep = outCubic(gather), ringR = 1.2 + outCubic((p - 0.3) / 0.5) * 0.3;
    for (let i = 0; i < 40; i++) {
      const u = i / 40;
      if (u > sweep) break;
      const a = u * TAU - Math.PI / 2, crest = 0.5 + 0.5 * Math.cos(a * 3 - age * 4);
      plot(Math.cos(a) * ringR, Math.sin(a) * ringR, crest > 0.7 ? '+' : ':', heat(0.3 + crest * 0.35), ringLevel * (0.4 + crest * 0.45));
    }
  }
  // Release: a white-gold flash with four short rays at the end of the wind-up.
  const flash = smooth(0.24, 0.31, p) * (1 - smooth(0.33, 0.5, p));
  if (flash > 0.01) {
    plot(0, 0, '@', heat(1), flash);
    for (let ray = 0; ray < 4; ray++) {
      const a = ray * TAU / 4 + Math.PI / 4;
      for (let j = 1; j <= 4; j++) {
        const r = j * 0.15 * (0.6 + flash * 0.6);
        plot(Math.cos(a) * r, Math.sin(a) * r, RAMP[4 - j], heat(1 - j * 0.15), flash * (1 - j * 0.18));
      }
    }
  }
  // Bloom: a six-petal rosette opens with overshoot, turns slowly and dissolves from the tips.
  const open = outBack((p - 0.26) / 0.3), dissolve = smooth(0.62, 1, p);
  if (open > 0) {
    const L = 1.05 * open, turn = age * 0.35;
    for (let i = 0; i < 84; i++) {
      const phi = i / 84 * TAU, petalR = Math.abs(Math.cos(3 * (phi - turn)));
      if (petalR < 0.22) continue;
      const tip = petalR ** 2, level = clamp01((hash(i + 70) + 0.1 - dissolve * (0.6 + tip * 0.6)) * 4) * end;
      if (level <= 0.01) continue;
      const r = L * petalR;
      plot(Math.cos(phi) * r, Math.sin(phi) * r, glyph(0.3 + tip * 0.46), heat(0.42 + tip * 0.5 * (1 - dissolve * 0.5)), level * (0.6 + tip * 0.4));
    }
    // Each petal has a bright midrib so the rosette reads as a flower, not a scatter.
    for (let k = 0; k < 6; k++) {
      const a = turn + k * Math.PI / 3, ca = Math.cos(a), sa = Math.sin(a);
      for (let j = 1; j <= 5; j++) {
        const u = j / 6, level = clamp01((hash(k * 7 + j + 140) + 0.2 - dissolve * (0.5 + u)) * 4) * end;
        if (level > 0.01) plot(ca * L * u, sa * L * u, j < 3 ? ':' : '+', heat(0.35 + u * 0.45), level * (0.5 + u * 0.4));
      }
    }
    for (let i = 0; i < 36; i++) {
      const phi = i / 36 * TAU, petalR = Math.abs(Math.cos(3 * (phi - turn) + Math.PI / 2));
      if (petalR < 0.3) continue;
      const level = clamp01((hash(i + 170) + 0.25 - dissolve * 1.3) * 4) * end;
      if (level > 0.01) plot(Math.cos(phi) * L * 0.5 * petalR, Math.sin(phi) * L * 0.5 * petalR, petalR > 0.8 ? '+' : '.', heat(0.12 + petalR * 0.25), level * 0.7);
    }
    plot(0, 0, open > 0.6 ? '*' : '+', heat(0.85), smooth(0, 0.4, open) * end * 0.9);
  }
  // Follow-through: petals shed from the tips, drift outward with drag and curl on a breeze.
  const shed = clamp01((p - 0.5) / 0.5);
  if (shed > 0) {
    for (let i = 0; i < 14; i++) {
      const t = clamp01(shed * 1.25 - hash(i + 220) * 0.25);
      if (t <= 0) continue;
      const a = (i % 6) / 6 * TAU + age * 0.35 + (hash(i + 5) - 0.5) * 0.5 + t * 0.7;
      const r = 1.0 + (0.5 + hash(i + 33)) * (1 - Math.exp(-3 * t)) * 0.9;
      const sway = Math.sin(age * 5 + i * 1.7) * 0.06;
      plot(Math.cos(a) * r + sway, Math.sin(a) * r, i % 2 ? '\'' : ',', i % 3 ? PETAL : BLUSH,
        smooth(0, 0.15, t) * (1 - t) * end);
    }
  }
}

function drawAura(effect, plot) {
  // A halo garland that swells with each channelled heartbeat. Works at 0.3 s and 1.5 s lives.
  const p = effect.progress, age = effect.age;
  const level = smooth(0, 0.18, p) * clamp01((1 - p) * 2.6);
  if (level <= 0) { plot(0, 0, '.', heat(0.3), 0); return; }
  const swell = outCubic(p), ringR = 1.0 + swell * 0.22, spin = age * 1.2;
  for (let i = 0; i < 48; i++) {
    const a = i / 48 * TAU, crest = 0.5 + 0.5 * Math.cos(2 * (a - spin));
    plot(Math.cos(a) * ringR, Math.sin(a) * ringR, glyph(0.15 + crest * 0.44), heat(0.25 + crest * 0.5), level * (0.35 + crest * 0.6));
  }
  // Six budding leaves ride the ring: a bright bud flanked by two leaf tips along the tangent.
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * TAU + spin * 0.5, ca = Math.cos(a), sa = Math.sin(a);
    const r = ringR + 0.06, bud = 0.6 + 0.4 * Math.sin(age * 6 + i * 2.1);
    plot(ca * r, sa * r, '*', heat(0.7 + bud * 0.3), level * bud);
    for (const side of [-1, 1]) plot(ca * r - sa * 0.11 * side, sa * r + ca * 0.11 * side, 'o', heat(0.35), level * 0.7);
    plot(ca * (r + 0.13), sa * (r + 0.13), '\'', heat(0.45), level * 0.6);
  }
  const innerR = 0.62 - swell * 0.06;
  for (let i = 0; i < 24; i++) {
    const a = i / 24 * TAU - spin * 1.4;
    plot(Math.cos(a) * innerR, Math.sin(a) * innerR, i % 4 ? '.' : ':', heat(0.15), level * 0.45);
  }
  // Light motes orbit between the rings with a little radial breathing.
  for (let i = 0; i < 10; i++) {
    const a = hash(i) * TAU + age * (0.9 + hash(i + 3) * 0.8);
    const r = 0.7 + hash(i + 7) * 0.45 + Math.sin(age * 3 + i) * 0.05;
    plot(Math.cos(a) * r, Math.sin(a) * r, '+', heat(0.75), level * (0.5 + 0.5 * Math.sin(age * 7 + i * 1.3) ** 2));
    plot(Math.cos(a - 0.14) * r, Math.sin(a - 0.14) * r, '.', heat(0.5), level * 0.35);
  }
}

function drawProjectile(effect, plot) {
  // A seed of light with a turning petal crown, trailing a twisted vine and shed motes.
  const age = effect.age, fade = clamp01((1 - effect.progress) * 4);
  plot(0, 0.04, '@', heat(1), fade);
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * TAU + age * 9;
    plot(Math.cos(a) * 0.17, Math.sin(a) * 0.17, i % 2 ? '+' : '*', heat(i % 2 ? 0.55 : 0.85), fade * 0.9);
  }
  braid(plot, { z0: -0.12, z1: -2.7, samples: 26, wavelength: 1.3, twist: -age * 14,
    amplitude: u => 0.2 * Math.sin(Math.PI * Math.min(1, u * 1.6 + 0.2)) * (1 - u * 0.4),
    light: u => fade * (1 - u) ** 1.2, taper: 0.06 });
  for (let i = 0; i < 12; i++) {
    const u = (age * 1.9 + hash(i)) % 1, side = i % 2 ? 1 : -1;
    const x = (hash(i + 20) - 0.5) * 0.14 + side * u ** 1.4 * 0.5 + Math.sin(age * 8 + i) * 0.04;
    plot(x, -0.2 - u * 2.6, u < 0.4 ? '\'' : '.', heat(0.8 - u * 0.5), fade * smooth(0, 0.08, u) * (1 - u) * 0.85);
  }
}

function drawImpact(effect, plot) {
  // Strong frame: white flash and starburst, then a leafy shock ring, a rosette that blooms
  // and closes, and healing motes that spiral into the ally.
  const p = effect.progress, age = effect.age, end = clamp01((1 - p) * 3);
  const flash = 1 - smooth(0, 0.3, p);
  plot(0, 0, flash > 0.4 ? '@' : '*', heat(0.75 + flash * 0.25), Math.max(flash, 0.6 * smooth(0.6, 0.85, 1 - p)) * end);
  if (flash > 0.01) {
    const reach = 0.25 + outCubic(p / 0.18) * 0.75;
    for (let ray = 0; ray < 8; ray++) {
      const a = ray * TAU / 8, len = ray % 2 ? 0.65 : 1;
      for (let j = 1; j <= 4; j++) {
        const r = j / 4 * reach * len;
        plot(Math.cos(a) * r, Math.sin(a) * r, RAMP[4 - j], heat(1 - j * 0.16), flash * (1.1 - j * 0.22));
      }
    }
  }
  const wave = outCubic(p / 0.7), ringR = 0.25 + wave * 1.25;
  const ringLevel = smooth(0, 0.05, p) * (1 - smooth(0.35, 0.8, p));
  if (ringLevel > 0.01) {
    for (let i = 0; i < 48; i++) {
      const a = i / 48 * TAU, keep = clamp01((hash(i + 90) + 0.5 - wave * 0.7) * 5);
      plot(Math.cos(a) * ringR, Math.sin(a) * ringR, i % 6 === 0 ? 'o' : glyph(0.7 - wave * 0.45), heat(0.9 - wave * 0.6), ringLevel * keep);
      if (i % 2 === 0) plot(Math.cos(a + 0.06) * ringR * 0.84, Math.sin(a + 0.06) * ringR * 0.84, '.', heat(0.3), ringLevel * keep * 0.5);
    }
  }
  const bloom = outBack((p - 0.08) / 0.32) * (1 - inCubic((p - 0.55) / 0.45) * 0.7);
  if (bloom > 0) {
    const L = 0.72 * bloom, turn = -age * 0.8;
    for (let i = 0; i < 60; i++) {
      const phi = i / 60 * TAU, petalR = Math.abs(Math.cos(3 * (phi - turn)));
      if (petalR < 0.22) continue;
      const tip = petalR ** 2;
      plot(Math.cos(phi) * L * petalR, Math.sin(phi) * L * petalR, glyph(0.3 + tip * 0.5), heat(0.35 + tip * 0.55), end * (0.5 + tip * 0.5));
    }
  }
  const draw = clamp01((p - 0.2) / 0.8);
  if (draw > 0) {
    for (let i = 0; i < 12; i++) {
      const t = clamp01(draw * 1.3 - hash(i + 50) * 0.3), a0 = i / 12 * TAU + hash(i) * 0.3;
      for (let trail = 0; trail < 3; trail++) {
        const tt = clamp01(t - trail * 0.05), r = (1.45 + hash(i + 8) * 0.3) * (1 - outCubic(tt) * 0.92), a = a0 - tt * 2.2;
        const level = smooth(0, 0.15, tt) * (1 - smooth(0.75, 1, tt)) * (1 - trail * 0.33) * end;
        if (level > 0.01) plot(Math.cos(a) * r, Math.sin(a) * r, trail ? '.' : '+', heat(0.45 + tt * 0.5), level);
      }
    }
  }
  for (let i = 0; i < 10; i++) {
    const a = hash(i + 300) * TAU, r = 0.3 + hash(i + 310) * 1.0;
    const twinkle = Math.max(0, Math.sin(age * 14 + i * 2.4)) ** 2 * smooth(0.1, 0.25, p);
    if (twinkle > 0.02) plot(Math.cos(a) * r, Math.sin(a) * r, twinkle > 0.6 ? '*' : '+', heat(0.9), twinkle * end);
  }
}

function drawPulse(effect, plot) {
  const p = effect.progress, age = effect.age, end = clamp01((1 - p) * 2.5);
  if (effect.radius >= 2) {
    // The heal's wide burst: a thin ring of light racing out with short radial streaks.
    const r = effect.radius * (0.25 + outCubic(p) * 0.65), level = end * smooth(0, 0.06, p);
    for (let i = 0; i < 64; i++) {
      const a = i / 64 * TAU, keep = clamp01((hash(i + 400) + 0.6 - p) * 4);
      plot(Math.cos(a) * r, Math.sin(a) * r, i % 4 ? ':' : '+', heat(0.75 - p * 0.45), level * keep * 0.85);
    }
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * TAU + 0.2;
      for (let j = 0; j < 2; j++) plot(Math.cos(a) * r * (0.88 - j * 0.1), Math.sin(a) * r * (0.88 - j * 0.1), j ? '.' : '\'', heat(0.55), level * (0.7 - j * 0.3));
    }
    return;
  }
  // Each bolt tick lights the ~5 m of path behind it as a braided ribbon; consecutive ticks
  // tile into one continuous vine of light that twists and frays from the back as it fades.
  braid(plot, { z0: -6, z1: 0.15, samples: 34, wavelength: 2.5, twist: age * 6,
    amplitude: u => 0.32 * (0.7 + 0.3 * smooth(0, 0.3, u)), light: () => end * smooth(0, 0.05, p),
    taper: 0.12, thin: p * 0.55, seed: 500 });
  const node = (1 - smooth(0, 0.7, p)) * smooth(0, 0.04, p);
  plot(0, 0, node > 0.5 ? '@' : '*', heat(0.95), node);
  for (let i = 0; i < 4; i++) {
    const a = i * TAU / 4 + age * 4, r = 0.12 + outCubic(p) * 0.18;
    plot(Math.cos(a) * r, Math.sin(a) * r, '+', heat(0.8), node * 0.85);
  }
  for (let i = 0; i < 8; i++) {
    const z = -0.3 - hash(i + 600) * 5.4, side = i % 2 ? 1 : -1;
    const x = side * (0.3 + (1 - Math.exp(-5 * p)) * (0.25 + hash(i + 610) * 0.3)) + Math.sin(age * 9 + i) * 0.03;
    plot(x, z + p * 0.25, '.', heat(0.6), end * 0.7 * smooth(0, 0.1, p));
  }
}

export default {
  id: 'blessing-of-healing', duration: 1.35,
  draw(effect, plot) {
    if (effect.stage === 'projectile') return drawProjectile(effect, plot);
    if (effect.stage === 'impact') return drawImpact(effect, plot);
    if (effect.stage === 'pulse') return drawPulse(effect, plot);
    if (effect.stage === 'aura' || effect.stage === 'zone') return drawAura(effect, plot);
    return drawCast(effect, plot);
  },
  sounds: {
    cast: [
      { kind: 'tone', type: 'triangle', frequency: 1046.5, endFrequency: 1032, delay: 0, duration: 0.42, gain: 0.055, attack: 0.004, release: 0.37, cutoff: 3400 },
      { kind: 'tone', type: 'triangle', frequency: 880, endFrequency: 870, delay: 0.13, duration: 0.45, gain: 0.06, attack: 0.004, release: 0.4, cutoff: 3000 },
      { kind: 'tone', type: 'triangle', frequency: 698.46, endFrequency: 692, delay: 0.29, duration: 0.49, gain: 0.065, attack: 0.005, release: 0.44, cutoff: 2600 },
      { kind: 'tone', type: 'sine', frequency: 523.25, endFrequency: 520, delay: 0.49, duration: 0.65, gain: 0.075, attack: 0.007, release: 0.6 },
    ],
    impact: [
      { kind: 'tone', type: 'sine', frequency: 261.63, duration: 0.85, gain: 0.075, attack: 0.045, release: 0.66 },
      { kind: 'tone', type: 'triangle', frequency: 329.63, duration: 0.78, gain: 0.045, attack: 0.045, release: 0.6, cutoff: 2100 },
      { kind: 'tone', type: 'sine', frequency: 392, duration: 0.85, gain: 0.055, attack: 0.045, release: 0.66 },
      { kind: 'tone', type: 'sine', frequency: 523.25, delay: 0.34, duration: 0.67, gain: 0.045, attack: 0.04, release: 0.55 },
      { kind: 'tone', type: 'sine', frequency: 261.63, delay: 0.57, duration: 0.7, gain: 0.06, attack: 0.04, release: 0.58 },
    ],
    pulse: [
      { kind: 'tone', type: 'sine', frequency: 659.25, endFrequency: 523.25, duration: 0.16, gain: 0.014, attack: 0.007, release: 0.14 },
    ],
  },
};
