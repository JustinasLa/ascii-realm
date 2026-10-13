import { putCell } from '../render/cells.js';
import { glyph } from '../render/glyphs.js';
import { ASPECT } from '../world/world.js';
import { MATERIALS } from './materials.js';
import { add, buildRig, lerp3, mul, project, rotY, SCALE, sub } from './rig.js';
import { capsule, ellipse, quad } from './shapes.js';

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

  // A flat panel through four world points (top edge first), e.g. cloth.
  panel(a, b, c, e, mat, bias = 0) {
    const p = [a, b, c, e].map(project);
    const z = (p[0][2] + p[1][2] + p[2][2] + p[3][2]) / 4;
    return this.add(quad(p[0], p[1], p[2], p[3]), mat, z + bias);
  }

  sorted() {
    return this.parts.sort((a, b) => a.z - b.z);
  }
}

// The torso is wider than it is deep, so how wide it looks depends on how
// far it has turned towards the camera.
const across = (rig, w, d) => Math.hypot(w * rig.facing, d * (1 - rig.facing));

// Dresses the posed skeleton, back to front.
function dress(rig, capeSim) {
  const d = new Dresser();
  if (capeSim?.pts) cape(d, rig, capeSim.pts);

  for (const l of rig.legs) {
    // Mail thighs, a plate knee cop, a greave down the shin and a sabaton.
    d.limb(l.hip, l.knee, 0.09, 0.072, 'mail');
    d.limb(l.knee, l.ankle, 0.075, 0.06, 'plate');
    d.limb(l.ankle, l.toe, 0.068, 0.055, 'darkPlate', 0.01);
    d.blob(lerp3(l.knee, l.ankle, 0.04), 0.07, 0.065, 'darkPlate', 0.02);
    d.limb(lerp3(l.knee, l.ankle, 0.8), lerp3(l.knee, l.ankle, 0.86), 0.072, 0.07, 'trim', 0.015);
  }

  cuirass(d, rig);
  greatsword(d, rig);

  for (const a of rig.arms) {
    // Mail sleeve, an elbow cop, a flared vambrace and a plated gauntlet.
    d.limb(a.shoulder, a.elbow, 0.074, 0.064, 'mail');
    d.limb(a.elbow, a.wrist, 0.058, 0.07, 'plate');
    d.blob(a.elbow, 0.062, 0.06, 'darkPlate', 0.01);
    d.limb(lerp3(a.elbow, a.wrist, 0.9), a.wrist, 0.074, 0.074, 'trim', 0.012);
    d.limb(a.wrist, a.hand, 0.06, 0.055, 'darkPlate', 0.015);
    pauldron(d, rig, a);
  }

  helm(d, rig);

  return d.sorted();
}

// Mail over the belly, a breastplate and gorget above it, a belt with a
// brass buckle, plate tassets over the hips and a crimson tabard hanging
// front and back that the knees push aside as they swing.
function cuirass(d, rig) {
  const at = rig.at;
  const w = (a, b) => across(rig, a, b);
  // Bits on the front vanish when the warrior turns away, and vice versa.
  const front = (p) => (project(p)[2] > project(rig.waist)[2] ? 0.15 : -0.15);

  d.limb(rig.pelvis, rig.chest, w(0.16, 0.12), w(0.17, 0.12), 'mail');
  d.limb(at([0, 0.26, 0.02]), at([0, 0.42, 0.01]), w(0.18, 0.13), w(0.2, 0.135), 'plate', 0.02);
  d.limb(rig.neck, at([0, 0.47, 0]), 0.075, w(0.1, 0.09), 'darkPlate', 0.03);
  d.limb(at([0, 0.01, 0]), at([0, 0.06, 0]), w(0.175, 0.13), w(0.17, 0.13), 'leather', 0.025);
  const buckle = at([0, 0.035, 0.15]);
  d.blob(buckle, 0.035, 0.03, 'trim', front(buckle));

  for (const s of [-1, 1]) {
    d.limb(at([s * 0.14, -0.01, 0.02]), at([s * 0.19, -0.2, 0.05]), 0.065, 0.075, 'darkPlate', 0.03);
  }

  for (const side of [1, -1]) {
    const z = side * 0.14;
    const push = side > 0 ? rig.kneeFwd : -rig.kneeBack;
    d.panel(at([-0.1, 0.0, z]), at([0.1, 0.0, z]), at([0.12, -0.46, z + push * 0.8]),
      at([-0.12, -0.46, z + push * 0.8]), 'crimson', side * 0.04);
  }
}

