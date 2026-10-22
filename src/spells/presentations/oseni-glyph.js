const TAU = Math.PI * 2;
// A height in metres above the ground shows this many ground metres up the screen
// (5 rows per metre of height against 6.5 rows per metre of depth).
const LIFT = 5 / 6.5;
// Cooling fire: ash red, ember, flame orange, gold, straw, white heat.
const HEAT = [[64, 8, 4], [150, 26, 8], [226, 70, 16], [255, 128, 28],
  [255, 184, 64], [255, 228, 150], [255, 250, 232]];
const SPARK = ['.', ':', '+', '*'];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const smooth = (from, to, value) => {
  const t = clamp((value - from) / (to - from), 0, 1);
  return t * t * (3 - 2 * t);
};
const easeOut = t => 1 - (1 - clamp(t, 0, 1)) ** 3;
const easeIn = t => clamp(t, 0, 1) ** 2;
const hash = n => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

function heat(level) {
  const t = clamp(level, 0, 1) * (HEAT.length - 1);
  const i = Math.min(HEAT.length - 2, Math.floor(t)), f = t - i;
  const a = HEAT[i], b = HEAT[i + 1];
  return [Math.round(a[0] + (b[0] - a[0]) * f), Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f)];
}

// The stroke character for a ground direction as it reads on screen, where a
// metre across is drawn twice as long as a metre of depth.
function slant(dx, dz) {
  const x = Math.abs(dx * 2), z = Math.abs(dz);
  if (z < x * 0.45) return '-';
  if (z > x * 2.2) return '|';
  return (dx > 0) === (dz > 0) ? '\\' : '/';
}

// Ring positions are spaced evenly along the on-screen ellipse rather than by
// angle, so its flat top and bottom are not left sparse. ARC holds the
// normalised perimeter length from the top, clockwise, at 128 even angles.
const ARC = new Float64Array(129);
{
  let total = 0;
  for (let i = 1; i <= 128; i++) {
    const a0 = (i - 1) / 128 * TAU, a1 = i / 128 * TAU;
    total += Math.hypot(2 * (Math.sin(a1) - Math.sin(a0)), Math.cos(a1) - Math.cos(a0));
    ARC[i] = total;
  }
  for (let i = 1; i <= 128; i++) ARC[i] /= total;
}
function ringAngle(u) {
  const target = u - Math.floor(u);
  let lo = 0, hi = 128;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ARC[mid] <= target) lo = mid; else hi = mid;
  }
  const f = (target - ARC[lo]) / Math.max(1e-9, ARC[hi] - ARC[lo]);
  return -Math.PI / 2 + (lo + f) / 128 * TAU;
}

