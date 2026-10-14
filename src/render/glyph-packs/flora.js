// Meadow plants: wild flower heads and spikes, grass seed heads, cattails,
// thistles, fern fronds and dew. Entries: { name, draw(ctx, w, h), mirror?,
// flip? } - see draw.js and glyphs.js.
//
// The meadow is seen from a little above, so a flower face turned to the sky
// is foreshortened into an ellipse, and the moon lights it from the upper
// left: petals on that side are drawn at full strength, the far ones dimmer.
// Heads sit low in their cell, right on top of the stem tip in the cell
// below; two-colour flowers are a petal glyph with an eye glyph layered in.

import { curve, dot, ellipse, line, poly, rng, TAU } from './draw.js';

// Flower faces seen at the meadow's viewing angle.
const SQUASH = 0.7;
// Where a head sits: centred a little below the middle of the cell, so the
// stem tip in the cell below runs straight into it.
const HX = 15;
const HY = 36;

const clamp = (v) => Math.max(0, Math.min(1, v));
// Moonlight from the upper left: a part facing (dx, dy) from a centre.
const lit = (dx, dy) => 0.8 + 0.2 * Math.max(-1, Math.min(1, -dx * 0.6 - dy * 0.8));

// Petals radiating from (cx, cy) on a foreshortened ring, back ones first.
function ring(ctx, cx, cy, n, inner, outer, width, turn, level, squash = SQUASH, jag = 0, seed = 1) {
  const rand = rng(seed);
  const petals = Array.from({ length: n }, (_, k) => {
    const a = turn + k / n * TAU + (rand() - 0.5) * jag;
    return { a, reach: outer * (1 - rand() * jag * 0.35) };
  }).sort((p, q) => Math.sin(p.a) - Math.sin(q.a));
  for (const { a, reach } of petals) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    const x0 = cx + c * inner;
    const y0 = cy + s * inner * squash;
    const x1 = cx + c * reach;
    const y1 = cy + s * reach * squash;
    const length = Math.hypot(x1 - x0, y1 - y0);
    // Petals pointing at the viewer are seen end on: shorter but as wide.
    ellipse(ctx, (x0 + x1) / 2, (y0 + y1) / 2, Math.max(width / 2, length / 2), width / 2,
      Math.atan2(y1 - y0, x1 - x0), level * lit(c, s));
  }
}

// A small round eye with a moonlit fleck on its upper left.
function eye(ctx, x, y, r, level = 0.85) {
  ellipse(ctx, x, y, r, r * 0.8, 0, level);
  dot(ctx, x - r * 0.35, y - r * 0.3, r * 0.45, 1);
}

// A tiny five-petalled floret, as on a forget-me-not or a yarrow umbel.
function floret(ctx, x, y, r, level) {
  for (let k = 0; k < 5; k++) {
    const a = -Math.PI / 2 + k / 5 * TAU;
    ellipse(ctx, x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.5, r * 0.5, r * 0.42, a, level);
  }
}

// A pea flower on a lupin spike: two wings below and a raised banner.
function pea(ctx, x, y, size, level, side) {
  ellipse(ctx, x, y + size * 0.25, size * 0.95, size * 0.62, side * 0.35, level);
}

// A tubular bell hanging from a stem point, mouth down and out.
function bell(ctx, x, y, size, side, level) {
  const a = Math.PI / 2 - side * 0.5;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const length = size * 2.1;
  const mx = x + c * length * 0.5;
  const my = y + s * length * 0.5;
  ellipse(ctx, mx, my, length / 2, size * 0.75, a, level);
  // A flared lip at the mouth.
  ellipse(ctx, x + c * length * 0.95, y + s * length * 0.95, size * 0.55, size * 0.95, a, level * 0.9);
}

