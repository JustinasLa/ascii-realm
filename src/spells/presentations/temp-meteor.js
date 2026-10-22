const TAU = Math.PI * 2;
const GOLDEN = 2.39996323;
// Screen cells per metre: columns across, foreshortened rows along the ground,
// and rows per metre of height (the projectile adapter lifts by h * 5 rows).
const CW = 26, RH = 6.5, LIFT = 5;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const sat = value => clamp(value, 0, 1);
const smooth = t => { const x = sat(t); return x * x * (3 - 2 * x); };
const easeOut = t => 1 - (1 - sat(t)) ** 3;
const easeIn = t => sat(t) ** 3;
const bell = (t, at, width) => Math.exp(-(((t - at) / width) ** 2));
const hash = n => { const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); };

function gradient(stops, size) {
  const table = [];
  for (let i = 0; i < size; i++) {
    const t = i / (size - 1);
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
    const [t0, a] = stops[k], [t1, b] = stops[k + 1], f = (t - t0) / (t1 - t0);
    table.push(a.map((channel, c) => Math.round(channel + (b[c] - channel) * f)));
  }
  return table;
}
// Fire cools from white-hot through gold and orange to dull red.
const HEAT = gradient([[0, [86, 22, 14]], [0.25, [196, 54, 20]], [0.5, [255, 124, 32]],
  [0.75, [255, 206, 110]], [1, [255, 248, 230]]], 25);
// Meteoric stone, from cold basalt to rock glowing from within.
const ROCK = gradient([[0, [74, 56, 48]], [0.5, [150, 104, 78]], [1, [255, 150, 64]]], 13);
const WHITE = HEAT[HEAT.length - 1];
const ASH = [108, 92, 84];
const pick = (table, t) => table[Math.round(sat(t) * (table.length - 1))];
const FIRE = '.,:-=+*#%@';
const glyph = t => FIRE[Math.round(sat(t) * (FIRE.length - 1))];

// Stroke character for a direction given in cells (a row is twice as tall as a column is wide).
function stroke(dx, dy) {
  const angle = ((Math.atan2(2 * dy, dx) % Math.PI) + Math.PI) % Math.PI;
  if (angle < 0.39 || angle > 2.75) return '-';
  if (angle < 1.18) return '\\';
  return angle < 1.96 ? '|' : '/';
}

// Ground circles are four times wider than tall in cells, so sampling them by
// angle bunches glyphs at the sides and leaves gaps along the front and back.
// This table maps an arc-length fraction to the ellipse angle so rings are
// evenly spaced on screen.
const ARC = (() => {
  const steps = 256, lengths = [0], table = new Float64Array(65);
  for (let i = 1; i <= steps; i++) {
    const a = (i - 0.5) / steps * TAU;
    lengths.push(lengths[i - 1] + Math.hypot(4 * Math.sin(a), Math.cos(a)));
  }
  for (let j = 0, k = 0; j <= 64; j++) {
    const target = j / 64 * lengths[steps];
    while (k < steps - 1 && lengths[k + 1] < target) k++;
    table[j] = (k + sat((target - lengths[k]) / (lengths[k + 1] - lengths[k]))) / steps * TAU;
  }
  return table;
})();
const arc = f => {
  const x = (((f % 1) + 1) % 1) * 64, i = Math.min(63, Math.floor(x));
  return ARC[i] + (ARC[i + 1] - ARC[i]) * (x - i);
};

// Art is authored in screen cells (x right, y down). Undo the adapter's heading
// rotation so silhouettes, rising flames and falling debris stay upright.
function painter(effect, plot) {
  const heading = Number.isFinite(effect.heading) ? effect.heading : 0;
  const c = Math.cos(heading), s = Math.sin(heading);
  return (cx, cy, char, color, brightness) => {
    if (!(brightness > 0.01)) return;
    const wx = cx / CW, wz = cy / RH;
    plot(wx * c - wz * s, wx * s + wz * c, char, color, Math.min(1, brightness));
  };
}

