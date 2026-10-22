// Flight of the Gladiator follows the rune's own choreography: a gladius is raised
// inside a rally of embers, the gladiator springs back on burning wings (0.6 s),
// dives forward (1.2 s) and stamps the ground just before the shockwaves land.
const WHITE = [255, 250, 232];
const IVORY = [255, 239, 192];
const GOLD = [255, 205, 91];
const AMBER = [255, 163, 35];
const COPPER = [237, 128, 49];
const EMBER = [201, 72, 28];
const ASH = [112, 44, 26];

// A cooling ramp from ash to white heat, sampled into a table once.
const STOPS = [ASH, EMBER, COPPER, AMBER, GOLD, IVORY, WHITE];
const HEAT = Array.from({ length: 33 }, (_, i) => {
  const t = i / 32 * (STOPS.length - 1), k = Math.min(STOPS.length - 2, Math.floor(t)), f = t - k;
  return STOPS[k].map((c, j) => Math.round(c + (STOPS[k + 1][j] - c) * f));
});
const RAMP = '.,:-=+*#%@';

const DURATION = 1.45;
const LAUNCH = 0.6 / DURATION; // the backward lunge
const DIVE = 1.2 / DURATION; // the forward, downward lunge
const LAND = 1.36 / DURATION; // feet touch down just ahead of the rupture
const APEX = 2.3; // metres behind the caster at the top of the flight
const COL = 1 / 26; // exactly one column, so neighbouring glyphs never leave gaps
const ROW = 1 / 6.5; // exactly one row

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeOut = t => 1 - (1 - t) ** 3;
const easeOutBack = t => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;
const hash = (i, s = 0) => { const v = Math.sin(i * 127.1 + s * 311.7) * 43758.5453; return v - Math.floor(v); };
const heat = t => HEAT[Math.round(clamp01(t) * 32)];
const ramp = v => RAMP[Math.min(RAMP.length - 1, Math.max(0, Math.floor(v * RAMP.length)))];

// The glyph that best follows a local direction once it is projected to cells
// (26 columns and 6.5 rows per metre, rows about twice as tall as columns).
function slant(dx, dz) {
  const ax = Math.abs(dx * 26), ay = Math.abs(dz * 13);
  if (ay < ax * 0.42) return '-';
  if (ax < ay * 0.42) return '|';
  return dx * dz > 0 ? '\\' : '/';
}

function progress(effect) {
  const value = Number.isFinite(effect.progress) ? effect.progress
    : Number.isFinite(effect.age) && effect.life > 0 ? effect.age / effect.life : 0;
  return clamp01(value);
}

// Where the gladiator's crest is during the cast; local -z is behind the caster.
function flight(p, out) {
  if (p < LAUNCH) {
    const a = p / LAUNCH;
    out.x = 0; out.z = 0.12 * smooth(0.6, 1, a); out.open = 0; out.fold = 0;
  } else if (p < DIVE) {
    const u = (p - LAUNCH) / (DIVE - LAUNCH);
    out.x = 0.16 * Math.sin(u * Math.PI); out.z = 0.12 - (APEX + 0.12) * easeOut(u);
    out.open = easeOutBack(Math.min(1, u * 1.5)); out.fold = 0;
  } else if (p < LAND) {
    const v = (p - DIVE) / (LAND - DIVE);
    out.x = 0; out.z = -APEX * (1 - v * v);
    out.open = 1 - 0.8 * smooth(0, 0.75, v); out.fold = smooth(0, 0.8, v);
  } else {
    out.x = 0; out.z = 0; out.open = 0.2; out.fold = 1;
  }
  return out;
}

