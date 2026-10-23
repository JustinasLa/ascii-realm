import { ArchitectureMesh } from './architecture-mesh.js';
import { ASPECT } from './world.js';

const TAU = Math.PI * 2;
const unit = (v) => { const d = Math.hypot(...v); return v.map((n) => n / (d || 1)); };
const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
const lerp = (a, b, t) => a + (b - a) * t;

// These are physical stone forms, without lighting, glyphs, or screen masks.
// The broad turned foot and restrained bell capital follow the reference's
// monumental, mostly smooth columns; detail comes from profiles and fractures.
function faceNormal(a, b, c) {
  const u = b.map((n, i) => n - a[i]), v = c.map((n, i) => n - a[i]);
  return unit([u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]);
}

function outwardFace(mesh, points, direction, material, smooth = null) {
  let n = faceNormal(points[0], points[1], points[2]);
  if (n.reduce((s, v, i) => s + v * direction[i], 0) < 0) n = n.map((v) => -v);
  mesh.face(points, n, material, smooth);
}

// A turned rim with two broad, shallow missing bites. They deform the actual
// silhouette and expose oblique fracture faces, instead of adding dark marks.
export function wornTurn(mesh, cx, cz, profile, rand, material, wear = 0.16, segments = 64) {
  const phase = rand() * TAU;
  const scars = [
    { a: phase, width: 0.23 + rand() * 0.15, depth: wear * (0.7 + rand() * 0.3) },
    { a: phase + 2.2 + rand() * 0.7, width: 0.19 + rand() * 0.13, depth: wear * 0.6 },
  ];
  const rings = profile.map(([r, h], j) => Array.from({ length: segments }, (_, i) => {
    const a = i * TAU / segments;
    let loss = 0;
    for (const scar of scars) {
      const distance = Math.abs(Math.atan2(Math.sin(a - scar.a), Math.cos(a - scar.a)));
      loss += scar.depth * clamp(1 - distance / scar.width);
    }
    const rr = r - loss * (0.7 + 0.3 * Math.sin(j * 1.7));
    return [cx + rr * Math.cos(a), h - (j >= profile.length - 2 ? loss * 0.7 : 0), cz + rr * Math.sin(a)];
  }));
  for (let j = 0; j < rings.length - 1; j++) {
    const [r0, h0] = profile[j], [r1, h1] = profile[j + 1];
    for (let i = 0; i < segments; i++) {
      const k = (i + 1) % segments;
      const normalAt = (index) => {
        const a = index * TAU / segments;
        return unit([(h1 - h0) * Math.cos(a), r0 - r1, (h1 - h0) * Math.sin(a)]);
      };
      const a = normalAt(i), b = normalAt(k);
      outwardFace(mesh, [rings[j][i], rings[j][k], rings[j + 1][k], rings[j + 1][i]],
        a, material, [a, b, b, a]);
    }
  }
  const last = rings.at(-1);
  const center = [cx, profile.at(-1)[1], cz];
  for (let i = 0; i < segments; i++) {
    outwardFace(mesh, [center, last[i], last[(i + 1) % segments]], [0, 1, 0], { ...material, cap: true });
  }
}

