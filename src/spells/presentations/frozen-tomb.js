// Frozen Tomb: a hexagonal frost rune raises six ice spikes and launches a spinning
// coffin crystal. Where it lands the ground freezes into a six-armed frost star, the
// target is sealed in an upright ice coffin that glints, cracks when the damage lands
// and finally bursts into falling shards.
const TAU = Math.PI * 2;
// One metre is 26 columns by 6.5 rows; height is drawn at 5 rows per metre.
const COLS = 26, ROWS = 6.5, LIFT = 5 / 6.5;

const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const easeOut = t => 1 - (1 - clamp01(t)) ** 3;
const easeIn = t => clamp01(t) ** 2;
const back = t => { const u = clamp01(t) - 1; return 1 + 2.7 * u * u * u + 1.7 * u * u; };
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const hash = n => { const v = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return v - Math.floor(v); };

// Glacier ramp: deep blue shadow -> ice -> pale rim -> white flash.
const STOPS = [[30, 64, 132], [58, 116, 186], [112, 188, 230], [178, 228, 250], [232, 249, 255], [255, 255, 255]];
const RAMP = Array.from({ length: 16 }, (_, i) => {
  const t = i / 15 * (STOPS.length - 1), k = Math.min(STOPS.length - 2, Math.floor(t)), f = t - k;
  return STOPS[k].map((c, j) => Math.round(c + (STOPS[k + 1][j] - c) * f));
});
const tone = t => RAMP[Math.round(clamp01(t) * 15)];
const DENSE = '.:;+*#@';
const dense = t => DENSE[Math.round(clamp01(t) * 6)];
const CHIPS = "'.,*`";

// Glyph for a stroke direction measured in screen cells.
const slope = (dx, dz) => {
  const c = Math.abs(dx * COLS), r = Math.abs(dz * ROWS);
  if (r < c * 0.42) return '-';
  if (c < r * 0.42) return '|';
  return dx * dz > 0 ? '\\' : '/';
};

// Author in screen-aligned metres (X right, Z toward the viewer, H up) and undo
// the adapter's heading turn so tombs and spikes always stand upright.
function pen(effect, plot) {
  const cos = Math.cos(effect.heading || 0), sin = Math.sin(effect.heading || 0);
  return (x, z, h, char, color, brightness) => {
    const d = z - h * LIFT;
    plot(x * cos - d * sin, x * sin + d * cos, char, color, clamp01(brightness));
  };
}

// Walk a stroke one screen cell at a time (bounded by cap); gap > 1 spaces
// flat strokes out across columns so long ground lines stay within budget.
function stroke(x0, z0, h0, x1, z1, h1, cap, each, gap = 1) {
  const dx = x1 - x0, dz = (z1 - h1 * LIFT) - (z0 - h0 * LIFT);
  const steps = Math.max(1, Math.min(cap, Math.ceil(Math.max(Math.abs(dx) * COLS / gap, Math.abs(dz) * ROWS))));
  const char = slope(dx, dz);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    each(x0 + dx * t, z0 + (z1 - z0) * t, h0 + (h1 - h0) * t, char, t, i);
  }
}

// The upright coffin: front face (x, height) and its depth.
const FACE = [[-0.3, 0], [0.3, 0], [0.5, 1.6], [0.3, 2.45], [-0.3, 2.45], [-0.5, 1.6]];
const DEPTH = 0.2, TOP = 2.45, HEART = 1.25;
const halfWidth = h => h < 1.6 ? 0.3 + 0.2 * h / 1.6 : 0.5 - 0.2 * (h - 1.6) / 0.85;

