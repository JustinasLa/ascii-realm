import { valueNoise } from '../core/noise.js';
import { hash2, mulberry32 } from '../core/rng.js';
import { SCALE, TILT } from '../entities/rig.js';
import { FINE } from '../render/cells.js';
import { dg } from '../render/glyphs.js';
import { MOSS } from '../render/palette.js';
import { bakeSurface, ringGlyph } from './prop-art.js';
import { ASPECT } from './world.js';

// What drifts down the rivers, as small solid models on the water: a log is
// a lying cylinder with sawn ends, a branch a few bark rods with tufts of
// leaves, a leaf mat a raft of flat leaves, a reed clump a bundle of stems
// with cattail heads, and the odd crate board or barrel stave a plank.
// Each is made in its own frame (metres: u along its axis, v to its left,
// z up from its keel; v across it) and seen through the game's camera by casting a ray
// per sample, so it can be drawn lying at any heading. The bake keeps, for
// every cell, how high on the hull it lies (`h`, 0 at the keel and 1 at the
// top) and the row its waterline is on (`depth`), so a piece sinks evenly
// along its length and mirrors about its own waterline.

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));

// The moon, up to the left and in front of the viewer, as a ground direction
// (east, south, up).
const MOON = (() => {
  const v = [-0.45, 0.35, 0.82];
  const l = Math.hypot(...v);
  return v.map((x) => x / l);
})();

const BARK = [116, 86, 62];
const BIRCH = [168, 174, 176];
const WOOD = [172, 136, 92];
const FUNGUS = [168, 146, 108];
const TWIG = [104, 80, 58];
const REED = [128, 132, 74];
const HEAD = [112, 72, 44];
const STRAW = [150, 130, 86];
const BOARD = [150, 112, 72];
const HOOP = [96, 80, 70];
const LEAVES = {
  spring: [[86, 142, 62], [104, 156, 70]],
  summer: [[62, 112, 48], [78, 126, 54]],
  autumn: [[176, 112, 44], [160, 74, 38], [188, 150, 60]],
  winter: [[120, 96, 60]],
};

// Ray tests against simple solids, in a primitive's own frame. The ray
// starts at o and runs along unit d; each returns the distance to the first
// hit and writes the surface normal into n, or returns -1.
function cylinder(o, d, a, b, r, n) {
  const ba = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const oc = [o[0] - a[0], o[1] - a[1], o[2] - a[2]];
  const baba = dot(ba, ba);
  const bard = dot(ba, d);
  const baoc = dot(ba, oc);
  const k2 = baba - bard * bard;
  const k1 = baba * dot(oc, d) - baoc * bard;
  const k0 = baba * dot(oc, oc) - baoc * baoc - r * r * baba;
  let h = k1 * k1 - k2 * k0;
  if (h < 0) return -1;
  h = Math.sqrt(h);
  let t = (-k1 - h) / k2;
  const y = baoc + t * bard;
  if (y > 0 && y < baba) {
    for (let i = 0; i < 3; i++) n[i] = (oc[i] + t * d[i] - ba[i] * y / baba) / r;
    n.cap = 0;
    return t;
  }
  // A sawn end.
  t = ((y < 0 ? 0 : baba) - baoc) / bard;
  if (t > 0 && Math.abs(k1 + k2 * t) < h) {
    const s = Math.sign(y) / Math.sqrt(baba);
    for (let i = 0; i < 3; i++) n[i] = ba[i] * s;
    n.cap = y < 0 ? -1 : 1;
    return t;
  }
  return -1;
}

function capsule(o, d, a, b, r, n) {
  const ba = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const oa = [o[0] - a[0], o[1] - a[1], o[2] - a[2]];
  const baba = dot(ba, ba);
  const bard = dot(ba, d);
  const baoa = dot(ba, oa);
  const k2 = baba - bard * bard;
  const k1 = baba * dot(oa, d) - baoa * bard;
  const k0 = baba * dot(oa, oa) - baoa * baoa - r * r * baba;
  const h = k1 * k1 - k2 * k0;
  if (h < 0) return -1;
  const t = (-k1 - Math.sqrt(h)) / k2;
  const y = baoa + t * bard;
  if (y > 0 && y < baba) {
    for (let i = 0; i < 3; i++) n[i] = (oa[i] + t * d[i] - ba[i] * y / baba) / r;
    return t;
  }
  // A rounded end.
  const c = y <= 0 ? a : b;
  const oc = [o[0] - c[0], o[1] - c[1], o[2] - c[2]];
  const bb = dot(d, oc);
  const cc = dot(oc, oc) - r * r;
  const hh = bb * bb - cc;
  if (hh < 0) return -1;
  const s = -bb - Math.sqrt(hh);
  for (let i = 0; i < 3; i++) n[i] = (oc[i] + s * d[i]) / r;
  return s;
}

