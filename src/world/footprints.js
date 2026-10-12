import { glyph } from '../render/glyphs.js';
import { DIRT, SHORE } from './world.js';

// Prints left in soft ground: dirt paths and the sand of the shore keep the
// mark of each footstep for a while before it blows away.

const PRINT = glyph('_');
const LIFE = 10;
const MAX = 80;

export class Footprints {
  constructor() {
    this.list = [];
  }

  add(world, x, y, t) {
    const type = world.typeAt(x, y);
    if (type !== DIRT && type !== SHORE) return;
    this.list.push({ x: Math.floor(x), y: Math.floor(y), t });
    if (this.list.length > MAX) this.list.shift();
  }

  draw(r, view, t) {
    const { fg, cols } = r;
    this.list = this.list.filter((p) => t - p.t < LIFE);
    for (const p of this.list) {
      const sx = p.x - view.x0;
      const sy = p.y - view.y0;
      if (sx < 0 || sy < 0 || sx >= view.cols || sy >= view.rows) continue;
      // A dark hollow pressed into the ground, filling in as it ages.
      const k = 0.45 + 0.55 * ((t - p.t) / LIFE);
      const o = (sy * cols + sx) * 4;
      fg[o] *= k;
      fg[o + 1] *= k;
      fg[o + 2] *= k;
      fg[o + 3] = PRINT;
    }
  }
}
