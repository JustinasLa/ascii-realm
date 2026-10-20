// Ice Shield: seven hexagonal ice plates spin in and lock into a honeycomb
// heater shield raised before the caster, its frost rim racing round to the
// point. Ground stages lay hexagonal frost rings at the caster's feet.
//
// The shield is authored on the screen's cell grid: the effect heading is only
// used to turn those cells back into the local metres the adapter expects, so
// plate seams always step as clean '_', '/' and '\' strokes at any aim.
const COLS = 13 / 0.6; // screen columns per metre (SCALE / ASPECT)
const ROWS = 13 * 0.5; // screen rows per metre (SCALE * TILT)
const TALL = 10 / 6; // a cell is this many columns tall on screen
const LIFT = 10; // rows the shield is raised to sit over the caster's body

// Cold ramp: deep blue -> seam blue -> ice -> frost -> white flash.
const STOPS = [[40, 82, 168], [78, 150, 222], [131, 216, 250], [206, 244, 255], [250, 254, 255]];
const RAMP = Array.from({ length: 33 }, (_, i) => {
  const t = i / 32 * (STOPS.length - 1), k = Math.min(STOPS.length - 2, Math.floor(t)), f = t - k;
  return STOPS[k].map((c, j) => Math.round(c + (STOPS[k + 1][j] - c) * f));
});

// Plates seat centre first, then round the ring from the crown, clockwise.
const LOCK_START = [0.08, 0.15, 0.18, 0.21, 0.24, 0.27, 0.3];
const LOCK_TIME = 0.12;
const LOCKED = 0.42; // every plate has seated; the shield rings
const ARMS = [[[-1, -2], [1, -4], [0, -6]], [[5, 1], [8, 0], [11, 2]], [[-4, 1], [-7, 3], [-10, 2]]];

const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const smooth = t => { t = clamp(t); return t * t * (3 - 2 * t); };
const easeOut = t => 1 - (1 - clamp(t)) ** 3;
const easeBack = t => { t = clamp(t) - 1; return 1 + t * t * (2.4 * t + 1.4); };
const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

// Visual slope glyph for a screen direction (columns, rows).
function slope(dx, dy, flat = '-') {
  let a = Math.atan2(dy * TALL, dx);
  if (a < 0) a += Math.PI;
  if (a < Math.PI / 8 || a > Math.PI * 7 / 8) return flat;
  if (a < Math.PI * 3 / 8) return '\\';
  if (a < Math.PI * 5 / 8) return '|';
  return '/';
}

function pen(effect, plot, cap, age) {
  const heading = Number.isFinite(effect.heading) ? effect.heading : 0;
  const fx = Number.isFinite(effect.x) ? effect.x - Math.floor(effect.x) : 0;
  const fy = Number.isFinite(effect.y) ? effect.y - Math.floor(effect.y) : 0;
  return { plot, cap, age, fx, fy, count: 0, used: new Set(), c: Math.cos(heading), s: Math.sin(heading),
    local: false, env: 1, flash: 0, band: 0, bandAt: 0, melt: 0, chill: 0, shift: 0, W: 1, H: 1 };
}

// Grid coordinates put integer boundaries on real screen cells, with the
// effect origin inside cell (0, 0). In local mode points are local metres.
const gx = (g, x, z) => g.local ? (x * g.c + z * g.s) * COLS + g.fx : x;
const gy = (g, x, z) => g.local ? (z * g.c - x * g.s) * ROWS + g.fy : z;

