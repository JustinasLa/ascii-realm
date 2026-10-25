// Water surfaces, shorelines and things that float.
// Entries: { name, draw(ctx, w, h), mirror?, flip? } - see draw.js and glyphs.js.
//
// The cell is 30 x 50 here and 0.6 x 1 on screen, so 50 units are one cell
// height in both directions and circles drawn here stay round. Strokes that
// must join their neighbours (streaks, waves, pad fills) run past the cell
// edge into the padding.

import { arc, curve, dot, ellipse, grey, line, poly, rng, TAU, variants } from './draw.js';

const W = 30;
const H = 50;
const ROWS = [15, 25, 35];

// A lens-shaped dash, pointed at both ends: a glint of light on a wavelet.
function lens(ctx, x, y, half, thick, level = 1) {
  poly(ctx, [x - half, y, x - half * 0.3, y - thick / 2, x + half * 0.3, y - thick / 2,
    x + half, y, x + half * 0.3, y + thick / 2, x - half * 0.3, y + thick / 2], level);
}

// A four-pointed glint, stretched sideways by `wide`.
function star(ctx, x, y, size, wide = 1, level = 1) {
  poly(ctx, [x, y - size, x + size * 0.18, y, x, y + size, x - size * 0.18, y], level);
  poly(ctx, [x - size * 0.75 * wide, y, x, y + size * 0.14, x + size * 0.75 * wide, y, x, y - size * 0.14], level);
  dot(ctx, x, y, Math.max(1.6, size * 0.2), level);
}

// A notched round leaf lying flat, its upper-left rim catching the moon.
function pad(ctx, x, y, r, notch, level = 0.72) {
  const half = 0.32;
  ctx.fillStyle = grey(level);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.ellipse(x, y, r, r * 0.62, 0, notch + half, notch + TAU - half);
  ctx.closePath();
  ctx.fill();
  arc(ctx, x, y, r * 0.9, r * 0.56, Math.PI * 0.95, Math.PI * 1.6, Math.max(2, r * 0.22), 1);
  for (const a of [notch + 1.6, notch + 3.1, notch + 4.6]) {
    line(ctx, [x, y, x + Math.cos(a) * r * 0.75, y + Math.sin(a) * r * 0.46], 1.4, level * 0.55);
  }
}

// One cell of a broad pad, filled to the edges so neighbours join, softly
// mottled, with a faint vein at heading `a`.
function padFill(ctx, a, seed) {
  ctx.fillStyle = grey(0.72);
  ctx.fillRect(-6, -6, W + 12, H + 12);
  const rand = rng(seed);
  for (let k = 0; k < 6; k++) dot(ctx, rand() * W, rand() * H, 2 + rand() * 2.5, 0.62 + rand() * 0.06);
  // A faint vein or two crossing the leaf.
  const c = Math.cos(a);
  const s = Math.sin(a);
  line(ctx, [15 - c * 40, 25 - s * 40, 15 + c * 40, 25 + s * 40], 1.6, 0.6);
}

// The rim of a broad pad: the leaf fills the side toward its middle (away
// from heading `a`) and stops at a raised, lighter edge.
function padRim(ctx, a, reach) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const R = 70;
  const cx = 15 + c * (reach - R);
  const cy = 25 + s * (reach - R);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, TAU);
  ctx.clip();
  ctx.fillStyle = grey(0.72);
  ctx.fillRect(-6, -6, W + 12, H + 12);
  ctx.restore();
  ctx.strokeStyle = grey(1);
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.arc(cx, cy, R - 1.2, a - 0.9, a + 0.9);
  ctx.stroke();
}

