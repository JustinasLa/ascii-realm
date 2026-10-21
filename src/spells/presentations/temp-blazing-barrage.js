// Blazing Barrage: six fire circles kindle in a fan above the caster on TF's
// 3-tick cadence, each one spits a fireball down into flight, then the circles
// collapse into a single ±48° fireblast. Rounds are comet-tailed fireballs and
// hits bloom into a churning, rising fireball. Pure and clock-driven: no timers,
// no Math.random; every variation comes from a hash of the glyph index.
const DURATION = 1.65;
const TAU = Math.PI * 2;
// One local metre spans 26 columns across and 6.5 rows down the screen.
const COLS = 26, ROWS = 6.5;
// TF schedule: circle i appears every 3 ticks, fires 4 ticks later; fireblast at 1.25s.
const SHOT_SPACING = 0.15, SHOT_DELAY = 0.2, GATHER_AT = 1.0, BLAST_AT = 1.25;
const LAUNCH_Z = 0.4, BLAST_Z = 0.3, FAN = 48 * Math.PI / 180;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const easeOut = t => 1 - (1 - clamp(t, 0, 1)) ** 3;
const easeIn = t => clamp(t, 0, 1) ** 2;
const frac = value => value - Math.floor(value);
const hash = n => frac(Math.sin(n * 127.1 + 311.7) * 43758.5453);

// Heat ramp: soot -> deep ember -> red -> orange -> amber -> yellow -> white-hot.
const STOPS = [[52, 24, 22], [110, 32, 20], [178, 46, 18], [228, 80, 22], [252, 122, 30],
  [255, 166, 46], [255, 208, 92], [255, 238, 160], [255, 252, 232]];
const RAMP = Array.from({ length: 33 }, (_, i) => {
  const t = i / 32 * (STOPS.length - 1), j = Math.min(STOPS.length - 2, Math.floor(t)), f = t - j;
  return STOPS[j].map((v, n) => Math.round(v + (STOPS[j + 1][n] - v) * f));
});
const SMOKE = [78, 56, 50];
const LAYER_HEAT = [1, 0.72, 0.42];
const FLAME = '.:-=+*#%@';
const heatColor = heat => RAMP[Math.round(clamp(heat, 0, 1) * 32)];
const flame = heat => FLAME[Math.round(clamp(heat, 0, 1) * 8)];
const spark = heat => heat > 0.62 ? '*' : heat > 0.34 ? '+' : heat > 0.16 ? ':' : '.';

// Billboarded fireball head in screen cells: [column, row, heat].
const HEAD = [
  [-2, -1, 0.38], [-1, -1, 0.62], [0, -1, 0.74], [1, -1, 0.62], [2, -1, 0.38],
  [-3, 0, 0.34], [-2, 0, 0.7], [-1, 0, 0.9], [0, 0, 1], [1, 0, 0.9], [2, 0, 0.7], [3, 0, 0.34],
  [-2, 1, 0.38], [-1, 1, 0.62], [0, 1, 0.74], [1, 1, 0.62], [2, 1, 0.38],
];
// A fire circle sigil, perimeter cells clockwise from the left: [column, row, glyph].
const RING = [
  [-4, 0, '('], [-3, -1, '.'], [-2, -1, '-'], [-1, -1, '~'], [0, -1, '='], [1, -1, '~'], [2, -1, '-'], [3, -1, '.'],
  [4, 0, ')'], [3, 1, "'"], [2, 1, '-'], [1, 1, '~'], [0, 1, '='], [-1, 1, '~'], [-2, 1, '-'], [-3, 1, '`'],
];
// Circle centres in screen metres (x right, y up) in firing order: the inner pair,
// the outer pair, then the raised pair, mirroring TF's side offsets and heights.
const BARRELS = [[-0.4, 0.62], [0.4, 0.62], [-1.12, 0.5], [1.12, 0.5], [-0.76, 1.12], [0.76, 1.12]];

