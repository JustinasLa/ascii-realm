// Drowning Prison: the caster draws water up and hurls a barred bubble; the tide
// converges on the target and seals a rotating, barred water globe around it.
// Each drowning tick squeezes the globe and forces a last breath out of its crown.
//
// Everything is authored in screen-aligned metres (x right, z down; one metre of
// height is about -1.8 z) and counter-rotated against the runtime heading, so the
// globe stays upright, bubbles always rise and spray always falls.
const TAU = Math.PI * 2;
// Columns and rows per metre on screen; strokes step one cell at a time.
const COLS = 21.7, ROWS = 6.5;
// Deep water -> current -> crest -> foam -> white flash.
const RAMP = [[16, 60, 128], [24, 96, 165], [34, 138, 185], [42, 170, 190],
  [80, 205, 215], [117, 233, 237], [176, 248, 244], [236, 255, 255]];
const tone = t => RAMP[Math.max(0, Math.min(7, Math.round(t * 7)))];
const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const smooth = t => { t = clamp(t); return t * t * (3 - 2 * t); };
const outCubic = t => 1 - (1 - clamp(t)) ** 3;
const inCubic = t => clamp(t) ** 3;
const outBack = t => { t = clamp(t) - 1; return 1 + 2.70158 * t * t * t + 1.70158 * t * t; };
const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
// A line glyph for a screen-metre direction (a z metre is half as tall as an x metre is wide).
const slant = (dx, dz) => {
  const ax = Math.abs(dx * 2), az = Math.abs(dz);
  if (ax > az * 2.4) return '-';
  if (az > ax * 2.4) return '|';
  return (dx > 0) === (dz > 0) ? '\\' : '/';
};
const wet = (dx, dz) => { const ch = slant(dx, dz); return ch === '-' ? '~' : ch; };
// Metres covered by one screen cell along a direction.
const cellStep = (dx, dz) => 1 / (Math.hypot(dx * COLS, dz * ROWS) || 1);

// Angles spaced evenly along an ellipse's on-screen arc, so outlines read as
// continuous strokes instead of bunching at the sides. Built once at load.
const arcTable = (count, a, b) => {
  const steps = 720, cumulative = new Float64Array(steps + 1);
  for (let i = 1; i <= steps; i++) {
    const t0 = (i - 1) / steps * TAU, t1 = i / steps * TAU;
    cumulative[i] = cumulative[i - 1] + Math.hypot(a * (Math.cos(t1) - Math.cos(t0)), b * (Math.sin(t1) - Math.sin(t0)));
  }
  const angles = new Float64Array(count), cos = new Float64Array(count), sin = new Float64Array(count);
  for (let k = 0, i = 0; k < count; k++) {
    const target = k / count * cumulative[steps];
    while (i < steps && cumulative[i + 1] < target) i++;
    const span = cumulative[i + 1] - cumulative[i] || 1;
    angles[k] = (i + (target - cumulative[i]) / span) / steps * TAU - Math.PI / 2;
    cos[k] = Math.cos(angles[k]); sin[k] = Math.sin(angles[k]);
  }
  return { angles, cos, sin, count };
};
// The globe is a circle on screen: 0.92 m wide and 2 m tall in z, centred at chest height.
const GX = 0.92, GZ = 2, GC = -1.75;
const SHELL = arcTable(80, GX * COLS, GZ * ROWS);

// The globe's skin: tangent strokes lit from the upper left with a travelling shimmer.
function shell(put, cx, cz, rx, rz, age, light, { step = 1, reveal = 1, flash = 0, wobble = 1 } = {}) {
  for (let k = 0; k < SHELL.count; k += step) {
    const c = SHELL.cos[k], s = SHELL.sin[k];
    if (reveal < 1 && Math.acos(clamp(s, -1, 1)) > reveal * Math.PI) continue;
    const t = SHELL.angles[k];
    const swell = 1 + wobble * (0.03 * Math.sin(3 * t + age * 3.1) + 0.018 * Math.sin(5 * t - age * 4.3));
    const lit = clamp(0.5 - 0.3 * c - 0.4 * s), shimmer = 0.5 + 0.5 * Math.cos(2 * t - age * 2.4);
    const intensity = clamp(0.25 + 0.45 * lit + 0.3 * shimmer);
    put(cx + rx * c * swell, cz + rz * s * swell, slant(-rx * s, rz * c),
      tone(0.3 + 0.55 * intensity + flash), light * (0.45 + 0.55 * intensity));
  }
}

