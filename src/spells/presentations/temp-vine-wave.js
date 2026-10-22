// Vine Wave: a wall of braided vines that crests and rolls forward like a wave.
// The cast gathers leaves into a rooted knot, then a crescent of vines rears up,
// curls its lip forward and crashes into drifting leaves while the braid sinks.
// In flight the crest rolls on with a braided wake; vines erupt from the ground
// under its path, thorns snap up around anything hit and coil it in place.
const TAU = Math.PI * 2;
// One metre of height along the ground's screen-up axis (5 rows against 6.5 per metre).
const LIFT = 5 / 6.5;

const STEM_DARK = [44, 104, 50], STEM = [92, 170, 68], LEAF = [152, 222, 98];
const BRIGHT = [212, 248, 156], FLASH = [246, 255, 226], BARK = [128, 96, 58];
const EARTH = [112, 88, 62], VENOM = [178, 214, 72];

function ramp(stops, n = 24) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1) * (stops.length - 1), k = Math.min(stops.length - 2, Math.floor(t)), f = t - k;
    out.push(stops[k].map((c, j) => Math.round(c + (stops[k + 1][j] - c) * f)));
  }
  return out;
}
// Precomputed gradients: plotted colours never allocate and keep stable references.
const VINE = ramp([STEM_DARK, STEM, LEAF, BRIGHT]);
const BLAZE = ramp([LEAF, BRIGHT, FLASH]);
const WITHER = ramp([LEAF, STEM, BARK]);
const SOIL = ramp([EARTH, BARK, STEM]);
const tint = (table, t) => table[Math.round(clamp01(t) * (table.length - 1))];

const fin = (v, d) => (Number.isFinite(v) ? v : d);
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
const span = (v, a, b) => clamp01((v - a) / (b - a));
const smooth = v => { v = clamp01(v); return v * v * (3 - 2 * v); };
const easeOut = v => 1 - (1 - clamp01(v)) ** 3;
const easeIn = v => clamp01(v) ** 2;
const bell = v => (v <= 0 || v >= 1 ? 0 : Math.sin(Math.PI * v));
const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const DOTS = '.,:;*';
const LEAVES = ",'`.";

// Every helper takes the per-call `view` (heading cos/sin, end fade, plot callback)
// built by draw(), so draw keeps no module state and stays pure and re-entrant.

// Plot a local ground point lifted `h` metres towards the viewer's screen-up.
function put(view, x, z, h, ch, color, light) {
  const v = clamp01(light) * view.end;
  if (v < 0.02) return;
  view.plot(x + h * view.hs * LIFT, z - h * view.hc * LIFT, ch, color, v);
}
// Choose a stroke glyph from a local direction as it lands on screen (visual units).
function stroke(view, dx, dz, dh, flat = '-') {
  const { hc, hs } = view;
  const vx = (dx * hc + dz * hs) * 13, vy = (dz * hc - dx * hs) * 6.5 - dh * 5;
  const ax = Math.abs(vx), ay = Math.abs(vy);
  if (ay < ax * 0.42) return flat;
  if (ay > ax * 2.4) return '|';
  return vx * vy > 0 ? '\\' : '/';
}
// Whether a local ground offset sits behind its origin on screen (dimmer, for depth).
const behind = (view, x, z) => z * view.hc - x * view.hs < 0;

// Two stems that keep crossing, carried along a travelling bend, with leaf hooks.
function braid(view, z0, z1, n, from, phase, width, light, colorAt) {
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    if (t < from) continue;
    const z = z0 + (z1 - z0) * t, turn = t * Math.PI * 4 - phase;
    const center = Math.sin(t * Math.PI * 1.5 - phase * 0.45) * width * 0.7;
    const weave = Math.sin(turn) * width, lean = Math.cos(turn) > 0;
    const shade = light(t);
    put(view, center + weave, z, 0, lean ? '/' : '\\', colorAt(t, 0), shade);
    put(view, center - weave, z, 0, lean ? '\\' : '/', colorAt(t, 1), shade * 0.85);
    if (i % 4 === 2) {
      const side = (i >> 2) % 2 ? 1 : -1;
      put(view, center + side * (Math.abs(weave) + 0.1), z + 0.04, 0, side > 0 ? ')' : '(', colorAt(t, 2), shade * 0.9);
    }
  }
}

