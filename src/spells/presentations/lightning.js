// Lightning: the caster's raised hand crackles while static gathers, and a
// ring of charge marks the ground where the strike will fall. A faint stepped
// leader feels its way down out of a gathering swirl, then a white return
// stroke slams down the same jagged channel with its forks, flickers once more
// and fades. Sparks burst from the strike point and arcs crawl across the
// ground to the edge of the hit radius; anything struck crackles with current
// and current arcs on from body to body to the others nearby.
const TAU = Math.PI * 2;
// Cells per local metre (SCALE / ASPECT across, SCALE * TILT down).
const COLS = 13 / 0.6, ROWS = 6.5;
// The channel is 34 screen rows tall (about 5.2 local metres above the strike).
const HEIGHT = 34 / ROWS;
const CORE = [240, 252, 255], BRIGHT = [172, 236, 255], ARC = [96, 202, 255],
  TEAL = [99, 209, 175], DEEP = [52, 112, 204], CLOUD = [74, 92, 132];

const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const hash = (i, seed = 0) => { const v = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453; return v - Math.floor(v); };
const mix = (a, b, t) => a.map((c, i) => c + (b[i] - c) * clamp01(t));

// Brightness of the return stroke and its re-stroke along the same channel.
export function strokeLight(age) {
  if (age < 0.05) return 0;
  if (age < 0.12) return 1;
  if (age < 0.26) return 0.2 + 0.8 * Math.exp(-(age - 0.12) * 18);
  if (age < 0.33) return 0.82;
  return 0.82 * Math.exp(-(age - 0.33) * 7);
}

// The jagged channel from the sky to the strike point: one x per screen row,
// zig-zagging between a few kinks and ending exactly at the ground.
function channel(seed) {
  const rows = 34, kinks = [];
  let x = (hash(1, seed) - 0.5) * 0.9;
  for (let k = 0, row = 0; row < rows; k++) {
    kinks.push({ row, x });
    row += 3 + Math.floor(hash(k, seed + 2) * 4);
    x = row >= rows ? 0 : x * 0.55 + (hash(k, seed + 3) - 0.5) * 0.62;
  }
  kinks.push({ row: rows, x: 0 });
  const path = [];
  for (let i = 1; i < kinks.length; i++) {
    const a = kinks[i - 1], b = kinks[i];
    for (let row = a.row; row < b.row; row++) path.push(a.x + (b.x - a.x) * (row - a.row) / (b.row - a.row));
  }
  path.push(0);
  return path.map((x, row) => ({ x, z: row / ROWS - HEIGHT }));
}

// Forks leave the channel and run down and away from it.
function forks(seed, path) {
  return [0.3, 0.48, 0.66].map((at, i) => {
    const root = Math.floor(path.length * at + hash(i, seed + 4) * 3), side = hash(i, seed + 5) < 0.5 ? -1 : 1;
    const run = (0.25 + hash(i, seed + 6) * 0.35) * side, length = 5 + Math.floor(hash(i, seed + 7) * 5);
    return Array.from({ length }, (_, j) => ({
      x: path[root].x + run * (j + 1) / length + (hash(j, seed + 8 + i) - 0.5) * 0.06,
      z: path[root].z + (j + 1) / ROWS,
    }));
  });
}

// One stroke glyph per screen row, following where the channel goes next.
function trace(points, plot, color, brightness, glow = 0) {
  for (let i = 0; i < points.length; i++) {
    const next = points[i + 1] ?? points[i], cols = (next.x - points[i].x) * COLS;
    const char = cols > 0.6 ? '\\' : cols < -0.6 ? '/' : '|';
    plot(points[i].x, points[i].z, char, color, brightness);
    // The main channel is drawn two columns thick, its second stroke fainter.
    if (glow > 0.02) plot(points[i].x + (i & 1 ? 1 : -1) / COLS, points[i].z, char, ARC, glow);
    // A steep sideways run fills the gap with a level stroke.
    if (Math.abs(cols) > 1.6) plot((points[i].x + next.x) / 2, points[i].z + 0.5 / ROWS, '_', color, brightness * 0.8);
  }
}

