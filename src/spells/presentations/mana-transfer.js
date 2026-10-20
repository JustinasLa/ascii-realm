// Mana Transfer: an open source gate inhales loose mana, braids it into a paired
// blue-green helix that runs forward (+z, towards the receiver) and the receiving
// gate closes around the delivered packets. Glyph orientation follows the heading.
const deep = [38, 96, 196], blue = [89, 187, 255], teal = [96, 222, 214], green = [112, 242, 164];
const pale = [201, 255, 236], white = [244, 255, 250], moss = [54, 156, 110];
const TAU = Math.PI * 2;

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = v => { v = clamp01(v); return v * v * (3 - 2 * v); };
const easeOut = v => 1 - (1 - clamp01(v)) ** 3;
const easeIn = v => clamp01(v) ** 2;
const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Screen cells per local metre along a direction (26 columns, 6.5 rows per metre).
function cells(view, dx, dz) {
  return Math.max(Math.abs(dx * view.c + dz * view.s) * 26, Math.abs(dz * view.c - dx * view.s) * 6.5);
}
// Line glyph for a local tangent as it appears on screen (rows are ~2x as tall as columns).
function slope(view, dx, dz) {
  let a = Math.atan2((dz * view.c - dx * view.s) * 13, (dx * view.c + dz * view.s) * 26);
  if (a < 0) a += Math.PI;
  return a < 0.39 || a > 2.75 ? '-' : a < 1.18 ? '\\' : a < 1.96 ? '|' : '/';
}
const screenX = (view, dx, dz) => dx * view.c + dz * view.s;

// One open bracket of a mana gate: an arc around (0, cz) on one side, its upright
// middle drawn as [ or ] so the gate stays readable at any heading.
function gate(plot, view, cz, side, radius, color, light, inner = true) {
  const span = radius * (1.62 * cells(view, 0, 1) + 0.42 * cells(view, 1, 0));
  const spread = 0.95, n = Math.max(3, Math.min(9, 1 + 2 * Math.round(span / 4)));
  for (let k = 0; k < n; k++) {
    const th = -spread + 2 * spread * k / (n - 1), ox = side * Math.cos(th), oz = Math.sin(th);
    let char = slope(view, -side * Math.sin(th), Math.cos(th));
    if (char === '|') char = screenX(view, ox, oz) < 0 ? '[' : ']';
    const edge = 1 - Math.abs(th) / spread;
    plot(ox * radius, cz + oz * radius, char, mix(color, pale, 0.35 * edge), light * (0.55 + 0.45 * edge));
  }
  // A nested pale lip, only where the gate is wide enough on screen to keep a gap.
  if (inner && radius * cells(view, 1, 0) > 9) {
    plot(side * radius * 0.72, cz, screenX(view, side, 0) < 0 ? '[' : ']', pale, light * 0.7);
  }
}

// Two counter-phase strands twisting along z from z0 to z1 (amp is in metres at heading 0). Packets ride the strands;
// strand crossings glint, the strand behind is dimmer and drawn with dots.
function braid(plot, view, t, z0, z1, a0, a1, amp, light, o) {
  if (z1 - z0 < 0.02) return;
  const along = cells(view, 0, 1), step = (along < 13 ? 0.55 : 1.15) / along, cols = cells(view, 1, 0), span = a1 - a0, k = TAU / 0.85;
  amp *= 26 / cols; // keep the twist equally wide on screen whatever the heading
  const n = Math.min(o.max, Math.floor((z1 - z0) / step) + 1);
  for (let i = 0; i < n; i++) {
    const z = z1 - i * step, u = clamp01((z - a0) / span);
    const a = amp * (0.3 + 0.7 * Math.sin(Math.PI * u) ** 0.6);
    const fade = light * smooth((z - z0) / o.tail) * (o.head ? smooth((z1 - z) / o.head) : 1);
    const phase = (z - a0) * k - t * o.twist, sx = a * Math.sin(phase), cs = Math.cos(phase);
    const cross = Math.abs(2 * sx) * cols < 1.4, base = mix(o.from, o.to, u);
    for (let s = 0; s < 2; s++) {
      const depth = s ? -cs : cs, x = s ? -sx : sx;
      if (cross && depth < 0) continue;
      const q = u * o.packets - t * o.speed - s * 0.5;
      const packet = Math.abs(q - Math.round(q)) * span / o.packets < step * 0.5;
      let char, shade, color = s ? mix(base, pale, 0.3) : base;
      if (packet) { char = 'o'; shade = depth > -0.2 ? 1 : 0.6; color = mix(s ? green : blue, pale, 0.2); }
      else if (cross) { char = '+'; shade = 0.9; color = mix(base, white, 0.4); }
      else if (depth > 0.3) { char = slope(view, (s ? -1 : 1) * a * k * cs, 1); shade = 0.95; }
      else if (depth > -0.3) { char = ':'; shade = 0.75; }
      else { char = '.'; shade = 0.55; color = mix(color, deep, 0.45); }
      plot(x, z, char, color, fade * shade);
    }
  }
}

