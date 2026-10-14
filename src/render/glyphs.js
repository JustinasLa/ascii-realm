// Every character the game can draw, rasterised once into a single texture.
// Glyphs are addressed by index; a cell stores its glyph in twelve bits.

import { ruleFor } from './ascii-rules.js';
import { PACKS } from './glyph-packs/index.js';

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
const PACK_BASE = BUD + 1;
const stepX = (i) => (i + 0.5) / STROKE_STEPS;
const stepY = (i) => (i + 0.5) / FLAT_STEPS;

// Detail glyphs come from packs (see glyph-packs/): each entry is drawn by
// its own function and found again by name. An entry may name its mirror
// image for reflections, or set `flip` to get an upside-down twin named
// `${name}~` drawn for it automatically.
const packed = [];
const byName = new Map();
function addPacked(entry) {
  if (byName.has(entry.name)) throw new Error(`Duplicate glyph name: ${entry.name}`);
  byName.set(entry.name, PACK_BASE + packed.length);
  packed.push(entry);
}
for (const pack of PACKS) {
  for (const entry of pack) {
    if (!entry.flip) {
      addPacked(entry);
      continue;
    }
    const twin = `${entry.name}~`;
    addPacked({ ...entry, mirror: twin });
    addPacked({ name: twin, mirror: entry.name, draw: (ctx, w, h) => {
      ctx.translate(0, h);
      ctx.scale(1, -1);
      entry.draw(ctx, w, h);
    } });
  }
}
export const GLYPH_COUNT = PACK_BASE + packed.length;
export const BLANK_GLYPH = 1;
export const GRASS_GLYPH = 2;

// A cell holds a base glyph and may hold a second one layered over it, like
// a flower over grass. Adding LAYER to a glyph asks any writer to stack it
// on top of the cell instead of replacing what is there.
export const GLYPH_BITS = 12;
export const LAYER = 1 << GLYPH_BITS;
export const GLYPH_MASK = LAYER - 1;
export const over = (g) => g | LAYER;
if (GLYPH_COUNT > LAYER) throw new Error('Too many glyphs for the cell format');

// A detail glyph by name. Unknown names throw, so a typo fails loudly.
export function dg(name) {
  const g = byName.get(name);
  if (g === undefined) throw new Error(`Unknown glyph: ${name}`);
  return g;
}

export const hasGlyph = (name) => byName.has(name);

// Every glyph whose name starts with the prefix, in pack order.
export function family(prefix) {
  const out = [];
  for (const [name, g] of byName) if (name.startsWith(prefix)) out.push(g);
  if (!out.length) throw new Error(`Unknown glyph family: ${prefix}`);
  return out;
}

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

// A reflection turns a glyph upside down: an upright stroke's bottom and top
// swap, and a pack glyph names the glyph that is its own mirror image.
export const MIRRORED = (() => {
  const table = new Uint16Array(LAYER * 2);
  for (let g = 0; g < table.length; g++) {
    const base = g & GLYPH_MASK;
    let m = base;
    if (base >= STROKE_BASE && base < FLAT_BASE) {
      const i = (base - STROKE_BASE) % (STROKE_STEPS * STROKE_STEPS);
      m = STROKE_BASE + (i % STROKE_STEPS) * STROKE_STEPS + Math.floor(i / STROKE_STEPS);
    } else if (base >= PACK_BASE && base < GLYPH_COUNT) {
      const mirror = packed[base - PACK_BASE].mirror;
      if (mirror) m = dg(mirror);
    }
    table[g] = m | (g & LAYER);
  }
  return table;
})();

// Atlas cells are padded so mipmapped sampling never bleeds a neighbour in.
const ATLAS_COLS = 32;
export const INNER_W = 30;
export const INNER_H = 50;
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

// Blossoms in the grass are a bold `*` and `o`: the regular weight is too
// faint to read at small cells.
function drawBlossoms(ctx, at, fontPx, fontFamily) {
  ctx.save();
  ctx.font = `bold ${fontPx}px ${fontFamily}`;
  for (const [g, ch] of [[BLOSSOM, '*'], [BUD, 'o']]) {
    const [ox, oy] = at(g);
    ctx.fillText(ch, ox + INNER_W / 2, oy + INNER_H / 2);
  }
  ctx.restore();
}

// Everything in the world except grass is drawn with real characters. Pack
// glyphs keep their names (and the code that picks them), but each one is
// shown as a character: the one an entry names with `ascii`, the one a rule
// below gives its family, or else the character whose shape matches the
// drawing best. A character drawn at partial strength keeps the drawing's
// brightness, so shading carried by grey glyphs survives.
const GRID_X = 6;
const GRID_Y = 10;
// Flower stems are drawn like the grass they grow in.
const DRAWN = /^flora\.stem\./;

