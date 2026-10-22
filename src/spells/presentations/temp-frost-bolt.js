// Frost Bolt: a faceted ice lance with a spiralling frost contrail. The cast is
// a short inhale of frost motes at the hand, a white muzzle flash and a cold jet
// that sinks; the hit bursts at chest height, rains shards that skid to the
// ground and leaves a snowflake of rime (the bolt slows its target).
//
// Everything is authored in world metres around the effect origin and turned
// back into the adapter's heading-local frame, so glyph orientation can follow
// the real on-screen direction (1 m = 13 / 0.6 columns by 6.5 rows).
const COLS = 13 / 0.6, ROWS = 6.5;
const LIFT = 5 / ROWS; // projectiles are drawn 5 rows up per metre of height
const HAND = 1.5; // the bolt leaves (syo) and strikes (tyo) at 1.5 m

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const span = (value, from, to) => clamp((value - from) / (to - from), 0, 1);
const easeOut = t => 1 - (1 - t) ** 3;
const smooth = t => t * t * (3 - 2 * t);
const hash = (i, salt = 0) => {
  const v = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return v - Math.floor(v);
};

// White-hot core (0) through glacial cyan to deep blue (1).
const STOPS = [[250, 254, 255], [212, 246, 255], [150, 224, 255], [96, 180, 252], [62, 126, 238], [40, 80, 196]];
const ICE = [];
for (let i = 0; i < 24; i++) {
  const t = i / 23 * (STOPS.length - 1), k = Math.min(STOPS.length - 2, Math.floor(t)), f = t - k;
  ICE.push(STOPS[k].map((c, n) => Math.round(c + (STOPS[k + 1][n] - c) * f)));
}
const ice = t => ICE[Math.round(clamp(t, 0, 1) * (ICE.length - 1))];

// Cells crossed by a world vector (Chebyshev distance on the character grid).
const cells = (mx, mz) => Math.max(Math.abs(mx) * COLS, Math.abs(mz) * ROWS);

// Line glyph that matches a world direction as it appears on screen.
function lineGlyph(mx, mz) {
  const cx = mx * COLS, cy = mz * ROWS;
  const a = Math.atan2(Math.abs(cy), Math.abs(cx));
  if (a < 0.33) return '-';
  if (a > 1.13) return '|';
  return cx * cy > 0 ? '\\' : '/';
}

// Arrow glyph for a world direction (cells are about twice as tall as wide).
function noseGlyph(mx, mz) {
  const px = mx * COLS, py = mz * ROWS * 2;
  if (Math.abs(px) > Math.abs(py)) return px > 0 ? '>' : '<';
  return py > 0 ? 'v' : '^';
}

// Ellipse angles spaced by on-screen arc length so rings never bunch at the
// ends. The screen ellipse ratio is fixed (COLS:ROWS), so one table serves all.
const ARC = (() => {
  const steps = 720, lengths = [0];
  for (let i = 1; i <= steps; i++) {
    const a = (i - 0.5) / steps * Math.PI * 2;
    lengths.push(lengths[i - 1] + Math.hypot(Math.sin(a) * COLS, Math.cos(a) * ROWS));
  }
  const total = lengths[steps], table = [];
  for (let j = 0, i = 0; j < 128; j++) {
    const target = j / 128 * total;
    while (lengths[i + 1] < target) i++;
    table.push((i + (target - lengths[i]) / (lengths[i + 1] - lengths[i])) / steps * Math.PI * 2);
  }
  return table;
})();
const arcAngle = u => {
  const w = (u % 1 + 1) % 1 * 128, i = Math.floor(w), f = w - i;
  const a = ARC[i], b = i === 127 ? Math.PI * 2 : ARC[i + 1];
  return a + (b - a) * f;
};

