// Tide Shard: seawater is wrung into a crystalline spear that leaves the hand
// with a bow splash, spirals a twin wake through the air and bursts into a
// rising crown of beads, shard fragments and rolling ripples on impact.
//
// Geometry is authored in local metres (+z is the cast heading). Glyph slants
// and height are resolved against the heading so the shard, its edges and
// the falling droplets read correctly in every direction on screen.

// Deep sea to white foam; tone(v) picks a stop without allocating per glyph.
const STOPS = [[18, 52, 118], [32, 116, 177], [38, 170, 200], [48, 219, 218], [150, 240, 240], [236, 255, 253]];
const TONES = Array.from({ length: 21 }, (_, i) => {
  const at = i / 20 * (STOPS.length - 1), k = Math.min(STOPS.length - 2, Math.floor(at)), f = at - k;
  return STOPS[k].map((c, j) => Math.round(c + (STOPS[k + 1][j] - c) * f));
});
const tone = v => TONES[Math.round((v < 0 ? 0 : v > 1 ? 1 : v) * 20)];
const BODY = ':-=+*#', WAKE = '.,-~~', FLASH = '.:+*#@';
const COLS = 13 / 0.6, ROWS = 6.5, LIFT = 5 / 6.5, HAND = 1.5;
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeOut = t => 1 - (1 - clamp01(t)) ** 3;
const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const pick = (set, v) => set[Math.round(clamp01(v) * (set.length - 1))];

// Every helper takes the per-draw view `o` ({ c, s, plot }) created inside draw(), so no
// state is shared between calls and a draw nested inside a plot callback cannot redirect
// or re-orient the outer one.
// A point at local (x, z) raised h metres above the ground.
const put = (o, x, z, h, ch, v, b) => o.plot(x + h * LIFT * o.s, z - h * LIFT * o.c, ch, tone(v), b < 0 ? 0 : b);
const screen = (o, dx, dz, dh) => [(dx * o.c + dz * o.s) * COLS, (dz * o.c - dx * o.s - dh * LIFT) * ROWS];
const cells = (o, dx, dz, dh = 0) => { const [x, y] = screen(o, dx, dz, dh); return Math.hypot(x, y); };
// The slash that matches a direction as it appears on screen (cells are 0.6 wide).
function slant(o, dx, dz, dh = 0) {
  const [x, y] = screen(o, dx, dz, dh);
  let a = Math.atan2(y, x * 0.6);
  if (a < 0) a += Math.PI;
  return a < 0.39 || a > 2.75 ? '-' : a < 1.18 ? '\\' : a < 1.96 ? '|' : '/';
}

// A pointed spear of water: rounded tail, widest a third along, needle tip.
function shard(o, cz, h, len, wid, age, b, glow) {
  const z0 = cz - len * 0.42, half = t => wid * Math.sqrt(t) * (1 - t) / 0.385;
  const n = Math.max(5, Math.min(22, Math.ceil(cells(o, 0, len))));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, z = z0 + t * len, w = half(t);
    const span = cells(o, 2 * w, 0), flow = 0.5 + 0.5 * Math.sin(t * 13 - age * 26);
    if (span < 2) {
      put(o, 0, z, h, pick(BODY, 0.45 + t * 0.3 + flow * 0.25), 0.62 + t * 0.3 + glow, b);
      continue;
    }
    const slope = wid / 0.385 * (0.5 / Math.sqrt(t) * (1 - t) - Math.sqrt(t)) / len;
    put(o, -w, z, h, slant(o, -slope, 1), 0.7 + t * 0.2 + glow, b * (0.75 + t * 0.25));
    put(o, w, z, h, slant(o, slope, 1), 0.78 + t * 0.2 + glow, b * (0.75 + t * 0.25));
    const inner = Math.min(3, Math.floor(span / 1.6));
    for (let k = 0; k < inner; k++) {
      const u = (k + 1) / (inner + 1) * 2 - 1, core = 1 - Math.abs(u);
      const shine = 0.5 + 0.5 * Math.sin(t * 11 - age * 26 + u * 2.4);
      put(o, u * w * 0.85, z, h, pick(BODY, core * 0.55 + t * 0.2 + shine * 0.3), 0.45 + core * 0.3 + shine * 0.2 + glow, b * (0.6 + core * 0.4));
    }
  }
  // Glinting needle tip and a rounded droplet tail.
  put(o, 0, z0 + len * 1.04, h, '*', 1, b * (0.85 + 0.15 * Math.sin(age * 40)));
  put(o, 0, z0 - len * 0.04, h, 'o', 0.45 + glow, b * 0.8);
}

