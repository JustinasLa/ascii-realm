// Leaf Arrow: a quick living-wood shot. A green-wood bow is drawn while leaf
// motes gather on the leaf-bladed arrowhead, the string snaps and the bow
// sheds into leaves; in flight the arrow keeps a crisp shaft, leaf head and
// fluttering leaflet fletching with a slipstream of motes; on impact it
// flashes, quivers in the target and bursts into splinters and spinning leaves.
const WHITE = [244, 255, 222], VEIN = [222, 246, 140], LEAF = [123, 210, 82];
const DEEP = [58, 138, 60], WOOD = [205, 164, 96], BARK = [128, 92, 52];

// The renderer squashes metres to 26 columns × 6.5 rows (cells are ~2:1),
// so line glyphs are chosen from the on-screen direction, not the local one.
const COLS = 26, ROWS = 6.5;

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const easeOut = t => 1 - (1 - t) ** 3;
const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const RAMP = '.:+*#';
const ramp = light => RAMP[Math.min(RAMP.length - 1, Math.floor(clamp(light) * RAMP.length))];

function view(heading) {
  const h = Number.isFinite(heading) ? heading : 0;
  return { c: Math.cos(h), s: Math.sin(h) };
}
// Screen vector for a local direction: x columns right, y rows down (×2 for cell shape).
const screen = (v, dx, dz) => [(dx * v.c + dz * v.s) * COLS, (dz * v.c - dx * v.s) * ROWS * 2];
const cells = (v, dx, dz) => Math.max(Math.abs((dx * v.c + dz * v.s) * COLS), Math.abs((dz * v.c - dx * v.s) * ROWS));
function line(v, dx, dz) {
  const [x, y] = screen(v, dx, dz), ax = Math.abs(x), ay = Math.abs(y);
  if (ay < ax * 0.42) return '-';
  if (ax < ay * 0.42) return '|';
  return x * y > 0 ? '\\' : '/';
}
function point(v, dx, dz) {
  const [x, y] = screen(v, dx, dz);
  return Math.abs(x) > Math.abs(y) ? (x > 0 ? '>' : '<') : (y > 0 ? 'v' : '^');
}
// One glyph per screen cell along a straight stroke, capped.
function stroke(plot, v, ax, az, bx, bz, cap, style) {
  const dx = bx - ax, dz = bz - az, glyph = line(v, dx, dz);
  const n = Math.max(2, Math.min(cap, Math.ceil(cells(v, dx, dz))));
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), [color, light] = style(t);
    if (light > 0.003) plot(ax + dx * t, az + dz * t, glyph, color, light);
  }
}

// The arrow is authored tail → tip along +z: wood shaft, leaflet fletching
// and a pointed leaf blade whose midrib carries the brightest light.
function arrow(plot, v, tail, length, light, age, glow = 0) {
  if (light <= 0.003) return;
  const blade = tail + length * 0.6, tip = tail + length;
  stroke(plot, v, 0, tail + 0.06, 0, blade, 28, t => [mix(BARK, WOOD, t), light * (0.62 + 0.38 * t)]);
  // Leaf blade: widest near its base, tapering into a sharp point.
  const span = tip - blade, half = 0.19 + glow * 0.03;
  const segs = Math.max(4, Math.min(13, Math.ceil(cells(v, 0, span))));
  for (const side of [-1, 1]) {
    for (let i = 0; i < segs; i++) {
      const t0 = i / segs, t1 = (i + 1) / segs;
      const w0 = Math.sin(Math.PI * t0 ** 0.8) * half * (1 - t0 * 0.3), w1 = Math.sin(Math.PI * t1 ** 0.8) * half * (1 - t1 * 0.3);
      const x = side * (w0 + w1) / 2, z = blade + span * (t0 + t1) / 2;
      plot(x, z, line(v, side * (w1 - w0), span / segs), mix(LEAF, VEIN, t0 * 0.6 + glow * 0.4), light * (0.78 + 0.22 * t0));
    }
  }
  stroke(plot, v, 0, blade + span * 0.12, 0, tip - span * 0.12, 10, t => [mix(VEIN, WHITE, t * 0.5 + glow * 0.5), light]);
  plot(0, tip, point(v, 0, 1), mix(VEIN, WHITE, 0.5 + glow * 0.5), light);
  // Three pairs of swept-back leaflets flutter out of phase.
  for (let k = 0; k < 3; k++) {
    const z = tail + 0.1 + k * 0.13, reach = 0.17 - k * 0.025;
    for (const side of [-1, 1]) {
      const flutter = Math.sin(age * 31 + k * 1.7 + side) * 0.03;
      const ex = side * (reach + flutter), ez = z - 0.16;
      const glyph = line(v, ex, ez - z);
      plot(ex * 0.45, z - 0.07, glyph, LEAF, light * 0.85);
      plot(ex, ez, glyph, DEEP, light * 0.7);
    }
  }
}