// Plot one glyph into a grid cell once, lit by the stage's shared modulators:
// the lock flash, a glint band sweeping the shield, and the late melt.
function emit(g, sx, sy, char, b, t, seed) {
  if (g.count >= g.cap) return;
  sx += g.shift;
  const ix = Math.floor(sx), iy = Math.floor(sy), key = (ix + 2048) * 4096 + iy + 2048;
  if (g.used.has(key)) return;
  b += g.flash * 0.45; t += g.flash;
  if (g.band > 0) {
    const w = ix / g.W * 0.75 + (iy + LIFT) / g.H * 0.65;
    const glint = g.band * Math.exp(-(((w - g.bandAt) / 0.22) ** 2));
    b += glint * 0.5; t += glint * 0.6;
  }
  if (g.melt > 0) {
    b *= clamp(1 - (g.melt - 0.55 * hash(seed)) / 0.45);
    t -= g.melt * 0.4;
  }
  b = clamp(b * g.env);
  if (b < 0.004) return;
  g.used.add(key);
  g.count++;
  // Back from the cell centre to local metres for the adapter to rotate.
  const mx = (ix + 0.5 - g.fx) / COLS, mz = (iy + 0.5 - g.fy) / ROWS;
  g.plot(mx * g.c - mz * g.s, mx * g.s + mz * g.c, char, RAMP[Math.round(clamp(t - g.chill) * 32)], b);
}
const dot = (g, x, z, char, b, t, seed) => emit(g, gx(g, x, z), gy(g, x, z), char, b, t, seed);

// A straight stroke. Steep strokes take one glyph per row and flat ones one
// per column (sampled at cell centres) so slants never double up; '_' rises a
// row because it draws on the bottom of its cell. Stride > 1 dashes it.
function stroke(g, x0, z0, x1, z1, b, t, seed, stride = 1, flat = '-') {
  const ax = gx(g, x0, z0), ay = gy(g, x0, z0), dx = gx(g, x1, z1) - ax, dy = gy(g, x1, z1) - ay;
  const char = slope(dx, dy, flat), lift = char === '_' ? 0.5 : 0;
  if (stride > 1) {
    const n = Math.max(1, Math.round(Math.max(Math.abs(dx), Math.abs(dy)) / stride));
    for (let i = 0; i <= n; i++) emit(g, ax + dx * i / n, ay + dy * i / n - lift, char, b, t, seed + i * 7);
    return;
  }
  const byRow = char !== '_' && char !== '-' && Math.abs(dx) / TALL <= Math.abs(dy) * 2;
  const from = byRow ? Math.min(ay, ay + dy) : Math.min(ax, ax + dx), span = byRow ? Math.abs(dy) : Math.abs(dx);
  const first = Math.ceil(from - 0.5), last = Math.floor(from + span - 0.5);
  if (last < first) return emit(g, ax + dx / 2, ay + dy / 2 - lift, char, b, t, seed);
  for (let i = first; i <= last; i++) {
    const f = (i + 0.5 - (byRow ? ay : ax)) / (byRow ? dy : dx);
    emit(g, byRow ? ax + dx * f : i + 0.5, byRow ? i + 0.5 : ay + dy * f - lift, char, b, t, seed + i * 7);
  }
}

// Shield layout in cells for a given size: plate half-width a, half-height h,
// honeycomb column step dx, and the heater rim around it.
function layout(R) {
  // A body-sized shield: it grows no further past the cast radius so the full
  // honeycomb and rim always fit the glyph budget.
  const k = clamp(R / 0.8, 0.7, 1);
  const a = Math.max(2, Math.round(3 * k)), h = Math.max(1, Math.round(2 * k)), dx = 2 * a + h + 1;
  const W = dx + a + h + 5, crown = -3 * h - 3, tip = 3 * h + 5;
  return { a, h, dx, W, crown, tip,
    plates: [[0, 0], [0, -2 * h], [dx, -h], [dx, h], [0, 2 * h], [-dx, h], [-dx, -h]] };
}

// A seated plate, glyph for glyph: '_' crown and base with one slant per row.
// Neighbours share seams; the occupancy set draws each shared cell once.
function seatedPlate(g, L, px, py, b, t, seed) {
  const { a, h } = L, y0 = py - LIFT;
  const shimmer = j => 0.08 * Math.sin(g.age * 3.1 + seed + j * 0.9);
  for (let j = 0; j < h; j++) {
    emit(g, px - a - 1 - j + 0.5, y0 - h + j + 0.5, '/', b + shimmer(j), t, seed + j);
    emit(g, px + a + 1 + j + 0.5, y0 - h + j + 0.5, '\\', b + shimmer(j + 3), t, seed + 10 + j);
    emit(g, px - a - h + j + 0.5, y0 + j + 0.5, '\\', b + shimmer(j + 5), t, seed + 20 + j);
    emit(g, px + a + h - j + 0.5, y0 + j + 0.5, '/', b + shimmer(j + 7), t, seed + 30 + j);
  }
  for (let i = -a; i <= a; i++) {
    emit(g, px + i + 0.5, y0 - h - 0.5, '_', b + shimmer(i), t, seed + 40 + i);
    emit(g, px + i + 0.5, y0 + h - 0.5, '_', b + shimmer(i + 2), t, seed + 60 + i);
  }
}

