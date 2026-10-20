// Scalding Wave: a boiling pool gathers at the caster's feet, then a cresting
// roller of hot water sweeps the 120-degree, four-metre cone, sheds yellow
// boiling beads and spray from its lip, and collapses into rising steam.
// Heights are drawn screen-up (compensating for the effect heading), so the
// crest stands above its foot and steam climbs whichever way the wave faces.
const deep = [24, 112, 146], water = [52, 184, 182], crest = [139, 245, 224];
const foam = [226, 255, 248], heat = [255, 218, 125], scald = [255, 158, 82];
const steam = [236, 250, 238], white = [255, 255, 246];

const REACH = 4, HALF = Math.PI / 3; // the TF cone: livingincone a=120 r=4
const STEAM = '.:;~';

const clamp01 = t => Math.max(0, Math.min(1, t));
const smooth = t => { t = clamp01(t); return t * t * (3 - 2 * t); };
const easeOut = t => 1 - (1 - clamp01(t)) ** 3;
const window01 = (t, a, b) => clamp01((t - a) / (b - a));
const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// A plot that adds a screen-up height (metres) to local ground coordinates.
function lifted(effect, plot) {
  const h = Number.isFinite(effect.heading) ? effect.heading : 0;
  const sx = Math.sin(h), cz = -Math.cos(h);
  return (x, z, up, char, color, brightness) =>
    plot(x + up * sx, z + up * cz, char, color, clamp01(brightness));
}

// Steam puffs: rise, drift and thin out; `t` is each puff's own 0-1 life.
function puff(lift, x, z, up, t, seed, age, bright) {
  const curl = Math.sin(age * 5 + seed * 6.3 + t * 4) * (0.06 + t * 0.22);
  const glyph = STEAM[Math.min(3, Math.floor((1 - t) * 3.2 + hash(seed) * 0.8))];
  lift(x + curl, z, up, glyph, mix(steam, [150, 190, 196], t), bright * (1 - t) * (0.35 + 0.65 * smooth(t / 0.25)));
}