function cast(effect, plot, view) {
  const p = effect.progress, t = effect.age, out = smooth((1 - p) / 0.2), L = 1.7;
  // Wind-up: loose mana motes spiral in and are swallowed by the source core.
  const gather = p / 0.3;
  for (let i = 0; i < 26 && gather < 1.05; i++) {
    const k = clamp01((gather - hash(i) * 0.25) / 0.75);
    if (k <= 0 || k >= 1) continue;
    const r = (0.62 + 0.42 * hash(i + 40)) * (1 - k * k), a = hash(i + 80) * TAU + k * 2.3;
    plot(Math.cos(a) * r, Math.sin(a) * r, k < 0.3 ? '.' : k < 0.6 ? ':' : k < 0.85 ? '+' : '*',
      mix(deep, pale, k), (0.3 + 0.7 * k) * out);
  }
  // Source core charges, kicks the stream off, then drains into it.
  const charge = smooth(p / 0.28), drain = smooth((p - 0.5) / 0.35);
  const core = charge * (1 - 0.8 * drain);
  plot(0, 0, core > 0.75 ? '@' : core > 0.4 ? 'O' : 'o', mix(blue, white, core), (0.3 + 0.7 * core) * out);
  const kick = (p - 0.24) / 0.2;
  if (kick > 0 && kick < 1) for (let i = 0; i < 10; i++) {
    const a = i / 10 * TAU + 0.3, r = 0.1 + 0.36 * easeOut(kick);
    plot(Math.cos(a) * r, Math.sin(a) * r, kick < 0.4 ? '*' : '.', mix(white, blue, kick), (1 - kick) * smooth(kick / 0.15) * out);
  }
  // Source gate opens around the caster and closes after the stream has left.
  const open = easeOut((p - 0.04) / 0.22), shut = smooth((p - 0.58) / 0.3);
  const sw = 0.2 + 0.24 * open - 0.1 * shut, sLight = open * (1 - shut) * out;
  gate(plot, view, 0, -1, sw, blue, sLight);
  gate(plot, view, 0, 1, sw, blue, sLight);
  // The braid shoots forward with an eased head and is reeled in from the tail.
  const launch = easeOut((p - 0.24) / 0.3), head = L * launch;
  const tail = Math.max(0.12, L * easeIn((p - 0.58) / 0.3));
  braid(plot, view, t, tail, Math.max(tail, head), 0, L, 0.17, out,
    { from: blue, to: green, twist: 10, speed: 1.6, packets: 4, max: 42, tail: 0.25, head: 0 });
  // Spilled mana: motes shed from the braid drift outward and wink out.
  const reach = Math.max(tail, head) - tail, widen = 26 / cells(view, 1, 0);
  const spill = smooth((reach - 0.1) / 0.35) * out;
  for (let j = 0; j < 22 && reach > 0.1; j++) {
    const f = (t * 1.4 + hash(j + 60)) % 1, side = j % 2 ? 1 : -1;
    const z = tail + hash(j + 100) * reach + f * 0.12, x = side * (0.07 + f * 0.22 + hash(j + 120) * 0.05) * widen;
    plot(x, z, f < 0.35 ? '*' : f < 0.7 ? '`' : '.', mix(side < 0 ? blue : green, pale, hash(j + 140) * 0.5),
      Math.sin(Math.PI * f) * 0.75 * spill);
  }
  if (launch > 0 && launch < 0.97) {
    // Leading comet: eases in on launch and burns out just before it reaches the receiver.
    const comet = smooth(launch / 0.08) * (1 - smooth((launch - 0.85) / 0.12)) * out;
    plot(0, head, '*', white, comet);
    for (let j = 0; j < 5; j++) {
      const back = 0.08 + j * 0.08 + hash(j + 9) * 0.04;
      const x = Math.sin(t * 17 + j * 2.1) * (0.05 + j * 0.035);
      plot(x, head - back, j < 2 ? ':' : '.', mix(pale, teal, j / 5), (1 - j / 6) * 0.8 * comet);
    }
  }
  // Receiving gate opens as the head arrives, then cinches around the packets.
  const arrive = smooth((launch - 0.7) / 0.3), cinch = easeOut((p - 0.7) / 0.2);
  const rw = (0.16 + 0.26 * arrive) * (1 - 0.55 * cinch), rLight = arrive * out * (0.75 + 0.25 * cinch);
  gate(plot, view, L, -1, rw, green, rLight);
  gate(plot, view, L, 1, rw, green, rLight);
  const fill = clamp01(tail / L) * arrive;
  if (arrive > 0) plot(0, L, fill > 0.8 ? '@' : fill > 0.45 ? 'O' : fill > 0.15 ? 'o' : '.',
    mix(green, white, fill * 0.7), (0.4 + 0.6 * Math.max(fill, arrive * 0.4)) * out);
  // Receipt bloom: a soft ring and shed motes around the filled receiver.
  const bloom = (p - 0.84) / 0.16, bloomIn = smooth(bloom / 0.15);
  if (bloom > 0) for (let i = 0; i < 16; i++) {
    const ring = i < 10, a = ring ? i / 10 * TAU : hash(i + 20) * TAU;
    const r = ring ? 0.14 + 0.46 * easeOut(bloom) : 0.2 + (0.25 + 0.4 * hash(i + 30)) * easeOut(bloom);
    plot(Math.cos(a) * r, L + Math.sin(a) * r, ring ? (bloom < 0.4 ? '+' : '.') : '\'',
      mix(white, ring ? green : moss, clamp01(bloom * 1.3)), (1 - bloom * 0.7) * bloomIn * out);
  }
}

