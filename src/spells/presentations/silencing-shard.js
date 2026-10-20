// Silencing Shard: a fractured seithr crystal that swallows sound. Sound rings
// are drawn inward, a muting slash cracks the shard, and the silenced target is
// locked inside a closing ring and an X seal.
const TAU = Math.PI * 2;
// One metre is 26 columns by 6.5 rows; rows are about twice as tall as columns.
const CELL_X = 26, CELL_Z = 6.5, ROW_ASPECT = 2;

// Hush gradient: white glint -> frost -> seithr ice -> violet hush -> dusk.
const STOPS = [[248, 253, 255], [186, 238, 255], [104, 208, 246], [150, 132, 228], [90, 82, 152]];
const RAMP = Array.from({ length: 17 }, (_, i) => {
  const t = i / 16 * (STOPS.length - 1), k = Math.min(STOPS.length - 2, Math.floor(t)), f = t - k;
  return STOPS[k].map((c, j) => Math.round(c + (STOPS[k + 1][j] - c) * f));
});
const MOTES = ".':+*";

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const span = (p, a, b) => clamp01((p - a) / (b - a));
const smooth = t => t * t * (3 - 2 * t);
const easeOut = t => 1 - (1 - t) ** 3;
const easeIn = t => t * t * t;
const easeBack = t => { const u = t - 1; return 1 + 2.7 * u * u * u + 1.7 * u * u; };
const frac = v => v - Math.floor(v);
const hash = (i, seed = 0) => frac(Math.sin(i * 127.1 + seed * 311.7) * 43758.5453);
const tone = t => RAMP[Math.round(clamp01(t) * 16)];
const mote = v => MOTES[Math.min(4, Math.max(0, Math.floor(clamp01(v) * 5)))];
// The slash leaves two diagonal gaps in every sound ring.
const gapped = angle => Math.abs(Math.sin(angle - Math.PI / 4)) < 0.17;

// A pen draws in local metres but picks slash glyphs from the on-screen slope,
// so edges keep their silhouette whichever way the runtime rotates the effect.
function pen(plot, heading) {
  const c = Math.cos(heading), s = Math.sin(heading);
  const out = {
    thin: 0, n: 0, oz: 0,
    dot(x, z, ch, t, b) {
      const keep = hash(out.n++, 7) >= out.thin;
      if (keep && b > 0.01) plot(x, z + out.oz, ch, tone(t), clamp01(b));
    },
    slope(dx, dz) {
      const px = (dx * c + dz * s) * CELL_X, py = (dz * c - dx * s) * CELL_Z * ROW_ASPECT;
      let a = Math.atan2(py, px);
      if (a < 0) a += Math.PI;
      if (a < Math.PI / 8 || a > Math.PI * 7 / 8) return '-';
      if (a > Math.PI * 3 / 8 && a < Math.PI * 5 / 8) return '|';
      return a < Math.PI / 2 ? '\\' : '/';
    },
    cells(dx, dz) {
      return Math.max(Math.abs(dx * c + dz * s) * CELL_X, Math.abs(dz * c - dx * s) * CELL_Z);
    },
    line(x1, z1, x2, z2, cap, t1, t2, b1, b2, skip = -1) {
      const dx = x2 - x1, dz = z2 - z1, ch = out.slope(dx, dz);
      const count = Math.max(2, Math.min(cap, Math.ceil(out.cells(dx, dz)) + 1));
      for (let i = 0; i < count; i++) {
        const t = i / (count - 1);
        if (Math.abs(t - skip) < 0.07) { out.n++; continue; }
        out.dot(x1 + dx * t, z1 + dz * t, ch, t1 + (t2 - t1) * t, b1 + (b2 - b1) * t);
      }
    },
    ringGlyph(angle) {
      const ch = out.slope(-Math.sin(angle), Math.cos(angle));
      if (ch !== '|') return ch;
      return Math.cos(angle) * c + Math.sin(angle) * s < 0 ? '(' : ')';
    },
    // A gapped sound ring; brightness may follow an orbiting glint.
    ring(r, count, rot, t, b, glintAt = null) {
      for (let i = 0; i < count; i++) {
        const angle = i / count * TAU + rot;
        if (gapped(angle)) { out.n++; continue; }
        const glint = glintAt === null ? 0 : Math.max(0, Math.cos(angle - glintAt)) ** 10;
        out.dot(Math.cos(angle) * r, Math.sin(angle) * r, out.ringGlyph(angle), t - glint * 0.35, b * (1 + glint * 0.6));
      }
    },
    // Sound-wave brackets: arcs on both flanks, brightest at their middle.
    waves(r, half, count, t, b) {
      for (let side = 0; side < 2; side++) {
        for (let i = 0; i < count; i++) {
          const f = i / (count - 1) * 2 - 1, angle = side * Math.PI + f * half;
          out.dot(Math.cos(angle) * r, Math.sin(angle) * r, out.ringGlyph(angle), t + Math.abs(f) * 0.15,
            b * (1 - 0.45 * f * f));
        }
      }
    },
  };
  return out;
}

