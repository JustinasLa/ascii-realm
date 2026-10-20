// Fire Shard: jaws snap shut on a white-hot needle, which leaves as a faceted
// crystal shard dragging a braided flame wake, scorches a cooling trail behind
// each tick and bursts into tumbling splinters, licking flame and rising embers.
// Pure function of the effect clock: no assets, timers or Math.random.
const WHITE = [255, 248, 230], YELLOW = [255, 214, 110], ORANGE = [255, 130, 36],
  RED = [212, 52, 18], EMBER = [118, 26, 8], SMOKE = [92, 72, 62];
const STOPS = [EMBER, RED, ORANGE, YELLOW, WHITE];
// 0 = dying ember, 1 = white-hot. Precomputed so draw() never builds colours.
const HEAT = Array.from({ length: 33 }, (_, i) => {
  const t = i / 32 * 4, k = Math.min(3, Math.floor(t)), f = t - k;
  return STOPS[k].map((c, ch) => Math.round(c + (STOPS[k + 1][ch] - c) * f));
});
const RAMP = ' .,:;-=+*#%@', FIRE = ' .,:;+*#%@';
const clamp01 = v => Math.min(1, Math.max(0, v));
const heat = t => HEAT[Math.round(clamp01(t) * 32)];
const pick = (set, v) => set[Math.max(1, Math.min(set.length - 1, Math.round(clamp01(v) * (set.length - 1))))];
const ramp = v => pick(RAMP, v), flame = v => pick(FIRE, v);
const easeOut = t => 1 - (1 - clamp01(t)) ** 3;
const easeIn = t => clamp01(t) ** 2;
const hash = (i, k = 0) => { const s = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return s - Math.floor(s); };
// In-game a metre spans 26 columns and 6.5 rows (cells are ~2:1 tall).
const COLS = 26, ROWS = 6.5;
// TF range 40 m at 40 m/s: a miss fizzles out over the last fifth of its flight.
const RANGE_TIME = 1;

// The adapter rotates local metres by heading; glyph shapes must follow the
// on-screen direction, so derive them from the same rotation.
function view(heading) {
  const c = Math.cos(heading), s = Math.sin(heading);
  const screen = (ax, az) => [(ax * c + az * s) * COLS, (az * c - ax * s) * ROWS];
  return {
    // Cells covered by one metre along a local direction.
    density(ax, az) { const [x, y] = screen(ax, az); return Math.hypot(x, y) / Math.hypot(ax, az); },
    line(ax, az) {
      const [x, y] = screen(ax, az), vx = Math.abs(x), vy = Math.abs(y) * 2;
      if (vy < vx * 0.41) return '-';
      if (vy > vx * 2.41) return '|';
      return x * y > 0 ? '\\' : '/';
    },
    arrow(ax, az) {
      const [x, y] = screen(ax, az);
      return Math.abs(x) > Math.abs(y) * 2.4 ? (x > 0 ? '>' : '<') : y > 0 ? 'v' : '^';
    },
    // Local offset that moves a glyph straight up the screen by d metres.
    lift: d => [d * s, -d * c],
  };
}