function aura(effect, plot, view) {
  const p = effect.progress, t = effect.age, env = smooth(t / 0.12) * smooth((1 - p) / 0.4);
  // Link ring: two comets (blue giver, green receiver) chase each other around a tilted ring.
  const R = 0.55 * (0.82 + 0.18 * easeOut(t / 0.25));
  const n = Math.max(16, Math.min(40, Math.round(TAU * R * 16 / 1.7))), ca = t * 4.2;
  for (let i = 0; i < n; i++) {
    const th = i / n * TAU;
    const ba = ((ca - th) % TAU + TAU) % TAU, bb = ((ca + Math.PI - th) % TAU + TAU) % TAU;
    const ia = ba < 1.5 ? (1 - ba / 1.5) ** 1.6 : 0, ib = bb < 1.5 ? (1 - bb / 1.5) ** 1.6 : 0, I = Math.max(ia, ib);
    const char = I > 0.85 ? 'O' : I > 0.55 ? '*' : I > 0.3 ? '+' : I > 0.1 ? slope(view, -Math.sin(th), Math.cos(th)) : '.';
    const color = I > 0.1 ? mix(ia > ib ? blue : green, white, I * 0.35) : mix(deep, teal, 0.45);
    plot(Math.cos(th) * R, Math.sin(th) * R, char, color, env * (0.22 + 0.78 * I));
  }
  // Open brackets flank the ring; the braid runs through it from giver to receiver.
  gate(plot, view, 0, -1, R + 0.14, blue, env * 0.75, false);
  gate(plot, view, 0, 1, R + 0.14, green, env * 0.75, false);
  braid(plot, view, t, -0.95, 0.95, -0.95, 0.95, 0.11, env * 0.85,
    { from: blue, to: green, twist: 9, speed: 1.2, packets: 4, max: 34, tail: 0.3, head: 0.3 });
  const beat = 0.5 + 0.5 * Math.sin(t * 9);
  plot(0, 0, beat > 0.6 ? 'O' : 'o', mix(teal, white, beat * 0.6), env * (0.6 + 0.4 * beat));
}

