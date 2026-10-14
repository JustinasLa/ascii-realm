// Particles and atmosphere: insects, mist, sparks and drifting things.
// Entries: { name, draw(ctx, w, h), mirror?, flip? } - see draw.js and glyphs.js.
//
// Light in this pack is soft: glows, flames and mist are drawn as grey
// ramps, so a glyph layered over a cell mixes its colour in gradually and
// whatever is underneath still shows through.

import { arc, curve, dot, ellipse, grey, line, poly, rng, TAU } from './draw.js';

const W = 30;
const H = 50;
const PAD = 6;

// Paints every pixel of the padded cell from a coverage function of the
// inner-cell position, for soft gradients that must meet their neighbours
// seamlessly. Levels are quantised so the canvas state changes rarely.
function field(ctx, cover) {
  let last = -1;
  for (let y = -PAD; y < H + PAD; y++) {
    for (let x = -PAD; x < W + PAD; x++) {
      const v = Math.round(Math.max(0, Math.min(1, cover(x + 0.5, y + 0.5))) * 40) / 40;
      if (v <= 0) continue;
      if (v !== last) { ctx.fillStyle = grey(v); last = v; }
      ctx.fillRect(x, y, 1, 1);
    }
  }
}

// Positions on a 3x3 grid inside the cell, for sub-cell motion.
const SX = [8, 15, 22];
const SY = [12, 25, 38];
export const subCell = (fx, fy) => Math.min(2, Math.max(0, Math.floor(fx * 3)))
  + 3 * Math.min(2, Math.max(0, Math.floor(fy * 3)));

// --- Glows ---------------------------------------------------------------

// A round halo spread over a 3x3 block of cells: entry i covers the cell
// at (i % 3 - 1, floor(i / 3) - 1) from the centre of the light.
export const HALO_RADIUS = 50;
function halo(i) {
  const cx = W / 2 - (i % 3 - 1) * W;
  const cy = H / 2 - (Math.floor(i / 3) - 1) * H;
  return (ctx) => field(ctx, (x, y) => {
    const d = Math.hypot(x - cx, y - cy) / HALO_RADIUS;
    return d >= 1 ? 0 : 0.62 * (1 - d) ** 2.2;
  });
}

// A firefly: a hot point with a little bloom around it.
function fly(i) {
  const x = SX[i % 3];
  const y = SY[Math.floor(i / 3)];
  return (ctx) => {
    field(ctx, (px, py) => {
      const d = Math.hypot(px - x, py - y) / 17;
      return d >= 1 ? 0 : 0.5 * (1 - d) ** 1.6;
    });
    dot(ctx, x, y, 5.6, 0.85);
    dot(ctx, x - 0.5, y - 0.5, 3.4, 1);
  };
}

// Pollen and spores: a pale fleck with a faint fuzz.
function mote(i) {
  const x = SX[i % 3];
  const y = SY[Math.floor(i / 3)];
  return (ctx) => {
    dot(ctx, x, y, 7, 0.22);
    dot(ctx, x, y, 4.4, 0.9);
  };
}

// --- Creatures -----------------------------------------------------------

// A moth seen from above: furry body, two pairs of wings in three beats.
function moth(frame) {
  return (ctx) => {
    const spread = [1, 0.62, 0.2][frame];
    const lift = [0, -3, -5][frame];
    for (const s of [-1, 1]) {
      // Forewing and hindwing, wider when open.
      poly(ctx, [15, 22, 15 + s * 13 * spread, 15 + lift, 15 + s * 12 * spread, 25 + lift * 0.4, 15, 27], 0.8);
      poly(ctx, [15, 26, 15 + s * 8 * spread, 28, 15 + s * 6 * spread, 34, 15, 31], 0.6);
    }
    ellipse(ctx, 15, 26, 2.2, 7, 0, 1);
    line(ctx, [14, 19, 11, 13], 2, 0.7);
    line(ctx, [16, 19, 19, 13], 2, 0.7);
  };
}

