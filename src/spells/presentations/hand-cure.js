// Hand Cure: a spectral hand of living light forms beside the caster, light
// flows from the wrist into the fingertips and the hand lifts away as motes.
// On the ally a healing cross blooms at the chest, grass tufts sprout in a ring
// and sparks rise through them. Art is authored in screen cells and
// counter-rotated by the heading so it stays upright at any facing.
// One metre spans SCALE / ASPECT columns and SCALE * TILT rows (13 / 0.6, 13 * 0.5).
const COLS = 13 / 0.6, ROWS = 6.5;
const deep = [46, 150, 92], leaf = [94, 214, 133], light = [183, 248, 175], gold = [255, 226, 159], white = [246, 255, 236];
const RAMP = [deep, leaf, light, gold, white];
const GLOW = '.,:;+*#@';

// '.' marks the palm and finger interior; every other glyph is the outline.
const HAND = [
  '       _',
  '     _|.|_',
  '   _|.|.|.|',
  '  |.|.|.|.|',
  '  |.|.|.|.|  _',
  '  |.|.|.|.| /./',
  "  |.'.'.'.|/./",
  "  |.......'./",
  '  |......../',
  '   \\....../',
  '    \\..../',
  '     |..|',
  '     |  |',
];
const PALM_COL = 6, PALM_ROW = 7, LAST_ROW = HAND.length - 1;
const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const outline = [], interior = [];
HAND.forEach((line, row) => {
  for (let col = 0; col < line.length; col++) {
    const ch = line[col];
    if (ch === ' ') continue;
    // order runs from 0 at the wrist to 1 at the middle fingertip: light flows upward.
    const cell = { c: col - PALM_COL, r: row - PALM_ROW, ch, order: 1 - row / LAST_ROW, seed: hash(col * 31 + row * 7) };
    (ch === '.' ? interior : outline).push(cell);
  }
});
const mirrored = { '/': '\\', '\\': '/' };

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = v => { v = clamp01(v); return v * v * (3 - 2 * v); };
const easeOut = v => 1 - (1 - clamp01(v)) ** 3;
const backOut = v => { v = clamp01(v) - 1; return 1 + 2.7 * v ** 3 + 1.7 * v ** 2; };
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const tint = t => { t = clamp01(t) * 4; const i = Math.min(3, Math.floor(t)); return mix(RAMP[i], RAMP[i + 1], t - i); };
const mote = u => (u < 0.3 ? '*' : u < 0.6 ? '+' : u < 0.85 ? "'" : '.');
// Glyph tangent to a screen-space ellipse at angle a (rows grow downward).
const rim = a => {
  const c = Math.cos(a), s = Math.sin(a);
  return Math.abs(s) > 0.8 ? '-' : Math.abs(c) > 0.8 ? (c > 0 ? ')' : '(') : c * s > 0 ? '/' : '\\';
};

