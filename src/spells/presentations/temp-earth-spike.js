// Earth Spike: a burrowing ridge of soil races forward and stone spikes punch up
// out of the ground behind it. Rocks always stand upright on screen, so the
// vertical silhouettes are authored in screen space and counter-rotated against
// the adapter's heading; cracks and furrows stay in the local ground frame.
const FLASH = [255, 251, 230], PALE = [236, 228, 198], STONE = [197, 186, 147];
const SHADE = [124, 126, 92], DEEP = [84, 80, 58];
const SOIL = [163, 103, 56], DARK_SOIL = [104, 68, 40], DUST = [190, 164, 122];
const LEAF = [151, 218, 87], BUD = [200, 246, 132];

// Character rigs stand 13 rows per metre of height but the ground recedes only
// 6.5 rows per metre, so one metre of height spans two ground metres of screen.
const HEIGHT = 2;
const ROW = 1 / 13; // one text row of height, in metres
const COL = 0.6 / 13; // one text column, in metres
// The projectile anchor is drawn 1.5 m up at 5 rows per metre (effects.js).
const PROJECTILE_DROP = 1.5 * 5 / 6.5;

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeOut = t => 1 - (1 - t) ** 3;
const easeOutBack = t => { const u = t - 1; return 1 + 2.7 * u * u * u + 1.7 * u * u; };
const tint = (a, b, x) => { const t = clamp01(x); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; };

// Screen-space plotter: sx metres right, sz metres down the screen (ground depth).
function screen(effect, plot) {
  const c = Math.cos(effect.heading || 0), s = Math.sin(effect.heading || 0);
  return (sx, sz, ch, color, b) => plot(sx * c - sz * s, sx * s + sz * c, ch, color, b);
}

// Pick a stroke for a screen direction given in metres (cells are ~2:1 tall).
function stroke(dx, dz) {
  const cx = Math.abs(dx / COL), cy = Math.abs(dz * 6.5) * 2;
  if (cy < cx * 0.4) return '-';
  if (cx < cy * 0.4) return '|';
  return (dx > 0) === (dz > 0) ? '\\' : '/';
}

// A rigid tapered rock pushed `rise` metres out of the ground at (gx, gz).
// Rows are counted from the tip, so its jagged profile moves up with it. Light
// comes from the upper left: a pale lit face, a ridge, and a dark shaded face.
function spike(put, gx, gz, length, half, rise, lean, seed, b, crumble, flash) {
  if (rise < ROW * 0.6 || b <= 0) return;
  const rows = Math.min(24, Math.floor(rise / ROW));
  let prev = 0;
  for (let k = 0; k <= rows; k++) {
    const depth = k * ROW, h = rise - depth, t = Math.min(1, depth / length);
    const cx = gx + lean * h, sz = gz - h * HEIGHT;
    const glow = flash * (1 - t * 0.8);
    const lit = tint(tint(PALE, STONE, t), FLASH, glow);
    const dark = tint(tint(SHADE, DEEP, t), STONE, glow * 0.6);
    if (k === 0) { put(cx, sz, '^', tint(PALE, FLASH, flash), b); continue; }
    const jag = 1 + (hash(seed + k * 7.3) - 0.5) * 0.35;
    const w = Math.max(half * t ** 0.8 * jag, COL * Math.min(k, 2));
    const steep = (w - prev) / COL < 0.4;
    prev = w;
    const keep = j => hash(seed + k * 3.1 + j) >= crumble;
    if (keep(0.5)) put(cx - w, sz, steep ? '|' : '/', lit, b);
    if (keep(0.9)) put(cx + w, sz, steep ? '|' : '\\', dark, b * 0.75);
    if (w > COL * 2.6 && keep(1.7)) {
      put(cx - w * 0.12, sz, k % 4 === 2 ? '+' : ':', tint(lit, dark, 0.45), b * 0.6);
    }
    if (w > COL * 4.5 && k % 2 === 0 && keep(2.3)) {
      put(cx - w * 0.58, sz, k % 4 === 0 ? '%' : '#', tint(lit, STONE, 0.3), b * 0.62);
    }
    if (w > COL * 5.5 && k % 3 === 1 && keep(3.1)) put(cx + w * 0.5, sz, '.', dark, b * 0.5);
  }
}