// An ellipsoid or a box with half-sizes e, centred at c and turned `yaw`
// about the vertical.
function inFrame(o, d, c, yaw) {
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  const x = o[0] - c[0], y = o[1] - c[1];
  return {
    o: [x * cs + y * sn, -x * sn + y * cs, o[2] - c[2]],
    d: [d[0] * cs + d[1] * sn, -d[0] * sn + d[1] * cs, d[2]],
    back: (n) => [n[0] * cs - n[1] * sn, n[0] * sn + n[1] * cs, n[2]],
  };
}

function ellipsoid(o, d, c, e, yaw, n) {
  const f = inFrame(o, d, c, yaw);
  const oo = [f.o[0] / e[0], f.o[1] / e[1], f.o[2] / e[2]];
  const dd = [f.d[0] / e[0], f.d[1] / e[1], f.d[2] / e[2]];
  const a = dot(dd, dd);
  const b = dot(oo, dd);
  const h = b * b - a * (dot(oo, oo) - 1);
  if (h < 0) return -1;
  const t = (-b - Math.sqrt(h)) / a;
  const p = [f.o[0] + f.d[0] * t, f.o[1] + f.d[1] * t, f.o[2] + f.d[2] * t];
  const m = f.back([p[0] / (e[0] * e[0]), p[1] / (e[1] * e[1]), p[2] / (e[2] * e[2])]);
  const l = Math.hypot(...m);
  for (let i = 0; i < 3; i++) n[i] = m[i] / l;
  return t;
}

