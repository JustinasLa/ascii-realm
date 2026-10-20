// Shielding Orb is a cerrith ward built from one motif: a gyroscopic lattice
// orb. It gathers and blooms at the caster's hand, flies as a spinning caged
// globe with two satellite cores, and seals around the ally as a pearl bubble.
const white = [246, 255, 236], pearl = [233, 255, 212], mint = [132, 227, 151];
const gold = [209, 229, 127], leaf = [76, 182, 108], moss = [46, 124, 80];
const tau = Math.PI * 2;
// A metre spans 26 columns but only 6.5 rows (cells are ~1.67:1), so a shape
// that should look round on screen stretches its local z radius by ~2.4.
const ROUND = 2.4;
// Lattices are seen from slightly above, so horizontal rings read as ellipses.
const VIEW_COS = Math.cos(0.42), VIEW_SIN = Math.sin(0.42);

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const finite = (v, fallback) => (Number.isFinite(v) ? v : fallback);
const hash = i => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const easeOut = t => 1 - (1 - t) ** 3;
const easeIn = t => t * t * t;
const easeOutBack = t => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;
const span = (p, a, b) => clamp01((p - a) / (b - a));
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

// White-hot core through pearl and mint to cool moss, indexed 0 (hot) to 1.
const RAMP = (() => {
  const stops = [white, pearl, mint, leaf, moss], out = [];
  for (let i = 0; i < 13; i++) {
    const t = i / 12 * (stops.length - 1), k = Math.min(stops.length - 2, Math.floor(t)), f = t - k;
    out.push(stops[k].map((c, j) => Math.round(c + (stops[k + 1][j] - c) * f)));
  }
  return out;
})();
const tone = t => RAMP[Math.round(clamp01(t) * (RAMP.length - 1))];

// Line glyph for a local tangent as it appears on screen (columns are narrow).
function stroke(dx, dz) {
  let t = Math.atan2(dz * 52, dx * 125);
  if (t < 0) t += Math.PI;
  if (t < 0.39 || t > 2.75) return '-';
  if (t < 1.18) return '\\';
  if (t < 1.96) return '|';
  return '/';
}

// Unit circle tilted about x, spun about the vertical and seen from above.
// Writes screen offsets (z already in round units) and depth toward the eye.
const pt = { x: 0, z: 0, d: 0 };
function ringPoint(a, tilt, spin, height = 0, scale = 1) {
  const X = Math.cos(a) * scale, s = Math.sin(a) * scale;
  const Y1 = height * Math.cos(tilt) - s * Math.sin(tilt), Z1 = height * Math.sin(tilt) + s * Math.cos(tilt);
  const cs = Math.cos(spin), ss = Math.sin(spin);
  const X2 = X * cs + Z1 * ss, Z2 = Z1 * cs - X * ss;
  pt.x = X2; pt.z = Z2 * VIEW_SIN - Y1 * VIEW_COS; pt.d = Y1 * VIEW_SIN + Z2 * VIEW_COS;
}

// Effects other than the projectile arrive rotated to the caster's heading;
// counter-rotate so "up" stays up the screen and stroke glyphs stay aligned.
function upright(plot, heading) {
  const c = Math.cos(heading), s = Math.sin(heading);
  return (x, z, char, color, light) => plot(x * c - z * s, x * s + z * c, char, color, light);
}

// One lattice ring: draw-on reveal, depth shading, and dissolve into motes.
function latticeRing(P, cx, cz, R, tilt, spin, n, reveal, light, color, seed, dissolve = 0, height = 0, scale = 1) {
  const count = Math.ceil(n * clamp01(reveal));
  for (let i = 0; i < count; i++) {
    const a = i / n * tau;
    ringPoint(a + 0.06, tilt, spin, height, scale);
    const nx = pt.x, nz = pt.z;
    ringPoint(a, tilt, spin, height, scale);
    const front = pt.d > -0.04, x = cx + R * pt.x, z = cz + ROUND * R * pt.z;
    const head = reveal < 1 && i >= count - 2;
    if (hash(seed + i) < dissolve) {
      // Broken links drift upward as fading motes instead of popping out.
      const lift = dissolve * (0.35 + hash(seed + i + 50) * 0.8);
      P(x + Math.sin(seed + i + dissolve * 5) * 0.08, z - lift * ROUND * 0.5, hash(seed + i + 9) < 0.5 ? '.' : '\'',
        tone(0.15 + dissolve * 0.6), light * 0.55 * (1 - Math.min(1, dissolve)));
      continue;
    }
    if (head) { P(x, z, '*', white, light); continue; }
    if (front) P(x, z, stroke(R * (nx - pt.x), ROUND * R * (nz - pt.z)), color, light * (0.8 + 0.2 * pt.d));
    else if (i % 2 === 0) P(x, z, '.', leaf, light * 0.45);
  }
}