// A bat spans three cells; each entry is one third of the silhouette in one
// of three wing beats. The rim entries hold only the moonlit upper edges.
function batShape(ctx, frame, rim) {
  // Wing tip height and the bend of the wing for up, level and down beats.
  const tipY = [6, 22, 38][frame];
  const elbowY = [14, 21, 30][frame];
  const level = rim ? 1 : 0.95;
  for (const s of [-1, 1]) {
    const cx = 45;
    const tip = cx + s * 42;
    const elbow = cx + s * 22;
    if (rim) {
      line(ctx, [cx + s * 4, 21, elbow, elbowY, tip, tipY], 2.4, level);
      continue;
    }
    // Leading edge to the tip, then a scalloped trailing edge back.
    const pts = [cx + s * 3, 20, elbow, elbowY, tip, tipY];
    const scallops = 3;
    for (let k = 1; k <= scallops; k++) {
      const u = k / scallops;
      const x = tip + (cx + s * 4 - tip) * u;
      const y = tipY + 6 + (31 - tipY - 6) * u;
      const mx = tip + (cx + s * 4 - tip) * (u - 0.5 / scallops);
      const my = y - 7 + (frame === 0 ? 4 : 0);
      pts.push(mx, my, x, y);
    }
    poly(ctx, pts, level);
  }
  if (!rim) {
    ellipse(ctx, 45, 25, 5, 9, 0, 1);
    poly(ctx, [41, 18, 42, 10, 44, 16, 46, 16, 48, 10, 49, 18], 1);
  } else {
    arc(ctx, 45, 22, 4.5, 6, Math.PI * 1.1, Math.PI * 1.9, 2.2, 1);
  }
}
function bat(frame, part, rim) {
  return (ctx) => {
    ctx.save();
    ctx.translate(-part * W, 0);
    batShape(ctx, frame, rim);
    ctx.restore();
  };
}

// --- Mist ----------------------------------------------------------------

// Low veils of mist: one soft horizontal streak at one of three heights,
// even along its length so a run of cells joins into a single long wisp.
// The density of the mist itself comes from blending the cell colours.
export const MIST_HEIGHTS = 3;
function mist(row, strong) {
  const y0 = [13, 26, 39][row];
  const sigma = strong ? 6 : 4;
  const peak = strong ? 0.5 : 0.32;
  return (ctx) => field(ctx, (x, y) => peak * Math.exp(-(((y - y0) / sigma) ** 2)));
}

// --- Fire ----------------------------------------------------------------

const STEP_X = [3, 9, 15, 21, 27];
export const FLAME_STEPS = STEP_X.length;

// A soft flame stroke joining the bottom edge to the top edge, so stacked
// cells draw one licking tongue; brighter along its axis.
function flameStroke(b, t) {
  return (ctx) => {
    const x0 = STEP_X[b];
    const x1 = STEP_X[t];
    const ext = (x1 - x0) / H * PAD;
    for (const [width, level] of [[24, 0.25], [15, 0.55], [8, 0.95]]) {
      line(ctx, [x0 - ext, H + PAD, x1 + ext, -PAD], width, level);
    }
  };
}

// The tapering tip of a tongue, rising from the bottom edge to a point.
function flameTip(b, t) {
  return (ctx) => {
    const x0 = STEP_X[b];
    const x1 = STEP_X[t];
    for (const [half, level, top] of [[9.5, 0.3, 4], [6, 0.62, 10], [3, 1, 18]]) {
      ctx.fillStyle = grey(level);
      ctx.beginPath();
      ctx.moveTo(x0 - half, H + PAD);
      ctx.quadraticCurveTo(x0 - half, 30, x1, top);
      ctx.quadraticCurveTo(x0 + half, 30, x0 + half, H + PAD);
      ctx.closePath();
      ctx.fill();
    }
  };
}

// The white heart of the fire: a soft upright teardrop.
function flameCore(v) {
  const rand = rng(3100 + v);
  const x = 13 + rand() * 4;
  return (ctx) => field(ctx, (px, py) => {
    const dy = (py - 30) / (py < 30 ? 30 : 18);
    const dx = (px - x - (30 - py) * 0.04 * (v - 1)) / (11 * (1 - Math.max(0, -dy) * 0.55));
    const d = Math.hypot(dx, dy);
    return d >= 1 ? 0 : Math.min(1, 1.25 * (1 - d) ** 0.8);
  });
}