function tomb(effect, put) {
  const { age, life } = effect;
  const remain = (1 - effect.progress) * life;
  const form = Math.min(0.42, life * 0.25), burst = Math.min(0.75, life * 0.3);
  const rise = back(age / form);
  const seal = smooth(form * 0.8, form, age) * (1 - smooth(form, form + 0.3, age));
  const shatter = clamp01(1 - remain / burst);
  const alive = (1 - shatter) ** 1.4;
  const glint = ((age - form) / 1.7 % 1 + 1) % 1;
  const band = -1.1 + 2.6 * glint;

  // Every shard carries a stable id (feature base + sample index), so pieces keep
  // their own scatter, glyph and thinning even when glint or crack samples come
  // and go mid-burst.
  const shard = (id, x, z, h, char, light, bright) => {
    if (shatter > 0) {
      // The tomb bursts: a white crack flash, slabs kick outward, then the
      // pieces fall under gravity and settle as glitter on the ground.
      if (hash(id * 3.1) < shatter * 0.5) return;
      const t = shatter * burst, kick = 0.6 + 0.8 * hash(id);
      x += x / 0.5 * kick * 0.4 * (1 - Math.exp(-t * 4)) + (hash(id * 2.2) - 0.5) * 0.25 * shatter;
      z += (hash(id * 7.3) - 0.35) * 0.4 * shatter;
      h = Math.max(0, h + 0.7 * kick * t - 4.9 * t * t);
      if (h === 0 && shatter > 0.1) char = id % 2 ? '.' : ',';
      else if (shatter > 0.2) char = CHIPS[Math.floor(hash(id * 5.7) * CHIPS.length)];
      light += 0.4 * (1 - smooth(0, 0.3, shatter));
    }
    put(x, z, h, char, tone(light), bright * alive);
  };

  // Frost ring cracks out around the feet; the half behind the coffin hides.
  const ring = 0.55 + 0.3 * easeOut(age / (form * 0.7));
  for (let i = 0; i < 26; i++) {
    const a = i / 26 * TAU, x = Math.cos(a) * ring, z = Math.sin(a) * ring * 0.9;
    if (z < DEPTH && Math.abs(x) < 0.34) continue;
    const char = slope(-Math.sin(a), Math.cos(a) * 0.9);
    const wobble = 0.5 + 0.5 * Math.sin(age * 1.7 + i * 1.9);
    shard(100 + i, x, z, 0, i % 3 === 1 ? '.' : char, 0.3 + 0.25 * wobble, (0.35 + 0.25 * wobble) * smooth(0, form * 0.5, age));
  }

  // Front face: ice slabs grow up from the foot with a slight overshoot,
  // flash white as the lid seals, then carry a sweeping glint.
  const top = TOP * rise;
  for (let side = 0; side < FACE.length; side++) {
    const a = FACE[side], b = FACE[(side + 1) % FACE.length];
    stroke(a[0], DEPTH, a[1] * rise, b[0], DEPTH, b[1] * rise, 20, (x, z, h, char, t, i) => {
      const off = (x * 0.9 + h / TOP - band) / 0.16;
      const shine = Math.exp(-off * off) * (1 - seal);
      const foot = side === 0 ? 0.2 : 0;
      shard(200 + side * 21 + i, x, z, h, char, 0.55 + 0.45 * Math.max(seal, shine) - foot, 0.82 + 0.18 * Math.max(seal, shine));
    });
  }
  // The lid: the coffin's top surface seen from above, a dim back edge joined
  // to the front corners.
  if (rise > 0.75) {
    const lid = smooth(0.75, 1, rise);
    // A bevelled lid: the back edge is narrower, so the corners lean inward.
    stroke(-0.2, -DEPTH, top, 0.2, -DEPTH, top, 12, (x, z, h, char, t, i) => {
      shard(400 + i, x, z, h, t === 0 || t === 1 ? '.' : '-', 0.45 + 0.3 * seal, 0.5 * lid);
    });
    for (const x of [-1, 1]) {
      for (const f of [0.3, 0.7]) {
        shard(421 + x + (f > 0.5 ? 1 : 0), x * (0.3 - 0.1 * f), DEPTH - 2 * DEPTH * f, top, x < 0 ? '/' : '\\', 0.55 + 0.3 * seal, 0.6 * lid);
      }
    }
  }

  // Frost creeps inward from the walls once sealed; the core stays clear so the
  // frozen target shows through.
  const creep = smooth(form * 0.6, form + 0.5, age);
  for (let i = 0; i < 18; i++) {
    if (hash(i * 9.1) > creep) continue;
    const rest = (0.1 + 0.85 * hash(i * 2.3)) * TOP, h = rest * rise;
    const edge = 0.55 + 0.4 * hash(i * 4.7);
    const x = (i % 2 ? 1 : -1) * halfWidth(rest) * edge;
    const twinkle = 0.55 + 0.45 * Math.sin(age * 2.6 + i * 2.1);
    shard(500 + i, x, DEPTH, h, edge > 0.8 ? ':' : '.', 0.45 + 0.3 * twinkle, 0.3 + 0.35 * twinkle);
  }

  // Reflection streak riding the glint band across the face.
  if (age > form) {
    for (let i = 0; i < 5; i++) {
      const h = HEART + (band - 0.5) * 1.6 + (i - 2) * 0.16;
      const x = (band - 0.5) * 0.35 + (i - 2) * 0.05;
      if (h < 0.15 || h > TOP - 0.15 || Math.abs(x) > halfWidth(h) - 0.08) continue;
      shard(600 + i, x, DEPTH, h, '/', 0.95, 0.55 * (1 - Math.abs(i - 2) * 0.25));
    }
  }

  // The damage pulse (19 ticks after sealing) splits the ice; faults keep creeping.
  const strain = age - 0.95;
  if (strain > 0) {
    const reach = 0.12 + 0.3 * easeOut(strain / 0.35) + Math.min(0.25, strain * 0.06);
    for (let c = 0; c < 3; c++) {
      let x = (c - 1) * 0.06, h = HEART + (c === 1 ? 0.2 : -0.1);
      const base = [2.3, -0.9, 0.6][c];
      for (let s = 0; s < 6; s++) {
        const len = reach / 6, a = base + (hash(c * 13 + s) - 0.5) * 1.3;
        const nx = x + Math.cos(a) * len * 0.8, nh = h + Math.sin(a) * len * 2.2;
        if (Math.abs(nx) > halfWidth(nh) - 0.04 || nh < 0.1 || nh > TOP - 0.1) break;
        shard(700 + c * 6 + s, nx, DEPTH, nh, slope(nx - x, -(nh - h) * LIFT), 0.9 - s * 0.06, 0.85 - s * 0.07);
        x = nx; h = nh;
      }
    }
  }
}

