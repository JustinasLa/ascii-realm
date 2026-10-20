// Woodland Anvil: a living-wood anvil grows out of the ground in front of the
// caster, a raised mallet slams onto it, and the blow rolls forward as a
// cresting earth wave that splits the soil and lifts the foes it reaches.
//
// Everything lies on the ground plane: local +z is the cast heading and the
// shared adapter rotates it. Two things are view aware but still pure functions
// of the effect state: line glyphs pick the stroke (- \ | /) that matches their
// on-screen direction, and airborne parts (mallet, clods, leaves) are lifted
// toward the top of the screen the same way the game lifts projectiles.
const TAU = Math.PI * 2;
const flash = [255, 252, 228], gold = [240, 226, 136], leafLight = [198, 244, 146], leaf = [128, 206, 92],
  moss = [86, 152, 74], wood = [206, 150, 78], woodDark = [132, 90, 50], soil = [160, 127, 80],
  soilDark = [104, 82, 56];

const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeOut = t => 1 - (1 - clamp01(t)) ** 3;
const easeIn = t => clamp01(t) ** 3;
const hash = (i, salt) => { const s = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453; return s - Math.floor(s); };
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
// Hot fissure light cools from white through gold and leaf green into soil.
const heat = t => t > 0.66 ? mix(gold, flash, (t - 0.66) / 0.34) : t > 0.33 ? mix(leafLight, gold, (t - 0.33) / 0.33)
  : mix(soilDark, leafLight, t / 0.33);
const RAMP = '.:-=+*#%@';
const ramp = v => RAMP[Math.max(0, Math.min(8, Math.floor(clamp01(v) * 8.99)))];

// The view basis for the current call (set at the top of draw).
let cos = 1, sin = 0;
const LIFT = 5 / 6.5; // the game lifts airborne things five rows per metre of height
const liftX = h => LIFT * h * sin, liftZ = h => -LIFT * h * cos;
function stroke(dx, dz) {
  const wx = dx * cos + dz * sin, wz = dz * cos - dx * sin;
  let a = Math.atan2(wz * 6.5, wx * 13);
  if (a < 0) a += Math.PI;
  return a < 0.39 || a >= 2.75 ? '-' : a < 1.18 ? '\\' : a < 1.96 ? '|' : '/';
}
function cells(dx, dz) {
  const wx = dx * cos + dz * sin, wz = dz * cos - dx * sin;
  return Math.hypot(wx * 21.7, wz * 6.5);
}
// A straight run of glyphs spaced about `gap` screen cells apart.
function line(plot, x0, z0, x1, z1, gap, max, color, b, char) {
  const dx = x1 - x0, dz = z1 - z0, ch = char ?? stroke(dx, dz);
  const n = Math.max(1, Math.min(max, Math.round(cells(dx, dz) / gap)));
  for (let i = 0; i < n; i++) { const t = (i + 0.5) / n; plot(x0 + dx * t, z0 + dz * t, ch, color, b); }
}

// Top-down anvil: horn toward +z, flat face, heel, four splayed feet.
const ANVIL = [[0, 0.95], [0.13, 0.66], [0.36, 0.46], [0.36, -0.42], [0.26, -0.6],
  [-0.26, -0.6], [-0.36, -0.42], [-0.36, 0.46], [-0.13, 0.66]];