// Front meridians of the cage rotate around the vertical axis; they grow from the base.
// Each bar dims smoothly to nothing as it turns towards the rim, so none pops off.
function bars(put, cx, cz, rx, rz, turn, light, count = 8, samples = 16, reveal = 1) {
  for (let i = 0; i < count; i++) {
    const phi = i * TAU / count + turn, sf = Math.sin(phi), cf = Math.cos(phi);
    const edge = cf > 0 ? smooth((0.92 - Math.abs(sf)) / 0.3) : 0;
    if (edge <= 0) continue;
    for (let j = 0; j < samples; j++) {
      if ((samples - j) / samples > reveal + 1e-9) continue;
      const lat = -Math.PI / 2 + (j + 1) * Math.PI / (samples + 1), cl = Math.cos(lat), sl = Math.sin(lat);
      put(cx + rx * sf * cl * 0.96, cz + rz * sl * 0.96, slant(-rx * sf * sl, rz * cl),
        tone(0.35 + 0.35 * cf), light * edge * (0.3 + 0.5 * cf) * (0.75 + 0.25 * cl));
    }
  }
}

// A short wave crest on a ground ring, stepped one cell at a time along its tangent.
function crest(put, cx, cz, r, t, half, light, color) {
  const c = Math.cos(t), s = Math.sin(t), step = cellStep(-s, c);
  const ch = Math.abs(c) > 0.94 ? (c > 0 ? ')' : '(') : wet(-s, c);
  for (let j = -half; j <= half; j++) {
    put(cx + r * c - s * step * j, cz + r * s + c * step * j, ch, color, light * (1 - Math.abs(j) / (half + 1.5)));
  }
}

// Air escaping a drowning body: bubbles widen as they rise and pop at the crown.
function bubble(put, x, z, q, light, color) {
  if (q <= 0 || q >= 1) return;
  const ch = q > 0.9 ? '*' : q > 0.62 ? 'O' : q > 0.3 ? 'o' : '.';
  put(x, z, ch, color, light * Math.sin(Math.PI * q) ** 0.5);
}
const GROUND = arcTable(48, COLS, ROWS);
// Unit screen-cell offsets, in metres, across a direction (for parallel strands).
const across = (fx, fz) => {
  const px = -fz * ROWS, pz = fx * COLS, norm = Math.hypot(px, pz) || 1;
  return [px / norm / COLS, pz / norm / ROWS];
};

