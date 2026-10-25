// Ring of Fire: a ragged front of sparks bursts from the caster's feet and
// catches as a thin, uneven band of flame on the ground around them. The band
// breathes, breaks into moving gaps and bright clumps, throws short tongues
// and sparks, and lights the grass along it. While the caster moves it is
// swept back and sheds embers. In its last moments it gutters to a few
// lingering dots, and a charred, broken ring is left behind to cool.
// Burning foes carry small flames that climb their legs.
// Authored in screen space (counter-rotated by the heading). Pure function of
// the effect clock; flicker is seeded by the cast, so the ring and its scorch
// match even after the caster has moved.
const TAU = Math.PI * 2;
// Cells per local metre (SCALE / ASPECT across, SCALE * TILT down).
const COLS = 13 / 0.6, ROWS = 6.5;
// A height in metres above the ground shows this many ground metres up the screen.
const LIFT = 5 / 6.5;
// The rune's own size and the zone's life (one tick short of six seconds).
export const RING_RADIUS = 1.5;
export const RING_LIFE = 5.95;
const GUTTER = 0.7;
// Running speed in metres a second, where the sweep back is strongest.
const RUN = 6;
// Cooling fire: ash red, ember, flame orange, gold, straw, white heat.
const HEAT = [[64, 8, 4], [150, 26, 8], [226, 70, 16], [255, 128, 28],
  [255, 184, 64], [255, 228, 150], [255, 250, 232]];
const CHAR = [110, 62, 30], ASH = [108, 102, 96];
const BAND = ['+', 'o', '%', '&', '@'];
const SPARK = ['*', "'", '.', '.'];
const SCORCH = ['.', ',', ':', ';', '~'];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const smooth = (from, to, value) => {
  const t = clamp((value - from) / (to - from), 0, 1);
  return t * t * (3 - 2 * t);
};
const hash = (i, seed = 0) => { const v = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453; return v - Math.floor(v); };
const mix = (a, b, f) => a.map((c, i) => c + (b[i] - c) * f);
function heat(level) {
  const t = clamp(level, 0, 1) * (HEAT.length - 1);
  const i = Math.min(HEAT.length - 2, Math.floor(t));
  return mix(HEAT[i], HEAT[i + 1], t - i);
}
// The stroke for a ground direction as it reads on screen.
function slant(dx, dz) {
  const x = Math.abs(dx * 2), z = Math.abs(dz);
  if (z < x * 0.45) return '-';
  if (z > x * 2.2) return '|';
  return (dx > 0) === (dz > 0) ? '\\' : '/';
}

// Positions are spaced evenly along the on-screen ellipse rather than by
// angle, so its flat top and bottom are not left sparse. ARC holds the
// normalised perimeter length at 128 even angles.
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
  return (lo + (target - ARC[lo]) / Math.max(1e-9, ARC[hi] - ARC[lo])) / 128 * TAU;
}

// Smooth value noise around the ring: `cells` lattice points per turn,
// shifted by `shift` (so it travels) and blended between two lattices over
// time (so the pattern itself changes).
function ringNoise(u, cells, shift, t, seed) {
  const x = (u - Math.floor(u)) * cells + shift, i = Math.floor(x), f = x - i, s = f * f * (3 - 2 * f);
  const k = Math.floor(t), g = smooth(0, 1, t - k);
  const at = j => { const n = ((j % cells) + cells) % cells; return hash(n, seed + k * 7.3) * (1 - g) + hash(n, seed + (k + 1) * 7.3) * g; };
  return at(i) * (1 - s) + at(i + 1) * s;
}

// The band's shape: a breathing radius that is never the same ellipse twice,
// swept back on the trailing side while the caster moves.
function bandPoint(u, R, t, seed, drift) {
  const a = ringAngle(u), sx = Math.sin(a), sz = Math.cos(a);
  let r = R * (1 + 0.05 * (2 * ringNoise(u, 9, 0.6 * t, t * 0.4, seed + 1) - 1) + 0.025 * Math.sin(5 * a - 2.1 * t + seed));
  if (drift.amount > 0) {
    const along = sx * drift.x + sz * drift.z;
    r *= 1 + drift.amount * (along < 0 ? -0.12 * along : -0.05 * along);
  }
  return { x: sx * r, z: sz * r, a };
}

// Four gaps that open at hashed points, drift and respawn somewhere new.
function inGap(u, t, seed, extra = 0) {
  for (let k = 0; k < 4; k++) {
    const period = 1.3 + hash(k, seed + 20) * 0.9, phase = (t + hash(k, seed + 21) * period) / period;
    const cycle = Math.floor(phase), f = phase - cycle;
    const centre = hash(k * 13 + cycle, seed + 22) + f * 0.03;
    const width = 0.014 + 0.01 * Math.sin(Math.PI * f) + extra;
    const d = Math.abs(u - centre + 0.5 - Math.floor(u - centre + 0.5) - 0.5);
    if (d < width) return true;
  }
  return false;
}