// Clipped rectangular masonry, with a lower arris, vertical broken faces, and
// a sloping bevel around its lid. Four independently cut corners keep blocks
// architectural, while the irregular lid prevents identical box silhouettes.
export function masonryFragment(mesh, cx, cz, width, depth, bottom, height, angle, rand, material) {
  const x = width / 2, z = depth / 2;
  const cuts = Array.from({ length: 4 }, () => Math.min(width, depth) * (0.09 + rand() * 0.15));
  const outline = [[-x + cuts[0], -z], [x - cuts[1], -z], [x, -z + cuts[1]],
    [x, z - cuts[2]], [x - cuts[2], z], [-x + cuts[3], z], [-x, z - cuts[3]], [-x, -z + cuts[0]]];
  const bevel = Math.min(0.25, height * 0.2, width * 0.1, depth * 0.1);
  const tiltX = (rand() - 0.5) * 0.17, tiltZ = (rand() - 0.5) * 0.16;
  const wear = Array.from({ length: 8 }, () => rand() * Math.min(0.2, height * 0.14));
  const rotate = ([xx, hh, zz]) => [cx + xx * Math.cos(angle) - zz * Math.sin(angle), hh,
    cz + xx * Math.sin(angle) + zz * Math.cos(angle)];
  const rings = [0, 1, 2, 3].map((j) => outline.map(([xx, zz], i) => {
    const inset = j === 0 ? bevel * 0.45 : j === 3 ? bevel : 0;
    const px = xx * (1 - inset / x), pz = zz * (1 - inset / z);
    const lid = bottom + height + xx * tiltX + zz * tiltZ - wear[i];
    const h = j === 0 ? bottom : j === 1 ? bottom + bevel * 0.5 : j === 2 ? lid - bevel : lid;
    return rotate([px, h, pz]);
  }));
  for (let j = 0; j < 3; j++) for (let i = 0; i < 8; i++) {
    const k = (i + 1) % 8;
    const mid = rings[j][i].map((v, axis) => (v + rings[j][k][axis]) / 2);
    outwardFace(mesh, [rings[j][i], rings[j][k], rings[j + 1][k], rings[j + 1][i]],
      [mid[0] - cx, j === 2 ? bevel : 0, mid[2] - cz], material);
  }
  const lid = rings[3];
  const center = [0, 1, 2].map((axis) => lid.reduce((s, p) => s + p[axis], 0) / 8);
  for (let i = 0; i < 8; i++) outwardFace(mesh, [center, lid[i], lid[(i + 1) % 8]], [0, 1, 0],
    { ...material, cap: true });
}

export function fracturedDrum(mesh, cx, cz, radius, bottom, height, rand, tone, shear = 0) {
  const segments = 64;
  // One tilted break and a missing front/right shoulder, rather than a crown
  // of random spikes. The lower torn lip exposes a broad inclined stone face.
  const phase = rand() * 0.8 - 0.4;
  const shoulders = [-0.25, 0.12, -0.42, 0.16, -0.1, -0.52, 0.08, -0.16];
  const fracture = (a) => {
    const t = a / TAU * shoulders.length, k = Math.floor(t), f = t - k;
    return (0.95 + shear) * Math.cos(a + phase) + lerp(shoulders[k % 8], shoulders[(k + 1) % 8], f);
  };
  const bite = (a) => {
    const d = Math.abs(Math.atan2(Math.sin(a + 0.55), Math.cos(a + 0.55)));
    return clamp(1 - d / 0.65);
  };
  const bands = [
    [bottom, 0, 0], [height - 2.7, 0, 0], [height - 1.1, 0.25, 0.48], [height, 1, 0.85],
  ];
  const rings = bands.map(([h, slope, chip]) => Array.from({ length: segments }, (_, i) => {
    const a = i * TAU / segments;
    const rr = radius - bite(a) * chip;
    return [cx + rr * Math.cos(a), h + fracture(a) * slope - bite(a) * chip * 1.1, cz + rr * Math.sin(a)];
  }));
  for (let j = 0; j < rings.length - 1; j++) for (let i = 0; i < segments; i++) {
    const k = (i + 1) % segments, a = i * TAU / segments, b = k * TAU / segments;
    const radial = [Math.cos((i + 0.5) * TAU / segments), 0, Math.sin((i + 0.5) * TAU / segments)];
    const smooth = j === 0 ? [[Math.cos(a), 0, Math.sin(a)], [Math.cos(b), 0, Math.sin(b)],
      [Math.cos(b), 0, Math.sin(b)], [Math.cos(a), 0, Math.sin(a)]] : null;
    outwardFace(mesh, [rings[j][i], rings[j][k], rings[j + 1][k], rings[j + 1][i]], radial,
      { shaft: true, tone: j === 0 ? tone : tone * 0.95 }, smooth);
  }
  const edge = rings.at(-1);
  // A recessed inner ring gives the fracture real facets and thickness. Its
  // low relief remains within the cut plane instead of forming a pointed lid.
  const inner = Array.from({ length: 16 }, (_, i) => {
    const a = i * TAU / 16, r = radius * (0.46 + rand() * 0.06);
    return [cx + r * Math.cos(a), height + fracture(a) * 0.5 - 0.12 - rand() * 0.16, cz + r * Math.sin(a)];
  });
  for (let i = 0; i < segments; i++) {
    const k = (i + 1) % segments, sector = Math.floor(i / 4);
    const innerA = inner[sector], innerB = inner[(sector + 1) % 16];
    outwardFace(mesh, [edge[i], edge[k], innerA], [0, 1, 0], { tone: tone * 1.04, cap: true });
    if (i % 4 === 3) outwardFace(mesh, [edge[k], innerB, innerA], [0, 1, 0], { tone, cap: true });
  }
  const center = [cx, height - 0.22, cz];
  for (let i = 0; i < 16; i++) outwardFace(mesh, [center, inner[i], inner[(i + 1) % 16]], [0, 1, 0],
    { tone: tone * 1.02, cap: true });
}