function cast(effect, lift) {
  const p = effect.progress, age = effect.age;
  const end = 1 - smooth(window01(p, 0.82, 1));

  // Wind-up: a churning, brightening pool spirals in at the caster's feet.
  const pool = smooth(p / 0.1) * (1 - smooth(window01(p, 0.2, 0.34)));
  if (pool > 0) {
    for (let i = 0; i < 22; i++) {
      const ring = i % 2, a = i / 11 * Math.PI + age * (5 + ring * 2.5) * (ring ? -1 : 1);
      const rad = (0.95 - ring * 0.38) * (1 - 0.35 * smooth(p / 0.22));
      const b = pool * (0.55 + 0.45 * Math.sin(a * 3 + age * 9) ** 2);
      lift(Math.sin(a) * rad, Math.cos(a) * rad, 0, ring ? '~' : (i % 4 ? '-' : '~'),
        mix(deep, crest, 0.3 + ring * 0.5), b);
    }
    for (let i = 0; i < 9; i++) {
      const cycle = (age * 3.2 + hash(i + 3)) % 1, a = hash(i + 11) * 6.283, rad = 0.12 + hash(i + 23) * 0.45;
      const glyph = cycle < 0.45 ? 'o' : cycle < 0.75 ? 'O' : cycle < 0.88 ? '*' : '.';
      lift(Math.sin(a) * rad, Math.cos(a) * rad, cycle * 0.12, glyph, mix(heat, white, cycle > 0.75 ? 0.7 : 0.1), pool);
    }
  }

  // Surge: the roller runs out to the edge of the cone with eased speed.
  const run = window01(p, 0.14, 0.86);
  if (run <= 0) return;
  const reach = 0.35 + (REACH - 0.35) * easeOut(run) + 0.25 * window01(p, 0.86, 1);
  const rise = smooth(run / 0.25), collapse = smooth(window01(p, 0.62, 0.92));
  const height = 0.62 * rise * (1 - collapse);
  const env = smooth(run / 0.12) * end;
  // Samples sit on a fixed angular grid; finer ranks fade in as the arc
  // lengthens, so the crest stays evenly dense without glyphs jumping.
  const want = 2 * HALF * reach / 0.15;
  const shape = (u, k) => {
    const swell = Math.sin(u * 7.5 - age * 6) * 0.06 + Math.sin(u * 3.1 + age * 2.3) * 0.08;
    const edge = 1 - u * u * 0.55;
    return { a: u * HALF, d: reach + swell - u * u * 0.18 * reach, edge, h: height * edge * (1 + swell * 1.4), k };
  };
  for (let i = 0; i <= 56; i++) {
    const rank = i % 8 === 0 ? 0 : i % 4 === 0 ? 1 : i % 2 === 0 ? 2 : 3;
    const w = rank === 0 ? 1 : smooth((want - [0, 8, 15, 29][rank]) / [0, 7, 14, 28][rank]);
    if (w < 0.05) continue;
    const u = i / 28 - 1, { a, d, edge, h } = shape(u);
    const sx = Math.sin(a), cz = Math.cos(a), b = env * edge * w;
    // Foaming lip curls forward over the face; it breaks into flecks late on.
    const lipD = d + 0.06 + h * 0.28 + collapse * 0.25;
    const lipGlyph = collapse > 0.45 ? (i % 2 ? '.' : ',') : h > 0.35 ? (i % 3 ? '~' : '^') : '~';
    if (hash(i * 3.7) > collapse * 0.55) lift(sx * lipD, cz * lipD, h, lipGlyph,
      mix(crest, foam, 0.4 + 0.6 * edge * rise), b * (1 - collapse * 0.4));
    if (i % 2) continue;
    // Spent glyphs drop out in a stable, hashed order as the wave breaks.
    const keep = hash(i * 7.3) > collapse * 0.7;
    if (keep) lift(sx * d, cz * d, 0, '=', mix(water, crest, 0.15), b * 0.9);
    if (h > 0.08 && keep) lift(sx * (d + 0.05), cz * (d + 0.05), h * 0.6, i % 4 ? '~' : '-', mix(water, crest, 0.6), b);
    if (h > 0.3 && Math.abs(u) < 0.62 && keep) lift(sx * (d + 0.02), cz * (d + 0.02), h * 0.28,
      i % 4 ? '=' : '~', mix(water, crest, 0.3), b * 0.9);
    // Trailing backwash thins to sparse dots behind the roller.
    if (i % 4 === 0) lift(sx * (d - 0.32), cz * (d - 0.32), 0, '-', mix(deep, water, 0.4), b * 0.65 * (1 - collapse * 0.5));
    if (i % 8 === 4) lift(sx * (d - 0.7), cz * (d - 0.7), 0, '.', deep, b * 0.4);
  }

  // Boiling beads ride and pop along the crest, glowing hotter at the centre.
  for (let i = 0; i < 12; i++) {
    const u = (hash(i + 41) * 2 - 1) * 0.92, a = u * HALF;
    const cycle = (age * (2.4 + hash(i + 5)) + hash(i + 77)) % 1;
    const d = reach - u * u * 0.18 * reach - 0.12, h = height * (1 - u * u * 0.55) * 0.75 + cycle * 0.25;
    const glyph = cycle < 0.5 ? 'o' : cycle < 0.78 ? 'O' : cycle < 0.9 ? '*' : '.';
    lift(Math.sin(a) * d, Math.cos(a) * d, h, glyph, mix(heat, scald, Math.abs(u)),
      env * (1 - collapse * 0.6) * (0.75 + 0.25 * Math.sin(cycle * Math.PI)));
  }

  // Spray flung from the lip as the crest peaks and breaks: drag + gravity.
  for (let i = 0; i < 18; i++) {
    const born = 0.32 + hash(i + 91) * 0.45, t = (p - born) / 0.22;
    if (t <= 0 || t >= 1) continue;
    const u = hash(i + 13) * 2 - 1, a = u * HALF;
    const at = 0.35 + (REACH - 0.35) * easeOut((born - 0.14) / 0.72);
    const fly = (1 - Math.exp(-3 * t)) * (0.35 + hash(i + 7) * 0.45);
    const d = at - u * u * 0.18 * at + fly;
    const h = 0.5 * (1 - u * u * 0.55) + (1.6 * t - 2.2 * t * t) * (0.5 + hash(i + 2) * 0.4);
    lift(Math.sin(a) * d, Math.cos(a) * d, Math.max(0, h), t < 0.3 ? "'" : t < 0.7 ? ',' : '.',
      mix(white, crest, t), end * (1 - t) * 0.95);
  }

  // Steam boils off the wake and climbs as the wave spends itself.
  for (let i = 0; i < 26; i++) {
    const born = 0.24 + hash(i + 31) * 0.6, t = (p - born) / (0.3 + hash(i + 3) * 0.2);
    if (t <= 0 || t >= 1) continue;
    const u = hash(i + 57) * 2 - 1, a = u * HALF;
    const at = (0.35 + (REACH - 0.35) * easeOut((born - 0.14) / 0.72)) * (0.55 + hash(i + 19) * 0.4);
    puff(lift, Math.sin(a) * at, Math.cos(a) * at, 0.1 + t * (0.7 + hash(i + 8) * 0.5), t, i, age, end);
  }
}

