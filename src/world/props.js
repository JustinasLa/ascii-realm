import { fbm } from '../core/noise.js';
import { hash2, mulberry32 } from '../core/rng.js';
import { putCell } from '../render/cells.js';
import { glyph } from '../render/glyphs.js';
import { makeBush, makeTree } from './trees.js';
import { treeWind, windGust } from './wind.js';
import { ASPECT, GRASS, WATER } from './world.js';

// Trees and boulders. Each prop is rasterised once, when its chunk is
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

function makeRock(x, y, rand) {
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
    bounds: { minX: -w, maxX: w, minY: -Math.ceil(ry * 2), maxY: 0 },
    cells: bake(w, -Math.ceil(ry * 2), 0, sample, x * 17 + y),
  };
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
          props.push(makeTree(x + 0.5, y + 0.5, rand, { species, season: world.season, seed }));
        } else if (layer === 1 && roll < 0.04 + Math.max(0, forest - 0.38) * 0.7) {
          // Keep seedlings out of the mature trunks without recursively
          // generating neighboring props. Bushes stay soft and walkable.
          if (props.some((p) => p.kind === 'tree' && Math.hypot((p.x - x) * ASPECT, p.y - y) < 7)) continue;
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

export function drawProp(r, view, prop, write = putCell, t = 0, player = null, seed = 1, reflected = false) {
  const bx = Math.floor(prop.x) - view.x0;
  const by = Math.floor(prop.y) - view.y0;
  const tree = prop.kind === 'tree' || prop.kind === 'bush';
  const sway = tree ? treeWind(prop, t, seed) : 0;
  const gust = tree ? windGust(seed, prop.x, prop.y, t) : 0;
  const sin = tree ? Math.sin(t * 1.4) : 0;
  const cos = tree ? Math.cos(t * 1.4) : 0;
  const sheen = Math.max(0, gust - 0.55) * 0.18;
  const direct = write === putCell;
  if (write === putCell && !propInView(view, prop)) return;
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
  if (prop.kind === 'bush') return false;
  const dx = (x - prop.x) / prop.footW;
  const dy = (y - prop.y) / prop.footH;
  return dx * dx + dy * dy < 1;
}
