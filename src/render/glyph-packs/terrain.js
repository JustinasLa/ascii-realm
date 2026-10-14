// Ground textures: grass floor, dirt paths, shore, stone.
// Entries: { name, draw(ctx, w, h), mirror?, flip? } - see draw.js and glyphs.js.
//
// Glyph space is isotropic: 30 x 50 px covers 0.6 x 1 world units, so one
// world unit is 50 px both across and down. That lets a joint or a rut
// computed in world units be drawn at its true angle and offset in a cell.

import { arc, curve, dot, ellipse, line, poly, rng, TAU, variants } from './draw.js';

const W = 30;
const H = 50;

// Oriented lines that cross a cell: ANGLES headings over half a turn and
// OFFSETS positions across the cell, so a long straight joint drawn cell by
// cell stays continuous (see terrain/surface.js lineCell).
export const LINE_ANGLES = 12;
export const LINE_OFFSETS = 7;

// The cell's half extent along a unit normal, in glyph pixels.
export const halfExtent = (nx, ny) => 0.5 * (W * Math.abs(nx) + H * Math.abs(ny));

// Points of a line at heading a (radians) through the cell centre, shifted
// by f (-1..1) of the half extent along its normal. The middle part, inside
// the cell, wobbles a little like a real crack; the wobble returns to the
// true line at the cell's edges so neighbouring cells join up.
function crossing(a, f, wobble, seed) {
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const nx = -dy;
  const ny = dx;
  const cx = W / 2 + nx * f * halfExtent(nx, ny);
  const cy = H / 2 + ny * f * halfExtent(nx, ny);
  // Where the line enters and leaves the inner cell.
  let t0 = -1e9;
  let t1 = 1e9;
  for (const [p, d, lo, hi] of [[cx, dx, 0, W], [cy, dy, 0, H]]) {
    if (Math.abs(d) < 1e-6) continue;
    const a0 = (lo - p) / d;
    const a1 = (hi - p) / d;
    t0 = Math.max(t0, Math.min(a0, a1));
    t1 = Math.min(t1, Math.max(a0, a1));
  }
  if (!(t1 > t0)) { t0 = -30; t1 = 30; }
  const rand = rng(seed);
  const pts = [cx + dx * (t0 - 12), cy + dy * (t0 - 12)];
  const steps = 5;
  const phase = rand() * TAU;
  for (let k = 0; k <= steps; k++) {
    const u = k / steps;
    const t = t0 + (t1 - t0) * u;
    const w = Math.sin(Math.PI * u) * (Math.sin(phase + u * 7) * 0.6 + (rand() - 0.5)) * wobble;
    pts.push(cx + dx * t + nx * w, cy + dy * t + ny * w);
  }
  pts.push(cx + dx * (t1 + 12), cy + dy * (t1 + 12));
  return { pts, cx, cy, dx, dy, nx, ny, t0, t1, rand };
}

const lineVariants = (prefix, draw) => {
  const out = [];
  for (let a = 0; a < LINE_ANGLES; a++) {
    for (let o = 0; o < LINE_OFFSETS; o++) {
      const angle = a / LINE_ANGLES * Math.PI;
      const f = -1 + (2 * o + 1) / LINE_OFFSETS;
      out.push({ name: `${prefix}.${a}.${o}`, draw: (ctx) => draw(ctx, angle, f, a * 31 + o) });
    }
  }
  return out;
};

// Rough pebbles and chips: a lit upper-left face over a darker body.
function chip(ctx, x, y, r, rand, lit = 1) {
  const n = 5 + Math.floor(rand() * 3);
  const pts = [];
  for (let k = 0; k < n; k++) {
    const a = k / n * TAU + rand() * 0.6;
    const d = r * (0.7 + rand() * 0.45);
    pts.push(x + Math.cos(a) * d, y + Math.sin(a) * d * 0.9);
  }
  poly(ctx, pts, 0.42 * lit);
  const top = [];
  for (let k = 0; k < pts.length; k += 2) {
    top.push(x + (pts[k] - x) * 0.62 - r * 0.18, y + (pts[k + 1] - y) * 0.62 - r * 0.2);
  }
  poly(ctx, top, 0.8 * lit);
  dot(ctx, x - r * 0.35, y - r * 0.38, Math.max(1.3, r * 0.22), lit);
}

