// Tree canopies, bark, branches and bushes.
// Entries: { name, draw(ctx, w, h), mirror?, flip? } - see draw.js and glyphs.js.
//
// Canopy glyphs are leaf clusters. Each family is drawn at eight headings
// (0 = right, 2 = down, 4 = left, 6 = up: the direction the leaves point,
// usually the crown's outward surface) and up to three densities (sparse,
// open, dense). Every cluster has a `.hi` twin holding only the upper-left
// rims of the very same leaves: layered over the cluster in a pale colour it
// reads as moonlight catching the leaf edges. A reflection maps a heading to
// its vertical mirror, so no flipped copies are needed.

import { dot, ellipse, grey, line, petals, rng, TAU } from './draw.js';

const W = 30;
const H = 50;
const HEADINGS = 8;
const mirrorHeading = (h) => (HEADINGS - h) % HEADINGS;
// The moon is up and to the left: rims are what remains of a leaf after the
// same leaf, nudged down and to the right, is cut away from it.
const RIM_X = 2.8;
const RIM_Y = 3.6;

// --- Leaf outlines -----------------------------------------------------------

// Traces one leaf (no fill) from its base at (x, y) along angle `a`.
function leafPath(ctx, x, y, len, wid, a, shape) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const at = (u, v) => [x + c * u - s * v, y + s * u + c * v];
  ctx.beginPath();
  if (shape === 'needle') {
    const [x0, y0] = at(0, -wid / 2);
    const [x1, y1] = at(len, 0);
    const [x2, y2] = at(0, wid / 2);
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.closePath();
    return;
  }
  if (shape === 'oak') {
    // Wavy lobes down both sides of a broad leaf.
    const pts = [];
    const n = 4;
    for (let k = 0; k <= n; k++) {
      const u = len * (0.08 + 0.86 * k / n);
      const bulge = Math.sin(Math.PI * (u / len)) ** 0.7;
      const lobe = k % 2 ? 1 : 0.72;
      pts.push(at(u, wid / 2 * bulge * lobe));
    }
    const tip = at(len, 0);
    const [sx, sy] = at(0, 0);
    ctx.moveTo(sx, sy);
    for (const [px, py] of pts) ctx.lineTo(px, py);
    ctx.lineTo(tip[0], tip[1]);
    for (let k = n; k >= 0; k--) {
      const u = len * (0.08 + 0.86 * k / n);
      const bulge = Math.sin(Math.PI * (u / len)) ** 0.7;
      const lobe = k % 2 ? 0.72 : 1;
      const [px, py] = at(u, -wid / 2 * bulge * lobe);
      ctx.lineTo(px, py);
    }
    ctx.closePath();
    return;
  }
  // Almond, ovate (widest near the base) and lance (long, narrow) leaves.
  const widest = shape === 'ovate' ? 0.36 : 0.5;
  const [mx, my] = at(len * widest, 0);
  const [tx, ty] = at(len, 0);
  const [b1x, b1y] = at(len * widest * 0.15, wid * 0.72);
  const [b2x, b2y] = at(len * widest * 0.15, -wid * 0.72);
  ctx.moveTo(x, y);
  ctx.bezierCurveTo(b1x, b1y, mx - s * wid * 0.78 + c * len * 0.18, my + c * wid * 0.78 + s * len * 0.18, tx, ty);
  ctx.bezierCurveTo(mx + s * wid * 0.78 + c * len * 0.18, my - c * wid * 0.78 + s * len * 0.18, b2x, b2y, x, y);
  ctx.closePath();
}

// Draws a list of leaves. `hi` keeps only each leaf's moonlit rim; a base
// draw gives every leaf a darker midrib and a thin dark seam so that
// overlapping leaves stay separate shapes instead of merging into a blob.
function drawLeaves(ctx, leaves, hi) {
  for (const l of leaves) {
    if (hi) {
      if (l.level < 0.8) continue;
      ctx.save();
      leafPath(ctx, l.x, l.y, l.len, l.wid, l.a, l.shape);
      ctx.clip();
      ctx.fillStyle = grey(1);
      ctx.fill();
      leafPath(ctx, l.x + RIM_X, l.y + RIM_Y, l.len, l.wid, l.a, l.shape);
      ctx.fillStyle = grey(0);
      ctx.fill();
      ctx.restore();
      continue;
    }
    leafPath(ctx, l.x, l.y, l.len, l.wid, l.a, l.shape);
    ctx.fillStyle = grey(l.level);
    ctx.fill();
    ctx.strokeStyle = grey(0);
    ctx.lineWidth = 1.3;
    ctx.stroke();
    if (l.len >= 10 && l.shape !== 'needle') {
      const c = Math.cos(l.a);
      const s = Math.sin(l.a);
      line(ctx, [l.x, l.y, l.x + c * l.len * 0.8, l.y + s * l.len * 0.8], 1.1, l.level * 0.45);
    }
  }
}