// A crescent of vines: tangled base on the ground, rising stems and a curling lip.
// `zf` is the front at the centre, `w` the half width and `rise` the crest height.
function crest(view, zf, w, rise, phase, light, glow, thin, nBase, nLip, nStem) {
  for (let k = 0; k < nBase; k++) {
    if (hash(k + 31) < thin) continue;
    const u = k / (nBase - 1) * 2 - 1;
    const x = u * w, z = zf - 0.32 * u * u * w + 0.04 * Math.sin(u * 9 + phase);
    const dz = -0.64 * u * w * (2 / (nBase - 1)) + 0.0001;
    const ch = stroke(view, 2 / (nBase - 1) * w, dz, 0, k % 3 === 1 ? '=' : '~');
    put(view, x, z, 0, ch, tint(VINE, 0.3 + 0.35 * (1 - Math.abs(u))), light * (0.8 - 0.3 * Math.abs(u)));
  }
  if (rise <= 0.02) return;
  const lip = (u, out) => {
    out[0] = u * w * 0.94;
    out[1] = zf - 0.32 * u * u * w + 0.14 * rise;
    out[2] = rise * (1 - 0.5 * u * u) + 0.06 * rise * Math.sin(u * 7 - phase * 1.3);
    return out;
  };
  const a = [0, 0, 0], b = [0, 0, 0];
  for (let k = 0; k < nLip; k++) {
    if (hash(k + 77) < thin) continue;
    const u = (k / (nLip - 1) * 2 - 1) * 0.92;
    lip(u, a); lip(u + 0.04, b);
    const peak = Math.abs(u) < 0.08 || k % 6 === 3;
    const ch = peak && rise > 0.35 ? '^' : stroke(view, b[0] - a[0], b[1] - a[1], b[2] - a[2], '~');
    put(view, a[0], a[1], a[2], ch, tint(BLAZE, glow + 0.25 * (1 - Math.abs(u))), light * (0.75 + 0.25 * rise));
    // The lip spills forward and down: the breaking curl of the wave.
    if (k % 2 === 0 && rise > 0.3) {
      const curl = 0.5 + 0.5 * Math.sin(phase * 0.8 + k);
      put(view, a[0], a[1] + 0.16 * rise, a[2] * (0.62 + 0.1 * curl), k % 4 ? ',' : '~', tint(VINE, 0.6 + 0.3 * curl), light * 0.55 * rise);
    }
  }
  // Rising stems twist between base and lip ('(' and ')' alternate per row).
  for (let j = 0; j < nStem; j++) {
    const u = (j / (nStem - 1) * 2 - 1) * 0.8;
    lip(u, a);
    const rows = Math.min(5, Math.round(a[2] * 6));
    for (let r = 1; r < rows; r++) {
      const f = r / rows;
      const x = a[0] + 0.05 * Math.sin(f * 5 + j + phase);
      const z = zf - 0.32 * u * u * w + (a[1] - (zf - 0.32 * u * u * w)) * f;
      put(view, x, z, a[2] * f, (j + r) % 2 ? '(' : ')', tint(VINE, 0.35 + 0.3 * f), light * 0.7);
    }
  }
}