function box(o, d, c, e, yaw, n) {
  const f = inFrame(o, d, c, yaw);
  let near = -Infinity, far = Infinity, axis = 0, sign = 1;
  // A ray square to a pair of faces divides by zero into infinities, which
  // keep the slab test right.
  for (let i = 0; i < 3; i++) {
    const t1 = (-e[i] - f.o[i]) / f.d[i];
    const t2 = (e[i] - f.o[i]) / f.d[i];
    const lo = Math.min(t1, t2);
    if (lo > near) { near = lo; axis = i; sign = f.d[i] > 0 ? -1 : 1; }
    far = Math.min(far, Math.max(t1, t2));
  }
  if (near > far || far < 0) return -1;
  const m = [0, 0, 0];
  m[axis] = sign;
  const w = f.back(m);
  for (let i = 0; i < 3; i++) n[i] = w[i];
  return near;
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// How lit a surface is under the moon, 0 to 1, from its normal in the
// piece's frame turned to `angle` on the ground.
function lit(n, ca, sa) {
  const e = n[0] * ca - n[1] * sa;
  const s = n[0] * sa + n[1] * ca;
  return clamp(0.3 + 0.75 * Math.max(0, e * MOON[0] + s * MOON[1] + n[2] * MOON[2]));
}

// The solids of one piece, from its kind, size and seed. Every primitive
// has a `shade(p, n, light, ca, sa)` that gives the sampled surface, from
// the hit point and normal in the piece's frame and the heading's cosine and
// sine.
export function pieceModel(piece, season = 'summer') {
  const rand = mulberry32(piece.seed >>> 0);
  const L = piece.length;
  const R = piece.radius;
  const prims = [];
  const half = L / 2;
  const seed = piece.seed;
  const winter = season === 'winter';
  const leafColours = LEAVES[season] ?? LEAVES.summer;
  const leaf = (p, light) => {
    const c = leafColours[Math.floor(hash2(Math.floor(p[0] * 60), Math.floor(p[1] * 60), seed) * leafColours.length)];
    return { m: 'leaf', l: light, c };
  };
  if (piece.kind === 'log') {
    const birch = rand() < 0.25;
    const bark = birch ? BIRCH : BARK;
    const fungusAt = (rand() - 0.5) * L * 0.6;
    const fungus = rand() < 0.4;
    prims.push({ type: 'cyl', a: [-half, 0, R], b: [half, 0, R], r: R, shade(p, n, light, ca, sa) {
      if (n.cap) {
        // End grain: rings round the pith, by the way to the middle.
        const nx = p[1] / R, ny = (p[2] - R) / R;
        if (nx * nx + ny * ny > 0.78) return { m: 'bark', l: light * 0.6, c: bark };
        // The way to the pith as it lies on the screen.
        const sx = -p[1] * sa, sy = p[1] * ca * TILT - (p[2] - R);
        return { m: 'cut', l: clamp(0.5 + light * 0.3), c: WOOD,
          g: ringGlyph(-sx / R, -sy / R, seed, Math.floor(p[1] * 80), Math.floor(p[2] * 80)) };
      }
      const grain = valueNoise(p[0] * 9, Math.atan2(n[2], n[1]) * 2, seed + 17);
      const l = clamp(light * (0.84 + grain * 0.28));
      if (grain > 0.86) return { m: 'plankh', l, c: WOOD };
      const s = { m: birch ? 'birch' : 'barkh', l, c: bark };
      if (n[2] > 0.55 && grain < 0.4) {
        s.acc = { g: dg(`props.moss.${Math.floor(hash2(Math.floor(p[0] * 80), Math.floor(p[1] * 80), seed) * 6)}`),
          c: MOSS.map((v) => v * (0.75 + grain * 0.7)) };
      } else if (fungus && Math.abs(p[0] - fungusAt) < 0.03 && n[2] > -0.1 && n[2] < 0.6) {
        s.acc = { g: dg(`props.fungus.${Math.floor(hash2(seed, 5, 2) * 3)}`), c: FUNGUS };
      }
      return s;
    } });
  } else if (piece.kind === 'branch') {
    const bark = (p, n, light) => ({ m: 'barkh', l: light, c: TWIG });
    prims.push({ type: 'cap', a: [-half, 0, R], b: [half, 0, R * 0.8], r: R, shade: bark });
    const forks = 2 + Math.floor(rand() * 2);
    for (let i = 0; i < forks; i++) {
      const u = -half * 0.4 + (i / forks) * L * 0.75;
      const side = i % 2 ? 1 : -1;
      const len = L * (0.25 + rand() * 0.2);
      const a = 0.5 + rand() * 0.4;
      const end = [u + Math.cos(a) * len, side * Math.sin(a) * len, R * 0.8];
      prims.push({ type: 'cap', a: [u, 0, R], b: end, r: R * 0.6, shade: bark });
      if (!winter) {
        for (let k = 0; k < 2; k++) {
          const c = [end[0] + (rand() - 0.5) * 0.05, end[1] + (rand() - 0.5) * 0.05, R * 1.2];
          prims.push({ type: 'ell', c, e: [0.035 + rand() * 0.02, 0.025 + rand() * 0.015, 0.018], yaw: rand() * 3, shade: (p, nn, light) => leaf(p, light) });
        }
      }
    }
    if (!winter) {
      // The leafy end, which trails downstream.
      for (let k = 0; k < 3; k++) {
        const c = [half - 0.02 - rand() * 0.06, (rand() - 0.5) * 0.06, R * 1.3];
        prims.push({ type: 'ell', c, e: [0.04 + rand() * 0.02, 0.03, 0.02], yaw: rand() * 3, shade: (p, nn, light) => leaf(p, light) });
      }
    }
  } else if (piece.kind === 'mat') {
    // A ragged raft of flat leaves, or of twigs and straw in winter.
    const n = 7 + Math.floor(rand() * 5);
    for (let k = 0; k < n; k++) {
      const a = rand() * Math.PI * 2;
      const d = Math.sqrt(rand());
      const c = [Math.cos(a) * d * half * 0.8, Math.sin(a) * d * R * 0.8, 0.008 + rand() * 0.01];
      if (winter) {
        prims.push({ type: 'cap', a: [c[0] - 0.04, c[1], c[2]], b: [c[0] + 0.04, c[1] + (rand() - 0.5) * 0.04, c[2]], r: 0.007,
          shade: (p, nn, light) => ({ m: 'plankh', l: light, c: STRAW }) });
      } else {
        prims.push({ type: 'ell', c, e: [0.03 + rand() * 0.015, 0.018 + rand() * 0.01, 0.008], yaw: rand() * 3, shade: (p, nn, light) => leaf(p, light) });
      }
    }
    for (let k = 0; k < 2; k++) {
      const v = (rand() - 0.5) * R;
      prims.push({ type: 'cap', a: [-half * 0.7, v, 0.012], b: [half * 0.7, v + (rand() - 0.5) * R, 0.012], r: 0.006,
        shade: (p, nn, light) => ({ m: 'barkh', l: light, c: TWIG }) });
    }
  } else if (piece.kind === 'reeds') {
    const stems = 4 + Math.floor(rand() * 3);
    for (let k = 0; k < stems; k++) {
      const v = (k / (stems - 1) - 0.5) * R * 2;
      const spread = (rand() - 0.5) * 0.04;
      const g = dg(`props.reedleaf.${Math.floor(rand() * 4)}`);
      prims.push({ type: 'cap', a: [-half, v, 0.012], b: [half * (0.7 + rand() * 0.3), v + spread, 0.012], r: 0.008,
        shade: (p, nn, light) => ({ m: 'leaf', l: light, c: REED, g }) });
    }
    const heads = 1 + Math.floor(rand() * 2);
    for (let k = 0; k < heads; k++) {
      const v = (rand() - 0.5) * R;
      prims.push({ type: 'cap', a: [half * 0.45, v, 0.016], b: [half * 0.85, v, 0.016], r: 0.014,
        shade: (p, nn, light) => ({ m: 'bark', l: light, c: HEAD, g: dg('reed.head') }) });
    }
  } else if (piece.kind === 'crate') {
    // Broken boards, still nailed together.
    const boards = 2 + Math.floor(rand() * 2);
    for (let k = 0; k < boards; k++) {
      const v = (k - (boards - 1) / 2) * 0.045;
      const len = half * (0.7 + rand() * 0.3);
      const yaw = (rand() - 0.5) * 0.25;
      const nail = rand() * len * 0.8;
      prims.push({ type: 'box', c: [(rand() - 0.5) * 0.04, v, 0.012], e: [len, 0.02, 0.012], yaw, shade(p, n, light) {
        const s = { m: 'plankh', l: light, c: BOARD };
        if (n[2] > 0.5 && Math.abs(p[0] - nail) < 0.012) s.acc = { g: dg('props.hoop.0'), c: HOOP };
        return s;
      } });
    }
  } else {
    // A barrel stave: one bellied board with a stub of rusted hoop.
    prims.push({ type: 'ell', c: [0, 0, 0.004], e: [half, R, 0.022], yaw: 0, shade: (p, n, light) => (Math.abs(p[0] - half * 0.5) < 0.02
      ? { m: 'iron', l: light, c: HOOP } : { m: 'plankh', l: light, c: BOARD }) });
  }
  let top = 0, reach = half;
  for (const p of prims) {
    if (p.type === 'cyl' || p.type === 'cap') {
      top = Math.max(top, p.a[2] + p.r, p.b[2] + p.r);
      reach = Math.max(reach, Math.hypot(p.a[0], p.a[1]) + p.r, Math.hypot(p.b[0], p.b[1]) + p.r);
    } else {
      top = Math.max(top, p.c[2] + p.e[2]);
      reach = Math.max(reach, Math.hypot(p.c[0], p.c[1]) + Math.max(p.e[0], p.e[1]));
    }
  }
  return { prims, top, reach };
}

const N = [0, 0, 0];

// The surface of a model seen at a point of the screen (layout units from
// the piece's waterline point, rows down), lying at `angle` on the ground.
export function sampler(model, angle) {
  const ca = Math.cos(angle), sa = Math.sin(angle);
  // The way to the viewer: toward the camera on the ground and up.
  const view = [0, 1 / TILT, 1];
  const vl = Math.hypot(...view);
  const toEye = view.map((x) => x / vl);
  // Toward the piece, in its frame.
  const d = [-(toEye[0] * ca + toEye[1] * sa), -(-toEye[0] * sa + toEye[1] * ca), -toEye[2]];
  const lift = model.top + 0.05;
  return (px, py) => {
    // The ground point under this sample at z = 0, then back up the ray to
    // above the tallest part.
    const gx = px / SCALE;
    const gy = py / (SCALE * TILT);
    const k = lift / toEye[2];
    const wx = gx + toEye[0] * k, wy = gy + toEye[1] * k, wz = toEye[2] * k;
    const o = [wx * ca + wy * sa, -wx * sa + wy * ca, wz];
    let best = Infinity, hit = null, normal = null;
    for (const p of model.prims) {
      let t;
      if (p.type === 'cyl') t = cylinder(o, d, p.a, p.b, p.r, N);
      else if (p.type === 'cap') t = capsule(o, d, p.a, p.b, p.r, N);
      else if (p.type === 'ell') t = ellipsoid(o, d, p.c, p.e, p.yaw, N);
      else t = box(o, d, p.c, p.e, p.yaw, N);
      if (t >= 0 && t < best) { best = t; hit = p; normal = [N[0], N[1], N[2]]; normal.cap = N.cap; }
    }
    if (!hit) return null;
    const pt = [o[0] + d[0] * best, o[1] + d[1] * best, o[2] + d[2] * best];
    const s = hit.shade(pt, normal, lit(normal, ca, sa), ca, sa);
    s.h = clamp(pt[2] / model.top);
    // The row of the water's surface under this point of the hull.
    s.depth = (pt[0] * sa + pt[1] * ca) * SCALE * TILT;
    return s;
  };
}

// A piece baked at one heading: its cells on the ordinary grid (for the
// reflection, and where there is no fine grid) and in small letters.
export function bakePiece(model, angle) {
  const s = sampler(model, angle);
  const w = Math.ceil(model.reach * SCALE / ASPECT) + 1;
  const rows = model.reach * SCALE * TILT;
  const top = -Math.ceil(rows + model.top * SCALE) - 1;
  const bottom = Math.ceil(rows) + 1;
  const cells = bakeSurface(w, top, bottom, s, 1);
  const fine = bakeSurface(w * FINE, top * FINE, bottom * FINE, (px, py) => s(px / FINE, py / FINE), 1);
  return { cells, fine };
}
