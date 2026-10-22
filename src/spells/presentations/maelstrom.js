const TAU = Math.PI * 2;
// Abyss -> deep -> sea -> sea-glass -> foam -> white crest.
const STOPS = [[5, 20, 36], [16, 78, 108], [40, 156, 172], [96, 212, 212], [176, 244, 238], [238, 255, 253]];
const RAMP = Array.from({ length: 21 }, (_, i) => {
  const t = i / 20 * (STOPS.length - 1), k = Math.min(STOPS.length - 2, Math.floor(t)), f = t - k;
  return STOPS[k].map((c, j) => Math.round(c + (STOPS[k + 1][j] - c) * f));
});
const EYE = [4, 16, 30];
const clamp01 = t => t < 0 ? 0 : t > 1 ? 1 : t;
const tone = t => RAMP[Math.round(clamp01(t) * 20)];
const smooth = t => { t = clamp01(t); return t * t * (3 - 2 * t); };
const outCubic = t => 1 - (1 - clamp01(t)) ** 3;
const inQuad = t => clamp01(t) ** 2;
const fract = v => v - Math.floor(v);
const hash = (i, salt = 0) => fract(Math.sin(i * 12.9898 + salt * 78.233 + 0.5) * 43758.5453);
// One metre of height lifts a glyph by five rows, like the game's projectiles.
const LIFT = 5 / 6.5;

const COLS = 13 / 0.6, ROWS = 6.5;

// Wraps plot with the effect heading so glyphs can follow on-screen flow and
// droplets can rise and fall regardless of which way the spell was aimed.
function pen(effect, plot) {
  const heading = Number.isFinite(effect.heading) ? effect.heading : 0;
  const c = Math.cos(heading), s = Math.sin(heading);
  const P = {
    ux: LIFT * s, uz: -LIFT * c,
    dot(x, z, h, char, color, brightness) {
      if (brightness > 0.012) plot(x + h * LIFT * s, z - h * LIFT * c, char, color, Math.min(1, brightness));
    },
    // Screen cell position of a local point (used to space strokes one cell apart).
    cx: (x, z) => (x * c + z * s) * COLS,
    cy: (x, z) => (z * c - x * s) * ROWS,
    // Picks a stroke for an on-screen direction; cells are ~0.6 as wide as tall.
    flowCells(vx, vy, level = '~') {
      let a = Math.atan2(vy, vx * 0.6);
      if (a < 0) a += Math.PI;
      return a < 0.42 || a >= 2.72 ? level : a < 1.2 ? '\\' : a < 1.94 ? '|' : '/';
    },
    flow(dx, dz, level = '~', dh = 0) {
      dx += dh * LIFT * s; dz -= dh * LIFT * c;
      return P.flowCells(P.cx(dx, dz), P.cy(dx, dz), level);
    },
  };
  return P;
}

// Walks a parametric curve (at(u) writes PT) and drops glyphs one screen cell
// apart, in dashes of `dash` cells separated by gapAt(u) empty cells, so long
// curves read as connected strokes instead of scattered dots.
const PT = { x: 0, z: 0 };
function stroke(P, at, steps, cap, dash, gapAt, paint) {
  at(0);
  let px = PT.x, pz = PT.z, pcx = P.cx(px, pz), pcy = P.cy(px, pz), acc = 0, next = 0, run = 0, count = 0;
  for (let k = 1; k <= steps && count < cap; k++) {
    const u = k / steps;
    at(u);
    const x = PT.x, z = PT.z, cx = P.cx(x, z), cy = P.cy(x, z);
    const d = Math.max(Math.abs(cx - pcx), Math.abs(cy - pcy));
    while (acc + d >= next && count < cap) {
      const f = d > 0 ? (next - acc) / d : 0;
      paint(px + (x - px) * f, pz + (z - pz) * f, u - (1 - f) / steps, cx - pcx, cy - pcy, count++);
      if (++run >= dash) { run = 0; next += 1 + gapAt(u); } else next += 1;
    }
    acc += d; px = x; pz = z; pcx = cx; pcy = cy;
  }
  return count;
}