function cast(p, age, put, side) {
  // The hand rises into place beside the caster's chest, thumb turned outward.
  const ax = side * 19, ay = -13 - Math.round(2 * (1 - easeOut(p / 0.4)));
  // Anticipation: leaf motes spiral in from a wide ellipse onto the palm.
  for (let i = 0; i < 26; i++) {
    const u = (p - hash(i + 50) * 0.12) / 0.32;
    if (u <= 0 || u >= 1) continue;
    const a = hash(i) * Math.PI * 2, spin = i % 2 ? 2.4 : -2.4, rx = 17 + hash(i + 9) * 10, ry = 6 + hash(i + 19) * 3;
    const at = v => { const e = v * v, k = 1 - e, ang = a + e * spin; return [ax + Math.cos(ang) * rx * k, ay + Math.sin(ang) * ry * k]; };
    const glow = smooth(u / 0.2) * (1 - smooth((u - 0.82) / 0.18));
    const [x, y] = at(u);
    put(x, y, u < 0.4 ? "'" : u < 0.75 ? '+' : '*', tint(0.3 + 0.6 * u), glow);
    if (u > 0.08) { const [tx, ty] = at(u - 0.08); put(tx, ty, '.', leaf, glow * 0.45); }
  }
  // Light traces the outline from the wrist up; each cell later dissolves
  // bottom-up, drifting upward as a dimming ':' then '.'.
  const front = easeOut((p - 0.04) / 0.36) * 1.15;
  const dissolve = cell => clamp01((p - (0.56 + cell.order * 0.2 + cell.seed * 0.08)) / 0.14);
  for (const cell of outline) {
    if (cell.order >= front) continue;
    const k = dissolve(cell);
    if (k >= 1) continue;
    const fresh = 1 - clamp01((front - cell.order) / 0.15);
    const ch = k > 0.55 ? '.' : k > 0.2 ? ':' : side < 0 ? mirrored[cell.ch] ?? cell.ch : cell.ch;
    put(ax + side * cell.c + 0.5, ay + cell.r + 0.5 - k * 2.5, ch,
      k > 0 ? mix(light, deep, k) : mix(light, white, 0.35 + 0.65 * fresh), (0.7 + 0.3 * fresh) * (1 - k) * smooth((front - cell.order) / 0.08));
  }
  // Palm glow: a core that swells and flashes at the hand's peak while a band
  // of light climbs the fingers.
  const core = smooth((p - 0.1) / 0.3), flash = Math.exp(-(((p - 0.42) / 0.06) ** 2)), flow = (p - 0.22) / 0.36;
  for (const cell of interior) {
    if (cell.order >= front) continue;
    const k = dissolve(cell);
    if (k >= 1) continue;
    const d = clamp01(Math.hypot(cell.c * 0.55, cell.r) / 5.5);
    const wave = cell.r < -1 ? Math.exp(-(((cell.order - flow) / 0.12) ** 2)) * 0.5 : 0;
    const shimmer = 0.07 * Math.sin(age * 9 + cell.seed * 6.3);
    const glow = clamp01((core * 0.62 + flash * 0.4) * (1 - d) ** 1.4 + wave + shimmer) * (1 - k);
    if (glow < 0.16) continue;
    put(ax + side * cell.c + 0.5, ay + cell.r + 0.5 - k * 2.5, GLOW[Math.min(GLOW.length - 1, Math.floor(glow * GLOW.length))],
      tint(0.25 + glow * 0.75), (0.35 + 0.65 * glow) * smooth((front - cell.order) / 0.08));
  }
  // Fingertip glints sparkle once the light reaches them.
  for (const cell of outline) {
    if (cell.ch !== '_') continue;
    const t = (p - 0.3 - cell.order * 0.12) / 0.32;
    if (t <= 0 || t >= 1) continue;
    put(ax + side * cell.c + 0.5, ay + cell.r - 0.5, t < 0.6 ? '*' : '+', mix(white, gold, t), Math.sin(t * Math.PI));
  }
  // Release: a ground ripple at the caster's feet and motes lifting off the hand.
  const ring = (p - 0.38) / 0.5;
  if (ring > 0 && ring < 1) {
    const r = 0.35 + 0.75 * easeOut(ring), fade = (1 - ring) ** 1.5 * smooth(ring / 0.1);
    for (let i = 0; i < 24; i++) {
      const a = i / 24 * Math.PI * 2 + 0.13;
      put(Math.cos(a) * r * COLS, Math.sin(a) * r * ROWS, rim(a), mix(light, leaf, ring), fade * (0.7 + 0.3 * hash(i + 70)));
    }
  }
  for (let i = 0; i < 22; i++) {
    const start = 0.5 + hash(i + 30) * 0.22, u = (p - start) / (1 - start);
    if (u <= 0 || u >= 1) continue;
    const from = interior[(i * 7) % interior.length];
    put(ax + side * from.c + Math.sin(u * 5 + i) * 2, ay + from.r - easeOut(u) * 9 - u * u * 4, mote(u), tint(0.9 - u * 0.7),
      smooth(u / 0.08) * (1 - u) ** 1.2);
  }
}