// The pen converts between local ground metres (x right, z forward) and screen
// metres (x right, y up) using the effect heading the adapter will apply.
const toSX = (pen, x, z) => x * pen.c + z * pen.s;
const toSY = (pen, x, z) => x * pen.s - z * pen.c;
function local(pen, x, z, char, color, light) {
  if (light > 0.004) pen.plot(x, z, char, color, Math.min(1, light));
}
function screen(pen, sx, sy, char, color, light) {
  if (light > 0.004) pen.plot(sx * pen.c + sy * pen.s, sx * pen.s - sy * pen.c, char, color, Math.min(1, light));
}
// Line glyph for a screen-metre direction, judged in pixels (cells are twice as tall as wide).
function stroke(dx, dy) {
  const k = Math.round(Math.atan2(-dy * ROWS * 2, dx * COLS) / (Math.PI / 4));
  return '-\\|/'[((k % 4) + 4) % 4];
}
const strokeLocal = (pen, x, z) => stroke(toSX(pen, x, z), toSY(pen, x, z));

function projectile(pen) {
  const { age, p } = pen;
  const fade = Math.min(1, (1 - p) * 10), grow = easeOut(age / 0.12);
  // Forward and sideways extents in cells keep strands about one cell apart at any heading.
  const forwardCells = Math.hypot(pen.s * COLS, pen.c * ROWS);
  const sideCells = Math.hypot(pen.c * COLS, pen.s * ROWS);
  // Shed sparks peel off behind the round, drag outwards and cool.
  for (let k = 0; k < 8; k++) {
    const period = 0.3 + 0.14 * hash(k), u = frac(age / period + hash(k + 11));
    const drift = (hash(k + 5) - 0.5) * 0.55 * (1 - Math.exp(-u * 3));
    const z = -0.12 - u * (0.8 + 0.6 * hash(k + 3));
    const heat = 0.9 * (1 - u);
    local(pen, drift + Math.sin(u * 6 + k) * 0.03, z, u < 0.35 ? '*' : k % 2 ? "'" : '.',
      heatColor(heat), (1 - u) * Math.min(1, u * 8) * 0.85 * fade * grow);
  }
  // Tapered comet tail: a hot spine with two cooler licking flanks.
  const length = 1.25 * grow, count = clamp(Math.round(length * forwardCells), 4, 28);
  const minWidth = 1.05 / sideCells;
  for (let i = count - 1; i >= 0; i--) {
    const u = (i + 0.5) / count, z = -0.1 - u * length;
    const sway = (Math.sin(z * 7 + age * 26) * 0.035 + Math.sin(z * 13 - age * 41) * 0.018) * u;
    const heat = (1 - u) ** 1.2 * 0.92 * (0.9 + 0.1 * Math.sin(age * 37 + i * 2.1));
    const width = Math.max(0.1 * (1 - u) ** 0.7, minWidth) * (0.85 + 0.15 * Math.sin(age * 19 + i));
    if (u < (minWidth > 0.1 ? 0.45 : 0.6)) {
      for (let side = -1; side <= 1; side += 2) {
        local(pen, sway + side * width, z + 0.5 * length / count, flame(heat * 0.68), heatColor(heat * 0.68),
          (0.18 + 0.7 * heat) * fade);
      }
    }
    local(pen, sway, z, flame(heat), heatColor(heat), (0.22 + 0.78 * heat) * fade);
  }
  // Round white-hot head, brighter on its leading face.
  const fx = pen.s * COLS, fy = pen.c * ROWS * 2, fl = Math.hypot(fx, fy) || 1;
  for (let i = 0; i < HEAD.length; i++) {
    const [col, row, base] = HEAD[i];
    if (base < 1 - grow) continue;
    const cl = Math.hypot(col, row * 2) || 1;
    const lead = (col * fx + row * 2 * fy) / (cl * fl) * (cl > 1 ? 1 : 0);
    const heat = clamp(base * (0.86 + 0.14 * Math.sin(age * 33 + i * 2.3)) + 0.16 * Math.max(lead, -0.25), 0, 1);
    screen(pen, col / COLS, -row / ROWS, flame(heat), heatColor(heat), (0.45 + 0.55 * heat) * fade);
  }
}

