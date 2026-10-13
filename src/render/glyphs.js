// Every character the game can draw, rasterised once into a single texture.
// Glyphs are addressed by index so a cell can store its character in one byte.

const ASCII = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');
export const GLYPHS = ASCII + '≈·°';

const indexOf = new Map([...GLYPHS].map((ch, i) => [ch, i]));

export function glyph(ch) {
  return indexOf.get(ch) ?? 0;
}

// Atlas cells are padded so mipmapped sampling never bleeds a neighbour in.
const ATLAS_COLS = 16;
const INNER_W = 30;
const INNER_H = 50;
const PAD = 6;

export function buildAtlas(fontFamily) {
  const cellW = INNER_W + PAD * 2;
  const cellH = INNER_H + PAD * 2;
  const rows = Math.ceil(GLYPHS.length / ATLAS_COLS);

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

  return { canvas, cols: ATLAS_COLS, rows, cellW, cellH, pad: PAD };
}
