// Bubble Shard: a crystalline water shard fired inside an iridescent soap
// bubble. Bubbles are drawn screen-round (the ground tilt squashes local metres,
// so their rims are authored in screen-aligned metres and rotated back), while
// shards, streaks and slivers follow the heading with stroke glyphs chosen from
// their on-screen direction.
const DEEP = [38, 128, 196], WATER = [92, 218, 229], FILM = [210, 248, 255],
  LILAC = [198, 182, 248], MINT = [150, 240, 214], WHITE = [255, 255, 255];
const TAU = Math.PI * 2;
const RIM = [')', '/', '_', '\\', '(', '/', '-', '\\'];
const FLASH = '.:+*#@';

const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const span = (p, a, b) => clamp01((p - a) / (b - a));
const easeOut = t => 1 - (1 - t) ** 3;
const easeIn = t => t * t * t;
const easeOutBack = t => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;
const fract = v => v - Math.floor(v);
const hash = n => fract(Math.sin(n * 127.1 + 311.7) * 43758.5453);

function ramp(stops, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1) * (stops.length - 1), k = Math.min(stops.length - 2, Math.floor(t)), f = t - k;
    out.push(stops[k].map((c, j) => Math.round(c + (stops[k + 1][j] - c) * f)));
  }
  return out;
}
// Intensity runs deep water -> water -> film -> white; the film cycles its sheen.
const HEAT = ramp([DEEP, WATER, FILM, WHITE], 12);
const SHEEN = ramp([FILM, LILAC, MINT, WATER, FILM], 16);
const heat = t => HEAT[Math.round(clamp01(t) * (HEAT.length - 1))];
const sheen = t => SHEEN[Math.floor(fract(t) * SHEEN.length) % SHEEN.length];

function pen(effect, plot) {
  const heading = Number.isFinite(effect.heading) ? effect.heading : 0;
  const seed = Number.isFinite(effect.x) && Number.isFinite(effect.y)
    ? Math.abs(Math.floor(effect.x * 0.37 + effect.y * 1.31)) % 97 : 0;
  return { plot, c: Math.cos(heading), s: Math.sin(heading), seed };
}

// Plot at a local centre plus a screen-aligned (unrotated) metre offset.
function dotW(g, cx, cz, X, Z, char, color, light) {
  g.plot(cx + X * g.c - Z * g.s, cz + X * g.s + Z * g.c, char, color, light);
}

// Stroke glyph for a screen-aligned metre direction (cells are twice as tall as wide).
function strokeW(X, Z) {
  let a = Math.atan2(Z * 13, X * 26);
  if (a < 0) a += Math.PI;
  const b = a / Math.PI * 8;
  return b < 1 || b >= 7 ? '-' : b < 3 ? '\\' : b < 5 ? '|' : '/';
}
const stroke = (g, dx, dz) => strokeW(dx * g.c + dz * g.s, dz * g.c - dx * g.s);
function arrow(g, dx, dz) {
  const vx = (dx * g.c + dz * g.s) * 26, vy = (dz * g.c - dx * g.s) * 13;
  return Math.abs(vx) > Math.abs(vy) ? (vx > 0 ? '>' : '<') : vy > 0 ? 'v' : '^';
}
const cells = (g, dx, dz) => Math.hypot((dx * g.c + dz * g.s) * 26, (dz * g.c - dx * g.s) * 6.5);

function line(g, x0, z0, x1, z1, color, light, max = 12, char) {
  const dx = x1 - x0, dz = z1 - z0;
  const n = Math.max(1, Math.min(max, Math.round(cells(g, dx, dz))));
  const glyph = char ?? stroke(g, dx, dz);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    g.plot(x0 + dx * t, z0 + dz * t, glyph, color, light);
  }
}