function driftOf(effect) {
  const vx = Number.isFinite(effect.vx) ? effect.vx : 0, vz = Number.isFinite(effect.vy) ? effect.vy : 0;
  const speed = Math.hypot(vx, vz);
  return speed < 0.05 ? { x: 0, z: 0, amount: 0 } : { x: vx / speed, z: vz / speed, amount: clamp(speed / RUN, 0, 1) };
}

// Band samples: about one per cell along the ring, shared by the scorch so
// it lies exactly where the flames were.
const bandCount = R => clamp(Math.round(R * 96), 24, 144);

// The standing ring.
function ring(plot, glow, effect, R, age, seed) {
  const life = effect.life, drift = driftOf(effect);
  const fade = smooth(0.3, 0.5, age) * 0.85 + 0.15 * smooth(0, 0.3, age);
  const gutter = smooth(life - GUTTER, life, age);
  const count = bandCount(R);
  let thick = 0;
  for (let i = 0; i < count; i++) {
    const u = (i + 0.5) / count;
    const clump = ringNoise(u, 7, -0.35 * age, age * 0.5, seed + 3);
    // A few points keep a dot alight to the very end.
    const lingering = gutter > 0 && (i + Math.floor(seed)) % 16 === 0;
    if (!lingering && (hash(i, seed + 5) < gutter * 1.05 || clump < 0.05 + gutter * 0.35 || inGap(u, age, seed))) continue;
    const p = bandPoint(u, R, age, seed, drift);
    const flick = 0.85 + 0.15 * Math.sin(age * 13 + i * 2.1);
    if (gutter > 0.4) {
      plot(p.x, p.z, hash(i, seed + 6) < 0.5 ? '.' : ',', heat(lingering ? 0.72 : 0.3 + 0.2 * clump), (lingering ? 0.75 : 0.5) * flick);
      continue;
    }
    const h = 0.64 + 0.32 * clump + 0.04 * flick * (1 - gutter);
    plot(p.x, p.z, BAND[clamp(Math.floor((h - 0.64) / 0.07), 0, 4)], heat(h), fade * (0.85 + 0.15 * clump) * flick);
    // The band burns a row thicker where it is hot, an ember-red skin outside.
    if (clump > 0.4 && thick < 40) {
      const out = 1 + 0.55 / (R * ROWS);
      plot(p.x * out, p.z * out, clump > 0.7 ? 'o' : '+', heat(h - 0.28), fade * (0.45 + 0.4 * clump) * flick);
      thick++;
    }
  }

  // Tongues live half a second or so, then flare up at a new hashed point.
  const tongues = clamp(Math.round(R * 14), 6, 22);
  let lights = 0;
  for (let k = 0; k < tongues; k++) {
    const span = 0.5 + 0.4 * hash(k, seed + 7), phase = (age + hash(k, seed + 8) * span) / span;
    const cycle = Math.floor(phase), f = phase - cycle;
    const u = hash(k * 17 + cycle, seed + 9);
    if (inGap(u, age, seed, 0.03)) continue;
    const p = bandPoint(u, R, age, seed, drift);
    const flick = 0.6 + 0.25 * Math.sin(age * 9.3 + k) + 0.15 * Math.sin(age * 14.7 + k * 2);
    const tall = 0.35 * Math.sqrt(Math.sin(Math.PI * f)) * flick * (1 - gutter) * fade;
    const rows = Math.round(tall * LIFT * ROWS);
    for (let j = 1; j <= rows; j++) {
      const lean = -drift.x * drift.amount * j * 1.2 / COLS;
      plot(p.x + lean + Math.sin(age * 8 + k + j) * 0.3 / COLS, p.z - j / ROWS, j === 1 ? '^' : "'",
        heat(0.78 - j * 0.12), fade * flick * (1 - (j - 1) * 0.3));
    }
    // The flames light the grass along the band, never a disc in the middle.
    if (lights < 16) { glow(p.x * 1.1, p.z * 1.1, flick * fade * (1 - gutter * 0.8), 1.6); lights++; }
  }

  // Sparks rise from the band and drift up the screen, fading with height.
  const sparks = gutter > 0.6 ? 0 : clamp(Math.round(R * 10), 4, 14);
  for (let i = 0; i < sparks; i++) {
    const span = 0.8 + 0.6 * hash(i, seed + 10), phase = (age + hash(i, seed + 11) * span) / span;
    const cycle = Math.floor(phase), f = phase - cycle, u = hash(i * 7 + cycle, seed + 12);
    if (inGap(u, age, seed, 0.03)) continue;
    const p = bandPoint(u, R, age, seed, drift);
    const rise = f * (0.4 + 0.5 * hash(i + cycle, seed + 13)) * LIFT;
    plot(p.x + Math.sin(age * 4 + i * 2.3) * 0.06 * f, p.z - 0.12 - rise, SPARK[Math.min(3, Math.floor(f * 4))],
      heat(0.95 - f * 0.5), fade * (1 - f) * 0.8);
  }

  // Embers shed behind a moving ring.
  const embers = Math.round(14 * drift.amount * (1 - gutter));
  for (let i = 0; i < embers; i++) {
    const span = 0.5 + 0.3 * hash(i, seed + 14), phase = (age + hash(i, seed + 15) * span) / span;
    const cycle = Math.floor(phase), f = phase - cycle;
    // Born on the trailing half, left behind as the ring moves on.
    const a = Math.atan2(-drift.x, -drift.z) + (hash(i * 3 + cycle, seed + 16) - 0.5) * 2.2;
    const r = R * (1.05 + 0.1 * hash(i, seed + 17)) + f * 0.4;
    plot(Math.sin(a) * r, Math.cos(a) * r - f * 0.15, f < 0.5 ? '*' : '.', heat(0.8 - f * 0.4), fade * (1 - f) * 0.8);
  }
}

