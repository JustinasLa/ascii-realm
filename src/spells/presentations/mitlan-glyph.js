const TAU = Math.PI * 2;
// One rows-per-metre of height is drawn as 5 rows; the ground plane uses 6.5.
const LIFT = 5 / 6.5;

// Abyss -> deep current -> water -> bright shallows -> foam -> white flash.
const STOPS = [[16, 48, 92], [34, 104, 158], [54, 172, 200], [100, 216, 224], [176, 250, 240], [236, 255, 255]];
const SHADES = Array.from({ length: 21 }, (_, i) => {
  const t = i / 20 * (STOPS.length - 1), k = Math.min(STOPS.length - 2, Math.floor(t)), f = t - k;
  return STOPS[k].map((c, j) => Math.round(c + (STOPS[k + 1][j] - c) * f));
});
const shade = t => SHADES[t <= 0 ? 0 : t >= 1 ? 20 : Math.round(t * 20)];

const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const smooth = v => (v = clamp01(v), v * v * (3 - 2 * v));
const easeOut = v => 1 - (1 - clamp01(v)) ** 3;
const easeIn = v => clamp01(v) ** 2;
const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
// Even visual spacing round a foreshortened circle: cells are twice as tall as
// wide and rows are halved by the tilt, so slow the sweep across the top/bottom.
const even = phi => phi + Math.sin(2 * phi) / 6;

// Pick a stroke for a screen-space tangent (world metres; +z is down the screen).
function stroke(tx, tz, side) {
  let a = Math.atan2(tz * 13, tx * 26) % Math.PI;
  if (a < 0) a += Math.PI;
  if (a < 0.39 || a > 2.75) return '~';
  if (a < 1.18) return '\\';
  if (a < 1.96) return side < 0 ? '(' : side > 0 ? ')' : '|';
  return '/';
}

// The water triskele: an arm sweeps out from the seal and hooks back like a crest.
function arm(s, out) {
  if (s < 0.72) { const v = s / 0.72; out.r = 0.1 + 0.9 * v; out.a = 1.7 * v * v; }
  else { const v = (s - 0.72) / 0.28; out.r = 1 - 0.32 * v * v; out.a = 1.7 + 1.5 * v; }
  return out;
}

