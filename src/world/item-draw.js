import { ITEMS } from '../inventory/items.js';
import { putCell } from '../render/cells.js';
import { glyph } from '../render/glyphs.js';

const GLINT = glyph('+');
const BLADES = [...'\\|/'].map(glyph);
const STUBBLE = [..."'`,"].map(glyph);
const BERRY = glyph('o');
const BERRY_PIPS = glyph(':');

// Several leafy lobes leave gaps around the woody forks. The exposed stems
// and paired ripe fruit distinguish this plant from the ground's moss.
const BUSH_CANOPY = [
  '     .v.     ',
  '   ,vOvO,    ',
  ' ,vOO OOvOv, ',
  'vOOvOxOxOOxOv',
  ' xOOv v OvO, ',
  '  vOx   Ov   ',
  '    vOxv     ',
].flatMap((row, i) => [...row].flatMap((ch, x) => ch === ' ' ? [] : [{
  dx: x - 6, dy: i - 8, g: glyph(ch), edge: '.,v'.includes(ch),
}]));

const BUSH_STEMS = [
  [-1, 0, '/'], [0, 0, '|'], [1, 0, '\\'],
  [-1, -1, '/'], [0, -1, '|'], [1, -1, '\\'],
  [-1, -2, '/'], [0, -2, '|'], [1, -2, '\\'],
  [-2, -3, '/'], [0, -3, '|'], [2, -3, '\\'],
  [-3, -4, '/'], [0, -4, '|'], [3, -4, '\\'],
  [-3, -5, '|'], [-1, -5, '/'], [1, -5, '\\'], [3, -5, '|'],
  [-4, -6, '/'], [0, -6, '|'], [4, -6, '\\'],
  [-1, -7, '/'], [1, -7, '\\'],
].map(([dx, dy, ch]) => ({ dx, dy, g: glyph(ch) }));

// Each site has room for a round berry and a pair of smaller fruit beside
// it. Counts select distinct sites, so the visible harvest matches the food.
const BERRY_SITES = [[-3, -6], [2, -6], [-5, -5], [4, -5], [-2, -4], [2, -3], [0, -2]];

// A reflected cell can land below the view even when its source is above
// it. Include that destination range (and the water's sideways sway) when
// a sprite is sent to a different writer.
function visible(r, x, base, width, height, write) {
  const reflected = write !== putCell;
  const margin = reflected ? 2 : 0;
  return x + width + margin >= 0 && x - width - margin < r.cols
    && base - height < r.rows && base + (reflected ? height + 1 : 0) >= 0;
}

export function drawItem(r, view, item, time, write = putCell) {
  const definition = Object.hasOwn(ITEMS, item?.id) ? ITEMS[item.id] : null;
  if (!definition || !Number.isFinite(item.x) || !Number.isFinite(item.y)
    || (item.count ?? 1) <= 0) return;
  const sx = Math.floor(item.x) - view.x0;
  const base = Math.floor(item.y) - view.y0;
  if (!visible(r, sx, base, 1, 2, write)) return;

  const phase = item.phase ?? 0;
  const bob = 0.65 + Math.sin(time * 2 + phase) * 0.3;
  const sy = Math.floor(item.y - bob) - view.y0;
  const pulse = Math.max(0, Math.sin(time * 2.7 + phase));
  const light = 0.85 + pulse * 0.15;
  const [red, green, blue] = definition.colour;
  const body = typeof definition.groundGlyph === 'number'
    ? definition.groundGlyph : glyph(definition.groundGlyph);
  write(r, sx, sy, body, red * light, green * light, blue * light, base);
  if (pulse > 0.96) {
    write(r, sx + 1, sy - 1, GLINT,
      red * 0.25 + 190, green * 0.25 + 190, blue * 0.25 + 190, base);
  }
}

export function drawResource(r, view, node, time, write = putCell) {
  if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.y)) return;
  const sx = Math.floor(node.x) - view.x0;
  const base = Math.floor(node.y) - view.y0;
  const bush = node.kind === 'bush';
  if (!visible(r, sx, base, bush ? 6 : 2, bush ? 8 : 4, write)) return;
  const phase = node.phase ?? 0;

  if (node.kind === 'grass') {
    if (node.harvested) {
      for (let dx = -1; dx <= 1; dx++) {
        write(r, sx + dx, base, STUBBLE[dx + 1], 89, 112, 65, base);
      }
      return;
    }
    const sway = Math.sin(time * 1.6 + phase) * 0.7;
    for (let dx = -2; dx <= 2; dx++) {
      const height = 5 - Math.abs(dx);
      for (let h = 0; h < height; h++) {
        const lean = dx * 0.22 + sway * h / height;
        const g = BLADES[lean < -0.2 ? 0 : lean > 0.2 ? 2 : 1];
        const light = 0.75 + h / height * 0.4;
        write(r, sx + dx, base - h, g, 87 * light, 161 * light, 66 * light, base);
      }
    }
    return;
  }

  if (!bush) return;
  const wind = Math.sin(time * 1.1 + phase);
  // Only the narrow upper lobes move a whole cell; the broad lower canopy
  // stays within the plant's 13-column footprint and its roots stay planted.
  const sway = dy => dy <= -6 ? Math.round(wind * 0.85 * -dy / 8) : 0;
  const tint = Math.sin(phase * 2.3) * 0.06;
  for (const cell of BUSH_CANOPY) {
    const light = 0.78 - cell.dy * 0.025 - cell.dx * 0.022 + tint
      + Math.sin(time * 1.1 + phase + cell.dx * 0.55) * 0.055;
    const colour = cell.edge ? [87, 157, 72] : [43, 112, 59];
    write(r, sx + cell.dx + sway(cell.dy), base + cell.dy, cell.g,
      colour[0] * light, colour[1] * light, colour[2] * light, base);
  }
  for (const cell of BUSH_STEMS) {
    const light = 0.8 - cell.dx * 0.03 - cell.dy * 0.018;
    write(r, sx + cell.dx + sway(cell.dy), base + cell.dy, cell.g,
      128 * light, 94 * light, 55 * light, base);
  }
  if (node.harvested) return;
  const count = Number.isInteger(node.berryCount) && node.berryCount >= 4 && node.berryCount <= 7
    ? node.berryCount : 2;
  const first = Math.abs(Math.floor(phase * 113)) % BERRY_SITES.length;
  for (let i = 0; i < count; i++) {
    const [dx, dy] = BERRY_SITES[(first + i) % BERRY_SITES.length];
    const x = sx + dx + sway(dy);
    const light = 0.94 + Math.sin(time * 1.7 + phase + i) * 0.06;
    write(r, x, base + dy, BERRY, 238 * light, 61 * light, 113 * light, base);
    write(r, x + 1, base + dy, BERRY_PIPS, 191 * light, 44 * light, 97 * light, base);
  }
}