// A ring of grass tufts sprouts around the target's feet, then wilts.
function sprouts(p, put, radius, count, sway = 0) {
  for (let i = 0; i < count; i++) {
    const a = i / count * Math.PI * 2 + 0.3, x = Math.cos(a) * 0.78 * radius * COLS, y = Math.sin(a) * 0.78 * radius * ROWS;
    const grow = backOut((p - 0.04 - hash(i + 90) * 0.1) / 0.28), wilt = smooth((p - 0.55) / 0.4);
    if (grow <= 0 || wilt >= 1) continue;
    const alive = 1 - wilt, height = 1 + Math.round(grow * 1.6), bend = Math.sin(sway + i) * 0.6;
    for (let h = 0; h < height; h++) {
      put(x + bend * h / 2 + 0.5, y - h + 0.5, wilt > 0.5 ? ',' : '|', mix(deep, leaf, (h + 1) / height), alive * 0.85);
    }
    if (grow > 0.5) {
      put(x - 0.5, y - 0.5, wilt > 0.5 ? '.' : '\\', leaf, alive * 0.75);
      put(x + 1.5, y - 0.5, wilt > 0.5 ? '.' : '/', leaf, alive * 0.75);
    }
    put(x + bend * height / 2 + 0.5, y - height + 0.5, grow > 0.8 && wilt < 0.4 ? '*' : "'", mix(gold, light, wilt), alive);
  }
}

// Sparks rise from the ground ellipse with a gentle sway. phase(i, u) maps the
// per-mote clock so the looping stages can reuse the same motion.
function sparks(p, put, count, phase, radius = 1) {
  for (let i = 0; i < count; i++) {
    const start = hash(i + 120) * 0.4, u = phase(i, (p - start) / (1 - start));
    if (u <= 0 || u >= 1) continue;
    const a = hash(i + 140) * Math.PI * 2, r = (0.25 + hash(i + 160) * 0.65) * radius;
    put(Math.cos(a) * r * COLS + Math.sin(u * 6 + i * 1.7) * 1.5, Math.sin(a) * r * ROWS - easeOut(u) * (14 + hash(i + 180) * 8),
      mote(u), tint(0.95 - u * 0.8), smooth(u / 0.1) * (1 - u) ** 1.3);
  }
}

function impact(p, put) {
  // Bright contact rays snap outward from the chest.
  const chest = -13;
  if (p < 0.35) {
    const reach = easeOut(p / 0.3), fade = (1 - p / 0.35) ** 2;
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4, c = Math.cos(a), s = Math.sin(a);
      const ch = Math.abs(s) < 0.1 ? '-' : Math.abs(c) < 0.1 ? '|' : c * s > 0 ? '\\' : '/';
      for (let j = 0; j < 3; j++) {
        const d = 5 + j * 3 + reach * 10;
        put(c * d, chest + s * d * 0.42, ch, mix(white, gold, j / 2), fade * (1 - j * 0.25));
      }
    }
  }
  // The healing cross pops with overshoot, then lifts and fades.
  const size = backOut(p / 0.2), flash = Math.exp(-((p / 0.09) ** 2));
  const lift = chest - 2 * smooth((p - 0.35) / 0.65), cross = 1 - smooth((p - 0.45) / 0.45);
  if (cross > 0) {
    const arm = Math.round(7 * size), tall = Math.round(3.5 * size);
    for (let j = 1; j <= arm; j++) for (const dir of [-1, 1]) {
      const i = 1 - j / (arm + 1);
      put(dir * j + 0.5, lift + 0.5, i > 0.5 ? '=' : '-', tint(0.55 + 0.45 * i + flash), cross * (0.55 + 0.45 * i));
    }
    for (let j = 1; j <= tall; j++) for (const dir of [-1, 1]) {
      const i = 1 - j / (tall + 1);
      put(0.5, lift + dir * j + 0.5, i > 0.4 ? '|' : ':', tint(0.55 + 0.45 * i + flash), cross * (0.55 + 0.45 * i));
    }
    put(0.5, lift + 0.5, flash > 0.3 ? '@' : '#', mix(gold, white, flash), cross);
  }
  sprouts(p, put, 1, 9);
  sparks(p, put, 22, (i, u) => u);
}