// Spreads `n` points over the cell, each as far as it can get from the
// others (best of a few random candidates) so clusters cover it evenly.
function spread(rand, n, margin = 4) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    let best = null;
    let bestD = -1;
    for (let k = 0; k < 8; k++) {
      const x = margin + rand() * (W - margin * 2);
      const y = margin + rand() * (H - margin * 2);
      let d = Infinity;
      for (const p of pts) d = Math.min(d, (p[0] - x) ** 2 + ((p[1] - y) * 0.75) ** 2);
      if (d > bestD) { bestD = d; best = [x, y]; }
    }
    pts.push(best);
  }
  return pts;
}

// A cluster of leaves flowing toward `heading`. Sparse clusters hang off a
// visible twig; denser ones fill the cell, the back leaves dimmer than the
// front ones so a single glyph already has depth.
function cluster(spec, heading, density, variant) {
  const rand = rng(spec.seed + heading * 31 + density * 7 + variant * 131);
  const a0 = heading / HEADINGS * TAU;
  const leaves = [];
  const twigs = [];
  const n = spec.counts[density];
  const size = () => 0.85 + rand() * 0.3;
  if (density === 0) {
    // A twig crossing the cell with leaves alternating off it.
    const c = Math.cos(a0);
    const s = Math.sin(a0);
    const x0 = 15 - c * 17 + (rand() - 0.5) * 6;
    const y0 = 25 - s * 22 + (rand() - 0.5) * 8;
    twigs.push([x0, y0, x0 + c * 30, y0 + s * 36]);
    for (let i = 0; i < n; i++) {
      const t = 0.3 + i / Math.max(1, n) * 0.6;
      const side = i % 2 ? 1 : -1;
      const a = a0 + side * (0.55 + rand() * 0.35);
      const k = size();
      leaves.push({ x: x0 + c * 30 * t, y: y0 + s * 36 * t, len: spec.len * k, wid: spec.wid * k,
        a, shape: spec.shape, level: 0.8 + rand() * 0.2 });
    }
  } else {
    const pts = spread(rand, n);
    // Back to front: farther leaves first, a little darker.
    pts.forEach(([x, y], i) => {
      const a = a0 + (rand() - 0.5) * spec.jitter;
      const k = size();
      const len = spec.len * k;
      leaves.push({ x: x - Math.cos(a) * len * 0.5, y: y - Math.sin(a) * len * 0.5, len, wid: spec.wid * k,
        a, shape: spec.shape, level: i < n * 0.4 ? 0.62 + rand() * 0.12 : 0.82 + rand() * 0.18 });
    });
  }
  return { leaves, twigs };
}

function clusterFamily(prefix, spec, densities, variants) {
  const out = [];
  for (let h = 0; h < HEADINGS; h++) {
    for (const d of densities) {
      for (let v = 0; v < variants; v++) {
        const name = `${prefix}.${h}.${d}.${v}`;
        const mirror = `${prefix}.${mirrorHeading(h)}.${d}.${v}`;
        out.push({ name, mirror, draw: (ctx) => {
          const { leaves, twigs } = cluster(spec, h, d, v);
          for (const t of twigs) line(ctx, t, 2.4, 0.55);
          drawLeaves(ctx, leaves, false);
        } });
        out.push({ name: `${name}.hi`, mirror: `${mirror}.hi`, draw: (ctx) => {
          drawLeaves(ctx, cluster(spec, h, d, v).leaves, true);
        } });
      }
    }
  }
  return out;
}

// --- Special foliage ---------------------------------------------------------

// Pine: tufts of long needles fanning out from a twig end.
function tufts(heading, density, hi) {
  return (ctx) => {
    const rand = rng(5100 + heading * 13 + density * 3);
    const a0 = heading / HEADINGS * TAU;
    const n = [1, 2, 3][density];
    const pts = spread(rand, n, 9);
    for (const [x, y] of pts) {
      const bx = x - Math.cos(a0) * 9;
      const by = y - Math.sin(a0) * 9;
      const count = 7 + Math.floor(rand() * 3);
      for (let k = 0; k < count; k++) {
        const a = a0 + (k / (count - 1) - 0.5) * 1.5 + (rand() - 0.5) * 0.15;
        const len = 15 + rand() * 7;
        const ex = bx + Math.cos(a) * len;
        const ey = by + Math.sin(a) * len;
        if (hi) {
          // Only the upper-left needles of a tuft catch the moon.
          if (Math.cos(a) * 0.6 + Math.sin(a) * 0.8 > -0.1) continue;
          line(ctx, [bx + (ex - bx) * 0.35, by + (ey - by) * 0.35, ex, ey], 2.2, 1);
        } else {
          line(ctx, [bx, by, ex, ey], 2.3, 0.7 + rand() * 0.3);
        }
      }
      if (!hi) dot(ctx, bx, by, 2.4, 0.5);
    }
  };
}

