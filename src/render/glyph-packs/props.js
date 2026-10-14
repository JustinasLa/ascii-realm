// Rocks, camp props, deadwood and other placed scenery.
// Entries: { name, draw(ctx, w, h), mirror?, flip? } - see draw.js and glyphs.js.
//
// Materials are drawn as families indexed by tone (T, dark to lit) and a
// variant (V), so a baked prop can pick a texture by its surface lighting
// without repeating one stamp. Silhouette edges ("cut" glyphs) are drawn as a
// half cell solid on the side the object lies, so outlines stay crisp.

import { arc, curve, dot, ellipse, grey, leaf, line, poly, rng, TAU } from './draw.js';

const W = 30;
const H = 50;

const fill = (ctx, level) => {
  ctx.fillStyle = grey(level);
  ctx.fillRect(-6, -6, W + 12, H + 12);
};

// Builds `${prefix}.${a}.${b}` entries for every pair of indices.
function grid(prefix, na, nb, draw, extra = {}) {
  const out = [];
  for (let a = 0; a < na; a++) {
    for (let b = 0; b < nb; b++) {
      out.push({ name: `${prefix}.${a}.${b}`, draw: (ctx) => draw(ctx, a, b), ...extra });
    }
  }
  return out;
}

function list(prefix, n, draw, extra = {}) {
  return Array.from({ length: n }, (_, i) => ({ name: `${prefix}.${i}`, draw: (ctx) => draw(ctx, i), ...extra }));
}

// ---------------------------------------------------------------- stone

// Granular stone: a face of fine grit, darker pits and the odd hairline,
// with no straight lines that would show the cell grid. Lit faces are
// dense and bright; faces turned away thin out into scattered grains.
const GRIT = [
  { base: 0.1, n: 22, level: 0.42 },
  { base: 0.24, n: 30, level: 0.55 },
  { base: 0.42, n: 36, level: 0.7 },
  { base: 0.6, n: 40, level: 0.85 },
  { base: 0.76, n: 40, level: 1 },
];

function stone(ctx, t, v) {
  const rand = rng(5000 + t * 17 + v * 131);
  const { base, n, level } = GRIT[t];
  fill(ctx, base);
  for (let k = 0; k < n; k++) {
    dot(ctx, rand() * (W + 4) - 2, rand() * (H + 4) - 2, 1.2 + rand() * 2.2, level * (0.55 + rand() * 0.45));
  }
  const pits = 1 + Math.floor(rand() * 3);
  for (let k = 0; k < pits; k++) {
    const x = 4 + rand() * 22;
    const y = 5 + rand() * 40;
    const r = 1.6 + rand() * 1.8;
    dot(ctx, x + 0.7, y + 1, r, Math.min(1, level));
    dot(ctx, x, y, r, base * 0.2);
  }
  if (v === 3) curve(ctx, rand() * 10, rand() * H, 15, rand() * H, 20 + rand() * 10, rand() * H, 1.3, base * 0.3);
}

// A facet ridge: where two planes of a boulder meet, a fine line that
// catches the light (or a crease in shadow).
function ridge(ctx, a) {
  const ang = [0, -Math.PI / 4, Math.PI / 2, Math.PI / 4][a];
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  line(ctx, [W / 2 - c * 40, H / 2 - s * 40, W / 2 + c * 40, H / 2 + s * 40], 2.4, 1);
}

// Outline edges. D is the side of the cell where the object lies (0 east,
// then clockwise: south-east, south, south-west, west, north-west, north,
// north-east) and C how much of the cell it covers. Edges facing the moon
// (upper left) carry a bright rim; the others fade into a dark lip.
const DIRS = Array.from({ length: 8 }, (_, d) => [Math.cos(d * Math.PI / 4), Math.sin(d * Math.PI / 4)]);
const COVER = [0.32, 0.52, 0.74];
const LIGHT = [-0.6, -0.8];

function clipHalf(nx, ny, t) {
  // The cell rectangle clipped to dot(p - centre, n) >= t.
  const rect = [[-6, -6], [W + 6, -6], [W + 6, H + 6], [-6, H + 6]];
  const f = ([x, y]) => (x - W / 2) * nx + (y - H / 2) * ny - t;
  const out = [];
  for (let i = 0; i < 4; i++) {
    const a = rect[i];
    const b = rect[(i + 1) % 4];
    const fa = f(a);
    const fb = f(b);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) {
      const k = fa / (fa - fb);
      out.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]);
    }
  }
  return out;
}

function areaInside(nx, ny, t) {
  // Fraction of the inner cell on the solid side, by sampling.
  let n = 0;
  for (let y = 1; y < H; y += 2) for (let x = 1; x < W; x += 2) if ((x - W / 2) * nx + (y - H / 2) * ny >= t) n++;
  return n / (15 * 25);
}

