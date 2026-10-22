// Cerrith Glyph: a four-leaf knot, bound to a rune ring by squared root curls.
// The seed spins in flight, the ground glyph writes itself stroke by stroke,
// breathes with a heartbeat while it shields, and shielded allies are wrapped
// in a rising helix of leaves.
const TAU = Math.PI * 2;
const GREEN = [131, 225, 106], DEEP = [58, 150, 82], WEAVE = [216, 240, 157];
const WOOD = [178, 143, 84], POLLEN = [247, 222, 126], BLOOM = [240, 255, 226];
const DURATION = 1.15;
// One metre of height expressed along the ground's screen-up axis (5 rows vs 6.5).
const HEIGHT = 5 / 6.5;
// A squared root curl for the +x/+z diagonal, in glyph radii: a stem leaves the
// knot, squares outward to touch the rune ring, then hooks back on itself.
const ROOT = [[0.2, 0.2], [0.45, 0.45], [0.7, 0.45], [0.7, 0.7], [0.45, 0.7], [0.45, 0.57], [0.58, 0.57]];
const ROOT_LENGTHS = ROOT.slice(1).map(([x, z], i) => Math.hypot(x - ROOT[i][0], z - ROOT[i][1]));
const ROOT_TOTAL = ROOT_LENGTHS.reduce((sum, length) => sum + length, 0);
const MOTE = '.\':*o';
const PETAL = ',\'`.';

const fin = (value, fallback) => (Number.isFinite(value) ? value : fallback);
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const span = (v, a, b) => clamp01((v - a) / (b - a));
const smooth = v => { v = clamp01(v); return v * v * (3 - 2 * v); };
const easeOut = v => 1 - (1 - clamp01(v)) ** 3;
const easeIn = v => clamp01(v) ** 2;
const bell = v => (v <= 0 || v >= 1 ? 0 : Math.sin(Math.PI * v));
const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
// Even screen spacing around a ground ellipse that is twice as wide as tall.
const evenAngle = u => u + Math.sin(2 * u) / 6;
const RGB = [0, 0, 0], RING = [0, 0];
function tint(a, b, t) {
  t = clamp01(t);
  RGB[0] = a[0] + (b[0] - a[0]) * t; RGB[1] = a[1] + (b[1] - a[1]) * t; RGB[2] = a[2] + (b[2] - a[2]) * t;
  return RGB;
}
// sx in columns, sy in column-widths down the screen (a row is about two columns tall).
function lineChar(sx, sy) {
  const ax = Math.abs(sx), ay = Math.abs(sy);
  if (ay < ax * 0.42) return '-';
  if (ay > ax * 2.4) return '|';
  return sx * sy > 0 ? '\\' : '/';
}
const tipChar = (sx, sy) => (Math.abs(sy) > Math.abs(sx) * 0.75 ? (sy < 0 ? '^' : 'v') : sx < 0 ? '<' : '>');

