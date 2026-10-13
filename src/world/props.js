import { fbm } from '../core/noise.js';
import { hash2, mulberry32 } from '../core/rng.js';
import { putCell } from '../render/cells.js';
import { glyph } from '../render/glyphs.js';
import { makeCampProp } from './camp-props.js';
import { makeNaturalProp } from './natural-props.js';
import { propDefinition } from './prop-catalog.js';
import { ASPECT, GRASS } from './world.js';

// Scenery props. Each prop is rasterised once, when its chunk is
// generated, into a list of cells relative to its base (the point where it
// touches the ground). Drawing is then just copying those cells.

const SUB_X = [0.25, 0.75];
const SUB_Y = [1 / 6, 3 / 6, 5 / 6];

// Glyph families from sparse to dense. A cell picks a family by brightness
// and a member by hash, which gives foliage its busy, leafy texture.
const FAMILIES = ['.\'`', ':;-', '+=~ox', 'aedbqpu', 'Q0O8&$', '@#%WM'].map((f) => [...f].map(glyph));

function bake(w, top, bottom, sample, seed) {
  const cells = [];
  for (let dy = top; dy <= bottom; dy++) {
    for (let dx = -w; dx <= w; dx++) {
      let hits = 0;
      let lum = 0;
      let cr = 0;
      let cg = 0;
      let cb = 0;
      for (const oy of SUB_Y) {
        for (const ox of SUB_X) {
          const s = sample((dx + ox - 0.5) * ASPECT, dy + oy - 1);
          if (!s) continue;
          hits++;
          lum += s.l;
          cr += s.c[0] * s.l;
          cg += s.c[1] * s.l;
          cb += s.c[2] * s.l;
        }
      }
      if (hits < 2) continue;
      const b = Math.max(0, Math.min(0.999, lum / hits));
      const fam = FAMILIES[Math.floor(b * FAMILIES.length)];
      const k = 1.3 / hits;
      cells.push({
        dx,
        dy,
        g: fam[Math.floor(hash2(dx, dy, seed) * fam.length)],
        r: cr * k,
        gg: cg * k,
        b: cb * k,
      });
    }
  }
  return cells;
}

function makeTree(x, y, rand, seed = x * 31 + y) {
  const height = 30 + rand() * 12;
  const radius = 8 + rand() * 3.5;
  const blobs = [{ x: 0, y: -height, r: radius }];
  const n = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand();
    blobs.push({
      x: Math.cos(a) * radius * 0.65,
      y: -height + Math.sin(a) * radius * 0.5 + 1,
      r: radius * (0.55 + rand() * 0.25),
    });
  }
  const tint = rand();
  const leaf = [40 + tint * 20, 100 + tint * 30, 80 - tint * 20];
  const bark = [70, 56, 44];
  const trunkTop = -height + radius * 0.5;

  const sample = (px, py) => {
    // Canopy: the brightest blob wins, lit from the upper left.
    let best = null;
    for (const bl of blobs) {
      const nx = (px - bl.x) / bl.r;
      const ny = (py - bl.y) / (bl.r * 0.85);
      const d2 = nx * nx + ny * ny;
      if (d2 > 1) continue;
      const l = 0.55 - nx * 0.3 - ny * 0.35 + (1 - d2) * 0.15;
      if (!best || l > best.l) best = { l, c: leaf };
    }
    if (best) return best;
    if (py > trunkTop && py < 0.2 && Math.abs(px) < 1.4 + (py / -height) * -0.5) {
      return { l: 0.6 - px * 0.4, c: bark };
    }
    return null;
  };

  const w = Math.ceil((radius * 1.7) / ASPECT);
  return {
    kind: 'tree',
    x,
    y,
    footW: 2.4,
    footH: 1.2,
    cells: bake(w, -Math.ceil(height + radius), 0, sample, seed),
  };
}

function makeRock(x, y, rand, seed = x * 17 + y) {
  const rx = 2.6 + rand() * 3.2;
  const ry = rx * (0.65 + rand() * 0.2);
  const stone = [118, 120, 124];
  const moss = [70, 104, 70];
  const sample = (px, py) => {
    const nx = px / rx;
    const ny = (py + ry) / ry;
    const d2 = nx * nx + ny * ny;
    if (d2 > 1 || py > 0) return null;
    const l = 0.6 - nx * 0.35 - ny * 0.3;
    return { l, c: ny < -0.3 && rand() < 0.4 ? moss : stone };
  };
  const w = Math.ceil(rx / ASPECT) + 1;
  return {
    kind: 'rock',
    x,
    y,
    footW: rx / ASPECT,
    footH: 1.4,
    cells: bake(w, -Math.ceil(ry * 2), 0, sample, seed),
  };
}

