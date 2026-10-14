// Branch-grown crowns. This stream is independent of placement and trunk
// sizing: changing a spray never changes the obstacles in a seeded forest.
import { mulberry32 } from '../core/rng.js';

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const WOODINESS = { oak: 1.1, birch: 0.48, pine: 0.78, spruce: 0.6,
  acacia: 0.95, jungle: 1.3, cherry: 0.9, willow: 0.65 };

function segment(x0, y0, x1, y1, r0, r1, trunk = false) {
  const pad = Math.max(1.5, r0 * (trunk ? 1.9 : 1), r1);
  return { x0, y0, x1, y1, r0, r1, trunk,
    minX: Math.min(x0, x1) - pad, maxX: Math.max(x0, x1) + pad,
    minY: Math.min(y0, y1) - pad, maxY: Math.max(y0, y1) + pad };
}

export function branchCrown(shape, species, growth, seed) {
  if (growth === 'bush') return shape;
  const rand = mulberry32((seed ^ 0x73a941cd) >>> 0);
  const mature = growth === 'mature';
  const scale = mature ? 1 : 0.3;
  const wind = rand() < 0.5 ? -1 : 1;
  const phase = rand() * TAU;
  const bend = species === 'birch' ? 0.9 : species === 'jungle' ? 2.7 : 2.1;
  const bendAt = y => (Math.sin(-y / shape.h * 3.8 + phase) - Math.sin(phase)) *
    bend * scale * clamp(-y / shape.h, 0, 1);

  // Several tapered lengths make a gently twisted stem. Boughs, roots and
  // leaf masses share the bend, so nothing floats beside the trunk.
  const wood = [];
  for (const s of shape.wood) {
    const count = s.trunk ? 7 : 2;
    for (let i = 0; i < count; i++) {
      const a = i / count, b = (i + 1) / count;
      const at = t => ({ x: s.x0 + (s.x1 - s.x0) * t,
        y: s.y0 + (s.y1 - s.y0) * t, r: s.r0 + (s.r1 - s.r0) * t });
      const p = at(a), q = at(b);
      wood.push(segment(p.x + bendAt(p.y), p.y, q.x + bendAt(q.y), q.y, p.r, q.r, s.trunk));
    }
  }
  shape.wood = wood;
  const leaf = (x, y, rx, ry, depth, layer, flowX = 0, flowY = 0.7) => {
    shape.blobs.push({ x, y, rx, ry, depth, layer, flowX, flowY });
  };
  const bough = (ax, ay, bx, by, width, curl = 0) => {
    const mx = ax + (bx - ax) * 0.55;
    const my = ay + (by - ay) * 0.5 + curl;
    shape.wood.push(segment(ax, ay, mx, my, width, width * 0.52));
    shape.wood.push(segment(mx, my, bx, by, width * 0.52, 0.13 * scale));
  };

  if (species === 'spruce') {
    // Drooping, uneven boughs carry needles in small overlapping brushes.
    // Their hems have loose ends and windows, not a filled triangular skirt.
    shape.blobs = [];
    shape.tiers.forEach((t, layer) => {
      const ax = t.x + bendAt(t.y), ay = t.y + t.depth * 0.22;
      for (const side of [-1, 1]) {
        const reach = t.width * (0.82 + rand() * 0.24);
        const bx = ax + side * reach;
        const by = t.y + t.depth * (0.73 + rand() * 0.18);
        bough(ax, ay, bx, by, (0.45 + reach * 0.025) * scale, t.depth * 0.13);
        for (let j = 1; j <= 4; j++) {
          const v = j / 4;
          const x = ax + (bx - ax) * v, y = ay + (by - ay) * v;
          const rx = (1.4 * scale + reach * 0.17) * (0.85 + rand() * 0.3);
          const ry = t.depth * (0.25 + rand() * 0.1);
          leaf(x, y + ry * 0.25, rx, ry, layer * 0.55 + rand() * 2, layer, side * 0.7, 1);
          leaf(x + side * rx * 0.4, y + ry * 0.67, rx * 0.65, ry * 0.6,
            layer * 0.55 + 1.5, layer, side * 0.4, 1);
        }
      }
      leaf(ax, ay, 1.5 * scale, t.depth * 0.42, layer * 0.55, layer, 0, -1);
    });
    shape.tiers = [];
  } else {
    const crowns = shape.crowns.map(c => ({ ...c, x: c.x + bendAt(c.y) }));
    shape.blobs = [];
    if (mature && ['oak', 'birch', 'pine', 'jungle'].includes(species)) {
      // Older side shoots break up the long exposed stem. They are smaller
      // and sit well below the main crown, as in the reference forest.
      for (let i = 0; i < 2; i++) {
        const y = -shape.h * (0.59 + i * 0.12 + rand() * 0.035);
        const side = i ? -wind : wind;
        const x = bendAt(y) + side * (4 + rand() * 5);
        bough(bendAt(y + 6), y + 6, x, y, 0.55, 1.5);
        crowns.push({ x, y, rx: 3.5 + rand() * 2, ry: 3 + rand() * 2, layer: 20 + i });
      }
    }
    crowns.forEach((c, layer) => {
      const pine = species === 'pine';
      const flat = species === 'acacia';
      const drift = wind * (rand() - 0.2) * c.rx * (pine ? 0.16 : 0.08);
      const ax = c.x - drift * 0.35, ay = c.y + c.ry * 0.45;
      // A subdued rear mass gives the crown depth behind its finer sprays.
      leaf(c.x + drift, c.y, c.rx * 0.64, c.ry * 0.63, -2 + rand(), layer, wind * 0.25, 0.5);
      const arms = pine ? 3 : 4 + Math.floor(rand() * 3);
      for (let arm = 0; arm < arms; arm++) {
        const angle = (arm + 0.25 + rand() * 0.55) / arms * TAU;
        const reach = 0.68 + rand() * 0.31;
        const bx = clamp(c.x + drift + Math.cos(angle) * c.rx * reach, -34, 34);
        const by = c.y + Math.sin(angle) * c.ry * reach * (flat ? 0.7 : 0.95);
        const weight = WOODINESS[species] * (0.5 + rand() * 0.45) * scale;
        const curl = (rand() - 0.35) * c.ry * 0.32;
        bough(ax, ay, bx, by, weight, curl);
        const dx = bx - ax, dy = by - ay;
        const length = Math.hypot(dx, dy) || 1;
        for (let j = 0; j < 3; j++) {
          const v = 0.55 + j * 0.2;
          const x = ax + dx * v, y = ay + dy * v + Math.sin(v * Math.PI) * curl;
          const rx = c.rx * (0.19 + rand() * 0.11);
          const ry = c.ry * (0.23 + rand() * 0.13);
          const side = j % 2 ? -1 : 1;
          const tx = x - dy / length * rx * 0.42 * side;
          const ty = y + dx / length * ry * 0.35 * side;
          bough(x, y, tx, ty, 0.2 * scale, 0);
          leaf(tx, ty, rx, ry, 1.2 + j * 0.5 + rand() * 2.5, layer, dx / length, dy / length);
        }
        // Small last leaves and twig ends fray the silhouette.
        leaf(bx + dx / length * scale, by + dy / length * scale,
          c.rx * 0.13, c.ry * 0.18, 3 + rand(), layer, dx / length, dy / length);
      }
    });
  }

  // Willow curtains start on individual outer boughs, vary in length, and
  // curl into separated leaf threads. No evenly spaced hanging bars.
  if (species === 'willow') {
    shape.strands = [];
    shape.crowns.forEach((c, layer) => {
      for (let i = 0; i < 5; i++) {
        const side = (i / 4 - 0.5) * 1.8;
        const y = c.y + c.ry * (0.35 + rand() * 0.3);
        shape.strands.push({ x: c.x + bendAt(c.y) + side * c.rx, y,
          length: (15 + rand() * 30) * scale, bend: wind * (1.3 + rand() * 3) * scale,
          radius: (0.3 + rand() * 0.35) * scale, layer: layer * 5 + i, vine: false });
      }
    });
  } else {
    for (const strand of shape.strands) {
      strand.x += bendAt(strand.y);
      strand.bend += wind * 1.2 * scale;
    }
  }
  return shape;
}
