// Every character the game can draw, rasterised once into a single texture.
// Glyphs are addressed by index so a cell can store its character in one byte.

const ASCII = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');
export const GLYPHS = ASCII + '≈·°';

const indexOf = new Map([...GLYPHS].map((ch, i) => [ch, i]));

export function glyph(ch) {
  return indexOf.get(ch) ?? 0;
}

// Grass blades use drawn strokes after the font glyphs. A font's `/` or `|`
// stops short of the cell edges, so stacked rows read as dashes; these run
// edge to edge, letting several rows join into one long, separate blade.
// Upright strokes cross from a point on the bottom edge to one on the top
// edge, with long and short tapered variants for the tip, so neighbouring
// blades end at different heights; flat strokes cross sideways.
export const STROKE_STEPS = 6;
const FLAT_STEPS = 3;
const STROKE_BASE = GLYPHS.length;
const TIP_BASE = STROKE_BASE + STROKE_STEPS * STROKE_STEPS;
const SHORT_BASE = TIP_BASE + STROKE_STEPS * STROKE_STEPS;
const FLAT_BASE = SHORT_BASE + STROKE_STEPS * STROKE_STEPS;
// Bold blossoms: a font's `*` and `o` are too faint to read at small cells.
export const BLOSSOM = FLAT_BASE + FLAT_STEPS * FLAT_STEPS;
export const BUD = BLOSSOM + 1;
const GLYPH_COUNT = BUD + 1;
const stepX = (i) => (i + 0.5) / STROKE_STEPS;
const stepY = (i) => (i + 0.5) / FLAT_STEPS;

// bottom/top: 0..STROKE_STEPS-1 from the left edge of the cell.
// tip: 0 for a joining stroke, 1 for a tip at the top, 2 for one mid-cell.
export function strokeGlyph(bottom, top, tip = 0) {
  return STROKE_BASE + (tip * STROKE_STEPS + bottom) * STROKE_STEPS + top;
}

// left/right: 0..2 from the top edge of the cell.
export function flatGlyph(left, right) {
  return FLAT_BASE + left * FLAT_STEPS + right;
}

export const FLAT_GLYPHS = Array.from({ length: FLAT_STEPS * FLAT_STEPS }, (_, i) => FLAT_BASE + i);

// A reflection turns an upright stroke upside down: its bottom and top swap.
export const MIRRORED = Uint8Array.from({ length: GLYPH_COUNT }, (_, g) => {
  if (g < STROKE_BASE || g >= FLAT_BASE) return g;
  const i = (g - STROKE_BASE) % (STROKE_STEPS * STROKE_STEPS);
  return STROKE_BASE + (i % STROKE_STEPS) * STROKE_STEPS + Math.floor(i / STROKE_STEPS);
});

// Atlas cells are padded so mipmapped sampling never bleeds a neighbour in.
const ATLAS_COLS = 16;
const INNER_W = 30;
const INNER_H = 50;
const PAD = 6;
// Strokes fill the padding too, so mipmaps keep the joins between rows solid.
const REACH = PAD;
const BLADE_WIDTH = 17;

// Draws one glyph clipped to its own padded atlas cell: a thick stroke near
// the cell edge must not leave a sliver in the neighbouring glyph.
function inCell(ctx, at, g, draw) {
  const [ox, oy] = at(g);
  ctx.save();
  ctx.beginPath();
  ctx.rect(ox - PAD, oy - PAD, INNER_W + PAD * 2, INNER_H + PAD * 2);
  ctx.clip();
  ctx.beginPath();
  draw(ox, oy);
  ctx.restore();
}