// Hand-placed boulders have irregular outlines and distinct mineral/moss
// patches. Procedural rocks above keep the original seeded landscape intact.
function makeSceneryRock(x, y, rand, seed) {
  const rx = 2.6 + rand() * 3.2;
  const ry = rx * (0.55 + rand() * 0.3);
  const count = 7 + Math.floor(rand() * 4);
  const offset = rand() * Math.PI * 2;
  const corners = Array.from({ length: count }, (_, i) => {
    const angle = offset + i * Math.PI * 2 / count;
    const radius = 0.76 + rand() * 0.24;
    return { x: Math.cos(angle) * rx * radius, y: -ry + Math.sin(angle) * ry * radius };
  });
  const bottom = Math.max(...corners.map((corner) => corner.y));
  for (const corner of corners) corner.y -= bottom;
  const colors = [[109, 122, 139], [145, 127, 106], [135, 137, 143], [122, 136, 119]];
  const stone = colors[Math.floor(rand() * colors.length)];
  const mossCoverage = rand() * 0.65;
  const facets = Array.from({ length: count }, () => (rand() - 0.5) * 0.15);
  const sample = (px, py) => {
    let inside = false;
    for (let i = 0, j = count - 1; i < count; j = i++) {
      const a = corners[i], b = corners[j];
      if ((a.y > py) !== (b.y > py)
        && px < (b.x - a.x) * (py - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    if (!inside) return null;
    const nx = px / rx, ny = (py + ry + bottom) / ry;
    const angle = (Math.atan2(ny, nx) - offset + Math.PI * 4) % (Math.PI * 2);
    const facet = facets[Math.floor(angle / (Math.PI * 2) * count)];
    const grain = (hash2(Math.floor(px * 3), Math.floor(py * 3), seed + 17) - 0.5) * 0.08;
    const moss = ny < 0.2 && hash2(Math.floor(px * 0.9), Math.floor(py * 0.8), seed + 29) < mossCoverage;
    return { l: 0.59 - nx * 0.26 - ny * 0.3 + facet + grain,
      c: moss ? [68, 99 + mossCoverage * 20, 62] : stone };
  };
  return { kind: 'rock', x, y, footW: rx / ASPECT, footH: 1.4,
    cells: bake(Math.ceil(rx / ASPECT) + 1, -Math.ceil(ry * 2), 0, sample, seed) };
}

function makeBush(x, y, rand, seed) {
  const radius = 3.5 + rand() * 2;
  const height = 4 + rand() * 2;
  const tint = rand();
  const leaf = [48 + tint * 20, 106 + tint * 30, 62 - tint * 12];
  const blobs = [
    { x: -radius * 0.45, y: -height * 0.5, rx: radius * 0.7, ry: height * 0.6 },
    { x: radius * 0.45, y: -height * 0.45, rx: radius * 0.65, ry: height * 0.55 },
    { x: 0, y: -height * 0.75, rx: radius * 0.75, ry: height * 0.65 },
  ];
  const sample = (px, py) => {
    if (py > 0) return null;
    let best = null;
    for (const blob of blobs) {
      const nx = (px - blob.x) / blob.rx;
      const ny = (py - blob.y) / blob.ry;
      const d2 = nx * nx + ny * ny;
      if (d2 > 1) continue;
      const l = 0.55 - nx * 0.22 - ny * 0.28 + (1 - d2) * 0.12;
      if (!best || l > best.l) best = { l, c: leaf };
    }
    return best;
  };
  return {
    kind: 'bush',
    x,
    y,
    footW: radius * 0.75 / ASPECT,
    footH: 1.5,
    cells: bake(Math.ceil(radius * 1.2 / ASPECT), -Math.ceil(height * 1.5), 0, sample, seed),
  };
}

// Resample the baked image onto the destination grid. Each destination is
// visited once, so shrinking cannot stack cells and enlarging fills the image
// instead of leaving gaps between its original cells. The ground anchor stays
// at (0, 0), just as it does for procedural props.
function scaleCells(cells, scaleX, scaleY = scaleX, mirror = false) {
  if (scaleX === 1 && scaleY === 1 && !mirror) return cells;
  const source = new Map();
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const cell of cells) {
    source.set(`${cell.dx},${cell.dy}`, cell);
    minX = Math.min(minX, cell.dx);
    maxX = Math.max(maxX, cell.dx);
    minY = Math.min(minY, cell.dy);
    maxY = Math.max(maxY, cell.dy);
  }
  const scaled = [];
  for (let dy = Math.ceil((minY - 0.5) * scaleY); dy <= Math.floor((maxY + 0.5) * scaleY); dy++) {
    for (let dx = Math.ceil((minX - 0.5) * scaleX); dx <= Math.floor((maxX + 0.5) * scaleX); dx++) {
      const cell = source.get(`${Math.round(dx / scaleX)},${Math.round(dy / scaleY)}`);
      if (cell) scaled.push({ ...cell, dx: mirror ? -dx : dx, dy });
    }
  }
  return scaled;
}

// Builder props use their own seed so moving an item does not change its
// appearance. Keep generateProps below on its original random stream.
export function createProp(kind, x, y, options = {}) {
  const definition = propDefinition(kind);
  if (!definition) throw new TypeError(`Unknown scenery prop: ${kind}`);
  if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) {
    throw new TypeError('Scenery prop coordinates must be finite numbers');
  }
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Scenery prop options must be an object');
  }
  const { scale = 1, seed = 1, variant = 1 } = options;
  if (typeof scale !== 'number' || !Number.isFinite(scale) || scale < 0.25 || scale > 3) {
    throw new RangeError('Scenery prop scale must be a number between 0.25 and 3');
  }
  if (typeof seed !== 'number' || !Number.isFinite(seed)) {
    throw new TypeError('Scenery prop seed must be a finite number');
  }
  if (variant !== 0 && variant !== 1) throw new RangeError('Unknown scenery variation version');
  const rand = mulberry32(seed);
  const make = { tree: makeTree, rock: variant === 0 ? makeRock : makeSceneryRock, bush: makeBush }[kind];
  const prop = make ? make(x, y, rand, seed)
    : makeNaturalProp(kind, x, y, rand, seed, bake) ?? makeCampProp(kind, x, y, rand, seed, bake);
  if (!prop) throw new TypeError(`Scenery prop has no factory: ${kind}`);
  if (variant === 1) {
    const variation = mulberry32((seed >>> 0) ^ 0xa341316c);
    const width = 0.9 + variation() * 0.22;
    const height = 0.9 + variation() * 0.2;
    const mirrored = variation() < 0.5;
    const brightness = 0.92 + variation() * 0.18;
    const warmth = (variation() - 0.5) * 16;
    const shade = (value, offset = 0) => Math.max(0, Math.min(255, value * brightness + offset));
    prop.cells = scaleCells(prop.cells, width, height, mirrored).map((cell) => ({ ...cell,
      r: shade(cell.r, warmth), gg: shade(cell.gg), b: shade(cell.b, -warmth) }));
    prop.footW *= width;
    prop.footH *= height;
  }
  prop.cells = scaleCells(prop.cells, scale);
  prop.footW *= scale;
  prop.footH *= scale;
  prop.scale = scale;
  prop.seed = seed;
  prop.solid = definition.solid;
  prop.variant = variant;
  return prop;
}