// Cast (authored over 1.25 s): a fire sigil is traced at the caster's feet and
// feeds a column of embers into a burning vortex six metres overhead. The vortex
// tightens until the meteor tears free at 0.5 s (where the real projectile
// spawns), then unwinds into smoke while a target ring locks onto the landing
// site 7.5 m ahead, vanishing as the rock arrives at ~1.04 s.
function cast(P, T, forwardX, forwardY, end) {
  const release = bell(T, 0.5, 0.05);
  const traced = easeOut(T / 0.3);
  const sigil = (T < 0.5 ? 0.45 + 0.55 * smooth(T / 0.5) : 1 - smooth((T - 0.5) / 0.72)) * end;
  const spin = T * 0.9;
  for (let i = 0; i < 48 && sigil > 0; i++) {
    const f = i / 48;
    if (f > traced) break;
    const a = arc(f + 0.75 + spin / TAU); // traced clockwise from the top
    const head = traced < 1 ? sat(1 - (traced - f) * 5) : 0;
    const flicker = 0.82 + 0.18 * Math.sin(T * 21 + i * 2.3);
    P(Math.cos(a) * 0.85 * CW, Math.sin(a) * 0.85 * RH,
      head > 0.6 ? '*' : stroke(-Math.sin(a) * CW, Math.cos(a) * RH),
      pick(HEAT, 0.3 + 0.3 * sigil + 0.4 * head + 0.3 * release),
      sigil * (0.6 + 0.35 * head) * flicker + 0.35 * release * end);
  }
  // A counter-rotating fire rune (an upward triangle) is inscribed after the ring.
  const rune = easeOut((T - 0.12) / 0.25);
  for (let edge = 0; edge < 3 && rune > 0 && sigil > 0; edge++) {
    const a0 = -Math.PI / 2 + edge * TAU / 3 - spin * 1.5, a1 = a0 + TAU / 3;
    const x0 = Math.cos(a0) * 0.62 * CW, y0 = Math.sin(a0) * 0.62 * RH;
    const x1 = Math.cos(a1) * 0.62 * CW, y1 = Math.sin(a1) * 0.62 * RH;
    const char = stroke(x1 - x0, y1 - y0);
    for (let j = 0; j < 7; j++) {
      if ((edge * 7 + j) / 21 > rune) break;
      const f = (j + 0.5) / 7;
      P(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, char, pick(HEAT, 0.45 + 0.15 * sigil + 0.4 * release),
        sigil * (0.55 + 0.1 * Math.sin(T * 17 + j)) + 0.3 * release * end);
    }
  }
  // Heat embers lift off the sigil for its whole life, cooling as they rise.
  for (let i = 0; i < 12 && sigil > 0; i++) {
    const u = (hash(i) + T * 1.3) % 1, a = hash(i + 7) * TAU;
    P(Math.cos(a) * 0.85 * CW + Math.sin(u * 5 + i) * 2, Math.sin(a) * 0.85 * RH - u * 1.8 * LIFT,
      u < 0.35 ? '*' : u < 0.7 ? "'" : '.', pick(HEAT, 0.85 - 0.7 * u), sigil * smooth(u * 6) * (1 - u));
  }

  const RY = -6 * LIFT; // the projectile spawns six metres above the caster
  // Summoning column: motes accelerate upward and converge into the vortex.
  const column = smooth(T / 0.15) * (1 - smooth((T - 0.42) / 0.1));
  for (let i = 0; i < 14 && column > 0; i++) {
    const u = (hash(i + 20) + T * 2.4) % 1;
    const h = 1 + 5 * u ** 1.3;
    P(Math.sin(u * 7 + i * 1.9) * (1 - u) * 6, -h * LIFT, u > 0.6 ? '|' : u > 0.3 ? ':' : "'",
      pick(HEAT, 0.45 + 0.5 * u), column * smooth(u * 8) * (0.45 + 0.55 * u));
  }

  const charge = sat(T / 0.5);
  if (T < 0.5) {
    // Three fiery arms spiral ever faster into a brightening heart.
    const env = smooth(T / 0.12);
    const reach = 1.25 - 0.7 * easeIn(charge), turn = T * 7 + charge * charge * 6;
    for (let arm = 0; arm < 3; arm++) {
      for (let k = 0; k < 11; k++) {
        const f = k / 10, a = arm * TAU / 3 + f * 2.6 + turn, r = reach * (0.18 + 0.82 * f);
        const x = Math.cos(a) * r * CW * 0.9, y = RY + Math.sin(a) * r * RH * 1.1;
        const a2 = a + 0.26, r2 = reach * (0.18 + 0.82 * (f + 0.1));
        const char = f < 0.3 ? '#' : f < 0.55 ? '*'
          : stroke(Math.cos(a2) * r2 * CW * 0.9 - x, RY + Math.sin(a2) * r2 * RH * 1.1 - y);
        P(x, y, char, pick(HEAT, 0.3 + 0.5 * (1 - f) + 0.25 * charge),
          env * (0.35 + 0.5 * charge) * (1 - 0.45 * f) * (0.85 + 0.15 * Math.sin(T * 25 + k)));
      }
    }
    const heart = 1.5 + 3 * charge;
    for (let i = 0; i < 9; i++) {
      const r = Math.sqrt((i + 0.5) / 9) * heart, a = i * GOLDEN + T * 5;
      P(Math.cos(a) * r, RY + Math.sin(a) * r / 2, i < 2 ? '@' : i < 5 ? '#' : '*',
        pick(HEAT, 0.6 + 0.4 * charge - r / heart * 0.2), env * (0.4 + 0.6 * charge));
    }
  } else {
    // Released: the arms fling outward and cool to smoke; a shock ring rolls out.
    const open = easeOut((T - 0.5) / 0.5), env = (1 - smooth((T - 0.5) / 0.5)) * end;
    const turn = 9.5 + (T - 0.5) * 3;
    for (let arm = 0; arm < 3 && env > 0; arm++) {
      for (let k = 0; k < 11; k++) {
        const f = k / 10, a = arm * TAU / 3 + f * 2.6 + turn, r = (0.45 + 0.85 * open) * (0.18 + 0.82 * f);
        const cool = (1 - f * 0.5) * (1 - open);
        P(Math.cos(a) * r * CW * 0.9, RY + Math.sin(a) * r * RH * 1.1 - open * 4,
          open > 0.45 ? '~' : glyph(0.3 + 0.5 * cool), cool < 0.12 ? ASH : pick(HEAT, 0.15 + cool),
          env * (0.7 - 0.3 * f));
      }
    }
    for (let i = 0; i < 5 && release > 0.05; i++) {
      const a = i * GOLDEN;
      P(Math.cos(a) * i * 1.4, RY + Math.sin(a) * i * 0.7, i ? '#' : '@', WHITE, release * end);
    }
    const shock = easeOut((T - 0.5) / 0.28);
    for (let i = 0; i < 28 && shock < 1; i++) {
      const a = i / 28 * TAU, r = 0.3 + 2.2 * shock;
      P(Math.cos(a) * r * CW * 0.9, RY + Math.sin(a) * r * RH * 1.1,
        stroke(-Math.sin(a) * CW * 0.9, Math.cos(a) * RH * 1.1), pick(HEAT, 0.95 - 0.7 * shock),
        (1 - shock) ** 1.5 * end);
    }
  }

  // Target ring at the landing site tightens and quickens as the meteor nears.
  const lock = sat((T - 0.42) / 0.62);
  const mark = smooth((T - 0.42) / 0.2) * (1 - smooth((T - 0.98) / 0.12)) * end;
  if (mark > 0) {
    const lx = forwardX * 7.5 * CW, ly = forwardY * 7.5 * RH;
    const r = 1.5 - 0.55 * easeOut(lock), beat = 0.72 + 0.28 * Math.sin(T * (14 + 26 * lock));
    for (let i = 0; i < 36; i++) {
      const a = arc(i / 36 + T * 0.24);
      P(lx + Math.cos(a) * r * CW, ly + Math.sin(a) * r * RH,
        i % 9 === 0 ? '+' : stroke(-Math.sin(a) * CW, Math.cos(a) * RH),
        pick(HEAT, 0.2 + 0.45 * lock), mark * (0.3 + 0.5 * lock) * beat * (i % 2 ? 0.7 : 1));
    }
    for (let i = 0; i < 5; i++) {
      const a = i * GOLDEN, s = Math.sqrt(i / 5) * 0.28 * (1 - 0.4 * lock);
      P(lx + Math.cos(a) * s * CW, ly + Math.sin(a) * s * RH, i ? '.' : 'x',
        pick(HEAT, 0.25 + 0.4 * lock), mark * (0.25 + 0.55 * lock) * beat);
    }
  }
}