function impact(effect, plot, view) {
  const p = effect.progress, out = smooth((1 - p) / 0.35);
  const pull = clamp01(p / 0.22), burst = clamp01((p - 0.2) / 0.8);
  // Anticipation: paired motes are drawn into the receiver.
  for (let i = 0; i < 18 && pull < 1; i++) {
    const r = (0.72 + 0.36 * hash(i + 5)) * (1 - pull * pull), a = hash(i + 9) * TAU - pull * 1.8;
    plot(Math.cos(a) * r, Math.sin(a) * r, pull < 0.5 ? ':' : '+', mix(i % 2 ? green : blue, pale, pull),
      (0.35 + 0.65 * pull) * (1 - smooth((pull - 0.8) / 0.2)) * out);
  }
  // The receiving brackets snap shut on the arrival, then hold while it glows.
  const w = 0.62 - 0.26 * easeOut(p / 0.26), gl = out * (0.45 + 0.55 * (1 - burst));
  gate(plot, view, 0, -1, w, blue, gl);
  gate(plot, view, 0, 1, w, green, gl);
  const flash = p < 0.2 ? smooth(p / 0.2) : 1 - smooth((p - 0.2) / 0.35);
  plot(0, 0, flash > 0.7 ? '@' : flash > 0.35 ? 'O' : 'o', mix(green, white, flash), Math.max(flash, 0.35) * out);
  if (burst > 0) {
    // A two-frame attack keeps the strong frame from popping in.
    const hit = smooth(burst / 0.05);
    // Star rays on the strong frame.
    const rays = burst / 0.4;
    for (let i = 0; i < 8 && rays < 1; i++) {
      const a = i / 8 * TAU + 0.39, c = Math.cos(a), s = Math.sin(a), char = slope(view, c, s);
      for (let j = 0; j < 3; j++) {
        const r = (0.14 + j * 0.13) * (0.4 + 0.6 * easeOut(rays));
        plot(c * r, s * r, char, mix(white, pale, j / 3), (1 - rays) * (1 - j * 0.25) * hit * out);
      }
    }
    // Shock ring thins out stably (by index) as it widens.
    const r = 0.2 + 0.85 * easeOut(burst), n = Math.max(12, Math.min(40, Math.round(TAU * r * 16 / 1.6)));
    for (let i = 0; i < n; i++) {
      if (hash(i + 50) < burst * 0.55) continue;
      const a = i / n * TAU;
      plot(Math.cos(a) * r, Math.sin(a) * r, burst < 0.3 ? '*' : burst < 0.6 ? '+' : '.',
        mix(mix(pale, green, clamp01(burst * 1.6)), moss, burst), (1 - burst) ** 1.3 * hit * out);
    }
    // Paired sparks fly out with drag.
    for (let i = 0; i < 20; i++) {
      const a = i / 20 * TAU + hash(i) * 0.3;
      const d = 0.15 + (0.5 + 0.7 * hash(i + 3)) * (1 - Math.exp(-3.5 * burst)) / 0.97;
      const glow = (1 - burst) ** 1.5 * (0.6 + 0.4 * hash(i + 7)) * hit * out, color = mix(i % 2 ? green : blue, pale, 0.5 * (1 - burst));
      plot(Math.cos(a) * d, Math.sin(a) * d, burst < 0.35 ? '*' : burst < 0.7 ? '+' : '.', color, glow);
      // A short trail behind each spark while it is still fast.
      const lag = d - 0.1 * Math.exp(-3.5 * burst) - 0.03;
      if (lag > 0.15) plot(Math.cos(a) * lag, Math.sin(a) * lag, slope(view, Math.cos(a), Math.sin(a)), mix(color, deep, 0.3), glow * 0.55);
    }
  }
  // Two reservoirs, giver blue and receiver green, settle on either side of the core.
  for (let side = -1; side <= 1; side += 2) plot(side * (0.11 + 0.07 * easeOut(burst)), 0, burst < 0.5 ? 'O' : 'o',
    side < 0 ? blue : green, smooth(p / 0.2) * out);
}

function pulse(effect, plot, view) {
  const p = effect.progress, out = smooth((1 - p) / 0.4);
  const rmax = Math.max(0.5, Math.min(1.4, effect.radius * 0.6));
  for (let w = 0; w < 2; w++) {
    const q = clamp01((p - w * 0.22) / 0.78), r = (0.15 + 0.85 * easeOut(q)) * rmax;
    const n = Math.max(10, Math.min(30, Math.round(TAU * r * 16 / 1.8)));
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU;
      plot(Math.cos(a) * r, Math.sin(a) * r, slope(view, -Math.sin(a), Math.cos(a)),
        mix(w ? green : blue, pale, 0.35 * (1 - q)), (1 - q) * out * (w ? 0.65 : 1));
    }
  }
  // A blue and a green packet swap sides along a shallow arc.
  const s = smooth(p / 0.7);
  for (let k = 0; k < 2; k++) {
    const dir = k ? -1 : 1;
    for (let j = 0; j < 4; j++) {
      const f = clamp01(s - j * 0.06), x = dir * (-0.42 + 0.84 * f), z = dir * 0.16 * Math.sin(Math.PI * f);
      plot(x, z, j ? (j < 2 ? ':' : '.') : 'o', k ? green : blue, (1 - j * 0.25) * out);
    }
  }
  plot(0, 0, '+', white, (1 - smooth(p / 0.25)) * out);
}