function hold(put, age, life) {
  const form = clamp(age / Math.min(0.4, life * 0.25));
  const releaseTime = Math.min(0.5, life * 0.3), release = clamp((age - (life - releaseTime)) / releaseTime);
  const grow = 0.55 + 0.45 * outBack(form), rx = GX * grow, rz = GZ * grow;
  if (release <= 0) {
    const light = 0.35 + 0.65 * smooth(form), settled = smooth((form - 0.6) / 0.4);
    // Water climbs both sides from the ground and seals at the crown, then the bars grow.
    shell(put, 0, GC, rx, rz, age, light, { reveal: smooth(form * 1.4) });
    bars(put, 0, GC, rx, rz, age * 0.7, light, 8, 16, clamp((form - 0.35) / 0.65));
    if (settled <= 0) return;
    // An equatorial band, seen slightly from above, locks the bars together.
    for (let k = 0; k < 20; k++) {
      const th = k / 20 * TAU + age * 0.7, front = Math.sin(th);
      if (front < -0.2) continue;
      put(rx * Math.cos(th) * 0.98, GC + rz * 0.05 + rz * 0.16 * front, front > 0.35 ? '=' : '-',
        tone(0.45 + 0.3 * front), light * settled * (0.45 + 0.4 * front));
    }
    for (let k = 0; k < 4; k++) {
      const t = -2.35 + k * 0.15;
      put(Math.cos(t) * rx * 0.8, GC + Math.sin(t) * rz * 0.8, k === 1 || k === 2 ? "'" : '`', tone(1), settled * 0.85);
    }
    for (let i = 0; i < 12; i++) {
      const q = (age * (0.32 + hash(i) * 0.3) + hash(i + 40)) % 1;
      const z = GC + rz * (0.75 - 1.62 * q), room = Math.sqrt(clamp(1 - ((z - GC) / rz) ** 2));
      bubble(put, rx * room * ((hash(i + 80) * 2 - 1) * 0.72) + 0.06 * Math.sin(age * 5 + i), z, q, light * settled, tone(0.85));
    }
    return;
  }
  // The globe bursts: its skin flies apart as droplets that fall and splash.
  const fade = (1 - release) ** 1.2;
  for (let k = 0; k < SHELL.count; k += 2) {
    const c = SHELL.cos[k], s = SHELL.sin[k], push = 1 + release * (0.5 + 0.6 * hash(k));
    const x = GX * c * push, z = GC + GZ * s * push + 2.4 * release * release;
    put(x, z, release < 0.35 ? slant(c, s + 4 * release) : hash(k + 7) > 0.5 ? '.' : ',',
      tone(0.85 - 0.5 * release), fade * (0.9 - 0.3 * hash(k + 3)));
  }
  const ring = 0.55 + 1.1 * outCubic(release);
  for (let k = 0; k < 8; k++) crest(put, 0, 0.15, ring, k / 8 * TAU + 0.2, 2, fade * 0.7, tone(0.55));
}

function squeeze(put, p, age) {
  // A damped spring: the globe crushes inward with a white flash, then rebounds.
  const squash = 1 - 0.18 * Math.exp(-3.5 * p) * Math.sin(p * 11), flash = Math.exp(-p * 7);
  shell(put, 0, GC, GX * squash, GZ * squash, age, Math.exp(-p * 3) * (1 - p), { flash: flash * 0.4, wobble: 0.4 });
  // Pressure lines close in on the globe from outside.
  const press = clamp(p / 0.3);
  if (press < 1) {
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * TAU + 0.26, c = Math.cos(a), s = Math.sin(a), step = cellStep(c * GX, s * GZ);
      const r = 1.42 - 0.38 * outCubic(press);
      for (let j = 0; j < 2; j++) {
        put(GX * c * (r + step * j * 1.1), GC + GZ * s * (r + step * j * 1.1), slant(c * GX, s * GZ),
          tone(0.95 - j * 0.3), (1 - press) * (1 - 0.4 * j));
      }
    }
  }
  // The last breath: big bubbles rush up from the face and burst through the crown.
  for (let i = 0; i < 10; i++) {
    const q = clamp((p - i * 0.035) / 0.42), top = GC - GZ * (0.95 + 0.25 * hash(i + 9)), mouth = GC - GZ * 0.42;
    const ch = q > 0.92 ? '*' : q > 0.55 ? '@' : q > 0.2 ? 'O' : 'o';
    if (q > 0 && q < 1) {
      put((hash(i) - 0.5) * 0.3 * q + 0.07 * Math.sin(q * 8 + i), mouth + (top - mouth) * outCubic(q), ch, tone(0.9),
        Math.sin(Math.PI * q) ** 0.4);
    }
  }
  // Water thrown off the crown arcs up and falls back.
  for (let i = 0; i < 24; i++) {
    const q = clamp((p - 0.17 - hash(i + 20) * 0.08) / 0.75);
    if (q <= 0) continue;
    const vz = 1.5 + hash(i + 30) * 1.4, vx = (hash(i + 50) - 0.5) * 2.2;
    const x = (hash(i + 60) - 0.5) * GX * 0.8 + vx * q, z = GC - GZ + 0.1 - vz * q + 3.4 * q * q;
    put(x, z, 6.8 * q < vz ? "'" : hash(i) > 0.5 ? '.' : ',', tone(0.8 - 0.3 * q), (1 - q) ** 1.3);
  }
  const ring = 0.55 + 0.9 * outCubic(p);
  for (let k = 0; k < 10; k++) crest(put, 0, 0.2, ring, k / 10 * TAU + 0.31, 2, (1 - p) * 0.6, tone(0.5));
}

