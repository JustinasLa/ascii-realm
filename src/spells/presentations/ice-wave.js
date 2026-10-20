// Ice Wave: frost gathers at the caster's feet, then a breaking crest of ice
// rolls through the 120-degree cone, leaving a wake of spikes that shatter.
// Local +z is the cast heading and the adapter rotates the ground plane. Height
// ("lift") is counter-rotated here so crests, spikes and spray always rise up
// the screen, whichever way the wave runs.

const COLS = 13 / 0.6; // screen columns per metre (SCALE / ASPECT)
const ROWS = 6.5; // screen rows per metre of depth or lift (SCALE * TILT)
const ROW = 1 / ROWS; // one screen row of lift, in metres
const NOMINAL = 1.15; // seconds; secondary motion is timed against this clock

// Deep glacier blue -> seithr cyan -> rime white, picked by intensity.
const RAMP = [
  [30, 78, 140], [38, 104, 168], [56, 140, 198], [77, 173, 218], [91, 205, 245],
  [118, 224, 255], [150, 233, 255], [182, 241, 255], [214, 248, 255], [240, 252, 255],
];
const WHITE = RAMP[9];
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const tint = t => RAMP[Math.round(clamp(t, 0, 1) * (RAMP.length - 1))];
const smooth = (from, to, x) => {
  const t = clamp((x - from) / (to - from), 0, 1);
  return t * t * (3 - 2 * t);
};
const easeOut = t => 1 - (1 - t) ** 3;
const easeBack = t => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2;
const hash = (i, salt) => {
  const v = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return v - Math.floor(v);
};

// A frame-local painter: ground position plus screen-up lift, and screen-aware
// stroke glyphs so shard lines follow their real on-screen direction.
function painter(effect, plot, fade, limit) {
  const heading = Number.isFinite(effect.heading) ? effect.heading : 0;
  const cos = Math.cos(heading), sin = Math.sin(heading);
  let used = 0; // a self-imposed budget below the adapter cap; key layers plot first
  const put = (x, z, lift, char, color, brightness) => {
    if (!(brightness > 0.004) || used >= limit) return;
    used++;
    plot(x + lift * sin, z - lift * cos, char, color, clamp(brightness * fade, 0, 1));
  };
  // On-screen pixel direction of a local displacement (cells are 0.6 wide).
  const stroke = (dx, dz, dLift = 0) => {
    const px = (dx * cos + dz * sin) * 13;
    const py = (dz * cos - dx * sin - dLift) * 6.5;
    const angle = Math.abs(Math.atan2(py, px)) % Math.PI;
    const a = angle > Math.PI / 2 ? Math.PI - angle : angle;
    if (a < 0.4) return '-';
    if (a > 1.2) return '|';
    return (px > 0) === (py > 0) ? '\\' : '/';
  };
  // How many glyphs a straight segment needs to read as a line without overdraw.
  const steps = (dx, dz, dLift, cap) => {
    const cols = Math.abs(dx * cos + dz * sin) * COLS, rows = Math.abs(dz * cos - dx * sin - dLift) * ROWS;
    return clamp(Math.round(Math.max(cols / 2, rows)), 1, cap);
  };
  // How many legible samples an arc needs (about 2.6 columns or one row apart).
  const arcSamples = (radius, span, cap, spacing = 2.6) => {
    let length = 0, px = 0, pz = 0;
    for (let i = 0; i <= 8; i++) {
      const a = -span + (2 * span * i) / 8;
      const x = radius * Math.sin(a), z = radius * Math.cos(a);
      const wx = x * cos + z * sin, wz = z * cos - x * sin;
      if (i) length += Math.max(Math.abs(wx - px) * COLS / spacing, Math.abs(wz - pz) * ROWS * 2.4 / spacing);
      px = wx; pz = wz;
    }
    return clamp(Math.round(length), 4, cap);
  };
  return { put, stroke, steps, arcSamples };
}

const LIMIT = { cast: 236, impact: 140, pulse: 80, aura: 72, zone: 140, projectile: 72 };
const SPAN = 1.02; // half-angle of the wave arc (just inside the 120-degree cone)
const front = (p, k) => k * (0.45 + 3.15 * easeOut(clamp((p - 0.1) / 0.64, 0, 1)));
const crest = (p, k) => k * 0.62 * smooth(0.04, 0.22, p) * (1 - smooth(0.58, 0.86, p));

