// Fire Phoenix: a pyre gathers and erupts beside the caster, the phoenix is
// born from it as the projectile (wings unfurl, hover-beat, then fold back and
// dive at full speed trailing a flame streamer), every totem tick leaves a
// patch of burning ground, and on impact the bird flares white and bursts
// into flying feathers, a shock ring, a fire column and cooling ash.
// Pure function of the effect state: no assets, timers or Math.random.
const WHITE = [255, 248, 222], GOLD = [255, 214, 108], FLAME = [255, 150, 46],
  FIRE = [236, 82, 24], EMBER = [150, 36, 14];
const STOPS = [EMBER, FIRE, FLAME, GOLD, WHITE];
// 0 = dying ember, 1 = white-hot. Precomputed so draw() never builds colours.
const HEAT = Array.from({ length: 33 }, (_, i) => {
  const t = i / 32 * 4, k = Math.min(3, Math.floor(t)), f = t - k;
  return STOPS[k].map((c, ch) => Math.round(c + (STOPS[k + 1][ch] - c) * f));
});
const FIRE_RAMP = ' .,:;+*#%@';
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const clamp01 = v => clamp(v, 0, 1);
const heat = t => HEAT[Math.round(clamp01(t) * 32)];
const flame = v => FIRE_RAMP[clamp(Math.round(clamp01(v) * 9), 1, 9)];
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeOut = t => 1 - (1 - clamp01(t)) ** 3;
const easeIn = t => clamp01(t) ** 2;
const easeOutBack = t => { const u = clamp01(t) - 1; return 1 + 2.4 * u * u * u + 1.4 * u * u; };
const hash = (i, k = 0) => { const s = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return s - Math.floor(s); };
// In-game a metre spans ~26 columns and 6.5 rows.
const COLS = 26, ROWS = 6.5;
// TF: the phoenix drifts at 1 m/s for 25 ticks, then VELOCITY SET 12.
const DIVE_AT = 1.25;

// The adapter rotates local metres by heading; glyph shapes and "up" must
// follow the on-screen direction, so derive them from the same rotation.
function view(heading) {
  const c = Math.cos(heading), s = Math.sin(heading);
  return {
    c, s,
    // Stroke glyph for a local direction as it appears on screen.
    line(ax, az) {
      const x = (ax * c + az * s) * COLS, y = (az * c - ax * s) * ROWS * 2;
      const vx = Math.abs(x), vy = Math.abs(y);
      if (vx + vy < 1e-6) return '*';
      if (vy < vx * 0.41) return '-';
      if (vy > vx * 2.41) return '|';
      return x * y > 0 ? '\\' : '/';
    },
    // Beak glyph pointing along a local direction on screen.
    arrow(ax, az) {
      const x = (ax * c + az * s) * COLS, y = (az * c - ax * s) * ROWS * 2;
      return Math.abs(x) > Math.abs(y) ? (x > 0 ? '>' : '<') : y > 0 ? 'v' : '^';
    },
  };
}