function field(effect, put) {
  const { age, life, progress: p, radius } = effect;
  const reach = Math.min(1.75, 0.4 + radius * 0.34);
  const turn = radius * Math.PI / 6;
  const grow = easeOut(age / Math.max(0.05, life * 0.45));
  const fade = smooth(0, 0.45, 1 - p);
  const thin = 0.8 * (1 - fade);
  let id = 0;
  const frost = (x, z, h, char, light, bright) => {
    id++;
    if (hash(id * 1.37 + radius) < thin) return;
    put(x, z, h, char, tone(light), bright * fade);
  };
  for (let k = 0; k < 6; k++) {
    const a = turn + k * TAU / 6, dx = Math.cos(a), dz = Math.sin(a);
    const end = reach * grow;
    // Main arm: dense, bright near the racing tip, settling to blue behind it.
    stroke(dx * 0.2, dz * 0.2, 0, dx * end, dz * end, 0, 18, (x, z, h, char, t, i) => {
      if (t === 1) return;
      const fresh = clamp01(1 - (1 - t) * end * 2.2);
      frost(x, z, h, char, 0.3 + 0.6 * fresh, 0.45 + 0.55 * fresh);
    }, 2);
    frost(dx * end, dz * end, 0, grow < 0.98 ? '*' : '+', 1, 1);
    // A pair of side twigs sprouts once the tip passes them, leaning outward.
    const open = smooth(0.5, 0.8, grow);
    if (open <= 0) continue;
    const bx = dx * reach * 0.5, bz = dz * reach * 0.5;
    for (const side of [-1, 1]) {
      const ta = a + side * 0.8, l = reach * 0.32 * open;
      stroke(bx, bz, 0, bx + Math.cos(ta) * l, bz + Math.sin(ta) * l, 0, 6, (x, z, h, char, t, i) => {
        if (i === 0) return;
        frost(x, z, h, t === 1 ? '.' : char, 0.35 + 0.4 * t, 0.4 + 0.4 * t);
      }, 2);
    }
  }
  // Frost motes lift and drift off the freezing ground.
  for (let i = 0; i < 10; i++) {
    const a = hash(i + radius) * TAU, r = reach * (0.25 + 0.7 * hash(i * 3.3));
    const rise = clamp01(age * 0.8 + hash(i * 5.1) * 0.4);
    frost(Math.cos(a) * r + Math.sin(age * 2 + i) * 0.06, Math.sin(a) * r, rise * 1.1,
      i % 3 ? '.' : "'", 0.7, (0.6 - rise * 0.4) * grow);
  }
}