// Spruce: drooping twigs densely set with short needles (a bottlebrush).
function brush(heading, density, hi) {
  return (ctx) => {
    const rand = rng(5300 + heading * 17 + density * 5);
    const a0 = heading / HEADINGS * TAU;
    const n = [1, 2][density];
    for (let i = 0; i < n; i++) {
      const c = Math.cos(a0);
      const s = Math.sin(a0);
      const ox = 15 + (n === 2 ? (i - 0.5) * 14 * -s : 0) + (rand() - 0.5) * 4;
      const oy = 25 + (n === 2 ? (i - 0.5) * 22 * c : 0) + (rand() - 0.5) * 6;
      const x0 = ox - c * 22;
      const y0 = oy - s * 30;
      const x1 = ox + c * 22;
      const y1 = oy + s * 30;
      if (!hi) line(ctx, [x0, y0, x1, y1], 2.2, 0.5);
      const steps = 9;
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const px = x0 + (x1 - x0) * t;
        const py = y0 + (y1 - y0) * t;
        for (const side of [-1, 1]) {
          const a = a0 + side * 0.9 + 0.35; // needles sweep forward and droop
          const len = 7 + rand() * 3;
          const ex = px + Math.cos(a) * len;
          const ey = py + Math.sin(a) * len;
          const up = Math.sin(a) < 0 || side < 0;
          if (hi && !up) continue;
          line(ctx, [px, py, ex, ey], 2.1, hi ? 1 : 0.65 + rand() * 0.35);
        }
      }
    }
  };
}

// Acacia: flat feathery sprays of tiny paired leaflets.
function spray(heading, density, hi) {
  return (ctx) => {
    const rand = rng(5500 + heading * 19 + density * 3);
    const a0 = heading / HEADINGS * TAU;
    const n = [1, 2][density];
    for (let i = 0; i < n; i++) {
      const c = Math.cos(a0);
      const s = Math.sin(a0);
      const ox = 15 + (rand() - 0.5) * 8;
      const oy = (n === 2 ? 14 + i * 22 : 25) + (rand() - 0.5) * 6;
      const x0 = ox - c * 20;
      const y0 = oy - s * 28;
      if (!hi) line(ctx, [x0, y0, ox + c * 20, oy + s * 28], 2, 0.5);
      for (let k = 1; k <= 8; k++) {
        const t = k / 9;
        const px = x0 + c * 40 * t;
        const py = y0 + s * 56 * t;
        for (const side of [-1, 1]) {
          const lx = px - s * side * 4;
          const ly = py + c * side * 4;
          if (hi && side > 0) continue;
          ellipse(ctx, lx, ly, 3.2, 2.2, a0 + side * 0.9, hi ? 1 : 0.7 + rand() * 0.3);
        }
      }
    }
  };
}

// Jungle: a big frond, a curved midrib with the blade cut into leaflets.
function frond(heading, variant, hi) {
  return (ctx) => {
    const rand = rng(5700 + heading * 23 + variant * 7);
    const a0 = heading / HEADINGS * TAU;
    const c = Math.cos(a0);
    const s = Math.sin(a0);
    const bend = (variant ? -1 : 1) * 7;
    const x0 = 15 - c * 18 - s * 3;
    const y0 = 25 - s * 26 + c * 3;
    const x1 = 15 + c * 18;
    const y1 = 25 + s * 26;
    const mx = (x0 + x1) / 2 - s * bend + 0 * rand();
    const my = (y0 + y1) / 2 + c * bend + 6;
    const at = (t) => [(1 - t) ** 2 * x0 + 2 * (1 - t) * t * mx + t * t * x1,
      (1 - t) ** 2 * y0 + 2 * (1 - t) * t * my + t * t * y1];
    for (let k = 1; k <= 10; k++) {
      const t = k / 11;
      const [px, py] = at(t);
      const [qx, qy] = at(t + 0.02);
      const ta = Math.atan2(qy - py, qx - px);
      const width = 13 * Math.sin(Math.PI * Math.min(1, t * 1.15));
      for (const side of [-1, 1]) {
        if (hi && side > 0) continue;
        const a = ta + side * 1.05;
        line(ctx, [px, py, px + Math.cos(a) * width, py + Math.sin(a) * width], 3.6, hi ? 1 : 0.72 + rand() * 0.28);
      }
    }
    if (!hi) {
      ctx.strokeStyle = grey(0.45);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(mx, my, x1, y1);
      ctx.stroke();
    }
  };
}

// Cherry: five-petalled blossoms in clusters, with the eyes and the lit
// petal tips as separate layers.
function blossoms(density, variant, part) {
  return (ctx) => {
    const rand = rng(5900 + density * 11 + variant * 3);
    const n = [3, 5, 7][density];
    const pts = spread(rand, n, 1.5);
    pts.forEach(([x, y]) => {
      const r = 5 + rand() * 1.6;
      const turn = rand() * TAU;
      if (part === 'eye') dot(ctx, x, y, 1.9);
      else if (part === 'hi') {
        for (let k = 0; k < 5; k++) {
          const a = turn + k / 5 * TAU;
          if (Math.cos(a) * 0.6 + Math.sin(a) * 0.8 > 0) continue;
          ellipse(ctx, x + Math.cos(a) * r * 0.7, y + Math.sin(a) * r * 0.7, r * 0.42, r * 0.3, a, 1);
        }
      } else petals(ctx, x, y, 5, r, r * 0.78, turn, 0.75 + rand() * 0.25, 0.8);
    });
  };
}