// Ground cracks: crooked lines radiating over the ground plane.
function cracks(put, gx, gz, count, reach, grow, seed, b, segs = 6) {
  for (let arm = 0; arm < count; arm++) {
    const a = (arm + 0.25 + hash(seed + arm) * 0.5) / count * Math.PI * 2;
    let x = gx + Math.cos(a) * 0.2, z = gz + Math.sin(a) * 0.1;
    const segments = Math.round(segs * grow);
    for (let j = 0; j < segments; j++) {
      const kink = a + (hash(seed + arm * 9 + j) - 0.5) * 0.9;
      const step = reach / segs * (0.8 + hash(seed + arm + j * 3) * 0.4);
      const dx = Math.cos(kink) * step, dz = Math.sin(kink) * step * 0.55;
      x += dx; z += dz;
      const edge = j / segs;
      put(x, z, stroke(dx, dz), tint(SOIL, DARK_SOIL, edge), b * (1 - edge * 0.7));
    }
  }
}

// Ballistic clods and pebbles thrown from (gx, gz) `t` seconds ago.
function debris(put, gx, gz, count, t, power, seed, b, color) {
  if (t <= 0) return;
  for (let i = 0; i < count; i++) {
    const r1 = hash(seed + i * 1.37), r2 = hash(seed + i * 2.91), r3 = hash(seed + i * 4.13);
    const side = (r1 - 0.5) * 2;
    const vx = side * (0.9 + r2 * 1.4) * power, vz = (r3 - 0.5) * 0.9 * power;
    const vh = (1.8 + r2 * 2.4) * power;
    const fly = Math.min(t, 0.9);
    const drag = (1 - Math.exp(-2.4 * fly)) / 2.4;
    let h = vh * fly - 7.5 * fly * fly;
    const falling = vh - 15 * fly < 0;
    const landed = h <= 0;
    if (landed) h = 0;
    const ch = landed ? (r3 > 0.5 ? '.' : ',') : r1 > 0.75 ? 'o' : falling ? (r2 > 0.5 ? '.' : '*') : "'";
    put(gx + vx * drag, gz + vz * drag - h * HEIGHT, ch, tint(color, SOIL, r2 * 0.6),
      b * (landed ? 0.45 : 0.6 + r1 * 0.4));
  }
}

// Dust skirt rolling outward along the ground as an ellipse.
function dust(put, gx, gz, count, radius, b, seed) {
  for (let i = 0; i < count; i++) {
    const a = (i + hash(seed + i) * 0.5) / count * Math.PI * 2;
    const r = radius * (0.85 + hash(seed + i * 3) * 0.3);
    const thin = r / 1.6;
    put(gx + Math.cos(a) * r, gz + Math.sin(a) * r * 0.55 - Math.abs(Math.sin(a * 3 + seed)) * 0.08,
      thin > 0.7 ? '.' : thin > 0.4 ? ':' : ';', tint(DUST, DARK_SOIL, thin * 0.6), b * (1 - thin * 0.45));
  }
}

// A handful of moss leaves fluttering off the stone: the cerrith signature.
function leaves(put, gx, gz, count, t, spread, seed, b) {
  for (let i = 0; i < count; i++) {
    const side = i % 2 ? 1 : -1;
    const drift = t * (0.5 + hash(seed + i) * 0.6);
    const x = gx + side * (0.15 + drift * spread) + Math.sin(t * 7 + i * 1.9) * 0.08;
    const h = 0.25 + hash(seed + i * 5) * 0.9 + drift * 0.8 - drift * drift * 0.9;
    put(x, gz - h * HEIGHT, Math.sin(t * 9 + i) > 0 ? (side < 0 ? '(' : ')') : "'",
      tint(LEAF, BUD, hash(seed + i * 3)), b * (0.55 + hash(seed + i * 7) * 0.45));
  }
}