function projectile(effect, plot, v) {
  const age = effect.age;
  // Count stays constant for a heading; every glyph dims together near expiry.
  const fade = Math.min(1, (1 - effect.progress) * 4) ** 2 * clamp01((RANGE_TIME - age) / 0.22);
  const grow = 0.6 + 0.4 * easeOut(age / 0.08);
  const tip = 0.5 * grow, mid = 0.2 * grow, tail = -0.3 * grow, half = 0.1 * grow;
  const along = v.density(0, 1), across = v.density(1, 0);
  // Sampling uses the full-grown size so the glyph count never changes in flight.
  const steps = Math.max(5, Math.min(22, Math.round(0.8 * along) + 1));
  const axis = v.line(0, 1), front = v.line(half, tip - mid), frontR = v.line(-half, tip - mid);
  const rear = v.line(half, mid - tail), rearR = v.line(-half, mid - tail);
  for (let i = 0; i < steps; i++) {
    const z = tail + (tip - tail) * i / (steps - 1);
    const w = z > mid ? half * (tip - z) / (tip - mid) : half * (z - tail) / (mid - tail);
    const m = i === steps - 1 ? 0 : Math.min(3, Math.round(w / grow * across));
    const flick = 0.9 + 0.1 * Math.sin(age * 41 + i * 1.7);
    for (let j = -m; j <= m; j++) {
      const x = m ? j / m * w : 0, edge = m > 0 && Math.abs(j) === m;
      if (i === steps - 1) plot(0, z, v.arrow(0, 1), WHITE, fade);
      else if (j === 0) plot(0, z, axis, heat(0.92 + 0.08 * flick), fade * flick);
      else if (edge) plot(x, z, z > mid ? (j > 0 ? frontR : front) : (j > 0 ? rear : rearR), heat(0.62), 0.78 * fade * flick);
      else plot(x, z, ramp(0.75 - Math.abs(j) / (m + 1) * 0.3), heat(0.78), 0.86 * fade * flick);
    }
  }
  // Braided wake: two strands corkscrew around a cooling core.
  const wake = 1.7 * grow, n = Math.max(6, Math.min(14, Math.round(1.7 * along * 0.6)));
  for (let k = 0; k < n; k++) {
    const s = (k + 0.5) / n, z = tail - s * wake, amp = 0.03 + 0.15 * s;
    const phase = s * 11 - age * 34, swing = Math.sin(phase) * amp;
    const hot = (1 - s) ** 1.2 * (0.82 + 0.18 * Math.sin(age * 37 + k * 2.3));
    plot(swing, z, flame(hot * 0.9), heat(0.95 - s * 0.85), (0.25 + 0.75 * hot) * fade);
    plot(-swing, z, flame(hot * 0.75), heat(0.85 - s * 0.85), (0.2 + 0.7 * hot) * fade);
    plot(Math.sin(age * 23 + k) * 0.02 * s, z - 0.5 / along, s < 0.5 ? v.line(0, 1) : '.', heat(1 - s), (0.15 + hot) * 0.8 * fade);
  }
  // Shed sparks fall behind, spread, rise and cool, then recycle while dark.
  for (let i = 0; i < 12; i++) {
    const u = (age * 2.6 + hash(i)) % 1, [lx, lz] = v.lift(u * u * 0.35);
    const x = (hash(i, 2) - 0.5) * (0.15 + u * 0.8) + lx, z = tail - 0.1 - u * (1.1 + hash(i, 1) * 1.3) + lz;
    plot(x, z, u < 0.25 ? '*' : u < 0.55 ? '+' : u < 0.8 ? "'" : '.', heat(0.9 - u * 0.8),
      (0.03 + 0.92 * (1 - u) ** 1.4) * fade);
  }
}

function trail(effect, plot, v) {
  // Source tick visuals fire every 2 m of flight: scorch the gap behind each.
  const p = effect.progress, cool = (1 - p) ** 2;
  if (cool <= 0) return;
  const along = v.density(0, 1), n = Math.max(6, Math.min(16, Math.round(2 * along * 0.9)));
  const streak = v.line(0, 1);
  for (let k = 0; k < n; k++) {
    if (hash(k, 5) < p * 1.25 - 0.1) continue; // the streak breaks up as it cools
    const s = k / n, z = -s * 2, wob = Math.sin(k * 1.9 + effect.age * 30) * 0.025 * p;
    const hot = (1 - p) * (1 - s * 0.45);
    plot(wob, z, hot > 0.55 ? streak : hot > 0.3 ? ':' : '.', heat(hot * 0.9 + 0.08), 0.6 * cool * (1 - s * 0.4));
  }
  for (let i = 0; i < 6; i++) {
    const t = effect.age, side = hash(i, 7) - 0.5, [lx, lz] = v.lift(t * (0.6 + hash(i, 8)));
    plot(side * (0.15 + t * 2.2) + lx, -hash(i, 9) * 2 + lz, p < 0.4 ? "'" : '.', heat(0.75 - p * 0.6),
      0.55 * cool * (0.7 + 0.3 * Math.sin(t * 50 + i * 2)));
  }
}

function blast(effect, plot, v) {
  // Hit visuals carry a wide radius: a fast shockwave ring with radial heat.
  const p = effect.progress, life = (1 - p) ** 1.5;
  if (life <= 0) return;
  const R = (0.25 + 0.75 * easeOut(p)) * Math.min(3, effect.radius) * 0.6;
  for (let k = 0; k < 56; k++) {
    if (hash(k, 3) < p * 0.9 - 0.05) continue;
    const a = k / 56 * Math.PI * 2, wob = 1 + Math.sin(a * 5 + p * 9) * 0.03;
    plot(Math.sin(a) * R * wob, Math.cos(a) * R * wob, v.line(Math.cos(a), -Math.sin(a)),
      heat(1 - p * 1.1), life * (0.75 + 0.25 * hash(k, 4)));
  }
  for (let k = 0; k < 16; k++) {
    if (hash(k, 6) < p) continue;
    const a = (k + hash(k, 1) * 0.6) / 16 * Math.PI * 2, r = R * (0.62 + 0.18 * hash(k, 2));
    plot(Math.sin(a) * r, Math.cos(a) * r, v.line(Math.sin(a), Math.cos(a)), heat(0.75 - p * 0.6), 0.6 * life);
  }
}