function cut(ctx, d, c, rough) {
  // The solid half lies toward (sx, sy).
  const [sx, sy] = DIRS[d];
  let lo = -40;
  let hi = 40;
  for (let k = 0; k < 24; k++) {
    const mid = (lo + hi) / 2;
    if (areaInside(sx, sy, mid) > COVER[c]) lo = mid; else hi = mid;
  }
  const t = (lo + hi) / 2;
  const shape = clipHalf(sx, sy, t);
  const lit = -sx * LIGHT[0] + -sy * LIGHT[1] > 0.2;
  const body = rough ? 0.8 : 0.84;
  if (rough) {
    ctx.save();
    ctx.beginPath();
    shape.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.clip();
    stone(ctx, 3, (d + c) % 3);
    ctx.restore();
  } else {
    poly(ctx, shape.flat(), body);
  }
  // The edge line runs perpendicular to the solid direction through t.
  const px = W / 2 + sx * t;
  const py = H / 2 + sy * t;
  const ex = -sy;
  const ey = sx;
  const a = [px - ex * 60, py - ey * 60];
  const b = [px + ex * 60, py + ey * 60];
  const rand = rng(6100 + d * 7 + c * 61 + (rough ? 500 : 0));
  if (rough) {
    // Bites out of the outline and a few pits inside.
    for (let k = -3; k <= 3; k++) {
      const m = [px + ex * k * 9 + (rand() - 0.5) * 4, py + ey * k * 9 + (rand() - 0.5) * 4];
      const depth = 1.5 + rand() * 3.5;
      const half = 2.5 + rand() * 3;
      poly(ctx, [m[0] - ex * half, m[1] - ey * half, m[0] + sx * depth, m[1] + sy * depth,
        m[0] + ex * half, m[1] + ey * half], 0);
    }
  }
  // Rim: a bright lip toward the moon, a dark one away from it.
  const inset = 2.4;
  line(ctx, [a[0] + sx * inset, a[1] + sy * inset, b[0] + sx * inset, b[1] + sy * inset], 3.4, lit ? 1 : 0.5);
}

const cutMirror = (d) => (8 - d) % 8;

// ---------------------------------------------------------------- wood

// Bark with vertical ridges split into plates; T is how much of the ridge
// face is lit. Horizontal bark is the same, lying down.
function barkRidges(ctx, t, v, horizontal) {
  const rand = rng(7000 + t * 13 + v * 71 + (horizontal ? 900 : 0));
  const span = horizontal ? H : W;
  const length = horizontal ? W : H;
  fill(ctx, 0.08 + t * 0.05);
  const n = horizontal ? 5 : 3;
  for (let k = 0; k < n; k++) {
    let c = (k + 0.3 + rand() * 0.4) * span / n;
    const width = (horizontal ? 4.5 : 5) + t * 1.3 + rand() * 1.5;
    const pts = [];
    for (let s = -6; s <= length + 6; s += 8) {
      pts.push(horizontal ? [s, c] : [c, s]);
      c += (rand() - 0.5) * 3;
    }
    const level = 0.45 + t * 0.17;
    line(ctx, pts.flat(), width, level);
    // Lit edge of the ridge.
    line(ctx, pts.map(([x, y]) => horizontal ? [x, y - width * 0.3] : [x - width * 0.3, y]).flat(), 1.6,
      Math.min(1, level + 0.25));
    // Cracks across the ridge break it into plates.
    for (let s = rand() * 14; s < length; s += 12 + rand() * 12) {
      const at = pts[Math.min(pts.length - 1, Math.floor((s + 6) / 8))];
      if (horizontal) line(ctx, [s, at[1] - width, s + 2, at[1] + width], 1.8, 0.05);
      else line(ctx, [at[0] - width, s, at[0] + width, s + 2], 1.8, 0.05);
    }
  }
}

// Silver birch: chalky bark with dark horizontal lenticels.
function birch(ctx, v) {
  const rand = rng(7400 + v);
  fill(ctx, 0.86);
  for (let k = 0; k < 4; k++) {
    const y = 5 + rand() * 40;
    const x = rand() * 22;
    poly(ctx, [x, y, x + 6 + rand() * 10, y - 1.5, x + 8 + rand() * 8, y + 2, x + 1, y + 2.6], 0.12);
  }
  if (v % 2) dot(ctx, 8 + rand() * 14, 15 + rand() * 20, 3.5, 0.15);
}

