// Restoration: drifting motes are drawn in and knotted into a sapling, which
// blooms into a rosette of living leaves; the totem then holds a vine-bound
// grove whose heartbeat ripples cleanse everything inside it.
const TAU = Math.PI * 2;

// Warm white -> honey gold -> spring green -> leaf green -> deep moss teal.
const STOPS = [[255, 252, 226], [252, 231, 150], [182, 242, 122], [118, 214, 108], [58, 164, 118]];
const RAMP = [];
for (let i = 0; i <= 32; i++) {
  const t = i / 32 * (STOPS.length - 1), k = Math.min(STOPS.length - 2, Math.floor(t)), f = t - k;
  RAMP.push(STOPS[k].map((c, j) => Math.round(c + (STOPS[k + 1][j] - c) * f)));
}
const tone = t => RAMP[Math.round((t < 0 ? 0 : t > 1 ? 1 : t) * 32)];

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeOut = t => 1 - (1 - t) ** 3;
const easeBack = t => { const u = t - 1; return 1 + 2.7 * u * u * u + 1.7 * u * u; };
const hash = (i, salt = 0) => { const v = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453; return v - Math.floor(v); };
// Thin a set out smoothly: member i survives while its hash is below `keep`.
const thin = (i, keep, salt = 7) => clamp01((keep - hash(i, salt)) * 10);

// The ground ellipse is twice as wide as it is tall on screen. This table maps
// an even fraction of the visible circumference to an angle so ring glyphs are
// spaced evenly instead of piling up at the left and right ends.
const ARC = (() => {
  const n = 256, sum = [0];
  for (let i = 1; i <= n; i++) {
    const a = (i - 0.5) / n * TAU;
    sum.push(sum[i - 1] + Math.hypot(2 * Math.sin(a), Math.cos(a)));
  }
  const table = new Float64Array(n + 1);
  for (let k = 0, j = 0; k <= n; k++) {
    const target = k / n * sum[n];
    while (j < n - 1 && sum[j + 1] < target) j++;
    table[k] = (j + clamp01((target - sum[j]) / (sum[j + 1] - sum[j]))) / n * TAU;
  }
  return table;
})();
const arcAngle = u => {
  const f = (u - Math.floor(u)) * 256, i = Math.floor(f);
  return ARC[i] + (ARC[i + 1] - ARC[i]) * (f - i);
};

// Screen glyph for a ground-plane direction (one metre is 2:1 wide on screen).
function slant(dx, dz) {
  const a = Math.atan2(Math.abs(dz), Math.abs(dx * 2));
  return a < 0.4 ? '-' : a > 1.17 ? '|' : dx * dz > 0 ? '\\' : '/';
}
const spark = b => (b > 0.82 ? '*' : b > 0.6 ? '+' : b > 0.38 ? "'" : '.');

// Draw in the world frame so "up" stays up and slants stay true whatever the
// caster's heading; very dim glyphs are skipped instead of feeding the glow.
function upright(plot, heading) {
  const c = Math.cos(heading), s = Math.sin(heading);
  return (x, z, char, color, light) => {
    if (light > 0.025) plot(x * c - z * s, x * s + z * c, char, color, light > 1 ? 1 : light);
  };
}

// A lens-shaped leaf from (bx, bz) toward `angle`, outlined by its two edges
// and a midrib. `grown` trims it from the tip so it can unfurl and wither.
function leaf(plot, bx, bz, angle, length, width, light, hue, grown = 1) {
  const dx = Math.cos(angle), dz = Math.sin(angle), nx = -dz, nz = dx;
  const reach = length * grown;
  for (let i = 1; i <= 4; i++) {
    const s = i / 5;
    if (s > grown) break;
    const w = width * Math.sin(Math.PI * s) ** 0.8, k = width * Math.PI * Math.cos(Math.PI * s) / length;
    const cx = bx + dx * length * s, cz = bz + dz * length * s;
    for (const side of [-1, 1]) {
      plot(cx + nx * w * side, cz + nz * w * side, slant(dx + nx * k * side, dz + nz * k * side),
        tone(hue + s * 0.15), light * (0.7 + s * 0.2));
    }
    if (i % 2 === 0) plot(cx, cz, slant(dx, dz), tone(hue + 0.25), light * 0.5);
  }
  if (grown > 0.25) plot(bx + dx * reach, bz + dz * reach, grown > 0.95 ? '*' : "'", tone(hue - 0.3), light);
}

