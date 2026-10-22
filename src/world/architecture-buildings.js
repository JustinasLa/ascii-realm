import { ArchitectureMesh } from './architecture-mesh.js';
import { ASPECT } from './world.js';

// Dimensions are physical row units. Depth is positive behind the front face;
// centering the ground plane requires the same -0.55 * depth / 2 translation
// as the modeller's oblique projection. Only the collider uses world columns.
const GAP = 0.105;
const area = (p) => p.reduce((sum, a, i) => {
  const b = p[(i + 1) % p.length];
  return sum + a[0] * b[1] - b[0] * a[1];
}, 0);
const normalized = (v) => {
  const length = Math.hypot(...v);
  return v.map((n) => n / (length || 1));
};

// Inset a convex stone face. Separate front, bevel and side planes are crucial
// here: painting a bright outline on a flat voussoir loses the carved edge.
function insetPolygon(points, distance) {
  return points.map((p, i) => {
    const previous = points[(i + points.length - 1) % points.length];
    const next = points[(i + 1) % points.length];
    const a = normalized([p[0] - previous[0], p[1] - previous[1]]);
    const b = normalized([next[0] - p[0], next[1] - p[1]]);
    const n0 = [-a[1], a[0]], n1 = [-b[1], b[0]];
    const divisor = Math.max(0.12, 1 + n0[0] * n1[0] + n0[1] * n1[1]);
    return [p[0] + distance * (n0[0] + n1[0]) / divisor,
      p[1] + distance * (n0[1] + n1[1]) / divisor];
  });
}

function bevelProfile(mesh, profile, z0, z1, bevel, material) {
  if (profile.length < 3 || Math.abs(area(profile)) < 1e-5) return;
  const p = area(profile) < 0 ? [...profile].reverse() : profile;
  const shortest = Math.min(...p.map((a, i) => {
    const b = p[(i + 1) % p.length];
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
  }));
  const b = Math.min(bevel, shortest * 0.22, (z1 - z0) * 0.28);
  const inner = insetPolygon(p, b);
  mesh.face(inner.map(([x, h]) => [x, h, z0]), [0, 0, -1], material);
  mesh.face(inner.map(([x, h]) => [x, h, z1]), [0, 0, 1], material);
  for (let i = 0; i < p.length; i++) {
    const j = (i + 1) % p.length;
    const [x, h] = p[i], [xx, hh] = p[j];
    const [ix, ih] = inner[i], [jx, jh] = inner[j];
    const dx = hh - h, dh = x - xx, length = Math.hypot(dx, dh);
    mesh.face([[ix, ih, z0], [x, h, z0 + b], [xx, hh, z0 + b], [jx, jh, z0]],
      normalized([dx, dh, -length]), material);
    mesh.face([[x, h, z0 + b], [x, h, z1 - b], [xx, hh, z1 - b], [xx, hh, z0 + b]],
      normalized([dx, dh, 0]), material);
    mesh.face([[x, h, z1 - b], [ix, ih, z1], [jx, jh, z1], [xx, hh, z1 - b]],
      normalized([dx, dh, length]), material);
  }
}

