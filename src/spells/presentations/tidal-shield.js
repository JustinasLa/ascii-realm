// Tidal Shield: the tide climbs a tall water dome around the caster from both
// sides, the two crests seal at the crown in a white flash, currents flow over
// the shell while it holds, then it recedes in falling droplets and a spreading
// ground ripple. Pulses are the surf ring the burst throws outward, impacts are
// crown splashes on struck foes, and the aura wraps a helix of water around the
// body as the absorption takes hold.

// Deep water -> tide -> bright water -> foam -> white flash.
const STOPS = [[0, 18, 62, 128], [0.3, 32, 122, 186], [0.55, 64, 196, 224], [0.8, 168, 244, 246], [1, 246, 255, 255]];
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const RAMP = Array.from({ length: 33 }, (_, i) => {
  const t = i / 32;
  let k = 1;
  while (k < STOPS.length - 1 && STOPS[k][0] < t) k++;
  const [t0, ...a] = STOPS[k - 1], [t1, ...b] = STOPS[k], f = (t - t0) / (t1 - t0);
  return a.map((v, j) => Math.round(v + (b[j] - v) * f));
});
const tone = t => RAMP[Math.round(clamp01(t) * 32)];
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeOut = v => 1 - (1 - clamp01(v)) ** 3;
const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const TAU = Math.PI * 2;
const COLS = 13 / 0.6, ROWS = 6.5; // screen cells per local metre across / down (cells are 6:10)
const LIFT = 2;              // one metre of height rises two local depth units on screen

// Glyph that follows a curve's on-screen direction (dx, dy in local units, +dy is down).
function stroke(dx, dy) {
  const ax = Math.abs(dx * COLS), ay = Math.abs(dy * ROWS) * 10 / 6;
  if (ay < ax * 0.47) return '~';
  if (ay > ax * 2.14) return '|';
  return dx * dy < 0 ? '/' : '\\';
}