// Visual pulses fire at the caster: a crescent sheet of scalding water is
// flung forward across the cone, shedding droplets and a hiss of steam.
function pulse(effect, lift) {
  const p = effect.progress, age = effect.age, r = Math.max(0.6, Math.min(3, effect.radius));
  const env = smooth(p / 0.08) * (1 - smooth(window01(p, 0.5, 1)));
  const out = easeOut(p * 1.15), arcH = Math.sin(Math.PI * clamp01(p * 1.1)) * r * 0.22;
  for (let i = 0; i < 15; i++) {
    const u = i / 7 - 1, a = u * HALF * 0.85, edge = 1 - u * u * 0.5;
    const d = 0.25 + r * 0.85 * out * (1 - u * u * 0.18) + Math.sin(u * 9 + age * 14) * 0.03;
    const sx = Math.sin(a), cz = Math.cos(a), h = arcH * edge;
    lift(sx * d, cz * d, h, i % 3 ? '~' : '^', mix(foam, crest, p), env * edge);
    if (i % 2 === 0) lift(sx * (d - 0.18), cz * (d - 0.18), h * 0.55, '-', mix(water, deep, p), env * edge * 0.7);
  }
  // Droplets outrun the sheet: drag on the spread, gravity on the height.
  for (let i = 0; i < 16; i++) {
    const t = clamp01(p * 1.2 - hash(i + 5) * 0.2), u = hash(i + 17) * 2 - 1, a = u * HALF * 0.9;
    const d = 0.3 + r * (1 - Math.exp(-3 * t)) * (0.8 + hash(i + 29) * 0.45);
    const h = Math.max(0, (1.9 * t - 2.4 * t * t) * r * (0.25 + hash(i + 3) * 0.2));
    lift(Math.sin(a) * d, Math.cos(a) * d, h, t < 0.35 ? "'" : t < 0.7 ? '.' : ',',
      mix(white, heat, t * 0.8), env * (1 - t * 0.5));
  }
  for (let i = 0; i < 12; i++) {
    const t = clamp01(p * 1.4 - hash(i + 9) * 0.4), a = (hash(i + 21) * 2 - 1) * HALF;
    const d = 0.25 + hash(i + 2) * 0.5 * r;
    if (t > 0 && t < 1) puff(lift, Math.sin(a) * d, Math.cos(a) * d, 0.08 + t * 0.45 * r, t, i + 50, age, env);
  }
}

// Each burn tick: a white-hot slap, a crown of thrown droplets, a steam column.
function impact(effect, lift) {
  const p = effect.progress, age = effect.age, r = Math.max(0.6, Math.min(2.5, effect.radius));
  const end = 1 - smooth(window01(p, 0.55, 1));
  const flash = 1 - smooth(p / 0.2);
  if (flash > 0) {
    for (let i = 0; i < 9; i++) {
      const a = i / 8 * 6.283, rad = i === 8 ? 0 : (0.16 + 0.08 * (i % 2)) * (0.6 + p * 2);
      lift(Math.sin(a) * rad * r, Math.cos(a) * rad * r, 0.25, i === 8 ? '@' : i % 2 ? '*' : '#',
        mix(white, heat, i === 8 ? 0 : 0.3 + p * 2), flash);
    }
  }
  // Ground ring of foam spreading out, biased forward (the wave shoves the target).
  const ring = easeOut(p / 0.7);
  for (let i = 0; i < 20; i++) {
    const a = i / 20 * 6.283, push = 1 + 0.35 * Math.max(0, Math.cos(a));
    const rad = r * (0.2 + 0.8 * ring) * push + Math.sin(i * 2.1 + age * 8) * 0.04;
    lift(Math.sin(a) * rad, Math.cos(a) * rad, 0, i % 2 ? '~' : '-', mix(crest, deep, ring), end * (0.9 - ring * 0.4));
  }
  // Crown: two rings of droplets thrown up together, then falling; the
  // forward side flies furthest because the wave shoves the target on.
  for (let i = 0; i < 28; i++) {
    const outer = i >= 14, a = (i % 14) / 14 * 6.283 + (outer ? 0.26 : 0) + (hash(i) - 0.5) * 0.15;
    const v = (outer ? 0.6 : 1) * (0.9 + hash(i + 3) * 0.2);
    const t = clamp01(p * 1.3 - hash(i + 6) * 0.05), fwd = 1 + 0.45 * Math.max(0, Math.cos(a));
    const rad = r * (0.22 + (outer ? 1.1 : 0.55) * fwd * (1 - Math.exp(-2.8 * t)));
    const vy = 2.4 - 6 * t, h = Math.max(0, (2.4 * t - 3 * t * t) * v * r * 0.6);
    const glyph = h <= 0 && t > 0.5 ? '.' : vy > 0.6 ? "'" : vy > -0.6 ? 'o' : ',';
    lift(Math.sin(a) * rad, Math.cos(a) * rad, h, glyph, mix(i % 4 ? crest : heat, water, t), end * (1 - t * 0.5));
  }
  // Steam column climbing off the scald.
  for (let i = 0; i < 22; i++) {
    const t = clamp01((p - 0.05 - hash(i + 40) * 0.3) / 0.6);
    if (t <= 0 || t >= 1) continue;
    const a = hash(i + 12) * 6.283, rad = r * (0.12 + hash(i + 30) * 0.3 + t * 0.35);
    puff(lift, Math.sin(a) * rad, Math.cos(a) * rad, 0.2 + t * r * (0.9 + hash(i) * 0.5), t, i + 100, age, end);
  }
}

