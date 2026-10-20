// Blessing of Swiftness: a cerrith gust gathers at the feet, knots into a
// bright seed and snaps open into a pair of veined leaves that stride forward
// on a rush of wind. Everything is a pure function of the effect clock.

const TAU = Math.PI * 2;
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const span = (v, a, b) => clamp01((v - a) / (b - a));
const smooth = v => { v = clamp01(v); return v * v * (3 - 2 * v); };
const easeOut = v => 1 - (1 - clamp01(v)) ** 3;
const easeOutBack = v => { v = clamp01(v) - 1; return 1 + 2.4 * v * v * v + 1.4 * v * v; };
const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

// Colour ramps are built once; draw only indexes into them.
function ramp(stops, steps = 16) {
  const out = [];
  for (let i = 0; i < steps; i++) {
    const f = i / (steps - 1) * (stops.length - 1), k = Math.min(stops.length - 2, Math.floor(f)), t = f - k;
    out.push(stops[k].map((c, j) => Math.round(c + (stops[k + 1][j] - c) * t)));
  }
  return out;
}
const LEAF = ramp([[72, 170, 74], [128, 214, 84], [186, 245, 116], [244, 255, 196]]);
const WIND = ramp([[88, 186, 160], [148, 228, 196], [226, 255, 240]]);
const FLASH = ramp([[164, 233, 98], [241, 255, 181], [255, 255, 242]]);
const tone = (r, v) => r[Math.round(clamp01(v) * (r.length - 1))];
const MOTE = '.,:;+*';
const mote = v => MOTE[Math.min(MOTE.length - 1, Math.floor(clamp01(v) * MOTE.length))];

// Line glyphs follow the on-screen direction of a local vector, so leaf edges,
// gust arcs and speed lines read correctly at any heading. TILT halves depth.
// The basis is built per draw from effect.heading and passed down, so draw
// stays stateless even when calls interleave.
function view(heading) {
  const hc = Math.cos(heading), hs = Math.sin(heading);
  const screen = (dx, dz) => [dx * hc + dz * hs, (dz * hc - dx * hs) * 0.5];
  return {
    screen,
    line(dx, dz) {
      const [sx, sy] = screen(dx, dz), ax = Math.abs(sx), ay = Math.abs(sy);
      if (ay < ax * 0.47) return '-';
      if (ax < ay * 0.36) return '|';
      return (sx > 0) === (sy > 0) ? '\\' : '/';
    },
    arrow(dx, dz) {
      const [sx, sy] = screen(dx, dz);
      return Math.abs(sx) >= Math.abs(sy) ? (sx > 0 ? '>' : '<') : (sy > 0 ? 'v' : '^');
    },
  };
}

// Ovate leaf: broad near the stem, drawn to a point. Outline glyphs follow
// the edge tangent, a midrib runs to an arrow tip and sparse fill sits between.
const leafWidth = t => (t <= 0 || t >= 1 ? 0 : Math.sin(Math.PI * t) ** 0.7 * (1 - 0.35 * t));
function leaf(plot, v, bx, bz, angle, length, width, brightness, warmth) {
  if (brightness <= 0.003 || length <= 0.02) return;
  const ux = Math.sin(angle), uz = Math.cos(angle), nx = uz, nz = -ux;
  const [ax, ay] = v.screen(ux, uz), [nxs, nys] = v.screen(nx, nz);
  const cells = length * Math.max(Math.abs(ax) * 26, Math.abs(ay) * 13);
  const rows = Math.max(3, Math.min(9, Math.round(cells / 1.3)));
  const across = Math.max(Math.abs(nxs) * 26, Math.abs(nys) * 13);
  const rib = v.line(ux, uz), ribColor = tone(LEAF, 0.72 + warmth * 0.28);
  for (let k = 0; k <= rows; k++) {
    const t = k / rows, x = bx + ux * length * t, z = bz + uz * length * t;
    if (k === rows) { plot(x, z, v.arrow(ux, uz), tone(FLASH, 0.3 + warmth * 0.7), brightness); break; }
    plot(x, z, rib, ribColor, brightness * (0.95 - t * 0.3));
    if (k === 0) continue;
    const w = width * leafWidth(t), slope = width * (leafWidth(t + 0.02) - leafWidth(t - 0.02)) / 0.04;
    for (let side = -1; side <= 1; side += 2) {
      plot(x + nx * w * side, z + nz * w * side, v.line(ux * length + nx * slope * side, uz * length + nz * slope * side),
        tone(LEAF, 0.45 + warmth * 0.4 - t * 0.15), brightness);
      if (w * across > 3.4) plot(x + nx * w * 0.52 * side, z + nz * w * 0.52 * side, t < 0.55 ? ':' : '.',
        tone(LEAF, 0.2 + warmth * 0.3), brightness * 0.45);
    }
  }
}

