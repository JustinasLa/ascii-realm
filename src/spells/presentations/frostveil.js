// Frostveil: a silencing curtain of frost. Fine hanging threads, open diamond
// eyelets and slow falling motes. Drapes hang straight down on screen, so every
// stage except the travelling projectile counter-rotates the cast heading.
const RAMP = [[44, 78, 132], [58, 104, 168], [92, 156, 206], [124, 194, 232],
  [150, 218, 242], [186, 236, 250], [216, 248, 255], [240, 253, 255]];
const ROW = 1 / 6.5, COL = 1 / 26;

const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const ease = v => { v = clamp01(v); return v * v * (3 - 2 * v); };
const easeOut = v => 1 - (1 - clamp01(v)) ** 3;
const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const tone = v => RAMP[Math.round(clamp01(v) * 7)];
const thread = v => v > 0.62 ? '|' : v > 0.36 ? ':' : '.';

// Pick a line glyph for a direction expressed in metres (x right, z down on screen).
function stroke(dx, dz) {
  const sx = dx * 13, sy = dz * 6.5;
  if (Math.abs(sy) < Math.abs(sx) * 0.45) return '-';
  if (Math.abs(sx) < Math.abs(sy) * 0.45) return '|';
  return sx * sy > 0 ? '\\' : '/';
}

function upright(effect, plot) {
  const h = effect.heading || 0;
  if (!h) return plot;
  const c = Math.cos(h), s = Math.sin(h);
  return (x, z, char, color, brightness) => plot(x * c - z * s, x * s + z * c, char, color, brightness);
}

// An open diamond eyelet: `rows` rows above and below its waist, half width w metres.
function eyelet(plot, x, z, w, rows, brightness, core = 0) {
  plot(x, z - rows * ROW, '.', tone(0.9), brightness);
  plot(x, z + rows * ROW, "'", tone(0.8), brightness);
  for (let r = 1 - rows; r < rows; r++) {
    const span = w * (1 - Math.abs(r) / rows), zr = z + r * ROW;
    const left = r < 0 ? '/' : r > 0 ? '\\' : '<', right = r < 0 ? '\\' : r > 0 ? '/' : '>';
    plot(x - span - COL, zr, left, tone(r ? 0.85 : 1), brightness);
    plot(x + span + COL, zr, right, tone(r ? 0.85 : 1), brightness);
  }
  if (core > 0.05) plot(x, z, core > 0.7 ? '*' : '+', tone(1), brightness * Math.min(1, core));
}