// The crimson cape: one cloth panel per link of the simulated chain,
// widening towards a ragged hem. It is sorted a little further back than it
// hangs, so it drapes under the pauldrons and sword rather than over them.
function cape(d, rig, pts) {
  const lat = rotY([1, 0, 0], rig.heading);
  const n = pts.length;
  const half = (i) => 0.2 + (0.11 * i) / (n - 1);
  // Seen edge-on the cloth would vanish into a line, so give it the bulk of
  // its folds from the side.
  const back = rotY([0, 0, -1], rig.heading);
  const bulk = (i) => mul(back, (1 - rig.facing) * (0.04 + (0.08 * i) / (n - 1)));
  const edge = (i, s) => add(mul(lat, s * half(i)), mul(bulk(i), s));
  for (let i = 0; i < n - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    d.panel(add(a, edge(i, -1)), add(a, edge(i, 1)), add(b, edge(i + 1, 1)), add(b, edge(i + 1, -1)), 'crimson',
      -0.1);
  }
  // Tatters: strips of uneven length hanging off the hem.
  const hem = pts[n - 1];
  const dir = sub(hem, pts[n - 2]);
  const len = Math.hypot(...dir) || 1;
  for (let k = 0; k < 5; k++) {
    const x = ((k + 0.5) / 5) * 2 - 1;
    const top = add(hem, mul(lat, x * half(n - 1) * 0.9));
    const drop = 0.05 + ((k * 37) % 5) * 0.025;
    d.limb(top, add(top, mul(dir, drop / len)), 0.045, 0.012, 'crimson', -0.1);
  }
}

// A greatsword slung across the back in a leather scabbard, the hilt riding
// above the right shoulder. Once drawn the scabbard hangs empty and the
// blade is drawn in the sword hand instead.
function greatsword(d, rig) {
  const at = rig.at;
  const pommel = at([-0.21, 0.72, -0.2]);
  const guard = at([-0.15, 0.56, -0.2]);
  const tip = at([0.2, -0.46, -0.21]);
  d.limb(guard, tip, 0.05, 0.035, 'leather', -0.01);
  d.limb(lerp3(guard, tip, 0.93), tip, 0.054, 0.04, 'trim', -0.005);
  d.limb(lerp3(guard, tip, 0.02), lerp3(guard, tip, 0.06), 0.056, 0.056, 'trim', -0.005);

  const sw = rig.sword;
  if (!sw) {
    d.limb(at([-0.25, 0.52, -0.2]), at([-0.05, 0.6, -0.2]), 0.026, 0.026, 'trim');
    d.limb(guard, pommel, 0.026, 0.024, 'leather');
    d.blob(pommel, 0.04, 0.04, 'trim', 0.001);
    return;
  }
  // In hand: a long bright blade with a dark fuller, the crossguard square
  // across it. Kept just in front of the gauntlet that grips it.
  d.limb(sw.guard, sw.tip, 0.034, 0.006, 'blade', 0.03);
  d.limb(lerp3(sw.guard, sw.tip, 0.05), lerp3(sw.guard, sw.tip, 0.7), 0.009, 0.006, 'darkPlate', 0.031);
  d.limb(sw.barA, sw.barB, 0.024, 0.024, 'trim', 0.032);
  d.limb(sw.pommel, sw.guard, 0.024, 0.024, 'leather', 0.02);
  d.blob(sw.pommel, 0.036, 0.036, 'trim', 0.021);
}