function drawCast(p, k, { put, stroke, arcSamples }) {
  // Wind-up: motes spiral in from around the caster to a point just ahead.
  if (p < 0.22) {
    const pull = clamp(p / 0.15, 0, 1), gone = 1 - smooth(0.12, 0.2, p);
    for (let i = 0; i < 18; i++) {
      const r = k * (1.05 + 0.45 * hash(i, 1)) * (1 - pull ** 2.2);
      const a = (i / 18) * Math.PI * 2 + (1 - pull) * 1.6 + hash(i, 2) * 0.3;
      const char = pull < 0.45 ? '.' : pull < 0.8 ? '+' : '*';
      put(r * Math.sin(a), k * 0.35 + r * Math.cos(a) * 0.85, k * 0.08 * Math.sin(i + pull * 4),
        char, tint(0.35 + 0.6 * pull), (0.25 + 0.75 * pull) * gone);
    }
    const flash = smooth(0.08, 0.13, p) * (1 - smooth(0.14, 0.22, p));
    if (flash > 0) {
      put(0, k * 0.35, ROW, '*', WHITE, flash);
      for (const [dx, dz, lift, char] of [[-0.12, 0, ROW, '-'], [0.12, 0, ROW, '-'], [0, 0, 2 * ROW, '|'], [0, 0, 0, '|']]) {
        put(dx * k, k * 0.35 + dz, lift, char, tint(0.85), flash * 0.8);
      }
    }
  }

  const R = front(p, k), H = crest(p, k);
  const build = smooth(0.02, 0.2, p), broken = smooth(0.58, 0.86, p);
  const glow = (0.3 + 0.7 * build) * (1 - smooth(0.7, 0.97, p));
  // The crest: a foam line on the ground, a dense ice face, and a continuous
  // toothed lip. Shape terms depend on angle only, so resampling never flickers.
  const wobble = a => 0.5 * Math.sin(a * 9 - p * 14) + 0.5 * Math.sin(a * 23 + p * 6);
  const height = (a, taper) => H * (0.3 + 0.7 * taper) * (0.86 + 0.14 * wobble(a));
  const N = arcSamples(R, SPAN, 34, 3.4);
  for (let i = 0; i < N; i++) {
    const u = N > 1 ? (i / (N - 1)) * 2 - 1 : 0, a = u * SPAN, taper = 1 - u ** 4;
    const r = R + k * 0.05 * wobble(a), x = r * Math.sin(a), z = r * Math.cos(a);
    const h = height(a, taper), b = glow * (0.6 + 0.4 * taper);
    put(x, z, 0, broken > 0.5 ? (Math.sin(a * 31) > 0 ? '.' : ',') : '=',
      tint(0.5 + 0.3 * taper - broken * 0.25), b * 0.9);
    if (h > ROW * 1.6 && taper > 0.35) {
      put(x, z, h * 0.5, h > ROW * 3 ? (taper > 0.7 ? '%' : '#') : '+', tint(0.65 + 0.25 * taper), b * 0.95);
    }
  }
  const L = arcSamples(R, SPAN, 56, 2.1);
  for (let i = 0; i < L; i++) {
    const u = L > 1 ? (i / (L - 1)) * 2 - 1 : 0, a = u * SPAN, taper = 1 - u ** 4;
    const h = height(a, taper);
    if (h < ROW * 0.7) continue;
    const r = R + k * 0.05 * wobble(a);
    put(r * Math.sin(a), r * Math.cos(a), h, Math.sin(a * 37 + 1.3) > 0.45 ? '^' : '~',
      tint(0.82 + 0.18 * taper), glow * (0.6 + 0.4 * taper));
  }
  // Churning frost behind the crest, thinning with distance from it.
  for (let row = 1; row <= 2; row++) {
    const r0 = R - k * (0.18 + 0.3 * row);
    if (r0 < k * 0.3) break;
    const M = arcSamples(r0, SPAN * 0.96, 26, 3.6);
    for (let i = (row % 2); i < M; i += 1) {
      const u = M > 1 ? (i / (M - 1)) * 2 - 1 : 0, a = u * SPAN * 0.96;
      if (hash(i + row * 31, 4) < 0.2 + row * 0.15) continue;
      const r = r0 + k * 0.07 * Math.sin(a * 11 + p * 20 + row * 2);
      const char = row === 1 ? (i % 3 ? '-' : ':') : (i % 2 ? ':' : '.');
      put(r * Math.sin(a), r * Math.cos(a), 0, char, tint(0.68 - row * 0.16),
        glow * (0.82 - row * 0.2) * (1 - u ** 4));
    }
  }
  // Wake: ice spikes punch up where the crest has passed, then shatter outward.
  for (let j = 0; j < 20; j++) {
    const rj = k * (0.75 + 2.75 * hash(j, 5)), aj = (hash(j, 6) * 2 - 1) * SPAN * 0.88;
    const grown = clamp((R - rj) / (k * 0.4), 0, 1);
    if (grown <= 0) continue;
    const at = 0.6 + 0.2 * (rj / k - 0.75) / 2.75, cracked = smooth(at, at + 0.1, p);
    const x = rj * Math.sin(aj), z = rj * Math.cos(aj);
    const tall = k * (0.24 + 0.22 * hash(j, 7)) * easeBack(grown) * (1 - cracked);
    const b = (0.75 + 0.25 * hash(j, 8)) * (1 - smooth(0.85, 1, p));
    if (tall > ROW * 0.6) {
      put(x, z, tall, '^', tint(0.8 + 0.2 * hash(j, 9)), b);
      if (tall > ROW * 1.7) put(x, z, tall - ROW, '|', tint(0.5), b * 0.8);
    }
    if (cracked > 0) {
      const t = (p - at) * NOMINAL;
      for (let f = 0; f < 2; f++) {
        const side = f ? 1 : -1, v = 0.5 + 0.5 * hash(j * 2 + f, 10);
        const lift = k * 0.32 + 1.1 * t - 5.5 * t * t;
        if (lift < 0) continue;
        put(x + side * v * t * k, z + 0.3 * v * t * k, lift, f ? "'" : '.',
          tint(0.85 - t * 2), b * (1 - smooth(0.05, 0.3, t)));
      }
    }
  }
  // Spray: crystals thrown off the crest, slowed by drag and pulled down again.
  for (let i = 0; i < 20; i++) {
    const born = 0.16 + 0.56 * hash(i, 11), t = (p - born) * NOMINAL;
    if (t < 0 || t > 0.5) continue;
    const a = (hash(i, 12) * 2 - 1) * SPAN * 0.95;
    const v = k * (1 + 1.5 * hash(i, 13)), out = front(born, k) + v * (1 - Math.exp(-2.6 * t)) / 2.6;
    const lift = crest(born, k) + (1.2 + hash(i, 14)) * t - 4.9 * t * t;
    if (lift < 0) continue;
    put(out * Math.sin(a), out * Math.cos(a), lift, t < 0.1 ? '*' : t < 0.26 ? "'" : '.',
      tint(1 - t * 1.4), (1 - t / 0.5) * (1 - smooth(0.85, 1, p)));
  }
  // Rime left on the ground glints briefly as the crest passes over it.
  for (let i = 0; i < 22; i++) {
    const r = k * (0.55 + 3 * hash(i, 15)), a = (hash(i, 16) * 2 - 1) * SPAN * 0.92;
    const passed = clamp((R - r) / (k * 0.3), 0, 1);
    if (passed <= 0) continue;
    const glint = 0.65 + 0.35 * Math.sin(p * 38 + i * 2.3);
    put(r * Math.sin(a), r * Math.cos(a), 0, hash(i, 17) < 0.5 ? '.' : ',', tint(0.25 + 0.2 * glint),
      passed * 0.5 * glint * (1 - smooth(0.72, 1, p)));
  }
}