// The body of a fire: a glowing mass with soft wavering streaks. The
// streaks meet the cells above, below and beside at the same places, so a
// block of body cells reads as one continuous blaze. Side variants fade out
// toward the edge of the fire.
export const BODY_SIDES = ['', 'l', 'r'];
function flameBody(v, side) {
  const wave = [4, -5, 6][v];
  return (ctx) => field(ctx, (x, y) => {
    const bend = wave * Math.sin(Math.PI * Math.max(0, Math.min(H, y)) / H);
    const streak = 0.5 + 0.5 * Math.cos((x + bend) / 15 * TAU);
    let c = 0.5 + 0.42 * streak;
    const u = Math.max(0, Math.min(1, x / W));
    if (side === 'l') c *= Math.min(1, (u / 0.75) ** 1.4);
    if (side === 'r') c *= Math.min(1, ((1 - u) / 0.75) ** 1.4);
    return c;
  });
}

// A tongue of flame filling a cell: it rises from the whole bottom edge,
// where it meets the tongue below, and narrows to one or two curling tips.
// Brighter at its root than at its tips.
export const LICKS = 8;
function flameLick(v) {
  const rand = rng(3300 + v);
  const tips = v < 5 ? [[(rand() - 0.5) * 10, 3 + rand() * 12]]
    : [[-6 - rand() * 3, 6 + rand() * 10], [5 + rand() * 4, 12 + rand() * 12]];
  const curl = (v % 2 ? 1 : -1) * (3 + rand() * 4);
  return (ctx) => {
    for (const [k, level, lift] of [[1, 0.42, 0], [0.62, 0.95, 7]]) {
      for (const [tx, ty] of tips) {
        const half = (tips.length > 1 ? 9 : 13) * k;
        const x = 15 + tx * 0.4;
        ctx.fillStyle = grey(level);
        ctx.beginPath();
        ctx.moveTo(x - half, H + PAD);
        ctx.bezierCurveTo(x - half, 30, 15 + tx - curl, ty + 16, 15 + tx, ty + lift);
        ctx.bezierCurveTo(15 + tx + curl * 0.4, ty + 18, x + half, 32, x + half, H + PAD);
        ctx.closePath();
        ctx.fill();
      }
    }
  };
}

// Smoke: clumps of dithered dots, densest in the middle, in a few sizes.
function smoke(v) {
  const rand = rng(3400 + v);
  const blobs = Array.from({ length: 3 }, () => ({ x: 6 + rand() * 18, y: 10 + rand() * 30, r: 9 + rand() * 7 }));
  const density = [0.35, 0.55, 0.75][v % 3];
  return (ctx) => {
    const dots = rng(3450 + v);
    for (let y = -2; y < H + 2; y += 4.2) {
      for (let x = (Math.round(y / 4.2) % 2) * 2.2; x < W + 2; x += 4.4) {
        let c = 0;
        for (const b of blobs) c = Math.max(c, 1 - Math.hypot(x - b.x, (y - b.y) * 0.8) / b.r);
        if (dots() < c * density * 1.6) dot(ctx, x, y, 1.8 + c * 1.2, 0.5 + c * 0.5);
      }
    }
  };
}

// A glowing ember at one of nine places, with a soft bloom.
function ember(i) {
  const x = SX[i % 3];
  const y = SY[Math.floor(i / 3)];
  return (ctx) => {
    dot(ctx, x, y, 9, 0.25);
    dot(ctx, x, y, 5, 1);
  };
}

// A spark streak heading in one of eight directions, hot at its head.
function spark(i) {
  const a = i / 8 * TAU;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return (ctx) => {
    line(ctx, [15 - c * 16, 25 - s * 16, 15, 25], 3.6, 0.45);
    line(ctx, [15, 25, 15 + c * 10, 25 + s * 10], 5, 1);
  };
}

// Coals: rounded chunks with glowing cracks between them. Layered in orange
// over ash, the cracks pulse as the colour does.
function coal(v) {
  const rand = rng(3500 + v);
  return (ctx) => {
    for (let k = 0; k < 4; k++) {
      const x = 5 + rand() * 20;
      const y = 14 + rand() * 26;
      ellipse(ctx, x, y, 4 + rand() * 3, 3 + rand() * 2.5, rand(), 0.5);
      line(ctx, [x - 3, y + rand() * 2 - 1, x + rand() * 3, y - 2, x + 3, y + 1], 3, 1);
    }
  };
}