// A ripple ellipse drawn as evenly spaced dashes that fit inside cap glyphs.
function ripple(P, r, cap, dash, spin, paint) {
  let perim = 0, px = P.cx(r, 0), py = P.cy(r, 0);
  for (let k = 1; k <= 32; k++) {
    const a = k * TAU / 32, x = P.cx(Math.cos(a) * r, Math.sin(a) * r), y = P.cy(Math.cos(a) * r, Math.sin(a) * r);
    perim += Math.max(Math.abs(x - px), Math.abs(y - py)); px = x; py = y;
  }
  const gap = Math.max(0, perim * dash / cap - dash);
  return stroke(P, u => { const a = spin + u * TAU; PT.x = Math.cos(a) * r; PT.z = Math.sin(a) * r; }, 64, cap, dash, () => gap, paint);
}

// Lays `cap` glyphs along an arm in dashes of `dash` glyphs one screen cell
// apart. Dash k aims for ground distance (k / last)^ARM_FLARE of the arm's
// length, so the gaps widen smoothly outward, but never starts before the
// previous dash ends, so the throat stays solid; the last dash ends on the rim.
// Every glyph's place is a continuous function of the arm's shape, so nothing
// jumps as the arm turns or grows, and glyphs only fade in or out at the tip
// of an arm too short to hold them all. paint gets (x, z, u, vx, vy, index, fade).
const ARM_STEPS = 96, ARM_FLARE = 1.6;
const AX = new Float64Array(ARM_STEPS + 1), AZ = new Float64Array(ARM_STEPS + 1);
const CELLS = new Float64Array(ARM_STEPS + 1), METRES = new Float64Array(ARM_STEPS + 1);
function armStroke(P, at, cap, dash, paint) {
  at(0);
  AX[0] = PT.x; AZ[0] = PT.z;
  for (let k = 1; k <= ARM_STEPS; k++) {
    at(k / ARM_STEPS);
    AX[k] = PT.x; AZ[k] = PT.z;
    const dx = AX[k] - AX[k - 1], dz = AZ[k] - AZ[k - 1];
    CELLS[k] = CELLS[k - 1] + Math.max(Math.abs(P.cx(dx, dz)), Math.abs(P.cy(dx, dz)));
    METRES[k] = METRES[k - 1] + Math.hypot(dx, dz);
  }
  const L = CELLS[ARM_STEPS], last = Math.ceil(cap / dash) - 1;
  let start = -Infinity, m = 1, k = 1;
  for (let d = 0, i = 0; d <= last; d++) {
    // Cell position of the ground distance this dash aims for.
    const share = d / last, v = METRES[ARM_STEPS] * share ** ARM_FLARE;
    while (m < ARM_STEPS && METRES[m] < v) m++;
    const run = METRES[m] - METRES[m - 1], g = run > 0 ? clamp01((v - METRES[m - 1]) / run) : 0;
    start = Math.max(start + dash, CELLS[m - 1] + (CELLS[m] - CELLS[m - 1]) * g - (dash - 1) * share);
    for (let j = 0; j < dash && i < cap; j++, i++) {
      const want = start + j, fade = clamp01(L + 1 - want), s = Math.min(L, want);
      if (fade <= 0) return;
      while (k < ARM_STEPS && CELLS[k] < s) k++;
      const seg = CELLS[k] - CELLS[k - 1], f = seg > 0 ? clamp01((s - CELLS[k - 1]) / seg) : 0;
      const dx = AX[k] - AX[k - 1], dz = AZ[k] - AZ[k - 1];
      paint(AX[k - 1] + dx * f, AZ[k - 1] + dz * f, (k - 1 + f) / ARM_STEPS, P.cx(dx, dz), P.cy(dx, dz), i, fade);
    }
  }
}

// A pinpoint vortex (the rune's display totem): spray and mist thrown up out
// of the throat, kept above the ground so it never clutters a larger whirlpool.
function spout(P, age, env) {
  for (let j = 0; j < 12; j++) {
    const f = fract(age * (0.9 + 0.5 * hash(j, 81)) + hash(j, 82)), a = hash(j, 83) * TAU - age * 3;
    const r = 0.12 + 0.55 * f * (0.5 + 0.5 * hash(j, 84)), h = 0.3 + 1.6 * f * (1 - f) * (0.6 + 0.4 * hash(j, 85));
    P.dot(Math.cos(a) * r, Math.sin(a) * r, h, f < 0.45 ? '\'' : f < 0.7 ? '.' : ',', tone(0.92 - 0.4 * f),
      env * smooth(f / 0.12) * (1 - f) * 0.85);
  }
  for (let j = 0; j < 3; j++) {
    const f = fract(age * 0.35 + j / 3);
    P.dot(Math.sin(age * 0.8 + j * 2) * 0.2, 0, 0.6 + 1.4 * f, ':', tone(0.55), env * Math.sin(Math.PI * f) * 0.35);
  }
}

