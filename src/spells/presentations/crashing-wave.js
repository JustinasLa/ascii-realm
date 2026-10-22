// Crashing Wave: water is drawn in around the caster, heaves up and is hurled
// forward as a broad crescent breaker. In flight a white foaming lip leads a
// dark barrel and rolling swell rows, its tips curling back and mist streaming
// off the crest, while every tick leaves churned wake behind. On a hit the
// breaker slams down in a white burst, throws a crown of surf and spray around
// the target, and spreads into a foam sheet and a fading ripple.
const TAU = Math.PI * 2;
// Cells per local metre (SCALE / ASPECT across, SCALE * TILT down) and the
// on-screen width of a column relative to a row, so strokes follow the heading.
const COLS = 13 / 0.6, ROWS = 6.5, CELL = 0.6;
// Deep water -> sea -> current -> foam -> white flash.
const STOPS = [[14, 62, 122], [35, 151, 177], [65, 205, 209], [222, 255, 246], [255, 255, 255]];
const RAMP = Array.from({ length: 33 }, (_, i) => {
  const t = i / 32 * (STOPS.length - 1), k = Math.min(STOPS.length - 2, Math.floor(t)), f = t - k;
  return STOPS[k].map((c, j) => Math.round(c + (STOPS[k + 1][j] - c) * f));
});
const FOAM = '.:-=*%#';

const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeOut = t => 1 - (1 - clamp01(t)) ** 3;
const tone = t => RAMP[Math.round(clamp01(t) * 32)];
const hash = (i, seed = 0) => { const v = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453; return v - Math.floor(v); };

// Screen cells crossed by a local metre along (dx, dz) at this heading.
const reach = (dx, dz, c, s) => Math.max(Math.abs(dx * c + dz * s) * COLS, Math.abs(dz * c - dx * s) * ROWS);
// A glyph that follows the on-screen direction of a stroke along (dx, dz).
function stroke(dx, dz, c, s, flat, upright) {
  const sx = (dx * c + dz * s) * COLS * CELL, sy = (dz * c - dx * s) * ROWS;
  const ax = Math.abs(sx), ay = Math.abs(sy);
  if (ay <= ax * 0.45) return flat;
  if (ax <= ay * 0.45) return upright;
  return sx * sy > 0 ? '\\' : '/';
}
// Screen-facing bracket for a curved edge at local (x, z): ')' on the right.
const bracket = (x, z, c, s) => x * c + z * s >= 0 ? ')' : '(';

// Thin ring of surf around the origin (used for ripples and crowns).
function ring(plot, r, gap, max, c, s, color, brightness, weight, seed, wobble = 0) {
  if (brightness <= 0.01 || r <= 0) return;
  const n = Math.max(6, Math.min(max, Math.round(r * 2 * Math.PI * 15 / gap)));
  for (let i = 0; i < n; i++) {
    const a = (i + hash(i, seed) * 0.35) / n * TAU;
    const rr = r * (1 + wobble * Math.sin(a * 5 + seed));
    const x = Math.sin(a) * rr, z = Math.cos(a) * rr;
    const b = brightness * (weight ? 1 - weight + weight * (0.5 + 0.5 * Math.cos(a)) : 1);
    if (b > 0.01) plot(x, z, stroke(Math.cos(a), -Math.sin(a), c, s, '~', bracket(x, z, c, s)), color, b);
  }
}