// A water lily: 0 open, 1 half open, 2 a bud. Petal tips are bright and the
// heart is left darker so the bloom reads as a cup, not a disc.
function bloom(ctx, kind) {
  const x = 15;
  const y = 30;
  if (kind === 2) {
    poly(ctx, [x, y - 13, x + 5, y - 3, x + 4, y + 3, x - 4, y + 3, x - 5, y - 3], 1);
    line(ctx, [x, y - 10, x, y + 2], 1.6, 0.55);
    return;
  }
  const n = kind === 0 ? 8 : 5;
  const spread = kind === 0 ? 1 : 0.6;
  // Outer petals lie flat, splayed sideways and squashed by the view.
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU + 0.2;
    const len = 9 * spread + 3;
    ellipse(ctx, x + Math.cos(a) * len * 0.75, y + Math.sin(a) * len * 0.42, len * 0.55, 2.8, a, 0.78);
  }
  // Inner petals stand up into a cup.
  for (let k = -2; k <= 2; k++) {
    const a = -Math.PI / 2 + k * 0.38 * spread;
    poly(ctx, [x + k * 2.2, y + 1, x + Math.cos(a) * 11 - 1.6, y + Math.sin(a) * 11,
      x + Math.cos(a) * 12.5, y + Math.sin(a) * 12.5 - 1, x + Math.cos(a) * 11 + 1.6, y + Math.sin(a) * 11], 1);
  }
  ellipse(ctx, x, y - 1, 3.6, 2.2, 0, 0.5);
}