// Small flame puff: the fireblast leaves a chain of these and hits flare with them.
function pulse(pen) {
  const { age, p } = pen;
  const size = clamp(pen.radius, 0.3, 2.4) * 0.38;
  const grow = easeOut(p / 0.3), fade = 1 - smooth((p - 0.3) / 0.7), core = 1 - p * 0.8;
  for (let k = 0; k < 3; k++) {
    // Every puff completes its rise exactly at p = 1, so nothing pops at the end.
    const u = clamp((p - 0.35 - k * 0.08) / (0.65 - k * 0.08), 0, 1);
    if (u <= 0) continue;
    screen(pen, (hash(k + 30) - 0.5) * size, size * (0.35 + 1.1 * u), k % 2 ? '~' : ':', SMOKE,
      Math.sin(Math.PI * u) * 0.32);
  }
  for (let k = 0; k < 6; k++) {
    const a = hash(k) * TAU, r = size * (0.6 + 1.3 * hash(k + 3)) * (1 - Math.exp(-p * 5));
    const lift = size * (0.4 + 0.5 * hash(k + 6)) * 2.4 * p * (1 - p);
    const heat = 0.85 * (1 - p);
    screen(pen, toSX(pen, Math.sin(a) * r, Math.cos(a) * r), toSY(pen, Math.sin(a) * r, Math.cos(a) * r) + lift,
      p < 0.4 ? "'" : '.', heatColor(heat), heat * fade);
  }
  for (let k = 0; k < 7; k++) {
    const a = k / 7 * TAU + hash(k + 9) * 0.6 + age * 0.8;
    const reach = size * (0.55 + 0.45 * hash(k + 7)) * grow * (0.85 + 0.15 * Math.sin(age * 37 + k));
    for (let m = 1; m >= 0; m--) {
      const r = reach * (m ? 1 : 0.5), heat = core * (m ? 0.55 : 0.85);
      const x = Math.sin(a) * r, z = Math.cos(a) * r;
      screen(pen, toSX(pen, x, z), toSY(pen, x, z) + size * 0.45 * p * (m ? 1 : 0.5),
        flame(heat), heatColor(heat), (0.3 + 0.7 * heat) * fade);
    }
  }
  for (let k = -1; k <= 1; k++) {
    const heat = core * (k ? 0.82 : 1);
    screen(pen, k / COLS, 0, flame(heat), heatColor(heat), (0.4 + 0.6 * heat) * fade);
  }
}

