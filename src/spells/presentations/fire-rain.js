// Fire Rain: a burning cloud gathers over the caster and lets slanted, white-hot
// drops fall onto the field. Everything except the falling projectile is authored
// in screen space (x right, y down, metres) and counter-rotated against the effect
// heading, so flames always rise and rain always falls on screen. The projectile
// keeps its travel frame: local +z is the direction of flight.

// Heat ramp from cold ash (0) to white-hot (10).
const HEAT = [
  [72, 20, 14], [112, 30, 16], [160, 42, 18], [206, 60, 20], [236, 88, 24], [252, 118, 30],
  [255, 150, 42], [255, 184, 66], [255, 214, 112], [255, 236, 176], [255, 250, 230],
];
const RAMP = '.:-=+*#%@';
const H_TO_Y = 5 / 6.5; // the renderer lifts one metre of height by 5 rows; a ground metre spans 6.5
const TAU = Math.PI * 2;
// Progress at which each stage starts its final fade.
const FADE_FROM = { cast: 0.8, impact: 0.55, pulse: 0.55, aura: 0.55, zone: 0.85 };

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const heat = t => HEAT[Math.round(clamp(t, 0, 1) * 10)];
const ramp = t => RAMP[Math.round(clamp(t, 0, 1) * 8)];
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const easeOut = t => 1 - (1 - clamp(t, 0, 1)) ** 3;
const hash = n => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
const flicker = (age, i) => 0.78 + 0.22 * Math.sin(age * 29 + i * 2.3) * Math.sin(age * 7.1 + i * 1.7);
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;

// A streak glyph that follows an on-screen direction given in screen metres.
// One metre spans ~21.7 columns but only 6.5 rows, and a cell is ~0.6 as wide as
// it is tall, so a metre across looks about twice as long as a metre down.
function streak(dx, dy) {
  let angle = Math.atan2(dy, dx * 2);
  if (angle < 0) angle += Math.PI;
  if (angle < Math.PI / 8 || angle > Math.PI * 7 / 8) return '-';
  if (angle < Math.PI * 3 / 8) return '\\';
  if (angle < Math.PI * 5 / 8) return '|';
  return '/';
}

// An ellipse on the ground drawn with glyphs that follow its outline.
function ring(put, radius, count, spin, char, color, brightness) {
  for (let i = 0; i < count; i++) {
    const a = i / count * TAU + spin, c = Math.cos(a), s = Math.sin(a);
    put(c * radius, s * radius, char ?? streak(-s, c), color, brightness);
  }
}

// One burning drop: emerges from (x0, y0), accelerates down to (x1, y1).
function drop(put, x0, y0, x1, y1, u) {
  const q = u * u, along = streak(x1 - x0, y1 - y0);
  const emerge = smooth(0, 0.15, u), gap = 0.05 + 0.06 * u;
  put(x0 + (x1 - x0) * q, y0 + (y1 - y0) * q, '@', HEAT[10], emerge);
  for (let j = 1; j <= 4; j++) {
    const qj = q - j * gap;
    if (qj < 0) break;
    put(x0 + (x1 - x0) * qj, y0 + (y1 - y0) * qj, j < 3 ? along : j === 3 ? ':' : '.',
      HEAT[9 - j * 2], emerge * (1 - j * 0.19));
  }
}

// A crown of liquid fire where a drop lands, with droplets and a cooling scorch.
function splash(put, x, y, t, size) {
  const e = easeOut(t), rise = Math.sin(Math.PI * Math.min(1, t * 1.4)), fade = 1 - t;
  if (t < 0.35) put(x, y - 0.03 * size, t < 0.15 ? '@' : '*', HEAT[10 - Math.round(t * 8)], 1 - t / 0.35);
  for (const side of [-1, 1]) {
    put(x + side * (0.05 + 0.09 * e) * size, y - 0.13 * size * rise, side < 0 ? '\\' : '/',
      heat(0.85 - t * 0.6), fade);
    put(x + side * (0.12 + 0.24 * e) * size, y - 0.24 * size * rise, "'", heat(0.75 - t * 0.6), fade * 0.85);
    put(x + side * (0.1 + 0.36 * e) * size, y - 0.07 * size * rise + 0.02 * size, ',', heat(0.6 - t * 0.5), fade * 0.7);
  }
  put(x, y + 0.04 * size, '_', heat(0.45 - t * 0.35), fade * 0.65);
}