function view(effect, plot) {
  const age = Number.isFinite(effect.age) ? Math.max(0, effect.age) : 0;
  const life = Number.isFinite(effect.life) && effect.life > 0 ? effect.life : 1;
  const progress = clamp(Number.isFinite(effect.progress) ? effect.progress : age / life, 0, 1);
  const radius = clamp(Number.isFinite(effect.radius) ? effect.radius : 1, 0.45, 1.15); // larger radii would only thin the glyphs out
  const heading = Number.isFinite(effect.heading) ? effect.heading : 0;
  const c = Math.cos(heading), s = Math.sin(heading);
  // Contract: every stage reaches zero light at progress 1 without a pop.
  const env = span(1 - progress, 0, 0.25) ** 1.5;
  return {
    age, progress, radius, env,
    fx: s, fz: c, rx: c, rz: -s, // forward and right as world vectors
    put(mx, mz, char, color, light) {
      if (!(light > 0.004)) return;
      plot(mx * c - mz * s, mx * s + mz * c, char, color, Math.min(1, light) * env);
    },
  };
}

// --- projectile: faceted lance + helical contrail + shed frost motes --------
function lance(v, x0, z0, k, light) {
  const { fx, fz, rx, rz, age } = v;
  const nose = 0.62 * k, shoulder = 0.16 * k, back = -0.44 * k, width = 0.14 * k;
  const glint = (age * 2.6) % 1.4 - 0.2; // a specular glint sweeps nose to tail
  const along = Math.min(26, Math.max(4, Math.ceil(cells(fx, fz) * (nose - back))));
  const perCell = 1 / cells(rx, rz); // metres per character across the lance
  for (let i = 0; i <= along; i++) {
    const a = nose - (nose - back) * i / along;
    const half = a > shoulder ? width * (nose - a) / (nose - shoulder) : width * (0.18 + 0.82 * (a - back) / (shoulder - back));
    const front = (a - back) / (nose - back);
    const shine = Math.max(0, 1 - Math.abs((1 - front) - glint) * 6);
    const cx = x0 + fx * a, cz = z0 + fz * a;
    if (i === 0) { v.put(cx, cz, noseGlyph(fx, fz), ice(0), light); continue; }
    // Offsets snap to whole characters so facets never stack in one cell.
    const across = Math.min(3, Math.floor(half / perCell + 0.35));
    for (let j = -across; j <= across; j++) {
      const px = cx + rx * j * perCell, pz = cz + rz * j * perCell;
      if (j !== 0 && Math.abs(j) === across) {
        // Outline facets: forward of the shoulder they rake to the nose, behind it to the tail.
        const side = Math.sign(j), fwd = a > shoulder ? 1 : -1;
        const run = a > shoulder ? nose - shoulder : shoulder - back;
        const dx = fx * fwd * run - rx * side * width, dz = fz * fwd * run - rz * side * width;
        let char = lineGlyph(dx, dz);
        if (char === '-' && rz * side < 0) char = '_'; // the upper rim hugs the core
        v.put(px, pz, char, ice(0.3 + (1 - front) * 0.35 - shine * 0.3), light * (0.7 + shine * 0.3));
      } else {
        const core = across ? 1 - Math.abs(j) / across : 1;
        const heat = clamp(core * 0.25 + front * 0.65 + shine * 0.4, 0, 1);
        const char = heat > 0.84 ? '@' : heat > 0.68 ? '#' : heat > 0.5 ? '*' : heat > 0.3 ? '+' : ':';
        v.put(px, pz, char, ice((1 - heat) * 0.55), light * (0.5 + heat * 0.5));
      }
    }
  }
}