// A broad gladius, point toward -z: hot core, dimmer edges, guard, grip and pommel.
function sword(plot, x, z, reveal, b, hot = 1) {
  if (b <= 0.02 || reveal <= 0.02) return;
  const rows = Math.max(1, Math.round(1.05 * reveal / ROW));
  for (let j = 0; j < rows; j++) {
    const t = (j + 0.5) / rows, bz = z - (j + 1) * ROW;
    plot(x, bz, '|', heat(0.78 + 0.22 * hot * (1 - t * 0.4)), b);
    if (t < 0.72) {
      plot(x - COL, bz, '|', heat(0.55 + 0.2 * hot), b * 0.6);
      plot(x + COL, bz, '|', heat(0.55 + 0.2 * hot), b * 0.6);
    }
  }
  if (reveal > 0.35) plot(x, z - (rows + 1) * ROW, '^', WHITE, b);
  for (let i = -4; i <= 4; i++) plot(x + i * COL, z, i === 0 ? '+' : '=', heat(0.82 - Math.abs(i) * 0.05), b * (1 - Math.abs(i) * 0.05));
  plot(x, z + ROW, '#', COPPER, b * 0.85);
  plot(x, z + 2 * ROW, 'o', GOLD, b * 0.85);
}

// Burning wings: six feathers a side hang from a rising leading edge.
// open spreads them, fold sweeps them back for the dive.
function wings(plot, x, z, open, fold, b, age) {
  if (b <= 0.02) return;
  const sweep = 1 - 2 * fold;
  for (const side of [-1, 1]) {
    for (let f = 0; f < 6; f++) {
      const t = (f + 1) / 6;
      const bx = x + side * (0.16 + t * 1.2 * open);
      const bz = z + 0.02 - open * (0.78 * t - 0.22 * t * t);
      const len = 0.32 + 0.55 * t;
      const dx = side * (0.1 + 0.45 * t) * (0.35 + 0.65 * Math.min(1, open)), dz = sweep;
      const dl = Math.hypot(dx, dz) || 1;
      const flutter = 0.05 * Math.sin(age * 15 + f * 1.3 + side);
      // One glyph per row or per two columns keeps each feather a continuous stroke.
      const n = Math.max(3, Math.min(7, Math.ceil(Math.max(Math.abs(dz / dl * len) * 6.5, Math.abs(dx / dl * len) * 12)) + 1));
      const ridge = slant(side * 1.2 * open + side * 0.05, -open * (0.78 - 0.44 * t));
      for (let j = 0; j < n; j++) {
        const s = j / (n - 1);
        const glow = 0.95 - 0.6 * s - 0.15 * (1 - t) + 0.06 * Math.sin(age * 23 + f * 3 + j * 1.7);
        plot(bx + dx / dl * len * s + flutter * s, bz + dz / dl * len * s,
          j === 0 ? ridge : slant(dx, dz), heat(glow), b * (1 - 0.5 * s));
      }
    }
  }
}

const head = { x: 0, z: 0, open: 0, fold: 0 };
const past = { x: 0, z: 0, open: 0, fold: 0 };

