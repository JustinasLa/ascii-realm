import { valueNoise } from '../core/noise.js';
import { glyph } from '../render/glyphs.js';
import { ASPECT, CHUNK_SIZE, DIRT, GRASS, SHORE, STONE, WATER } from './world.js';

const G = (s) => [...s].map(glyph);

// Blades lean with the wind: index 0 leans left, 2 leans right.
const BLADE = G('\\|/');
const STUBBLE = G(`',"\``);
const SHORE_CH = G('.,:;');
const DIRT_CH = G('.:,`');
const STONE_CH = G('.:-=+*#%@');
const WATER_CH = G('~-');

// Fills the grid with the terrain under the camera. Writes straight into the
// renderer's buffers because this runs for every visible cell every frame.
export function drawGround(r, world, view, t) {
  const { fg, bg, cols } = r;
  let chunk = null;
  let ccx = 0;
  let ccy = 0;

  for (let sy = 0; sy < view.rows; sy++) {
    const wy = view.y0 + sy;
    for (let sx = 0; sx < view.cols; sx++) {
      const wx = view.x0 + sx;
      const cx = Math.floor(wx / CHUNK_SIZE);
      const cy = Math.floor(wy / CHUNK_SIZE);
      if (!chunk || cx !== ccx || cy !== ccy) {
        chunk = world.chunk(cx, cy);
        ccx = cx;
        ccy = cy;
      }
      const i = (wy - cy * CHUNK_SIZE) * CHUNK_SIZE + (wx - cx * CHUNK_SIZE);
      const type = chunk.type[i];
      const shade = chunk.shade[i];
      const rnd = chunk.rnd[i];

      let ch = 0;
      let cr = 0;
      let cg = 0;
      let cb = 0;
      let br = 0;
      let bgG = 0;
      let bb = 0;

      if (type === GRASS) {
        // Slow gusts roll across the field; each blade also flutters on its
        // own phase so neighbours never move in lockstep.
        const gust = valueNoise(wx * ASPECT * 0.035 - t * 0.55, wy * 0.035 + t * 0.12, world.seed + 900);
        const lean = (gust - 0.42) * 2.4 + Math.sin(t * 2.6 + rnd * 40) * 0.25;
        if (rnd < 0.12) ch = STUBBLE[Math.floor(rnd * 33) % STUBBLE.length];
        else ch = BLADE[lean < -0.35 ? 0 : lean > 0.35 ? 2 : 1];
        const l = 0.55 + shade * 0.6;
        cr = 40 * l;
        cg = 120 * l;
        cb = 60 * l;
        br = 4;
        bgG = 10;
        bb = 6;
      } else if (type === WATER) {
        ch = rnd < 0.25 ? WATER_CH[Math.floor(rnd * 8)] : 0;
        cr = 50;
        cg = 70;
        cb = 110;
        br = 4;
        bgG = 6;
        bb = 16;
      } else if (type === SHORE) {
        ch = SHORE_CH[Math.floor(rnd * SHORE_CH.length)];
        cr = 90;
        cg = 92;
        cb = 80;
        br = 7;
        bgG = 8;
        bb = 9;
      } else if (type === DIRT) {
        ch = DIRT_CH[Math.floor(rnd * DIRT_CH.length)];
        cr = 150;
        cg = 110;
        cb = 60;
        br = 12;
        bgG = 9;
        bb = 5;
      } else if (type === STONE) {
        const e = chunk.elev[i];
        const k = Math.min(1, (e - 0.7) * 6 + shade * 0.5);
        ch = STONE_CH[Math.min(STONE_CH.length - 1, Math.floor(k * STONE_CH.length))];
        cr = 110 + k * 60;
        cg = 112 + k * 60;
        cb = 120 + k * 60;
        br = 9;
        bgG = 10;
        bb = 12;
      }

      const o = (sy * cols + sx) * 4;
      fg[o] = cr;
      fg[o + 1] = cg;
      fg[o + 2] = cb;
      fg[o + 3] = ch;
      bg[o] = br;
      bg[o + 1] = bgG;
      bg[o + 2] = bb;
    }
  }
}