function studio(rand, depth) {
  const mesh = new ArchitectureMesh(), shift = depth * 0.275;
  const stone = (m = {}) => ({ tone: 0.94 + rand() * 0.12, ...m });
  const profile = (p, z0, z1, m = {}, bevel = 0.18) => {
    bevelProfile(mesh, p.map(([x, h]) => [x - shift, h]), z0, z1, bevel, stone(m));
  };
  const block = (x0, x1, h0, h1, z0, z1, m = {}, bevel = 0.18, chipped = true) => {
    if (x1 - x0 < 0.055 || h1 - h0 < 0.055 || z1 - z0 < 0.055) return;
    if (chipped && rand() < 0.14 && h1 - h0 > 0.7 && x1 - x0 > 1.1) {
      const chip = Math.min(0.35 + rand() * 0.4, (h1 - h0) * 0.28, (x1 - x0) * 0.2);
      const p = rand() < 0.5
        ? [[x0, h0], [x1, h0], [x1, h1 - chip], [x1 - chip, h1], [x0, h1]]
        : [[x0, h0], [x1, h0], [x1, h1], [x0 + chip, h1], [x0, h1 - chip]];
      profile(p, z0, z1, m, bevel);
    } else {
      mesh.bevelBox(x0 - shift, x1 - shift, h0, h1, z0, z1, bevel, stone(m));
    }
  };
  const solid = (x0, x1, h0, h1, z0, z1, m = {}) =>
    mesh.box(x0 - shift, x1 - shift, h0, h1, z0, z1, m);
  // A Z/height profile extruded across X, for the sloping undersides of corbels.
  const depthProfile = (p, x0, x1, m = {}, bevel = 0.14) => {
    const temporary = new ArchitectureMesh();
    bevelProfile(temporary, p, x0 - shift, x1 - shift, bevel, stone(m));
    for (const triangle of temporary.triangles) {
      mesh.triangles.push({ ...triangle,
        points: triangle.points.map(([z, h, x]) => [x, h, z]),
        normal: [triangle.normal[2], triangle.normal[1], triangle.normal[0]] });
    }
  };
  return { mesh, shift, stone, block, profile, solid, depthProfile };
}

function intervals(start, end, pitch, offset = 0) {
  const result = [];
  for (let x = start - offset; x < end - 0.04; x += pitch) {
    const a = Math.max(start, x), b = Math.min(end, x + pitch);
    if (b - a > 0.15) result.push([a, b]);
  }
  return result;
}

// Clip a convex course block against a sloping boundary x <= a + b * h.
function clipX(polygon, a, b, sign) {
  const result = [];
  const distance = ([x, h]) => sign * (x - a - b * h);
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i], q = polygon[(i + 1) % polygon.length];
    const dp = distance(p), dq = distance(q);
    if (dp <= 0) result.push(p);
    if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) {
      const t = dp / (dp - dq);
      result.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return result;
}

