import { putCell } from '../render/cells.js';
import { glyph } from '../render/glyphs.js';
import { ASPECT } from '../world/world.js';
import { MATERIALS } from './materials.js';
import { buildRig, project, SCALE } from './rig.js';
import { capsule, ellipse } from './shapes.js';

// The warrior is not a hand-drawn sprite. Its skeleton (see rig.js) is posed
// every frame, dressed in simple shapes (capsules, ellipses, cloth panels)
// that are projected onto the screen, sorted back to front and rasterised
// into character cells with supersampling. That way every movement can be
// animated smoothly and the figure glides between cells instead of snapping.
//
// Shapes live in "row units": one unit is one cell tall, the feet are at the
// origin and up is negative y.

const EDGE = {
  top: glyph('_'),
  topLight: glyph('.'),
  bottom: glyph('"'),
  bottomLight: glyph("'"),
  side: glyph('|'),
  rise: glyph('/'),
  fall: glyph('\\'),
  flat: glyph('-'),
};

// The glyph that best draws a bar running in a given screen direction.
function barGlyph(dx, dy) {
  const a = ((Math.atan2(dy, dx) * 180) / Math.PI + 180) % 180;
  if (a < 22.5 || a >= 157.5) return EDGE.flat;
  if (a < 67.5) return EDGE.fall;
  if (a < 112.5) return EDGE.side;
  return EDGE.rise;
}

// Collects projected shapes along with their depth, so they can be drawn
// back to front.
class Dresser {
  constructor() {
    this.parts = [];
  }

  add(shape, mat, z) {
    shape.mat = MATERIALS[mat];
    shape.z = z;
    this.parts.push(shape);
    return shape;
  }

  // A limb segment between two joints, radii in metres.
  limb(a, b, ra, rb, mat, bias = 0) {
    const pa = project(a);
    const pb = project(b);
    const shape = this.add(capsule(pa[0], pa[1], pb[0], pb[1], ra * SCALE, rb * SCALE), mat,
      (pa[2] + pb[2]) / 2 + bias);
    shape.bar = barGlyph(pb[0] - pa[0], pb[1] - pa[1]);
    return shape;
  }

  // A round blob, radii in metres.
  blob(c, rx, ry, mat, bias = 0) {
    const p = project(c);
    return this.add(ellipse(p[0], p[1], rx * SCALE, ry * SCALE), mat, p[2] + bias);
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
  const d = new Dresser();

  for (const l of rig.legs) {
    d.limb(l.hip, l.knee, 0.085, 0.07, 'mail');
    d.limb(l.knee, l.ankle, 0.068, 0.055, 'mail');
    d.limb(l.ankle, l.toe, 0.06, 0.055, 'leather', 0.01);
  }

  d.limb(rig.waist, rig.chest, across(rig, 0.16, 0.12), across(rig, 0.19, 0.13), 'plate');
  d.limb(rig.pelvis, rig.waist, across(rig, 0.17, 0.12), across(rig, 0.16, 0.12), 'leather', 0.01);
  d.limb(rig.neck, rig.chest, 0.06, across(rig, 0.18, 0.12), 'plate', 0.01);

  for (const a of rig.arms) {
    d.limb(a.shoulder, a.elbow, 0.072, 0.062, 'mail');
    d.limb(a.elbow, a.wrist, 0.06, 0.05, 'plate');
    d.blob(a.hand, 0.05, 0.055, 'leather', 0.01);
  }

  d.blob(rig.head, 0.15, 0.16, 'plate');
  // The face only shows while the head is turned towards the camera.
  const face = rig.at([0, 0.635, 0.1]);
  d.blob(face, 0.085, 0.1, 'void', face[2] > rig.head[2] ? 0.2 : -0.2);

  return d.sorted();
}

// Each cell is sampled on a 3x4 grid. Coverage decides between leaving the
// ground showing, drawing an outline glyph and filling the cell with the
// material's texture.
const SUB_X = [1 / 6, 3 / 6, 5 / 6];
const SUB_Y = [1 / 8, 3 / 8, 5 / 8, 7 / 8];
const SAMPLES = SUB_X.length * SUB_Y.length;
const SAMPLE = { nx: 0, ny: 0, u: 0, v: 0 };
const hitPart = new Int16Array(SAMPLES);
const hitLum = new Float32Array(SAMPLES);
const hitU = new Float32Array(SAMPLES);
const hitV = new Float32Array(SAMPLES);

// Moonlight comes from the upper left; edges that face it catch a cold rim.
const LIGHT_X = -0.6;
const LIGHT_Y = -0.8;
const RIM = [150, 178, 220];

// Picks the outline glyph for a partly covered cell from the direction the
// covered samples lean (mx, my). Also returns how squarely the edge faces
// the moon, for the rim light.
const OUTLINE = { g: 0, rim: 0 };
function outline(mx, my, cover) {
  const len = Math.hypot(mx, my) || 1;
  const nx = -mx / len;
  const ny = -my / len;
  const a = (Math.atan2(ny, nx) * 180) / Math.PI;
  let g;
  if (a > -112.5 && a <= -67.5) g = cover > 0.5 ? EDGE.top : EDGE.topLight;
  else if (a > 67.5 && a <= 112.5) g = cover > 0.5 ? EDGE.bottom : EDGE.bottomLight;
  else if (a > -22.5 && a <= 22.5) g = EDGE.side;
  else if (a > 157.5 || a <= -157.5) g = EDGE.side;
  // Screen y points down, so an edge facing up and right runs like "\".
  else if (a > -67.5 && a <= -22.5) g = EDGE.fall;
  else if (a > -157.5 && a <= -112.5) g = EDGE.rise;
  else if (a > 22.5 && a <= 67.5) g = EDGE.rise;
  else g = EDGE.fall;
  OUTLINE.g = g;
  OUTLINE.rim = Math.max(0, nx * LIGHT_X + ny * LIGHT_Y);
  return OUTLINE;
}

// Darkens the ground in a soft ellipse under the feet.
export function drawShadow(r, view, x, y) {
  const { fg, bg, cols } = r;
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  for (let cy = fy - 2; cy <= fy + 2; cy++) {
    const sy = cy - view.y0;
    if (sy < 0 || sy >= view.rows) continue;
    for (let cx = fx - 9; cx <= fx + 9; cx++) {
      const sx = cx - view.x0;
      if (sx < 0 || sx >= view.cols) continue;
      const dx = ((cx + 0.5 - x) * ASPECT) / 4.4;
      const dy = (cy + 0.5 - y) / 1.8;
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
      shadeCell(r, cx - view.x0, sy, cx, cy, state, parts, base, write);
    }
  }
}

function shadeCell(r, sx, sy, cx, cy, state, parts, base, write) {
  let hits = 0;
  let mx = 0;
  let my = 0;
  let front = -1;
  let k = 0;
  for (const oy of SUB_Y) {
    for (const ox of SUB_X) {
      const px = (cx + ox - state.x) * ASPECT;
      const py = cy + oy - state.y;
      hitPart[k] = -1;
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        if (px < p.x0 || px > p.x1 || py < p.y0 || py > p.y1) continue;
        if (!p.test(px, py, SAMPLE)) continue;
        hitPart[k] = i;
        hitLum[k] = 0.62 - 0.3 * SAMPLE.nx - 0.2 * SAMPLE.ny;
        hitU[k] = SAMPLE.u;
        hitV[k] = SAMPLE.v;
        hits++;
        mx += ox - 0.5;
        my += oy - 0.5;
        if (i > front) front = i;
        break;
      }
      k++;
    }
  }
  if (hits < 3) return;