// Sawn planks: smooth wood with fine grain lines and the odd knot.
function grain(ctx, t, v, horizontal) {
  const rand = rng(7600 + t * 11 + v * 37 + (horizontal ? 300 : 0));
  const base = 0.4 + t * 0.15;
  fill(ctx, base);
  const n = 4;
  for (let k = 0; k < n; k++) {
    let c = (k + 0.5) * (horizontal ? H : W) / n + (rand() - 0.5) * 4;
    const pts = [];
    for (let s = -6; s <= (horizontal ? W : H) + 6; s += 6) {
      pts.push(horizontal ? [s, c] : [c, s]);
      c += (rand() - 0.5) * 2.2;
    }
    line(ctx, pts.flat(), 1.4 + rand() * 0.8, base * 0.55);
  }
  if (v === 3) {
    const x = 9 + rand() * 12;
    const y = 15 + rand() * 20;
    ellipse(ctx, x, y, horizontal ? 6 : 3.5, horizontal ? 3.5 : 6, 0, base * 0.5);
    ellipse(ctx, x, y, horizontal ? 3 : 1.8, horizontal ? 1.8 : 3, 0, base * 0.25);
  }
}

// End grain: arcs of growth rings around a pith in direction D.
function rings(ctx, d, v) {
  const rand = rng(7800 + d * 5 + v * 29);
  fill(ctx, 0.82);
  const [ux, uy] = DIRS[d];
  const r0 = 30 + v * 9;
  const cx = W / 2 + ux * r0;
  const cy = H / 2 + uy * r0;
  for (let r = r0 - 30 + rand() * 4; r < r0 + 34; r += 6 + rand() * 3) {
    if (r > 2) arc(ctx, cx, cy, r, r, 0, TAU, 1.6 + rand() * 0.6, 0.38);
  }
}

function ringCore(ctx, v) {
  const rand = rng(7900 + v);
  fill(ctx, 0.85);
  const x = 13 + rand() * 4;
  const y = 22 + rand() * 6;
  for (let r = 6; r < 40; r += 6.5 + rand() * 2) arc(ctx, x, y, r, r, 0, TAU, 1.7, 0.38);
  dot(ctx, x, y, 2.6, 0.3);
}

// ---------------------------------------------------------------- accents

function fissure(ctx, a, v) {
  const rand = rng(8100 + a * 9 + v * 41);
  const ang = [0, -Math.PI / 4, Math.PI / 2, Math.PI / 4][a];
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const pts = [];
  for (let k = -4; k <= 4; k++) {
    const j = (rand() - 0.5) * 6;
    pts.push(W / 2 + c * k * 8 - s * j, H / 2 + s * k * 8 + c * j);
  }
  line(ctx, pts, 2.6, 1);
  const i = 2 * (3 + Math.floor(rand() * 3));
  line(ctx, [pts[i], pts[i + 1], pts[i] + (rand() - 0.5) * 16, pts[i + 1] + (rand() - 0.5) * 20], 1.6, 0.8);
}

// Moss cushions: a dense pile of tiny tufts, thickest at the top of a cell.
function moss(ctx, v) {
  const rand = rng(8300 + v);
  const edge = 22 + rand() * 18;
  for (let k = 0; k < 40; k++) {
    const x = rand() * (W + 4) - 2;
    const y = rand() * (edge + 6) - 4 + Math.sin(x * 0.4 + v) * 4;
    const fade = y > edge - 6 ? 0.5 : 1;
    dot(ctx, x, y, 1.5 + rand() * 1.8, (0.5 + rand() * 0.5) * fade);
  }
  for (let k = 0; k < 3; k++) {
    const x = 3 + rand() * 24;
    line(ctx, [x, edge - 6, x + (rand() - 0.5) * 4, edge + 4 + rand() * 6], 2, 0.6);
  }
}

// Lichen: flat rosettes in a ring of dots.
function lichen(ctx, v) {
  const rand = rng(8400 + v);
  const n = 1 + (v % 2);
  for (let k = 0; k < n; k++) {
    const x = 7 + rand() * 16;
    const y = 10 + rand() * 30;
    const r = 4 + rand() * 3;
    for (let p = 0; p < 9; p++) {
      const a = p / 9 * TAU + rand() * 0.3;
      dot(ctx, x + Math.cos(a) * r, y + Math.sin(a) * r * 1.1, 1.5 + rand() * 0.8, 0.8 + rand() * 0.2);
    }
    dot(ctx, x, y, 2, 0.6);
  }
}

// Bracket fungus: shelves with a pale upper rim, stacked on bark.
function fungus(ctx, v) {
  const rand = rng(8500 + v);
  const n = 1 + (v === 2 ? 1 : 0);
  for (let k = 0; k < n; k++) {
    const x = 12 + rand() * 6;
    const y = (n === 1 ? 22 : 16 + k * 18) + rand() * 4;
    const rx = (n === 1 ? 14 : 11) + rand() * 2;
    ctx.fillStyle = grey(0.7);
    ctx.beginPath();
    ctx.ellipse(x, y, rx, rx * 0.75, 0, 0, Math.PI);
    ctx.closePath();
    ctx.fill();
    line(ctx, [x - rx, y, x + rx, y], 2, 1);
    arc(ctx, x, y, rx * 0.6, rx * 0.33, 0.2, Math.PI - 0.2, 1.2, 0.4);
  }
}

