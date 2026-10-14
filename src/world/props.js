import { fbm } from '../core/noise.js';
import { hash2, mulberry32 } from '../core/rng.js';
import { putCell } from '../render/cells.js';
import { glyph } from '../render/glyphs.js';
import { MOSS, STONE_LIT, STONE_MID } from '../render/palette.js';
import { makeCampProp } from './camp-props.js';
import { deadwoodBlocks, deadwoodInClearing, makeDeadwood } from './deadwood.js';
import { makeNaturalProp } from './natural-props.js';
import { propDefinition } from './prop-catalog.js';
import { makeBush, makeTree } from './trees.js';
import { treeWind, windGust } from './wind.js';
import { ASPECT, GRASS, WATER } from './world.js';

// Scenery props. Each prop is rasterised once, when its chunk is
// generated, into a list of cells relative to its base (the point where it
// touches the ground). Crowns animate without rebuilding their geometry.

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
      // A fully covered cell also darkens the ground behind it, so the rock
      // reads as one solid form rather than glyphs scattered on the grass.
      const solid = hits === SUB_X.length * SUB_Y.length;
      cells.push({
        dx,
        dy,
        g: fam[Math.floor(hash2(dx, dy, seed) * fam.length)],
        r: cr * k,
        gg: cg * k,
        b: cb * k,
        br: solid ? cr * k * 0.16 : undefined,
        bgG: solid ? cg * k * 0.16 : undefined,
        bb: solid ? cb * k * 0.18 : undefined,
      });
    }
  }
  return cells;
}

function makeRock(x, y, rand, seed = x * 17 + y) {
  const rx = 2.6 + rand() * 3.2;
  const ry = rx * (0.65 + rand() * 0.2);
  const sample = (px, py) => {
    const nx = px / rx;
    const ny = (py + ry) / ry;
    const d2 = nx * nx + ny * ny;
    if (d2 > 1 || py > 0) return null;
    // The moonlit crown of the boulder is pale lavender, its flanks drop
    // into blue-grey shadow.
    const l = 0.5 - nx * 0.3 - ny * 0.45;
    return { l, c: ny < -0.3 && rand() < 0.4 ? MOSS : l > 0.6 ? STONE_LIT : STONE_MID };
  };
  const w = Math.ceil(rx / ASPECT) + 1;
  return {
    kind: 'rock',
    x,
    y,
    footW: rx / ASPECT,
    footH: 1.4,
    bounds: { minX: -w, maxX: w, minY: -Math.ceil(ry * 2), maxY: 0 },
    cells: bake(w, -Math.ceil(ry * 2), 0, sample, seed),
  };
}