// An elongated hexagonal crystal pointing along +z, cracked across its waist;
// the lower half is offset along the fracture by `split`.
function shard(ink, size, split, b, warm, age = 0) {
  const P = (x, z, lower) => [x * size + (lower ? split : 0), z * size - (lower ? split * 0.6 : 0)];
  const edge = (a, bb, ta, tb, ba, bb2) => ink.line(...a, ...bb, 9, ta - warm, tb - warm, ba * b, bb2 * b);
  const tip = P(0, 1.15), sl = P(-0.19, 0.3), sr = P(0.19, 0.3);
  const fl = P(-0.18, 0.04), fr = P(0.18, -0.1);
  const fl2 = P(-0.18, 0.04, true), fr2 = P(0.18, -0.1, true);
  const ll = P(-0.14, -0.45, true), lr = P(0.14, -0.45, true), base = P(0, -0.8, true);
  edge(tip, sl, 0.02, 0.22, 1, 0.9);
  edge(tip, sr, 0.02, 0.22, 1, 0.9);
  edge(sl, fl, 0.22, 0.32, 0.9, 0.8);
  edge(sr, fr, 0.22, 0.32, 0.9, 0.8);
  edge(fl, fr, 0.62, 0.62, 0.55, 0.55);
  edge(fl2, fr2, 0.72, 0.72, 0.4, 0.4);
  edge(fl2, ll, 0.36, 0.46, 0.75, 0.7);
  edge(fr2, lr, 0.36, 0.46, 0.75, 0.7);
  edge(ll, base, 0.46, 0.58, 0.7, 0.55);
  edge(lr, base, 0.46, 0.58, 0.7, 0.55);
  // Bright core along the axis, dimmer below the crack.
  ink.line(...P(0, 0.9), ...P(0, 0.14), 7, 0.0 - warm, 0.18 - warm, b, b * 0.75);
  ink.line(...P(0, -0.2, true), ...P(0, -0.62, true), 4, 0.35 - warm, 0.5 - warm, b * 0.6, b * 0.45);
  // Slow inner glints keep the crystal alive without flicker.
  for (let i = 0; i < 4; i++) {
    const z = 0.6 - i * 0.3, x = (hash(i, 3) - 0.5) * 0.16 * (1 - Math.abs(z - 0.2));
    const twinkle = 0.5 + 0.5 * Math.sin(age * 6 + i * 2.3);
    ink.dot(...P(x, z, z < 0), twinkle > 0.6 ? '+' : ':', 0.1 - warm, b * (0.3 + 0.5 * twinkle));
  }
  return tip;
}