// Draws the phoenix seen from above and behind: a lit breast, crested head
// and hooked beak, two articulated wings of graded primaries and a sinuous
// fan of tail plumes. `o.burst` (0..1) tears the bird apart into flying
// feathers for the rebirth flare. Returns nothing; every glyph goes to P.put.
function bird(P, o) {
  const { v, age } = P;
  const size = o.size, detail = o.detail;
  let index = 0;
  // Bird-local (bx, bz) with height bh above its own plane -> effect-local.
  const put = (bx, bz, bh, char, t, b) => {
    let x = bx * size, z = bz * size, h = o.alt + bh * size;
    let bright = b, hot = t;
    if (o.burst > 0) {
      const k = 0.55 + hash(index, o.seed) * 1.5, d = o.burst;
      const spin = (hash(index, o.seed + 3) - 0.5) * 0.9 * d;
      const nx = x * (1 + d * k * 1.9), nz = z * (1 + d * k * 1.9);
      x = nx * Math.cos(spin) - nz * Math.sin(spin);
      z = nx * Math.sin(spin) + nz * Math.cos(spin);
      h += d * (0.3 + hash(index, o.seed + 5) * 0.9) - d * d * 0.6;
      bright *= (1 - d) ** 1.4;
      hot = t * (1 - d * 0.75) + (1 - d) * 0.15;
    }
    index++;
    P.put(o.x + x, o.z + z, h, char, hot, bright);
  };
  const flap = o.flap, lift = Math.sin(flap), reach = Math.cos(flap);

  // Breast: an ellipse whose spine burns white and edges cool to flame.
  const rows = detail > 1 ? 6 : detail > 0 ? 5 : 4;
  for (let j = 0; j < rows; j++) {
    const u = -0.85 + 1.7 * j / (rows - 1), z = 0.15 + u * 0.55;
    const w = 0.25 * Math.sqrt(Math.max(0, 1 - u * u * 0.92));
    const core = 1 - Math.abs(u) * 0.35;
    put(0, z, 0.05, j === rows - 2 ? '@' : flame(0.75 + core * 0.25), 1, 1);
    if (detail > 0) for (const side of [-1, 1]) put(side * w * 0.5, z, 0.03, flame(0.55 + core * 0.3), 0.85 * core, 0.95);
    for (const side of [-1, 1]) put(side * w, z, 0, v.line(side * -u * 0.3, 1), 0.62, 0.85);
  }

  // Neck, head with a flickering crest, and the hooked beak.
  put(0, 0.86, 0.02, v.line(0, 1), 0.92, 1);
  put(0, 1.02, 0, 'o', 1, 1);
  put(0, 1.2, 0, v.arrow(0, 1), 0.85, 1);
  const crest = detail > 0 ? 3 : 2;
  for (let i = 0; i < crest; i++) {
    const side = crest === 2 ? i * 2 - 1 : i - 1;
    const sway = Math.sin(age * 11 + i * 2.1) * 0.05;
    put(side * 0.12 + sway, 0.9 - Math.abs(side) * 0.04, 0.12 + (i === 1 ? 0.08 : 0), "'", 0.9, 0.85);
  }

  // Wings: a curved leading edge, then primaries that lengthen and splay
  // toward the tip. Wing height follows the beat; trailing feathers lag it.
  const span = 2.05 * o.unfurl * o.spread;
  const edgeSteps = detail > 1 ? 15 : detail > 0 ? 13 : 9;
  const feathers = detail > 1 ? 9 : detail > 0 ? 8 : 5;
  for (const side of [-1, 1]) {
    const edge = r => {
      const f = r / Math.max(0.01, span);
      return [side * (0.2 + r * reach), 0.42 + 0.3 * Math.sin(Math.PI * f * 0.85) - 0.3 * f * f
        - o.sweep * r * 0.75, r * lift];
    };
    for (let i = 1; i <= edgeSteps; i++) {
      const r = span * i / edgeSteps;
      const [x, z, h] = edge(r), [px, pz, ph] = edge(r - span / edgeSteps);
      const f = i / edgeSteps;
      put(x, z, h, i === edgeSteps ? '*' : v.line(x - px, z - pz + (h - ph) * -0.3), 1 - f * 0.25, 1);
    }
    for (let k = 0; k < feathers; k++) {
      const f = (k + 0.5) / feathers, r = span * (0.1 + 0.88 * f);
      const [rx, rz, rh] = edge(r);
      const length = (0.42 + 0.95 * f ** 1.4) * (0.55 + 0.45 * o.unfurl) * (1 - o.sweep * 0.3);
      const angle = 0.12 + 0.95 * f * f - o.sweep * 0.45;
      const dx = side * Math.sin(angle) * reach, dz = -Math.cos(angle);
      const samples = detail > 1 ? 3 + Math.round(f * 3) : detail > 0 ? 3 + Math.round(f * 2) : 3;
      const glyph = v.line(dx, dz);
      for (let m = 1; m <= samples; m++) {
        const t = m / samples, lag = -o.flapVel * 0.12 * t * f;
        const flick = 0.5 + 0.5 * Math.sin(age * 21 + k * 1.7 + side + m);
        const x = rx + dx * length * t, z = rz + dz * length * t, h = rh + lag;
        const tip = m === samples;
        put(x, z, h, tip ? (flick > 0.55 ? '^' : "'") : glyph, 0.92 - t * 0.55 - (tip ? flick * 0.12 : 0),
          tip ? 0.55 + flick * 0.3 : 1 - t * 0.25);
      }
    }
  }

  // Tail: plumes fanning back from the rump, rippling like flame.
  const plumes = detail > 1 ? 5 : detail > 0 ? 4 : 3;
  const tailSteps = detail > 1 ? 5 : 4;
  for (let i = 0; i < plumes; i++) {
    const spread = plumes === 1 ? 0 : i / (plumes - 1) * 2 - 1;
    const length = (1.35 + (1 - Math.abs(spread)) * 0.55) * o.tail;
    let px = 0, pz = -0.42;
    for (let m = 1; m <= tailSteps; m++) {
      const t = m / tailSteps;
      const x = spread * 0.38 * t + Math.sin(age * 7.5 - t * 4 + i * 1.3) * 0.13 * t;
      const z = -0.42 - length * t;
      const tip = m === tailSteps;
      put(x, z, -0.05 * t, tip ? (i % 2 ? '~' : ',') : v.line(x - px, z - pz), 0.88 - t * 0.6, 1 - t * 0.4);
      px = x; pz = z;
    }
  }
}