// A spiral whirlpool: foam arms wound around a dark throat, a churning rim,
// and flotsam that accelerates along the arms before it is swallowed.
function whirlpool(P, effect) {
  const R = Math.max(0.7, Math.min(9, effect.radius)), age = effect.age, p = effect.progress;
  const appear = smooth(age / 0.35), calm = 1 - smooth((1 - p) / 0.25), env = appear * (1 - calm);
  if (env <= 0) return;
  if (effect.radius < 0.5) return spout(P, age, env);
  const grow = outCubic(age / 0.9), w = 0.9 + 2.2 / Math.sqrt(R);
  const rot = -w * (age - 0.45 * (1 - Math.exp(-age / 0.45)));
  const extent = R * (0.3 + 0.7 * grow) * (1 + 0.12 * calm);
  const curl = (R < 1.5 ? 3.4 : 4.2) * (1 - 0.35 * calm);
  const eyeR = Math.min(0.5, Math.max(0.14, R * 0.07)) * (0.6 + 0.4 * grow) * (1 - 0.45 * calm);
  const span = extent - eyeR;
  // Three foam arms: solid strokes near the throat, breaking into ever sparser
  // dashes outward; the budget is spread along the whole arm out to the rim.
  const arms = 3, armCap = R < 1.5 ? 18 : R < 4 ? 27 : 30;
  for (let arm = 0; arm < arms; arm++) {
    const base = rot + arm * TAU / arms;
    const at = u => {
      const r = eyeR + span * u ** 1.15, a = base + curl * (1 - u) ** 1.6 + 0.14 * Math.sin(age * 1.7 + arm * 2.1 + u * 6);
      PT.x = Math.cos(a) * r; PT.z = Math.sin(a) * r;
    };
    armStroke(P, at, armCap, 3, (x, z, u, vx, vy, i, fade) => {
      // Unravels as the sea calms: each glyph dims out as calm sweeps past its own threshold.
      if (calm > 0) fade *= clamp01((hash(arm * 37 + i, 4) - calm * (0.65 + u)) / 0.25 + 1);
      const crest = 0.78 + 0.22 * Math.sin(u * 11 - age * 5 + arm * 1.3), inner = (1 - u) ** 1.1;
      P.dot(x, z, 0, P.flowCells(vx, vy), tone(0.34 + 0.62 * inner), env * fade * crest * (0.36 + 0.64 * inner));
    });
  }
  // Flotsam is dragged in from the rim as short streaks, speeding up near the throat.
  const motes = Math.min(6, Math.max(4, Math.round(3 + R)));
  for (let j = 0; j < motes; j++) {
    const f = fract(age * (0.2 + 0.14 * hash(j, 1)) * 2.6 / (1 + R * 0.25) + hash(j, 2));
    const fade = env * smooth(f / 0.12) * smooth((1 - f) / 0.12);
    if (fade <= 0.012) continue;
    const lead = 0.5 + 0.9 * hash(j, 3) + (j % arms) * TAU / arms, reach = span * 0.97;
    const at = q => {
      const u = (1 - q) ** 1.3, r = eyeR + reach * u, a = rot + lead + curl * (1 - (r - eyeR) / span) ** 1.6 + q * 1.4;
      PT.x = Math.cos(a) * r; PT.z = Math.sin(a) * r;
    };
    at(f);
    const x = PT.x, z = PT.z;
    at(Math.max(0, f - 0.02));
    const vx = P.cx(x - PT.x, z - PT.z), vy = P.cy(x - PT.x, z - PT.z), step = Math.max(Math.abs(vx), Math.abs(vy)) || 1;
    for (let k = 0; k < 3; k++) {
      const back = k / step;
      P.dot(x - (x - PT.x) * back, z - (z - PT.z) * back, 0, k ? '-' : 'o', tone(0.95 - k * 0.22), fade * (1 - k * 0.3));
    }
  }
  // Churning outer rim: short foam crests travel around the lip of the vortex.
  const crests = Math.min(6, Math.max(4, Math.round(3 + R)));
  for (let j = 0; j < crests; j++) {
    const a = j * TAU / crests + rot * 0.35 + hash(j, 5) * 0.4;
    const swell = 0.5 + 0.5 * Math.sin(a * 3 - age * 2.1 + hash(j, 6) * 4);
    const r = extent * (1 + 0.035 * Math.sin(a * 5 + age * 2.4)), x = Math.cos(a) * r, z = Math.sin(a) * r;
    const tx = -Math.sin(a), tz = Math.cos(a), cells = Math.max(Math.abs(P.cx(tx, tz)), Math.abs(P.cy(tx, tz))) || 1;
    for (let k = -1; k <= 1; k++) {
      P.dot(x + tx * k / cells, z + tz * k / cells, 0, k ? '-' : swell > 0.6 ? '~' : '-', tone(0.32 + 0.4 * swell - Math.abs(k) * 0.1),
        env * (0.3 + 0.5 * swell) * (k ? 0.7 : 1));
    }
  }
  // The throat: a bright spinning lip that narrows into the deep in smaller,
  // darker, faster rings down to a black core.
  ripple(P, eyeR, 14, 2, rot * 2.3, (x, z, u, vx, vy, i) =>
    P.dot(x, z, 0, P.flowCells(vx, vy), tone(i % 2 ? 0.86 : 1), env * (0.8 + 0.2 * Math.sin(u * TAU * 3 + age * 9))));
  for (let k = 1; k <= 3; k++) {
    const r = eyeR * (1 - 0.24 * k), h = -eyeR * 0.5 * k, count = 12 - 3 * k;
    for (let j = 0; j < count; j++) {
      const a = rot * (2.3 + 0.9 * k) + (j + k * 0.5) * TAU / count;
      P.dot(Math.cos(a) * r, Math.sin(a) * r, h, P.flow(Math.sin(a), -Math.cos(a)), tone(0.62 - 0.16 * k), env * (0.85 - 0.18 * k));
    }
  }
  P.dot(0, 0, -eyeR * 2, '@', EYE, env);
  // Spray thrown up off the lip falls back into the throat.
  for (let j = 0; j < 4; j++) {
    const f = fract(age * 1.25 + hash(j, 7)), a = rot * 2.3 + hash(j, 8) * TAU;
    const r = eyeR * (1 + 0.8 * f), h = Math.min(0.9, R * 0.12) * 4 * f * (1 - f);
    P.dot(Math.cos(a) * r, Math.sin(a) * r, h, f < 0.5 ? '\'' : '.', tone(0.9), env * (1 - f) * 0.8);
  }
}