// Willow: long chains of narrow leaves hanging the full height of the cell,
// so a column of these reads as one unbroken strand.
function strands(variant, tip, hi) {
  return (ctx) => {
    const rand = rng(6100 + variant * 7);
    const count = 2 + (variant % 2);
    for (let i = 0; i < count; i++) {
      const x = (i + 0.5) / count * W + (rand() - 0.5) * 5;
      const sway = (rand() - 0.5) * 4;
      const end = tip ? 22 + rand() * 18 : H + 4;
      if (!hi) line(ctx, [x, -4, x + sway * 0.5, end * 0.5, x + sway, end], 1.6, 0.5);
      for (let y = -2 + rand() * 6; y < end - 3; y += 7) {
        const t = y / H;
        const px = x + sway * t;
        const side = Math.round(y / 7) % 2 ? 1 : -1;
        const a = Math.PI / 2 + side * 0.42;
        const l = { x: px, y, len: tip && y > end - 12 ? 7 : 10, wid: 3.4, a, shape: 'lance', level: 0.75 + rand() * 0.25 };
        drawLeaves(ctx, [l], hi);
      }
    }
  };
}

// --- Bark ----------------------------------------------------------------------

// Bark tiles vertically: whatever crosses the top and bottom edges does so
// at the same places in every variant, so a trunk is one continuous texture.
const RIDGES = [5, 15, 25];

function furrowed(ctx, rand, hi, from = 0) {
  // Rough vertical ridges split by deep, dark fissures, broken here and
  // there by a horizontal crack.
  for (const x0 of RIDGES) {
    if (x0 < from) continue;
    const wob = (rand() - 0.5) * 4;
    const pts = [x0, -4, x0 + wob * 0.5, 12, x0 + wob, 25, x0 + wob * 0.4, 38, x0, 54];
    if (hi) {
      line(ctx, pts.map((v, i) => (i % 2 ? v : v - 2.6)), 2.4, 1);
      continue;
    }
    line(ctx, pts, 6.6, 0.72 + rand() * 0.28);
    const breakY = 8 + rand() * 34;
    if (rand() < 0.7) line(ctx, [x0 - 4, breakY, x0 + 4, breakY + 1.5], 2.2, 0);
  }
  if (!hi && rand() < 0.5) {
    // A fissure wandering across from one furrow to the next.
    const y = 12 + rand() * 26;
    line(ctx, [10, y, 20, y + 8], 2.2, 0);
  }
}

function plated(ctx, rand, hi) {
  // Scaly plates in two courses, separated by dark cracks.
  for (const [top, bottom] of [[1.5, 23.5], [26.5, 48.5]]) {
    let x = -6 + rand() * 6;
    while (x < W) {
      const w = 9 + rand() * 7;
      const l = Math.max(x + 1.4, 0);
      const r = Math.min(x + w - 1.4, W);
      if (r - l > 2) {
        if (hi) line(ctx, [l + 1, top + 1.5, r - 1, top + 1.5], 2.4, 1);
        else {
          ctx.fillStyle = grey(0.66 + rand() * 0.34);
          ctx.beginPath();
          ctx.roundRect(l, top, r - l, bottom - top, 3);
          ctx.fill();
          if (rand() < 0.5) line(ctx, [l + 2, (top + bottom) / 2, r - 2, (top + bottom) / 2 + 2], 1.2, 0.4);
        }
      }
      x += w;
    }
  }
}

function birch(ctx, rand, hi, variant) {
  // Chalk-white bark ringed with dark horizontal lenticels.
  if (hi) {
    ctx.fillStyle = grey(1);
    ctx.fillRect(-6, -6, 10, H + 12);
    return;
  }
  ctx.fillStyle = grey(0.92);
  ctx.fillRect(-6, -6, W + 12, H + 12);
  const n = 2 + variant;
  for (let i = 0; i < n; i++) {
    const y = 4 + rand() * 42;
    const x = rand() * 22;
    const w = 6 + rand() * 12;
    ctx.fillStyle = grey(0);
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y, w / 2, 1.5 + rand() * 1.3, 0, 0, TAU);
    ctx.fill();
  }
  if (variant === 3) {
    // The dark chevron left where a branch was shed.
    line(ctx, [4, 14, 15, 22, 26, 14], 3.6, 0);
  }
}