function contrail(v, x0, z0, k, length, light) {
  const { fx, fz, rx, rz, age } = v;
  const count = Math.min(16, Math.ceil(cells(fx, fz) * length / 1.8));
  const perCell = 1 / cells(rx, rz), grown = length / (1.45 * k);
  for (let strand = 0; strand < 2; strand++) {
    for (let i = 1; i <= count; i++) {
      const t = i / count, d = length * t;
      const wave = Math.sin((d + age * 3.2) * 7.5 / k + strand * Math.PI);
      const o = wave * (0.7 + 2.6 * t) * perCell * k; // the helix opens as it trails off
      const px = x0 - fx * d + rx * o, pz = z0 - fz * d + rz * o + t * t * 0.12 * LIFT; // cold air sinks
      const b = (1 - t) ** 1.25 * (0.55 + 0.35 * Math.abs(wave));
      const char = b > 0.62 ? '*' : b > 0.42 ? '+' : b > 0.2 ? ':' : '.';
      v.put(px, pz, char, ice(0.2 + t * 0.75), light * b);
    }
  }
  for (let j = 0; j < 12; j++) {
    const phase = (age * 2.1 + hash(j, 3)) % 1, side = hash(j, 4) < 0.5 ? -1 : 1;
    const d = phase * length * 1.1;
    const drift = (side * (0.6 + phase * 3.5) * perCell * k + Math.sin(age * 9 + j * 2.3) * 0.03) * grown;
    const twinkle = Math.sin(age * 23 + j * 4.1);
    const px = x0 - fx * d + rx * drift, pz = z0 - fz * d + rz * drift + phase * 0.25 * LIFT * grown;
    const char = phase < 0.2 ? '*' : twinkle > 0.75 ? '+' : phase < 0.6 ? "'" : '.';
    v.put(px, pz, char, ice(0.1 + phase * 0.8), light * (1 - phase) ** 1.5 * (0.75 + 0.25 * twinkle));
  }
}

function projectile(v) {
  const k = Math.min(1.3, v.radius / 0.65); // the runtime always flies it at 0.65
  const grow = 0.55 + 0.45 * easeOut(span(v.age, 0, 0.08));
  const tail = 1.45 * k * easeOut(span(v.age, 0, 0.14));
  contrail(v, -v.fx * 0.44 * k * grow, -v.fz * 0.44 * k * grow, k, tail + 0.02, 1);
  lance(v, 0, 0, k * grow, 1);
}

// --- cast: inhale, muzzle flash, sinking frost jet, shock ring, lingering motes
function ray(v, x0, z0, dx, dz, length, light, tone, maxCells) {
  const n = Math.min(maxCells, Math.max(1, Math.round(cells(dx, dz) * length / 1.3)));
  const char = lineGlyph(dx, dz);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    v.put(x0 + dx * length * t, z0 + dz * length * t, t > 0.85 ? '+' : char, ice(tone + t * 0.45), light * (1 - t * 0.55));
  }
}

function ring(v, x0, z0, radius, count, spin, light, tone, salt) {
  for (let i = 0; i < count; i++) {
    const a = arcAngle(i / count + spin), cos = Math.cos(a), sin = Math.sin(a);
    // Each crystal fades on its own schedule so the ring thins instead of popping.
    const own = clamp((light - hash(i, salt) * 0.55) / 0.45, 0, 1);
    const char = own > 0.7 ? lineGlyph(-sin, cos) : own > 0.35 ? '+' : '.';
    v.put(x0 + cos * radius, z0 + sin * radius, char, ice(tone + (1 - own) * 0.4), own);
  }
}