// The armed fire rune in screen-aligned ground metres: a ring, the upward
// alchemical fire triangle and three curling arms around a white-hot core.
// Each part is revealed by a travelling pen and can crumble into embers.
function sigil(put, o) {
  const S = o.size, age = o.age, crumble = o.crumble ?? 0, lift = o.lift ?? 0;
  const glow = (h, extra = 0) => heat(Math.min(1, h + o.flash * 0.6 + extra));
  const mark = (x, z, char, h, light, seed) => {
    if (crumble > 0 && hash(seed) < crumble * 1.15 - 0.15) return;
    const rise = crumble * (0.25 + hash(seed + 0.5)) * S * 0.35 + lift;
    put(x + Math.sin(age * 2 + seed) * crumble * 0.08 * S, z - rise,
      crumble > 0.45 ? (hash(seed + 1.3) < 0.5 ? '.' : ',') : char,
      glow(h * (1 - crumble * 0.5)), light * (1 - crumble * 0.4));
  };

  // Ring: two pens leave the top and meet at the bottom.
  if (o.ring > 0 && o.ringN > 0) {
    const n = o.ringN, half = o.ring * 0.5;
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n, d = Math.min(u, 1 - u);
      if (d > half) continue;
      const a = ringAngle(u), x = Math.cos(a) * S, z = Math.sin(a) * S;
      const pen = half < 0.5 ? 1 - smooth(0, 0.08, half - d) : 0;
      const march = 0.5 + 0.5 * Math.sin(age * 2.4 - u * TAU * 4);
      const rune = i % 7 === 3;
      const char = pen > 0.5 ? '@' : rune ? (march > 0.55 ? '%' : '+') : slant(-Math.sin(a), Math.cos(a));
      mark(x, z, char, 0.48 + march * 0.2 + pen * 0.5 + (rune ? 0.12 : 0),
        o.light * (0.68 + march * 0.22 + pen * 0.3 + (rune ? 0.1 : 0)), i * 1.7);
    }
  }

  // The fire triangle, point up, traced in one continuous stroke.
  if (o.tri > 0 && o.triN > 0) {
    const r = S * 0.78, reach = o.tri * 3;
    for (let edge = 0; edge < 3; edge++) {
      const a0 = -Math.PI / 2 + edge * TAU / 3, a1 = a0 + TAU / 3;
      const x0 = Math.cos(a0) * r, z0 = Math.sin(a0) * r;
      const x1 = Math.cos(a1) * r, z1 = Math.sin(a1) * r;
      const char = slant(x1 - x0, z1 - z0);
      const count = Math.round(o.triN * (edge === 1 ? 1.5 : 1));
      for (let j = 0; j < count; j++) {
        const t = (j + 0.5) / count, at = edge + t;
        if (at > reach) break;
        const pen = reach < 3 ? 1 - smooth(0, 0.18, reach - at) : 0;
        mark(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, pen > 0.6 ? '@' : char,
          0.6 + pen * 0.4, o.light * (0.85 + pen * 0.15), 40 + edge * 13 + j);
      }
    }
  }

  // Three curling arms, hot at the root and cooling to a flickering tip.
  if (o.arms > 0 && o.armN > 0) {
    for (let k = 0; k < 3; k++) {
      const base = o.spin + k * TAU / 3 + 0.5;
      const at = u => {
        const r = S * (0.13 + 0.7 * u), a = base + 1.3 * u * u;
        return [Math.cos(a) * r, Math.sin(a) * r];
      };
      for (let j = 0; j < o.armN; j++) {
        const u = (j + 0.5) / o.armN;
        if (u > o.arms) break;
        const [x, z] = at(u), [nx, nz] = at(u + 0.04);
        const pen = o.arms < 1 ? 1 - smooth(0, 0.12, o.arms - u) : 0;
        const tip = j === o.armN - 1;
        const flick = 0.5 + 0.5 * Math.sin(age * 11 + k * 2.1);
        mark(x, z, pen > 0.6 ? '@' : tip ? (flick > 0.5 ? '*' : '+') : slant(nx - x, nz - z),
          0.95 - u * 0.5 + pen * 0.4, o.light * (0.95 - u * 0.25 + pen * 0.2), 90 + k * 17 + j);
      }
    }
  }

  // Flames lick up from the finished ring and arm tips, flickering in place.
  if (o.flames > 0 && o.ring >= 1) {
    for (let k = 0; k < o.flames; k++) {
      const a = ringAngle((k + 0.25) / o.flames);
      const bx = Math.cos(a) * S, bz = Math.sin(a) * S;
      const flick = 0.55 + 0.25 * Math.sin(age * 9.1 + k * 2.3) + 0.2 * Math.sin(age * 15.7 + k * 4.1);
      const tall = S * (0.07 + 0.06 * hash(k + 7)) * flick * (o.flameScale ?? 1);
      for (let level = 0; level < 3; level++) {
        const t = (level + 1) / 3;
        mark(bx + Math.sin(age * 6 + k + level) * 0.02 * S * level, bz - tall * t * 2,
          level === 0 ? '^' : level === 1 ? '\'' : '.',
          0.75 - level * 0.25, o.light * flick * (0.85 - level * 0.25), 200 + k * 5 + level);
      }
    }
  }

  // White-hot heart.
  if (o.core > 0) {
    const flick = 0.85 + 0.15 * Math.sin(age * 13);
    mark(0, 0, '@', 1, o.core * flick, 300);
    mark(-0.07 * S, 0, '#', 0.85, o.core * 0.8 * flick, 301);
    mark(0.07 * S, 0, '#', 0.85, o.core * 0.8 * flick, 302);
    mark(0, -0.1 * S, '*', 0.75, o.core * 0.6, 303);
    mark(0, 0.1 * S, '*', 0.7, o.core * 0.55, 304);
  }
}