function drawCast(p, age, plot) {
  const a = Math.min(1, p / LAUNCH);
  flight(p, head);

  // Rally: a ground ring contracts and brightens, then is kicked outward at launch.
  const launch = clamp01((p - LAUNCH) / 0.18);
  const ringR = 1.7 - 0.85 * easeOut(a) + 1.25 * easeOut(launch);
  const ringB = (0.3 + 0.6 * a) * (1 - launch);
  if (ringB > 0.02) {
    for (let i = 0; i < 48; i++) {
      const ang = i / 48 * Math.PI * 2 + age * 0.6, c = Math.cos(ang), s = Math.sin(ang);
      const flick = 0.75 + 0.25 * Math.sin(age * 19 + i * 2.3);
      plot(c * ringR, s * ringR, slant(-s, c), heat(0.45 + 0.4 * a + 0.15 * launch), ringB * flick);
      if (i % 6 === 0 && launch < 1) {
        const lick = (0.18 + 0.14 * Math.sin(age * 11 + i)) * (0.4 + 0.6 * a);
        plot(c * ringR, s * ringR - lick, '*', heat(0.7 + 0.2 * a), ringB * 0.8 * flick);
        plot(c * ringR, s * ringR - lick * 2, '\'', heat(0.45), ringB * 0.5 * flick);
      }
    }
  }

  // Embers spiral in to the raised blade while the rally gathers.
  const gather = smooth(0, 0.25, a) * (1 - smooth(0.05, 0.25, launch));
  if (gather > 0.02) {
    for (let k = 0; k < 28; k++) {
      const q = (a * 1.7 + hash(k, 1)) % 1;
      const r = (1.3 + 1.1 * hash(k, 2)) * (1 - q) ** 1.5 + 0.12;
      const ang = hash(k, 3) * Math.PI * 2 + q * 2.4;
      const b = Math.sin(q * Math.PI) * gather;
      plot(Math.cos(ang) * r, Math.sin(ang) * r - q * 0.5, q > 0.7 ? '*' : q > 0.35 ? '+' : '.', heat(0.4 + 0.55 * q), b);
    }
  }

  // Flight trail and dive streak follow the crest's own path.
  if (p > LAUNCH && p < LAND + 0.02) {
    const trailB = 1 - smooth(LAND - 0.02, LAND + 0.02, p);
    for (let k = 1; k <= 13; k++) {
      const pk = p - k * 0.016;
      if (pk < LAUNCH) break;
      flight(pk, past);
      const tail = (1 - k / 14) ** 1.3 * trailB * smooth(0.8, 2.5, Math.abs(head.z - past.z) / (k * 0.016 * DURATION));
      const w = 0.13 * (1 - k / 14) + 0.03;
      const sway = 0.05 * Math.sin(age * 21 + k * 1.9);
      const speed = Math.abs(head.z - past.z) / (k * 0.016 * DURATION);
      if (speed < 0.8) continue;
      const fast = speed > 5;
      plot(past.x + sway, past.z - 0.2, fast ? '|' : ':', heat(0.92 - k / 14 * 0.7), tail);
      plot(past.x - w + sway, past.z - 0.1, k % 2 ? '.' : ',', heat(0.6 - k / 14 * 0.45), tail * 0.6);
      plot(past.x + w + sway, past.z - 0.1, k % 2 ? ',' : '.', heat(0.6 - k / 14 * 0.45), tail * 0.6);
    }
  }

  // Sparks shed from the wing tips fall away under gravity.
  for (let k = 0; k < 24; k++) {
    const birth = LAUNCH + 0.02 + (k + hash(k, 4)) / 24 * (LAND - LAUNCH - 0.02);
    const t = (p - birth) * DURATION;
    if (t <= 0 || t > 0.38) continue;
    flight(birth, past);
    const side = k % 2 ? 1 : -1, open = Math.min(1.1, past.open);
    const vx = side * (0.5 + 0.9 * hash(k, 5)), vz = -0.5 + 0.9 * hash(k, 6), drag = (1 - Math.exp(-3 * t)) / 3;
    const life = t / 0.38;
    plot(past.x + side * (0.16 + 1.2 * open) + vx * drag, past.z - 0.55 * open + vz * drag + 1.4 * t * t,
      life < 0.3 ? '*' : life < 0.65 ? '+' : '.', heat(0.95 - life * 0.75), (1 - life) * 0.9 * (1 - smooth(LAND, 1, p)));
  }

  // The crest itself: blade rises from the ground, then flies on burning wings.
  const crestB = p < LAND ? 0.55 + 0.45 * smooth(0, 0.6, a) : 1 - smooth(LAND, 1, p);
  const reveal = easeOutBack(Math.min(1, a * 1.3));
  const hot = p < LAUNCH ? 0.4 + 0.6 * smooth(0.6, 1, a) : 1;
  sword(plot, head.x, head.z, Math.min(1.08, reveal), crestB, hot);
  if (p > LAUNCH && p < LAND) wings(plot, head.x, head.z, head.open, head.fold, crestB * smooth(0, 0.3, head.open), age);

  // Landing: a white stamp, a cracked ground ring and the wings bursting into embers.
  if (p >= LAND) {
    const w = (p - LAND) / (1 - LAND), fade = (1 - w) ** 1.2;
    plot(0, 0, '@', WHITE, fade);
    for (let i = 0; i < 6; i++) {
      const ang = i / 6 * Math.PI * 2;
      plot(Math.cos(ang) * 0.12, Math.sin(ang) * 0.12, '#', heat(1 - w * 0.4), fade * 0.9);
    }
    const r = 0.35 + 1.5 * easeOut(w);
    for (let i = 0; i < 36; i++) {
      const ang = i / 36 * Math.PI * 2, c = Math.cos(ang), s = Math.sin(ang);
      const jag = 1 + 0.07 * Math.sin(i * 2.7);
      plot(c * r * jag, s * r * jag, slant(-s, c), heat(1 - w * 0.6), fade);
      if (i % 2 === 0) plot(c * r * 0.62, s * r * 0.62, i % 4 ? ':' : '=', heat(0.75 - w * 0.5), fade * 0.55);
    }
    for (let k = 0; k < 22; k++) {
      const ang = hash(k, 7) * Math.PI * 2, speed = 1.8 + 2 * hash(k, 8), t = w * (1 - LAND) * DURATION;
      const d = speed * (1 - Math.exp(-5 * t)) / 5;
      const vx = Math.cos(ang), vz = Math.sin(ang) - 0.6;
      plot(vx * (0.3 + d), vz * (0.15 + d) + 2 * t * t, w < 0.45 ? slant(vx, vz) : '.', heat(0.95 - w * 0.6), fade);
    }
  }
}