// Wood chips scattered on the ground, low in the cell.
function chips(ctx, v) {
  const rand = rng(8600 + v);
  const n = 2 + Math.floor(rand() * 3);
  for (let k = 0; k < n; k++) {
    const x = 4 + rand() * 22;
    const y = 30 + rand() * 16;
    const a = (rand() - 0.5) * 1.6;
    const l = 4 + rand() * 4;
    const c = Math.cos(a);
    const s = Math.sin(a);
    poly(ctx, [x - c * l, y - s * l, x + c * l, y + s * l - 2.2, x + c * l * 0.6, y + s * l + 1.8],
      0.75 + rand() * 0.25);
  }
}

// Soft ground shadow: an ordered dither from light to deep.
function shade(ctx, k) {
  const step = [10, 8, 6][k];
  let row = 0;
  for (let y = step / 2; y < H + 4; y += step * 1.2, row++) {
    for (let x = (row % 2 ? step / 2 : 0); x < W + 4; x += step) dot(ctx, x, y, 1.6 + k * 0.5);
  }
}

// A thin strand (stem, rope, branch) through the cell at one of four angles.
function strip(ctx, a, w) {
  const ang = [0, -Math.PI / 4, Math.PI / 2, Math.PI / 4][a];
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const width = [6, 11][w];
  line(ctx, [W / 2 - c * 40, H / 2 - s * 40, W / 2 + c * 40, H / 2 + s * 40], width, 0.9);
  line(ctx, [W / 2 - c * 40 + s * width * 0.3, H / 2 - s * 40 - c * width * 0.3,
    W / 2 + c * 40 + s * width * 0.3, H / 2 + s * 40 - c * width * 0.3], 1.6, 1);
}

// Rope or guy line: a fine twisted line at one of eight angles.
function rope(ctx, a) {
  const ang = a / 8 * Math.PI;
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  line(ctx, [W / 2 - c * 40, H / 2 - s * 40, W / 2 + c * 40, H / 2 + s * 40], 2.4, 0.95);
}

// Stitched seam: short dashes along a line.
function seam(ctx, a) {
  const ang = [0, -Math.PI / 4, Math.PI / 2, Math.PI / 4][a];
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  line(ctx, [W / 2 - c * 40, H / 2 - s * 40, W / 2 + c * 40, H / 2 + s * 40], 2.6, 0.75);
  for (let k = -4; k <= 4; k++) {
    const x = W / 2 + c * k * 7;
    const y = H / 2 + s * k * 7;
    line(ctx, [x - s * 3 - c * 1.5, y + c * 3 - s * 1.5, x + s * 3 + c * 1.5, y - c * 3 + s * 1.5], 1.4, 1);
  }
}

// Woven canvas with soft creases; T is the light on the cloth.
function canvasCloth(ctx, t, v) {
  const rand = rng(8800 + t * 7 + v * 19);
  const base = 0.42 + t * 0.15;
  fill(ctx, base);
  for (let y = 2; y < H; y += 5) line(ctx, [-2, y, W + 2, y + (rand() - 0.5)], 0.9, base * 0.82);
  const n = 1 + (v % 2);
  for (let k = 0; k < n; k++) {
    const x = 4 + rand() * 22;
    const lean = (rand() - 0.5) * 18;
    line(ctx, [x, -4, x + lean, H + 4], 3.2, Math.min(1, base + 0.2));
    line(ctx, [x + 3, -4, x + lean + 3, H + 4], 2.2, base * 0.55);
  }
}

// Flames: a tongue with a brighter heart.
function flame(ctx, v) {
  const rand = rng(8900 + v);
  const x = 13 + rand() * 4;
  const top = 2 + rand() * 10;
  const lean = (rand() - 0.5) * 8;
  poly(ctx, [x + lean, top, x + 9, 30, x + 7, 44, x, 50, x - 7, 44, x - 8, 30], 0.75);
  poly(ctx, [x + lean * 0.6, top + 12, x + 5, 34, x + 3, 44, x - 3, 44, x - 5, 34], 1);
}