export const WATER = [
  // Long swell streaks: flat lines edge to edge at three heights, so a row
  // of them reads as one unbroken streak of moonlight.
  ...variants('water.line', 3, (ctx, w, h, i) => line(ctx, [-6, ROWS[i], W + 6, ROWS[i]], 4.6, 1)),
  // Wave crests: half a sine each, rising (even) or falling (odd); laid out
  // alternately along a row they join into a continuous swell line, with a
  // faint trough below the crest.
  ...variants('water.wave', 6, (ctx, w, h, i) => {
    const y = ROWS[Math.floor(i / 2)];
    const up = i % 2 === 0 ? -1 : 1;
    curve(ctx, -6, y, 15, y + up * 11, W + 6, y, 4.6, 1);
    curve(ctx, -6, y + 7, 15, y + 7 + up * 7, W + 6, y + 7, 3, 0.35);
  }),
  // Short tapered dashes: where a streak thins out or ends.
  ...variants('water.dash', 6, (ctx, w, h, i) => {
    const rand = rng(1300 + i);
    lens(ctx, 6 + rand() * 18, ROWS[i % 3] + (rand() - 0.5) * 6, 8 + rand() * 7, 5.2, 0.85 + rand() * 0.15);
  }),
  // Fine chop: two or three tiny wavelets.
  ...variants('water.chop', 6, (ctx, w, h, i) => {
    const rand = rng(1400 + i);
    const n = 2 + (i % 2);
    for (let k = 0; k < n; k++) {
      const x = 3 + rand() * 18;
      const y = 8 + (k + rand() * 0.8) * (36 / n);
      curve(ctx, x, y + 2, x + 5, y - 4, x + 10, y + 2, 4.2, 0.75 + rand() * 0.25);
    }
  }),
  // Specks of light riding the wavelets.
  ...variants('water.glint', 4, (ctx, w, h, i) => {
    const rand = rng(1500 + i);
    const n = 1 + (i % 2);
    for (let k = 0; k < n; k++) lens(ctx, 5 + rand() * 20, 8 + rand() * 34, 4.5 + rand() * 3, 4.6, 1);
  }),
  // Moonlight glitter: four-pointed glints drawn wide, as water spreads them.
  // A thick bright lens with a short spike, so it still reads at small sizes.
  ...variants('water.glitter', 3, (ctx, w, h, i) => {
    const s = [1, 0.75, 0.5][i];
    lens(ctx, 15, 25, 15 * s + 4, 9 * s + 2, 0.75);
    lens(ctx, 15, 25, 9 * s + 3, 6 * s + 2, 1);
    poly(ctx, [15, 25 - 16 * s, 16.6, 25, 15, 25 + 16 * s, 13.4, 25], 1);
  }),
  // Reflected stars: a dot, a small cross and a bright star with a halo.
  { name: 'water.star.0', draw: (ctx) => dot(ctx, 15, 25, 2.8) },
  { name: 'water.star.1', draw: (ctx) => { dot(ctx, 15, 25, 5, 0.25); star(ctx, 15, 25, 9, 0.9); } },
  { name: 'water.star.2', draw: (ctx) => {
    dot(ctx, 15, 25, 9, 0.12);
    dot(ctx, 15, 25, 5.5, 0.3);
    star(ctx, 15, 25, 17, 0.9);
  } },
  // The moon as the swell breaks it up: bright horizontal bars, edge to edge
  // so a row of them reads as one sliver of moonlight. Thickness 0-3 sets
  // how much light a cell holds; two heights let a base bar and a layered
  // one stripe each cell. Bars thin to rounded ends when they stop short.
  ...Array.from({ length: 8 }, (_, k) => ({
    name: `water.bar.${k >> 1}.${k & 1}`,
    draw: (ctx) => line(ctx, [-6, (k & 1) ? 35 : 15, W + 6, (k & 1) ? 35 : 15], [4, 7, 10, 14][k >> 1], 1),
  })),
  ...Array.from({ length: 4 }, (_, k) => ({
    name: `water.barend.${k}`,
    draw: (ctx) => {
      const y = (k & 1) ? 35 : 15;
      const width = 7;
      if (k < 2) line(ctx, [-6, y, 18, y], width, 1);
      else line(ctx, [12, y, W + 6, y], width, 1);
    },
  })),
  // The glow around the moon: soft horizontal haze, sparse to dense.
  ...variants('water.haze', 4, (ctx, w, h, i) => {
    const rand = rng(1800 + i);
    for (let k = 0; k < 2 + i; k++) {
      lens(ctx, rand() * W, 6 + rand() * 38, 6 + rand() * 8, 2.8, 0.35 + rand() * 0.35);
    }
  }),
  // The lake bed seen through shallow water: rippled sand, stones, weed.
  ...variants('water.sand', 4, (ctx, w, h, i) => {
    const rand = rng(1900 + i);
    for (let k = 0; k < 3; k++) {
      const y = 9 + k * 15 + rand() * 5;
      const dy = (rand() - 0.5) * 8;
      curve(ctx, -6, y, 15, y + dy, W + 6, y + (rand() - 0.5) * 3, 2.8, 0.45 + rand() * 0.3);
    }
  }),
  ...variants('water.stones', 6, (ctx, w, h, i) => {
    const rand = rng(2000 + i);
    const n = 1 + Math.floor(rand() * 3);
    for (let k = 0; k < n; k++) {
      const rx = 4 + rand() * (n === 1 ? 7 : 4);
      const ry = rx * (0.6 + rand() * 0.25);
      const x = rx + rand() * (W - 2 * rx);
      const y = 6 + ry + rand() * (H - 12 - 2 * ry);
      ellipse(ctx, x + 1, y + 1.5, rx, ry, 0, 0.25);
      ellipse(ctx, x, y, rx * 0.95, ry * 0.9, 0, 0.6);
      ellipse(ctx, x - rx * 0.3, y - ry * 0.35, rx * 0.45, ry * 0.35, 0, 1);
    }
  }),
  ...variants('water.weed', 4, (ctx, w, h, i) => {
    const rand = rng(2100 + i);
    const n = 2 + (i % 3);
    for (let k = 0; k < n; k++) {
      const x = 4 + rand() * 22;
      const top = 4 + rand() * 20;
      const sway = (rand() - 0.5) * 14;
      curve(ctx, x, H + 4, x + sway * 1.6, (H + top) / 2, x + sway * 0.4, top, 2.8, 0.6 + rand() * 0.4);
    }
  }),
  // Caustics: a loose net of light focused by the ripples onto the bed.
  ...variants('water.caustic', 4, (ctx, w, h, i) => {
    const rand = rng(2200 + i);
    const pts = Array.from({ length: 4 }, () => [rand() * W, rand() * H]);
    for (let k = 0; k < pts.length; k++) {
      const [x0, y0] = pts[k];
      const [x1, y1] = pts[(k + 1) % pts.length];
      curve(ctx, x0, y0, (x0 + x1) / 2 + (rand() - 0.5) * 16, (y0 + y1) / 2 + (rand() - 0.5) * 16, x1, y1, 2.6, 0.7);
    }
  }),
  // Lily pads small enough to sit in one cell, and pairs of tiny ones.
  ...variants('water.pad', 6, (ctx, w, h, i) => {
    const rand = rng(2300 + i);
    pad(ctx, 15 + (rand() - 0.5) * 4, 26 + (rand() - 0.5) * 6, 10 + (i % 3) * 1.6, rand() * TAU);
  }),
  ...variants('water.pads', 3, (ctx, w, h, i) => {
    const rand = rng(2400 + i);
    pad(ctx, 9 + rand() * 4, 14 + rand() * 6, 6.5 + rand() * 1.5, rand() * TAU);
    pad(ctx, 19 + rand() * 4, 34 + rand() * 6, 5.5 + rand() * 2, rand() * TAU);
  }),
  // Broad pads span several cells: fills with a vein at each of eight
  // headings out from the leaf's middle, and rims at two reaches.
  ...variants('water.padfill', 8, (ctx, w, h, i) => padFill(ctx, (i / 8) * TAU, 2500 + i)),
  ...Array.from({ length: 16 }, (_, k) => ({
    name: `water.padrim.${k >> 1}.${k & 1}`,
    draw: (ctx) => padRim(ctx, ((k >> 1) / 8) * TAU, (k & 1) ? -4 : 9),
  })),
  // The slit running from a broad pad's middle out to its notch, layered in
  // the colour of the water, at eight headings.
  ...variants('water.slit', 8, (ctx, w, h, i) => {
    const a = (i / 8) * TAU;
    line(ctx, [15 - Math.cos(a) * 40, 25 - Math.sin(a) * 40, 15 + Math.cos(a) * 40, 25 + Math.sin(a) * 40], 5, 1);
  }),
  ...variants('water.bloom', 3, (ctx, w, h, i) => bloom(ctx, i)),
  // Pieces of an expanding ring, by heading out from its middle.
  ...variants('water.ring', 8, (ctx, w, h, i) => {
    const a = (i / 8) * TAU;
    const R = 26;
    arc(ctx, 15 - Math.cos(a) * R, 25 - Math.sin(a) * R, R, R, a - 0.62, a + 0.62, 3.2, 1);
  }),
  // A fish taking a fly: a dimple ringed by a first small ripple.
  { name: 'water.plop', draw: (ctx) => {
    arc(ctx, 15, 27, 10, 5.5, 0, TAU, 3, 0.9);
    dot(ctx, 15, 25, 3.2, 1);
    line(ctx, [15, 20, 15, 12], 2.4, 0.6);
  } },
  // Lacy foam: a band of linked bubbles, and sparser froth.
  ...variants('water.foam', 6, (ctx, w, h, i) => {
    const rand = rng(2600 + i);
    const n = 9 + (i % 3) * 3;
    for (let k = 0; k < n; k++) {
      const x = rand() * W;
      const y = 10 + rand() * 30;
      const r = 1.8 + rand() * 3.2;
      if (rand() < 0.55) arc(ctx, x, y, r, r * 0.8, 0, TAU, 2.4, 0.75 + rand() * 0.25);
      else dot(ctx, x, y, r * 0.7, 0.8 + rand() * 0.2);
    }
    line(ctx, [-6, 34 + rand() * 6, 10, 36, 20, 33 + rand() * 6, W + 6, 35], 2.6, 0.7);
  }),
  ...variants('water.froth', 4, (ctx, w, h, i) => {
    const rand = rng(2700 + i);
    for (let k = 0; k < 3 + (i % 2) * 2; k++) {
      const x = 3 + rand() * 24;
      const y = 6 + rand() * 38;
      if (rand() < 0.5) arc(ctx, x, y, 2.6, 2.2, 0, TAU, 2.2, 0.8);
      else dot(ctx, x, y, 2, 0.9);
    }
  }),
  // Bubbles rising off the bed.
  ...variants('water.bubbles', 4, (ctx, w, h, i) => {
    const rand = rng(2800 + i);
    for (let k = 0; k <= i % 3; k++) {
      const x = 8 + rand() * 14;
      const y = 12 + rand() * 26;
      const r = 2.4 + rand() * 2.2;
      arc(ctx, x, y, r, r, 0, TAU, 2.2, 0.9);
      dot(ctx, x - r * 0.35, y - r * 0.4, 1.2, 1);
    }
  }),
  // A pond skater: a slim body on four dimples in the surface.
  ...variants('water.skater', 2, (ctx, w, h, i) => {
    const a = i ? 0.5 : -0.4;
    const c = Math.cos(a);
    const s = Math.sin(a);
    line(ctx, [15 - c * 5, 25 - s * 5, 15 + c * 5, 25 + s * 5], 2.8, 1);
    for (const [u, v] of [[-10, -7], [10, -7], [-12, 7], [12, 7]]) {
      const x = 15 + c * u - s * v;
      const y = 25 + s * u + c * v;
      arc(ctx, x, y, 2.8, 1.8, 0, TAU, 2, 0.8);
    }
  }),
  // Spray: a bead of water, a falling drop and rising streaks.
  { name: 'water.drop.0', draw: (ctx) => { dot(ctx, 15, 25, 4.4, 1); dot(ctx, 13.6, 23.6, 1.6, 1); } },
  { name: 'water.drop.1', draw: (ctx) => {
    poly(ctx, [15, 15, 18.6, 27, 15, 31, 11.4, 27], 1);
  } },
  { name: 'water.drop.2', draw: (ctx) => line(ctx, [15, 14, 15, 34], 4, 1) },
  { name: 'water.drop.3', draw: (ctx) => { line(ctx, [15, 6, 15, 40], 3.6, 0.8); dot(ctx, 15, 8, 3.2, 1); } },
];

