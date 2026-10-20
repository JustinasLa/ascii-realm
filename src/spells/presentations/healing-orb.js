// Healing Orb: a cerrith seed of light. Pollen spirals into a five-petal ground
// sigil, the released orb flies as a phyllotaxis sun trailing a vine helix, the
// ground sprouts as it passes, and the heal unfurls five leaves around a cross.
const white = [250, 255, 238], light = [239, 255, 203], mint = [153, 246, 174];
const leaf = [83, 192, 113], deep = [44, 138, 82], pollen = [248, 226, 133];
const tau = Math.PI * 2, golden = Math.PI * (3 - Math.sqrt(5));
const ramp = '.:;+*#@', soft = '.:+*';

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeOut = t => 1 - (1 - clamp01(t)) ** 3;
const easeBack = t => { const u = clamp01(t) - 1; return 1 + 2.4 * u ** 3 + 1.4 * u * u; };
const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const shade = (v, set = ramp) => set[Math.min(set.length - 1, Math.max(0, Math.floor(clamp01(v) * set.length)))];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
// Life gradient: white flash -> cream light -> mint -> leaf green.
const bloom = t => (t < 0.33 ? mix(white, light, t / 0.33) : t < 0.66
  ? mix(light, mint, (t - 0.33) / 0.33) : mix(mint, leaf, clamp01((t - 0.66) / 0.34)));

// A sunflower (golden-angle) disc: even fill, bright core, sparse rim. The
// highlight sweeps around independently of the slowly spinning seeds.
function sun(plot, radius, count, spin, glint, heat, light01) {
  for (let k = count - 1; k >= 0; k--) {
    const f = (k + 0.5) / count, r = radius * Math.sqrt(f), a = k * golden + spin;
    const v = clamp01(0.92 * (1 - f) ** 0.75 + 0.35 * f * Math.max(0, Math.cos(a - glint)));
    const b = light01 * (0.3 + 0.7 * v);
    if (b > 0.004) plot(Math.sin(a) * r, Math.cos(a) * r, shade(v), bloom(clamp01(1 - v - heat * 0.4)), b);
  }
}

function flight(effect, plot) {
  const t = effect.age, fade = clamp01((1 - effect.progress) * 3);
  const s = 0.4 + 0.6 * easeBack(t / 0.16);
  const radius = 0.37 * s * (1 + Math.sin(t * 9) * 0.04);
  // Two vine strands braid behind the orb; the near strand reads brighter.
  for (let strand = 0; strand < 2; strand++) {
    for (let k = 0; k < 12; k++) {
      const phase = k * 0.62 - t * 11 + strand * Math.PI, near = Math.cos(phase);
      const b = fade * (1 - k / 13) ** 1.2 * (0.42 + 0.34 * Math.max(0, near));
      plot(Math.sin(phase) * (0.21 - k * 0.008) * s, -(0.3 + k * 0.19) * s,
        k < 2 && near > 0 ? '+' : near > 0.2 ? ':' : '.', mix(strand ? pollen : mint, deep, k / 12), b);
    }
  }
  // Pollen motes peel off the orb and widen as they drift back.
  for (let i = 0; i < 16; i++) {
    const phi = (t * 1.9 + hash(i)) % 1, side = hash(i + 40) - 0.5;
    const b = fade * (1 - phi) ** 1.5 * smooth(0, 0.08, phi) * 0.85;
    plot(side * 0.3 + Math.sin(t * 5 + i * 2.1) * phi * 0.32, -(0.35 + phi * 2.45) * s,
      phi < 0.3 ? '*' : phi < 0.6 ? '+' : '.', mix(light, pollen, phi), b);
  }
  // Three leaves orbit the light, brighter as they swing to the near side.
  for (let i = 0; i < 3; i++) {
    const a = t * 4.5 + i * tau / 3, r = 0.62 * s, x = Math.sin(a) * r, z = Math.cos(a) * r;
    const tx = Math.cos(a) * 0.07, tz = -Math.sin(a) * 0.07, b = fade * (0.6 + 0.3 * Math.sin(a));
    plot(x - tx, z - tz, ',', leaf, b * 0.75);
    plot(x + tx, z + tz, '\'', leaf, b * 0.75);
    plot(x, z, '*', mint, b);
  }
  sun(plot, radius, 56, t * 1.6, t * 4.2, 0, fade);
}