// Screen-round silhouette; sides use parentheses so the outline reads as a ball.
function rim(P, cx, cz, R, n, light, glintAt, flash, wobble, age, seed, thin = 0) {
  for (let i = 0; i < n; i++) {
    if (thin > 0 && hash(seed + i) < thin) continue;
    const a = i / n * tau, c = Math.cos(a), s = Math.sin(a);
    const r = R * (1 + wobble * Math.sin(a * 3 - age * 9));
    const glint = Math.exp(-(wrap(a - glintAt) ** 2) * 9);
    const char = glint > 0.6 ? '*' : Math.abs(c) > 0.84 ? (c < 0 ? '(' : ')') : stroke(-s, -ROUND * c);
    const color = flash > 0.35 ? white : glint > 0.35 ? pearl : s > 0 ? mint : leaf;
    P(cx + r * c, cz - ROUND * r * s, char, color, light * Math.min(1, 0.84 + 0.1 * s + 0.3 * glint + 0.3 * flash));
  }
}

// Gathering, flash bloom, gyroscope reveal and dissolve at the casting hand.
function cast(P, p, age, radius) {
  const s = Math.min(1.5, Math.max(0.6, radius / 0.8)), cz = -1.45;
  const out = clamp01((1 - p) * 6);
  if (p < 0.2) {
    const t = p / 0.2;
    for (let k = 0; k < 18; k++) {
      // Motes spiral into the palm along deterministic paths.
      for (let j = 0; j < 2; j++) {
        const tt = Math.max(0, t - j * 0.08), a = hash(k) * tau + tt * 2.6;
        const r = (0.9 + hash(k + 3) * 0.7) * s * (1 - tt) ** 1.6;
        P(Math.cos(a) * r, cz + Math.sin(a) * r * 1.3, j ? '.' : r < 0.35 ? '*' : ':',
          k % 2 ? gold : mint, (0.3 + 0.7 * tt) * (j ? 0.4 : 0.85));
      }
    }
  }
  const core = p < 0.2 ? easeIn(p / 0.2) : 1 - easeOut(span(p, 0.2, 0.46));
  if (core > 0.02) {
    P(0, cz, core > 0.75 ? '@' : core > 0.45 ? 'O' : core > 0.2 ? 'o' : '.', core > 0.6 ? white : pearl, core);
    if (core > 0.45) { P(-0.07, cz, '(', gold, core * 0.8); P(0.07, cz, ')', gold, core * 0.8); }
  }
  const bloom = span(p, 0.17, 0.45);
  if (bloom > 0 && bloom < 1) {
    // A thin shock shell marks the moment the lattice snaps open.
    const R = s * (0.12 + 0.85 * easeOut(bloom));
    rim(P, 0, cz, R, Math.max(12, Math.round(70 * R)), (1 - bloom) ** 1.5, -1, bloom < 0.25 ? 1 : 0, 0, age, 400);
  }
  const reveal = easeOut(span(p, 0.15, 0.4));
  if (reveal > 0) {
    const dissolve = easeIn(span(p, 0.55, 1)) * 1.05;
    const R = s * (0.25 + 0.38 * easeOut(span(p, 0.15, 0.55)) + 0.17 * span(p, 0.55, 1));
    const snap = Math.exp(-(((p - 0.42) / 0.07) ** 2));
    const light = out * Math.min(1, 0.75 + snap * 0.5);
    const meridian = snap > 0.5 ? white : mint;
    latticeRing(P, 0, cz, R, 0.12, age * 1.2, 40, reveal, light, snap > 0.5 ? white : gold, 10, dissolve);
    latticeRing(P, 0, cz, R, Math.PI / 2, age * 2.6, 40, reveal, light, meridian, 60, dissolve);
    latticeRing(P, 0, cz, R, Math.PI / 2, age * 2.6 + Math.PI / 2, 40, reveal, light, meridian, 110, dissolve);
  }
  // A ground sigil anchors the cast at the caster's feet.
  const g = easeOut(span(p, 0.1, 0.45)), gfade = 1 - span(p, 0.55, 1);
  if (g > 0) {
    // Sampled in step with its growth so the ring stays a continuous line.
    const q = Math.max(3, Math.round(11 * g)), n = q * 4;
    for (let i = 0; i < n; i++) {
      const a = i / n * tau + age * 0.6, c = Math.cos(a), sn = Math.sin(a), r = s * 0.95 * g;
      P(c * r, 1.1 + sn * r, i % q === 0 ? '+' : stroke(-sn, c), i % q === 0 ? gold : leaf,
        out * gfade * (sn > 0 ? 0.6 : 0.35));
    }
  }
}

