import { putCell } from '../render/cells.js';
import { glyph } from '../render/glyphs.js';
import { ASPECT } from '../world/world.js';
import { buildRig, project, SCALE } from './rig.js';
import { capsule, ellipse } from './shapes.js';

// The wanderer is not a hand-drawn sprite. Its skeleton (see rig.js) is posed
// every frame, dressed in simple shapes (capsules, ellipses, cloth panels)
// that are projected onto the screen, sorted back to front and rasterised
// into character cells with supersampling. That way every movement can be
// animated smoothly and the figure glides between cells instead of snapping.
//
// Shapes live in "row units": one unit is one cell tall, the feet are at the
// origin and up is negative y.

const RAMP = [...' .:-=+*#%@'].map(glyph);
const EDGE_TOP = glyph("'");
const EDGE_BOTTOM = glyph('.');
const EDGE_SIDE = glyph(':');

const COLORS = {
  cloak: [74, 86, 102],
  sleeve: [62, 72, 88],
  hood: [66, 78, 94],
  face: [128, 104, 88],
  pants: [58, 54, 56],
  boots: [44, 34, 30],
  belt: [104, 72, 44],
  hand: [150, 120, 100],
};

// Collects projected shapes along with their depth, so they can be drawn
// back to front.
class Dresser {
  constructor() {
    this.parts = [];
  }

  add(shape, color, z) {
    shape.color = color;
    shape.z = z;
    this.parts.push(shape);
  }

  // A limb segment between two joints, radii in metres.
  limb(a, b, ra, rb, color, bias = 0) {
    const pa = project(a);
    const pb = project(b);
    this.add(capsule(pa[0], pa[1], pb[0], pb[1], ra * SCALE, rb * SCALE), color, (pa[2] + pb[2]) / 2 + bias);
  }

  // A round blob, radii in metres.
  blob(c, rx, ry, color, bias = 0) {
    const p = project(c);
    this.add(ellipse(p[0], p[1], rx * SCALE, ry * SCALE), color, p[2] + bias);
  }

  sorted() {
    return this.parts.sort((a, b) => a.z - b.z);
  }
}

// The torso is wider than it is deep, so how wide it looks depends on how
// far it has turned towards the camera.
const across = (rig, w, d) => Math.hypot(w * rig.facing, d * (1 - rig.facing));

// Dresses the posed skeleton, back to front.
function dress(rig) {
  const C = COLORS;
  const d = new Dresser();

  for (const l of rig.legs) {
    d.limb(l.hip, l.knee, 0.085, 0.07, C.pants);
    d.limb(l.knee, l.ankle, 0.068, 0.055, C.pants);
    d.limb(l.ankle, l.toe, 0.06, 0.055, C.boots, 0.01);
  }

  d.limb(rig.waist, rig.chest, across(rig, 0.16, 0.12), across(rig, 0.19, 0.13), C.cloak);
  d.limb(rig.pelvis, rig.waist, across(rig, 0.17, 0.12), across(rig, 0.16, 0.12), C.belt, 0.01);
  d.limb(rig.neck, rig.chest, 0.06, across(rig, 0.18, 0.12), C.cloak, 0.01);

  for (const a of rig.arms) {
    d.limb(a.shoulder, a.elbow, 0.072, 0.062, C.sleeve);
    d.limb(a.elbow, a.wrist, 0.06, 0.05, C.sleeve);
    d.blob(a.hand, 0.05, 0.055, C.hand, 0.01);
  }

  d.blob(rig.head, 0.15, 0.16, C.hood);
  // The face only shows while the head is turned towards the camera.
  const face = rig.at([0, 0.635, 0.1]);
  d.blob(face, 0.085, 0.1, C.face, face[2] > rig.head[2] ? 0.2 : -0.2);

  return d.sorted();
}

const SAMPLE = { nx: 0, ny: 0, u: 0, v: 0 };
const SUB_X = [0.25, 0.75];
const SUB_Y = [1 / 6, 3 / 6, 5 / 6];

// Darkens the ground in a soft ellipse under the feet.
export function drawShadow(r, view, x, y) {
  const { fg, bg, cols } = r;
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  for (let cy = fy - 1; cy <= fy + 1; cy++) {
    const sy = cy - view.y0;
    if (sy < 0 || sy >= view.rows) continue;
    for (let cx = fx - 5; cx <= fx + 5; cx++) {
      const sx = cx - view.x0;
      if (sx < 0 || sx >= view.cols) continue;
      const dx = ((cx + 0.5 - x) * ASPECT) / 2.6;
      const dy = (cy + 0.5 - y) / 1.1;
      const d = dx * dx + dy * dy;
      if (d >= 1) continue;
      const k = 0.35 + 0.65 * d;
      const o = (sy * cols + sx) * 4;
      for (let c = 0; c < 3; c++) {
        fg[o + c] *= k;
        bg[o + c] *= k;
      }
    }
  }
}

// Rasterises the figure with its feet at world position (state.x, state.y).
export function drawFigure(r, view, state, write = putCell) {
  const parts = dress(buildRig(state));
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of parts) {
    x0 = Math.min(x0, p.x0);
    x1 = Math.max(x1, p.x1);
    y0 = Math.min(y0, p.y0);
    y1 = Math.max(y1, p.y1);
  }
  const base = Math.floor(state.y) - view.y0;

  for (let cy = Math.floor(state.y + y0); cy <= Math.floor(state.y + y1); cy++) {
    const sy = cy - view.y0;
    for (let cx = Math.floor(state.x + x0 / ASPECT); cx <= Math.floor(state.x + x1 / ASPECT); cx++) {
      const sx = cx - view.x0;

      let hits = 0;
      let lum = 0;
      let cr = 0;
      let cg = 0;
      let cb = 0;
      let my = 0;
      let mx = 0;
      for (const oy of SUB_Y) {
        for (const ox of SUB_X) {
          const px = (cx + ox - state.x) * ASPECT;
          const py = cy + oy - state.y;
          let hit = null;
          for (let i = parts.length - 1; i >= 0; i--) {
            const p = parts[i];
            if (px < p.x0 || px > p.x1 || py < p.y0 || py > p.y1) continue;
            if (p.test(px, py, SAMPLE)) {
              hit = p;
              break;
            }
          }
          if (!hit) continue;
          const nx = SAMPLE.nx;

          // Moonlight from the upper left, plus a cool rim on the lit edge.
          let l = 0.7 - 0.32 * nx - 0.12 * SAMPLE.ny;
          if (nx < -0.72) l += 0.25;
          hits++;
          lum += l;
          cr += hit.color[0] * l;
          cg += hit.color[1] * l;
          cb += hit.color[2] * l;
          mx += ox - 0.5;
          my += oy - 0.5;
        }
      }
      if (!hits) continue;

      const k = 1.35 / hits;
      let g;
      if (hits <= 2) {
        // Mostly empty cell: a light glyph hugging the covered side.
        if (Math.abs(my) >= Math.abs(mx)) g = my < 0 ? EDGE_TOP : EDGE_BOTTOM;
        else g = EDGE_SIDE;
      } else {
        const b = Math.max(0, Math.min(0.999, (lum / hits - 0.25) / 0.85));
        g = RAMP[2 + Math.floor(b * 8)];
      }
      write(r, sx, sy, g, cr * k, cg * k, cb * k, base);
    }
  }
}