// An evenly spaced ring of tangent-aligned glyphs. A one-metre ring spans
// about 119 cells, so on small rings every other glyph fades to stay legible.
function ring(plot, count, radius, spin, light, hue, keep = 1, salt = 3) {
  const crowd = smooth(1.5, 2.6, radius * 119 / count);
  for (let i = 0; i < count; i++) {
    const a = arcAngle(i / count + spin), b = light * thin(i, keep, salt) * (i % 2 ? crowd : 1);
    if (b <= 0.025) continue;
    plot(Math.cos(a) * radius, Math.sin(a) * radius, slant(-Math.sin(a), Math.cos(a)), tone(hue + hash(i, salt) * 0.12), b);
  }
}

// Sparkles that bud from the ground inside `spread`, rise and sway, and wink out.
function motes(plot, count, spread, time, span, light, salt, lift = 0.5) {
  for (let i = 0; i < count; i++) {
    const t = (time - hash(i, salt) * span) / 0.42;
    if (t <= 0 || t >= 1) continue;
    const a = hash(i, salt + 1) * TAU, r = spread * Math.sqrt(hash(i, salt + 2));
    const rise = (1 - (1 - t) ** 2) * lift * (0.7 + hash(i, salt + 3) * 0.7);
    const x = Math.cos(a) * r + Math.sin(t * 5 + i) * 0.06, z = Math.sin(a) * r * 0.9 - rise;
    const b = light * Math.sin(Math.PI * t) ** 0.7;
    plot(x, z, spark(b * (1.1 - t * 0.5)), tone(0.1 + t * 0.6), b);
  }
}

// The totem sapling: a stem rising up the screen, paired leaves, and a crown.
function sapling(plot, height, sway, light, bloom) {
  const rows = Math.max(1, Math.round(height * 6.5));
  for (let i = 0; i < rows; i++) {
    const s = (i + 0.5) / rows, x = Math.sin(s * 1.6) * sway;
    plot(x, -i / 6.5, s > 0.6 && sway > 0.02 ? '/' : s > 0.6 && sway < -0.02 ? '\\' : '|', tone(0.75 - s * 0.2), light * (0.65 + s * 0.3));
  }
  const top = -rows / 6.5, tipX = Math.sin(1.6) * sway;
  if (rows >= 3) {
    const mid = -Math.round(rows * 0.45) / 6.5, midX = Math.sin(0.75) * sway;
    plot(midX - 0.06, mid, '\\', tone(0.55), light * 0.85);
    plot(midX + 0.06, mid, '/', tone(0.55), light * 0.85);
    plot(midX - 0.12, mid + 0.02, '~', tone(0.65), light * 0.6 * bloom);
    plot(midX + 0.12, mid + 0.02, '~', tone(0.65), light * 0.6 * bloom);
  }
  plot(tipX, top, bloom > 0.6 ? '@' : bloom > 0.25 ? 'o' : ',', tone(0.25 - bloom * 0.2), light);
  if (bloom > 0.4) {
    const petals = light * smooth(0.4, 0.8, bloom);
    plot(tipX - 0.07, top, '(', tone(0.12), petals);
    plot(tipX + 0.07, top, ')', tone(0.12), petals);
    plot(tipX, top - 1 / 6.5, "'", tone(0.05), petals * 0.8);
  }
}