function drawCast(put, e) {
  const p = e.progress, age = e.age;
  const S = 0.55 + clamp(e.radius, 0.3, 4) * 0.9;
  const fade = 1 - smooth(0.86, 1, p);

  // Anticipation: embers spiral in from beyond the rune and are swallowed by its heart.
  if (p < 0.45) {
    for (let i = 0; i < 34; i++) {
      const g = easeIn(p / (0.26 + 0.14 * hash(i)));
      if (g >= 1) continue;
      const a0 = hash(i + 0.31) * TAU, r0 = S * (1.35 + 0.7 * hash(i + 0.77));
      const at = q => [Math.cos(a0 + 2.4 * q) * r0 * (1 - q), Math.sin(a0 + 2.4 * q) * r0 * (1 - q)];
      const [x, z] = at(g), light = Math.sin(Math.PI * Math.min(1, g * 0.9 + 0.1)) * 0.9;
      put(x, z, SPARK[Math.min(3, Math.floor(g * 4))], heat(0.35 + g * 0.55), light);
      if (g > 0.15) {
        const [tx, tz] = at(g - 0.08);
        put(tx, tz, slant(x - tx, z - tz), heat(0.25 + g * 0.4), light * 0.45);
      }
    }
  }

  // Inscription, seal flash and burn-out.
  const flash = smooth(0.64, 0.7, p) * (1 - smooth(0.7, 0.86, p));
  const crumble = smooth(0.8, 1, p);
  sigil(put, {
    size: S * (0.88 + 0.12 * easeOut((p - 0.15) / 0.5)) * (1 + flash * 0.06), age,
    ring: easeOut((p - 0.16) / 0.3), ringN: 40,
    tri: smooth(0.3, 0.6, p), triN: 8,
    arms: easeOut((p - 0.38) / 0.26), armN: 9, spin: age * 0.9,
    flames: p > 0.5 ? 6 : 0, flameScale: 1.4,
    core: smooth(0.05, 0.4, p) * 0.9 * fade + flash * 0.3,
    flash, crumble, lift: crumble * S * 0.15,
    light: fade * (0.85 + flash * 0.3),
  });

  // Seal: a shock ring rolls out and sparks leap up as the glyph locks.
  if (p > 0.64) {
    const q = (p - 0.64) / 0.36, ring = S * (1 + 0.85 * easeOut(q));
    for (let i = 0; i < 30; i++) {
      const a = ringAngle((i + 0.5) / 30);
      put(Math.cos(a) * ring, Math.sin(a) * ring,
        q < 0.25 ? '*' : q < 0.6 ? slant(-Math.sin(a), Math.cos(a)) : '.',
        heat(0.95 - q * 0.75), (1 - q) ** 1.6 * 0.9);
    }
    const t = q * e.life * 0.36;
    for (let i = 0; i < 22; i++) {
      const a = hash(i + 4.4) * TAU, out = S * (0.25 + 0.5 * hash(i + 5.5));
      const speed = S * (0.8 + 1.2 * hash(i + 6.6)), up = S * (1.8 + 1.6 * hash(i + 7.7));
      const d = out + speed * (1 - Math.exp(-3 * t)) / 3;
      const h = Math.max(0, up * t - 2.4 * S * t * t);
      put(Math.cos(a) * d, Math.sin(a) * d - h * LIFT, q < 0.35 ? '*' : q < 0.7 ? '\'' : '.',
        heat(1 - q * 0.8), (1 - q) ** 1.2 * 0.95);
    }
  }
}

function drawProjectile(put, e, back) {
  const age = e.age, p = e.progress;
  const grow = easeOut(age / 0.18), fade = 1 - smooth(0.9, 1, p);
  const S = clamp(e.radius, 0.2, 2) * 0.62 * (0.55 + 0.45 * grow);
  const throb = 0.9 + 0.1 * Math.sin(age * 10);

  // Ember wake: sparks are shed continuously, drift up, cool and wink out.
  for (let i = 0; i < 18; i++) {
    const f = (age * 2.6 + i / 18) % 1;
    const dist = S * 0.5 + f * S * 3.2;
    const sway = Math.sin(age * 5 + i * 1.9) * S * 0.3 * f + (hash(i) - 0.5) * S * 0.5 * f;
    const h = f * f * S * 1.2;
    put(back[0] * dist - back[1] * sway, back[1] * dist + back[0] * sway - h * LIFT,
      SPARK[Math.min(3, Math.floor((1 - f) * 4))], heat(0.9 - f * 0.8), fade * (1 - f) ** 1.4 * 0.95);
  }
  // A short smoky streak directly behind the rune.
  for (let i = 0; i < 4; i++) {
    const d = S * (1.1 + i * 0.32);
    put(back[0] * d, back[1] * d, slant(back[0], back[1]), heat(0.7 - i * 0.15), fade * (0.7 - i * 0.14));
  }
  // Flame tongues stream up off the spinning rune.
  for (let i = 0; i < 6; i++) {
    const f = (age * 3.4 + i / 6) % 1;
    const x = (hash(i + 2) - 0.5) * S * 1.2 + Math.sin(age * 7 + i) * S * 0.15;
    put(x, -S * 0.4 - f * S * 1.3 * LIFT, f < 0.35 ? '^' : f < 0.7 ? '\'' : '.',
      heat(0.8 - f * 0.6), fade * (1 - f) * 0.8);
  }
  sigil(put, {
    size: S, age, ring: 1, ringN: 22, tri: 0, triN: 0, arms: 1, armN: 5, spin: age * 4.5,
    flames: 0, core: fade * throb, flash: 0.15, light: fade * throb,
  });
}