// The caster draws the sea up into a spinning orb, then flings it forward.
function cast(P, effect) {
  const R = Math.max(0.6, Math.min(2, effect.radius)), p = effect.progress, age = effect.age;
  const env = smooth((1 - p) / 0.3) * smooth(age / 0.08 + 0.15);
  const RELEASE = 0.42, g = clamp01(p / RELEASE), q = clamp01((p - RELEASE) / (1 - RELEASE));
  const orbH = 0.8, spin = -age * 9;
  // Three ribbons of water spiral up from the ground into the orb: the heads
  // race inward first and the tails follow, so the sea is drawn in, not popped.
  const head = clamp01(g / 0.62), tail = clamp01((g - 0.38) / 0.62);
  if (head > tail) {
    for (let arm = 0; arm < 3; arm++) {
      const a0 = arm * TAU / 3 + 0.4, r0 = R * 2;
      const at = u => {
        const v = tail + (head - tail) * u, e = v ** 1.4, r = r0 + (0.16 - r0) * e;
        const a = a0 + spin * 0.25 - 3.6 * e, h = orbH * e * e;
        PT.x = Math.cos(a) * r + h * P.ux; PT.z = Math.sin(a) * r + h * P.uz;
      };
      stroke(P, at, 64, 40, 4, () => 1, (x, z, u, vx, vy) => {
        P.dot(x, z, 0, u > 0.93 ? 'o' : P.flowCells(vx, vy), tone(0.4 + 0.55 * u),
          env * (0.3 + 0.7 * u) * smooth(head / 0.15));
      });
    }
  }
  // Loose droplets lift off the surface and are sucked toward the streams.
  for (let j = 0; j < 12; j++) {
    const delay = hash(j, 11) * 0.4, gg = clamp01((g - delay) / 0.55);
    if (gg <= 0 || gg >= 1) continue;
    const r0 = R * (1.2 + 0.9 * hash(j, 12)), a0 = hash(j, 13) * TAU, e = inQuad(gg), r = r0 + (0.2 - r0) * e;
    const a = a0 - e * 3 + spin * 0.25;
    P.dot(Math.cos(a) * r, Math.sin(a) * r, orbH * e * e, gg < 0.5 ? '.' : "'", tone(0.5 + 0.4 * gg),
      env * smooth(gg / 0.2) * smooth((1 - gg) / 0.15) * 0.8);
  }
  // A shallow eddy forms under the caster's feet.
  const eddy = env * smooth(g / 0.4) * (1 - 0.7 * q);
  for (let arm = 0; arm < 2; arm++) {
    for (let i = 0; i < 8; i++) {
      const t = (i + 0.5) / 8, r = R * (0.25 + (1.25 - 0.35 * g + 0.8 * outCubic(q)) * t);
      const a = spin * 0.6 + arm * Math.PI + 3 * (1 - t);
      P.dot(Math.cos(a) * r, Math.sin(a) * r, 0, P.flow(-Math.sin(a) + Math.cos(a) * 0.3, Math.cos(a) + Math.sin(a) * 0.3),
        tone(0.3 + 0.45 * (1 - t)), eddy * (0.35 + 0.5 * (1 - t)));
    }
  }
  // The orb swells and spins, then flares white as it is released.
  const swell = 0.08 + 0.2 * outCubic(g), orbFade = env * (q > 0 ? 1 - smooth(q / 0.35) : 0.35 + 0.65 * g);
  for (let j = 0; j < 10; j++) {
    const a = spin * 1.6 + j * TAU / 10, r = swell * (1 + 0.6 * outCubic(q));
    P.dot(Math.cos(a) * r, Math.sin(a) * r, orbH, P.flow(Math.sin(a), -Math.cos(a)), tone(0.7 + 0.3 * g), orbFade);
  }
  P.dot(0, 0, orbH, g < 0.6 ? 'o' : q < 0.15 ? '#' : 'O', q > 0 && q < 0.2 ? RAMP[20] : tone(0.2 + 0.6 * g), orbFade);
  if (q <= 0) return;
  // Release: muzzle flash rays favour the cast direction.
  const flash = env * (1 - smooth(q / 0.25));
  for (let j = 0; j < 8; j++) {
    const a = Math.PI / 2 + (j - 3.5) * 0.42, r = 0.2 + 0.5 * outCubic(q / 0.3) * (1 - Math.abs(j - 3.5) * 0.15);
    P.dot(Math.cos(a) * r, Math.sin(a) * r, orbH, P.flow(Math.cos(a), Math.sin(a)), RAMP[20 - j % 3], flash);
  }
  // Two ground ripples roll outward from the caster.
  for (let ring = 0; ring < 2; ring++) {
    const k = clamp01((q - ring * 0.16) / (1 - ring * 0.16)), count = ring ? 20 : 28;
    if (k <= 0) continue;
    const r = R * (0.4 + (ring ? 1.3 : 1.9) * outCubic(k)), b = env * (1 - k) ** 1.4 * (ring ? 0.6 : 0.9);
    ripple(P, r, count, 2, ring * 0.7 + age, (x, z, u, vx, vy, i) =>
      P.dot(x, z, 0, P.flowCells(vx, vy), tone(0.85 - 0.45 * k - ring * 0.15 - (i % 2) * 0.1), b));
  }
  // A forward jet of spray arcs out and splashes down; the rest of the orb rains around the caster.
  const tau = q * 0.67;
  for (let j = 0; j < 30; j++) {
    const jet = j < 18, spread = jet ? (hash(j, 21) - 0.5) * 1.0 : hash(j, 21) * TAU;
    const dir = jet ? Math.PI / 2 + spread : spread, v = jet ? 4 + 4 * hash(j, 22) : 0.8 + 1.4 * hash(j, 22);
    const up = jet ? 1 + 2 * hash(j, 23) : 0.6 + 1.2 * hash(j, 23);
    const d = (jet ? 0.25 : swell) + v * (1 - Math.exp(-3 * tau)) / 3, h = orbH + up * tau - 7 * tau * tau;
    const landed = h <= 0, x = Math.cos(dir) * d, z = Math.sin(dir) * d;
    const vy = up - 14 * tau;
    P.dot(x, z, Math.max(0, h), landed ? '.' : vy > 0.6 ? '\'' : vy > -0.6 ? 'o' : ',',
      tone(landed ? 0.4 : 0.86 - 0.3 * q), env * (landed ? 0.45 * (1 - q) : 0.95 - 0.4 * q));
  }
}