// Charred wood: blocks of charcoal split by a black crack network.
function charcoal(ctx, v) {
  const rand = rng(9000 + v);
  fill(ctx, 0.62);
  for (let y = 4 + rand() * 6; y < H; y += 9 + rand() * 4) {
    line(ctx, [-2, y, W + 2, y + (rand() - 0.5) * 4], 2, 0);
    for (let x = rand() * 10; x < W; x += 8 + rand() * 8) line(ctx, [x, y, x + (rand() - 0.5) * 3, y + 9], 1.8, 0);
  }
}

// Glowing specks for embers.
function embers(ctx, v) {
  const rand = rng(9100 + v);
  for (let k = 0; k < 4; k++) dot(ctx, 3 + rand() * 24, 6 + rand() * 40, 1.6 + rand() * 1.4, 0.7 + rand() * 0.3);
}

// ---------------------------------------------------------------- plants

// Leaf clusters for broadleaf crowns and shrubs; T is the light.
function leaves(ctx, t, v) {
  const rand = rng(9200 + t * 11 + v * 23);
  const n = 3 + t * 2;
  for (let k = 0; k < n; k++) {
    const a = rand() * TAU;
    const x = 2 + rand() * 26;
    const y = 4 + rand() * 42;
    leaf(ctx, x, y, 10 + rand() * 5, 5 + rand() * 2, a, 0.55 + t * 0.12 + rand() * 0.15, 0.3);
  }
}

// Pine needles: drooping sprays along a twig.
function needles(ctx, t, v) {
  const rand = rng(9300 + t * 11 + v * 23);
  const n = 2 + t;
  for (let k = 0; k < n; k++) {
    const x = 3 + rand() * 24;
    const y = 4 + rand() * 30;
    const dir = rand() < 0.5 ? -1 : 1;
    const len = 10 + rand() * 8;
    const level = 0.55 + t * 0.13;
    line(ctx, [x, y, x + dir * len, y + 6], 1.6, level);
    for (let s = 1; s <= 4; s++) {
      const px = x + dir * len * s / 5;
      const py = y + 6 * s / 5;
      line(ctx, [px, py, px - dir * 2, py + 7], 1.3, level);
      line(ctx, [px, py, px + dir * 3, py + 6], 1.3, level * 0.85);
    }
  }
}

// A cluster of round berries, each with a lit shoulder and a dark side.
function berries(ctx, v) {
  const rand = rng(9400 + v);
  const n = 1 + (v % 3);
  for (let k = 0; k < n; k++) {
    const x = 9 + rand() * 12 + (k - (n - 1) / 2) * 6;
    const y = 18 + rand() * 16 + (k % 2) * 5;
    const r = 4.6 + rand() * 1.6;
    dot(ctx, x, y, r, 0.62);
    dot(ctx, x - 0.8, y - 0.9, r * 0.78, 0.9);
    dot(ctx, x - r * 0.38, y - r * 0.42, r * 0.28, 1);
  }
}

// A woody fork: the branching stems inside a shrub.
function fork(ctx, v) {
  const rand = rng(9500 + v);
  const x = 13 + rand() * 4;
  line(ctx, [x, 54, x + (rand() - 0.5) * 4, 26], 3.6, 0.9);
  const side = v % 2 ? 1 : -1;
  curve(ctx, x, 32, x + side * 6, 22, x + side * 13, 6, 2.6, 0.85);
  if (v >= 2) curve(ctx, x, 40, x - side * 6, 30, x - side * 12, 18, 2.2, 0.75);
}

// Arching sedge blades for a harvestable tussock; L is the lean.
function blades(ctx, l, v) {
  const rand = rng(9600 + l * 7 + v * 13);
  const lean = (l - 2) * 11;
  const n = 2 + (v % 2);
  for (let k = 0; k < n; k++) {
    const x = 7 + k * 8 + rand() * 4;
    const tipX = x + lean + (rand() - 0.5) * 6;
    curve(ctx, x, 54, x + lean * 0.3, 24, tipX, -4, 2.6, 0.8 + rand() * 0.2);
  }
}

// A feathery seed head on its stalk.
function plume(ctx, v) {
  const rand = rng(9700 + v);
  const lean = (v - 1.5) * 3;
  line(ctx, [15, 54, 15 + lean, 30], 1.8, 0.7);
  for (let k = 0; k < 9; k++) {
    const y = 4 + k * 3.2;
    const x = 15 + lean * (1 + (30 - y) / 26);
    const w = 3 + Math.sin(k / 8 * Math.PI) * 4 + rand();
    line(ctx, [x, y, x - w, y + 3.5], 1.5, 0.9);
    line(ctx, [x, y, x + w, y + 3.5], 1.5, 0.9);
  }
}

function stubble(ctx, v) {
  const rand = rng(9800 + v);
  for (let k = 0; k < 5; k++) {
    const x = 3 + k * 6 + rand() * 2;
    const top = 30 + rand() * 12;
    line(ctx, [x, 52, x + (rand() - 0.5) * 3, top], 2.2, 0.8);
    line(ctx, [x - 2, top, x + 2, top - 1], 1.4, 1);
  }
}