function impact(effect, plot, v) {
  const p = effect.progress, t = effect.age, end = clamp01((1 - p) * 5);
  if (end <= 0) return;
  // White flash and an eight-point star at the moment of fracture.
  if (p < 0.25) {
    const flash = (1 - p / 0.25) ** 1.5, r = 0.1 + 0.2 * easeOut(p / 0.25);
    plot(0, 0, '@', WHITE, flash);
    for (let k = 0; k < 8; k++) {
      const a = k / 8 * Math.PI * 2, dx = Math.sin(a), dz = Math.cos(a), arm = k % 2 ? 0.6 : 1;
      plot(dx * r * 0.5, dz * r * 0.5, '#', WHITE, flash);
      plot(dx * r * arm, dz * r * arm, v.line(dx, dz), WHITE, flash);
      plot(dx * r * arm * 1.7, dz * r * arm * 1.7, k % 2 ? '*' : v.line(dx, dz), YELLOW, flash * 0.8);
    }
  }
  // Heat ring rolls out after the flash, behind the fire.
  if (p > 0.03 && p < 0.5) {
    const q = (p - 0.03) / 0.47, R = 0.3 + 1.1 * easeOut(q), b = Math.min(1, q * 6) * (1 - q) ** 1.6;
    for (let k = 0; k < 36; k++) {
      if (hash(k, 11) < q * 0.8) continue;
      const a = k / 36 * Math.PI * 2;
      plot(Math.sin(a) * R, Math.cos(a) * R, v.line(Math.cos(a), -Math.sin(a)), heat(0.85 - q * 0.5), b * 0.6);
    }
  }
  // Flame tongues bloom out, lick upward, thin out and cool.
  const bloom = easeOut(p / 0.25) * (1 - 0.3 * p), body = (1 - p) ** 1.1 * end;
  for (let i = 0; i < 14 && bloom > 0.08; i++) {
    const a = (i + hash(i, 12) * 0.5) / 14 * Math.PI * 2 + Math.sin(t * 13 + i) * 0.1;
    const dx = Math.sin(a), dz = Math.cos(a), len = (0.5 + 0.6 * hash(i, 13)) * bloom;
    const n = Math.max(3, Math.min(8, Math.round(len * v.density(dx, dz) * 0.5)));
    for (let k = 0; k < n; k++) {
      if (hash(i * 9 + k, 14) < p * 1.15 - 0.2) continue;
      const s = (k + 0.6) / n, [lx, lz] = v.lift(s * 0.12 + p * 0.3 * s);
      const hot = (1 - s * 0.75) * (1 - p * 0.65) * (0.85 + 0.15 * Math.sin(t * 47 + i * 3 + k));
      plot(dx * len * s + lx, dz * len * s + lz, k === n - 1 && hot > 0.3 ? v.line(dx, dz) : flame(hot),
        heat(hot * 1.1 + 0.08), body * (0.55 + 0.45 * hot));
    }
  }
  // Splinters: the shard's fragments fly on along its path, tumbling and dragging.
  for (let i = 0; i < 9; i++) {
    const a = i < 6 ? (hash(i, 15) - 0.5) * 2.2 : hash(i, 15) * Math.PI * 2;
    const dx = Math.sin(a), dz = Math.cos(a), speed = 3.5 + 3 * hash(i, 16);
    const d = speed * (1 - Math.exp(-5 * t)) / 5, [gx, gz] = v.lift(-1.4 * t * t);
    const spin = a + t * (8 + 10 * hash(i, 17)) * (i % 2 ? 1 : -1);
    const b = (1 - p) ** 1.2 * end, step = 1 / v.density(dx, dz);
    for (let k = 0; k < 4; k++) {
      const r = d - k * step * 1.5;
      if (r < step * 2) break; // fragments only show once they clear the flash
      plot(dx * r + gx, dz * r + gz, k ? (k === 1 ? v.line(dx, dz) : k === 2 ? ':' : '.') : v.line(Math.sin(spin), Math.cos(spin)),
        heat(1.05 - p * 0.8 - k * 0.15), b * (1 - k * 0.22));
    }
  }
  // Embers burst out, slow, rise on turbulence and flicker as they cool.
  const appear = clamp01((p - 0.02) / 0.1);
  for (let i = 0; i < 28; i++) {
    const a = (hash(i, 18) - 0.5) * (i < 18 ? 1.8 : Math.PI * 2), dx = Math.sin(a), dz = Math.cos(a);
    const d = (1 + 2.2 * hash(i, 19)) * (1 - Math.exp(-3.5 * t)) / 3.5;
    const [lx, lz] = v.lift(t * (0.4 + 0.5 * hash(i, 20)));
    const sway = Math.sin(t * 9 + i * 1.3) * 0.06;
    const flick = 0.6 + 0.4 * Math.sin(t * 31 + i * 2.7);
    plot(dx * d + lx + sway, dz * d + lz, p < 0.3 ? '*' : i % 3 ? '.' : "'", heat(0.85 - p * 0.75),
      appear * (1 - p) * flick * end);
  }
  // Late smoke wisps curl up from the scorch.
  if (p > 0.35) {
    const smoke = Math.sin(Math.PI * (p - 0.35) / 0.65) * 0.35;
    for (let i = 0; i < 8; i++) {
      const [lx, lz] = v.lift(0.15 + p * 0.65 + hash(i, 21) * 0.2);
      plot((hash(i, 22) - 0.5) * 0.9 + Math.sin(t * 5 + i) * 0.08 + lx, (hash(i, 23) - 0.5) * 0.6 + lz,
        i % 2 ? '~' : ':', SMOKE, smoke * end);
    }
  }
}