function drawImpact(p, k, { put, stroke, steps, arcSamples }) {
  // Flash: the hit freezes white for a beat.
  const flash = 1 - smooth(0, 0.22, p);
  if (flash > 0) {
    put(0, 0, ROW, '*', WHITE, flash);
    put(-0.1 * k, 0, ROW, '<', WHITE, flash * 0.7);
    put(0.1 * k, 0, ROW, '>', WHITE, flash * 0.7);
  }
  // Crystal cluster: shards spring up and out of the target, hold, then shatter.
  const grow = easeBack(clamp(p / 0.2, 0, 1)), shatter = smooth(0.5, 0.62, p);
  const t = Math.max(0, p - 0.5) * 0.6;
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + hash(i, 20) * 0.5;
    const dx = Math.sin(a), dz = Math.cos(a) * 0.6, rise = 1.1 + 0.9 * hash(i, 22);
    const length = k * (0.3 + 0.28 * hash(i, 21)) * grow;
    if (length < k * 0.05) continue;
    const char = stroke(dx, dz, rise), n = steps(dx * length, dz * length, rise * length, 7);
    for (let s = 1; s <= n; s++) {
      const f = s / n, d = k * 0.06 + length * f;
      let x = dx * d, z = dz * d, lift = d * rise;
      let b = (0.5 + 0.5 * f) * (1 - smooth(0.82, 1, p));
      let glyph = s === n ? '*' : char;
      if (shatter > 0) {
        // Each segment becomes a fragment that keeps drifting out as it falls.
        const v = k * (0.6 + 0.9 * hash(i * 8 + s, 23));
        x += dx * v * t; z += dz * v * t;
        lift += 0.5 * t - 9 * t * t;
        if (lift < 0) continue;
        if (shatter > 0.5) glyph = s % 2 ? '.' : "'";
        b *= 1 - 0.45 * shatter;
      }
      put(x, z, lift, glyph, tint(s === n ? 1 : 0.45 + 0.45 * f), b);
    }
  }
  // Frost ring expands over the ground and thins out.
  const ringR = k * (0.3 + 1.2 * easeOut(clamp(p / 0.7, 0, 1)));
  const N = arcSamples(ringR, Math.PI, 34);
  for (let i = 0; i < N; i++) {
    if (hash(i, 24) < smooth(0.3, 0.95, p)) continue;
    const a = (i / N) * Math.PI * 2;
    put(Math.sin(a) * ringR, Math.cos(a) * ringR, 0, p < 0.3 ? ':' : '.', tint(0.6 - p * 0.4),
      (0.7 - 0.4 * p) * (1 - smooth(0.7, 1, p)));
  }
  // Snow motes sift down through the frozen air.
  for (let i = 0; i < 12; i++) {
    const a = hash(i, 25) * Math.PI * 2, r = k * (0.2 + 0.7 * hash(i, 26));
    const lift = k * (0.7 + 0.5 * hash(i, 27)) * (1 - p) + k * 0.05;
    put(r * Math.sin(a) + 0.08 * k * Math.sin(p * 9 + i), r * Math.cos(a), lift, i % 3 ? '.' : '*',
      tint(0.7), 0.55 * smooth(0, 0.15, p) * (1 - smooth(0.7, 1, p)));
  }
}