function drawImpact(effect, p, plot) {
  const size = Math.max(0.6, Math.min(2.4, Number.isFinite(effect.radius) ? effect.radius : 1));
  const t = p * (effect.life > 0 ? effect.life : 0.6);
  const fade = 1 - p;

  // A white-hot contact flash: a dense star that shrinks as it cools.
  if (p < 0.24) {
    const f = 1 - p / 0.24, arm = Math.max(1, Math.round(4 * f * size));
    plot(0, 0, '@', WHITE, 1);
    for (let i = 1; i <= arm; i++) {
      const b = f * (1 - (i - 1) / (arm + 1));
      plot(-i * COL, 0, '-', heat(1 - i * 0.08), b);
      plot(i * COL, 0, '-', heat(1 - i * 0.08), b);
    }
    for (const s of [-1, 1]) {
      plot(0, s * ROW, '|', IVORY, f * 0.9);
      plot(-COL, s * ROW, s < 0 ? '\\' : '/', heat(0.85), f * 0.7);
      plot(COL, s * ROW, s < 0 ? '/' : '\\', heat(0.85), f * 0.7);
    }
  }

  // Two crossing gladius cuts: drawn on fast as thick 45-degree strokes, white at
  // their leading edge, then eroded from the tail into falling sparks.
  const H = Math.max(3, Math.min(9, Math.round(5 * size)));
  for (let cut = 0; cut < 2; cut++) {
    const side = cut ? -1 : 1, start = cut * 0.06;
    const head = easeOut(clamp01((p - start) / 0.1)), tail = smooth(0.2 + start, 0.62 + start, p);
    if (head <= 0) continue;
    const ch = side > 0 ? '\\' : '/';
    for (let j = -H; j <= H; j++) {
      const u = (j + H) / (2 * H);
      if (u > head + 1e-6) break;
      const x = side * j * 2 * COL, z = j * ROW;
      if (u < tail) {
        // The eroded part sheds a spark that drifts off the stroke and cools.
        const age = (tail - u) * 2.2;
        if (age < 1 && (j & 1) === 0) {
          const drift = age * (0.18 + 0.2 * hash(j + cut * 31, 30));
          plot(x + side * drift * 0.4, z + drift, age < 0.4 ? ':' : '.', heat(0.75 - age * 0.5), fade * (1 - age) * 0.8);
        }
        continue;
      }
      const lead = 1 - Math.min(1, (head - u) * 3.5);
      const color = lead > 0.75 && p < 0.3 ? WHITE : heat(0.98 - p * 0.55 - (1 - lead) * 0.2);
      const b = fade * (0.55 + 0.45 * lead);
      plot(x, z, ch, color, b);
      plot(x + COL, z, ch, heat(0.8 - p * 0.5 - (1 - lead) * 0.2), b * 0.75);
    }
  }

  // A stamped ground ring with a cooler wake, thinning out as it spreads.
  const r = size * (0.4 + 1.1 * easeOut(p));
  const ringB = (1 - p) ** 1.4 * smooth(0.03, 0.09, p);
  for (let i = 0; ringB > 0.02 && i < 44; i++) {
    if (hash(i, 9) < p * 0.6) continue;
    const ang = i / 44 * Math.PI * 2, c = Math.cos(ang), s = Math.sin(ang);
    plot(c * r, s * r, slant(-s, c), heat(0.95 - p * 0.7), ringB);
    if (i % 2 === 0) plot(c * r * 0.84, s * r * 0.84, i % 4 ? '.' : ':', heat(0.6 - p * 0.45), ringB * 0.5);
  }

  // Ember spray: fast streaks with a short tail, slowing under drag to falling sparks.
  for (let k = 0; k < 24; k++) {
    const span = 0.45 + 0.55 * hash(k, 10);
    const life = p / span;
    if (life >= 1) continue;
    const ang = hash(k, 11) * Math.PI * 2, speed = (1.4 + 2.2 * hash(k, 12)) * size;
    const vx = Math.cos(ang), vz = Math.sin(ang) * 0.8 - 0.35;
    const d = speed * (1 - Math.exp(-5 * t)) / 5, v = speed * Math.exp(-5 * t);
    const x = vx * d, z = vz * d + 1.6 * t * t;
    const b = (1 - life) * (0.6 + 0.4 * hash(k, 13));
    plot(x, z, v > 1.2 ? slant(vx, vz + 3.2 * t) : life < 0.7 ? '+' : '.', heat(1 - life * 0.85), b);
    if (v > 0.9) plot(x - vx * 0.06 * v / speed * size, z - vz * 0.06 * v / speed * size, '.', heat(0.7 - life * 0.6), b * 0.55);
  }

  // Cinders smoulder where the blow landed.
  const smoulder = smooth(0.15, 0.32, p) * fade;
  if (smoulder > 0.02) {
    for (let k = 0; k < 12; k++) {
      const ang = hash(k, 14) * Math.PI * 2, d = (0.12 + 0.45 * hash(k, 15)) * size;
      const flick = 0.55 + 0.45 * Math.sin(t * 17 + k * 2.1);
      plot(Math.cos(ang) * d, Math.sin(ang) * d - 0.1 * p, k % 3 ? '.' : ':', heat(0.35 + 0.2 * flick), smoulder * flick * 0.8);
    }
  }
}

