// Hailpiercer: a rapid volley of ice harpoons. A frost sigil snaps open and its
// crystal fires on the gameplay cadence, then draws hail back in and bursts;
// harpoons punch through foes in a white streak and exit spray, and the
// ground along the line splits into erupting spears of ice.

// Local metres -> terminal cells, matching the renderer (SCALE 13, ASPECT 0.6,
// TILT 0.5). Used to orient line glyphs on screen and to keep samples one cell
// apart, so the drawing reads the same at any heading.
const COLS = 13 / 0.6;
const ROWS = 13 * 0.5;
const CELL = 0.6; // a cell is 0.6 as wide as it is tall
const LIFT = 5 / ROWS; // depth offset that reads as one metre of height (5 rows)

const WHITE = [244, 253, 255];
const CORE = [206, 244, 255];
const ICE = [126, 215, 251];
const DEEP = [74, 141, 205];
const DUSK = [44, 88, 158];

// Volley cadence, mirroring the definition as the runtime runs it:
// TEMP_Hailpiercer_CAST runs TEMP_Hailpiercer_PRO with `repeat: 5`, i.e. once
// plus five repeats, `repeati: 5` ticks apart, so the harpoons leave a quarter
// second apart. (The definition imports this module, so it can't be imported here.)
const TICK = 1 / 20;
const REPEAT = 5;
const REPEAT_TICKS = 5;
// Seconds after the cast at which each harpoon launches.
export const LAUNCHES = Object.freeze(Array.from({ length: REPEAT + 1 }, (_, i) => i * REPEAT_TICKS * TICK));

// The volley, then a fixed-length follow-through (refill, shatter, fade).
const DURATION = LAUNCHES[LAUNCHES.length - 1] + 1.1;
const sec = t => t / DURATION; // seconds to cast progress
const SHOTS = LAUNCHES.map(sec); // launches in cast progress
const LAST = SHOTS[SHOTS.length - 1];
const KICK = sec(Math.min(0.15, 0.6 * REPEAT_TICKS * TICK)); // crystal recoil, shorter than the gap between shots
const BURST = sec(0.09); // muzzle burst length
const OPEN = LAST + sec(0.045); // hail starts rising into the emptied crystal
const REFILL = LAST + sec(0.55); // the emptied crystal has drawn its hail back in
const SHATTER = REFILL + sec(0.12); // ...and bursts into falling hail as the sigil evaporates
export const PHASES = Object.freeze({ refill: REFILL, shatter: SHATTER });

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = v => { v = clamp01(v); return v * v * (3 - 2 * v); };
const easeOut = v => 1 - (1 - clamp01(v)) ** 3;
const easeIn = v => clamp01(v) ** 2;
const backOut = v => { v = clamp01(v) - 1; return 1 + 2.7 * v ** 3 + 1.7 * v ** 2; };
const hash = n => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Intensity 0..1 -> deep blue through ice to a white-hot core.
function frost(t) {
  t = clamp01(t);
  if (t < 0.3) return mix(DUSK, DEEP, t / 0.3);
  if (t < 0.6) return mix(DEEP, ICE, (t - 0.3) / 0.3);
  if (t < 0.85) return mix(ICE, CORE, (t - 0.6) / 0.25);
  return mix(CORE, WHITE, (t - 0.85) / 0.15);
}
const MOTE = '.:+*';
const mote = t => MOTE[Math.min(3, Math.floor(clamp01(t) * 4))];

// A heading-aware pen. Points are local ground metres (x across, z forward)
// plus `lift` metres of height and `side` metres straight across the screen.
function pen(effect, plot) {
  const heading = Number.isFinite(effect.heading) ? effect.heading : 0;
  const c = Math.cos(heading), s = Math.sin(heading);
  const screen = (dx, dz, lift, side) => {
    const wx = dx * c + dz * s + side, wz = dz * c - dx * s - lift * LIFT;
    return [wx * COLS, wz * ROWS];
  };
  return {
    dot(x, z, lift, side, char, color, brightness) {
      if (!(brightness > 0.004)) return;
      plot(x + c * side + s * lift * LIFT, z + s * side - c * lift * LIFT, char, color, clamp01(brightness));
    },
    // Line glyph for a local direction as it appears on screen.
    line(dx, dz, lift = 0, side = 0) {
      const [cx, cy] = screen(dx, dz, lift, side);
      let a = Math.atan2(cy, cx * CELL);
      if (a < 0) a += Math.PI;
      if (a < Math.PI / 8 || a > Math.PI * 7 / 8) return '-';
      if (a < Math.PI * 3 / 8) return '\\';
      if (a < Math.PI * 5 / 8) return '|';
      return '/';
    },
    arrow(dx, dz, lift = 0, side = 0) {
      const [cx, cy] = screen(dx, dz, lift, side);
      if (Math.abs(cy) >= Math.abs(cx * CELL)) return cy > 0 ? 'v' : '^';
      return cx > 0 ? '>' : '<';
    },
    // Cells spanned by a local offset; used to sample one glyph per cell.
    span(dx, dz, lift = 0, side = 0) {
      const [cx, cy] = screen(dx, dz, lift, side);
      return Math.max(Math.abs(cx), Math.abs(cy));
    },
  };
}