// A soap bubble: iridescent hollow rim lit from the upper left, a curved
// specular arc, a glint and a faint bounce light. `stretch` pulls the front
// half forward along the heading into a teardrop.
function sphere(g, cx, cz, R, light, wob = 0, spin = 0, stretch = 0, max = 36) {
  if (R < 0.015) return;
  const n = Math.max(6, Math.min(max, Math.ceil(R * 109)));
  const put = (X, Z, char, color, l) => {
    const lx = X * g.c - Z * g.s, lz = X * g.s + Z * g.c;
    g.plot(cx + lx, cz + lz * (lz > 0 ? 1 + stretch : 1 - stretch * 0.25), char, color, l);
  };
  for (let i = 0; i < n; i++) {
    // Warp the angle so the long top and bottom edges get denser samples.
    const t = i / n * TAU, a = t + Math.sin(2 * t) / 6;
    const lit = 0.5 + 0.5 * Math.cos(a - 3.93);
    put(Math.cos(a) * R * (1 + wob), Math.sin(a) * 2 * R * (1 - wob),
      RIM[Math.round(a / TAU * 8) & 7], sheen(a / TAU + spin), light * (0.5 + 0.5 * lit));
  }
  if (R < 0.09) return;
  for (let k = 0; k < 3; k++) {
    const a = 3.55 + k * 0.36;
    put(Math.cos(a) * R * 0.66, Math.sin(a) * 2 * R * 0.66, "'", k === 1 ? WHITE : FILM, light * 0.9);
  }
  put(Math.cos(3.95) * R * 0.38, Math.sin(3.95) * 2 * R * 0.38, 'o', WHITE, light);
  put(Math.cos(0.75) * R * 0.72, Math.sin(0.75) * 2 * R * 0.72, '.', LILAC, light * 0.5);
}

// Small bubbles collapse to a single bead when the rim would be a smear.
function bead(g, x, z, R, light, spin = 0) {
  if (R * 52 < 2.6) {
    if (R > 0.004) g.plot(x, z, R * 52 < 1.2 ? '.' : 'o', R * 52 < 1.2 ? WATER : FILM, light);
    return;
  }
  sphere(g, x, z, R, light, 0, spin, 0, 14);
}

// A popping bubble: a white snap, then beads flung out on a screen-round ring.
function pop(g, x, z, t, size, light, seed) {
  if (t >= 1) return;
  const l = light * (1 - t);
  if (t < 0.3) g.plot(x, z, t < 0.12 ? '*' : '+', WHITE, l);
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * TAU + hash(seed + i) * 0.9, d = size * (0.5 + 1.6 * easeOut(t)), s = Math.sin(a);
    dotW(g, x, z, Math.cos(a) * d, s * 2 * d + t * t * size * 1.5,
      s < -0.3 ? "'" : s > 0.3 ? ',' : '.', heat(0.85 - t * 0.6), l * 0.85);
  }
}

// Ground ripple: a true ground-plane ring, so the tilt flattens it naturally.
function ripple(g, x, z, r, light, count, thin = 0, seed = 0) {
  for (let i = 0; i < count; i++) {
    if (hash(seed + i * 3.1) < thin) continue;
    const a = i / count * TAU, ca = Math.cos(a);
    g.plot(x + ca * r, z + Math.sin(a) * r, ca > 0.93 ? ')' : ca < -0.93 ? '(' : '~',
      sheen(a / TAU * 0.5 + 0.6), light * (0.6 + 0.4 * Math.abs(Math.sin(a * 2 + r * 4))));
  }
}

// The shard: four facet edges (deep behind, bright film in front), a refracted
// core that brightens toward the tip, a travelling glint, and an arrow point.
function shard(g, cx, cz, len, wid, light, glint = -1) {
  if (len <= 0.01) return;
  // Keep the on-screen girth steady: sideways metres span half as many cells
  // vertically, so widen the shard as the heading turns across the screen.
  wid *= 26 / Math.hypot(26 * g.c, 13 * g.s);
  const tip = cz + len * 0.62, tail = cz - len * 0.38;
  line(g, cx, tail, cx - wid, cz, WATER, light * 0.7, 8);
  line(g, cx, tail, cx + wid, cz, WATER, light * 0.7, 8);
  line(g, cx - wid, cz, cx, tip, FILM, light, 10);
  line(g, cx + wid, cz, cx, tip, FILM, light, 10);
  const n = Math.max(2, Math.min(9, Math.round(cells(g, 0, tip - tail) * 0.55)));
  const core = stroke(g, 0, 1) === '-' ? '=' : ':';
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, near = Math.abs(t - glint) < 0.6 / n;
    g.plot(cx, tail + (tip - tail) * t, near ? '*' : core, near ? WHITE : heat(0.45 + 0.5 * t),
      light * (0.55 + 0.45 * t));
  }
  g.plot(cx, tip + len * 0.04, arrow(g, 0, 1), WHITE, light);
}