// A shockwave ring scaled to the burst radius: bright leading edge, cooler wake, ejecta.
function drawPulse(effect, p, age, plot) {
  const R = Math.max(0.5, Math.min(12, Number.isFinite(effect.radius) ? effect.radius : 1));
  const e = easeOut(p), r = R * (0.45 + 0.55 * e);
  const fade = (1 - p) ** 1.3 * (0.35 + 0.65 * smooth(0, 0.08, p));
  const n = Math.max(24, Math.min(58, Math.round(20 + R * 8)));
  const spin = R * 0.37;
  for (let i = 0; i < n; i++) {
    const ang = i / n * Math.PI * 2 + spin, c = Math.cos(ang), s = Math.sin(ang);
    const wob = 1 + 0.03 * Math.sin(i * 2.7 + age * 30);
    plot(c * r * wob, s * r * wob, slant(-s, c), heat(1 - 0.75 * p), fade);
  }
  const m = Math.round(n / 2.6), inner = r * 0.86 - 0.05 * R;
  for (let i = 0; i < m; i++) {
    const ang = (i + 0.5) / m * Math.PI * 2 + spin;
    plot(Math.cos(ang) * inner, Math.sin(ang) * inner, ramp(0.25 + 0.2 * (1 - p)), heat(0.62 - 0.5 * p), fade * 0.55);
  }
  for (let k = 0; k < 8; k++) {
    const ang = hash(k, R) * Math.PI * 2, d = r + R * 0.28 * e * hash(k, R + 1);
    plot(Math.cos(ang) * d, Math.sin(ang) * d - 0.5 * Math.sin(p * Math.PI) * R * 0.15, p < 0.4 ? '*' : '.', heat(0.9 - p * 0.6), fade * 0.8);
  }
}