// What a glyph is when cells are written: a cell shows one character, so a
// glyph layered over another replaces it, except where grass grows over
// grass; a blank glyph layered over a cell leaves it as it was.
export const GLYPH_KIND = (() => {
  const kind = new Uint8Array(GLYPH_COUNT);
  kind[0] = BLANK_GLYPH;
  for (let g = STROKE_BASE; g < BLOSSOM; g++) kind[g] = GRASS_GLYPH;
  packed.forEach((entry, k) => {
    if (DRAWN.test(entry.name)) kind[PACK_BASE + k] = GRASS_GLYPH;
    else if ((entry.ascii ?? ruleFor(entry.name)) === '') kind[PACK_BASE + k] = BLANK_GLYPH;
  });
  return kind;
})();

function cellFeatures(data, width, ox, oy) {
  const out = new Float32Array(GRID_X * GRID_Y);
  const bw = INNER_W / GRID_X;
  const bh = INNER_H / GRID_Y;
  for (let gy = 0; gy < GRID_Y; gy++) {
    for (let gx = 0; gx < GRID_X; gx++) {
      let sum = 0;
      let n = 0;
      for (let y = Math.floor(gy * bh); y < Math.floor((gy + 1) * bh); y++) {
        for (let x = Math.floor(gx * bw); x < Math.floor((gx + 1) * bw); x++) {
          sum += data[((oy + y) * width + ox + x) * 4];
          n++;
        }
      }
      out[gy * GRID_X + gx] = sum / n / 255;
    }
  }
  return out;
}

const FLIP_CHAR = { '/': '\\', '\\': '/', ',': "'", "'": ',', '.': "'", v: '^', '^': 'v', u: 'n', n: 'u', m: 'w', w: 'm' };

function asciify(ctx, at, canvas, fontPx, fontFamily) {
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const features = (g) => cellFeatures(data, canvas.width, ...at(g));
  const chars = [];
  for (let i = 1; i < ASCII.length; i++) {
    const f = features(i);
    let peak = 0;
    for (const v of f) peak = Math.max(peak, v);
    if (peak > 0) chars.push({ ch: ASCII[i], f: f.map((v) => v / peak) });
  }
  const chosen = new Map();
  const choose = (k) => {
    const entry = packed[k];
    if (chosen.has(entry.name)) return chosen.get(entry.name);
    if (DRAWN.test(entry.name)) {
      chosen.set(entry.name, null);
      return null;
    }
    const f = features(PACK_BASE + k);
    let peak = 0;
    for (const v of f) peak = Math.max(peak, v);
    let ch = entry.ascii;
    if (ch === undefined) ch = ruleFor(entry.name);
    // A highlight layered over a glyph is its own character, recoloured.
    if (ch === undefined && entry.name.endsWith('.hi') && byName.has(entry.name.slice(0, -3))) {
      ch = choose(byName.get(entry.name.slice(0, -3)) - PACK_BASE).ch;
    }
    if (ch !== undefined && entry.name.endsWith('~') && entry.ascii === undefined) ch = FLIP_CHAR[ch] ?? ch;
    if (ch === undefined) {
      ch = '';
      if (peak > 0.03) {
        let best = Infinity;
        for (const c of chars) {
          let err = 0;
          for (let i = 0; i < f.length; i++) {
            const d = f[i] / peak - c.f[i];
            err += d * d;
          }
          if (err < best) {
            best = err;
            ch = c.ch;
          }
        }
      }
    }
    const result = { ch, strength: Math.min(1, Math.max(0.35, peak * 1.15)) };
    chosen.set(entry.name, result);
    return result;
  };
  const picks = packed.map((_, k) => choose(k));
  ctx.save();
  ctx.font = `${fontPx}px ${fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  picks.forEach((pick, k) => {
    if (!pick) return;
    const { ch, strength } = pick;
    const [ox, oy] = at(PACK_BASE + k);
    ctx.fillStyle = '#000';
    ctx.fillRect(ox - PAD, oy - PAD, INNER_W + PAD * 2, INNER_H + PAD * 2);
    if (!ch) return;
    const v = Math.round(strength * 255);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.fillText(ch, ox + INNER_W / 2, oy + INNER_H / 2);
  });
  ctx.restore();
  return new Map(packed.map((entry, k) => [entry.name, picks[k]?.ch ?? null]));
}

// Pack glyphs draw in their own inner-cell coordinates, 0..INNER_W across
// and 0..INNER_H down, in white; grey fills draw a glyph at partial strength.
// Only glyphs shown as drawn, or matched to a character by their drawing,
// need drawing: the rest already know their character.
function drawPacks(ctx, at) {
  packed.forEach((entry, k) => {
    const hi = entry.name.endsWith('.hi') && byName.has(entry.name.slice(0, -3));
    if (!DRAWN.test(entry.name) && (entry.ascii !== undefined || ruleFor(entry.name) !== undefined || hi)) return;
    inCell(ctx, at, PACK_BASE + k, (ox, oy) => {
      ctx.translate(ox, oy);
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#fff';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 4;
      entry.draw(ctx, INNER_W, INNER_H);
    });
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
  drawBlossoms(ctx, at, fontPx, fontFamily);
  drawPacks(ctx, at);
  const ascii = asciify(ctx, at, canvas, fontPx, fontFamily);

  return { canvas, cols: ATLAS_COLS, rows, cellW, cellH, pad: PAD, ascii };
}