function cast(effect, plot, v) {
  const p = effect.progress, t = effect.age, end = clamp01((1 - p) * 5);
  if (end <= 0) return;
  const F = 0.55, WIND = 0.15;
  if (p < WIND) {
    // Wind-up: two angular jaws snap shut while motes spiral into the needle point.
    const w = p / WIND, spread = 0.7 * (1 - easeIn(w)) + 0.2, glow = 0.55 + 0.45 * w;
    for (let i = 0; i < 7; i++) {
      const z = F - 0.75 + i * 0.11, x = spread * (1 - i / 7);
      const dir = v.line(spread / 7, 0.11), dirR = v.line(-spread / 7, 0.11);
      plot(-x, z, dir, heat(0.55 + 0.4 * w), glow);
      plot(x, z, dirR, heat(0.55 + 0.4 * w), glow);
    }
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2 + w * 2.6, r = 0.95 * (1 - easeIn(w)) + 0.04;
      plot(Math.sin(a) * r, F + Math.cos(a) * r * 0.8, w > 0.6 ? '*' : w > 0.3 ? '+' : '.', heat(0.4 + 0.6 * w), glow * 0.85);
    }
    plot(0, F, '@', WHITE, 0.3 + 0.7 * w);
    return;
  }
  const r = (p - WIND) / (1 - WIND);
  // Release flash at the needle point.
  if (r < 0.3) {
    const flash = (1 - r / 0.3) ** 2;
    plot(0, F, '@', WHITE, flash);
    for (let k = 0; k < 8; k++) {
      const a = k / 8 * Math.PI * 2, dx = Math.sin(a), dz = Math.cos(a), d = 0.07 + 0.12 * r / 0.3;
      plot(dx * d, F + dz * d, k % 2 ? '*' : v.line(dx, dz), k % 2 ? YELLOW : WHITE, flash * 0.9);
    }
  }
  // Muzzle flare: streaks shoot forward then retract toward their tips.
  if (r < 0.45) {
    const q = r / 0.45, b = (1 - q) ** 1.5, head = easeOut(q / 0.45) * 1.4, base = easeIn(q) * 1.2;
    for (let i = 0; i < 9; i++) {
      const a = (i - 4) / 4 * 0.38 + (hash(i, 30) - 0.5) * 0.08, dx = Math.sin(a), dz = Math.cos(a);
      const reach = head * (0.65 + 0.35 * hash(i, 31)) * (i === 4 ? 1.25 : 1);
      for (let k = 0; k < 5; k++) {
        const s = base + (reach - base) * k / 4;
        if (s < base || reach <= base) continue;
        if (s < 0.12) continue; // keep the streak roots from piling onto the flash
        plot(dx * s, F + dz * s, k === 4 ? '.' : v.line(dx, dz),
          heat(1 - k * 0.08 - q * 0.3), b * (1 - k * 0.1));
      }
    }
  }
  // Shock ring around the release point.
  if (r < 0.4) {
    const q = r / 0.4, R = 0.12 + 0.7 * easeOut(q), b = (1 - q) ** 2;
    for (let k = 0; k < 28; k++) {
      const a = k / 28 * Math.PI * 2;
      plot(Math.sin(a) * R, F + Math.cos(a) * R, v.line(Math.cos(a), -Math.sin(a)), heat(0.9 - q * 0.4), b * 0.75);
    }
  }
  // Recoil: the jaws spring open again and cool.
  const open = 0.2 + easeOut(r) * 0.45, jb = (1 - r) ** 1.5 * 0.75 * end;
  for (let i = 0; i < 7; i++) {
    const z = F - 0.75 - easeOut(r) * 0.25 + i * 0.11, x = open * (1 - i / 7);
    plot(-x, z, v.line(open / 7, 0.11), heat(0.6 - r * 0.5), jb);
    plot(x, z, v.line(-open / 7, 0.11), heat(0.6 - r * 0.5), jb);
  }
  // Embers flung forward from the needle, dragged, rising and cooling.
  const et = Math.max(0, t - WIND * effect.life);
  for (let i = 0; i < 26; i++) {
    const a = (hash(i, 32) - 0.5) * 2.8, dx = Math.sin(a), dz = Math.cos(a);
    const d = (0.8 + 2.4 * hash(i, 33)) * (1 - Math.exp(-4 * et)) / 4;
    const [lx, lz] = v.lift(et * (0.3 + 0.6 * hash(i, 34)));
    const flick = 0.65 + 0.35 * Math.sin(t * 29 + i * 2.1);
    plot(dx * d + lx + Math.sin(t * 8 + i) * 0.04, F + dz * d + lz, r < 0.25 && i % 2 ? '*' : i % 3 ? '.' : "'",
      heat(0.9 - r * 0.8), (1 - r) ** 1.1 * flick * end * clamp01(et / 0.06));
  }
  // Heat shimmer rises off the caster's hands.
  if (r > 0.2) {
    const haze = Math.sin(Math.PI * (r - 0.2) / 0.8) * 0.3;
    for (let i = 0; i < 6; i++) {
      const [lx, lz] = v.lift(0.1 + r * 0.6 + hash(i, 35) * 0.2);
      plot((i - 2.5) * 0.12 + Math.sin(t * 7 + i * 1.7) * 0.05 + lx, F * 0.5 + lz, '~', SMOKE, haze * end);
    }
  }
}

