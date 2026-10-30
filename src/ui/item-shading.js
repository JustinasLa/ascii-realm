// Item art as letters: a rendered picture of an item, sampled per character
// cell and turned into shaded glyphs, then drawn onto a canvas. Plain inputs
// only (pixel buffers, grids and ramps of characters), so it all runs in Node.

// A character cell is 0.6 of its height wide.
export const ASPECT = 0.6;
// Samples per cell, across and down.
export const SX = 4;
export const SY = 6;
const N = SX * SY;

// The letter grid of each box shape, in columns × rows, with the font size
// in CSS px that fills the box at its desktop size: letters stay about 4 px
// wide and 6 px tall in every box, and the cell count changes with the box.
export const GRIDS = Object.freeze({
  card: { cols: 20, rows: 24, font: 5 },
  '2x4': { cols: 30, rows: 31, font: 6.6 },
  '2x3': { cols: 30, rows: 23, font: 6.6 },
  '2x2': { cols: 30, rows: 15, font: 6.6 },
  '1x1': { cols: 14, rows: 7, font: 6.5, fill: 0.96, minHits: 2 },
});

// A doll box's grid shape, from its width and height in doll cells.
export const shapeOf = (box) => `${box.width}x${box.height}`;

// The angle of a grid's diagonal from the horizontal: long items lie on it.
export const poseAngle = (grid) => Math.atan2(grid.rows, grid.cols * ASPECT);

const hex = (rgb) => rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');
const fromHex = (h) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));

// The metal colour of a stack, or null: its own (a forged weapon or alloy
// ingot, as `own` describes it), else the tier from `materialOf`
// (weaponMaterial in weapons.js) of a weapon or of a stack with a material,
// such as arrows.
export function artTint(stack, item, own, materialOf) {
  if (/^#?[0-9a-f]{6}$/i.test(own?.colour ?? '')) return fromHex(own.colour.replace('#', ''));
  return item.weapon || stack?.material ? materialOf(stack, item.material ?? 'iron').color : null;
}

// The cache key of one picture.
export const artKey = (id, variant, tint, shape, dpr) => `${id}|${variant}|${tint ? hex(tint) : ''}|${shape}|${dpr}`;

// A stable 0..1 hash of a cell, so equal-weight letters vary across the
// picture but never between frames or runs.
export function hash(x, y, seed) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export const seedOf = (text) => [...text].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619), 2166136261) >>> 0;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// A character of a ramp (shadow to light, each level a few characters of
// about the same weight) for a light level in 0..1.
export function rampChar(ramp, light, r) {
  const level = ramp[Math.min(ramp.length - 1, Math.floor(clamp01(light) * ramp.length))];
  return level[Math.floor(r * level.length) % level.length];
}

// Cells from a lit picture `shade` and a paint-id picture `ids` (RGBA, rows
// bottom-up as WebGL reads them, SX × SY samples per cell). `paints[i]` is
// { ramp, lum, floor, gain, glint?, edge? }, and an id pixel's red is
// i * 8 + 4; the light level is how bright a cell is lit against its paint's
// own brightness `lum` (0..1), so dark leather and pale steel both use their
// whole ramp.
// `outline(mx, my, cover)` gives the { ch, rim } of a partly covered cell.
// A cell is { x, y, ch, r, g, b }; uncovered cells are left out.
export function cellsFromPixels({ shade, ids, grid, paints, outline, seed = 0 }) {
  const w = grid.cols * SX;
  const h = grid.rows * SY;
  const minHits = grid.minHits ?? 3;
  const cells = [];
  for (let y = 0; y < grid.rows; y++) {
    for (let x = 0; x < grid.cols; x++) {
      let hits = 0, r = 0, g = 0, b = 0, mx = 0, my = 0;
      const votes = new Map();
      for (let j = 0; j < SY; j++) {
        const row = h - 1 - (y * SY + j);
        for (let i = 0; i < SX; i++) {
          const o = (row * w + x * SX + i) * 4;
          if (shade[o + 3] < 128) continue;
          hits++;
          r += shade[o];
          g += shade[o + 1];
          b += shade[o + 2];
          mx += (i + 0.5) / SX - 0.5;
          my += (j + 0.5) / SY - 0.5;
          const id = ids[o] >> 3;
          votes.set(id, (votes.get(id) ?? 0) + 1);
        }
      }
      if (hits < minHits) continue;
      r /= hits;
      g /= hits;
      b /= hits;
      const paint = paints[[...votes].reduce((a, v) => (v[1] > a[1] ? v : a))[0]] ?? paints[0];
      if (hits < N * 0.4 || paint.edge) {
        // The silhouette: an edge stroke, brighter where it faces the light.
        const o = outline(mx, my, hits / N);
        const t = 0.35 * o.rim;
        cells.push({ x, y, ch: o.ch, r: r * 0.85 + (255 - r * 0.85) * t, g: g * 0.85 + (255 - g * 0.85) * t, b: b * 0.85 + (255 - b * 0.85) * t });
        continue;
      }
      const light = clamp01(((r * 0.3 + g * 0.55 + b * 0.15) / 255 / paint.lum - paint.floor) * paint.gain);
      const rnd = hash(x, y, seed);
      const ch = paint.glint && light > 0.85 && rnd > 0.92 ? paint.glint : rampChar(paint.ramp, light, rnd);
      cells.push({ x, y, ch, r: Math.min(255, 24 + r * 1.3), g: Math.min(255, 24 + g * 1.3), b: Math.min(255, 24 + b * 1.3) });
    }
  }
  return cells;
}

export const FONT = '"Cascadia Mono", Consolas, Menlo, "DejaVu Sans Mono", monospace';

// Draws cells with letters `font` px tall onto a 2D context: first a
// near-black silhouette one cell wider than the item, then the letters,
// grouped by colour.
export function drawCells(ctx, cells, font) {
  const cw = font * ASPECT;
  ctx.fillStyle = 'rgb(3,4,7)';
  const dark = new Set();
  for (const { x, y } of cells) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) dark.add(`${x + dx},${y + dy}`);
  for (const at of dark) {
    const [x, y] = at.split(',').map(Number);
    ctx.fillRect(x * cw, y * font, cw, font);
  }
  ctx.font = `${font}px ${FONT}`;
  ctx.textBaseline = 'top';
  const groups = new Map();
  for (const c of cells) {
    const style = `rgb(${[c.r, c.g, c.b].map((v) => Math.round(v / 6) * 6).join(',')})`;
    if (!groups.has(style)) groups.set(style, []);
    groups.get(style).push(c);
  }
  for (const [style, group] of groups) {
    ctx.fillStyle = style;
    for (const c of group) ctx.fillText(c.ch, c.x * cw, c.y * font);
  }
}