// A bubble that rises from a local base point, swaying, then pops.
function riser(g, bx, bz, rise, sway, R, light, popT, seed) {
  const X = sway, Z = -rise, x = bx + X * g.c - Z * g.s, z = bz + X * g.s + Z * g.c;
  if (popT <= 0) bead(g, x, z, R, light, seed);
  else pop(g, x, z, popT, 0.08, light, seed * 7);
}

// Cast: the film gathers and inflates around a crystallising shard, the shard
// punches out through the stretched film with a white flash, the torn film
// sprays droplets, and leftover bubbles drift up and pop over a ground ripple.
function cast(g, e) {
  const p = e.progress, age = e.age, life = e.life, end = clamp01((1 - p) * 4), G = 0.45;
  for (let i = 0; i < 10; i++) {
    const t = span(p, hash(i) * 0.04, 0.13 + hash(i + 9) * 0.03);
    if (t >= 1) continue;
    const r = 0.06 + 1.05 * (1 - t * t), ang = i / 10 * TAU + hash(i + 3) + t * 1.8;
    const light = (0.35 + 0.65 * t) * end;
    g.plot(Math.cos(ang) * r, G + Math.sin(ang) * r * 0.9, t > 0.55 ? 'o' : t > 0.25 ? ':' : '.',
      heat(0.3 + 0.6 * t), light);
    const r2 = 0.06 + 1.05 * (1 - Math.max(0, t - 0.12) ** 2), a2 = ang - 0.22;
    g.plot(Math.cos(a2) * r2, G + Math.sin(a2) * r2 * 0.9, '.', DEEP, 0.4 * light);
  }

  const inflate = span(p, 0, 0.15), launch = span(p, 0.13, 0.3), torn = span(p, 0.17, 0.21);
  if (torn < 1) {
    const R = 0.17 + 0.16 * easeOutBack(inflate);
    const wob = 0.16 * Math.sin(inflate * Math.PI) + 0.05 * Math.sin(age * 31) * (1 - inflate);
    sphere(g, 0, G, R, (0.45 + 0.55 * inflate) * (1 - torn) * end, wob, age * 2,
      1.1 * easeIn(span(p, 0.12, 0.2)), 36);
  }

  const form = easeOut(span(p, 0.02, 0.14)), gone = span(p, 0.25, 0.32);
  if (gone < 1) {
    const z = G + easeIn(launch) * 2.6;
    shard(g, 0, z, 0.22 + 0.48 * form, 0.05 + 0.1 * form, (0.4 + 0.6 * form) * (1 - gone) * end, fract(age * 3));
    if (launch > 0) {
      line(g, 0, G + 0.12, 0, z - 0.32, FILM, 0.75 * (1 - launch) * end, 14);
    }
  }

  const flash = span(p, 0.13, 0.34);
  if (p >= 0.13 && flash < 1) {
    const I = 1 - flash;
    g.plot(0, G, FLASH[Math.min(5, Math.floor(I * 6))], heat(0.4 + 0.6 * I), I * end);
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * TAU + 0.2, d = 0.1 + 0.55 * easeOut(flash) * (0.7 + 0.3 * hash(i + 60));
      dotW(g, 0, G, Math.cos(a) * d, Math.sin(a) * 2 * d, flash < 0.35 ? '*' : flash < 0.7 ? '+' : '.',
        heat(0.95 - flash * 0.6), I * 0.9 * end);
    }
  }

  const fall = span(p, 0.17, 0.78);
  if (p >= 0.17 && fall < 1) {
    // The torn film: beads thrown off the rim with drag, sagging as they slow.
    const tau = age - 0.17 * life, drag = 1 - Math.exp(-4.5 * tau), fwd = 0.5 * drag;
    for (let i = 0; i < 24; i++) {
      const a = i / 24 * TAU + hash(i + 70) * 0.2, v = 1.1 + 0.9 * hash(i + 80);
      const d = 0.33 + v * drag / 4.5, speed = v * (1 - drag);
      const char = speed > 0.85 ? strokeW(Math.cos(a), 2 * Math.sin(a)) : speed > 0.4 ? "'" : '.';
      dotW(g, 0, G + fwd, Math.cos(a) * d, Math.sin(a) * 1.6 * d + 0.6 * tau * tau, char,
        i % 3 ? heat(0.85 - fall * 0.7) : sheen(a / TAU + age), (1 - fall) ** 1.4 * end);
    }
  }

  for (let i = 0; i < 6; i++) {
    const born = 0.19 + i * 0.035, popAt = 0.56 + hash(i + 20) * 0.32;
    if (p < born) continue;
    const u = span(p, born, popAt);
    const R = (0.05 + 0.065 * hash(i + 30)) * easeOutBack(span(u, 0, 0.3)) * (1 + 0.15 * span(u, 0.8, 1));
    riser(g, (hash(i + 40) - 0.5) * 0.8, G + (hash(i + 50) - 0.5) * 0.5,
      0.95 * easeOut(u) * (0.7 + 0.3 * hash(i + 2)), Math.sin(age * 5 + i * 1.7) * 0.06 * u,
      R, 0.85 * end, span(p, popAt, popAt + 0.12) || (u >= 1 ? 1e-6 : 0), i);
  }

  const q = span(p, 0.2, 1);
  if (p >= 0.2) ripple(g, 0, G, 0.4 + 0.6 * easeOut(q), 0.5 * (1 - q * 0.6) * end, 20, q * 0.45, 3);
}

