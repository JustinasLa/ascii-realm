// Cold Embrace: two crescent arms of ice gather frost, reach around the target
// and close on it, sealing it in binding bands before thawing into drifting motes.
const DEEP = [44, 92, 170];
const FROST = [80, 157, 211];
const ICE = [125, 211, 244];
const EDGE = [220, 249, 255];
const WHITE = [255, 255, 255];
const CHILL = [DEEP, FROST, ICE, EDGE, WHITE];
const RAMP = '.:-=+*#%@';

const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const smooth = (from, to, value) => {
  const t = clamp((value - from) / (to - from));
  return t * t * (3 - 2 * t);
};
const easeOut = t => 1 - (1 - t) ** 3;
const easeIn = t => t * t * t;
const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const hash = (index, salt = 0) => {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return value - Math.floor(value);
};
const bell = (x, centre, width) => Math.exp(-(((x - centre) / width) ** 2));
const ramp = t => RAMP[clamp(Math.floor(t * RAMP.length), 0, RAMP.length - 1)];

// Cold gradient: deep blue (0) through frost and ice to a white-hot flash (1).
function chill(t) {
  const f = clamp(t) * (CHILL.length - 1);
  const i = Math.min(CHILL.length - 2, Math.floor(f));
  const a = CHILL[i], b = CHILL[i + 1], u = f - i;
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
}

function progressOf(effect) {
  if (Number.isFinite(effect.progress)) return clamp(effect.progress);
  const life = Number.isFinite(effect.life) && effect.life > 0 ? effect.life : 1.15;
  return clamp((Number.isFinite(effect.age) ? effect.age : 0) / life);
}

// The adapter rotates local metres by the heading and squashes them into cells
// (one metre is ~26 columns by 6.5 rows). Strokes pick glyphs and spacing in that
// on-screen space so lines stay continuous and slant the right way at any heading.
function viewOf(heading) {
  const h = Number.isFinite(heading) ? heading : 0;
  const c = Math.cos(h), s = Math.sin(h);
  return {
    // Cells stepped (Chebyshev), so spacing 1 gives an unbroken line of glyphs.
    dist: (dx, dz) => Math.max(Math.abs(26 * (dx * c + dz * s)), Math.abs(6.5 * (dz * c - dx * s))),
    glyph(tx, tz) {
      const vx = 13 * (tx * c + tz * s), vy = 6.5 * (tz * c - tx * s);
      const ax = Math.abs(vx), ay = Math.abs(vy);
      if (ay < ax * 0.42) return '-';
      if (ax < ay * 0.42) return '|';
      return vx * vy > 0 ? '\\' : '/';
    },
    // Upright parts of a crescent bow away from its centre: '(' on screen left, ')' on the right.
    bow(glyph, x, z) {
      return glyph === '|' ? (x * c + z * s < 0 ? '(' : ')') : glyph;
    },
  };
}

const P = { x: 0, z: 0 }, Q = { x: 0, z: 0 }, R = { x: 0, z: 0 };

// Walk a curve at a roughly constant on-screen spacing; emit(x, z, glyph, t, i).
function stroke(view, curve, spacing, maxPoints, emit) {
  let length = 0;
  curve(0, Q);
  for (let k = 1; k <= 12; k++) {
    curve(k / 12, R);
    length += view.dist(R.x - Q.x, R.z - Q.z);
    Q.x = R.x; Q.z = R.z;
  }
  const n = clamp(Math.round(length / spacing), 1, maxPoints);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    curve(Math.min(1, t + 0.02), Q);
    curve(Math.max(0, t - 0.02), R);
    curve(t, P);
    emit(P.x, P.z, view.glyph(Q.x - R.x, Q.z - R.z), t, i);
  }
}