function anvil(plot, cx, cz, k, b, grow, glow) {
  if (b <= 0) return;
  const tone = mix(mix(moss, wood, grow), glow > 0.5 ? flash : gold, clamp01(glow));
  for (let e = 0; e < ANVIL.length; e++) {
    const [x0, z0] = ANVIL[e], [x1, z1] = ANVIL[(e + 1) % ANVIL.length];
    // The wood sprouts from the heel toward the horn tip.
    const reach = clamp01((grow * 1.25 - (Math.min(z0, z1) + 0.6) / 1.55) * 5);
    if (reach > 0) line(plot, cx + x0 * k, cz + z0 * k, cx + x1 * k, cz + z1 * k, 1.3, 10, tone, b * reach);
  }
  const g = clamp01(grow * 2 - 1);
  if (g <= 0) return;
  for (const [fx, fz] of [[-0.5, 0.32], [0.5, 0.32], [-0.46, -0.66], [0.46, -0.66]]) {
    plot(cx + fx * k, cz + fz * k, '%', mix(woodDark, tone, glow), b * g * 0.85);
  }
  plot(cx, cz - 0.4 * k, 'o', woodDark, b * g);
  // Grain runs along the working face; it glows when the mallet lands.
  for (const gx of [-0.16, 0.16]) line(plot, cx + gx * k, cz - 0.3 * k, cx + gx * k, cz + 0.36 * k, 2.2, 4,
    mix(woodDark, gold, glow), b * g * (0.45 + 0.55 * glow));
  // Woodland leaves cling to the horn and heel.
  plot(cx + 0.06 * k, cz + 1.05 * k, ',', leafLight, b * g);
  plot(cx - 0.34 * k, cz - 0.72 * k, '\'', leaf, b * g * 0.8);
  plot(cx + 0.34 * k, cz - 0.72 * k, ',', leaf, b * g * 0.8);
}

// A jagged fissure from (cx, cz) at angle `ang`; `grow` reveals it and `hot` sets its light.
function crack(plot, cx, cz, ang, len, grow, seed, b, hot, segments = 5) {
  if (b <= 0 || grow <= 0) return;
  const ux = Math.sin(ang), uz = Math.cos(ang);
  let px = cx, pz = cz;
  for (let k = 1; k <= segments; k++) {
    const reveal = clamp01(grow * segments - (k - 1));
    if (reveal <= 0) break;
    const d = len * k / segments, j = (hash(seed, k) - 0.5) * 0.36 * len / segments * 2;
    let nx = cx + ux * d + uz * j, nz = cz + uz * d - ux * j;
    nx = px + (nx - px) * reveal; nz = pz + (nz - pz) * reveal;
    // The newest stretch of the fissure is hottest; the origin cools first.
    const t = clamp01(hot * (0.55 + 0.45 * k / segments));
    line(plot, px, pz, nx, nz, 2.1, 3, heat(t), b * (0.55 + 0.45 * t));
    px = nx; pz = nz;
  }
}

// A ground ring: crisp tangent strokes at the front and kicked dust behind.
function ring(plot, cx, cz, r, front, back, b, color, dust, wobble, seed) {
  for (let i = 0; i < front; i++) {
    const a = TAU * (i + hash(i, seed) * 0.35) / front, rr = r * (1 + Math.sin(a * 7 + seed) * wobble);
    const x = cx + Math.sin(a) * rr, z = cz + Math.cos(a) * rr;
    plot(x, z, stroke(Math.cos(a), -Math.sin(a)), color, b * (0.75 + 0.25 * hash(i, seed + 1)));
  }
  for (let i = 0; i < back; i++) {
    const a = TAU * (i + 0.5) / back, rr = r * (0.82 - 0.1 * hash(i, seed + 2));
    plot(cx + Math.sin(a) * rr, cz + Math.cos(a) * rr, ramp(0.1 + 0.4 * hash(i, seed + 3) * b), dust, b * 0.55);
  }
}