// A plate still flying in: the same hexagon, scaled and spun on screen.
function flyingPlate(g, L, px, py, scale, spin, b, t, seed) {
  const { a, h } = L, cx = px + 0.5, cy = py - LIFT;
  const c = Math.cos(spin), s = Math.sin(spin);
  const vx = [a + h + 0.5, a + 0.5, -a - 0.5, -a - h - 0.5, -a - 0.5, a + 0.5];
  const vy = [0, h, h, 0, -h, -h];
  const at = (i, axis) => {
    const x = vx[i] * scale, y = vy[i] * scale * TALL;
    return axis ? cy + (x * s + y * c) / TALL : cx + x * c - y * s;
  };
  for (let e = 0; e < 6; e++) {
    const n = (e + 1) % 6;
    stroke(g, at(e, 0), at(e, 1), at(n, 0), at(n, 1), b, t, seed + e * 31, 1, '_');
  }
}

// The heater rim as an ordered walk from the crown centre to the point, for
// one side; `visit` stops the walk by returning false.
function walkRim(L, side, visit) {
  const { W, crown, tip } = L;
  let i = 0;
  for (let x = 0; x < W; x++) if (visit(i++, side * x, crown - LIFT, '_') === false) return;
  for (let y = crown + 1; y < 0; y++) if (visit(i++, side * W, y - LIFT, '|') === false) return;
  let last = W;
  for (let y = 0; y < tip; y++) {
    const x = Math.round(W * (1 - ((y + 1) / (tip + 1)) ** 1.5));
    const char = last - x < 0.7 ? '|' : side > 0 ? '/' : '\\';
    if (visit(i++, side * x, y - LIFT, char) === false) return;
    last = x;
  }
  if (side > 0) visit(i, 0, tip - LIFT, 'V');
}
const rimLength = L => L.W + (-L.crown - 1) + L.tip + 1;

function rim(g, L, reveal, b, t, runner) {
  const limit = reveal * rimLength(L);
  for (const side of [1, -1]) {
    walkRim(L, side, (i, x, y, char) => {
      if (i > limit) return false;
      const head = limit - i < 1.5 && reveal < 1;
      const run = runner >= 0 ? Math.exp(-(((i - runner) / 2.5) ** 2)) : 0;
      emit(g, x + 0.5, y + 0.5, head ? '*' : char, head ? 1 : b + 0.4 * run, head ? 1 : t + 0.3 * run, 5000 + side * 300 + i);
    });
  }
}

// A crystal core per plate, with a few slowly twinkling frost specks inside.
function plateCores(g, L, which, flashes) {
  for (let k = 0; k < 7; k++) {
    if (!which(k)) continue;
    const [px, py] = L.plates[k], f = flashes(k);
    emit(g, px + 0.5, py - LIFT - 0.5, f > 0.35 ? '*' : '+', 0.5 + f * 0.5, 0.62 + f * 0.4, k * 977);
    for (let j = 0; j < 3; j++) {
      const x = px + Math.round((hash(k * 13 + j) * 2 - 1) * (L.a - 0.5));
      const y = py - LIFT + Math.floor(hash(k * 7 + j * 3) * L.h * 2) - L.h;
      const twinkle = 0.5 + 0.5 * Math.sin(g.age * (2.4 + j) + k * 2.1 + j * 1.9);
      emit(g, x + 0.5, y + 0.5, twinkle > 0.72 ? ':' : '.', 0.16 + 0.3 * twinkle, 0.45 + 0.3 * twinkle, k * 401 + j);
    }
  }
}