function flight(plot, v, age, fade) {
  const tail = -0.85;
  arrow(plot, v, tail, 1.38, fade, age);
  // Slipstream motes peel off the fletching, widen and dim behind the arrow.
  for (let i = 0; i < 18; i++) {
    const ph = (age * 3.4 + hash(i)) % 1, spread = (hash(i + 31) - 0.5) * 0.55;
    const x = Math.sin(age * 11 + i * 2.3) * 0.05 + spread * ph, z = tail - 0.12 - ph * 1.9;
    const light = (1 - ph) ** 1.6;
    plot(x, z, ramp(light * 0.78), mix(DEEP, VEIN, light), fade * light * 0.9);
  }
  // A few torn leaves tumble in the wake.
  for (let i = 0; i < 4; i++) {
    const ph = (age * 1.9 + hash(i + 70)) % 1, side = i % 2 ? 1 : -1;
    const x = side * (0.12 + ph * 0.45) + Math.sin(age * 9 + i) * 0.08, z = tail - 0.3 - ph * 1.6;
    const spin = Math.sin(age * 22 + i * 1.9);
    plot(x, z, spin > 0.35 ? ',' : spin < -0.35 ? '`' : '~', mix(LEAF, DEEP, ph), fade * (1 - ph) * 0.85);
  }
}