// Clods of earth thrown out ballistically with drag; they land and settle.
function clods(plot, cx, cz, n, t, seed, b, spread, up) {
  for (let i = 0; i < n; i++) {
    const a = TAU * (i + (hash(i, seed) - 0.5) * 0.6) / n, v = spread * (0.6 + 0.8 * hash(i, seed + 1));
    const vz = up * (0.6 + 0.6 * hash(i, seed + 2)), d = v * (1 - Math.exp(-2.4 * t)) / 2.4;
    const h = Math.max(0, vz * t - 4.9 * t * t), landed = h === 0 && t > 0.05;
    const x = cx + Math.sin(a) * (0.25 + d), z = cz + Math.cos(a) * (0.25 + d);
    const ch = landed ? '.' : h > 0.45 ? (i % 3 ? '#' : '%') : h > 0.15 ? 'o' : '+';
    plot(x + liftX(h), z + liftZ(h), ch, mix(i % 2 ? soil : wood, gold, clamp01(0.4 - t) * 1.5),
      b * (landed ? 0.45 : 1) * (1 - clamp01((t - 0.5) * 1.2)));
  }
}

// Leaves shaken loose: they flutter, drift outward and sink.
function leaves(plot, cx, cz, n, t, age, seed, b, height, reach) {
  for (let i = 0; i < n; i++) {
    const a = TAU * (i + hash(i, seed)) / n, s = easeOut(t * (0.8 + 0.4 * hash(i, seed + 1)));
    const r = 0.3 + reach * s, sway = Math.sin(age * 7 + i * 1.9) * 0.14;
    const h = Math.max(0, height * (0.6 + 0.6 * hash(i, seed + 2)) * (1 - s * 0.85) + Math.sin(age * 5 + i) * 0.05);
    const x = cx + Math.sin(a) * r + Math.cos(a) * sway, z = cz + Math.cos(a) * r - Math.sin(a) * sway;
    plot(x + liftX(h), z + liftZ(h), Math.sin(age * 9 + i * 2.3) > 0 ? ',' : '\'',
      mix(leafLight, leaf, hash(i, seed + 3)), b * (1 - s * 0.5));
  }
}

const AT = 0.545; // mallet contact, matching the delayed wooden strike in the cast sound