// Embers shed from wings and tail: each one loops on its own hashed clock,
// falls behind the bird with drag and cools from gold to dull red.
function sheddings(P, o, count, rate) {
  for (let i = 0; i < count; i++) {
    const period = 0.65 + hash(i, 41) * 0.5;
    const t = ((P.age * rate + hash(i, 42) * period) % period) / period;
    const side = i % 2 ? 1 : -1, from = hash(i, 43);
    const sx = side * (0.3 + from * 1.6) * o.size * o.unfurl, sz = (-0.35 - from * 0.5) * o.size;
    const drift = (1 - Math.exp(-t * 3)) / 3;
    const x = o.x + sx + side * drift * 0.5 + Math.sin(P.age * 5 + i) * 0.06;
    const z = o.z + sz - drift * (1.6 + o.sweep * 2.5);
    const h = o.alt - t * t * 0.9;
    P.put(x, z, h, t < 0.3 ? '*' : t < 0.65 ? '+' : '.', 0.85 - t * 0.8, (1 - t) * 0.85);
  }
}

function castStage(P, p) {
  // Anticipation: motes spiral in from the edge of the pyre and brighten.
  const gather = 1 - smooth(0.22, 0.34, p);
  if (gather > 0) {
    for (let i = 0; i < 24; i++) {
      const lag = hash(i, 1) * 0.08, t = easeIn((p - lag) / (0.3 - lag));
      if (p < lag) continue;
      const r = 1.9 * (1 - t) + 0.25, a = i / 24 * Math.PI * 2 + t * 2.4 + hash(i, 2) * 0.4;
      P.put(Math.sin(a) * r, Math.cos(a) * r, t * 0.25, t > 0.75 ? '*' : t > 0.4 ? ':' : '.',
        0.35 + t * 0.6, (0.3 + t * 0.7) * gather);
    }
  }
  // The pyre: crossed kindling that glows, catches, then burns down.
  const kindle = smooth(0, 0.2, p) * (1 - smooth(0.7, 1, p) * 0.7);
  for (let i = 0; i < 10; i++) {
    const a = i / 10 * Math.PI * 2 + 0.2, r = 0.55 + (i % 2) * 0.12;
    const glow = 0.5 + 0.5 * Math.sin(P.age * 13 + i * 2.3);
    P.put(Math.sin(a) * r, Math.cos(a) * r, 0, P.v.line(Math.cos(a), -Math.sin(a)),
      0.25 + kindle * 0.35 + glow * 0.15, kindle * (0.6 + glow * 0.3));
  }
  // Ignition flash and a ground shock ring that races out and thins.
  const flash = smooth(0.2, 0.27, p) * (1 - smooth(0.3, 0.46, p));
  if (flash > 0) for (let i = 0; i < 7; i++) {
    const a = i / 6 * Math.PI * 2;
    const r = i ? 0.18 : 0;
    P.put(Math.sin(a) * r, Math.cos(a) * r, 0.2 + (i ? 0 : 0.1), i ? '#' : '@', 1, flash);
  }
  const ring = (p - 0.24) / 0.36;
  if (ring > 0 && ring < 1) {
    const r = 0.4 + easeOut(ring) * 2.2;
    for (let i = 0; i < 36; i++) {
      const a = i / 36 * Math.PI * 2;
      const wobble = 1 + Math.sin(a * 5 + P.age * 6) * 0.04;
      P.put(Math.sin(a) * r * wobble, Math.cos(a) * r * wobble, 0, i % 3 ? '~' : '=',
        0.9 - ring * 0.7, (1 - ring) ** 1.5 * (i % 2 ? 0.75 : 1));
    }
  }
  // Flame pillar: tongues lick up out of the pyre, tallest just after
  // ignition, then settle and burn down.
  const pillar = smooth(0.18, 0.3, p) * (1 - smooth(0.62, 1, p));
  if (pillar > 0) {
    const height = 0.9 + 1.6 * easeOut((p - 0.18) / 0.2) * (1 - 0.5 * smooth(0.45, 0.9, p));
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * Math.PI * 2 + 0.4, base = i ? 0.32 : 0;
      const tall = height * (i ? 0.62 + hash(i, 5) * 0.3 : 1);
      for (let m = 0; m < 6; m++) {
        const t = m / 5, sway = Math.sin(P.age * 9 + i * 2 + t * 3) * 0.1 * t;
        const r = base * (1 - t * 0.6);
        const hot = 1 - t * 0.75 - (i ? 0.1 : 0);
        P.put(Math.sin(a) * r + sway, Math.cos(a) * r, tall * t, m === 5 ? '^' : flame(hot),
          hot, pillar * (1 - t * 0.35));
      }
    }
  }
  // Cinders loft out of the column on a slow, swaying climb.
  const cinders = smooth(0.24, 0.36, p);
  if (cinders > 0) for (let i = 0; i < 18; i++) {
    const period = 0.5 + hash(i, 7) * 0.35;
    const t = ((P.age + hash(i, 8) * period) % period) / period;
    const a = hash(i, 9) * Math.PI * 2, r = 0.2 + t * (0.4 + hash(i, 10) * 0.7);
    P.put(Math.sin(a) * r + Math.sin(P.age * 4 + i) * 0.1, Math.cos(a) * r, 0.4 + t * (1.6 + hash(i, 11)),
      t < 0.4 ? '*' : t < 0.75 ? '+' : '.', 0.95 - t * 0.85, cinders * (1 - t));
  }
}