function drawProjectile(ink, p, age) {
  const env = Math.min(1, 0.45 + p * 14) * (1 - smooth(span(p, 0.84, 1)));
  // Sound waves on both flanks are forever drawn inward into the shard.
  for (let k = 0; k < 2; k++) {
    const q = frac(age * 2.2 + k * 0.5);
    ink.waves(0.8 - 0.55 * easeIn(q), 0.75, 6, 0.75 - q * 0.45, env * 0.7 * Math.sin(Math.PI * q));
  }
  // A frost wake streams behind, slowed by drag and stirred by turbulence.
  for (let i = 0; i < 22; i++) {
    const q = frac(hash(i) + age * 1.6);
    const z = -0.5 - (1 - (1 - q) ** 2) * 1.8;
    const x = (hash(i, 2) - 0.5) * 0.34 * (0.25 + q) + Math.sin(age * 5 + i * 1.7) * 0.08 * q;
    const b = env * 0.72 * (1 - q) ** 1.5 * Math.min(1, q * 12);
    ink.dot(x, z, mote(1 - q * 1.1), 0.15 + q * 0.8, b);
  }
  const tip = shard(ink, 0.62, 0.04, env, 0, age);
  const twinkle = 0.5 + 0.5 * Math.sin(age * 23);
  ink.dot(tip[0], tip[1] + 0.2, '*', 0, env * (0.45 + 0.55 * twinkle));
}

function drawCast(ink, p, radius) {
  const u = Math.max(0.7, Math.min(1.4, radius)) * 1.25;
  const env = 1 - smooth(span(p, 0.8, 1));
  // The shard forms just ahead of the caster, where the projectile leaves.
  ink.oz = 0.5 * u;
  // Wind-up: three nested sound waves are pulled in, accelerating into the forming crystal.
  for (let k = 0; k < 3; k++) {
    const q = span(p, k * 0.07, 0.46);
    if (q >= 1) { ink.n += 20; continue; }
    const r = (1.75 - 1.35 * easeIn(q)) * u * (1 - k * 0.17);
    ink.waves(r, 0.8 - 0.25 * q, 10, 0.78 - q * 0.6,
      env * (0.35 + 0.65 * q) * (1 - span(q, 0.86, 1)) * Math.min(1, 0.4 + p * 12));
  }
  // Frost motes spiral inward with the dying sound.
  for (let i = 0; i < 26; i++) {
    const m = span(p, hash(i, 1) * 0.15, 0.47);
    if (m >= 1) { ink.n++; continue; }
    const r = (1.6 + hash(i, 2) * 0.9) * u * (1 - easeIn(m)) + 0.1;
    const a = hash(i, 3) * TAU + easeIn(m) * 1.8;
    ink.dot(Math.cos(a) * r, Math.sin(a) * r, mote(0.3 + 0.6 * m), 0.8 - 0.7 * m,
      env * (0.25 + 0.6 * m) * (1 - span(m, 0.9, 1)));
  }
  // The crystal grows with a slight overshoot, cracks at the snap and fades by thinning out.
  const grow = span(p, 0.12, 0.48);
  const flash = easeOut(span(p, 0.44, 0.5)) * (1 - span(p, 0.5, 0.68));
  if (grow > 0) {
    ink.thin = smooth(span(p, 0.66, 0.97)) * 0.85;
    const glow = (0.45 + 0.55 * grow) * (1 - smooth(span(p, 0.62, 0.98)));
    shard(ink, 0.95 * u * easeBack(grow), 0.08 * u * easeOut(span(p, 0.46, 0.62)),
      env * Math.min(1, glow + flash * 0.3), flash * 0.2, p * 0.92);
    ink.thin = 0;
  }
  // Snap: a star of frost rays flashes from the crack.
  if (flash > 0) {
    const reach = (0.3 + 0.7 * easeOut(span(p, 0.44, 0.68))) * u;
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * TAU, L = reach * (i % 3 ? 0.7 : 1.15);
      const x = Math.cos(a), z = Math.sin(a);
      ink.line(x * L * 0.45, z * L * 0.45, x * L, z * L, 5, 0, 0.35, env * flash, env * flash * 0.35);
    }
  }
  // The muting slash cuts across the shard with a bright leading head.
  const head = easeOut(span(p, 0.42, 0.54)), tail = easeIn(span(p, 0.48, 0.72));
  if (head > tail) {
    const ax = -1.25 * u, az = -0.95 * u, bx = 1.25 * u, bz = 0.95 * u;
    ink.line(ax + (bx - ax) * tail, az + (bz - az) * tail, ax + (bx - ax) * head, az + (bz - az) * head,
      18, 0.55, 0, env * 0.35, env);
  }
  // Follow-through: a cut, thinning shockwave and drag-slowed splinters.
  const wave = span(p, 0.48, 0.96);
  if (wave > 0 && wave < 1) {
    ink.thin = wave * 0.5;
    ink.ring((0.5 + 1.9 * easeOut(wave)) * u, 26, 0.2, 0.25 + 0.6 * wave, env * 0.8 * (1 - wave) ** 1.3);
    ink.thin = 0;
  } else ink.n += 26;
  const burst = span(p, 0.47, 1);
  if (burst > 0) {
    for (let i = 0; i < 16; i++) {
      const a = hash(i, 4) * TAU, x = Math.cos(a), z = Math.sin(a);
      const d = (0.25 + (1.2 + hash(i, 5) * 1.4) * 0.6 * easeOut(burst)) * u;
      const b = env * (1 - burst) ** 1.4 * (0.6 + 0.4 * hash(i, 6));
      ink.dot(x * d, z * d, ink.slope(x, z), 0.1 + 0.7 * burst, b);
      ink.dot(x * d * 0.84, z * d * 0.84, '.', 0.4 + 0.5 * burst, b * 0.5);
    }
    // Motes linger, drifting outward on a gentle turbulence.
    for (let i = 0; i < 14; i++) {
      const a = hash(i, 8) * TAU + Math.sin(burst * 3 + i) * 0.25;
      const r = (0.3 + hash(i, 9) * 1.3 + burst * 0.4) * u;
      const glow = Math.sin(Math.PI * burst) * (0.5 + 0.5 * Math.sin(burst * 9 + i * 1.3));
      ink.dot(Math.cos(a) * r, Math.sin(a) * r, mote(glow), 0.3 + 0.5 * burst, env * 0.55 * glow);
    }
  }
}