// Cast: the dome itself. Heights are drawn screen-up, so `put` is heading-free.
function dome(e, put) {
  const p = e.progress, age = e.age;
  const R = Math.min(1.3, Math.max(0.95, e.radius * 1.25));
  const H = 2.05, S = Math.sqrt(R * R + LIFT * LIFT * H * H); // crown height on screen
  const end = 1 - smooth(0.9, 1, p);
  const rise = smooth(0.03, 0.34, p);          // the waterline climbing both walls
  const recede = 1 - smooth(0.6, 0.84, p);     // the water falling back from the crown
  const level = Math.min(rise, recede);
  const seal = smooth(0.32, 0.36, p) * (1 - smooth(0.36, 0.5, p));
  const hold = smooth(0.34, 0.42, p) * (1 - smooth(0.58, 0.7, p));

  // Ground ring: swells out from the feet, laps, and spreads into a ripple at the end.
  const swell = easeOut(p / 0.14), spread = easeOut((p - 0.8) / 0.2);
  const Rg = R * (0.4 + 0.6 * swell + 0.45 * spread);
  const ring = end * (0.3 + 0.55 * swell) * (1 - 0.5 * spread);
  for (let i = 0; i < 30; i++) {
    const a = -Math.PI / 2 + (i + 0.5) / 30 * Math.PI; // front half, toward the viewer
    const lap = Math.sin(a * 5 - age * 7);
    const X = Rg * Math.sin(a), Y = Rg * Math.cos(a) * (1 + 0.06 * lap);
    let ch = stroke(Rg * Math.cos(a), -Rg * Math.sin(a));
    if (ch === '|') ch = X < 0 ? '(' : ')';
    else if (ch === '~' && lap < -0.3) ch = '-';
    put(X, Y, ch, tone(0.5 + 0.2 * lap * (1 - spread) + 0.15 * (1 - swell)), ring * (0.8 + 0.2 * lap));
  }
  for (let i = 0; i < 14; i++) { // the far side of the ring, seen faintly through the water
    const a = Math.PI / 2 + (i + 0.5) / 14 * Math.PI;
    put(Rg * Math.sin(a), Rg * Math.cos(a), i % 2 ? '-' : '.', tone(0.3), ring * 0.35);
  }

  // The rim of the dome: a bright (Fresnel) edge with currents running along it.
  for (let i = 0; i < 80; i++) {
    const t = -Math.PI / 2 + (i + 0.5) / 80 * Math.PI;
    const hf = Math.cos(t);
    if (hf > level) continue;
    const flow = Math.sin(t * 9 - age * 8);
    const wob = 1 + 0.02 * Math.sin(t * 7 + age * 5);
    const X = R * Math.sin(t) * wob, Y = -S * hf;
    let ch = stroke(R * Math.cos(t), S * Math.sin(t));
    if (ch === '|') ch = t < 0 ? '(' : ')';
    else if (ch === '~' && flow < -0.4) ch = '-';
    const edge = level < 0.999 && level - hf < 0.07; // foam along the moving waterline
    const rim = Math.abs(Math.sin(t));
    const lit = (0.55 + 0.3 * rim + 0.12 * flow) * (1 + 0.25 * seal);
    put(X, Y, edge ? '~' : ch, tone(edge ? 0.9 : 0.42 + 0.25 * rim + 0.1 * flow + 0.5 * seal),
      clamp01(edge ? 1 : lit) * end);
  }

  // Rising crests: a foam head on each wall flinging spray toward the crown.
  const climbing = smooth(0.03, 0.06, p) * (1 - smooth(0.3, 0.35, p));
  if (climbing > 0.01) {
    for (let side = -1; side <= 1; side += 2) {
      const t = side * Math.acos(rise), hx = R * Math.sin(t), hy = -S * rise;
      put(hx - side * 0.04, hy - 0.12, 'o', tone(1), climbing * end);
      for (let k = 0; k < 4; k++) {
        const f = (age * 3.2 + hash(k * 7 + side)) % 1;
        put(hx - side * (0.06 + 0.3 * f) * (0.6 + 0.5 * hash(k + 2)), hy - 0.2 - 0.7 * f * (0.6 + 0.6 * hash(k + 5)),
          f < 0.45 ? '\'' : '.', tone(0.95 - 0.3 * f), climbing * (1 - f) * end);
      }
    }
    // The waterline sweeping across the front of the dome as the tide climbs.
    const r = R * Math.sqrt(Math.max(0, 1 - rise * rise));
    for (let i = 0; i < 20; i++) {
      const a = -Math.PI / 2 + (i + 0.5) / 20 * Math.PI;
      const X = r * Math.sin(a);
      put(X, -S * rise + r * Math.cos(a) * 0.9, (i + Math.floor(age * 12)) % 3 ? '~' : '-',
        tone(0.75), climbing * end * (0.45 + 0.4 * Math.cos(a)));
    }
  }

  // The crests meet at the crown: a white flash with short radiating streaks.
  if (seal > 0.01) {
    put(0, -S, '*', tone(1), seal * end);
    const len = 0.1 + 0.5 * smooth(0.32, 0.5, p);
    for (let k = 0; k < 10; k++) {
      const a = (k + 0.5) / 10 * TAU, dx = Math.sin(a) * 0.5, dy = Math.cos(a) * 1.1;
      let ch = stroke(dx, dy);
      if (ch === '~') ch = '-';
      put(dx * len, -S + dy * len, ch, tone(0.97 - 0.15 * (k % 2)), seal * end * (0.9 - 0.25 * (k % 2)));
    }
  }

  // Held shell: faint currents climb the front face; a glint rides the upper-left shoulder.
  if (hold > 0.01) {
    for (let band = 0; band < 3; band++) {
      const f = (band / 3 + age * 0.35) % 1, L = 0.06 + 0.86 * f;
      if (L > level) continue;
      const r = R * Math.sqrt(1 - L * L), b = 0.5 * hold * Math.sin(Math.PI * f) * end;
      for (let i = 0; i < 12; i++) {
        const a = -1.25 + (i + 0.5) / 12 * 2.5, X = r * Math.sin(a);
        if (Math.abs(X) < 0.22) continue; // leave the caster readable
        put(X, -S * L + r * Math.cos(a) * 0.9, (i + band) % 3 ? '~' : '-', tone(0.45), b);
      }
    }
  }
  const glint = smooth(0.36, 0.44, p) * recede * end;
  if (glint > 0.01) {
    for (let i = 0; i < 5; i++) {
      const t = -0.95 + i * 0.13, hf = Math.cos(t);
      if (hf > level) continue;
      put(0.82 * R * Math.sin(t), -0.9 * S * hf, i === 2 ? '\'' : stroke(R * Math.cos(t), S * Math.sin(t)),
        tone(0.95), glint * (0.65 + 0.3 * Math.sin(age * 5 + i)) * (1 - Math.abs(i - 2) * 0.15));
    }
  }

  // Receding: droplets let go as the waterline passes them and fall to splash at the base.
  for (let k = 0; k < 18; k++) {
    const side = k % 2 ? 1 : -1, t = side * (0.12 + 1.3 * hash(k + 11)), hf = Math.cos(t);
    const release = 0.6 + 0.24 * (1 - hf);
    const tau = (p - release) * e.life;
    if (tau <= 0) continue;
    const m = 0.6 + 0.4 * hash(k + 23); // some cling to the front face, some to the rim
    const X = m * R * Math.sin(t), y0 = -S * hf * (0.8 + 0.2 * m), drop = 4.9 * tau * tau, h0 = H * hf;
    if (drop < h0) {
      const v = 9.8 * tau;
      put(X * (1 + 0.08 * tau), y0 + LIFT * drop, v < 1 ? '\'' : v < 2.6 ? ':' : '|',
        tone(0.82 - 0.25 * Math.min(1, v / 4)), 0.85 * end);
    } else {
      const since = tau - Math.sqrt(h0 / 4.9);
      if (since < 0.14) put(X * 1.1, y0 + LIFT * h0, since < 0.05 ? 'o' : ',', tone(0.7), (1 - since / 0.14) * 0.8 * end);
    }
  }
}