// Spinning caged globe with two satellite cores and a double-helix wake.
function projectile(P, p, age, radius, heading) {
  const R = 0.3 * Math.min(1.6, Math.max(0.6, radius / 0.65)), light = clamp01((1 - p) * 8);
  const fx = Math.sin(heading), fz = Math.cos(heading), rx = Math.cos(heading), rz = -Math.sin(heading);
  // Wake first so the globe and cores draw over it.
  for (let strand = 0; strand < 2; strand++) {
    for (let i = 0; i < 12; i++) {
      const phase = age * 16 - i * 0.75 + strand * Math.PI, w = R * 0.6 * (1 - i / 16);
      const d = R * 1.15 + i * 0.075, depth = Math.cos(phase);
      const x = -fx * d + rx * Math.sin(phase) * w, z = -fz * d + rz * Math.sin(phase) * w - depth * w * ROUND * 0.4;
      P(x, z, i < 2 ? '*' : depth > 0 ? ':' : '.', strand ? gold : mint,
        light * (1 - i / 12) ** 1.2 * (depth > 0 ? 0.85 : 0.45));
    }
  }
  for (let k = 0; k < 8; k++) {
    // Shed motes loop on staggered cycles; brightness is zero at each wrap.
    const tau01 = (age * 2.6 + hash(k + 20)) % 1, d = R * 1.2 + tau01 * 0.9, side = (hash(k + 30) - 0.5) * 0.7 * tau01;
    P(-fx * d + rx * side, -fz * d + rz * side - tau01 * 0.5, tau01 < 0.45 ? '\'' : '.', k % 2 ? pearl : gold,
      light * 0.6 * Math.sin(Math.PI * tau01));
  }
  rim(P, 0, 0, R, 34, light * 0.9, age * 5, 0, 0.02, age, 200);
  latticeRing(P, 0, 0, R, 0.1, age * 3, 12, 1, light * 0.8, gold, 230);
  latticeRing(P, 0, 0, R, Math.PI / 2, age * 9, 12, 1, light * 0.8, mint, 250);
  latticeRing(P, 0, 0, R, Math.PI / 2, age * 9 + Math.PI / 2, 12, 1, light * 0.8, mint, 270);
  P(0, 0, '@', white, light);
  for (let k = 0; k < 2; k++) {
    // Twin satellites orbit on a tilted plane, dimming as they pass behind.
    for (let j = 2; j >= 0; j--) {
      ringPoint(k * Math.PI - j * 0.32, 0.55, age * 7);
      const x = R * 1.5 * pt.x, z = ROUND * R * 1.5 * pt.z, front = pt.d > 0;
      P(x, z, j ? '.' : 'o', j ? gold : front ? pearl : gold, light * (j ? 0.45 / j : front ? 1 : 0.55));
    }
  }
}