// Dim swirl of cloud and static where the channel will begin.
function gathering(plot, age, strength, x0) {
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * TAU + age * (i & 1 ? 2.4 : -1.7), r = 0.35 + hash(i, 9) * 0.45;
    plot(x0 + Math.sin(a) * r * 1.4, -HEIGHT - 0.25 + Math.cos(a) * r * 0.35, i % 3 ? '~' : '-', CLOUD,
      strength * (0.45 + 0.35 * hash(i + Math.floor(age * 20), 10)));
  }
}

function strike(plot, effect, age, p, seed) {
  const fade = Math.min(1, (1 - p) * 4), R = Math.max(0.8, Math.min(4, effect.radius));
  const path = channel(seed), branches = forks(seed, path);
  gathering(plot, age, fade * (1 - smooth(0.3, 0.7, age)), path[0].x);
  // Stepped leader: a faint broken channel feeling its way to the ground.
  if (age < 0.05) {
    const reach = -HEIGHT + HEIGHT * age / 0.05;
    for (let i = 0; i < path.length && path[i].z <= reach; i += 2) plot(path[i].x, path[i].z, ':', ARC, 0.5 * fade);
    for (const fork of branches) for (let j = 0; j < fork.length && fork[j].z <= reach; j += 2) plot(fork[j].x, fork[j].z, '.', ARC, 0.3 * fade);
    return;
  }
  const light = strokeLight(age) * fade;
  if (light > 0.02) {
    trace(path, plot, mix(BRIGHT, CORE, light), light, light * 0.55);
    for (const fork of branches) trace(fork, plot, mix(DEEP, BRIGHT, light), light * 0.62);
  }
  // The strike point blazes, then sparks burst out and fall back.
  plot(0, 0, light > 0.5 ? '@' : '*', mix(TEAL, CORE, light), Math.max(light, 0.5 * fade * (1 - smooth(0.2, 0.6, age))));
  const t = age - 0.05;
  for (let i = 0; i < 16; i++) {
    const a = hash(i, seed + 11) * TAU, v = 1.1 + hash(i, seed + 12) * 1.6;
    const x = Math.sin(a) * v * t * 1.5, z = Math.cos(a) * v * t * 0.5 - v * t * 2.2 + 7 * t * t;
    const life = clamp01(t / (0.35 + hash(i, seed + 13) * 0.35));
    if (life >= 1) continue;
    plot(x, z, life < 0.2 ? '*' : life < 0.5 ? '+' : life < 0.8 ? "'" : '.', mix(CORE, ARC, life), fade * (1 - life));
  }
  // Arcs crawl across the ground out to the edge of the hit radius.
  for (let k = 0; k < 6; k++) {
    const a = (k + hash(k, seed + 14) * 0.6) / 6 * TAU, reach = smooth(0.05, 0.3, age) * R;
    const flicker = hash(k + Math.floor(age * 30) * 7, seed + 15);
    for (let j = 1; j <= 5; j++) {
      const r = reach * j / 5, bend = (hash(j + k * 5 + Math.floor(age * 30), seed + 16) - 0.5) * 0.5;
      plot(Math.sin(a + bend / Math.max(r, 0.4)) * r, Math.cos(a + bend / Math.max(r, 0.4)) * r, j & 1 ? '~' : '-',
        mix(ARC, BRIGHT, flicker), fade * (1 - smooth(0.25, 0.75, age)) * (0.45 + 0.55 * flicker) * (1 - j * 0.1));
    }
  }
  // A scorched ring settles where the arcs ran out.
  const ring = smooth(0.15, 0.4, age);
  if (ring > 0) {
    for (let i = 0; i < 20; i++) {
      const a = i / 20 * TAU;
      plot(Math.sin(a) * R, Math.cos(a) * R, i & 1 ? '.' : ',', mix(DEEP, TEAL, hash(i, seed + 17)), fade * ring * 0.45);
    }
  }
}