// Long reed leaves arching away from the clump.
function reedLeaf(ctx, v) {
  const side = v % 2 ? 1 : -1;
  const rand = rng(9900 + v);
  curve(ctx, 15 - side * 6, 54, 15 + side * (2 + rand() * 4), 18, 15 + side * 16, 2 + rand() * 10, 3, 0.85);
}

// Mushroom parts in three pieces so a wide cap spans several cells.
function capPiece(ctx, part) {
  ctx.fillStyle = grey(1);
  ctx.beginPath();
  if (part === 0) ctx.ellipse(W + 6, 40, W + 2, 30, 0, Math.PI, Math.PI * 1.5);
  else if (part === 2) ctx.ellipse(-6, 40, W + 2, 30, 0, Math.PI * 1.5, TAU);
  else { ctx.moveTo(-6, 9); ctx.lineTo(W + 6, 9); ctx.lineTo(W + 6, 41); ctx.lineTo(-6, 41); }
  ctx.lineTo(part === 0 ? W + 6 : -6, 40);
  ctx.closePath();
  ctx.fill();
  if (part === 1) {
    ctx.fillStyle = '#000';
    ctx.fillRect(-6, -6, W + 12, 15);
    ctx.fillStyle = grey(1);
    ctx.beginPath();
    ctx.ellipse(W / 2, 12, W, 6, 0, Math.PI, TAU);
    ctx.fill();
  }
  // The cap's underside rim.
  line(ctx, [-6, 42, W + 6, 42], 2.2, 0.45);
}

function capSpots(ctx, v) {
  const rand = rng(10000 + v);
  const n = 2 + (v % 2);
  for (let k = 0; k < n; k++) ellipse(ctx, 4 + rand() * 22, 14 + rand() * 18, 2.6 + rand() * 1.6, 2 + rand(), 0, 1);
}

// Gills and stem below a cap.
function stemPiece(ctx, v) {
  const w = [5, 7, 4][v];
  poly(ctx, [15 - w, -4, 15 + w, -4, 15 + w + 1, 50, 15 - w - 1, 50], 0.85);
  line(ctx, [15 - w + 1.5, -4, 15 - w + 0.5, 50], 1.8, 1);
  if (v === 1) arc(ctx, 15, 12, w + 2, 3, 0, Math.PI, 2.2, 0.7);
}

// ---------------------------------------------------------------- ironwork

function nails(ctx, v) {
  const spots = [[[6, 9], [24, 9]], [[6, 41], [24, 41]], [[15, 25]], [[6, 9], [24, 41]]][v];
  for (const [x, y] of spots) {
    dot(ctx, x, y, 3, 0.55);
    dot(ctx, x - 0.8, y - 1, 1.5, 1);
  }
}

function hoop(ctx, v) {
  poly(ctx, [-6, 17, W + 6, 17, W + 6, 31, -6, 31], 0.7);
  line(ctx, [-6, 18.5, W + 6, 18.5], 2.4, 1);
  line(ctx, [-6, 30, W + 6, 30], 1.6, 0.35);
  if (v) { dot(ctx, 15, 24, 2.4, 0.4); dot(ctx, 14.3, 23.2, 1.2, 1); }
}

// Rope lashing: tight diagonal wraps.
function lash(ctx, v) {
  const rand = rng(10100 + v);
  for (let k = 0; k < 4; k++) {
    const y = 12 + k * 7 + rand();
    line(ctx, [-2, y + 4, W + 2, y - 3], 3.4, 0.85);
    line(ctx, [-2, y + 5.6, W + 2, y - 1.4], 1.2, 0.4);
  }
}

// A carved groove, such as a letter or an arrow cut into a board.
function carve(ctx, v) {
  const shapes = [
    [4, 25, 26, 25], [8, 12, 22, 38], [22, 12, 8, 38], [15, 10, 15, 40],
  ];
  line(ctx, shapes[v], 3.2, 1);
}

function arrowHead(ctx, dir) {
  const x0 = dir ? 24 : 6;
  const x1 = dir ? 6 : 24;
  poly(ctx, [x0, 25, x1, 12, x1 + (dir ? 4 : -4), 25, x1, 38], 1);
}

function peg(ctx) {
  poly(ctx, [12, 24, 18, 24, 16, 46, 14, 46], 0.85);
  poly(ctx, [10, 20, 20, 20, 20, 26, 10, 26], 1);
}

// ---------------------------------------------------------------- items