function drawPulse(p, k, { put, stroke, steps, arcSamples }) {
  if (k >= 1.5) {
    // Gust: cold air streaks fan out through the cone ahead of the crest.
    const reach = easeOut(p);
    for (let i = 0; i < 9; i++) {
      const a = ((i / 8) * 2 - 1) * SPAN * 0.95 + (hash(i, 30) - 0.5) * 0.12;
      const dx = Math.sin(a), dz = Math.cos(a), char = stroke(dx, dz);
      const head = k * (0.3 + 1.05 * reach) * (0.82 + 0.3 * hash(i, 31));
      const tail = k * (0.12 + 0.2 * reach), n = steps(dx * tail, dz * tail, 0, 5);
      for (let s = 0; s < n; s++) {
        const r = head - (s / n) * tail;
        if (r < k * 0.2) break;
        put(dx * r, dz * r, k * 0.04 * Math.sin(r * 3 + i), s ? char : '*', tint(0.9 - (s / n) * 0.5),
          (1 - (s / n) * 0.6) * (1 - smooth(0.5, 1, p)));
      }
    }
    for (let i = 0; i < 14; i++) {
      const a = (hash(i, 32) * 2 - 1) * SPAN, r = k * (0.2 + 1.3 * reach * (0.5 + 0.5 * hash(i, 33)));
      put(r * Math.sin(a), r * Math.cos(a), k * 0.06 * Math.sin(p * 8 + i), '.', tint(0.6),
        0.6 * (1 - smooth(0.4, 1, p)));
    }
    return;
  }
  // Frost snap: a six-armed flake cracks open at the caster's feet.
  const open = easeBack(clamp(p / 0.35, 0, 1)), fade = 1 - smooth(0.45, 1, p);
  put(0, 0, 0, '*', WHITE, fade);
  for (let arm = 0; arm < 6; arm++) {
    const a = (arm / 6) * Math.PI * 2 + Math.PI / 6, dx = Math.sin(a), dz = Math.cos(a);
    const char = stroke(dx, dz);
    for (let s = 1; s <= 2; s++) {
      const r = k * 0.2 * s * open;
      if (r < k * 0.08) continue;
      put(dx * r, dz * r, 0, s === 2 ? '+' : char, tint(0.95 - s * 0.15), fade * (1 - s * 0.15));
    }
  }
  const ringR = k * (0.25 + 0.5 * easeOut(p)), N = arcSamples(ringR, Math.PI, 16);
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    put(Math.sin(a) * ringR, Math.cos(a) * ringR, 0, '.', tint(0.5), 0.6 * fade);
  }
}

