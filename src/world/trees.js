import { glyph } from '../render/glyphs.js';
import { hash2 } from '../core/rng.js';
import { valueNoise } from '../core/noise.js';
import { ASPECT } from './world.js';

export const TREE_SPECIES = Object.freeze([
  'oak', 'birch', 'pine', 'spruce', 'acacia', 'jungle', 'cherry', 'willow',
]);
export const MAX_TREE_HEIGHT = 240;
export const MAX_TREE_HALF_WIDTH = 64;

const TAU = Math.PI * 2;
const SUB_X = [-0.25, 0.25];
const SUB_Y = [-5 / 6, -0.5, -1 / 6];
const EVERGREEN = new Set(['pine', 'spruce']);
const SEASONS = new Set(['spring', 'summer', 'autumn', 'winter']);
const LEAF_GLYPHS = ['.,:;*', '*+xo', 'o%&#', '@&%#'];
const RUSTLE_GLYPHS = '@&%#*';
const SWAY = { oak: 1.05, birch: 1.3, pine: 0.7, spruce: 0.55, acacia: 0.8, jungle: 1.1, cherry: 1.2, willow: 1.5 };
const BARK = {
  oak: [116, 82, 48], birch: [206, 211, 191], pine: [125, 84, 52],
  spruce: [97, 76, 61], acacia: [153, 104, 62], jungle: [123, 97, 59],
  cherry: [130, 75, 69], willow: [110, 105, 64],
};
const SUMMER = {
  oak: [69, 153, 63], birch: [123, 187, 64], pine: [51, 127, 76],
  spruce: [51, 125, 111], acacia: [121, 160, 59], jungle: [44, 151, 85],
  cherry: [234, 130, 173], willow: [121, 176, 83],
};
const SPRING = {
  oak: [110, 184, 68], birch: [157, 203, 81], pine: [67, 147, 84],
  spruce: [65, 143, 118], acacia: [152, 185, 77], jungle: [63, 172, 92],
  cherry: [248, 153, 193], willow: [150, 196, 99],
};
const AUTUMN = {
  oak: [215, 117, 43], birch: [222, 181, 53], pine: [54, 122, 73],
  spruce: [47, 115, 105], acacia: [189, 153, 62], jungle: [113, 151, 62],
  cherry: [222, 115, 106], willow: [190, 180, 70],
};
const WINTER = {
  oak: [160, 126, 87], birch: [176, 162, 113], pine: [55, 103, 104],
  spruce: [57, 111, 124], acacia: [159, 145, 93], jungle: [85, 124, 99],
  cherry: [172, 134, 151], willow: [154, 161, 116],
};

const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const blend = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

function leafPalette(species, season, variation) {
  const colors = { spring: SPRING, summer: SUMMER, autumn: AUTUMN, winter: WINTER };
  const base = colors[season][species].map((v, i) => clamp(v + variation * (i === 1 ? 15 : 8), 0, 255));
  const pink = species === 'cherry';
  return {
    base,
    shadow: base.map((v, i) => v * (i === 0 ? 0.29 : 0.38) + (i === 2 ? 13 : 4)),
    // Warm leaf highlights and a cool moonlit edge facing the upper left.
    light: blend(base, pink ? [255, 217, 221] : [236, 222, 126], pink ? 0.58 : 0.43),
    rim: blend(base, pink ? [181, 188, 239] : [112, 188, 207], 0.46),
    accent: season === 'autumn' ? blend(base, [235, 76, 38], 0.4) : blend(base, [162, 209, 116], pink ? 0.02 : 0.18),
  };
}

function segmentDistance(px, py, s) {
  const vx = s.x1 - s.x0;
  const vy = s.y1 - s.y0;
  const t = clamp(((px - s.x0) * vx + (py - s.y0) * vy) / (vx * vx + vy * vy || 1));
  const radius = s.r0 + (s.r1 - s.r0) * t;
  return { distance: Math.hypot(px - s.x0 - vx * t, py - s.y0 - vy * t), radius, t };
}