// A free-standing ice spear: '/' and '\' flanks tapering to a '^' point,
// with a bright '|' facet down the middle of wide rows.
// `glint` (0..1, or < 0 for none) is the height of a white band sliding up the facets.
function spear(v, x, z, height, width, b, heat, lean = 0, glint = -1) {
  if (height <= 0.02 || b <= 0) return;
  const rows = Math.max(1, Math.round(height * 5));
  for (let i = 0; i < rows; i++) {
    const f = i / rows, lift = height * f, w = width * (1 - f) + 0.03, mid = lean * f;
    const band = glint < 0 ? 0 : Math.max(0, 1 - Math.abs(f - glint) * 4) ** 2;
    const color = frost(heat * (0.45 + 0.4 * f) + 0.45 * band), edge = b * (0.6 + 0.3 * f + 0.3 * band);
    v.dot(x, z, lift, mid - w, '/', color, edge);
    v.dot(x, z, lift, mid + w, '\\', color, edge);
    if (w > 0.075) v.dot(x, z, lift, mid, '|', frost(heat * (0.7 + 0.3 * f) + 0.4 * band), b * (0.5 + 0.4 * f + 0.3 * band));
  }
  v.dot(x, z, height, lean, '^', frost(heat), b);
}

// Harpoons leave on the gameplay cadence (LAUNCHES): a frost sigil snaps open,
// its crystal recoils and drains with every shot, draws hail back in from the
// ground, then shatters as the sigil evaporates.
function cast(v, p) {
  const end = clamp01((1 - p) / sec(0.12));
  let kick = 0;
  for (const s of SHOTS) {
    const d = p - s;
    if (d >= 0 && d < KICK) kick = Math.max(kick, 1 - d / KICK);
  }

  // Sigil ring drawn from the front around to the back, then evaporating upward.
  const R = 0.95, sweep = easeOut(p / sec(0.2)), N = 56;
  const base = 0.4 + 0.3 * smooth(p / sec(0.36)) + 0.3 * kick;
  for (let k = 0; k < N; k++) {
    const phi = (k / N) * Math.PI * 2 - Math.PI;
    const edge = sweep * Math.PI - Math.abs(phi);
    if (edge < 0) continue;
    const w = clamp01((p - SHATTER - hash(k + 11) * sec(0.32)) / sec(0.145));
    if (w >= 1) continue;
    const glint = sweep < 1 && edge < 0.3 ? 1 - edge / 0.3 : 0;
    const I = clamp01(base * (0.82 + 0.18 * Math.sin(phi * 5 + p * DURATION * 12.4)) + glint * 0.5);
    const x = Math.sin(phi) * R, z = Math.cos(phi) * R;
    const char = w > 0.5 ? '.' : w > 0.1 ? ':' : v.line(Math.cos(phi), -Math.sin(phi));
    v.dot(x, z, 0.55 * easeIn(w), 0, char, frost(I + 0.15 * w), (0.35 + 0.65 * I) * (1 - w) * end);
  }
  // Six runes inside the ring and a chevron pointing down the firing line.
  for (let k = 0; k < 6; k++) {
    const phi = k * Math.PI / 3 + Math.PI / 6 - Math.PI;
    if (sweep * Math.PI < Math.abs(phi)) continue;
    const w = clamp01((p - SHATTER + sec(0.06) - hash(k + 70) * sec(0.29)) / sec(0.145));
    v.dot(Math.sin(phi) * 0.7, Math.cos(phi) * 0.7, 0.4 * w, 0, k % 2 ? '+' : '*', frost(base),
      (0.3 + 0.5 * base) * (1 - w) * end);
  }
  const chevron = smooth(p / sec(0.09)) * (1 - smooth((p - SHATTER - sec(0.03)) / sec(0.17))) * end;
  v.dot(0, R + 0.16, 0, 0, v.arrow(0, 1), frost(0.7 + 0.3 * kick), chevron);
  for (const side of [-1, 1]) v.dot(side * 0.12, R + 0.05, 0, 0, v.line(side * -0.12, 0.11), frost(0.6 + 0.3 * kick), chevron * 0.8);

  // After the volley, hail is inhaled from the ground and spirals up into the
  // emptied crystal, every mote arriving before it refills.
  const lift0 = 1.25, z0 = 0.3, open = OPEN;
  for (let m = 0; m < 24; m++) {
    const span = sec(0.17 + hash(m + 5) * 0.145);
    const u = (p - open - hash(m + 3) * (REFILL - open - span)) / span;
    if (u <= 0 || u >= 1) continue;
    const spin = (m % 2 ? 1 : -1) * 1.4, phi = hash(m) * Math.PI * 2, r0 = 1.4 + hash(m + 9);
    const at = t => {
      const r = r0 * (1 - easeIn(t)), a = phi + spin * t;
      return [Math.sin(a) * r, z0 * smooth(t) + Math.cos(a) * r, lift0 * smooth(t)];
    };
    const [x, z, lift] = at(u), [nx, nz, nl] = at(Math.min(1, u + 0.06));
    const char = u > 0.5 ? v.line(nx - x, nz - z, nl - lift) : mote(0.2 + u);
    v.dot(x, z, lift, 0, char, frost(0.3 + 0.65 * u), Math.sin(Math.PI * u) ** 0.6 * 0.9 * end);
  }

  // The crystal recoils white at each launch and drains over the volley,
  // refills with the inhaled hail, then collapses into the shatter.
  let fired = 0;
  for (const s of SHOTS) if (p >= s) fired += 1 / SHOTS.length;
  const drain = Math.min(fired, smooth(p / (LAST + KICK)));
  const fill = p < SHATTER ? 1 - 0.7 * drain + 0.7 * smooth((p - open) / (REFILL - open))
    : (1 - smooth((p - SHATTER) / sec(0.07)));
  if (fill > 0.02) {
    const color = mix(frost(0.6 + 0.4 * fill), WHITE, kick), b = (0.55 + 0.45 * Math.max(fill, kick)) * end;
    v.dot(0, z0, lift0, 0, fill > 0.65 ? '#' : fill > 0.35 ? '*' : '+', color, b);
    const arms = fill > 0.55 ? 2 : 1;
    for (let i = 1; i <= arms; i++) {
      const f = i / arms;
      v.dot(0, z0, lift0, -0.1 * f * (0.4 + fill), '-', color, b * (1 - 0.3 * f));
      v.dot(0, z0, lift0, 0.1 * f * (0.4 + fill), '-', color, b * (1 - 0.3 * f));
      v.dot(0, z0, lift0 + 0.24 * f * (0.4 + fill), 0, '|', color, b * (1 - 0.3 * f));
      v.dot(0, z0, lift0 - 0.24 * f * (0.4 + fill), 0, '|', color, b * (1 - 0.3 * f));
    }
    if (fill > 0.8) {
      for (const [sd, lf, ch] of [[-1, 1, '\\'], [1, 1, '/'], [-1, -1, '/'], [1, -1, '\\']]) {
        v.dot(0, z0, lift0 + lf * 0.14, sd * 0.07, ch, color, b * 0.6);
      }
    }
  }

  // Muzzle burst for each harpoon launch: an opening chevron of spray and
  // thrown sparks, splayed a little differently every shot.
  for (let s = 0; s < SHOTS.length; s++) {
    const u = (p - SHOTS[s]) / BURST;
    if (u < 0 || u >= 1) continue;
    const len = 0.15 + 0.6 * easeOut(u), fade = (1 - u) ** 1.5 * end, splay = 0.38 + 0.16 * hash(s + 90);
    for (const side of [-1, 1]) {
      const dx = side * Math.sin(splay), dz = Math.cos(splay);
      for (let i = 1; i <= 5; i++) {
        const t = i / 5;
        v.dot(dx * len * t, z0 + dz * len * t, lift0, 0, v.line(dx, dz), frost(1 - 0.5 * u - 0.2 * t), fade * (1 - 0.45 * t));
      }
    }
    for (let j = 0; j < 6; j++) {
      const a = (hash(s * 13 + j) - 0.5) * 1.3, dist = (1 + hash(s * 7 + j) * 1.6) * 0.4 * easeOut(u);
      const fall = 0.35 * u * u;
      v.dot(Math.sin(a) * dist, z0 + Math.cos(a) * dist, lift0 - fall, 0, u < 0.45 ? v.line(Math.sin(a), Math.cos(a), -fall) : '.',
        frost(0.95 - 0.5 * u), fade * 0.85);
    }
  }

  // Follow-through: the recharged crystal shatters into falling hail, the
  // pieces breaking away a few frames apart.
  for (let j = 0; j < 14; j++) {
    const at = SHATTER + sec(0.03 + 0.07 * hash(j + 43)), u = (p - at) / (1 - at);
    if (u > 0) {
      const a = (j / 14) * Math.PI * 2 + hash(j + 31), out = (0.5 + 0.8 * hash(j + 37)) * easeOut(u);
      const up = 0.35 + 0.5 * hash(j + 41), height = (t, o) => Math.max(0, lift0 + up * t - 2.4 * t * t + o);
      const lift = height(u, 0), x = Math.sin(a) * out, z = z0 + Math.cos(a) * out * 0.8;
      const char = lift <= 0 ? '.' : u < 0.35 ? v.line(Math.sin(a), Math.cos(a) * 0.8, up - 4.8 * u) : mote(0.6 - u * 0.6);
      v.dot(x, z, lift, 0, char, frost(1 - u * 0.8), (1 - u) ** 1.3 * end);
    }
  }
}