function seal(ink, L, s1, s2, b, centre) {
  if (s1 > 0) ink.line(-L, -L, -L + 2 * L * s1, -L + 2 * L * s1, 10, 0.35, 0, b * 0.75, b, 0.5);
  if (s2 > 0) ink.line(L, -L, L - 2 * L * s2, -L + 2 * L * s2, 10, 0.45, 0.05, b * 0.7, b, 0.5);
  if (centre > 0) ink.dot(0, 0, 'X', 0, b * centre);
}

function drawImpact(ink, p, radius) {
  const u = Math.max(0.5, Math.min(2, radius));
  const env = 1 - smooth(span(p, 0.55, 1));
  const strike = easeOut(span(p, 0, 0.22));
  // The X seal stamps down from oversized and settles.
  const L = 0.62 * u * (1.5 - 0.5 * strike);
  ink.thin = smooth(span(p, 0.6, 1)) * 0.7;
  seal(ink, L, 1, 1, env * (0.7 + 0.3 * (1 - strike)), 1);
  // The sound ring snaps shut around it, glint orbiting.
  ink.ring(u * (1.05 + 0.35 * (1 - strike)), 28, p * 1.2, 0.45, env * 0.75, p * TAU * 1.4);
  ink.thin = 0;
  // A white flash star on the first frames.
  const flash = 1 - span(p, 0, 0.2);
  for (let i = 0; i < 8 && flash > 0; i++) {
    const a = i / 8 * TAU, L2 = (0.3 + 0.6 * strike) * u * (i % 2 ? 0.6 : 1);
    ink.line(Math.cos(a) * L2 * 0.4, Math.sin(a) * L2 * 0.4, Math.cos(a) * L2, Math.sin(a) * L2,
      4, 0, 0.2, env * flash, env * flash * 0.4);
  }
  // Shockwave and drag-slowed splinters.
  const wave = span(p, 0.04, 0.7);
  if (wave < 1) {
    ink.thin = wave * 0.5;
    ink.ring((0.45 + 1.85 * easeOut(wave)) * u, 30, 0.15, 0.2 + 0.6 * wave, env * 0.75 * (1 - wave) ** 1.2);
    ink.thin = 0;
  }
  for (let i = 0; i < 20; i++) {
    const a = hash(i, 11) * TAU, x = Math.cos(a), z = Math.sin(a);
    const d = (0.3 + (1 + hash(i, 12) * 1.3) * easeOut(p)) * u;
    const b = env * (1 - p) ** 1.2 * (0.55 + 0.45 * hash(i, 13));
    ink.dot(x * d, z * d, ink.slope(x, z), 0.05 + 0.75 * p, b);
    ink.dot(x * d * 0.86, z * d * 0.86, '.', 0.4 + 0.5 * p, b * 0.5);
  }
  for (let i = 0; i < 16; i++) {
    const a = hash(i, 14) * TAU + p * (hash(i, 15) - 0.5);
    const r = (0.4 + hash(i, 16) * 1.4 + p * 0.5) * u;
    const glow = Math.sin(Math.PI * Math.min(1, p * 1.4 + 0.1)) * (0.5 + 0.5 * Math.sin(p * 11 + i));
    ink.dot(Math.cos(a) * r, Math.sin(a) * r, mote(glow), 0.3 + 0.5 * p, env * 0.5 * glow);
  }
}