function smooth(ctx, rand, hi) {
  // Smooth bark crossed by fine horizontal lenticel bands.
  if (hi) {
    ctx.fillStyle = grey(1);
    ctx.fillRect(-6, -6, 9, H + 12);
    return;
  }
  ctx.fillStyle = grey(0.82);
  ctx.fillRect(-6, -6, W + 12, H + 12);
  for (let y = 5 + rand() * 6; y < H; y += 9 + rand() * 6) {
    const x = rand() * 10;
    line(ctx, [x, y, x + 10 + rand() * 14, y + (rand() - 0.5) * 1.5], 1.8, 0.35);
  }
  line(ctx, [20 + rand() * 6, -4, 22 + rand() * 4, 54], 1.4, 0.55);
}

const BARK_KINDS = {
  furrow: (ctx, rand, hi, v, from) => furrowed(ctx, rand, hi, from),
  plate: (ctx, rand, hi) => plated(ctx, rand, hi),
  birch: (ctx, rand, hi, v) => birch(ctx, rand, hi, v),
  smooth: (ctx, rand, hi) => smooth(ctx, rand, hi),
};

function barkFamily(kind) {
  const out = [];
  const draw = BARK_KINDS[kind];
  for (let v = 0; v < 4; v++) {
    out.push({ name: `tree.bark.${kind}.${v}`, flip: true, draw: (ctx) => draw(ctx, rng(6300 + v * 13 + kind.length), false, v, 0) });
    out.push({ name: `tree.bark.${kind}.${v}.hi`, flip: true, draw: (ctx) => draw(ctx, rng(6300 + v * 13 + kind.length), true, v, 0) });
  }
  return out;
}

// --- Branches ------------------------------------------------------------------

// Wood is drawn like the grass blades: a stroke enters a cell at one of
// five places along its bottom edge and leaves at one of five along its top
// (or, for a flat branch, crosses from the left edge to the right), so a
// branch drawn cell by cell is one smooth, unbroken line at any slope. The
// trunk's outline is drawn the same way, as a fill bounded by such a line.
export const WOOD_STEPS = 5;
const STEP = (i) => (i + 0.5) / WOOD_STEPS;
const REACH = 6;
const STROKE_WIDTH = { twig: 7, limb: 14 };

function steepStroke(b, t, width) {
  return (ctx) => {
    const x0 = STEP(b) * W;
    const x1 = STEP(t) * W;
    const ext = (x1 - x0) / H * REACH;
    ctx.lineCap = 'butt';
    // A rounded limb: its moonward side catches the light.
    line(ctx, [x0 - ext, H + REACH, x1 + ext, -REACH], width, 0.72);
    line(ctx, [x0 - ext - width * 0.22, H + REACH, x1 + ext - width * 0.22, -REACH], width * 0.4, 1);
  };
}

function flatStroke(l, r, width, part) {
  return (ctx) => {
    const y0 = STEP(l) * H;
    const y1 = STEP(r) * H;
    const ext = (y1 - y0) / W * REACH;
    ctx.lineCap = 'butt';
    if (part === 'snow') {
      line(ctx, [-REACH, y0 - ext - width * 0.5 - 2, W + REACH, y1 + ext - width * 0.5 - 2], 5, 1);
      return;
    }
    line(ctx, [-REACH, y0 - ext, W + REACH, y1 + ext], width, 0.72);
    line(ctx, [-REACH, y0 - ext - width * 0.22, W + REACH, y1 + ext - width * 0.22], width * 0.4, 1);
  };
}

// The trunk's silhouette: filled on the trunk side of a line from (b) on the
// bottom edge to (t) on the top. 'l' is a left outline (filled to the right).
function edge(side, b, t, hi) {
  return (ctx) => {
    const x0 = STEP(b) * W;
    const x1 = STEP(t) * W;
    const ext = (x1 - x0) / H * REACH;
    const far = side === 'l' ? W + REACH : -REACH;
    if (hi) {
      // The moonlit rim just inside the trunk's left outline.
      ctx.lineCap = 'butt';
      line(ctx, [x0 - ext + 2.6, H + REACH, x1 + ext + 2.6, -REACH], 4.2, 1);
      return;
    }
    ctx.fillStyle = grey(0.86);
    ctx.beginPath();
    ctx.moveTo(x0 - ext, H + REACH);
    ctx.lineTo(x1 + ext, -REACH);
    ctx.lineTo(far, -REACH);
    ctx.lineTo(far, H + REACH);
    ctx.closePath();
    ctx.fill();
    // A furrow running along the outline.
    const inset = side === 'l' ? 7 : -7;
    ctx.lineCap = 'butt';
    line(ctx, [x0 - ext + inset, H + REACH, x1 + ext + inset, -REACH], 1.8, 0.35);
  };
}

