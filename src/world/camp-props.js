import { hash2 } from '../core/rng.js';
import { ASPECT } from './world.js';

// The sampler uses physical row units; bake converts its silhouette to cells.
// Shape choices consume the prop's seeded stream only during construction.
function segmentDistance(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy)));
  return Math.hypot(px - ax - t * vx, py - ay - t * vy);
}

function inPolygon(px, py, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if ((a[1] > py) !== (b[1] > py) && px < (b[0] - a[0]) * (py - a[1]) / (b[1] - a[1]) + a[0]) {
      inside = !inside;
    }
  }
  return inside;
}

function grain(px, py, seed) {
  return (hash2(Math.floor(px * 4), Math.floor(py * 1.7), seed) - 0.5) * 0.09;
}

function prop(kind, x, y, radius, height, footW, footH, sample, seed, bake) {
  return {
    kind,
    x,
    y,
    footW,
    footH,
    cells: bake(Math.ceil(radius / ASPECT) + 1, -Math.ceil(height), 0,
      (px, py) => py > 0 ? null : sample(px, py), seed),
  };
}

function makeCrate(x, y, rand, seed, bake) {
  const rx = 2.8 + rand() * 0.6;
  const height = 5.8 + rand() * 1.4;
  const wood = [148 + rand() * 18, 99, 51];
  const brace = [185, 132, 72];
  const outline = [
    [-rx + 0.35, -height], [rx - 0.35, -height],
    [rx, -height + 0.8], [rx, 0], [-rx, 0], [-rx, -height + 0.8],
  ];
  const sample = (px, py) => {
    if (!inPolygon(px, py, outline)) return null;
    const top = -height + 0.9;
    const edge = Math.abs(px) > rx - 0.42 || py > -0.43 || Math.abs(py - top) < 0.27;
    const cross = segmentDistance(px, py, -rx + 0.6, -0.6, rx - 0.6, top + 0.45) < 0.3
      || segmentDistance(px, py, rx - 0.6, -0.6, -rx + 0.6, top + 0.45) < 0.3;
    // Corner nails and narrow plank gaps make the diagonal braces stand out.
    if (Math.abs(Math.abs(px) - (rx - 0.22)) < 0.18
      && (Math.abs(py + 0.28) < 0.17 || Math.abs(py - top) < 0.19)) {
      return { l: 0.36, c: [74, 73, 66] };
    }
    if (edge || cross) return { l: 0.79 - px * 0.025 + grain(px, py, seed), c: brace };
    if (py < top) return { l: 0.83 + grain(px, py, seed), c: wood };
    const gap = Math.abs((px + rx) % 1.25 - 0.625) < 0.075;
    return { l: (gap ? 0.35 : 0.59) - px * 0.045 + grain(px, py, seed), c: wood };
  };
  return prop('crate', x, y, rx, height, rx * 0.9 / ASPECT, 1.25, sample, seed, bake);
}

function makeBarrel(x, y, rand, seed, bake) {
  const rx = 2.2 + rand() * 0.45;
  const height = 6.6 + rand() * 1.4;
  const wood = [143 + rand() * 18, 91, 45];
  const iron = [105, 115, 120];
  const sample = (px, py) => {
    const t = (py + height) / height;
    if (t < 0 || t > 1) return null;
    const side = rx * (0.77 + 0.23 * Math.sin(t * Math.PI));
    const nx = px / side;
    if (Math.abs(nx) > 1) return null;
    const capY = -height + 0.55;
    const cap = (px / (rx * 0.79)) ** 2 + ((py - capY) / 0.62) ** 2;
    if (py < -height + 1 && cap <= 1) {
      return { l: cap > 0.66 ? 0.43 : 0.72 - px * 0.075 + grain(px, py, seed), c: wood };
    }
    // Each hoop curves down slightly at its center, around the rounded body.
    for (const level of [0.2, 0.52, 0.85]) {
      const hoopY = -height + height * level + 0.23 * (1 - nx * nx);
      if (Math.abs(py - hoopY) < 0.32) {
        return { l: 0.58 - nx * 0.22 + (py < hoopY ? 0.12 : 0), c: iron };
      }
    }
    const stave = Math.abs((px + rx + 0.04 * Math.sin(py)) % 0.83 - 0.415) < 0.065;
    return { l: (stave ? 0.34 : 0.65) - nx * 0.21 + grain(px, py, seed), c: wood };
  };
  return prop('barrel', x, y, rx, height, rx * 0.85 / ASPECT, 1.25, sample, seed, bake);
}