// The cast: forty rays race out from the feet at their own speeds, so the
// front is ragged, and each flares white-hot where it lands on the band.
function erupt(plot, glow, age, seed) {
  const R = RING_RADIUS, fade = 1 - smooth(0.42, 0.55, age);
  for (let k = 0; k < 40; k++) {
    const u = (k + hash(k, seed + 30) * 0.6) / 40, a = ringAngle(u), sx = Math.sin(a), sz = Math.cos(a);
    const arrive = 0.25 + 0.2 * hash(k, seed + 31);
    const front = smooth(0, 1, Math.min(1, age / arrive) ** 0.8);
    if (front < 1) {
      const r = R * front;
      plot(sx * r, sz * r, slant(sx, sz), heat(0.6 + 0.3 * front), fade * (0.5 + 0.4 * front));
      if (front > 0.3) plot(sx * r * 0.6, sz * r * 0.6, hash(k + Math.floor(age * 20), seed) < 0.5 ? '.' : "'", heat(0.5), fade * 0.5);
    } else {
      const flare = 1 - smooth(arrive, arrive + 0.12, age);
      plot(sx * R, sz * R, flare > 0.5 ? '*' : '+', heat(0.7 + 0.3 * flare), fade * (0.55 + 0.45 * flare));
      if (k % 5 === 0) glow(sx * R, sz * R, 0.5 * fade, 0.45);
    }
  }
}

// Flames on a foe: small tongues climb from the feet with embers above. A
// burn (following, one second, renewed each second) reads as steadily
// alight; a pulse hit is a short flare-up.
function burn(plot, effect, age, seed) {
  const steady = effect.shape === 'burn';
  const fade = steady ? 1 - smooth(effect.life * 0.85, effect.life, age) : 1 - smooth(0.25, 0.4, age);
  if (fade <= 0) return;
  const top = (steady ? 1.2 : 0.8) * LIFT, count = 3 + Math.floor(hash(seed, 40) * 3), frame = Math.floor(age * 16);
  for (let k = 0; k < count; k++) {
    const x0 = ((k + 0.5) / count - 0.5) * 0.6 + (hash(k, seed + 41) - 0.5) * 0.1;
    const tall = top * (0.45 + 0.55 * hash(k + frame * 3, seed + 42));
    const rows = Math.max(1, Math.round(tall * ROWS));
    for (let j = 0; j < rows; j++) {
      const v = j / rows, sway = Math.sin(age * 9 + k * 1.7 + v * 3) * 0.05 * v;
      plot(x0 * (1 - v * 0.4) + sway, -j / ROWS, v < 0.3 ? (k % 2 ? ')' : '(') : v < 0.75 ? '^' : "'",
        heat(0.9 - v * 0.4), fade * (1 - v * 0.35));
    }
  }
  for (let i = 0; i < 4; i++) {
    const f = (age * (1.1 + hash(i, seed + 43) * 0.5) + hash(i, seed + 44)) % 1;
    plot((hash(i, seed + 45) - 0.5) * 0.5, -top - f * 0.5, f < 0.5 ? '*' : '.', heat(0.9 - f * 0.5), fade * (1 - f) * 0.8);
  }
}