function cast(effect, plot) {
  const p = effect.progress, end = 1 - smooth(0.8, 1, p), cz = 0.95;
  // Wind-up: six roots spiral in along the ground and feed the growing anvil.
  const gather = smooth(0, 0.42, p), rootFade = 1 - smooth(0.36, 0.5, p);
  if (rootFade > 0) for (let i = 0; i < 6; i++) {
    const a0 = TAU * i / 6 + 0.3;
    for (let j = 0; j < 8; j++) {
      const u = Math.max(0, gather - j * 0.055), r = 2.5 * (1 - u) + 0.45 * u, a = a0 + 1.4 * u;
      const r2 = 2.5 * (1 - u - 0.02) + 0.45 * (u + 0.02), a2 = a0 + 1.4 * (u + 0.02);
      const x = Math.sin(a) * r, z = cz + Math.cos(a) * r;
      plot(x, z, j ? stroke(Math.sin(a2) * r2 - x, cz + Math.cos(a2) * r2 - z) : '*', j ? mix(leaf, moss, j / 8) : leafLight,
        rootFade * (1 - j / 9) * (0.5 + 0.5 * gather));
    }
  }
  // The anvil grows in, flashes on contact, cools, then sinks back into the soil.
  const after = clamp01((p - AT) / (1 - AT)), struck = p >= AT ? 1 - smooth(0, 0.55, after) : 0;
  anvil(plot, 0, cz, 1, end * (0.55 + 0.45 * smooth(0, 0.3, p)) * (1 - 0.35 * smooth(0.4, 1, after)),
    smooth(0, 0.38, p), struck);
  // Mallet: lifted with anticipation, held, then slammed down at contact.
  let h;
  if (p < 0.4) h = 1.7 * easeOut((p - 0.06) / 0.3);
  else if (p < 0.45) h = 1.7 + 0.18 * Math.sin((p - 0.4) / 0.05 * Math.PI / 2);
  else if (p < AT) h = 1.88 * (1 - easeIn((p - 0.45) / (AT - 0.45)));
  else h = 0.28 * Math.sin(Math.min(1, after / 0.22) * Math.PI) * (1 - after);
  const mallet = smooth(0.02, 0.12, p) * (1 - smooth(0.06, 0.22, after)) * end;
  if (mallet > 0) {
    const mx = liftX(h), mz = cz + 0.05 + liftZ(h), w = 0.4, d = 0.17;
    const body = mix(woodDark, wood, 0.4 + 0.6 * smooth(0, 0.3, p));
    line(plot, mx - w, mz + d, mx + w, mz + d, 1.3, 14, body, mallet);
    line(plot, mx - w, mz - d, mx + w, mz - d, 1.3, 14, body, mallet);
    line(plot, mx - w, mz - d, mx - w, mz + d, 1.3, 4, body, mallet);
    line(plot, mx + w, mz - d, mx + w, mz + d, 1.3, 4, body, mallet);
    for (const s of [-1, 1]) plot(mx + s * w, mz, '#', mix(wood, gold, struck), mallet);
    line(plot, mx - w * 0.6, mz, mx + w * 0.6, mz, 2.4, 5, woodDark, mallet * 0.7, ':');
    // The haft runs back to the caster's hands.
    line(plot, mx, mz - d, liftX(h * 0.45), 0.15 + liftZ(h * 0.45), 1.5, 7, woodDark, mallet * 0.9);
    // Speed streaks during the slam.
    if (p > 0.45 && p < AT) for (let k = 1; k <= 3; k++) {
      for (const s of [-0.75, 0, 0.75]) plot(mx + s * w + liftX(k * 0.28), mz + liftZ(k * 0.28),
        stroke(liftX(1), liftZ(1)), gold, mallet * (0.7 - k * 0.18) * smooth(0.45, 0.5, p));
    }
    // Shadow sharpens as the head comes down.
    const sh = Math.max(0, 1 - h / 2.2);
    for (let i = 0; i < 9; i++) {
      const a = TAU * i / 9, rx = 0.3 + 0.16 * h, rz = 0.14 + 0.07 * h;
      plot(Math.sin(a) * rx, cz + 0.05 + Math.cos(a) * rz, sh > 0.7 ? ':' : '.', soilDark, mallet * (0.2 + 0.5 * sh));
    }
  }
  if (p < AT) return;
  const t = (p - AT) * (effect.life || 1.1);
  // Contact flash and sparks.
  const spark = 1 - smooth(0, 0.22, after);
  if (spark > 0) {
    plot(0, cz, '@', flash, spark); plot(0.12, cz + 0.12, '*', flash, spark); plot(-0.12, cz - 0.1, '*', gold, spark);
    for (let i = 0; i < 8; i++) {
      const a = TAU * (i + 0.5 * hash(i, 9)) / 8, r = 0.3 + 1.3 * easeOut(after / 0.22) * (0.7 + 0.3 * hash(i, 8));
      plot(Math.sin(a) * r, cz + Math.cos(a) * r, stroke(Math.sin(a), Math.cos(a)), mix(gold, flash, spark), spark);
    }
  }
  // Shockwave ring rolls out across the clearing.
  const ringB = end * (1 - smooth(0.15, 0.95, after)) ** 1.1;
  if (ringB > 0) ring(plot, 0, cz, 0.55 + 2.3 * easeOut(after * 1.25), 36, 16, ringB,
    after < 0.12 ? flash : mix(leafLight, soil, smooth(0.1, 0.7, after)), soil, 0.035, 3);
  // Fissures split from the anvil feet; they glow, then cool to soil.
  for (let i = 0; i < 6; i++) {
    const a = TAU * (i + 0.5 + (hash(i, 11) - 0.5) * 0.5) / 6;
    crack(plot, Math.sin(a) * 0.45, cz + Math.cos(a) * 0.3, a, 1.3 + 0.9 * hash(i, 12), easeOut(after / 0.3), i + 20,
      end * (1 - 0.4 * after), 1 - smooth(0, 0.8, after), 4);
  }
  clods(plot, 0, cz, 14, t, 30, end, 2.6, 3.4);
  leaves(plot, 0, cz, 10, after, effect.age, 40, end, 0.9, 1.5);
}