function cast(v) {
  const { age, progress: p, radius, fx, fz, rx, rz } = v;
  const k = radius / 0.8;
  const hx = fx * 0.35 * k, hz = fz * 0.35 * k - HAND * LIFT; // the casting hand / bolt spawn

  // Anticipation: frost motes spiral into the hand before the release.
  const gather = span(age, 0, 0.09);
  if (gather < 1) {
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2 + gather * 2.2, d = (0.95 - 0.9 * gather ** 2) * k * (0.8 + hash(i, 1) * 0.4);
      v.put(hx + Math.cos(a) * d, hz + Math.sin(a) * d * 0.8, gather > 0.6 ? '*' : '.', ice(0.5 - gather * 0.4),
        (0.35 + gather * 0.65) * (1 - span(gather, 0.85, 1)));
    }
  }

  // Release flash: a white star that blooms then retracts.
  const flash = span(age, 0.06, 0.1) * (1 - span(p, 0.1, 0.32));
  if (flash > 0) {
    v.put(hx, hz, flash > 0.6 ? '@' : '*', ice(0), flash);
    const reach = (0.18 + 0.42 * easeOut(span(p, 0.07, 0.2))) * k;
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2 + 0.2, long = i % 2 ? 0.55 : 1;
      ray(v, hx, hz, Math.cos(a), Math.sin(a), reach * long, flash, 0, i % 2 ? 3 : 6);
    }
  }

  // The frost jet: a cone of motes that decelerates, sinks and cools.
  for (let j = 0; j < 46; j++) {
    const born = 0.07 + hash(j, 2) * 0.22, life = 0.3 + hash(j, 5) * 0.32, t = age - born;
    if (t <= 0 || t >= life) continue;
    const spread = (hash(j, 6) - 0.5) * 0.9, speed = (3.2 + hash(j, 7) * 4.4) * k, drag = 5.5;
    const d = speed / drag * (1 - Math.exp(-drag * t));
    const ux = fx * Math.cos(spread) + rx * Math.sin(spread), uz = fz * Math.cos(spread) + rz * Math.sin(spread);
    const curl = Math.sin(age * 11 + j * 1.7) * 0.06 * t / life;
    const fall = 0.9 * t * t * LIFT;
    const heat = 1 - t / life;
    const char = heat > 0.75 ? '*' : heat > 0.5 ? '+' : heat > 0.25 ? ':' : '.';
    v.put(hx + ux * d - uz * curl, hz + uz * d + ux * curl + fall, char, ice(0.08 + (1 - heat) * 0.8), heat ** 0.8);
  }

  // Recoil shock ring around the hand, thinning as it widens.
  const shock = span(p, 0.06, 0.55);
  if (shock > 0 && shock < 1) {
    ring(v, hx, hz, (0.12 + 0.95 * easeOut(shock)) * k, 30, age * 0.05, 1 - smooth(shock), 0.1, 8);
  }

  // Lingering frost motes drift outward and settle, twinkling as they cool.
  const linger = span(p, 0.12, 0.3);
  for (let j = 0; j < 22; j++) {
    const a = hash(j, 9) * Math.PI * 2, d = (0.15 + hash(j, 10) * 0.75) * k * (0.4 + 0.6 * easeOut(span(p, 0.1, 0.9)));
    const sink = p * p * (0.4 + hash(j, 11) * 0.6) * LIFT;
    const x = hx + Math.cos(a) * d + fx * p * 0.5 * k + Math.sin(age * 3 + j) * 0.05;
    const z = hz + Math.sin(a) * d * 0.7 + fz * p * 0.5 * k + sink;
    const twinkle = Math.sin(age * 17 + j * 2.9);
    const own = linger * clamp((1 - p) * 1.4 - hash(j, 12) * 0.3, 0, 1);
    v.put(x, z, twinkle > 0.8 ? '*' : twinkle > 0.2 ? "'" : '.', ice(0.25 + p * 0.6), own * (0.6 + 0.4 * twinkle));
  }
}

const BRANCHES = [[0.45, 0.32], [0.72, 0.22]];