export default {
  id: 'fire-shard', duration: 0.55,
  draw(effect, plot) {
    const v = view(Number.isFinite(effect.heading) ? effect.heading : 0);
    if (effect.stage === 'projectile') return projectile(effect, plot, v);
    // Burst stages skip glyphs that have faded out so they never spend budget on darkness.
    const lit = (x, z, char, color, brightness) => { if (brightness > 0.012) plot(x, z, char, color, brightness); };
    if (effect.stage === 'impact') return impact(effect, lit, v);
    if (effect.stage === 'pulse') return effect.radius >= 2 ? blast(effect, lit, v) : trail(effect, lit, v);
    // Cast, plus aura/zone fallbacks, use the snap-and-release choreography.
    return cast(effect, lit, v);
  },
  sounds: {
    cast: [
      { kind: 'noise', duration: 0.045, gain: 0.12, cutoff: 4100, filterType: 'highpass', attack: 0.001, release: 0.035 },
      { kind: 'tone', type: 'triangle', frequency: 560, endFrequency: 1620, delay: 0.025, duration: 0.19, gain: 0.065 },
      { kind: 'noise', delay: 0.04, duration: 0.14, gain: 0.045, cutoff: 1900, filterType: 'highpass' },
    ],
    impact: [
      { kind: 'noise', duration: 0.17, gain: 0.15, cutoff: 2600, filterType: 'bandpass', release: 0.14 },
      { kind: 'tone', type: 'triangle', frequency: 240, endFrequency: 70, duration: 0.2, gain: 0.12 },
      { kind: 'noise', delay: 0.055, duration: 0.23, gain: 0.055, cutoff: 4700, filterType: 'highpass' },
    ],
    pulse: [{ kind: 'noise', duration: 0.06, gain: 0.025, cutoff: 3200, filterType: 'highpass' }],
  },
};