function drawCast(effect, plot) {
  const put = screen(effect, plot), p = effect.progress;
  const c = Math.cos(effect.heading || 0), s = Math.sin(effect.heading || 0);
  const out = 1 - smooth(0.62, 1, p);
  // Wind-up: soil and leaf motes spiral in under the caster's feet.
  const gather = smooth(0, 0.3, p), gone = smooth(0.26, 0.36, p);
  for (let i = 0; i < 22 && gone < 1; i++) {
    const a = i / 22 * Math.PI * 2 + gather * 2.4 + hash(i) * 0.4;
    const r = 0.45 + (1.5 + hash(i * 3) * 0.5) * (1 - gather);
    const leaf = i % 4 === 0;
    put(Math.cos(a) * r, Math.sin(a) * r * 0.55 - gather * 0.1, leaf ? '*' : r > 1.1 ? '.' : r > 0.7 ? ':' : '+',
      leaf ? LEAF : tint(DUST, SOIL, gather), (0.25 + gather * 0.75) * (1 - gone));
  }
  // Stomp: the ground ring cracks and a dust skirt rolls outward.
  const stomp = smooth(0.26, 0.34, p), after = clamp01((p - 0.28) / 0.6);
  if (stomp > 0) {
    dust(put, 0, 0, 30, 0.45 + easeOut(after) * 1.5, out * (1 - after * 0.4), 3);
    cracks(put, 0, 0, 6, 1.1, easeOut(clamp01((p - 0.28) / 0.2)), 11, out * 0.85);
    put(0, 0, '@', tint(FLASH, SOIL, after * 2), out * (1 - smooth(0.3, 0.5, p)));
  }
  // A fan of shards pops up ahead of the caster, then sinks again.
  for (let i = 0; i < 5; i++) {
    const delay = 0.3 + Math.abs(i - 2) * 0.035;
    const life = clamp01((p - delay) / 0.18);
    if (life <= 0) continue;
    const a = (i - 2) * 0.42, lx = Math.sin(a) * 0.75, lz = Math.cos(a) * 0.75;
    const gx = lx * c + lz * s, gz = lz * c - lx * s;
    const rise = (0.4 + (i === 2 ? 0.35 : 0.08 * (i % 2))) * easeOutBack(life) * (1 - smooth(0.6, 1, p) * 0.8);
    spike(put, gx, gz, 0.6, 0.12, rise, (i - 2) * 0.12, 20 + i * 4, out, smooth(0.6, 1, p), 1 - life);
  }
  // The fissure tears forward toward the first eruption, kicking soil.
  const run = easeOut(clamp01((p - 0.32) / 0.4));
  if (run > 0) {
    let px = 0, pz = 0.9;
    const steps = 14, reach = 0.9 + run * 2.2;
    for (let j = 1; j <= steps; j++) {
      const z = 0.9 + (reach - 0.9) * j / steps;
      const x = Math.sin(j * 1.7) * 0.07 + (hash(j) - 0.5) * 0.08;
      const mx = x * c + z * s - (px * c + pz * s), mz = z * c - x * s - (pz * c - px * s);
      const lead = j / steps;
      plot(x, z, stroke(mx, mz), tint(DARK_SOIL, PALE, lead * lead * (1 - after * 0.6)), out * (0.45 + 0.55 * lead));
      px = x; pz = z;
    }
    const tipX = (reach) * s, tipZ = (reach) * c;
    debris(put, tipX, tipZ, 10, (p - 0.36) * effect.life * 0.6, 0.5, 31, out, STONE);
  }
}