// Hexagonal ward ripple on the ground. Projectile ticks leave small, lean
// ripples under the orb; the landing pulse draws a wide seal of corner brackets.
function pulse(P, p, age, radius) {
  const r = Math.min(3.2, Math.max(0.5, radius)), light = (1 - p) ** 1.4;
  if (r < 2) {
    // Tick ripple: a small hex that widens and cools from pearl to moss.
    const rr = r * 0.55 * (0.35 + 0.65 * easeOut(p)), turn = age * 1.5;
    for (let e = 0; e < 6; e++) {
      const a0 = turn + e * tau / 6, a1 = a0 + tau / 6;
      const x0 = Math.cos(a0) * rr, z0 = Math.sin(a0) * rr, dx = Math.cos(a1) * rr - x0, dz = Math.sin(a1) * rr - z0;
      const char = stroke(dx, dz);
      for (let i = 0; i < 3; i++) {
        P(x0 + dx * i / 3, z0 + dz * i / 3, i ? char : '+', i ? tone(0.3 + p * 0.65) : pearl, light * (i ? 0.55 : 0.75));
      }
    }
    return;
  }
  const grow = 0.2 + 0.8 * easeOut(p), rr = r * grow, turn = age * 0.8;
  const arm = 0.12, per = 6;
  for (let e = 0; e < 6; e++) {
    const a = turn + e * tau / 6, x0 = Math.cos(a) * rr, z0 = Math.sin(a) * rr;
    P(x0, z0, '+', p < 0.2 ? white : pearl, light);
    for (const side of [-1, 1]) {
      // Each corner bracket runs a short way along both neighbouring edges.
      const b = a + side * tau / 6, dx = Math.cos(b) * rr - x0, dz = Math.sin(b) * rr - z0, char = stroke(dx, dz);
      for (let i = 1; i <= per; i++) {
        const f = i / per * arm;
        P(x0 + dx * f, z0 + dz * f, char, tone(0.1 + i / per * 0.35 + p * 0.45), light * (0.95 - i / per * 0.45));
      }
    }
  }
  for (let k = 0; k < 12; k++) {
    // Radial glints race just ahead of the seal and slow under drag.
    const a = k / 12 * tau + hash(k) * 0.4, d = r * (0.2 + 0.95 * easeOut(Math.min(1, p * 1.25))) * (1.04 + 0.14 * hash(k + 5));
    P(Math.cos(a) * d, Math.sin(a) * d, p < 0.4 ? stroke(Math.cos(a), Math.sin(a)) : '.', k % 2 ? gold : mint, light * 0.65);
  }
}