function drawPulse(ink, p, radius) {
  const env = (1 - p) ** 1.2;
  if (radius < 1.8) {
    // Each projectile tick leaves a small hush ripple of frost on the ground.
    const u = Math.max(0.3, Math.min(1.5, radius));
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * TAU + hash(i, 21) * 0.5;
      const r = (0.15 + 0.6 * easeOut(p)) * u * (0.7 + 0.3 * hash(i, 22));
      ink.dot(Math.cos(a) * r, Math.sin(a) * r, mote(1 - p * 0.9), 0.1 + 0.7 * p, env * 0.7);
    }
    ink.ring((0.2 + 0.65 * easeOut(p)) * u, 10, p * 0.6, 0.5 + 0.4 * p, env * 0.42);
    if (p < 0.4) ink.dot(0, 0, '*', 0, 1 - p / 0.4);
    return;
  }
  // The hit burst: the shard shatters on the target. A white flash core, six
  // retracting frost cracks, a gapped hush ring with a violet echo, and
  // drag-slowed splinters trailing frost. Kept compact so it reads as one burst.
  const u = Math.max(0.9, Math.min(1.6, radius * 0.42));
  const flash = 1 - span(p, 0, 0.28);
  if (flash > 0) {
    ink.dot(0, 0, '@', 0, flash);
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * TAU + Math.PI / 4;
      ink.dot(Math.cos(a) * 0.12 * u, Math.sin(a) * 0.12 * u, '#', 0.05, flash * 0.8);
    }
  } else ink.n += 5;
  const reach = easeOut(span(p, 0, 0.35)), retract = easeIn(span(p, 0.2, 0.95));
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * TAU, L = (0.3 + 0.7 * reach) * u * (i % 2 ? 0.62 : 1);
    const from = 0.12 * u + (L - 0.12 * u) * retract;
    ink.line(Math.cos(a) * from, Math.sin(a) * from, Math.cos(a) * L, Math.sin(a) * L,
      9, 0.02 + 0.3 * p, 0.3 + 0.4 * p, env, env * 0.45);
  }
  ink.thin = p * 0.45;
  ink.ring((0.3 + 1.2 * easeOut(p)) * u, 32, 0.1, 0.3 + 0.45 * p, env * 0.8, 0.6 + p * 2);
  ink.ring((0.2 + 0.75 * easeOut(span(p, 0.08, 1))) * u, 16, 0.3, 0.6 + 0.35 * p, env * 0.5);
  ink.thin = 0;
  const drag = (1 - Math.exp(-4 * p)) / (1 - Math.exp(-4));
  for (let i = 0; i < 14; i++) {
    const a = hash(i, 23) * TAU, x = Math.cos(a), z = Math.sin(a);
    const d = (0.15 + (0.75 + hash(i, 24) * 0.6) * drag) * u;
    const b = env * (0.55 + 0.45 * hash(i, 25));
    ink.dot(x * d, z * d, ink.slope(x, z), 0.05 + 0.7 * p, b);
    ink.dot(x * (d - 0.14 * u), z * (d - 0.14 * u), mote(0.6 - p * 0.5), 0.45 + 0.4 * p, b * 0.45);
  }
}