// A burning log crossing the cell nearly level, rising or falling: a
// rounded body, a lit upper edge and a dark charred underside.
function log(v) {
  const rise = [11, -11, 11, -11][v];
  return (ctx) => {
    const y0 = 25 + rise / 2;
    const y1 = 25 - rise / 2;
    line(ctx, [-PAD, y0, W + PAD, y1], 26, 0.4);
    line(ctx, [-PAD, y0 - 2, W + PAD, y1 - 2], 16, 0.7);
    line(ctx, [-PAD, y0 - 8, W + PAD, y1 - 8], 4, 1);
    if (v >= 2) ellipse(ctx, 15, 25, 3.4, 2.6, 0, 0.35);
  };
}

// The glowing cracks of a charred log, to layer in orange over log.N.
function logGlow(v) {
  const rise = [11, -11, 11, -11][v];
  const rand = rng(3700 + v);
  return (ctx) => {
    for (let k = 0; k < 3; k++) {
      const x = 2 + k * 10 + rand() * 4;
      const y = 27 - rise * (x / W - 0.5) + (rand() - 0.5) * 6;
      line(ctx, [x - 4, y + 1, x, y - 1, x + 4, y + 1.5], 3.4, 1);
    }
  };
}

// Hearth stones: rounded, lit on the upper left, shaded lower right; some
// cells hold one big stone, others two smaller ones.
function hearthStone(v) {
  const rand = rng(3800 + v);
  const stones = v < 2
    ? [[15 + (rand() - 0.5) * 3, 27, 11 + rand() * 3, 12 + rand() * 6]]
    : [[9, 30, 8, 10 + rand() * 4], [22, 22 + rand() * 6, 7, 9 + rand() * 4]];
  return (ctx) => {
    for (const [x, y, rx, ry] of stones) {
      ellipse(ctx, x + 1, y + 2, rx, ry, 0, 0.3);
      ellipse(ctx, x, y, rx * 0.94, ry * 0.92, 0, 0.6);
      ellipse(ctx, x - rx * 0.28, y - ry * 0.32, rx * 0.5, ry * 0.42, 0, 0.88);
    }
    if (v % 2) line(ctx, [stones[0][0] + 2, stones[0][1] - 5, stones[0][0] + 4, stones[0][1] + 2], 1.4, 0.25);
  };
}

// --- Dust, grit and grass -------------------------------------------------

// A dust puff that swells and thins: lit on its upper left by the moon.
function puff(s) {
  const r = 5 + s * 2.6;
  const level = 1 - s * 0.14;
  return (ctx) => {
    const rand = rng(3900 + s);
    const n = 14 + s * 6;
    for (let k = 0; k < n; k++) {
      const a = rand() * TAU;
      const d = Math.sqrt(rand());
      const x = 15 + Math.cos(a) * r * d;
      const y = 30 + Math.sin(a) * r * 1.1 * d;
      const lit = 0.75 - (Math.cos(a) + Math.sin(a)) * d * 0.2;
      dot(ctx, x, y, (1.8 + rand() * 1.8) * (1 - d * 0.35), level * lit * (1 - d * 0.4));
    }
  };
}

// A clipped bit of grass blade tumbling through the air, at eight angles.
function clip(i) {
  const a = i / 8 * Math.PI;
  const c = Math.cos(a) * 9;
  const s = Math.sin(a) * 9;
  return (ctx) => {
    ctx.fillStyle = grey(1);
    ctx.beginPath();
    ctx.moveTo(15 - c - s * 0.25, 25 - s + c * 0.25);
    ctx.lineTo(15 + c, 25 + s);
    ctx.lineTo(15 - c + s * 0.25, 25 - s - c * 0.25);
    ctx.closePath();
    ctx.fill();
  };
}

// Breath and steam: a curl of vapour that loosens as it drifts.
function wisp(v) {
  return (ctx) => {
    const k = 1 - v * 0.2;
    curve(ctx, 3, 30, 11, 18 - v * 2, 18, 28, 4.6 - v * 0.5, 0.75 * k);
    curve(ctx, 14, 28, 22, 36 + v * 2, 28, 24 - v * 3, 3.8 - v * 0.4, 0.55 * k);
  };
}