function projectileStage(P) {
  const age = P.age;
  // Birth (unfurl from the pyre), hover-beat, then fold back and dive.
  const born = easeOutBack(age / 0.42), dive = smooth(DIVE_AT - 0.15, DIVE_AT + 0.15, age);
  const beat = age * (8.5 + dive * 6), amp = 0.6 * (1 - dive * 0.65);
  const o = {
    x: 0, z: 0, alt: Math.sin(age * 4.2) * 0.08 * (1 - dive), seed: 0,
    size: (0.28 + 0.36 * born) * (1 - dive * 0.08), unfurl: clamp(0.15 + 0.85 * born, 0, 1.05),
    spread: 0.8 - dive * 0.12, flap: Math.sin(beat) * amp, flapVel: Math.cos(beat) * amp,
    sweep: dive, tail: 0.8 + dive * 0.35, detail: 0, burst: 0,
  };
  // A flash as the bird ignites out of the pyre.
  const birth = 1 - smooth(0.05, 0.3, age);
  if (birth > 0) for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + 0.6;
    P.put(Math.sin(a) * 0.35 * (1 + age * 3), Math.cos(a) * 0.35 * (1 + age * 3), 0.1, '*', 1, birth);
  }
  bird(P, o);
  // Hovering: heat motes rise off the wings. Diving: a flame streamer.
  if (dive < 1) sheddings(P, o, 8, 1);
  if (dive > 0) for (let s = 0; s < 3; s++) {
    for (let m = 0; m < 6; m++) {
      const t = (m + 1) / 6, side = s - 1;
      const x = side * 0.12 * t * 3 + Math.sin(age * 13 - t * 5 + s * 2) * 0.12 * t;
      const z = -1.0 * o.size - t * 2.6 * dive;
      const hot = 0.95 - t * 0.85;
      P.put(x, z, -0.05 * t, m === 5 ? '.' : flame(hot), hot, dive * (1 - t * 0.6) * (s === 1 ? 1 : 0.8));
    }
  }
}