// A compact spinning whirlpool with a bow wave and a corkscrew wake.
function projectile(P, effect) {
  const S = Math.max(0.4, Math.min(1.2, effect.radius)) / 0.65, age = effect.age;
  const env = smooth((1 - effect.progress) / 0.25) * (0.55 + 0.45 * smooth(age / 0.08));
  if (env <= 0) return;
  const rot = -age * 16;
  for (let arm = 0; arm < 3; arm++) {
    for (let i = 0; i < 7; i++) {
      const t = (i + 0.5) / 7, r = S * (0.1 + 0.36 * t), a = rot + arm * TAU / 3 + 2.6 * (1 - t);
      const dx = Math.cos(a) * 0.36 + Math.sin(a) * r * 2.6, dz = Math.sin(a) * 0.36 - Math.cos(a) * r * 2.6;
      P.dot(Math.cos(a) * r, Math.sin(a) * r, 0, P.flow(dx, dz), tone(0.45 + 0.5 * (1 - t)), env * (0.6 + 0.4 * (1 - t)));
    }
  }
  for (let j = 0; j < 12; j++) {
    const a = j * TAU / 12 + rot * 0.6, crest = 0.5 + 0.5 * Math.sin(a * 3 - age * 9);
    P.dot(Math.cos(a) * 0.5 * S, Math.sin(a) * 0.5 * S, 0, crest > 0.55 ? '~' : '-', tone(0.45 + 0.4 * crest), env * (0.45 + 0.5 * crest));
  }
  for (let j = 0; j < 4; j++) {
    const a = -rot * 1.5 + j * TAU / 4;
    P.dot(Math.cos(a) * 0.07 * S, Math.sin(a) * 0.07 * S, 0, ':', tone(0.15), env);
  }
  P.dot(0, 0, 0, '@', EYE, env);
  // Bow wave pushed ahead of the orb.
  for (let j = 0; j < 9; j++) {
    const a = Math.PI / 2 + (j - 4) * 0.24, r = S * (0.64 + 0.03 * Math.sin(age * 22 + j) - Math.abs(j - 4) * 0.025);
    P.dot(Math.cos(a) * r, Math.sin(a) * r, 0, P.flow(-Math.sin(a), Math.cos(a)), tone(0.98 - Math.abs(j - 4) * 0.08),
      env * (1 - Math.abs(j - 4) * 0.09));
  }
  // Two counter-phased strands braid a corkscrew wake.
  for (let strand = 0; strand < 2; strand++) {
    for (let k = 1; k <= 12; k++) {
      const z = -0.48 * S - k * 0.17, ph = age * 20 - k * 0.75 + strand * Math.PI, amp = (0.12 + 0.03 * k) * S;
      const x = amp * Math.sin(ph), dx = -amp * 0.75 * Math.cos(ph) + 0.03 * Math.sin(ph), dz = -0.17;
      const front = Math.cos(ph) > 0;
      P.dot(x, z, 0, P.flow(dx, dz), tone((front ? 0.82 : 0.5) - 0.035 * k), env * (1 - k / 13) ** 1.2 * (front ? 1 : 0.6));
    }
  }
  // Droplets peel off the wake and drift aside as they fall.
  for (let j = 0; j < 10; j++) {
    const f = fract(age * 2.2 + hash(j, 31)), side = j % 2 ? 1 : -1;
    const x = (hash(j, 32) - 0.5) * 0.3 * S + side * f * 0.6 * (0.5 + hash(j, 33)) * S, z = -0.45 * S - f * 1.6 * S;
    P.dot(x, z, 0.25 * Math.sin(Math.PI * f) * S, f < 0.45 ? '\'' : '.', tone(0.75 - 0.3 * f), env * (1 - f) * smooth(f / 0.1) * 0.75);
  }
}