// A harpoon of packed ice with a white glint running up the spine, swept
// barbs, a turbulent frost contrail fixed in the world and shed sparkles.
function projectile(v, effect) {
  const a = Math.max(0, effect.age), fade = clamp01((1 - effect.progress) * 12);
  const grow = 0.55 + 0.45 * easeOut(a / 0.07), on = fade * (0.55 + 0.45 * smooth(a / 0.06));
  const tip = 0.42 * grow, len = 1.15 * grow, tail = tip - len;

  const spine = Math.min(24, Math.max(5, Math.round(v.span(0, len))));
  const dash = v.line(0, 1);
  for (let i = 0; i < spine; i++) {
    const t = i / (spine - 1), z = tip - len * (1 - t);
    const glint = Math.max(0, Math.sin(t * 9 - a * 38)) ** 3 * 0.35;
    const I = clamp01(0.3 + 0.62 * t ** 0.8 + glint);
    v.dot(0, z, 0, 0, i === spine - 1 ? v.arrow(0, 1) : dash, frost(I), on * (0.4 + 0.6 * I));
  }
  // Blade head and two pairs of swept barbs.
  for (const [at, reach, back, I] of [[0.08, 0.07, 0.2, 0.95], [0.42, 0.2, 0.22, 0.8], [0.64, 0.17, 0.2, 0.65]]) {
    for (const side of [-1, 1]) {
      const n = Math.min(5, Math.max(1, Math.round(v.span(reach, back))));
      const char = v.line(side * reach, -back);
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        v.dot(side * reach * t * grow, tip - (at + back * t) * grow, 0, 0, char, frost(I - 0.2 * t), on * (0.85 - 0.3 * t));
      }
    }
  }
  // Contrail: phase is tied to distance flown, so the wake holds still in the world.
  const step = Math.max(0.09, 1.1 / v.span(0, 1)), trail = Math.min(20, Math.floor(1.8 / step));
  for (let j = 1; j <= trail; j++) {
    const dist = j * step;
    if (dist > a * 25 + 0.15) break;
    const q = a * 25 - dist, amp = 0.015 + 0.007 * j;
    const x = Math.sin(q * 2.7 + 0.8) * amp + Math.sin(q * 6.1) * amp * 0.35;
    const I = (1 - j / (trail + 1)) ** 1.2;
    v.dot(x, tail - dist, 0, 0, I > 0.7 ? '+' : I > 0.4 ? ':' : '.', frost(0.25 + 0.6 * I), on * I * 0.85);
  }
  // Sparkles peel off the barbs and fall behind.
  for (let m = 0; m < 8; m++) {
    const period = 0.16, u = ((a + hash(m) * period) % period) / period;
    if (a - u * period < 0) continue;
    const side = m % 2 ? 1 : -1;
    const x = side * (0.18 + 0.24 * easeOut(u)) + Math.sin(m * 1.7 + u * 6) * 0.03;
    v.dot(x * grow, tip - 0.8 * grow - u * period * 11, 0, 0, u < 0.25 ? '*' : u < 0.6 ? '+' : '.',
      frost(0.95 - 0.6 * u), on * (1 - u) ** 1.6 * 0.9);
  }
}