// One crescent arm of ice: an outer edge, a thinner inner edge and hooked claw
// fingers at both tips. `side` -1 draws '(' on the left, 1 draws ')' on the right.
function drawArm(view, dot, side, o) {
  const { gap, depth, height, span, heat, dissolve = 0, spacing = 1, salt = 0, claws = 1, light = 1 } = o;
  if (span <= 0.02) return;
  const keep = (i, layer) => hash(i + layer * 97, salt + side) >= dissolve;
  const layers = [[1, 1, 1], [0.7, 0.88, 0.82]];
  for (let layer = 0; layer < layers.length; layer++) {
    const [dx, hz, sp] = layers[layer];
    const reach = span * sp;
    stroke(view, (t, out) => {
      const phi = (t * 2 - 1) * reach;
      out.x = side * (gap + Math.cos(phi) * depth * dx);
      out.z = Math.sin(phi) * height * hz;
    }, spacing * (layer ? 1.3 : 1), layer ? 22 : 30, (x, z, glyph, t, i) => {
      if (!keep(i, layer)) return;
      const tip = Math.abs(t * 2 - 1);
      const glow = layer ? 0.55 + tip * 0.15 : 0.7 + tip * 0.3;
      const color = chill(clamp(heat * (layer ? 0.7 : 1) + tip * 0.12 - dissolve * 0.5));
      dot(x, z, dissolve > 0.45 && hash(i, salt + 7) < dissolve ? ':' : view.bow(glyph, x, z), color, glow * light);
    });
  }
  if (claws <= 0.02) return;
  for (const end of [-1, 1]) {
    const phi = end * span;
    const tx = side * (gap + Math.cos(phi) * depth), tz = Math.sin(phi) * height;
    // Continue the arc past its tip: the fingers curl inward around the target.
    let ux = -side * Math.sin(phi) * depth * end, uz = Math.cos(phi) * height * end;
    const norm = Math.hypot(ux, uz) || 1;
    ux /= norm; uz /= norm;
    for (let f = -1; f <= 1; f++) {
      const turn = f * 0.5 + side * end * -0.25;
      const fx = ux * Math.cos(turn) - uz * Math.sin(turn), fz = ux * Math.sin(turn) + uz * Math.cos(turn);
      const length = (f === 0 ? 0.3 : 0.22) * claws * Math.max(depth, 0.3);
      for (let k = 1; k <= 2; k++) {
        if (!keep(40 + (end + 1) * 6 + (f + 1) * 2 + k, 2)) continue;
        const d = length * k / 2;
        dot(tx + fx * d, tz + fz * d, k === 2 ? '*' : view.glyph(fx, fz),
          chill(clamp(heat + 0.15 - dissolve * 0.5)), (k === 2 ? 1 : 0.85) * light);
      }
    }
  }
}

