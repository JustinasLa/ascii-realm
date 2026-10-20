// Fire Breath: a drawn-in breath, a roaring jet of flame that rolls out into
// billowing fireballs, and the burns it leaves behind. Local +z is the breath
// direction. Everything is a pure function of the effect state.
const TAU = Math.PI * 2;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const smooth = (edge0, edge1, value) => {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};
const easeOut = (t, power = 3) => 1 - Math.pow(1 - clamp(t, 0, 1), power);
// Deterministic per-index variation in [0, 1).
const hash = (index, salt) => {
  const v = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return v - Math.floor(v);
};

// Heat ramp: white-hot core -> yellow -> orange -> red -> smoke, precomputed so
// painting never allocates colours.
const STOPS = [
  [0, [92, 78, 72]], [0.16, [150, 52, 22]], [0.34, [222, 72, 18]], [0.55, [255, 132, 30]],
  [0.75, [255, 196, 70]], [0.9, [255, 234, 150]], [1, [255, 250, 226]],
];
const HEAT = Array.from({ length: 33 }, (_, step) => {
  const heat = step / 32;
  let k = 1;
  while (k < STOPS.length - 1 && STOPS[k][0] < heat) k++;
  const [h0, c0] = STOPS[k - 1], [h1, c1] = STOPS[k];
  const t = clamp((heat - h0) / (h1 - h0), 0, 1);
  return c0.map((channel, i) => Math.round(channel + (c1[i] - channel) * t));
});
const heatColor = heat => HEAT[Math.round(clamp(heat, 0, 1) * 32)];
const SMOKE = [104, 92, 86];
// Glyph density follows heat: sparse cool edges, dense white-hot cores.
const RAMP = '.:;~+*%#@';
const glyph = heat => RAMP[Math.min(RAMP.length - 1, Math.floor(clamp(heat, 0, 0.999) * RAMP.length))];

// In game one world cell is 0.6/13 m wide and 1/6.5 m deep (SCALE 13, ASPECT 0.6,
// TILT 0.5). Solid shapes are rasterised on that lattice so every sample lands in
// its own cell at any heading instead of scattering or piling up.
const CELL_X = 0.6 / 13;
const CELL_Z = 1 / 6.5;
const BUDGET = 240;

// Per-call view: draw() resets these from the effect before painting anything.
let out = null, used = 0, cosH = 1, sinH = 0, fracX = 0, fracZ = 0;

function ink(x, z, char, color, level) {
  const brightness = clamp(level, 0, 1);
  if (brightness <= 0.004 || used >= BUDGET) return false;
  out(x, z, char, color, brightness);
  used++;
  return true;
}
// World-aligned offsets (x east, z toward the bottom of the screen; "up" is -z).
const inkWorld = (wx, wz, char, color, level) =>
  ink(wx * cosH - wz * sinH, wx * sinH + wz * cosH, char, color, level);
const localX = (wx, wz) => wx * cosH - wz * sinH;
const localZ = (wx, wz) => wx * sinH + wz * cosH;

// Visit world cell centres inside a world box, nearest the breath origin first.
// `shade` returns true when it plotted; at most `limit` cells are plotted.
function lattice(x0, x1, z0, z1, limit, shade) {
  const c0 = Math.floor(x0 / CELL_X + fracX), c1 = Math.floor(x1 / CELL_X + fracX);
  const r0 = Math.floor(z0 / CELL_Z + fracZ), r1 = Math.floor(z1 / CELL_Z + fracZ);
  const rows = r1 - r0 + 1, cols = c1 - c0 + 1;
  if (rows * cols > 5000) return;
  const flipR = cosH < 0, flipC = sinH < 0;
  let left = limit;
  for (let i = 0; i < rows; i++) {
    const r = flipR ? r1 - i : r0 + i;
    const wz = (r + 0.5 - fracZ) * CELL_Z;
    for (let j = 0; j < cols; j++) {
      const c = flipC ? c1 - j : c0 + j;
      if (shade((c + 0.5 - fracX) * CELL_X, wz) && --left <= 0) return;
    }
  }
}
// World box around a local-space box (the breath frame is rotated).
function latticeLocal(x0, x1, z0, z1, limit, shade) {
  let wx0 = Infinity, wx1 = -Infinity, wz0 = Infinity, wz1 = -Infinity;
  for (let k = 0; k < 4; k++) {
    const x = k & 1 ? x1 : x0, z = k & 2 ? z1 : z0;
    const wx = x * cosH + z * sinH, wz = z * cosH - x * sinH;
    wx0 = Math.min(wx0, wx); wx1 = Math.max(wx1, wx); wz0 = Math.min(wz0, wz); wz1 = Math.max(wz1, wz);
  }
  lattice(wx0, wx1, wz0, wz1, limit, shade);
}