function shackles(put, p) {
  const q = clamp(p / 0.55), r = 0.5 + 0.85 * (1 - outCubic(q)), flash = Math.exp(-p * 5);
  for (let hoop = 0; hoop < 2; hoop++) {
    const height = hoop ? -2.45 : -0.5, radius = r * (hoop ? 0.85 : 1);
    for (let k = 0; k < GROUND.count; k++) {
      const c = GROUND.cos[k], s = GROUND.sin[k];
      put(c * radius, height + s * radius, Math.abs(c) > 0.94 ? (c > 0 ? ')' : '(') : s > 0 ? '=' : '-',
        tone(0.55 + 0.45 * flash), (1 - p) ** 0.8 * (0.6 + 0.4 * s));
    }
    // Locks snap shut where each hoop closes in front.
    if (q > 0.8) for (let k = -1; k <= 1; k++) put(k / COLS, height + radius + 1 / ROWS, k ? '-' : '+', tone(1), (1 - p) * 0.95);
  }
}

function breath(put, p) {
  for (let i = 0; i < 8; i++) {
    const q = clamp((p - hash(i + 3) * 0.35) / 0.65), x0 = (hash(i + 11) - 0.5) * GX * 0.7;
    const z = GC - GZ * (0.3 + 0.67 * outCubic(q)) + hash(i) * 0.25;
    bubble(put, x0 + 0.07 * Math.sin(q * 9 + i), z, q, 0.9, tone(0.9));
  }
  // Where the bubbles break the crown, a small ripple runs over the skin.
  for (let k = 0; k < 11; k++) {
    const t = -Math.PI / 2 + (k - 5) * 0.11, r = 1 + 0.08 * p;
    put(Math.cos(t) * GX * r, GC + Math.sin(t) * GZ * r - 0.1, '~', tone(0.7), Math.sin(Math.PI * p) * 0.6 * (1 - Math.abs(k - 5) / 6));
  }
  for (let i = 0; i < 8; i++) {
    const a = hash(i + 70) * TAU, r = Math.sqrt(hash(i + 90)) * 0.85;
    put(Math.cos(a) * GX * r, GC + Math.sin(a) * GZ * r - p * 0.2, hash(i) > 0.5 ? '.' : "'",
      tone(0.6), Math.sin(Math.PI * clamp(p * 1.3 - hash(i + 5) * 0.3)) * 0.35);
  }
}

function tide(put, p, age, radius) {
  const reach = clamp(radius * 0.8, 1.2, 3.2);
  // Two rings of breaking crests rush inward to the target.
  for (let ring = 0; ring < 2; ring++) {
    const q = clamp((p - ring * 0.16) / 0.55);
    if (q <= 0 || q >= 1) continue;
    const r = reach + (0.75 - reach) * smooth(q), half = r > 1.4 ? 2 : 1, light = Math.sin(Math.PI * q) ** 0.7;
    for (let k = 0; k < 10; k++) {
      const t = (k + ring * 0.5) / 10 * TAU + hash(k + ring * 13) * 0.25 + q * 0.6;
      crest(put, 0, 0, r, t, half, light * (0.65 + 0.35 * Math.sin(t)), tone(0.35 + 0.45 * q + 0.1 * Math.sin(t)));
    }
  }
  // Streams of water race along the ground toward the centre.
  for (let i = 0; i < 10; i++) {
    const a = i / 10 * TAU + 0.3 + hash(i) * 0.3, c = Math.cos(a), s = Math.sin(a), step = cellStep(c, s);
    const q = clamp((p - hash(i + 4) * 0.2) / 0.5);
    if (q <= 0 || q >= 1) continue;
    const r = reach * 1.05 + (0.85 - reach * 1.05) * (0.4 * q + 0.6 * inCubic(q));
    for (let j = 0; j < 4; j++) {
      put(c * (r + step * j * 1.2), s * (r + step * j * 1.2), wet(-c, -s), tone(0.8 - j * 0.15), Math.sin(Math.PI * q) * (1 - j * 0.22));
    }
  }
  // Where the rings meet, water climbs to build the globe.
  for (let i = 0; i < 12; i++) {
    const tau = age - 0.42 - hash(i + 15) * 0.15;
    if (tau <= 0) continue;
    const a = i / 12 * TAU, v = 2.6 + hash(i + 25) * 1.2, height = v * tau - 4.9 * tau * tau;
    if (height <= 0) continue;
    put(Math.cos(a) * 0.7 * (1 - tau * 0.6), Math.sin(a) * 0.7 * (1 - tau * 0.6) - 1.8 * height,
      v - 9.8 * tau > 0 ? "'" : '.', tone(0.85), 0.8);
  }
}