// Gathering wind-up, a blooming knot of leaves, then rising motes.
function drawCast(plot, p, radius) {
  const R = 1 + Math.min(3, Math.max(0.5, radius)) * 0.35;
  const end = 1 - smooth(0.8, 1, p);
  const bloomAt = 0.44;

  // Motes spiral in with accelerating ease and short comet trails.
  for (let i = 0; i < 16; i++) {
    const delay = hash(i, 1) * 0.1, a0 = i / 16 * TAU + hash(i, 2) * 0.35, r0 = R * (1.35 + hash(i, 3) * 0.45);
    for (let k = 0; k < 3; k++) {
      const t = clamp01((p - delay - k * 0.025) / (bloomAt - delay)), e = t * t * t;
      if (t <= 0 || t >= 1) continue;
      const a = a0 + e * 1.9, r = r0 * (1 - e) + R * 0.06;
      const b = smooth(0, 0.12, t) * (1 - smooth(0.9, 1, t)) * (1 - k * 0.32) * (k ? smooth(0.3, 0.6, t) : 1);
      plot(Math.cos(a) * r, Math.sin(a) * r, k ? '.' : spark(0.45 + e * 0.5), tone(0.62 - e * 0.5 + k * 0.08), b);
    }
  }

  // A ground circle is traced around the caster, then breathes out and frays.
  const traced = easeOut(smooth(0.02, bloomAt, p)), after = smooth(bloomAt, 1, p);
  const circle = R * (0.95 + easeOut(after) * 0.3), loops = 44;
  for (let i = 0; i < loops; i++) {
    const u = i / loops;
    if (u > traced) break;
    const a = arcAngle(u - 0.25 + after * 0.08), head = traced < 1 ? smooth(traced - 0.12, traced, u) : 0;
    const b = (0.42 + head * 0.55 + (1 - after) * smooth(bloomAt - 0.02, bloomAt + 0.04, p) * 0.4) * thin(i, 1.05 - after * 1.1) * end;
    plot(Math.cos(a) * circle, Math.sin(a) * circle, head > 0.7 ? '*' : slant(-Math.sin(a), Math.cos(a)), tone(head > 0.5 ? 0.1 : 0.45 + after * 0.4), b);
  }

  // The gathered light condenses (anticipation) and flashes at the bloom.
  const charge = smooth(0.18, bloomAt, p), flash = Math.exp(-(((p - bloomAt) / 0.05) ** 2));
  plot(0, 0, flash > 0.5 ? '@' : charge > 0.6 ? 'O' : charge > 0.3 ? 'o' : '.', tone(0.3 - charge * 0.3),
    (0.25 + charge * 0.6) * (1 - smooth(bloomAt, bloomAt + 0.1, p)) + flash);
  if (flash > 0.06) {
    for (let k = 0; k < 8; k++) {
      const a = k * TAU / 8, len = 0.12 + flash * 0.16;
      plot(Math.cos(a) * len, Math.sin(a) * len * 0.8, slant(Math.cos(a), Math.sin(a)), tone(0.05), flash);
    }
  }

  // Shock ring of fresh light rolls outward and thins.
  const wave = smooth(bloomAt, 0.74, p);
  if (wave > 0 && wave < 1) ring(plot, 40, R * (0.45 + easeOut(wave) * 1.2), 0.1, (1 - wave) * 0.95, wave * 0.5, 1.1 - wave);

  // Six leaves unfurl with overshoot, then drift, turn, and wither from the tip.
  const open = smooth(bloomAt - 0.02, 0.66, p), drift = smooth(0.66, 1, p);
  if (open > 0) {
    for (let k = 0; k < 6; k++) {
      const a = k * TAU / 6 + Math.PI / 6 + drift * 0.35, base = R * (0.24 + drift * 0.3);
      leaf(plot, Math.cos(a) * base, Math.sin(a) * base, a, R * 0.56, R * 0.17,
        (0.55 + 0.45 * smooth(bloomAt, 0.5, p)) * (1 - drift * 0.5) * end, 0.45, Math.max(0.05, easeBack(open)) * (1 - drift * 0.5));
    }
  }

  // The sapling rises from the knot and holds while sparkles lift away.
  const grow = smooth(0.3, 0.6, p);
  if (grow > 0) sapling(plot, R * 0.62 * easeOut(grow), Math.sin(p * 9) * 0.03 * grow, grow * end, smooth(0.5, 0.72, p));
  motes(plot, 24, R * 0.95, p - bloomAt, 0.4, end * smooth(bloomAt, bloomAt + 0.04, p), 11, 1);
}