// Piercing hit: a white streak punches through, a star flashes, shards spray
// out of the far side with drag and gravity, a ground ring spreads and rime
// clings to the target.
function impact(v, p) {
  const body = 0.9;
  const ps = p / 0.16;
  if (ps < 1) {
    const head = -0.7 + 2.3 * easeOut(ps), len = 1.2 * (1 - ps) + 0.1;
    const n = Math.min(20, Math.max(4, Math.round(v.span(0, len))));
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      v.dot(0, head - len * (1 - t), body, 0, i === n - 1 ? v.arrow(0, 1) : v.line(0, 1), frost(0.75 + 0.25 * t),
        (1 - ps) ** 0.7 * (0.4 + 0.6 * t));
    }
  }
  const sf = p / 0.24;
  if (sf < 1) {
    const flash = (1 - sf) ** 0.8;
    v.dot(0, 0, body, 0, sf < 0.4 ? '@' : '#', WHITE, flash);
    for (let k = 0; k < 8; k++) {
      const th = k * Math.PI / 4, reach = (k % 2 ? 1.6 : 3) * (0.5 + easeOut(sf / 0.4)) * (1 - sf) ** 0.5;
      const side = Math.cos(th) / 13, lift = Math.sin(th) / 5;
      const char = v.line(0, 0, lift, side);
      for (let i = 1; i <= 3; i++) {
        const t = i / 3;
        v.dot(0, 0, body + lift * reach * t, side * reach * t, char, frost(1 - 0.35 * t), flash * (1 - 0.5 * t));
      }
    }
  }
  // Exit spray (most shards) and a few chips kicked back toward the caster.
  for (let j = 0; j < 44; j++) {
    const back = j >= 36;
    const a = back ? Math.PI + (hash(j) - 0.5) * 1.4 : (hash(j) - 0.5) * 1.25;
    const speed = back ? 1 + 1.5 * hash(j + 50) : 2.5 + 4.5 * hash(j + 50);
    const tau = Math.max(0, p * 0.6 * (0.85 + 0.3 * hash(j + 90)) - 0.02);
    if (tau <= 0) continue;
    const drag = 1 - Math.exp(-4.5 * tau), dist = speed * drag / 4.5;
    const rise = 0.5 + 2 * hash(j + 70), lift = body + rise * drag / 4.5 - 3.9 * tau * tau;
    const now = speed * Math.exp(-4.5 * tau), landed = lift <= 0;
    const vy = rise * Math.exp(-4.5 * tau) - 7.8 * tau;
    const char = landed ? '.' : now > 1.2 ? v.line(Math.sin(a) * now, Math.cos(a) * now, vy) : hash(j + 7) > 0.5 ? ',' : '\'';
    v.dot(Math.sin(a) * dist, Math.cos(a) * dist, Math.max(0, lift), 0, char,
      frost(clamp01(now / 5) * 0.6 + 0.4 * (1 - p)), (1 - p) ** 1.5 * (landed ? 0.45 : 0.55 + 0.45 * hash(j + 110)));
  }
  // Ground ring, thinning as it spreads.
  if (p < 0.75) {
    const r = 0.15 + 0.95 * easeOut(p / 0.7), fade = (1 - p / 0.75) ** 1.4;
    for (let k = 0; k < 44; k++) {
      if (hash(k + 40) < p * 1.1) continue;
      const phi = k / 44 * Math.PI * 2;
      v.dot(Math.sin(phi) * r, Math.cos(phi) * r, 0, 0, v.line(Math.cos(phi), -Math.sin(phi)), frost(0.8 - p), fade * 0.8);
    }
  }
  // Rime crystals glitter on the target and drift up as they fade.
  for (let j = 0; j < 10; j++) {
    const on = smooth((p - 0.1 - hash(j + 120) * 0.15) / 0.12) * (1 - p);
    const twinkle = 0.6 + 0.4 * Math.sin(p * 26 + j * 2.1);
    v.dot(0, 0, 0.3 + hash(j + 130) + 0.3 * p, (hash(j + 140) - 0.5) * 0.5, mote(0.4 + 0.6 * twinkle * (1 - p)),
      frost(0.6 + 0.35 * twinkle), on * twinkle);
  }
}