// --- Footprints ----------------------------------------------------------

// A boot print pressed into soft ground: a treaded sole and a separate
// heel. Foot-local coordinates are in metres: `a` along the foot (toe
// positive), `b` across it.
function bootDepth(a, b) {
  // The sole is widest across the ball and rounds off at the toe.
  const half = 0.026 + 0.022 * Math.sin(Math.PI * Math.min(1, Math.max(0, (a + 0.03) / 0.15)));
  const sole = a > -0.03 && a < 0.12 ? (Math.abs(b + 0.004) / half) ** 2 + ((a - 0.045) / 0.075) ** 6 : 2;
  if (sole < 1) {
    // Fine tread bars across the ball of the foot sit a little deeper.
    const tread = a > 0 && Math.cos(a * 520) > 0.3 ? 1 : 0.84;
    return Math.min(1, (1 - sole) * 5) * tread;
  }
  const heel = ((a + 0.085) / 0.034) ** 4 + (b / 0.031) ** 2;
  if (heel < 1) return Math.min(1, (1 - heel) * 5) * 0.95;
  // The narrow waist under the arch barely marks the ground.
  if (a > -0.06 && a < -0.025 && Math.abs(b - 0.012) < 0.013) return 0.3;
  return 0;
}

// Screen units per metre: 30 units span one column and 50 one row, with
// columns 1/21.7 m wide and rows 1/6.5 m deep (see ASPECT, SCALE and TILT).
const UX = 30 * 21.7;
const UY = 50 * 6.5;
export const BOOT_HEADINGS = 8;

// The cells one boot print covers at a heading, measured once so that the
// glyphs and the stamp agree. Each heading's print is centred in cell 0, 0.
function bootCells(h) {
  const heading = h / BOOT_HEADINGS * TAU;
  const fx = Math.sin(heading);
  const fy = Math.cos(heading);
  const depth = (ux, uy) => {
    const wx = ux / UX;
    const wy = uy / UY;
    return bootDepth(wx * fx + wy * fy, wx * fy - wy * fx);
  };
  const cells = [];
  for (let cy = -2; cy <= 2; cy++) {
    for (let cx = -4; cx <= 4; cx++) {
      let sum = 0;
      for (let y = 2; y < H; y += 4) {
        for (let x = 1.5; x < W; x += 3) sum += depth(cx * W + x - W / 2, cy * H + y - H / 2);
      }
      if (sum > 2.5) cells.push({ dx: cx, dy: cy, ink: sum });
    }
  }
  return { cells, depth };
}
const BOOTS = Array.from({ length: BOOT_HEADINGS }, (_, h) => bootCells(h));
// The lower-right inner wall of a print faces the moon and catches its
// light: the part of the hollow from which a step down and to the right
// climbs out of it again.
const rimOf = (depth) => (x, y) => (depth(x, y) > 0.25 && depth(x + 5, y + 7) < 0.2 ? 0.9 : 0);
export const BOOT_STAMPS = BOOTS.map((boot, h) => boot.cells.map(({ dx, dy, ink }) => ({
  dx, dy, name: `effects.boot.${h}.${dx}.${dy}`, rim: ink > 40 ? `effects.bootrim.${h}.${dx}.${dy}` : null })));

// --- Weather -------------------------------------------------------------

// A thin rain streak crossing the whole cell, leaning with the wind, so a
// column of cells draws one long streak.
export const RAIN_SLANTS = 7;
function rain(s) {
  const k = (s - 3) * 5;
  return (ctx) => line(ctx, [15 - k * 1.2, H + PAD, 15 + k * 1.2, -PAD], 4.8, 0.95);
}

// Drizzle: a short dash at one of three places.
function drizzle(i) {
  const x = [8, 16, 23][i];
  const y = [14, 30, 22][i];
  return (ctx) => line(ctx, [x, y - 8, x, y + 8], 4.8, 0.9);
}