// Scatters props over a chunk on a jittered grid. Forest density comes from
// low-frequency noise, so trees cluster into groves with clearings between.
export function generateProps(world, cx, cy, size) {
  const props = [];
  const seed = world.seed;
  const STEP_X = 15;
  const STEP_Y = 8;
  for (let gy = 0; gy < size; gy += STEP_Y) {
    for (let gx = 0; gx < size; gx += STEP_X) {
      const ox = cx * size + gx;
      const oy = cy * size + gy;
      const rand = mulberry32(Math.floor(hash2(ox, oy, seed + 61) * 2 ** 32));
      const x = ox + Math.floor(rand() * STEP_X);
      const y = oy + Math.floor(rand() * STEP_Y);
      if (world.typeAt(x, y) !== GRASS) continue;
      // Keep the spawn clearing open.
      if (Math.hypot((x - world.spawn.x) * ASPECT, y - world.spawn.y) < 36) continue;

      const forest = fbm(x * ASPECT * 0.01, y * 0.01, seed + 500, 3);
      const roll = rand();
      if (roll < (forest - 0.5) * 1.6) props.push(makeTree(x + 0.5, y + 0.5, rand));
      else if (roll > 0.975) props.push(makeRock(x + 0.5, y + 0.5, rand));
    }
  }
  return props;
}

export function drawProp(r, view, prop, write = putCell) {
  const bx = Math.floor(prop.x) - view.x0;
  const by = Math.floor(prop.y) - view.y0;
  for (const c of prop.cells) {
    write(r, bx + c.dx, by + c.dy, c.g, c.r, c.gg, c.b, by);
  }
}

export function blocks(prop, x, y) {
  if (prop.solid === false) return false;
  const dx = (x - prop.x) / prop.footW;
  const dy = (y - prop.y) / prop.footH;
  return dx * dx + dy * dy < 1;
}
