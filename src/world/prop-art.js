import { hash2 } from '../core/rng.js';
import { dg, glyph, over } from '../render/glyphs.js';
import { ASPECT } from './world.js';

// Turns a prop's sampled surface into cells. A sampler is called with a
// point in physical row units, measured from the prop's base, and returns
// null for empty space or a surface:
//   m   material: 'stone', 'bark', 'barkh', 'birch', 'plank', 'plankh',
//       'cut' (end grain), 'canvas', 'iron', 'char', 'flame', 'leaf',
//       'needle', 'plain' (any other name falls back to 'plain')
//   l   light on the surface, 0 (turned from the moon) to 1 (lit)
//   c   base colour, shaded here by the light
//   g   optional glyph that overrides the material's texture
//   acc optional accent { g, c } layered over the cell (moss, a nail...)
//   depth optional projected ground row, relative to the prop's anchor
// Fully covered cells get a texture chosen by material and light and a dark
// background in the material's own colour, so a form reads as one solid
// mass. Partly covered cells become outline glyphs pointing at the solid
// side, so silhouettes stay crisp instead of ending in loose letters.

// Trees and rocks can also be baked in small letters for the renderer's
// fine grid (see fine-bakes.js). The recipe is kept beside the prop rather
// than on it, so props stay plain data that can be compared, cloned and
// saved. A recipe is a generator function: it may pause (yield) between
// steps of a long bake, and returns the finished cells. The source is plain
// data a worker can rebuild the same prop from (see rebuildProp).
const fineRecipes = new WeakMap();
const fineSources = new WeakMap();

// Gives a prop a recipe for its fine bake and the source it was made from.
export function withFine(prop, bake, source = null) {
  fineRecipes.set(prop, bake);
  if (source) fineSources.set(prop, source);
  else fineSources.delete(prop);
  return prop;
}

export const fineRecipe = (prop) => fineRecipes.get(prop);
export const fineSource = (prop) => fineSources.get(prop) ?? null;

// A random stream that remembers what it drew, so the same draws can be
// replayed to make the same prop again.
export function recording(rand) {
  const draws = [];
  return { draws, random: () => {
    const v = rand();
    draws.push(v);
    return v;
  } };
}

export function replaying(draws) {
  let i = 0;
  return () => draws[i++];
}

const SUB_X = [0.25, 0.75];
const SUB_Y = [1 / 6, 3 / 6, 5 / 6];
const FINE_X = [0.125, 0.375, 0.625, 0.875];
const FINE_Y = [1 / 12, 3 / 12, 5 / 12, 7 / 12, 9 / 12, 11 / 12];

let tables = null;
function glyphs() {
  if (tables) return tables;
  const fam = (prefix, a, b) => Array.from({ length: a }, (_, i) => Array.from({ length: b }, (_, j) => dg(`${prefix}.${i}.${j}`)));
  tables = {
    stone: fam('props.stone', 5, 6),
    bark: fam('props.bark', 4, 4),
    barkh: fam('props.barkh', 4, 4),
    birch: [Array.from({ length: 4 }, (_, i) => dg(`props.birch.${i}`))],
    plank: fam('props.grainv', 4, 4),
    plankh: fam('props.grainh', 4, 4),
    canvas: fam('props.canvas', 4, 4),
    leaf: fam('props.leaves', 4, 4),
    needle: fam('props.needles', 4, 3),
    char: [Array.from({ length: 3 }, (_, i) => dg(`props.char.${i}`))],
    flame: [Array.from({ length: 4 }, (_, i) => dg(`props.flame.${i}`))],
    iron: [[dg('props.hoop.0')]],
    plain: [[dg('block.full')]],
    cutS: fam('props.cut.s', 8, 3),
    cutR: fam('props.cut.r', 8, 3),
    strip: fam('props.strip', 4, 2),
    ring: fam('props.ring', 8, 3),
    ringCore: [0, 1, 2].map((i) => dg(`props.ringcore.${i}`)),
    shade: [0, 1, 2].map((i) => dg(`props.shade.${i}`)),
  };
  tables.cut = tables.ring;
  return tables;
}

// How bright a material's background is relative to its colour: enough to
// close the gaps of the texture without flattening it.
const BACK = { stone: 0.3, bark: 0.26, barkh: 0.26, birch: 0.34, plank: 0.34, plankh: 0.34, cut: 0.42,
  canvas: 0.3, leaf: 0.18, needle: 0.16, char: 0.2, flame: 0.45, iron: 0.3, plain: 0.3 };
// Materials whose outline is broken and rocky rather than clean.
const ROUGH = new Set(['stone', 'bark', 'barkh', 'char', 'leaf', 'needle']);