function projectile(effect, plot) {
  const p = effect.progress, a = effect.age, env = Math.min(1, 0.4 + a / 0.12) * (1 - smooth(0.85, 1, p));
  const trav = a * 8;
  // Cresting bow wave: a bright rolling lip with heaved earth just behind it.
  for (let i = 0; i <= 18; i++) {
    const u = i / 9 - 1, x = u * 0.95, z = 0.3 - 0.5 * u * u, edge = 1 - Math.abs(u);
    const h = 0.1 + 0.08 * Math.sin(a * 15 - i * 0.9) * edge;
    plot(x + liftX(h), z + liftZ(h), stroke(0.1, -u * 0.1), mix(soil, mix(leafLight, gold, 0.5 + 0.5 * Math.sin(a * 9 + i)), 0.35 + 0.65 * edge),
      env * (0.55 + 0.45 * edge));
    if (i % 2 === 0 && i > 0 && i < 18) {
      const hb = 0.04 + 0.05 * Math.sin(a * 15 - i * 0.9 - 1.2);
      plot(x * 0.92 + liftX(hb), z - 0.17 + liftZ(hb), ramp(0.55 + 0.4 * edge * (0.6 + 0.4 * Math.sin(a * 11 + i))),
        mix(woodDark, soil, edge), env * (0.6 + 0.3 * edge));
    }
  }
  // The anvil's echo rides the crest.
  const bob = 0.22 + 0.05 * Math.sin(a * 10);
  anvil(plot, liftX(bob), -0.2 + liftZ(bob), 0.36, env * 0.8, 1, 0.35 + 0.25 * Math.sin(a * 12));
  // World-fixed fissure wake: it scrolls back as the wave advances and cools behind.
  let px = 0, pz = -0.3;
  for (let k = 0; k < 14; k++) {
    const zl = -0.3 - (k + 1) * 0.16, s = (trav + zl) / 0.3, n = Math.floor(s), f = s - n;
    const x = ((hash(n, 50) - 0.5) * (1 - f) + (hash(n + 1, 50) - 0.5) * f) * 0.34 * Math.min(1, k / 3 + 0.3);
    const cool = k / 14;
    if (-zl < trav + 0.3) plot(x, zl, stroke(x - px, zl - pz), heat(1 - cool * 0.9), env * (1 - cool * 0.7));
    px = x; pz = zl;
  }
  // Earth folds outward along both sides of the wake.
  for (let k = 0; k < 6; k++) for (const side of [-1, 1]) {
    const zl = -0.25 - k * 0.32, wide = 0.42 + 0.2 * k;
    if (-zl > trav + 0.3) continue;
    plot(side * (wide + 0.05 * Math.sin(a * 6 + k)), zl, ramp(0.35 - k * 0.05), soil, env * (0.75 - k * 0.1));
  }
  // Grass springs up in the fresh fissure, world-fixed, growing the longer it has been passed.
  for (let k = 0; k < 7; k++) {
    const s0 = Math.floor(trav / 0.42) - k, zl = s0 * 0.42 - trav;
    if (zl > -0.5 || zl < -2.6 || s0 < 0) continue;
    const grown = clamp01((-zl - 0.5) / 1.2), side = hash(s0, 60) > 0.5 ? 1 : -1;
    plot(side * (0.12 + 0.12 * hash(s0, 61)), zl, grown > 0.6 ? '"' : grown > 0.25 ? '\'' : ',', mix(leaf, leafLight, grown),
      env * (0.4 + 0.5 * grown) * (1 - smooth(1.8, 2.6, -zl)));
  }
  // Pebbles hop off the crest.
  for (let i = 0; i < 8; i++) {
    const f = (a * 1.7 + hash(i, 70)) % 1, side = i % 2 ? 1 : -1;
    const h = 0.55 * 4 * f * (1 - f);
    plot(side * (0.35 + 0.8 * f) + liftX(h), 0.15 - 0.7 * f + liftZ(h), f < 0.5 ? 'o' : '.', i % 3 ? soil : wood, env * (1 - f));
  }
}