function pulse(p, put) {
  // A quick contact shock: a crisp ellipse rim with a lagging inner ring.
  const fade = (1 - p) ** 1.4;
  for (const [n, scale, lag, bright] of [[30, 1, 0, 1], [18, 0.6, 0.12, 0.55]]) {
    if (p < lag) continue;
    const r = (0.25 + 0.95 * easeOut((p - lag) / (1 - lag))) * scale;
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2;
      put(Math.cos(a) * r * COLS, Math.sin(a) * r * ROWS, scale < 1 ? '.' : rim(a), mix(white, light, p), fade * bright);
    }
  }
  const r = 0.25 + 0.95 * easeOut(p);
  for (let i = 0; i < 8; i++) {
    const a = hash(i + 200) * Math.PI * 2, twinkle = 0.5 + 0.5 * Math.sin(p * 40 + i * 2.1);
    put(Math.cos(a) * r * COLS, Math.sin(a) * r * ROWS - 1, '*', gold, fade * twinkle);
  }
}

function linger(p, age, plot, radius) {
  // Aura and zone: a breathing rim, swaying tufts and an endless rise of sparks
  // that ease in over the first tenth of the effect.
  const r = Math.min(3, Math.max(0.5, radius)), breathe = 0.85 + 0.15 * Math.sin(age * 3), arrive = smooth(p * 10);
  const put = (x, y, ch, color, b) => plot(x, y, ch, color, b * arrive);
  for (let i = 0; i < 28; i++) {
    const a = i / 28 * Math.PI * 2 + age * 0.4;
    put(Math.cos(a) * r * breathe * COLS, Math.sin(a) * r * breathe * ROWS, i % 3 ? '.' : rim(a), leaf,
      0.45 + 0.2 * Math.sin(age * 3 + i));
  }
  sprouts(0.5, put, r, 8, age * 2);
  sparks(0, put, 24, i => { const v = age * 0.7 + hash(i + 220); return v - Math.floor(v); }, r);
}

function projectile(age, put) {
  // A compact palm of light with orbiting leaves and a drifting sparkle trail.
  for (let j = 0; j < 10; j++) {
    const k = j / 10;
    put(Math.sin(age * 10 + j) * k * 3, k * 9 + 2, k < 0.3 ? '*' : k < 0.6 ? '+' : '.', tint(0.85 - k * 0.7), 1 - k);
  }
  for (let i = 0; i < 4; i++) {
    const a = age * 8 + i * Math.PI / 2;
    put(Math.cos(a) * 5, Math.sin(a) * 1.6, i % 2 ? '(' : ')', light, 0.8);
  }
  put(0.5, 0.5, '@', gold, 1);
}

export default {
  id: 'hand-cure',
  duration: 0.95,
  draw(effect, plot) {
    const p = effect.progress, age = effect.age, heading = effect.heading || 0;
    const cos = Math.cos(heading), sin = Math.sin(heading), guard = clamp01((1 - p) * 12);
    // (column, row) screen-cell offsets become local metres that the adapter
    // rotates back onto exactly that cell, keeping the art upright.
    const put = (col, row, char, color, brightness) => {
      const wx = col / COLS, wz = row / ROWS;
      plot(wx * cos - wz * sin, wx * sin + wz * cos, char, color, clamp01(brightness) * guard);
    };
    switch (effect.stage) {
      case 'cast': return cast(p, age, put, sin < -0.2 ? -1 : 1);
      case 'impact': return impact(p, put);
      case 'pulse': return pulse(p, put);
      // Projectiles fly along the heading, so their trail stays heading-relative (behind = -z).
      case 'projectile': return projectile(age, (col, row, char, color, brightness) =>
        plot(col / COLS, -row / ROWS, char, color, clamp01(brightness) * guard));
      default: return linger(p, age, put, effect.radius);
    }
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