// The flying breaker: a forward-bowed crescent with a foaming lip, a dark barrel
// beneath it, swell rows rolling back under the crest, curled tips and mist.
function breaker(plot, age, p, c, s) {
  const grow = smooth(0, 0.22, age), spent = 1 - smooth(0.82, 1.14, age);
  const base = Math.min(1, (1 - p) * 4) * spent * (0.25 + 0.75 * grow);
  if (base <= 0.01) return;
  const W = 1.05 * (0.4 + 0.6 * grow) * (1 + (1 - spent) * 0.2);
  const bow = 0.34 * (0.35 + 0.65 * grow) * (0.4 + 0.6 * spent);
  const crestZ = u => bow * (1 - u * u) + Math.sin(u * 4.2 - age * 7) * 0.03;
  const slope = u => -2 * bow * u / W + Math.cos(u * 4.2 - age * 7) * 0.126 / W;
  const across = reach(1, 0, c, s) * 2 * W;

  // Swell rows scroll back from the crest and fade out behind it.
  const roll = (age * 2.4) % 1, cycle = Math.floor(age * 2.4);
  for (let k = 0; k < 4; k++) {
    const d = (k + roll) / 4, id = k - cycle;
    const env = smooth(0, 0.18, d) * (1 - d) ** 1.2;
    if (env * base <= 0.01) continue;
    const w = W * (1 - d * 0.22), n = Math.min(14, Math.ceil(across * (1 - d * 0.22) / (3 + d * 3.4)));
    for (let i = 0; i < n; i++) {
      const u = ((i + 0.5 + (id & 1) * 0.5) / n * 2 - 1) * (1 - 0.5 / n);
      const I = env * (0.6 + 0.4 * Math.sin(u * 6.3 + age * 4 + id * 2.1));
      const g = I > 0.45 ? '=' : I > 0.3 ? '~' : I > 0.16 ? '-' : '.';
      const x = u * w, z = crestZ(u) * (1 - d * 0.6) - 0.3 - d * 0.75;
      plot(x, z, g === '.' ? g : stroke(1, slope(u), c, s, g, ':'), tone(0.12 + I * 0.5), base * Math.min(1, I * 1.3));
    }
  }

  // Dark barrel under the lip gives the crest its depth.
  const nb = Math.min(10, Math.ceil(across / 4));
  for (let i = 0; i < nb; i++) {
    const u = ((i + 0.5) / nb * 2 - 1) * 0.92;
    plot(u * W, crestZ(u) - 0.16, stroke(1, slope(u), c, s, '=', '|'), tone(0.06), base * 0.55);
  }

  // The foaming lip, shimmering white along its length.
  const nc = Math.min(34, Math.ceil(across));
  for (let i = 0; i <= nc; i++) {
    const u = i / nc * 2 - 1, x = u * W, z = crestZ(u);
    const glint = 0.5 + 0.5 * Math.sin(u * 9 + age * 13);
    plot(x, z, stroke(1, slope(u), c, s, '~', bracket(x, z, c, s)), tone(0.74 + glint * 0.22),
      base * (0.78 + 0.22 * glint) * (1 - u * u * 0.25));
  }

  // Tips curl back around the ends of the crest.
  for (let side = -1; side <= 1; side += 2) {
    for (let j = 0; j < 4; j++) {
      const t = (j + 1) / 4.5, a = t * 2.4;
      const x = side * (W + 0.15 * Math.sin(a)), z = crestZ(1) - t * 0.55 * (0.4 + 0.6 * grow);
      plot(x, z, stroke(side * 0.36 * Math.cos(a), -0.55, c, s, '~', '|'), tone(0.7 - t * 0.4), base * (1 - t * 0.65));
    }
  }

  // Spray pitched off the lip, and mist streaming back over the swell.
  const np = Math.min(7, Math.ceil(across / 7));
  for (let i = 0; i < np; i++) {
    const u = ((i + 0.5) / np * 2 - 1) * 0.85, flick = 0.5 + 0.5 * Math.sin(age * 11 + i * 2.7);
    plot(u * W, crestZ(u) + 0.12 + flick * 0.06, i & 1 ? "'" : '"', tone(0.84), base * (0.3 + 0.4 * flick));
  }
  for (let i = 0; i < 8; i++) {
    const t = age * 1.5 + hash(i, 2), ph = t % 1, lane = Math.floor(t);
    const u = (hash(i + lane * 13, 3) * 2 - 1) * 0.9;
    const x = u * W + (hash(i + lane * 13, 4) - 0.5) * 0.3 * ph, z = crestZ(u) + 0.1 - ph * 1.05;
    plot(x, z, ph < 0.25 ? '"' : ph < 0.6 ? "'" : '.', tone(0.86 - ph * 0.4), base * 0.8 * Math.sin(Math.PI * ph));
  }
}