const clamp = (v) => Math.max(0, Math.min(255, v));
const tone = (c, l, k = 1) => [clamp(c[0] * l * k), clamp(c[1] * l * k), clamp(c[2] * l * k)];
const pick = (row, seed, dx, dy) => row[Math.floor(hash2(dx, dy, seed) * row.length)];

// The ring glyph for a point of end grain, by the direction to the pith.
export function ringGlyph(dirX, dirY, seed = 0, dx = 0, dy = 0) {
  const t = glyphs();
  if (Math.hypot(dirX, dirY) < 0.35) return t.ringCore[Math.floor(hash2(dx, dy, seed + 3) * 3)];
  const d = (Math.round(Math.atan2(dirY, dirX) / (Math.PI / 4)) + 8) % 8;
  return pick(t.ring[d], seed, dx, dy);
}

function texture(m, l, seed, dx, dy) {
  const t = glyphs();
  const family = t[m] ?? t.plain;
  const level = Math.max(0, Math.min(family.length - 1, Math.floor(l * family.length)));
  return pick(family[level], seed, dx, dy);
}

function dominant(samples) {
  let best = null;
  let count = 0;
  const seen = new Map();
  for (const s of samples) {
    if (!s) continue;
    const n = (seen.get(s.m) ?? 0) + 1;
    seen.set(s.m, n);
    if (n > count) { count = n; best = s.m; }
  }
  return best;
}

// Average light and colour of the samples of one material.
function average(samples, m) {
  let l = 0, r = 0, g = 0, b = 0, n = 0;
  for (const s of samples) {
    if (!s || s.m !== m) continue;
    l += s.l; r += s.c[0]; g += s.c[1]; b += s.c[2]; n++;
  }
  return { l: l / n, c: [r / n, g / n, b / n] };
}

// Every prop cell has the same shape, so the per-frame draw loop sees one
// kind of object; a cell that keeps the ground behind it has no background.
export function makeCell(dx, dy, g, r, gg, b, br = undefined, bgG = undefined, bb = undefined, depth = undefined) {
  const cell = { dx, dy, g, r, gg, b, br, bgG, bb };
  if (Number.isFinite(depth)) cell.depth = depth;
  return cell;
}

// Light shapes a material's colour from 55% in shadow to 115% fully lit.
const shine = (l) => 0.4 + l * 0.66;

// Bakes every cell from column -w to w and row top to bottom. With
// `shadow`, the prop also darkens the ground around its base: an ellipse
// { rx, ry, ox } in physical units, pushed away from the moon.
export function bakeSurface(w, top, bottom, sample, seed, { shadow, extras, x0 = -w, x1 = w } = {}) {
  const t = glyphs();
  const cells = [];
  const filled = new Set();
  for (let dy = top; dy <= bottom; dy++) {
    for (let dx = x0; dx <= x1; dx++) {
      const at = (fx, fy) => {
        const s = sample((dx + fx - 0.5) * ASPECT, dy + fy - 1);
        if (s && s.m === undefined) s.m = 'plain';
        return s;
      };
      const coarse = [];
      let hits = 0;
      for (const fy of SUB_Y) for (const fx of SUB_X) {
        const s = at(fx, fy);
        coarse.push(s);
        if (s) hits++;
      }
      let samples = coarse;
      let cover = hits / 6;
      let cx = 0, cy = 0, sxx = 0, syy = 0, sxy = 0;
      if (hits > 0 && hits < 6) {
        // Measure the edge finely: how much is covered, and on which side.
        samples = [];
        let n = 0;
        for (const fy of FINE_Y) for (const fx of FINE_X) {
          const s = at(fx, fy);
          samples.push(s);
          if (!s) continue;
          n++;
          const x = (fx - 0.5) * ASPECT;
          const y = fy - 0.5;
          cx += x; cy += y; sxx += x * x; syy += y * y; sxy += x * y;
        }
        cover = n / 24;
        if (n) { cx /= n; cy /= n; sxx = sxx / n - cx * cx; syy = syy / n - cy * cy; sxy = sxy / n - cx * cy; }
      }
      if (cover < 0.2) continue;
      const m = dominant(samples);
      const { l, c } = average(samples, m);
      // The sample nearest the middle of the cell decides overrides.
      const mid = coarse[2] ?? coarse[3] ?? samples.find((s) => s && s.m === m);
      const k = mid.k ?? shine(l);
      const colour = tone(mid.c ?? c, 1, k);
      let g;
      let back = false;
      if (cover > 0.85) {
        g = mid.g ?? texture(m, mid.l ?? l, seed, dx, dy);
        back = true;
      } else if (Math.hypot(cx, cy) < 0.07 && cover < 0.75) {
        // A thin strand through the middle: follow its long axis.
        const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
        const a = (Math.round(-angle / (Math.PI / 4)) + 4) % 4;
        g = t.strip[[0, 1, 2, 3][a]][cover > 0.5 ? 1 : 0];
      } else {
        const d = (Math.round(Math.atan2(cy, cx) / (Math.PI / 4)) + 8) % 8;
        const level = cover < 0.42 ? 0 : cover < 0.63 ? 1 : 2;
        g = (ROUGH.has(m) ? t.cutR : t.cutS)[d][level];
      }
      const cell = makeCell(dx, dy, g, colour[0], colour[1], colour[2], undefined, undefined, undefined, mid.depth);
      if (back) {
        const kb = mid.back ?? BACK[m] ?? 0.3;
        cell.br = colour[0] * kb;
        cell.bgG = colour[1] * kb;
        cell.bb = colour[2] * kb + 2;
        filled.add(`${dx},${dy}`);
      }
      cells.push(cell);
      const acc = mid.acc ?? samples.find((s) => s?.acc)?.acc;
      if (acc && (back || acc.edge)) cells.push(makeCell(dx, dy, over(acc.g), acc.c[0], acc.c[1], acc.c[2],
        undefined, undefined, undefined, cell.depth));
    }
  }
  if (extras) {
    // Loose bits on the ground beside the prop, layered over the ground.
    const taken = new Set(cells.map((c) => `${c.dx},${c.dy}`));
    for (const e of extras) {
      const key = `${e.dx},${e.dy}`;
      if (taken.has(key)) continue;
      taken.add(key);
      cells.push(makeCell(e.dx, e.dy, over(e.g), e.c[0], e.c[1], e.c[2]));
    }
  }
  if (shadow) castShadow(cells, filled, shadow, seed);
  return cells;
}