function impact(effect, plot) {
  const p = effect.progress, t = effect.age, end = 1 - smooth(0.7, 1, p);
  // The anvil's imprint is stamped into the ground beneath the foe.
  anvil(plot, 0, 0, 0.75, end * (1 - smooth(0.25, 0.7, p)), 1, 1 - smooth(0, 0.4, p));
  const burst = 1 - smooth(0, 0.18, p);
  if (burst > 0) {
    plot(0, 0, '@', flash, burst); plot(0.1, 0.08, '*', gold, burst); plot(-0.1, -0.06, '*', flash, burst);
    for (let i = 0; i < 8; i++) {
      const a = TAU * (i + 0.25) / 8, r0 = 0.25 + 1.1 * easeOut(p / 0.25), len = 0.35 * burst;
      line(plot, Math.sin(a) * r0, Math.cos(a) * r0, Math.sin(a) * (r0 + len), Math.cos(a) * (r0 + len), 2, 2, mix(gold, flash, burst), burst);
    }
  }
  ring(plot, 0, 0, 0.35 + 1.9 * easeOut(p / 0.8), 40, 24, end * (1 - smooth(0.2, 0.9, p)),
    p < 0.1 ? flash : mix(leafLight, soil, smooth(0.1, 0.6, p)), soil, 0.05, 5);
  for (let i = 0; i < 6; i++) {
    const a = TAU * (i + hash(i, 80) * 0.6) / 6;
    crack(plot, 0, 0, a, 0.9 + 0.6 * hash(i, 81), easeOut(p / 0.25), i + 90, end, 1 - smooth(0, 0.75, p), 4);
  }
  // Slabs of earth heave up under the foe and crash back down.
  clods(plot, 0, 0, 12, t, 100, end, 2, 4.6);
  // A low dust cloud drifts out and settles.
  for (let i = 0; i < 14; i++) {
    const a = TAU * (i + hash(i, 110)) / 14, r = 0.5 + 1.5 * easeOut(p * (0.7 + 0.5 * hash(i, 111)));
    plot(Math.sin(a) * r, Math.cos(a) * r, p < 0.5 ? ':' : '.', mix(soil, soilDark, p), end * 0.5 * smooth(0, 0.15, p));
  }
  leaves(plot, 0, 0, 10, p, t, 120, end, 1.3, 1.4);
}

function pulse(effect, plot) {
  const p = effect.progress, r = Math.min(2.5, Math.max(0.5, effect.radius || 1));
  const R = 0.55 + 0.5 * r, end = 1 - smooth(0.55, 1, p), t = effect.age;
  if (p < 0.2) { plot(0, 0, p < 0.1 ? '@' : '*', p < 0.1 ? flash : gold, (1 - p / 0.2) * end); }
  for (let i = 0; i < 5; i++) {
    const a = TAU * (i + hash(i, 130) * 0.6) / 5;
    crack(plot, 0, 0, a, R * (0.7 + 0.3 * hash(i, 131)), easeOut(p / 0.32), i + 140, end, 1 - smooth(0.05, 0.75, p), 4);
  }
  // A dust ring puffs out of the opening ground.
  for (let i = 0; i < 12; i++) {
    const a = TAU * (i + 0.5 * hash(i, 150)) / 12, rr = 0.2 + R * 0.95 * easeOut(p * 1.4) * (0.85 + 0.15 * hash(i, 151));
    plot(Math.sin(a) * rr, Math.cos(a) * rr, p < 0.35 ? ':' : '.', soil, end * 0.6 * (1 - smooth(0.3, 0.9, p)));
  }
  // Chips of soil hop out.
  for (let i = 0; i < 7; i++) {
    const a = TAU * (i + hash(i, 160)) / 7, f = clamp01(t / 0.45), d = 0.2 + R * 0.6 * easeOut(f);
    const h = Math.max(0, 1.6 * f * (1 - f) * (0.7 + 0.6 * hash(i, 161)));
    plot(Math.sin(a) * d + liftX(h), Math.cos(a) * d + liftZ(h), f < 0.9 ? 'o' : '.', i % 2 ? soil : wood, end * (1 - f * 0.6));
  }
  // Grass sprouts in the fresh cracks.
  const sprout = smooth(0.2, 0.55, p);
  if (sprout > 0) for (let i = 0; i < 6; i++) {
    const a = TAU * (i + hash(i, 130) * 0.6 + 0.08) / 5, d = R * (0.35 + 0.35 * hash(i, 170));
    plot(Math.sin(a) * d, Math.cos(a) * d, sprout > 0.7 ? '"' : sprout > 0.35 ? '\'' : ',', mix(leaf, leafLight, sprout), end * sprout);
  }
}