function cast(put, p, age, fx, fz) {
  const hx = fx * 0.55, hz = fz * 0.55 - 1.9, [sx, sz] = across(fx, fz);
  // Gather: droplets spiral off the ground and into the caster's hand.
  for (let i = 0; i < 22; i++) {
    const q = clamp((p - hash(i) * 0.05) / 0.13);
    if (q <= 0 || q >= 1) continue;
    const a = i / 22 * TAU + q * 1.2, k = inCubic(q), gx = Math.cos(a) * 1.25, gz = Math.sin(a) * 1.25;
    put(gx + (hx - gx) * k, gz + (hz - gz) * k - Math.sin(Math.PI * q) * 0.6, q > 0.6 ? "'" : '.', tone(0.4 + 0.5 * q), 0.35 + 0.65 * q);
  }
  // The orb swells, squashes in anticipation, then is hurled down the heading.
  const launch = 0.17, swell = outBack(p / 0.12), squash = 1 + 0.35 * Math.sin(Math.PI * clamp((p - 0.11) / 0.06));
  const go = outCubic((p - launch) / 0.2), away = go * 3.5;
  if (p < launch + 0.2) {
    const ox = hx + fx * away, oz = hz + fz * away, rx = 0.22 * swell * squash, rz = 0.44 * swell / squash;
    shell(put, ox, oz, rx, rz, age, 1 - go, { step: 5 });
    bars(put, ox, oz, rx, rz, age * 8, 1 - go, 4, 5);
  }
  // A braided jet tears away after it.
  if (p > 0.15 && p < 0.5) {
    const q = (p - 0.15) / 0.35, head = 3.6 * outCubic(q * 1.4), tail = 3.6 * inCubic(q), cell = cellStep(fx, fz);
    for (let s = -1; s <= 1; s++) {
      const n = Math.max(1, Math.min(s ? 12 : 18, Math.round((head - tail) / cell / 1.2)));
      for (let j = 0; j <= n; j++) {
        const d = tail + (head - tail) * j / n, off = s * 1.2 + Math.sin(d * 5 - age * 25 + s) * 0.5;
        put(hx + fx * d + sx * off, hz + fz * d + sz * off, s ? wet(fx, fz) : slant(fx, fz),
          tone(0.45 + 0.5 * j / n - Math.abs(s) * 0.15), Math.sin(Math.PI * q) * (0.4 + 0.6 * j / n));
      }
    }
  }
  // Spray from the release follows real ballistics and splashes where it lands.
  for (let i = 0; i < 16; i++) {
    const tau = age - launch * 1.2 - hash(i) * 0.06;
    if (tau <= 0) continue;
    const turn = (hash(i + 31) - 0.5) * 0.7, dx = fx * Math.cos(turn) - fz * Math.sin(turn), dz = fz * Math.cos(turn) + fx * Math.sin(turn);
    const speed = 1.2 + hash(i + 41) * 1.6, vy = 0.4 + hash(i + 51) * 1.4;
    const flight = (vy + Math.sqrt(vy * vy + 2 * 9.8 * 1.05)) / 9.8, t = Math.min(tau, flight);
    const height = Math.max(0, 1.05 + vy * t - 4.9 * t * t), landed = tau >= flight;
    const fade = landed ? 1 - clamp((tau - flight) / 0.3) : 1;
    if (fade > 0) {
      put(hx + dx * speed * t, fz * 0.55 + dz * speed * t - 1.8 * height, landed ? '.' : vy - 9.8 * t > 0 ? "'" : ',',
        tone(landed ? 0.35 : 0.75), fade * 0.85);
    }
  }
  // Recoil ripples spread from the caster's feet.
  for (let k = 0; k < 2; k++) {
    const q = clamp((p - 0.12 - k * 0.15) / 0.6), r = 0.35 + 1.0 * outCubic(q), crests = k ? 8 : 12;
    if (q <= 0 || q >= 1) continue;
    for (let j = 0; j < crests; j++) {
      const t = j / crests * TAU + k * 0.3;
      crest(put, 0, 0, r, t, k ? 1 : 2, (1 - q) * 0.75 * (0.55 + 0.45 * Math.sin(t)), tone(0.5 - k * 0.1));
    }
  }
  // Drips left on the hand fall to the caster's feet.
  for (let i = 0; i < 8; i++) {
    const tau = age - 0.3 - i * 0.07, fall = Math.sqrt(2 * 1.05 / 9.8);
    if (tau <= 0 || tau > fall + 0.25) continue;
    const height = Math.max(0, 1.05 - 4.9 * Math.min(tau, fall) ** 2), x = hx + (hash(i + 61) - 0.5) * 0.3;
    put(x, fz * 0.55 - 1.8 * height, height > 0 ? (hash(i) > 0.5 ? ',' : "'") : '.', tone(0.6),
      height > 0 ? 0.75 : 0.75 * (1 - (tau - fall) / 0.25));
  }
}