// Speed line: bright head, thinning tail running back along -dir.
function streak(plot, v, x, z, dx, dz, length, brightness, steps = 4) {
  if (brightness <= 0.003) return;
  const glyph = v.line(dx, dz), flat = glyph === '-';
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    plot(x - dx * length * t, z - dz * length * t, i === 0 && flat ? '=' : glyph,
      tone(WIND, 0.95 - t * 0.7), brightness * (1 - t * 0.75));
  }
}

// Open gust arcs: two counter-placed ribbons swept around the feet.
function gust(plot, v, radius, spin, sweep, brightness, points, depth = 0) {
  if (brightness <= 0.003) return;
  for (let ribbon = 0; ribbon < 2; ribbon++) {
    for (let i = 0; i < points; i++) {
      const t = i / (points - 1), a = spin + ribbon * Math.PI + t * sweep;
      const r = radius * (0.86 + t * 0.14), x = Math.cos(a) * r, z = Math.sin(a) * r + depth;
      const tx = -Math.sin(a), tz = Math.cos(a);
      plot(x, z, i === points - 1 ? v.arrow(tx, tz) : t > 0.55 ? v.line(tx, tz) : '~',
        tone(WIND, 0.25 + t * 0.75), brightness * (0.2 + t * 0.8));
    }
  }
}