function aura(effect, plot) {
  const p = effect.progress, t = effect.age, env = Math.min(1, 0.3 + p / 0.12) * (1 - smooth(0.6, 1, p));
  // A ring of living roots coils around the feet and turns slowly.
  for (let i = 0; i < 22; i++) {
    const a = TAU * i / 22 + t * 0.8, x = Math.sin(a) * 0.8, z = Math.cos(a) * 0.8;
    plot(x, z, i % 6 === 0 ? 'o' : stroke(Math.cos(a), -Math.sin(a)), i % 2 ? moss : woodDark, env * (0.6 + 0.4 * Math.sin(t * 4 + i)));
  }
  // Three vines climb around the body.
  const grow = easeOut(p / 0.4);
  for (let v = 0; v < 3; v++) for (let j = 0; j < 10; j++) {
    const hj = j * 0.15 * grow, a = TAU * v / 3 + j * 0.55 + t * 1.5, rad = 0.55 - j * 0.025;
    const hk = (j + 1) * 0.15 * grow, ak = a + 0.55;
    const x = Math.sin(a) * rad + liftX(hj), z = Math.cos(a) * rad + liftZ(hj);
    const nx = Math.sin(ak) * (rad - 0.025) + liftX(hk), nz = Math.cos(ak) * (rad - 0.025) + liftZ(hk);
    plot(x, z, j === 9 ? '*' : stroke(nx - x, nz - z), j > 6 ? leafLight : leaf, env * (0.5 + 0.05 * j));
  }
  // Leaves and clods drift upward as the earth heaves.
  for (let i = 0; i < 10; i++) {
    const f = (t * 0.7 + hash(i, 180)) % 1, a = TAU * hash(i, 181) + t * 2, rr = 0.7 + 0.2 * Math.sin(t * 3 + i);
    plot(Math.sin(a) * rr + liftX(1.6 * f), Math.cos(a) * rr + liftZ(1.6 * f), i % 3 ? (Math.sin(t * 9 + i) > 0 ? ',' : '\'') : 'o',
      i % 3 ? mix(leafLight, leaf, hash(i, 182)) : soil, env * (1 - f));
  }
  // An opening dust ring marks the heave.
  const puff = 1 - smooth(0, 0.5, p);
  if (puff > 0) for (let i = 0; i < 20; i++) {
    const a = TAU * (i + 0.5) / 20, rr = 0.5 + 1.2 * easeOut(p / 0.5);
    plot(Math.sin(a) * rr, Math.cos(a) * rr, i % 2 ? '.' : ':', soil, puff * 0.6 * env);
  }
}