// Pulse: the burst's surf ring, broken into wavelets with a raised foam crest.
const WAVELET = ['-', '~', '^', '~', '-'];
function surf(e, put) {
  const p = e.progress, age = e.age;
  const R = Math.min(4, Math.max(0.8, e.radius));
  const reach = R * (0.22 + 0.78 * easeOut(p));
  const end = 1 - smooth(0.55, 1, p), lift = 0.32 * (1 - 0.6 * p);
  for (let s = 0; s < 16; s++) {
    const a0 = (s + 0.35 * hash(s)) / 16 * TAU + 0.2;
    const pace = reach * Math.hypot(COLS * Math.cos(a0), ROWS * Math.sin(a0)); // cells per radian
    const da = 1.15 / Math.max(1, pace);
    const near = 0.75 + 0.25 * Math.cos(a0); // the near side of the ring reads brighter
    // Wavelets follow the ring: crests on its flat ends, bowed walls on its steep sides.
    const dir = stroke(Math.cos(a0), -Math.sin(a0));
    const wall = dir === '|' ? (Math.sin(a0) < 0 ? '(' : ')') : dir;
    const rise = LIFT * lift * 0.35 * Math.abs(Math.cos(a0));
    for (let j = -2; j <= 2; j++) {
      const a = a0 + j * da, arch = 1 - j * j / 4;
      put(reach * Math.sin(a), reach * Math.cos(a) - rise * arch, dir === '~' ? WAVELET[j + 2] : wall,
        tone(0.55 + 0.4 * arch - 0.25 * p), end * near * (0.6 + 0.4 * arch));
    }
  }
  for (let k = 0; k < 10; k++) { // spray thrown off the crest
    const a = (k + hash(k + 40)) / 10 * TAU, vv = 1.6 + 1.4 * hash(k + 41);
    const tau = age * (0.8 + 0.4 * hash(k + 42)), h = Math.max(0, vv * tau - 4.9 * tau * tau);
    const r = reach + 0.12 + 0.25 * hash(k + 43) * p;
    put(r * Math.sin(a), r * Math.cos(a) - LIFT * h, vv - 9.8 * tau > 0 ? '\'' : '.', tone(0.85 - 0.3 * p),
      end * 0.75 * (h > 0 || p < 0.2 ? 1 : 0.4));
  }
}