function cast(effect, plot) {
  const p = effect.progress, t = effect.age;
  const g = clamp01(p / 0.38), gIn = g * g, rel = clamp01((p - 0.38) / 0.62);
  const out = 1 - smooth(0.45, 1, p);
  // Pollen is drawn in along accelerating spirals, each with a short tail.
  if (g < 1) {
    for (let i = 0; i < 28; i++) {
      const r0 = 1.15 + hash(i) * 0.55, a0 = hash(i + 9) * tau;
      const live = smooth(0, 0.18, g) * (1 - smooth(0.82, 1, g));
      for (let tail = 0; tail < 3; tail++) {
        const gt = Math.max(0, g - tail * 0.05), e = gt * gt;
        const r = r0 * (1 - e) + 0.06, a = a0 + e * 2.6;
        plot(Math.sin(a) * r, Math.cos(a) * r, tail ? (tail === 1 ? ':' : '.') : g > 0.55 ? '*' : '+',
          tail ? pollen : light, live * (0.85 - tail * 0.28));
      }
    }
  }
  // The ground sigil circle draws itself, then turns and thins away.
  const sweep = easeOut(g) * tau, ringR = 1.05 + 0.22 * easeOut(rel);
  for (let j = 0; j < 45; j++) {
    const a0 = j / 45 * tau;
    if (a0 > sweep) continue;
    const head = clamp01(1 - (sweep - a0) / 1.2) * (1 - rel), a = a0 + rel * 0.6;
    const dissolve = 1 - smooth(0.55 + hash(j + 3) * 0.3, 0.85 + hash(j + 3) * 0.15, p);
    const node = j % 9 === 0;
    plot(Math.sin(a) * ringR, Math.cos(a) * ringR, node ? 'o' : head > 0.5 ? '+' : j % 2 ? ':' : '.',
      node ? light : mix(mint, leaf, rel), out * dissolve * (node ? 0.9 : 0.5 + 0.4 * head));
  }
  // A five-petal rose blooms inside the sigil as the gather completes.
  const rose = easeBack(clamp01((p - 0.12) / 0.4)) * 0.82;
  if (rose > 0.03) {
    for (let j = 0; j < 40; j++) {
      const th = j / 40 * Math.PI, c = Math.cos(5 * th), r = rose * c;
      const a = th - t * 0.7, v = Math.abs(c);
      plot(Math.sin(a) * r, Math.cos(a) * r, v > 0.85 ? '*' : v > 0.4 ? ':' : '.',
        mix(light, leaf, 1 - v), out * (1 - smooth(0.5, 0.95, p)) * (0.35 + 0.5 * v));
    }
  }
  // The nucleus brightens through the gather and flares white on release.
  const flare = p < 0.38 ? 0.35 + 0.65 * gIn : (1 - clamp01(rel / 0.24)) ** 1.5;
  if (flare > 0.01) {
    const coreR = p < 0.38 ? 0.08 + 0.2 * gIn : 0.28 + 0.3 * easeOut(rel / 0.24);
    sun(plot, coreR, 20, t * 3, t * 6, p < 0.38 ? 1 - g : 1, flare);
  }
  if (rel <= 0) return;
  // Release: a light shock ring, leaves flung out with drag, lingering pollen.
  const q = clamp01(rel / 0.55);
  if (q < 1) {
    const r = 0.25 + 1.65 * easeOut(q), b = (1 - q) ** 1.5;
    for (let j = 0; j < 36; j++) {
      const a = j / 36 * tau + 0.09;
      plot(Math.sin(a) * r, Math.cos(a) * r, shade(b, soft), bloom(q), b * 0.9);
    }
  }
  for (let i = 0; i < 12; i++) {
    const a0 = (i + hash(i + 70) * 0.7) * tau / 12, v = 1.6 + hash(i + 80) * 1.4;
    const r = 0.2 + v * (1 - Math.exp(-rel * 4)) / 2.2, a = a0 + rel * (hash(i) > 0.5 ? 0.9 : -0.9);
    const x = Math.sin(a) * r, z = Math.cos(a) * r, b = out ** 1.3 * smooth(0, 0.06, rel) * (0.7 + 0.3 * Math.sin(t * 13 + i));
    plot(x, z, '*', mint, b);
    plot(x - Math.sin(a) * 0.08, z - Math.cos(a) * 0.08, ',', leaf, b * 0.6);
  }
  for (let i = 0; i < 16; i++) {
    const a = hash(i + 120) * tau + rel * 0.5, r = 0.3 + hash(i + 140) * 0.9 + rel * 0.45;
    plot(Math.sin(a) * r, Math.cos(a) * r, '.', pollen,
      out * smooth(0, 0.3, rel) * (0.45 + 0.4 * Math.sin(t * 9 + i * 2.3)));
  }
}