// Heal arrival: a flash, a ring, leaves opening around the target and motes.
function drawImpact(plot, p, radius) {
  const R = 0.7 + Math.min(3, Math.max(0.5, radius)) * 0.3;
  const end = 1 - smooth(0.7, 1, p);
  const flash = Math.exp(-(((p - 0.04) / 0.07) ** 2));
  plot(0, 0, flash > 0.45 ? '@' : '*', tone(0.05 + (1 - flash) * 0.3), (0.35 + flash) * end);
  for (let k = 0; k < 8; k++) {
    const a = k * TAU / 8 + 0.2, len = R * (0.1 + flash * 0.18);
    plot(Math.cos(a) * len, Math.sin(a) * len, slant(Math.cos(a), Math.sin(a)), tone(0.05), flash);
  }
  const wave = smooth(0, 0.55, p);
  if (wave < 1) ring(plot, 44, R * (0.4 + easeOut(wave) * 1.05), 0.05, (1 - wave) * 1.1, wave * 0.6, 1.1 - wave);
  const open = smooth(0.02, 0.32, p), wither = smooth(0.5, 1, p);
  for (let k = 0; k < 5; k++) {
    const a = k * TAU / 5 - Math.PI / 2 + wither * 0.3, base = R * (0.12 + wither * 0.3);
    leaf(plot, Math.cos(a) * base, Math.sin(a) * base, a, R * 0.55, R * 0.16,
      end * (1 - wither * 0.4), 0.42, Math.max(0.05, easeBack(open)) * (1 - wither * 0.6));
  }
  // Stitches close across the healed seam: '<' '>' meet as an 'x'.
  for (let k = 0; k < 4; k++) {
    const a = k * TAU / 4 + Math.PI / 4, r = R * 0.9, gap = 0.16 * (1 - easeOut(smooth(0.05, 0.4, p)));
    const x = Math.cos(a) * r, z = Math.sin(a) * r, b = smooth(0.02, 0.12, p) * end;
    if (gap > 0.02) {
      plot(x - gap, z, '>', tone(0.4), b);
      plot(x + gap, z, '<', tone(0.4), b);
    } else plot(x, z, 'x', tone(0.15), b);
  }
  motes(plot, 26, R * 0.9, p - 0.04, 0.5, end, 31);
}

// A brief embrace: leaflets swoop in to a glowing ring, which lifts as motes.
function drawAura(plot, p, radius) {
  const R = 0.6 + Math.min(3, Math.max(0.4, radius)) * 0.35;
  const end = 1 - smooth(0.62, 1, p), arrive = easeOut(smooth(0, 0.42, p));
  const r = R * (1.45 - arrive * 0.5);
  for (let k = 0; k < 8; k++) {
    const a = k * TAU / 8 + (1 - arrive) * 1.3 + p * 0.5;
    const x = Math.cos(a) * r, z = Math.sin(a) * r, tx = -Math.sin(a), tz = Math.cos(a);
    const b = smooth(0, 0.15, p) * end;
    plot(x, z, slant(tx, tz) === '-' ? (tx > 0 ? '>' : '<') : tz > 0 ? 'v' : '^', tone(0.4), b);
    plot(x - tx * 0.14, z - tz * 0.14, slant(tx, tz), tone(0.6), b * 0.75);
    plot(x - tx * 0.28, z - tz * 0.28, '.', tone(0.75), b * 0.45);
  }
  ring(plot, 40, R * (0.95 + smooth(0.4, 1, p) * 0.1), p * 0.15, smooth(0.25, 0.45, p) * 0.75 * end, 0.35, 1.1 - smooth(0.55, 1, p));
  motes(plot, 18, R * 0.9, p - 0.35, 0.3, end, 51);
}