// Flight: the shard leads inside a wobbling, slowly spinning teardrop of film
// that trails a wake of shrinking bubbles and spray.
function projectile(g, e) {
  const age = e.age, fade = clamp01((1 - e.progress) * 4);
  for (let i = 0; i < 8; i++) {
    const s = fract(age * 3.1 + i / 8 + hash(i + 11) * 0.3);
    const x = (hash(i + 40) - 0.5) * 0.55 * s + Math.sin(age * 9 + i) * 0.04, z = -0.3 - s * 1.25;
    g.plot(x, z, s < 0.3 ? "'" : s < 0.65 ? '.' : ',', heat(0.7 - s * 0.5), 0.6 * (1 - s) * Math.min(1, s * 6) * fade);
  }
  for (let i = 0; i < 6; i++) {
    const s = fract(age * 2.4 + i / 6);
    const x = Math.sin(age * 6.5 + i * 2.4) * 0.05 + (hash(i) - 0.5) * 0.4 * s, z = -0.36 - s * 1.7;
    const R = (0.05 + 0.05 * hash(i + 5)) * (1 - s) * Math.min(1, s * 5);
    bead(g, x, z, R, 0.85 * (1 - s) * fade, age + i);
  }
  sphere(g, 0, -0.04, 0.23, 0.8 * fade, Math.sin(age * 19) * 0.07, age * 1.7, 0.18, 28);
  shard(g, 0, 0.05, 0.86, 0.15, fade, fract(age * 2.2));
}