// One unfurling leaf: a pointed outline, a midrib and a seed-bead tip. The
// leaf starts a little off-centre so five of them stay separate; tips dissolve first.
function petal(plot, angle, length, front, tint, glow) {
  const dx = Math.sin(angle), dz = Math.cos(angle), px = dz, pz = -dx, base = 0.16 * Math.min(1, length);
  const seen = u => clamp01((front - u) * 4);
  for (let j = 1; j <= 12; j++) {
    const u = j / 13, w = 0.27 * length * Math.sin(Math.PI * u ** 0.85) ** 0.8, b = glow * seen(u);
    if (b <= 0.004) continue;
    const color = mix(mix(mint, leaf, u * 0.8), deep, tint), along = base + u * length;
    for (let side = -1; side <= 1; side += 2) {
      plot(dx * along + px * w * side, dz * along + pz * w * side,
        u < 0.3 ? '*' : u < 0.75 ? '+' : ':', color, b * (0.95 - u * 0.25));
    }
  }
  for (let j = 0; j < 6; j++) {
    const u = j / 7, b = glow * seen(u), along = base + u * length;
    if (b > 0.004) plot(dx * along, dz * along, u < 0.3 ? '+' : ':',
      mix(mix(light, mint, u * 1.5), leaf, tint), b * (0.85 - u * 0.3));
  }
  const tip = glow * seen(1.04);
  if (tip > 0.004) plot(dx * (base + length * 1.06), dz * (base + length * 1.06), 'o', mix(light, mint, tint), tip);
}

function impact(effect, plot) {
  const p = effect.progress, t = effect.age, out = 1 - p;
  // The landing flash: a white seed-sun that bursts open and burns out fast.
  const fq = clamp01(p / 0.2);
  if (fq < 1) sun(plot, 0.3 + 0.4 * easeOut(fq), 24, t * 3, t * 8, 1, (1 - fq) ** 1.4);
  // A soft shock ring rolls across the ground and thins as it widens.
  const q = clamp01(p / 0.45);
  if (q < 1) {
    const r = 0.25 + 2.1 * easeOut(q), b = (1 - q) ** 1.6;
    for (let j = 0; j < 36; j++) {
      const a = j / 36 * tau;
      plot(Math.sin(a) * r, Math.cos(a) * r, shade(b, soft), bloom(q * 0.9), b);
    }
  }
  // Five leaves spring open with overshoot, twisting as they unfurl.
  const u = easeBack((p - 0.03) / 0.4), length = 1.3 * u;
  if (length > 0.06) {
    const front = 1.3 - 1.6 * smooth(0.58, 0.98, p), tint = smooth(0.4, 1, p) * 0.55;
    const glow = Math.min(1, out * 3) * (0.8 + 0.2 * (1 - clamp01(p / 0.15)));
    for (let n = 0; n < 5; n++) petal(plot, n * tau / 5 + (1 - clamp01(u)) * 0.8 + p * 0.25, length, front, tint, glow);
  }
  // Healing sparkles launch in a staggered fountain and spiral out with drag.
  for (let i = 0; i < 20; i++) {
    const start = 0.06 + hash(i + 200) * 0.2, a = p - start;
    if (a <= 0) continue;
    const lf = a / (1 - start), v = 1.5 + hash(i + 220) * 1.3;
    const r = 0.25 + v * (1 - Math.exp(-a * 5)) * 0.7, ang = hash(i + 240) * tau + a * (hash(i) > 0.5 ? 1.6 : -1.6);
    const b = (1 - lf) ** 1.1 * smooth(0, 0.04, a) * (0.75 + 0.25 * Math.sin(t * 20 + i * 3));
    plot(Math.sin(ang) * r, Math.cos(ang) * r, lf < 0.4 ? '*' : lf < 0.75 ? '+' : '.', mix(white, pollen, lf), b);
  }
  // The healing cross holds at the heart of the bloom.
  plot(0, 0, '+', light, out * smooth(0, 0.06, p + 0.03));
}