function drawCast(view, p, age, phase) {
  const fadeIn = smooth(span(p, 0, 0.07));
  // Anticipation: leaves spiral inward to the caster's feet.
  for (let i = 0; i < 18; i++) {
    const u = smooth(span(p, 0.01 + hash(i + 9) * 0.1, 0.27));
    const r = (1.05 + hash(i + 50) * 0.55) * (1 - u) + 0.12 * u;
    const a = hash(i) * TAU + u * 2.3;
    const light = fadeIn * (0.3 + 0.7 * u) * (1 - span(p, 0.26, 0.31));
    put(view, r * Math.sin(a), r * Math.cos(a), 0.3 * bell(u) * hash(i + 4), DOTS[Math.min(4, Math.floor(u * 5))], tint(VINE, 0.2 + 0.8 * u), light);
  }
  // A rooted knot tightens under the caster, then lingers as bark.
  const knot = 0.2 + 0.22 * easeOut(span(p, 0, 0.28)) - 0.08 * smooth(span(p, 0.3, 0.6));
  const knotLight = (0.35 + 0.65 * span(p, 0.1, 0.28)) * fadeIn * (1 - 0.55 * span(p, 0.3, 0.45)) * (1 - span(p, 0.6, 0.9));
  for (let i = 0; i < 14; i++) {
    const a = i / 14 * TAU + p * 2;
    put(view, knot * Math.sin(a), knot * Math.cos(a), 0, stroke(view, Math.cos(a), -Math.sin(a), 0, '='),
      tint(SOIL, 0.6 + 0.4 * span(p, 0.1, 0.28) - 0.6 * span(p, 0.35, 0.6)), knotLight);
  }
  // Burst flash as the wave tears loose.
  const flash = bell(span(p, 0.24, 0.4));
  if (flash > 0) {
    put(view, 0, 0.12, 0.1, '@', FLASH, flash);
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * TAU, r = 0.12 + 0.28 * span(p, 0.24, 0.4);
      put(view, r * Math.sin(a), 0.12 + r * Math.cos(a), 0.1, i % 2 ? '*' : '+', tint(BLAZE, 1 - span(p, 0.3, 0.4)), flash * 0.8);
    }
  }
  // The surge: a crescent of vines rears up, rolls forward and crashes.
  const su = easeOut(span(p, 0.26, 0.62));
  const zf = 0.4 + 2.6 * su, w = 0.35 + 1.0 * su;
  const rise = 0.95 * smooth(span(p, 0.26, 0.42)) * (1 - easeIn(span(p, 0.58, 0.84)));
  const waveLight = smooth(span(p, 0.26, 0.33)) * (1 - smooth(span(p, 0.72, 1)));
  const glow = 0.25 + 0.75 * (1 - span(p, 0.32, 0.55));
  if (waveLight > 0) {
    crest(view, zf, w, rise, phase, waveLight, glow, smooth(span(p, 0.7, 1)) * 0.85, 26, 21, 8);
    // The braid that feeds the wave, sinking from the caster outward afterwards.
    const from = easeIn(span(p, 0.6, 0.95));
    braid(view, 0.25, zf - 0.3, 26, from, phase, 0.17,
      t => waveLight * (0.5 + 0.5 * t),
      (t, s) => (s === 2 ? tint(VINE, 0.85) : tint(WITHER, span(p, 0.62, 1) * (1 - 0.4 * t) + s * 0.15)));
    // Thorns left standing where the wave broke.
    const thorns = smooth(span(p, 0.6, 0.72)) * (1 - span(p, 0.8, 1));
    for (let i = 0; i < 6 && thorns > 0; i++) {
      const u = (i + 0.5) / 6 * 2 - 1;
      put(view, u * w, zf - 0.32 * u * u * w - 0.12, 0.18 * thorns, '^', tint(WITHER, 0.35), thorns * 0.85);
    }
  }
  // Follow-through: leaves flung from the lip, drifting under drag, settling.
  for (let i = 0; i < 16; i++) {
    const tl = 0.4 + hash(i + 13) * 0.16, t = Math.max(0, p - tl) * 1.05;
    const show = smooth(span(p, tl, tl + 0.04)) * (1 - span(p, 0.74, 1));
    if (show <= 0) continue;
    const s0 = easeOut(span(tl, 0.26, 0.62));
    const u = hash(i + 3) * 1.8 - 0.9, w0 = 0.35 + s0;
    const drag = (1 - Math.exp(-2.4 * t)) / 2.4;
    const x = u * w0 * 0.94 + u * (0.5 + hash(i + 21)) * drag;
    const z = 0.4 + 2.6 * s0 - 0.32 * u * u * w0 + 0.12 + (1.0 + hash(i + 8) * 1.2) * drag;
    const h = Math.max(0, 0.8 * (1 - 0.5 * u * u) + (1 + hash(i + 5)) * drag - 2 * t * t);
    put(view, x, z, h, h > 0 ? LEAVES[Math.floor(t * 12 + hash(i) * 4) % 4] : ',', tint(WITHER, t * 0.9), show * (0.55 + 0.45 * hash(i + 2)));
  }
}