// Geometry uses physical distances. ASPECT is only read when making a tree:
// world -> props -> trees -> world is a valid ES module initialization cycle.
function geometry(species, rand) {
  const blobs = [];
  const tiers = [];
  const wood = [];
  const strands = [];
  const ellipse = (x, y, rx, ry, layer = 0) => blobs.push({ x, y, rx, ry, layer });
  const branch = (x0, y0, x1, y1, r0 = 0.45, r1 = 0.15, trunk = false) => {
    const pad = Math.max(1.5, r0, r1);
    wood.push({ x0, y0, x1, y1, r0, r1, trunk,
      minX: Math.min(x0, x1) - pad, maxX: Math.max(x0, x1) + pad,
      minY: Math.min(y0, y1) - pad, maxY: Math.max(y0, y1) + pad,
    });
  };
  const fork = (x0, y0, x1, y1, spread = 2) => {
    branch(x0, y0, x1, y1, 0.65, 0.24);
    branch(x1, y1, x1 - spread, y1 - 3, 0.24, 0.1);
    branch(x1, y1, x1 + spread * 0.7, y1 - 4, 0.24, 0.1);
  };
  let h;
  let footW = 2.1;
  let footH = 1.15;

  if (species === 'oak') {
    h = 28 + rand() * 5;
    const rx = 7.6 + rand() * 1.2;
    branch(0, 0, -0.4, -h + 4, 1.2, 0.6, true);
    fork(0, -h * 0.51, -5.2, -h + 1, 2.6);
    fork(-0.3, -h * 0.65, 5.4, -h - 1, 2.5);
    ellipse(-0.5, -h - 1, rx, 8.1, 0);
    ellipse(-5.6, -h + 1.2, rx * 0.73, 5.8, 1);
    ellipse(5.4, -h + 0.5, rx * 0.7, 6, 2);
    ellipse(-3.1, -h - 5, rx * 0.67, 5.4, 3);
    ellipse(3.4, -h - 4.1, rx * 0.65, 5.5, 4);
    ellipse(0.8, -h + 4.5, rx * 0.62, 4.4, 5);
  } else if (species === 'birch') {
    h = 41 + rand() * 5;
    footW = 1.55;
    footH = 0.95;
    branch(0, 0, 0.7, -h - 1, 0.83, 0.34, true);
    fork(0.3, -h * 0.54, -3.4, -h + 3.2, 1.9);
    fork(0.4, -h * 0.68, 3.6, -h - 1, 1.7);
    ellipse(0.4, -h - 2, 4.9, 9.4, 0);
    ellipse(-3.4, -h + 4.2, 3.7, 6.4, 1);
    ellipse(3.5, -h + 0.1, 3.5, 6.7, 2);
    ellipse(-1.8, -h - 7.4, 3.1, 5.2, 3);
    ellipse(1.8, -h + 8, 3.5, 5, 4);
  } else if (EVERGREEN.has(species)) {
    const spruce = species === 'spruce';
    h = (spruce ? 49 : 45) + rand() * 7;
    footW = 1.8;
    const count = spruce ? 7 : 6;
    branch(0, 0, 0, -h + 0.7, 0.95, 0.14, true);
    for (let i = 0; i < count; i++) {
      const top = -h + i * h * (spruce ? 0.094 : 0.113);
      const depth = h * (spruce ? 0.24 : 0.17) + i * (spruce ? 0.12 : 0.45);
      const width = (spruce ? 2 : 1.8) + i * (spruce ? 1.24 : 1.53);
      tiers.push({ x: (rand() - 0.5) * 0.6, y: top, width, depth, layer: i });
      branch(0, top + depth * 0.58, -width * 0.9, top + depth * 0.96, 0.36, 0.12);
      branch(0, top + depth * 0.61, width * 0.9, top + depth * 0.95, 0.36, 0.12);
    }
  } else if (species === 'acacia') {
    h = 31 + rand() * 5;
    const bend = rand() < 0.5 ? -1 : 1;
    branch(0, 0, bend * 1.3, -h * 0.5, 1.05, 0.74, true);
    branch(bend * 1.3, -h * 0.5, bend * 3.7, -h + 1, 0.74, 0.4, true);
    fork(bend * 1.5, -h * 0.58, bend * 3.3 - 5.6, -h - 1.5, 2.7);
    fork(bend * 2, -h * 0.74, bend * 3.3 + 5.4, -h - 1.6, 2.5);
    ellipse(bend * 3.1, -h - 3.5, 9.4, 3.8, 0);
    ellipse(bend * 3.1 - 5.6, -h - 3.9, 4.2, 3.1, 1);
    ellipse(bend * 3.1 + 5.1, -h - 4.6, 4.6, 3, 2);
    ellipse(bend * 3.1 - 1.1, -h - 6.2, 5.5, 2.6, 3);
  } else if (species === 'jungle') {
    h = 46 + rand() * 7;
    footW = 2.4;
    footH = 1.3;
    branch(0, 0, -0.5, -h + 3, 1.55, 0.75, true);
    branch(0, -5, -3.7, 0, 0.85, 0.25);
    branch(0, -6, 3.8, 0, 0.85, 0.25);
    fork(-0.4, -h * 0.7, -6.3, -h + 0.8, 2.8);
    fork(-0.4, -h * 0.76, 6, -h - 0.3, 2.8);
    ellipse(-0.9, -h - 2.7, 8.6, 8.4, 0);
    ellipse(-6.4, -h + 1.9, 5.5, 6.9, 1);
    ellipse(6.1, -h + 0.2, 5.6, 7.2, 2);
    ellipse(1.2, -h - 7.1, 5.5, 6.1, 3);
    ellipse(-2.1, -h + 5.5, 6.2, 5.4, 4);
    for (let i = 0; i < 5; i++) {
      const sx = -8 + i * 3.8 + rand() * 0.8;
      const sy = -h + 3 + rand() * 4;
      const length = 12 + rand() * 12;
      strands.push({ x: sx, y: sy, length, bend: 0.9, radius: 0.23, layer: i, vine: true });
    }
  } else if (species === 'cherry') {
    h = 26 + rand() * 5;
    branch(0, 0, 0.8, -h + 3, 1.05, 0.5, true);
    fork(0.4, -h * 0.51, -5.9, -h + 0.4, 3.1);
    fork(0.6, -h * 0.64, 6.1, -h - 1.2, 3.1);
    ellipse(0.3, -h - 1.8, 8.3, 7.5, 0);
    ellipse(-6.2, -h + 0.6, 5.7, 5.6, 1);
    ellipse(6.4, -h - 0.6, 5.8, 5.7, 2);
    ellipse(-2.6, -h - 6.4, 5.5, 4.7, 3);
    ellipse(3.1, -h - 5.8, 5.9, 4.9, 4);
    ellipse(1.1, -h + 4.5, 6.3, 3.7, 5);
  } else {
    h = 28 + rand() * 6;
    branch(0, 0, -0.8, -h + 2, 1.15, 0.5, true);
    fork(-0.5, -h * 0.56, -6.2, -h - 0.4, 2.4);
    fork(-0.5, -h * 0.68, 6, -h - 1.4, 2.5);
    ellipse(-0.6, -h - 2.1, 8.6, 7.2, 0);
    ellipse(-6, -h + 0.5, 5.4, 5.1, 1);
    ellipse(5.9, -h - 0.2, 5.5, 5.5, 2);
    ellipse(-1.9, -h - 5.3, 6, 4.8, 3);
    for (let i = 0; i < 15; i++) {
      const sx = -10.2 + i * 1.45 + (rand() - 0.5) * 0.3;
      const sy = -h + 1.3 + Math.abs(sx) * 0.11;
      const length = 12 + rand() * 10 + Math.abs(sx) * 0.24;
      strands.push({ x: sx, y: sy, length, bend: Math.sign(sx) * (0.6 + rand() * 0.8), radius: 0.38 + rand() * 0.22, layer: i, vine: false });
    }
  }

  // Roots are visible ground anchors. Twigs preserve each crown's structure
  // when deciduous trees lose most of their leaves in winter.
  branch(-0.3, -2.2, -2.4, 0, 0.65, 0.15);
  branch(0.3, -2.1, 2.2, 0, 0.6, 0.15);
  for (let i = 0; i < blobs.length; i++) {
    const b = blobs[i];
    const anchorX = species === 'acacia' ? blobs[0].x : 0;
    branch(anchorX, -h + 4, b.x, b.y, 0.4, 0.17);
    for (const sign of [-1, 1]) {
      branch(b.x, b.y, b.x + sign * b.rx * 0.66, b.y - b.ry * 0.35, 0.17, 0.1);
      branch(b.x + sign * b.rx * 0.4, b.y - b.ry * 0.2, b.x + sign * b.rx * 0.55, b.y - b.ry * 0.72, 0.13, 0.08);
    }
  }
  return { blobs, tiers, wood, strands, h, footW, footH };
}