// Ice spears burst out of a split in the ground (the large VFX summons), or a
// small snowflake bites at body height (per-hit visuals).
function pulse(v, p, radius) {
  const end = clamp01((1 - p) / 0.1);
  if (radius < 1.2) {
    const grow = easeOut(p / 0.3), fade = (1 - p) ** 1.2 * end, body = 0.9;
    v.dot(0, 0, body, 0, p < 0.3 ? '*' : '+', frost(1 - 0.5 * p), fade);
    for (let k = 0; k < 6; k++) {
      const th = k * Math.PI / 3, side = Math.cos(th) / 13, lift = Math.sin(th) / 5;
      const char = v.line(0, 0, lift, side), reach = 2.6 * grow;
      for (let i = 1; i <= 3; i++) {
        const t = i / 3;
        v.dot(0, 0, body + lift * reach * t, side * reach * t, char, frost(0.95 - 0.4 * t - 0.3 * p), fade * (1 - 0.4 * t));
      }
      const fly = 3.4 + 2.4 * easeOut(p);
      v.dot(0, 0, body + lift * fly - 0.3 * p * p, side * fly, '.', frost(0.7 - 0.4 * p), fade * 0.7);
    }
    return;
  }
  const S = Math.min(1.5, Math.max(0.6, radius / 2));
  const settle = 1 - smooth((p - 0.45) / 0.5);
  // Jagged cracks race out from the centre along the ground, about one glyph per cell.
  const grow = easeOut(p / 0.16);
  for (let j = 0; j < 4; j++) {
    const aj = j * Math.PI / 2 + 0.5 + (hash(j) - 0.5) * 0.7, L = (0.55 + 0.35 * hash(j + 5)) * S;
    let px = 0, pz = 0, used = 0;
    for (let i = 1; i <= 4 && used < 7; i++) {
      const t = i / 4, off = (hash(j * 7 + i) - 0.5) * 0.7;
      const x = Math.sin(aj + off) * L * t, z = Math.cos(aj + off) * L * t;
      const char = v.line(x - px, z - pz);
      const n = Math.min(3, Math.max(1, Math.round(v.span(x - px, z - pz) / 1.8)));
      for (let k = 1; k <= n && used < 7; k++) {
        const f = (i - 1 + k / n) / 4;
        if (f > grow + 0.001) break;
        const front = grow < 1 ? clamp01(1 - (grow - f) * 4) : 0;
        v.dot(px + (x - px) * k / n, pz + (z - pz) * k / n, 0, 0, char, frost(0.45 + 0.5 * front - 0.15 * f),
          (0.45 + 0.55 * front) * settle * end);
        used++;
      }
      px = x; pz = z;
    }
  }
  // A crown of spears rises with overshoot (centre first), holds with a glint
  // on the tallest, then crumbles from the top. Drawn back to front.
  const crumble = smooth((p - 0.6) / 0.32);
  SPEARS.forEach(([x, z, H, width, lean], i) => {
    const delay = 0.04 + Math.hypot(x, z) * 0.12;
    const height = H * S * backOut((p - delay) / 0.16) * (1 - crumble);
    // Once a spear stands, a glint slides up its facets (staggered per spear).
    const sweep = (p - delay - 0.14 - i * 0.05) / 0.3;
    spear(v, x * S, z * S, height, width * S, (0.6 + 0.4 * (1 - crumble)) * end,
      clamp01(0.85 - 0.4 * crumble), lean * S, sweep > 0 && sweep < 1.2 ? sweep : -1);
  });
  // Falling shards as the spears break up.
  if (p > 0.6) {
    const u = (p - 0.6) / 0.4;
    for (let j = 0; j < 12; j++) {
      const [x, z, H] = SPEARS[j % SPEARS.length];
      const t = u * 0.6, side = (hash(j + 60) - 0.5) * 1.2 * t;
      const lift = Math.max(0, H * S * (0.35 + 0.6 * hash(j + 65)) + 0.6 * hash(j + 66) * t - 4.9 * t * t);
      v.dot(x * S, z * S, lift, side, lift <= 0 ? '.' : u < 0.4 ? '\'' : ',', frost(0.8 - 0.5 * u), (1 - u) ** 1.2 * end);
    }
  }
}