// The totem grove: a vine boundary, three curling roots, a swaying sapling,
// and a steady drizzle of rising motes.
function drawZone(plot, p, age, radius) {
  const R = Math.min(5, Math.max(1.2, radius));
  const live = smooth(0, 0.14, p) * (1 - smooth(0.8, 1, p));
  const breathe = 0.85 + Math.sin(age * TAU * 1.6) * 0.15;
  // Vine boundary: drawn in, then slowly turning.
  const drawn = easeOut(smooth(0, 0.2, p)), loops = 72, spin = age * 0.03;
  for (let i = 0; i < loops; i++) {
    const u = i / loops;
    if (u > drawn) break;
    const a = arcAngle(u + spin), wob = 1 + Math.sin(a * 9 + age * 2) * 0.025;
    const leafy = i % 6 === 0, b = live * breathe * (leafy ? 0.85 : 0.55) * thin(i, 1.1 - smooth(0.82, 1, p) * 1.15, 5);
    plot(Math.cos(a) * R * wob, Math.sin(a) * R * wob, leafy ? (i % 12 ? '&' : '*') : slant(-Math.sin(a), Math.cos(a)), tone(leafy ? 0.3 : 0.7), b);
  }
  // Three roots curl from the sapling toward the boundary.
  const reach = easeOut(smooth(0.04, 0.32, p));
  for (let arm = 0; arm < 3; arm++) {
    for (let i = 1; i <= 14; i++) {
      const s = i / 14;
      if (s > reach) break;
      const a = arm * TAU / 3 + Math.PI / 2 + s * 1.6 + age * 0.12, r = R * (0.12 + s * 0.78);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const pulse = 0.5 + 0.5 * Math.cos((s - age * 1.3) * TAU);
      plot(x, z, i === 14 ? '*' : slant(Math.cos(a) * 0.78 - Math.sin(a) * s * 1.6 - Math.sin(a) * 0.12, Math.sin(a) * 0.78 + Math.cos(a) * (s * 1.6 + 0.12)),
        tone(0.75 - pulse * 0.45), live * (0.38 + pulse * 0.4) * (1 - s * 0.25));
    }
  }
  sapling(plot, 0.75 * easeOut(smooth(0, 0.25, p)), Math.sin(age * 2.4) * 0.05, live, smooth(0.1, 0.3, p));
  motes(plot, 20, R * 0.85, age % 0.84, 0.42, live, 71, 0.8);
  motes(plot, 20, R * 0.85, (age + 0.42) % 0.84, 0.42, live, 91, 0.8);
}

// A heartbeat ripple from the totem: a bright ring rolling out with leaves.
function drawPulse(plot, p, radius) {
  const R = Math.min(6, Math.max(0.8, radius));
  const wave = easeOut(p), r = R * (0.3 + wave * 0.7), end = 1 - smooth(0.55, 1, p);
  const light = smooth(0, 0.12, p) * end;
  ring(plot, 52, r, 0.02, light * 0.85, 0.12 + p * 0.55, 1.15 - p * 0.6, 13);
  for (let k = 0; k < 10; k++) {
    const a = arcAngle(k / 10 + 0.05 + hash(k, 17) * 0.04), rr = r * (1.04 + hash(k, 19) * 0.08) + p * 0.15;
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr - p * 0.2;
    plot(x, z, p < 0.5 ? (Math.cos(a) > 0 ? '>' : '<') : "'", tone(0.4 + p * 0.3), light * 0.8);
  }
  for (let k = 0; k < 6; k++) {
    const a = k * TAU / 6 + 0.3, rr = R * 0.08 * (1 + p);
    plot(Math.cos(a) * rr, Math.sin(a) * rr - p * 0.3, k % 2 ? '+' : "'", tone(0.1 + p * 0.3), light * (1 - p) * 0.9);
  }
}