// Projectile: a tumbling faceted rock whose leading face burns white, wrapped
// in a tapering fire tail that streams back along the steep fall, shedding sparks.
function meteor(P, age, fade, heading) {
  const grow = easeOut(age / 0.12);
  // Motion in "visual" units (one column wide, rows count double): 14 m/s
  // forward along the heading while falling 11.2 m/s of height.
  const vx = Math.sin(heading) * 14 * CW, vy = (Math.cos(heading) * 14 * RH + 11.2 * LIFT) * 2;
  const vl = Math.hypot(vx, vy) || 1, mx = vx / vl, my = vy / vl, px = -my, py = mx;
  const R = 5.5 * (0.6 + 0.4 * grow), L = 46 * grow, spin = age * 8;
  const V = (x, y, char, color, brightness) => P(x, y / 2, char, color, brightness);

  for (let i = 0; i < 34; i++) {
    const u = (hash(i) + age * (2.6 + hash(i + 40) * 1.6)) % 1;
    const side = hash(i + 80) * 2 - 1;
    const width = R * (1 - 0.55 * u) + 3 * u;
    const lat = side * width + Math.sin(u * 9 - age * 22 + i) * 2.2 * u, along = R * 0.5 + u ** 1.35 * L;
    const heat = (1 - u) ** 1.3 * (1 - 0.45 * Math.abs(side));
    V(-mx * along + px * lat, -my * along + py * lat, heat < 0.06 ? '~' : glyph(heat),
      heat < 0.06 ? ASH : pick(HEAT, 0.15 + 0.85 * heat), fade * grow * smooth(u * 12) * (0.3 + 0.7 * (1 - u)));
  }
  for (let k = 0; k < 9; k++) {
    const s = (k + 0.6) / 9 * 0.55, wobble = Math.sin(s * 11 - age * 26) * 1.2 * s * L / 46;
    const along = R * 0.6 + s * L, heat = (1 - s) ** 1.1;
    V(-mx * along + px * wobble, -my * along + py * wobble, glyph(heat * 0.92),
      pick(HEAT, 0.3 + 0.7 * heat), fade * (0.55 + 0.45 * heat));
  }
  for (let i = 0; i < 10; i++) {
    const u = (hash(i + 200) + age * (1.5 + hash(i + 210))) % 1, side = hash(i + 220) * 2 - 1;
    const along = R + u * L * 1.1, lat = side * (R * 0.6 + u * 14);
    V(-mx * along + px * lat, -my * along + py * lat + u * u * 10, u < 0.3 ? '*' : u < 0.65 ? "'" : '.',
      pick(HEAT, 0.95 - 0.75 * u), fade * smooth(u * 10) * (1 - u) * 0.9 * grow);
  }
  // Body: irregular tumbling outline, white-hot leading rim, dark trailing
  // stone with molten cracks and a glowing heart.
  for (let row = -3; row <= 3; row++) {
    for (let col = -7; col <= 7; col++) {
      const x = col, y = row * 2, d0 = Math.hypot(x, y), th = Math.atan2(y, x);
      const edge = R * (1 + 0.13 * Math.sin(3 * th + spin) + 0.07 * Math.sin(5 * th - spin * 0.7));
      if (d0 > edge) continue;
      const d = d0 / edge, lead = d0 ? (x * mx + y * my) / d0 : 0;
      if (d > 0.7) {
        const hot = lead > 0.15;
        P(col, row, hot ? (lead > 0.6 ? '@' : '%') : stroke(-y, x / 2),
          hot ? pick(HEAT, 0.75 + 0.25 * lead) : pick(ROCK, 0.3 + 0.3 * (lead + 1)), fade * (hot ? 0.95 : 0.75));
      } else if (d < 0.3) {
        P(col, row, '@', pick(HEAT, 0.82), fade);
      } else if (Math.sin(th * 4 + spin + d * 5) > 0.82) {
        P(col, row, '*', pick(HEAT, 0.65), fade * 0.9);
      } else {
        P(col, row, lead > 0.3 ? '%' : '#', pick(ROCK, 0.3 + 0.35 * (lead + 1)), fade * 0.85);
      }
    }
  }
  // Bow shock: a flickering plasma arc just ahead of the rock.
  const bow = Math.atan2(my, mx);
  for (let j = 0; j < 5; j++) {
    const a = bow + (j - 2) * 0.42, r = R * 1.35;
    V(Math.cos(a) * r, Math.sin(a) * r, stroke(-Math.sin(a), Math.cos(a) / 2), j === 2 ? WHITE : pick(HEAT, 0.85),
      fade * grow * (0.55 + 0.3 * Math.sin(age * 40 + j * 1.7)));
  }
}