function drawProjectile(view, age) {
  const grow = easeOut(Math.min(1, 0.2 + age / 0.14)), phase = age * 9;
  // The rolling crest head, compact and bright.
  crest(view, 0.08, 0.5 * grow, 0.36 * grow, phase, grow, 0.55, 0, 13, 11, 5);
  // Spray flicked from the lip.
  for (let i = 0; i < 6; i++) {
    const t = (age + hash(i) * 0.3) % 0.3 / 0.3, u = hash(i + 40) * 1.6 - 0.8;
    put(view, u * 0.45 * grow + u * 0.15 * t, 0.2 + 0.25 * t, 0.36 * grow + 0.3 * t - 0.4 * t * t,
      LEAVES[i % 4], tint(BLAZE, 0.8 - 0.6 * t), grow * bell(t));
  }
  // A braided wake trailing behind, fading towards its tail.
  braid(view, -0.05, -0.05 - 1.85 * grow, 15, 0, phase, 0.14,
    t => grow * (0.95 - 0.7 * t),
    (t, s) => (s === 2 ? LEAF : tint(VINE, 0.85 - 0.6 * t - s * 0.12)));
  // Leaves shed by the wake, falling behind under drag.
  for (let i = 0; i < 12; i++) {
    const period = 0.42 + hash(i + 7) * 0.2;
    const t = (age + hash(i) * period) % period / period;
    const z0 = -0.2 - hash(i + 11) * 1.2, x0 = (hash(i + 17) - 0.5) * 0.4;
    put(view, x0 * (1 + t), z0 - 1.1 * (1 - Math.exp(-2.5 * t)), -0.9 * t * t,
      LEAVES[Math.floor(t * 9 + i) % 4], tint(WITHER, t * 0.8), grow * bell(t) * 0.75);
  }
}

function drawPulse(view, p, age) {
  const rise = easeOut(span(p, 0, 0.3)), sink = easeIn(span(p, 0.55, 1)), hf = rise * (1 - sink);
  const light = smooth(span(p, 0, 0.06)) * (1 - span(p, 0.75, 1));
  // A cracked ground ellipse and kicked-up soil.
  const cr = 0.25 + 0.35 * easeOut(span(p, 0, 0.25));
  for (let i = 0; i < 14; i++) {
    const a = i / 14 * TAU + hash(i) * 0.3;
    put(view, cr * Math.sin(a), cr * Math.cos(a) * 0.8, 0, i % 3 ? '.' : ',', tint(SOIL, 0.4 * (1 - p)), light * 0.55 * (1 - span(p, 0.3, 0.9)));
  }
  const t = age;
  for (let i = 0; i < 6; i++) {
    const a = hash(i + 60) * TAU, v = 0.8 + hash(i + 61);
    const d = v * (1 - Math.exp(-3 * t)) / 3, h = Math.max(0, 2.4 * t - 6 * t * t);
    put(view, d * Math.sin(a), d * Math.cos(a), h, h > 0 ? "'" : '.', tint(SOIL, 0.2), light * 0.7 * (1 - span(p, 0.4, 0.9)));
  }
  // Three twined tendrils erupt, hook over at the top, then sink back.
  for (let j = 0; j < 3; j++) {
    const ta = j / 3 * TAU + 0.5, bx = Math.sin(ta) * 0.34 + (hash(j) - 0.5) * 0.08, bz = Math.cos(ta) * 0.3;
    const top = (0.55 + 0.35 * hash(j + 7) + (j === 1 ? 0.2 : 0)) * hf, lean = Math.sin(ta) * 0.26;
    if (top < 0.04) continue;
    const n = 7;
    for (let s = 0; s <= 1; s++) {
      for (let i = 0; i < n; i++) {
        const f = (i + 0.5) / n, f2 = f + 0.08;
        const sway = 0.06 * Math.sin(f * 5 + age * 12 + j * 2);
        const twist = (s ? 1 : -1) * 0.05 * Math.cos(f * 9 + age * 10 + j);
        const x = bx + lean * f * f + sway + twist;
        const x2 = bx + lean * f2 * f2 + 0.06 * Math.sin(f2 * 5 + age * 12 + j * 2) + (s ? 1 : -1) * 0.05 * Math.cos(f2 * 9 + age * 10 + j);
        put(view, x, bz, top * f, stroke(view, x2 - x, 0, top * (f2 - f)), tint(VINE, 0.25 + 0.6 * f + s * 0.1), light * (0.55 + 0.45 * f) * (s ? 0.85 : 1));
      }
    }
    // The hooked tip curls outward and down.
    const side = lean < 0 ? -1 : 1;
    const tx = bx + lean + 0.06 * Math.sin(5 + age * 12 + j * 2);
    for (let k = 1; k <= 3; k++) {
      const a = k / 3 * Math.PI * 0.9;
      put(view, tx + side * 0.12 * Math.sin(a), bz, top + 0.1 * Math.cos(a) - 0.02, k === 3 ? (side > 0 ? ')' : '(') : stroke(view, side * Math.cos(a), 0, -Math.sin(a) * 0.5),
        tint(BLAZE, 0.3 + 0.4 * (1 - rise)), light);
    }
  }
}