// Pearl bubble that seals around the ally: bloom, shimmer, orbiting cores.
function bubble(P, age, p, radius, light, { burst = false } = {}) {
  const R = Math.min(1.5, Math.max(0.6, radius)), cz = -1.0;
  const grow = easeOutBack(clamp01(age / (burst ? 0.3 : 0.22))), r = R * (0.3 + 0.7 * grow);
  const flash = clamp01(1 - age / 0.16), wobble = 0.05 * clamp01(1 - age / 0.5) + 0.012;
  const dissolve = clamp01(1 - light * 1.25);
  // The rim is sampled densely enough (~0.75 glyph per cell) to read as one outline.
  rim(P, 0, cz, r, Math.max(24, Math.round(Math.min(96, 96 * r))), light, age * 2.6 + 1.2, flash, wobble, age, 500, dissolve * 0.85);
  const meshLight = light * (0.5 + 0.5 * flash);
  for (let m = 0; m < 2; m++) {
    // Two front meridians sweep across the shell; faint so the ally stays visible.
    for (let i = 0; i < 20; i++) {
      if (hash(600 + m * 20 + i) < dissolve) continue;
      ringPoint(i / 20 * tau, Math.PI / 2, age * 0.9 + m * Math.PI / 2 + 0.4);
      if (pt.d < 0.15) continue;
      const x = r * pt.x, z = cz + ROUND * r * pt.z;
      ringPoint(i / 20 * tau + 0.06, Math.PI / 2, age * 0.9 + m * Math.PI / 2 + 0.4);
      P(x, z, stroke(r * pt.x - x, cz + ROUND * r * pt.z - z), m ? pearl : mint, Math.min(1, meshLight * (1.25 - pt.d)));
    }
  }
  for (let i = 0; i < 22; i++) {
    // Equatorial band seen from above: a front arc of dashes.
    if (hash(700 + i) < dissolve) continue;
    ringPoint(i / 22 * tau + age * 0.5, 0, 0, -0.1, 0.995);
    if (pt.d < 0.15) continue;
    P(r * pt.x, cz + ROUND * r * pt.z, i % 4 ? '-' : '+', i % 4 ? mint : gold, Math.min(1, meshLight * (1.25 - pt.d)));
  }
  // Ground ring where the bubble rests.
  const gz = cz + ROUND * r * 0.86;
  for (let i = 0; i < 22; i++) {
    const a = i / 22 * tau - age * 0.7, c = Math.cos(a), s = Math.sin(a);
    if (hash(800 + i) < dissolve) continue;
    P(c * r * 1.1, gz + s * r * 0.45, i % 6 === 0 ? '+' : stroke(-s, c * 0.45), i % 6 === 0 ? gold : leaf,
      light * (s > 0 ? 0.75 : 0.4));
  }
  for (let k = 0; k < 2; k++) {
    // Twin cores keep circling the ward on a tilted orbit.
    for (let j = 2; j >= 0; j--) {
      ringPoint(k * Math.PI - j * 0.16, 0.4, age * 3.4);
      const front = pt.d > 0;
      P(r * 1.08 * pt.x, cz + ROUND * r * 1.08 * pt.z, j ? (j === 1 ? ':' : '.') : front ? 'O' : 'o',
        j ? gold : front ? pearl : gold, light * (j ? 0.55 / j : front ? 1 : 0.5));
    }
  }
  for (let k = 0; k < 8; k++) {
    // Pollen motes rise inside the shell on staggered loops.
    const t = (age * 0.8 + hash(k + 40)) % 1, x = (hash(k + 41) * 2 - 1) * r * 0.7 + Math.sin(age * 3 + k) * 0.05;
    P(x, gz - t * ROUND * r * 1.4, t < 0.35 ? '.' : t < 0.7 ? '+' : '\'', k % 3 ? gold : pearl,
      light * 0.75 * Math.sin(Math.PI * t));
  }
  if (burst) {
    const shock = span(age, 0, 0.38);
    if (shock < 1) {
      for (let i = 0; i < 30; i++) {
        const a = i / 30 * tau, rr = r * (0.5 + 1.4 * easeOut(shock));
        P(Math.cos(a) * rr * 1.1, gz + Math.sin(a) * rr * 0.45, stroke(-Math.sin(a), Math.cos(a) * 0.45),
          shock < 0.3 ? white : pearl, light * (1 - shock) ** 1.5);
      }
    }
    for (let k = 0; k < 14; k++) {
      // Petals are flung from the seal and fall under drag and gravity.
      const a = k / 14 * tau + hash(k + 60), v = 1.3 + hash(k + 61) * 1.1, t = Math.min(age, 0.7);
      const travel = v * (1 - Math.exp(-3 * t)) / 3;
      const x = Math.cos(a) * (r + travel * 1.4), z = cz + Math.sin(a) * ROUND * (r * 0.9 + travel * 0.6) + 2.2 * t * t;
      P(x, z, k % 3 === 0 ? '*' : k % 3 === 1 ? ',' : '`', k % 2 ? gold : mint,
        light * 0.8 * clamp01(1 - age / 0.75));
    }
  }
}

// Short absorption aura that lands with the ward: a white shell closes in
// from outside and snaps onto the bubble, then four gold clasps glint.
function seal(P, p, radius) {
  const R = Math.min(1.5, Math.max(0.6, radius)), cz = -1.0, close = easeIn(span(p, 0, 0.55));
  const r = R * (1.5 - 0.5 * close), light = (1 - p) ** 1.5;
  rim(P, 0, cz, r, Math.round(Math.min(80, 54 * r)), light * (0.45 + 0.55 * close), -1, close > 0.85 ? 1 : 0, 0, 0, 900,
    0.35 * (1 - close));
  const clasp = span(p, 0.45, 0.6);
  if (clasp > 0) {
    for (let k = 0; k < 4; k++) {
      const a = k / 4 * tau + tau / 8, x = Math.cos(a) * R, z = cz - ROUND * R * Math.sin(a);
      P(x, z, '*', clasp < 1 && p < 0.62 ? white : gold, light);
      P(x - 0.08, z, '-', gold, light * 0.7); P(x + 0.08, z, '-', gold, light * 0.7);
    }
  }
}