function impactStage(P, p) {
  // Rebirth flare: the bird spreads wide, flashes white and tears apart
  // into flying feathers while a shock ring, rays and a column follow.
  const burst = easeOut(smooth(0.06, 0.62, p));
  // Past 0.9 the scattered feathers are below 4% brightness: stop drawing
  // them so the ash and the rebirth ember keep their share of the budget.
  if (burst < 0.9) {
    const flash = 1 - smooth(0, 0.14, p);
    bird(P, { x: 0, z: 0, alt: 0.35 + p * 0.5, seed: 9, size: 0.86 + p * 0.25, unfurl: 1,
      spread: 0.8 + easeOut(p / 0.12) * 0.3, flap: -0.25 + easeOut(p / 0.2) * 0.55, flapVel: 0,
      sweep: 0, tail: 1.15, detail: 1, burst });
    if (flash > 0) for (let i = 0; i < 9; i++) {
      const a = i / 8 * Math.PI * 2, r = i ? 0.3 + p * 1.5 : 0;
      P.put(Math.sin(a) * r, Math.cos(a) * r * 0.8, 0.45, i ? '#' : '@', 1, flash);
    }
  }
  const ring = p / 0.5;
  if (ring < 1) {
    const r = 0.35 + easeOut(ring) * 3;
    for (let i = 0; i < 30; i++) {
      const a = i / 30 * Math.PI * 2;
      P.put(Math.sin(a) * r, Math.cos(a) * r, 0, i % 3 ? '~' : '=', 1 - ring * 0.8,
        (1 - ring) ** 1.4 * (i % 2 ? 0.7 : 1));
    }
  }
  const rays = 1 - smooth(0.1, 0.5, p);
  if (rays > 0) for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2 + 0.3, reach = 0.5 + easeOut(p / 0.45) * (1.8 + hash(i, 21) * 0.8);
    const glyph = P.v.line(Math.sin(a), Math.cos(a));
    for (let m = 0; m < 3; m++) {
      const r = reach - m * 0.28;
      P.put(Math.sin(a) * r, Math.cos(a) * r, 0.1, m ? glyph : '*', 1 - m * 0.25 - p, rays * (1 - m * 0.25));
    }
  }
  // Fire column that climbs out of the burst and burns down.
  const column = smooth(0.04, 0.16, p) * (1 - smooth(0.45, 0.85, p));
  if (column > 0) {
    const height = 0.6 + easeOut((p - 0.04) / 0.3) * 1.9;
    for (let i = 0; i < 5; i++) {
      const a = i / 5 * Math.PI * 2, base = i ? 0.3 : 0;
      for (let m = 0; m < 5; m++) {
        const t = m / 4, sway = Math.sin(P.age * 10 + i * 2.2 + t * 3.5) * 0.12 * t;
        const hot = 1 - t * 0.8;
        P.put(Math.sin(a) * base * (1 - t * 0.5) + sway, Math.cos(a) * base * (1 - t * 0.5),
          height * t * (i ? 0.75 : 1), m === 4 ? '^' : flame(hot), hot, column * (1 - t * 0.3));
      }
    }
  }
  // Ash and embers drift up on turbulent air and cool to dull red.
  const ash = smooth(0.15, 0.3, p);
  if (ash > 0) for (let i = 0; i < 24; i++) {
    const a = hash(i, 31) * Math.PI * 2, r = 0.3 + hash(i, 32) * 1.8;
    const t = clamp01((p - 0.15 - hash(i, 33) * 0.15) / 0.75);
    if (t <= 0) continue;
    const h = 0.2 + easeOut(t) * (1 + hash(i, 34) * 1.4);
    P.put(Math.sin(a) * r * (1 + t * 0.4) + Math.sin(P.age * 3 + i * 1.7) * 0.15 * t,
      Math.cos(a) * r * (1 + t * 0.4), h, t < 0.35 ? '*' : t < 0.7 ? '+' : '.', 0.85 - t * 0.8, ash * (1 - t) * 0.95);
  }
  // The rebirth ember: a small heart of fire that remains and dims.
  const heart = smooth(0.45, 0.6, p);
  if (heart > 0) {
    const pulse = 0.75 + 0.25 * Math.sin(P.age * 9);
    P.put(0, 0, 0.1, 'O', 0.85 * pulse, heart * pulse);
    P.put(-0.12, 0, 0.1, '(', 0.6, heart * 0.7);
    P.put(0.12, 0, 0.1, ')', 0.6, heart * 0.7);
  }
}