// A raindrop striking the ground: a flat burst, a crown of droplets, then
// the droplets falling away.
function crown(f) {
  return (ctx) => {
    if (f === 0) {
      arc(ctx, 15, 44, 9, 3, Math.PI, TAU, 3.6, 0.9);
      dot(ctx, 15, 42, 3.4, 1);
      return;
    }
    const spread = f === 1 ? 1 : 1.5;
    const level = f === 1 ? 1 : 0.6;
    arc(ctx, 15, 45, 9 * spread, 3, 0, TAU, 3, level * 0.6);
    for (let k = 0; k < 5; k++) {
      const a = Math.PI + (k + 0.5) / 5 * Math.PI;
      const x = 15 + Math.cos(a) * 10 * spread;
      const y = 44 + Math.sin(a) * (f === 1 ? 14 : 10);
      line(ctx, [15 + Math.cos(a) * 6, 44 + Math.sin(a) * 3, x, y], 3, level * 0.7);
      dot(ctx, x, y - (f === 2 ? -3 : 0), 3.2, level);
    }
  };
}

// Snowflakes of several kinds: a branched dendrite, a plain star, a plate,
// a small cross, a pair of grains and a soft clump.
function flake(v) {
  return (ctx) => {
    if (v <= 1) {
      const r = v === 0 ? 12 : 8;
      for (let k = 0; k < 6; k++) {
        const a = k / 6 * TAU + 0.26;
        const c = Math.cos(a);
        const s = Math.sin(a);
        line(ctx, [15, 25, 15 + c * r, 25 + s * r], 3.2, 1);
        if (v === 0) {
          for (const side of [-1, 1]) {
            const b = a + side * 0.75;
            line(ctx, [15 + c * 7, 25 + s * 7, 15 + c * 7 + Math.cos(b) * 4.5, 25 + s * 7 + Math.sin(b) * 4.5], 2.4, 0.85);
          }
        }
      }
      dot(ctx, 15, 25, 2.6, 1);
    } else if (v === 2) {
      const pts = [];
      for (let k = 0; k < 6; k++) pts.push(15 + Math.cos(k / 6 * TAU) * 6.5, 25 + Math.sin(k / 6 * TAU) * 6.5);
      poly(ctx, pts, 0.8);
      dot(ctx, 14, 24, 1.6, 1);
    } else if (v === 3) {
      line(ctx, [9, 25, 21, 25], 3.2, 1);
      line(ctx, [15, 19, 15, 31], 3.2, 1);
    } else if (v === 4) {
      dot(ctx, 12, 22, 3, 1);
      dot(ctx, 18, 29, 2.6, 0.8);
    } else {
      dot(ctx, 15, 25, 5.5, 0.4);
      dot(ctx, 15, 25, 3.4, 1);
    }
  };
}

// Snow that has settled: a few grains and a small drift low in the cell.
function settled(v) {
  const rand = rng(4000 + v);
  return (ctx) => {
    ellipse(ctx, 8 + rand() * 14, 40 + rand() * 6, 5 + rand() * 3, 2.4, 0, 0.7);
    for (let k = 0; k < 4; k++) dot(ctx, 3 + rand() * 24, 24 + rand() * 22, 2.4 + rand(), 0.6 + rand() * 0.4);
  };
}

// --- Lightning -----------------------------------------------------------

// A bolt segment from the bottom edge to the top, kinked once in the
// middle so long runs look jagged; and nearly level runs for wide forks.
function bolt(b, t) {
  const kink = ((b * 7 + t * 3) % 5 - 2) * 2.2;
  return (ctx) => {
    const x0 = STEP_X[b];
    const x1 = STEP_X[t];
    const mx = (x0 + x1) / 2 + kink;
    line(ctx, [x0, H + PAD, mx, H / 2, x1, -PAD], 6.5, 1);
  };
}
const FLAT_Y = [12, 25, 38];
function boltFlat(l, r) {
  return (ctx) => line(ctx, [-PAD, FLAT_Y[l], 15, (FLAT_Y[l] + FLAT_Y[r]) / 2 + 3, W + PAD, FLAT_Y[r]], 6, 1);
}

// --- The pack -------------------------------------------------------------

const range = (n) => Array.from({ length: n }, (_, i) => i);
const grid = (n, prefix, draw, mirror) => range(n).flatMap((b) => range(n).map((t) => ({
  name: `${prefix}.${b}${t}`, draw: draw(b, t), mirror: mirror?.(b, t),
})));