function drawCast(put, p, age, radius) {
  const s = clamp(radius, 0.8, 1.6) / 0.8;
  const cloudY = -3 * s * H_TO_Y;

  // Wind-up: a sigil ellipse flares at the caster's feet while sparks spiral up into the sky.
  const sigil = smooth(0, 0.06, p) * (1 - smooth(0.24, 0.46, p));
  if (sigil > 0) {
    const r = 1.25 * s * (1 - 0.18 * easeOut(p / 0.4));
    ring(put, r, 28, p * 1.4, null, heat(0.9 - p), sigil * 0.85);
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * TAU + p * 1.4 + Math.PI / 4;
      put(Math.cos(a) * r, Math.sin(a) * r, '*', HEAT[9], sigil);
    }
  }
  for (let i = 0; i < 18; i++) {
    const u = clamp((p - hash(i) * 0.12) / 0.3, 0, 1);
    if (u <= 0 || u >= 1) continue;
    // Each spark and its fading wake spiral inward from the sigil and up to the cloud.
    for (let j = 0; j < 2; j++) {
      const e = Math.max(0, u * u - j * 0.07), a = i / 18 * TAU + e * 2.4, r = 1.25 * s * (1 - e);
      put(Math.cos(a) * r, Math.sin(a) * r + cloudY * e, j ? "'" : '*',
        heat(0.6 + 0.4 * e - j * 0.3), Math.sin(Math.PI * u) * (1 - j * 0.45));
    }
  }

  // The burning cloud: a domed band of fire, hot underneath, smoky red on top.
  const form = easeOut(smooth(0.1, 0.4, p)), thin = smooth(0.66, 1, p);
  if (form > 0) {
    const width = 2 * s * (0.4 + 0.6 * form);
    for (let k = 0; k < 5; k++) {
      for (let j = 0; j < 21; j++) {
        const u = (j + (k % 2) * 0.5) / 20.5 * 2 - 1;
        const dome = Math.sqrt(Math.max(0, 1 - u * u));
        const churn = Math.sin(j * 1.9 + k * 2.3 + age * 2.2) * 0.5 + Math.sin(j * 0.7 - age * 1.4 + k) * 0.5;
        const v = (dome * 1.2 - k * 0.24 + churn * 0.13) * form - thin * 1.25;
        if (v <= 0.12) continue;
        // Glyphs crossing the visibility threshold fade in (and out as the cloud thins) instead of popping.
        const t = clamp(v, 0, 1), emerge = smooth(0.12, 0.4, v);
        put(u * width + Math.sin(age * 1.6 + k * 1.3 + j) * 0.03,
          cloudY - k * 0.17 * s + (1 - dome) * 0.18 * s - thin * 0.25,
          ramp(t * 0.9), heat(0.3 + 0.55 * t - k * 0.07 + 0.08 * Math.sin(age * 9 + j)), (0.35 + 0.65 * t) * emerge);
      }
    }
  }

  // Rain: sixteen drops leave the cloud's underside on a slant and splash across the field.
  for (let i = 0; i < 16; i++) {
    const start = 0.28 + i / 15 * 0.34 + (hash(i + 40) - 0.5) * 0.03;
    const u = (p - start) / 0.22;
    if (u < 0) continue;
    const gx = (hash(i * 3 + 1) * 2 - 1) * 1.7 * s, gy = (hash(i * 3 + 2) * 2 - 1) * 0.7 * s;
    if (u < 1) drop(put, gx - 0.45 * s, cloudY + 0.05, gx, gy, u);
    else if (u < 1 + 0.2 / 0.22) splash(put, gx, gy, (u - 1) * 0.22 / 0.2, s);
  }
}