function pulse(effect, put) {
  const { progress: p, radius } = effect;
  const reach = Math.min(2.3, 0.5 + radius * 0.45);
  const out = easeOut(p);
  const fade = (1 - p) ** 1.5;
  // A ring of radial ice needles, white-headed with cooling tails.
  for (let i = 0; i < 12; i++) {
    const a = (i + hash(i + radius) * 0.6) / 12 * TAU, dx = Math.cos(a), dz = Math.sin(a);
    const d = reach * (0.25 + 0.75 * out) * (0.85 + 0.25 * hash(i * 7.7));
    const len = reach * 0.24 * (1 - 0.6 * p), h = 0.3 * (1 - p);
    stroke(dx * Math.max(0.05, d - len), dz * Math.max(0.05, d - len), h, dx * d, dz * d, h, 4, (x, z, sh, char, t) => {
      put(x, z, sh, t === 1 && p < 0.4 ? '*' : char, tone(0.55 + 0.45 * t - p * 0.3), fade * (0.4 + 0.6 * t));
    }, 2);
  }
  // Frost breath ring under the needles.
  const ring = reach * (0.15 + 0.6 * out);
  for (let i = 0; i < 20; i++) {
    const a = i / 20 * TAU;
    put(Math.cos(a) * ring, Math.sin(a) * ring, 0, i % 2 ? '.' : ':', tone(0.45 - p * 0.2), 0.6 * fade);
  }
  if (p < 0.35) put(0, 0, 0.3, p < 0.15 ? '@' : '*', tone(1), 1 - p / 0.35);
}

function impact(effect, put) {
  const { progress: p } = effect;
  const fade = (1 - p) ** 1.2;
  // White core flash at the heart of the tomb, collapsing through the density ramp.
  const core = 1 - smooth(0, 0.45, p);
  put(0, DEPTH + 0.01, HEART, dense(core), tone(0.7 + 0.3 * core), Math.max(core, 0.3) * fade);
  // Seven jagged fault lines snap outward from the heart, white-hot then cooling.
  const reach = easeOut(p / 0.2);
  for (let c = 0; c < 7; c++) {
    let x = 0, h = HEART, run = 0;
    const base = c / 7 * TAU + 0.3;
    const len = (0.5 + 0.3 * hash(c * 4.1)) * reach / 3;
    for (let s = 1; s <= 3; s++) {
      const a = base + (hash(c * 17 + s) - 0.5) * 1.1;
      const nx = x + Math.cos(a) * len * 0.75, nh = Math.max(0, h + Math.sin(a) * len * 1.5);
      const settle = 1 - smooth(0.3 + s * 0.12, 0.95, p) * 0.75;
      stroke(x, DEPTH, h, nx, DEPTH, nh, 6, (sx, sz, sh, char, t, i) => {
        if (i === 0 && s > 1) return;
        const cool = (run + t) / 3;
        put(sx, sz, sh, char, tone(1 - cool * 0.35 - p * 0.55), fade * (1 - cool * 0.3) * settle);
      });
      run++; x = nx; h = nh;
    }
  }
  // Ice chips burst out ballistically with drag, bounce once and settle.
  for (let i = 0; i < 28; i++) {
    const a = hash(i * 2.9) * TAU, speed = 1.2 + 2.3 * hash(i * 6.1);
    const t = p * effect.life;
    const travel = speed * (1 - Math.exp(-t * 3.2)) / 3.2;
    const up = (0.6 + 2.2 * hash(i * 8.3)) * t - 4.9 * t * t;
    const h = Math.max(0, HEART * 0.9 + up);
    const landed = h <= 0;
    put(Math.cos(a) * travel * 0.9, Math.sin(a) * travel * 0.6 + DEPTH, h,
      landed ? '.' : CHIPS[i % CHIPS.length], tone(0.95 - p * 0.6), fade * (landed ? 0.45 : 0.95));
  }
  // Ground shock ring of frost rolling out from the tomb's foot.
  const ring = 0.4 + 0.75 * easeOut(p * 1.4);
  for (let i = 0; i < 32; i++) {
    const a = i / 32 * TAU;
    put(Math.cos(a) * ring, Math.sin(a) * ring + DEPTH * 0.5, 0, i % 4 === 2 ? '.' : slope(-Math.sin(a), Math.cos(a)),
      tone(0.75 - p * 0.45), 0.7 * fade * (1 - p));
  }
}