// Cast and impact share one choreography: gather -> seed flash -> unfurl and
// stride forward -> drift and thin out. `gatherEnd` sets the anticipation.
function stride(effect, plot, v, gatherEnd, power) {
  const p = effect.progress, life = effect.life, R = Math.min(1.4, Math.max(0.6, effect.radius));
  const fadeOut = 1 - smooth(span(p, 0.68, 1));

  // 1. Anticipation: four wind arms spiral in to the feet and pour into the seed.
  for (let arm = 0; arm < 4; arm++) {
    const a0 = arm / 4 * TAU + 0.5, r0 = R * (1.35 + 0.25 * hash(arm + 3));
    for (let i = 0; i < 9; i++) {
      const q = span(p, i * 0.035 * gatherEnd / 0.36, gatherEnd), s = q - 0.05;
      if (q <= 0 || q >= 1) continue;
      const a = a0 + q * 2.6, r = r0 * (1 - q) ** 1.4 + 0.05;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const pa = a0 + s * 2.6, pr = r0 * (1 - Math.max(0, s)) ** 1.4 + 0.05;
      const b = Math.min(1, smooth(q * 5) * (1 - smooth(span(q, 0.8, 1))) * (1 - i * 0.07) * power);
      plot(x, z, i === 0 ? '*' : v.line(x - Math.cos(pa) * pr, z - Math.sin(pa) * pr), tone(WIND, 0.35 + q * 0.6 - i * 0.03), b);
    }
  }

  // 2. The seed: a white-green knot flashes where the gust closes.
  const knot = smooth(span(p, gatherEnd - 0.1, gatherEnd)) * (1 - smooth(span(p, gatherEnd, gatherEnd + 0.22)));
  if (knot > 0.003) {
    plot(0, 0, knot > 0.6 ? '@' : '*', tone(FLASH, 0.5 + 0.5 * knot), knot);
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * TAU + p * 3, r = 0.07 + 0.08 * knot;
      plot(Math.cos(a) * r, Math.sin(a) * r, '*', tone(FLASH, knot * 0.85), knot * 0.85);
    }
    for (let i = 0; i < 8; i++) {
      const a = (i + 0.5) / 8 * TAU - p * 2, r = 0.16 + 0.14 * knot;
      plot(Math.cos(a) * r, Math.sin(a) * r, v.line(Math.cos(a), Math.sin(a)), tone(LEAF, 0.6 + knot * 0.4), knot * 0.6);
    }
  }

  // 3. Unfurl: two leaves snap open from the seed, swept back like a winged
  //    heel into an arrowhead, and stride ahead as they cool to leaf green.
  const u = span(p, gatherEnd - 0.03, gatherEnd + 0.4), open = easeOutBack(u), glide = easeOut(u);
  const leafLight = smooth(u * 4) * fadeOut;
  if (leafLight > 0.003) {
    const length = (0.38 + 0.72 * open) * power, drift = 0.3 * glide + 0.32 * smooth(span(p, 0.55, 1));
    for (let side = -1; side <= 1; side += 2) {
      leaf(plot, v, side * 0.03 * glide, 0.05 + drift, side * (Math.PI - 0.14 - 0.5 * open), length,
        length * 0.36, leafLight, 1 - u * 0.75);
    }
  }

  // 4. Rush of passage: speed lines race forward past the stride.
  for (let i = 0; i < 9; i++) {
    const delay = hash(i + 20) * 0.12, q = span(p, gatherEnd + delay - 0.02, gatherEnd + delay + 0.42);
    if (q <= 0 || q >= 1) continue;
    const lane = (i / 8 - 0.5) * 1.7 * R + (hash(i + 30) - 0.5) * 0.18;
    const head = -0.35 + (0.85 + hash(i + 50) * 0.5) * easeOut(q) * R;
    streak(plot, v, lane, head - Math.abs(lane) * 0.35, 0, 1, (0.18 + 0.5 * (1 - q)) * R,
      smooth(q * 6) * (1 - smooth(span(q, 0.55, 1))) * 0.85 * fadeOut);
  }

  // 5. Follow-through: petals flicked forward from the seed, slowed by drag.
  const flight = Math.max(0, (p - gatherEnd) * life);
  if (flight > 0) {
    const drag = 1 - Math.exp(-3.2 * flight);
    for (let i = 0; i < 14; i++) {
      const a = (hash(i + 60) - 0.5) * 2.7, speed = (1.4 + hash(i + 70) * 1.5) * R / 3.2;
      const flutter = Math.sin(effect.age * 7 + i * 1.9);
      const x = Math.sin(a) * speed * drag + flutter * 0.05 * drag, z = Math.cos(a) * speed * drag - 0.1 * flight * flight;
      const b = smooth(flight * 12) * (0.5 + 0.5 * hash(i + 90)) * fadeOut;
      plot(x, z, b > 0.6 ? '*' : flutter > 0 ? "'" : ',', tone(LEAF, 0.35 + b * 0.6), b);
    }
  }

  // 6. A gust ring rolls outward from the flash and thins away.
  const w = span(p, gatherEnd - 0.02, gatherEnd + 0.5);
  if (w > 0 && w < 1) {
    gust(plot, v, R * (0.3 + 1.25 * easeOut(w)), effect.age * 5, 1.9, (1 - w) ** 1.4 * 0.85 * power * fadeOut, 12);
  }
}