// ---------------------------------------------------------------- cast
const MOTES = 18;
const BALLS = 10;
const SPARKS = 16;

function cast(p, age) {
  const envelope = 1 - smooth(0.82, 1, p);

  // Mouth: an ember glow while the breath is drawn in, a white flash as it ignites.
  const charge = smooth(0, 0.12, p) * (1 - smooth(0.5, 0.7, p));
  const ignite = Math.max(0, 1 - Math.abs(p - 0.13) / 0.05);
  if (charge > 0.02) {
    const radius = 0.05 + 0.11 * charge + 0.06 * ignite;
    lattice(-radius, radius, -radius * 0.6, radius * 1.4, 18, (wx, wz) => {
      const lx = localX(wx, wz), lz = localZ(wx, wz) - 0.05;
      const q = Math.hypot(lx, lz * 0.8) / radius;
      if (q >= 1) return false;
      const heat = clamp(0.62 + 0.38 * (1 - q * q) * charge + 0.3 * ignite + 0.05 * Math.sin(age * 37 + lx * 40), 0, 1);
      return ink(lx, lz + 0.05, glyph(heat), heatColor(heat), (0.35 + 0.65 * (1 - q)) * charge);
    });
  }

  // Jet core: a solid, turbulent wedge of flame streaming out of the mouth. When
  // the breath ends its tail detaches and the whole column rolls forward.
  const grow = easeOut((p - 0.11) / 0.2, 2.2);
  const release = clamp((p - 0.5) / 0.18, 0, 1);
  const head = 2.1 * grow + 1.4 * release;
  const tail = 2.4 * Math.pow(release, 1.4);
  const power = grow * (1 - Math.pow(release, 1.5));
  if (power > 0.01 && head - tail > 0.05) {
    const span = head - tail;
    const half = z => 0.06 + 0.22 * z;
    const reach = half(head) * 1.25;
    latticeLocal(-reach, reach, tail, head, 110, (wx, wz) => {
      const x = localX(wx, wz), z = localZ(wx, wz);
      if (z < tail || z > head) return false;
      const u = (z - tail) / span;
      const edge = half(z) * (1 + 0.2 * Math.sin(z * 6.5 - age * 24 + (x > 0 ? 0 : 2.1)));
      const s = Math.abs(x) / edge;
      if (s >= 1) return false;
      const lead = 1 - Math.pow(u, 2.4);
      const detach = release > 0 ? Math.min(1, (z - tail) / 0.3) : 1;
      const texture = 0.16 * Math.sin(z * 9 - age * 30 + x * 14) + 0.1 * Math.sin(x * 31 - z * 5 + age * 13);
      const intensity = (1 - s * s) * lead * detach * power + texture;
      if (intensity < 0.14) return false;
      const heat = clamp(intensity * (1.08 - 0.3 * u - 0.25 * release), 0, 1);
      return ink(x, z, glyph(heat), heatColor(heat), envelope * (0.45 + 0.55 * clamp(intensity, 0, 1)));
    });
  }

  // Fireballs break off the jet tip, roll outward to the full cone, swell, cool
  // from yellow to red and erode into drifting smoke.
  for (let i = 0; i < BALLS; i++) {
    const birth = 0.16 + i * 0.038 + 0.02 * hash(i, 1);
    const life = 0.3 + 0.1 * hash(i, 2);
    const a = (p - birth) / life;
    if (a <= 0 || a >= 1) continue;
    const angle = (hash(i, 3) + hash(i, 4) - 1) * 0.46;
    const far = 4.5 + 1.5 * hash(i, 5);
    const d = 1.7 + (far - 1.7) * easeOut(a, 2);
    const roll = Math.sin(age * 5 + i * 2) * 0.12 * a;
    const cx = Math.sin(angle) * d + roll, cz = Math.cos(angle) * d;
    const wcx = cx * cosH + cz * sinH, wcz = cz * cosH - cx * sinH;
    const radius = 0.14 + 0.18 * a;
    const heat0 = Math.pow(1 - a, 1.1) * (1 - 0.3 * Math.abs(angle));
    const fadeIn = Math.min(1, a / 0.12);
    lattice(wcx - radius, wcx + radius, wcz - radius, wcz + radius, 19, (wx, wz) => {
      const dx = wx - wcx, dz = wz - wcz;
      const q = Math.hypot(dx, dz * 1.15) / radius;
      if (q >= 1) return false;
      const n = 0.22 * Math.sin(dx * 26 + age * 9 + i) * Math.sin(dz * 15 - age * 7 + i * 2);
      const body = 1 - q * q + n - 0.55 * a;
      if (heat0 < 0.2) {
        if (body < 0.35) return false;
        return ink(localX(wx, wz), localZ(wx, wz), (i + Math.floor(dx * 50)) % 2 ? '.' : ':', SMOKE, envelope * 0.5 * (1 - a));
      }
      if (body < 0.12) return false;
      const heat = clamp(heat0 * (0.55 + 0.6 * body), 0, 1);
      return ink(localX(wx, wz), localZ(wx, wz), glyph(heat), heatColor(heat),
        envelope * fadeIn * Math.sqrt(1 - a) * (0.45 + 0.55 * body));
    });
  }

  // Sparks spit from the flanks, outrun the flame, then die as embers.
  for (let s = 0; s < SPARKS; s++) {
    const birth = 0.15 + 0.4 * hash(s, 6);
    const life = 0.24 + 0.14 * hash(s, 7);
    const a = (p - birth) / life;
    if (a <= 0 || a >= 1) continue;
    const angle = (s % 2 ? 1 : -1) * (0.28 + 0.4 * hash(s, 8));
    const d = 0.4 + (2.2 + 3.4 * hash(s, 9)) * easeOut(a, 3);
    ink(Math.sin(angle) * d, Math.cos(angle) * d, a < 0.35 ? '*' : a < 0.7 ? "'" : '.',
      heatColor(0.95 - 0.8 * a), envelope * (1 - a) * (0.75 + 0.25 * Math.sin(age * 53 + s)));
  }

  // Anticipation: loose embers are sucked into the mouth as the breath is drawn.
  if (p < 0.17) {
    for (let j = 0; j < MOTES; j++) {
      const t = clamp(p / 0.14 - hash(j, 10) * 0.2, 0, 1);
      if (t <= 0 || t >= 1) continue;
      const pull = t * t;
      const angle = (hash(j, 11) - 0.5) * 2.4 + (hash(j, 12) - 0.5) * pull * 1.2;
      const distance = (1 + hash(j, 13) * 1.2) * (1 - pull) + 0.08;
      ink(Math.sin(angle) * distance, Math.cos(angle) * distance, t > 0.7 ? '*' : t > 0.35 ? '+' : '.',
        heatColor(0.25 + 0.55 * t), (0.3 + 0.6 * t) * Math.sin(Math.PI * Math.min(1, t * 1.1)));
    }
  }
}