function makeFence(x, y, rand, seed, bake) {
  const rx = 6.3 + rand() * 0.8;
  const height = 5.7 + rand() * 1.2;
  const postX = rx - 0.65;
  const wood = [138 + rand() * 18, 104, 65];
  const sample = (px, py) => {
    if (py < -height || Math.abs(px) > rx) return null;
    const postDistance = Math.abs(Math.abs(px) - postX);
    const postWidth = py < -height + 0.75 ? 0.58 * (py + height) / 0.75 : 0.58;
    if (postDistance < postWidth) {
      const edge = postDistance > postWidth - 0.17;
      return { l: (edge ? 0.43 : 0.74) - px * 0.01 + grain(px, py, seed), c: wood };
    }
    for (const level of [0.3, 0.7]) {
      const railY = -height + height * level;
      if (Math.abs(py - railY) < 0.43 && Math.abs(px) < postX + 0.3) {
        return { l: (py < railY - 0.16 ? 0.78 : 0.53) + grain(px, py, seed), c: wood };
      }
    }
    return null;
  };
  return prop('fence', x, y, rx, height, postX / ASPECT, 0.7, sample, seed, bake);
}

function makeTent(x, y, rand, seed, bake) {
  const rx = 6.5 + rand() * 1;
  const height = 10.4 + rand() * 2;
  const apex = -rx * (0.2 + rand() * 0.05);
  const rightFront = rx * 0.36;
  const backPeak = [rx * 0.42, -height * 0.86];
  const colors = [[147, 87, 51], [104, 125, 68], [66, 115, 145], [155, 72, 67]];
  const canvas = colors[Math.floor(rand() * colors.length)];
  const front = [[-rx, 0], [apex, -height], [rightFront, 0]];
  const side = [[apex, -height], backPeak, [rx, 0], [rightFront, 0]];
  const doorX = (-rx + rightFront) * 0.5;
  const door = [[doorX - 1.8, 0], [doorX + 0.15, -height * 0.64], [doorX + 1.8, 0]];
  const seams = [
    [-rx, 0, apex, -height], [apex, -height, rightFront, 0],
    [apex, -height, ...backPeak], [...backPeak, rx, 0],
  ];
  const sample = (px, py) => {
    const isFront = inPolygon(px, py, front);
    const isSide = inPolygon(px, py, side);
    if (!isFront && !isSide) return null;
    if (seams.some((s) => segmentDistance(px, py, ...s) < 0.25) || py > -0.35) {
      return { l: 0.82, c: [186, 166, 119] };
    }
    if (isFront && inPolygon(px, py, door)) {
      const doorEdge = segmentDistance(px, py, ...door[0], ...door[1]) < 0.22
        || segmentDistance(px, py, ...door[1], ...door[2]) < 0.22;
      return { l: doorEdge ? 0.59 : 0.24, c: doorEdge ? canvas : [37, 34, 34] };
    }
    const fold = Math.sin((px - apex) * 2.8 + py * 0.25) * 0.035;
    return { l: (isFront ? 0.73 : 0.44) + fold - py / height * 0.07 + grain(px, py, seed), c: canvas };
  };
  return prop('tent', x, y, rx, height, rx * 0.8 / ASPECT, 2.2, sample, seed, bake);
}