function bushGeometry(rand) {
  const shape = { blobs: [], tiers: [], wood: [], strands: [], h: 7, footW: 0, footH: 0 };
  const count = 4 + Math.floor(rand() * 4);
  for (let i = 0; i < count; i++) {
    const x = (i / (count - 1) - 0.5) * (6 + rand() * 4);
    const y = -3.5 - rand() * 3;
    shape.blobs.push({ x, y, rx: 2.6 + rand() * 1.8, ry: 2.3 + rand() * 2, layer: i });
    shape.wood.push({ x0: x * 0.3, y0: 0, x1: x, y1: y, r0: 0.25, r1: 0.1,
      trunk: false, minX: x - 5, maxX: x + 5, minY: y - 2, maxY: 2 });
  }
  return shape;
}

// Individual crowns grow around their branch clusters, rather than sharing
// identical circular outlines. Size and lean stay seeded across seasons.
function grow(shape, growth, rand) {
  const mature = growth === 'mature';
  const sx = mature ? 1.65 + rand() * 0.65 : growth === 'sapling' ? 0.42 + rand() * 0.28 : 0.85 + rand() * 0.55;
  const sy = mature ? 2.15 + rand() * 0.85 : growth === 'sapling' ? 0.4 + rand() * 0.3 : 0.85 + rand() * 0.5;
  const lean = (rand() - 0.5) * (mature ? 0.055 : 0.035);
  const xAt = (x, y) => x * sx - y * sy * lean;
  const clusters = [];
  for (const b of shape.blobs) {
    const x = xAt(b.x, b.y);
    const y = b.y * sy;
    const rx = b.rx * sx;
    const ry = b.ry * sy * (0.88 + rand() * 0.22);
    // A core and smaller overlapping lobes provide an irregular crown and
    // visible shaded pockets between outward-facing leaf masses.
    clusters.push({ x, y, rx: rx * 0.8, ry: ry * 0.85, layer: b.layer, depth: rand() * 2 });
    const count = mature ? 5 : 3;
    for (let i = 0; i < count; i++) {
      const a = i / count * TAU + rand() * 0.6;
      clusters.push({ x: x + Math.cos(a) * rx * (0.45 + rand() * 0.12),
        y: y + Math.sin(a) * ry * (0.42 + rand() * 0.13),
        rx: rx * (0.32 + rand() * 0.18), ry: ry * (0.32 + rand() * 0.16),
        layer: b.layer, depth: 1 + rand() * 4 });
    }
  }
  shape.blobs = clusters;
  for (const tier of shape.tiers) {
    tier.x = xAt(tier.x, tier.y);
    tier.y *= sy;
    tier.width *= sx * (0.82 + rand() * 0.27);
    tier.depth *= sy * (0.9 + rand() * 0.15);
  }
  for (const strand of shape.strands) {
    strand.x = xAt(strand.x, strand.y);
    strand.y *= sy;
    strand.length *= sy;
    strand.radius *= sx;
    strand.bend *= sx;
  }
  for (const wood of shape.wood) {
    wood.x0 = xAt(wood.x0, wood.y0);
    wood.x1 = xAt(wood.x1, wood.y1);
    wood.y0 *= sy;
    wood.y1 *= sy;
    wood.r0 *= sx;
    wood.r1 *= sx;
    const pad = Math.max(1.5, wood.r0, wood.r1);
    wood.minX = Math.min(wood.x0, wood.x1) - pad;
    wood.maxX = Math.max(wood.x0, wood.x1) + pad;
    wood.minY = Math.min(wood.y0, wood.y1) - pad;
    wood.maxY = Math.max(wood.y0, wood.y1) + pad;
  }
  shape.h *= sy;
  shape.footW *= sx;
  shape.footH *= mature ? 1.45 : growth === 'sapling' ? 0.6 : 1;
  return shape;
}