// A water whip coils around the target, then the hit bursts into a crown splash.
function impact(P, effect) {
  const R = Math.max(0.6, Math.min(3, effect.radius)), p = effect.progress, age = effect.age;
  const env = smooth((1 - p) / 0.35);
  const HIT = 0.26, c = clamp01(p / HIT), q = clamp01((p - HIT) / (1 - HIT));
  const rot = -age * 14;
  const coil = env * (p < HIT ? 0.35 + 0.65 * c : 1 - smooth((p - HIT) / 0.1));
  if (coil > 0) {
    const reach = R * (1.5 - 1.15 * inQuad(c));
    for (let arm = 0; arm < 2; arm++) {
      const at = t => {
        const r = reach * (0.22 + 0.78 * t), a = rot + arm * Math.PI + 3.2 * (1 - t), h = 0.4 * (1 - t);
        PT.x = Math.cos(a) * r + h * P.ux; PT.z = Math.sin(a) * r + h * P.uz;
      };
      stroke(P, at, 48, 30, 4, t => t * 3, (x, z, t, vx, vy) =>
        P.dot(x, z, 0, P.flowCells(vx, vy), tone(0.5 + 0.45 * (1 - t)), coil * (0.45 + 0.55 * (1 - t))));
    }
  }
  if (q <= 0) return;
  // Impact flash: a white core with short rays.
  const flash = env * (1 - smooth(q / 0.3));
  P.dot(0, 0, 0.5, q < 0.1 ? '#' : q < 0.22 ? '*' : 'o', q < 0.15 ? RAMP[20] : tone(0.9 - q), env * (1 - smooth(q / 0.45)));
  for (let j = 0; j < 8; j++) {
    const a = j * TAU / 8 + 0.2, base = R * 0.18 * (0.5 + 2 * outCubic(q / 0.3));
    for (let k = 0; k < 2; k++) {
      const r = base + k * R * 0.12;
      P.dot(Math.cos(a) * r, Math.sin(a) * r, 0.5, P.flow(Math.cos(a), Math.sin(a), '-'), RAMP[20 - k * 3], flash * (1 - k * 0.35));
    }
  }
  // Shock ripples on the water.
  for (let ring = 0; ring < 2; ring++) {
    const k = clamp01((q - ring * 0.18) / (1 - ring * 0.18)), count = ring ? 24 : 32;
    if (k <= 0) continue;
    const r = R * (ring ? 0.2 + 1.1 * outCubic(k) : 0.3 + 1.45 * outCubic(k)), b = env * (1 - k) ** 1.3 * (ring ? 0.65 : 1);
    ripple(P, r, count, ring ? 2 : 3, ring * 1.1 + q, (x, z, u, vx, vy, i) =>
      P.dot(x, z, 0, P.flowCells(vx, vy), tone(0.95 - 0.5 * k - 0.15 * ring - (i % 3 === 2) * 0.12), b));
  }
  // Crown droplets with drag and gravity; landed ones leave a dimming fleck.
  const tau = q * 0.75;
  for (let j = 0; j < 28; j++) {
    const dir = hash(j, 41) * TAU, v = R * (1.4 + 1.8 * hash(j, 42)), up = 2.4 + 2.6 * hash(j, 43);
    const d = R * 0.2 + v * (1 - Math.exp(-2.5 * tau)) / 2.5, h = 0.5 + up * tau - 7 * tau * tau, vy = up - 14 * tau;
    const landed = h <= 0, big = hash(j, 44) > 0.75;
    P.dot(Math.cos(dir) * d, Math.sin(dir) * d, Math.max(0, h),
      landed ? '.' : vy > 0.8 ? (big ? 'o' : '\'') : vy > -0.8 ? (big ? 'o' : '*') : ',',
      tone(landed ? 0.35 : 0.9 - 0.35 * q), env * (landed ? 0.5 * (1 - q) : 1 - 0.3 * q));
  }
}