// Churned wake left under the breaker each tick: broken foam and edge eddies.
function wake(plot, p, seed, c, s) {
  const b = smooth(0, 0.12, p) * (1 - p) ** 1.5 * 0.5;
  if (b <= 0.01) return;
  const spread = 1 + easeOut(p) * 0.35;
  for (let i = 0; i < 16; i++) {
    const u = hash(i, seed) * 2 - 1, I = (1 - Math.abs(u) * 0.45) * (0.55 + 0.45 * hash(i, seed + 1));
    const x = u * 0.9 * spread, z = (hash(i, seed + 2) - 0.5) * 0.6 - p * 0.2;
    plot(x, z, I > 0.7 ? stroke(1, 0, c, s, '~', ':') : I > 0.5 ? stroke(1, 0, c, s, '-', ':') : '.',
      tone(0.55 - p * 0.35 + I * 0.15), b * I);
  }
  for (let side = -1; side <= 1; side += 2) {
    for (let j = 0; j < 4; j++) {
      const a = j * TAU / 4 + p * 5 * side, r = 0.09 + p * 0.12;
      plot(side * 0.98 * spread + Math.sin(a) * r, Math.cos(a) * r - 0.05, j ? '.' : 'o', tone(0.5), b * 0.8);
    }
  }
}

// The breaker slams down on a target.
function crash(plot, p, age, c, s) {
  const fade = Math.min(1, (1 - p) * 3);
  // White slam flash at the point of impact.
  const flash = 1 - smooth(0.02, 0.24, p);
  if (flash > 0.01) {
    plot(0, 0, '@', tone(1), flash);
    for (let i = 0; i < 16; i++) {
      const inner = i < 6, a = (i + (inner ? 0 : 0.5)) / (inner ? 6 : 10) * TAU;
      const r = (inner ? 0.13 : 0.28) * (1 + p * 2.5);
      plot(Math.sin(a) * r, Math.cos(a) * r, inner ? '#' : '%', tone(inner ? 1 : 0.9), flash * (inner ? 1 : 0.85));
    }
  }

  // Surf crown thrown around the target, heaviest where the wave pushes on.
  const q = smooth(0, 0.8, p), crown = 0.42 + easeOut(q) * 0.85;
  ring(plot, crown, 1.5, 44, c, s, tone(0.97 - p * 0.6), fade * (1 - p * 0.45), 0.5, 1, 0.07);
  ring(plot, crown * 0.72, 2.2, 28, c, s, tone(0.55 - p * 0.3), fade * 0.6 * (1 - p * 0.4) * smooth(0.02, 0.1, p), 0.3, 2, 0.05);

  // Foam sheet spreading inside the crown, swirling as it settles.
  for (let i = 0; i < 34; i++) {
    const rho = Math.sqrt(hash(i, 4)), a = hash(i, 5) * TAU + p * (hash(i, 6) - 0.5) * 1.8;
    const r = 0.12 + rho * crown * 0.8;
    const I = (1 - rho * 0.55) * (1 - p) ** 0.8 * (0.65 + 0.35 * Math.sin(age * 9 + i));
    plot(Math.sin(a) * r, Math.cos(a) * r, FOAM[Math.min(6, Math.floor(I * 7))], tone(0.3 + I * 0.62),
      fade * smooth(0.04, 0.16, p) * (0.25 + 0.7 * I));
  }

  // Spray flung outward, mostly forward, slowing under drag.
  for (let i = 0; i < 46; i++) {
    const a = (hash(i, 7) - 0.5) * 5.4, v = (1.3 + 2.2 * hash(i, 8)) * (0.6 + 0.4 * Math.cos(a));
    const d = 0.3 + v * (1 - Math.exp(-4 * p)) * 0.42;
    const x = Math.sin(a) * d, z = Math.cos(a) * d + Math.sin(p * 6 + i) * 0.03;
    const stage = p + hash(i, 9) * 0.2;
    plot(x, z, stage < 0.25 ? 'o' : stage < 0.5 ? (i & 1 ? "'" : '"') : stage < 0.75 ? ',' : '.',
      tone(0.92 - p * 0.55), fade * smooth(0.01, 0.08, p) * (0.55 + 0.45 * hash(i, 10)));
  }

  // A ripple spreads out once the surf has fallen back.
  const ripple = smooth(0.3, 1, p);
  if (ripple > 0) ring(plot, 0.75 + ripple * 1.3, 2, 36, c, s, tone(0.42 - ripple * 0.2), fade * Math.sin(Math.PI * ripple) * 0.6, 0, 3);
}