// Impact on a struck foe: white starburst, flames climbing the target, embers
// tossed on ballistic arcs and a scorch ring that cools away.
function impact(P, t, fade, scale) {
  const flash = 1 - smooth(t / 0.16);
  for (let ray = 0; ray < 8 && flash > 0; ray++) {
    const a = ray / 8 * TAU + 0.2, len = (6 + 10 * easeOut(t / 0.16)) * scale;
    const char = stroke(Math.cos(a), Math.sin(a) / 2);
    for (let j = 1; j <= 4; j++) {
      const r = len * j / 4;
      P(Math.cos(a) * r, Math.sin(a) * r / 2 - 4, char, j === 1 ? WHITE : pick(HEAT, 1 - j * 0.15),
        flash * (1.1 - j * 0.2) * fade);
    }
  }
  if (flash > 0) P(0, -4, '@', WHITE, flash * fade);
  const engulf = smooth(t / 0.15) * (1 - smooth((t - 0.4) / 0.6));
  for (let k = 0; k < 10 && engulf > 0; k++) {
    const a = k / 10 * TAU + 0.3, bx = Math.cos(a) * 0.42 * CW * scale, by = Math.sin(a) * 0.42 * RH * scale;
    const height = (1 + 0.6 * hash(k + 30)) * engulf * (0.8 + 0.2 * Math.sin(t * 30 + k * 2)) * scale;
    const front = Math.sin(a) > 0 ? 1 : 0.7;
    for (let j = 0; j < 4; j++) {
      const h = height * (j + 0.5) / 4;
      P(bx + Math.sin(t * 18 + k + j) * 1.2 * j / 3, by - h * LIFT, j === 3 ? "'" : j === 2 ? '^' : j ? '*' : '#',
        pick(HEAT, (0.95 - j * 0.2) * (1 - 0.4 * t)), engulf * front * (1 - j * 0.15) * fade);
    }
  }
  for (let i = 0; i < 18; i++) {
    const a = hash(i + 60) * TAU, d = (0.8 + 1.2 * hash(i + 61)) * easeOut(t) * 0.9 * scale;
    const h = Math.max(0, (1.5 + 2 * hash(i + 62)) * t * 0.9 - 2.8 * t * t);
    P(Math.cos(a) * d * CW, Math.sin(a) * d * RH - h * LIFT, t < 0.35 ? '*' : t < 0.7 ? "'" : '.',
      pick(HEAT, 1 - t * 0.9), (1 - t) * fade * (0.6 + 0.4 * hash(i + 63)));
  }
  const scorch = smooth(t / 0.1) * (1 - t) ** 1.2;
  for (let i = 0; i < 30; i++) {
    const a = arc(i / 30), r = (0.55 + 0.35 * easeOut(t)) * scale * (1 + 0.08 * (hash(i + 90) - 0.5));
    P(Math.cos(a) * r * CW, Math.sin(a) * r * RH, i % 3 ? '~' : '.', pick(HEAT, 0.45 * (1 - t) + 0.1),
      scorch * 0.65 * fade);
  }
}