// The Last Stand buff: a burning laurel wreath on the ground. Its two branches grow
// up from the stem knot, a shimmer of heat climbs them, and at the end the leaves
// burn away from the tips into rising embers.
function drawAura(effect, p, age, plot) {
  const size = Math.max(0.6, Math.min(2, Number.isFinite(effect.radius) ? effect.radius : 1));
  const grow = easeOutBack(clamp01(p / 0.22));
  const fade = 1 - smooth(0.8, 1, p);
  const drawOn = easeOut(clamp01(p / 0.28)), burn = smooth(0.55, 0.97, p);
  const R = 0.95 * size * (0.8 + 0.2 * grow);
  const N = 20;
  for (const side of [-1, 1]) {
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      if (t > drawOn + 1e-6) break;
      // From the knot at the bottom (+z) round to just short of the top.
      const th = 0.2 + t * (Math.PI - 0.62);
      const s = Math.sin(th), c = Math.cos(th);
      const x = side * s * R, z = c * R;
      const tx = side * c, tz = -s; // along the branch, toward its tip
      const nx = side * s, nz = c; // outward from the wreath
      const ember = t - (1 - burn); // > 0 once this leaf has caught and burnt away
      if (ember > 0) {
        const rise = clamp01(ember * 2.2);
        if (i % 3 === 0 && rise < 1) {
          plot(x + 0.06 * Math.sin(age * 7 + i), z - rise * 0.75 * size, rise < 0.35 ? '*' : rise < 0.7 ? '\'' : '.',
            heat(0.9 - rise * 0.6), fade * (1 - rise));
        }
        continue;
      }
      // A heat shimmer runs up each branch; the newest leaves arrive white-hot.
      const fresh = clamp01(1 - (drawOn - t) * 5);
      const shimmer = 0.5 + 0.5 * Math.sin(age * 7 - t * 7);
      const scorch = clamp01(1 - (1 - burn - t) * 6); // leaves about to catch glow hotter
      const glow = Math.min(1, 0.62 + 0.2 * shimmer + 0.25 * fresh + 0.3 * scorch);
      plot(x, z, slant(tx, tz), heat(glow - 0.25), fade * 0.75);
      // Leaves point forward along the branch, one outside and one inside.
      {
        const out = i % 2 ? -1 : 1;
        const lx = x + (nx * out * 0.1 + tx * 0.05) * size, lz = z + (nz * out * 0.1 + tz * 0.05) * size * 2;
        plot(lx, lz, slant(tx + nx * out * 0.9, tz + nz * out * 0.9), heat(glow), fade * (0.7 + 0.3 * shimmer) * (out > 0 ? 1 : 0.8));
      }
    }
  }
  // The knot where the branches meet, and a small flame crest in the gap at the top.
  const knot = fade * smooth(0, 0.08, p);
  plot(0, R + ROW, '@', heat(0.9), knot);
  plot(-COL, R + ROW, '(', heat(0.7), knot * 0.8);
  plot(COL, R + ROW, ')', heat(0.7), knot * 0.8);
  const crest = fade * smooth(0.18, 0.3, p) * (1 - burn);
  if (crest > 0.02) {
    const lick = 0.6 + 0.4 * Math.sin(age * 11);
    plot(0, -R, '^', WHITE, crest);
    plot(-COL, -R + ROW * 0.5, '/', heat(0.85), crest * 0.85);
    plot(COL, -R + ROW * 0.5, '\\', heat(0.85), crest * 0.85);
    plot(0, -R - ROW * (1 + lick), '\'', heat(0.6), crest * lick * 0.7);
  }
  // A few embers drift up off the wreath while it burns.
  for (let k = 0; k < 10; k++) {
    const q = (age * 0.8 + hash(k, 16)) % 1;
    const ang = hash(k, 17) * Math.PI * 2, d = R * (0.9 + 0.15 * hash(k, 18));
    plot(Math.cos(ang) * d + 0.08 * Math.sin(age * 5 + k), Math.sin(ang) * d - q * 0.8 * size,
      q < 0.35 ? '+' : '.', heat(0.85 - q * 0.6), Math.sin(q * Math.PI) * fade * smooth(0.1, 0.3, p) * 0.7);
  }
}