// Repeating ground sprouts: a rosette of crescent leaf-arcs rolls outward with
// a faint echo behind it, five sprouts spring up inside and pollen lifts off.
// Small radii mark the orb's path; the radius-3 hit burst uses the same shape.
function pulse(effect, plot) {
  const p = effect.progress, q = easeOut(p), out = 1 - p, t = effect.age;
  const R = Math.min(4, Math.max(0.5, effect.radius || 1)), wide = R >= 2;
  const arcs = wide ? 10 : 6, per = wide ? 5 : 3, front = R * (0.12 + 0.78 * q);
  const fade = out ** 1.3, spin = p * 0.5 + R;
  // Crescent arcs: bright centre glyph, thinning ends, bulging slightly outward.
  for (let k = 0; k < arcs; k++) {
    const mid = (k + 0.5) / arcs * tau + spin, width = 0.5 * tau / arcs;
    for (let j = 0; j < per; j++) {
      const u = per > 1 ? j / (per - 1) * 2 - 1 : 0, v = 1 - Math.abs(u);
      const a = mid + u * width / 2, r = front * (1 + 0.06 * v * (1 - p));
      plot(Math.sin(a) * r, Math.cos(a) * r, shade(0.25 + 0.75 * v * (1 - p * 0.6), ramp),
        bloom(clamp01(0.15 + p * 0.85 - v * 0.15)), fade * (0.45 + 0.5 * v));
    }
    // On the wide hit burst a dim echo dot trails between arcs so the ring
    // reads as continuous; the small trail sprouts skip it to stay lean.
    if (!wide) continue;
    const ea = mid + tau / arcs / 2, er = front * 0.84;
    plot(Math.sin(ea) * er, Math.cos(ea) * er, '.', mix(mint, leaf, p), fade * 0.4);
  }
  // Five sprouts spring outward with overshoot: stem dots and a bright bud.
  const grow = easeBack(p / 0.45) * R * 0.38, stems = wide ? 3 : 2;
  if (grow > 0.02) {
    for (let n = 0; n < 5; n++) {
      const a = n * tau / 5 - spin * 0.4, sway = Math.sin(t * 9 + n * 1.7) * 0.12;
      for (let j = 0; j <= stems; j++) {
        const u = j / stems, r = R * 0.06 + grow * u, aa = a + sway * u * u;
        plot(Math.sin(aa) * r, Math.cos(aa) * r, j === stems ? (p < 0.55 ? '*' : '+') : ':',
          j === stems ? mix(light, mint, p) : mix(mint, deep, u * 0.6), fade * (j === stems ? 0.95 : 0.6));
      }
    }
  }
  // Pollen motes lift off the front and drift with a gentle drag.
  const motes = wide ? 8 : 4;
  for (let i = 0; i < motes; i++) {
    const a = (i + hash(i + 300)) / motes * tau + spin + p * 0.4;
    const r = front * (0.55 + 0.35 * hash(i + 320)) + R * 0.12 * (1 - Math.exp(-p * 3));
    plot(Math.sin(a) * r, Math.cos(a) * r, p < 0.4 ? '*' : p < 0.75 ? '+' : '.', mix(pollen, mint, p),
      out * (0.65 + 0.3 * Math.sin(t * 17 + i * 2.3)));
  }
  plot(0, 0, p < 0.35 ? '@' : p < 0.7 ? '*' : '.', light, out * out);
}