// River current, packed after every other pack so existing glyphs keep
// their numbers. Foam streaks drawn along the flow in four directions on
// screen (along the rows, rising to the right, down the screen, falling to
// the right), light to heavy; riffles of broken chop over fast shallows;
// the curl of an eddy behind a stone; and the arms of the V a stone leaves
// in the water downstream.
export const RIVER = [
  ...[0, 1, 2, 3].flatMap((o) => variants(`water.streak.${o}`, 3, (ctx, w, h, k) => {
    const a = [0, -Math.PI / 4, Math.PI / 2, Math.PI / 4][o];
    const r = 22 + k * 6;
    line(ctx, [15 - Math.cos(a) * r, 25 - Math.sin(a) * r, 15 + Math.cos(a) * r, 25 + Math.sin(a) * r], 2.6 + k * 1.4, 0.6 + k * 0.2);
  })),
  ...variants('water.riffle', 4, (ctx, w, h, i) => {
    const rand = rng(1700 + i);
    const y = 18 + rand() * 14;
    curve(ctx, 2, y + 3, 15, y - 6 - rand() * 4, 28, y + 3, 3.6, 0.9);
  }),
  ...variants('water.eddy', 3, (ctx, w, h, i) => arc(ctx, 15, 25, 9, 12, [0.6, -1.2, 1.9][i], [5.6, 1.2, 4.4][i], 3.6, 0.9)),
  ...variants('water.vee', 4, (ctx, w, h, o) => {
    const a = [0, -Math.PI / 4, Math.PI / 2, Math.PI / 4][o];
    line(ctx, [15 - Math.cos(a) * 26, 25 - Math.sin(a) * 26, 15 + Math.cos(a) * 26, 25 + Math.sin(a) * 26], 3.4, 0.95);
  }),
];