function drawCast(effect, p, view, dot) {
  const k = clamp(0.7 + (Number.isFinite(effect.radius) ? effect.radius : 0.8) * 0.4, 0.9, 1.6);
  const grow = easeOut(smooth(0.04, 0.38, p));
  const close = easeInOut(smooth(0.3, 0.6, p));
  const squeeze = Math.sin(smooth(0.58, 0.76, p) * Math.PI) * 0.05;
  const gap = (0.9 - close * 0.8 - squeeze) * k;
  const flash = bell(p, 0.62, 0.06);
  const dissolve = smooth(0.7, 1, p);
  const heat = 0.45 + grow * 0.2 + flash * 0.35 - dissolve * 0.3;

  // Frost motes spiral in from the air and condense into the forming arms.
  for (let i = 0; i < 28; i++) {
    const u = clamp((p - hash(i, 1) * 0.2) / 0.3);
    if (u <= 0 || u >= 1) continue;
    const side = i % 2 ? 1 : -1;
    const phi = (hash(i, 2) * 2 - 1) * 1.2;
    const targetX = side * (gap + Math.cos(phi) * 0.75 * k), targetZ = Math.sin(phi) * 1.1 * k;
    const angle = hash(i, 3) * Math.PI * 2;
    const at = v => {
      const reach = (1 - easeIn(v) * 0.35 - v * 0.65) * (1 + hash(i, 4) * 0.9) * k;
      const swirl = angle + (1 - v) * 1.6 * side;
      return [targetX + Math.sin(swirl) * reach * 1.4, targetZ + Math.cos(swirl) * reach];
    };
    const [x, z] = at(u), [bx, bz] = at(Math.max(0, u - 0.08));
    const light = Math.sin(u * Math.PI) ** 0.6;
    dot(x, z, u > 0.75 ? '*' : '+', chill(0.45 + u * 0.4), light);
    dot(bx, bz, view.glyph(x - bx, z - bz), chill(0.25 + u * 0.3), light * 0.55);
  }

  for (const side of [-1, 1]) {
    drawArm(view, dot, side, {
      gap, depth: 0.75 * k, height: 1.1 * k, span: 1.35 * grow, heat, dissolve,
      spacing: 1, salt: 11, claws: grow * (1 - dissolve * 0.6),
    });
  }

  if (p > 0.5) {
    // The embrace closes: a white flash in the held space and a frost ring.
    const ring = easeOut(smooth(0.58, 0.95, p));
    const ringLight = (1 - ring) * smooth(0.56, 0.62, p);
    const count = 26;
    for (let i = 0; i < count; i++) {
      const a = (i + hash(i, 5) * 0.4) / count * Math.PI * 2;
      const r = (0.25 + ring * 1.55) * k * (0.92 + hash(i, 6) * 0.16);
      dot(Math.sin(a) * r, Math.cos(a) * r, ringLight > 0.5 ? ':' : '.', chill(0.4 + ringLight * 0.5), ringLight);
    }
    if (flash > 0.04) {
      dot(0, 0, ramp(flash), WHITE, flash);
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * Math.PI * 2 + 0.26;
        const ux = Math.sin(a), uz = Math.cos(a);
        for (let s = 1; s <= 3; s++) {
          const d = s * 0.11 * k * (0.6 + flash * 0.6);
          dot(ux * d, uz * d, s === 3 ? '.' : view.glyph(ux, uz), chill(0.6 + flash * 0.4), flash * (1.1 - s * 0.25));
        }
      }
    }
  }

  // Thawing: the arms shed motes that drift outward and settle.
  if (dissolve > 0) {
    for (let i = 0; i < 22; i++) {
      const side = i % 2 ? 1 : -1;
      const phi = (hash(i, 8) * 2 - 1) * 1.3;
      const drift = easeOut(dissolve) * (0.25 + hash(i, 9) * 0.5) * k;
      const x = side * (gap + Math.cos(phi) * 0.75 * k + drift) + Math.sin(p * 9 + i) * 0.04;
      const z = Math.sin(phi) * 1.1 * k + drift * (hash(i, 10) - 0.5);
      dot(x, z, hash(i, 11) > 0.6 ? '*' : '.', chill(0.5 - dissolve * 0.3), Math.sin(dissolve * Math.PI) * 0.8);
    }
  }
}

function drawProjectile(effect, p, view, dot) {
  const age = Number.isFinite(effect.age) ? effect.age : 0;
  // A pair of small ice claws snapping around a bright core, streaming frost behind.
  const snap = 0.5 + Math.sin(age * 18) * 0.5;
  for (const side of [-1, 1]) {
    drawArm(view, dot, side, {
      gap: 0.06 + snap * 0.06, depth: 0.2, height: 0.34, span: 1.2, heat: 0.75,
      spacing: 0.75, salt: 3, claws: 0.6,
    });
  }
  dot(0, 0.02, '@', WHITE, 1);
  dot(0, 0.12, '*', EDGE, 0.8);
  for (let i = 0; i < 26; i++) {
    const lane = i % 3 - 1;
    const u = (hash(i, 12) + age * 3.2) % 1;
    const z = -0.2 - u * 0.95;
    const x = lane * (0.05 + u * 0.12) + Math.sin(age * 14 + i * 1.7) * 0.03 * (1 + u * 2);
    const light = (1 - u) ** 1.4 * (0.6 + hash(i, 13) * 0.4);
    dot(x, z, u < 0.25 ? '*' : u < 0.55 ? ':' : '.', chill(0.75 - u * 0.6), light);
  }
}