function drawImpact(put, e) {
  const p = e.progress, t = e.age;
  const S = 0.4 + clamp(e.radius, 0.3, 4) * 0.45;
  const fade = 1 - smooth(0.8, 1, p);

  // Flash: a white-hot knot at the point of contact.
  if (p < 0.3) {
    const k = 1 - p / 0.3;
    put(0, 0, '@', heat(1), k);
    const spread = S * (0.12 + 0.1 * (1 - k));
    put(-spread, 0, '#', heat(0.9 + 0.1 * k), k * 0.9);
    put(spread, 0, '#', heat(0.9 + 0.1 * k), k * 0.9);
    put(0, -spread * 1.8, '%', heat(0.85), k * 0.8);
    put(0, spread * 1.8, '%', heat(0.85), k * 0.7);
  }

  // Eight fire rays shoot out and burn back toward their tips.
  const grow = easeOut(p / 0.3), rays = smooth(0, 0.05, p) * (1 - smooth(0.12, 0.55, p));
  if (rays > 0) {
    for (let k = 0; k < 8; k++) {
      const a = k * TAU / 8 + (hash(k) - 0.5) * 0.35, len = S * (0.7 + 0.5 * hash(k + 3));
      for (let j = 0; j < 4; j++) {
        const u = (j + 0.5) / 4, r = S * 0.15 + len * (0.25 * smooth(0.1, 0.5, p) + u * 0.75) * grow;
        put(Math.cos(a) * r, Math.sin(a) * r, j === 3 ? '*' : slant(Math.cos(a), Math.sin(a)),
          heat(1 - u * 0.45 - p), rays * (1 - u * 0.35));
      }
    }
  }

  // The fire triangle brands the ground and smoulders down from white to red.
  const brand = smooth(0, 0.06, p) * fade;
  sigil(put, {
    size: S * 0.72, age: t, ring: 0, ringN: 0, tri: 1, triN: 6,
    arms: 1, armN: 4, spin: 0.4, flames: 0, core: 0,
    flash: Math.max(0, 0.6 - p * 1.5), light: brand * (0.95 - p * 0.35),
    crumble: smooth(0.6, 1, p) * 0.7,
  });

  // A shock ring rolls out under the target.
  const ringR = S * (0.5 + 0.9 * easeOut(p / 0.55)), ringLight = smooth(0, 0.08, p) * (1 - smooth(0, 0.7, p)) ** 1.2;
  if (ringLight > 0) {
    for (let i = 0; i < 34; i++) {
      const a = ringAngle((i + 0.5) / 34);
      put(Math.cos(a) * ringR, Math.sin(a) * ringR, p < 0.25 ? '*' : slant(-Math.sin(a), Math.cos(a)),
        heat(0.95 - p * 1.1), ringLight * 0.9);
    }
  }

  // Sparks: ballistic arcs with drag, streaking along their motion then cooling.
  for (let i = 0; i < 40; i++) {
    const a = hash(i + 0.13) * TAU, speed = S * (1.6 + 2.4 * hash(i + 0.57));
    const up = S * (1.4 + 2.6 * hash(i + 0.91)), g = S * 11;
    const d = S * 0.1 * (0.5 + hash(i + 0.35)) + speed * (1 - Math.exp(-3.5 * t)) / 3.5;
    const h = up * t - 0.5 * g * t * t;
    const landed = h < 0;
    const x = Math.cos(a) * d, z = Math.sin(a) * d - Math.max(0, h) * LIFT;
    const vx = Math.cos(a) * speed * Math.exp(-3.5 * t);
    const vz = Math.sin(a) * speed * Math.exp(-3.5 * t) - (up - g * t) * LIFT;
    const life = smooth(0, 0.04, t) * (1 - smooth(0.35 + 0.4 * hash(i + 2.2), 1, p));
    const cool = p + hash(i + 3.3) * 0.2;
    put(x, z, landed ? '.' : cool < 0.3 ? slant(vx, vz) : cool < 0.55 ? '*' : '\'',
      heat(1 - cool * 0.95), life * (landed ? 0.45 : 0.95));
    if (i % 2 === 0 && !landed && p < 0.5) {
      const back = 0.04;
      put(x - vx * back, z - vz * back, '.', heat(0.7 - cool * 0.6), life * 0.5);
    }
  }

  // Embers and heat lift off the brand as it dies.
  for (let i = 0; i < 12; i++) {
    const f = smooth(0.25, 1, p - hash(i + 9.1) * 0.15);
    if (f <= 0) continue;
    const a = hash(i + 8.1) * TAU, r = S * 0.4 * hash(i + 8.8);
    put(Math.cos(a) * r + Math.sin(t * 4 + i) * S * 0.08, Math.sin(a) * r - f * S * 1.1 * LIFT,
      f < 0.5 ? '\'' : '.', heat(0.55 - f * 0.4), fade * Math.sin(Math.PI * f) * 0.75);
  }
}