// ---------------------------------------------------------------- pulse
// The cast's FX visuals fire at the mouth: a tight ember glow builds, then a
// solid muzzle flare of flame bursts forward, rounds off and burns down while a
// few sparks race ahead of it.
const PULSE_SPARKS = 8;

function pulse(p, age, life, radius) {
  const reach = 0.45 + 0.35 * clamp(radius, 0.5, 2.5);
  const gather = Math.min(0.13, life * 0.45);
  if (age < gather) {
    const t = age / gather;
    const r = 0.06 + 0.08 * t * t, rz = Math.max(r, 0.1);
    lattice(-r, r, -rz, rz, 12, (wx, wz) => {
      const q = Math.hypot(wx / r, wz / rz);
      if (q >= 1) return false;
      const heat = clamp(0.5 + 0.45 * t - 0.25 * q, 0, 1);
      return inkWorld(wx, wz, glyph(heat), heatColor(heat), (0.3 + 0.6 * t) * (1 - 0.5 * q));
    });
    return;
  }
  const q = (age - gather) / Math.max(0.01, life - gather);
  const fade = Math.pow(1 - q, 1.3);
  const head = 0.08 + reach * easeOut(q / 0.55, 3);
  const tail = reach * 0.7 * smooth(0.35, 1, q);
  if (head - tail > 0.04) {
    const half = z => 0.05 + 0.34 * z;
    const width = half(head);
    latticeLocal(-width, width, tail, head, 72, (wx, wz) => {
      const x = localX(wx, wz), z = localZ(wx, wz);
      if (z < tail || z > head) return false;
      const u = (z - tail) / (head - tail);
      // Rounded leading cap: the flare is a teardrop, not a clipped wedge.
      const cap = Math.sqrt(Math.max(0, 1 - Math.pow(Math.max(0, u - 0.6) / 0.4, 2)));
      const edge = half(z) * cap * (1 + 0.15 * Math.sin(z * 18 - age * 30));
      const s = Math.abs(x) / Math.max(0.01, edge);
      if (s >= 1) return false;
      const intensity = (1 - s * s) * (1 - 0.45 * u) + 0.1 * Math.sin(x * 40 + z * 22 - age * 26);
      if (intensity < 0.18) return false;
      const heat = clamp(intensity * (1.05 - 0.75 * q), 0, 1);
      return ink(x, z, glyph(heat), heatColor(heat), fade * (0.45 + 0.55 * clamp(intensity, 0, 1)));
    });
  }
  for (let s = 0; s < PULSE_SPARKS; s++) {
    const angle = (hash(s, 24) - 0.5) * 1.1;
    const d = 0.1 + reach * (1 + 0.6 * hash(s, 25)) * easeOut(q, 2.5);
    ink(Math.sin(angle) * d, Math.cos(angle) * d, q < 0.45 ? "'" : '.', heatColor(0.92 - 0.7 * q), fade * 0.8);
  }
}

