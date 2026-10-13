import { ITEMS } from '../inventory/items.js';
import { putCell } from '../render/cells.js';
import { glyph } from '../render/glyphs.js';

const GLINT = glyph('+');
const BLADES = [...'\\|/'].map(glyph);
const STUBBLE = [..."'`,"].map(glyph);
const LEAVES = [...'ox*'].map(glyph);
const BERRY = glyph('o');

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
  if (!visible(r, sx, base, 3, 5, write)) return;
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

  if (node.kind !== 'bush') return;
  for (let dy = -4; dy <= 0; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const distance = (dx / 3.6) ** 2 + ((dy + 2) / 2.5) ** 2;
      if (distance > 1) continue;
      const leaf = LEAVES[(dx + dy + 9) % LEAVES.length];
      const light = 0.8 + Math.sin(time * 1.2 + phase + dx * 0.6) * 0.08
        - dx * 0.025 - dy * 0.025;
      const berry = !node.harvested && dy < 0 && (dx + dy + 9) % 4 === 0;
      write(r, sx + dx, base + dy, berry ? BERRY : leaf,
        (berry ? 217 : 47) * light,
        (berry ? 79 : 127) * light,
        (berry ? 123 : 61) * light, base);
    }
  }
}