// Layered shoulder plates edged in brass, with a short spike on top. They
// ride on the torso, so they shrug with the breath but ignore the arm swing.
function pauldron(d, rig, a) {
  const s = a.s;
  const top = rig.at([s * 0.24, 0.5, 0]);
  const lower = rig.at([s * 0.27, 0.44, 0.005]);
  // Kept just in front of the arm they cover.
  const z = Math.max(project(a.shoulder)[2], project(a.elbow)[2]) + 0.05;
  const zOf = (p) => Math.max(z, project(p)[2]);
  d.blob(lower, 0.125, 0.085, 'trim', zOf(lower) - project(lower)[2] + 0.001);
  d.blob(lower, 0.115, 0.075, 'darkPlate', zOf(lower) - project(lower)[2] + 0.002);
  d.blob(top, 0.135, 0.09, 'trim', zOf(top) - project(top)[2] + 0.003);
  d.blob(top, 0.125, 0.08, 'plate', zOf(top) - project(top)[2] + 0.004);
  const spike = rig.at([s * 0.25, 0.58, -0.01]);
  d.limb(top, add(spike, [0, 0.06, 0]), 0.03, 0.004, 'plate', zOf(top) - project(top)[2] + 0.005);
}

// A closed great helm with a dark visor slit, a brow band and a pair of
// horns sweeping up and back.
function helm(d, rig) {
  const h = rig.headAt;
  const head = h([0, 0, 0]);
  const z = project(head)[2];
  // Anything on the front of the helm is hidden once it turns away.
  const front = (p) => (project(p)[2] > z ? 0.3 : -0.3);

  for (const s of [-1, 1]) {
    const root = h([s * 0.11, 0.07, -0.01]);
    const bend = h([s * 0.24, 0.13, -0.05]);
    const tip = h([s * 0.27, 0.31, -0.12]);
    d.limb(root, bend, 0.045, 0.032, 'horn', front(root) * 0.1);
    d.limb(bend, tip, 0.032, 0.008, 'horn', front(root) * 0.1);
  }

  d.blob(head, 0.15, 0.17, 'plate');
  // A ridge running over the crown, front to back.
  d.limb(h([0, 0.15, 0.08]), h([0, 0.13, -0.1]), 0.022, 0.018, 'darkPlate', 0.05);
  const brow = h([0, 0.035, 0.11]);
  d.limb(h([-0.12, 0.03, 0.06]), h([0.12, 0.03, 0.06]), 0.026, 0.026, 'trim', front(brow));
  const slit = h([0, -0.015, 0.125]);
  d.blob(slit, 0.1, 0.026, 'void', front(slit) * 1.1);

  // Two cold points of light burn in the dark of the visor, and now and
  // then they gutter out for a blink.
  if (rig.eyes > 0.05) {
    for (const s of [-1, 1]) {
      const eye = h([s * 0.048, -0.015, 0.118]);
      d.blob(eye, 0.026, 0.013 * rig.eyes, 'eye', front(eye) * 1.2);
    }
  }
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

// Darkens the ground in a soft ellipse under the feet, smaller and fainter
// the higher the warrior is off the ground.
export function drawShadow(r, view, x, y, air = 0) {
  const size = 1 / (1 + air * 1.2);
  const depth = 0.65 * size;
  const { fg, bg, cols } = r;
  const fx = Math.floor(x);
  const fy = Math.floor(y);
  for (let cy = fy - 2; cy <= fy + 2; cy++) {
    const sy = cy - view.y0;
    if (sy < 0 || sy >= view.rows) continue;
    for (let cx = fx - 9; cx <= fx + 9; cx++) {
      const sx = cx - view.x0;
      if (sx < 0 || sx >= view.cols) continue;
      const dx = ((cx + 0.5 - x) * ASPECT) / (4.4 * size);
      const dy = (cy + 0.5 - y) / (1.8 * size);
      const d = dx * dx + dy * dy;
      if (d >= 1) continue;
      const k = 1 - depth * (1 - d);
      const o = (sy * cols + sx) * 4;
      for (let c = 0; c < 3; c++) {
        fg[o + c] *= k;
        bg[o + c] *= k;
      }
    }
  }
}

// Poses and dresses the figure: the list of shapes to draw, back to front.
// Built once a frame and shared by the figure and its reflection.
export function dressFigure(state) {
  return dress(buildRig(state), state.cape);
}

// One reusable raster for the current pose. Both painter passes replay the
// same shaded cells, retaining all twelve coverage samples and exact colours.
let rasterParts = null;
let rasterX = 0;
let rasterY = 0;
let rasterBounds;
let rasterCount = 0;
let rasterCells = new Float64Array(1024 * 9);
let candidates = new Int32Array(128);
function collectCell(_r, x, y, g, cr, cg, cb, _base, br, bg, bb) {
  const i = rasterCount * 9;
  if (i + 9 > rasterCells.length) {
    const next = new Float64Array(rasterCells.length * 2);
    next.set(rasterCells);
    rasterCells = next;
  }
  rasterCells[i] = x;
  rasterCells[i + 1] = y;
  rasterCells[i + 2] = g;
  rasterCells[i + 3] = cr;
  rasterCells[i + 4] = cg;
  rasterCells[i + 5] = cb;
  rasterCells[i + 6] = br === undefined ? NaN : br;
  rasterCells[i + 7] = bg;
  rasterCells[i + 8] = bb;
  rasterCount++;
}

// Rasterises the dressed figure with its feet at world position
// (state.x, state.y).
export function drawFigure(r, view, state, parts, write = putCell) {
  if (rasterParts !== parts || rasterX !== state.x || rasterY !== state.y) {
    rasterize(state, parts);
  }
  const base = Math.floor(state.y) - view.y0;
  const b = rasterBounds;
  if (write.visible && !write.visible(r, b.x0 - view.x0, b.y0 - view.y0,
    b.x1 - view.x0, b.y1 - view.y0, base)) return;
  for (let n = 0; n < rasterCount; n++) {
    const i = n * 9;
    const x = rasterCells[i] - view.x0;
    const y = rasterCells[i + 1] - view.y0;
    if (write === putCell && (x < 0 || y < 0 || x >= r.cols || y >= r.rows)) continue;
    write(r, x, y, rasterCells[i + 2], rasterCells[i + 3], rasterCells[i + 4], rasterCells[i + 5],
      base, Number.isNaN(rasterCells[i + 6]) ? undefined : rasterCells[i + 6],
      rasterCells[i + 7], rasterCells[i + 8]);
  }
}

function rasterize(state, parts) {
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
  rasterBounds = { x0: Math.floor(state.x + x0 / ASPECT), x1: Math.floor(state.x + x1 / ASPECT),
    y0: Math.floor(state.y + y0), y1: Math.floor(state.y + y1) };
  rasterCount = 0;
  if (candidates.length < parts.length) candidates = new Int32Array(parts.length * 2);
  for (let cy = rasterBounds.y0; cy <= rasterBounds.y1; cy++) {
    for (let cx = rasterBounds.x0; cx <= rasterBounds.x1; cx++) {
      // Broad phase once per cell, instead of scanning every armour piece
      // for each of its twelve sub-samples.
      let count = 0;
      const px0 = (cx + SUB_X[0] - state.x) * ASPECT;
      const px1 = (cx + SUB_X[2] - state.x) * ASPECT;
      const py0 = cy + SUB_Y[0] - state.y;
      const py1 = cy + SUB_Y[3] - state.y;
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        if (p.x1 < px0 || p.x0 > px1 || p.y1 < py0 || p.y0 > py1) continue;
        candidates[count++] = i;
      }
      if (count) shadeCell(null, cx, cy, cx, cy, state, parts, 0, collectCell, count);
    }
  }
  rasterParts = parts;
  rasterX = state.x;
  rasterY = state.y;
}

