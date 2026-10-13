import { valueNoise } from '../core/noise.js';
import { grassGust } from '../audio/environment.js';
import { hash2 } from '../core/rng.js';
import { glyph } from '../render/glyphs.js';
import { ASPECT, CHUNK_SIZE, DIRT, GRASS, SHORE, STONE, WATER, WATER_LEVEL } from './world.js';

const G = (s) => [...s].map(glyph);

// Blades lean with the wind: index 0 leans left, 2 leans right.
const BLADE = G('\\|/');
const STUBBLE = G(`',"\``);
const BEND_R2 = 3.2 * 3.2;
const DEW = glyph('.');
const STAR = glyph('*');
const GREENS = [
  [34, 92, 48],
  [46, 122, 62],
  [58, 140, 74],
  [74, 150, 70],
  [40, 108, 70],
];

const SHORE_CH = G('.,:;');
const DIRT_CH = G('.:,`');
const SLAB = 4;
const SLAB_FAMILIES = [':;-', '+=xo', 'aedbqp', 'Q0O8&$', '@#%WM'].map(G);
const CRACK_A = glyph('.');
const CRACK_B = glyph(',');
const WAVE_HI = glyph('≈');
const WAVE_MID = glyph('~');
const WAVE_LO = glyph('-');
const WAVE_DOT = glyph('·');

// Fills the grid with the terrain under the camera. Writes straight into the
// renderer's buffers because this runs for every visible cell every frame.
export function drawGround(r, world, view, t, bend) {
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
        const gust = grassGust(world, wx, wy, t);
        let lean = (gust - 0.42) * 2.4 + Math.sin(t * 2.6 + rnd * 40) * 0.25;
        // Blades near the wanderer's feet are pushed aside.
        const pdx = (wx + 0.5 - bend.x) * ASPECT;
        const pdy = wy + 0.5 - bend.y;
        const pd = pdx * pdx + pdy * pdy;
        if (pd < BEND_R2) lean += Math.sign(pdx) * (1 - pd / BEND_R2) * 3;
        if (rnd < 0.12) ch = STUBBLE[Math.floor(rnd * 33) % STUBBLE.length];
        else ch = BLADE[lean < -0.35 ? 0 : lean > 0.35 ? 2 : 1];
        // Pick one of a few greens per blade, darken whole patches with the
        // shade noise and let passing gusts flash the tips lighter.
        const tone = GREENS[Math.floor(rnd * 997) % GREENS.length];
        const sheen = Math.max(0, gust - 0.55) * 1.6;
        const l = 0.35 + shade * shade * 1.1 + sheen;
        cr = tone[0] * l;
        cg = tone[1] * l;
        cb = tone[2] * l;
        // A few cells hold a dew drop or tiny flower that twinkles.
        if (rnd > 0.985) {
          const tw = 0.6 + 0.4 * Math.sin(t * 3 + rnd * 977);
          ch = rnd > 0.996 ? STAR : DEW;
          cr = 200 * tw;
          cg = 215 * tw;
          cb = 200 * tw;
        }
        br = 4;
        bgG = 10;
        bb = 6;
      } else if (type === WATER) {
        // Long horizontal streaks that drift slowly, like moonlight broken up
        // by a gentle swell.
        const depth = Math.min(1, (WATER_LEVEL - chunk.elev[i]) * 12);
        const v = valueNoise(wx * ASPECT * 0.09 + t * 0.25, wy * 0.7 - t * 0.05, world.seed + 300) +
          Math.sin(wx * ASPECT * 0.4 + wy * 1.3 + t * 1.2) * 0.12;
        if (v > 0.74) ch = WAVE_HI;
        else if (v > 0.63) ch = WAVE_MID;
        else if (v > 0.53) ch = WAVE_LO;
        else if (v > 0.47 && rnd < 0.4) ch = WAVE_DOT;
        const k = (0.45 + Math.max(0, v - 0.45) * 1.6) * (1 - depth * 0.3);
        cr = 66 * k;
        cg = 86 * k;
        cb = 128 * k;
        // Thin lapping foam right where the water meets the shore.
        if (depth < 0.07) {
          const lap = Math.sin(t * 1.8 + wx * ASPECT * 0.5 + rnd * 2);
          ch = lap > 0.1 ? WAVE_MID : WAVE_LO;
          const f = 0.6 + 0.4 * Math.max(0, lap);
          cr = 120 * f;
          cg = 138 * f;
          cb = 160 * f;
        }
        br = 3 + 4 * (1 - depth);
        bgG = 5 + 6 * (1 - depth);
        bb = 13 + 6 * (1 - depth);
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
        // Rocky ground is a field of irregular slabs: find the nearest two
        // jittered seed points and draw a dark crack where they tie.
        const px = wx * ASPECT;
        const gx = Math.floor(px / SLAB);
        const gy = Math.floor(wy / SLAB);
        let d1 = 1e9;
        let d2 = 1e9;
        let id = 0;
        let ox = 0;
        let oy = 0;
        for (let j = -1; j <= 1; j++) {
          for (let k = -1; k <= 1; k++) {
            const hx = (gx + k + hash2(gx + k, gy + j, 13)) * SLAB;
            const hy = (gy + j + hash2(gx + k, gy + j, 14)) * SLAB;
            const d = Math.hypot(px - hx, wy - hy);
            if (d < d1) {
              d2 = d1;
              d1 = d;
              id = hash2(gx + k, gy + j, 15);
              ox = px - hx;
              oy = wy - hy;
            } else if (d < d2) d2 = d;
          }
        }
        if (d2 - d1 < 0.3) {
          ch = rnd < 0.5 ? CRACK_A : CRACK_B;
          cr = 40;
          cg = 42;
          cb = 48;
        } else {
          const l = Math.max(0, Math.min(0.999, 0.35 + id * 0.4 - (ox + oy) * 0.08 + shade * 0.2));
          const fam = SLAB_FAMILIES[Math.floor(l * SLAB_FAMILIES.length)];
          ch = fam[Math.floor(rnd * 101) % fam.length];
          cr = 112 * (0.55 + l);
          cg = 116 * (0.55 + l);
          cb = 126 * (0.55 + l);
        }
        br = 8;
        bgG = 9;
        bb = 11;
      }

      r.mask[sy * cols + sx] = type;
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