function aura(effect, put) {
  const { progress: p } = effect;
  const fade = 1 - smooth(0.55, 1, p);
  const close = easeOut(p / 0.5);
  // Two frost shackles cinch around the feet.
  for (const [start, end, h, n] of [[1.0, 0.42, 0.05, 22], [0.8, 0.32, 0.45, 18]]) {
    const r = start + (end - start) * close;
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU + (1 - close) * (h ? 0.8 : -0.8);
      put(Math.cos(a) * r, Math.sin(a) * r * 0.8, h, slope(-Math.sin(a), Math.cos(a) * 0.8),
        tone(0.5 + 0.5 * smooth(0.4, 0.55, p) * (1 - p)), (0.5 + 0.5 * close) * fade);
    }
  }
  // Icicles snap up from the shackle as it locks.
  const snap = back((p - 0.35) / 0.3);
  if (p > 0.35) {
    for (let i = 0; i < 6; i++) {
      const a = (i + 0.5) / 6 * TAU, x = Math.cos(a) * 0.42, z = Math.sin(a) * 0.34;
      const tall = (0.4 + 0.3 * hash(i * 3.7)) * snap;
      for (let j = 0; j < 3; j++) {
        const h = tall * j / 2;
        put(x, z, h, j === 2 ? '^' : '|', tone(0.6 + 0.2 * j), fade * (0.6 + 0.2 * j));
      }
    }
  }
}

function projectile(effect, put) {
  const { age, heading } = effect;
  const fade = clamp01((1 - effect.progress) * 8);
  const fx = Math.sin(heading || 0), fz = Math.cos(heading || 0);
  // Local (side, forward) to screen-aligned metres.
  const at = (side, fwd) => [side * fz + fwd * fx, fwd * fz - side * fx];
  // The spinning coffin crystal: its width breathes as it rolls.
  const roll = Math.cos(age * 14), width = 0.08 + 0.12 * Math.abs(roll);
  const hull = [[0, 0.42], [width, 0.18], [width, -0.2], [0, -0.34], [-width, -0.2], [-width, 0.18]];
  for (let k = 0; k < hull.length; k++) {
    const [ax, az] = at(...hull[k]), [bx, bz] = at(...hull[(k + 1) % hull.length]);
    stroke(ax, az, 0, bx, bz, 0, 9, (x, z, h, char, t, i) => {
      if (i === 0 && k) return;
      put(x, z, 0, char, tone(0.75 + 0.25 * (roll * (k < 3 ? 1 : -1) * 0.5 + 0.5)), fade);
    });
  }
  const [cx, cz] = at(0, 0.04);
  put(cx, cz, 0, '#', tone(1), fade);
  // Three frost streams spiral off the tail, cooling into faint motes.
  for (let s = 0; s < 3; s++) {
    for (let j = 1; j <= 12; j++) {
      const d = 0.3 + j * 0.13;
      const sway = Math.sin(age * 22 - j * 0.8 + s * TAU / 3) * 0.05 * (1 + j * 0.25);
      const [x, z] = at(sway + (s - 1) * 0.03 * j * 0.3, -d);
      const heat = 1 - j / 13;
      put(x, z, 0, dense(heat * 0.85 - 0.15 * ((j + s + Math.floor(age * 30)) % 2)), tone(heat * 0.9), fade * (0.25 + 0.75 * heat));
    }
  }
  // Shed glitter peeling away behind the crystal.
  for (let i = 0; i < 12; i++) {
    const life = (hash(i * 4.3) + age * 2.4) % 1;
    const [x, z] = at((hash(i * 9.7) - 0.5) * (0.15 + life * 0.7), -0.35 - life * 1.6);
    put(x, z, 0, life < 0.3 ? '*' : "'", tone(1 - life * 0.6), fade * (1 - life) * 0.8);
  }
}