function projectile(o, e) {
  const age = e.age, size = Math.min(1.4, e.radius / 0.65), b = clamp01((1 - e.progress) * 10);
  const grow = 0.6 + 0.4 * smooth(0, 0.06, age), len = 1.1 * size * grow, wid = 0.13 * size;
  shard(o, 0, 0, len, wid, age, b, 0.05);
  // A twin helix of churned water spirals off the tail and widens as it slows.
  const tail = -len * 0.42;
  for (let j = 0; j < 11; j++) {
    const s = (j + 0.5) / 11, d = 0.12 + s * 1.5 * size * grow, amp = wid * (0.5 + s * 2.6);
    const phase = d * 6.5 - age * 24, fade = b * (1 - s) ** 1.3 * 0.9;
    put(o, Math.sin(phase) * amp, tail - d, Math.cos(phase) * amp * 0.5, pick(WAKE, 1 - s * 0.8), 0.66 - s * 0.5, fade);
    put(o, -Math.sin(phase) * amp, tail - d, -Math.cos(phase) * amp * 0.5, pick(WAKE, 0.9 - s * 0.8), 0.5 - s * 0.45, fade * 0.8);
  }
  // Droplets are shed from the shoulders, lag behind and drop away.
  for (let i = 0; i < 8; i++) {
    const ph = (age * 3.4 + hash(i)) % 1, side = i % 2 ? 1 : -1;
    const x = side * (wid + ph * (0.25 + hash(i + 9) * 0.35) * size), z = tail + len * 0.2 - ph * 1.3 * size;
    const lift = ph * (0.18 - ph * 0.55) * size, fall = 0.18 - ph * 1.1;
    put(o, x, z, lift, fall > 0 ? '\'' : ph < 0.75 ? ',' : '.', 0.85 - ph * 0.55, b * smooth(0, 0.12, ph) * (1 - ph) * 0.9);
  }
}