// A short flame burst for the totem's burn ticks and the summon flash.
function pulseStage(P, p, radius, seed) {
  const scale = clamp(radius, 0.6, 2.4) * 0.55;
  const flare = 1 - smooth(0, 0.35, p);
  if (flare > 0) {
    P.put(0, 0, 0.05, '@', 1, flare);
    P.put(-0.1 * scale, 0, 0.05, '#', 0.9, flare * 0.8);
    P.put(0.1 * scale, 0, 0.05, '#', 0.9, flare * 0.8);
  }
  const rise = easeOut(p / 0.5), sink = 1 - smooth(0.55, 1, p);
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2 + hash(seed, i) * 0.5, r = (0.25 + rise * 0.35) * scale;
    const tall = (0.5 + hash(seed + i, 3) * 0.6) * scale * (0.4 + rise * 0.6) * sink;
    for (let m = 0; m < 4; m++) {
      const t = m / 3, sway = Math.sin(P.age * 14 + i * 2 + t * 3) * 0.06 * t * scale;
      const hot = 0.95 - t * 0.7 - p * 0.3;
      P.put(Math.sin(a) * r + sway, Math.cos(a) * r, tall * t, m === 3 ? '^' : flame(hot), hot,
        (1 - t * 0.3) * (0.4 + sink * 0.6));
    }
  }
  for (let i = 0; i < 8; i++) {
    const a = (i + 0.5) / 8 * Math.PI * 2 + hash(seed, i + 9), speed = (0.8 + hash(seed, i + 17) * 0.8) * scale;
    const d = speed * (1 - Math.exp(-p * 3)) / 1.2;
    P.put(Math.sin(a) * (0.2 * scale + d), Math.cos(a) * (0.2 * scale + d), 0.6 * p * scale - 1.2 * p * p * scale + 0.1,
      p < 0.5 ? '*' : '.', 0.9 - p * 0.8, 1 - p);
  }
}

// Burning ground left along the flight path by each totem: a few licking
// tongues and smouldering coals that flare, burn and cool to dark red.
function zoneStage(P, p, seed) {
  const ignite = smooth(0, 0.06, p), burn = 1 - smooth(0.45, 0.95, p);
  for (let i = 0; i < 3; i++) {
    const x = (hash(seed, i) - 0.5) * 0.9, z = (hash(seed, i + 4) - 0.5) * 0.7;
    const tall = (0.35 + hash(seed, i + 8) * 0.4) * (0.6 + 0.4 * Math.sin(P.age * 7 + i * 2.4 + seed)) * burn;
    for (let m = 0; m < 3; m++) {
      const t = m / 2, sway = Math.sin(P.age * 12 + i * 3 + t * 2) * 0.05 * t;
      const hot = (0.9 - t * 0.6) * (0.35 + burn * 0.65);
      P.put(x + sway, z, tall * t, m === 2 ? '^' : flame(hot), hot, ignite * (1 - t * 0.35) * (0.3 + burn * 0.7));
    }
  }
  for (let i = 0; i < 6; i++) {
    const x = (hash(seed, i + 12) - 0.5) * 1.3, z = (hash(seed, i + 20) - 0.5) * 0.8;
    const glow = 0.5 + 0.5 * Math.sin(P.age * (3 + hash(seed, i + 28) * 4) + i * 1.9);
    P.put(x, z, 0, glow > 0.6 ? ',' : '.', (0.2 + glow * 0.35) * (0.4 + burn * 0.6), ignite * (0.35 + glow * 0.4));
  }
}