function shadeCell(r, sx, sy, cx, cy, state, parts, base, write, count) {
  let hits = 0;
  let mx = 0;
  let my = 0;
  let front = -1;
  let claim = -1;
  let claimLum = 0;
  let k = 0;
  for (const oy of SUB_Y) {
    for (const ox of SUB_X) {
      const px = (cx + ox - state.x) * ASPECT;
      const py = cy + oy - state.y;
      hitPart[k] = -1;
      for (let candidate = 0; candidate < count; candidate++) {
        const i = candidates[candidate];
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
        if (p.mat.claim && i > claim) {
          claim = i;
          claimLum = hitLum[k];
        }
        break;
      }
      k++;
    }
  }
  // Lights and blades are thinner than a cell but must never be outvoted
  // by what surrounds them.
  if (claim >= 0) {
    const p = parts[claim];
    const [cr, cg, cbl] = p.mat.color;
    const l = p.mat.emissive ? 1 : 0.55 + 0.45 * Math.max(0, Math.min(1, claimLum));
    write(r, sx, sy, p.mat.tex ? p.mat.tex() : p.bar, cr * l, cg * l, cbl * l, base, 6, 10, 14);
    return;
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

// The glowing smear a swing leaves behind: the blade's recent positions,
// joined into bands that fade with age and towards the hilt.
const TRAIL_LIFE = 0.16;
const TRAIL_COLOR = [176, 224, 255];
const TRAIL_HIT = { nx: 0, ny: 0, u: 0, v: 0 };
export function drawTrail(r, view, trail, time) {
  for (let i = 0; i + 1 < trail.length; i++) {
    const a = trail[i];
    const b = trail[i + 1];
    const fade = 1 - (time - a.t) / TRAIL_LIFE;
    if (fade <= 0) continue;
    // Corners in row units: hilt then tip of one sample, tip then hilt of
    // the next.
    const shape = quad([a.hx * ASPECT, a.hy], [a.tx * ASPECT, a.ty], [b.tx * ASPECT, b.ty],
      [b.hx * ASPECT, b.hy]);
    const g = barGlyph((a.tx - a.hx) * ASPECT, a.ty - a.hy);
    for (let cy = Math.floor(shape.y0); cy <= Math.floor(shape.y1); cy++) {
      for (let cx = Math.floor(shape.x0 / ASPECT); cx <= Math.floor(shape.x1 / ASPECT); cx++) {
        if (!shape.test((cx + 0.5) * ASPECT, cy + 0.5, TRAIL_HIT)) continue;
        // v runs across the band from hilt (-1) to tip (+1).
        const k = fade * (0.25 + 0.75 * Math.max(0, (TRAIL_HIT.v + 1) / 2));
        r.put(cx - view.x0, cy - view.y0, g, TRAIL_COLOR[0] * k, TRAIL_COLOR[1] * k, TRAIL_COLOR[2] * k);
      }
    }
  }
}

export const TRAIL_SECONDS = TRAIL_LIFE;

// The warrior's name floating above the helm, as in an online RPG. `top` is
// the highest point of the dressed figure, in rows above the feet.
export function drawNameTag(r, view, state, parts, name) {
  let top = 0;
  for (const p of parts) top = Math.min(top, p.y0);
  const sy = Math.floor(state.y + top - 2) - view.y0;
  const sx = Math.floor(state.x - name.length / 2) - view.x0;
  for (let i = 0; i < name.length; i++) {
    r.put(sx + i, sy, glyph(name[i]), 212, 218, 228);
    r.putBg(sx + i, sy, 8, 10, 14);
  }
}