function cast(o, e) {
  const p = e.progress, age = e.age, k = Math.min(1.5, Math.max(0.6, e.radius / 0.8));
  const env = 1 - smooth(0.72, 1, p), hz = 0.32 * k;
  // Wind-up: three water ribbons spiral up from the feet into the casting hand.
  const gather = smooth(-0.02, 0.03, p) * (1 - smooth(0.12, 0.2, p)), g = easeOut(p / 0.16);
  if (gather > 0) {
    for (let a = 0; a < 3; a++) {
      for (let j = 0; j < 8; j++) {
        const s = j / 7, r = ((1 - g) * 0.85 + s * 0.45 * (1 - g * 0.7)) * k, ang = a * 2.094 + r * 3.2 + p * 7;
        put(o, Math.sin(ang) * r, hz + Math.cos(ang) * r, HAND * (1 - r / (1.6 * k)), pick('.~~o', 1 - s), 0.95 - s * 0.55, gather * (1 - s * 0.7));
      }
    }
  }
  // Release flash and a short bright jet chasing the departing shard.
  const flash = smooth(0.06, 0.12, p) * (1 - smooth(0.13, 0.36, p)), q = clamp01((p - 0.1) / 0.3);
  if (flash > 0) {
    put(o, 0, hz, HAND, '@', 1, flash);
    for (let r = 0; r < 8; r++) {
      const a = r * 0.785 + 0.39, reach = (0.2 + easeOut(q * 2.5) * 0.45) * k;
      for (let j = 1; j <= 3; j++) {
        const t = j / 3, dx = Math.sin(a) * reach * t, dh = Math.cos(a) * reach * t;
        put(o, dx, hz, HAND + dh, pick(FLASH, 1 - t * 0.85), 1 - t * 0.35, flash * (1 - t * 0.5));
      }
    }
  }
  if (q > 0 && q < 1) {
    const front = hz + easeOut(q) * 2.8 * k, back = hz + q * q * 2.8 * k, len = front - back;
    const n = 10, ch = slant(o, 0, 1);
    for (let j = 0; j < n; j++) {
      const t = (j + 0.5) / n;
      put(o, 0, back + len * t, HAND, t > 0.86 ? '*' : ch, 0.7 + t * 0.3, smooth(0, 0.06, q) * (1 - q) * (0.45 + t * 0.55));
    }
  }
  // Bow splash: droplets burst forward and sideways, arc under gravity and bead the ground.
  const tau = Math.max(0, (p - 0.1) * 0.78);
  if (p > 0.1) {
    for (let i = 0; i < 30; i++) {
      const back = i % 5 === 4, a = back ? Math.PI + (hash(i) - 0.5) * 2.2 : (hash(i) - 0.5) * 1.6;
      const v = (back ? 0.6 : 1.2) + hash(i + 31) * 1.7, up = 0.2 + hash(i + 57) * 1.5;
      const d = v * (1 - Math.exp(-3 * tau)) / 3 * k, h = HAND + up * tau - 8 * tau * tau;
      const landed = h <= 0, x = Math.sin(a) * d, z = hz + Math.cos(a) * d;
      if (landed) {
        const since = (tau - (up + Math.sqrt(up * up + 32 * HAND)) / 16) / 0.25;
        put(o, x, z, 0, '.', 0.3, env * 0.55 * (1 - clamp01(since)));
      } else {
        const rising = up - 16 * tau > 0;
        put(o, x, z, h, hash(i + 77) > 0.86 ? 'o' : rising ? '\'' : ',', 0.95 - tau * 0.7, env * smooth(0.1, 0.13, p) * (0.75 + hash(i + 5) * 0.25));
      }
    }
  }
  // Ground ripples roll out around the caster and thin away.
  for (let ring = 0; ring < 2; ring++) {
    const rq = clamp01((p - 0.1 - ring * 0.16) / 0.72);
    if (rq <= 0) continue;
    // Each ring swells in from nothing as it starts rolling, so it never pops into view.
    const r = (0.25 + easeOut(rq) * (1.05 - ring * 0.25)) * k, enter = smooth(0, 0.12, rq);
    for (let i = 0; i < 22; i++) {
      const a = i * 0.2856 + ring * 0.14, rr = r * (1 + 0.06 * Math.sin(a * 6 + p * 9));
      const keep = smooth(hash(i + ring * 40) * 0.6, hash(i + ring * 40) * 0.6 + 0.4, 1 - rq);
      put(o, Math.sin(a) * rr, Math.cos(a) * rr, 0, pick('.-~', (1 - rq) * 1.2), 0.55 - rq * 0.4 - ring * 0.1, enter * keep * env * (0.9 - ring * 0.2));
    }
  }
  // A few drips fall from the hand after the release.
  for (let i = 0; i < 4; i++) {
    const t0 = 0.2 + i * 0.12, ft = Math.max(0, (p - t0) * 0.78), h = HAND * 0.9 - 4.9 * ft * ft;
    const drip = p > t0 ? env * 0.8 * smooth(0, 0.35, h) * smooth(t0, t0 + 0.03, p) : 0;
    put(o, (hash(i + 3) - 0.5) * 0.25 * k, hz - 0.05, Math.max(0, h), i % 2 ? '\'' : ',', 0.8, drip);
  }
}