// Small pulses (the landing bursts and the burn field's flare-ups): a rolling
// fireball that swells and lifts, licks flame at its crown and spits sparks.
function flare(P, t, fade, scale) {
  const rise = easeOut(t) * 0.8 * LIFT * scale, Rv = (4 + 6 * easeOut(t)) * scale;
  const life = (1 - t) ** 1.2 * fade, flash = 1 - smooth(t / 0.2);
  for (let i = 0; i < 30; i++) {
    const rad = Math.sqrt((i + 0.5) / 30), a = i * GOLDEN + t * 2;
    const x = Math.cos(a) * rad * Rv + Math.sin(i * 3.1 + t * 20) * 0.8;
    const heat = sat((1 - rad * 0.7) * (1 - t) ** 0.8 + 0.3 * flash);
    P(x, Math.sin(a) * rad * Rv / 2 - rise, glyph(heat), pick(HEAT, heat), life * (0.5 + 0.5 * (1 - rad)));
  }
  for (let k = 0; k < 6; k++) {
    const x = (k / 5 * 2 - 1) * Rv * 0.7, top = -Math.sqrt(Math.max(0, 1 - (x / Rv) ** 2)) * Rv / 2 - rise;
    const tall = 1 + 2 * hash(k + 70) * (0.6 + 0.4 * Math.sin(t * 40 + k * 2));
    for (let j = 1; j <= 3; j++) {
      P(x + Math.sin(t * 25 + k + j) * j * 0.6, top - j * tall * 0.7, j === 3 ? "'" : j === 2 ? '^' : '*',
        pick(HEAT, 0.85 - j * 0.18 - t * 0.3), life * (1 - j * 0.2));
    }
  }
  for (let i = 0; i < 8; i++) {
    const a = hash(i + 75) * TAU, d = (8 + 10 * hash(i + 76)) * easeOut(t) * scale;
    P(Math.cos(a) * d, Math.sin(a) * d / 2 - rise - (2 * t - 2.5 * t * t) * 6, t < 0.5 ? '*' : "'",
      pick(HEAT, 0.95 - 0.6 * t), life);
  }
}