export function makeGateGeometry(rand, seed) {
  const depth = 8.2, radius = 22.0 + rand() * 0.45;
  const opening = 15.4 + rand() * 0.2;
  const spring = 34.6 + rand() * 0.4, outer = opening + 3.15;
  const height = 68.4 + rand() * 1.1, crown = height - 10.0;
  const s = studio(rand, depth), { mesh, block, profile, solid } = s;

  // Broad, three-step footings. Their inner faces retain a generous clear
  // passage even at the rear projected edge; there is no floor across it.
  for (const side of [-1, 1]) {
    const span = (inside, outside) => side < 0 ? [-outside, -inside] : [inside, outside];
    const [base0, base1] = span(opening - 0.15, radius + 0.65);
    const [mid0, mid1] = span(opening - 0.05, radius + 0.35);
    const [a, b] = span(opening, radius);
    block(base0, base1, 0, 0.75, 0.08, depth, { tone: 0.89 }, 0.22);
    block(base0 + 0.1, base1 - 0.1, 0.78, 1.55, 0.14, depth - 0.06, {}, 0.2);
    block(mid0, mid1, 1.59, 2.85, 0.24, depth - 0.18, { tone: 1.04 }, 0.25);
    solid(a + 0.14, b - 0.14, 2.8, spring, 0.8, depth - 0.5, { shade: 0.53, tone: 0.88 });
    const courses = 10, ch = (spring - 2.9) / courses;
    for (let row = 0; row < courses; row++) {
      const h0 = 2.9 + row * ch + GAP / 2, h1 = 2.9 + (row + 1) * ch - GAP / 2;
      // Alternating long bond and two short stones break the upright seams.
      const xs = row % 2 ? [[a, b]] : [[a, (a + b) / 2], [(a + b) / 2, b]];
      const dz = depth / 2 + (row % 2 ? 0.65 : -0.65);
      for (const [x0, x1] of xs) for (const [z0, z1] of [[0.44, dz], [dz + GAP, depth - 0.18]]) {
        block(x0 + GAP / 2, x1 - GAP / 2, h0, h1, z0, z1, {}, 0.2 + rand() * 0.06);
      }
    }
    // Raised, heavy outer quoins, rather than thin decorative stripes.
    const [q0, q1] = span(radius - 1.95, radius + 0.1);
    for (let row = 0; row < 6; row++) {
      const h0 = 3.1 + row * 5.05;
      block(q0, q1, h0, h0 + 4.75, 0.2, 1.4 + (row % 2) * 0.35, { tone: 1.025 }, 0.22);
    }
    // Chamfered impost and drip ledge wrap all the way through the gate.
    const [i0, i1] = span(opening - 0.22, radius + 0.3);
    block(i0 + 0.12, i1 - 0.12, spring - 1.25, spring - 0.55, 0.2, depth, {}, 0.18);
    block(i0, i1, spring - 0.51, spring + 0.45, 0.05, depth, { tone: 1.06 }, 0.23);
  }

  // Three genuinely separated arch depths: recessed structural barrel,
  // individually bevelled front voussoirs and the far lip of the tunnel.
  const count = 17;
  const point = (r, a) => [Math.cos(a) * r, spring + Math.sin(a) * r];
  for (let i = 0; i < count; i++) {
    const a0 = i * Math.PI / count, a1 = (i + 1) * Math.PI / count;
    const a = a0 + 0.0038, b = a1 - 0.0038;
    const key = i === (count - 1) / 2;
    const wedge = (inner, outside, aa = a, bb = b) =>
      [point(inner, aa), point(outside, aa), point(outside, bb), point(inner, bb)];
    mesh.extrude(wedge(opening, outer, a0, a1).map(([x, h]) => [x - s.shift, h]),
      0.94, depth - 0.65, { shade: 0.77, tone: 0.94 });
    profile(wedge(opening - (key ? 0.48 : 0), outer + (key ? 0.75 : 0.03)),
      key ? 0.025 : 0.15, key ? 1.35 : 1.02, { tone: key ? 1.09 : 0.94 + rand() * 0.13 }, 0.19);
    profile(wedge(opening + 0.015, outer - 0.22), depth - 0.8, depth,
      { tone: 0.92, shade: 0.94 }, 0.14);
    // A narrow, separate weathered hood projects above the arch blocks.
    profile(wedge(outer + 0.14, outer + 0.72), 0.055, 0.72,
      { tone: 1.065 }, 0.13);
    if (key) {
      const ka = (a + b) / 2 - 0.052, kb = (a + b) / 2 + 0.052;
      profile(wedge(opening + 0.65, outer + 0.42, ka, kb), 0.0, 0.22, { tone: 1.035 }, 0.08);
    }
  }

  // Spandrels are coursed solids clipped to the arch haunch, not a flat box
  // whose painted arch happens to resemble an opening.
  const archTop = spring + outer + 0.8;
  const levels = [spring + 0.5];
  while (levels.at(-1) + 3.05 < archTop) levels.push(levels.at(-1) + 3.05);
  levels.push(archTop, crown);
  for (let row = 0; row < levels.length - 1; row++) {
    const h0 = levels[row] + GAP / 2, h1 = levels[row + 1] - GAP / 2;
    if (h1 <= h0) continue;
    const edge = (h) => Math.sqrt(Math.max(0, (outer + 0.76) ** 2 - Math.max(0, h - spring) ** 2));
    for (const side of [-1, 1]) {
      const e0 = edge(h0), e1 = edge(h1), slope = side * (e1 - e0) / (h1 - h0);
      const intercept = side * e0 - slope * h0;
      const ranges = intervals(side < 0 ? -radius : 0, side < 0 ? 0 : radius, 4.8, row % 2 ? 2.4 : 0);
      for (const [a, b] of ranges) {
        const clipped = clipX([[a + GAP / 2, h0], [b - GAP / 2, h0],
          [b - GAP / 2, h1], [a + GAP / 2, h1]], intercept, slope, -side);
        if (clipped.length >= 3 && Math.abs(area(clipped)) > 0.35) {
          profile(clipped, 0.85, depth - 0.15, {}, 0.18);
        }
      }
    }
  }

  // Broad stone entablature, with a sloping lower face and recessed bed joint.
  for (const [a, b] of intervals(-radius - 0.35, radius + 0.35, 7.5)) {
    block(a + GAP / 2, b - GAP / 2, crown, crown + 0.75, 0.28, depth, {}, 0.18);
    block(a - 0.15, b + 0.15, crown + 0.83, crown + 1.6, 0.07, depth + 0.12, { tone: 1.06 }, 0.24);
    block(a - 0.25, b + 0.25, crown + 1.68, crown + 2.6, 0.0, depth + 0.22, {}, 0.27);
  }
  const parapet = height - 4.65;
  for (const [a, b] of intervals(-radius, radius, 5.2, 1.3)) {
    block(a + GAP / 2, b - GAP / 2, crown + 2.68, parapet, 0.46, depth - 0.22, {}, 0.19);
  }
  const pitch = radius * 2 / 7;
  for (let i = 0; i < 7; i++) {
    const a = -radius + i * pitch, b = Math.min(radius, a + pitch * 0.62);
    const top = height - (i === 5 ? 0.75 : i === 0 ? 0.25 : 0);
    block(a + 0.04, b, parapet + GAP, parapet + 2.65, 0.38, depth - 0.18, {}, 0.24);
    profile([[a + 0.04, parapet + 2.75], [b, parapet + 2.75], [b, top - 0.38],
      [b - 0.45, top], [a + 0.2, top], [a + 0.04, top - 0.16]],
    0.25, depth - 0.06, { tone: 1.03 }, 0.21);
  }

  const footW = radius + 0.65 + s.shift, footH = depth * 0.45;
  const inner = opening - 0.15 - s.shift;
  return { mesh, footW, footH, collisionRects: [
    { minX: -footW / ASPECT, maxX: -inner / ASPECT, minY: -footH, maxY: 0.3 },
    { minX: inner / ASPECT, maxX: footW / ASPECT, minY: -footH, maxY: 0.3 },
  ] };
}