function cast(effect, plot) {
  const p = effect.progress, t = effect.age;
  const fade = clamp01((1 - p) / 0.28), knotZ = -2.35;
  // Anticipation: frost motes spiral in from a wide ring and vanish into the knot.
  if (p < 0.46) {
    for (let i = 0; i < 12; i++) {
      const g = clamp01((p - hash(i) * 0.08) / 0.34) ** 1.6;
      if (g >= 1) continue;
      const angle = i * Math.PI / 8 + hash(i + 7) * 0.5 + g * 2.4, radius = (1.3 + hash(i + 3) * 0.5) * (1 - g) ** 1.3;
      const lit = clamp01(p / 0.08) * (1 - clamp01((g - 0.9) / 0.1));
      const x = Math.cos(angle) * radius, z = knotZ + Math.sin(angle) * radius * 0.6;
      plot(x, z, g < 0.35 ? '.' : g < 0.7 ? '+' : '*', tone(0.35 + g * 0.65), lit);
      const back = angle - 0.22, br = radius * 1.12;
      plot(Math.cos(back) * br, knotZ + Math.sin(back) * br * 0.6, '.', tone(0.2 + g * 0.4), lit * 0.5);
    }
  }
  // The knot opens as an eyelet and flashes when the motes arrive.
  const knot = ease((p - 0.24) / 0.18) * (1 - ease((p - 0.62) / 0.2));
  const flash = Math.exp(-(((p - 0.42) / 0.07) ** 2));
  if (knot > 0) eyelet(plot, 0, knotZ, 0.08 + knot * 0.16 + flash * 0.08, 2, knot * fade, 0.4 + flash * 0.6);
  if (flash > 0.04) {
    for (let k = 1; k <= 5; k++) {
      const b = flash * (1 - k / 6);
      plot(-0.22 - k * 0.12 * (0.5 + flash), knotZ, '-', tone(1 - k * 0.1), b);
      plot(0.22 + k * 0.12 * (0.5 + flash), knotZ, '-', tone(1 - k * 0.1), b);
      if (k <= 2) {
        plot(0, knotZ - (2 + k) * ROW, '|', tone(0.9), b);
        plot(0, knotZ + (2 + k) * ROW, '|', tone(0.9), b);
        plot(-0.2 - k * 0.1, knotZ - (1 + k) * ROW, '\\', tone(0.8), b * 0.8);
        plot(0.2 + k * 0.1, knotZ - (1 + k) * ROW, '/', tone(0.8), b * 0.8);
      }
    }
  }
  // Follow-through: a rod spreads from the knot and the veil drops from it.
  const spread = easeOut((p - 0.4) / 0.22), width = 1.35 * spread;
  if (spread <= 0) return;
  for (let k = -14; k <= 14; k++) {
    const u = Math.abs(k) / 14;
    plot(k / 14 * width, knotZ + Math.sin(k * 0.8 + t * 4) * 0.025, k % 3 ? '-' : '~',
      tone(1 - u * 0.5), fade * (1 - u * 0.4) * spread);
  }
  for (let j = -5; j <= 5; j++) {
    const drop = easeOut((p - 0.47 - Math.abs(j) * 0.018) / 0.3);
    const length = (1.75 + 0.3 * (1 - (j / 5) ** 2)) * drop, rows = Math.floor(length / ROW);
    const glintAt = ((t * 1.1 + hash(j + 20)) % 1) * (rows + 3);
    const opening = Math.abs(j) === 1 || Math.abs(j) === 2 ? Math.sign(j) * 0.06 * ease((p - 0.56) / 0.25) : 0;
    for (let r = 0; r < rows && r < 13; r++) {
      const bend = Math.sin(r * Math.PI / 12) * opening;
      const sway = Math.sin(t * 2.4 + r * 0.45 + j * 0.9) * 0.05 * (r + 1) / 13;
      const breakAt = 0.74 + 0.18 * (1 - r / 13) + hash(j * 13 + r) * 0.05;
      const fall = clamp01((p - breakAt) / 0.2);
      let x = j / 5 * width * 0.92 + sway + bend, z = knotZ + (r + 1) * ROW;
      let v = 1 - r / 16, char = thread(v), color = tone(v * 0.9);
      if (Math.abs(r - glintAt) < 0.6) { char = '!'; color = tone(1); v = 1; }
      if (fall > 0) {
        const seconds = fall * 0.2 * effect.life;
        z += seconds * seconds * 1.3; x += Math.sin(r + j * 2.1 + t * 3) * 0.08 * fall;
        char = fall < 0.5 ? "'" : '.';
      }
      plot(x, z, char, color, fade * (0.45 + v * 0.55) * (1 - fall));
    }
  }
  const open = easeOut((p - 0.55) / 0.25);
  if (open > 0) for (const side of [-1, 1]) {
    eyelet(plot, side * 1.5 / 5 * width * 0.92, knotZ + 0.95, 0.03 + open * 0.07, 2, fade * open * 0.9, 0);
  }
}