// A pinnate frond segment crossing the cell along `angle` from vertical
// (positive leans right). The rib runs through the centre edge to edge so
// segments join; leaflets point toward the tip, the lit side brighter.
function frond(ctx, angle, tip) {
  const ux = Math.sin(angle);
  const uy = -Math.cos(angle);
  // Long enough to reach the cell's edges whichever way it points.
  const half = Math.min(26 / Math.max(0.01, Math.abs(uy)), 16 / Math.max(0.01, Math.abs(ux)));
  const from = -half;
  const to = tip ? half * 0.35 : half;
  line(ctx, [HX + ux * from, 25 + uy * from, HX + ux * to, 25 + uy * to], 2.2, 0.75);
  const steps = 5;
  for (let k = 0; k < steps; k++) {
    const u = from + (to - from) * (k + 0.5) / steps;
    const shrink = tip ? 1 - (k / steps) * 0.7 : 1;
    for (const side of [-1, 1]) {
      const px = HX + ux * u;
      const py = 25 + uy * u;
      // Leaflets sweep forward at about fifty degrees from the rib.
      const a = Math.atan2(uy, ux) + side * 0.95;
      const length = 9 * shrink;
      const nx = Math.cos(a);
      const ny = Math.sin(a);
      ellipse(ctx, px + nx * length * 0.5 + side * ux * 0.6 * (k % 2), py + ny * length * 0.5,
        length / 2, 2.2 * shrink + 0.6, a, clamp(0.72 * lit(nx, ny) + (side < 0 === ux > -0.2 ? 0.1 : 0)));
    }
  }
}

export const FRONDS = [-1.25, -0.85, -0.42, 0, 0.42, 0.85, 1.25];