export const EFFECTS = [
  ...range(9).map((i) => ({ name: `effects.halo.${i}`, draw: halo(i) })),
  ...range(9).map((i) => ({ name: `effects.fly.${i}`, draw: fly(i) })),
  ...range(9).map((i) => ({ name: `effects.mote.${i}`, draw: mote(i) })),
  ...range(3).map((f) => ({ name: `effects.moth.${f}`, draw: moth(f) })),
  ...range(3).flatMap((f) => range(3).map((p) => ({ name: `effects.bat.${f}.${p}`, draw: bat(f, p, false) }))),
  ...range(3).flatMap((f) => range(3).map((p) => ({ name: `effects.batrim.${f}.${p}`, draw: bat(f, p, true) }))),
  ...range(MIST_HEIGHTS).flatMap((row) => range(2).map((k) => ({ name: `effects.mist.${row}.${k}`, draw: mist(row, k) }))),
  ...grid(FLAME_STEPS, 'effects.flame.s', flameStroke, (b, t) => `effects.flame.s.${t}${b}`),
  ...grid(FLAME_STEPS, 'effects.flame.tip', flameTip, (b, t) => `effects.flame.s.${t}${b}`),
  ...range(3).map((v) => ({ name: `effects.flame.core.${v}`, draw: flameCore(v) })),
  ...range(3).flatMap((v) => BODY_SIDES.map((side) => ({
    name: `effects.flame.body.${v}${side}`, draw: flameBody(v, side) }))),
  ...range(LICKS).map((v) => ({ name: `effects.flame.lick.${v}`, draw: flameLick(v) })),
  ...range(6).map((v) => ({ name: `effects.smoke.${v}`, draw: smoke(v) })),
  ...range(9).map((i) => ({ name: `effects.ember.${i}`, draw: ember(i) })),
  ...range(8).map((i) => ({ name: `effects.spark.${i}`, draw: spark(i) })),
  ...range(4).map((v) => ({ name: `effects.coal.${v}`, draw: coal(v) })),
  ...range(4).map((v) => ({ name: `effects.log.${v}`, draw: log(v), mirror: `effects.log.${v ^ 1}` })),
  ...range(4).map((v) => ({ name: `effects.logglow.${v}`, draw: logGlow(v), mirror: `effects.logglow.${v ^ 1}` })),
  ...range(4).map((v) => ({ name: `effects.stone.${v}`, draw: hearthStone(v) })),
  ...range(5).map((s) => ({ name: `effects.puff.${s}`, draw: puff(s) })),
  ...range(8).map((i) => ({ name: `effects.clip.${i}`, draw: clip(i) })),
  ...range(4).map((v) => ({ name: `effects.wisp.${v}`, draw: wisp(v) })),
  ...BOOTS.flatMap((boot, h) => boot.cells.map(({ dx, dy }) => ({
    name: `effects.boot.${h}.${dx}.${dy}`,
    draw: (ctx) => field(ctx, (x, y) => boot.depth(dx * W + x - W / 2, dy * H + y - H / 2)),
  }))),
  ...BOOTS.flatMap((boot, h) => boot.cells.filter((c) => c.ink > 40).map(({ dx, dy }) => {
    const rim = rimOf(boot.depth);
    return { name: `effects.bootrim.${h}.${dx}.${dy}`,
      draw: (ctx) => field(ctx, (x, y) => rim(dx * W + x - W / 2, dy * H + y - H / 2)) };
  })),
  ...range(RAIN_SLANTS).map((s) => ({ name: `effects.rain.${s}`, draw: rain(s) })),
  ...range(3).map((i) => ({ name: `effects.drizzle.${i}`, draw: drizzle(i) })),
  ...range(3).map((f) => ({ name: `effects.crown.${f}`, draw: crown(f) })),
  ...range(6).map((v) => ({ name: `effects.flake.${v}`, draw: flake(v) })),
  ...range(4).map((v) => ({ name: `effects.settled.${v}`, draw: settled(v) })),
  { name: 'effects.hail', draw: (ctx) => { dot(ctx, 15, 25, 4.4, 0.75); dot(ctx, 13.5, 23.5, 2, 1); } },
  ...grid(FLAME_STEPS, 'effects.bolt', bolt, (b, t) => `effects.bolt.${t}${b}`),
  ...grid(3, 'effects.boltflat', boltFlat),
];