// A single splash: an expanding ripple, a small plume, and droplets.
function splash(P, effect) {
  const R = Math.max(0.4, effect.radius), p = effect.progress;
  const env = 1 - smooth(p), e = outCubic(p);
  ripple(P, R * (0.15 + 0.85 * e), 16, 2, 0.4, (x, z, u, vx, vy) =>
    P.dot(x, z, 0, P.flowCells(vx, vy), tone(0.92 - 0.45 * p), env * 0.9));
  for (let j = 0; j < 12; j++) {
    const a = hash(j, 52) * TAU, r = R * (0.1 + 0.75 * e) * (0.55 + 0.5 * hash(j, 53));
    const h = R * 0.6 * (0.5 + 0.5 * hash(j, 54)) * 4 * p * (1 - p);
    P.dot(Math.cos(a) * r, Math.sin(a) * r, h, p < 0.5 ? '\'' : '.', tone(0.85), env * smooth(p / 0.15));
  }
  const plume = Math.sin(Math.PI * Math.min(1, p * 1.4));
  for (let k = 0; k < 3; k++) {
    P.dot(0, 0, R * 0.35 * plume * k, k === 0 ? (p < 0.25 ? '*' : 'o') : k === 1 ? '|' : '\'',
      p < 0.2 && k === 0 ? RAMP[20] : tone(0.9 - k * 0.1), env * (1 - k * 0.2));
  }
}