function impact(o, e) {
  const p = e.progress, k = Math.min(1.6, Math.max(0.6, e.radius)), env = 1 - smooth(0.78, 1, p);
  const core = 0.9;
  // Strike flash: a white starburst at the point of impact.
  const flash = 1 - smooth(0, 0.2, p);
  if (flash > 0) {
    put(o, 0, 0, core, '@', 1, flash);
    for (let r = 0; r < 8; r++) {
      const a = r * 0.785, reach = (0.3 + easeOut(p / 0.2) * 0.35) * k;
      for (let j = 1; j <= 4; j++) {
        const t = j / 4;
        put(o, Math.sin(a) * reach * t, 0, core + Math.cos(a) * reach * t, pick(FLASH, 1 - t * 0.9), 1 - t * 0.3, flash * (1 - t * 0.55));
      }
    }
  }
  // The shard shatters; fragments keep its momentum, slowed by drag, and fall.
  for (let i = 0; i < 12; i++) {
    const a = i < 8 ? (hash(i + 3) - 0.5) * 2.6 : hash(i + 3) * 6.283, v = (0.5 + hash(i + 11) * 0.75) * k;
    const reach = v * (1 - Math.exp(-4 * p)) / (1 - Math.exp(-4)), up = 0.5 + hash(i + 19) * 0.7;
    const h = Math.max(0, core + up * p * 1.6 - 2.6 * p * p), x = Math.sin(a) * reach, z = Math.cos(a) * reach;
    const vx = Math.sin(a) * v * Math.exp(-4 * p), vz = Math.cos(a) * v * Math.exp(-4 * p), vh = up * 1.6 - 5.2 * p;
    const b = env * (1 - p) ** 1.4;
    put(o, x, z, h, slant(o, vx, vz, vh), 1 - p * 0.75, b);
    put(o, x - vx * 0.08, z - vz * 0.08, h - vh * 0.08, '.', 0.7 - p * 0.5, b * 0.55);
  }
  // A crown of water spikes rises around the strike, then sheds its beads.
  const rise = Math.sin(Math.PI * clamp01(p / 0.62)), rc = (0.15 + easeOut(p / 0.45) * 0.45) * k;
  for (let i = 0; i < 16; i++) {
    const a = i * 0.3927 + 0.2, j = hash(i + 101), sx = Math.sin(a), sz = Math.cos(a);
    const top = 0.6 * k * (0.7 + 0.3 * j) * rise, lean = 0.15 * k;
    // Upper segments grow in (and sink away) with the spike so short spikes never stack glyphs.
    for (let s = 0; s < 3; s++) {
      const t = s / 3, r = rc + lean * t * t, grown = smooth(0.03 + s * 0.09, 0.09 + s * 0.09, top);
      put(o, sx * r, sz * r, top * t, slant(o, sx * lean * 2 * t, sz * lean * 2 * t, top + 0.01), 0.45 + t * 0.4, env * (0.55 + t * 0.4) * grown);
    }
    // Each spike tip carries a bead; past the crest it detaches and falls outward.
    const peak = 0.6 * k * (0.7 + 0.3 * j), shed = clamp01((p - 0.42) / 0.38);
    const r = rc + lean + shed * (0.25 + j * 0.2) * k, h = shed > 0 ? peak * Math.sin(Math.PI * 0.42 / 0.62) * (1 - shed * shed) : top;
    if (p < 0.8) put(o, sx * r, sz * r, h, shed > 0.75 ? ',' : 'o', 1 - shed * 0.4, env * (shed > 0 ? 1 - shed * 0.5 : smooth(0, 0.08, p)));
    else put(o, sx * r, sz * r, 0, '.', 0.35, env * 0.5);
  }
  // Two scalloped ripples roll across the ground and thin out.
  for (let ring = 0; ring < 2; ring++) {
    const rq = clamp01((p - ring * 0.25) / (1 - ring * 0.25)), r = (0.25 + easeOut(rq) * (1.0 - ring * 0.35)) * k;
    if (rq <= 0) continue;
    // The delayed ring swells in from nothing instead of popping into view.
    const n = 30 - ring * 8, enter = smooth(0, 0.12, rq);
    for (let i = 0; i < n; i++) {
      const a = i / n * 6.283 + ring * 0.12, rr = r * (1 + 0.07 * Math.sin(a * 7 - p * 8));
      const keep = smooth(hash(i + 60 * ring) * 0.55, hash(i + 60 * ring) * 0.55 + 0.45, 1 - rq);
      put(o, Math.sin(a) * rr, Math.cos(a) * rr, 0, pick('.-~', 1.1 - rq), 0.55 - rq * 0.35 - ring * 0.12, enter * env * keep * (0.8 - ring * 0.25));
    }
  }
  // The settling pool at the centre.
  const pool = smooth(0.1, 0.25, p) * env;
  for (let i = 0; i < 6; i++) {
    const a = i * 1.047 + p * 2, r = 0.22 * k * (1 - p * 0.4);
    put(o, Math.sin(a) * r, Math.cos(a) * r, 0, i % 2 ? '~' : '=', 0.25, pool * 0.7);
  }
}