// A churning fireball that flashes white, rolls outward and upward, hollows from
// the middle as it burns out, throws arcing embers and leaves a scorch ring.
function impact(pen) {
  const { age, p } = pen;
  const size = clamp(pen.radius, 0.5, 2.4) * 0.75;
  const tail = 1 - smooth((p - 0.5) / 0.5);
  const burn = smooth(p / 0.6);
  const rise = size * 0.35 * p * p;
  // Scorch ring on the ground.
  if (p > 0.12) {
    for (let k = 0; k < 16; k++) {
      const a = k / 16 * TAU + hash(k + 70) * 0.3, r = size * (1.12 + 0.1 * hash(k + 71));
      local(pen, Math.sin(a) * r, Math.cos(a) * r, k % 3 ? '.' : ',', heatColor(0.14 + 0.08 * hash(k)),
        smooth((p - 0.12) / 0.2) * (1 - p) * 0.5);
    }
  }
  // Smoke billowing up off the top.
  for (let k = 0; k < 8; k++) {
    const u = clamp((p - 0.25 - hash(k + 50) * 0.15) / 0.6, 0, 1);
    if (u <= 0) continue;
    const a = hash(k + 51) * TAU;
    screen(pen, Math.sin(a) * size * 0.5 + Math.sin(age * 3 + k) * 0.05,
      size * (0.25 + 1.2 * u) + Math.cos(a) * size * 0.15, k % 2 ? '~' : '(', SMOKE, Math.sin(Math.PI * u) * 0.38);
  }
  // Embers flung outwards (biased forward), arcing up and falling, cooling as they go.
  for (let k = 0; k < 26; k++) {
    const a = (hash(k) - 0.5) * TAU * 0.92, speed = size * (1.3 + 2.1 * hash(k + 1));
    const up = size * (0.4 + 0.9 * hash(k + 2));
    const heat = clamp(1 - p * 1.15 + 0.15 * hash(k + 3), 0, 1), light = heat * tail * Math.min(1, p * 25);
    for (let m = 1; m >= 0; m--) {
      const t = p * (m ? 0.82 : 1);
      const r = speed * 0.5 * (1 - Math.exp(-3.2 * t)), x = Math.sin(a) * r, z = Math.cos(a) * r;
      const lift = Math.max(-0.04, up * (2.6 * t - 3.4 * t * t));
      screen(pen, toSX(pen, x, z), toSY(pen, x, z) + lift, m ? '.' : spark(heat),
        heatColor(heat * (m ? 0.6 : 1)), light * (m ? 0.45 : 1));
    }
  }
  // White flash star for the first frames.
  const flash = 1 - smooth(p / 0.14);
  // Licking tongues curl up off the top of the ball.
  const ball = Math.min(0.47, size * 0.6) * (0.28 + 0.72 * easeOut(p / 0.4)) * (1 + 0.1 * smooth((p - 0.4) / 0.6));
  const halfCols = ball * COLS, halfRows = ball * COLS * 0.4;
  for (let k = 0; k < 9; k++) {
    const a = (k + 0.5) / 9 * Math.PI + (hash(k + 20) - 0.5) * 0.25;
    const tip = 1.12 + 0.3 * hash(k + 21) * (0.7 + 0.3 * Math.sin(age * 23 + k));
    for (let m = 1; m >= 0; m--) {
      const r = m ? tip : 1.04, heat = (1 - p) * (m ? 0.42 : 0.62);
      screen(pen, Math.cos(a) * r * halfCols / COLS + Math.sin(age * 9 + k) * 0.02 * m,
        Math.sin(a) * r * halfRows / ROWS + rise, m ? "'" : flame(heat), heatColor(heat), (0.25 + 0.75 * heat) * tail);
    }
  }
  // The fireball body: a solid, churning, round ball filled cell by cell
  // (every other column, staggered by row, so the glow never blooms into a blob).
  // The checkerboard is anchored to absolute cells (col + row even), so as the ball
  // grows it only gains perimeter cells and the existing body never shifts sideways.
  // White-hot in the middle at first, then the core burns out into a hollow shell.
  const rows = Math.ceil(halfRows * 1.3), cols = Math.ceil(halfCols * 1.3);
  for (let row = -rows; row <= rows; row++) {
    for (let col = -cols + ((row - cols) & 1); col <= cols; col += 2) {
      const nx = col / halfCols, ny = row / halfRows, d = Math.hypot(nx, ny), a = Math.atan2(ny, nx);
      const edge = 1 + 0.1 * Math.sin(5 * a + 1.7 + age * 2) + 0.07 * Math.sin(8 * a - age * 9)
        + Math.max(0, ny) * 0.18 * p;
      if (d > edge) continue;
      const q = d / edge, hollow = smooth((q - burn * 0.8 + 0.2) / 0.3);
      if (hollow <= 0) continue;
      const churn = 0.08 * Math.sin(col * 0.9 + row * 1.7 + age * 21) + 0.05 * Math.sin(row * 2.3 - col * 0.4 - age * 15);
      const shell = (1 - 0.55 * q) * (1 - burn) + (0.35 + 0.55 * q) * burn;
      const heat = clamp((1 - p) ** 0.8 * shell + churn + flash * (1 - q) * 0.5, 0, 1);
      screen(pen, col / COLS, row / ROWS + rise, flame(heat), heatColor(heat), hollow * (0.3 + 0.7 * heat) * tail);
    }
  }
  if (flash > 0) {
    for (let k = 0; k < 8; k++) {
      const a = k / 8 * TAU + 0.2, x = Math.sin(a), z = Math.cos(a), char = strokeLocal(pen, x, z);
      for (let m = 0; m < 3; m++) {
        const r = size * (0.25 + 0.3 * m) * (0.6 + 0.4 * easeOut(p / 0.1));
        local(pen, x * r, z * r, char, heatColor(1 - m * 0.12), flash * (1 - m * 0.25));
      }
    }
    local(pen, 0, 0, '@', heatColor(1), flash);
  }
}

