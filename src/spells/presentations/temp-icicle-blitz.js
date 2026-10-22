// Icicle Blitz: a quiver of frost quills condenses in front of the caster and
// snaps forward one needle at a time, in step with the cast pings.
// Local +z is forward; the runtime rotates coordinates to the heading, while
// the needle glyphs below follow the heading so a quill always reads as a quill.

// Screen cells per metre across and down (SCALE 13 / ASPECT 0.5, SCALE 13 * TILT 0.5).
const COLS = 26;
const ROWS = 6.5;

// Deep glacier blue -> pale ice -> white-hot frost.
const STOPS = [[44, 96, 188], [64, 140, 222], [104, 196, 240], [160, 228, 252], [212, 246, 255], [246, 253, 255]];
const RAMP = Array.from({ length: 16 }, (_, index) => {
  const t = index / 15 * (STOPS.length - 1);
  const k = Math.min(STOPS.length - 2, Math.floor(t)), f = t - k;
  return STOPS[k].map((c, channel) => Math.round(c + (STOPS[k + 1][channel] - c) * f));
});
const MOTES = ['.', "'", ':', '+', '*'];

const clamp01 = value => Math.max(0, Math.min(1, value));
const tone = t => RAMP[Math.round(clamp01(t) * 15)];
const mote = t => MOTES[Math.min(4, Math.floor(clamp01(t) * 5))];
const smooth = (a, b, value) => { const t = clamp01((value - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeOut = t => 1 - (1 - clamp01(t)) ** 3;
const easeIn = t => clamp01(t) ** 3;
const hash = (index, salt) => { const v = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453; return v - Math.floor(v); };

// Lateral offset, nocked depth, and launch progress of the five quills; launches
// track the five cast pings so the volley is heard and seen together.
const LANES = [[-0.4, 0.14, 0.07], [0.3, 0.24, 0.13], [-0.13, 0.34, 0.22], [0.47, 0.18, 0.29], [0.06, 0.4, 0.4]];
const NOCK = 0.13;
const FLIGHT = 0.3;
const REACH = 1.95;

// Glyph orientation in screen space. Cells are about twice as tall as wide.
function view(heading) {
  const cos = Math.cos(heading), sin = Math.sin(heading);
  const screen = (lx, lz) => [(lx * cos + lz * sin) * COLS, (lz * cos - lx * sin) * ROWS * 2];
  const line = (lx, lz) => {
    const [vx, vy] = screen(lx, lz), ax = Math.abs(vx), ay = Math.abs(vy);
    if (ay < ax * 0.41) return '-';
    if (ax < ay * 0.41) return '|';
    return (vx > 0) === (vy > 0) ? '\\' : '/';
  };
  const tip = (lx, lz) => {
    const [vx, vy] = screen(lx, lz);
    return Math.abs(vx) > Math.abs(vy) * 1.2 ? (vx > 0 ? '>' : '<') : (vy > 0 ? 'v' : '^');
  };
  // Cells crossed per metre along local forward (z) and lateral (x).
  const along = Math.max(Math.abs(sin) * COLS, Math.abs(cos) * ROWS);
  const across = Math.max(Math.abs(cos) * COLS, Math.abs(sin) * ROWS);
  const cells = (lx, lz) => Math.max(Math.abs(lx * cos + lz * sin) * COLS, Math.abs(lz * cos - lx * sin) * ROWS);
  // On-screen length (in column widths) of a local metre vector.
  const span = (lx, lz) => Math.hypot(...screen(lx, lz));
  const flat = (lx, lz) => Math.abs(screen(lx, lz)[0]) / Math.max(1e-6, span(lx, lz));
  return { line, tip, cells, span, flat, along, across,
    shaft: line(0, 1), point: tip(0, 1),
    flankLeft: line(1 / across, 1 / along), flankRight: line(-1 / across, 1 / along) };
}

// Longest quill (projectile at its widest scale, seen side-on) is ~30 cells;
// the cap only guards the loop and never thins a shaft into dashes.
const SHAFT_CAP = 32;

// A forward-pointing quill: white tip, barbed head, shaft cooling to deep blue.
// The shaft is sampled one screen cell apart so it stays solid at any heading.
function quill(plot, v, x, tipZ, length, light) {
  if (light <= 0.002 || length <= 0.02) return;
  const n = Math.max(2, Math.min(SHAFT_CAP, Math.ceil(length * v.along)));
  for (let k = n; k >= 1; k--) {
    const u = k / n;
    plot(x, tipZ - length * u, k === n ? ':' : v.shaft, tone(0.95 - u * 0.7), Math.min(1, light * (1 - 0.62 * u)));
  }
  const back = 1 / v.along, side = 1 / v.across;
  plot(x - side, tipZ - back, v.flankLeft, tone(0.75), Math.min(1, light * 0.8));
  plot(x + side, tipZ - back, v.flankRight, tone(0.75), Math.min(1, light * 0.8));
  plot(x, tipZ, v.point, tone(1), Math.min(1, light));
}

function cast(plot, v, p, s) {
  const env = 1 - smooth(0.8, 1, p);

  // Wind-up: frost motes spiral in and are absorbed into each forming quill.
  for (let i = 0; i < 25; i++) {
    const lane = LANES[i % 5];
    const delay = hash(i, 1) * 0.07;
    const q = clamp01((p - (lane[2] - NOCK - 0.16) - delay) / 0.2);
    if (q <= 0 || q >= 1) continue;
    const e = easeIn(q);
    const angle = i * 2.39996 + (1 - e) * 1.6;
    const r = (0.95 + hash(i, 2) * 0.55) * (1 - e);
    const x = (lane[0] + Math.sin(angle) * r) * s;
    const z = (lane[1] + Math.cos(angle) * r * 0.8) * s;
    const glow = Math.sin(Math.PI * q) ** 0.6;
    plot(x, z, mote(0.25 + e * 0.75), tone(0.35 + e * 0.6), Math.min(1, glow * (0.45 + 0.5 * e)) * env);
  }

  for (let i = 0; i < LANES.length; i++) {
    const [lane, nock, launch] = LANES[i];
    const x = lane * s;
    const grow = easeOut((p - (launch - NOCK)) / NOCK);
    if (p < launch) {
      // Anticipation: the quill crystallises tip-first and draws back.
      if (grow > 0) quill(plot, v, x, (nock - 0.1 * grow) * s, 0.55 * grow * s, (0.35 + 0.5 * grow) * env);
      continue;
    }
    const f = (p - launch) / FLIGHT;
    const sinceLaunch = p - launch;

    // Muzzle burst: a crisp ring of frost sparks where the quill left.
    const m = sinceLaunch / 0.14;
    if (m < 1) {
      for (let j = 0; j < 7; j++) {
        const a = j / 7 * Math.PI * 2 + i * 0.7;
        const r = (0.06 + 0.34 * easeOut(m)) * s;
        plot(x + Math.sin(a) * r, (nock - 0.1) * s + Math.cos(a) * r * 0.7, m < 0.3 ? '*' : m < 0.65 ? '+' : '.',
          tone(1 - m * 0.6), 0.9 * (1 - m) ** 1.5 * env);
      }
    }

    // Lingering rime where the quill was nocked, drifting and thinning out.
    for (let j = 0; j < 4; j++) {
      const age = sinceLaunch / 0.6;
      if (age >= 1) break;
      const a = hash(i * 4 + j, 3) * Math.PI * 2;
      const r = (0.08 + 0.3 * (1 - Math.exp(-4 * age))) * s;
      plot(x + Math.sin(a) * r, (nock - 0.1) * s + Math.cos(a) * r * 0.6 + age * 0.12 * s, age < 0.4 ? ':' : '.',
        tone(0.55 - age * 0.3), 0.5 * (1 - age) ** 2 * env);
    }

    if (f >= 1) continue;
    const travel = 1 - (1 - f) ** 2;
    const tipZ = (nock - 0.1 + REACH * travel) * s;
    const length = 0.55 * (1 + 0.7 * (1 - f) * Math.min(1, f * 8)) * s;
    const light = (1 - f ** 1.6) * env;

    // Frost wake shed along the flight path, spreading as it ages.
    for (let k = 0; k < 7; k++) {
      const shed = f - (k + 1) * 0.04;
      if (shed < 0) break;
      const behind = f - shed;
      const z = (nock - 0.1 + REACH * (1 - (1 - shed) ** 2)) * s - length;
      const drift = (hash(i * 7 + k, 4) - 0.5) * 0.9 * behind * s;
      const fadeK = (1 - behind / 0.32) * light;
      if (fadeK <= 0) continue;
      plot(x + drift, z, mote(fadeK * 0.7), tone(0.6 - behind), 0.65 * fadeK);
    }

    quill(plot, v, x, tipZ, length, light);
  }
}

function projectile(plot, v, p, age, s) {
  const light = (1 - p) ** 0.8 * Math.min(1, 0.55 + age * 9);
  if (light <= 0.002) return;
  const tipZ = 0.46 * s, length = 0.95 * s, tail = tipZ - length;

  // Long wake of powder snow streaming back from the tail.
  for (let i = 0; i < 14; i++) {
    const phase = (i / 14 + age * 2.4) % 1;
    const spread = (hash(i, 5) - 0.5) * 0.42 * phase + Math.sin(age * 7 + i * 1.7) * 0.03;
    const intensity = (1 - phase) ** 1.5;
    plot(spread * s, tail - (0.05 + phase * 1.0) * s, mote(intensity * 0.6), tone(0.62 - phase * 0.5), 0.75 * intensity * light);
  }

  // Two helical strands of frost winding down the shaft.
  for (let strand = 0; strand < 2; strand++) {
    for (let k = 0; k < 5; k++) {
      const u = ((k + 0.5) / 5 + age * 3.2) % 1;
      const swirl = Math.sin(Math.PI * 2 * (u * 1.5 - age * 4) + strand * Math.PI);
      const front = Math.cos(Math.PI * 2 * (u * 1.5 - age * 4) + strand * Math.PI);
      plot(swirl * (0.05 + 0.1 * u) * s, tipZ - (0.25 + u * 0.8) * length, front > 0 ? '+' : '.',
        tone(0.82 - u * 0.4), (0.4 + 0.35 * Math.max(0, front)) * (1 - u * 0.6) * light);
    }
  }

  quill(plot, v, 0, tipZ, length, light);

  // Intentional glint racing over the tip.
  const glint = Math.sin(age * 23) * 0.5 + 0.5;
  if (glint > 0.55) plot(0, tipZ + 0.6 / v.along, '*', tone(1), light * (glint - 0.3));
}

function impact(plot, v, p, s) {
  // White flash at the point of contact.
  if (p < 0.2) plot(0, 0, p < 0.07 ? '@' : '#', tone(1), 1 - smooth(0.04, 0.2, p));

  // Ice bloom: eight crystal spikes punch out, stand frozen for a beat, then
  // crumble tip-first into chips that drift outward and melt away.
  const grow = easeOut(p / 0.1);
  const settle = 1 - 0.25 * smooth(0.1, 0.3, p);
  for (let j = 0; j < 8; j++) {
    const a = j / 8 * Math.PI * 2 + 0.2 + (hash(j, 40) - 0.5) * 0.18;
    const dx = Math.sin(a), dz = Math.cos(a);
    // Sized on screen (dense '-' runs trimmed), so the tilted ground does not
    // squash the star into a horizontal bar.
    const full = (j % 2 ? 7.5 : 13) * (1 - 0.32 * v.flat(dx, dz)) * (0.9 + 0.2 * hash(j, 41)) * s / v.span(dx, dz);
    const n = Math.max(3, Math.min(16, Math.ceil(full * v.cells(dx, dz))));
    const glyph = v.line(dx, dz);
    for (let k = 1; k <= n; k++) {
      const u = k / n;
      if (u > grow + 1e-9) break;
      const r = full * u;
      const breakAt = 0.3 + (1 - u) * 0.3 + hash(j * 19 + k, 42) * 0.08;
      if (p < breakAt) {
        plot(dx * r, dz * r, k === n ? '+' : glyph, tone(1 - u * 0.5 - p * 0.4),
          Math.min(1, (1 - u * 0.45) * settle));
        continue;
      }
      const d = (p - breakAt) / 0.32;
      if (d >= 1) continue;
      const out = r + (0.06 + 0.22 * hash(j * 19 + k, 43)) * s * easeOut(d);
      const twist = a + (hash(j * 19 + k, 44) - 0.5) * 0.35 * d;
      const spin = twist + (hash(j * 19 + k, 45) - 0.5) * 9 * d;
      plot(Math.sin(twist) * out, Math.cos(twist) * out, d < 0.45 ? v.line(Math.sin(spin), Math.cos(spin)) : '.',
        tone(0.8 - d * 0.5), 0.7 * (1 - d) ** 1.5);
    }
  }

  // Ground frost shockwave ring, cooling and breaking up as it expands.
  if (p > 0.02) {
    const radius = (0.2 + 0.95 * easeOut(p * 1.2)) * s;
    const ring = (1 - p) ** 1.3;
    for (let j = 0; j < 32; j++) {
      if (hash(j, 7) < smooth(0.35, 1, p)) continue;
      const a = j / 32 * Math.PI * 2;
      const r = radius * (1 + (hash(j, 6) - 0.5) * 0.06);
      plot(Math.sin(a) * r, Math.cos(a) * r, mote(ring * (0.55 + hash(j, 8) * 0.45)), tone(0.85 - p * 0.65), 0.75 * ring);
    }
  }

  if (p < 0.03) return;
  // Tumbling ice chips flung clear on drag-damped trajectories.
  for (let i = 0; i < 10; i++) {
    const a = i / 10 * Math.PI * 2 + 0.5 + hash(i, 9) * 0.35;
    const speed = 1 + hash(i, 10) * 0.9;
    const r = (0.1 + speed * 0.55 * (1 - Math.exp(-5 * p))) * s;
    const dx = Math.sin(a), dz = Math.cos(a);
    const spin = a + (hash(i, 11) - 0.5) * 12 * p;
    const shardLight = (1 - p) ** 1.3 * (0.6 + 0.4 * hash(i, 12));
    plot(dx * r, dz * r, v.line(Math.sin(spin), Math.cos(spin)), tone(1 - p * 0.75 - hash(i, 13) * 0.15), shardLight);
    const lag = r - 0.11 * s * (1 - p);
    plot(dx * lag, dz * lag, '.', tone(0.5 - p * 0.3), shardLight * 0.45);
  }

  // Snowflakes settle and twinkle after the hit (echoing the summoned flakes).
  for (let i = 0; i < 8; i++) {
    const appear = 0.12 + hash(i, 16) * 0.2;
    const shown = smooth(appear, appear + 0.12, p);
    if (shown <= 0) continue;
    const a = hash(i, 17) * Math.PI * 2;
    const r = (0.3 + hash(i, 18) * 0.6 + p * 0.1) * s;
    const twinkle = 0.65 + 0.35 * Math.sin(p * 30 + i * 2.1);
    const b = shown * (1 - p) ** 0.9 * twinkle;
    plot(Math.sin(a) * r, Math.cos(a) * r, b > 0.45 ? '*' : '+', tone(0.9), b);
  }
}
function pulse(plot, v, p, s) {
  // Frost fractures race across the ground from the struck point.
  const grow = easeOut(p / 0.45);
  const light = (1 - p) ** 1.2;
  for (let j = 0; j < 5; j++) {
    let a = j / 5 * Math.PI * 2 + 0.3 + (hash(j, 20) - 0.5) * 0.5;
    const total = (0.55 + hash(j, 21) * 0.35) * s;
    let x = 0, z = 0;
    const segments = 4, shown = total * grow;
    let travelled = 0;
    for (let seg = 0; seg < segments && travelled < shown; seg++) {
      a += (hash(j * 4 + seg, 22) - 0.5) * 0.9;
      const dx = Math.sin(a), dz = Math.cos(a);
      const segLen = Math.min(total / segments, shown - travelled);
      const n = Math.max(1, Math.min(4, Math.round(segLen * v.cells(dx, dz))));
      const glyph = v.line(dx, dz);
      for (let k = 1; k <= n; k++) {
        const along = (travelled + segLen * k / n) / Math.max(1e-6, shown);
        plot(x + dx * segLen * k / n, z + dz * segLen * k / n, glyph, tone(0.45 + along * 0.55),
          light * (0.35 + 0.65 * along * along));
      }
      x += dx * segLen; z += dz * segLen; travelled += segLen;
    }
    plot(x, z, '*', tone(1), light);
  }
  // A few motes kicked up around the cracks.
  for (let i = 0; i < 8; i++) {
    const a = hash(i, 23) * Math.PI * 2, r = (0.2 + hash(i, 24) * 0.6 * grow) * s;
    plot(Math.sin(a) * r, Math.cos(a) * r, mote(light * 0.6), tone(0.7), 0.6 * light * smooth(0.05, 0.3, p + hash(i, 25) * 0.2));
  }
}

function aura(plot, v, p, age, s) {
  const env = smooth(0, 0.12, p) * (1 - smooth(0.55, 1, p));
  if (env <= 0) return;
  // Three small quills orbit the bearer, curving with the orbit.
  for (let i = 0; i < 3; i++) {
    const a = i / 3 * Math.PI * 2 + age * 2.4;
    const r = 0.62 * s;
    const step = 1 / Math.max(1, v.cells(Math.cos(a), -Math.sin(a)) * r);
    for (let k = 4; k >= 1; k--) {
      const b = a - k * step;
      plot(Math.sin(b) * r, Math.cos(b) * r, v.line(Math.cos(b), -Math.sin(b)), tone(0.85 - k * 0.12), env * (1 - k * 0.17));
    }
    plot(Math.sin(a) * r, Math.cos(a) * r, v.tip(Math.cos(a), -Math.sin(a)), tone(1), env);
  }
  // Counter-rotating ring of rime with sin turbulence and twinkle.
  for (let j = 0; j < 22; j++) {
    const a = j / 22 * Math.PI * 2 - age * 0.9;
    const r = (0.86 + Math.sin(a * 3 + age * 4) * 0.05) * s;
    const twinkle = 0.55 + 0.45 * Math.sin(age * 9 + j * 2.3);
    plot(Math.sin(a) * r, Math.cos(a) * r, mote(twinkle * 0.8), tone(0.45 + twinkle * 0.35), env * 0.6 * twinkle);
  }
  // Inner frost crystals breathing in place.
  for (let j = 0; j < 9; j++) {
    const a = hash(j, 26) * Math.PI * 2, r = (0.18 + hash(j, 27) * 0.24) * s;
    const twinkle = 0.5 + 0.5 * Math.sin(age * 6 + j * 1.9);
    plot(Math.sin(a) * r, Math.cos(a) * r, twinkle > 0.6 ? '*' : '+', tone(0.7 + twinkle * 0.3), env * 0.55 * twinkle);
  }
}

function zone(plot, v, p, age, radius) {
  const env = smooth(0, 0.1, p) * (1 - smooth(0.7, 1, p));
  if (env <= 0) return;
  const R = Math.max(0.8, Math.min(2.5, radius));
  // Slow blizzard of motes circling the field.
  for (let i = 0; i < 40; i++) {
    const r = Math.sqrt(hash(i, 30)) * R;
    const a = hash(i, 31) * Math.PI * 2 + age * (0.5 + 0.4 / (0.3 + r));
    const wobble = Math.sin(age * 3 + i) * 0.05;
    const twinkle = 0.5 + 0.5 * Math.sin(age * 5 + i * 1.3);
    plot(Math.sin(a) * (r + wobble), Math.cos(a) * (r + wobble), mote(twinkle * 0.7), tone(0.4 + twinkle * 0.4), env * 0.55 * twinkle);
  }
  // Ice spikes heave up out of the field in turn and sink away.
  for (let i = 0; i < 6; i++) {
    const cycle = (age * 0.6 + hash(i, 32)) % 1;
    const rise = Math.sin(Math.PI * cycle);
    const a = hash(i, 33) * Math.PI * 2, r = (0.25 + hash(i, 34) * 0.6) * R;
    const x = Math.sin(a) * r, z = Math.cos(a) * r;
    quill(plot, v, x, z + 0.3 * rise, 0.35 * rise, env * rise);
  }
}

function draw(effect, plot) {
  const raw = Number.isFinite(effect.progress) ? effect.progress
    : (Number.isFinite(effect.age) && effect.life > 0 ? effect.age / effect.life : 0);
  const progress = clamp01(raw);
  if (progress >= 1) return;
  const life = Number.isFinite(effect.life) && effect.life > 0 ? effect.life : 1;
  const age = Number.isFinite(effect.age) ? effect.age : progress * life;
  const radius = Number.isFinite(effect.radius) ? effect.radius : 1;
  const v = view(Number.isFinite(effect.heading) ? effect.heading : 0);

  switch (effect.stage) {
    case 'projectile': return projectile(plot, v, progress, age, Math.max(0.85, Math.min(1.2, radius / 0.65)));
    case 'impact': return impact(plot, v, progress, Math.max(0.8, Math.min(1.25, radius)));
    case 'pulse': return pulse(plot, v, progress, Math.max(0.8, Math.min(1.25, radius)));
    case 'aura': return aura(plot, v, progress, age, Math.max(0.8, Math.min(1.25, radius)));
    case 'zone': return zone(plot, v, progress, age, radius);
    default: return cast(plot, v, progress, Math.max(0.85, Math.min(1.15, radius / 0.8)));
  }
}

export default {
  id: 'temp-icicle-blitz',
  duration: 1.02,
  draw,
  sounds: {
    // Frozen breath and strained glacier bass carry an uneven, brittle volley.
    cast: [
      { kind: 'noise', delay: 0, duration: 0.61, gain: 0.025, attack: 0.055, decay: 0.13, sustain: 0.25, release: 0.29, cutoff: 1150, filterType: 'bandpass', Q: 0.7, playbackRate: 0.65 },
      { kind: 'tone', delay: 0, duration: 0.66, gain: 0.05, attack: 0.025, decay: 0.15, sustain: 0.3, release: 0.32, frequency: 117, endFrequency: 76, type: 'triangle', cutoff: 360, filterType: 'lowpass', Q: 0.6 },
      { kind: 'tone', delay: 0.071, duration: 0.15, gain: 0.042, attack: 0.002, decay: 0.037, sustain: 0.14, release: 0.10, frequency: 1260, endFrequency: 730, type: 'triangle', cutoff: 1650, filterType: 'lowpass', Q: 0.65 },
      { kind: 'tone', delay: 0.133, duration: 0.17, gain: 0.035, attack: 0.002, decay: 0.045, sustain: 0.12, release: 0.11, frequency: 960, endFrequency: 590, type: 'triangle', cutoff: 1500, filterType: 'lowpass', Q: 0.65 },
      { kind: 'tone', delay: 0.224, duration: 0.18, gain: 0.039, attack: 0.002, decay: 0.05, sustain: 0.1, release: 0.12, frequency: 1430, endFrequency: 820, type: 'triangle', cutoff: 1750, filterType: 'lowpass', Q: 0.7 },
      { kind: 'tone', delay: 0.408, duration: 0.22, gain: 0.032, attack: 0.003, decay: 0.065, sustain: 0.13, release: 0.14, frequency: 1080, endFrequency: 630, type: 'sine', cutoff: 1450, filterType: 'lowpass', Q: 0.65 },
    ],
    // A close ice fracture, its dense frozen core, then chips in a hollow tail.
    impact: [
      { kind: 'noise', delay: 0, duration: 0.18, gain: 0.065, attack: 0.002, decay: 0.035, sustain: 0.16, release: 0.12, cutoff: 1900, filterType: 'bandpass', Q: 0.9, playbackRate: 0.8 },
      { kind: 'tone', delay: 0, duration: 0.28, gain: 0.048, attack: 0.003, decay: 0.06, sustain: 0.17, release: 0.19, frequency: 185, endFrequency: 67, type: 'triangle', cutoff: 540, filterType: 'lowpass', Q: 0.65 },
      { kind: 'tone', delay: 0.019, duration: 0.29, gain: 0.027, attack: 0.002, decay: 0.065, sustain: 0.12, release: 0.21, frequency: 1187, endFrequency: 879, type: 'sine', cutoff: 1550, filterType: 'lowpass', Q: 0.7 },
      { kind: 'noise', delay: 0.061, duration: 0.13, gain: 0.021, attack: 0.002, decay: 0.028, sustain: 0.12, release: 0.09, cutoff: 2500, filterType: 'bandpass', Q: 0.8, playbackRate: 0.7 },
      { kind: 'noise', delay: 0.12, duration: 0.38, gain: 0.014, attack: 0.022, decay: 0.07, sustain: 0.2, release: 0.26, cutoff: 690, filterType: 'lowpass', Q: 0.6, playbackRate: 0.55 },
    ],
    // Projectile/field repeats: a quiet splinter with breath and buried ice strain.
    pulse: [
      { kind: 'tone', delay: 0, duration: 0.13, gain: 0.014, attack: 0.002, decay: 0.028, sustain: 0.12, release: 0.09, frequency: 790, endFrequency: 565, type: 'triangle', cutoff: 1250, filterType: 'lowpass', Q: 0.6 },
      { kind: 'noise', delay: 0.012, duration: 0.17, gain: 0.011, attack: 0.008, decay: 0.04, sustain: 0.17, release: 0.11, cutoff: 1370, filterType: 'bandpass', Q: 0.7, playbackRate: 0.65 },
      { kind: 'tone', delay: 0.027, duration: 0.21, gain: 0.012, attack: 0.012, decay: 0.043, sustain: 0.18, release: 0.14, frequency: 134, endFrequency: 98, type: 'sine', cutoff: 320, filterType: 'lowpass', Q: 0.6 },
    ],
  },
};