function cast(plot, v, p, age, fade) {
  // The projectile launches on the cast frame, so the wind-up is a brief
  // full-draw hold before the string snaps; most of the stage is follow-through.
  const RELEASE = 0.11;
  const draw = 0.55 + 0.45 * easeInOut(clamp(p / RELEASE)), rel = clamp((p - RELEASE) / (1 - RELEASE));
  const released = p >= RELEASE, grow = easeOut(clamp(p / 0.06));
  // Bow limbs bend further while drawn, then spring back with a damped wobble.
  const recoil = released ? Math.cos(rel * 26) * (1 - rel) ** 3 * 0.5 : draw;
  const bend = 0.24 + 0.36 * recoil, grip = 0.7, span = 0.72 * grow;
  // After the snap the bow sheds into leaves from the tips in toward the grip.
  const shed = clamp((rel - 0.2) / 0.6);
  const n = Math.max(12, Math.min(44, Math.ceil(cells(v, span * 2, bend))));
  for (let i = 0; i <= n; i++) {
    const u = i / n * 2 - 1, x = u * span, z = grip - bend * u * u, h = hash(i + 11);
    const d = clamp((rel - 0.12 - (1 - Math.abs(u)) * 0.42 - h * 0.1) / 0.38);
    if (d >= 1) continue;
    const color = mix(mix(WOOD, LEAF, Math.abs(u) * 0.5 + rel * 0.4), DEEP, d);
    const light = fade * (0.6 + 0.4 * (1 - Math.abs(u))) * (1 - d) ** 1.2;
    if (d <= 0) { plot(x, z, line(v, span, -2 * bend * u), color, light); continue; }
    const flutter = Math.sin(age * 11 + i * 1.7) * 0.07 * d;
    plot(x + u * 0.38 * d + (h - 0.5) * 0.25 * d + flutter, z - (0.15 + h * 0.3) * d * d,
      Math.sin(age * 17 + i) > 0 ? ',' : '`', color, light);
  }
  const tipZ = grip - bend, nockZ = released ? tipZ + Math.sin(rel * 44) * 0.14 * (1 - rel) ** 2 : grip - 0.06 - 0.9 * draw;
  // String: taut V while drawn, a vibrating near-straight line after release.
  for (const side of [-1, 1]) {
    stroke(plot, v, side * span, tipZ, 0, nockZ, 24, t => [mix(VEIN, WHITE, draw * (1 - rel)), fade * (0.45 + 0.35 * draw) * (1 - shed) ** 1.5]);
  }
  if (!released) {
    const glow = clamp((draw - 0.75) / 0.25) * (0.75 + 0.25 * Math.sin(age * 60));
    arrow(plot, v, nockZ, 1.25, fade * grow, age, glow);
    // Leaf motes spiral in to the arrowhead as the draw tightens.
    const head = nockZ + 1.25;
    for (let i = 0; i < 20; i++) {
      const m = clamp(p / RELEASE * 1.4 - hash(i) * 0.4), e = m * m;
      if (m <= 0 || m >= 1) continue;
      const a = hash(i + 5) * Math.PI * 2 + e * 2.4, r = 1.55 * (1 - e);
      plot(Math.sin(a) * r, head + Math.cos(a) * r * 0.8, ramp(0.3 + e * 0.7), mix(DEEP, VEIN, e), fade * (0.35 + 0.65 * e));
    }
    return;
  }
  // Release: the arrow streaks away, leaving a fading motion smear.
  const out = easeOut(clamp(rel / 0.18)), gone = clamp(1 - rel / 0.18);
  const front = nockZ + 1.25 + out * 3.6;
  stroke(plot, v, 0, Math.max(nockZ, front - 1.6), 0, front, 30, t => [mix(WOOD, WHITE, t), fade * gone * t]);
  plot(0, front, point(v, 0, 1), WHITE, fade * gone);
  // A forward cone of leaf shards bursts from the bow grip.
  const burst = easeOut(clamp(rel / 0.7)), puff = (1 - rel) ** 1.5;
  for (let i = 0; i < 16; i++) {
    const a = (hash(i + 40) - 0.5) * 1.6, sp = 0.8 + hash(i + 90) * 1.6;
    const d = sp * burst, x = Math.sin(a) * d, z = grip + Math.cos(a) * d;
    const light = puff * (0.5 + 0.5 * hash(i + 3));
    plot(x, z, d < 0.9 ? line(v, Math.sin(a), Math.cos(a)) : (i % 2 ? ',' : "'"), mix(WHITE, LEAF, burst), fade * light);
  }
}