// ------------------------------------------------- burning (world-upright)
// Flame tongues stand up on screen (world -z) from a glowing bed at the feet.
function flames(r, count, salt, age, sizeOf, level, limit) {
  const top = r * 1.45;
  lattice(-0.66 * r, 0.66 * r, -top, 0.22 * r, limit, (wx, wz) => {
    const h = -wz;
    let best = 0;
    for (let k = 0; k < count; k++) {
      const size = sizeOf(k);
      if (size <= 0.02) continue;
      const height = r * (0.8 + 0.6 * hash(k, salt)) * size;
      const t = h / height;
      if (t < -0.15 || t > 1) continue;
      const base = (k - (count - 1) / 2) * (0.95 * r / count) + (hash(k, salt + 1) - 0.5) * 0.08 * r;
      const sway = Math.sin(age * 11 + k * 2.3 - t * 2) * 0.1 * r * Math.max(0, t) * Math.max(0, t);
      const width = 0.15 * r * Math.pow(1 - clamp(t, 0, 1), 0.6) * (0.7 + 0.3 * size);
      const s = Math.abs(wx - base - sway) / width;
      if (s >= 1) continue;
      best = Math.max(best, (1 - s * s) * (1 - 0.55 * clamp(t, 0, 1)) * (0.6 + 0.4 * size));
    }
    // Ember bed: a flattened glow on the ground under the tongues.
    const q = Math.hypot(wx / (0.42 * r), wz / (0.2 * r));
    if (q < 1) best = Math.max(best, 0.5 * (1 - q * q) * (0.6 + 0.4 * Math.sin(age * 9 + wx * 30)));
    if (best < 0.12) return false;
    const heat = clamp(best + 0.06 * Math.sin(age * 31 + wx * 40 + wz * 17), 0, 1);
    return inkWorld(wx, wz, glyph(heat), heatColor(heat), level * (0.45 + 0.55 * best));
  });
}

const CRACKLE = [0, 0.1, 0.24];

function impact(p, age, radius) {
  // A burn tick: ignition flash, a flare of tongues, staggered crackle, then ash.
  const r = clamp(radius, 0.5, 2.5);
  const fade = Math.pow(1 - p, 0.9);
  if (p < 0.22) {
    const flash = 1 - p / 0.22;
    inkWorld(0, -0.15 * r, '@', heatColor(1), flash);
    const ring = r * (0.15 + 0.45 * easeOut(p / 0.22));
    for (let k = 0; k < 12; k++) {
      const angle = k * TAU / 12;
      inkWorld(Math.sin(angle) * ring, Math.cos(angle) * ring * 0.55, '*', heatColor(0.95 - 0.3 * p / 0.22), flash * 0.9);
    }
  }
  const flare = Math.pow(Math.sin(Math.PI * clamp(p * 1.2, 0, 1)), 0.55);
  flames(r, 4, 30, age, k => flare * (0.75 + 0.25 * Math.sin(age * 14 + k * 1.7)), fade, 125);
  for (let s = 0; s < 18; s++) {
    const local = (p - CRACKLE[s % 3]) / 0.5;
    if (local <= 0 || local >= 1) continue;
    const vx = (hash(s, 32) - 0.5) * 1.6 * r, up = (0.7 + 0.8 * hash(s, 33)) * r;
    const t = easeOut(local, 2);
    inkWorld(vx * t, -(up * t - 0.5 * r * local * local), local < 0.4 ? '*' : "'",
      heatColor(0.92 - 0.7 * local), (1 - local) * 0.95);
  }
  if (p > 0.3) {
    const ash = smooth(0.3, 0.5, p) * fade;
    for (let k = 0; k < 12; k++) {
      const angle = k * TAU / 12 + hash(k, 34) * 0.3;
      inkWorld(Math.sin(angle) * 0.5 * r, Math.cos(angle) * 0.24 * r, k % 2 ? ',' : '.', heatColor(0.14), ash * 0.6);
    }
    const rise = (p - 0.3) / 0.7;
    for (let k = 0; k < 8; k++) {
      inkWorld((hash(k, 36) - 0.5) * 0.7 * r + Math.sin(age * 4 + k) * 0.05,
        -r * (0.5 + 0.8 * rise * (0.6 + 0.4 * hash(k, 37))), k % 2 ? '.' : ':', SMOKE, ash * 0.55);
    }
  }
}