function zone(effect, plot, view) {
  const p = effect.progress, t = effect.age, env = smooth(t / 0.3) * smooth((1 - p) / 0.25);
  const R = Math.max(0.5, Math.min(6, effect.radius)) * 0.9;
  const n = Math.max(16, Math.min(64, Math.round(TAU * R * 16 / 1.8))), ca = t * 2.4;
  for (let i = 0; i < n; i++) {
    const th = i / n * TAU, ba = ((ca - th) % Math.PI + Math.PI) % Math.PI;
    const I = ba < 1.1 ? (1 - ba / 1.1) ** 1.5 : 0;
    plot(Math.cos(th) * R, Math.sin(th) * R, I > 0.7 ? '*' : I > 0.3 ? '+' : slope(view, -Math.sin(th), Math.cos(th)),
      I > 0.1 ? mix(i % 2 ? green : blue, white, I * 0.3) : mix(deep, teal, 0.5), env * (0.25 + 0.75 * I));
  }
  // Mana spirals inward from the rim and is drunk by the central gate.
  for (let i = 0; i < 24; i++) {
    const f = (t * 0.35 + i / 24) % 1, r = R * (1 - f), a = i * 2.4 + f * 3.5;
    plot(Math.cos(a) * r, Math.sin(a) * r, f < 0.45 ? '.' : f < 0.8 ? ':' : 'o', mix(blue, green, f),
      env * (0.3 + 0.6 * f) * smooth((1 - f) / 0.12));
  }
  gate(plot, view, 0, -1, 0.36, blue, env * 0.85);
  gate(plot, view, 0, 1, 0.36, green, env * 0.85);
  plot(0, 0, 'O', mix(teal, white, 0.4 + 0.3 * Math.sin(t * 6)), env);
}

function projectile(effect, plot, view) {
  const p = effect.progress, t = effect.age, out = smooth((1 - p) / 0.15), spin = t * 14;
  braid(plot, view, t, -1, -0.1, -1, 0, 0.1, out * 0.9,
    { from: deep, to: teal, twist: -12, speed: -2, packets: 3, max: 26, tail: 0.45, head: 0 });
  for (let i = 0; i < 8; i++) {
    const f = (t * 1.6 + i / 8) % 1;
    plot((hash(i) - 0.5) * 0.5 * f + Math.sin(t * 5 + i) * 0.03, -0.12 - f * 0.85, f < 0.4 ? ':' : '.',
      i % 2 ? green : blue, (1 - f) * 0.7 * out);
  }
  plot(Math.cos(spin) * 0.15, Math.sin(spin) * 0.07, 'o', blue, out);
  plot(-Math.cos(spin) * 0.15, -Math.sin(spin) * 0.07, 'o', green, out);
  plot(0, 0, '@', mix(pale, white, 0.5), out);
}

const stages = { cast, aura, impact, pulse, zone, projectile };

export default {
  id: 'mana-transfer', duration: 1.12,
  draw(effect, plot) {
    const view = { c: Math.cos(effect.heading || 0), s: Math.sin(effect.heading || 0) };
    (stages[effect.stage] ?? aura)(effect, plot, view);
  },
  sounds: {
    cast: [
      { kind: 'tone', type: 'sine', frequency: 238, endFrequency: 177, duration: 0.12, gain: 0.075, attack: 0.002, release: 0.1 },
      { kind: 'tone', type: 'sine', frequency: 356, endFrequency: 248, delay: 0.13, duration: 0.13, gain: 0.065, attack: 0.002, release: 0.11 },
      { kind: 'tone', type: 'sine', frequency: 238, endFrequency: 177, delay: 0.29, duration: 0.12, gain: 0.055, attack: 0.002, release: 0.1 },
      { kind: 'tone', type: 'sine', frequency: 356, endFrequency: 248, delay: 0.42, duration: 0.13, gain: 0.05, attack: 0.002, release: 0.11 },
      { kind: 'tone', type: 'sine', frequency: 520, endFrequency: 1160, delay: 0.16, duration: 0.44, gain: 0.032, attack: 0.06, release: 0.13 },
    ],
    impact: [
      { kind: 'tone', type: 'triangle', frequency: 784, endFrequency: 780, duration: 0.23, gain: 0.055, attack: 0.003, release: 0.2, cutoff: 1800 },
      { kind: 'tone', type: 'triangle', frequency: 1176, endFrequency: 1168, delay: 0.095, duration: 0.28, gain: 0.04, attack: 0.003, release: 0.24, cutoff: 2400 },
    ],
    pulse: [
      { kind: 'tone', type: 'sine', frequency: 356, endFrequency: 310, duration: 0.075, gain: 0.018, attack: 0.002, release: 0.06 },
      { kind: 'tone', type: 'sine', frequency: 534, endFrequency: 465, delay: 0.065, duration: 0.075, gain: 0.015, attack: 0.002, release: 0.06 },
    ],
  },
};