function drawImpact(effect, p, view, dot) {
  const k = clamp(0.8 + (Number.isFinite(effect.radius) ? effect.radius : 1) * 0.3, 0.9, 1.8);
  const SNAP = 0.18;
  const windup = Math.sin(smooth(0, 0.07, p) * Math.PI / 2) * (1 - smooth(0.07, SNAP, p));
  const slam = easeIn(smooth(0.05, SNAP, p));
  const gap = (0.85 + windup * 0.15 - slam * 0.78) * k;
  const after = smooth(SNAP, 1, p);
  const flash = p < SNAP ? 0 : bell(p, SNAP, 0.07);
  const dissolve = smooth(0.62, 1, p);

  for (const side of [-1, 1]) {
    drawArm(view, dot, side, {
      gap, depth: 0.62 * k, height: 0.95 * k, span: 1.25, heat: 0.55 + flash * 0.45 - dissolve * 0.3,
      dissolve, spacing: 1.1, salt: 21, claws: 1 - dissolve,
    });
  }
  if (p < SNAP) return;

  // Three frost bands lash across the closed claws, cinching tight, then crack away.
  const bind = easeOut(smooth(SNAP, 0.42, p));
  for (let band = 0; band < 3; band++) {
    const offset = (band - 1) * 0.45 * k;
    const phi = Math.asin(clamp(offset / (0.95 * k), -1, 1));
    const width = (gap + Math.cos(phi) * 0.62 * k * 0.72) * (1.45 - bind * 0.45);
    const light = smooth(SNAP, SNAP + 0.08, p) * (1 - smooth(0.6, 0.95, p)) * (band === 1 ? 1 : 0.8);
    const n = clamp(Math.round(width * 2 * 26 / 3), 2, 14);
    for (let i = 0; i <= n; i++) {
      if (hash(i + band * 15, 14) < dissolve) continue;
      const u = i / n * 2 - 1;
      dot(u * width, offset + (1 - u * u) * 0.07 * k * bind, '=',
        chill(band === 1 ? 0.75 + flash * 0.25 : 0.55 + flash * 0.2), light * (0.75 + (1 - u * u) * 0.25));
    }
  }

  // Central flash with a star of cracks.
  if (flash > 0.03) dot(0, 0, '@', WHITE, flash);
  const crack = easeOut(smooth(SNAP, SNAP + 0.18, p));
  const crackLight = (1 - smooth(0.4, 0.75, p));
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2 + 0.2 + (hash(i, 15) - 0.5) * 0.3;
    const ux = Math.sin(a), uz = Math.cos(a);
    const length = (0.25 + hash(i, 16) * 0.2) * k * crack;
    for (let s = 1; s <= 2; s++) {
      const d = length * s / 2;
      const kink = (s === 1 ? (hash(i, 17) - 0.5) * 0.08 : 0) * k;
      dot(ux * d - uz * kink, uz * d + ux * kink, s === 2 ? '+' : view.glyph(ux, uz),
        chill(0.95 - s * 0.12 - after * 0.3), crackLight * (1.1 - s * 0.15));
    }
  }

  // Shards burst out with drag; each leaves a short streak behind it.
  const t = (p - SNAP) * 1.15;
  for (let i = 0; i < 20; i++) {
    const a = hash(i, 18) * Math.PI * 2;
    const speed = (1.2 + hash(i, 19) * 1.6) * k;
    const travel = d => speed * (1 - Math.exp(-4 * d)) / 4 * 3;
    const ux = Math.sin(a), uz = Math.cos(a);
    const head = travel(t), tail = travel(Math.max(0, t - 0.05));
    const life = 1 - smooth(0.3 + hash(i, 20) * 0.3, 0.95, p);
    dot(ux * (0.3 * k + head), uz * (0.3 * k + head), view.glyph(ux, uz), chill(0.95 - after * 0.7), life);
    dot(ux * (0.3 * k + tail), uz * (0.3 * k + tail), '.', chill(0.6 - after * 0.4), life * 0.5);
  }

  // Shock ring of frost rolling outward and breaking into fragments.
  const ring = easeOut(smooth(SNAP, 0.7, p));
  const ringLight = (1 - ring) * 0.9;
  const r = (0.5 + ring * 1.6) * k;
  stroke(view, (u, out) => {
    out.x = Math.sin(u * Math.PI * 2) * r;
    out.z = Math.cos(u * Math.PI * 2) * r;
  }, 2.2, 32, (x, z, glyph, u, i) => {
    if (hash(i, 33) < ring * 0.5) return;
    dot(x, z, ringLight > 0.4 ? glyph : '.', chill(0.35 + ringLight * 0.5), ringLight);
  });
}