function drawAura(p, k, { put, arcSamples }) {
  // Slowed: rime creeps around the feet, short crystals jut up and snow settles.
  const fade = smooth(0, 0.18, p) * 0.75 + 0.25;
  const out = 1 - smooth(0.68, 1, p);
  const ringR = k * 0.55, N = arcSamples(ringR, Math.PI, 22);
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2, creep = smooth(hash(i, 40) * 0.3, hash(i, 40) * 0.3 + 0.15, p);
    const glint = 0.7 + 0.3 * Math.sin(p * 16 + i * 1.7);
    put(Math.sin(a) * ringR, Math.cos(a) * ringR * 0.9, 0, hash(i, 41) < 0.3 ? '*' : i % 2 ? ':' : '.',
      tint(0.45 + 0.3 * glint), (0.25 + 0.6 * creep) * glint * fade * out);
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4, grow = easeBack(clamp((p - 0.05 * i) / 0.3, 0, 1));
    const tall = k * (0.18 + 0.1 * hash(i, 42)) * grow * (1 - smooth(0.6, 0.95, p));
    const x = Math.sin(a) * ringR * 0.8, z = Math.cos(a) * ringR * 0.7;
    put(x, z, tall, '^', tint(0.9), (0.4 + 0.6 * grow) * out);
    if (tall > ROW * 1.7) put(x, z, tall - ROW, '|', tint(0.55), 0.7 * out);
  }
  for (let i = 0; i < 10; i++) {
    const a = hash(i, 43) * Math.PI * 2, r = k * (0.3 + 0.5 * hash(i, 44));
    const fall = (hash(i, 45) + p * 1.4) % 1;
    put(r * Math.sin(a) + 0.07 * k * Math.sin(p * 10 + i * 2), r * Math.cos(a), k * 1.3 * (1 - fall),
      i % 3 ? '.' : '*', tint(0.75), 0.6 * Math.sin(fall * Math.PI) * fade * out);
  }
}

function drawZone(p, k, { put, arcSamples }) {
  // Not used by the rune; a frozen field of rime and slowly cycling spikes.
  const out = 1 - smooth(0.8, 1, p), turn = p * 1.2;
  for (let ring = 1; ring <= 2; ring++) {
    const r = k * ring * 0.45, N = arcSamples(r, Math.PI, 36);
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + turn * (ring % 2 ? 1 : -1);
      put(Math.sin(a) * r, Math.cos(a) * r, 0, i % 3 ? '.' : ':', tint(0.5 - ring * 0.1),
        (0.65 - ring * 0.15) * out);
    }
  }
  for (let i = 0; i < 12; i++) {
    const a = hash(i, 50) * Math.PI * 2, r = k * (0.2 + 0.75 * hash(i, 51));
    const cycle = (p * 3 + hash(i, 52)) % 1, tall = k * 0.25 * Math.sin(cycle * Math.PI);
    put(r * Math.sin(a), r * Math.cos(a), tall, '^', tint(0.9), (0.3 + 0.7 * Math.sin(cycle * Math.PI)) * out);
    if (tall > ROW * 1.7) put(r * Math.sin(a), r * Math.cos(a), tall - ROW, '|', tint(0.55), 0.7 * out);
  }
}

function drawProjectile(p, k, { put }) {
  // Not used by the rune; a compact cresting arc that sheds frost behind it.
  const out = 1 - smooth(0.82, 1, p);
  for (let i = -4; i <= 4; i++) {
    const u = i / 4, x = u * k * 0.45, z = k * 0.2 * (1 - u * u);
    const h = k * 0.25 * (1 - 0.6 * u * u) * (0.9 + 0.1 * Math.sin(p * 18 + i));
    put(x, z, 0, i % 2 ? '=' : '-', tint(0.45), 0.8 * out);
    put(x, z, h, Math.abs(i) % 3 === 1 ? '^' : '~', tint(0.9 - 0.2 * Math.abs(u)), (1 - 0.3 * Math.abs(u)) * out);
  }
  for (let i = 0; i < 10; i++) {
    const back = ((i / 10 + p * 2.5) % 1), sway = Math.sin(i * 2.1 + p * 9) * k * 0.2;
    put(sway * (0.3 + back), -back * k * 1.1, k * 0.1 * (1 - back), back < 0.3 ? '*' : '.', tint(0.8 - back * 0.5),
      0.75 * (1 - back) * out);
  }
}