function zone(P, p, age, radius) {
  const r = Math.min(4, Math.max(0.8, radius)), light = clamp01(age / 0.35) * clamp01((1 - p) * 4);
  const turn = age * 0.35;
  for (let e = 0; e < 6; e++) {
    const a0 = turn + e * tau / 6, a1 = a0 + tau / 6;
    const x0 = Math.cos(a0) * r, z0 = Math.sin(a0) * r, x1 = Math.cos(a1) * r, z1 = Math.sin(a1) * r;
    const char = stroke(x1 - x0, z1 - z0);
    for (let i = 0; i < 14; i++) {
      const f = i / 14;
      P(x0 + (x1 - x0) * f, z0 + (z1 - z0) * f, i === 0 ? '+' : char, i === 0 ? pearl : mint,
        light * (0.55 + 0.25 * Math.sin(age * 3 + e + f * 3)));
    }
  }
  for (let i = 0; i < 36; i++) {
    const a = i / 36 * tau - age * 0.6, c = Math.cos(a), s = Math.sin(a);
    P(c * r * 0.7, s * r * 0.7, i % 2 ? stroke(-s, c) : '.', leaf, light * 0.45);
  }
  for (let k = 0; k < 2; k++) {
    for (let j = 3; j >= 0; j--) {
      const a = age * 1.6 + k * Math.PI - j * 0.08;
      P(Math.cos(a) * r * 0.85, Math.sin(a) * r * 0.85, j ? '.' : 'O', j ? gold : pearl, light * (j ? 0.5 / j : 1));
    }
  }
  for (let k = 0; k < 20; k++) {
    const t = (age * 0.5 + hash(k + 90)) % 1, a = hash(k + 91) * tau, d = Math.sqrt(hash(k + 92)) * r * 0.85;
    P(Math.cos(a) * d, Math.sin(a) * d - t * 1.6, t < 0.4 ? '.' : '\'', k % 2 ? gold : pearl,
      light * 0.5 * Math.sin(Math.PI * t));
  }
}

export default {
  id: 'shielding-orb',
  duration: 0.9,
  draw(effect, plot) {
    const p = clamp01(finite(effect.progress, 0)), age = Math.max(0, finite(effect.age, 0));
    const radius = finite(effect.radius, 1), heading = finite(effect.heading, 0);
    const life = finite(effect.life, 0.9), P = upright(plot, heading);
    switch (effect.stage) {
      case 'projectile': projectile(P, p, age, radius, heading); return;
      case 'cast': cast(P, p, age, radius); return;
      case 'pulse': pulse(P, p, age, radius); return;
      case 'zone': zone(P, p, age, radius); return;
      case 'impact': bubble(P, age, p, radius, clamp01((1 - p) * 3), { burst: true }); return;
      default:
        // Short absorption auras land together with the full ward: they draw a
        // closing seal around it rather than doubling the lattice.
        if (life < 0.4) seal(P, p, radius);
        else bubble(P, age, p, radius, clamp01((1 - p) * 3.2));
    }
  },
  sounds: {
    cast: [
      { kind: 'tone', type: 'sine', frequency: 660, duration: 0.65, gain: 0.065, attack: 0.004, release: 0.55 },
      { kind: 'tone', type: 'sine', frequency: 671, delay: 0.018, duration: 0.62, gain: 0.058, attack: 0.005, release: 0.52 },
      { kind: 'tone', type: 'triangle', frequency: 165, endFrequency: 170, delay: 0.06, duration: 0.48, gain: 0.035, cutoff: 800, attack: 0.04, release: 0.3 },
    ],
    impact: [
      { kind: 'tone', type: 'sine', frequency: 150, endFrequency: 112, duration: 0.34, gain: 0.085, attack: 0.007, release: 0.27 },
      { kind: 'tone', type: 'triangle', frequency: 300, endFrequency: 265, delay: 0.012, duration: 0.2, gain: 0.045, cutoff: 720, attack: 0.01, release: 0.17 },
      { kind: 'tone', type: 'sine', frequency: 440, delay: 0.07, duration: 0.44, gain: 0.035, attack: 0.018, release: 0.38 },
      { kind: 'tone', type: 'sine', frequency: 446, delay: 0.085, duration: 0.41, gain: 0.032, attack: 0.018, release: 0.35 },
    ],
    pulse: [
      { kind: 'tone', type: 'sine', frequency: 330, endFrequency: 326, duration: 0.08, gain: 0.012, attack: 0.01, release: 0.06 },
    ],
  },
};