// Subtract a rectangular recess from masonry before adding its bevels. This
// leaves actual jambs, bed faces and deep shadow behind the arrow openings.
function subtractBox(box, cut) {
  const a = { x0: Math.max(box.x0, cut.x0), x1: Math.min(box.x1, cut.x1),
    h0: Math.max(box.h0, cut.h0), h1: Math.min(box.h1, cut.h1),
    z0: Math.max(box.z0, cut.z0), z1: Math.min(box.z1, cut.z1) };
  if (a.x0 >= a.x1 || a.h0 >= a.h1 || a.z0 >= a.z1) return [box];
  return [
    { ...box, x1: a.x0 }, { ...box, x0: a.x1 },
    { ...box, x0: a.x0, x1: a.x1, h1: a.h0 },
    { ...box, x0: a.x0, x1: a.x1, h0: a.h1 },
    { ...a, z0: box.z0, z1: a.z0 }, { ...a, z0: a.z1, z1: box.z1 },
  ].filter((p) => p.x1 - p.x0 > 0.055 && p.h1 - p.h0 > 0.055 && p.z1 - p.z0 > 0.055);
}

export function makeTowerGeometry(rand, seed) {
  const depth = 13.2, half = 7.8 + rand() * 0.3, base = half + 1.2;
  const height = 79.5 + rand() * 1.5, bodyTop = height - 14.3;
  const front = 0.72, back = depth - 0.7;
  const s = studio(rand, depth), { mesh, block, profile, solid, depthProfile } = s;
  const slitLevels = [24.0, 47.2], sideLevel = 36.0, sideZ = depth * 0.56;
  const cuts = slitLevels.map((h) => ({ x0: -0.62, x1: 0.62, h0: h - 3.15, h1: h + 3.15,
    z0: front - 0.4, z1: front + 1.7 }));
  cuts.push({ x0: half - 1.65, x1: half + 0.5, h0: sideLevel - 3.15, h1: sideLevel + 3.15,
    z0: sideZ - 0.62, z1: sideZ + 0.62 });
  const carved = (box) => cuts.reduce((pieces, cut) => pieces.flatMap((p) => subtractBox(p, cut)), [box]);

  // The plinth consists of large individually joined ashlar, stepped inward
  // to a broad chamfer. No single smooth cuboid carries the visible tower.
  for (const [a, b] of intervals(-base, base, 6.1)) {
    block(a + GAP / 2, b - GAP / 2, 0, 0.78, 0.04, depth, { tone: 0.9 }, 0.23);
    block(a + 0.16, b - 0.16, 0.84, 1.65, 0.14, depth - 0.1, {}, 0.22);
    block(a + 0.28, b - 0.28, 1.72, 3.05, 0.25, depth - 0.22, { tone: 1.035 }, 0.31);
  }
  for (const p of carved({ x0: -half + 0.23, x1: half - 0.23, h0: 3.05, h1: bodyTop,
    z0: front + 0.52, z1: back - 0.4 })) {
    solid(p.x0, p.x1, p.h0, p.h1, p.z0, p.z1, { shade: 0.49, tone: 0.87 });
  }
  const rows = 20, ch = (bodyTop - 3.1) / rows;
  for (let row = 0; row < rows; row++) {
    const h0 = 3.1 + row * ch + GAP / 2, h1 = 3.1 + (row + 1) * ch - GAP / 2;
    const middle = depth * 0.5 + (row % 2 ? 0.55 : -0.55);
    for (const [a, b] of intervals(-half, half, half * 2 / 3, row % 2 ? half / 3 : 0)) {
      for (const [z0, z1] of [[front, middle - GAP / 2], [middle + GAP / 2, back]]) {
        for (const p of carved({ x0: a + GAP / 2, x1: b - GAP / 2, h0, h1, z0, z1 })) {
          block(p.x0, p.x1, p.h0, p.h1, p.z0, p.z1, {}, 0.2);
        }
      }
    }
  }

  // Four corner buttresses have sloping shoulders and wide lower stages.
  // Sparse raised quoins continue their weight upward without adding stripes.
  for (const side of [-1, 1]) for (const rear of [false, true]) {
    const outer = side * (half + 0.65), inner = side * (half - 1.8);
    const x0 = Math.min(outer, inner), x1 = Math.max(outer, inner);
    const z0 = rear ? back - 1.75 : 0.33, z1 = rear ? depth - 0.25 : front + 1.75;
    block(x0, x1, 3.12, 9.0, z0, z1, {}, 0.25);
    const shoulder = side > 0
      ? [[x0, 9.1], [x1, 9.1], [x1, 16.4], [x1 - 0.72, 18.0], [x0, 18.0]]
      : [[x0, 9.1], [x1, 9.1], [x1, 18.0], [x0 + 0.72, 18.0], [x0, 16.4]];
    profile(shoulder, z0 + 0.1, z1 - 0.08, {}, 0.21);
    for (let row = 0; row < 7; row++) {
      const h0 = 18.15 + row * 6.25;
      const q0 = side < 0 ? -half - 0.08 : half - 1.55;
      const q1 = side < 0 ? -half + 1.55 : half + 0.08;
      block(q0, q1, h0, Math.min(bodyTop - 1.1, h0 + 3.7),
        rear ? back - 1.5 : front - 0.19, rear ? back + 0.13 : front + 1.4, { tone: 1.015 }, 0.22);
    }
  }

  // Recessed arrow slits: solid shadow plane behind sloping stone reveals,
  // small framed courses, a heavy sill and chamfered lintel. No painted slot.
  for (const h of slitLevels) {
    solid(-0.36, 0.36, h - 3.1, h + 3.1, front + 1.64, front + 1.72,
      { shade: 0.12, tone: 0.61 });
    for (const side of [-1, 1]) {
      const x0 = side < 0 ? -1.36 : 0.67, x1 = side < 0 ? -0.67 : 1.36;
      for (let row = 0; row < 2; row++) {
        block(x0, x1, h - 3.15 + row * 3.17, h - 0.08 + row * 3.17,
          front - 0.22, front + 0.58, { tone: 1.04 }, 0.14);
      }
      const xf = side * 0.62 - s.shift, xb = side * 0.33 - s.shift;
      mesh.face([[xf, h - 3.1, front], [xb, h - 2.9, front + 1.65],
        [xb, h + 2.9, front + 1.65], [xf, h + 3.1, front]],
      normalized([-side, 0, -0.18]), { tone: 0.9, shade: 0.63 });
    }
    block(-1.65, 1.65, h - 3.8, h - 3.16, front - 0.36, front + 0.65, { tone: 1.035 }, 0.16);
    profile([[-1.55, h + 3.19], [1.55, h + 3.19], [1.28, h + 4.16],
      [-1.22, h + 4.1]], front - 0.22, front + 0.76, {}, 0.16);
  }
  solid(half - 1.7, half - 1.61, sideLevel - 3.1, sideLevel + 3.1, sideZ - 0.37, sideZ + 0.37,
    { shade: 0.13, tone: 0.63 });
  for (const side of [-1, 1]) {
    const z0 = sideZ + (side < 0 ? -1.35 : 0.67), z1 = sideZ + (side < 0 ? -0.67 : 1.35);
    block(half - 0.6, half + 0.2, sideLevel - 3.14, sideLevel + 3.14, z0, z1, {}, 0.15);
    mesh.face([[half - s.shift, sideLevel - 3.1, sideZ + side * 0.62],
      [half - 1.65 - s.shift, sideLevel - 2.9, sideZ + side * 0.33],
      [half - 1.65 - s.shift, sideLevel + 2.9, sideZ + side * 0.33],
      [half - s.shift, sideLevel + 3.1, sideZ + side * 0.62]],
    normalized([0.18, 0, -side]), { tone: 0.89, shade: 0.66 });
  }
  block(half - 0.65, half + 0.3, sideLevel - 3.78, sideLevel - 3.17, sideZ - 1.6, sideZ + 1.6, {}, 0.14);
  block(half - 0.62, half + 0.22, sideLevel + 3.19, sideLevel + 4.1, sideZ - 1.5, sideZ + 1.5, {}, 0.18);

  // Deep corbels support a layered oversailing cornice on all four faces.
  const ledge = bodyTop + 2.5;
  for (const x of [-half + 1.2, 0, half - 1.2]) {
    depthProfile([[front + 0.85, bodyTop - 3.3], [front + 0.85, ledge],
      [0.05, ledge], [0.05, ledge - 0.9], [front + 0.2, bodyTop - 1.5]], x - 0.62, x + 0.62, {}, 0.16);
    depthProfile([[back - 0.85, bodyTop - 3.3], [back - 0.85, ledge],
      [depth - 0.05, ledge], [depth - 0.05, ledge - 0.9], [back - 0.2, bodyTop - 1.5]], x - 0.62, x + 0.62, {}, 0.16);
  }
  for (const side of [-1, 1]) for (const z of [3.0, depth / 2, depth - 3.0]) {
    const p = [[side * (half - 0.8), bodyTop - 3.3], [side * (half - 0.8), ledge],
      [side * (half + 0.65), ledge], [side * (half + 0.65), ledge - 0.9],
      [side * (half - 0.13), bodyTop - 1.5]];
    profile(p, z - 0.62, z + 0.62, {}, 0.16);
  }
  const corniceHalf = half + 0.85;
  for (const [h0, h1, spread] of [[ledge, ledge + 0.67, 0.38],
    [ledge + 0.75, ledge + 1.65, 0.66], [ledge + 1.74, ledge + 2.5, 0.85]]) {
    block(-half - spread, half + spread, h0, h1, 0.12, 1.5, { tone: 1.035 }, 0.21);
    block(-half - spread, half + spread, h0, h1, depth - 1.5, depth - 0.12, {}, 0.21);
    block(-half - spread, -half + 0.65, h0, h1, 1.55, depth - 1.55, {}, 0.21);
    block(half - 0.65, half + spread, h0, h1, 1.55, depth - 1.55, {}, 0.21);
  }
  const roof = ledge + 2.58, parapet = height - 5.3;
  solid(-half + 0.8, half - 0.8, roof - 0.2, roof + 0.15, 1.8, depth - 1.8,
    { shade: 0.23, tone: 0.75 });
  for (const [a, b] of intervals(-corniceHalf + 0.25, corniceHalf - 0.25, 5.7)) {
    block(a + GAP / 2, b - GAP / 2, roof, parapet, 0.34, 1.8, {}, 0.22);
    block(a + GAP / 2, b - GAP / 2, roof, parapet, depth - 1.8, depth - 0.34, {}, 0.22);
  }
  for (const side of [-1, 1]) {
    const x0 = side < 0 ? -corniceHalf + 0.25 : corniceHalf - 1.75;
    const x1 = side < 0 ? -corniceHalf + 1.75 : corniceHalf - 0.25;
    for (const [z0, z1] of intervals(1.88, depth - 1.88, 4.9)) {
      block(x0, x1, roof, parapet, z0 + GAP / 2, z1 - GAP / 2, {}, 0.2);
    }
  }
  const merlon = (a, b, z0, z1, top) => {
    block(a, b, parapet + GAP, parapet + 2.7, z0, z1, {}, 0.25);
    profile([[a, parapet + 2.8], [b, parapet + 2.8], [b, top - 0.35],
      [b - 0.34, top], [a + 0.25, top], [a, top - 0.25]], z0 - 0.06, z1 + 0.06, {}, 0.2);
  };
  const pitch = corniceHalf * 2 / 3;
  for (let i = 0; i < 3; i++) {
    const a = -corniceHalf + 0.25 + i * pitch, b = Math.min(corniceHalf - 0.25, a + 3.4);
    merlon(a, b, 0.28, 1.95, height - (i === 2 ? 0.45 : 0));
    merlon(a, b, depth - 1.95, depth - 0.28, height - (i === 0 ? 0.65 : 0.1));
  }
  for (const side of [-1, 1]) for (const z of [3.65, depth - 5.7]) {
    const a = side < 0 ? -corniceHalf + 0.25 : corniceHalf - 1.9;
    merlon(a, a + 1.65, z, z + 2.05, height - 0.25);
  }
  const footW = base + s.shift, footH = depth * 0.45;
  return { mesh, footW, footH, collisionRects: [
    { minX: -footW / ASPECT, maxX: footW / ASPECT, minY: -footH, maxY: 0.3 },
  ] };
}