function drawImpact(view, p, age) {
  const flash = 1 - smooth(span(p, 0, 0.2));
  // Hit flash at the centre.
  if (flash > 0.02) {
    put(view, 0, 0, 0.5, '@', FLASH, flash);
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * TAU + 0.4;
      put(view, 0.18 * Math.sin(a), 0.18 * Math.cos(a), 0.5, '*', BLAZE[BLAZE.length - 1], flash * 0.8);
    }
  }
  // A shock ring rolls out across the ground, white-hot to green, thinning.
  const rr = 0.2 + 1.0 * easeOut(span(p, 0, 0.32)), ringLight = 1 - span(p, 0.12, 0.45);
  for (let i = 0; i < 26 && ringLight > 0; i++) {
    if (hash(i + 90) < span(p, 0.15, 0.45)) continue;
    const a = i / 26 * TAU;
    const ch = ' .,:;*#'[Math.max(1, Math.min(6, Math.round(ringLight * 6)))];
    put(view, rr * Math.sin(a), rr * Math.cos(a), 0, ch, tint(BLAZE, flash), ringLight * (behind(view, Math.sin(a), Math.cos(a)) ? 0.7 : 1));
  }
  // Thorns erupt in a ring, then whip inward to bind the target.
  const sink = 1 - span(p, 0.5, 0.78);
  for (let i = 0; i < 9 && sink > 0; i++) {
    const a = (i + hash(i) * 0.5) / 9 * TAU, sa = Math.sin(a), ca = Math.cos(a);
    const e = easeOut(span(p, 0.02 + 0.05 * hash(i + 1), 0.22)), l = smooth(span(p, 0.22, 0.5));
    const rb = 0.75 + 0.15 * hash(i + 2), rt = rb - 0.1 - 0.45 * l, ht = (0.45 + 0.3 * hash(i + 3)) * e * (1 - 0.3 * l);
    if (e <= 0) continue;
    const dim = behind(view, sa, ca) ? 0.6 : 1;
    for (let k = 1; k <= 4; k++) {
      const f = k / 4, f0 = f - 0.25;
      const r = rb + (rt - rb) * f * f, r0 = rb + (rt - rb) * f0 * f0;
      const ch = k === 4 ? (l < 0.5 ? '^' : '*') : stroke(view, (r - r0) * sa, (r - r0) * ca, ht * 0.25);
      put(view, r * sa, r * ca, ht * f, ch, tint(k === 4 ? BLAZE : VINE, k === 4 ? 0.4 + 0.6 * flash : 0.3 + 0.15 * k), sink * dim * (0.6 + 0.1 * k));
    }
  }
  // Two vines coil up around the target, tightening; they wither from the top.
  const reveal = easeOut(span(p, 0.18, 0.5)) * (1 - easeIn(span(p, 0.72, 1)));
  const rc = 0.55 - 0.2 * smooth(span(p, 0.25, 0.6)), top = 1.5, turns = 2.2;
  const wither = span(p, 0.6, 0.95), coilLight = 1 - span(p, 0.8, 1);
  for (let s = 0; s < 2 && reveal > 0; s++) {
    for (let i = 0; i < 26; i++) {
      const f = (i + 0.5) / 26;
      if (f > reveal) break;
      const a = f * turns * TAU + s * Math.PI + p * 1.5, sa = Math.sin(a), ca = Math.cos(a);
      const da = turns * TAU / 26;
      const ch = stroke(view, rc * Math.cos(a) * da, -rc * Math.sin(a) * da, top / 26, '~');
      const lead = 1 - clamp01((reveal - f) * 5);
      put(view, rc * sa, rc * ca, top * f, ch, lead > 0.5 && wither === 0 ? tint(BLAZE, lead) : tint(WITHER, 0.15 + wither * 0.85 - 0.1 * s),
        coilLight * (behind(view, sa, ca) ? 0.38 : 0.95));
    }
  }
  // Leaves on the coil.
  for (let i = 0; i < 6 && reveal > 0; i++) {
    const f = 0.15 + i * 0.14;
    if (f > reveal) continue;
    const a = f * turns * TAU + (i % 2) * Math.PI + p * 1.5, sa = Math.sin(a);
    put(view, (rc + 0.1) * sa, (rc + 0.1) * Math.cos(a), top * f, sa > 0 ? ')' : '(', tint(WITHER, wither), coilLight * 0.85);
  }
  // Soil clods and torn leaves fly out ballistically and settle.
  for (let i = 0; i < 16; i++) {
    const a = hash(i + 70) * TAU, v = 1.2 + 1.6 * hash(i + 71), t = age;
    const d = 0.25 + v * (1 - Math.exp(-3 * t)) / 3, h = Math.max(0, (1.4 + 1.6 * hash(i + 72)) * t - 4.9 * t * t);
    const leaf = i % 2 === 0;
    put(view, d * Math.sin(a), d * Math.cos(a), h, leaf ? (h > 0 ? LEAVES[Math.floor(t * 14 + i) % 4] : ',') : (h > 0 ? 'o' : '.'),
      leaf ? tint(WITHER, span(p, 0.2, 1) * 0.7) : tint(SOIL, 0.1), (1 - span(p, 0.4, 1)) * smooth(span(p, 0, 0.05)) * 0.9);
  }
}