// The cast: water drawn in, a heave at the feet, then a surge hurled forward.
function surge(plot, p, age, c, s) {
  const fade = Math.min(1, (1 - p) * 2.5);
  // Wind-up: droplets spiral in toward the caster's feet.
  const pull = smooth(0, 0.14, p), gather = 1 - smooth(0.1, 0.2, p);
  if (gather > 0.01) {
    for (let i = 0; i < 24; i++) {
      const a = (i + hash(i, 11) * 0.4) / 24 * TAU + pull * 0.9;
      const r = (1.35 - pull * pull * 1.05) * (0.8 + 0.4 * hash(i, 12));
      plot(Math.sin(a) * r, Math.cos(a) * r, pull > 0.6 ? "'" : '.', tone(0.35 + pull * 0.45), gather * (0.3 + 0.65 * pull));
    }
  }
  // The heave: a bright dome of water at the feet.
  const heave = smooth(0.02, 0.13, p) * (1 - smooth(0.13, 0.32, p));
  if (heave > 0.01) {
    plot(0, 0, '#', tone(0.95), heave);
    for (let i = 0; i < 16; i++) {
      const inner = i < 6, a = (i + (inner ? 0 : 0.5)) / (inner ? 6 : 10) * TAU;
      const r = (inner ? 0.14 : 0.3) * (0.6 + 0.6 * heave);
      plot(Math.sin(a) * r, Math.cos(a) * r, inner ? '=' : '~', tone(inner ? 0.85 : 0.6), heave * (inner ? 1 : 0.75));
    }
  }
  // Launch: a crescent surge rolls forward from the caster and spends itself.
  const q = smooth(0.1, 0.72, p), qe = easeOut(q);
  const power = smooth(0.1, 0.17, p) * (1 - q) ** 0.9 * fade;
  if (power > 0.01) {
    const W = 0.45 + qe * 0.65, bow = 0.2 + qe * 0.12, front = 0.2 + qe * 1.25;
    const across = reach(1, 0, c, s) * 2 * W;
    for (let k = 0; k < 3; k++) {
      const n = Math.min(k ? 18 : 28, Math.ceil(across * (1 - k * 0.15) / (k ? 1.8 + k * 1.1 : 1.3)));
      for (let i = 0; i <= n; i++) {
        const u = (i + (k & 1) * 0.5) / (n + (k & 1)) * 2 - 1, w = W * (1 - k * 0.15);
        const x = u * w, z = front + bow * (1 - u * u) - k * 0.2 * (1 + qe);
        const glint = 0.5 + 0.5 * Math.sin(u * 8 + age * 12 + k);
        const g = k ? (k === 1 ? '=' : '-') : '~';
        plot(x, z, stroke(1, -2 * bow * u / w, c, s, g, k ? ':' : bracket(x, z, c, s)),
          tone(k ? 0.5 - k * 0.15 : 0.76 + glint * 0.2), power * (k ? 0.75 - k * 0.2 : 0.8 + 0.2 * glint));
      }
    }
  }
  // Rings of displaced water race outward from the caster.
  for (let k = 0; k < 2; k++) {
    const start = 0.08 + k * 0.16, t = smooth(start, start + 0.6, p);
    ring(plot, 0.35 + easeOut(t) * 1.05, 1.8, 34, c, s, tone(0.6 - t * 0.35),
      fade * Math.sin(Math.PI * t) * (0.7 - k * 0.2), 0.35, 4 + k, 0.04);
  }
  // Spray thrown up by the launch.
  const tt = clamp01((p - 0.1) / 0.6);
  if (tt > 0 && tt < 1) {
    for (let i = 0; i < 34; i++) {
      const a = (hash(i, 13) - 0.5) * 3.8, v = (1 + 2.2 * hash(i, 14)) * (0.55 + 0.45 * Math.cos(a));
      const d = 0.25 + v * (1 - Math.exp(-4 * tt)) * 0.4;
      plot(Math.sin(a) * d, Math.cos(a) * d + 0.15, tt < 0.3 ? (hash(i, 15) > 0.55 ? 'o' : '"') : tt < 0.6 ? "'" : '.', tone(0.9 - tt * 0.5),
        fade * smooth(0, 0.08, tt) * (1 - tt) ** 1.1 * (0.6 + 0.4 * hash(i, 15)));
    }
  }
  // Settling: foam patches drift and dissolve around the caster.
  const settle = smooth(0.3, 0.55, p) * (1 - smooth(0.55, 1, p));
  if (settle > 0.01) {
    for (let i = 0; i < 18; i++) {
      const a = hash(i, 16) * TAU + p * (hash(i, 17) - 0.5) * 1.5, r = 0.3 + hash(i, 18) * 0.9 + p * 0.25;
      const I = settle * (0.55 + 0.45 * Math.sin(age * 5 + i * 1.7));
      plot(Math.sin(a) * r, Math.cos(a) * r, I > 0.6 ? '~' : I > 0.35 ? '-' : '.', tone(0.3 + I * 0.35), fade * I * 0.8);
    }
  }
}