function impact(plot, v, p, age, radius, fade) {
  const R = clamp(radius, 0.6, 2);
  // Strike flash: a white core and short rays that punch out and retract.
  const flash = 1 - easeOut(clamp(p / 0.2));
  if (flash > 0) {
    const reach = 0.12 + Math.sin(Math.PI * clamp(p / 0.2)) * 0.55 * R;
    for (let k = 0; k < 8; k++) {
      const a = k / 8 * Math.PI * 2 + 0.2, dx = Math.sin(a), dz = Math.cos(a);
      stroke(plot, v, dx * 0.1, dz * 0.1, dx * reach * (k % 2 ? 0.6 : 1), dz * reach * (k % 2 ? 0.6 : 1), 6,
        t => [mix(WHITE, VEIN, t), fade * flash * (1 - t * 0.6)]);
    }
    plot(0, 0, '@', WHITE, fade * flash);
  }
  // The arrow sticks in, quivering behind the hit, then thins away.
  const stuck = clamp(1 - p / 0.55) ** 1.2;
  if (stuck > 0) {
    const wob = Math.sin(age * 48) * Math.exp(-age * 6) * 0.22;
    const tail = -1.0;
    const n = 14;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), x = wob * t * t, z = -0.05 + (tail + 0.05) * t;
      if (hash(i + 200) > stuck + 0.15) continue;
      plot(x, z, line(v, wob * 2 * t, tail), mix(WOOD, BARK, t), fade * stuck * (0.9 - t * 0.3));
    }
    for (const side of [-1, 1]) {
      plot(wob + side * 0.12, tail + 0.05, line(v, side, -1), LEAF, fade * stuck * 0.8);
      plot(wob + side * 0.2, tail - 0.07, line(v, side, -1), DEEP, fade * stuck * 0.6);
    }
  }
  // Splinters and leaf chips spray mostly forward with drag.
  const drag = 6;
  const travel = (1 - Math.exp(-drag * age)) / drag;
  for (let i = 0; i < 22; i++) {
    const back = i >= 17, a = (back ? Math.PI : 0) + (hash(i + 400) - 0.5) * (back ? 1.2 : 2.4);
    const sp = (2.4 + hash(i + 500) * 3.2) * R * (back ? 0.6 : 1);
    const d = sp * travel, x = Math.sin(a) * d, z = Math.cos(a) * d;
    const speed = sp * Math.exp(-drag * age), light = (1 - p) ** 2 * (0.55 + 0.45 * hash(i + 9));
    const glyph = speed > 1.2 ? line(v, Math.sin(a), Math.cos(a)) : i % 3 ? '.' : ',';
    plot(x, z, glyph, mix(i % 3 ? WOOD : LEAF, BARK, p), fade * light);
  }
  // Seven leaves spin outward on a loose spiral and flutter as they slow.
  const out = easeOut(clamp(p / 0.8));
  for (let i = 0; i < 7; i++) {
    const a = i / 7 * Math.PI * 2 + hash(i + 600) * 0.6 + out * 0.9;
    const r = (0.2 + out * 1.15 * (0.75 + 0.3 * hash(i + 700))) * R;
    const flutter = Math.sin(age * 13 + i * 2) * 0.09 * out;
    const cx = Math.sin(a) * r + Math.cos(a) * flutter, cz = Math.cos(a) * r - Math.sin(a) * flutter;
    const turn = hash(i + 800) * 6 + age * (i % 2 ? 7 : -7), ux = Math.sin(turn) * 0.09, uz = Math.cos(turn) * 0.09;
    const light = fade * (1 - out * 0.55) * clamp(p / 0.06);
    const color = mix(VEIN, DEEP, out);
    plot(cx, cz, line(v, ux, uz), color, light);
    plot(cx + ux, cz + uz, '.', color, light * 0.75);
    plot(cx - ux, cz - uz, "'", color, light * 0.6);
  }
  // A thin green shock ring expands and thins.
  const ring = easeOut(clamp(p / 0.6)), ringLight = (1 - ring) ** 1.4;
  if (ringLight > 0.01) {
    const r = (0.25 + ring * 1.45) * R;
    for (let i = 0; i < 30; i++) {
      const a = i / 30 * Math.PI * 2;
      if (hash(i + 900) < ring * 0.5) continue;
      plot(Math.sin(a) * r, Math.cos(a) * r, line(v, Math.cos(a), -Math.sin(a)), mix(VEIN, LEAF, ring), fade * ringLight * 0.7);
    }
  }
  // Pollen motes linger and twinkle out.
  for (let i = 0; i < 8; i++) {
    const m = clamp((p - 0.25 - hash(i + 1000) * 0.15) / 0.6);
    if (m <= 0) continue;
    const a = hash(i + 1100) * Math.PI * 2, r = (0.35 + hash(i + 1200) * 0.9) * R;
    const twinkle = 0.6 + 0.4 * Math.sin(age * 20 + i * 2.7);
    plot(Math.sin(a) * r + Math.sin(age * 3 + i) * 0.1, Math.cos(a) * r - m * 0.35,
      m < 0.5 ? '*' : '.', mix(VEIN, LEAF, m), fade * Math.sin(Math.PI * m) * twinkle * 0.8);
  }
}