function cast(g, p, R) {
  const L = layout(R);
  g.W = L.W; g.H = L.tip - L.crown;
  const lockFlash = k => { const d = p - LOCK_START[k] - LOCK_TIME; return d < 0 ? 0 : Math.exp(-d / 0.05); };
  g.flash = 0.9 * Math.exp(-(((p - LOCKED - 0.015) / 0.035) ** 2));
  g.band = Math.sin(Math.PI * clamp((p - 0.47) / 0.3));
  g.bandAt = -0.9 + 2.2 * smooth((p - 0.47) / 0.3);
  g.melt = smooth((p - 0.7) / 0.3);
  g.chill = g.melt * 0.25;

  // Plates seat from the centre outward, spinning flat and flashing white.
  for (let k = 0; k < 7; k++) {
    const raw = clamp((p - LOCK_START[k]) / LOCK_TIME);
    if (raw <= 0) continue;
    const [px, py] = L.plates[k], f = lockFlash(k);
    if (raw >= 1) seatedPlate(g, L, px, py, 0.6 + f * 0.4, 0.55 + f * 0.45, k * 211);
    else {
      const s = easeBack(raw), spread = 1 + (1 - Math.min(1, s)) * 0.6;
      flyingPlate(g, L, px * spread, py * spread, s, (1 - easeOut(raw)) * 1.3, 0.35 + 0.5 * raw, 0.5 + 0.3 * raw, k * 211);
    }
  }
  // Frost races round the rim from the crown to the point; later a glint
  // keeps running round it while the shield holds.
  const reveal = easeOut((p - 0.2) / 0.24);
  const runner = p > LOCKED ? ((p - LOCKED) / 0.3) * rimLength(L) : -1;
  if (reveal > 0) rim(g, L, reveal, 0.55, 0.78, runner);
  plateCores(g, L, k => p > LOCK_START[k] + LOCK_TIME * 0.6, lockFlash);

  // Anticipation: frost motes spiral in to each plate just before it seats.
  for (let i = 0; i < 28; i++) {
    const k = i % 7, arrive = LOCK_START[k] + 0.03, f = p / arrive;
    if (f >= 1) continue;
    const e = f * f * f, a = hash(i) * Math.PI * 2 + 2.4 * e, r = (16 + 10 * hash(i + 50)) * (1 - e);
    const [px, py] = L.plates[k];
    emit(g, px + 0.5 + Math.cos(a) * r, py - LIFT + Math.sin(a) * r / TALL, e > 0.5 ? '*' : f > 0.45 ? ':' : '.',
      (0.3 + 0.7 * e) * clamp(p / 0.05), 0.4 + 0.6 * e, 300 + i);
  }

  // Seating rings the shield: shards spit off the rim and drag to a stop.
  const tau = (p - LOCKED) / 0.3;
  if (tau > 0 && tau < 1) {
    const travel = (1 - Math.exp(-6 * tau)) / (1 - Math.exp(-6)), total = rimLength(L);
    for (let i = 0; i < 18; i++) {
      const side = i < 9 ? 1 : -1, at = Math.floor(((i % 9) + 0.3 + 0.4 * hash(i)) / 9 * total);
      let x0 = 0, y0 = 0;
      walkRim(L, side, (j, x, y) => { x0 = x; y0 = y; return j < at; });
      const ox = x0, oy = (y0 + LIFT - (L.tip + L.crown) / 2) * TALL, len = Math.hypot(ox, oy) || 1;
      const d = 4 + 7 * hash(i + 90), x = x0 + ox / len * d * travel, y = y0 + oy / len * d * travel / TALL;
      const char = tau < 0.35 ? slope(ox, oy / TALL) : hash(i + 7) > 0.5 ? "'" : '.';
      emit(g, x + 0.5, y + 0.5, char, (1 - tau) ** 1.5, 1 - tau * 0.5, 600 + i);
    }
  }

  // Sublimation: the melting plates breathe off vapour that rises and sways.
  if (p > 0.7) {
    const saved = g.melt;
    g.melt = 0;
    for (let i = 0; i < 24; i++) {
      const start = 0.7 + 0.1 * hash(i + 200), tt = (p - start) / (1 - start);
      if (tt <= 0) continue;
      const [px, py] = L.plates[i % 7];
      const x = px + (hash(i + 220) * 2 - 1) * (L.a + L.h) + 1.5 * Math.sin(g.age * 4 + i * 1.7) * tt;
      const y = py - LIFT + (hash(i + 230) * 2 - 1) * L.h - 5 * tt ** 0.8;
      emit(g, x + 0.5, y + 0.5, tt < 0.4 ? ':' : hash(i) > 0.5 ? "'" : '.', Math.sin(Math.PI * tt) * 0.7, 0.75 - 0.5 * tt, 800 + i);
    }
    g.melt = saved;
  }
}