// Charge mark: the hit radius traced on the ground, static drawn to its centre.
function charge(plot, effect, age, p, seed) {
  const R = Math.max(0.8, Math.min(4, effect.radius)), fade = Math.min(1, (1 - p) * 8);
  const grow = smooth(0, 0.5, p), n = 56;
  for (let i = 0; i < n; i++) {
    const a = i / n * TAU + age * 0.9, lit = i / n < grow;
    if (!lit) continue;
    plot(Math.sin(a) * R, Math.cos(a) * R, i & 1 ? '-' : '~', mix(TEAL, ARC, p), fade * (0.45 + 0.5 * p));
  }
  // Four crackles race round the ring.
  for (let k = 0; k < 4; k++) {
    const a = k / 4 * TAU + age * 6;
    plot(Math.sin(a) * R, Math.cos(a) * R, '*', mix(ARC, CORE, p), fade * (0.4 + 0.6 * p));
  }
  // Static is drawn in toward the strike point.
  for (let i = 0; i < 14; i++) {
    const a = hash(i, seed + 18) * TAU, q = (p * 2 + hash(i, seed + 19)) % 1, r = R * (1 - q) * 0.9;
    plot(Math.sin(a) * r, Math.cos(a) * r, q > 0.7 ? '+' : '.', mix(ARC, BRIGHT, q), fade * q * 0.8);
  }
  plot(0, 0, p > 0.6 ? '+' : '.', mix(TEAL, CORE, p), fade * (0.3 + 0.7 * p));
  gathering(plot, age, fade * smooth(0.1, 0.8, p), 0);
}

// Current crawling over a body that was struck.
function crackle(plot, age, p, seed, height = 3.2) {
  const fade = Math.min(1, (1 - p) * 2.5), frame = Math.floor(age * 24);
  for (let k = 0; k < 4; k++) {
    let x = (hash(k + frame * 4, seed) - 0.5) * 0.5, z = -hash(k + frame * 4, seed + 1) * height;
    for (let j = 0; j < 5; j++) {
      const dx = (hash(j + k * 5 + frame * 20, seed + 2) - 0.5) * 0.12, dz = -0.14 - hash(j, seed + 3) * 0.1;
      plot(x, z, dx * COLS > 0.6 ? '/' : dx * COLS < -0.6 ? '\\' : '|', mix(ARC, CORE, hash(j + frame, seed + 4)), fade * (1 - j * 0.12));
      x += dx; z += dz;
    }
  }
  for (let i = 0; i < 6; i++) {
    plot((hash(i + frame * 6, seed + 5) - 0.5) * 0.9, -hash(i + frame * 6, seed + 6) * height, i & 1 ? '*' : "'",
      BRIGHT, fade * hash(i + frame, seed + 7));
  }
}

// The raised hand crackles, a spark leaps skyward and static spirals in.
function summon(plot, age, p, seed) {
  const fade = Math.min(1, (1 - p) * 3);
  for (let i = 0; i < 18; i++) {
    const a = i / 18 * TAU + p * 4, r = (1 - smooth(0, 0.6, p)) * 1.2 + 0.12;
    plot(Math.sin(a) * r * 0.8, -3.4 + Math.cos(a) * r * 0.5, p > 0.4 ? "'" : '.', mix(DEEP, ARC, p), fade * smooth(0, 0.2, p) * 0.7);
  }
  crackle(plot, age, p, seed, 1.2);
  const leap = smooth(0.35, 0.5, p) * (1 - smooth(0.5, 0.8, p));
  if (leap > 0.02) {
    let x = 0;
    for (let j = 0; j < 12; j++) {
      x += (hash(j, seed + 20) - 0.5) * 0.12;
      plot(x, -3.6 - j / ROWS, Math.abs(x) < 0.02 ? '|' : x > 0 ? '/' : '\\', mix(BRIGHT, CORE, leap), leap * fade * (1 - j / 14));
    }
  }
  plot(0, -3.4, p > 0.45 && p < 0.6 ? '@' : '*', mix(ARC, CORE, p), fade * (0.4 + 0.6 * smooth(0.2, 0.5, p)));
}