// Ground Crack pulse: the main detonation. A white starburst, a shock front that
// races out over the ground as an evenly spaced ring and frays into dust, glowing
// fissures that split outward and cool, and rock chunks thrown on ballistic arcs.
function blast(P, t, fade, r) {
  const k = r / 2;
  const flash = 1 - smooth(t / 0.16);
  for (let ray = 0; ray < 8 && flash > 0; ray++) {
    const a = ray / 8 * TAU + 0.2, len = (ray % 2 ? 8 : 14) * (0.6 + 0.6 * easeOut(t / 0.16)) * k;
    const char = stroke(Math.cos(a), Math.sin(a) / 2);
    for (let j = 1; j <= 3; j++) {
      P(Math.cos(a) * len * j / 3, Math.sin(a) * len * j / 6 - 3, char, j === 1 ? WHITE : pick(HEAT, 0.95 - j * 0.12),
        flash * (1.05 - j * 0.2) * fade);
    }
  }
  if (flash > 0) P(0, -3, '@', WHITE, flash * fade);

  const s = easeOut(t / 0.5), front = (0.2 + 0.8 * s) * r * 0.85;
  const ring = (1 - smooth((t - 0.1) / 0.6)) * fade;
  for (let i = 0; i < 64 && ring > 0; i++) {
    // The front frays as it slows: glyphs drop out one by one instead of all at once.
    const keep = 1 - smooth((s - 0.55 - 0.45 * hash(i + 402)) / 0.15);
    if (keep <= 0) continue;
    const a = arc(i / 64), jag = front * (1 + 0.07 * (hash(i + 400) - 0.5));
    P(Math.cos(a) * jag * CW, Math.sin(a) * jag * RH, stroke(-Math.sin(a) * CW, Math.cos(a) * RH),
      pick(HEAT, 0.98 - 0.8 * s), ring * keep * (0.7 + 0.3 * hash(i + 401)));
  }
  // Dust skirt kicked up just behind the front, lifting and greying.
  for (let i = 0; i < 28 && ring > 0; i++) {
    const a = arc((i + 0.5) / 28), d = front * (0.78 + 0.08 * hash(i + 403));
    P(Math.cos(a) * d * CW, Math.sin(a) * d * RH - s * (1 + 2 * hash(i + 404)), s > 0.45 ? (i % 2 ? '.' : ':') : '=',
      s > 0.45 ? ASH : pick(HEAT, 0.45), ring * (0.55 - 0.2 * s));
  }
  // Fissures: six jagged cracks split outward from the crater, then cool to dark red.
  const grow = easeOut(t / 0.24), cool = smooth((t - 0.2) / 0.8);
  for (let c = 0; c < 6; c++) {
    const base = (c + 0.5) / 6 * TAU + (hash(c + 300) - 0.5) * 0.6;
    const len = r * 0.72 * (0.75 + 0.4 * hash(c + 310)) * grow;
    let x0 = 0, y0 = 0, wander = 0;
    for (let j = 1; j <= 10; j++) {
      const f = j / 10;
      if (f > grow + 0.05) break;
      wander += (hash(c * 17 + j) - 0.5) * 0.45;
      const a = base + wander * 0.6;
      const x = Math.cos(a) * len * f * CW, y = Math.sin(a) * len * f * RH;
      P(x, y, stroke(x - x0, y - y0), pick(HEAT, (1 - f * 0.55) * (1 - cool * 0.8)),
        (1 - cool) * (1 - f * 0.35) * fade);
      x0 = x; y0 = y;
    }
  }
  // Rock chunks on real ballistic arcs, each with a short glowing trail.
  const tau = t * 0.6, landed = 1 - smooth((t - 0.6) / 0.4);
  for (let i = 0; i < 14; i++) {
    const a = hash(i + 320) * TAU, speed = (1.4 + 1.8 * hash(i + 321)) * k, up = 3 + 3 * hash(i + 322);
    const at = time => [Math.cos(a) * speed * time * CW,
      Math.sin(a) * speed * time * RH - Math.max(0, up * time - 4.9 * time * time) * LIFT];
    const [x, y] = at(tau), [tx, ty] = at(Math.max(0, tau - 0.05));
    P(tx, ty, '.', pick(HEAT, 0.5 * (1 - t)), landed * fade * 0.5);
    P(x, y, '#o*^'[i % 4], pick(ROCK, 1 - t), landed * fade * 0.95);
  }
}