// A wall of water heaves up along the boundary, marking the coming vortex.
function surge(P, effect) {
  const R = Math.min(9, effect.radius), p = effect.progress, age = effect.age;
  const env = smooth(p / 0.12) * (1 - smooth((p - 0.35) / 0.65)), heave = Math.sin(Math.PI * p);
  for (let j = 0; j < 22; j++) {
    const a = j * TAU / 22 + hash(j, 61) * 0.1 - age * 0.6, r = R * (0.92 + 0.08 * outCubic(p));
    const x = Math.cos(a) * r, z = Math.sin(a) * r, h = heave * 0.55 * (0.6 + 0.4 * hash(j, 62));
    // Step one column along the tangent on screen so each crest reads as a short wave.
    const tx = -Math.sin(a), tz = Math.cos(a), cells = Math.hypot(tx * 13 / 0.6, tz * 6.5) || 1;
    for (let k = -1; k <= 1; k++) {
      const s = k * 1.15 / cells, peak = k === 0;
      P.dot(x + tx * s, z + tz * s, h * (peak ? 1 : 0.7), peak && heave > 0.55 ? '^' : '~',
        tone(peak ? 0.95 : 0.7), env * (peak ? 1 : 0.7));
    }
    P.dot(x, z, 0, '.', tone(0.25), env * 0.6);
  }
}

// Not used by the rune itself: a slow current that circles its target.
function aura(P, effect) {
  const R = Math.max(0.5, Math.min(2.5, effect.radius)), p = effect.progress, age = effect.age;
  const env = smooth(age / 0.2) * smooth((1 - p) / 0.3);
  for (let strand = 0; strand < 2; strand++) {
    for (let j = 0; j < 16; j++) {
      const a = j * TAU / 16 + (strand ? 1 : -1) * age * 2.2, r = R * (0.9 + (strand ? 0.12 : -0.04) + 0.06 * Math.sin(a * 3 + age * 4));
      const b = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(a * 2 - age * 5 + strand * 2));
      P.dot(Math.cos(a) * r, Math.sin(a) * r, 0.15 * strand, P.flow(-Math.sin(a), Math.cos(a)), tone(strand ? 0.85 : 0.5), env * b);
    }
  }
  for (let j = 0; j < 8; j++) {
    const f = fract(age * 0.9 + hash(j, 71)), a = hash(j, 72) * TAU, r = R * (0.8 + 0.3 * f);
    P.dot(Math.cos(a) * r, Math.sin(a) * r, 0.6 * Math.sin(Math.PI * f), f < 0.5 ? '\'' : '.', tone(0.85), env * (1 - f));
  }
}

export default {
  id: 'maelstrom',
  duration: 1.15,
  draw(effect, plot) {
    const P = pen(effect, plot);
    switch (effect.stage) {
      case 'cast': return cast(P, effect);
      case 'projectile': return projectile(P, effect);
      case 'impact': return impact(P, effect);
      case 'pulse': return effect.radius > 2.5 ? surge(P, effect) : splash(P, effect);
      case 'aura': return aura(P, effect);
      default: return whirlpool(P, effect);
    }
  },
  sounds: {
    // Displaced water rolls back into the throat, with real bubbles following
    // behind the wash to give the whirlpool a churning, circular cadence.
    cast: [
      { kind: 'recording', url: '/assets/audio/spells/mitlan/water-lift.wav', gain: 0.36, rate: 0.86, delay: 0 },
      { kind: 'recording', url: '/assets/audio/spells/mitlan/wash.wav', gain: 0.46, rate: 0.8, delay: 0.18 },
      { kind: 'recording', url: '/assets/audio/spells/mitlan/bubbles.wav', gain: 0.24, rate: 0.88, delay: 0.58 },
    ],
    // A close splash collapses into returning water and trapped air.
    impact: [
      { kind: 'recording', url: '/assets/audio/spells/mitlan/water-strike.wav', gain: 0.48, rate: 0.8, delay: 0 },
      { kind: 'recording', url: '/assets/audio/spells/mitlan/wash.wav', gain: 0.36, rate: 0.9, delay: 0.13 },
      { kind: 'recording', url: '/assets/audio/spells/mitlan/bubbles.wav', gain: 0.22, rate: 0.78, delay: 0.36 },
    ],
    // Gentle recurring churn leaves headroom for overlapping zone pulses.
    pulse: [
      { kind: 'recording', url: '/assets/audio/spells/mitlan/bubbles.wav', gain: 0.12, rate: 1.12, delay: 0 },
      { kind: 'recording', url: '/assets/audio/spells/mitlan/wash.wav', gain: 0.1, rate: 1.16, delay: 0.08 },
    ],
  },
};