function aura(p, age, radius) {
  // Burnt status: embers circling the feet, small flames that keep rekindling,
  // smoke curling up.
  const r = clamp(radius, 0.5, 2.5);
  const envelope = smooth(0, 0.08, p) * Math.pow(1 - p, 0.8);
  flames(r * 0.75, 5, 40, age, k => {
    const cycle = age * 1.6 + hash(k, 42);
    return Math.sin(Math.PI * (cycle - Math.floor(cycle)));
  }, envelope, 90);
  for (let k = 0; k < 16; k++) {
    const angle = k * TAU / 16 + age * (0.9 + 0.3 * hash(k, 41));
    const heat = 0.45 + 0.35 * Math.sin(age * 13 + k * 2.7);
    inkWorld(Math.sin(angle) * 0.5 * r, Math.cos(angle) * 0.24 * r, heat > 0.6 ? '*' : heat > 0.35 ? '+' : '.',
      heatColor(heat), envelope * (0.5 + 0.4 * heat));
  }
  for (let k = 0; k < 9; k++) {
    const cycle = age * 0.8 + hash(k, 43);
    const phase = cycle - Math.floor(cycle);
    inkWorld((hash(k, 44) - 0.5) * 0.8 * r + Math.sin(age * 2 + k) * 0.08, -r * (0.45 + 0.9 * phase),
      phase < 0.5 ? ':' : '.', SMOKE, envelope * Math.sin(Math.PI * phase) * 0.45);
  }
}

function zone(p, age, radius) {
  // A field of ground fire: rekindling upright licks spread evenly over the disc.
  const r = clamp(radius, 0.4, 6);
  const envelope = smooth(0, 0.06, p) * (1 - smooth(0.7, 1, p));
  const count = Math.min(30, Math.round(10 + r * 5));
  for (let k = 0; k < count; k++) {
    const distance = r * 0.9 * Math.sqrt((k + 0.5) / count);
    const angle = k * 2.39996;
    const cycle = age * (1.3 + 0.5 * hash(k, 50)) + hash(k, 51);
    const size = Math.sin(Math.PI * (cycle - Math.floor(cycle)));
    const bx = Math.sin(angle) * distance, bz = Math.cos(angle) * distance;
    for (let j = 0; j < 3; j++) {
      const heat = (0.9 - 0.25 * j) * (0.5 + 0.5 * size) * (1 - 0.25 * distance / r);
      inkWorld(bx + Math.sin(age * 8 + k + j) * 0.03 * j, bz - j * CELL_Z * size, glyph(heat), heatColor(heat),
        envelope * size * (1 - 0.25 * j));
    }
  }
  for (let k = 0; k < 24; k++) {
    const angle = k * TAU / 24 + Math.sin(age * 0.7 + k) * 0.05;
    const heat = 0.3 + 0.25 * Math.sin(age * 9 + k * 1.3);
    inkWorld(Math.sin(angle) * r, Math.cos(angle) * r, k % 2 ? ',' : '.', heatColor(heat), envelope * 0.5);
  }
}