function makeCampfire(x, y, rand, seed, bake) {
  const radius = 3.6 + rand() * 0.6;
  const height = 7.3 + rand() * 1.2;
  const lean = (rand() - 0.5) * 0.55;
  const stones = Array.from({ length: 9 }, (_, i) => {
    const angle = i / 9 * Math.PI * 2;
    return { x: Math.cos(angle) * (radius - 0.65), y: -1.05 + Math.sin(angle) * 0.6,
      rx: 0.62 + rand() * 0.15, ry: 0.43 + rand() * 0.1 };
  });
  const flame = [
    [-1.7, -1.6], [-2, -3.25], [-1.4, -4.55], [-1.25, -3.8],
    [-0.65 + lean, -height], [0.15 + lean, -height * 0.7],
    [0.85 + lean, -height * 0.92], [1.32, -height * 0.56],
    [1.85, -3.7], [1.65, -1.65],
  ];
  const inner = [[-1.05, -1.6], [-0.7, -3.2], [-0.15, -height * 0.63], [0.85, -3.1], [1, -1.6]];
  const sample = (px, py) => {
    // Foreground stones sit across the log ends and the flame's lower edge.
    for (const stone of stones) {
      const nx = (px - stone.x) / stone.rx;
      const ny = (py - stone.y) / stone.ry;
      const d2 = nx * nx + ny * ny;
      if (d2 <= 1 && stone.y > -1.2) return { l: 0.58 - nx * 0.15 - ny * 0.19, c: [112, 108, 99] };
    }
    if (inPolygon(px, py, flame)) {
      if (inPolygon(px, py, inner)) {
        return { l: 0.88, c: py > -2.6 ? [215, 199, 95] : [215, 165, 38] };
      }
      return { l: 0.84 + grain(px, py, seed) * 0.4, c: [213, 95, 25] };
    }
    const logA = segmentDistance(px, py, -radius * 0.8, -2.3, radius * 0.8, -0.7);
    const logB = segmentDistance(px, py, -radius * 0.8, -0.7, radius * 0.8, -2.3);
    if (Math.min(logA, logB) < 0.4) {
      return { l: 0.49 + grain(px, py, seed), c: [114, 68, 35] };
    }
    for (const stone of stones) {
      const nx = (px - stone.x) / stone.rx;
      const ny = (py - stone.y) / stone.ry;
      if (nx * nx + ny * ny <= 1) return { l: 0.55 - nx * 0.15 - ny * 0.19, c: [112, 108, 99] };
    }
    return null;
  };
  return prop('campfire', x, y, radius + 0.15, height, radius * 0.9 / ASPECT, 1.2, sample, seed, bake);
}

function makeSignpost(x, y, rand, seed, bake) {
  const height = 9.1 + rand() * 1.5;
  const direction = rand() < 0.5 ? -1 : 1;
  const boardY = -height + 1.2;
  const wood = [155 + rand() * 17, 108, 60];
  const board = [[-3.35, boardY - 1.05], [2.65, boardY - 1.05],
    [4, boardY + 0.2], [2.65, boardY + 1.45], [-3.35, boardY + 1.45]];
  const sample = (px, py) => {
    const sx = px * direction;
    if (inPolygon(sx, py, board)) {
      const edge = board.some((a, i) => {
        const b = board[(i + 1) % board.length];
        return segmentDistance(sx, py, ...a, ...b) < 0.2;
      });
      if (Math.abs(sx) < 0.17 && Math.abs(py - boardY) < 0.23) return { l: 0.35, c: [72, 71, 65] };
      const groove = Math.abs(py - boardY - 0.15) < 0.11 && sx > -2.7 && sx < 2.2;
      return { l: (edge ? 0.81 : groove ? 0.37 : 0.67) + grain(sx, py, seed), c: wood };
    }
    if (py >= -height && Math.abs(px) < 0.48) {
      return { l: 0.58 - px * 0.28 + grain(px, py, seed), c: [119, 85, 48] };
    }
    return null;
  };
  return prop('signpost', x, y, 4, height, 1.05, 0.75, sample, seed, bake);
}

const MAKERS = { crate: makeCrate, barrel: makeBarrel, fence: makeFence,
  tent: makeTent, campfire: makeCampfire, signpost: makeSignpost };

export function makeCampProp(kind, x, y, rand, seed, bake) {
  const make = Object.hasOwn(MAKERS, kind) ? MAKERS[kind] : null;
  return make ? make(x, y, rand, seed, bake) : null;
}