function drawProjectile(plot, age, progress, heading) {
  const env = (1 - progress) ** 0.5;
  if (env <= 0) return;
  const put = (x, z, char, color, brightness) => plot(x, z, char, color, brightness * env);
  const sin = Math.sin(heading), cos = Math.cos(heading);
  // Local +z runs along (sin, cos) on the ground; local +x along (cos, -sin).
  const along = streak(sin, cos);
  const step = 1.1 / Math.hypot(sin * 21.7, cos * 6.5), side = 1.15 / Math.hypot(cos * 21.7, sin * 6.5);
  const count = Math.min(26, Math.ceil(1.6 / step));
  for (let j = 1; j <= count; j++) {
    const f = j / count, t = 1 - f, glow = flicker(age, j);
    const z = -j * step - 0.04, wave = Math.sin(age * 19 - j * 0.8) * side * 0.6 * f;
    put(wave, z, j < 3 ? '#' : f < 0.55 ? along : ramp(t * 0.55), heat(t * 0.95 + 0.05 * glow), t ** 0.7 * glow);
    if (f < 0.4 && j % 2 === 0) {
      for (const sideSign of [-1, 1]) {
        put(wave + sideSign * side * (1 + (1 - f) * 0.7), z, ramp(t * 0.6), heat(t * 0.8), t * 0.7 * glow);
      }
    }
  }
  // A white-hot head wrapped in a flickering shell.
  put(0, 0, '@', HEAT[10], 1);
  for (let k = 0; k < 6; k++) {
    const a = k / 6 * TAU + age * 6;
    put(Math.cos(a) * side * 1.1, Math.sin(a) * step * 1.1, k % 2 ? '*' : '#', HEAT[8 - (k % 3)], 0.8 * flicker(age, k + 30));
  }
  // Sparks shed from the head drift back and outward, then wink out.
  for (let i = 0; i < 10; i++) {
    const tau = (age / 0.35 + hash(i + 70)) % 1;
    const drift = (hash(i + 90) - 0.5) * 2;
    put(drift * tau * side * 9, -(0.12 + tau * 1.1 + hash(i + 80) * 0.2), tau < 0.35 ? '*' : tau < 0.7 ? "'" : '.',
      heat(0.9 - tau * 0.7), Math.sin(Math.PI * tau));
  }
}

// A falling drop bursts on the ground: a white-hot fireball blossom, a shock ring
// marking the blast, flame tongues standing up off the ring and thrown debris.
function drawStrike(put, p, age, radius) {
  const R = clamp(radius, 2.5, 5), e = easeOut(p), env = 1 - smooth(0.45, 1, p);
  // Fireball: three concentric bands, white-hot inside, cooling and thinning outward.
  const ball = 1 - smooth(0.2, 0.75, p), grow = 0.35 + 0.65 * easeOut(p * 2.2);
  if (ball > 0) {
    const bands = [[0.12, 6, 1], [0.26, 10, 0.78], [0.42, 16, 0.55]];
    for (let k = 0; k < 3; k++) {
      const [r, n, t] = bands[k];
      for (let i = 0; i < n; i++) {
        const a = (i + k * 0.5) / n * TAU, wob = 1 + 0.12 * Math.sin(a * 3 + age * 20 + k);
        const size = r * grow * wob * R / 5;
        put(Math.cos(a) * size, Math.sin(a) * size * 1.4 - size * 0.6,
          ramp(t - p * 0.6), heat(t + 0.1 - p * 0.9), ball * (0.55 + 0.45 * t));
      }
    }
    put(0, -0.05, p < 0.15 ? '@' : '%', HEAT[10], ball);
  }
  // Shock ring with its glyphs following the outline.
  const rr = R * (0.15 + 0.4 * e);
  ring(put, rr, Math.round(clamp(rr * 18, 20, 40)), 0, null, heat(0.95 - p * 0.85), env * (1 - p * 0.4));
  // Flame tongues stand up off the ring and sink back as it widens.
  const lick = Math.sin(Math.PI * Math.min(1, p * 1.3));
  for (let k = 0; k < 8; k++) {
    const a = (k + 0.5) / 8 * TAU, h = R * 0.22 * lick * (0.7 + 0.3 * hash(k + 5)) * flicker(age, k);
    const x = Math.cos(a) * rr * 0.9, y = Math.sin(a) * rr * 0.9;
    put(x, y - h * 0.4 * H_TO_Y, '#', heat(0.9 - p * 0.4), env);
    put(x + Math.sin(age * 9 + k) * 0.03, y - h * H_TO_Y, '^', heat(0.65 - p * 0.4), env * 0.8);
  }
  // Burning debris thrown outward on short ballistic arcs, cooling as it lands.
  for (let i = 0; i < 10; i++) {
    const a = hash(i + 11) * TAU, dist = R * (0.2 + 0.45 * hash(i + 23)) * e;
    const up = R * 0.35 * (0.4 + 0.6 * hash(i + 37)) * Math.sin(Math.PI * Math.min(1, p * 1.1));
    put(Math.cos(a) * dist, Math.sin(a) * dist - up * H_TO_Y, p < 0.5 ? "'" : '.', heat(0.9 - p * 0.75), 1 - p * 0.7);
  }
}