// A burning arena circle around a planted gladius (not used by this rune's mechanics).
function drawZone(effect, p, age, plot) {
  const R = Math.max(0.6, Math.min(8, Number.isFinite(effect.radius) ? effect.radius : 1));
  const fade = smooth(0, 0.1, p) * (1 - smooth(0.75, 1, p));
  const n = Math.max(24, Math.min(56, Math.round(R * 14)));
  for (let i = 0; i < n; i++) {
    const ang = i / n * Math.PI * 2, c = Math.cos(ang), s = Math.sin(ang);
    const flick = 0.7 + 0.3 * Math.sin(age * 17 + i * 2.3);
    plot(c * R, s * R, slant(-s, c), heat(0.55 + 0.25 * flick), fade * flick);
    if (i % 3 === 0) {
      const lick = (0.2 + 0.18 * (0.5 + 0.5 * Math.sin(age * 8 + i))) * Math.min(1.5, R * 0.5);
      plot(c * R, s * R - lick * 0.5, '*', heat(0.85), fade * flick);
      plot(c * R, s * R - lick * 1.3, '\'', heat(0.5), fade * flick * 0.55);
    }
  }
  sword(plot, 0, 0.3, 0.8, fade * 0.85, 0.6);
  for (let k = 0; k < 18; k++) {
    const q = (age * 0.7 + hash(k, 19)) % 1, ang = hash(k, 20) * Math.PI * 2, d = R * Math.sqrt(hash(k, 21));
    plot(Math.cos(ang) * d, Math.sin(ang) * d - q * 1.1, q < 0.4 ? '+' : '.', heat(0.85 - q * 0.6), Math.sin(q * Math.PI) * fade * 0.7);
  }
}

// A thrown gladius, point forward (+z), dragging a flickering fire trail.
function drawProjectile(p, age, plot) {
  const fade = Math.min(1, (1 - p) * 4) * smooth(0, 0.04, p + 0.02);
  if (fade <= 0) return;
  for (let j = 0; j < 6; j++) {
    const t = j / 5, z = 0.5 - t * 0.75;
    plot(0, z, '|', heat(1 - t * 0.25), fade);
    if (j > 0 && j < 5) { plot(-0.045, z, '|', AMBER, fade * 0.55); plot(0.045, z, '|', AMBER, fade * 0.55); }
  }
  plot(0, 0.62, '*', WHITE, fade);
  for (let i = -3; i <= 3; i++) plot(i * 0.05, -0.3, i === 0 ? '+' : '=', GOLD, fade * (1 - Math.abs(i) * 0.08));
  plot(0, -0.44, '#', COPPER, fade * 0.85);
  for (let k = 1; k <= 12; k++) {
    const t = k / 12, w = Math.sin(age * 24 + k * 1.7) * 0.06 * t;
    plot(w, -0.5 - k * 0.11, k < 4 ? ':' : '.', heat(0.9 - t * 0.75), fade * (1 - t) ** 1.2);
  }
  for (let k = 0; k < 10; k++) {
    const q = (age * 3 + hash(k, 22)) % 1, side = k % 2 ? 1 : -1;
    plot(side * q * (0.15 + 0.2 * hash(k, 23)), -0.45 - q * 0.9, q < 0.4 ? '*' : '.', heat(0.85 - q * 0.6), Math.sin(q * Math.PI) * fade * 0.75);
  }
}

function draw(effect, plot) {
  const p = progress(effect);
  if (p >= 1) return;
  const age = Number.isFinite(effect.age) ? effect.age : p * (effect.life > 0 ? effect.life : DURATION);
  const dot = (x, z, char, color, brightness) => {
    if (brightness > 0.015) plot(x, z, char, color, brightness > 1 ? 1 : brightness);
  };
  switch (effect.stage) {
    case 'projectile': drawProjectile(p, age, dot); break;
    case 'impact': drawImpact(effect, p, dot); break;
    case 'pulse': drawPulse(effect, p, age, dot); break;
    case 'aura': drawAura(effect, p, age, dot); break;
    case 'zone': drawZone(effect, p, age, dot); break;
    default: drawCast(p, age, dot);
  }
}