const woodGlyphs = () => {
  const out = [];
  const n = WOOD_STEPS;
  for (let b = 0; b < n; b++) {
    for (let t = 0; t < n; t++) {
      for (const w of ['twig', 'limb']) {
        out.push({ name: `tree.stroke.${w}.${b}.${t}`, mirror: `tree.stroke.${w}.${t}.${b}`, draw: steepStroke(b, t, STROKE_WIDTH[w]) });
        out.push({ name: `tree.flat.${w}.${b}.${t}`, mirror: `tree.flat.${w}.${n - 1 - b}.${n - 1 - t}`, draw: flatStroke(b, t, STROKE_WIDTH[w], 'base') });
      }
      out.push({ name: `tree.flat.snow.${b}.${t}`, mirror: `tree.flat.snow.${n - 1 - b}.${n - 1 - t}`, draw: flatStroke(b, t, 9, 'snow') });
      out.push({ name: `tree.edge.l.${b}.${t}`, mirror: `tree.edge.l.${t}.${b}`, draw: edge('l', b, t, false) });
      out.push({ name: `tree.edge.l.${b}.${t}.hi`, mirror: `tree.edge.l.${t}.${b}.hi`, draw: edge('l', b, t, true) });
      out.push({ name: `tree.edge.r.${b}.${t}`, mirror: `tree.edge.r.${t}.${b}`, draw: edge('r', b, t, false) });
    }
  }
  return out;
};

// Winter crowns: fine networks of forking twigs.
function sprig(variant, snow) {
  return (ctx) => {
    const rand = rng(6600 + variant * 11);
    const grow = (x, y, a, len, depth) => {
      const ex = x + Math.cos(a) * len;
      const ey = y + Math.sin(a) * len;
      if (snow) {
        if (depth < 2 && Math.sin(a) < 0.3) dot(ctx, (x + ex) / 2 - 0.6, (y + ey) / 2 - 2, 2.2, 1);
      } else line(ctx, [x, y, ex, ey], depth === 0 ? 2.8 : 2.2, depth === 0 ? 0.85 : 0.65);
      if (depth >= 2) return;
      grow(ex, ey, a - 0.45 - rand() * 0.3, len * 0.66, depth + 1);
      grow(ex, ey, a + 0.4 + rand() * 0.3, len * 0.6, depth + 1);
    };
    const a = -Math.PI / 2 + (rand() - 0.5) * 1.6;
    grow(15 - Math.cos(a) * 16, 25 - Math.sin(a) * 26, a, 20, 0);
  };
}

// --- Seasonal and small accents ---------------------------------------------

function snowCap(variant) {
  return (ctx) => {
    const rand = rng(6800 + variant * 5);
    const depth = 12 + rand() * 8;
    ctx.fillStyle = grey(1);
    ctx.beginPath();
    ctx.moveTo(-6, -6);
    ctx.lineTo(36, -6);
    ctx.lineTo(36, depth * 0.6);
    // A scalloped lower edge where the snow drapes over the needles.
    for (let x = 32; x >= -4; x -= 6) {
      ctx.quadraticCurveTo(x - 1.5, depth + 3 + rand() * 6, x - 6, depth * (0.55 + rand() * 0.3));
    }
    ctx.closePath();
    ctx.fill();
    dot(ctx, 6 + rand() * 18, depth + 7 + rand() * 6, 1.8, 0.8);
  };
}

const ACCENTS = [
  // Acorns: a cup and a nut, hanging in a pair.
  { name: 'tree.acorns', flip: true, draw: (ctx) => {
    for (const [x, y] of [[10, 20], [20, 30]]) {
      line(ctx, [x, y - 10, x, y - 4], 1.6, 0.6);
      ellipse(ctx, x, y + 3, 3.6, 5, 0, 0.85);
      ellipse(ctx, x, y - 2, 4.6, 2.6, 0, 0.5);
    }
  } },
  // Cherries: two round fruits on long stalks.
  { name: 'tree.cherries', flip: true, draw: (ctx) => {
    line(ctx, [15, 8, 10, 30], 1.6, 0.6);
    line(ctx, [15, 8, 21, 32], 1.6, 0.6);
    dot(ctx, 10, 33, 4.2, 1);
    dot(ctx, 21, 35, 4.2, 0.85);
    dot(ctx, 8.8, 31.6, 1.3, 0);
  } },
  // A pine cone hanging by its stalk, its scales in rows.
  { name: 'tree.cone', flip: true, draw: (ctx) => {
    line(ctx, [15, 4, 15, 12], 2, 0.6);
    ellipse(ctx, 15, 25, 6, 12, 0, 0.8);
    for (let y = 16; y < 36; y += 4.5) line(ctx, [10, y, 15, y + 2.4, 20, y], 1.3, 0.2);
  } },
  // Round fruits clustered under a palm-like crown.
  { name: 'tree.fruits', flip: true, draw: (ctx) => {
    for (const [x, y] of [[10, 18], [19, 16], [14, 26], [22, 26]]) dot(ctx, x, y, 4.6, 0.8 + (x % 3) * 0.08);
    line(ctx, [15, 4, 15, 12], 2, 0.5);
  } },
  // Catkins dangling from the twigs of birch and willow in spring.
  { name: 'tree.catkins', flip: true, draw: (ctx) => {
    for (const [x, len] of [[8, 22], [17, 30], [25, 18]]) {
      for (let y = 6; y < 6 + len; y += 4) ellipse(ctx, x + Math.sin(y * 0.2) * 1.2, y, 2.4, 2.2, 0, 0.9);
    }
  } },
  // Berries on a bush: little clusters of round fruit.
  ...[0, 1, 2].map((v) => ({ name: `tree.berries.${v}`, draw: (ctx) => {
    const rand = rng(7000 + v * 9);
    for (const [x, y] of spread(rand, 2 + v, 7)) {
      for (let k = 0; k < 3; k++) {
        const a = rand() * TAU;
        dot(ctx, x + Math.cos(a) * 3.6, y + Math.sin(a) * 3.6, 2.9, 0.8 + rand() * 0.2);
      }
    }
  } })),
  // Moss on the shaded side of a trunk.
  ...[0, 1, 2].map((v) => ({ name: `tree.moss.${v}`, flip: true, draw: (ctx) => {
    const rand = rng(7100 + v * 5);
    for (let i = 0; i < 26; i++) {
      const x = 12 + rand() * 20;
      const y = 2 + rand() * 46;
      dot(ctx, x, y, 1.6 + rand() * 1.4, 0.55 + rand() * 0.45);
    }
  } })),
];