function drawCinders(put, p, age, radius) {
  const R = clamp(radius, 0.4, 2), fall = (1 - Math.min(1, p * 1.6)) ** 2;
  for (let i = 0; i < 6; i++) {
    const a = hash(i + 3) * TAU, d = hash(i + 9) * 0.35 * R;
    const lift = 0.5 * R * fall * (0.5 + hash(i + 15) * 0.5);
    put(Math.cos(a) * d, Math.sin(a) * d * 0.6 - lift * H_TO_Y, lift > 0.04 ? "'" : p < 0.7 ? '*' : '.',
      heat(0.85 - p * 0.7), 1 - p);
  }
  for (const side of [-1, 1]) {
    put(side * 0.09 * R + Math.sin(age * 13) * 0.02, 0.02, '~', heat(0.4), 0.5 * (1 - p) * flicker(age, side));
  }
}

// The return anchor's ward ticks every 0.05 s, so its copies overlap: each one is a
// lean ripple swelling out from the brazier and cooling, and together they read as
// a steady train of concentric heat rings.
function drawSigil(put, p, radius) {
  const R = clamp(radius, 0.5, 3), r = R * (0.2 + 0.8 * easeOut(p));
  ring(put, r, 16, 0, null, heat(0.9 - p * 0.7), (1 - p) * 0.8);
}

function drawImpact(put, p, age, radius) {
  const R = clamp(radius, 0.6, 3), env = 1 - smooth(0.5, 1, p);
  if (p < 0.25) {
    const f = 1 - p / 0.25;
    put(0, -0.05, '@', HEAT[10], f);
    for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      put(x * 0.12 * R * (1 + p * 3), y * 0.08 * R * (1 + p * 3) - 0.05, '*', HEAT[9], f);
    }
  }
  // Scorched ground spreads under the target and cools from orange to ash.
  ring(put, 0.6 * R * (0.25 + 0.75 * easeOut(Math.min(1, p * 3))), 18, 0.2, null, heat(0.55 - p * 0.45), 0.75 * env);
  // Flame tongues wrap the target in a bonfire silhouette: tallest in the middle,
  // bright roots, licking bodies that sway more as they climb, and red tips.
  const rise = Math.sin(Math.PI * Math.min(1, p * 1.2)) ** 0.7;
  for (let k = 0; k < 9; k++) {
    const u = k / 8 * 2 - 1, bx = u * 0.45 * R, by = Math.sin(k * 1.3) * 0.1 * R;
    const h = (0.45 + 0.75 * (1 - Math.abs(u))) * (0.8 + 0.2 * hash(k + 50)) * rise * flicker(age, k);
    const segments = Math.min(8, Math.round(h * 6.5));
    for (let m = 0; m < segments; m++) {
      const t = 1 - m / 8, sway = Math.sin(age * 8 + k * 1.7 + m * 0.6) * 0.07 * R * (m / 7) ** 1.5;
      const char = m === segments - 1 ? (k % 2 ? '^' : "'") : ramp(t * 0.95);
      put(bx + sway, by - (m + 0.5) * 0.18 * R, char, heat(0.25 + 0.72 * t - p * 0.2), env * (0.45 + 0.55 * t));
    }
  }
  // Embers ride the heat upward, drifting and cooling.
  for (let i = 0; i < 12; i++) {
    const tau = clamp((p - hash(i + 60) * 0.35) / 0.55, 0, 1);
    if (tau <= 0 || tau >= 1) continue;
    const x = (hash(i + 61) * 2 - 1) * 0.5 * R + Math.sin(tau * 6 + i) * 0.1 * R;
    put(x, -tau * 1.5 * R * H_TO_Y, tau < 0.4 ? '*' : "'", heat(0.85 - tau * 0.75), Math.sin(Math.PI * tau));
  }
}