function drawPulse(put, e) {
  const p = e.progress, age = e.age, R = clamp(e.radius, 0.3, 8);
  const light = (1 - p) ** 1.3 * (0.75 + 0.25 * Math.sin(age * 30 + R));
  const r = R * (0.45 + 0.55 * easeOut(p));
  const n = Math.round(clamp(8 + R * 11, 14, 72)), every = R < 2 ? 3 : 5;
  const spin = hash(R * 3.1) * TAU;
  // A thin ring of fire rolls outward, throwing up flame tongues as it goes.
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n, a = ringAngle(u + spin / TAU);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    put(x, z, p < 0.2 ? '*' : slant(-Math.sin(a), Math.cos(a)), heat(0.95 - p * 0.7), light);
    if (i % every === 0) {
      const tall = (0.12 + 0.18 * hash(i + R)) * Math.min(1.5, R * 0.5 + 0.5) * Math.sin(Math.PI * Math.min(1, p * 1.4 + 0.1));
      put(x, z - tall * LIFT, p < 0.5 ? '^' : '\'', heat(0.8 - p * 0.6), light * 0.8);
    }
  }
  // Small pulses flare up as a cluster of tongues from their centre.
  if (R < 2) {
    for (let i = 0; i < 6; i++) {
      const a = i * TAU / 6 + spin, rr = R * 0.18 * (1 + p);
      const h = R * (0.2 + 0.25 * hash(i + 5)) * easeOut(p * 1.6);
      put(Math.cos(a) * rr, Math.sin(a) * rr - h * LIFT, i % 2 ? '^' : '*', heat(1 - p * 0.8), light * 0.9);
    }
  }
}

function drawAura(put, e) {
  const p = e.progress, age = e.age, life = e.life;
  const S = 0.35 + clamp(e.radius, 0.3, 3) * 0.4;
  const fade = (0.3 + 0.7 * easeOut(age / 0.15)) * smooth(0, Math.min(0.35, life * 0.3), life * (1 - p));
  sigil(put, {
    size: S, age, ring: 1, ringN: 26, tri: 1, triN: 5, arms: 0, armN: 0, spin: 0,
    flames: 0, core: 0, flash: 0, light: fade * 0.8,
  });
  // Three flames chase each other around the ward.
  for (let k = 0; k < 3; k++) {
    const a = ringAngle(age * 0.35 + k / 3), bx = Math.cos(a) * S, bz = Math.sin(a) * S;
    const flick = 0.75 + 0.25 * Math.sin(age * 12 + k * 2);
    for (let level = 0; level < 3; level++) {
      put(bx, bz - S * 0.16 * level * flick, level === 0 ? '*' : level === 1 ? '^' : '\'',
        heat(0.95 - level * 0.25), fade * flick * (1 - level * 0.25));
    }
  }
}