// Burning target: flame tongues lick up around its footprint and embers rise.
function aura(pen) {
  const { age, p } = pen;
  const size = clamp(pen.radius, 0.5, 2) * 0.55;
  const env = easeOut(p / 0.12) * (1 - smooth((p - 0.6) / 0.4));
  if (p < 0.16) {
    const u = p / 0.16, r = size * (0.3 + 0.75 * easeOut(u));
    for (let k = 0; k < 12; k++) {
      const a = k / 12 * TAU;
      local(pen, Math.sin(a) * r, Math.cos(a) * r, '*', heatColor(1 - u * 0.4), 1 - u);
    }
  }
  for (let k = 0; k < 6; k++) {
    const u = frac(age / 1.1 + hash(k + 40));
    screen(pen, (hash(k + 41) - 0.5) * size * 1.2 + Math.sin(age * 2 + k) * 0.05, size * (1.3 + u * 1.1),
      '~', SMOKE, Math.sin(Math.PI * u) * 0.3 * env);
  }
  for (let k = 0; k < 14; k++) {
    const a = k / 14 * TAU + hash(k + 60) * 0.3, flicker = 0.3 + 0.2 * Math.sin(age * 13 + k * 2.7);
    local(pen, Math.sin(a) * size * 0.78, Math.cos(a) * size * 0.78, flicker > 0.38 ? ':' : k % 2 ? ',' : '.',
      heatColor(flicker), env * 0.6);
  }
  for (let k = 0; k < 12; k++) {
    const period = 0.7 + 0.4 * hash(k + 80), u = frac(age / period + hash(k + 81));
    const a = hash(k + 82) * TAU, x = Math.sin(a) * size * 0.6, z = Math.cos(a) * size * 0.6;
    const heat = 0.85 * (1 - u);
    screen(pen, toSX(pen, x, z) + Math.sin(age * 5 + k) * 0.04 * u, toSY(pen, x, z) + u * size * 2,
      u < 0.3 ? '*' : '.', heatColor(heat), (1 - u) * Math.min(1, u * 6) * env);
  }
  for (let k = 0; k < 10; k++) {
    const a = k / 10 * TAU + 0.3 * Math.sin(age * 0.9 + k);
    const x = Math.sin(a) * size * 0.7, z = Math.cos(a) * size * 0.7;
    const bx = toSX(pen, x, z), by = toSY(pen, x, z), depth = by > 0 ? 0.75 : 1;
    const height = size * (0.7 + 0.5 * hash(k)) * (0.7 + 0.3 * Math.sin(age * 9.5 + k * 1.9)) * env;
    const lick = frac(age * 2.6 + hash(k + 5));
    screen(pen, bx + Math.sin(age * 6 + k) * 0.05, by + height + size * 0.3 * lick, "'",
      heatColor(0.5), (1 - lick) * 0.6 * env * depth);
    for (let m = 3; m >= 0; m--) {
      const v = (m + 0.5) / 4, heat = (1 - v) * 0.85 * env + 0.1;
      screen(pen, bx + Math.sin(age * 6 + k + v * 2.5) * 0.05 * v, by + v * height,
        m === 3 ? '^' : flame(heat), heatColor(heat), (0.3 + 0.7 * heat) * env * depth);
    }
  }
}

// A ring of fire with smouldering coals inside (not used by TF, kept on-theme).
function zone(pen) {
  const { age, p } = pen;
  const size = clamp(pen.radius, 0.6, 2.4) * 0.9;
  const env = easeOut(p / 0.1) * (1 - smooth((p - 0.8) / 0.2));
  for (let k = 0; k < 24; k++) {
    const a = hash(k + 100) * TAU, r = size * 0.85 * Math.sqrt(hash(k + 101));
    const glow = 0.25 + 0.2 * Math.sin(age * (3 + 4 * hash(k + 102)) + k);
    local(pen, Math.sin(a) * r, Math.cos(a) * r, glow > 0.38 ? '*' : glow > 0.25 ? ':' : '.',
      heatColor(glow), env * (0.35 + glow));
  }
  for (let k = 0; k < 14; k++) {
    const u = frac(age / (0.8 + 0.4 * hash(k + 110)) + hash(k + 111));
    const a = hash(k + 112) * TAU, r = size * Math.sqrt(hash(k + 113));
    const x = Math.sin(a) * r, z = Math.cos(a) * r;
    screen(pen, toSX(pen, x, z), toSY(pen, x, z) + u * size * 0.9, '.', heatColor(0.8 * (1 - u)),
      (1 - u) * Math.min(1, u * 6) * env);
  }
  for (let k = 0; k < 22; k++) {
    const a = k / 22 * TAU + age * 0.25, x = Math.sin(a) * size, z = Math.cos(a) * size;
    const bx = toSX(pen, x, z), by = toSY(pen, x, z);
    const height = size * 0.4 * (0.6 + 0.4 * hash(k)) * (0.75 + 0.25 * Math.sin(age * 9 + k * 1.7));
    for (let m = 2; m >= 0; m--) {
      const v = (m + 0.5) / 3, heat = (1 - v) * 0.85 + 0.1;
      screen(pen, bx + Math.sin(age * 5 + k + v * 2) * 0.04 * v, by + v * height,
        m === 2 ? '^' : flame(heat), heatColor(heat), (0.3 + 0.7 * heat) * env);
    }
  }
}