function projectile(effect, plot) {
  const t = effect.age, fade = clamp01((1 - effect.progress) / 0.25);
  const h = effect.heading || 0, line = stroke(Math.sin(h), Math.cos(h));
  // The head is a bright, upright eyelet; streamers trail along the flight path.
  eyelet(upright(effect, plot), 0, 0, 0.1 + Math.sin(t * 22) * 0.015, 2, fade, 1);
  for (let s = -1; s <= 1; s++) {
    for (let k = 1; k <= 10; k++) {
      const lateral = s * 0.11 * (1 + k * 0.09) + Math.sin(t * 15 - k * 0.8 + s * 2) * 0.022 * k;
      const v = (1 - k / 11) ** 1.2 * (s ? 0.85 : 1);
      plot(lateral, -0.16 - k * 0.15, k < 4 ? line : k < 7 ? ':' : '.', tone(v), fade * (0.25 + v * 0.75));
    }
  }
  for (let m = 0; m < 10; m++) {
    const q = (t / 0.32 + hash(m)) % 1;
    const lateral = (hash(m + 3) - 0.5) * (0.18 + q * 0.4) + Math.sin(t * 6 + m) * 0.04;
    plot(lateral, -0.25 - q * 1.5 - hash(m + 9) * 0.2, q < 0.3 ? '*' : q < 0.65 ? '+' : '.',
      tone(0.9 - q * 0.6), fade * Math.sin(Math.PI * q) * 0.8);
  }
}

function impact(effect, plot) {
  const p = effect.progress, t = effect.age, fade = (1 - p) ** 1.4, cz = -0.9;
  const flash = Math.exp(-((p / 0.12) ** 2));
  eyelet(plot, 0, cz, 0.12 + easeOut(p / 0.5) * 0.4, 2 + Math.round(easeOut(p / 0.4) * 2), fade, flash + 0.3 * fade);
  // Shards of the veil burst outward from the eyelet and slow down.
  for (let i = 0; i < 18; i++) {
    const a = i / 18 * Math.PI * 2 + hash(i) * 0.25, reach = 0.7 + hash(i + 40) * 0.7;
    const d = easeOut(p / 0.55) * reach, dx = Math.cos(a), dz = Math.sin(a) * 0.62;
    const glyph = stroke(dx, dz), b = fade * (0.6 + flash * 0.4) * (1 - clamp01((p - 0.5) / 0.45));
    plot(dx * (0.25 + d), cz + dz * (0.25 + d), glyph, tone(1 - p * 0.6), b);
    plot(dx * (0.16 + d * 0.8), cz + dz * (0.16 + d * 0.8), '.', tone(0.7 - p * 0.4), b * 0.6);
  }
  // Two curtains part to either side, billowing outward at the hem.
  const part = easeOut(p / 0.6);
  for (const side of [-1, 1]) {
    for (let j = 0; j < 4; j++) {
      for (let r = 0; r < 8; r++) {
        const x = side * (0.18 + j * 0.2 + part * 0.95 + r * r * 0.0025 * (1 + part))
          + Math.sin(t * 3 + r * 0.6 + j) * 0.03;
        const v = (1 - r / 10) * (1 - j * 0.15);
        plot(x, -1.65 + r * ROW * 1.15, thread(v), tone(v * 0.85), fade * (0.4 + v * 0.6));
      }
    }
  }
  // Frost motes settle out of the burst.
  for (let i = 0; i < 20; i++) {
    const a = hash(i + 70) * Math.PI * 2, speed = 0.6 + hash(i + 90) * 0.9, tau = p * effect.life;
    const d = speed * (1 - Math.exp(-3 * tau)) / 3 * 2.4;
    plot(Math.cos(a) * d, cz + Math.sin(a) * d * 0.6 + tau * tau * 0.9, i % 3 ? '.' : '*',
      tone(0.75 - p * 0.4), fade * clamp01(p * 8) * 0.8);
  }
}