export function makeWallGeometry(kind, rand, seed) {
  const broken = kind === 'wall-broken';
  const radius = 16.4 + rand() * 1.0, depth = 6.4;
  const height = (broken ? 30.5 : 13.3) + rand() * (broken ? 3.5 : 1.9);
  const reverse = rand() < 0.5;
  const s = studio(rand, depth), { mesh, block, profile, solid } = s;
  const course = 3.0, pitch = 4.8;
  // A few broad surviving masses give the ruin an intelligible silhouette.
  // Individual top stones provide chips; random needles never define it.
  const steps = broken ? [1, 0.98, 0.87, 0.77, 0.59, 0.44, 0.32]
    : [0.87, 0.94, 1, 0.98, 0.9, 0.82, 0.72];
  const roofAt = (x) => {
    const f = Math.max(0, Math.min(0.9999, (x + radius) / (radius * 2)));
    const index = Math.floor(f * steps.length);
    const value = steps[reverse ? steps.length - 1 - index : index];
    return 1.3 + Math.max(2, Math.round((height * value - 1.3) / course)) * course;
  };
  for (const [a, b] of intervals(-radius, radius, 5.8)) {
    block(a + GAP / 2, b - GAP / 2, 0, 0.72, 0.1, depth, { tone: 0.9 }, 0.22);
    block(a + 0.13, b - 0.13, 0.79, 1.28, 0.18, depth - 0.1, {}, 0.15);
  }
  const rows = Math.ceil(height / course) + 1;
  for (let row = 0; row < rows; row++) {
    const h0 = 1.35 + row * course + GAP / 2;
    for (const [a, b] of intervals(-radius + 0.22, radius - 0.22, pitch, row % 2 ? 2.4 : 0)) {
      const top = roofAt((a + b) / 2);
      if (h0 >= top) continue;
      const h1 = Math.min(top - 0.04, h0 + course - GAP);
      const terminal = h0 + course >= top;
      const middle = depth / 2 + (row % 2 ? 0.34 : -0.34);
      for (const [z0, z1] of [[0.43, middle], [middle + GAP, depth - 0.18]]) {
        if (terminal) {
          const leftChip = 0.25 + rand() * 0.5, rightChip = 0.2 + rand() * 0.65;
          const p = [[a + GAP / 2, h0], [b - GAP / 2, h0],
            [b - GAP / 2, h1 - rightChip], [b - 0.38 - rand() * 0.45, h1],
            [a + 0.45 + rand() * 0.35, h1 - rand() * 0.32], [a + GAP / 2, h1 - leftChip]];
          profile(p, z0 - (z0 < 1 ? 0.06 : 0), z1, { tone: 1.025 }, 0.22);
        } else {
          block(a + GAP / 2, b - GAP / 2, h0, h1, z0, z1, {}, 0.2);
        }
      }
      // Recessed mortar exists behind the open bevel joints, not on top of
      // the block faces. Keep it below the broken lid of each local segment.
      if (row === 0) {
        const coreTop = Math.min(top, roofAt(a + 0.1), roofAt(b - 0.1)) - 0.95;
        solid(a + 0.1, b - 0.1, 1.3, coreTop, 0.88, depth - 0.5,
          { shade: 0.5, tone: 0.86 });
      }
      if (terminal && !broken) {
        // Surviving low-wall coping is a heavy, deeply chamfered slab.
        profile([[a - 0.04, h1 + 0.1], [b + 0.04, h1 + 0.1], [b + 0.04, h1 + 0.78],
          [b - 0.35, h1 + 1.0], [a + 0.26, h1 + 0.92], [a - 0.04, h1 + 0.66]],
        0.2, depth - 0.02, { tone: 1.04 }, 0.22);
      }
    }
  }
  // The remaining end is stepped outward near the ground and cut back above,
  // making a broken thickness visible even when viewed beside the tall face.
  const end = reverse ? 1 : -1;
  const outer = end * (radius + 0.35), inner = end * (radius - 2.0);
  const a = Math.min(outer, inner), b = Math.max(outer, inner);
  block(a, b, 1.35, 4.05, 0.23, depth - 0.05, {}, 0.24);
  profile([[a + 0.12, 4.16], [b - 0.12, 4.16], [b - 0.12, 6.2],
    [b - 0.52, 6.65], [a + 0.46, 6.47], [a + 0.12, 5.9]],
  0.34, depth - 0.18, {}, 0.21);

  const footW = radius + 0.35 + s.shift, footH = depth * 0.45;
  return { mesh, footW, footH, collisionRects: [
    { minX: -footW / ASPECT, maxX: footW / ASPECT, minY: -footH, maxY: 0.3 },
  ] };
}