function footprint(mesh) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const triangle of mesh.triangles) for (const [x, , z] of triangle.points) {
    minX = Math.min(minX, x + 0.55 * z); maxX = Math.max(maxX, x + 0.55 * z);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  return { mesh, footW: Math.max(Math.abs(minX), Math.abs(maxX)), footH: maxZ * 0.45,
    collisionRects: [{ minX: minX / ASPECT, maxX: maxX / ASPECT, minY: -maxZ * 0.45,
      maxY: Math.max(0.3, -minZ * 0.45) }] };
}

export function makeColumnGeometry(kind, rand, seed) {
  const mesh = new ArchitectureMesh();
  const broken = kind === 'column-broken', tall = kind === 'column-tall';
  const height = (tall ? 62 : broken ? 37 : 22) + rand() * (tall ? 5 : broken ? 4 : 3);
  const radius = 7.5 + rand() * 0.6;
  const shaft = radius * (0.64 + rand() * 0.015);
  const cz = radius + 0.12, cx = -0.55 * cz;
  const tone = 0.97 + rand() * 0.055;
  const baseScale = tall || broken ? 1 : 0.86;
  const baseTop = 6.3 * baseScale;
  // Broad circular plinth: square-edged bottom course, rolled lower torus,
  // recessed scotia, upper torus, and a restrained curved shaft transition.
  // Independent turned stones leave narrow actual recessed bedding joints.
  wornTurn(mesh, cx, cz, [[radius * 0.96, 0.03], [radius, 0.28 * baseScale],
    [radius, 0.82 * baseScale], [radius * 0.965, 1.02 * baseScale]], rand, { tone: tone * 0.93 }, 0.27);
  mesh.lathe(cx, cz, [[radius * 0.87, 1.0 * baseScale], [radius * 0.87, 1.16 * baseScale]],
    { tone: tone * 0.83 }, null, 64);
  wornTurn(mesh, cx, cz, [[radius * 0.89, 1.13 * baseScale], [radius * 0.955, 1.32 * baseScale],
    [radius * 0.98, 1.58 * baseScale], [radius * 0.957, 1.84 * baseScale],
    [radius * 0.89, 2.03 * baseScale], [radius * 0.84, 2.09 * baseScale]], rand, { tone: tone * 1.03 }, 0.18);
  wornTurn(mesh, cx, cz, [[radius * 0.825, 2.1 * baseScale], [radius * 0.79, 2.29 * baseScale],
    [radius * 0.72, 2.5 * baseScale], [radius * 0.705, 2.71 * baseScale],
    [radius * 0.73, 2.9 * baseScale], [radius * 0.78, 3.06 * baseScale]], rand, { tone }, 0.12);
  wornTurn(mesh, cx, cz, [[radius * 0.78, 3.08 * baseScale], [radius * 0.82, 3.24 * baseScale],
    [radius * 0.825, 3.44 * baseScale], [radius * 0.79, 3.65 * baseScale],
    [radius * 0.7, 3.83 * baseScale], [shaft * 1.13, 3.95 * baseScale],
    [shaft * 1.13, 4.17 * baseScale], [shaft * 1.05, 4.34 * baseScale],
    [shaft, baseTop]], rand, { tone: tone * 1.015 }, 0.12);

  const capitalDepth = tall ? 6.3 : 4.6;
  const shaftTop = broken ? height - 3.0 : height - capitalDepth;
  const drumCount = tall ? 5 : broken ? 3 : 2;
  const length = shaftTop - baseTop;
  // Gentle entasis and taper; no ornamental fluting absent from the reference.
  const at = (h) => {
    const t = clamp((h - baseTop) / Math.max(1, height - capitalDepth - baseTop));
    return shaft * (1 - t * 0.085 + Math.sin(Math.PI * t) * 0.027);
  };
  for (let i = 0; i < drumCount; i++) {
    const start = baseTop + length * i / drumCount, end = baseTop + length * (i + 1) / drumCount;
    const seam = i === 0 ? 0 : 0.13;
    const drift = i === 0 ? 0 : (rand() - 0.5) * 0.055;
    mesh.lathe(cx + drift, cz, [[at(start) - 0.08, start + seam], [at(start), start + seam + 0.16],
      [at(lerp(start, end, 0.35)), lerp(start, end, 0.35)],
      [at(lerp(start, end, 0.7)), lerp(start, end, 0.7)],
      [at(end), end - 0.16], [at(end) - 0.09, end - 0.015]],
    { shaft: true, tone: tone * (0.975 + rand() * 0.035) }, null, 64);
    if (i > 0) mesh.lathe(cx, cz, [[at(start) - 0.15, start - 0.04], [at(start) - 0.15, start + seam + 0.03]],
      { shade: 0.78, tone: tone * 0.86 }, null, 64);
  }
  if (broken) {
    fracturedDrum(mesh, cx, cz, at(shaftTop) - 0.025, shaftTop - 0.03, height, rand, tone);
  } else {
    const neck = height - capitalDepth, s = capitalDepth / 4.7;
    const r = at(neck);
    // Astragal, narrow neck, curved echinus and a thick circular abacus. The
    // flaring crown in the footage is turned masonry, not an ornate square cap.
    wornTurn(mesh, cx, cz, [[r, neck - 0.03], [r * 1.07, neck + 0.16 * s],
      [r * 1.13, neck + 0.36 * s], [r * 1.13, neck + 0.57 * s],
      [r * 1.06, neck + 0.75 * s], [r * 1.025, neck + 0.86 * s]], rand, { tone: tone * 1.02 }, 0.11);
    wornTurn(mesh, cx, cz, [[r * 1.025, neck + 0.88 * s], [r * 1.03, neck + 1.3 * s],
      [r * 1.08, neck + 1.58 * s], [r * 1.2, neck + 1.89 * s],
      [r * 1.39, neck + 2.22 * s], [r * 1.6, neck + 2.54 * s],
      [radius * 0.86, neck + 2.86 * s], [radius * 0.9, neck + 3.1 * s],
      [radius * 0.91, neck + 3.27 * s]], rand, { tone }, 0.2);
    mesh.lathe(cx, cz, [[radius * 0.84, neck + 3.26 * s], [radius * 0.84, neck + 3.45 * s]],
      { tone: tone * 0.85 }, null, 64);
    wornTurn(mesh, cx, cz, [[radius * 0.88, neck + 3.44 * s], [radius * 0.96, neck + 3.65 * s],
      [radius * 0.96, height - 0.29 * s], [radius * 0.92, height]], rand,
    { tone: tone * 1.035 }, 0.7);
  }

  // A couple of dislodged rim chips remain on the existing circular footprint.
  const chipSide = (seed & 1) ? -1 : 1;
  for (let i = 0; i < 2; i++) {
    const z = cz - radius * (0.35 + i * 0.18), x = cx + chipSide * radius * (0.69 - i * 0.12);
    masonryFragment(mesh, x, z, 0.8 + rand() * 0.4, 0.65 + rand() * 0.3, 0.02,
      0.27 + rand() * 0.18, rand() - 0.5, rand, { tone: tone * 0.96 });
  }
  return footprint(mesh);
}