function blast(pen, bt) {
  const { age } = pen;
  const env = 1 - smooth((bt - 0.35) / 0.65);
  const front = 0.45 + 1.7 * easeOut(bt), hot = clamp(1 - bt * 0.6, 0, 1);
  // Soot rolling up off the caster's front.
  for (let k = 0; k < 6; k++) {
    const u = clamp(bt * 1.3 - hash(k + 90) * 0.3, 0, 1), x = (hash(k + 91) - 0.5) * 0.9;
    const z = BLAST_Z + 0.2 + hash(k + 92) * 0.4;
    screen(pen, toSX(pen, x, z), toSY(pen, x, z) + u * 0.6, '~', SMOKE, Math.sin(Math.PI * u) * 0.35);
  }
  // Embers thrown ahead of the front.
  for (let k = 0; k < 18; k++) {
    const a = (hash(k + 120) - 0.5) * 2 * FAN, speed = 1.6 + 1.8 * hash(k + 121);
    const r = 0.5 + speed * (1 - Math.exp(-2.6 * bt)) / 1.25, x = Math.sin(a) * r, z = BLAST_Z + Math.cos(a) * r;
    const heat = (1 - bt) * (0.75 + 0.25 * hash(k + 122));
    screen(pen, toSX(pen, x, z), toSY(pen, x, z) + (0.2 + 0.35 * hash(k + 123)) * 4 * bt * (1 - bt),
      spark(heat), heatColor(heat), heat * env);
  }
  // A continuous crescent wall: every angular sample is a short radial flame,
  // white-hot on the leading edge and cooling one cell at a time behind it.
  let arc = 0;
  for (let k = 0; k < 8; k++) {
    const a0 = -FAN + k / 8 * 2 * FAN, a1 = a0 + FAN / 4;
    const dx = Math.sin(a1) - Math.sin(a0), dz = Math.cos(a1) - Math.cos(a0);
    arc += Math.hypot(toSX(pen, dx, dz) * COLS, toSY(pen, dx, dz) * ROWS) * front;
  }
  const samples = clamp(Math.round(arc / 1.3), 14, 64);
  const depth = bt < 0.45 ? 3 : 2, thin = 1 - smooth((bt - 0.3) / 0.5);
  for (let k = 0; k < samples; k++) {
    const a = -FAN + (k + 0.5) / samples * 2 * FAN, sa = Math.sin(a), ca = Math.cos(a);
    const rim = 0.6 + 0.4 * Math.cos(a / FAN * Math.PI / 2);
    const lump = 1 + 0.06 * Math.sin(a * 9 + bt * 7 + 1) + 0.035 * Math.sin(a * 17 - age * 13);
    const step = 1.05 / Math.hypot(toSX(pen, sa, ca) * COLS, toSY(pen, sa, ca) * ROWS);
    const r0 = front * lump;
    for (let layer = depth - 1; layer >= 0; layer--) {
      const r = r0 - layer * step;
      if (r < 0.3) continue;
      const heat = hot * rim * LAYER_HEAT[layer] * (0.88 + 0.12 * Math.sin(age * 37 + k * 3 + layer));
      local(pen, sa * r, BLAST_Z + ca * r, flame(heat), heatColor(heat),
        (0.25 + 0.75 * heat) * env * (layer ? thin : 1));
    }
  }
  // Thirteen tongues lead the front along the real fireblast projectile headings.
  for (let k = 0; k < 13; k++) {
    const a = (-48 + k * 8) * Math.PI / 180, x = Math.sin(a), z = Math.cos(a), char = strokeLocal(pen, x, z);
    const tip = front + 0.16 + 0.07 * Math.sin(age * 29 + k * 1.3);
    for (let m = 1; m >= 0; m--) {
      const r = m ? tip : front + 0.08, heat = hot * (m ? 0.7 : 0.95);
      local(pen, x * r, BLAST_Z + z * r, char, heatColor(heat), (0.3 + 0.7 * heat) * env);
    }
  }
}