// Impact: a slam and crown splash on a struck foe, ringed by two ground ripples.
function splash(e, put) {
  const p = e.progress, age = e.age;
  const R = Math.min(1.6, Math.max(0.7, e.radius));
  const end = 1 - smooth(0.72, 1, p);
  const flash = 1 - smooth(0, 0.22, p);
  if (flash > 0.01) {
    put(0, 0, 'O', tone(1), flash * end);
    const r = 0.1 + 0.3 * easeOut(p / 0.22);
    for (let k = 0; k < 6; k++) {
      const a = k / 6 * TAU + 0.5;
      put(r * Math.sin(a), r * Math.cos(a), k % 2 ? '*' : 'o', tone(0.95), flash * end * 0.85);
    }
  }
  // A column of water thrown up by the slam, collapsing back down.
  const column = Math.sin(Math.PI * clamp01(p / 0.5)) * R * 1.1;
  if (column > 0.02) {
    for (let k = 0; k < 10; k++) {
      const f = (k + 1) / 10, h = column * f;
      put(0.04 * Math.sin(k * 1.7 + age * 9), -LIFT * h, k === 9 ? '\'' : f > 0.7 ? ':' : '|',
        tone(0.55 + 0.4 * f), (0.45 + 0.5 * f) * end * (1 - smooth(0.35, 0.5, p) * 0.6));
    }
  }
  // Crown droplets: launched up and out, slowed by drag, falling back to the ground.
  for (let k = 0; k < 30; k++) {
    const a = (k + 0.6 * hash(k)) / 30 * TAU;
    const vh = (1.3 + 0.6 * hash(k + 1)) * R, vv = 2.1 + 0.7 * hash(k + 2), drag = 2;
    const tau = age * (0.92 + 0.16 * hash(k + 3));
    const r = 0.12 + vh * (1 - Math.exp(-drag * tau)) / drag;
    const flight = vv / 4.9, landed = tau >= flight;
    const h = landed ? 0 : vv * tau - 4.9 * tau * tau;
    let ch = ',';
    if (!landed) {
      const sp = vh * Math.exp(-drag * tau), vy = vv - 9.8 * tau;
      ch = Math.abs(vy) < 0.9 ? 'o' : stroke(sp * Math.sin(a), sp * Math.cos(a) - LIFT * vy);
      if (ch === '~') ch = '-';
    }
    put(r * Math.sin(a), r * Math.cos(a) - LIFT * h, ch, tone(0.95 - 0.45 * p),
      end * (landed ? 0.5 * (1 - smooth(flight, flight + 0.25, tau)) : 0.9 - 0.2 * p));
  }
  // Two ground ripples spreading from the point of contact.
  for (let ring = 0; ring < 2; ring++) {
    const q = easeOut((p - ring * 0.14) / 0.86);
    if (q <= 0) continue;
    const r = 0.15 + R * 1.25 * q, b = (1 - 0.8 * q) * 0.7 * end;
    for (let i = 0; i < 28; i++) {
      const a = (i + 0.5 * ring) / 28 * TAU;
      let ch = stroke(r * Math.cos(a), -r * Math.sin(a));
      if (ch === '|') ch = Math.sin(a) < 0 ? '(' : ')';
      put(r * Math.sin(a), r * Math.cos(a), ch, tone(0.6 - 0.15 * ring), b * (0.75 + 0.25 * Math.cos(a)));
    }
  }
}

// Aura: two ribbons of water spiral up the caster's body.
function wrap(e, put) {
  const p = e.progress, age = e.age;
  const rr = 0.42 * Math.min(1.4, Math.max(0.8, e.radius));
  const head = 2.1 * easeOut(p / 0.75), end = 1 - smooth(0.6, 1, p);
  for (let strand = 0; strand < 2; strand++) {
    for (let i = 0; i < 26; i++) {
      const f = i / 25, h = head - f * 1.3;
      if (h < 0) break;
      const th = strand * Math.PI + h * 3.2 + age * 9;
      const front = Math.cos(th) > 0;
      const X = rr * Math.sin(th) * (1 + 0.12 * f), Y = rr * Math.cos(th) * 0.9 - LIFT * h;
      const ch = i === 0 ? 'o' : stroke(rr * Math.cos(th) * 3.2, -rr * Math.sin(th) * 2.9 - LIFT);
      put(X, Y, ch, tone(front ? 0.88 - 0.35 * f : 0.35), end * (front ? 0.95 : 0.3) * (1 - 0.7 * f));
    }
  }
  for (let i = 0; i < 16; i++) { // swirl at the feet that feeds the ribbons
    const a = i / 16 * TAU - age * 6, r = rr * (1.5 - 0.3 * easeOut(p));
    put(r * Math.sin(a), r * Math.cos(a) * 0.9, i % 2 ? '~' : '-', tone(0.5), end * 0.5 * (0.6 + 0.4 * Math.cos(a)));
  }
}