// A fallen shaft section retains its cylindrical cross-section and chipped
// oblique end, so rubble reads as collapsed architecture rather than boulders.
export function fallenDrum(mesh, sx, cz, radius, length, angle, bottom, rand, tone) {
  const cx = sx - 0.55 * cz, segments = 40;
  const axis = [Math.cos(angle), 0, Math.sin(angle)];
  const across = [-Math.sin(angle), 0, Math.cos(angle)];
  const chips = Array.from({ length: 10 }, () => rand() * 0.3);
  const rings = [-length / 2, -length / 2 + 0.2, length / 2 - 0.23, length / 2].map((along, j) =>
    Array.from({ length: segments }, (_, i) => {
      const a = i * TAU / segments;
      const rr = radius - (j === 0 || j === 3 ? 0.17 + chips[Math.floor(i / 4)] : 0);
      const end = along + (j === 3 ? Math.cos(a - 0.5) * 0.17 : 0);
      return [cx + end * axis[0] + Math.cos(a) * rr * across[0],
        bottom + radius + Math.sin(a) * rr, cz + end * axis[2] + Math.cos(a) * rr * across[2]];
    }));
  for (let j = 0; j < 3; j++) for (let i = 0; i < segments; i++) {
    const k = (i + 1) % segments, a = i * TAU / segments, b = k * TAU / segments;
    const n = (t) => [Math.cos(t) * across[0], Math.sin(t), Math.cos(t) * across[2]];
    outwardFace(mesh, [rings[j][i], rings[j][k], rings[j + 1][k], rings[j + 1][i]], n((i + 0.5) * TAU / segments),
      { shaft: true, tone }, j === 1 ? [n(a), n(b), n(b), n(a)] : null);
  }
  for (const j of [0, 3]) {
    const end = rings[j], center = [0, 1, 2].map((a) => end.reduce((sum, p) => sum + p[a], 0) / segments);
    for (let i = 0; i < segments; i++) outwardFace(mesh, [center, end[i], end[(i + 1) % segments]],
      axis.map((n) => n * (j === 0 ? -1 : 1)), { tone: tone * 1.025, cap: true });
  }
}