// Everything carried on a stalk, drawn once per place the stalk's tip can
// end across its cell (see PLACES).
const ON_STALKS = [
  // Ox-eye daisy: a ring of slim white rays; the yellow eye is layered in.
  { name: 'flora.daisy.0', scale: 1.12, flip: true, draw: (ctx) => ring(ctx, HX, HY, 13, 3.2, 12, 3.6, 0.2, 1, SQUASH, 0.25, 11) },
  { name: 'flora.daisy.1', scale: 1.12, flip: true, draw: (ctx) => ring(ctx, HX, HY + 1, 12, 3, 11, 3.4, 0.5, 1, 0.5, 0.3, 12) },
  { name: 'flora.daisy.eye', scale: 1.12, flip: true, draw: (ctx) => eye(ctx, HX, HY, 4.4) },
  { name: 'flora.daisy.eye.1', scale: 1.12, flip: true, draw: (ctx) => eye(ctx, HX, HY + 1, 3.8) },
  // Buttercup: a small glossy bowl of five rounded petals; the gloss and
  // stamens are layered on in a paler yellow.
  { name: 'flora.buttercup', scale: 1.15, flip: true, draw: (ctx) => {
    ring(ctx, HX, HY, 5, 0.5, 8.5, 7.6, -Math.PI / 2 + 0.3, 1, 0.66, 0.15, 21);
  } },
  { name: 'flora.buttercup.gloss', scale: 1.15, flip: true, draw: (ctx) => {
    curve(ctx, HX - 7, HY - 1, HX - 6, HY - 5, HX - 2, HY - 5.5, 1.8, 1);
    dot(ctx, HX, HY + 0.5, 2.2, 0.9);
  } },
  // Field poppy: four broad crinkled petals in a shallow bowl, the far
  // pair in shadow; a dark eye ringed with stamens is layered on.
  { name: 'flora.poppy', scale: 1.1, flip: true, draw: (ctx) => {
    ellipse(ctx, HX - 5, HY - 4, 6.4, 5.4, -0.3, 0.68);
    ellipse(ctx, HX + 5, HY - 4, 6.4, 5.4, 0.3, 0.6);
    ellipse(ctx, HX - 5.4, HY + 1.5, 6.8, 6, 0.25, 1);
    ellipse(ctx, HX + 5.4, HY + 1.5, 6.8, 6, -0.25, 0.88);
    // Crinkles catch the light as faint darker veins.
    line(ctx, [HX - 9, HY + 3, HX - 4, HY + 0.5], 1.2, 0.7);
    line(ctx, [HX + 9, HY + 3, HX + 4, HY + 0.5], 1.2, 0.62);
  } },
  { name: 'flora.poppy.eye', scale: 1.1, flip: true, draw: (ctx) => {
    ellipse(ctx, HX, HY - 1, 3.4, 2.6, 0, 1);
    for (let k = 0; k < 9; k++) {
      const a = k / 9 * TAU;
      dot(ctx, HX + Math.cos(a) * 5.4, HY - 1 + Math.sin(a) * 3.3, 1.1, 0.9);
    }
  } },
  // Cornflower: a ragged ring of frilled funnel florets around a dark eye.
  { name: 'flora.cornflower', scale: 1.2, flip: true, draw: (ctx) => {
    const rand = rng(31);
    for (let k = 0; k < 9; k++) {
      const a = k / 9 * TAU + 0.2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const r0 = 3;
      const r1 = 9.5 + rand() * 1.6;
      const level = lit(c, s);
      // A funnel widening outward with a toothed mouth.
      const px = -s * 2.8;
      const py = c * 2.8 * SQUASH;
      poly(ctx, [HX + c * r0, HY + s * r0 * SQUASH,
        HX + c * r1 + px, HY + s * r1 * SQUASH + py,
        HX + c * (r1 + 1.6), HY + s * (r1 + 1.6) * SQUASH,
        HX + c * r1 - px, HY + s * r1 * SQUASH - py], level);
    }
  } },
  { name: 'flora.cornflower.eye', scale: 1.2, flip: true, draw: (ctx) => {
    ellipse(ctx, HX, HY, 2.8, 2.2, 0, 1);
    for (let k = 0; k < 6; k++) {
      const a = k / 6 * TAU;
      dot(ctx, HX + Math.cos(a) * 3.8, HY + Math.sin(a) * 2.4, 0.8, 0.7);
    }
  } },
  // Red clover: a round head of tiny tubes, paler tips catching the moon.
  { name: 'flora.clover', scale: 1.4, flip: true, draw: (ctx) => {
    const rand = rng(41);
    for (let k = 0; k < 30; k++) {
      const a = rand() * TAU;
      const d = Math.sqrt(rand());
      const x = HX + Math.cos(a) * 6.6 * d;
      const y = HY - 1 + Math.sin(a) * 6.2 * d;
      ellipse(ctx, x, y, 1.5, 2.6, a + Math.PI / 2, 0.7 + 0.3 * lit(Math.cos(a), Math.sin(a)));
    }
  } },
  { name: 'flora.clover.tips', scale: 1.4, flip: true, draw: (ctx) => {
    const rand = rng(42);
    for (let k = 0; k < 9; k++) {
      const a = Math.PI + rand() * Math.PI;
      const d = 0.4 + rand() * 0.6;
      dot(ctx, HX - 1.5 + Math.cos(a) * 5.4 * d, HY - 2 + Math.sin(a) * 5 * d, 1.1 + rand() * 0.5, 0.8 + rand() * 0.2);
    }
  } },
  // Dandelion in flower: a dense, ragged head of strap petals.
  { name: 'flora.dandelion', scale: 1.22, flip: true, draw: (ctx) => {
    ring(ctx, HX, HY, 18, 2, 10.5, 2.8, 0, 0.9, SQUASH, 0.5, 51);
    ring(ctx, HX, HY - 0.5, 12, 0.5, 7, 2.8, 0.3, 1, SQUASH, 0.5, 52);
  } },
  { name: 'flora.dandelion.eye', scale: 1.22, flip: true, draw: (ctx) => {
    const rand = rng(53);
    for (let k = 0; k < 7; k++) dot(ctx, HX + (rand() - 0.5) * 6, HY - 0.5 + (rand() - 0.5) * 3.4, 1.2, 0.85);
  } },
  // Dandelion clock: a sphere of fine seeds, each with a pale parachute,
  // and a dark seed core layered in its centre.
  { name: 'flora.clock', scale: 1.3, flip: true, draw: (ctx) => {
    const cy = HY - 4;
    const n = 26;
    for (let k = 0; k < n; k++) {
      const a = k / n * TAU + (k % 2) * 0.12;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const r = 10 - (k % 3) * 0.9;
      line(ctx, [HX + c * 2, cy + s * 2, HX + c * r, cy + s * r * 0.92], 1.1, 0.42);
      dot(ctx, HX + c * r, cy + s * r * 0.92, 1.6, clamp(0.72 * lit(c, s) + 0.1));
    }
  } },
  { name: 'flora.clock.core', scale: 1.3, flip: true, draw: (ctx) => {
    ellipse(ctx, HX, HY - 4, 2.6, 2.2, 0, 1);
    line(ctx, [HX, HY - 2, HX, 54], 1.6, 0.55);
  } },
  // Yarrow: a flat-topped umbel of tiny florets on short stalklets.
  { name: 'flora.yarrow', scale: 1.12, flip: true, draw: (ctx) => {
    const rand = rng(61);
    for (let k = 0; k < 7; k++) line(ctx, [HX, HY + 8, HX - 10 + k * 3.3, HY - 1 + Math.abs(k - 3) * 0.8], 1, 0.4);
    for (let k = 0; k < 15; k++) {
      const u = rand();
      const x = HX - 11 + u * 22;
      const y = HY - 3 + Math.abs(u - 0.5) * 5 + (rand() - 0.5) * 3.2;
      floret(ctx, x, y, 2.6, 0.7 + 0.3 * lit(u - 0.5, -0.6));
    }
  } },
  // Forget-me-nots: a curled spray of tiny blue florets, yellow eyes apart.
  ...[0, 1].flatMap((i) => {
    const spots = i ? [[8, 38], [14, 33], [20, 35], [24, 41], [11, 44]] :
      [[9, 36], [15, 31], [21, 34], [17, 41], [6, 43]];
    return [
      { name: `flora.myosotis.${i}`, scale: 1.1, flip: true,
        draw: (ctx) => spots.forEach(([x, y], k) => floret(ctx, x, y, k === 4 ? 3 : 4.2, k === 4 ? 0.7 : 1)) },
      { name: `flora.myosotis.eye.${i}`, scale: 1.1, flip: true,
        draw: (ctx) => spots.slice(0, 4).forEach(([x, y]) => dot(ctx, x, y, 1.2, 1)) },
    ];
  }),
  // Bluebells: an arching stem bowed to one side under hanging bells.
  ...[1, -1].map((side, i) => ({ name: `flora.bluebell.${i}`, flip: true, draw: (ctx) => {
    const x = (v) => HX + side * v;
    curve(ctx, x(-1), 54, x(-2), 22, x(8), 20, 1.8, 0.5);
    bell(ctx, x(1), 26, 3.4, side * 0.6, 1);
    bell(ctx, x(5), 22.5, 3.2, side * 0.9, 0.92);
    bell(ctx, x(8.5), 21.5, 2.8, side * 1.3, 0.8);
  } })),
  // Lupin: a cone of pea flowers in whorls up the stalk. The spike runs
  // over the stalk's upper cells; its tip tapers in the cell above. The
  // pale banner petals are a second layer.
  { name: 'flora.lupin.tip', flip: true, draw: (ctx) => {
    for (let k = 0; k < 6; k++) {
      const y = 48 - k * 6.6;
      const spread = 9 - k * 1.3;
      const size = 4.2 - k * 0.4;
      pea(ctx, HX - spread * 0.6, y, size, lit(-1, -0.2) * 0.85, -1);
      pea(ctx, HX + spread * 0.6, y + 2.6, size, lit(1, 0) * 0.75, 1);
    }
    dot(ctx, HX, 9, 1.6, 0.8);
  } },
  ...[0, 1].map((i) => ({ name: `flora.lupin.mid.${i}`, flip: true, draw: (ctx) => {
    const rand = rng(120 + i);
    for (let k = 0; k < 4; k++) {
      const y = 46 - k * 12.5 + i * 6;
      for (const side of [-1, 1]) {
        pea(ctx, HX + side * (7.4 + rand() * 1.4), y + (side > 0) * 4 + (rand() - 0.5) * 2.4,
          4.4 + rand() * 0.6, side < 0 ? 1 : 0.8, side);
      }
      pea(ctx, HX + (rand() - 0.5) * 2, y + 2.2, 3.8, 0.62, 0);
      // The pale banner of each floret, in the spike's own colour.
      dot(ctx, HX - 8.4, y - 2, 2, 1);
    }
  } })),
  { name: 'flora.lupin.banner.tip', flip: true, draw: (ctx) => {
    for (let k = 0; k < 5; k++) {
      const y = 46 - k * 6.6;
      const spread = 9 - k * 1.3;
      dot(ctx, HX - spread * 0.6 - 0.8, y - 1.6, 1.8 - k * 0.15, 1);
    }
  } },
  // Foxglove: tubular bells hanging from one side of a tall spike, their
  // speckled throats layered in a darker shade.
  { name: 'flora.foxglove.tip', flip: true, draw: (ctx) => {
    line(ctx, [HX, 54, HX - 0.5, 6], 1.8, 0.55);
    bell(ctx, HX + 1, 29, 5.2, 1, 1);
    bell(ctx, HX - 0.5, 16, 3.6, 0.6, 0.85);
    ellipse(ctx, HX - 0.5, 9, 1.8, 3, 0, 0.8);
  } },
  // Over the stalk's own cells the spike has a single layer, so the
  // blade beneath still shows as its stem: the throats are cut out of the
  // bells and let that darker stem and ground show through.
  ...[0, 1].map((i) => ({ name: `flora.foxglove.mid.${i}`, flip: true, draw: (ctx) => {
    const bells = [[HX + 1, -2 + i * 8, 6.4, 1, 0.92], [HX + 1, 22 + i * 8, 6.8, 1.1, 1]];
    if (!i) bells.push([HX - 1, 36, 5, -0.8, 0.72]);
    for (const [x, y, size, side, level] of bells) {
      bell(ctx, x, y, size, side, level);
      const a = Math.PI / 2 - side * 0.5;
      const c = Math.cos(a);
      const s = Math.sin(a);
      ellipse(ctx, x + c * size * 1.95, y + s * size * 1.95, size * 0.3, size * 0.55, a, 0);
      dot(ctx, x + c * size * 1.3, y + s * size * 1.3, 0.8, 0.35);
    }
  } })),
  { name: 'flora.foxglove.throat', flip: true, draw: (ctx) => {
    const a = Math.PI / 2 - 0.5;
    for (let k = 0; k < 3; k++) {
      const d = 5.2 * (1.25 + k * 0.28);
      dot(ctx, HX + 1 + Math.cos(a) * d, 29 + Math.sin(a) * d, 1.1, 1);
    }
  } },
  // Thistle: a spiny green bulb of crossed bracts with a purple brush
  // bursting from its top.
  { name: 'flora.thistle.bulb', scale: 1.15, flip: true, draw: (ctx) => {
    const cy = HY + 5;
    line(ctx, [HX, cy + 6, HX, 54], 2.2, 0.7);
    ellipse(ctx, HX, cy, 6, 6.4, 0, 0.62);
    ellipse(ctx, HX - 1.8, cy - 1.6, 3, 3.6, 0, 0.9);
    // Bract scales as a lattice of darker seams.
    for (const d of [-3, 1.5]) {
      line(ctx, [HX - 5 + d, cy - 4, HX + 1 + d, cy + 5], 0.9, 0.35);
      line(ctx, [HX + 5 + d, cy - 4, HX - 1 + d, cy + 5], 0.9, 0.35);
    }
    // Spines curling out from the sides.
    for (const [x0, y0, x1, y1] of [[-5, -2, -10, -6], [-6, 2, -11, 1], [-4, 5, -8, 8], [5, -2, 10, -6],
      [6, 2, 11, 1], [4, 5, 8, 8]]) {
      line(ctx, [HX + x0, cy + y0, HX + x1, cy + y1], 1.1, 0.85);
    }
  } },
  { name: 'flora.thistle.brush', scale: 1.15, flip: true, draw: (ctx) => {
    const cy = HY - 1;
    for (let k = 0; k < 8; k++) {
      const u = k / 7 - 0.5;
      const x1 = HX + u * 18;
      const y1 = cy - 13 + Math.abs(u) * 9;
      line(ctx, [HX + u * 5, cy, x1, y1], 1.8, clamp(0.85 + (u < 0 ? 0.15 : -0.1)));
      dot(ctx, x1, y1, 1.4, 1);
    }
    ellipse(ctx, HX, cy, 5.2, 2, 0, 0.9);
  } },
  // Cattail: a velvet brown head on a reed, a thin spike above, lit down
  // its left side.
  { name: 'flora.cattail', flip: true, draw: (ctx) => {
    line(ctx, [HX, 1, HX, 13], 1.6, 0.75);
    ellipse(ctx, HX, 27, 6, 14, 0, 0.72);
    ellipse(ctx, HX - 1.8, 25.5, 3, 11.5, 0, 1);
    ellipse(ctx, HX + 3.4, 29, 1.4, 8, 0, 0.5);
    line(ctx, [HX, 39, HX, 54], 2.4, 0.7);
  } },
  // Grass seed heads, drawn above a stalk's tip: a nodding oat panicle,
  // a timothy spike, a feathery plume and a bearded rye ear.
  ...[1, -1].map((side, i) => ({ name: `flora.seed.oat.${i}`, flip: true, draw: (ctx) => {
    const x = (v) => HX + side * v;
    curve(ctx, x(0), 54, x(1), 20, x(-3), 8, 1.6, 0.8);
    for (const [px, py, len] of [[0.4, 40, 5], [0.6, 30, 6.5], [0.2, 21, 6], [-1.5, 13, 5]]) {
      for (const dir of [-1, 1]) {
        const ex = x(px + dir * 5);
        const ey = py + len;
        line(ctx, [x(px), py, ex, ey - 2], 1, 0.6);
        ellipse(ctx, ex, ey, 1.6, 3.2, dir * side * 0.25, dir < 0 ? 1 : 0.8);
      }
    }
  } })),
  { name: 'flora.seed.timothy', flip: true, draw: (ctx) => {
    line(ctx, [HX, 54, HX, 30], 1.8, 0.8);
    ellipse(ctx, HX, 18, 3.6, 14, 0, 0.75);
    const rand = rng(71);
    for (let k = 0; k < 16; k++) {
      const y = 6 + rand() * 25;
      const side = k % 2 ? 1 : -1;
      dot(ctx, HX + side * (3 + rand() * 1.4), y, 1.2, side < 0 ? 1 : 0.6);
    }
  } },
  ...[1, -1].map((side, i) => ({ name: `flora.seed.plume.${i}`, flip: true, draw: (ctx) => {
    const rand = rng(81 + i);
    curve(ctx, HX, 54, HX + side * 1, 30, HX + side * 6, 8, 1.4, 0.7);
    for (let k = 0; k < 26; k++) {
      const u = rand();
      const bx = HX + side * (1 + u * u * 5);
      const by = 36 - u * 30;
      const spread = 2.5 + u * 3.5 * (1 - u) * 2;
      dot(ctx, bx + (rand() - 0.5) * spread * 2, by + (rand() - 0.5) * 4, 1.2 + rand() * 0.6, 0.45 + rand() * 0.4);
    }
  } })),
  { name: 'flora.seed.rye', flip: true, draw: (ctx) => {
    line(ctx, [HX, 54, HX, 12], 1.4, 0.7);
    for (let k = 0; k < 5; k++) {
      const y = 38 - k * 6;
      for (const side of [-1, 1]) {
        ellipse(ctx, HX + side * 2.4, y, 1.8, 3.4, side * 0.4, side < 0 ? 1 : 0.75);
        line(ctx, [HX + side * 3, y - 3, HX + side * (4.5 + k * 0.4), y - 14], 0.9, 0.55);
      }
    }
  } },
];