// The scorch: the ring's outline as the flames settled (its last shape, at
// rest), charred dark and broken, with embers blinking out. Fully dark for
// a second and a half, then fading to nothing.
function scorch(plot, glow, effect, R, age, seed) {
  const life = effect.life, dim = 1 - smooth(1.5, life, age);
  if (dim <= 0) return;
  const still = { x: 0, z: 0, amount: 0 };
  const count = bandCount(R);
  for (let i = 0; i < count; i++) {
    const u = (i + 0.5) / count;
    if (ringNoise(u, 7, -0.35 * RING_LIFE, RING_LIFE * 0.5, seed + 3) < 0.2 || hash(i, seed + 50) > dim * 1.1 - 0.05) continue;
    const p = bandPoint(u, R, RING_LIFE, seed, still), k = hash(i, seed + 51);
    // Cold char gives off no light: plotted unlit, so it never haloes the grass.
    plot(p.x, p.z, SCORCH[Math.floor(k * 5)], mix(CHAR, ASH, k), dim, true);
    // Charred a row wider where the flames burned hottest.
    if (k > 0.55) plot(p.x * (1 + 0.5 / (R * ROWS)), p.z * (1 + 0.5 / (R * ROWS)), k > 0.8 ? ':' : '.', mix(CHAR, ASH, 1 - k), dim * 0.8, true);
  }
  for (let i = 0; i < 12; i++) {
    const end = 0.2 + 1.3 * hash(i, seed + 52);
    if (age >= end) continue;
    const p = bandPoint(hash(i, seed + 53), R, RING_LIFE, seed, still);
    plot(p.x, p.z, hash(i + Math.floor(age * 12), seed + 54) < 0.5 ? '*' : '.', heat(0.62 + 0.15 * hash(i, seed + 55)),
      (1 - age / end) * (0.6 + 0.4 * Math.sin(age * 17 + i)));
  }
  for (let i = 0; i < 12; i++) {
    const p = bandPoint((i + 0.5) / 12, R, RING_LIFE, seed, still);
    glow(p.x, p.z, -0.35 * dim, 0.4);
  }
}

export default {
  id: 'ring-of-fire', duration: 0.55,
  // Flames pass behind trees and rocks drawn on the fine grid.
  keepScenery: true,
  draw(effect, draw, light = () => {}) {
    const age = Number.isFinite(effect.age) ? Math.max(0, effect.age) : 0;
    const life = Number.isFinite(effect.life) ? effect.life : 0.55;
    if (age >= life) return;
    const heading = Number.isFinite(effect.heading) ? effect.heading : 0;
    const c = Math.cos(heading), s = Math.sin(heading);
    const seed = Number.isFinite(effect.seed) ? effect.seed % 97 : 0;
    const R = clamp(Number.isFinite(effect.radius) ? effect.radius : RING_RADIUS, 0.3, 3);
    // Undo the adapter's heading rotation so the ring stays screen-aligned.
    const plot = (x, z, char, color, brightness, unlit = false) => {
      if (brightness <= 0.01) return;
      if (unlit) draw(x * c - z * s, x * s + z * c, char, color, Math.min(1, brightness), true);
      else draw(x * c - z * s, x * s + z * c, char, color, Math.min(1, brightness));
    };
    const glow = (x, z, k, reach) => light(x * c - z * s, x * s + z * c, k, reach);
    switch (effect.stage) {
      case 'cast': return erupt(plot, glow, age, seed);
      case 'zone': return ring(plot, glow, { ...effect, life }, R, age, seed);
      case 'impact': return burn(plot, { ...effect, life }, age, seed);
      case 'pulse': return effect.shape === 'scorch' ? scorch(plot, glow, { ...effect, life }, R, age, seed) : undefined;
      default: return undefined;
    }
  },
  sounds: {
    // A low sweep that closes round the caster; foes catch with muted contacts.
    cast: [
      { kind: 'recording', url: '/assets/audio/spells/oseni/wing-sweep.wav', gain: 0.2, rate: 0.82, delay: 0 },
      { kind: 'recording', url: '/assets/audio/spells/oseni/air-draw.wav', gain: 0.14, rate: 0.86, delay: 0.06 },
      { kind: 'recording', url: '/assets/audio/spells/oseni/dark-swell.wav', gain: 0.12, rate: 0.9, delay: 0.18 },
    ],
    impact: [
      { kind: 'recording', url: '/assets/audio/spells/oseni/muted-hit.wav', gain: 0.12, rate: 1.12, delay: 0 },
      { kind: 'recording', url: '/assets/audio/spells/oseni/air-release.wav', gain: 0.07, rate: 1.15, delay: 0.02 },
    ],
    pulse: [
      { kind: 'recording', url: '/assets/audio/spells/oseni/soft-return.wav', gain: 0.06, rate: 0.8, delay: 0.3 },
      { kind: 'recording', url: '/assets/audio/spells/oseni/pressure.wav', gain: 0.05, rate: 0.78, delay: 0.4 },
    ],
  },
};