// Spirit guardian aura: three flame wisps orbit the caster over a faint
// ring of heat, fading in and out with the aura.
function auraStage(P, p, radius) {
  const r = clamp(radius, 0.6, 2) * 1.05;
  const grow = easeOut(p / 0.18) * (1 - smooth(0.7, 1, p));
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * Math.PI * 2 + P.age * 0.4;
    const glow = 0.5 + 0.5 * Math.sin(P.age * 5 + i * 1.3);
    P.put(Math.sin(a) * r, Math.cos(a) * r, 0, glow > 0.55 ? '-' : '.', 0.3 + glow * 0.3, grow * (0.25 + glow * 0.3));
  }
  for (let w = 0; w < 3; w++) {
    const head = P.age * 2.6 + w * Math.PI * 2 / 3;
    for (let m = 0; m < 6; m++) {
      const a = head - m * 0.2, t = m / 5;
      const bob = 0.3 + Math.sin(P.age * 3 + w * 2) * 0.12 + t * 0.15;
      const hot = 0.95 - t * 0.75;
      P.put(Math.sin(a) * r * grow, Math.cos(a) * r * grow, bob, m ? flame(hot - 0.1) : '*', hot, grow * (1 - t * 0.6));
    }
  }
}

// Local +z is the bird's flight direction. The effects adapter applies heading.
export default {
  id: 'temp-summon-phoenix',
  duration: 1.25,
  draw(effect, plot) {
    const age = Number.isFinite(effect.age) ? Math.max(0, effect.age) : 0;
    const progress = clamp01(Number.isFinite(effect.progress) ? effect.progress
      : age / Math.max(0.01, effect.life || 1.25));
    // Every stage dims to nothing over its last quarter (progress 1 is silent).
    const fade = 1 - smooth(0.72, 1, progress);
    if (fade <= 0) return;
    const v = view(Number.isFinite(effect.heading) ? effect.heading : 0);
    const P = {
      v, age,
      // Effect-local ground position plus height (drawn straight up the screen).
      put(x, z, h, char, t, brightness) {
        plot(x + h * v.s, z - h * v.c, char, heat(t), clamp01(brightness * fade));
      },
    };
    const seed = Math.round((Number.isFinite(effect.x) ? effect.x : 0) * 7 + (Number.isFinite(effect.y) ? effect.y : 0) * 13) % 997;
    switch (effect.stage) {
      case 'projectile': projectileStage(P); break;
      case 'impact': impactStage(P, progress); break;
      case 'pulse': pulseStage(P, progress, Number.isFinite(effect.radius) ? effect.radius : 1, seed); break;
      case 'zone': zoneStage(P, progress, seed); break;
      case 'aura': auraStage(P, progress, Number.isFinite(effect.radius) ? effect.radius : 1); break;
      default: castStage(P, progress);
    }
  },
  sounds: {
    // Real cloth wingbeats unfold over a blowtorch ignition and sustained fire rush.
    cast: [
      { kind: 'recording', url: '/assets/audio/spells/oseni/wing-flap.wav', gain: 0.3, rate: 0.85, delay: 0 },
      { kind: 'recording', url: '/assets/audio/spells/oseni/ignition.wav', gain: 0.16, rate: 0.9, delay: 0.18 },
      { kind: 'recording', url: '/assets/audio/spells/oseni/fire-roar.wav', gain: 0.32, rate: 0.9, delay: 0.28 },
      { kind: 'recording', url: '/assets/audio/spells/oseni/wing-flap.wav', gain: 0.24, rate: 0.95, delay: 0.58 },
    ],
    // Rebirth catches with a fresh ignition; cloth and fireplace embers scatter after it.
    impact: [
      { kind: 'recording', url: '/assets/audio/spells/oseni/ignition.wav', gain: 0.55, rate: 0.85, delay: 0 },
      { kind: 'recording', url: '/assets/audio/spells/oseni/wing-flap.wav', gain: 0.24, rate: 1.1, delay: 0.08 },
      { kind: 'recording', url: '/assets/audio/spells/oseni/coal-crack.wav', gain: 0.14, rate: 0.95, delay: 0.32 },
    ],
    // A single quiet fireplace pop keeps the frequent burning-ground ticks small.
    pulse: [
      { kind: 'recording', url: '/assets/audio/spells/oseni/coal-crack.wav', gain: 0.1, rate: 1.15, delay: 0 },
    ],
  },
};