// Not used by the rune; a lingering field of breathing fissures.
function zone(effect, plot) {
  const p = effect.progress, t = effect.age, env = Math.min(1, 0.3 + p * 8) * (1 - smooth(0.8, 1, p));
  for (let i = 0; i < 4; i++) {
    const a = TAU * (i + 0.2) / 4 + 0.3;
    crack(plot, 0, 0, a, 1.2 * Math.min(2, effect.radius || 1), 1, i + 200, env * (0.6 + 0.3 * Math.sin(t * 3 + i)),
      0.3 + 0.3 * Math.sin(t * 2 + i * 1.7), 4);
  }
  for (let i = 0; i < 12; i++) {
    const f = (t * 0.5 + hash(i, 210)) % 1, a = TAU * hash(i, 211), rr = 0.4 + 1.2 * hash(i, 212);
    plot(Math.sin(a) * rr + liftX(0.8 * f), Math.cos(a) * rr + liftZ(0.8 * f), i % 2 ? ',' : '.', i % 2 ? leaf : soil, env * (1 - f) * 0.8);
  }
}

const stages = { cast, projectile, impact, pulse, aura, zone };

export default {
  id: 'temp-shock-wave', duration: 1.1,
  draw(effect, plot) {
    cos = Math.cos(effect.heading || 0); sin = Math.sin(effect.heading || 0);
    const state = { ...effect, progress: clamp01(effect.progress), age: Math.max(0, effect.age || 0) };
    (stages[effect.stage] ?? pulse)(state, plot);
  },
  sounds: {
    cast: [
      { kind: 'noise', duration: 0.3, gain: 0.025, cutoff: 520, filterType: 'bandpass', attack: 0.06, release: 0.15 },
      { kind: 'tone', type: 'sine', frequency: 86, endFrequency: 68, duration: 0.4, gain: 0.035, attack: 0.08, release: 0.2 },
      { kind: 'noise', delay: 0.6, duration: 0.075, gain: 0.095, cutoff: 620, filterType: 'bandpass', attack: 0.002, release: 0.065 },
      { kind: 'tone', type: 'triangle', delay: 0.6, frequency: 146, endFrequency: 72, duration: 0.24, gain: 0.085, attack: 0.002, release: 0.22 },
      { kind: 'tone', type: 'sine', delay: 0.615, frequency: 114, endFrequency: 101, duration: 0.58, gain: 0.06, attack: 0.004, release: 0.55 },
      { kind: 'tone', type: 'sine', delay: 0.62, frequency: 173, endFrequency: 164, duration: 0.39, gain: 0.035, attack: 0.004, release: 0.37 },
    ],
    impact: [
      { kind: 'noise', duration: 0.07, gain: 0.11, cutoff: 720, filterType: 'bandpass', attack: 0.002, release: 0.065 },
      { kind: 'tone', type: 'triangle', frequency: 164, endFrequency: 73, duration: 0.17, gain: 0.1, attack: 0.002, release: 0.16 },
      { kind: 'tone', type: 'sine', frequency: 107, endFrequency: 91, duration: 0.62, gain: 0.07, attack: 0.004, release: 0.59 },
      { kind: 'tone', type: 'sine', delay: 0.012, frequency: 159, endFrequency: 149, duration: 0.4, gain: 0.04, attack: 0.004, release: 0.38 },
      { kind: 'noise', delay: 0.22, duration: 0.34, gain: 0.07, cutoff: 180, filterType: 'lowpass', attack: 0.03, release: 0.28 },
      { kind: 'tone', type: 'sine', delay: 0.24, frequency: 52, endFrequency: 32, duration: 0.4, gain: 0.055, attack: 0.02, release: 0.36 },
    ],
    pulse: [
      { kind: 'noise', duration: 0.075, gain: 0.025, cutoff: 280, filterType: 'lowpass', attack: 0.004, release: 0.065 },
      { kind: 'tone', type: 'sine', frequency: 73, endFrequency: 48, duration: 0.12, gain: 0.025, attack: 0.004, release: 0.11 },
    ],
  },
};