// A seed-leaf in flight trailing a twin vine helix and falling sparkles.
function drawProjectile(effect, plot) {
  const p = effect.progress, age = effect.age;
  const light = smooth(0, 0.05, p) * (1 - smooth(0.85, 1, p));
  const lit = (x, z, ch, c, b) => { if (b > 0.025) plot(x, z, ch, c, b); };
  leaf(lit, 0, -0.15, Math.PI / 2, 0.55, 0.13, light, 0.35);
  lit(0, 0.42, '*', tone(0.02), light);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 12; i++) {
      const s = i / 12, z = -0.2 - s * 1.2;
      const x = Math.sin(age * 9 - s * 7 + (side > 0 ? Math.PI : 0)) * 0.12 * (1 - s * 0.4);
      lit(x, z, Math.cos(age * 9 - s * 7 + (side > 0 ? Math.PI : 0)) > 0 ? '(' : ')', tone(0.5 + s * 0.4), light * (1 - s) * 0.85);
    }
  }
  for (let i = 0; i < 8; i++) {
    const t = (age * 1.8 + hash(i, 41)) % 1;
    lit((hash(i, 43) - 0.5) * 0.4 * (1 + t), -0.3 - t * 1.1, spark(1 - t), tone(0.1 + t * 0.6), light * (1 - t) * 0.8);
  }
}

export default {
  id: 'restoration',
  duration: 1.45,
  draw(effect, plot) {
    if (effect.stage === 'projectile') { drawProjectile(effect, plot); return; }
    const world = upright(plot, effect.heading ?? 0);
    const p = effect.progress;
    if (effect.stage === 'cast') drawCast(world, p, effect.radius);
    else if (effect.stage === 'impact') drawImpact(world, p, effect.radius);
    else if (effect.stage === 'aura') drawAura(world, p, effect.radius);
    else if (effect.stage === 'zone') drawZone(world, p, effect.age, effect.radius);
    else drawPulse(world, p, effect.radius);
  },
  sounds: {
    cast: [
      { kind: 'tone', type: 'triangle', frequency: 293.66, delay: 0, duration: 0.7, gain: 0.055, attack: 0.035, release: 0.5 },
      { kind: 'tone', type: 'sine', frequency: 369.99, delay: 0.27, duration: 0.7, gain: 0.065, attack: 0.04, release: 0.48 },
      { kind: 'tone', type: 'triangle', frequency: 440, delay: 0.62, duration: 0.75, gain: 0.05, attack: 0.04, release: 0.55 },
      { kind: 'tone', type: 'sine', frequency: 587.33, delay: 1.02, duration: 0.9, gain: 0.045, attack: 0.06, release: 0.65 },
      { kind: 'noise', delay: 0.08, duration: 1.65, gain: 0.025, cutoff: 1050, filterType: 'lowpass', attack: 0.28, release: 0.6 },
    ],
    impact: [
      { kind: 'tone', type: 'sine', frequency: 293.66, duration: 0.7, gain: 0.06, attack: 0.04, release: 0.5 },
      { kind: 'tone', type: 'triangle', frequency: 440, delay: 0.08, duration: 0.8, gain: 0.045, attack: 0.045, release: 0.55 },
      { kind: 'tone', type: 'sine', frequency: 587.33, delay: 0.25, duration: 0.8, gain: 0.045, attack: 0.04, release: 0.6 },
      { kind: 'noise', delay: 0.05, duration: 0.65, gain: 0.018, cutoff: 900, filterType: 'lowpass', attack: 0.15, release: 0.35 },
    ],
    pulse: [
      { kind: 'tone', type: 'sine', frequency: 369.99, duration: 0.16, gain: 0.019, attack: 0.025, release: 0.11 },
      { kind: 'tone', type: 'sine', frequency: 440, delay: 0.12, duration: 0.17, gain: 0.014, attack: 0.025, release: 0.12 },
    ],
  },
};