function drawAura(put, p, age, radius) {
  const R = clamp(radius, 0.5, 2.5);
  // Heat haze across the take-off ring.
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * TAU + age * 0.8;
    put(Math.cos(a) * 0.6 * R, Math.sin(a) * 0.6 * R, i % 2 ? '~' : '-', heat(0.35 + 0.2 * flicker(age, i)),
      0.55 * flicker(age, i + 20));
  }
  // An updraft: sparks spiral up around the caster and cool as they climb.
  for (let i = 0; i < 14; i++) {
    const tau = (age / 0.55 + hash(i + 100)) % 1, a = i * 2.4 + age * 3.5, r = 0.5 * R * (1 - 0.5 * tau);
    const y = Math.sin(a) * r * 0.6 - tau * 2.2 * R * H_TO_Y;
    put(Math.cos(a) * r, y, tau < 0.4 ? '*' : tau < 0.75 ? "'" : '.', heat(0.9 - tau * 0.7), Math.sin(Math.PI * tau));
  }
  // Short flames jet from the feet.
  for (let k = 0; k < 5; k++) {
    const h = R * (0.3 + 0.25 * hash(k + 120)) * flicker(age, k + 7);
    for (let m = 0; m < 3; m++) {
      put((k - 2) * 0.14 * R + Math.sin(age * 10 + k + m) * 0.02, -(m + 0.5) / 3 * h * H_TO_Y * 1.4, '#*^'[m],
        heat(0.9 - m * 0.25), 1 - m * 0.25);
    }
  }
}

// The return anchor: a burning boundary with heat waves running around it, a
// brazier flame at its heart, and drops still falling inside it.
// The totem's 4 m hit radius never deals damage, so the visible boundary is drawn
// tighter, where the zone budget can keep its outline continuous on screen.
const COLS = 13 / 0.6, ROWS = 6.5; // cells per metre across and down the screen
const BOUNDARY_GAP = 1.6; // cells between boundary marks, so at most one empty cell between neighbours
const BOUNDARY_MARKS = 96;
const BOUNDARY_STEPS = 480;

function drawZone(put, p, age, radius) {
  const R = clamp(radius * 0.4, 0.8, 1.6);
  // Space the marks evenly along the projected outline: the ellipse is about 3.3 times
  // wider than tall in cells, so equal angles would leave wide gaps along its top and bottom.
  const a = R * COLS, b = R * ROWS;
  const perimeter = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
  const marks = Math.min(BOUNDARY_MARKS, Math.ceil(perimeter / BOUNDARY_GAP)), gap = perimeter / marks;
  let travelled = 0, placed = 0, px = a, py = 0;
  for (let step = 0; step <= BOUNDARY_STEPS && placed < marks; step++) {
    const ang = step / BOUNDARY_STEPS * TAU, c = Math.cos(ang), s = Math.sin(ang);
    travelled += Math.hypot(c * a - px, s * b - py);
    px = c * a; py = s * b;
    if (travelled + 1e-9 < placed * gap) continue;
    placed++;
    const w = 0.5 + 0.5 * Math.sin(ang * 3 - age * 2.4) * Math.sin(ang * 2 + age * 1.1);
    put(c * R, s * R, w > 0.72 ? '#' : streak(-s, c), heat(0.3 + 0.55 * w), 0.25 + 0.6 * w);
  }
  for (let k = -2; k <= 2; k++) {
    const h = (4 - Math.abs(k) * 1.2) * (0.75 + 0.25 * flicker(age, k + 50));
    for (let m = 0; m < Math.round(h); m++) {
      const t = 1 - m / 4;
      put(k * 0.05 + Math.sin(age * 7 + k + m * 0.8) * 0.012 * m, -(m + 0.3) * 0.16,
        m === Math.round(h) - 1 ? '^' : ramp(t * 0.82), heat(0.35 + 0.65 * t - Math.abs(k) * 0.08), 0.5 + 0.5 * t);
    }
  }
  for (let i = 0; i < 6; i++) {
    const cycle = age / 0.7 + hash(i + 140), n = Math.floor(cycle), tau = cycle - n;
    const gx = (hash(i * 7 + n * 13) * 2 - 1) * 0.75 * R, gy = (hash(i * 7 + n * 13 + 1) * 2 - 1) * 0.5 * R;
    if (tau < 0.55) drop(put, gx - 0.4, gy - 2.2 * H_TO_Y, gx, gy, tau / 0.55);
    else if (tau < 0.9) splash(put, gx, gy, (tau - 0.55) / 0.35, 1);
  }
}