function projectile(put, age, fx, fz) {
  const rx = 0.3, rz = 0.6, [sx, sz] = across(fx, fz), cell = cellStep(fx, fz) * 1.3;
  shell(put, 0, 0, rx, rz, age * 4, 1, { step: 3 });
  bars(put, 0, 0, rx, rz, age * 9, 0.9, 4, 5);
  put(-rx * 0.45, -rz * 0.5, "'", tone(1), 0.9);
  for (let i = 0; i < 3; i++) {
    const q = (age * 3 + hash(i)) % 1;
    put((hash(i + 5) - 0.5) * rx, rz * (0.6 - 1.2 * q), q > 0.5 ? 'o' : '.', tone(0.9), 0.8 * Math.sin(Math.PI * q));
  }
  // Three braided strands stream back along the flight path and widen as they thin.
  const back = Math.hypot(rx * fx, rz * fz) + cell;
  for (let s = -1; s <= 1; s++) {
    const n = s ? 10 : 14;
    for (let j = 0; j < n; j++) {
      const d = back + j * cell, off = s * (1 + j * 0.12) + Math.sin(j * 0.9 - age * 30 + s * 2) * 0.45;
      put(-fx * d + sx * off, -fz * d + sz * off, s ? wet(fx, fz) : slant(fx, fz),
        tone(0.85 - j / n * 0.45 - Math.abs(s) * 0.1), (1 - j / n) ** 1.2 * (s ? 0.65 : 0.95));
    }
  }
  // Droplets peel off the wake and drop out of it.
  for (let i = 0; i < 12; i++) {
    const q = (age * 5 + hash(i + 17)) % 1, d = back + q * cell * 16, side = (hash(i + 27) - 0.5) * 6 * q;
    put(-fx * d + sx * side, -fz * d + sz * side + 0.5 * q * q, q < 0.45 ? "'" : '.', tone(0.7 - q * 0.3), (1 - q) * 0.75);
  }
}