function drawAura(ink, p, radius) {
  const u = Math.max(0.5, Math.min(2, radius));
  const env = 1 - smooth(span(p, 0.72, 1));
  const close = easeOut(span(p, 0, 0.2));
  const drift = smooth(span(p, 0.7, 1));
  ink.thin = drift * 0.8;
  // The sound ring closes from the top like a lock, then a glint circles it.
  const r = u * (1.05 + 0.25 * (1 - close) + 0.3 * drift);
  for (let i = 0; i < 28; i++) {
    const a = i / 28 * TAU;
    const from = Math.abs(Math.atan2(Math.sin(a + Math.PI / 2), Math.cos(a + Math.PI / 2)));
    if (from > close * Math.PI + 1e-6) { ink.n++; continue; }
    const head = close < 1 ? Math.max(0, 1 - (close * Math.PI - from) / 0.5) : 0;
    const glint = Math.max(0, Math.cos(a - p * TAU * 1.5)) ** 10;
    ink.dot(Math.cos(a) * r, Math.sin(a) * r, drift > 0.5 ? mote(1 - drift) : ink.ringGlyph(a),
      0.42 - 0.4 * Math.max(head, glint), env * (0.6 + 0.4 * Math.max(head, glint)));
  }
  // Two strokes slash in to cross into the X seal; the centre breathes.
  const breath = 0.8 + 0.2 * Math.sin(p * TAU * 2);
  seal(ink, 0.55 * u, easeOut(span(p, 0.08, 0.22)), easeOut(span(p, 0.16, 0.3)), env * breath,
    span(p, 0.22, 0.3));
  ink.thin = 0;
  // Remaining sound keeps draining inward while the seal holds.
  const hold = span(p, 0.15, 0.3) * env;
  for (let k = 0; k < 2; k++) {
    const q = frac(p * 2.5 + k * 0.5);
    ink.waves(u * (0.95 - 0.55 * easeIn(q)), 0.7, 7, 0.7 - 0.35 * q, hold * 0.5 * Math.sin(Math.PI * q));
  }
  // Frost runes orbit the seal with faint trailing motes.
  const runes = span(p, 0.1, 0.25) * env;
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * TAU + p * 2.2, rr = u * (1.32 + 0.06 * Math.sin(p * 9 + i) + 0.25 * drift);
    const twinkle = 0.5 + 0.5 * Math.sin(p * 14 + i * 2.1);
    ink.dot(Math.cos(a) * rr, Math.sin(a) * rr, twinkle > 0.5 ? '*' : '+', 0.15, runes * (0.45 + 0.4 * twinkle));
    ink.dot(Math.cos(a - 0.14) * rr, Math.sin(a - 0.14) * rr, '.', 0.6, runes * 0.3);
  }
}