// Sustained cerrith ring (aura/zone): a breathing circle with orbiting leaves.
function halo(effect, plot) {
  const p = effect.progress, t = effect.age;
  const R = effect.stage === 'zone' ? Math.min(6, Math.max(0.6, effect.radius || 1)) : 0.9;
  const env = smooth(0, 0.12, p) * (1 - smooth(0.7, 1, p));
  for (let j = 0; j < 40; j++) {
    const a = j / 40 * tau + t * 0.6, wave = 0.5 + 0.5 * Math.sin(5 * a - t * 3);
    plot(Math.sin(a) * R, Math.cos(a) * R, wave > 0.6 ? ':' : '.', mix(leaf, mint, wave), env * (0.2 + 0.5 * wave));
  }
  for (let n = 0; n < 5; n++) {
    const a = n * tau / 5 - t * 0.9, cx = Math.sin(a) * R * 0.72, cz = Math.cos(a) * R * 0.72;
    const dx = Math.sin(a) * 0.32, dz = Math.cos(a) * 0.32;
    for (let j = 0; j < 7; j++) {
      const u = j / 6 - 0.5, w = (j % 2 ? 1 : -1) * 0.09 * Math.cos(u * Math.PI);
      plot(cx + dx * u + dz * w, cz + dz * u - dx * w, j === 3 ? '*' : ':', j === 3 ? mint : leaf, env * 0.75);
    }
  }
  for (let i = 0; i < 10; i++) {
    const phi = (t * 0.5 + hash(i + 400)) % 1, a = hash(i + 420) * tau + phi * 2, r = R * (1 - phi * 0.85);
    plot(Math.sin(a) * r, Math.cos(a) * r, '.', pollen, env * Math.sin(Math.PI * phi) * 0.8);
  }
}

export default {
  id: 'healing-orb',
  duration: 0.9,
  draw(effect, plot) {
    if (effect.stage === 'projectile') return flight(effect, plot);
    if (effect.stage === 'cast') return cast(effect, plot);
    if (effect.stage === 'impact') return impact(effect, plot);
    if (effect.stage === 'pulse') return pulse(effect, plot);
    return halo(effect, plot);
  },
  sounds: {
    cast: [
      { kind: 'tone', type: 'sine', frequency: 330, endFrequency: 392, duration: 0.38, gain: 0.065, attack: 0.015, release: 0.28 },
      { kind: 'tone', type: 'sine', frequency: 523.25, delay: 0.12, duration: 0.25, gain: 0.055, attack: 0.008, release: 0.2 },
      { kind: 'tone', type: 'sine', frequency: 659.25, delay: 0.25, duration: 0.28, gain: 0.05, attack: 0.008, release: 0.23 },
      { kind: 'tone', type: 'sine', frequency: 783.99, delay: 0.38, duration: 0.35, gain: 0.045, attack: 0.01, release: 0.29 },
    ],
    impact: [
      { kind: 'tone', type: 'sine', frequency: 523.25, duration: 0.65, gain: 0.06, attack: 0.025, release: 0.5 },
      { kind: 'tone', type: 'sine', frequency: 659.25, delay: 0.035, duration: 0.6, gain: 0.04, attack: 0.04, release: 0.46 },
      { kind: 'noise', delay: 0.04, duration: 0.5, gain: 0.035, cutoff: 1800, filterType: 'bandpass', attack: 0.1, release: 0.35 },
      { kind: 'tone', type: 'sine', frequency: 1046.5, delay: 0.12, duration: 0.48, gain: 0.025, attack: 0.02, release: 0.4 },
    ],
    pulse: [
      { kind: 'tone', type: 'sine', frequency: 783.99, duration: 0.11, gain: 0.012, attack: 0.012, release: 0.085 },
    ],
  },
};