// Zone: the burning crater left behind. An evenly spaced rubble rim lit from
// within, a glowing lip, a churning molten floor, flickering flame tongues and
// embers that rise and turn to smoke. It surges white-hot as it forms, then
// cools from orange to dull red over the field's life.
function crater(P, p, age, fade, r) {
  const R = r * 0.62, surge = 1 - smooth(p / 0.15), cool = smooth(p);
  const form = easeOut(p / 0.08);
  for (let i = 0; i < 52; i++) {
    const a = arc(i / 52), jag = R * form * (1 + 0.14 * (hash(i + 500) - 0.5));
    const near = Math.sin(a) > 0; // the near rim hides the glow; the far rim catches it
    const glow = (near ? 0.25 : 0.55) * (1 - 0.7 * cool) + 0.4 * surge;
    P(Math.cos(a) * jag * CW, Math.sin(a) * jag * RH - (near ? 0 : 0.6), '#%o^#'[Math.floor(hash(i + 501) * 5)],
      pick(ROCK, glow * (0.8 + 0.2 * Math.sin(age * 3 + i))), fade * (near ? 0.75 : 0.6));
  }
  for (let i = 0; i < 34; i++) {
    const a = arc((i + 0.5) / 34), d = R * 0.84 * form;
    const heat = sat((0.6 + 0.15 * Math.sin(age * 5 + i * 0.9)) * (1 - 0.6 * cool) + 0.4 * surge);
    P(Math.cos(a) * d * CW, Math.sin(a) * d * RH, stroke(-Math.sin(a) * CW, Math.cos(a) * RH) === '-' ? '=' : ':',
      pick(HEAT, heat), fade * (0.35 + 0.45 * heat));
  }
  for (let i = 0; i < 34; i++) {
    const rad = Math.sqrt((i + 0.5) / 34), a = i * GOLDEN, d = rad * R * 0.7 * form;
    const churn = Math.sin(a * 3 + age * 2.2 - rad * 4) * 0.15;
    const heat = sat((0.8 - 0.4 * rad + churn) * (1 - 0.55 * cool) + 0.3 * surge);
    P(Math.cos(a) * d * CW, Math.sin(a) * d * RH, heat > 0.85 ? '%' : heat > 0.6 ? '~' : heat > 0.45 ? '=' : heat > 0.3 ? '-' : '.',
      pick(HEAT, heat), fade * (0.35 + 0.6 * heat));
  }
  for (let k = 0; k < 6; k++) {
    const rad = Math.sqrt((k + 0.5) / 6) * R * 0.6, a = k * GOLDEN + 0.7;
    const bx = Math.cos(a) * rad * CW, by = Math.sin(a) * rad * RH;
    const tall = (0.55 + 0.5 * hash(k + 520)) * (0.7 + 0.3 * Math.sin(age * 9 + k * 2.1)) * (1 - 0.65 * cool) + 0.5 * surge;
    for (let j = 0; j < 4; j++) {
      P(bx + Math.sin(age * 7 + k + j) * j * 0.8, by - tall * (j + 0.5) / 4 * LIFT, '#*^\''[j],
        pick(HEAT, (0.92 - j * 0.2) * (1 - 0.5 * cool) + 0.1 * surge), fade * form * (0.9 - j * 0.18));
    }
  }
  for (let i = 0; i < 12; i++) {
    const u = (hash(i + 540) + age * 0.55 * (0.7 + 0.6 * hash(i + 541))) % 1;
    const rad = Math.sqrt(hash(i + 542)) * R, a = hash(i + 543) * TAU;
    P(Math.cos(a) * rad * CW + Math.sin(u * 6 + i) * 3, Math.sin(a) * rad * RH - u * 2.2 * LIFT,
      u < 0.45 ? '*' : u < 0.75 ? "'" : '~', u < 0.75 ? pick(HEAT, 0.85 - 0.7 * u) : ASH,
      fade * smooth(u * 6) * (1 - u));
  }
}

// Aura (not used by Meteor's graph, kept for completeness): a ring of orbiting
// embers with a slow heat shimmer.
function aura(P, p, age, fade, r) {
  for (let i = 0; i < 24; i++) {
    const a = i / 24 * TAU + age * 1.4, d = r * (1 + 0.06 * Math.sin(age * 4 + i));
    P(Math.cos(a) * d * CW, Math.sin(a) * d * RH, i % 3 ? '.' : '*', pick(HEAT, 0.45 + 0.3 * Math.sin(age * 6 + i)),
      fade * 0.6);
  }
  for (let i = 0; i < 8; i++) {
    const u = (hash(i + 600) + age * 0.8) % 1, a = hash(i + 601) * TAU;
    P(Math.cos(a) * r * CW * 0.7, Math.sin(a) * r * RH * 0.7 - u * 1.5 * LIFT, u < 0.5 ? "'" : '.',
      pick(HEAT, 0.8 - 0.6 * u), fade * smooth(u * 6) * (1 - u));
  }
}