// Pulse/aura/zone are not used by the shot itself; they share a lean leaf whirl.
function whirl(plot, v, stage, p, age, radius) {
  const env = clamp(p / 0.15) * clamp((1 - p) / 0.3);
  if (env <= 0) return;
  const R = stage === 'zone' ? clamp(radius, 0.8, 6) : stage === 'aura' ? 0.9 : clamp(radius, 0.5, 2) * (0.4 + easeOut(p) * 0.7);
  const cap = stage === 'zone' ? 34 : stage === 'aura' ? 22 : 20;
  const count = Math.max(10, Math.min(cap, Math.ceil(cells(v, R * 6.3, 0) / 3.5)));
  for (let i = 0; i < count; i++) {
    const a = i / count * Math.PI * 2 + age * (stage === 'pulse' ? 1.2 : 1.8);
    const r = R * (0.85 + 0.15 * Math.sin(age * 4 + i * 1.3));
    const cx = Math.sin(a) * r, cz = Math.cos(a) * r, tx = Math.cos(a), tz = -Math.sin(a);
    const color = mix(VEIN, DEEP, (i % 4) / 4), light = env * (0.55 + 0.45 * Math.sin(age * 6 + i));
    plot(cx, cz, line(v, tx, tz), color, light);
    plot(cx - tx * 0.12, cz - tz * 0.12, i % 2 ? ',' : '`', color, light * 0.6);
  }
  if (stage !== 'pulse') arrow(plot, v, -0.6 * Math.min(1, R), 1.15 * Math.min(1, R), env * 0.8, age);
  for (let i = 0; i < (stage === 'zone' ? 12 : 8); i++) {
    const ph = (age * 0.7 + hash(i + 50)) % 1, a = hash(i + 60) * Math.PI * 2, r = R * ph;
    plot(Math.sin(a) * r, Math.cos(a) * r, ramp((1 - ph) * 0.7), LEAF, env * Math.sin(Math.PI * ph) * 0.7);
  }
}

export default {
  id: 'temp-quickshot',
  duration: 0.7,
  draw(effect, plot) {
    const p = clamp(Number.isFinite(effect.progress) ? effect.progress : 0);
    const age = Number.isFinite(effect.age) ? Math.max(0, effect.age) : 0;
    const radius = Number.isFinite(effect.radius) ? effect.radius : 1;
    const fade = Math.min(1, (1 - p) * 4), v = view(effect.heading);
    if (fade <= 0) return;
    if (effect.stage === 'projectile') flight(plot, v, age, Math.min(1, (1 - p) * 3));
    else if (effect.stage === 'cast') cast(plot, v, p, age, fade);
    else if (effect.stage === 'impact') impact(plot, v, p, age, radius, fade);
    else whirl(plot, v, effect.stage, p, age, radius);
  },
  sounds: {
    cast: [
      { kind: 'tone', type: 'triangle', frequency: 294, endFrequency: 132, duration: 0.12, gain: 0.085, attack: 0.001, release: 0.1 },
      { kind: 'tone', type: 'sine', frequency: 672, endFrequency: 336, delay: 0.008, duration: 0.055, gain: 0.025, attack: 0.001, release: 0.05 },
      { kind: 'noise', delay: 0.045, duration: 0.09, gain: 0.047, cutoff: 3200, filterType: 'bandpass', attack: 0.005, release: 0.07 },
    ],
    impact: [
      { kind: 'noise', duration: 0.035, gain: 0.055, cutoff: 3900, filterType: 'highpass', attack: 0.001, release: 0.03 },
      { kind: 'noise', delay: 0.026, duration: 0.04, gain: 0.037, cutoff: 5200, filterType: 'bandpass', attack: 0.001, release: 0.035 },
      { kind: 'noise', delay: 0.068, duration: 0.03, gain: 0.022, cutoff: 2700, filterType: 'highpass', attack: 0.001, release: 0.026 },
      { kind: 'tone', type: 'sine', frequency: 840, endFrequency: 280, duration: 0.035, gain: 0.018, attack: 0.001, release: 0.03 },
    ],
  },
};