// Fallen leaves, needles and petals lying flat on the ground (squashed
// vertically, as the ground is seen at a slant).
function litter(kind, variant) {
  return (ctx) => {
    const rand = rng(7300 + variant * 17 + kind.length * 3);
    ctx.save();
    ctx.translate(0, 25);
    ctx.scale(1, 0.62);
    ctx.translate(0, -25);
    if (kind === 'leaf') {
      const n = 1 + (variant % 3);
      for (const [x, y] of spread(rand, n, 7)) {
        const a = rand() * TAU;
        const l = { x: x - Math.cos(a) * 6, y: y - Math.sin(a) * 6, len: 12 + rand() * 4, wid: 7, a,
          shape: variant > 2 ? 'oak' : 'almond', level: 0.75 + rand() * 0.25 };
        drawLeaves(ctx, [l], false);
      }
    } else if (kind === 'needle') {
      for (let i = 0; i < 6 + variant * 2; i++) {
        const x = 3 + rand() * 24;
        const y = 8 + rand() * 34;
        const a = (rand() - 0.5) * 1.6 + (rand() < 0.5 ? 0 : Math.PI);
        line(ctx, [x, y, x + Math.cos(a) * 11, y + Math.sin(a) * 11], 2, 0.6 + rand() * 0.4);
      }
    } else if (kind === 'petal') {
      for (let i = 0; i < 2 + variant; i++) {
        ellipse(ctx, 5 + rand() * 20, 8 + rand() * 34, 3.4, 2.4, rand() * TAU, 0.8 + rand() * 0.2);
      }
    } else if (kind === 'twig') {
      const a = (rand() - 0.5) * 0.8;
      line(ctx, [15 - Math.cos(a) * 14, 25 - Math.sin(a) * 14, 15 + Math.cos(a) * 14, 25 + Math.sin(a) * 14], 2.8, 0.75);
      line(ctx, [17, 25, 22, 16], 2, 0.6);
    } else if (kind === 'cone') {
      ellipse(ctx, 15, 27, 10, 5.4, 0.2, 0.8);
      for (let x = 8; x < 23; x += 4) line(ctx, [x, 23, x + 1.6, 31], 1.3, 0.2);
    }
    ctx.restore();
  };
}

// Falling leaves: a small leaf at eight headings, the same leaf seen edge-on
// as it tumbles, and a drifting blossom petal.
const FALLING = [
  ...Array.from({ length: 8 }, (_, h) => ({ name: `tree.fall.${h}`, mirror: `tree.fall.${mirrorHeading(h)}`,
    draw: (ctx) => {
      const a = h / 8 * TAU;
      drawLeaves(ctx, [{ x: 15 - Math.cos(a) * 7, y: 25 - Math.sin(a) * 7, len: 14, wid: 8, a, shape: 'almond', level: 1 }], false);
    } })),
  ...Array.from({ length: 4 }, (_, h) => ({ name: `tree.fall.edge.${h}`, mirror: `tree.fall.edge.${(4 - h) % 4}`,
    draw: (ctx) => {
      const a = h / 4 * Math.PI;
      line(ctx, [15 - Math.cos(a) * 7, 25 - Math.sin(a) * 7, 15 + Math.cos(a) * 7, 25 + Math.sin(a) * 7], 2.8, 1);
    } })),
  ...Array.from({ length: 4 }, (_, h) => ({ name: `tree.fall.petal.${h}`, mirror: `tree.fall.petal.${(4 - h) % 4}`,
    draw: (ctx) => ellipse(ctx, 15, 25, 5, 3.2 - (h % 2) * 1.2, h / 4 * Math.PI, 1) })),
];