export default {
  id: 'mitlan-glyph',
  duration: 1.15,
  draw(effect, plot) {
    const p = clamp01(effect.progress), age = Math.max(0, effect.age), life = Math.max(0.05, effect.life);
    const h = effect.heading || 0, ch = Math.cos(h), sh = Math.sin(h);
    // Author in screen-aligned world metres so strokes, lift and the foreshortened
    // ring stay correct for any heading; the adapter rotates this back.
    const put = (X, Z, c, color, b) => {
      if (b > 0.012) plot(X * ch - Z * sh, X * sh + Z * ch, c, color, b > 1 ? 1 : b);
    };
    const core = (c, color, b) => plot(0, 0, c, color, clamp01(b));
    const pt = { r: 0, a: 0 };
    const stage = effect.stage;

    if (stage === 'projectile') {
      // A compact spinning water seal with a sinuous wake and shed droplets.
      const fade = Math.min(1, (1 - p) * 3), grow = easeOut(age / 0.18), spin = age * 6.5;
      // Local x/z (+z = travel) expressed in the screen-aligned frame.
      const fx = sh, fz = ch, sx = ch, sz = -sh;
      for (let i = 0; i < 12; i++) {
        const a = i / 12 * TAU, r = 0.3 * grow, c = Math.cos(a), s = Math.sin(a);
        const shine = 0.5 + 0.5 * Math.sin(a * 2 - spin * 1.3);
        put(c * r, s * r, stroke(-s, c, c < -0.38 ? -1 : c > 0.38 ? 1 : 0), shade(0.5 + 0.35 * shine), fade * (0.45 + 0.5 * shine));
      }
      for (let k = 0; k < 3; k++) {
        for (let j = 0; j < 4; j++) {
          arm(0.15 + j * 0.25, pt);
          const a = k * TAU / 3 + spin + pt.a, r = 0.24 * grow * pt.r;
          const da = a + 0.3;
          put(Math.cos(a) * r, Math.sin(a) * r, j === 3 ? 'o' : stroke(-Math.sin(da), Math.cos(da), 0),
            shade(0.62 + j * 0.1), fade * (0.7 + j * 0.1));
        }
      }
      core('@', shade(0.95), fade * grow);
      for (let ribbon = 0; ribbon < 2; ribbon++) {
        const n = ribbon ? 10 : 16, amp = ribbon ? 0.09 : 0.14, phase = ribbon * Math.PI;
        for (let j = 0; j < n; j++) {
          const s = (j + 0.5) / n, z = -(0.34 + 1.5 * s) * grow;
          const w = age * 8 - s * 6 + phase, x = amp * Math.sin(w) * (0.3 + s);
          // d/ds of the ribbon: lateral wobble against the 1.5 m backwards run.
          const tx = amp * (Math.sin(w) - 6 * Math.cos(w) * (0.3 + s)), tz = -1.5;
          put(x * sx + z * fx, x * sz + z * fz, stroke(tx * sx + tz * fx, tx * sz + tz * fz, 0),
            shade(0.72 - 0.45 * s - ribbon * 0.1), fade * (1 - s) ** 1.3 * (ribbon ? 0.5 : 0.85));
        }
      }
      for (let i = 0; i < 14; i++) {
        const period = 0.55, t = ((age + i * period / 14 + hash(i) * 0.04) % period) / period;
        const x = (hash(i + 7) - 0.5) * 0.7 * t, z = -0.3 - t * 1.25, lift = 0.12 - 1.1 * t * t;
        put(x * sx + z * fx, x * sz + z * fz - lift * LIFT, t < 0.3 ? '\'' : t < 0.7 ? '.' : ',', shade(0.8 - 0.4 * t),
          fade * grow * (1 - t) * 0.8 * smooth(t / 0.08));
      }
      return;
    }

    if (stage === 'impact') {
      // A geyser erupts beneath the target, crowns into spray and rains back down.
      const R = clamp(effect.radius, 0.6, 1.6), end = smooth((1 - p) / 0.25);
      const flash = 1 - smooth(p / 0.16);
      const H = 2.3 * easeOut(p / 0.3) * (1 - easeIn((p - 0.38) / 0.5));
      const rows = Math.min(12, Math.floor(H * 5));
      for (let i = 0; i < rows; i++) {
        const y = (i + 0.5) / 5, top = H - y, sway = 0.035 * Math.sin(age * 18 + i * 0.9);
        for (let c = -1; c <= 1; c++) {
          const crest = top < 0.45, x = c * 0.085 * (1 + y * 0.25) + sway * (1 + y);
          const glyph = crest ? (c ? '*' : '%') : c ? (i % 2 ? ':' : '!') : '|';
          put(x, -y * LIFT, glyph, shade(crest ? 0.9 + flash * 0.1 : 0.62 + (c ? 0 : 0.18) + y * 0.05),
            end * (c ? 0.62 : 0.95) * (0.55 + 0.45 * clamp01(y / H + 0.3)));
        }
      }
      for (let i = 0; i < 26; i++) {
        const born = 0.14 + hash(i) * 0.16, t = (p - born) / (1 - born);
        if (t <= 0) continue;
        const T = t * 0.95, a = hash(i + 31) * TAU, vh = (0.9 + 1.4 * hash(i + 57)) * R;
        const vu = 1.6 + 2.4 * hash(i + 83), y0 = Math.max(0.4, H);
        const d = vh * (1 - Math.exp(-2.2 * T)) / 2.2, y = Math.max(0, y0 * (1 - t * 0.6) + vu * T - 6.5 * T * T);
        const landed = y <= 0.001;
        put(Math.cos(a) * d, Math.sin(a) * d - y * LIFT, landed ? ',' : vu - 13 * T > 0 ? '\'' : i % 3 ? '.' : 'o',
          shade(0.92 - 0.45 * t), end * (landed ? 0.5 : 0.95) * (1 - t * 0.55));
      }
      for (let ring = 0; ring < 2; ring++) {
        const q = clamp01((p - ring * 0.14) / 0.75);
        if (q <= 0) continue;
        const r = (0.18 + 1.45 * R * easeOut(q)) * (1 - ring * 0.25), n = ring ? 16 : 24;
        for (let i = 0; i < n; i++) {
          const a = even(i / n * TAU + ring * 0.13), c = Math.cos(a), s = Math.sin(a);
          put(c * r, s * r, ring ? '.' : stroke(-s, c, c < -0.4 ? -1 : c > 0.4 ? 1 : 0),
            shade(0.95 - 0.55 * q), end * (1 - q) ** 1.3 * (ring ? 0.55 : 0.95));
        }
      }
      for (let i = 0; i < 6 && flash > 0.02; i++) {
        const a = i / 6 * TAU + 0.3, r = 0.16 + 0.3 * p;
        put(Math.cos(a) * r, Math.sin(a) * r, '*', shade(1), flash);
      }
      core(flash > 0.3 ? '@' : 'o', shade(0.8 + 0.2 * flash), end * Math.max(flash, 0.7 * (1 - p)));
      return;
    }

    if (stage === 'pulse') {
      // A small splash: a crisp ripple ring, a thinner after-ring and a crown of droplets.
      const R = clamp(effect.radius, 0.4, 6), q = easeOut(p), r = R * (0.12 + 0.68 * q);
      const n = Math.round(clamp(12 + R * 5, 14, 40)), b = (1 - p) ** 1.2;
      for (let i = 0; i < n; i++) {
        const a = even(i / n * TAU + age * 0.6), c = Math.cos(a), s = Math.sin(a);
        put(c * r, s * r, stroke(-s, c, c < -0.4 ? -1 : c > 0.4 ? 1 : 0), shade(0.9 - 0.35 * p), b * 0.9);
        if (i % 2 === 0) put(c * r * 0.66, s * r * 0.66, '.', shade(0.55 - 0.2 * p), b * 0.45);
      }
      const drops = R > 2 ? 6 : 10;
      for (let i = 0; i < drops; i++) {
        const T = p * 0.42, a = (i + hash(i) * 0.6) / drops * TAU, d = Math.min(1.2, R * 0.45) * (0.4 + 0.6 * hash(i + 9)) * easeOut(p * 1.4);
        const y = Math.max(0, (1.6 + 1.2 * hash(i + 17)) * T - 4.9 * T * T);
        put(Math.cos(a) * d, Math.sin(a) * d - y * LIFT, y > 0.15 ? '\'' : '.', shade(0.9 - 0.4 * p), b * 0.85);
      }
      core(p < 0.25 ? '@' : p < 0.55 ? 'o' : '.', shade(1 - 0.5 * p), (1 - p) ** 1.5);
      return;
    }

    if (stage === 'aura') {
      // Water shackles: counter-turning bands at the feet and waist, slow heavy drips.
      const rem = life * (1 - p), b = Math.min(smooth(age / 0.12), smooth(rem / 0.3));
      for (let band = 0; band < 2; band++) {
        const n = band ? 16 : 24, r = band ? 0.42 : 0.62, y = band ? 0.85 : 0, spin = age * (band ? -2.1 : 1.4);
        for (let i = 0; i < n; i++) {
          const a = even(i / n * TAU + spin), c = Math.cos(a), s = Math.sin(a);
          const front = s > 0, crest = 0.5 + 0.5 * Math.sin(a * 3 - age * 4);
          put(c * r, s * r - y * LIFT, band && i % 4 === 0 ? 'o' : stroke(-s, c, c < -0.4 ? -1 : c > 0.4 ? 1 : 0),
            shade((front ? 0.62 : 0.38) + 0.3 * crest), b * (front ? 0.85 : 0.4) * (0.6 + 0.4 * crest));
        }
      }
      for (let i = 0; i < 8; i++) {
        const t = (age / 0.75 + hash(i)) % 1, a = i / 8 * TAU + 0.4, r = 0.42 * (1 + 0.15 * t);
        const y = 0.85 * (1 - t * t);
        put(Math.cos(a) * r, Math.sin(a) * r - y * LIFT, t > 0.92 ? ',' : t < 0.2 ? '\'' : '.', shade(0.82 - 0.3 * t),
          b * 0.75 * smooth(t / 0.1) * (Math.sin(a) > -0.2 ? 1 : 0.5));
      }
      core('.', shade(0.6), 0);
      return;
    }

    if (stage === 'cast') {
      // Wind-up: three water streams spiral in; the seal inscribes itself, twists
      // tighter, flashes, then releases a ripple and a spray of droplets.
      const Rc = clamp(effect.radius * 1.15, 0.7, 1.4), end = smooth((1 - p) / 0.25);
      const form = easeOut((p - 0.28) / 0.32), r0 = 1.7, rIn = Rc * 0.18;
      const flash = Math.exp(-(((p - 0.6) / 0.05) ** 2)), release = clamp01((p - 0.6) / 0.4);
      const sealB = form * (1 - smooth(release * 1.15)) * end;
      const spin = age * 0.9 + 3.2 * easeIn((p - 0.28) / 0.34);
      for (let k = 0; k < 3; k++) {
        for (let j = 0; j < 12; j++) {
          // Each droplet follows the same accelerating spiral, a beat behind the last.
          const tj = (p - j * 0.022) / 0.44, s = easeIn(tj);
          if (tj <= 0 || s >= 1) continue;
          const r = rIn + (r0 - rIn) * (1 - s), a = k * TAU / 3 + 0.5 + 3 * s;
          const y = 0.3 * Math.sin(Math.PI * s), da = a + Math.atan2(r0 - rIn, -3 * r);
          put(Math.cos(a) * r, Math.sin(a) * r - y * LIFT, j === 0 ? 'o' : j < 4 ? stroke(Math.cos(da), Math.sin(da), 0) : j % 2 ? ':' : '.',
            shade(0.45 + 0.45 * s - j * 0.02), end * smooth(tj / 0.2) * (0.35 + 0.65 * s) * (1 - j / 13));
        }
      }
      if (sealB > 0.012) {
        for (let i = 0; i < 30; i++) {
          const u = i / 30;
          if (u > form * 1.02) break;
          const a = even(-Math.PI / 2 + u * TAU), c = Math.cos(a), s = Math.sin(a), head = Math.max(0, 1 - Math.abs(form - u) * 8);
          put(c * Rc, s * Rc, head > 0.5 && form < 1 ? '*' : stroke(-s, c, c < -0.4 ? -1 : c > 0.4 ? 1 : 0),
            shade(0.62 + 0.25 * head + 0.3 * flash), sealB * (0.7 + 0.3 * head) + flash * 0.3);
        }
        for (let k = 0; k < 3; k++) {
          for (let j = 0; j < 7; j++) {
            const s = j / 6;
            if (s > form) break;
            arm(s, pt);
            const a = k * TAU / 3 + spin + pt.a, r = Rc * 0.82 * pt.r;
            arm(Math.min(1, s + 0.05), pt);
            const a2 = k * TAU / 3 + spin + pt.a, r2 = Rc * 0.82 * pt.r;
            put(Math.cos(a) * r, Math.sin(a) * r, j === 6 ? 'o' : stroke(Math.cos(a2) * r2 - Math.cos(a) * r, Math.sin(a2) * r2 - Math.sin(a) * r, 0),
              shade(0.6 + 0.3 * s + 0.2 * flash), sealB * (0.65 + 0.35 * s));
          }
        }
      }
      if (release > 0) {
        const r = Rc + 1.25 * easeOut(release);
        for (let i = 0; i < 30; i++) {
          const a = even(i / 30 * TAU), c = Math.cos(a), s = Math.sin(a);
          put(c * r, s * r, stroke(-s, c, c < -0.4 ? -1 : c > 0.4 ? 1 : 0), shade(0.95 - 0.5 * release), end * (1 - release) ** 1.4);
          if (i % 2) put(c * r * 0.8, s * r * 0.8, '.', shade(0.6 - 0.3 * release), end * (1 - release) ** 1.6 * 0.5);
        }
        for (let i = 0; i < 16; i++) {
          const T = release * 0.46, a = hash(i + 3) * TAU, v = 1.4 + 2 * hash(i + 11), d = Rc * 0.3 + v * (1 - Math.exp(-3 * T)) / 3;
          const vu = 1 + 1.3 * hash(i + 19), y = Math.max(0, vu * T - 4.9 * T * T);
          put(Math.cos(a) * d, Math.sin(a) * d - y * LIFT, y <= 0 ? ',' : vu - 9.8 * T > 0 ? '\'' : '.',
            shade(0.9 - 0.4 * release), end * (1 - release) * 0.9);
        }
      }
      core(flash > 0.35 ? '@' : form > 0.2 ? 'O' : 'o', shade(0.7 + 0.3 * flash),
        Math.max(flash, sealB * 0.85, smooth(p / 0.4) * 0.5 * (1 - release)) * end);
      return;
    }

    // Zone / fallback: the inscribed water glyph.
    const Rb = clamp(effect.radius, 0.8, 4.5), Rs = clamp(effect.radius * 0.42, 0.6, 1.75);
    if (life < 2) {
      // The short summoning totem: water converges from the hit radius into the
      // seal's centre while a faint half-size ring brightens, ready for the glyph.
      const end = smooth((1 - p) / 0.22), Rh = Rs * 0.5;
      for (let k = 0; k < 3; k++) {
        for (let j = 0; j < 12; j++) {
          const tj = (p - j * 0.025) / 0.6, s = easeIn(tj);
          if (tj <= 0 || s >= 1) continue;
          const r = 0.1 + (Rb - 0.1) * (1 - s), a = k * TAU / 3 + 2.8 * s;
          put(Math.cos(a) * r, Math.sin(a) * r, j === 0 ? 'o' : j < 3 ? '~' : j % 2 ? ':' : '.',
            shade(0.4 + 0.5 * s), end * smooth(tj / 0.15) * (0.35 + 0.65 * s) * (1 - j / 13));
        }
      }
      for (let i = 0; i < 28; i++) {
        const a = even(i / 28 * TAU - age * 0.8), c = Math.cos(a), s = Math.sin(a);
        put(c * Rh, s * Rh, i % 2 ? '.' : stroke(-s, c, c < -0.4 ? -1 : c > 0.4 ? 1 : 0), shade(0.4 + 0.4 * p), end * (0.15 + 0.6 * smooth(p / 0.9)));
      }
      core(p > 0.6 ? '@' : p > 0.3 ? 'O' : 'o', shade(0.6 + 0.4 * p), end * smooth(p / 0.85));
      return;
    }
    const rem = life * (1 - p), out = smooth(rem / 1.3), dis = 1 - clamp01(rem / 1.5);
    const grow = easeOut(age / 0.8), armGrow = easeOut((age - 0.12) / 0.75), spin = age * 0.32;
    const level = out * (0.9 + 0.1 * Math.sin(age * 2.6));
    const flash = Math.exp(-((age / 0.14) ** 2));
    const keep = (i, salt) => hash(i * 1.37 + salt) >= dis * 1.15 - 0.1;
    // Sigil ring: it sweeps itself in from the top, then carries three flowing packets.
    const ringR = Rs * (1 + 0.12 * dis);
    for (let i = 0; i < 44; i++) {
      const u = i / 44;
      if (u > grow * 1.01 || !keep(i, 7)) continue;
      const a = even(-Math.PI / 2 + u * TAU), c = Math.cos(a), s = Math.sin(a), head = grow < 1 ? Math.max(0, 1 - Math.abs(grow - u) * 10) : 0;
      put(c * ringR, s * ringR, head > 0.5 ? '*' : stroke(-s, c, c < -0.4 ? -1 : c > 0.4 ? 1 : 0),
        shade(0.62 + 0.38 * head), level * (0.72 + 0.28 * head));
    }
    const step = 1.1 / (14.4 * Rs), packets = level * smooth((age - 0.6) / 0.4) * (1 - dis);
    for (let k = 0; k < 3 && packets > 0.012; k++) {
      for (let j = 0; j < 10; j++) {
        const a = even(k * TAU / 3 + age * 0.75 - Math.PI / 2 - j * step), c = Math.cos(a), s = Math.sin(a), f = 1 - j / 10;
        put(c * ringR, s * ringR, j === 0 ? '@' : j < 3 ? '=' : stroke(-s, c, c < -0.4 ? -1 : c > 0.4 ? 1 : 0),
          shade(0.6 + 0.4 * f), packets * (0.35 + 0.65 * f));
      }
    }
    // Counter-turning inner ring.
    for (let i = 0; i < 12; i++) {
      if (!keep(i, 11)) continue;
      const a = even(i / 12 * TAU - spin * 1.6), r = Rs * 0.4 * grow;
      put(Math.cos(a) * r, Math.sin(a) * r, i % 2 ? '.' : ':', shade(0.42), level * 0.6);
    }
    // The triskele: three curling arms that grow outward and unwind from the root as it dissolves.
    for (let k = 0; k < 3; k++) {
      for (let j = 0; j < 15; j++) {
        const s = j / 14;
        if (s > armGrow || s < dis * 1.1 - 0.1) continue;
        arm(s, pt);
        const a = k * TAU / 3 + spin + pt.a, r = Rs * 0.82 * pt.r;
        arm(Math.min(1, s + 0.04), pt);
        const a2 = k * TAU / 3 + spin + pt.a, r2 = Rs * 0.82 * pt.r;
        const tip = j === 14, lead = armGrow < 1 && Math.abs(armGrow - s) < 0.1;
        put(Math.cos(a) * r, Math.sin(a) * r, tip ? 'O' : lead ? 'o' : stroke(Math.cos(a2) * r2 - Math.cos(a) * r, Math.sin(a2) * r2 - Math.sin(a) * r, 0),
          shade(0.58 + 0.32 * s + (tip ? 0.1 : 0)), level * (tip ? 1 : 0.92 - 0.25 * s));
      }
    }
    // Beads between the arms ride the ring.
    for (let k = 0; k < 3; k++) {
      const a = even(k * TAU / 3 + spin + Math.PI / 3), pulse = 0.5 + 0.5 * Math.sin(age * 3 + k * 2.1);
      if (keep(k, 13)) put(Math.cos(a) * ringR * 1.1, Math.sin(a) * ringR * 1.1, 'o', shade(0.75 + 0.2 * pulse), level * grow * (0.55 + 0.4 * pulse));
    }
    // A ripple rolls out from the seal every 1.7 s; droplets of mist lift off it.
    if (age > 0.9 && dis < 1) {
      const q = ((age - 0.9) % 1.7) / 1.7, r = Rs * 0.35 + (Rb - Rs * 0.35) * easeOut(q);
      for (let i = 0; i < 18; i++) {
        const a = even(i / 18 * TAU + q), c = Math.cos(a), s = Math.sin(a);
        put(c * r, s * r, stroke(-s, c, c < -0.4 ? -1 : c > 0.4 ? 1 : 0), shade(0.7 - 0.4 * q), level * (1 - dis) * 0.5 * (1 - q) ** 1.5 * smooth(q / 0.08));
      }
    }
    for (let i = 0; i < 6; i++) {
      const t = (age / 2.2 + hash(i + 40)) % 1, a = hash(i + 50) * TAU, r = Rs * (0.2 + 0.75 * hash(i + 60));
      put(Math.cos(a) * r, Math.sin(a) * r - t * 1.1 * LIFT, t < 0.5 ? '\'' : '.', shade(0.8), level * grow * 0.45 * Math.sin(Math.PI * t));
    }
    for (let i = 0; i < 6 && flash > 0.02; i++) {
      const a = i / 6 * TAU, r = 0.2 + age * 2;
      put(Math.cos(a) * r, Math.sin(a) * r, '*', shade(1), flash);
    }
    core('@', shade(0.85 + 0.15 * flash), level * Math.max(0.8 * (1 - dis), flash));
  },
  sounds: {
    // Three rising dry strokes inscribe the glyph; three compact marks release it.
    cast: [
      { kind: 'recording', url: '/assets/audio/spells/mitlan/glyph-trace.wav', gain: 0.2, rate: 0.85, delay: 0 },
      { kind: 'recording', url: '/assets/audio/spells/mitlan/glyph-trace.wav', gain: 0.21, rate: 1, delay: 0.16 },
      { kind: 'recording', url: '/assets/audio/spells/mitlan/glyph-trace.wav', gain: 0.23, rate: 1.18, delay: 0.32 },
    ],
    impact: [
      { kind: 'recording', url: '/assets/audio/spells/mitlan/glyph-mark.wav', gain: 0.28, rate: 0.85, delay: 0 },
      { kind: 'recording', url: '/assets/audio/spells/mitlan/glyph-mark.wav', gain: 0.18, rate: 1, delay: 0.09 },
      { kind: 'recording', url: '/assets/audio/spells/mitlan/glyph-mark.wav', gain: 0.17, rate: 1.18, delay: 0.18 },
    ],
    pulse: [
      { kind: 'recording', url: '/assets/audio/spells/mitlan/glyph-trace.wav', gain: 0.06, rate: 1.1, delay: 0 },
    ],
  },
};