export default {
  id: 'fire-rain',
  duration: 1.35,
  draw(effect, plot) {
    const age = Math.max(0, finite(effect.age, 0));
    const life = Number.isFinite(effect.life) && effect.life > 0 ? effect.life : 1.35;
    const progress = clamp(finite(effect.progress, age / life), 0, 1);
    if (progress >= 1) return;
    const heading = finite(effect.heading, 0);
    if (effect.stage === 'projectile') { drawProjectile(plot, age, progress, heading); return; }

    // Every other stage fades out with its own envelope; counter-rotate to screen space.
    const env = (1 - smooth(FADE_FROM[effect.stage] ?? FADE_FROM.cast, 1, progress)) * (effect.stage === 'aura' || effect.stage === 'zone'
      ? smooth(0, 0.08, progress) : 1);
    if (env <= 0) return;
    const c = Math.cos(heading), s = Math.sin(heading);
    const put = (x, y, char, color, brightness) => plot(x * c - y * s, x * s + y * c, char, color,
      clamp(brightness, 0, 1) * env);
    const radius = finite(effect.radius, effect.stage === 'cast' ? 0.8 : 1);
    if (effect.stage === 'impact') drawImpact(put, progress, age, radius);
    else if (effect.stage === 'pulse') {
      if (effect.shape === 'ward') drawSigil(put, progress, radius);
      else if (radius >= 2.5) drawStrike(put, progress, age, radius);
      else drawCinders(put, progress, age, radius);
    } else if (effect.stage === 'aura') drawAura(put, progress, age, radius);
    else if (effect.stage === 'zone') drawZone(put, progress, age, radius);
    else drawCast(put, progress, age, radius);
  },
  sounds: {
    cast: [
      { kind: 'noise', delay: 0, duration: 0.34, gain: 0.035, attack: 0.13, release: 0.17, cutoff: 1500, filterType: 'bandpass' },
      { kind: 'tone', delay: 0, duration: 0.34, gain: 0.026, attack: 0.12, release: 0.16, frequency: 310, endFrequency: 1480, type: 'triangle', cutoff: 2400 },
      { kind: 'tone', delay: 0.24, duration: 0.23, gain: 0.034, attack: 0.025, release: 0.12, frequency: 1800, endFrequency: 530, type: 'sine' },
      { kind: 'noise', delay: 0.42, duration: 0.13, gain: 0.043, attack: 0.006, release: 0.11, cutoff: 2300, filterType: 'highpass' },
      { kind: 'tone', delay: 0.55, duration: 0.25, gain: 0.032, attack: 0.025, release: 0.14, frequency: 1540, endFrequency: 420, type: 'sine' },
      { kind: 'noise', delay: 0.75, duration: 0.14, gain: 0.04, attack: 0.006, release: 0.12, cutoff: 1800, filterType: 'highpass' },
      { kind: 'tone', delay: 0.89, duration: 0.23, gain: 0.031, attack: 0.025, release: 0.12, frequency: 2080, endFrequency: 640, type: 'sine' },
      { kind: 'noise', delay: 1.07, duration: 0.17, gain: 0.04, attack: 0.006, release: 0.14, cutoff: 2600, filterType: 'highpass' },
    ],
    impact: [
      { kind: 'tone', delay: 0, duration: 0.16, gain: 0.044, attack: 0.006, release: 0.12, frequency: 1050, endFrequency: 180, type: 'triangle' },
      { kind: 'noise', delay: 0.07, duration: 0.24, gain: 0.072, attack: 0.008, release: 0.2, cutoff: 2100, filterType: 'highpass' },
      { kind: 'tone', delay: 0.18, duration: 0.15, gain: 0.033, attack: 0.006, release: 0.11, frequency: 1340, endFrequency: 240, type: 'sine' },
      { kind: 'noise', delay: 0.25, duration: 0.22, gain: 0.054, attack: 0.008, release: 0.18, cutoff: 2800, filterType: 'highpass' },
      { kind: 'tone', delay: 0.39, duration: 0.16, gain: 0.028, attack: 0.006, release: 0.12, frequency: 890, endFrequency: 150, type: 'sine' },
      { kind: 'noise', delay: 0.46, duration: 0.28, gain: 0.044, attack: 0.008, release: 0.23, cutoff: 1600, filterType: 'highpass' },
    ],
    pulse: [
      { kind: 'noise', delay: 0, duration: 0.075, gain: 0.022, attack: 0.004, release: 0.065, cutoff: 2400, filterType: 'highpass' },
    ],
  },
};