function cast(effect, put) {
  const { progress: p, heading } = effect;
  const fx = Math.sin(heading || 0), fz = Math.cos(heading || 0);
  const end = 1 - smooth(0.7, 1, p);
  // Wind-up: frost motes spiral into a focus in front of the chest.
  const focusX = fx * 0.55, focusZ = fz * 0.55, focusH = 1.15;
  if (p < 0.2) {
    const pull = easeIn(p / 0.16);
    for (let i = 0; i < 18; i++) {
      const a = i / 18 * TAU + (1 - pull) * 2.4, r = 1.35 * (1 - pull) + 0.04;
      put(focusX + Math.cos(a) * r, focusZ + Math.sin(a) * r * 0.6, focusH + Math.sin(a * 2) * 0.3 * (1 - pull),
        i % 3 ? '.' : '*', tone(0.5 + 0.5 * pull), (0.4 + 0.6 * pull) * (1 - smooth(0.15, 0.2, p)));
    }
  }
  // Release: a white flash and forward frost lances.
  const flash = smooth(0.1, 0.14, p) * (1 - smooth(0.16, 0.36, p));
  if (flash > 0) {
    put(focusX, focusZ, focusH, flash > 0.6 ? '@' : '*', tone(1), flash);
    const lance = easeOut((p - 0.1) / 0.18);
    for (let s = -2; s <= 2; s++) {
      const spread = s * 0.08;
      const dx = fx + fz * spread, dz = fz - fx * spread;
      const len = 1.8 * lance * (1 - Math.abs(s) * 0.18);
      stroke(focusX + dx * len * 0.25, focusZ + dz * len * 0.25, focusH, focusX + dx * len, focusZ + dz * len, focusH - 0.15 * Math.abs(s),
        9, (x, z, h, char, t) => put(x, z, h, char, tone(0.6 + 0.4 * t), flash * (0.4 + 0.6 * t)));
    }
  }
  // A hexagonal rune traces itself around the caster's feet.
  const trace = easeOut(p / 0.3), hexR = 0.95;
  for (let k = 0; k < 6; k++) {
    const a0 = k / 6 * TAU, a1 = (k + 1) / 6 * TAU;
    stroke(Math.cos(a0) * hexR, Math.sin(a0) * hexR, 0, Math.cos(a1) * hexR, Math.sin(a1) * hexR, 0, 14,
      (x, z, h, char, t, i) => {
        if (i === 0 || (k + t) / 6 > trace || (i % 2 && char === '-')) return;
        if (hash(k * 31 + i) < smooth(0.65, 1, p) * 0.8) return;
        put(x, z, h, char, tone(0.35 + 0.35 * end), (0.45 + 0.3 * (1 - trace)) * end + 0.2 * end);
      });
  }
  // An inner circle of frost runes turns slowly inside the hexagon.
  const inner = smooth(0.05, 0.3, p) * end;
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * TAU + p * 1.4;
    if (hash(i * 7 + 3) < smooth(0.6, 1, p) * 0.8) continue;
    put(Math.cos(a) * 0.6, Math.sin(a) * 0.6, 0, i % 4 ? '.' : '*',
      tone(0.45 + 0.3 * Math.sin(p * 9 + i)), inner * (0.4 + 0.25 * Math.sin(p * 9 + i)));
  }
  // Six ice spikes rise from the rune vertices, then shatter into falling glitter.
  const grow = back((p - 0.16) / 0.24), crack = smooth(0.6, 0.95, p);
  for (let k = 0; k < 6; k++) {
    if (p < 0.16) break;
    const a = k / 6 * TAU, bx = Math.cos(a) * hexR, bz = Math.sin(a) * hexR;
    const tall = (0.75 + 0.35 * hash(k * 2.7)) * grow;
    // Each spike: a flared '/|\' foot, a shaft and a bright '^' point.
    for (let j = 0; j < 7; j++) {
      const f = j < 2 ? 0 : (j - 2) / 4, id = k * 7 + j;
      let x = bx + (j === 0 ? -0.045 : j === 1 ? 0.045 : 0), z = bz, h = tall * f;
      let char = j === 0 ? '/' : j === 1 ? '\\' : j === 6 ? '^' : '|';
      if (crack > 0) {
        const drop = crack * crack;
        x += Math.cos(a) * crack * (0.3 + hash(id) * 0.5);
        z += Math.sin(a) * crack * 0.3;
        h = Math.max(0, h + crack * 0.4 * hash(id * 3.3) - drop * 1.8);
        if (crack > 0.1) char = CHIPS[id % CHIPS.length];
      }
      put(x, z, h, char, tone(0.55 + 0.4 * f - crack * 0.3), (0.7 + 0.3 * f) * end * (1 - crack * 0.4));
    }
  }
  // Cold mist curls upward from the rune for the whole cast.
  for (let i = 0; i < 12; i++) {
    const life = (hash(i * 5.3) + p * 1.6) % 1, a = hash(i * 1.9) * TAU;
    put(Math.cos(a) * hexR * 0.9 + Math.sin(life * 6 + i) * 0.08, Math.sin(a) * hexR * 0.9, life * 1.4,
      life < 0.5 ? "'" : '.', tone(0.6 - life * 0.3), (1 - life) * 0.55 * end * smooth(0, 0.1, p));
  }
}