  // Which part covers the most samples, and where the frontmost part's own
  // samples lean, in case its edge runs through this cell.
  let best = -1;
  let bestN = 0;
  let frontN = 0;
  let fmx = 0;
  let fmy = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const p = hitPart[i];
    if (p < 0) continue;
    if (p === front) {
      frontN++;
      fmx += SUB_X[i % 3] - 0.5;
      fmy += SUB_Y[(i / 3) | 0] - 0.5;
    }
    if (p === best) continue;
    let n = 0;
    for (let j = i; j < SAMPLES; j++) if (hitPart[j] === p) n++;
    if (n > bestN) {
      bestN = n;
      best = p;
    }
  }
  let lum = 0;
  let u = 0;
  let v = 0;
  for (let i = 0; i < SAMPLES; i++) {
    if (hitPart[i] !== best) continue;
    lum += hitLum[i];
    u += hitU[i];
    v += hitV[i];
  }
  lum /= bestN;
  u /= bestN;
  v /= bestN;

  const part = parts[best];
  const mat = part.mat;
  const [mr, mg, mb] = mat.color;

  if (hits < SAMPLES - 2) {
    // The silhouette: an outline glyph, lit by the moon on the near side.
    const o = outline(mx, my, hits / SAMPLES);
    const l = 0.45 + 0.25 * lum;
    const t = Math.min(1, o.rim * 0.85);
    write(r, sx, sy, o.g, mr * l + (RIM[0] - mr * l) * t, mg * l + (RIM[1] - mg * l) * t,
      mb * l + (RIM[2] - mb * l) * t, base);
    return;
  }

  // Fully covered cells blot out the grass behind with a dark backing.
  const br = 3 + mr * 0.06;
  const bgG = 3 + mg * 0.06;
  const bb = 5 + mb * 0.08;

  if (front !== best && frontN >= 3 && frontN <= SAMPLES - 3) {
    // A part overlapping another: trace its edge so limbs stay readable.
    const f = parts[front].mat.color;
    const o = outline(fmx, fmy, frontN / SAMPLES);
    const l = 0.55 + 0.4 * o.rim;
    write(r, sx, sy, o.g, f[0] * l, f[1] * l, f[2] * l, base, br, bgG, bb);
    return;
  }

  const b = Math.max(0, Math.min(0.999, lum));
  const g = mat.tex ? mat.tex(b, u, v) : part.bar;
  const k2 = mat.emissive ? 1 : 0.35 + b * 0.85;
  write(r, sx, sy, g, mr * k2, mg * k2, mb * k2, base, br, bgG, bb);
}