function pulse(o, e) {
  const p = e.progress, g = easeOut(p), env = 1 - smooth(0.55, 1, p), fadeIn = smooth(0, 0.08, p);
  if (e.radius < 1.8) {
    // In-flight ticks: a small wake on the water below the shard.
    const k = Math.max(0.6, e.radius);
    for (let side = -1; side <= 1; side += 2) {
      for (let s = 0; s < 5; s++) {
        const t = (s + 1) / 5;
        put(o, side * (0.06 + t * 0.4 * g) * k, -t * 0.7 * g * k, 0, s < 2 ? '~' : ',', 0.6 - t * 0.35, env * fadeIn * (1 - t * 0.6) * 0.75);
      }
    }
    for (let i = 0; i < 4; i++) {
      const a = (hash(i + 13) - 0.5) * 2.4 + Math.PI, r = (0.15 + hash(i + 7) * 0.3) * g * k;
      const h = (0.25 + hash(i + 2) * 0.3) * Math.sin(Math.PI * p) * k;
      put(o, Math.sin(a) * r, Math.cos(a) * r, h, p < 0.5 ? '\'' : '.', 0.85 - p * 0.4, env * 0.8);
    }
    return;
  }
  // The wide hit splash: a fast ring with radial spray streaks.
  const R = Math.min(4, e.radius), r = (0.15 + g * 0.45) * R;
  for (let i = 0; i < 28; i++) {
    const a = i * 0.2244, rr = r * (1 + 0.06 * Math.sin(a * 5 + p * 6));
    put(o, Math.sin(a) * rr, Math.cos(a) * rr, 0, pick('.-~', 1.1 - p), 0.6 - p * 0.35, env * fadeIn * 0.7);
  }
  for (let i = 0; i < 14; i++) {
    const a = i * 0.449 + hash(i) * 0.3, d = (0.1 + g * (0.3 + hash(i + 4) * 0.25)) * R;
    const h = Math.sin(Math.PI * p) * (0.3 + hash(i + 8) * 0.4);
    put(o, Math.sin(a) * d, Math.cos(a) * d, h, p < 0.45 ? '\'' : ',', 0.95 - p * 0.5, env * 0.9);
    put(o, Math.sin(a) * d * 0.8, Math.cos(a) * d * 0.8, h * 0.6, '.', 0.6 - p * 0.3, env * 0.45);
  }
}

// Aura and zone (not used by the rune, kept for the contract): a slow tidal eddy.
function eddy(o, e) {
  const p = e.progress, age = e.age, k = Math.min(3, Math.max(0.6, e.radius));
  const env = smooth(0, 0.06, p) * (1 - smooth(0.85, 1, p));
  for (let i = 0; i < 26; i++) {
    const a = i * 0.2417 + age * 1.6, r = k * (0.9 + 0.06 * Math.sin(a * 5 - age * 4));
    put(o, Math.sin(a) * r, Math.cos(a) * r, 0, pick('.-~', 0.5 + 0.5 * Math.sin(a * 3 - age * 5)), 0.5, env * 0.7);
  }
  for (let arm = 0; arm < 3; arm++) {
    for (let j = 0; j < 9; j++) {
      const s = j / 8, r = k * (0.2 + s * 0.7), a = arm * 2.094 + age * 2.2 - s * 2.4;
      put(o, Math.sin(a) * r, Math.cos(a) * r, 0, pick(WAKE, 1 - s), 0.75 - s * 0.4, env * (1 - s * 0.6) * 0.8);
    }
  }
  for (let i = 0; i < 10; i++) {
    const ph = (age * 0.9 + hash(i)) % 1, a = hash(i + 20) * 6.283, r = k * (0.3 + hash(i + 40) * 0.6);
    put(o, Math.sin(a) * r, Math.cos(a) * r, Math.sin(Math.PI * ph) * 0.5 * k, ph < 0.5 ? '\'' : ',', 0.9 - ph * 0.4, env * Math.sin(Math.PI * ph) * 0.9);
  }
}