// --- impact: flash, shard rain, frost nova, rime snowflake, cold mist --------
function snowflake(v, grow, fadeOut) {
  const { radius: r } = v;
  for (let arm = 0; arm < 6; arm++) {
    const a = arm / 6 * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a);
    const length = 1.05 * r * grow;
    // Flat arms run along a row, so they need a glyph per cell to read as one line.
    const flat = lineGlyph(dx, dz) === '-';
    const n = Math.min(flat ? 22 : 14, Math.max(1, Math.round(cells(dx, dz) * length / (flat ? 1.05 : 1.6))));
    for (let i = 1; i <= n; i++) {
      const t = i / n, front = grow < 1 && i === n;
      const own = clamp((1 - fadeOut) * 1.7 - t * 0.7, 0, 1);
      v.put(dx * length * t, dz * length * t, front ? '*' : lineGlyph(dx, dz), ice(front ? 0 : 0.25 + t * 0.45), own * (0.9 - t * 0.25));
    }
    // Side branches sprout from the arm as the frost front passes them.
    for (const [at, size] of BRANCHES) {
      const reach = span(grow, at, Math.min(1, at + 0.35));
      if (reach <= 0) continue;
      const bx = dx * 1.05 * r * at, bz = dz * 1.05 * r * at;
      for (const turn of [-1, 1]) {
        const b = a + turn * Math.PI / 3, ex = Math.cos(b), ez = Math.sin(b), bl = size * r * reach;
        const level = lineGlyph(ex, ez) === '-';
        const m = Math.min(level ? 7 : 4, Math.max(1, Math.round(cells(ex, ez) * bl / (level ? 1.05 : 1.6))));
        const own = clamp((1 - fadeOut) * 1.7 - (at + 0.2) * 0.7, 0, 1);
        for (let i = 1; i <= m; i++) {
          v.put(bx + ex * bl * i / m, bz + ez * bl * i / m, lineGlyph(ex, ez), ice(0.35 + i / m * 0.35), own * 0.75);
        }
      }
    }
  }
}

function impact(v) {
  const { age, progress: p, radius: r, fx, fz, rx, rz } = v;
  const burstZ = -HAND * 0.85 * LIFT; // the bolt bursts at chest height

  // Strike flash: a hard white frame with a cross of light.
  const flash = 1 - span(p, 0, 0.2);
  if (flash > 0) {
    v.put(0, burstZ, flash > 0.5 ? '@' : '*', ice(0), flash);
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2 + 0.26;
      ray(v, 0, burstZ, Math.cos(a), Math.sin(a), (0.25 + 0.55 * easeOut(span(p, 0, 0.12))) * r * (i % 3 ? 0.7 : 1), flash, 0, 5);
    }
  }

  // Rime snowflake spreads over the ground beneath the target, then thaws from the tips.
  snowflake(v, easeOut(span(p, 0.06, 0.42)), span(p, 0.5, 1));

  // Frost nova running out along the ground.
  const nova = span(p, 0.04, 0.62);
  if (nova > 0 && nova < 1) ring(v, 0, 0, (0.3 + 1.25 * easeOut(nova)) * r, 34, age * 0.04, 1 - smooth(nova) * 0.95, 0.05, 13);

  // Shards: thrown forward from the burst, arcing down to skid and glint on the ground.
  for (let j = 0; j < 16; j++) {
    const back = j % 5 === 0;
    const spread = (hash(j, 14) - 0.5) * 2.5 + (back ? Math.PI : 0);
    const ux = fx * Math.cos(spread) + rx * Math.sin(spread), uz = fz * Math.cos(spread) + rz * Math.sin(spread);
    const speed = (2.4 + hash(j, 15) * 3.8) * r * (back ? 0.6 : 1), drag = 3.2;
    const rise = 0.6 + hash(j, 16) * 3, gravity = 22, h0 = HAND * 0.85;
    const landT = (rise + Math.sqrt(rise * rise + 2 * gravity * h0)) / gravity;
    const t = Math.min(age, landT), landed = age >= landT;
    const d = speed / drag * (1 - Math.exp(-drag * t)) + (landed ? Math.min(0.12, (age - landT) * 0.6) * r : 0);
    const h = landed ? 0 : h0 + rise * t - gravity * t * t / 2;
    const x = ux * d, z = uz * d - h * LIFT;
    const own = clamp((1 - p) * 1.5 - hash(j, 17) * 0.4, 0, 1);
    if (landed) {
      const glint = Math.sin(age * 21 + j * 3.3) > 0.55;
      v.put(x, z, glint ? '*' : ',', ice(glint ? 0.1 : 0.5), own * (glint ? 0.9 : 0.6));
      continue;
    }
    const vel = speed * Math.exp(-drag * t), vx = ux * vel, vz = uz * vel - (rise - gravity * t) * LIFT;
    const step = 1 / Math.max(0.001, cells(vx, vz));
    const char = lineGlyph(vx, vz);
    v.put(x, z, char, ice(0.05 + hash(j, 18) * 0.15), own);
    v.put(x - vx * step, z - vz * step, char, ice(0.4), own * 0.6);
  }

  // Cold mist curls up from the frosted ground and fades.
  for (let j = 0; j < 16; j++) {
    const a = hash(j, 19) * Math.PI * 2, d = (0.2 + hash(j, 20) * 0.9) * r;
    const up = span(p, 0.15, 1) * (0.3 + hash(j, 21) * 0.5);
    const x = Math.cos(a) * d + Math.sin(age * 4 + j * 1.9) * 0.08 * r;
    const z = Math.sin(a) * d - up * LIFT;
    const own = span(p, 0.15, 0.35) * clamp((1 - p) * 1.6 - hash(j, 22) * 0.4, 0, 1);
    v.put(x, z, up > 0.35 ? '.' : ':', ice(0.45 + up * 0.5), own * 0.7);
  }
}