// Aura: the quickening winds around the blessed feet, tightening while a
// small leaf pair flicks open and chevrons skip ahead.
function quicken(effect, plot, v) {
  const p = effect.progress, R = Math.min(1.4, Math.max(0.6, effect.radius));
  const env = smooth(p / 0.14) * (1 - smooth(span(p, 0.5, 1)));
  if (env <= 0) return;
  for (let ribbon = 0; ribbon < 2; ribbon++) {
    for (let i = 0; i < 14; i++) {
      const t = i / 13, s = p * 1.1 - (1 - t) * 0.3;
      if (s < 0) continue;
      const a = ribbon * Math.PI + s * TAU * 1.05 + 0.6, r = R * (1.1 - 0.55 * easeOut(s));
      const tx = -Math.sin(a), tz = Math.cos(a);
      plot(Math.cos(a) * r, Math.sin(a) * r, i === 13 ? v.arrow(tx, tz) : t > 0.4 ? v.line(tx, tz) : '~',
        tone(WIND, 0.25 + t * 0.75), env * (0.15 + 0.85 * t ** 1.2));
    }
  }
  const open = easeOutBack(span(p, 0, 0.55));
  for (let side = -1; side <= 1; side += 2) {
    leaf(plot, v, side * 0.04, -0.12 + 0.12 * open, side * (0.15 + 0.38 * open), (0.25 + 0.27 * open) * R,
      0.17 * R * (0.6 + 0.4 * open), env, 1 - p);
  }
  for (let j = 0; j < 3; j++) {
    const q = span(p, 0.08 + j * 0.13, 0.62 + j * 0.13);
    const b = Math.sin(Math.PI * q) * env * (1 - j * 0.2);
    if (b <= 0.003) continue;
    const z = (0.55 + 0.75 * easeOut(q)) * R;
    plot(0, z, v.arrow(0, 1), tone(FLASH, 0.6), b);
    for (let k = 1; k <= 3; k++) {
      for (let side = -1; side <= 1; side += 2) {
        const dx = side * 0.075 * k, dz = -0.16 * k;
        plot(dx, z + dz, v.line(-dx, -dz), tone(WIND, 0.85 - k * 0.15), b * (1 - k * 0.2));
      }
    }
  }
  for (let i = 0; i < 12; i++) {
    const a = hash(i + 5) * TAU + p * 2.2, r = R * (0.35 + 0.6 * hash(i + 15)) * (1 - 0.3 * p);
    const b = env * Math.sin(Math.PI * span(p, hash(i + 25) * 0.3, 1)) * 0.7;
    plot(Math.cos(a) * r, Math.sin(a) * r, mote(b), tone(LEAF, 0.4 + b * 0.5), b);
  }
}

// Pulse: the speed tick, a quick starburst of wind lines and flicked leaflets.
function burst(effect, plot, v) {
  const p = effect.progress, R = Math.min(1.4, Math.max(0.6, effect.radius));
  const env = 1 - smooth(span(p, 0.35, 1)), reach = easeOut(p);
  const flash = 1 - smooth(span(p, 0, 0.35));
  if (flash > 0.003) {
    plot(0, 0, '*', tone(FLASH, flash), flash);
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * TAU + 0.4;
      plot(Math.cos(a) * 0.1, Math.sin(a) * 0.1, '+', tone(FLASH, flash * 0.8), flash * 0.75);
    }
  }
  for (let i = 0; i < 12; i++) {
    const a = (i + hash(i) * 0.5) / 12 * TAU, dx = Math.cos(a), dz = Math.sin(a);
    const r = (0.18 + (0.75 + hash(i + 3) * 0.35) * reach) * R;
    streak(plot, v, dx * r, dz * r, dx, dz, (0.32 * (1 - p) + 0.08) * R, env * (0.6 + 0.4 * hash(i + 9)));
  }
  for (let i = 0; i < 8; i++) {
    const a = (i + 0.5) / 8 * TAU + 0.2, r = (0.12 + 0.6 * reach) * R;
    const b = env * 0.7 * smooth(p * 8);
    plot(Math.cos(a) * r, Math.sin(a) * r + 0.04 * Math.sin(effect.age * 20 + i), b > 0.5 ? '*' : "'", tone(LEAF, 0.5 + b * 0.4), b);
  }
}

// Zone: a lingering swift-wind grove: open gust ribbons circle while four
// leaves ride the current and loose petals drift through it.
function grove(effect, plot, v) {
  const p = effect.progress, age = effect.age, R = Math.min(2.2, Math.max(0.6, effect.radius));
  const env = smooth(p / 0.12) * (1 - smooth(span(p, 0.72, 1)));
  if (env <= 0) return;
  gust(plot, v, R * (0.95 + 0.05 * Math.sin(age * 2.3)), age * 2.4, 2.3, env * 0.8, 17);
  for (let j = 0; j < 4; j++) {
    const a = age * 1.7 + j / 4 * TAU, r = R * 0.62;
    const x = Math.cos(a) * r, z = Math.sin(a) * r, heading = Math.atan2(-Math.sin(a), Math.cos(a));
    leaf(plot, v, x, z, heading + Math.sin(age * 4 + j) * 0.25, 0.46, 0.16, env * 0.9, 0.35 + 0.3 * Math.sin(age * 3 + j));
  }
  for (let i = 0; i < 18; i++) {
    const phase = (age * (0.35 + hash(i) * 0.3) + hash(i + 11)) % 1;
    const a = hash(i + 22) * TAU + phase * 2.6, r = R * (0.2 + 0.85 * phase);
    const b = env * Math.sin(Math.PI * phase) * 0.75;
    plot(Math.cos(a) * r, Math.sin(a) * r, mote(b), tone(LEAF, 0.3 + b * 0.6), b);
  }
}