function impact(g, p, R) {
  // The struck shield flashes white and shudders; cracks race out from the
  // contact, chips spit toward the viewer and a frost ripple rolls outward.
  const L = layout(R);
  g.W = L.W; g.H = L.tip - L.crown;
  g.flash = Math.exp(-p / 0.06);
  g.melt = smooth((p - 0.62) / 0.38);
  g.chill = g.melt * 0.25;
  // A whole-shield shudder in whole columns, damped within a quarter second.
  g.shift = Math.round(1.6 * Math.exp(-p * 8) * Math.sin(p * 70));
  const grow = easeOut(p / 0.3), hx = 0, hy = -LIFT - 1;
  emit(g, hx + 0.5, hy + 0.5, 'X', 1, 1, 3999);
  for (let a = 0; a < ARMS.length; a++) {
    let x0 = hx + 0.5, y0 = hy + 0.5, left = grow * ARMS[a].length;
    for (const [ax, ay] of ARMS[a]) {
      if (left <= 0) break;
      const f = Math.min(1, left), x1 = hx + 0.5 + ax, y1 = hy + 0.5 + ay;
      stroke(g, x0, y0, x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, 1, 0.95, 4000 + a * 300 + Math.round(x1) * 7, 1);
      x0 = x1; y0 = y1; left -= 1;
    }
  }

  // Chips fly toward the viewer and out to the sides, slowing and falling.
  const tau = p / 0.55;
  if (tau < 1) {
    const travel = (1 - Math.exp(-5 * tau)) / (1 - Math.exp(-5));
    for (let i = 0; i < 14; i++) {
      const a = Math.PI / 2 + (hash(i + 40) - 0.5) * 3.4, d = 8 + 12 * hash(i + 41);
      const dx = Math.cos(a), dy = Math.sin(a);
      const x = hx + dx * d * travel, y = hy + (dy * d * travel) / TALL + 4 * tau * tau;
      const char = tau < 0.4 ? slope(dx, dy / TALL) : i % 3 ? '.' : "'";
      emit(g, x + 0.5, y + 0.5, char, (1 - tau) ** 1.3, 1 - tau * 0.4, 4500 + i);
    }
  }
  for (let k = 0; k < 7; k++) seatedPlate(g, L, L.plates[k][0], L.plates[k][1], 0.7, 0.55, k * 211);
  rim(g, L, 1, 0.68, 0.76, -1);
  // A frost ripple rolls out across the plate faces from the contact.
  if (p < 0.3) {
    const r = 2 + 12 * easeOut(p / 0.3);
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2;
      emit(g, hx + 0.5 + Math.cos(a) * r, hy + 0.5 + Math.sin(a) * r / TALL, '.', (1 - p / 0.3) * 0.8, 0.9, 4700 + i);
    }
  }
  plateCores(g, L, () => true, () => 0);
}

// A flat hexagon ring on the ground around the origin (radius in metres).
function groundHex(g, radius, spin, reveal, b, t, seed, stride) {
  for (let e = 0; e < 6; e++) {
    const a0 = spin + e * Math.PI / 3, a1 = a0 + Math.PI / 3;
    const x0 = Math.cos(a0) * radius * COLS, y0 = Math.sin(a0) * radius * ROWS;
    const x1 = Math.cos(a1) * radius * COLS, y1 = Math.sin(a1) * radius * ROWS;
    stroke(g, x0 + g.fx, y0 + g.fy, x0 + g.fx + (x1 - x0) * reveal, y0 + g.fy + (y1 - y0) * reveal, b, t, seed + e * 53, stride);
  }
}
const ground = (g, radius, a, char, b, t, seed) =>
  emit(g, Math.cos(a) * radius * COLS + g.fx, Math.sin(a) * radius * ROWS + g.fy, char, b, t, seed);