// Hit: the shard crushes into a white flash and shatters into spinning slivers,
// the bubble shell bursts outward and thins into beads, a crown of droplets
// arcs up and lands, two ripples spread, and a few bubbles rise and pop.
function impact(g, e) {
  const p = e.progress, age = e.age, life = e.life, end = clamp01((1 - p) * 3.5);
  const crush = span(p, 0, 0.14);
  if (crush < 1) shard(g, 0, -0.45 * (1 - easeOut(crush)), 0.8 * (1 - 0.6 * crush), 0.15, (1 - crush) * end);

  const shatter = span(p, 0.04, 0.68), tau = Math.max(0, age - 0.04 * life);
  for (let i = 0; i < 10 && shatter < 1; i++) {
    const th = i < 7 ? (hash(i + 100) - 0.5) * 3.6 : Math.PI + (hash(i + 100) - 0.5) * 1.6;
    const v = 2.2 + 1.8 * hash(i + 110), d = v * (1 - Math.exp(-4 * tau)) / 4;
    const x = Math.sin(th) * d, z = Math.cos(th) * d;
    const spin = th + tau * (7 + 6 * hash(i + 120)) * (i % 2 ? 1 : -1);
    const ox = Math.sin(spin) * 0.07, oz = Math.cos(spin) * 0.07;
    line(g, x - ox, z - oz, x + ox, z + oz, heat(1 - shatter * 0.85), (1 - shatter) * end, 3);
  }

  const shell = span(p, 0.03, 0.62);
  if (shell < 1) {
    const R = 0.25 + 0.5 * easeOut(shell);
    for (let i = 0; i < 28; i++) {
      if (hash(i + 50) < shell * 0.8) continue;
      const t = i / 28 * TAU, a = t + Math.sin(2 * t) / 6;
      dotW(g, 0, 0, Math.cos(a) * R, Math.sin(a) * 2 * R,
        shell < 0.3 ? RIM[Math.round(a / TAU * 8) & 7] : Math.sin(a) < 0 ? "'" : '.',
        sheen(a / TAU + age * 1.5), (1 - shell) * 0.9 * end);
    }
  }

  const crown = span(p, 0.06, 0.9), ct = Math.max(0, age - 0.06 * life);
  for (let i = 0; i < 16 && crown < 1; i++) {
    // Ballistic droplets: up the screen, back down, a dim bead where they land.
    const vx = (hash(i + 130) - 0.5) * 2.6, vy = 1.5 + 1.3 * hash(i + 140), depth = (hash(i + 150) - 0.5) * 0.5;
    const h = vy * ct - 4.6 * ct * ct, landed = h <= 0 && ct > 0, vz = vy - 9.2 * ct;
    const X = vx * Math.min(ct, vy / 4.6), Z = depth - Math.max(0, h) * 0.8;
    const char = landed ? '.' : vz > 0.4 ? "'" : vz > -0.4 ? '.' : ',';
    dotW(g, 0, 0, X, Z, char, i % 4 ? heat(0.85 - crown * 0.6) : sheen(i / 16 + age),
      (1 - crown) * (landed ? 0.45 : 0.9) * end);
  }

  for (let j = 0; j < 2; j++) {
    const start = 0.08 + j * 0.16, q = span(p, start, 1);
    ripple(g, 0, 0, 0.25 + 0.8 * easeOut(q), 0.45 * (1 - q) * (p >= start ? 1 : 0) * end, 16, 0.15 + q * 0.45, j * 11);
  }

  for (let i = 0; i < 4; i++) {
    const born = 0.3 + i * 0.06, popAt = 0.66 + hash(i + 160) * 0.22;
    if (p < born) continue;
    const u = span(p, born, popAt);
    riser(g, (hash(i + 170) - 0.5) * 0.9, (hash(i + 180) - 0.5) * 0.4, 0.8 * easeOut(u),
      Math.sin(age * 6 + i) * 0.05 * u, (0.05 + 0.05 * hash(i + 190)) * easeOutBack(span(u, 0, 0.35)),
      0.8 * end, span(p, popAt, popAt + 0.12) || (u >= 1 ? 1e-6 : 0), i + 30);
  }
  // The flash goes last: the renderer keeps the last glyph in a cell, and the
  // slivers and crown droplets all start at the centre.
  const flash = span(p, 0, 0.3), I = 1 - flash;
  if (flash < 1) {
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * TAU, d = 0.12 + 0.5 * easeOut(flash) * (0.75 + 0.25 * hash(i + 90));
      dotW(g, 0, 0, Math.cos(a) * d, Math.sin(a) * 2 * d, flash < 0.3 ? '*' : flash < 0.65 ? '+' : '.',
        heat(1 - flash * 0.6), I * end);
    }
    g.plot(0, 0, FLASH[Math.min(5, Math.floor(I * 6))], heat(0.4 + 0.6 * I), I * end);
  }
}

// Trail ticks: a few beads shed by the flight swell and pop in turn.
function pulse(g, e) {
  const p = e.progress, sc = 0.75 + 0.25 * Math.min(3, e.radius), end = clamp01((1 - p) * 3), k = g.seed;
  for (let i = 0; i < 3; i++) {
    const popAt = 0.42 + i * 0.16 + hash(k + i) * 0.06, u = span(p, 0, popAt);
    riser(g, (hash(k + i + 20) - 0.5) * 0.7 * sc, (hash(k + i + 30) - 0.5) * 0.4 * sc, 0.22 * sc * easeOut(u), 0,
      (0.05 + 0.045 * hash(k + i + 40)) * sc * easeOutBack(Math.min(1, u * 2.2)), 0.85 * end,
      p < popAt ? 0 : span(p, popAt, popAt + 0.3) || 1e-6, k + i);
  }
  ripple(g, 0, 0, (0.15 + 0.35 * easeOut(p)) * sc, 0.35 * (1 - p) * end, 10, p * 0.4, k);
}