function cast(pen) {
  const { age } = pen, time = pen.p * DURATION;
  const gather = clamp((time - GATHER_AT) / (BLAST_AT - GATHER_AT), 0, 1);
  // Anticipation: motes spiral into the caster's hands before the first circle fires.
  if (time < 0.34) {
    for (let k = 0; k < 12; k++) {
      const u = clamp((time - hash(k) * 0.08) / 0.24, 0, 1);
      if (u <= 0 || u >= 1) continue;
      const a = hash(k + 20) * TAU + u * 2.4, r = (0.55 + 0.35 * hash(k + 40)) * (1 - easeIn(u));
      local(pen, Math.sin(a) * r, LAUNCH_Z + Math.cos(a) * r, u > 0.65 ? '*' : '.',
        heatColor(0.4 + 0.6 * u), Math.sin(Math.PI * u) * 0.9);
    }
  }
  const knotX = toSX(pen, 0, BLAST_Z), knotY = toSY(pen, 0, BLAST_Z);
  for (let i = 0; i < BARRELS.length; i++) {
    const born = i * SHOT_SPACING, fire = born + SHOT_DELAY, t = time - born;
    if (t <= 0 || gather >= 1) continue;
    const [bx, by] = BARRELS[i];
    const kindle = easeOut(t / 0.16), since = time - fire;
    const flash = since >= 0 ? Math.exp(-since * 13) : 0, charge = since < 0 ? smooth(t / SHOT_DELAY) : 0;
    const heat = clamp(0.5 + 0.35 * charge + 0.5 * flash + 0.3 * smooth(gather / 0.5)
      - (since > 0 ? 0.14 * smooth(since / 0.4) : 0), 0, 1);
    // Embers drip from each spent circle.
    if (since > 0) {
      for (let d = 0; d < 2; d++) {
        const u = frac(since / 0.45 + hash(i * 3 + d));
        screen(pen, bx + (hash(i * 7 + d) - 0.5) * 0.25, by - 0.22 - u * u * 0.45, u < 0.3 ? ':' : '.',
          heatColor(0.6 * (1 - u)), (1 - u) * Math.min(1, since * 8) * 0.55 * (1 - gather));
      }
    }
    // The circle draws itself clockwise, spins a hot highlight and recoils when it
    // fires; for the fireblast it unravels cell by cell into the caster's hands.
    const scale = 1 + 0.3 * flash, spin = frac(age * 1.4 + i * 0.37) * 16;
    const drawn = kindle * RING.length;
    for (let j = 0; j < RING.length; j++) {
      if (j >= drawn) break;
      const [col, row, glyph] = RING[j];
      const pull = easeIn((gather - j / 16 * 0.4 - i * 0.02) / 0.5);
      if (pull >= 1) continue;
      const gap = Math.abs(j - spin), near = Math.min(gap, 16 - gap), hl = Math.max(0, 1 - near / 2.5);
      const leading = kindle < 1 && j + 1 >= drawn;
      const h = leading || pull > 0 ? 1 - 0.3 * pull : clamp(heat * (0.72 + 0.28 * hl), 0, 1);
      const x = bx + col / COLS * scale, y = by - row / ROWS * scale, swirl = Math.sin(Math.PI * pull) * 0.18;
      screen(pen, x + (knotX - x) * pull + swirl * (i % 2 ? 1 : -1), y + (knotY - y) * pull + swirl * 0.5,
        pull > 0 ? (pull > 0.5 ? '*' : '+') : leading || hl > 0.6 ? '*' : glyph, heatColor(h), 0.35 + 0.65 * h);
    }
    const coreHeat = 0.35 + 0.65 * Math.max(charge, flash);
    screen(pen, bx, by, flame(coreHeat), heatColor(coreHeat), (0.4 + 0.6 * coreHeat) * kindle * (1 - smooth(gather / 0.6)));
    // The circle spits its fireball down to the launch point beside the caster.
    if (since >= 0 && since < 0.2) {
      const side = i % 2 ? 0.12 : -0.12;
      const tx = toSX(pen, side, LAUNCH_Z), ty = toSY(pen, side, LAUNCH_Z);
      const u = easeOut(since / 0.11), vis = 1 - smooth((since - 0.09) / 0.11);
      for (let j = 6; j >= 0; j--) {
        const q = u - j * 0.075;
        if (q <= 0) continue;
        const h = 1 - j / 7;
        screen(pen, bx + (tx - bx) * q, by + (ty - by) * q, j ? flame(h) : '@', heatColor(h), vis * (0.3 + 0.7 * h));
      }
      if (since < 0.14) {
        const mb = since / 0.14;
        for (let r = 0; r < 6; r++) {
          const a = r / 6 * TAU + i, x = Math.sin(a), z = Math.cos(a), char = strokeLocal(pen, x, z);
          for (let m = 0; m < 2; m++) {
            const reach = 0.08 + 0.12 * m + 0.2 * easeOut(mb);
            local(pen, side + x * reach, LAUNCH_Z + z * reach, char, heatColor(1 - mb * 0.6), (1 - mb) * (1 - 0.35 * m));
          }
        }
      }
    }
  }
  // Gather: embers spiral into a white-hot knot just before the fireblast.
  if (gather > 0 && time < BLAST_AT + 0.1) {
    const out = 1 - smooth((time - BLAST_AT) / 0.1);
    for (let k = 0; k < 8; k++) {
      const u = clamp(gather * 1.15 - hash(k + 60) * 0.15, 0, 1);
      if (u <= 0) continue;
      const a = k / 8 * TAU + u * 3, r = 0.9 * (1 - u) + 0.05;
      local(pen, Math.sin(a) * r, BLAST_Z + Math.cos(a) * r, u > 0.6 ? '*' : '.', heatColor(0.45 + 0.55 * u),
        Math.sin(Math.PI * Math.min(1, u * 1.1)) * out * 0.8);
    }
    const knot = 0.4 + 0.6 * easeIn(gather), bx = knotX, by = knotY;
    for (let k = 0; k < 6; k++) {
      const a = k / 6 * TAU + age * 6, reach = 0.04 + 0.12 * easeIn(gather);
      screen(pen, bx + Math.cos(a) * reach, by + Math.sin(a) * reach * 0.6, flame(knot * 0.85),
        heatColor(knot * 0.85), knot * out);
    }
    screen(pen, bx, by, '@', heatColor(knot), knot * out);
  }
  if (time >= BLAST_AT) blast(pen, (time - BLAST_AT) / (DURATION - BLAST_AT));
}