function aura(g, p, R) {
  // The ward seals at the caster's feet: a hex ring spins in and contracts.
  const settle = easeOut(p / 0.6), radius = R * (1.2 - 0.22 * settle), spin = 0.6 * (1 - settle);
  g.melt = smooth((p - 0.45) / 0.55);
  for (let e = 0; e < 6; e++) ground(g, radius, spin + e * Math.PI / 3, '*', 1, 1, 70 + e);
  hexRingFill(g, radius, spin, p);
  // Frost glints on an inner ring, turning against the ward.
  for (let i = 0; i < 12; i++) {
    const twinkle = 0.5 + 0.5 * Math.sin(g.age * 9 + i * 2.4);
    ground(g, radius * (0.6 + 0.06 * (i % 2)), i * Math.PI / 6 - spin * 1.5, twinkle > 0.6 ? '+' : '.',
      0.3 + 0.4 * twinkle, 0.7, 500 + i);
  }
}
function hexRingFill(g, radius, spin, p) {
  const b = 0.55 + 0.45 * Math.exp(-p * 7), t = 0.95 - 0.4 * p;
  groundHex(g, radius, spin, easeOut(p / 0.3), b, t, 100, Math.max(1, radius * 1.1));
}

function pulse(g, p, R) {
  // Cold snap: a hexagonal frost front rushes outward, trailing fine rime.
  const grow = easeOut(p), radius = R * (0.3 + 0.8 * grow), spin = 0.3 * grow;
  const fade = (1 - p) ** 1.4, b = (0.55 + 0.45 * Math.exp(-p * 6)) * fade, t = 1 - 0.55 * p;
  for (let e = 0; e < 6; e++) {
    const a = spin + e * Math.PI / 3;
    ground(g, radius, a, '*', fade, 1, 20 + e);
    ground(g, radius + 0.12 * R, a, slope(Math.cos(a) * COLS, Math.sin(a) * ROWS), fade * 0.7, 0.85, 30 + e);
  }
  // Dash the front so even the widest snap stays inside the pulse budget.
  groundHex(g, radius, spin, 1, b, t, 200, Math.max(1, radius * COLS * 6 / 58));
  for (let i = 0; i < 20; i++) {
    ground(g, radius * (0.5 + 0.42 * hash(i + 30)), hash(i) * Math.PI * 2 + spin, hash(i + 60) > 0.6 ? ':' : '.',
      fade * (0.25 + 0.35 * hash(i + 90)), 0.55, 700 + i);
  }
}

function zone(g, p, R) {
  // A lingering frost ward: a slowly turning hex with snow circling inside.
  g.env *= Math.min(1, p / 0.08);
  const spin = g.age * 0.25, radius = R * 0.95;
  groundHex(g, radius, spin, 1, 0.55, 0.7, 100, Math.max(1.5, radius * 1.7));
  for (let e = 0; e < 6; e++) {
    const twinkle = 0.5 + 0.5 * Math.cos(g.age * 3 + e * 1.3);
    ground(g, radius, spin + e * Math.PI / 3, twinkle > 0.5 ? '*' : '+', 0.6 + 0.4 * twinkle, 0.85, 10 + e);
  }
  for (let i = 0; i < 26; i++) {
    const r = radius * (0.2 + 0.65 * hash(i + 3)), a = hash(i) * Math.PI * 2 + g.age * (0.4 + 0.5 * hash(i + 9));
    const twinkle = 0.5 + 0.5 * Math.sin(g.age * (2 + 3 * hash(i + 4)) + i);
    ground(g, r, a, twinkle > 0.8 ? '*' : '.', 0.25 + 0.45 * twinkle, 0.5 + 0.35 * twinkle, 900 + i);
  }
}