function drawStrokes(ctx, at) {
  ctx.strokeStyle = '#fff';
  ctx.lineCap = 'butt';
  const half = BLADE_WIDTH / 2;
  for (let b = 0; b < STROKE_STEPS; b++) {
    for (let t = 0; t < STROKE_STEPS; t++) {
      const x0 = stepX(b) * INNER_W;
      const x1 = stepX(t) * INNER_W;
      const ext = (x1 - x0) / INNER_H * REACH;
      inCell(ctx, at, strokeGlyph(b, t), (ox, oy) => {
        ctx.lineWidth = BLADE_WIDTH;
        ctx.moveTo(ox + x0 - ext, oy + INNER_H + REACH);
        ctx.lineTo(ox + x1 + ext, oy - REACH);
        ctx.stroke();
      });
      // Tips narrow to a point near the top edge, or halfway up the cell.
      for (const [tip, reach] of [[1, 0.9], [2, 0.5]]) {
        inCell(ctx, at, strokeGlyph(b, t, tip), (ox, oy) => {
          const tipX = ox + x0 + (x1 - x0) * reach;
          const tipY = oy + INNER_H * (1 - reach);
          ctx.moveTo(ox + x0 - ext - half, oy + INNER_H + REACH);
          ctx.lineTo(ox + x0 - ext + half, oy + INNER_H + REACH);
          ctx.lineTo(tipX + half * 0.45, tipY);
          ctx.lineTo(tipX - half * 0.45, tipY);
          ctx.closePath();
          ctx.fill();
        });
      }
    }
  }
  for (let l = 0; l < FLAT_STEPS; l++) {
    for (let r = 0; r < FLAT_STEPS; r++) {
      const y0 = stepY(l) * INNER_H;
      const y1 = stepY(r) * INNER_H;
      const ext = (y1 - y0) / INNER_W * REACH;
      inCell(ctx, at, flatGlyph(l, r), (ox, oy) => {
        ctx.lineWidth = BLADE_WIDTH * 0.8;
        ctx.moveTo(ox - REACH, oy + y0 - ext);
        ctx.lineTo(ox + INNER_W + REACH, oy + y1 + ext);
        ctx.stroke();
      });
    }
  }
}

function drawBlossoms(ctx, at) {
  ctx.lineCap = 'round';
  inCell(ctx, at, BLOSSOM, (ox, oy) => {
    const cx = ox + INNER_W / 2;
    const cy = oy + INNER_H / 2;
    ctx.lineWidth = 6;
    for (let k = 0; k < 3; k++) {
      const a = k * Math.PI / 3 + Math.PI / 2;
      ctx.moveTo(cx - Math.cos(a) * 11, cy - Math.sin(a) * 11);
      ctx.lineTo(cx + Math.cos(a) * 11, cy + Math.sin(a) * 11);
    }
    ctx.stroke();
  });
  inCell(ctx, at, BUD, (ox, oy) => {
    ctx.lineWidth = 5;
    ctx.arc(ox + INNER_W / 2, oy + INNER_H / 2, 8, 0, Math.PI * 2);
    ctx.stroke();
  });
}

export function buildAtlas(fontFamily) {
  const cellW = INNER_W + PAD * 2;
  const cellH = INNER_H + PAD * 2;
  const rows = Math.ceil(GLYPH_COUNT / ATLAS_COLS);

  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLS * cellW;
  canvas.height = rows * cellH;
  const ctx = canvas.getContext('2d');

  // Fit the font so its advance width fills the inner cell like a terminal.
  ctx.font = `100px ${fontFamily}`;
  const advance = ctx.measureText('M').width / 100;
  const fontPx = Math.min(INNER_H * 0.92, INNER_W / advance);

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff';
  ctx.font = `${fontPx}px ${fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  [...GLYPHS].forEach((ch, i) => {
    const x = (i % ATLAS_COLS) * cellW + cellW / 2;
    const y = Math.floor(i / ATLAS_COLS) * cellH + cellH / 2;
    ctx.fillText(ch, x, y);
  });
  const at = (g) => [(g % ATLAS_COLS) * cellW + PAD, Math.floor(g / ATLAS_COLS) * cellH + PAD];
  drawStrokes(ctx, at);
  drawBlossoms(ctx, at);

  return { canvas, cols: ATLAS_COLS, rows, cellW, cellH, pad: PAD };
}