// [x, z, height, base half-width, lean] in metres at radius 2, back to front.
const SPEARS = [
  [0.24, -0.36, 0.45, 0.07, 0.08],
  [-0.38, -0.12, 0.75, 0.09, -0.14],
  [0, 0, 1.25, 0.13, 0.02],
  [0.42, 0.08, 0.85, 0.09, 0.16],
  [-0.22, 0.34, 0.5, 0.07, -0.1],
];

// A crust of rime forms around the feet and frost motes rise from it.
function aura(v, p, age) {
  const fade = smooth(p / 0.12) * (1 - smooth((p - 0.6) / 0.4));
  for (let k = 0; k < 30; k++) {
    const phi = k / 30 * Math.PI * 2, r = 0.55;
    const appear = smooth((p - hash(k + 210) * 0.25) / 0.1);
    const crystal = hash(k + 220) > 0.78;
    const I = (crystal ? 0.8 : 0.45) + 0.15 * Math.sin(age * 5 + k * 1.3);
    v.dot(Math.sin(phi) * r, Math.cos(phi) * r, 0, 0, crystal ? '*' : v.line(Math.cos(phi), -Math.sin(phi)), frost(I),
      fade * appear * (0.35 + 0.6 * I));
  }
  for (let k = 0; k < 6; k++) {
    const phi = k / 6 * Math.PI * 2 + 0.4, r = 0.4;
    const h = 0.2 * smooth((p - 0.05 - k * 0.03) / 0.15);
    if (h <= 0.02) continue;
    const x = Math.sin(phi) * r, z = Math.cos(phi) * r;
    v.dot(x, z, 0, -0.05, '/', frost(0.6), fade * 0.7);
    v.dot(x, z, 0, 0.05, '\\', frost(0.6), fade * 0.7);
    v.dot(x, z, h, 0, '^', frost(0.9), fade * 0.85);
  }
  for (let m = 0; m < 8; m++) {
    const u = (age * 0.7 + hash(m + 230)) % 1, phi = hash(m + 240) * Math.PI * 2;
    v.dot(Math.sin(phi) * 0.45, Math.cos(phi) * 0.45, 1.1 * u, Math.sin(age * 3 + m) * 0.04, mote(0.8 - 0.6 * u),
      frost(0.85 - 0.4 * u), fade * Math.sin(Math.PI * u) * 0.8);
  }
}