function zone(effect, plot) {
  const p = effect.progress, t = effect.age, life = effect.life;
  const R = Math.min(10, Math.max(1.2, effect.radius));
  const intro = t / Math.min(0.9, life * 0.45);
  const fade = clamp01((1 - p) * life / Math.min(0.8, life * 0.35));
  const half = Math.min(1.8, 0.35 * R + 0.4) * easeOut(intro / 0.6), top = -1.9;
  // A faint frost ring marks the ground the veil watches over.
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2 + t * 0.08, depth = 0.5 + 0.5 * Math.cos(a);
    plot(Math.sin(a) * R, Math.cos(a) * R, i % 2 ? '.' : stroke(Math.cos(a), -Math.sin(a)),
      tone(0.15 + depth * 0.4), fade * ease(intro - 0.3) * (0.2 + depth * 0.35));
  }
  // The rod: a rippling hem the threads hang from.
  for (let k = -9; k <= 9; k++) {
    const u = Math.abs(k) / 9;
    plot(k / 9 * half, top + Math.sin(k * 0.7 + t * 1.8) * 0.03, k % 3 ? '-' : '~',
      tone(0.95 - u * 0.45), fade * (1 - u * 0.4) * clamp01(intro * 3));
  }
  // Thirteen threads drop with a sagging hem; a slow wave of light crosses them.
  for (let j = -6; j <= 6; j++) {
    const drop = easeOut(intro - 0.25 - Math.abs(j) * 0.03);
    const n = Math.min(8, Math.floor((0.95 + 0.35 * (1 - (j / 6) ** 2) + hash(j + 4) * 0.12) * drop * fade ** 0.5 / ROW));
    const shimmer = 0.72 + 0.28 * Math.sin(t * 1.9 - j * 0.55);
    const glintAt = ((t * 0.45 + hash(j + 9)) % 1) * (n + 5);
    for (let r = 1; r <= n; r++) {
      const sway = Math.sin(t * 1.4 - j * 0.5 + r * 0.35) * 0.07 * r / 8;
      let v = shimmer * (1 - 0.5 * r / (n + 1)), char = thread(v), color = tone(v * 0.92);
      if (Math.abs(r - glintAt) < 0.6) { char = '!'; color = tone(1); v = 1; }
      plot(j / 6 * half * 0.94 + sway, top + r * ROW, char, color, fade * (0.3 + 0.65 * v));
    }
  }
  // Three eyelets woven between the threads breathe open and closed.
  const open = easeOut(intro - 0.55);
  if (open > 0) for (let e = -1; e <= 1; e++) {
    const breath = 0.5 + 0.5 * Math.sin(t * 2.1 + e * 1.3), x = e ? e * 3.5 / 6 * half * 0.94 : half * 0.94 / 12;
    eyelet(plot, e ? x : 0, top + (e ? 0.62 : 0.85), (0.04 + 0.05 * breath) * open, 2,
      fade * open * (0.65 + 0.35 * breath), e ? 0 : 0.3 + breath * 0.6);
  }
  // Frost motes drift down out of the veil.
  for (let m = 0; m < 8; m++) {
    const q = (t / 2.2 + hash(m + 5)) % 1, x = (hash(m + 31) * 2 - 1) * half * 1.15;
    plot(x + Math.sin(t * 0.9 + m) * 0.1, top + 0.4 + q * 1.8, q < 0.4 ? '*' : q < 0.7 ? '+' : '.',
      tone(0.85 - q * 0.45), fade * clamp01(intro - 0.5) * Math.sin(Math.PI * q) * 0.7);
  }
}

function pulse(effect, plot) {
  const p = effect.progress, t = effect.age;
  const R = Math.min(12, Math.max(0.8, effect.radius));
  const env = clamp01(p / 0.1) * clamp01((1 - p) / 0.35), ring = R * (0.8 + 0.2 * easeOut(p));
  // A dashed frost ring sweeps out to the edge of the silence.
  const spin = t * 0.25, step = 0.13 / R;
  for (let i = 0; i < 14; i++) {
    const centre = i / 14 * Math.PI * 2 + spin + hash(i) * 0.08;
    const depth = 0.6 + 0.4 * Math.cos(centre);
    for (let j = -1; j <= 1; j++) {
      const a = centre + j * step * (1 + Math.abs(Math.sin(centre)) * 0.3);
      const x = Math.sin(a) * ring, z = Math.cos(a) * ring;
      plot(x, z, j ? stroke(Math.cos(a), -Math.sin(a)) : '*', tone(j ? 0.75 * depth : depth),
        env * depth * (j ? 0.7 : 1));
    }
  }
  // Silenced air glitters with slowly sinking motes.
  for (let m = 0; m < 34; m++) {
    const rr = R * 0.95 * Math.sqrt(hash(m + 11)), a = hash(m + 23) * Math.PI * 2, bright = hash(m + 47);
    const twinkle = 0.55 + 0.45 * Math.sin(t * 9 + m * 1.7);
    plot(Math.sin(a) * rr, Math.cos(a) * rr - 0.35 + p * 0.25, bright > 0.8 ? '*' : bright > 0.5 ? "'" : '.',
      tone(0.35 + bright * 0.55), env * twinkle * (0.35 + bright * 0.5));
  }
}