export const TERRAIN = [
  // --- Stone ------------------------------------------------------------
  // The dark joint between two slabs, and grit settled along it.
  ...lineVariants('terrain.joint', (ctx, a, f, seed) => {
    const { pts } = crossing(a, f, 2.2, 3000 + seed);
    ctx.lineJoin = 'round';
    line(ctx, pts, 7.5, 1);
  }),
  ...lineVariants('terrain.jgrit', (ctx, a, f, seed) => {
    const { cx, cy, dx, dy, nx, ny, t0, t1, rand } = crossing(a, f, 0, 3500 + seed);
    const n = 3 + Math.floor(rand() * 3);
    for (let k = 0; k < n; k++) {
      const t = t0 + (t1 - t0) * (k + 0.2 + rand() * 0.6) / n;
      const s = (rand() - 0.5) * 6;
      const r = 1.8 + rand() * 1.6;
      const x = cx + dx * t + nx * s;
      const y = cy + dy * t + ny * s;
      dot(ctx, x, y, r, 0.55 + rand() * 0.2);
      dot(ctx, x - r * 0.3, y - r * 0.35, r * 0.5, 1);
    }
  }),
  // A thin line on the same grid: a hairline crack where two slabs have
  // fused, or the lit (or shaded) lip of a slab beside its joint.
  ...lineVariants('terrain.fine', (ctx, a, f, seed) => {
    const { pts } = crossing(a, f, 1.4, 3800 + seed);
    ctx.lineJoin = 'round';
    line(ctx, pts, 3, 1);
  }),
  // Granular rock: specks of quartz and feldspar at mixed strengths.
  ...variants('terrain.grain', 8, (ctx, w, h, i) => {
    const rand = rng(3100 + i);
    const n = 4 + Math.floor(rand() * 4);
    for (let k = 0; k < n; k++) {
      dot(ctx, 4 + rand() * 22, 5 + rand() * 40, 2 + rand() * 1.4, 0.35 + rand() * 0.6);
    }
  }),
  // Faint mottling, so a smooth slab is not a flat fill.
  ...variants('terrain.mottle', 4, (ctx, w, h, i) => {
    const rand = rng(3200 + i);
    for (let k = 0; k < 3; k++) {
      ellipse(ctx, 4 + rand() * 22, 6 + rand() * 38, 4 + rand() * 5, 4 + rand() * 7, rand() * 3, 0.22 + rand() * 0.18);
    }
    for (let k = 0; k < 3; k++) dot(ctx, 3 + rand() * 24, 4 + rand() * 42, 1.4, 0.5);
  }),
  // A weathered pit: dark inside, its far wall lit by the moon.
  ...variants('terrain.pit', 4, (ctx, w, h, i) => {
    const rand = rng(3300 + i);
    const x = 10 + rand() * 10;
    const y = 16 + rand() * 18;
    const r = 4 + rand() * 2.5;
    for (let k = 0; k < 9; k++) {
      const a = rand() * TAU;
      const d = r + 3 + rand() * 6;
      dot(ctx, x + Math.cos(a) * d, y + Math.sin(a) * d, 1.3 + rand(), 0.3 + rand() * 0.3);
    }
    arc(ctx, x, y, r, r, -0.3, Math.PI * 0.95, 2.6, 0.95);
    arc(ctx, x, y, r + 1.6, r + 1.6, Math.PI * 1.05, Math.PI * 1.7, 1.6, 0.35);
  }),
  // Sedimentary bands. Each runs edge to edge at the same height on both
  // sides, so a row of cells on one slab joins into long strata.
  ...variants('terrain.strata', 6, (ctx, w, h, i) => {
    const rand = rng(3400 + i);
    const n = 1 + (i % 2);
    for (let k = 0; k < n; k++) {
      const y = n === 1 ? 14 + rand() * 22 : 9 + k * 22 + rand() * 10;
      const amp = 1.5 + rand() * 2;
      const pts = [];
      for (let x = -6; x <= W + 6; x += 3) pts.push(x, y + Math.sin(x / W * TAU) * amp);
      line(ctx, pts, 2.4, 0.55 + rand() * 0.35);
      if (rand() < 0.6) {
        const y2 = y + 4.5;
        const pts2 = [];
        for (let x = 4 + rand() * 6; x <= 22 + rand() * 8; x += 3) pts2.push(x, y2 + Math.sin(x / W * TAU) * amp);
        if (pts2.length >= 4) line(ctx, pts2, 1.6, 0.35);
      }
    }
  }),
  // Hairline fissures inside a slab, with a short branch.
  ...variants('terrain.fissure', 4, (ctx, w, h, i) => {
    const rand = rng(3500 + i);
    let x = 6 + rand() * 18;
    let y = 4 + rand() * 6;
    const pts = [x, y];
    const lean = (rand() - 0.5) * 8;
    for (let k = 0; k < 5; k++) {
      x += lean + (rand() - 0.5) * 8;
      y += 7 + rand() * 3;
      pts.push(x, y);
    }
    ctx.lineJoin = 'round';
    line(ctx, pts, 2.2, 1);
    const b = 4 + Math.floor(rand() * 2) * 2;
    line(ctx, [pts[b], pts[b + 1], pts[b] + (rand() < 0.5 ? -1 : 1) * (6 + rand() * 5), pts[b + 1] + 5 + rand() * 6],
      1.6, 0.8);
  }),
  // Crustose lichen: a lobed rosette with a paler rim.
  ...variants('terrain.lichen', 4, (ctx, w, h, i) => {
    const rand = rng(3600 + i);
    const x = 9 + rand() * 12;
    const y = 15 + rand() * 20;
    const r = 5 + rand() * 4;
    ellipse(ctx, x, y, r * 0.75, r * 0.8, 0, 0.45);
    const lobes = 7 + Math.floor(rand() * 4);
    for (let k = 0; k < lobes; k++) {
      const a = k / lobes * TAU + rand() * 0.3;
      dot(ctx, x + Math.cos(a) * r, y + Math.sin(a) * r, 1.8 + rand() * 1.2, 0.85 + rand() * 0.15);
    }
    if (i % 2) dot(ctx, x + r * 1.8 * (rand() - 0.5), y + r * 2.2, 2.2, 0.7);
  }),
  // Stone chips and gravel heaped against a slab or dropped on soil.
  ...variants('terrain.chips', 6, (ctx, w, h, i) => {
    const rand = rng(3700 + i);
    const n = 1 + (i % 3);
    for (let k = 0; k < n; k++) chip(ctx, 7 + rand() * 16, 12 + rand() * 26, 3.5 + rand() * 3.5 - n * 0.4, rand);
  }),

  // --- Dirt -------------------------------------------------------------
  // Crumbled soil: a couple of lit clods among fine grains.
  ...variants('terrain.soil', 8, (ctx, w, h, i) => {
    const rand = rng(4000 + i);
    const clods = i % 3;
    for (let k = 0; k < clods; k++) {
      const x = 6 + rand() * 18;
      const y = 10 + rand() * 30;
      const r = 2.6 + rand() * 2;
      ellipse(ctx, x, y + 0.8, r * 1.25, r, rand(), 0.5);
      dot(ctx, x - r * 0.35, y - r * 0.3, r * 0.55, 0.95);
    }
    const n = 3 + Math.floor(rand() * 4);
    for (let k = 0; k < n; k++) dot(ctx, 3 + rand() * 24, 4 + rand() * 42, 1.3 + rand() * 1.1, 0.4 + rand() * 0.45);
  }),
  // Packed earth worn into fine streaks along the way, at twelve headings.
  ...variants('terrain.streak', LINE_ANGLES, (ctx, w, h, i) => {
    const a = i / LINE_ANGLES * Math.PI;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const rand = rng(4100 + i);
    for (let k = -1; k <= 1; k++) {
      const s = k * 9 + (rand() - 0.5) * 3;
      const cx = 15 - dy * s;
      const cy = 25 + dx * s;
      // Broken into dashes so the streaks read as scuffs, not rails.
      let t = -34 + rand() * 6;
      while (t < 34) {
        const len = 7 + rand() * 12;
        line(ctx, [cx + dx * t, cy + dy * t, cx + dx * (t + len), cy + dy * (t + len)], 1.9, 0.45 + rand() * 0.4);
        t += len + 3 + rand() * 6;
      }
    }
  }),
  // A boot print (sole and heel) heading one of eight ways, pressed dark.
  ...variants('terrain.print', 8, (ctx, w, h, i) => {
    const a = i / 8 * TAU;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    ellipse(ctx, 15 + dx * 6, 25 + dy * 6, 7.5, 4.6, a, 1);
    ellipse(ctx, 15 - dx * 8, 25 - dy * 8, 4, 4.2, a, 1);
  }),
  // A hoof print: a horseshoe opening toward its heading.
  ...variants('terrain.hoof', 8, (ctx, w, h, i) => {
    const a = i / 8 * TAU;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(15, 25, 7, a + 0.75, a + TAU - 0.75);
    ctx.stroke();
  }),
  // Dried mud split into curling plates.
  ...variants('terrain.mud', 4, (ctx, w, h, i) => {
    const rand = rng(4300 + i);
    ctx.fillStyle = 'rgb(190,190,190)';
    ctx.fillRect(-6, -6, W + 12, H + 12);
    ctx.lineJoin = 'round';
    // A network of cracks: one across, one down, a spur, and a cell border.
    const across = [-6, 10 + rand() * 30];
    for (let x = 4; x <= W + 6; x += 8) across.push(x, across[across.length - 1] + (rand() - 0.5) * 12);
    line(ctx, across, 3.4, 0);
    const down = [4 + rand() * 22, -6];
    for (let y = 6; y <= H + 6; y += 10) down.push(down[down.length - 2] + (rand() - 0.5) * 10, y);
    line(ctx, down, 3.4, 0);
    line(ctx, [down[4], down[5], down[4] + (rand() < 0.5 ? -14 : 14), down[5] + 6 + rand() * 8], 2.6, 0);
    if (i % 2) line(ctx, [-2, -6, -2, H + 6], 3.4, 0);
    else line(ctx, [-6, -1, W + 6, -1], 3.4, 0);
    // Curled, lit plate edges toward the moon.
    for (let k = 0; k < 4; k++) dot(ctx, 4 + rand() * 22, 6 + rand() * 38, 1.6, 1);
  }),

  // --- Shore ------------------------------------------------------------
  // Fine sand.
  ...variants('terrain.sand', 8, (ctx, w, h, i) => {
    const rand = rng(5000 + i);
    const n = 8 + Math.floor(rand() * 6);
    for (let k = 0; k < n; k++) dot(ctx, 2 + rand() * 26, 3 + rand() * 44, 1.1 + rand() * 0.8, 0.35 + rand() * 0.55);
  }),
  // Ripple marks left by the water, along the shoreline at six headings.
  ...variants('terrain.ripple', 6, (ctx, w, h, i) => {
    const a = i / 6 * Math.PI;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    for (let k = -1; k <= 1; k++) {
      const s = k * 14;
      const pts = [];
      for (let t = -34; t <= 34; t += 4) {
        const wv = Math.sin(t * 0.22 + k) * 2;
        pts.push(15 + dx * t - dy * (s + wv), 25 + dy * t + dx * (s + wv));
      }
      line(ctx, pts, 2, 0.7);
    }
  }),
  // Shells: a ribbed fan, a coiled snail and a pale clam.
  { name: 'terrain.shell.0', draw: (ctx) => {
    poly(ctx, [15, 33, 7, 25, 8, 20, 12, 17, 18, 17, 22, 20, 23, 25], 0.85);
    for (let k = 0; k < 5; k++) {
      const a = Math.PI * (1.1 + k * 0.2);
      line(ctx, [15, 32, 15 + Math.cos(a) * 9, 32 + Math.sin(a) * 13], 1.2, 0.35);
    }
  } },
  { name: 'terrain.shell.1', draw: (ctx) => {
    ellipse(ctx, 15, 26, 7, 6.5, 0, 0.8);
    arc(ctx, 15, 26, 4.2, 3.8, 0, TAU * 0.8, 1.6, 0.3);
    dot(ctx, 15.5, 26, 1.6, 0.3);
    dot(ctx, 12, 23, 1.8, 1);
  } },
  { name: 'terrain.shell.2', draw: (ctx) => {
    ellipse(ctx, 14, 28, 8, 5, -0.25, 0.9);
    arc(ctx, 14, 28, 6, 3.4, -0.25 + 0.2, Math.PI - 0.3, 1.2, 0.4);
    dot(ctx, 10, 26, 1.6, 1);
  } },
  { name: 'terrain.shell.3', draw: (ctx) => {
    ellipse(ctx, 9, 20, 4, 3, 0.4, 0.8);
    ellipse(ctx, 21, 34, 4.5, 3, -0.3, 0.75);
    dot(ctx, 15, 27, 1.8, 0.6);
  } },
  // The tide line: tangled strands of dark weed with a bladder or two.
  ...variants('terrain.wrack', 4, (ctx, w, h, i) => {
    const rand = rng(5200 + i);
    ctx.lineJoin = 'round';
    for (let k = 0; k < 3; k++) {
      const y = 14 + rand() * 22;
      const pts = [];
      for (let x = -4 - rand() * 4; x <= W + 4; x += 4) pts.push(x, y + Math.sin(x * 0.35 + k * 2 + rand()) * 3);
      line(ctx, pts, 2.2, 0.6 + rand() * 0.4);
    }
    for (let k = 0; k < 2; k++) dot(ctx, 5 + rand() * 20, 16 + rand() * 18, 2.2, 1);
  }),
  // Moonlight caught on wet sand: short glossy dashes.
  ...variants('terrain.glint', 3, (ctx, w, h, i) => {
    const rand = rng(5300 + i);
    for (let k = 0; k <= i % 2; k++) {
      const x = 6 + rand() * 14;
      const y = 12 + rand() * 26;
      const len = 7 + rand() * 6;
      line(ctx, [x, y, x + len, y], 2.4, 1);
      dot(ctx, x + len * 0.5, y, 2, 1);
    }
  }),

  // --- Meadow floor -----------------------------------------------------
  // Leaf litter and dead grass lying flat.
  ...variants('terrain.litter', 8, (ctx, w, h, i) => {
    const rand = rng(6000 + i);
    ctx.lineCap = 'round';
    const n = 2 + Math.floor(rand() * 2);
    for (let k = 0; k < n; k++) {
      const x = 4 + rand() * 22;
      const y = 8 + rand() * 34;
      const a = (rand() - 0.5) * 1.6 + (rand() < 0.5 ? 0 : Math.PI);
      const len = 8 + rand() * 9;
      curve(ctx, x, y, x + Math.cos(a) * len * 0.5, y + Math.sin(a) * len * 0.5 - 3,
        x + Math.cos(a) * len, y + Math.sin(a) * len, 2, 0.5 + rand() * 0.4);
    }
    if (i % 3 === 0) ellipse(ctx, 8 + rand() * 14, 14 + rand() * 22, 3.6, 2.4, rand() * 3, 0.8);
  }),
  // A mat of clover: two or three trefoils of different sizes and turns,
  // so a patch does not repeat one stamp.
  ...variants('terrain.clover', 8, (ctx, w, h, i) => {
    const rand = rng(6050 + i);
    const n = 2 + (i % 2);
    for (let k = 0; k < n; k++) {
      const x = 6 + rand() * 18;
      const y = 8 + (k + rand()) * (34 / n);
      const r = 2.8 + rand() * 1.8;
      const turn = rand() * TAU;
      line(ctx, [x, y, x + (rand() - 0.5) * 6, y + 6 + rand() * 4], 1.4, 0.5);
      for (let j = 0; j < 3; j++) {
        const a = turn + j * TAU / 3;
        ellipse(ctx, x + Math.cos(a) * r, y + Math.sin(a) * r, r * 0.95, r * 0.8, a, 0.75 + rand() * 0.25);
      }
    }
  }),
  // Fallen petals.
  ...variants('terrain.petal', 4, (ctx, w, h, i) => {
    const rand = rng(6100 + i);
    const n = 1 + (i % 3);
    for (let k = 0; k < n; k++) ellipse(ctx, 6 + rand() * 18, 10 + rand() * 30, 2.8, 1.8, rand() * 3, 1);
  }),
  // Pale ash flakes, and the charred stubs of burnt grass.
  ...variants('terrain.ash', 4, (ctx, w, h, i) => {
    const rand = rng(6200 + i);
    for (let k = 0; k < 4; k++) {
      const x = 4 + rand() * 22;
      const y = 6 + rand() * 38;
      poly(ctx, [x, y, x + 3 + rand() * 3, y + rand() * 2, x + 2, y + 2 + rand() * 2], 0.6 + rand() * 0.4);
    }
    for (let k = 0; k < 4; k++) dot(ctx, 3 + rand() * 24, 4 + rand() * 42, 1.2, 0.5);
  }),
  ...variants('terrain.char', 4, (ctx, w, h, i) => {
    const rand = rng(6300 + i);
    const n = 2 + Math.floor(rand() * 3);
    for (let k = 0; k < n; k++) {
      const x = 4 + rand() * 22;
      const top = 30 + rand() * 14;
      line(ctx, [x, 50, x + (rand() - 0.5) * 4, top], 2.8, 0.7 + rand() * 0.3);
    }
  }).map((e) => ({ ...e, flip: true })),
];