// Sustained surf (aura/zone): three breakers chase each other around the edge.
function surf(plot, effect, age, p, c, s) {
  const R = Math.max(0.6, Math.min(3, Number.isFinite(effect.radius) ? effect.radius : 1)) * 0.85;
  const fade = Math.min(1, (1 - p) * 3) * smooth(0, 0.25, age);
  if (fade <= 0.01) return;
  for (let b = 0; b < 3; b++) {
    const A = age * 1.1 + b * TAU / 3;
    for (let j = 0; j < 14; j++) {
      const lead = j / 13, a = A + (lead - 0.5) * 1.5, x = Math.sin(a) * R, z = Math.cos(a) * R;
      plot(x, z, stroke(Math.cos(a), -Math.sin(a), c, s, '~', bracket(x, z, c, s)), tone(0.55 + lead * 0.4), fade * (0.3 + 0.7 * lead));
      if (j & 1) plot(x * 0.88, z * 0.88, stroke(Math.cos(a), -Math.sin(a), c, s, '=', '|'), tone(0.08), fade * 0.5 * lead);
    }
  }
  for (let i = 0; i < 20; i++) {
    const a = i / 20 * TAU - age * 0.7, r = R * (0.45 + 0.08 * Math.sin(age * 3 + i * 1.3));
    plot(Math.sin(a) * r, Math.cos(a) * r, i & 1 ? '-' : '~', tone(0.3), fade * (0.3 + 0.2 * Math.sin(age * 4 + i)));
  }
}

export default {
  id: 'crashing-wave', duration: 1.15,
  draw(effect, draw) {
    const p = clamp01(Number.isFinite(effect.progress) ? effect.progress : 0);
    const age = Number.isFinite(effect.age) ? Math.max(0, effect.age) : 0;
    const heading = Number.isFinite(effect.heading) ? effect.heading : 0;
    const c = Math.cos(heading), s = Math.sin(heading);
    // Glyphs that have faded out are skipped so they never spend the budget.
    const plot = (x, z, char, color, brightness) => { if (brightness > 0.01) draw(x, z, char, color, brightness); };
    switch (effect.stage) {
      case 'projectile': return breaker(plot, age, p, c, s);
      case 'impact': return crash(plot, p, age, c, s);
      case 'pulse': {
        const seed = (Number.isFinite(effect.x) ? effect.x * 0.37 : 0) + (Number.isFinite(effect.y) ? effect.y * 1.13 : 0);
        return wake(plot, p, seed % 97, c, s);
      }
      case 'aura': case 'zone': return surf(plot, effect, age, p, c, s);
      default: return surge(plot, p, age, c, s);
    }
  },
  sounds: {
    // Recorded water displacement gathers at the caster before the crest lifts.
    cast: [
      { kind: 'recording', url: '/assets/audio/spells/mitlan/water-lift.wav', gain: 0.55, rate: 0.88, delay: 0 },
      { kind: 'recording', url: '/assets/audio/spells/mitlan/wash.wav', gain: 0.25, rate: 0.94, delay: 0.18 },
    ],
    // Keep the complete splash and its natural texture; a later wash carries
    // the broken wave back out after the heavy crest lands.
    impact: [
      { kind: 'recording', url: '/assets/audio/spells/mitlan/breaker.wav', gain: 0.76, rate: 0.9, delay: 0 },
      { kind: 'recording', url: '/assets/audio/spells/mitlan/wash.wav', gain: 0.3, rate: 0.88, delay: 1.8 },
    ],
    // Sparse real droplets make the repeated wake audible without another slam.
    pulse: [
      { kind: 'recording', url: '/assets/audio/spells/mitlan/droplets.wav', gain: 0.1, rate: 1.12, delay: 0 },
    ],
  },
};