function aura(effect, plot) {
  const p = effect.progress, t = effect.age;
  const s = Math.min(1.5, Math.max(0.6, effect.radius));
  const env = clamp01(p / 0.15) * clamp01((1 - p) / 0.3);
  // A frost hoop slides down over the silenced target, trailing short threads.
  const zc = -1.75 * s * (1 - ease(p)), rho = 0.55 * s * (1 + 0.15 * p);
  for (let i = 0; i < 18; i++) {
    const b = i / 18 * Math.PI * 2 + t * 1.2, depth = 0.55 + 0.45 * Math.cos(b);
    plot(Math.sin(b) * rho, zc + Math.cos(b) * rho, stroke(Math.cos(b), -Math.sin(b)),
      tone(depth), env * (0.3 + 0.7 * depth));
  }
  for (let k = -2; k <= 2; k++) {
    const b = k * 0.45, x = Math.sin(b) * rho, z = zc + Math.cos(b) * rho;
    const sway = Math.sin(t * 3 + k) * 0.03;
    plot(x + sway, z + ROW, ':', tone(0.65), env * 0.75);
    plot(x + sway * 2, z + 2 * ROW, '.', tone(0.45), env * 0.5);
  }
  // A sealed eyelet over the head marks the silence, then fades as the hoop falls.
  const seal = p < 0.45 ? Math.sin(Math.PI * p / 0.45) : 0;
  if (seal > 0) {
    const z = -1.95 * s;
    plot(-0.2, z, '<', tone(0.9), seal * env);
    plot(-0.1, z, '-', tone(0.8), seal * env);
    plot(0, z, '=', tone(1), seal * env);
    plot(0.1, z, '-', tone(0.8), seal * env);
    plot(0.2, z, '>', tone(0.9), seal * env);
  }
}

const STAGES = { cast, impact, zone, pulse, aura };

export default {
  id: 'frostveil', duration: 1.25,
  draw(effect, plot) {
    if (effect.stage === 'projectile') return projectile(effect, plot);
    (STAGES[effect.stage] ?? pulse)(effect, upright(effect, plot));
  },
  sounds: {
    cast: [
      // Real outdoor wind opens the veil; a restrained breath and close ice creak follow.
      { kind: 'recording', url: '/assets/audio/spells/seithr/wind-swell.wav', gain: 0.36, rate: 0.92, delay: 0 },
      { kind: 'recording', url: '/assets/audio/spells/seithr/cold-breath.wav', gain: 0.18, rate: 0.96, delay: 0.22 },
      { kind: 'recording', url: '/assets/audio/spells/seithr/ice-grit.wav', gain: 0.12, rate: 0.88, delay: 0.48 },
    ],
    impact: [
      // A soft physical scuff settles the curtain into an exhaled, wind-carried hush.
      { kind: 'recording', url: '/assets/audio/spells/seithr/snow-scuff.wav', gain: 0.18, rate: 0.9, delay: 0 },
      { kind: 'recording', url: '/assets/audio/spells/seithr/cold-breath.wav', gain: 0.2, rate: 0.88, delay: 0.08 },
      { kind: 'recording', url: '/assets/audio/spells/seithr/wind-swell.wav', gain: 0.22, rate: 1.04, delay: 0.28 },
    ],
    pulse: [
      // Dense silence-field repeats use just one quiet piece of recorded ice foley.
      { kind: 'recording', url: '/assets/audio/spells/seithr/ice-tick.wav', gain: 0.1, rate: 1.19, delay: 0.009 },
    ],
  },
};