// Projectile: a compact leaf pair skims forward on two sinuous wind trails,
// shedding petals that peel away behind it.
function dart(effect, plot, v) {
  const p = effect.progress, age = effect.age;
  const env = 1 - smooth(span(p, 0.84, 1));
  if (env <= 0) return;
  const sway = Math.sin(age * 10) * 0.06;
  for (let side = -1; side <= 1; side += 2) {
    leaf(plot, v, side * 0.03, 0.22, side * (Math.PI - 0.32 - sway), 0.52, 0.18, env, 0.55);
    for (let i = 0; i < 10; i++) {
      const t = i / 9, z = -0.3 - i * 0.1;
      const x = side * (0.18 + 0.1 * t) + Math.sin(age * 14 - i * 0.85 + side) * 0.06 * t;
      const nx = side * 0.1 / 9 + Math.cos(age * 14 - i * 0.85 + side) * -0.85 * 0.06 * t;
      plot(x, z, i < 2 ? '~' : v.line(nx, -0.1), tone(WIND, 0.95 - t * 0.7), env * (0.85 - t * 0.7));
    }
  }
  for (let i = 0; i < 10; i++) {
    const phase = (age * 1.8 + hash(i + 3)) % 1, side = i % 2 ? 1 : -1;
    const x = side * (0.12 + 0.4 * phase) + Math.sin(age * 6 + i) * 0.05, z = -0.32 - phase * 0.8;
    const b = env * Math.sin(Math.PI * phase) * 0.75;
    plot(x, z, b > 0.55 ? '*' : Math.sin(age * 9 + i) > 0 ? "'" : ',', tone(LEAF, 0.35 + b * 0.5), b);
  }
}

export default {
  id: 'blessing-of-swiftness',
  duration: 0.9,
  draw(effect, plot) {
    const heading = Number.isFinite(effect.heading) ? effect.heading : 0;
    const v = view(heading);
    switch (effect.stage) {
      case 'projectile': dart(effect, plot, v); break;
      case 'impact': stride(effect, plot, v, 0.16, 1.1); break;
      case 'aura': quicken(effect, plot, v); break;
      case 'pulse': burst(effect, plot, v); break;
      case 'zone': grove(effect, plot, v); break;
      default: stride(effect, plot, v, 0.36, 1);
    }
  },
  sounds: {
    cast: [
      { kind: 'tone', type: 'triangle', frequency: 392, endFrequency: 365, duration: 0.09, gain: 0.075, attack: 0.002, release: 0.075, cutoff: 1500 },
      { kind: 'tone', type: 'triangle', frequency: 494, endFrequency: 465, delay: 0.055, duration: 0.085, gain: 0.067, attack: 0.002, release: 0.07, cutoff: 1700 },
      { kind: 'tone', type: 'triangle', frequency: 659, endFrequency: 625, delay: 0.105, duration: 0.09, gain: 0.06, attack: 0.002, release: 0.075, cutoff: 1900 },
      { kind: 'noise', delay: 0.035, duration: 0.24, gain: 0.035, attack: 0.055, release: 0.17, cutoff: 2400, filterType: 'bandpass' },
      { kind: 'tone', type: 'sine', frequency: 1318, endFrequency: 1568, delay: 0.175, duration: 0.16, gain: 0.035, attack: 0.003, release: 0.145 },
    ],
    impact: [
      { kind: 'noise', duration: 0.18, gain: 0.04, attack: 0.012, release: 0.15, cutoff: 3100, filterType: 'bandpass' },
      { kind: 'tone', type: 'triangle', frequency: 784, endFrequency: 740, duration: 0.085, gain: 0.055, attack: 0.002, release: 0.07, cutoff: 2200 },
      { kind: 'tone', type: 'sine', frequency: 1568, endFrequency: 1760, delay: 0.07, duration: 0.17, gain: 0.035, attack: 0.003, release: 0.15 },
    ],
    pulse: [
      { kind: 'noise', duration: 0.08, gain: 0.014, attack: 0.012, release: 0.06, cutoff: 2600, filterType: 'bandpass' },
    ],
  },
};