function drawZone(ink, p, radius, age) {
  const u = Math.max(0.5, Math.min(4, radius));
  const env = smooth(span(p, 0, 0.12)) * (1 - smooth(span(p, 0.75, 1)));
  ink.ring(u, 36, age * 0.4, 0.45, env * 0.6, age * 2);
  for (let k = 0; k < 2; k++) {
    const q = frac(age * 0.8 + k * 0.5);
    ink.waves(u * (0.9 - 0.55 * easeIn(q)), 0.7, 9, 0.7 - 0.35 * q, env * 0.45 * Math.sin(Math.PI * q));
  }
  seal(ink, 0.3 * u, 1, 1, env * (0.75 + 0.15 * Math.sin(age * 3)), 1);
  for (let i = 0; i < 24; i++) {
    const q = frac(hash(i, 31) + age * 0.15);
    const a = hash(i, 32) * TAU + age * 0.3 * (hash(i, 33) - 0.5) + Math.sin(age + i) * 0.1;
    const r = u * (0.95 - 0.75 * q);
    const glow = Math.sin(Math.PI * q);
    ink.dot(Math.cos(a) * r, Math.sin(a) * r, mote(glow), 0.2 + 0.6 * (1 - q), env * 0.55 * glow);
  }
}

function draw(effect, plot) {
  const p = clamp01(Number.isFinite(effect.progress) ? effect.progress
    : (Number.isFinite(effect.age) && effect.life > 0 ? effect.age / effect.life : 0));
  if (p >= 1) return;
  const age = Number.isFinite(effect.age) ? effect.age : p;
  const radius = Number.isFinite(effect.radius) ? effect.radius : 1;
  const ink = pen(plot, Number.isFinite(effect.heading) ? effect.heading : 0);
  switch (effect.stage) {
    case 'projectile': return drawProjectile(ink, p, age);
    case 'impact': return drawImpact(ink, p, radius);
    case 'pulse': return drawPulse(ink, p, radius);
    case 'aura': return drawAura(ink, p, radius);
    case 'zone': return drawZone(ink, p, radius, age);
    default: return drawCast(ink, p, radius);
  }
}

export default {
  id: 'silencing-shard',
  duration: 0.92,
  draw,
  sounds: {
    cast: [
      // Two non-harmonic partials make a hollow, deliberately damped bell.
      { kind: 'tone', delay: 0, duration: 0.27, gain: 0.07, attack: 0.003, release: 0.2,
        frequency: 428, endFrequency: 397, type: 'sine', cutoff: 1200, filterType: 'lowpass' },
      { kind: 'tone', delay: 0.012, duration: 0.19, gain: 0.032, attack: 0.002, release: 0.16,
        frequency: 677, endFrequency: 628, type: 'triangle', cutoff: 1000, filterType: 'lowpass' },
      // Descending notch centres remove successively lower bands of breath.
      { kind: 'noise', delay: 0.13, duration: 0.11, gain: 0.035, attack: 0.025, release: 0.07,
        cutoff: 1750, filterType: 'notch' },
      { kind: 'noise', delay: 0.22, duration: 0.1, gain: 0.027, attack: 0.018, release: 0.06,
        cutoff: 880, filterType: 'notch' },
      { kind: 'noise', delay: 0.30, duration: 0.075, gain: 0.02, attack: 0.012, release: 0.009,
        cutoff: 390, filterType: 'notch' },
    ],
    impact: [
      { kind: 'tone', delay: 0, duration: 0.105, gain: 0.06, attack: 0.003, release: 0.009,
        frequency: 262, endFrequency: 106, type: 'sine', cutoff: 650, filterType: 'lowpass' },
      { kind: 'noise', delay: 0.018, duration: 0.075, gain: 0.035, attack: 0.01, release: 0.008,
        cutoff: 680, filterType: 'notch' },
      { kind: 'tone', delay: 0.105, duration: 0.018, gain: 0.022, attack: 0.001, release: 0.012,
        frequency: 1020, endFrequency: 740, type: 'triangle', cutoff: 1500, filterType: 'lowpass' },
    ],
  },
};