export default {
  id: 'temp-last-stand',
  duration: 1.45,
  draw,
  sounds: {
    // A cracked war horn and two laboured double heartbeats gather the embers.
    // Close, low onsets tighten with effort; each beat falls back into the body.
    cast: [
      { kind: 'tone', delay: 0, type: 'sawtooth', frequency: 43, endFrequency: 46, detune: -11, filterType: 'lowpass', cutoff: 245, Q: 1.2, duration: 1.05, gain: 0.055, attack: 0.16, decay: 0.22, sustain: 0.45, release: 0.38 },
      { kind: 'tone', delay: 0.08, type: 'sine', frequency: 79, endFrequency: 42, duration: 0.19, gain: 0.075, attack: 0.009, decay: 0.065, sustain: 0.28, release: 0.1 },
      { kind: 'tone', delay: 0.23, type: 'triangle', frequency: 83, endFrequency: 48, cutoff: 240, duration: 0.17, gain: 0.055, attack: 0.008, decay: 0.05, sustain: 0.22, release: 0.095 },
      { kind: 'tone', delay: 0.55, type: 'sine', frequency: 87, endFrequency: 43, duration: 0.19, gain: 0.068, attack: 0.01, decay: 0.06, sustain: 0.25, release: 0.105 },
      { kind: 'tone', delay: 0.7, type: 'triangle', frequency: 91, endFrequency: 46, cutoff: 260, duration: 0.18, gain: 0.049, attack: 0.008, decay: 0.05, sustain: 0.2, release: 0.11 },
      { kind: 'noise', delay: 0.36, filterType: 'bandpass', cutoff: 480, Q: 0.85, playbackRate: 0.65, duration: 0.86, gain: 0.048, attack: 0.19, decay: 0.2, sustain: 0.42, release: 0.4 },
    ],
    // The landing closes like ember-black armour: a heavy stamp, answering
    // heartbeat, strained iron resonance, and furnace ash settling behind it.
    impact: [
      { kind: 'tone', delay: 0, type: 'sine', frequency: 116, endFrequency: 35, duration: 0.45, gain: 0.11, attack: 0.006, decay: 0.09, sustain: 0.24, release: 0.3 },
      { kind: 'noise', delay: 0, filterType: 'lowpass', cutoff: 590, Q: 0.8, playbackRate: 0.6, duration: 0.3, gain: 0.065, attack: 0.004, decay: 0.065, sustain: 0.16, release: 0.2 },
      { kind: 'tone', delay: 0.18, type: 'triangle', frequency: 78, endFrequency: 39, cutoff: 240, duration: 0.25, gain: 0.045, attack: 0.008, decay: 0.055, sustain: 0.23, release: 0.17 },
      { kind: 'tone', delay: 0.015, type: 'triangle', frequency: 173, endFrequency: 151, detune: -17, cutoff: 430, duration: 0.67, gain: 0.04, attack: 0.005, decay: 0.13, sustain: 0.19, release: 0.48 },
      { kind: 'noise', delay: 0.12, filterType: 'bandpass', cutoff: 890, Q: 1.1, playbackRate: 0.72, duration: 0.54, gain: 0.022, attack: 0.035, decay: 0.11, sustain: 0.2, release: 0.36 },
    ],
    // Small paired pressure knocks support successive shockwaves without
    // repeating the full landing; the ember scrape dies between pulses.
    pulse: [
      { kind: 'tone', delay: 0, type: 'sine', frequency: 72, endFrequency: 42, duration: 0.12, gain: 0.011, attack: 0.005, decay: 0.025, sustain: 0.2, release: 0.08 },
      { kind: 'tone', delay: 0.08, type: 'triangle', frequency: 67, endFrequency: 41, cutoff: 190, duration: 0.11, gain: 0.008, attack: 0.004, decay: 0.025, sustain: 0.16, release: 0.075 },
      { kind: 'noise', delay: 0.015, filterType: 'bandpass', cutoff: 430, Q: 0.9, playbackRate: 0.6, duration: 0.12, gain: 0.007, attack: 0.012, decay: 0.025, sustain: 0.18, release: 0.075 },
    ],
  },
};