// The builder's original broadleaf, kept so saved scenes look the same.
function makeBuilderTree(x, y, rand, seed = x * 31 + y) {
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
  const top = -Math.ceil(height + radius);
  let cells;
  return {
    kind: 'tree',
    x,
    y,
    footW: 2.4,
    footH: 1.2,
    bounds: { minX: -w, maxX: w, minY: top, maxY: 0 },
    get cells() { return cells ??= bake(w, top, 0, sample, seed); },
    // Replaced cells (e.g. a rescaled builder prop) bring their own extent.
    set cells(value) { cells = value; this.bounds = null; },
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

function makeBuilderBush(x, y, rand, seed) {
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
  const make = { tree: makeBuilderTree, rock: variant === 0 ? makeRock : makeSceneryRock, bush: makeBuilderBush }[kind];
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
  // Culling must see the scaled, mirrored image rather than the original.
  let minX = 0, maxX = 0, minY = 0, maxY = 0;
  for (const cell of prop.cells) {
    minX = Math.min(minX, cell.dx);
    maxX = Math.max(maxX, cell.dx);
    minY = Math.min(minY, cell.dy);
    maxY = Math.max(maxY, cell.dy);
  }
  prop.bounds = { minX, maxX, minY, maxY };
  prop.footW *= scale;
  prop.footH *= scale;
  prop.scale = scale;
  prop.seed = seed;
  prop.solid = definition.solid;
  prop.variant = variant;
  return prop;
}

// Reflected bounds are measured about this prop's own base. Do not cull
// source cells against the normal viewport when drawing a reflection.
export function propInView(view, prop, reflected = false, marginX = 3) {
  const b = prop.bounds;
  if (!b) return true;
  const x = Math.floor(prop.x) - view.x0;
  const y = Math.floor(prop.y) - view.y0;
  const top = reflected ? y - b.maxY + 1 : y + b.minY;
  const bottom = reflected ? y - b.minY + 1 : y + b.maxY;
  return x + b.maxX + marginX >= 0 && x + b.minX - marginX < view.cols && bottom >= 0 && top < view.rows;
}

// Terrain-only queries are safe while a chunk's props are being generated.
// Never query props/isWalkable here: that would recurse into this generator.
export function nearWater(world, x, y) {
  for (let dy = -7; dy <= 7; dy++) {
    for (let dx = -11; dx <= 11; dx++) {
      if ((dx * ASPECT) ** 2 + dy * dy > 49) continue;
      if (world.typeAt(x + dx, y + dy) === WATER) return true;
    }
  }
  return false;
}

export function treeSpeciesAt(world, x, y) {
  const s = world.seed;
  const local = hash2(x, y, s + 715);
  if (nearWater(world, x, y) && local < 0.72) return 'willow';
  const warmth = fbm(x * ASPECT * 0.004, y * 0.004, s + 710, 3);
  const moisture = fbm(x * ASPECT * 0.004, y * 0.004, s + 711, 3);
  if (warmth < 0.4) return local < 0.2 ? 'pine' : moisture > 0.5 ? 'spruce' : 'pine';
  if (warmth > 0.6) return local < 0.15 ? 'oak' : moisture > 0.5 ? 'jungle' : 'acacia';
  const grove = fbm(x * ASPECT * 0.009, y * 0.009, s + 712, 3);
  if (grove > 0.6 && local < 0.85) return 'cherry';
  return (grove < 0.43) !== (local < 0.18) ? 'birch' : 'oak';
}

export function deadwoodConditionAt(world, x, y) {
  if (hash2(x, y, world.seed + 728) < 0.3 && nearWater(world, x, y)) return 'beaver';
  const history = hash2(x, y, world.seed + 727);
  if (history < 0.09) return 'fallen';
  if (history < 0.16) return 'snag';
  if (history < 0.24) return 'stump';
  return null;
}

// Two layers: widely spaced mature trees, with a smaller understorey grid.
// Their independent random streams keep groves repeatable across seasons.
export function generateProps(world, cx, cy, size) {
  const props = [];
  const seed = world.seed;
  for (let layer = 0; layer < 2; layer++) {
    const stepX = layer === 0 ? 42 : 14;
    const stepY = layer === 0 ? 28 : 12;
    for (let gy = 0; gy < size; gy += stepY) {
      for (let gx = 0; gx < size; gx += stepX) {
        const ox = cx * size + gx;
        const oy = cy * size + gy;
        const rand = mulberry32(Math.floor(hash2(ox, oy, seed + 61 + layer * 1031) * 2 ** 32));
        // The last grid slot can be smaller than stepX. Keep every base in
        // its owning chunk so collision queries still find it near a seam.
        const x = ox + Math.floor(rand() * Math.min(stepX, size - gx));
        const y = oy + Math.floor(rand() * Math.min(stepY, size - gy));
        if (world.typeAt(x, y) !== GRASS) continue;
        // Keep the spawn clearing open.
        if (Math.hypot((x + 0.5 - world.spawn.x) * ASPECT, y + 0.5 - world.spawn.y) < 36) continue;

        const forest = fbm(x * ASPECT * 0.01, y * 0.01, seed + 500, 3);
        const roll = rand();
        if (layer === 0 && roll < Math.max(0, forest - 0.38) * 1.6) {
          const species = treeSpeciesAt(world, x, y);
          const condition = deadwoodConditionAt(world, x, y);
          if (condition) {
            const remains = makeDeadwood(x + 0.5, y + 0.5, rand, { condition, species, seed });
            // A log's far end must also stay outside the spawn clearing.
            if (!deadwoodInClearing(remains, world.spawn)) props.push(remains);
          } else {
            props.push(makeTree(x + 0.5, y + 0.5, rand, { species, season: world.season, seed }));
          }
        } else if (layer === 1 && roll < 0.04 + Math.max(0, forest - 0.38) * 0.7) {
          // Keep seedlings out of the mature trunks without recursively
          // generating neighboring props. Bushes stay soft and walkable.
          if (props.some((p) => (p.kind === 'tree' &&
            Math.hypot((p.x - x) * ASPECT, p.y - y) < p.footW * ASPECT + 4) ||
            (p.kind === 'deadwood' && deadwoodBlocks(p, x, y)))) continue;
          const species = treeSpeciesAt(world, x, y);
          const options = { species, season: world.season, seed };
          props.push(rand() < 0.35 ? makeTree(x + 0.5, y + 0.5, rand, { ...options, growth: 'sapling' }) :
            makeBush(x + 0.5, y + 0.5, rand, options));
        } else if (layer === 1 && roll > 0.965) {
          props.push(makeRock(x + 0.5, y + 0.5, rand));
        }
      }
    }
  }
  return props;
}

// What is left of a felled tree.
const STUMP = [
  { dx: -1, dy: -2, g: glyph('_'), r: 139, gg: 103, b: 62 },
  { dx: 0, dy: -2, g: glyph('='), r: 166, gg: 124, b: 76 },
  { dx: 1, dy: -2, g: glyph('_'), r: 122, gg: 85, b: 50 },
  { dx: -1, dy: -1, g: glyph('|'), r: 112, gg: 77, b: 47 },
  { dx: 0, dy: -1, g: glyph('#'), r: 99, gg: 69, b: 44 },
  { dx: 1, dy: -1, g: glyph('|'), r: 78, gg: 54, b: 35 },
  { dx: 0, dy: 0, g: glyph('w'), r: 88, gg: 62, b: 40 },
];

// A `t` of null draws the prop still, for views too far out to see it sway.
export function drawProp(r, view, prop, write = putCell, t = 0, player = null, seed = 1, reflected = false) {
  const direct = write === putCell;
  if (direct && !propInView(view, prop)) return;
  const bx = Math.floor(prop.x) - view.x0;
  const by = Math.floor(prop.y) - view.y0;
  if (prop.chopped) {
    for (const c of STUMP) write(r, bx + c.dx, by + c.dy, c.g, c.r, c.gg, c.b, by);
    return;
  }
  const tree = t !== null && (prop.kind === 'tree' || prop.kind === 'bush');
  const sway = tree ? treeWind(prop, t, seed) : 0;
  const gust = tree ? windGust(seed, prop.x, prop.y, t) : 0;
  const sin = tree ? Math.sin(t * 1.4) : 0;
  const cos = tree ? Math.cos(t * 1.4) : 0;
  const sheen = Math.max(0, gust - 0.55) * 0.18;
  // The figure has already been drawn when its base is behind this tree.
  // Stable local dither lets it show through nearby leaves without changing
  // the renderer's glyph index channel or punching holes in solid wood.
  const reveal = player && prop.y > player.y ? player.foliageBounds : null;
  for (const c of prop.cells) {
    const sy = by + c.dy;
    // Reject invisible rows before calculating foliage lighting or texture.
    // Reflections need source rows above the view, measured about the base.
    if (direct && (sy < 0 || sy >= view.rows)) continue;
    if (reflected && (by - c.dy + 1 < 0 || by - c.dy + 1 >= view.rows)) continue;
    const dx = c.dx + (c.foliage ? Math.round(sway * c.flex) : 0);
    const sx = bx + dx;
    if ((direct || reflected) && (sx < -1 || sx >= view.cols + 1)) continue;
    if (c.foliage && reveal) {
      const nx = (Math.floor(prop.x) + dx - reveal.x) / reveal.rx;
      const ny = (Math.floor(prop.y) + c.dy - reveal.y) / reveal.ry;
      const d2 = nx * nx + ny * ny;
      if (d2 < 1 && hash2(c.dx, c.dy, prop.textureSeed) < (1 - d2) * 0.93) continue;
    }
    const flutter = c.foliage ? sin * c.phaseCos + cos * c.phaseSin : 0;
    const light = c.foliage ? 1 + flutter * 0.035 + sheen : 1;
    const ch = c.foliage && flutter > 0.94 && gust > 0.58 ? c.rustle : c.g;
    write(r, sx, sy, ch, c.r * light, c.gg * light, c.b * light, by, c.br, c.bgG, c.bb);
  }
}

export function blocks(prop, x, y) {
  if (prop.chopped) return false;
  if (prop.solid === false) return false;
  // Wild shrubs are soft; a builder bush is placed as an obstacle.
  if (prop.kind === 'bush' && prop.solid !== true) return false;
  if (prop.kind === 'deadwood') return deadwoodBlocks(prop, x, y);
  const dx = (x - prop.x) / prop.footW;
  const dy = (y - prop.y) / prop.footH;
  return dx * dx + dy * dy < 1;
}
