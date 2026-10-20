const TAU = Math.PI * 2;
const DEEP = [52, 112, 222];
const RUNE = [111, 183, 249];
const ICE = [176, 232, 255];
const WHITE = [246, 253, 255];
// Isa (ice), Hagalaz (hail), Algiz, Gebo, Ehwaz and Tiwaz read as ASCII staves.
const RUNES = ['I', 'N', 'Y', 'X', 'M', 'T'];
const MOTES = ['.', "'", '+', '*'];

const clamp = value => Math.max(0, Math.min(1, value));
const span = (value, from, to) => clamp((value - from) / (to - from));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const easeOut = value => 1 - (1 - clamp(value)) ** 3;
const easeIn = value => clamp(value) ** 2;
const hash = seed => { const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const lerp = (a, b, t) => a + (b - a) * t;
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const cycle = value => value - Math.floor(value);

// 0 is the deep rune blue of a cold stave, 1 is white frost catching the light.
function frost(value) {
  const t = clamp(value);
  const [a, b, k] = t < 0.4 ? [DEEP, RUNE, t / 0.4]
    : t < 0.75 ? [RUNE, ICE, (t - 0.4) / 0.35] : [ICE, WHITE, (t - 0.75) / 0.25];
  return [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
}

// The adapter rotates local metres by the heading and draws one metre as 26 columns
// by 6.5 double-height rows; pick the stroke that matches the on-screen direction.
function view(heading) {
  const cos = Math.cos(heading), sin = Math.sin(heading);
  return {
    stroke(dx, dz) {
      const wx = dx * cos + dz * sin, wz = dz * cos - dx * sin;
      let angle = Math.atan2(wz * 13, wx * 26);
      if (angle < 0) angle += Math.PI;
      if (angle < Math.PI / 8 || angle >= Math.PI * 7 / 8) return '-';
      if (angle < Math.PI * 3 / 8) return '\\';
      return angle < Math.PI * 5 / 8 ? '|' : '/';
    },
    cells(dx, dz) {
      const wx = dx * cos + dz * sin, wz = dz * cos - dx * sin;
      return Math.max(Math.abs(wx) * 26 / 1.6, Math.abs(wz) * 6.5);
    },
    // Billboarded effects author in screen-aligned metres (+x right, +z down).
    local(wx, wz) { return [wx * cos - wz * sin, wx * sin + wz * cos]; },
  };
}

// Dissolving glyphs drop out by a stable per-glyph hash so they thin, not flicker.
function pen(plot, thin, seed) {
  return (id, x, z, char, color, light) => {
    if (light <= 0.012 || (thin > 0 && hash(id * 0.731 + seed) < thin)) return;
    plot(x, z, char, color, Math.min(1, light));
  };
}

// Six-armed frost sigil inscribed in a hexagon with a rune on each face.
function sigil(put, eye, o) {
  const { R, turn, light, heat = 0, reveal, ring = 1, rune, step = 1, maxN = 12, edgeN = maxN,
    branches = 2, glint = -1 } = o;
  // Arms lie along 0/60/120 degrees so the tilted ground reads as clean - / \ strokes.
  const vertex = arm => turn + arm * TAU / 6;
  for (let arm = 0; arm < 6; arm++) {
    const angle = vertex(arm);
    const ux = Math.cos(angle), uz = Math.sin(angle);
    const grown = reveal(arm);
    if (grown <= 0) continue;
    const inner = R * 0.17, reach = inner + (R - inner) * grown;
    const spine = eye.stroke(ux, uz);
    const n = Math.max(3, Math.min(maxN, Math.round(eye.cells(ux * R, uz * R) / step)));
    for (let i = 0; i < n; i++) {
      const d = inner + (R - inner) * (i + 0.5) / n;
      if (d > reach) break;
      const along = d / R;
      const shine = glint >= 0 ? Math.exp(-(((along - glint) / 0.11) ** 2)) : 0;
      put(arm * 97 + i, ux * d, uz * d, shine > 0.55 ? '+' : spine,
        frost(0.9 - along * 0.4 + heat + shine * 0.5), light * (0.95 - along * 0.28 + shine * 0.45));
    }
    // A bright etching head while the arm is traced, a crystal tip once complete.
    put(arm * 97 + 60, ux * reach, uz * reach, '*', frost(grown < 1 ? 1 : 0.78 + heat),
      light * (grown < 1 ? 1 : 0.92));

    // Paired forward-swept branches, longer near the core like a real dendrite.
    for (let b = 0; b < branches; b++) {
      const at = b ? 0.72 : 0.46, len = R * (b ? 0.2 : 0.3);
      const grow = clamp((grown - at) / 0.22);
      if (grow <= 0) continue;
      const bx = ux * (inner + (R - inner) * at), bz = uz * (inner + (R - inner) * at);
      for (const side of [-1, 1]) {
        const ba = angle + side * Math.PI / 3;
        const vx = Math.cos(ba), vz = Math.sin(ba);
        const char = eye.stroke(vx, vz);
        const m = Math.max(1, Math.min(b ? 2 : 3, Math.round(eye.cells(vx * len, vz * len) / step)));
        for (let i = 1; i <= m; i++) {
          const t = i / m;
          if (t > grow + 1e-6) break;
          put(arm * 97 + 61 + b * 18 + (side + 1) * 4 + i, bx + vx * len * t, bz + vz * len * t,
            i === m ? "'" : char, frost(0.62 - t * 0.2 + heat), light * (0.8 - t * 0.25));
        }
      }
    }
  }

  // The hexagon is traced edge by edge, then a rune settles on every face.
  const H = R * 1.1;
  for (let edge = 0; edge < 6; edge++) {
    const drawn = clamp(ring * 6 - edge);
    if (drawn <= 0) break;
    const a0 = vertex(edge), a1 = vertex(edge + 1);
    const x0 = Math.cos(a0) * H, z0 = Math.sin(a0) * H;
    const dx = Math.cos(a1) * H - x0, dz = Math.sin(a1) * H - z0;
    const char = eye.stroke(dx, dz);
    const n = Math.max(2, Math.min(edgeN, Math.round(eye.cells(dx, dz) / step)));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      if (t > drawn) {
        put(700 + edge * 40 + i, x0 + dx * drawn, z0 + dz * drawn, '*', frost(1), light);
        break;
      }
      put(600 + edge * 40 + i, x0 + dx * t, z0 + dz * t, char, frost(0.42 + heat), light * 0.62);
    }
    const lit = rune ? rune(edge) : 0;
    if (lit > 0) {
      const mid = (a0 + a1) / 2, rr = R * 1.24;
      put(950 + edge, Math.cos(mid) * rr, Math.sin(mid) * rr, RUNES[edge],
        frost(0.6 + lit * 0.3 + heat), light * lit);
    }
  }
}

function castStage(plot, eye, p, radius) {
  const S = Math.max(1.1, Math.min(2.6, radius * 1.5));
  const fade = clamp(p * 25) * (1 - smooth(span(p, 0.8, 1)));
  if (fade <= 0) return;

  // Wind-up: frost motes spiral in from the air and feed the charging core.
  const gather = span(p, 0, 0.36);
  if (gather < 1) {
    for (let k = 0; k < 16; k++) {
      const lag = hash(k) * 0.3, phase = clamp((gather - lag) / 0.7);
      if (phase <= 0 || phase >= 1) continue;
      const a0 = k / 16 * TAU + hash(k + 9) * 0.6;
      for (let tail = 0; tail < 3; tail++) {
        const q = Math.max(0, phase - tail * 0.06);
        const r = S * (2 - 1.85 * easeIn(q)), a = a0 + 2.2 * q;
        const glow = Math.sin(Math.PI * phase) * (1 - tail * 0.35);
        plot(Math.cos(a) * r, Math.sin(a) * r * 0.9, tail ? '.' : MOTES[1 + Math.min(2, Math.floor(q * 3))],
          frost(0.45 + q * 0.5), fade * glow);
      }
    }
  }

  // Etch: arms trace outward one after another, the hexagon closes, the runes settle.
  const flash = Math.exp(-(((p - 0.76) / 0.05) ** 2));
  const lift = easeIn(span(p, 0.8, 1));
  const put = pen(plot, span(p, 0.8, 1) * 0.85, 3);
  sigil(put, eye, {
    R: S * (1 - 0.35 * lift), turn: p * 0.18 + lift * 0.5, light: fade * (0.82 + flash * 0.18), heat: flash * 0.6,
    reveal: arm => easeOut(span(p, 0.2 + arm * 0.045, 0.48 + arm * 0.045)),
    ring: span(p, 0.42, 0.72), rune: edge => smooth(span(p, 0.6 + edge * 0.025, 0.7 + edge * 0.025)),
    step: 1.15, maxN: 12,
  });

  // The seal flashes white and throws a crown of sparks off the tips.
  if (p > 0.72) {
    const t = span(p, 0.72, 1);
    for (let k = 0; k < 18; k++) {
      const a = k / 18 * TAU + hash(k + 40) * 0.3 + p * 0.18;
      const d = S * (1.1 + (0.3 + hash(k + 70) * 0.4) * (1 - Math.exp(-5 * t)));
      plot(Math.cos(a) * d, Math.sin(a) * d - t * 0.25, t < 0.3 ? eye.stroke(Math.cos(a), Math.sin(a)) : t < 0.6 ? "'" : '.',
        frost(1 - t * 0.6), fade * (1 - t) ** 1.3);
    }
  }
  const charge = span(p, 0.05, 0.74);
  plot(0, 0, flash > 0.4 ? '@' : charge > 0.66 ? '*' : charge > 0.33 ? 'o' : '.',
    frost(0.6 + charge * 0.3 + flash), fade * (0.4 + charge * 0.5 + flash * 0.1));
}

function projectileStage(plot, eye, effect, p) {
  const age = Math.max(0, finite(effect.age, 0));
  const fade = clamp(age * 14) * clamp((1 - p) * 5);
  if (fade <= 0) return;
  const size = Math.max(0.2, Math.min(0.5, finite(effect.radius, 0.65) * 0.48));
  const spin = age * 9;

  // Frost trail: dense and white just behind the crystal, sparse blue motes further back.
  const reach = 0.25 + 1.15 * clamp(age * 2.6);
  for (let i = 0; i < 26; i++) {
    const s = (i + 0.5) / 26, back = 0.16 + s * reach;
    const sway = Math.sin(age * 7 + i * 1.7) * 0.07 * s + (hash(i) - 0.5) * 0.3 * s * s;
    const glow = (1 - s) ** 1.3 * (0.75 + 0.25 * Math.sin(age * 19 + i * 2.3));
    plot(sway, -back, s < 0.15 ? '*' : s < 0.4 ? '+' : s < 0.7 ? "'" : '.', frost(1 - s * 0.85), fade * glow);
  }
  // A tumbling six-point crystal with forward-swept barbs.
  for (let arm = 0; arm < 6; arm++) {
    const a = spin + arm * TAU / 6, ux = Math.cos(a), uz = Math.sin(a);
    const char = eye.stroke(ux, uz);
    plot(ux * size * 0.4, uz * size * 0.4, char, frost(0.95), fade);
    plot(ux * size * 0.75, uz * size * 0.75, char, frost(0.8), fade * 0.95);
    plot(ux * size, uz * size, '*', frost(0.85), fade * 0.9);
    for (const side of [-1, 1]) {
      const ba = a + side * Math.PI / 3, d = size * 0.62, len = size * 0.3;
      plot(ux * d + Math.cos(ba) * len, uz * d + Math.sin(ba) * len, "'", frost(0.6), fade * 0.7);
    }
  }
  // Glints orbit and twinkle around the crystal.
  for (let k = 0; k < 8; k++) {
    const a = -spin * 0.6 + k * TAU / 8, r = size * (1.35 + 0.15 * Math.sin(age * 5 + k));
    const tw = 0.5 + 0.5 * Math.sin(age * 16 + k * 2.4);
    plot(Math.cos(a) * r, Math.sin(a) * r, tw > 0.75 ? '+' : '.', frost(0.7 + tw * 0.3), fade * (0.25 + tw * 0.5));
  }
  plot(0, 0, '@', WHITE, fade);
}

function impactStage(plot, eye, p, radius) {
  const S = Math.max(0.8, Math.min(3.2, radius * 1.3));
  const fade = clamp(p * 30) * (1 - smooth(span(p, 0.7, 1)));
  if (fade <= 0) return;
  const burst = easeOut(p);
  const flash = 1 - smooth(span(p, 0, 0.3));

  // The seal slams down full size, white-hot, then expands and shatters away.
  sigil(pen(plot, smooth(span(p, 0.25, 0.9)), 11), eye, {
    R: S * (0.72 + 0.4 * burst), turn: p * 0.25, light: fade * 0.9, heat: flash * 0.7,
    reveal: () => 1, ring: 1, rune: () => 1 - span(p, 0.2, 0.6), step: 1.3, maxN: 8,
  });
  // Shards fly out with drag, each a needle pointing along its flight.
  for (let k = 0; k < 14; k++) {
    const a = k / 14 * TAU + hash(k + 3) * 0.4;
    const ux = Math.cos(a), uz = Math.sin(a);
    const d = S * (0.25 + (1.3 + hash(k + 21) * 0.7) * (1 - Math.exp(-5 * p)));
    const char = eye.stroke(ux, uz), light = fade * (1 - p) ** 1.2;
    plot(ux * d, uz * d, p < 0.3 ? '*' : "'", frost(1 - p * 0.5), light);
    plot(ux * (d - 0.14), uz * (d - 0.14), char, frost(0.85 - p * 0.5), light * 0.8);
    plot(ux * (d - 0.3), uz * (d - 0.3), '.', frost(0.6 - p * 0.4), light * 0.5);
  }
  // A crisp frost shockwave ring drawn with tangent strokes.
  const rr = S * (0.35 + 1.5 * burst);
  for (let k = 0; k < 30; k++) {
    if (hash(k + 50) < p * 0.7) continue;
    const a = k / 30 * TAU;
    plot(Math.cos(a) * rr, Math.sin(a) * rr, eye.stroke(-Math.sin(a), Math.cos(a)),
      frost(0.9 - p * 0.6), fade * (1 - p) ** 2 * 0.85);
  }
  // Frost motes hang and twinkle after the blast.
  for (let k = 0; k < 14; k++) {
    const t = span(p, 0.2 + hash(k + 90) * 0.2, 1);
    if (t <= 0) continue;
    const a = hash(k + 31) * TAU, r = S * (0.3 + hash(k + 61) * 1.1);
    plot(Math.cos(a) * r, Math.sin(a) * r - t * 0.35, MOTES[k % 2], frost(0.7), fade * Math.sin(Math.PI * t) * 0.7);
  }
  plot(0, 0, p < 0.2 ? '@' : p < 0.45 ? '*' : '+', frost(1), fade * (1 - p));
}

function pulseStage(plot, eye, p, radius) {
  const r = Math.max(0.4, Math.min(8, radius));
  const fade = clamp(p * 14) * (1 - p) ** 1.4;
  if (fade <= 0) return;
  const grow = easeOut(p);
  // A ring of frost races outward, thinning as it goes.
  const rr = r * (0.22 + 0.78 * grow);
  const n = Math.max(18, Math.min(44, Math.round(12 + r * 6)));
  for (let k = 0; k < n; k++) {
    if (hash(k + 7) < p * 0.55) continue;
    const a = k / n * TAU + hash(k) * 0.1;
    plot(Math.cos(a) * rr, Math.sin(a) * rr, eye.stroke(-Math.sin(a), Math.cos(a)),
      frost(0.95 - p * 0.55), fade * (0.6 + 0.4 * hash(k + 13)));
  }
  // Six ice needles stab out of the burst point.
  const len = Math.min(r * 0.45, 1.2) * grow;
  for (let arm = 0; arm < 6; arm++) {
    const a = arm * TAU / 6, ux = Math.cos(a), uz = Math.sin(a);
    const char = eye.stroke(ux, uz);
    for (let i = 1; i <= 3; i++) {
      plot(ux * len * i / 3, uz * len * i / 3, i === 3 ? '*' : char, frost(1 - i * 0.12 - p * 0.4),
        fade * (1.05 - i * 0.18));
    }
  }
  plot(0, 0, p < 0.4 ? '*' : '+', WHITE, fade);
}

function auraStage(plot, eye, effect, p, radius) {
  const age = Math.max(0, finite(effect.age, 0));
  const fade = clamp(age * 20) * clamp((1 - p) * 4);
  if (fade <= 0) return;
  const R = Math.max(0.25, Math.min(0.9, radius * 0.4));
  const grow = easeOut(age / 0.32);
  const at = (wx, wz, char, color, light) => {
    const [x, z] = eye.local(wx, wz);
    plot(x, z, char, color, light);
  };
  // Rime spreads over the ground beneath the frozen target.
  for (let k = 0; k < 18; k++) {
    const a = k / 18 * TAU, rr = R * 1.25 * grow;
    at(Math.cos(a) * rr, Math.sin(a) * rr, k % 3 ? (Math.abs(Math.sin(a)) > 0.7 ? '-' : '.') : '*',
      frost(0.45 + 0.2 * hash(k)), fade * (0.35 + 0.2 * hash(k + 5)));
  }
  // Ice crystals jut up around the target, leaning outward; a glint climbs each one.
  for (let k = 0; k < 7; k++) {
    const a = k / 7 * TAU + 0.35, bx = Math.cos(a) * R, bz = Math.sin(a) * R * 0.8;
    const height = (0.45 + hash(k + 17) * 0.4) * grow, lean = Math.cos(a) * 0.35;
    const behind = bz < 0 ? 0.65 : 1;
    const char = eye.stroke(...eye.local(lean, -1));
    const n = Math.max(1, Math.min(6, Math.round(height * 6.5)));
    const climb = (age * 1.4 + hash(k + 29)) % 1;
    for (let i = 1; i <= n; i++) {
      const t = i / n, shine = Math.exp(-(((t - climb) / 0.2) ** 2));
      at(bx + lean * height * t, bz - height * t, i === n ? '^' : char,
        frost(0.55 + t * 0.35 + shine * 0.3), fade * behind * Math.min(1, 0.55 + t * 0.3 + shine * 0.2));
    }
  }
  // Breath of frost motes rising from the shell.
  for (let k = 0; k < 8; k++) {
    const phase = (age * 0.6 + hash(k + 43)) % 1;
    const wx = (hash(k + 51) - 0.5) * R * 2.2 + Math.sin(age * 2 + k) * 0.06;
    at(wx, -phase * 1.3 - 0.1, phase < 0.5 ? "'" : '.', frost(0.8 - phase * 0.3), fade * Math.sin(Math.PI * phase) * 0.6);
  }
}

// The short-lived spawn totem: frost is drawn in to the landing point before the glyph arms.
function seedStage(plot, eye, age, p, R) {
  const fade = clamp(age * 10) * (1 - smooth(span(p, 0.6, 1)));
  if (fade <= 0) return;
  for (let ring = 0; ring < 3; ring++) {
    const t = cycle(p * 1.6 + ring / 3), rr = R * 1.3 * (1 - easeIn(t)) + R * 0.08;
    const n = 26 - ring * 4;
    for (let k = 0; k < n; k++) {
      const a = k / n * TAU + ring * 0.4 - p;
      plot(Math.cos(a) * rr, Math.sin(a) * rr, eye.stroke(-Math.sin(a), Math.cos(a)),
        frost(0.4 + t * 0.6), fade * Math.sin(Math.PI * t) * 0.8);
    }
  }
  // The hexagon flickers in faintly as a promise of the glyph to come.
  sigil(pen(plot, 0, 23), eye, {
    R, turn: 0, light: fade * 0.4 * smooth(span(p, 0.1, 0.5)), reveal: () => 0,
    ring: span(p, 0.05, 0.55), step: Math.max(1.2, R * 0.9), maxN: 8,
  });
  plot(0, 0, p < 0.5 ? '+' : '*', WHITE, fade * (0.5 + p * 0.5));
}

function zoneStage(plot, eye, effect, p, radius) {
  const age = Math.max(0, finite(effect.age, 0));
  const life = Math.max(0.05, finite(effect.life, 1));
  const reach = Math.max(0.6, Math.min(6, radius));
  const R = Math.max(0.6, Math.min(2.6, reach * 0.55));
  if (life < 2) return seedStage(plot, eye, age, p, R);
  const end = clamp((life - age) / 0.9) * clamp((1 - p) * 40);
  const fade = clamp(age * 8) * smooth(end);
  if (fade <= 0) return;

  // Opening: a frost shock ring sweeps out to the trap's reach as the glyph etches.
  if (age < 0.75) {
    const t = age / 0.75, rr = reach * easeOut(age / 0.6);
    for (let k = 0; k < 22; k++) {
      const a = k / 22 * TAU;
      plot(Math.cos(a) * rr, Math.sin(a) * rr, eye.stroke(-Math.sin(a), Math.cos(a)),
        frost(1 - t * 0.5), fade * (1 - t) ** 2);
    }
  }
  const breathe = 0.74 + 0.1 * Math.sin(age * 2.1);
  sigil(pen(plot, 1 - end, 17), eye, {
    R, turn: age * 0.06, light: fade * breathe, heat: 0.18,
    reveal: arm => easeOut(age * 1.7 - arm * 0.06), ring: clamp(age * 1.5 - 0.45),
    rune: edge => clamp(age * 2 - 1.1 - edge * 0.1) * (0.6 + 0.4 * Math.exp(-((cycle(age * 0.7 - edge / 6) / 0.12) ** 2))),
    step: Math.max(1.2, R * 0.9), maxN: 8, edgeN: 7, branches: 1, glint: age > 1.2 ? cycle(age * 0.45) * 1.4 : -1,
  });
  // The armed perimeter: frost motes circle slowly at the trap's reach, twinkling.
  const settle = smooth(span(age, 0.55, 1.4));
  for (let k = 0; k < 20 && settle > 0; k++) {
    const a = k / 20 * TAU - age * 0.12 + hash(k) * 0.15;
    const tw = 0.5 + 0.5 * Math.sin(age * (1.4 + hash(k + 4)) + hash(k + 9) * TAU);
    const rr = reach * (0.96 + 0.04 * Math.sin(age * 1.3 + k));
    plot(Math.cos(a) * rr, Math.sin(a) * rr, tw > 0.8 ? '*' : tw > 0.4 ? '+' : '.',
      frost(0.5 + tw * 0.4), fade * settle * (0.25 + tw * 0.45) * (1 - (end < 1 ? hash(k + 2) * (1 - end) : 0)));
  }
  plot(0, 0, '*', frost(0.95), fade * Math.min(1, breathe * 1.2));
}

export default {
  id: 'seithr-glyph',
  duration: 1.35,
  draw(effect, plot) {
    const p = clamp(Number.isFinite(effect.progress) ? effect.progress : 0);
    if (p >= 1) return;
    const eye = view(finite(effect.heading, 0));
    const radius = Math.max(0.2, finite(effect.radius, 2));
    switch (effect.stage) {
      case 'projectile': return projectileStage(plot, eye, effect, p);
      case 'impact': return impactStage(plot, eye, p, radius);
      case 'pulse': return pulseStage(plot, eye, p, radius);
      case 'aura': return auraStage(plot, eye, effect, p, radius);
      case 'zone': return zoneStage(plot, eye, effect, p, radius);
      default: return castStage(plot, eye, p, radius);
    }
  },
  sounds: {
    cast: [
      // Six even glass steps trace the six arms; a quiet lower partial holds them together.
      ...[784, 988, 1175, 1568, 1976, 2350].map((frequency, index) => ({
        kind: 'tone', type: 'sine', delay: index * 0.105, duration: 0.31,
        frequency, endFrequency: frequency * 0.997, gain: 0.043 - index * 0.002,
        attack: 0.003, release: 0.25,
      })),
      { kind: 'tone', type: 'triangle', delay: 0, duration: 1.04,
        frequency: 392, endFrequency: 392, gain: 0.018, attack: 0.16, release: 0.4,
        cutoff: 1100, filterType: 'lowpass' },
    ],
    impact: [
      // The sealing chord arrives together, unlike the arm-by-arm cast.
      ...[587, 784, 1175].map(frequency => ({
        kind: 'tone', type: 'triangle', delay: 0, duration: 0.65,
        frequency, endFrequency: frequency * 0.993, gain: 0.037,
        attack: 0.004, release: 0.52, cutoff: 3400, filterType: 'lowpass',
      })),
      { kind: 'tone', type: 'sine', delay: 0.065, duration: 0.38,
        frequency: 3136, endFrequency: 2349, gain: 0.022, attack: 0.002, release: 0.32 },
    ],
    pulse: [
      { kind: 'tone', type: 'sine', delay: 0, duration: 0.13,
        frequency: 1568, endFrequency: 1560, gain: 0.012, attack: 0.003, release: 0.1 },
    ],
  },
};