// Slowed: a lazy film cocoon clings to the target, its sheen crawling, motes
// circling inside, drips sliding down and falling into a puddle ring.
function aura(g, e) {
  const p = e.progress, age = e.age, grow = span(p, 0, 0.18), end = clamp01((1 - p) * 4);
  const light = (0.3 + 0.7 * grow) * end, R = 0.42 * (0.55 + 0.45 * easeOutBack(grow));
  const cx = -0.3 * -g.s, cz = -0.3 * g.c;
  ripple(g, -0.62 * g.s, 0.62 * g.c, 0.3 + 0.03 * Math.sin(age * 2), 0.4 * light, 14, 0.2, 5);
  sphere(g, cx, cz, R, 0.85 * light, 0.05 * Math.sin(age * 3.2), age * 0.35, 0, 40);
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * TAU + age * 1.2, d = R * (0.45 + 0.15 * Math.sin(age * 2 + i));
    dotW(g, cx, cz, Math.cos(a) * d, Math.sin(a) * 2 * d * 0.7, i % 2 ? 'o' : '.', i % 2 ? FILM : LILAC,
      0.6 * light * (0.6 + 0.4 * Math.sin(a)));
  }
  for (let j = 0; j < 4; j++) {
    const c = fract(age * 0.55 + j / 4 + hash(j + 200) * 0.2), slide = easeIn(Math.min(1, c / 0.7));
    const a0 = j % 2 ? 0.25 : Math.PI - 0.25, a = a0 + (Math.PI / 2 - a0) * slide;
    const fall = Math.max(0, c - 0.7) / 0.3;
    dotW(g, cx, cz, Math.cos(a) * R * 1.06, Math.sin(a) * 2 * R * 1.06 + fall * fall * 0.5,
      fall > 0 ? (fall > 0.6 ? '.' : ',') : "'", heat(0.75 - fall * 0.4),
      light * 0.8 * (1 - fall) * Math.min(1, c * 6));
  }
}

// Zone (not used by the rune today): a shimmering puddle that breathes ripples
// and releases bubbles that rise and pop.
function zone(g, e) {
  const p = e.progress, age = e.age, r = Math.min(3, e.radius);
  const light = (0.25 + 0.75 * span(p, 0, 0.15)) * clamp01((1 - p) * 4);
  for (let i = 0; i < 30; i++) {
    const a = i / 30 * TAU, ca = Math.cos(a), shimmer = 0.55 + 0.45 * Math.sin(a * 3 - age * 2);
    g.plot(ca * r, Math.sin(a) * r, ca > 0.95 ? ')' : ca < -0.95 ? '(' : '~', sheen(a / TAU + age * 0.2),
      0.7 * light * shimmer);
  }
  const q = fract(age * 0.6);
  ripple(g, 0, 0, r * (0.15 + 0.75 * q), 0.45 * (1 - q) * light, 18, q * 0.4, 9);
  for (let i = 0; i < 8; i++) {
    const c = fract(age * 0.5 + hash(i + 210)), rr = Math.sqrt(hash(i + 220)) * r * 0.8, a = hash(i + 230) * TAU;
    riser(g, Math.cos(a) * rr, Math.sin(a) * rr, c * 0.8, Math.sin(age * 4 + i) * 0.04,
      (0.05 + 0.06 * hash(i + 240)) * Math.min(1, c * 6), 0.8 * light, c < 0.85 ? 0 : (c - 0.85) / 0.15 || 1e-6, i + 60);
  }
}

const STAGES = { cast, projectile, impact, pulse, aura, zone };

export default {
  id: 'bubble-shard',
  duration: 0.86,
  draw(effect, plot) {
    (STAGES[effect.stage] ?? cast)(pen(effect, plot), effect);
  },
  sounds: {
    // An enclosed swell and uneven air gestures suggest the bubble without close gurgling.
    cast: [
      { kind: 'recording', url: '/assets/audio/spells/mitlan/deep-fold.wav', gain: 0.23, rate: 1.05, delay: 0 },
      { kind: 'recording', url: '/assets/audio/spells/mitlan/current-rise.wav', gain: 0.15, rate: 1.12, delay: 0.137 },
      { kind: 'recording', url: '/assets/audio/spells/mitlan/storm-air.wav', gain: 0.1, rate: 0.98, delay: 0.367 },
    ],
    impact: [
      { kind: 'recording', url: '/assets/audio/spells/mitlan/shell-hit.wav', gain: 0.24, rate: 1.12, delay: 0 },
      { kind: 'recording', url: '/assets/audio/spells/mitlan/current-rise.wav', gain: 0.1, rate: 1.16, delay: 0.173 },
    ],
    pulse: [
      { kind: 'recording', url: '/assets/audio/spells/mitlan/deep-fold.wav', gain: 0.055, rate: 1.2, delay: 0 },
    ],
  },
};