export default {
  id: 'tide-shard',
  duration: 0.78,
  draw(effect, plot) {
    const o = { c: Math.cos(effect.heading || 0), s: Math.sin(effect.heading || 0), plot };
    if (effect.stage === 'projectile') projectile(o, effect);
    else if (effect.stage === 'cast') cast(o, effect);
    else if (effect.stage === 'impact') impact(o, effect);
    else if (effect.stage === 'pulse') pulse(o, effect);
    else eddy(o, effect);
  },
  sounds: {
    // A compact pressure draw releases a spear through dark, narrow surf.
    cast: [
      { kind: 'tone', type: 'sine', frequency: 92, endFrequency: 138, duration: 0.14, gain: 0.065, attack: 0.028, decay: 0.025, sustain: 0.65, release: 0.07 },
      { kind: 'noise', delay: 0.035, duration: 0.2, gain: 0.075, cutoff: 940, filterType: 'bandpass', Q: 1.4, playbackRate: 0.78, attack: 0.018, decay: 0.045, sustain: 0.3, release: 0.12 },
      { kind: 'tone', type: 'triangle', frequency: 328, endFrequency: 94, delay: 0.05, duration: 0.23, gain: 0.048, cutoff: 620, Q: 0.65, attack: 0.005, decay: 0.045, sustain: 0.24, release: 0.16 },
      { kind: 'noise', delay: 0.09, duration: 0.29, gain: 0.044, cutoff: 320, filterType: 'lowpass', Q: 0.8, playbackRate: 0.6, attack: 0.015, decay: 0.065, sustain: 0.22, release: 0.19 },
    ],
    // The tip cracks wetly, followed by a hollow implosion and a drowned wake.
    impact: [
      { kind: 'noise', duration: 0.09, gain: 0.075, cutoff: 1650, filterType: 'bandpass', Q: 0.8, attack: 0.002, decay: 0.018, sustain: 0.2, release: 0.06 },
      { kind: 'tone', type: 'sine', frequency: 158, endFrequency: 49, duration: 0.33, gain: 0.09, attack: 0.003, decay: 0.055, sustain: 0.28, release: 0.24 },
      { kind: 'noise', delay: 0.028, duration: 0.43, gain: 0.07, cutoff: 460, filterType: 'lowpass', Q: 1.2, playbackRate: 0.64, attack: 0.016, decay: 0.08, sustain: 0.28, release: 0.31 },
      { kind: 'tone', type: 'triangle', frequency: 263, endFrequency: 117, delay: 0.055, duration: 0.34, gain: 0.035, cutoff: 420, Q: 0.7, attack: 0.01, decay: 0.06, sustain: 0.19, release: 0.25 },
    ],
    // Restrained water drag for repeated flight ticks and the radial hit spray.
    pulse: [
      { kind: 'noise', duration: 0.12, gain: 0.018, cutoff: 650, filterType: 'bandpass', Q: 1.1, playbackRate: 0.7, attack: 0.012, decay: 0.025, sustain: 0.25, release: 0.07 },
      { kind: 'tone', type: 'sine', frequency: 126, endFrequency: 81, duration: 0.14, gain: 0.014, attack: 0.007, decay: 0.028, sustain: 0.2, release: 0.095 },
      { kind: 'noise', delay: 0.025, duration: 0.14, gain: 0.01, cutoff: 240, filterType: 'lowpass', Q: 0.7, attack: 0.015, decay: 0.025, sustain: 0.2, release: 0.09 },
    ],
  },
};
