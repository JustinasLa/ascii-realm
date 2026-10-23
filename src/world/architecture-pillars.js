import { ArchitectureMesh } from './architecture-mesh.js';
import { fracturedDrum, fallenDrum, makeColumnGeometry, masonryFragment, wornTurn } from './architecture-columns.js';

export { PILLAR_DEFINITIONS, PILLAR_RUINS } from './pillar-catalog.js';

// Convex hulls of separate solid parts keep the space between fallen masonry
// and the standing base walkable, including after yaw and scale.
function hull(points) {
  const sorted = [...new Map(points.map(p => [p.join(','), p])).values()]
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const half = (list) => {
    const result = [];
    for (const p of list) {
      while (result.length > 1 && cross(result.at(-2), result.at(-1), p) <= 0) result.pop();
      result.push(p);
    }
    return result.slice(0, -1);
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

export function makePillarGeometry(kind, rand, seed) {
  const square = kind === 'column-square' || kind.startsWith('column-square-');
  const ruin = kind === 'column-square' ? null : kind.split('-').at(-1);
  const original = makeColumnGeometry('column-tall', rand, seed);
  const mesh = new ArchitectureMesh();
  // Reuse the original turned mouldings. Only the plinth and abacus become
  // square; the shaft stays round, matching the established stone columns.
  mesh.triangles = original.mesh.triangles.filter(t =>
    t.points.every(([, h]) => h <= 6.4) && (!square || t.points.every(([, h]) => h >= 1.18)));
  const allPoints = original.mesh.triangles.flatMap(t => t.points);
  const minX = Math.min(...allPoints.map(p => p[0])), maxX = Math.max(...allPoints.map(p => p[0]));
  const minZ = Math.min(...allPoints.map(p => p[2])), maxZ = Math.max(...allPoints.map(p => p[2]));
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const radius = (maxZ - minZ) / 2, shaft = radius * 0.65;
  const tone = 0.98 + rand() * 0.04;
  if (square) {
    mesh.bevelBox(cx - radius, cx + radius, 0.03, 0.96, cz - radius, cz + radius, 0.18, { tone: tone * 0.94 });
    mesh.bevelBox(cx - radius * 0.9, cx + radius * 0.9, 0.98, 1.3,
      cz - radius * 0.9, cz + radius * 0.9, 0.09, { tone });
  }

  const parts = [];
  const part = (draw) => {
    const start = mesh.triangles.length;
    draw();
    const points = mesh.triangles.slice(start).flatMap(t => t.points.map(([x, , z]) => [x, z]));
    if (points.length) parts.push(hull(points));
  };
  parts.push(hull(mesh.triangles.flatMap(t => t.points.map(([x, , z]) => [x, z]))));
  const drum = (x, z, bottom, top, r = shaft) => mesh.lathe(x, z,
    [[r - 0.14, bottom], [r, bottom + 0.2], [r * 0.99, top - 0.18], [r * 0.96, top]],
    { shaft: true, tone }, null, 64);
  const chip = (dx, dz, size = 1.5) => part(() => masonryFragment(mesh, cx + dx, cz + dz,
    size * 1.3, size, 0.03, size * 0.65, rand() * 0.9, rand, { tone }));

  if (ruin === 'snapped') {
    part(() => {
      fracturedDrum(mesh, cx, cz, shaft, 6.2, 32 + rand() * 2, rand, tone, 3);
    });
    chip(radius * 0.8, -radius * 0.6, 2.8);
  } else if (ruin === 'split') {
    // Two actual lobes with a widening daylight fissure and exposed stone
    // faces; the cut continues through the crown instead of a painted crack.
    part(() => {
      drum(cx, cz, 6.2, 18);
      for (const side of [-1, 1]) {
        const outline = [];
        const start = side === 1 ? -Math.PI / 2 : Math.PI / 2;
        for (let i = 0; i <= 24; i++) {
          const a = start + i * Math.PI / 24;
          outline.push([cx + Math.cos(a) * shaft + side * 0.7, cz + Math.sin(a) * shaft]);
        }
        mesh.slab(outline, 18, outline.map(([x, z]) => 45 + (x - cx) * 0.4
          + Math.sin(z * 2.3) * 0.5 + (side > 0 ? 3 : 0)), { shaft: true, tone });
      }
    });
    chip(-radius * 0.8, -radius * 0.45, 2.2);
  } else if (ruin === 'shifted') {
    part(() => {
      for (const [i, offset] of [0, 0.4, -1.8, 2.8].entries()) {
        drum(cx + offset, cz + i * 0.12, 6.2 + i * 10.5, 16.4 + i * 10.5, shaft * (1 - i * 0.025));
      }
      fracturedDrum(mesh, cx + 2.8, cz + 0.36, shaft * 0.925, 47.7, 52, rand, tone);
    });
    chip(radius * 0.72, -radius * 0.7, 1.8);
  } else if (ruin === 'collapsed') {
    part(() => fracturedDrum(mesh, cx, cz, shaft, 6.2, 13.5, rand, tone));
    part(() => fallenDrum(mesh, cx + 15 + 0.55 * cz, cz, shaft * 0.94, 22,
      -0.16, 0.05, rand, tone));
    chip(radius * 0.7, -radius * 0.75, 2.8);
    chip(radius * 1.4, radius * 0.5, 2);
  } else {
    const neck = ruin === 'chipped' ? 52 : 58;
    part(() => {
      for (let i = 0; i < 5; i++) drum(cx, cz, 6.2 + (neck - 6.2) * i / 5,
        6.2 + (neck - 6.2) * (i + 1) / 5 - 0.12, shaft * (1 - i * 0.018));
      wornTurn(mesh, cx, cz, [[shaft * 0.92, neck], [shaft * 1.08, neck + 0.5],
        [shaft * 1.1, neck + 1.1], [radius * 0.84, neck + 3.5], [radius * 0.9, neck + 4.2]],
      rand, { tone }, ruin ? 2.1 : 0.18);
      if (square) {
        // A missing corner on the chipped square abacus is part of its mesh.
        const r = radius * 0.93, cut = ruin ? r * 0.85 : 0.25;
        mesh.slab([[cx - r, cz - r], [cx + r - cut, cz - r], [cx + r, cz - r + cut],
          [cx + r, cz + r], [cx - r, cz + r]], neck + 4.18,
        [neck + 6, neck + 5.8, neck + (ruin ? 4.8 : 5.8), neck + 6, neck + 6], { tone });
      } else {
        wornTurn(mesh, cx, cz, [[radius * 0.85, neck + 4.18], [radius * 0.96, neck + 4.6],
          [radius * 0.96, neck + 5.7], [radius * 0.92, neck + 6]], rand, { tone }, 2.5);
      }
    });
    if (ruin) chip(radius * 0.74, -radius * 0.6, 2.5);
  }

  // Pillars stand around their own footing centre. Unlike the connected walls,
  // they use a symmetric ground projection: a 45-degree square reads as a
  // balanced diamond, with the upright shaft directly above its centre.
  mesh.triangles = mesh.triangles.map(t => ({ ...t,
    points: t.points.map(([x, h, z]) => [x - cx, h, z - cz]),
  }));
  const groundFootprints = parts.map(polygon => polygon.map(([x, z]) => [x - cx, z - cz]));
  const points = groundFootprints.flat();
  return { mesh, groundFootprints, polygonCollision: true, groundSkew: 0,
    footW: Math.max(...points.map(([x]) => Math.abs(x))),
    footH: Math.max(...points.map(([, z]) => Math.abs(z) * 0.45)) };
}