function makeSampler(shape, species, season, palette, seed) {
  const winter = season === 'winter';
  const evergreen = EVERGREEN.has(species);
  const bark = BARK[species];
  return (px, py) => {
    let leaf = null;
    const grain = hash2(Math.floor(px * 2.2), Math.floor(py * 1.6), seed + 41);
    const clump = valueNoise(px * 0.24, py * 0.2, seed + 89);

    for (const b of shape.blobs) {
      const nx = (px - b.x) / b.rx;
      const ny = (py - b.y) / b.ry;
      const d = nx * nx + ny * ny;
      // Small notches give the clustered edge an ASCII/blocky silhouette.
      if (d > 0.86 + clump * 0.24 + grain * 0.065) continue;
      const nz = Math.sqrt(Math.max(0, 1 - d));
      const light = clamp(0.22 + (-nx * 0.42 - ny * 0.62 + nz * 0.55) * 0.67);
      const depth = b.depth + nz * Math.min(b.rx, b.ry) * 0.32;
      if (!leaf || depth > leaf.depth) leaf = { light, depth, edge: d > 0.79,
        rim: nx < -0.45 && ny < 0.35 && d > 0.77, snow: false, layer: b.layer, strand: false };
    }
    for (const t of shape.tiers) {
      const v = (py - t.y) / t.depth;
      if (v < 0 || v > 1) continue;
      const half = t.width * (0.04 + v * 0.96) * (0.86 + clump * 0.22);
      const edge = Math.abs(px - t.x) / (half || 0.01);
      if (edge > 0.96 + grain * 0.08 || v > 0.95 + Math.sin((px - t.x) * 1.3 + t.layer) * 0.045) continue;
      const nx = (px - t.x) / t.width;
      const light = clamp(0.65 - nx * 0.28 - v * 0.42 + clump * 0.12);
      const snow = winter && (v < 0.21 || edge > 0.86 || (v > 0.92 && grain > 0.53));
      if (!leaf || t.layer > leaf.depth) leaf = { light, depth: t.layer, edge: edge > 0.85, rim: nx < -0.5, snow, layer: t.layer, strand: false };
    }
    for (const s of shape.strands) {
      const v = (py - s.y) / s.length;
      if (v < 0 || v > 1) continue;
      const curve = s.x + s.bend * v * v + Math.sin(v * 5 + s.layer * 1.7) * 0.24;
      const width = s.radius * (1 - v * 0.65);
      if (Math.abs(px - curve) > width || (s.vine && grain < 0.23)) continue;
      leaf = { light: 0.52 + grain * 0.2 - v * 0.14, edge: true, rim: px > 5, snow: false, layer: s.layer, strand: true, vine: s.vine };
    }

    let wood = null;
    let nearTwig = false;
    if (!leaf || (winter && !evergreen)) {
      for (const s of shape.wood) {
        if (px < s.minX || px > s.maxX || py < s.minY || py > s.maxY) continue;
        const hit = segmentDistance(px, py, s);
        if (hit.distance < 1.5) nearTwig = true;
        if (hit.distance > hit.radius) continue;
        const edge = hit.distance / hit.radius;
        if (!wood || s.trunk) wood = { segment: s, edge, t: hit.t };
      }
    }

    if (leaf && winter && !evergreen) {
      // Bare branch networks with small persistent, frosted leaf clusters.
      const patch = hash2(Math.floor(px / 1.5), Math.floor(py / 1.5), seed + 113);
      if (!nearTwig || patch > (species === 'jungle' ? 0.2 : 0.08)) leaf = null;
      else leaf.snow = grain > 0.45;
    }

    if (leaf) {
      let c = blend(palette.shadow, palette.base, clamp(leaf.light * 1.3));
      if (leaf.light > 0.55) c = blend(c, palette.light, (leaf.light - 0.55) * 1.8);
      const patch = hash2(Math.floor(px / 2), Math.floor(py / 2), seed + leaf.layer * 19);
      c = blend(c, palette.accent, patch > 0.74 ? 0.24 : 0);
      c = c.map(v => v * (0.8 + clump * 0.3 + grain * 0.08));
      if (leaf.rim) c = blend(c, palette.rim, 0.55);
      if (leaf.snow) c = blend(c, [216, 235, 244], 0.76 + grain * 0.2);
      return { c, light: leaf.light, foliage: true, edge: leaf.edge, strand: leaf.strand, vine: leaf.vine, snow: leaf.snow };
    }
    if (!wood) return null;

    const rough = valueNoise(px * 1.7, py * 0.13, seed + 71);
    let c;
    let band = false;
    if (species === 'birch') {
      band = (Math.floor(-py * 0.77) % 5 === 0 && rough > 0.3) || rough < 0.09;
      c = band ? [66, 69, 65] : blend(bark, [252, 242, 207], 0.23 + (px < 0 ? 0.2 : 0));
    } else {
      const trunkX = wood.segment.x0 + (wood.segment.x1 - wood.segment.x0) * wood.t;
      const radius = wood.segment.r0 + (wood.segment.r1 - wood.segment.r0) * wood.t;
      const nx = (px - trunkX) / radius;
      const light = 0.53 - nx * 0.23 + Math.sqrt(Math.max(0, 1 - nx * nx)) * 0.18 - wood.edge * 0.08;
      c = bark.map((v, i) => v * light + (i === 0 ? 12 : 4));
      c = c.map(v => v * (0.84 + rough * 0.3));
    }
    if (winter && !wood.segment.trunk && wood.edge > 0.68 && rough > 0.58) c = blend(c, [205, 221, 230], 0.7);
    return { c, light: 0.48 + rough * 0.28, foliage: false, band, trunk: wood.segment.trunk, slant: wood.segment.x1 - wood.segment.x0, grain: rough };
  };
}