function drawPulse(effect, p, view, dot) {
  const radius = Number.isFinite(effect.radius) ? clamp(effect.radius, 0.3, 5) : 1;
  // A snowflake pops into being, rings out a wave of frost and melts away.
  const bloom = easeOut(smooth(0, 0.35, p));
  const melt = smooth(0.45, 1, p);
  const spin = p * 0.5;
  const arm = 0.42 * radius ** 0.6 * bloom;
  dot(0, 0, ramp(1 - melt * 0.8), chill(1 - p * 0.6), 1 - melt * 0.5);
  for (let j = 0; j < 6; j++) {
    const a = j / 6 * Math.PI * 2 + spin;
    const ux = Math.sin(a), uz = Math.cos(a);
    const n = clamp(Math.round(view.dist(ux * arm, uz * arm)), 1, 7);
    for (let s = 1; s <= n; s++) {
      const d = arm * s / n;
      const end = s === n;
      dot(ux * d, uz * d, end ? '*' : view.glyph(ux, uz), chill(0.9 - s / n * 0.35 - melt * 0.3), (1 - melt) * (end ? 1 : 0.85));
    }
  }
  // The frost ring is drawn as one slanted stroke so it reads as a clean ellipse,
  // and it breaks into fragments as it spreads and thins.
  const r = radius ** 0.85 * (0.3 + 0.62 * easeOut(p));
  const ringLight = (1 - p) ** 1.4;
  const breakup = smooth(0.35, 0.9, p) * 0.6;
  stroke(view, (t, out) => {
    const a = t * Math.PI * 2 + spin * 0.5;
    out.x = Math.sin(a) * r;
    out.z = Math.cos(a) * r;
  }, 1.6, 36, (x, z, glyph, t, i) => {
    if (hash(i, 22) < breakup) return;
    dot(x, z, ringLight > 0.35 ? glyph : '.', chill(0.3 + ringLight * 0.55), ringLight * 0.85);
  });
  for (let i = 0; i < 8; i++) {
    const a = hash(i, 24) * Math.PI * 2;
    const d = radius * (0.15 + (1 - Math.exp(-3 * p)) * (0.4 + hash(i, 25) * 0.5));
    dot(Math.sin(a) * d, Math.cos(a) * d, '.', EDGE, (1 - p) * 0.7);
  }
}

function drawAura(effect, p, view, dot) {
  const age = Number.isFinite(effect.age) ? effect.age : 0;
  const k = clamp((Number.isFinite(effect.radius) ? effect.radius : 1) * 0.6, 0.45, 1.2);
  // Small arms wrap the weakened target, hold it while breathing, then let go.
  const wrap = easeOut(smooth(0, 0.25, p));
  const release = easeIn(smooth(0.75, 1, p));
  const breathe = Math.sin(age * 5) * 0.04 * k;
  const gap = (0.75 - wrap * 0.62 + release * 0.5) * k + breathe;
  const light = 1 - release;
  for (const side of [-1, 1]) {
    drawArm(view, dot, side, {
      gap, depth: 0.6 * k, height: 1.0 * k, span: 1.25 * (0.4 + wrap * 0.6), heat: 0.55,
      dissolve: release * 0.8, spacing: 1.1, salt: 31, claws: wrap, light,
    });
  }
  // A band of frost cinches around the waist of the embrace.
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2 + age * 1.2;
    const w = (0.9 - wrap * 0.3) * k;
    const front = Math.cos(a) > 0;
    dot(Math.sin(a) * w, Math.cos(a) * 0.14 * k, front ? '=' : '-', front ? ICE : FROST, (front ? 0.8 : 0.45) * wrap * light);
  }
  // Cold breath: motes rise from the held target and fade.
  for (let i = 0; i < 10; i++) {
    const u = (hash(i, 26) + age * 0.6) % 1;
    const x = (hash(i, 27) - 0.5) * 0.7 * k + Math.sin(age * 3 + i) * 0.06;
    const z = (0.2 - u * 1.1) * k;
    dot(x, z, u < 0.3 ? '*' : '.', chill(0.7 - u * 0.4), Math.sin(u * Math.PI) * 0.7 * wrap * light);
  }
}