function drawPulse(effect, plot) {
  // One eruption along the burrowing path: crack, punch up, hold, crumble away.
  // These fire every few metres behind the mound, so each stays lean (~90 glyphs).
  const put = screen(effect, plot), p = effect.progress;
  const out = 1 - smooth(0.68, 1, p);
  cracks(put, 0, 0, 3, 0.55, easeOut(clamp01(p / 0.18)), 5, out * (0.5 + 0.5 * (1 - p)), 4);
  const erupt = clamp01((p - 0.06) / 0.2);
  const sink = smooth(0.66, 1, p);
  const flash = erupt > 0 ? 1 - smooth(0.12, 0.36, p) : 0;
  spike(put, 0, 0, 1.35, 0.2, 1.35 * easeOutBack(erupt) * (1 - sink * 0.75), 0.03, 1, out, sink, flash);
  for (const side of [-1, 1]) {
    const e = clamp01((p - 0.1 - (side > 0 ? 0.04 : 0)) / 0.18);
    spike(put, side * 0.4, side * 0.05 + 0.04, 0.6, 0.12, (side > 0 ? 0.55 : 0.45) * easeOutBack(e) * (1 - sink * 0.7),
      side * 0.12, 9 + side * 4, out * 0.9, sink, flash * 0.6);
  }
  const burst = (p - 0.1) * effect.life;
  if (burst > 0) {
    dust(put, 0, 0.02, 8, 0.3 + easeOut(clamp01(burst / 0.4)) * 0.85, out * (1 - clamp01(burst / 0.5) * 0.5), 7);
    debris(put, 0, 0, 6, burst, 0.85, 13, out, STONE);
  }
}

function drawImpact(effect, plot) {
  // The victim is skewered from below: a white flash, a crown of three spikes,
  // a star of cracks, flying shards and a leaf burst, then everything settles.
  const put = screen(effect, plot), p = effect.progress;
  const out = 1 - smooth(0.6, 1, p);
  const flash = 1 - smooth(0, 0.22, p);
  for (let i = 0; i < 14 && flash > 0; i++) {
    const a = i / 14 * Math.PI * 2, r = 0.2 + (1 - flash) * 0.9;
    put(Math.cos(a) * r, Math.sin(a) * r * 0.55, i % 2 ? '*' : '+', tint(FLASH, PALE, 1 - flash), flash);
  }
  cracks(put, 0, 0, 6, 1.3, easeOut(clamp01(p / 0.2)), 17, out * 0.9);
  const sink = smooth(0.58, 1, p);
  const erupt = clamp01(p / 0.16);
  spike(put, 0, 0.03, 2, 0.17, 2 * easeOutBack(erupt) * (1 - sink * 0.8), 0, 3, out, sink, flash);
  for (const side of [-1, 1]) {
    const e = clamp01((p - 0.04) / 0.16);
    spike(put, side * 0.32, 0.08, 1.2, 0.14, 1.15 * easeOutBack(e) * (1 - sink * 0.8), side * 0.3, 40 + side * 7, out * 0.9, sink, flash * 0.7);
  }
  const t = p * effect.life;
  dust(put, 0, 0.04, 18, 0.35 + easeOut(clamp01(p / 0.6)) * 1.25, out * 0.85, 23);
  debris(put, 0, -0.05, 22, t, 1.15, 29, out, tint(PALE, STONE, clamp01(p * 3)));
  leaves(put, 0, 0, 8, t, 1.6, 37, out * smooth(0.04, 0.16, p));
}