export const LEAF_SPECS = {
  broad: { seed: 4100, len: 17, wid: 9.5, jitter: 1.1, shape: 'oak', counts: [3, 4, 6] },
  round: { seed: 4300, len: 11, wid: 7.6, jitter: 1.5, shape: 'ovate', counts: [3, 6, 9] },
  lance: { seed: 4500, len: 14, wid: 4.2, jitter: 0.7, shape: 'lance', counts: [3, 6, 9] },
  almond: { seed: 4700, len: 13, wid: 7.5, jitter: 1.2, shape: 'almond', counts: [3, 5, 7] },
};

export const TREES = [
  ...clusterFamily('tree.broad', LEAF_SPECS.broad, [0, 1, 2], 2),
  ...clusterFamily('tree.round', LEAF_SPECS.round, [0, 1, 2], 1),
  ...clusterFamily('tree.lance', LEAF_SPECS.lance, [0, 1, 2], 1),
  ...clusterFamily('tree.almond', LEAF_SPECS.almond, [0, 1, 2], 1),
  ...Array.from({ length: HEADINGS }, (_, h) => [0, 1, 2].flatMap((d) => [
    { name: `tree.tuft.${h}.${d}`, mirror: `tree.tuft.${mirrorHeading(h)}.${d}`, draw: tufts(h, d, false) },
    { name: `tree.tuft.${h}.${d}.hi`, mirror: `tree.tuft.${mirrorHeading(h)}.${d}.hi`, draw: tufts(h, d, true) },
  ])).flat(),
  ...Array.from({ length: HEADINGS }, (_, h) => [0, 1].flatMap((d) => [
    { name: `tree.brush.${h}.${d}`, mirror: `tree.brush.${mirrorHeading(h)}.${d}`, draw: brush(h, d, false) },
    { name: `tree.brush.${h}.${d}.hi`, mirror: `tree.brush.${mirrorHeading(h)}.${d}.hi`, draw: brush(h, d, true) },
  ])).flat(),
  ...Array.from({ length: HEADINGS }, (_, h) => [0, 1].flatMap((d) => [
    { name: `tree.spray.${h}.${d}`, mirror: `tree.spray.${mirrorHeading(h)}.${d}`, draw: spray(h, d, false) },
    { name: `tree.spray.${h}.${d}.hi`, mirror: `tree.spray.${mirrorHeading(h)}.${d}.hi`, draw: spray(h, d, true) },
  ])).flat(),
  ...Array.from({ length: HEADINGS }, (_, h) => [0, 1].flatMap((v) => [
    { name: `tree.frond.${h}.${v}`, mirror: `tree.frond.${mirrorHeading(h)}.${v}`, draw: frond(h, v, false) },
    { name: `tree.frond.${h}.${v}.hi`, mirror: `tree.frond.${mirrorHeading(h)}.${v}.hi`, draw: frond(h, v, true) },
  ])).flat(),
  ...[0, 1, 2].flatMap((d) => [0, 1, 2].flatMap((v) => [
    { name: `tree.bloom.${d}.${v}`, draw: blossoms(d, v, 'base') },
    { name: `tree.bloom.${d}.${v}.hi`, draw: blossoms(d, v, 'hi') },
    { name: `tree.bloom.${d}.${v}.eye`, draw: blossoms(d, v, 'eye') },
  ])),
  ...[0, 1, 2, 3].flatMap((v) => [
    { name: `tree.strand.${v}`, flip: true, draw: strands(v, false, false) },
    { name: `tree.strand.${v}.hi`, flip: true, draw: strands(v, false, true) },
    { name: `tree.strand.tip.${v}`, flip: true, draw: strands(v, true, false) },
    { name: `tree.strand.tip.${v}.hi`, flip: true, draw: strands(v, true, true) },
  ]),
  ...['furrow', 'plate', 'birch', 'smooth'].flatMap(barkFamily),
  ...woodGlyphs(),
  ...Array.from({ length: 6 }, (_, v) => [
    { name: `tree.sprig.${v}`, flip: true, draw: sprig(v, false) },
    { name: `tree.sprig.${v}.snow`, flip: true, draw: sprig(v, true) },
  ]).flat(),
  ...[0, 1, 2, 3].map((v) => ({ name: `tree.snow.${v}`, draw: snowCap(v) })),
  ...ACCENTS,
  ...[0, 1, 2, 3, 4, 5].map((v) => ({ name: `tree.litter.leaf.${v}`, draw: litter('leaf', v) })),
  ...[0, 1, 2].map((v) => ({ name: `tree.litter.needle.${v}`, draw: litter('needle', v) })),
  ...[0, 1, 2].map((v) => ({ name: `tree.litter.petal.${v}`, draw: litter('petal', v) })),
  ...[0, 1].map((v) => ({ name: `tree.litter.twig.${v}`, draw: litter('twig', v) })),
  { name: 'tree.litter.cone', draw: litter('cone', 0) },
  ...FALLING,
];