function projectile(g, p, R) {
  // A single plate spins flat along its flight, shedding a frost wake.
  g.local = true;
  const size = Math.min(0.34, R * 0.42), spin = g.age * 5;
  for (let e = 0; e < 6; e++) {
    const a0 = spin + e * Math.PI / 3, a1 = a0 + Math.PI / 3;
    stroke(g, Math.cos(a0) * size, Math.sin(a0) * size, Math.cos(a1) * size, Math.sin(a1) * size,
      0.8, 0.7 + 0.15 * Math.sin(g.age * 7 + e), e * 17, 1, '_');
  }
  dot(g, 0, 0, '*', 1, 1, 1);
  for (let j = 0; j < 3; j++) {
    const a = -spin * 0.6 + j * Math.PI * 2 / 3;
    dot(g, Math.cos(a) * size * 0.45, Math.sin(a) * size * 0.45, '.', 0.5, 0.8, 2 + j);
  }
  // Wake motes stream backward continuously, easing in at the plate.
  const phase = (g.age * 7) % 1;
  for (let i = 0; i < 14; i++) {
    const k = i + phase, fade = Math.min(1, k) * (1 - k / 14.5) ** 1.5;
    dot(g, Math.sin(g.age * 6 + i * 1.3) * (0.04 + k * 0.012), -(size + 0.05 + k * 0.08), k < 4 ? ':' : '.',
      0.8 * fade, 0.85 - k * 0.03, 60 + i);
  }
}

const STAGES = { cast, impact, aura, pulse, zone, projectile };
const CAPS = { cast: 250, impact: 250, aura: 150, zone: 150, pulse: 90, projectile: 110 };

function draw(effect, plot) {
  const age = Number.isFinite(effect.age) ? effect.age : 0;
  const rawProgress = Number.isFinite(effect.progress) ? effect.progress
    : Number.isFinite(effect.life) && effect.life > 0 ? age / effect.life : 0;
  const p = clamp(rawProgress);
  if (p >= 1) return;
  const stage = STAGES[effect.stage] ? effect.stage : 'cast';
  const g = pen(effect, plot, CAPS[stage], age);
  // Every stage eases in and is guaranteed dark by the end of its life.
  g.env = Math.min(1, p / 0.025, (1 - p) / 0.06);
  STAGES[stage](g, p, Math.max(0.55, Math.min(2.4, Number.isFinite(effect.radius) ? effect.radius : 1.4)));
}

export default {
  id: 'ice-shield',
  duration: 1.18,
  draw,
  sounds: {
    cast: [
      { kind: 'tone', delay: 0, duration: 0.78, gain: 0.046, attack: 0.045, release: 0.46, frequency: 493.88, endFrequency: 523.25, type: 'sine' },
      { kind: 'tone', delay: 0.09, duration: 0.82, gain: 0.036, attack: 0.055, release: 0.5, frequency: 622.25, endFrequency: 659.25, type: 'triangle', cutoff: 2800 },
      { kind: 'tone', delay: 0.18, duration: 0.88, gain: 0.027, attack: 0.065, release: 0.56, frequency: 739.99, endFrequency: 783.99, type: 'sine' },
      { kind: 'noise', delay: 0.04, duration: 0.38, gain: 0.024, attack: 0.07, release: 0.22, cutoff: 4300, filterType: 'highpass' },
      { kind: 'tone', delay: 0.22, duration: 0.92, gain: 0.028, attack: 0.08, release: 0.62, frequency: 261.63, endFrequency: 262.5, type: 'sine' },
    ],
    impact: [
      { kind: 'tone', delay: 0, duration: 0.72, gain: 0.075, attack: 0.008, release: 0.61, frequency: 220, endFrequency: 215, type: 'sine' },
      { kind: 'tone', delay: 0.012, duration: 0.56, gain: 0.034, attack: 0.006, release: 0.49, frequency: 354.2, endFrequency: 349.8, type: 'sine' },
      { kind: 'tone', delay: 0.035, duration: 0.34, gain: 0.02, attack: 0.005, release: 0.28, frequency: 580.8, endFrequency: 575, type: 'triangle', cutoff: 2200 },
      { kind: 'noise', delay: 0, duration: 0.11, gain: 0.021, attack: 0.005, release: 0.09, cutoff: 5400, filterType: 'highpass' },
    ],
    pulse: [
      { kind: 'tone', delay: 0, duration: 0.18, gain: 0.012, attack: 0.018, release: 0.14, frequency: 1046.5, endFrequency: 988, type: 'sine' },
      { kind: 'tone', delay: 0.045, duration: 0.21, gain: 0.009, attack: 0.02, release: 0.17, frequency: 523.25, type: 'sine' },
    ],
  },
};