function drawProjectile(effect, plot) {
  // A ridge of churned earth burrows forward at ground level; the stone tip
  // flicks through its crest and a cracked furrow trails behind it.
  const p = effect.progress, age = effect.age;
  const out = 1 - smooth(0.9, 1, p);
  const fade = out * smooth(0, 0.06, age);
  const c = Math.cos(effect.heading || 0), s = Math.sin(effect.heading || 0);
  // Ground origin in local coordinates: straight down the screen.
  const ox = -PROJECTILE_DROP * s, oz = PROJECTILE_DROP * c;
  const put = (sx, sz, ch, color, b) => plot(ox + sx * c - sz * s, oz + sx * s + sz * c, ch, color, b);
  const furrow = stroke(s, c);
  // Furrow: two broken soil lines converging on the mound, fading behind it.
  for (let j = 1; j <= 16; j++) {
    const back = j * 0.14, trail = 1 - j / 17;
    for (const side of [-1, 1]) {
      if (hash(j * 3 + side + Math.floor(age * 8)) < 0.18 * (1 - trail)) continue;
      const lx = side * (0.1 + back * 0.05) + Math.sin(back * 4 + side) * 0.03;
      plot(ox + lx, oz - back, j % 4 === 0 ? ':' : furrow, tint(DARK_SOIL, SOIL, trail), fade * (0.2 + 0.6 * trail));
    }
    if (j % 3 === 1) {
      // Little stones nudged up along the seam, shrinking as they settle.
      const lift = 0.18 * trail * (0.6 + 0.4 * Math.sin(age * 14 + j)) * HEIGHT;
      plot(ox + (hash(j) - 0.5) * 0.12 + lift * s, oz - back - lift * c, trail > 0.6 ? '^' : '.',
        tint(SHADE, STONE, trail), fade * trail);
    }
  }
  // The mound itself: a heaving dome of soil, outlined by slope, with a
  // darker churned core.
  const crest = 0.3 + 0.07 * (0.5 + 0.5 * Math.sin(age * 18));
  const dome = u => (1 - u * u) * crest * HEIGHT;
  for (let i = 0; i <= 16; i++) {
    const u = -1 + i / 8, edge = Math.abs(u);
    const ch = edge > 0.9 ? '_' : stroke(0.09, dome(u - 0.125) - dome(u + 0.125));
    put(u * 0.36, -dome(u), ch, tint(SOIL, STONE, 1 - edge), fade * (0.7 + 0.3 * (1 - edge)));
    if (edge < 0.7 && i % 2 === 0) put(u * 0.3, -dome(u) * 0.45, i % 4 ? '.' : ':', DARK_SOIL, fade * 0.55);
  }
  // The stone tip flicks up through the crest, flashing pale as it breaks out.
  const flick = Math.max(0, Math.sin(age * 9));
  const tipRows = Math.floor(flick * 5);
  for (let k = 0; k <= tipRows; k++) {
    const sz = -dome(0) - (tipRows - k) * ROW * HEIGHT - ROW * HEIGHT;
    const color = tint(tint(PALE, STONE, k / 5), FLASH, flick * 0.5 * (1 - k / 5));
    if (k === 0) { put(0, sz, '^', color, fade); continue; }
    put(-k * COL, sz, '/', color, fade);
    put(k * COL, sz, '\\', tint(color, SHADE, 0.5), fade * 0.8);
  }
  // Bow-wave of soil: clods sprayed sideways that hang back as the mound moves on.
  for (let i = 0; i < 18; i++) {
    const tt = (age * 2.2 + hash(i * 1.9)) % 1, side = i % 2 ? 1 : -1;
    const h = Math.max(0, (1.6 + hash(i) * 0.8) * tt * 0.45 - 2.4 * tt * tt * 0.45);
    const lx = side * (0.25 + tt * (0.5 + hash(i * 5) * 0.4)), lz = 0.1 - tt * 1.3;
    const lift = h * HEIGHT; // straight up the screen, expressed in the local frame
    plot(ox + lx + lift * s, oz + lz - lift * c, h > 0.05 ? (i % 3 ? "'" : 'o') : '.',
      tint(SOIL, DUST, tt), fade * (1 - tt) * 0.9);
  }
  leaves(put, 0, 0, 4, (age * 1.3) % 1, 0.8, 51, fade * 0.7);
}