// Zone: a tidepool with a rippling rim and three currents spiralling inward.
function pool(e, put) {
  const p = e.progress, age = e.age;
  const R = Math.min(4, Math.max(0.8, e.radius));
  const end = (0.3 + 0.7 * smooth(0, 0.08, p)) * (1 - smooth(0.8, 1, p));
  for (let i = 0; i < 48; i++) {
    const a = i / 48 * TAU, w = 1 + 0.04 * Math.sin(a * 6 - age * 4);
    let ch = stroke(Math.cos(a), -Math.sin(a));
    if (ch === '|') ch = Math.sin(a) < 0 ? '(' : ')';
    put(R * w * Math.sin(a), R * w * Math.cos(a), ch, tone(0.6 + 0.15 * Math.sin(a * 3 + age * 3)), end * 0.85);
  }
  for (let arm = 0; arm < 3; arm++) {
    for (let i = 0; i < 18; i++) {
      const f = i / 18, a = arm / 3 * TAU + age * 2 + f * 3.4, r = R * (0.92 - 0.8 * f);
      put(r * Math.sin(a), r * Math.cos(a), f > 0.7 ? '.' : '~', tone(0.5 - 0.2 * f), end * (0.75 - 0.45 * f));
    }
  }
  put(0, 0, '@', tone(0.85), end * (0.6 + 0.2 * Math.sin(age * 6)));
}

// Projectile: a small water orb with a forked liquid wake (local +z is forward).
function orb(e, plot) {
  const p = e.progress, age = e.age, fade = 1 - smooth(0.85, 1, p);
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * TAU + age * 3;
    let ch = stroke(Math.cos(a) * 0.3, -Math.sin(a) * 0.48);
    if (ch === '|') ch = Math.sin(a) < 0 ? '(' : ')';
    plot(0.3 * Math.sin(a), 0.48 * Math.cos(a), ch, tone(0.6 + 0.3 * Math.max(0, Math.cos(a - 2.4))), fade * 0.9);
  }
  plot(0, 0, 'O', tone(0.95), fade);
  plot(-0.1, -0.12, '~', tone(0.75), fade * 0.7);
  plot(0.1, 0.12, '~', tone(0.75), fade * 0.7);
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < 9; i++) {
      const f = (i + 1) / 9;
      plot(side * (0.14 + 0.2 * f) + 0.06 * Math.sin(age * 9 - i), -0.45 - f * 1.1, i % 3 ? '~' : '-',
        tone(0.6 - 0.3 * f), fade * (0.8 - 0.65 * f));
    }
  }
  for (let k = 0; k < 8; k++) {
    const f = (age * 2.5 + hash(k)) % 1;
    plot((hash(k + 3) - 0.5) * (0.4 + 0.8 * f), -0.5 - 1.3 * f, f < 0.4 ? 'o' : '.', tone(0.8 - 0.4 * f), fade * (1 - f) * 0.8);
  }
}

export default {
  id: 'tidal-shield',
  duration: 1.35,
  draw(effect, plot) {
    if (effect.stage === 'projectile') { orb(effect, plot); return; }
    // Heights rise straight up the screen whichever way the caster faces.
    const c = Math.cos(effect.heading || 0), s = Math.sin(effect.heading || 0);
    const put = (X, Y, ch, color, b) => plot(X * c - Y * s, X * s + Y * c, ch, color, b);
    if (effect.stage === 'cast') dome(effect, put);
    else if (effect.stage === 'impact') splash(effect, put);
    else if (effect.stage === 'aura') wrap(effect, put);
    else if (effect.stage === 'zone') pool(effect, put);
    else surf(effect, put);
  },
  // Close water displacement rises into a broad returning wash. A bucket
  // splash supplies the shove; falling creek droplets mark the quiet pulse.
  sounds: {
    cast: [
      { kind: 'recording', url: '/assets/audio/spells/mitlan/water-lift.wav', gain: 0.62, rate: 0.85, delay: 0 },
      { kind: 'recording', url: '/assets/audio/spells/mitlan/wash.wav', gain: 0.46, rate: 0.9, delay: 0.3 },
    ],
    impact: [
      { kind: 'recording', url: '/assets/audio/spells/mitlan/water-strike.wav', gain: 0.67, rate: 0.82, delay: 0 },
      { kind: 'recording', url: '/assets/audio/spells/mitlan/droplets.wav', gain: 0.23, rate: 0.95, delay: 0.2 },
    ],
    pulse: [
      { kind: 'recording', url: '/assets/audio/spells/mitlan/droplets.wav', gain: 0.12, rate: 0.9, delay: 0 },
    ],
  },
};