export default {
  id: 'drowning-prison',
  duration: 1.2,
  draw(effect, plot) {
    const p = clamp(Number.isFinite(effect.progress) ? effect.progress : 0);
    const age = Number.isFinite(effect.age) ? effect.age : 0;
    const life = Number.isFinite(effect.life) && effect.life > 0 ? effect.life : 1.2;
    const heading = Number.isFinite(effect.heading) ? effect.heading : 0;
    const c = Math.cos(heading), s = Math.sin(heading);
    // Every stage eases fully out over its last 0.15 s, reaching zero at progress 1.
    const end = p >= 1 ? 0 : clamp((1 - p) * life / 0.15);
    const put = (x, z, ch, color, light) => plot(x * c - z * s, x * s + z * c, ch, color, clamp(light * end));
    switch (effect.stage) {
      case 'cast': return cast(put, p, age, s, c);
      case 'projectile': return projectile(put, age, s, c);
      case 'aura': return shackles(put, p);
      case 'pulse': return breath(put, p);
      case 'zone': return (Number.isFinite(effect.radius) ? effect.radius : 1) < 1 ? hold(put, age, life) : tide(put, p, age, effect.radius);
      default: return squeeze(put, p, age);
    }
  },
  sounds: {
    // A drowned, inharmonic gong draws the bars together; trapped air escapes
    // in an accelerating phrase beneath the muffled weight of the water.
    cast: [
      { kind: 'tone', type: 'sine', frequency: 108, endFrequency: 86, duration: 1.08, gain: 0.1, attack: 0.028, decay: 0.17, sustain: 0.55, release: 0.82, cutoff: 380 },
      { kind: 'tone', type: 'triangle', frequency: 251, endFrequency: 219, duration: 0.92, gain: 0.038, attack: 0.018, decay: 0.16, sustain: 0.3, release: 0.71, cutoff: 440 },
      { kind: 'tone', type: 'sine', delay: 0.21, frequency: 190, endFrequency: 285, duration: 0.14, gain: 0.032, attack: 0.012, decay: 0.025, sustain: 0.42, release: 0.095, cutoff: 520 },
      { kind: 'tone', type: 'sine', delay: 0.44, frequency: 250, endFrequency: 365, duration: 0.12, gain: 0.027, attack: 0.01, decay: 0.025, sustain: 0.34, release: 0.08, cutoff: 570 },
      { kind: 'tone', type: 'sine', delay: 0.61, frequency: 315, endFrequency: 465, duration: 0.1, gain: 0.022, attack: 0.008, decay: 0.02, sustain: 0.28, release: 0.065, cutoff: 620 },
      { kind: 'noise', delay: 0.09, duration: 0.73, gain: 0.044, attack: 0.15, decay: 0.13, sustain: 0.5, release: 0.43, cutoff: 330, filterType: 'lowpass', Q: 1.1 },
    ],
    // The cage crushes inward with a low pressure fall and a damped bar clang;
    // a single breath bubbles out after the constriction.
    impact: [
      { kind: 'tone', type: 'sine', frequency: 91, endFrequency: 42, duration: 0.53, gain: 0.097, attack: 0.055, decay: 0.075, sustain: 0.43, release: 0.39, cutoff: 250 },
      { kind: 'noise', duration: 0.34, gain: 0.062, attack: 0.025, decay: 0.065, sustain: 0.3, release: 0.24, cutoff: 300, filterType: 'lowpass', Q: 1.3 },
      { kind: 'tone', type: 'triangle', delay: 0.08, frequency: 193, endFrequency: 113, duration: 0.28, gain: 0.035, attack: 0.018, decay: 0.05, sustain: 0.29, release: 0.2, cutoff: 390 },
      { kind: 'tone', type: 'sine', delay: 0.23, frequency: 310, endFrequency: 460, duration: 0.11, gain: 0.021, attack: 0.009, decay: 0.025, sustain: 0.3, release: 0.07, cutoff: 600 },
    ],
    // Small oxygen pops and a very short pressure creak keep repeated ticks
    // intimate, leaving room for other spells during the four-second hold.
    pulse: [
      { kind: 'tone', type: 'sine', frequency: 196, endFrequency: 294, duration: 0.12, gain: 0.018, attack: 0.014, decay: 0.024, sustain: 0.34, release: 0.075, cutoff: 440 },
      { kind: 'tone', type: 'triangle', delay: 0.025, frequency: 104, endFrequency: 78, duration: 0.15, gain: 0.013, attack: 0.022, decay: 0.026, sustain: 0.3, release: 0.095, cutoff: 220 },
      { kind: 'noise', delay: 0.045, duration: 0.1, gain: 0.012, attack: 0.012, decay: 0.02, sustain: 0.22, release: 0.06, cutoff: 390, filterType: 'bandpass', Q: 1.4 },
    ],
  },
};