function drawZone(effect, p, view, dot) {
  const radius = Number.isFinite(effect.radius) ? clamp(effect.radius, 0.6, 8) : 4;
  // Two great arms reach from behind around the field and hook in at the front,
  // while veins of hoarfrost creep from the rim toward the held centre.
  const sweep = easeOut(smooth(0, 0.42, p));
  const tighten = easeInOut(smooth(0.35, 0.75, p));
  const dissolve = smooth(0.7, 1, p);
  const appear = smooth(0, 0.12, p);
  const heat = 0.5 + bell(p, 0.44, 0.08) * 0.35 - dissolve * 0.25;
  const rim = radius * (0.88 - tighten * 0.1);
  const reach = 0.3 + sweep * (Math.PI - 0.85);
  const armAt = (side, t, inset, out) => {
    const a = side * (Math.PI - t * reach);
    const curl = (1 - inset) * (1 - 0.16 * smooth(0.7, 1, t) * sweep);
    out.x = Math.sin(a) * rim * curl;
    out.z = Math.cos(a) * rim * curl;
  };
  for (const side of [-1, 1]) {
    // The arm: a long outer sweep, thickened by an inner edge along the forearm.
    stroke(view, (t, out) => armAt(side, t, 0, out), 1.7, 46, (x, z, glyph, t, i) => {
      if (hash(i, 28 + side) < dissolve) return;
      const tip = smooth(0.5, 1, t);
      dot(x, z, dissolve > 0.4 ? ':' : view.bow(glyph, x, z), chill(heat * (0.7 + tip * 0.4)),
        (0.3 + tip * 0.7) * (1 - dissolve * 0.5) * appear);
    });
    stroke(view, (t, out) => armAt(side, 0.45 + t * 0.5, 0.07, out), 2, 15, (x, z, glyph, t, i) => {
      if (hash(i, 34 + side) < dissolve) return;
      dot(x, z, dissolve > 0.4 ? '.' : view.bow(glyph, x, z), chill(heat * 0.75), (0.3 + t * 0.4) * (1 - dissolve * 0.6) * appear);
    });
    // Claw fingers hooking inward from the hand.
    armAt(side, 1, 0, P);
    const hx = P.x, hz = P.z;
    armAt(side, 0.97, 0, P);
    let ux = hx - P.x, uz = hz - P.z;
    const norm = Math.hypot(ux, uz) || 1;
    ux /= norm; uz /= norm;
    for (let f = -1; f <= 1; f++) {
      const turn = f * 0.45 + side * 0.35;
      const fx = ux * Math.cos(turn) - uz * Math.sin(turn), fz = ux * Math.sin(turn) + uz * Math.cos(turn);
      const length = radius * 0.13 * sweep * (f === 0 ? 1.2 : 0.9);
      for (let s = 1; s <= 2; s++) {
        if (hash(f + 2 + s * 3, 36 + side) < dissolve) continue;
        const d = length * s / 2;
        dot(hx + fx * d, hz + fz * d, s === 2 ? '*' : view.glyph(fx, fz), chill(heat + 0.2), (s === 2 ? 1 : 0.85) * appear * (1 - dissolve * 0.5));
      }
    }
  }
  // Hoarfrost veins spiral in from the rim, growing crystal by crystal.
  const front = radius * (0.98 - easeOut(p) * 0.7);
  for (let i = 0; i < 21; i++) {
    const vein = Math.floor(i / 3), step = i % 3;
    const r = radius * (0.84 - step * 0.17 + (hash(i, 30) - 0.5) * 0.06);
    const a = (vein + hash(vein, 31) * 0.5) / 7 * Math.PI * 2 + (0.84 - r / radius) * 0.9;
    const grown = clamp((r - front) / (radius * 0.22));
    if (grown <= 0) continue;
    const thaw = 1 - smooth(0.74 + hash(i, 32) * 0.14, 1, p);
    const char = grown < 0.35 ? '.' : grown < 0.7 ? '+' : '*';
    dot(Math.sin(a) * r, Math.cos(a) * r, char, chill(0.3 + grown * 0.45), (0.3 + grown * 0.5) * thaw);
  }
}

