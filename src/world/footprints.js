import { BOOT_HEADINGS, BOOT_STAMPS } from '../render/glyph-packs/effects.js';
import { dg } from '../render/glyphs.js';
import { ASPECT, DIRT, SHORE } from './world.js';

// Boot prints left in soft ground. Each print is a treaded sole and a heel
// drawn across the few cells a boot covers, turned to the way the wanderer
// was walking. Dirt keeps a crisp, dusty hollow that slowly crumbles in;
// wet shore sand darkens, then water seeps into the print and it glistens
// before the sand smooths over.

const STAMPS = BOOT_STAMPS.map((cells) => cells.map(({ dx, dy, name, rim }) => ({
  dx, dy, g: dg(name), rim: rim ? dg(rim) : 0 })));
const LIFE = { [DIRT]: 26, [SHORE]: 16 };
export const MAX_PRINTS = 120;

// The stamp nearest a heading (radians; 0 faces down the screen, as the
// wanderer's heading does).
export function bootStamp(heading) {
  const turn = heading / (Math.PI * 2) * BOOT_HEADINGS;
  return Math.round(((turn % BOOT_HEADINGS) + BOOT_HEADINGS) % BOOT_HEADINGS) % BOOT_HEADINGS;
}

export class Footprints {
  constructor() {
    this.list = [];
  }

  // heading is optional: without it the print follows the line from the
  // previous print, which is how the feet were travelling.
  add(world, x, y, t, heading) {
    const type = world.typeAt(x, y);
    if (type !== DIRT && type !== SHORE) return;
    if (!Number.isFinite(heading)) {
      const last = this.list[this.list.length - 1];
      const dx = last ? (x - last.fx) * ASPECT : 0;
      const dy = last ? y - last.fy : 0;
      heading = dx * dx + dy * dy > 0.25 && dx * dx + dy * dy < 100 ? Math.atan2(dx, dy) : last?.heading ?? 0;
    }
    this.list.push({ x: Math.floor(x), y: Math.floor(y), fx: x, fy: y, t, type, heading,
      stamp: bootStamp(heading) });
    if (this.list.length > MAX_PRINTS) this.list.shift();
  }

  draw(r, view, t) {
    this.list = this.list.filter((p) => t - p.t < (LIFE[p.type] ?? 20));
    for (const p of this.list) {
      const sx = p.x - view.x0;
      const sy = p.y - view.y0;
      if (sx < -5 || sy < -3 || sx >= view.cols + 5 || sy >= view.rows + 3) continue;
      const age = (t - p.t) / (LIFE[p.type] ?? 20);
      const wet = p.type === SHORE;
      // How deep the print still reads, and for sand, how much water has
      // seeped in to catch the sky.
      const depth = wet ? 1 - age ** 1.5 : 1 - age ** 2;
      const seep = wet ? Math.min(1, Math.max(0, (t - p.t - 1) / 3)) * (1 - age) : 0;
      for (const c of STAMPS[p.stamp]) {
        const x = sx + c.dx;
        const y = sy + c.dy;
        if (x < 0 || y < 0 || x >= r.cols || y >= r.rows) continue;
        const cell = y * r.cols + x;
        if (r.mask && r.mask[cell] !== p.type) continue;
        const o = cell * 4;
        const k = (wet ? 0.5 : 0.66) * depth;
        let cr = r.bg[o] * (1 - k);
        let cg = r.bg[o + 1] * (1 - k);
        let cb = r.bg[o + 2] * (1 - k * 0.8);
        if (seep > 0) {
          cr += (58 - cr) * seep * 0.6;
          cg += (72 - cg) * seep * 0.6;
          cb += (98 - cb) * seep * 0.6;
        }
        // Fresh prints in dry dirt keep a crisp moonlit inner wall, lit a
        // little brighter than the grit around them.
        const lift = 0.55 * depth;
        const rr = r.bg[o] + (r.fg[o] * 1.2 + 14 - r.bg[o]) * lift;
        const rg = r.bg[o + 1] + (r.fg[o + 1] * 1.2 + 12 - r.bg[o + 1]) * lift;
        const rb = r.bg[o + 2] + (r.fg[o + 2] * 1.2 + 10 - r.bg[o + 2]) * lift;
        r.layerAt(cell, c.g, cr, cg, cb);
        if (c.rim && !wet) r.layerAt(cell, c.rim, rr, rg, rb);
      }
    }
  }
}