// Chained lightning: a jagged arc leaps chest to chest from the last body
// struck (the origin) to the next one, `radius` metres along the heading.
const CHEST = 2.6;
function arc(plot, effect, age, p, seed, c, s) {
  const length = Math.max(0.1, Math.min(12, effect.radius)), fade = (1 - p) ** 1.2;
  const reach = smooth(0, 0.25, p), frame = Math.floor(age * 30);
  // One glyph per screen cell crossed, so level arcs stay unbroken.
  const steps = Math.max(6, Math.min(96, Math.ceil(length * Math.max(Math.abs(s) * COLS, Math.abs(c) * ROWS))));
  // Along the heading on the ground, then lifted to chest height on screen.
  const at = (t, j) => ({ x: s * t * length + c * j, z: c * t * length - s * j - CHEST });
  let last = at(0, 0);
  for (let i = 1; i <= steps && i / steps <= reach; i++) {
    const t = i / steps, sway = i === steps ? 0 : (hash(i + frame * 50, seed + 21) - 0.5) * 0.3 * Math.sin(Math.PI * t);
    const point = at(t, sway), dx = (point.x - last.x) * COLS, dy = (point.z - last.z) * ROWS;
    const char = Math.abs(dy) <= Math.abs(dx) * 0.45 ? '-' : Math.abs(dx) <= Math.abs(dy) * 0.45 ? '|' : dx * dy > 0 ? '\\' : '/';
    plot(point.x, point.z, char, mix(BRIGHT, CORE, fade), fade * (0.85 + 0.15 * hash(i + frame, seed + 22)));
    // A fainter second stroke beside it gives the arc some body.
    const level = Math.abs(dy) <= Math.abs(dx);
    plot(point.x + (level ? 0 : 1 / COLS), point.z + (level ? 1 / ROWS : 0), char, ARC, fade * 0.5);
    last = point;
  }
  plot(0, -CHEST, '*', BRIGHT, fade);
  if (reach >= 1) plot(s * length, c * length - CHEST, '@', CORE, fade);
}

// Generic visuals: a short burst of sparks at the configured size.
function sparks(plot, effect, age, p, seed) {
  const R = Math.max(0.3, Math.min(4, effect.radius)), fade = Math.min(1, (1 - p) * 3);
  for (let i = 0; i < 18; i++) {
    const a = i / 18 * TAU + hash(i, seed) * 0.3, r = R * (0.2 + 0.8 * smooth(0, 0.7, p));
    plot(Math.sin(a) * r, Math.cos(a) * r, p < 0.3 ? '*' : p < 0.6 ? '+' : '.', mix(CORE, ARC, p), fade * (0.5 + 0.5 * hash(i + Math.floor(age * 30), seed)));
  }
}