function projectile(p, age) {
  // A compact fireball whose flames stream back into a cooling, curling trail.
  const envelope = smooth(0, 0.04, p) * (1 - smooth(0.85, 1, p));
  const radius = 0.13;
  lattice(-radius, radius, -radius, radius, 14, (wx, wz) => {
    const q = Math.hypot(wx, wz) / radius;
    if (q >= 1) return false;
    const heat = clamp(1 - 0.45 * q * q + 0.06 * Math.sin(age * 40 + wx * 60), 0, 1);
    return inkWorld(wx, wz, glyph(heat), heatColor(heat), envelope * (1 - 0.3 * q));
  });
  for (let i = 0; i < 30; i++) {
    const cycle = age * 3.2 + hash(i, 60);
    const phase = cycle - Math.floor(cycle);
    const z = -0.1 - phase * (1 + 0.5 * hash(i, 61));
    const x = (hash(i, 62) - 0.5) * 0.35 * phase + Math.sin(age * 14 + i * 1.3 + z * 4) * 0.05 * phase;
    const heat = 0.92 - 0.85 * phase;
    ink(x, z, heat < 0.15 ? '.' : glyph(heat), heat < 0.15 ? SMOKE : heatColor(heat), envelope * (1 - phase) * (0.5 + 0.5 * heat));
  }
  for (let s = 0; s < 8; s++) {
    const cycle = age * 2.4 + hash(s, 63);
    const phase = cycle - Math.floor(cycle);
    ink((s % 2 ? 1 : -1) * (0.1 + 0.3 * phase * hash(s, 64)), -0.2 - phase * 0.9, phase < 0.4 ? "'" : '.',
      heatColor(0.85 - 0.6 * phase), envelope * (1 - phase));
  }
}

function draw(effect, plot) {
  const age = Math.max(0, finite(effect.age, 0));
  const life = Math.max(0.01, finite(effect.life, 1.08));
  const progress = clamp(finite(effect.progress, age / life), 0, 1);
  if (progress >= 1) return;
  const radius = clamp(finite(effect.radius, 1), 0.2, 6);
  const heading = finite(effect.heading, 0);
  out = plot; used = 0;
  cosH = Math.cos(heading); sinH = Math.sin(heading);
  const x = finite(effect.x, 0), y = finite(effect.y, 0);
  fracX = x - Math.floor(x); fracZ = y - Math.floor(y);
  try {
    switch (effect.stage) {
      case 'projectile': return projectile(progress, age);
      case 'pulse': return pulse(progress, age, life, radius);
      case 'impact': return impact(progress, age, radius);
      case 'aura': return aura(progress, age, radius);
      case 'zone': return zone(progress, age, radius);
      default: return cast(progress, age);
    }
  } finally {
    out = null;
  }
}

export default {
  id: 'fire-breath',
  duration: 1.08,
  draw,
  sounds: {
    cast: [
      { kind: 'noise', delay: 0, duration: 0.19, gain: 0.035, attack: 0.04, release: 0.09, cutoff: 640, filterType: 'highpass' },
      { kind: 'tone', delay: 0.04, duration: 0.83, gain: 0.065, attack: 0.12, release: 0.28, frequency: 87, endFrequency: 54, type: 'triangle', cutoff: 230 },
      { kind: 'noise', delay: 0.1, duration: 0.56, gain: 0.085, attack: 0.09, release: 0.24, cutoff: 1050, filterType: 'lowpass' },
      { kind: 'noise', delay: 0.27, duration: 0.57, gain: 0.065, attack: 0.08, release: 0.3, cutoff: 1550, filterType: 'bandpass' },
      { kind: 'noise', delay: 0.46, duration: 0.51, gain: 0.045, attack: 0.05, release: 0.32, cutoff: 2200, filterType: 'lowpass' },
    ],
    impact: [
      { kind: 'noise', delay: 0, duration: 0.15, gain: 0.065, attack: 0.003, release: 0.12, cutoff: 2800, filterType: 'highpass' },
      { kind: 'noise', delay: 0.062, duration: 0.1, gain: 0.035, attack: 0.002, release: 0.085, cutoff: 3900, filterType: 'bandpass' },
      { kind: 'noise', delay: 0.145, duration: 0.09, gain: 0.027, attack: 0.002, release: 0.075, cutoff: 3200, filterType: 'highpass' },
      { kind: 'tone', delay: 0.015, duration: 0.19, gain: 0.026, attack: 0.003, release: 0.15, frequency: 132, endFrequency: 67, type: 'triangle' },
    ],
    pulse: [
      { kind: 'noise', delay: 0, duration: 0.1, gain: 0.018, attack: 0.003, release: 0.08, cutoff: 1900, filterType: 'bandpass' },
      { kind: 'noise', delay: 0.045, duration: 0.065, gain: 0.009, attack: 0.002, release: 0.05, cutoff: 2700, filterType: 'highpass' },
    ],
  },
};