// Six subcell samples smooth the outline without allocating any geometry in
// the drawing loop. The returned glyph/color cells are the complete sprite.
function bake(sample, seed, species, shape) {
  const cells = [];
  const fullHeight = shape.h + 14;
  let left = -4.5;
  let right = 4.5;
  let top = -shape.h - 2;
  for (const b of shape.blobs) {
    left = Math.min(left, b.x - b.rx * 1.04);
    right = Math.max(right, b.x + b.rx * 1.04);
    top = Math.min(top, b.y - b.ry * 1.04);
  }
  for (const t of shape.tiers) {
    left = Math.min(left, t.x - t.width * 1.04);
    right = Math.max(right, t.x + t.width * 1.04);
    top = Math.min(top, t.y);
  }
  for (const s of shape.strands) {
    left = Math.min(left, s.x + Math.min(0, s.bend) - s.radius - 0.3);
    right = Math.max(right, s.x + Math.max(0, s.bend) + s.radius + 0.3);
    top = Math.min(top, s.y);
  }
  for (const s of shape.wood) {
    left = Math.min(left, s.minX);
    right = Math.max(right, s.maxX);
    top = Math.min(top, s.minY);
  }
  const minX = Math.max(-MAX_TREE_HALF_WIDTH, Math.floor(left / ASPECT - 1));
  const maxX = Math.min(MAX_TREE_HALF_WIDTH, Math.ceil(right / ASPECT + 1));
  const minY = Math.max(1 - MAX_TREE_HEIGHT, Math.floor(top - 1));
  const leafGlyphs = LEAF_GLYPHS.map(f => [...f].map(glyph));
  const rustles = [...RUSTLE_GLYPHS].map(glyph);
  const bounds = { minX: MAX_TREE_HALF_WIDTH, minY: 0, maxX: -MAX_TREE_HALF_WIDTH, maxY: 1 - MAX_TREE_HEIGHT };
  for (let dy = minY; dy <= 0; dy++) {
    for (let dx = minX; dx <= maxX; dx++) {
      let hits = 0;
      let foliageHits = 0;
      let red = 0;
      let green = 0;
      let blue = 0;
      let light = 0;
      let detail = null;
      let leafDetail = null;
      let woodDetail = null;
      for (const oy of SUB_Y) {
        for (const ox of SUB_X) {
          const s = sample((dx + ox) * ASPECT, dy + oy);
          if (!s) continue;
          hits++;
          if (s.foliage) foliageHits++;
          if (s.foliage) leafDetail = s;
          else woodDetail = s;
          red += s.c[0];
          green += s.c[1];
          blue += s.c[2];
          light += s.light;
        }
      }
      if (hits < 2) continue;
      const foliage = foliageHits > hits / 2;
      detail = foliage ? leafDetail : woodDetail;
      const texture = hash2(dx, dy, seed + 3);
      let g;
      if (foliage) {
        const family = leafGlyphs[Math.min(3, Math.floor((1 - light / hits) * 3.9))];
        g = family[Math.floor(texture * family.length)];
        if (hits < 4 || detail.strand) g = glyph(detail.vine ? (texture < 0.5 ? ':' : ';') : (texture < 0.54 ? '*' : ';'));
        else if (species === 'cherry' && texture > 0.58) g = glyph(texture > 0.86 ? '+' : '*');
        if (detail.snow && texture > 0.35) g = glyph(texture > 0.7 ? '*' : '#');
      } else if (species === 'birch' && detail.band) {
        g = glyph(texture > 0.4 ? '=' : '#');
      } else if (detail.trunk) {
        g = glyph(detail.grain < 0.3 ? ':' : detail.grain < 0.5 ? '|' : detail.grain < 0.67 ? '!' : '/');
      } else {
        g = glyph(Math.abs(detail.slant) < 0.5 ? '|' : detail.slant < 0 ? '/' : '\\');
      }
      const flex = foliage ? clamp(0.24 + (-dy / fullHeight) * 0.61 + (detail.strand ? 0.12 : 0), 0.2, 1) : 0;
      const phase = hash2(dx, dy, seed + 97) * TAU;
      cells.push({
        dx, dy, g,
        r: Math.round(clamp(red / hits, 0, 255)),
        gg: Math.round(clamp(green / hits, 0, 255)),
        b: Math.round(clamp(blue / hits, 0, 255)),
        br: hits >= 5 ? Math.round(red / hits * 0.14) : undefined,
        bgG: hits >= 5 ? Math.round(green / hits * 0.15) : undefined,
        bb: hits >= 5 ? Math.round(blue / hits * 0.17) : undefined,
        foliage,
        flex,
        phase,
        phaseSin: Math.sin(phase),
        phaseCos: Math.cos(phase),
        rustle: foliage ? rustles[Math.floor(hash2(dx, dy, seed + 103) * rustles.length)] : g,
      });
      bounds.minX = Math.min(bounds.minX, dx);
      bounds.minY = Math.min(bounds.minY, dy);
      bounds.maxX = Math.max(bounds.maxX, dx);
      bounds.maxY = Math.max(bounds.maxY, dy);
    }
  }
  return { cells, bounds };
}