function draw(effect, plot) {
  const p = progressOf(effect);
  if (p >= 1) return;
  const stage = effect.stage ?? 'cast';
  const fade = Math.min(1, (1 - p) * 4);
  const view = viewOf(effect.heading);
  const dot = (x, z, char, color, brightness = 1) =>
    plot(x, z, char, color, clamp(brightness * fade));
  if (stage === 'projectile') drawProjectile(effect, p, view, dot);
  else if (stage === 'impact') drawImpact(effect, p, view, dot);
  else if (stage === 'pulse') drawPulse(effect, p, view, dot);
  else if (stage === 'aura') drawAura(effect, p, view, dot);
  else if (stage === 'zone') drawZone(effect, p, view, dot);
  else drawCast(effect, p, view, dot);
}

export default {
  id: 'cold-embrace',
  duration: 1.15,
  draw,
  sounds: {
    cast: [
      { kind: 'noise', delay: 0, duration: 0.56, gain: 0.038, attack: 0.28, release: 0.22, cutoff: 1650, filterType: 'bandpass' },
      { kind: 'tone', delay: 0.10, duration: 0.42, gain: 0.045, attack: 0.015, release: 0.3, frequency: 1174.66, endFrequency: 880, type: 'sine' },
      { kind: 'tone', delay: 0.14, duration: 0.4, gain: 0.032, attack: 0.012, release: 0.3, frequency: 1760, endFrequency: 1320, type: 'triangle', cutoff: 2800 },
      { kind: 'tone', delay: 0.34, duration: 0.4, gain: 0.04, attack: 0.012, release: 0.3, frequency: 880, endFrequency: 587.33, type: 'sine' },
      { kind: 'tone', delay: 0.38, duration: 0.38, gain: 0.026, attack: 0.012, release: 0.28, frequency: 1320, endFrequency: 880, type: 'triangle', cutoff: 2200 },
    ],
    impact: [
      { kind: 'tone', delay: 0, duration: 0.32, gain: 0.055, attack: 0.006, release: 0.26, frequency: 1174.66, endFrequency: 587.33, type: 'sine' },
      { kind: 'tone', delay: 0.035, duration: 0.29, gain: 0.034, attack: 0.005, release: 0.23, frequency: 1568, endFrequency: 784, type: 'triangle', cutoff: 2400 },
      { kind: 'noise', delay: 0.16, duration: 0.075, gain: 0.05, attack: 0.002, release: 0.065, cutoff: 2500, filterType: 'highpass' },
      { kind: 'tone', delay: 0.18, duration: 0.21, gain: 0.035, attack: 0.003, release: 0.19, frequency: 220, endFrequency: 110, type: 'sine' },
    ],
    pulse: [
      { kind: 'tone', delay: 0, duration: 0.12, gain: 0.018, attack: 0.005, release: 0.1, frequency: 784, endFrequency: 659.25, type: 'sine' },
      { kind: 'tone', delay: 0.045, duration: 0.11, gain: 0.012, attack: 0.005, release: 0.09, frequency: 1046.5, endFrequency: 880, type: 'sine' },
    ],
  },
};