// A frozen field: a frost rim, a crown of small spears and drifting snow.
function zone(v, p, age, radius) {
  const R = Math.min(2.2, Math.max(0.5, radius));
  const fade = smooth(p / 0.08) * (1 - smooth((p - 0.85) / 0.15));
  for (let k = 0; k < 64; k++) {
    const phi = k / 64 * Math.PI * 2, I = 0.45 + 0.25 * Math.sin(phi * 3 + age * 2);
    v.dot(Math.sin(phi) * R, Math.cos(phi) * R, 0, 0, v.line(Math.cos(phi), -Math.sin(phi)), frost(I), fade * (0.35 + 0.5 * I));
  }
  for (let k = 0; k < 8; k++) {
    const phi = k / 8 * Math.PI * 2 + 0.2;
    spear(v, Math.sin(phi) * R * 0.8, Math.cos(phi) * R * 0.8, 0.35 * smooth((p - k * 0.01) / 0.12), 0.06, fade * 0.8, 0.8);
  }
  for (let m = 0; m < 16; m++) {
    const u = (age * 0.45 + hash(m + 300)) % 1, phi = hash(m + 310) * Math.PI * 2, r = R * Math.sqrt(hash(m + 320));
    v.dot(Math.sin(phi) * r, Math.cos(phi) * r, 1.4 * (1 - u), Math.sin(age * 2 + m * 1.3) * 0.08, mote(0.3 + 0.4 * (1 - u)),
      frost(0.7), fade * Math.sin(Math.PI * u) * 0.75);
  }
}