export function makeTree(x, y, rand, { species = 'oak', season = 'summer', seed = 1, growth = 'mature' } = {}) {
  if (!TREE_SPECIES.includes(species)) species = 'oak';
  if (!SEASONS.has(season)) season = 'summer';
  const spriteSeed = Math.floor(hash2(Math.floor(x * 32), Math.floor(y * 32), seed + TREE_SPECIES.indexOf(species) * 197) * 0x100000000);
  // A deterministic fallback also makes this useful to sprite galleries.
  let draw = 0;
  const random = typeof rand === 'function' ? rand : () => hash2(draw++, spriteSeed, seed + 17);
  if (!['mature', 'sapling', 'bush'].includes(growth)) growth = 'mature';
  const shape = grow(growth === 'bush' ? bushGeometry(random) : geometry(species, random), growth, random);
  const palette = leafPalette(species, season, random() - 0.5);
  const sample = makeSampler(shape, species, season, palette, spriteSeed);
  const { cells, bounds } = bake(sample, spriteSeed, species, shape);
  const top = bounds.minY;
  return {
    kind: growth === 'bush' ? 'bush' : 'tree', growth, species, season, x, y,
    footW: shape.footW, footH: shape.footH,
    height: bounds.maxY - top + 1,
    top,
    bounds,
    cells,
    leafColor: palette.base.map(Math.round),
    textureSeed: spriteSeed,
    phase: hash2(Math.floor(x * 16), Math.floor(y * 16), spriteSeed + 157) * TAU,
    sway: SWAY[species] * (growth === 'sapling' ? 1.25 : growth === 'bush' ? 0.65 : 1),
  };
}

export function makeBush(x, y, rand, options = {}) {
  return makeTree(x, y, rand, { ...options, growth: 'bush' });
}