export default {
  id: 'frozen-tomb',
  duration: 1.18,
  draw(effect, plot) {
    const put = pen(effect, plot);
    switch (effect.stage) {
      case 'cast': return cast(effect, put);
      case 'projectile': return projectile(effect, put);
      case 'impact': return impact(effect, put);
      case 'aura': return aura(effect, put);
      case 'pulse': return pulse(effect, put);
      default: return effect.radius < 1 ? tomb(effect, put) : field(effect, put);
    }
  },
  sounds: {
    cast: [
      { kind: 'tone', type: 'triangle', frequency: 57, endFrequency: 126, duration: 0.98,
        gain: 0.055, attack: 0.18, release: 0.36 },
      { kind: 'noise', delay: 0.03, duration: 0.86, gain: 0.045, cutoff: 420,
        filterType: 'lowpass', attack: 0.14, release: 0.4 },
      { kind: 'tone', type: 'sine', delay: 0.2, frequency: 680, endFrequency: 595,
        duration: 0.12, gain: 0.048, attack: 0.002, release: 0.1 },
      { kind: 'tone', type: 'sine', delay: 0.39, frequency: 1015, endFrequency: 920,
        duration: 0.1, gain: 0.042, attack: 0.002, release: 0.085 },
      { kind: 'tone', type: 'sine', delay: 0.65, frequency: 1530, endFrequency: 1390,
        duration: 0.09, gain: 0.035, attack: 0.002, release: 0.075 },
    ],
    impact: [
      { kind: 'tone', type: 'triangle', frequency: 120, endFrequency: 46,
        duration: 0.38, gain: 0.09, attack: 0.003, release: 0.31 },
      { kind: 'noise', duration: 0.17, gain: 0.1, cutoff: 600,
        filterType: 'bandpass', attack: 0.002, release: 0.145 },
      { kind: 'noise', duration: 0.06, gain: 0.06, cutoff: 3500,
        filterType: 'highpass', attack: 0.001, release: 0.05 },
      { kind: 'tone', type: 'sine', delay: 0.04, frequency: 735, endFrequency: 420,
        duration: 0.24, gain: 0.048, attack: 0.002, release: 0.21 },
      { kind: 'noise', delay: 0.19, duration: 0.08, gain: 0.028, cutoff: 2300,
        filterType: 'bandpass', attack: 0.002, release: 0.065 },
    ],
    pulse: [
      { kind: 'tone', type: 'sine', frequency: 980, endFrequency: 870,
        duration: 0.07, gain: 0.018, attack: 0.002, release: 0.06 },
    ],
  },
};