export default {
  id: 'temp-hailpiercer',
  duration: DURATION,
  draw(effect, plot) {
    const v = pen(effect, plot), p = clamp01(effect.progress), age = Math.max(0, effect.age || 0);
    if (p >= 1) return;
    switch (effect.stage) {
      case 'projectile': return projectile(v, effect);
      case 'impact': return impact(v, p);
      case 'pulse': return pulse(v, p, effect.radius ?? 1);
      case 'aura': return aura(v, p, age);
      case 'zone': return zone(v, p, age, effect.radius ?? 1);
      default: return cast(v, p);
    }
  },
  sounds: {
    // Taut glacier fibres snap into a dense lance; a hollow undertone holds
    // beneath the volley without adding a bright, musical ice whistle.
    cast: [
      { kind: 'tone', type: 'triangle', frequency: 176, endFrequency: 263, duration: 0.19, gain: 0.042, cutoff: 590, attack: 0.065, decay: 0.035, sustain: 0.72, release: 0.07 },
      { kind: 'noise', duration: 0.21, gain: 0.033, filterType: 'bandpass', cutoff: 940, Q: 2.1, playbackRate: 0.72, attack: 0.075, decay: 0.025, sustain: 0.65, release: 0.09 },
      { kind: 'tone', type: 'triangle', frequency: 247, endFrequency: 69, delay: 0.115, duration: 0.23, gain: 0.082, cutoff: 760, attack: 0.003, decay: 0.045, sustain: 0.22, release: 0.16 },
      { kind: 'noise', delay: 0.115, duration: 0.15, gain: 0.061, filterType: 'bandpass', cutoff: 1850, Q: 0.85, attack: 0.002, decay: 0.036, sustain: 0.16, release: 0.1 },
      { kind: 'tone', type: 'sine', frequency: 91, endFrequency: 76, delay: 0.15, duration: 0.88, gain: 0.043, attack: 0.025, decay: 0.17, sustain: 0.24, release: 0.6 },
      { kind: 'noise', delay: 0.27, duration: 0.42, gain: 0.02, filterType: 'bandpass', cutoff: 690, Q: 1.8, playbackRate: 0.64, attack: 0.016, decay: 0.065, sustain: 0.18, release: 0.32 },
    ],
    // A short piercing fracture, then irregular, diminishing chips over the
    // resonance of a frozen burial chamber. Keep the hit clear in a volley.
    impact: [
      { kind: 'noise', duration: 0.075, gain: 0.088, filterType: 'bandpass', cutoff: 2250, Q: 0.8, attack: 0.001, decay: 0.018, sustain: 0.17, release: 0.05 },
      { kind: 'tone', type: 'triangle', frequency: 440, endFrequency: 124, duration: 0.115, gain: 0.067, cutoff: 1050, attack: 0.002, decay: 0.024, sustain: 0.21, release: 0.08 },
      { kind: 'tone', type: 'sine', frequency: 119, endFrequency: 66, delay: 0.012, duration: 0.46, gain: 0.059, attack: 0.004, decay: 0.073, sustain: 0.2, release: 0.36 },
      { kind: 'noise', delay: 0.065, duration: 0.085, gain: 0.038, filterType: 'bandpass', cutoff: 1700, Q: 1.4, attack: 0.002, decay: 0.017, sustain: 0.12, release: 0.06 },
      { kind: 'noise', delay: 0.143, duration: 0.11, gain: 0.022, filterType: 'bandpass', cutoff: 1260, Q: 1.2, playbackRate: 0.8, attack: 0.003, decay: 0.022, sustain: 0.13, release: 0.075 },
      { kind: 'noise', delay: 0.247, duration: 0.18, gain: 0.012, filterType: 'bandpass', cutoff: 810, Q: 1, playbackRate: 0.65, attack: 0.006, decay: 0.035, sustain: 0.12, release: 0.13 },
    ],
    // Repeated projectile and ground-spike cues: restrained rime fractures
    // with a low cavity knock, short enough to leave space between harpoons.
    pulse: [
      { kind: 'tone', type: 'triangle', frequency: 216, endFrequency: 108, duration: 0.12, gain: 0.028, cutoff: 620, attack: 0.003, decay: 0.022, sustain: 0.19, release: 0.085 },
      { kind: 'noise', duration: 0.095, gain: 0.022, filterType: 'bandpass', cutoff: 1430, Q: 1.2, attack: 0.002, decay: 0.018, sustain: 0.15, release: 0.065 },
      { kind: 'tone', type: 'sine', frequency: 88, endFrequency: 73, delay: 0.018, duration: 0.2, gain: 0.015, attack: 0.006, decay: 0.035, sustain: 0.2, release: 0.145 },
      { kind: 'noise', delay: 0.07, duration: 0.105, gain: 0.009, filterType: 'bandpass', cutoff: 760, Q: 1.7, attack: 0.004, decay: 0.025, sustain: 0.12, release: 0.07 },
    ],
  },
};