export default {
  id: 'cerrith-glyph',
  duration: DURATION,
  draw(effect, plot) {
    const p = clamp01(fin(effect.progress, 0));
    const age = Math.max(0, fin(effect.age, 0));
    const life = Math.max(0.05, fin(effect.life, DURATION));
    const radius = Math.max(0.1, Math.min(40, fin(effect.radius, 1)));
    const heading = fin(effect.heading, 0), hc = Math.cos(heading), hs = Math.sin(heading);
    const stage = effect.stage;
    // Every stage reaches darkness exactly at the end of its clock.
    const end = Math.min(1, (1 - p) * 8);
    const LX = hs * HEIGHT, LZ = -hc * HEIGHT;
    const screenX = (dx, dz) => (dx * hc + dz * hs) * 26;
    const screenY = (dx, dz) => (dz * hc - dx * hs) * 13;
    const dir = (dx, dz) => lineChar(screenX(dx, dz), screenY(dx, dz));
    const put = (x, z, char, color, light) => plot(x, z, char, color, clamp01(light) * end);
    // World angle -> local ground point, so rings stay evenly spaced on screen.
    const ringPoint = (r, phi, h = 0) => {
      const wx = r * Math.cos(phi), wz = r * Math.sin(phi);
      RING[0] = wx * hc - wz * hs + h * LX; RING[1] = wx * hs + wz * hc + h * LZ;
      return RING;
    };
    const ringChar = phi => lineChar(-Math.sin(phi) * 26, Math.cos(phi) * 13);
    let surge = () => 0;

    // A teardrop leaf from the knot outward at local angle a; reveal traces base -> tip.
    const leaf = (a, base, len, wid, spacing, maxN, reveal, light, glow) => {
      if (reveal <= 0 || light <= 0.004) return;
      const ux = Math.sin(a), uz = Math.cos(a), vx = uz, vz = -ux;
      // About one sample per row and per `spacing` columns, whichever is denser.
      const n = Math.max(3, Math.min(maxN, Math.round(len * Math.max(Math.abs(screenX(ux, uz)) / spacing, Math.abs(screenY(ux, uz)) / 2))));
      for (let k = 1; k < n; k++) {
        const t = k / n;
        if (t > reveal) break;
        const t2 = t + 0.03, w = wid * Math.sin(Math.PI * t ** 0.72), w2 = wid * Math.sin(Math.PI * Math.min(1, t2) ** 0.72);
        const along = base + t * len, lead = 1 - clamp01((reveal - t) * 5);
        const shade = (0.5 + 0.4 * t + surge(along / (base + len) * 0.67)) * light;
        const color = tint(GREEN, BLOOM, Math.max(glow, lead * 0.85));
        for (let side = -1; side <= 1; side += 2) {
          put(ux * along + vx * w * side, uz * along + vz * w * side,
            dir(ux * 0.03 * len + vx * (w2 - w) * side, uz * 0.03 * len + vz * (w2 - w) * side), color, shade + lead * 0.3);
        }
        // The midrib follows behind the outline at every other step.
        if (k % 3 === 0 && t < 0.85) put(ux * along, uz * along, dir(ux, uz), tint(WEAVE, BLOOM, glow), shade * 0.55);
      }
      if (reveal >= 1) {
        const tip = base + len;
        put(ux * tip, uz * tip, tipChar(screenX(ux, uz), screenY(ux, uz)), tint(WEAVE, BLOOM, glow), light + surge(1) * light);
      }
    };
    // The squared root curl, mirrored into each diagonal; corners are knotted with '+'.
    const root = (g, sx, sz, spacing, reveal, light, glow) => {
      if (reveal <= 0 || light <= 0.004) return;
      let walked = 0;
      for (let s = 0; s < ROOT_LENGTHS.length; s++) {
        const [x0, z0] = ROOT[s], [x1, z1] = ROOT[s + 1], length = ROOT_LENGTHS[s];
        // One sample per `spacing` columns or per one and a half rows of the segment.
        const dx = (x1 - x0) * g * sx, dz = (z1 - z0) * g * sz;
        const steps = Math.max(1, Math.min(4, Math.round(Math.max(Math.abs(screenX(dx, dz)) / spacing, Math.abs(screenY(dx, dz)) / 3))));
        for (let k = 1; k <= steps; k++) {
          const t = k / steps, along = (walked + t * length) / ROOT_TOTAL;
          if (along > reveal) return;
          const x = (x0 + (x1 - x0) * t) * g * sx, z = (z0 + (z1 - z0) * t) * g * sz;
          const corner = k === steps;
          const lead = 1 - clamp01((reveal - along) * 6);
          put(x, z, corner ? '+' : dir(dx, dz), tint(WOOD, BLOOM, Math.max(glow, lead * 0.7)),
            (corner ? 0.85 : 0.68) * light + surge(Math.hypot(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t)) * light + lead * 0.25);
        }
        walked += length;
      }
    };
    // A rune ring traced outward in both directions from its start angle.
    const ring = (r, n, spin, reveal, paint) => {
      if (reveal <= 0) return;
      for (let k = 0; k < n; k++) {
        const u = k / n * TAU, reach = Math.abs(Math.atan2(Math.sin(u), Math.cos(u))) / Math.PI;
        if (reach > reveal) continue;
        const phi = evenAngle(u + spin), [x, z] = ringPoint(r, phi);
        paint(x, z, ringChar(phi), k, phi, 1 - clamp01((reveal - reach) * 6));
      }
    };
    const knot = (g, light, glow) => {
      const d = 0.13 * g;
      put(0, 0, '*', tint(POLLEN, BLOOM, glow), light);
      for (let s = 0; s < 4; s++) {
        const x = (s & 1 ? 1 : -1) * d, z = (s & 2 ? 1 : -1) * d;
        put(x, z, dir(-z, x), tint(WEAVE, BLOOM, glow), light * 0.8);
      }
    };

    if (stage === 'projectile') {
      // A spinning clover seed with a pollen wake and two twisting vine strands.
      const g = Math.max(0.3, Math.min(1.2, radius)) * 0.6;
      const appear = smooth(age / 0.08), bob = 0.08 * Math.sin(age * 5);
      const spin = age * 6;
      for (let s = 0; s < 4; s++) {
        const a = spin + s * Math.PI / 2, ux = Math.sin(a), uz = Math.cos(a), vx = uz, vz = -ux;
        for (let k = 1; k <= 2; k++) {
          const t = k / 3, al = g * (0.15 + 0.85 * t), w = g * 0.32 * Math.sin(Math.PI * t ** 0.72);
          for (let side = -1; side <= 1; side += 2) {
            const dw = g * 0.32 * (Math.sin(Math.PI * Math.min(1, t + 0.05) ** 0.72) - Math.sin(Math.PI * t ** 0.72));
            put(ux * al + vx * w * side + bob * LX, uz * al + vz * w * side + bob * LZ,
              dir(ux * 0.05 * g + vx * dw * side, uz * 0.05 * g + vz * dw * side), GREEN, (0.6 + 0.3 * t) * appear);
          }
        }
        const tip = g;
        put(ux * tip + bob * LX, uz * tip + bob * LZ, tipChar(screenX(ux, uz), screenY(ux, uz)), WEAVE, 0.9 * appear);
      }
      put(bob * LX, bob * LZ, 'o', BLOOM, appear);
      for (let i = 0; i < 16; i++) {
        const back = 0.2 + i * 0.11, fadeI = (1 - i / 16) ** 1.4;
        const x = Math.sin(age * 7 - i * 0.7) * 0.05 * (1 + i * 0.15) + (hash(i) - 0.5) * 0.035 * i;
        const intensity = fadeI * (0.75 + 0.25 * Math.sin(age * 11 + i * 2.3));
        put(x, -back + (hash(i + 9) - 0.5) * 0.05, MOTE[Math.min(3, Math.floor(intensity * 4))],
          tint(POLLEN, DEEP, i / 16), 0.9 * intensity * appear);
      }
      for (let strand = 0; strand < 2; strand++) {
        for (let j = 0; j < 9; j++) {
          const back = 0.16 + j * 0.12, a = age * 9 - j * 0.9 + strand * Math.PI;
          const x = Math.cos(a) * 0.13 * (1 - j / 14), x2 = Math.cos(a - 0.9) * 0.13 * (1 - (j + 1) / 14);
          put(x, -back, dir(x2 - x, -0.12), tint(GREEN, DEEP, j / 9), 0.7 * (1 - j / 9) * appear);
        }
      }
      return;
    }

    if (stage === 'pulse') {
      // A seed-bloom ripple: short tangent leaf-arcs open outward, inner streaks trail them.
      const r = Math.max(0.4, Math.min(7, radius)), e = easeOut(p);
      const rr = r * (0.2 + 0.8 * e), n = Math.max(6, Math.min(22, Math.round(5 + r * 3)));
      const light = 0.85 * (1 - p) ** 1.3, arc = Math.min(0.2, 1.3 / (rr * 22));
      for (let k = 0; k < n; k++) {
        const phi = evenAngle(k / n * TAU + r * 0.7) + (hash(k + r) - 0.5) * 0.12;
        const reach = rr * (0.95 + 0.1 * hash(k)), shade = light * (0.75 + 0.25 * hash(k + 3));
        for (let j = -1; j <= 1; j += 2) {
          const a = phi + j * arc / 2, [x, z] = ringPoint(reach, a);
          put(x, z, ringChar(a), tint(BLOOM, GREEN, e * 1.2 + (j > 0 ? 0.25 : 0)), shade * (j > 0 ? 0.8 : 1));
        }
        if (r >= 2 && k % 2 === 0) {
          const [ix, iz] = ringPoint(rr * 0.82, phi);
          put(ix, iz, lineChar(Math.cos(phi) * 26, Math.sin(phi) * 13), tint(GREEN, DEEP, e), light * 0.5);
        }
      }
      if (p < 0.4) put(0, 0, '*', POLLEN, bell(p / 0.4) * 0.9);
      return;
    }

    if (stage === 'aura') {
      // Leaves spiral up around the shielded ally; overlapping ticks form a steady helix.
      const r = Math.max(0.4, Math.min(2, radius)) * 0.7;
      const rise = easeOut(p), light = 0.85 * smooth(p / 0.15) * (1 - p) ** 1.2;
      for (let i = 0; i < 9; i++) {
        const phi = i / 9 * TAU + age * 2.5 + hash(i) * 0.4, rad = r * (1 - 0.3 * p);
        const h = 0.1 + (0.8 + 0.5 * hash(i + 5)) * rise + 0.08 * Math.sin(age * 6 + i);
        const [x, z] = ringPoint(rad, phi, h);
        const sx = -Math.sin(phi) * rad * 26, sy = Math.cos(phi) * rad * 13 - 2;
        put(x, z, lineChar(sx, sy), tint(WEAVE, GREEN, p * 1.3), light);
        const [tx, tz] = ringPoint(rad, phi - 0.3, h - 0.06);
        put(tx, tz, '.', DEEP, light * 0.6);
      }
      if (p < 0.5) {
        const glow = 0.5 * (1 - p / 0.5) ** 2;
        for (let k = 0; k < 14; k++) {
          const phi = evenAngle(k / 14 * TAU - age * 1.5), [x, z] = ringPoint(r * 1.08, phi);
          put(x, z, ringChar(phi), tint(GREEN, DEEP, p * 2), glow);
        }
      }
      return;
    }

    if (stage === 'zone') {
      const g = Math.max(0.9, Math.min(2.4, radius * 0.55));
      if (life < 2) {
        // The summoning breath: pollen converges and the rune ring traces itself.
        const fade = smooth((1 - p) / 0.35);
        ring(g, 36, age * 0.4, easeOut(p / 0.6), (x, z, ch, k, phi, lead) =>
          put(x, z, ch, tint(GREEN, BLOOM, lead * 0.9), (0.55 + 0.45 * lead) * fade));
        for (let i = 0; i < 24; i++) {
          const q = clamp01(p * 1.5 - hash(i) * 0.45), phi = hash(i + 4) * TAU + q * 1.8;
          const [x, z] = ringPoint(g * (1.5 - 0.5 * easeIn(q)), phi);
          const light = 0.25 + 0.75 * bell(q);
          put(x, z, MOTE[Math.min(4, Math.floor(light * 5))], tint(GREEN, POLLEN, q), light * fade * smooth(p / 0.1));
        }
        knot(g, 0.6 * smooth(p / 0.5) * fade, 0.4);
        return;
      }
      // The standing glyph writes itself, breathes a heartbeat outward, then unravels.
      const intro = Math.min(1.1, life * 0.3), ti = age / intro;
      const fade = smooth((1 - p) * life / Math.min(0.9, life * 0.25));
      const beat = (age * 0.55) % 1 * 1.5 - 0.2;
      surge = d => 0.35 * Math.exp(-(((d - beat) / 0.12) ** 2));
      const shrink = 0.85 + 0.15 * fade;
      ring(g, 28, age * 0.12, easeOut(span(ti, 0, 0.35)), (x, z, ch, k, phi, lead) => {
        const bead = k % 7 === 0;
        const wave = 0.5 + 0.5 * Math.sin(phi * 3 - age * 1.8);
        put(x, z, bead ? 'o' : ch, bead ? POLLEN : tint(DEEP, WEAVE, wave * 0.6 + lead),
          (0.55 + 0.3 * wave + surge(1) + lead * 0.4) * fade);
      });
      for (let s = 0; s < 4; s++) {
        const reveal = easeOut(span(ti, 0.12 + s * 0.06, 0.7 + s * 0.06));
        const a = s * Math.PI / 2 + 0.05 * Math.sin(age * 1.4 + s * 1.7);
        leaf(a, 0.07 * g, 0.6 * g * shrink, 0.2 * g, 2.6, 12, reveal, 0.95 * fade, 0);
        root(g * shrink, s & 1 ? 1 : -1, s & 2 ? 1 : -1, 6, easeOut(span(ti, 0.4, 1)), 0.75 * fade, 0);
      }
      knot(g, (0.75 + surge(0) * 0.7) * smooth(ti * 3) * fade, 0.3 + surge(0));
      for (let i = 0; i < 6; i++) {
        // Pollen drifts inward and upward from the ring, rising faster as the glyph unravels.
        const q = (age * 0.22 + hash(i)) % 1, phi = hash(i + 7) * TAU + q * 1.6 + age * 0.1;
        const [x, z] = ringPoint(g * (1 - 0.75 * easeIn(q)), phi, q * 0.9 + (1 - fade) * 1.2);
        const light = bell(q) * 0.8;
        put(x, z, MOTE[Math.min(4, Math.floor(light * 5))], tint(POLLEN, BLOOM, light * 0.4), light * smooth(ti) * (0.4 + 0.6 * fade));
      }
      return;
    }

    if (stage === 'impact') {
      // The glyph slams down: leaves snap open past rest, a shock ring rolls out,
      // root hooks lash outward and torn petals arc away before the glyph thins out.
      const g = Math.max(0.5, Math.min(2.6, radius)) * 1.2;
      const open = span(p, 0, 0.35), back = 1.7;
      const snap = 0.45 + 0.55 * (1 + (back + 1) * (open - 1) ** 3 + back * (open - 1) ** 2);
      const flash = 1 - span(p, 0, 0.3), dissolve = 1 - smooth(span(p, 0.55, 1));
      const e = easeOut(p), shock = (1 - p) ** 1.5;
      ring(g * (0.4 + 1.3 * e), 34, 0, 1, (x, z, ch, k) =>
        put(x, z, ch, tint(BLOOM, DEEP, p * 1.4), shock * (0.7 + 0.3 * hash(k))));
      for (let s = 0; s < 4; s++) {
        leaf(s * Math.PI / 2, 0.07 * g, 0.6 * g * snap, 0.2 * g * snap, 1.8, 12, 1, dissolve, flash);
        root(g * (0.85 + 0.3 * e), s & 1 ? 1 : -1, s & 2 ? 1 : -1, 3.5, easeOut(span(p, 0.05, 0.4)), 0.85 * dissolve, flash * 0.6);
      }
      knot(g, Math.max(flash, 0.6 * dissolve), flash);
      for (let i = 0; i < 18; i++) {
        const q = span(p, 0.04 + hash(i) * 0.08, 1), phi = hash(i + 11) * TAU;
        const dist = g * (0.5 + (1.4 + hash(i + 5)) * (1 - Math.exp(-4 * q)) / 1.2);
        const h = (1.6 + hash(i + 2)) * q * (1 - q) * g * 0.6;
        const [x, z] = ringPoint(dist, phi + Math.sin(q * 6 + i) * 0.08, h);
        put(x, z, PETAL[(i + Math.floor(q * 8)) % 4], tint(i % 3 ? GREEN : POLLEN, DEEP, q), 0.9 * (1 - q) ** 1.2 * span(p, 0, 0.04));
      }
      return;
    }

    // Cast: pollen spirals in, the knot writes itself leaf by leaf, roots and ring
    // bind it with a bright pulse, then petals scatter and the glyph thins away.
    const g = Math.max(0.5, Math.min(2.6, radius)) * 1.5;
    const glow = bell(span(p, 0.62, 0.86));
    const dissolve = 1 - smooth(span(p, 0.76, 1));
    // Each stroke fades on its own staggered clock so the glyph thins out instead of popping.
    const stagger = k => clamp01((dissolve - 0.5 * hash(k)) * 2);
    for (let i = 0; i < 16; i++) {
      const q = span(p, 0.08 * hash(i), 0.3 + 0.06 * hash(i + 1));
      if (q >= 1) continue;
      const phi = hash(i + 2) * TAU + 2.2 * q;
      const [x, z] = ringPoint(g * (2.1 - 1.95 * easeIn(q)), phi, 0.3 * (1 - q));
      const light = (0.3 + 0.7 * q) * (1 - span(q, 0.88, 1)) * smooth(q / 0.12);
      put(x, z, MOTE[Math.min(4, 1 + Math.floor(q * 4))], tint(DEEP, POLLEN, q), light);
    }
    knot(g, Math.max(bell(span(p, 0.22, 0.42)), smooth(span(p, 0.3, 0.4)) * 0.7) * dissolve, Math.max(glow, bell(span(p, 0.22, 0.42))));
    for (let s = 0; s < 4; s++) {
      leaf(s * Math.PI / 2, 0.07 * g, 0.6 * g, 0.2 * g, 1.6, 12, easeOut(span(p, 0.28 + s * 0.04, 0.6 + s * 0.04)),
        (0.85 + 0.15 * glow) * stagger(s + 40), glow * 0.8);
      root(g, s & 1 ? 1 : -1, s & 2 ? 1 : -1, 3.5, easeOut(span(p, 0.45, 0.72)), (0.8 + 0.2 * glow) * stagger(s + 50), glow * 0.6);
    }
    ring(g, 36, age * 0.6, easeOut(span(p, 0.4, 0.75)), (x, z, ch, k, phi, lead) => {
      const fade = stagger(k + 60);
      if (fade > 0) put(x, z, ch, tint(DEEP, BLOOM, Math.max(lead, glow * 0.8)), (0.5 + 0.4 * lead + 0.4 * glow) * fade);
    });
    for (let i = 0; i < 14; i++) {
      // Petals shed from the ring with drag, fluttering as they drift and fall away.
      const q = span(p, 0.7 + 0.06 * hash(i + 20), 1);
      if (q <= 0) continue;
      const phi = i / 14 * TAU + hash(i + 21) * 0.4;
      const dist = g * (1 + 0.9 * (1 - Math.exp(-3.5 * q))) + Math.sin(q * 9 + i) * 0.05;
      const [x, z] = ringPoint(dist, phi, 0.5 * q - 0.6 * q * q);
      put(x, z, PETAL[(i + Math.floor(q * 10)) % 4], tint(i % 3 ? WEAVE : POLLEN, GREEN, q), 0.9 * (1 - q) ** 1.3 * smooth(q / 0.08));
    }
  },
  sounds: {
    cast: [
      // Two measured wooden contacts inscribe the seal while roots strain beneath it.
      { kind: 'recording', url: '/assets/audio/spells/cerrith/wood-knock.wav', gain: 0.3, rate: 0.94, delay: 0 },
      { kind: 'recording', url: '/assets/audio/spells/cerrith/wood-knock.wav', gain: 0.35, rate: 0.79, delay: 0.38 },
      { kind: 'recording', url: '/assets/audio/spells/cerrith/root-creak.wav', gain: 0.29, rate: 0.85, delay: 0.12 },
      { kind: 'recording', url: '/assets/audio/spells/cerrith/leaf-drift.wav', gain: 0.16, rate: 0.93, delay: 0.27 },
    ],
    impact: [
      // The ward plants with packed earth and splitting timber; roots hold under tension.
      { kind: 'recording', url: '/assets/audio/spells/cerrith/earth-impact.wav', gain: 0.46, rate: 0.82, delay: 0 },
      { kind: 'recording', url: '/assets/audio/spells/cerrith/branch-snap.wav', gain: 0.28, rate: 0.89, delay: 0.035 },
      { kind: 'recording', url: '/assets/audio/spells/cerrith/branch-strain.wav', gain: 0.3, rate: 0.83, delay: 0.13 },
    ],
    pulse: [
      // Small foliage movements keep recurring shielding contacts unobtrusive.
      { kind: 'recording', url: '/assets/audio/spells/cerrith/leaf-turn.wav', gain: 0.12, rate: 1.16, delay: 0 },
    ],
  },
};