const STAGES = { cast, projectile, impact, pulse, aura, zone };

function draw(effect, plot) {
  const life = Math.max(0.001, Number.isFinite(effect.life) ? effect.life : DURATION);
  const p = clamp(Number.isFinite(effect.progress) ? effect.progress : (effect.age ?? 0) / life, 0, 1);
  if (p >= 1) return;
  const heading = Number.isFinite(effect.heading) ? effect.heading : 0;
  const pen = { plot, p, age: Number.isFinite(effect.age) ? effect.age : p * life,
    radius: Number.isFinite(effect.radius) ? effect.radius : 1, c: Math.cos(heading), s: Math.sin(heading) };
  (STAGES[effect.stage] ?? pulse)(pen);
}

export default {
  id: 'temp-blazing-barrage',
  duration: DURATION,
  draw,
  sounds: {
    // The six clipped pitch drops follow the original 3-tick firing cadence.
    cast: [
      ...[280, 320, 260, 300, 240, 280].map((frequency, i) => ({
        kind: 'tone', type: i % 2 ? 'triangle' : 'square', delay: 0.20 + i * 0.15,
        frequency, endFrequency: 75 + i * 3, duration: 0.075, gain: 0.045,
        attack: 0.002, release: 0.060, cutoff: 1500,
      })),
      { kind: 'tone', type: 'triangle', delay: 1.25, frequency: 112, endFrequency: 38,
        duration: 0.30, gain: 0.095, attack: 0.004, release: 0.25, cutoff: 850 },
      { kind: 'noise', delay: 1.25, duration: 0.25, gain: 0.075,
        attack: 0.004, release: 0.22, filterType: 'lowpass', cutoff: 1700 },
    ],
    impact: [
      { kind: 'noise', delay: 0, duration: 0.065, gain: 0.055,
        attack: 0.002, release: 0.055, filterType: 'bandpass', cutoff: 2100 },
      { kind: 'tone', type: 'triangle', delay: 0.015, frequency: 150, endFrequency: 52,
        duration: 0.16, gain: 0.045, attack: 0.003, release: 0.14 },
      { kind: 'noise', delay: 0.08, duration: 0.14, gain: 0.025,
        attack: 0.004, release: 0.12, filterType: 'highpass', cutoff: 2600 },
    ],
  },
};
