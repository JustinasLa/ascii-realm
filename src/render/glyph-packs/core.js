// General-purpose detail glyphs shared by every part of the world: specks,
// pebbles, sparkles, petals, leaves, cracks, dithers, ripples and so on.
// Domain packs (terrain, water, flora, trees, props, effects) add their own.

import {
  arc, curve, dot, ellipse, fuzz, grey, leaf, line, petals, poly, rng, TAU, variants,
} from './draw.js';

const W = 30;
const H = 50;

// Positions on a 3x3 grid inside the cell.
const GX = [7, 15, 23];
const GY = [11, 25, 39];

const angleMirror = (n) => (i) => (n - i) % n;

export const CORE = [
  // A single round dot at one of nine places.
  ...variants('dot', 9, (ctx, w, h, i) => dot(ctx, GX[i % 3], GY[Math.floor(i / 3)], 3.6)),
  // Fine grit: a few tiny dots of varied strength scattered in the cell.
  ...variants('speck', 16, (ctx, w, h, i) => {
    const rand = rng(100 + i);
    const n = 2 + Math.floor(rand() * 4);
    for (let k = 0; k < n; k++) dot(ctx, 3 + rand() * 24, 4 + rand() * 42, 1.6 + rand() * 1.6, 0.55 + rand() * 0.45);
  }),
  // A single pebble with a lit upper edge and a darker body.
  ...variants('pebble', 8, (ctx, w, h, i) => {
    const rand = rng(200 + i);
    const rx = 5 + rand() * 5;
    const ry = 3.5 + rand() * 3;
    const x = 8 + rand() * 14;
    const y = 14 + rand() * 24;
    const a = (rand() - 0.5) * 0.8;
    ellipse(ctx, x, y + 1.5, rx, ry, a, 0.35);
    ellipse(ctx, x, y, rx * 0.92, ry * 0.85, a, 0.65);
    ellipse(ctx, x - rx * 0.25, y - ry * 0.3, rx * 0.45, ry * 0.4, a, 1);
  }),
  // A small cluster of gravel.
  ...variants('gravel', 8, (ctx, w, h, i) => {
    const rand = rng(300 + i);
    const n = 3 + Math.floor(rand() * 3);
    for (let k = 0; k < n; k++) {
      const x = 4 + rand() * 22;
      const y = 6 + rand() * 38;
      const r = 2 + rand() * 2.8;
      ellipse(ctx, x, y, r * 1.2, r, rand(), 0.5 + rand() * 0.25);
      dot(ctx, x - r * 0.3, y - r * 0.35, r * 0.5, 1);
    }
  }),
  // Four-pointed glints: large, medium and small.
  ...variants('sparkle', 3, (ctx, w, h, i) => {
    const s = [1, 0.7, 0.45][i];
    const x = W / 2;
    const y = H / 2;
    poly(ctx, [x, y - 16 * s, x + 2.6 * s, y, x, y + 16 * s, x - 2.6 * s, y]);
    poly(ctx, [x - 11 * s, y, x, y + 2.4 * s, x + 11 * s, y, x, y - 2.4 * s]);
    dot(ctx, x, y, 3 * s);
  }),
  // Flower heads drawn as petals around an open eye, so a second glyph in
  // another colour can be layered into the middle.
  { name: 'flower.ring4', draw: (ctx) => petals(ctx, 15, 25, 4, 9, 7, Math.PI / 4, 1, 3) },
  { name: 'flower.ring5', draw: (ctx) => petals(ctx, 15, 25, 5, 9, 6.5, -Math.PI / 2, 1, 3) },
  { name: 'flower.ring6', draw: (ctx) => petals(ctx, 15, 25, 6, 9, 5.5, 0, 1, 3.4) },
  { name: 'flower.ring8', draw: (ctx) => petals(ctx, 15, 25, 8, 10, 4, 0, 1, 3.4) },
  { name: 'flower.small5', draw: (ctx) => petals(ctx, 15, 25, 5, 6, 4.4, -Math.PI / 2, 1, 2.2) },
  { name: 'flower.eye', draw: (ctx) => dot(ctx, 15, 25, 3.6) },
  { name: 'flower.eye.big', draw: (ctx) => { dot(ctx, 15, 25, 5, 0.7); dot(ctx, 14, 24, 2.6); } },
  // A cup-shaped bloom such as a tulip or crocus.
  { name: 'flower.cup', flip: true, draw: (ctx) => {
    poly(ctx, [7, 14, 11, 20, 15, 12, 19, 20, 23, 14, 22, 28, 15, 33, 8, 28]);
    line(ctx, [15, 33, 15, 50], 2.4, 0.6);
  } },
  // A nodding bell such as a bluebell or snowdrop.
  { name: 'flower.bell', flip: true, draw: (ctx) => {
    curve(ctx, 13, 50, 12, 18, 19, 14, 2.4, 0.6);
    poly(ctx, [19, 15, 24, 20, 26, 32, 22, 30, 19, 33, 16, 30, 12, 32, 14, 20]);
  } },
  // A spray of tiny florets.
  ...variants('flower.spray', 4, (ctx, w, h, i) => {
    const rand = rng(400 + i);
    for (let k = 0; k < 4; k++) {
      const x = 6 + rand() * 18;
      const y = 10 + rand() * 30;
      petals(ctx, x, y, 5, 3.2, 2.6, rand() * TAU, 1, 0.8);
    }
  }),
  // The yellow eyes of a spray, to layer over flower.spray.N.
  ...variants('flower.sprayeye', 4, (ctx, w, h, i) => {
    const rand = rng(400 + i);
    for (let k = 0; k < 4; k++) {
      const x = 6 + rand() * 18;
      const y = 10 + rand() * 30;
      rand();
      dot(ctx, x, y, 1.4);
    }
  }),
  // A clover trefoil, leaves at a few places in the cell.
  ...variants('clover', 4, (ctx, w, h, i) => {
    const rand = rng(500 + i);
    const x = 9 + rand() * 12;
    const y = 18 + rand() * 16;
    for (let k = 0; k < 3; k++) {
      const a = -Math.PI / 2 + k * TAU / 3 + rand() * 0.3;
      ellipse(ctx, x + Math.cos(a) * 4.6, y + Math.sin(a) * 4.6, 4.4, 3.8, a, 0.95);
    }
    dot(ctx, x, y, 1.6, 0.5);
  }),
  // Fallen leaves at eight headings; reflections turn them over.
  ...variants('leaf', 8, (ctx, w, h, i) => {
    const a = i / 8 * TAU;
    leaf(ctx, 15 - Math.cos(a) * 9, 25 - Math.sin(a) * 9, 18, 7.5, a, 1, 0.5);
  }, angleMirror(8)),
  // Smaller leaves, two to a cell.
  ...variants('leaflet', 8, (ctx, w, h, i) => {
    const rand = rng(600 + i);
    for (let k = 0; k < 2; k++) {
      const a = rand() * TAU;
      leaf(ctx, 6 + rand() * 18, 8 + rand() * 32, 10, 4.5, a, 0.8 + rand() * 0.2, 0.45);
    }
  }),
  // Twigs with a side shoot.
  ...variants('twig', 4, (ctx, w, h, i) => {
    const a = (i / 4) * Math.PI + 0.3;
    const c = Math.cos(a);
    const s = Math.sin(a);
    line(ctx, [15 - c * 16, 25 - s * 16, 15 + c * 16, 25 + s * 16], 2.8, 0.9);
    line(ctx, [15 + c * 3, 25 + s * 3, 15 + c * 10 - s * 6, 25 + s * 10 + c * 6], 2, 0.7);
  }),
  // Hairline cracks.
  ...variants('crack', 6, (ctx, w, h, i) => {
    const rand = rng(700 + i);
    const pts = [];
    let x = rand() * W;
    let y = 0;
    const down = i % 2 === 0;
    if (!down) { x = 0; y = rand() * H; }
    for (let k = 0; k <= 5; k++) {
      pts.push(x, y);
      if (down) { y += H / 5; x += (rand() - 0.5) * 14; } else { x += W / 5; y += (rand() - 0.5) * 18; }
    }
    line(ctx, pts, 2.2, 1);
    if (rand() < 0.6) line(ctx, [pts[4], pts[5], pts[4] + (rand() - 0.5) * 16, pts[5] + (rand() - 0.5) * 20], 1.6, 0.8);
  }),
  // Ordered dither from sparse to dense, for soft gradients.
  ...variants('stipple', 4, (ctx, w, h, i) => {
    const step = [12.5, 10, 7.5, 5][i];
    let row = 0;
    for (let y = step / 2; y < H; y += step * 1.25, row++) {
      for (let x = (row % 2 ? step / 2 : 0) + step / 4; x < W; x += step) dot(ctx, x, y, 1.5 + i * 0.25);
    }
  }),
  // Diagonal hatching for shadow.
  { name: 'hatch./', draw: (ctx) => { for (let k = -2; k < 5; k++) line(ctx, [k * 10, 56, k * 10 + 32, -6], 1.6); },
    mirror: 'hatch.\\' },
  { name: 'hatch.\\', draw: (ctx) => { for (let k = -2; k < 5; k++) line(ctx, [k * 10, -6, k * 10 + 32, 56], 1.6); },
    mirror: 'hatch./' },
  // Water rings and wavelets.
  { name: 'ripple.ring', draw: (ctx) => arc(ctx, 15, 25, 12, 7, 0, TAU, 2.4) },
  { name: 'ripple.ring.small', draw: (ctx) => arc(ctx, 15, 25, 6, 3.6, 0, TAU, 2.2) },
  { name: 'ripple.top', draw: (ctx) => arc(ctx, 15, 34, 15, 9, Math.PI, TAU, 2.6), mirror: 'ripple.bottom' },
  { name: 'ripple.bottom', draw: (ctx) => arc(ctx, 15, 16, 15, 9, 0, Math.PI, 2.6), mirror: 'ripple.top' },
  ...variants('wavelet', 4, (ctx, w, h, i) => {
    const rand = rng(800 + i);
    for (let k = 0; k < 2; k++) {
      const x = 4 + rand() * 18;
      const y = 10 + rand() * 30;
      curve(ctx, x, y + 2, x + 4, y - 3, x + 8, y + 2, 2.2, 0.8 + rand() * 0.2);
    }
  }),
  // Moss and lichen.
  ...variants('moss', 4, (ctx, w, h, i) => fuzz(ctx, 15, 25 + (i - 1.5) * 4, 11, 13, 900 + i, 34, 2.4)),
  // Short tufts of grass rising from the bottom of the cell.
  ...variants('tuft', 4, (ctx, w, h, i) => {
    const rand = rng(1000 + i);
    const n = 3 + Math.floor(rand() * 3);
    for (let k = 0; k < n; k++) {
      const x = 4 + rand() * 22;
      const lean = (rand() - 0.5) * 18;
      const top = 14 + rand() * 22;
      poly(ctx, [x - 2.2, 52, x + 2.2, 52, x + lean + 0.6, top, x + lean - 0.6, top], 0.7 + rand() * 0.3);
    }
  }).map((e) => ({ ...e, flip: true })),
  // Toadstools: a cap and a stem to layer in two colours.
  { name: 'mush.cap', flip: true, draw: (ctx) => {
    ctx.fillStyle = grey(1);
    ctx.beginPath();
    ctx.ellipse(15, 26, 12, 10, 0, Math.PI, TAU);
    ctx.closePath();
    ctx.fill();
  } },
  { name: 'mush.spots', flip: true, draw: (ctx) => { dot(ctx, 10, 22, 2); dot(ctx, 17, 19, 2.2); dot(ctx, 21, 24, 1.6); } },
  { name: 'mush.stem', flip: true, draw: (ctx) => poly(ctx, [12, 26, 18, 26, 19, 44, 11, 44]) },
  { name: 'mush.small', flip: true, draw: (ctx) => {
    ctx.fillStyle = grey(1);
    ctx.beginPath();
    ctx.ellipse(10, 34, 6, 5, 0, Math.PI, TAU);
    ctx.ellipse(21, 38, 5, 4, 0, Math.PI, TAU);
    ctx.fill();
    line(ctx, [10, 34, 10, 44], 3, 0.7);
    line(ctx, [21, 38, 21, 45], 2.6, 0.7);
  } },
  // Round leaves floating on water.
  ...variants('lilypad', 3, (ctx, w, h, i) => {
    const r = [12, 9, 6.5][i];
    const notch = 0.5;
    ctx.fillStyle = grey(0.85);
    ctx.beginPath();
    ctx.moveTo(15, 25);
    ctx.ellipse(15, 25, r, r * 0.62, 0, notch * 0.5 - Math.PI / 2, TAU - notch * 0.5 - Math.PI / 2);
    ctx.closePath();
    ctx.fill();
    line(ctx, [15, 25, 15 + r * 0.7, 25 + r * 0.25], 1.2, 0.5);
    line(ctx, [15, 25, 15 - r * 0.7, 25 + r * 0.25], 1.2, 0.5);
  }),
  { name: 'lily.bloom', flip: true, draw: (ctx) => {
    for (let k = -2; k <= 2; k++) leaf(ctx, 15, 30, 13 - Math.abs(k) * 1.5, 5, -Math.PI / 2 + k * 0.42, 1, 1);
  } },
  // Grain running up a trunk or plank.
  ...variants('bark', 4, (ctx, w, h, i) => {
    const rand = rng(1100 + i);
    for (let k = 0; k < 3; k++) {
      let x = 4 + k * 10 + rand() * 4;
      const pts = [];
      for (let y = -4; y <= 54; y += 9) { pts.push(x, y); x += (rand() - 0.5) * 4; }
      line(ctx, pts, 2 + rand() * 1.6, 0.6 + rand() * 0.4);
    }
    if (i % 2) ellipse(ctx, 10 + rand() * 10, 15 + rand() * 20, 3, 4.5, 0, 0.9);
  }, (i) => i),
  // Solid and half-cell fills for crisp sprite edges.
  { name: 'block.full', draw: (ctx) => { ctx.fillRect(-6, -6, W + 12, H + 12); } },
  { name: 'block.top', draw: (ctx) => { ctx.fillRect(-6, -6, W + 12, H / 2 + 6); }, mirror: 'block.bottom' },
  { name: 'block.bottom', draw: (ctx) => { ctx.fillRect(-6, H / 2, W + 12, H / 2 + 6); }, mirror: 'block.top' },
  { name: 'block.left', draw: (ctx) => { ctx.fillRect(-6, -6, W / 2 + 6, H + 12); } },
  { name: 'block.right', draw: (ctx) => { ctx.fillRect(W / 2, -6, W / 2 + 6, H + 12); } },
  // A uniform veil at partial strength: layered over a cell, it tints it.
  ...variants('veil', 4, (ctx, w, h, i) => {
    ctx.fillStyle = grey([0.2, 0.4, 0.6, 0.8][i]);
    ctx.fillRect(-6, -6, W + 12, H + 12);
  }),
  // Outline rings.
  ...variants('ring', 3, (ctx, w, h, i) => arc(ctx, 15, 25, [4, 8, 12][i], [4, 8, 12][i], 0, TAU, 2.4)),
  // Thin stems rising from the bottom edge.
  ...variants('stem', 3, (ctx, w, h, i) => curve(ctx, 15, 52, 15 + (i - 1) * 2, 36, 15 + (i - 1) * 9, 22, 2.4))
    .map((e) => ({ ...e, flip: true })),
  // A cattail's brown head on its stalk.
  { name: 'reed.head', flip: true, draw: (ctx) => {
    line(ctx, [15, 4, 15, 12], 1.6);
    ellipse(ctx, 15, 24, 4.2, 12);
    line(ctx, [15, 36, 15, 54], 2.4, 0.8);
  } },
];