function drawZone(put, e) {
  const age = e.age, life = e.life, p = e.progress;
  const S = clamp(e.radius, 0.5, 10) * 0.5;
  const tail = Math.min(1, life * 0.3), fade = smooth(0, tail, life * (1 - p));
  const flash = smooth(0.62, 0.74, age) * (1 - smooth(0.74, 1.5, age));
  const breath = 0.9 + 0.1 * Math.sin(age * 2.6);
  sigil(put, {
    size: S, age, ring: 0.04 + 0.96 * easeOut(age / 0.5), ringN: 50,
    tri: smooth(0.15, 0.62, age), triN: 12,
    arms: easeOut((age - 0.3) / 0.4), armN: 12, spin: age * 0.35,
    flames: 6, flameScale: 1 + flash,
    core: Math.max(smooth(0.2, 0.7, age) * 0.95, 0.8 * (1 - smooth(0, 0.3, age))) * fade, flash,
    crumble: 1 - fade, light: fade * breath * (0.92 + flash * 0.2),
  });
  // Motes of heat drift up from the rune floor.
  for (let i = 0; i < 8; i++) {
    const f = (age * 0.45 + hash(i + 1.5)) % 1;
    const a = hash(i + 2.5) * TAU, r = S * (0.25 + 0.65 * hash(i + 3.5));
    put(Math.cos(a) * r + Math.sin(age * 1.7 + i) * S * 0.04, Math.sin(a) * r - f * S * 0.5 * LIFT,
      f < 0.4 ? '\'' : '.', heat(0.6 - f * 0.4),
      Math.sin(Math.PI * f) * 0.6 * smooth(0.4, 0.9, age) * fade);
  }
}

const STAGES = { cast: drawCast, impact: drawImpact, pulse: drawPulse, aura: drawAura, zone: drawZone };

// A fire rune drawn flat on the ground: inscribed with a travelling pen, sealed
// with a flash, burning while armed and crumbling into embers as it expires.
// Everything is laid out in screen-aligned ground metres and turned back
// against the effect heading, so strokes pick the right slant characters.
function draw(effect, plot) {
  const progress = clamp(finite(effect.progress, 0), 0, 1);
  if (progress >= 1) return;
  const life = Math.max(0.05, finite(effect.life, 1.16));
  const e = {
    stage: effect.stage, progress, life,
    age: Math.max(0, finite(effect.age, progress * life)),
    radius: clamp(finite(effect.radius, 1), 0.1, 40),
  };
  const heading = finite(effect.heading, 0);
  const c = Math.cos(heading), s = Math.sin(heading);
  const put = (x, z, char, color, light) => {
    if (!(light > 0.004)) return;
    plot(x * c - z * s, x * s + z * c, char, color, Math.min(1, light));
  };
  if (effect.stage === 'projectile') {
    drawProjectile(put, e, [-s, -c]);
    return;
  }
  (STAGES[effect.stage] ?? drawZone)(put, e);
}

export default {
  id: 'oseni-glyph',
  duration: 1.16,
  draw,
  sounds: {
    cast: [
      // Live coals stir, fuel snaps, then the traced seal catches at its flash.
      { kind: 'recording', url: '/assets/audio/spells/oseni/ember-bed.wav',
        gain: 0.18, rate: 0.88, delay: 0 },
      { kind: 'recording', url: '/assets/audio/spells/oseni/coal-crack.wav',
        gain: 0.26, rate: 0.85, delay: 0.28 },
      { kind: 'recording', url: '/assets/audio/spells/oseni/ignition.wav',
        gain: 0.48, rate: 0.91, delay: 0.78 },
    ],
    impact: [
      // A sharp coal fracture gives the brand weight before flame and embers settle.
      { kind: 'recording', url: '/assets/audio/spells/oseni/coal-crack.wav',
        gain: 0.47, rate: 0.78, delay: 0 },
      { kind: 'recording', url: '/assets/audio/spells/oseni/ignition.wav',
        gain: 0.36, rate: 1.08, delay: 0.045 },
      { kind: 'recording', url: '/assets/audio/spells/oseni/ember-bed.wav',
        gain: 0.16, rate: 0.96, delay: 0.16 },
    ],
    pulse: [
      // The armed ward breathes with quiet, naturally irregular fire texture.
      { kind: 'recording', url: '/assets/audio/spells/oseni/ember-bed.wav',
        gain: 0.12, rate: 0.82, delay: 0 },
    ],
  },
};