function drawField(effect, plot, ring) {
  // Long-lived stages: a rumbling rubble rim with spikes erupting in turn.
  const put = screen(effect, plot), p = effect.progress, age = effect.age;
  const out = smooth(0, 0.08, p) * (1 - smooth(0.82, 1, p));
  const radius = Math.max(0.5, Math.min(ring ? 1.1 : 3, effect.radius || 1));
  for (let i = 0; i < 26; i++) {
    const a = i / 26 * Math.PI * 2 + (ring ? age * 0.35 : 0);
    const r = radius * (0.92 + hash(i) * 0.16), rumble = Math.sin(age * 11 + i * 2.3) * 0.02;
    put(Math.cos(a) * r, Math.sin(a) * r * 0.55 + rumble, i % 5 === 0 ? 'o' : i % 2 ? '.' : ',',
      tint(DARK_SOIL, STONE, hash(i * 3)), out * (0.45 + 0.35 * hash(i * 7)));
  }
  const spikes = ring ? 6 : 5;
  for (let i = 0; i < spikes; i++) {
    const period = 1.4, local = ((age + i * period / spikes) % period) / period;
    const cycle = Math.floor((age + i * period / spikes) / period);
    const a = ring ? i / spikes * Math.PI * 2 + age * 0.35 : hash(i + cycle * 7) * Math.PI * 2;
    const r = ring ? radius : radius * (0.25 + 0.6 * hash(i * 3 + cycle * 5));
    const rise = (ring ? 0.45 : 0.9) * easeOutBack(clamp01(local / 0.25)) * (1 - smooth(0.6, 1, local));
    spike(put, Math.cos(a) * r, Math.sin(a) * r * 0.55, ring ? 0.5 : 0.9, ring ? 0.1 : 0.15, rise,
      Math.cos(a) * 0.15, i * 11 + cycle, out, smooth(0.55, 1, local), 1 - smooth(0, 0.2, local));
  }
  leaves(put, 0, 0, ring ? 6 : 4, (age * 0.5) % 1, radius, 61, out * 0.6);
}

export default {
  id: 'temp-earth-spike', duration: 0.9,
  draw(effect, plot) {
    switch (effect.stage) {
      case 'cast': return drawCast(effect, plot);
      case 'projectile': return drawProjectile(effect, plot);
      case 'impact': return drawImpact(effect, plot);
      case 'aura': return drawField(effect, plot, true);
      case 'zone': return drawField(effect, plot, false);
      default: return drawPulse(effect, plot);
    }
  },
  sounds: {
    cast: [
      { kind: 'noise', duration: 0.46, gain: 0.055, cutoff: 290, filterType: 'lowpass', attack: 0.08, release: 0.18 },
      { kind: 'tone', type: 'triangle', frequency: 55, endFrequency: 98, duration: 0.42, gain: 0.05, attack: 0.07, release: 0.16 },
      { kind: 'noise', delay: 0.16, duration: 0.045, gain: 0.09, cutoff: 1500, filterType: 'bandpass', attack: 0.001, release: 0.035 },
      { kind: 'noise', delay: 0.31, duration: 0.035, gain: 0.07, cutoff: 2400, filterType: 'bandpass', attack: 0.001, release: 0.028 },
    ],
    impact: [
      { kind: 'noise', duration: 0.17, gain: 0.1, cutoff: 650, filterType: 'lowpass', attack: 0.002, release: 0.14 },
      { kind: 'tone', type: 'triangle', frequency: 108, endFrequency: 39, duration: 0.18, gain: 0.085, attack: 0.002, release: 0.15 },
      { kind: 'noise', delay: 0.06, duration: 0.1, gain: 0.03, cutoff: 1900, filterType: 'bandpass', attack: 0.001, release: 0.09 },
    ],
    pulse: [
      { kind: 'noise', duration: 0.05, gain: 0.018, cutoff: 500, filterType: 'lowpass', release: 0.04 },
      { kind: 'tone', type: 'sine', frequency: 64, endFrequency: 45, duration: 0.08, gain: 0.016, release: 0.065 },
    ],
  },
};