const LOOSE = [
  // Dew on a blade: a pinpoint glint, at a few places along the cell.
  ...[[15, 25], [13, 18], [17, 32], [14, 28]].map(([x, y], i) => ({ name: `flora.dew.${i}`, draw: (ctx) => {
    poly(ctx, [x, y - 6, x + 1, y, x, y + 6, x - 1, y]);
    poly(ctx, [x - 4.5, y, x, y + 0.9, x + 4.5, y, x, y - 0.9]);
    dot(ctx, x, y, 1.7);
  } })),
  // Fern frond segments at seven headings, with tapering ends.
  ...FRONDS.flatMap((angle, i) => [
    { name: `flora.frond.${i}`, flip: true, draw: (ctx) => frond(ctx, angle, false) },
    { name: `flora.frond.tip.${i}`, flip: true, draw: (ctx) => frond(ctx, angle, true) },
  ]),
  // Petals knocked onto a trampled mat.
  { name: 'flora.fallen', draw: (ctx) => {
    const rand = rng(91);
    for (let k = 0; k < 4; k++) {
      ellipse(ctx, 6 + rand() * 18, 18 + rand() * 22, 2.4, 1.6, rand() * TAU, 0.6 + rand() * 0.4);
    }
  } },
];

// A stalk's tip may end left of centre, centred or right of centre in its
// cell; whatever it carries is shifted to match, so heads sit on stems.
export const PLACES = [-4, 0, 4];
// A head may be drawn larger about its centre to fill the cell.
const placed = (entry) => PLACES.map((dx, k) => ({ ...entry, name: `${entry.name}@${k}`,
  draw: (ctx, w, h) => {
    const scale = entry.scale ?? 1;
    ctx.translate(dx + HX * (1 - scale), HY * (1 - scale) + (entry.drop ?? 0));
    ctx.scale(scale, scale);
    entry.draw(ctx, w, h);
  } }));

// Thin flower stalks, edge to edge like the grass strokes in glyphs.js
// (bottom and top: 0..5 from the left edge), so a flower's own stem reads
// apart from the broad blades around it. Upside down, bottom and top swap.
export const STEM_STEPS = 6;
const stemX = (i) => (i + 0.5) / STEM_STEPS * 30;
const STEMS = [];
for (let b = 0; b < STEM_STEPS; b++) {
  for (let t = 0; t < STEM_STEPS; t++) {
    STEMS.push({ name: `flora.stem.${b}.${t}`, mirror: `flora.stem.${t}.${b}`, draw: (ctx) => {
      const x0 = stemX(b);
      const x1 = stemX(t);
      const ext = (x1 - x0) / 50 * 6;
      line(ctx, [x0 - ext, 56, x1 + ext, -6], 4.2, 1);
    } });
  }
}

// Every head also comes smaller, as a bud or a young flower, sitting a
// little lower on its stem.
const withBuds = (entry) => entry.scale ?
  [entry, { ...entry, name: `${entry.name}.s`, scale: entry.scale * 0.7, drop: 3 }] : [entry];

export const FLORA = [...ON_STALKS.flatMap(withBuds).flatMap(placed), ...LOOSE, ...STEMS];