export default {
  id: 'temp-meteor',
  duration: 1.25,
  draw(effect, plot) {
    const progress = clamp(Number.isFinite(effect.progress) ? effect.progress
      : (effect.age ?? 0) / Math.max(0.001, effect.life ?? 1), 0, 1);
    if (progress >= 1) return;
    const P = painter(effect, plot);
    const heading = Number.isFinite(effect.heading) ? effect.heading : 0;
    const age = Number.isFinite(effect.age) ? effect.age : progress * (effect.life ?? 1);
    const radius = Number.isFinite(effect.radius) ? effect.radius : 1;
    const fade = Math.min(1, (1 - progress) * 3);
    switch (effect.stage) {
      case 'cast':
        cast(P, progress * 1.25, Math.sin(heading), Math.cos(heading), Math.min(1, (1 - progress) * 8));
        return;
      case 'projectile': meteor(P, age, fade, heading); return;
      case 'impact': impact(P, progress, fade, clamp(radius, 0.7, 1.6)); return;
      case 'zone': crater(P, progress, age, Math.min(1, (1 - progress) * 2.5) * smooth(progress / 0.06 + 0.3),
        clamp(radius, 0.8, 3)); return;
      case 'aura': aura(P, progress, age, fade * smooth(progress / 0.1 + 0.2), clamp(radius, 0.6, 2.5)); return;
      default:
        if (radius >= 1.5) blast(P, progress, Math.min(1, (1 - progress) * 4), clamp(radius, 1.5, 3));
        else flare(P, progress, Math.min(1, (1 - progress) * 4), clamp(radius, 0.6, 1.4));
    }
  },
  sounds: {
    // Furnace intake opens the sigil; the delayed basalt growl follows the
    // half-second release. Projectile motion itself emits no separate cue.
    cast: [
      { kind: 'noise', delay: 0, duration: 0.56, gain: 0.064, attack: 0.22, decay: 0.07, sustain: 0.7, release: 0.2, cutoff: 520, filterType: 'lowpass', Q: 0.65, playbackRate: 0.65 },
      { kind: 'tone', type: 'sawtooth', delay: 0.08, duration: 0.82, frequency: 146, endFrequency: 43, gain: 0.046, attack: 0.16, decay: 0.12, sustain: 0.65, release: 0.4, cutoff: 185, filterType: 'lowpass', Q: 0.7 },
      { kind: 'tone', type: 'triangle', delay: 0.48, duration: 0.58, frequency: 91, endFrequency: 32, gain: 0.054, attack: 0.06, decay: 0.09, sustain: 0.72, release: 0.28, cutoff: 250, filterType: 'lowpass', Q: 0.55 },
      { kind: 'noise', delay: 0.5, duration: 0.53, gain: 0.047, attack: 0.12, decay: 0.07, sustain: 0.8, release: 0.18, cutoff: 720, filterType: 'bandpass', Q: 0.8, playbackRate: 0.7 },
    ],
    // Two low detonation bodies carry the weight; three uneven charcoal
    // contacts settle behind the blast instead of forming a rhythmic jingle.
    impact: [
      { kind: 'tone', type: 'sine', delay: 0, duration: 1.18, frequency: 108, endFrequency: 29, gain: 0.12, attack: 0.005, decay: 0.12, sustain: 0.48, release: 0.9, cutoff: 180, filterType: 'lowpass', Q: 0.6 },
      { kind: 'tone', type: 'triangle', delay: 0, duration: 0.78, frequency: 67, endFrequency: 25, gain: 0.062, attack: 0.004, decay: 0.08, sustain: 0.38, release: 0.65, cutoff: 150, filterType: 'lowpass', Q: 0.55 },
      { kind: 'noise', delay: 0, duration: 0.32, gain: 0.083, attack: 0.003, decay: 0.04, sustain: 0.32, release: 0.24, cutoff: 740, filterType: 'lowpass', Q: 0.7, playbackRate: 0.6 },
      { kind: 'noise', delay: 0.17, duration: 0.09, gain: 0.036, attack: 0.003, decay: 0.012, sustain: 0.18, release: 0.065, cutoff: 1120, filterType: 'bandpass', Q: 0.85, playbackRate: 0.75 },
      { kind: 'tone', type: 'triangle', delay: 0.36, duration: 0.085, frequency: 174, endFrequency: 71, gain: 0.026, attack: 0.003, decay: 0.012, sustain: 0.22, release: 0.06, cutoff: 430, filterType: 'lowpass', Q: 0.6 },
      { kind: 'noise', delay: 0.63, duration: 0.1, gain: 0.021, attack: 0.004, decay: 0.015, sustain: 0.15, release: 0.075, cutoff: 490, filterType: 'lowpass', Q: 0.7, playbackRate: 0.55 },
    ],
    // Ground bursts repeat during the burn field: quiet coal sighs and tiny
    // stone ticks keep them underneath the initial detonation.
    pulse: [
      { kind: 'noise', delay: 0, duration: 0.16, gain: 0.012, attack: 0.022, decay: 0.025, sustain: 0.3, release: 0.1, cutoff: 410, filterType: 'lowpass', Q: 0.6, playbackRate: 0.6 },
      { kind: 'tone', type: 'triangle', delay: 0.018, duration: 0.13, frequency: 81, endFrequency: 41, gain: 0.009, attack: 0.014, decay: 0.024, sustain: 0.3, release: 0.08, cutoff: 190, filterType: 'lowpass', Q: 0.6 },
      { kind: 'noise', delay: 0.065, duration: 0.07, gain: 0.006, attack: 0.003, decay: 0.012, sustain: 0.18, release: 0.05, cutoff: 830, filterType: 'bandpass', Q: 0.7, playbackRate: 0.7 },
    ],
  },
};