export default {
  id: 'lightning', duration: 0.55,
  draw(effect, draw) {
    const p = clamp01(Number.isFinite(effect.progress) ? effect.progress : 0);
    const age = Number.isFinite(effect.age) ? Math.max(0, effect.age) : 0;
    const heading = Number.isFinite(effect.heading) ? effect.heading : 0;
    const c = Math.cos(heading), s = Math.sin(heading);
    const seed = ((Number.isFinite(effect.x) ? effect.x * 0.37 : 0) + (Number.isFinite(effect.y) ? effect.y * 1.13 : 0)) % 97;
    // Authored in screen space: undo the adapter's heading rotation so the
    // bolt always falls straight down the screen.
    const plot = (x, z, char, color, brightness) => {
      if (brightness > 0.01) draw(x * c - z * s, x * s + z * c, char, color, Math.min(1, brightness));
    };
    switch (effect.stage) {
      case 'impact': return effect.shape === 'bolt' ? strike(plot, effect, age, p, seed) : crackle(plot, age, p, seed);
      case 'zone': return charge(plot, effect, age, p, seed);
      case 'aura': return crackle(plot, age, p, seed);
      case 'projectile': return crackle(plot, age, p, seed, 0.6);
      case 'pulse': return effect.shape === 'chain' ? arc(plot, effect, age, p, seed, c, s) : sparks(plot, effect, age, p, seed);
      default: return summon(plot, age, p, seed);
    }
  },
  sounds: {
    // Storm pressure builds into a beating electrical hum and muted static.
    cast: [
      { kind: 'tone', type: 'sawtooth', frequency: 57, endFrequency: 94, cutoff: 480, duration: 0.64, gain: 0.055, attack: 0.19, decay: 0.11, sustain: 0.72, release: 0.27 },
      { kind: 'tone', type: 'triangle', frequency: 61, endFrequency: 101, cutoff: 360, duration: 0.63, gain: 0.036, attack: 0.23, decay: 0.08, sustain: 0.67, release: 0.26 },
      { kind: 'noise', duration: 0.57, gain: 0.042, cutoff: 680, filterType: 'bandpass', Q: 0.8, attack: 0.18, decay: 0.1, sustain: 0.56, release: 0.23 },
      { kind: 'noise', delay: 0.29, duration: 0.09, gain: 0.033, cutoff: 1350, filterType: 'lowpass', attack: 0.003, decay: 0.018, sustain: 0.25, release: 0.06 },
      { kind: 'noise', delay: 0.41, duration: 0.12, gain: 0.027, cutoff: 980, filterType: 'bandpass', Q: 0.7, attack: 0.004, decay: 0.026, sustain: 0.22, release: 0.08 },
    ],
    // A rounded crack tears into two late thunder rolls; no exposed high hiss.
    impact: [
      { kind: 'noise', duration: 0.22, gain: 0.12, cutoff: 1900, filterType: 'lowpass', Q: 0.6, attack: 0.002, decay: 0.035, sustain: 0.28, release: 0.17 },
      { kind: 'tone', type: 'sawtooth', frequency: 174, endFrequency: 53, cutoff: 760, duration: 0.29, gain: 0.042, attack: 0.003, decay: 0.06, sustain: 0.27, release: 0.21 },
      { kind: 'noise', delay: 0.065, duration: 0.3, gain: 0.063, cutoff: 820, filterType: 'bandpass', Q: 0.65, attack: 0.006, decay: 0.06, sustain: 0.34, release: 0.22 },
      { kind: 'tone', type: 'sine', frequency: 73, endFrequency: 31, duration: 1.85, gain: 0.085, attack: 0.018, decay: 0.22, sustain: 0.52, release: 1.5 },
      { kind: 'noise', delay: 0.19, duration: 1.38, gain: 0.065, cutoff: 240, filterType: 'lowpass', Q: 0.75, playbackRate: 0.64, attack: 0.095, decay: 0.18, sustain: 0.48, release: 1.05 },
      { kind: 'noise', delay: 0.56, duration: 1.6, gain: 0.043, cutoff: 165, filterType: 'lowpass', Q: 0.8, playbackRate: 0.51, attack: 0.17, decay: 0.2, sustain: 0.38, release: 1.15 },
    ],
    // Small, dry discharges retain the storm's low body between full strikes.
    pulse: [
      { kind: 'noise', duration: 0.13, gain: 0.024, cutoff: 1050, filterType: 'lowpass', attack: 0.004, decay: 0.026, sustain: 0.23, release: 0.09 },
      { kind: 'tone', type: 'triangle', frequency: 116, endFrequency: 63, cutoff: 420, duration: 0.24, gain: 0.021, attack: 0.008, decay: 0.045, sustain: 0.32, release: 0.17 },
      { kind: 'noise', delay: 0.065, duration: 0.16, gain: 0.014, cutoff: 430, filterType: 'bandpass', Q: 0.75, attack: 0.012, decay: 0.03, sustain: 0.2, release: 0.11 },
    ],
  },
};