// Burnt targets simmer: blistering bubbles on a hot skin, steam wisps rising.
function aura(effect, lift) {
  const p = effect.progress, age = effect.age, r = Math.max(0.6, Math.min(2.5, effect.radius));
  const env = smooth(p / 0.12) * (1 - smooth(window01(p, 0.6, 1)));
  for (let i = 0; i < 18; i++) {
    const a = i / 18 * 6.283 + age * 0.8, shimmer = Math.sin(age * 11 + i * 1.9);
    const rad = r * (0.55 + 0.05 * shimmer);
    lift(Math.sin(a) * rad, Math.cos(a) * rad * 0.8, 0, shimmer > 0.3 ? '~' : '-',
      mix(scald, water, 0.5 + 0.5 * Math.sin(i + age * 3)), env * (0.45 + 0.25 * shimmer));
  }
  for (let i = 0; i < 12; i++) {
    const cycle = (age * (1.6 + hash(i) * 1.2) + hash(i + 70)) % 1;
    const a = hash(i + 15) * 6.283, rad = r * (0.1 + hash(i + 25) * 0.4);
    const glyph = cycle < 0.4 ? '.' : cycle < 0.7 ? 'o' : cycle < 0.86 ? 'O' : '*';
    lift(Math.sin(a) * rad, Math.cos(a) * rad * 0.8, 0.15 + cycle * 0.3 + hash(i + 2) * 0.5, glyph,
      mix(heat, cycle > 0.86 ? white : scald, cycle * 0.5), env * (0.5 + 0.5 * Math.sin(cycle * Math.PI)));
  }
  for (let c = 0; c < 4; c++) {
    const a = c / 4 * 6.283 + 0.4, rad = r * 0.35;
    for (let j = 0; j < 7; j++) {
      const t = (age * 0.9 + j / 7 + hash(c) * 0.5) % 1;
      puff(lift, Math.sin(a) * rad, Math.cos(a) * rad * 0.8, 0.3 + t * r * 1.3, t, c * 7 + j, age, env * 0.85);
    }
  }
}

// Not used by the TF rune, but kept coherent: a boiling, steaming pool.
function zone(effect, lift) {
  const p = effect.progress, age = effect.age, r = Math.max(0.7, Math.min(4, effect.radius));
  const env = smooth(p / 0.1) * (1 - smooth(window01(p, 0.7, 1)));
  for (let k = 0; k < 3; k++) {
    const ripple = ((age * 0.5 + k / 3) % 1), rad = r * (0.25 + 0.75 * ripple);
    for (let i = 0; i < 24; i++) {
      const a = i / 24 * 6.283 + k;
      lift(Math.sin(a) * rad, Math.cos(a) * rad, 0, k === 0 ? '~' : i % 2 ? '-' : '~',
        mix(crest, deep, ripple), env * (1 - ripple) * 0.8);
    }
  }
  for (let i = 0; i < 18; i++) {
    const cycle = (age * (1.5 + hash(i) * 1.5) + hash(i + 8)) % 1;
    const a = hash(i + 4) * 6.283, rad = r * Math.sqrt(hash(i + 6)) * 0.8;
    lift(Math.sin(a) * rad, Math.cos(a) * rad, cycle * 0.15, cycle < 0.5 ? 'o' : cycle < 0.8 ? 'O' : '*',
      mix(heat, white, cycle > 0.8 ? 0.6 : 0), env * Math.sin(cycle * Math.PI));
  }
  for (let i = 0; i < 12; i++) {
    const t = (age * 0.6 + hash(i + 3)) % 1, a = hash(i + 33) * 6.283, rad = r * hash(i + 44) * 0.7;
    puff(lift, Math.sin(a) * rad, Math.cos(a) * rad, 0.2 + t * 1.2, t, i, age, env);
  }
}

