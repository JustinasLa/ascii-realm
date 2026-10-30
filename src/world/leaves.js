import { hash2 } from '../core/rng.js';
import { dg } from '../render/glyphs.js';
import { turnOf } from './prop-art.js';
import { treeWind, windGust } from './wind.js';

// A falling leaf tumbles: it turns through eight headings and, twice a
// turn, is seen edge-on as a thin sliver. Petals spin flatter and faster.
const LEAF = Array.from({ length: 8 }, (_, h) => dg(`tree.fall.${h}`));
const EDGE = Array.from({ length: 4 }, (_, h) => dg(`tree.fall.edge.${h}`));
const PETAL = Array.from({ length: 4 }, (_, h) => dg(`tree.fall.petal.${h}`));
// Autumn leaves fall in the colours of the turning crowns.
const AUTUMN = [[218, 164, 65], [214, 112, 46], [188, 70, 44], [226, 196, 84]];

export function fallingGlyph(age, spin, blossom) {
  const turn = age * spin;
  if (blossom) return PETAL[((Math.floor(turn * 4) % 4) + 4) % 4];
  const step = ((Math.floor(turn * 8) % 8) + 8) % 8;
  // Edge-on for a moment as the leaf flips over.
  if (step % 4 === 1 && (turn * 8) % 1 < 0.5) return EDGE[(step >> 1) & 3];
  return LEAF[step];
}
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
    if ((prop.kind !== 'tree' && prop.kind !== 'bush') || prop.species === 'pine' || prop.species === 'spruce') continue;
    // A leaf born before its tree turned to another season (see
    // season-turn.js) is the old season's, from the old crown.
    const turn = turnOf(prop);
    if ((prop.season === 'winter' && !turn) || !prop.cells?.length) continue;

    const bx = Math.floor(prop.x);
    const by = Math.floor(prop.y);
    // Leaves stay between their canopy and the ground at the tree's base.
    if (by < view.y0 || by + (prop.top ?? -prop.height) >= view.y0 + view.rows) continue;

    const phase = prop.phase ?? 0;

    for (let slot = 0; slot < 2; slot++) {
      const slotSeed = seed + 2801 + slot * 131;
      const period = 10 + hash2(bx, by, slotSeed) * 15;
      const clock = t + hash2(bx, by, slotSeed + 1) * period + phase;
      const cycle = Math.floor(clock / period);
      const age = clock - cycle * period;
      const cycleSeed = slotSeed + Math.imul(cycle, 1931);
      const life = 4 + hash2(bx, by, cycleSeed + 2) * 4;
      const old = turn !== null && t - age < turn.at;
      const season = old ? turn.from : prop.season;
      const autumn = season === 'autumn';
      const blossom = prop.species === 'cherry' && season === 'spring';
      const chance = autumn ? 1 : blossom ? 0.8 : season === 'spring' ? 0.5 : 0.3;
      if (season === 'winter' || age >= life || hash2(bx, by, cycleSeed + 3) > chance) continue;
      const cells = old ? turn.cells : prop.cells;

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
      const color = autumn ? AUTUMN[Math.floor(hash2(bx, by, cycleSeed + 6) * AUTUMN.length)]
        : old ? turn.leafColor : prop.leafColor;
      const cr = blossom ? 244 : color ? color[0] : 86;
      const cg = blossom ? 178 : color ? color[1] : 132;
      const cb = blossom ? 204 : color ? color[2] : 73;
      // Each leaf spins at its own rate, one way or the other.
      const spin = (hash2(bx, by, cycleSeed + 7) - 0.5) * 1.6;
      r.put(sx, sy, fallingGlyph(age, spin + Math.sign(spin) * 0.35, blossom),
        cr * light, cg * light, cb * light);
    }
  }
}
