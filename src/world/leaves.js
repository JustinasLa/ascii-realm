import { hash2 } from '../core/rng.js';
import { glyph } from '../render/glyphs.js';
import { treeWind, windGust } from './wind.js';

const LEAF = glyph('.');
const AUTUMN_LEAF = glyph("'");
const BLOSSOM = glyph('*');
// Eight seconds of gust drift, flutter, and the displaced birth cell.
export const MAX_LEAF_DRIFT = 14;

// Two fixed slots per tree, evaluated from world time rather than updated
// particles. Returning to a grove reveals the same leaves already in flight;
// drawing never adds objects to a pool or changes the generated tree cells.
export function drawLeaves(r, view, props, t, seed = 1) {
  // A single prop lets the painter draw its leaves at the same depth without
  // creating a temporary array; an array remains useful for previews/tests.
  const list = Array.isArray(props);
  const count = list ? props.length : 1;
  for (let i = 0; i < count; i++) {
    const prop = list ? props[i] : props;
    if (prop.kind !== 'tree' || prop.season === 'winter' ||
        prop.species === 'pine' || prop.species === 'spruce') continue;
    const cells = prop.cells;
    if (!cells || cells.length === 0) continue;

    const bx = Math.floor(prop.x);
    const by = Math.floor(prop.y);
    // Leaves stay between their canopy and the ground at the tree's base.
    if (by < view.y0 || by + (prop.top ?? -prop.height) >= view.y0 + view.rows) continue;

    const autumn = prop.season === 'autumn';
    const blossom = prop.species === 'cherry' && prop.season === 'spring';
    const chance = autumn ? 1 : blossom ? 0.8 : prop.season === 'spring' ? 0.5 : 0.3;
    const phase = prop.phase ?? 0;

    for (let slot = 0; slot < 2; slot++) {
      const slotSeed = seed + 2801 + slot * 131;
      const period = 10 + hash2(bx, by, slotSeed) * 15;
      const clock = t + hash2(bx, by, slotSeed + 1) * period + phase;
      const cycle = Math.floor(clock / period);
      const age = clock - cycle * period;
      const cycleSeed = slotSeed + Math.imul(cycle, 1931);
      const life = 4 + hash2(bx, by, cycleSeed + 2) * 4;
      if (age >= life || hash2(bx, by, cycleSeed + 3) > chance) continue;

      // Search from a hashed index without creating a separate foliage list.
      // An origin always belongs to the baked canopy, never a trunk or gap.
      const first = Math.floor(hash2(bx, by, cycleSeed + 4) * cells.length);
      let origin = null;
      for (let n = 0; n < cells.length; n++) {
        const cell = cells[(first + n) % cells.length];
        if (cell.foliage && cell.dy < 0) {
          origin = cell;
          break;
        }
      }
      if (!origin) continue;

      const born = t - age;
      const ox = bx + origin.dx + Math.round(treeWind(prop, born, seed) * origin.flex);
      const oy = by + origin.dy;
      const progress = age / life;

      // Simpson sampling gives a smooth, stateless approximation of travel
      // through the same passing gusts that lean the grass and tree crowns.
      const startWind = windGust(seed, ox, oy, born);
      const midWind = windGust(seed, ox, oy, born + age * 0.5);
      const endWind = windGust(seed, ox, oy, t);
      const drift = age * ((startWind + midWind * 4 + endWind) / 6 - 0.5) * 2.4;
      const flutter = phase + hash2(bx, by, cycleSeed + 5) * Math.PI * 2;
      const wx = ox + drift + (Math.sin(age * 2 + flutter) - Math.sin(flutter)) * 0.65;
      const wy = Math.min(by - 0.25, oy + (by - 0.25 - oy) * Math.pow(progress, 1.1));
      const sx = Math.floor(wx) - view.x0;
      const sy = Math.floor(wy) - view.y0;
      if (sx < 0 || sy < 0 || sx >= view.cols || sy >= view.rows) continue;

      const fade = Math.min(1, (1 - progress) * 4);
      if (fade < 0.04) continue;
      const light = fade * (0.85 + Math.sin(age * 2.5 + flutter) * 0.1);
      const color = prop.leafColor;
      const cr = blossom ? 244 : autumn ? 218 : color ? color[0] : 86;
      const cg = blossom ? 163 : autumn ? 164 : color ? color[1] : 132;
      const cb = blossom ? 190 : autumn ? 65 : color ? color[2] : 73;
      r.put(sx, sy, blossom ? BLOSSOM : autumn ? AUTUMN_LEAF : LEAF,
        cr * light, cg * light, cb * light);
    }
  }
}