// A soft contact shadow on the ground around the base, darker toward the
// middle and cast down and to the right, away from the moon.
function castShadow(cells, filled, { rx, ry, ox = 0.25 * rx, oy = 0.1 }, seed) {
  const t = glyphs();
  const taken = new Set(cells.map((c) => `${c.dx},${c.dy}`));
  const w = Math.ceil((rx + Math.abs(ox)) / ASPECT) + 1;
  for (let dy = -1; dy <= Math.ceil(ry + oy) + 1; dy++) {
    for (let dx = -w; dx <= w; dx++) {
      if (taken.has(`${dx},${dy}`)) continue;
      const nx = (dx * ASPECT - ox) / rx;
      const ny = (dy - 0.5 - oy) / ry;
      const d = nx * nx + ny * ny + (hash2(dx, dy, seed + 5) - 0.5) * 0.25;
      if (d >= 1) continue;
      const k = d < 0.35 ? 2 : d < 0.7 ? 1 : 0;
      cells.push(makeCell(dx, dy, over(t.shade[k]), 3, 4, 10));
    }
  }
}

// Composes a sprite glyph by glyph: each spot keeps one base glyph and one
// glyph layered over it, so later strokes replace earlier ones cleanly.
export class Sprite {
  constructor() {
    this.spots = new Map();
  }

  spot(dx, dy) {
    const key = `${dx},${dy}`;
    let s = this.spots.get(key);
    if (!s) this.spots.set(key, s = { dx, dy, base: null, top: null });
    return s;
  }

  // c is an rgb triple; `back` darkens the ground behind a solid cell.
  put(dx, dy, g, c, back = 0) {
    const s = this.spot(dx, dy);
    s.base = back ? makeCell(dx, dy, g, clamp(c[0]), clamp(c[1]), clamp(c[2]), c[0] * back, c[1] * back, c[2] * back + 2)
      : makeCell(dx, dy, g, clamp(c[0]), clamp(c[1]), clamp(c[2]));
    s.top = null;
  }

  layer(dx, dy, g, c) {
    this.spot(dx, dy).top = makeCell(dx, dy, over(g), clamp(c[0]), clamp(c[1]), clamp(c[2]));
  }

  has(dx, dy) {
    return !!this.spots.get(`${dx},${dy}`)?.base;
  }

  cells() {
    const out = [];
    for (const s of this.spots.values()) {
      if (s.base) out.push(s.base);
      if (s.top) out.push(s.top);
    }
    return out;
  }
}

// Measures the extent of a list of cells.
export function cellBounds(cells) {
  let minX = 0, maxX = 0, minY = 0, maxY = 0;
  for (const c of cells) {
    if (c.dx < minX) minX = c.dx;
    if (c.dx > maxX) maxX = c.dx;
    if (c.dy < minY) minY = c.dy;
    if (c.dy > maxY) maxY = c.dy;
  }
  return { minX, maxX, minY, maxY };
}

export const G = (name) => dg(name);
export const F = (ch) => glyph(ch);