function draw(effect, plot) {
  const life = Number.isFinite(effect.life) && effect.life > 0 ? effect.life : 1.15;
  const p = clamp(Number.isFinite(effect.progress) ? effect.progress
    : (Number.isFinite(effect.age) ? effect.age / life : 0), 0, 1);
  if (p >= 1) return;
  const radius = Number.isFinite(effect.radius) ? effect.radius : 1;
  const stage = effect.stage;
  // A short global tail guarantees every stage reaches darkness at progress 1.
  const tools = painter(effect, plot, Math.min(1, (1 - p) * 8), LIMIT[stage] ?? 90);
  if (stage === 'cast') drawCast(p, clamp(radius / 0.8, 0.7, 1.6), tools);
  else if (stage === 'impact') drawImpact(p, clamp(radius, 0.6, 2.5), tools);
  else if (stage === 'pulse') drawPulse(p, clamp(radius, 0.5, 3), tools);
  else if (stage === 'aura') drawAura(p, clamp(radius, 0.6, 2.5), tools);
  else if (stage === 'zone') drawZone(p, clamp(radius, 0.8, 4), tools);
  else if (stage === 'projectile') drawProjectile(p, clamp(radius / 0.65, 0.7, 2), tools);
}

export default {
  id: 'ice-wave',
  duration: 1.15,
  draw,
  sounds: {
    cast: [
      { kind: 'noise', delay: 0, duration: 0.82, gain: 0.07, attack: 0.19, release: 0.36, cutoff: 2400, filterType: 'highpass' },
      { kind: 'noise', delay: 0.05, duration: 0.72, gain: 0.045, attack: 0.17, release: 0.3, cutoff: 470, filterType: 'lowpass' },
      { kind: 'tone', delay: 0.14, duration: 0.12, gain: 0.03, attack: 0.002, release: 0.1, frequency: 1760, endFrequency: 1510, type: 'triangle' },
      { kind: 'tone', delay: 0.27, duration: 0.1, gain: 0.034, attack: 0.002, release: 0.085, frequency: 1290, endFrequency: 1170, type: 'triangle' },
      { kind: 'tone', delay: 0.43, duration: 0.14, gain: 0.038, attack: 0.002, release: 0.12, frequency: 2180, endFrequency: 1840, type: 'triangle' },
      { kind: 'tone', delay: 0.62, duration: 0.11, gain: 0.027, attack: 0.002, release: 0.095, frequency: 1490, endFrequency: 1340, type: 'triangle' },
    ],
    impact: [
      { kind: 'noise', delay: 0, duration: 0.23, gain: 0.09, attack: 0.003, release: 0.2, cutoff: 4100, filterType: 'bandpass' },
      { kind: 'tone', delay: 0, duration: 0.28, gain: 0.055, attack: 0.004, release: 0.24, frequency: 196, endFrequency: 83, type: 'triangle' },
      { kind: 'tone', delay: 0.015, duration: 0.13, gain: 0.04, attack: 0.002, release: 0.115, frequency: 2700, endFrequency: 2340, type: 'triangle' },
      { kind: 'tone', delay: 0.085, duration: 0.16, gain: 0.033, attack: 0.002, release: 0.14, frequency: 1890, endFrequency: 1630, type: 'triangle' },
      { kind: 'tone', delay: 0.19, duration: 0.1, gain: 0.025, attack: 0.002, release: 0.085, frequency: 3180, endFrequency: 2780, type: 'triangle' },
    ],
    pulse: [
      { kind: 'noise', delay: 0, duration: 0.11, gain: 0.014, attack: 0.012, release: 0.08, cutoff: 2600, filterType: 'highpass' },
      { kind: 'tone', delay: 0.025, duration: 0.08, gain: 0.012, attack: 0.002, release: 0.065, frequency: 1470, endFrequency: 1320, type: 'triangle' },
    ],
  },
};