const ITEM = {
  flint: (ctx) => {
    poly(ctx, [5, 34, 14, 14, 26, 22, 23, 38, 12, 42], 0.6);
    poly(ctx, [14, 14, 26, 22, 18, 28], 1);
    line(ctx, [5, 34, 14, 14], 1.6, 1);
  },
  stick: (ctx) => {
    line(ctx, [2, 40, 28, 22], 3.6, 0.9);
    line(ctx, [16, 31, 22, 40], 2.2, 0.75);
    line(ctx, [2, 38.5, 28, 20.5], 1.2, 1);
  },
  leaf: (ctx) => leaf(ctx, 6, 40, 16, 6, -0.6, 1, 0.4),
  cap: (ctx) => {
    ctx.fillStyle = grey(1);
    ctx.beginPath();
    ctx.ellipse(15, 30, 11, 9, 0, Math.PI, TAU);
    ctx.closePath();
    ctx.fill();
    line(ctx, [4, 31, 26, 31], 2, 0.5);
  },
  stem: (ctx) => poly(ctx, [12, 31, 18, 31, 19, 44, 11, 44], 1),
  spots: (ctx) => { dot(ctx, 10, 25, 1.8); dot(ctx, 17, 23, 2); dot(ctx, 21, 27, 1.4); },
  reed: (ctx) => {
    line(ctx, [4, 44, 26, 18], 2, 0.8);
    ellipse(ctx, 17, 28, 3.8, 9, 0.7, 1);
  },
  clay: (ctx) => {
    ellipse(ctx, 15, 34, 11, 8, 0, 0.75);
    ellipse(ctx, 13, 31, 7, 4.5, 0, 1);
    arc(ctx, 18, 35, 4, 2.5, 0.3, 2.6, 1.4, 0.4);
  },
  straw: (ctx) => {
    for (let k = -3; k <= 3; k++) line(ctx, [4, 30 + k * 1.6, 26, 26 + k * 2.2], 1.4, 0.85);
    line(ctx, [14, 22, 16, 34], 2.6, 0.5);
  },
  fibre: (ctx) => {
    arc(ctx, 15, 32, 10, 6, 0, TAU, 2.2, 0.9);
    arc(ctx, 15, 32, 6, 3.6, 0, TAU, 2, 0.8);
    line(ctx, [25, 32, 28, 22], 1.6, 0.8);
  },
  log: (ctx) => {
    poly(ctx, [2, 26, 22, 26, 22, 40, 2, 40], 0.75);
    line(ctx, [2, 28, 22, 28], 1.6, 1);
    line(ctx, [4, 34, 18, 34.5], 1.2, 0.45);
  },
  logend: (ctx) => {
    ellipse(ctx, 23, 33, 5, 7.4, 0, 0.95);
    arc(ctx, 23, 33, 2.6, 4, 0, TAU, 1.2, 0.4);
  },
  ore: (ctx) => {
    poly(ctx, [5, 40, 8, 26, 17, 20, 26, 27, 25, 40], 0.7);
    poly(ctx, [8, 26, 17, 20, 18, 30], 0.95);
  },
  glints: (ctx) => { dot(ctx, 12, 32, 1.8); dot(ctx, 19, 27, 1.5); dot(ctx, 20, 36, 1.4); },
  blade: (ctx) => {
    poly(ctx, [4, 42, 23, 14, 26, 11, 24, 16, 7, 44], 0.9);
    line(ctx, [5, 42, 24, 13], 1.2, 1);
  },
  hilt: (ctx) => {
    line(ctx, [2, 37, 11, 46], 3.2, 1);
    line(ctx, [0, 48, 6, 42], 3, 0.8);
  },
  bow: (ctx) => {
    arc(ctx, 6, 25, 14, 22, -Math.PI / 2, Math.PI / 2, 3, 0.95);
    line(ctx, [6, 3, 6, 47], 1.2, 0.8);
  },
  shaft: (ctx) => {
    line(ctx, [2, 44, 26, 8], 2.4, 0.9);
    poly(ctx, [26, 4, 28, 13, 22, 10], 1);
  },
  head: (ctx) => {
    poly(ctx, [16, 6, 27, 14, 24, 24, 15, 18], 0.95);
    line(ctx, [16, 6, 27, 14], 1.4, 1);
  },
  hammerhead: (ctx) => poly(ctx, [14, 6, 28, 12, 25, 22, 11, 16], 0.95),
  flask: (ctx) => {
    ellipse(ctx, 15, 34, 8, 9, 0, 0.6);
    poly(ctx, [12, 14, 18, 14, 18, 27, 12, 27], 0.6);
    poly(ctx, [11, 10, 19, 10, 19, 15, 11, 15], 0.9);
    arc(ctx, 13, 32, 4, 5, Math.PI, Math.PI * 1.5, 1.6, 1);
  },
  liquid: (ctx) => {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(15, 34, 6.6, 7.6, 0, 0, TAU);
    ctx.clip();
    ctx.fillStyle = grey(1);
    ctx.fillRect(0, 31, W, 20);
    ctx.restore();
  },
  roll: (ctx) => {
    ellipse(ctx, 15, 32, 10, 9, 0, 0.9);
    arc(ctx, 15, 32, 6, 5.4, 0, TAU, 1.5, 0.5);
    arc(ctx, 15, 32, 2.5, 2.2, 0, TAU, 1.3, 0.5);
    line(ctx, [21, 40, 28, 44], 3, 0.85);
  },
};

