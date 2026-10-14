import { ASPECT } from './world.js';

// Geometry is measured in physical row units, as in props.js. Random choices
// happen before sampling, so supersampling and moving a prop never change it.
const clamp = (n) => Math.max(0, Math.min(1, n));
const surface = (l, c) => ({ l: clamp(l), c });

function ellipse(px, py, cx, cy, rx, ry) {
  const nx = (px - cx) / rx;
  const ny = (py - cy) / ry;
  return { nx, ny, d2: nx * nx + ny * ny };
}

function lineDistance(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const t = clamp(((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy));
  return { t, d: Math.hypot(px - ax - vx * t, py - ay - vy * t) };
}

function leafSample(px, py, leaf) {
  const dx = px - leaf.x;
  const dy = py - leaf.y;
  const nx = (dx * leaf.cos + dy * leaf.sin) / leaf.rx;
  const ny = (-dx * leaf.sin + dy * leaf.cos) / leaf.ry;
  return nx * nx + ny * ny <= 1 ? ny : null;
}

function makePine(x, y, rand, seed, bake) {
  const height = 27 + rand() * 7;
  const radius = 6.8 + rand() * 1.8;
  const tint = rand();
  const foliage = [34 + tint * 13, 103 + tint * 26, 76 + tint * 14];
  const bark = [103, 74, 47];
  const canopy = height - 5;
  const layers = Array.from({ length: 5 }, (_, i) => ({
    top: -height + canopy * i * 0.16,
    bottom: -height + canopy * (i * 0.16 + 0.35),
    radius: radius * (0.28 + i * 0.18),
    cx: (rand() - 0.5) * 0.55,
    phase: rand() * Math.PI * 2,
  }));
  const sample = (px, py) => {
    if (py > 0) return null;
    // Upper branches overlap the next tier, giving each a separate dark hem.
    for (const layer of layers) {
      if (py < layer.top || py > layer.bottom) continue;
      const t = (py - layer.top) / (layer.bottom - layer.top);
      const edge = layer.radius * t;
      const jag = 0.13 * Math.sin(py * 3.2 + layer.phase);
      const nx = (px - layer.cx) / Math.max(0.1, edge);
      if (Math.abs(px - layer.cx) > edge + jag) continue;
      const needles = 0.045 * Math.sin(px * 8 + py * 2.7 + layer.phase);
      const hem = t > 0.86 ? -0.17 : 0;
      return surface(0.64 - nx * 0.19 - t * 0.15 + needles + hem, foliage);
    }
    const trunkWidth = 0.68 + (py + 9) * 0.025;
    if (py >= -10 && Math.abs(px) <= trunkWidth) {
      return surface(0.62 - px * 0.19 + 0.05 * Math.sin(px * 12), bark);
    }
    return null;
  };
  return {
    kind: 'pine', x, y, footW: 1.8, footH: 1.1,
    cells: bake(Math.ceil((radius + 0.4) / ASPECT), -Math.ceil(height), 0, sample, seed),
  };
}

function makeStump(x, y, rand, seed, bake) {
  const radius = 2.4 + rand() * 1.1;
  const height = 4.5 + rand() * 1.9;
  const topY = -height + 1.05;
  const topRy = 1.15 + rand() * 0.3;
  const phase = rand() * Math.PI * 2;
  const bark = [115, 79, 48];
  const cut = [194, 153, 92];
  const roots = [-0.85, 0.85].map((side) => ({
    ax: side * radius * 0.55, ay: -2.1,
    bx: side * radius * 1.27, by: -0.35,
  }));
  const sample = (px, py) => {
    if (py > 0) return null;
    const top = ellipse(px, py, -0.12, topY, radius, topRy);
    if (top.d2 <= 1) {
      const r = Math.sqrt(top.d2);
      const ring = Math.sin(r * 27 + phase + top.nx * 0.6);
      const edge = r > 0.86;
      return surface(edge ? 0.41 : 0.77 - top.nx * 0.1 - top.ny * 0.1 + ring * 0.11, edge ? bark : cut);
    }
    if (py >= topY && py <= -0.2) {
      const t = (py - topY) / -topY;
      const rx = radius * (0.92 + t * 0.07);
      if (Math.abs(px) <= rx) {
        const furrow = Math.sin(px * 5.7 + 0.18 * Math.sin(py * 2) + phase);
        return surface(0.55 - px / radius * 0.23 + furrow * 0.12, bark);
      }
    }
    for (const root of roots) {
      const line = lineDistance(px, py, root.ax, root.ay, root.bx, root.by);
      if (line.d < 0.62 * (1 - line.t * 0.62)) return surface(0.42 - px / radius * 0.12, bark);
    }
    return null;
  };
  return {
    kind: 'stump', x, y, footW: radius / ASPECT, footH: 1.2,
    cells: bake(Math.ceil(radius * 1.35 / ASPECT), -Math.ceil(height + topRy), 0, sample, seed),
  };
}

function makeLog(x, y, rand, seed, bake) {
  const length = 10.5 + rand() * 4;
  const radius = 1.9 + rand() * 0.75;
  const cutRx = 1.15 + rand() * 0.3;
  const slope = (rand() - 0.5) * 0.1;
  const centerY = -radius - 0.65 - Math.abs(slope) * length / 2;
  const endX = length / 2;
  const phase = rand() * Math.PI * 2;
  const bark = [111, 78, 49];
  const wood = [196, 156, 102];
  const knotX = -length * (0.08 + rand() * 0.2);
  const sample = (px, py) => {
    if (py > 0) return null;
    const localY = py - centerY - px * slope;
    const end = ellipse(px, localY, endX, 0, cutRx, radius);
    if (end.d2 <= 1) {
      const r = Math.sqrt(end.d2);
      const ring = Math.sin(r * 25 + phase + end.ny * 0.4);
      return surface(r > 0.85 ? 0.42 : 0.79 - end.nx * 0.14 - end.ny * 0.12 + ring * 0.11,
        r > 0.85 ? bark : wood);
    }
    const left = ellipse(px, localY, -endX, 0, cutRx * 0.75, radius);
    if ((px < -endX || px > endX || Math.abs(localY) > radius) && !(px <= -endX && left.d2 <= 1)) return null;
    const ny = localY / radius;
    const grain = Math.sin(localY * 8 + Math.sin(px * 0.8 + phase) * 0.65 + phase);
    const knot = ellipse(px, localY, knotX, -0.15, 1.25, 0.6);
    const knotShade = knot.d2 < 1 ? Math.sin(Math.sqrt(knot.d2) * 14) * 0.11 - 0.09 : 0;
    return surface(0.61 - ny * 0.21 - px / length * 0.08 + grain * 0.095 + knotShade, bark);
  };
  return {
    kind: 'log', x, y, footW: (length / 2 + cutRx) / ASPECT, footH: 1.35,
    cells: bake(Math.ceil((endX + cutRx) / ASPECT), -Math.ceil(radius * 2 + 1.5), 0, sample, seed),
  };
}

function makeFlowers(x, y, rand, seed, bake) {
  const spread = 4.4 + rand() * 1.2;
  const count = 5 + Math.floor(rand() * 3);
  const palette = [[235, 99, 136], [245, 192, 70], [168, 120, 232], [121, 187, 245], [241, 221, 182]];
  const paletteOffset = Math.floor(rand() * palette.length);
  const flowers = [];
  let height = 0;
  for (let i = 0; i < count; i++) {
    const fx = (i / (count - 1) * 2 - 1) * spread + (rand() - 0.5) * 0.65;
    const fy = -(4.2 + rand() * 3.5);
    const size = 0.82 + rand() * 0.32;
    const baseX = fx * 0.6;
    const angle = rand() * Math.PI * 2;
    const leaves = [-1, 1].map((side) => {
      const a = side > 0 ? -0.55 : -2.55;
      return { x: fx * 0.8 + side * 0.7, y: fy * 0.43 - 0.25,
        rx: 1.15, ry: 0.37, cos: Math.cos(a), sin: Math.sin(a) };
    });
    flowers.push({ x: fx, y: fy, baseX, size, angle, leaves, color: palette[(paletteOffset + i) % palette.length] });
    height = Math.max(height, -fy + size * 1.7);
  }
  const green = [64, 126, 61];
  const sample = (px, py) => {
    if (py > 0) return null;
    for (const flower of flowers) {
      const center = ellipse(px, py, flower.x, flower.y, flower.size * 0.36, flower.size * 0.36);
      if (center.d2 <= 1) return surface(0.9 - center.ny * 0.06, [248, 209, 78]);
      for (let p = 0; p < 5; p++) {
        const a = flower.angle + p * Math.PI * 2 / 5;
        const petal = ellipse(px, py, flower.x + Math.cos(a) * flower.size * 0.77,
          flower.y + Math.sin(a) * flower.size * 0.77, flower.size * 0.65, flower.size * 0.6);
        if (petal.d2 <= 1) return surface(0.8 - petal.nx * 0.1 - petal.ny * 0.12, flower.color);
      }
    }
    for (const flower of flowers) {
      for (const leaf of flower.leaves) {
        const ny = leafSample(px, py, leaf);
        if (ny !== null) return surface(0.65 - ny * 0.13, green);
      }
      const stem = lineDistance(px, py, flower.baseX, -0.1, flower.x, flower.y);
      if (stem.d <= 0.25) return surface(0.65, green);
    }
    return null;
  };
  return {
    kind: 'flowers', x, y, footW: spread * 0.65 / ASPECT, footH: 0.65,
    cells: bake(Math.ceil((spread + 2.1) / ASPECT), -Math.ceil(height), 0, sample, seed),
  };
}

function makeMushrooms(x, y, rand, seed, bake) {
  const count = 3 + Math.floor(rand() * 2);
  const mushrooms = [];
  const capColors = [[196, 64, 45], [209, 123, 46], [154, 91, 65]];
  const color = capColors[Math.floor(rand() * capColors.length)];
  let height = 0;
  let width = 0;
  for (let i = 0; i < count; i++) {
    const central = i === 1;
    const mx = (i - (count - 1) / 2) * 2.5 + (rand() - 0.5) * 0.45;
    const h = central ? 6.1 + rand() * 1.4 : 3.0 + rand() * 2.2;
    const rx = central ? 2.2 + rand() * 0.55 : 1.35 + rand() * 0.55;
    const ry = rx * (0.65 + rand() * 0.15);
    const base = -h + ry;
    const spots = Array.from({ length: 4 }, () => ({
      x: mx + (rand() - 0.5) * rx * 1.35,
      y: base - ry * (0.26 + rand() * 0.47),
      r: 0.23 + rand() * 0.15,
    }));
    mushrooms.push({ x: mx, base, rx, ry, spots, h });
    height = Math.max(height, h);
    width = Math.max(width, Math.abs(mx) + rx);
  }
  // The shorter caps sit in front of the tall mushroom's stem.
  mushrooms.sort((a, b) => a.h - b.h);
  const sample = (px, py) => {
    if (py > 0) return null;
    for (const mushroom of mushrooms) {
      const cap = ellipse(px, py, mushroom.x, mushroom.base, mushroom.rx, mushroom.ry);
      if (py <= mushroom.base && cap.d2 <= 1) {
        for (const spot of mushroom.spots) {
          if (ellipse(px, py, spot.x, spot.y, spot.r, spot.r * 0.8).d2 <= 1) {
            return surface(0.87, [237, 217, 169]);
          }
        }
        return surface(0.75 - cap.nx * 0.2 - cap.ny * 0.11, color);
      }
      const rim = ellipse(px, py, mushroom.x, mushroom.base + 0.07, mushroom.rx, 0.37);
      if (rim.d2 <= 1) return surface(0.63 - rim.nx * 0.12, [209, 178, 133]);
      const stemTop = mushroom.base + 0.12;
      const stemWidth = 0.36 + mushroom.rx * 0.11;
      if (py >= stemTop && py <= 0 && Math.abs(px - mushroom.x) < stemWidth * (1 + py / stemTop * 0.18)) {
        return surface(0.8 - (px - mushroom.x) / stemWidth * 0.19, [217, 194, 146]);
      }
    }
    return null;
  };
  return {
    kind: 'mushrooms', x, y, footW: width * 0.75 / ASPECT, footH: 0.8,
    cells: bake(Math.ceil((width + 0.5) / ASPECT), -Math.ceil(height + 0.5), 0, sample, seed),
  };
}

function makeReeds(x, y, rand, seed, bake) {
  const count = 7 + Math.floor(rand() * 3);
  const reeds = [];
  const leaves = [];
  let height = 0;
  let width = 0;
  for (let i = 0; i < count; i++) {
    const baseX = (rand() - 0.5) * 2.5;
    const tipX = (i / (count - 1) * 2 - 1) * (2.6 + rand() * 1.1);
    const h = 10.2 + rand() * 5.3;
    const hasHead = i % 2 === 0;
    const headLength = 1.5 + rand() * 0.8;
    reeds.push({ baseX, tipX, h, hasHead, headLength });
    height = Math.max(height, h + (hasHead ? headLength * 0.5 : 0));
    const leafTipX = tipX + (tipX < 0 ? -1 : 1) * (1.8 + rand() * 1.4);
    leaves.push({ ax: baseX, ay: -0.2, bx: leafTipX, by: -h * (0.52 + rand() * 0.27) });
    width = Math.max(width, Math.abs(leafTipX), Math.abs(tipX) + 0.5);
  }
  const green = [110, 141, 64];
  const straw = [164, 157, 75];
  const heads = [130, 86, 45];
  const sample = (px, py) => {
    if (py > 0) return null;
    for (const reed of reeds) {
      if (reed.hasHead) {
        const head = lineDistance(px, py, reed.tipX, -reed.h - reed.headLength * 0.45,
          reed.tipX, -reed.h + reed.headLength * 0.55);
        if (head.d < 0.38) return surface(0.63 - (px - reed.tipX) * 0.23 + 0.07 * Math.sin(py * 8), heads);
      }
    }
    for (const leaf of leaves) {
      const blade = lineDistance(px, py, leaf.ax, leaf.ay, leaf.bx, leaf.by);
      const bladeWidth = 0.12 + 0.22 * Math.sin(blade.t * Math.PI);
      if (blade.d < bladeWidth && blade.t < 0.985) return surface(0.65 + blade.t * 0.1, green);
    }
    for (const reed of reeds) {
      const stem = lineDistance(px, py, reed.baseX, -0.05, reed.tipX, -reed.h);
      if (stem.d < 0.23) return surface(0.69, straw);
    }
    return null;
  };
  return {
    kind: 'reeds', x, y, footW: 2.5 / ASPECT, footH: 0.75,
    cells: bake(Math.ceil((width + 0.5) / ASPECT), -Math.ceil(height + 0.5), 0, sample, seed),
  };
}

const NATURAL_MAKERS = {
  pine: makePine,
  stump: makeStump,
  log: makeLog,
  flowers: makeFlowers,
  mushrooms: makeMushrooms,
  reeds: makeReeds,
};

export function makeNaturalProp(kind, x, y, rand, seed, bake) {
  const make = Object.hasOwn(NATURAL_MAKERS, kind) ? NATURAL_MAKERS[kind] : null;
  return make ? make(x, y, rand, seed, bake) : null;
}