// --- pulse: the bolt's quick crystalline report (life ~0.25 s) ---------------
function pulse(v) {
  const { age, progress: p, radius: r } = v;
  const z0 = -HAND * 0.85 * LIFT;
  const bloom = easeOut(span(p, 0, 0.55)), light = 1 - smooth(span(p, 0.2, 1));
  v.put(0, z0, p < 0.3 ? '@' : '*', ice(0), light);
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2 + 0.26;
    ray(v, 0, z0, Math.cos(a), Math.sin(a), (0.15 + 0.5 * bloom) * r * (i % 3 ? 0.7 : 1), light, 0.05, 5);
  }
  ring(v, 0, z0, (0.2 + 0.75 * bloom) * r, 20, age * 0.1, light, 0.15, 23);
}

// --- aura / zone (not used by this rune; kept as a slow rime ring) ----------
function rime(v) {
  const { age, progress: p, radius: r } = v;
  const settle = easeOut(span(p, 0, 0.2));
  ring(v, 0, 0, r * (0.7 + 0.3 * settle), 32, age * 0.03, settle, 0.25, 29);
  for (let j = 0; j < 14; j++) {
    const phase = (age * 0.5 + hash(j, 30)) % 1, a = hash(j, 31) * Math.PI * 2, d = r * (0.2 + 0.6 * hash(j, 32));
    v.put(Math.cos(a) * d, Math.sin(a) * d - phase * 0.6 * LIFT, phase < 0.3 ? '*' : '.', ice(0.3 + phase * 0.6),
      settle * Math.sin(phase * Math.PI) * 0.8);
  }
}

export default {
  id: 'temp-frost-bolt',
  duration: 0.85,
  draw(effect, plot) {
    const v = view(effect, plot);
    if (v.env <= 0) return;
    switch (effect.stage) {
      case 'cast': return cast(v);
      case 'projectile': return projectile(v);
      case 'impact': return impact(v);
      case 'pulse': return pulse(v);
      default: return rime(v);
    }
  },
  sounds: {
    cast: [
      // Recorded breath rushes out with a small ice fracture at the muzzle.
      { kind: 'recording', url: '/assets/audio/spells/seithr/cold-breath.wav', gain: 0.36, rate: 1.2, delay: 0 },
      { kind: 'recording', url: '/assets/audio/spells/seithr/ice-tick.wav', gain: 0.26, rate: 1.12, delay: 0.075 },
    ],
    impact: [
      // A close lake-ice fracture lands first; loose snow skitters after it.
      { kind: 'recording', url: '/assets/audio/spells/seithr/ice-crack.wav', gain: 0.57, rate: 1.16, delay: 0 },
      { kind: 'recording', url: '/assets/audio/spells/seithr/snow-scuff.wav', gain: 0.29, rate: 1.1, delay: 0.09 },
    ],
    pulse: [
      // The repeated visual burst only sheds one quiet physical ice grain.
      { kind: 'recording', url: '/assets/audio/spells/seithr/ice-tick.wav', gain: 0.14, rate: 1.18, delay: 0.006 },
    ],
  },
};