export const PROPS = [
  ...grid('props.stone', 5, 4, stone),
  ...grid('props.cut.s', 8, 3, (ctx, d, c) => cut(ctx, d, c, false)).map((e) => {
    const [, , , d, c] = e.name.split('.');
    return { ...e, mirror: `props.cut.s.${cutMirror(+d)}.${c}` };
  }),
  ...grid('props.cut.r', 8, 3, (ctx, d, c) => cut(ctx, d, c, true)).map((e) => {
    const [, , , d, c] = e.name.split('.');
    return { ...e, mirror: `props.cut.r.${cutMirror(+d)}.${c}` };
  }),
  ...grid('props.strip', 4, 2, strip).map((e) => {
    const [, , a, w] = e.name.split('.');
    return { ...e, mirror: `props.strip.${[0, 3, 2, 1][a]}.${w}` };
  }),
  ...list('props.shade', 3, shade),
  ...list('props.ridge', 4, ridge).map((e, i) => ({ ...e, mirror: `props.ridge.${[0, 3, 2, 1][i]}` })),
  ...grid('props.fissure', 4, 2, fissure).map((e) => {
    const [, , a, v] = e.name.split('.');
    return { ...e, mirror: `props.fissure.${[0, 3, 2, 1][a]}.${v}` };
  }),
  ...list('props.moss', 6, moss, { flip: true }),
  ...list('props.lichen', 4, lichen),
  ...grid('props.bark', 4, 4, (ctx, t, v) => barkRidges(ctx, t, v, false)),
  ...grid('props.barkh', 4, 4, (ctx, t, v) => barkRidges(ctx, t, v, true), { flip: true }),
  ...list('props.birch', 4, birch),
  ...grid('props.grainv', 4, 4, (ctx, t, v) => grain(ctx, t, v, false)),
  ...grid('props.grainh', 4, 4, (ctx, t, v) => grain(ctx, t, v, true)),
  ...grid('props.ring', 8, 3, rings).map((e) => {
    const [, , d, v] = e.name.split('.');
    return { ...e, mirror: `props.ring.${cutMirror(+d)}.${v}` };
  }),
  ...list('props.ringcore', 3, ringCore),
  ...list('props.fungus', 3, fungus, { flip: true }),
  ...list('props.chips', 4, chips, { flip: true }),
  ...list('props.rope', 8, rope).map((e, i) => ({ ...e, mirror: `props.rope.${(8 - i) % 8}` })),
  ...list('props.seam', 4, seam).map((e, i) => ({ ...e, mirror: `props.seam.${[0, 3, 2, 1][i]}` })),
  ...grid('props.canvas', 4, 3, canvasCloth),
  ...list('props.flame', 4, flame, { flip: true }),
  ...list('props.char', 3, charcoal),
  ...list('props.embers', 3, embers),
  ...grid('props.leaves', 4, 4, leaves),
  ...grid('props.needles', 4, 3, needles, { flip: true }),
  ...list('props.berry', 6, berries, { flip: true }),
  ...list('props.fork', 4, fork, { flip: true }),
  ...grid('props.blades', 5, 2, blades, { flip: true }),
  ...list('props.plume', 4, plume, { flip: true }),
  ...list('props.stubble', 3, stubble, { flip: true }),
  ...list('props.reedleaf', 4, reedLeaf, { flip: true }),
  ...list('props.cap', 3, capPiece, { flip: true }),
  ...list('props.capspots', 4, capSpots, { flip: true }),
  ...list('props.stem', 3, stemPiece, { flip: true }),
  ...list('props.nails', 4, nails),
  ...list('props.hoop', 2, hoop, { flip: true }),
  ...list('props.lash', 2, lash),
  ...list('props.carve', 4, carve).map((e, i) => ({ ...e, mirror: `props.carve.${[0, 2, 1, 3][i]}` })),
  ...list('props.arrow', 2, arrowHead),
  { name: 'props.peg', draw: peg, flip: true },
  ...Object.entries(ITEM).map(([name, draw]) => ({ name: `props.item.${name}`, draw, flip: true })),
];