export function makeRubbleGeometry(kind, rand, seed) {
  const mesh = new ArchitectureMesh(), large = kind === 'rubble-large';
  const scale = large ? 1 : 0.6;
  const mirror = seed & 1 ? -1 : 1;
  const tone = 0.96 + rand() * 0.065;
  const block = (sx, z, w, d, bottom, h, angle, index) => {
    sx *= scale * mirror; z *= scale;
    masonryFragment(mesh, sx - 0.55 * z, z, w * scale, d * scale, bottom * scale, h * scale,
      angle * mirror + (rand() - 0.5) * 0.12, rand, { tone: tone * (0.94 + index * 0.012) });
  };
  // Deliberate interlocking tiers: two back stones, two front fragments, then
  // displaced upper blocks with distinct exposed lids and recessed overlaps.
  block(-2.25, 4.1, 4.0, 2.75, 0.04, 2.15, -0.15, 0);
  block(2.05, 4.15, 4.25, 2.6, 0.04, 2.65, 0.23, 1);
  block(-3.35, 1.5, 3.25, 1.95, 0.02, 1.6, -0.27, 2);
  block(2.9, 1.45, 3.5, 1.8, 0.02, 1.35, 0.12, 3);
  if (large) {
    block(1.2, 3.7, 3.25, 2.1, 2.15, 1.7, -0.29, 4);
    fallenDrum(mesh, -1.2 * mirror, 2.7, 1.25, 4.6, -0.22 * mirror, 1.0, rand, tone);
    block(-0.1, 0.65, 1.4, 0.92, 0.02, 0.6, 0.48, 5);
    block(4.8, 2.6, 1.0, 1.15, 0.02, 0.65, -0.3, 6);
  } else {
    // A broken moulding over the front course supplies a recognizable curved
    // architectural fragment without turning the small pile into a heap.
    fallenDrum(mesh, -0.2 * mirror, 1.7, 0.83, 2.8, -0.2 * mirror, 0.6, rand, tone);
  }
  return footprint(mesh);
}