// Not used by the TF rune: a compact travelling crest trailing a steaming wake.
function projectile(effect, lift) {
  const p = effect.progress, age = effect.age;
  const env = smooth(p / 0.05) * (1 - smooth(window01(p, 0.8, 1)));
  for (let i = -6; i <= 6; i++) {
    const u = i / 6, x = u * 0.55, z = 0.2 - u * u * 0.25, h = 0.3 * (1 - u * u);
    const wob = Math.sin(age * 9 + i) * 0.03;
    lift(x, z, 0, '=', mix(deep, water, 0.6), env * 0.85);
    lift(x, z + 0.04, h * 0.5 + wob, '~', mix(water, crest, 0.5), env);
    lift(x, z + 0.08 + h * 0.2, h + wob, i % 3 ? '~' : '^', mix(crest, foam, 1 - Math.abs(u)), env);
  }
  for (let i = 0; i < 4; i++) {
    const cycle = (age * 3 + hash(i)) % 1, u = (hash(i + 5) * 2 - 1) * 0.7;
    lift(u * 0.55, 0.15 - u * u * 0.2, 0.25 + cycle * 0.15, cycle < 0.6 ? 'o' : '*', heat, env);
  }
  for (let i = 0; i < 16; i++) {
    const side = i % 2 ? 1 : -1, k = i >> 1, back = 0.15 + k * 0.17;
    const x = side * (0.45 + k * 0.06) + Math.sin(age * 7 + k) * 0.03;
    lift(x, -back, 0, k % 2 ? '.' : '-', mix(water, deep, k / 8), env * (1 - k / 9));
  }
  for (let i = 0; i < 10; i++) {
    const t = (age * 1.4 + hash(i + 2)) % 1, x = (hash(i + 9) * 2 - 1) * 0.4;
    puff(lift, x, -0.2 - t * 0.9, 0.15 + t * 0.6, t, i, age, env * 0.8);
  }
}

const stages = { cast, pulse, impact, aura, zone, projectile };

export default {
  id: 'scalding-wave', duration: 1.1,
  draw(effect, plot) {
    const p = clamp01(effect.progress);
    const state = { stage: effect.stage, progress: p, age: Number.isFinite(effect.age) ? effect.age : 0,
      radius: Number.isFinite(effect.radius) ? effect.radius : 1, heading: effect.heading };
    (stages[effect.stage] ?? cast)(state, lifted(effect, plot));
  },
  sounds: {
    cast: [
      { kind: 'noise', duration: 0.48, gain: 0.075, cutoff: 2300, filterType: 'highpass', attack: 0.075, release: 0.2 },
      { kind: 'noise', delay: 0.025, duration: 0.5, gain: 0.065, cutoff: 260, filterType: 'bandpass', attack: 0.035, release: 0.2 },
      { kind: 'tone', type: 'sine', delay: 0.07, duration: 0.11, gain: 0.045, frequency: 165, endFrequency: 69, attack: 0.006, release: 0.08 },
      { kind: 'tone', type: 'sine', delay: 0.19, duration: 0.14, gain: 0.04, frequency: 210, endFrequency: 84, attack: 0.008, release: 0.1 },
    ],
    impact: [
      { kind: 'noise', duration: 0.065, gain: 0.09, cutoff: 5200, filterType: 'highpass', attack: 0.002, release: 0.055 },
      { kind: 'noise', delay: 0.018, duration: 0.36, gain: 0.08, cutoff: 3800, filterType: 'bandpass', attack: 0.012, release: 0.28 },
      { kind: 'noise', delay: 0.04, duration: 0.25, gain: 0.05, cutoff: 390, filterType: 'bandpass', attack: 0.01, release: 0.18 },
      { kind: 'tone', type: 'sine', delay: 0.04, duration: 0.1, gain: 0.045, frequency: 230, endFrequency: 76, attack: 0.005, release: 0.075 },
      { kind: 'tone', type: 'sine', delay: 0.115, duration: 0.08, gain: 0.03, frequency: 175, endFrequency: 63, attack: 0.005, release: 0.06 },
    ],
    pulse: [
      { kind: 'noise', duration: 0.075, gain: 0.018, cutoff: 2800, filterType: 'highpass', attack: 0.015, release: 0.055 },
    ],
  },
};