// Vines coiling up around the bound entity. The shape holds steady after a quick
// growth so the overlapping re-applied auras read as a single coil.
function drawAura(view, p, age) {
  const grow = easeOut(span(p, 0, 0.18)), unwrap = easeIn(span(p, 0.7, 1));
  const reveal = grow * (1 - unwrap);
  const rc = (0.5 - 0.13 * smooth(span(p, 0, 0.35))) * (1 + 0.04 * Math.sin(age * 6)), top = 1.6, turns = 2;
  const wither = span(p, 0.65, 1), light = 1 - span(p, 0.85, 1);
  // Roots spread in an ellipse at the feet.
  const rr = 0.32 + 0.28 * grow;
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * TAU + 0.2 * Math.sin(age * 1.5);
    put(view, rr * Math.sin(a), rr * Math.cos(a), 0, stroke(view, Math.cos(a), -Math.sin(a), 0, '~'),
      tint(WITHER, 0.45 + wither * 0.55), light * grow * (behind(view, Math.sin(a), Math.cos(a)) ? 0.4 : 0.7));
  }
  for (let s = 0; s < 2 && reveal > 0; s++) {
    for (let i = 0; i < 24; i++) {
      const f = (i + 0.5) / 24;
      if (f > reveal) break;
      const a = f * turns * TAU + s * Math.PI, sa = Math.sin(a), ca = Math.cos(a), da = turns * TAU / 24;
      const r = rc * (1 - 0.25 * f);
      const ch = stroke(view, r * ca * da, -r * sa * da, top / 24, '~');
      put(view, r * sa, r * ca, top * f, ch, tint(WITHER, 0.1 + wither * 0.9 + 0.15 * f * (1 - wither) - 0.1 * s),
        light * (behind(view, sa, ca) ? 0.35 : 0.9) * (0.7 + 0.3 * f));
    }
  }
  for (let i = 0; i < 8 && reveal > 0; i++) {
    const f = 0.12 + i * 0.11;
    if (f > reveal) continue;
    const a = f * turns * TAU + (i % 2) * Math.PI, sa = Math.sin(a), r = rc * (1 - 0.25 * f) + 0.1;
    put(view, r * sa, r * Math.cos(a), top * f, sa > 0 ? ')' : '(', tint(VINE, 0.75 - wither * 0.5), light * 0.8 * (behind(view, sa, Math.cos(a)) ? 0.5 : 1));
  }
  // Venom drips from the coil (Vine Wave poisons what it binds).
  for (let i = 0; i < 8; i++) {
    const period = 0.6 + hash(i + 30) * 0.4, t = (age + hash(i + 31) * period) % period / period;
    const a = hash(i + 32) * TAU, h0 = (0.3 + 0.6 * hash(i + 33)) * top * reveal;
    put(view, (rc + 0.04) * Math.sin(a), (rc + 0.04) * Math.cos(a), Math.max(0, h0 * (1 - t * t)), t < 0.85 ? (t < 0.3 ? ',' : '.') : '_',
      VENOM, grow * light * bell(t) * 0.75);
  }
}

// Not produced by Vine Wave's gameplay, but authored: a braided thicket ring.
function drawZone(view, p, age, radius) {
  const R = Math.min(3, Math.max(0.6, radius)), grow = easeOut(span(p, 0, 0.12));
  const light = smooth(span(p, 0, 0.05)) * (1 - smooth(span(p, 0.85, 1)));
  const n = Math.min(52, Math.ceil(R * 18));
  for (let s = 0; s < 2; s++) {
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU + age * 0.25, sa = Math.sin(a), ca = Math.cos(a);
      if (a / TAU % 1 > grow) continue;
      const r = R + (s ? 1 : -1) * 0.08 * Math.sin(a * 7 + age * 3);
      put(view, r * sa, r * ca, 0, stroke(view, ca, -sa, 0, '~'), tint(VINE, 0.3 + 0.25 * s), light * (s ? 0.75 : 0.9));
    }
  }
  for (let j = 0; j < 6; j++) {
    const a = j / 6 * TAU + age * 0.25 + 0.3, sa = Math.sin(a), ca = Math.cos(a);
    const top = (0.5 + 0.3 * hash(j)) * grow * (1 + 0.1 * Math.sin(age * 4 + j));
    for (let k = 1; k <= 5; k++) {
      const f = k / 5, sway = 0.07 * Math.sin(f * 4 + age * 5 + j);
      put(view, (R - 0.1 * f) * sa + sway, (R - 0.1 * f) * ca, top * f, k === 5 ? '^' : (k % 2 ? '(' : ')'), tint(VINE, 0.4 + 0.5 * f), light * (0.6 + 0.4 * f));
    }
  }
  for (let i = 0; i < 10; i++) {
    const t = (age * 0.5 + hash(i)) % 1, a = hash(i + 5) * TAU, r = R * (0.3 + 0.6 * hash(i + 6));
    put(view, r * Math.sin(a + t), r * Math.cos(a + t), 0.4 * (1 - t), LEAVES[i % 4], tint(WITHER, t), light * bell(t) * 0.6);
  }
}

export default {
  id: 'temp-vine-wave',
  duration: 1.05,
  draw(effect, plot) {
    const p = clamp01(fin(effect.progress, 0));
    const age = Math.max(0, fin(effect.age, 0));
    const heading = fin(effect.heading, 0);
    // Every stage reaches darkness exactly at the end of its clock.
    const view = { hc: Math.cos(heading), hs: Math.sin(heading), end: Math.min(1, (1 - p) * 8), plot };
    const stage = effect.stage;
    if (stage === 'projectile') drawProjectile(view, age);
    else if (stage === 'impact') drawImpact(view, p, age);
    else if (stage === 'pulse') drawPulse(view, p, age);
    else if (stage === 'aura') drawAura(view, p, age);
    else if (stage === 'zone') drawZone(view, p, age, fin(effect.radius, 1));
    else drawCast(view, p, age, age * 8);
  },
  sounds: {
    // Twisted branches strain, then swinging air carries a drag of living leaves.
    cast: [
      { kind: 'recording', url: '/assets/audio/spells/cerrith/branch-strain.wav', gain: 0.48, rate: 0.84, delay: 0 },
      { kind: 'recording', url: '/assets/audio/spells/cerrith/cloth-sweep.wav', gain: 0.25, rate: 0.92, delay: 0.23 },
      { kind: 'recording', url: '/assets/audio/spells/cerrith/leaf-drift.wav', gain: 0.27, rate: 0.9, delay: 0.34 },
    ],
    // A physical snap catches the victim; buried roots creak as the binding holds.
    impact: [
      { kind: 'recording', url: '/assets/audio/spells/cerrith/branch-snap.wav', gain: 0.52, rate: 0.88, delay: 0 },
      { kind: 'recording', url: '/assets/audio/spells/cerrith/earth-impact.wav', gain: 0.22, rate: 0.86, delay: 0.025 },
      { kind: 'recording', url: '/assets/audio/spells/cerrith/root-creak.wav', gain: 0.29, rate: 0.8, delay: 0.12 },
    ],
    // One restrained leaf movement marks each travelling tendril.
    pulse: [
      { kind: 'recording', url: '/assets/audio/spells/cerrith/leaf-turn.wav', gain: 0.16, rate: 1.12, delay: 0 },
    ],
  },
};
