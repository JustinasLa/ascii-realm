import { fbm } from '../core/noise.js';
import { hash2, mulberry32 } from '../core/rng.js';
import { putCell } from '../render/cells.js';
import { glyph } from '../render/glyphs.js';
import { ASPECT, GRASS } from './world.js';

// Trees and boulders. Each prop is rasterised once, when its chunk is
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

function makeTree(x, y, rand) {
  const height = 15 + rand() * 6;
  const radius = 4.2 + rand() * 1.8;
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
    if (py > trunkTop && py < 0.2 && Math.abs(px) < 0.75 + (py / -height) * -0.2) {
      return { l: 0.6 - px * 0.4, c: bark };
    }
    return null;
  };

  const w = Math.ceil((radius * 1.7) / ASPECT);
  return {
    kind: 'tree',
    x,
    y,
    footW: 1.3,
    footH: 0.8,
    cells: bake(w, -Math.ceil(height + radius), 0, sample, x * 31 + y),
  };
}

function makeRock(x, y, rand) {
  const rx = 1.4 + rand() * 1.8;
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
    footH: 0.9,
    cells: bake(w, -Math.ceil(ry * 2), 0, sample, x * 17 + y),
  };
}

// Scatters props over a chunk on a jittered grid. Forest density comes from
// low-frequency noise, so trees cluster into groves with clearings between.
export function generateProps(world, cx, cy, size) {
  const props = [];
  const seed = world.seed;
  const STEP_X = 9;
  const STEP_Y = 5;
  for (let gy = 0; gy < size; gy += STEP_Y) {
    for (let gx = 0; gx < size; gx += STEP_X) {
      const ox = cx * size + gx;
      const oy = cy * size + gy;
      const rand = mulberry32(Math.floor(hash2(ox, oy, seed + 61) * 2 ** 32));
      const x = ox + Math.floor(rand() * STEP_X);
      const y = oy + Math.floor(rand() * STEP_Y);
      if (world.typeAt(x, y) !== GRASS) continue;
      // Keep the spawn clearing open.
      if (Math.hypot((x - world.spawn.x) * ASPECT, y - world.spawn.y) < 24) continue;

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
  const dx = (x - prop.x) / prop.footW;
  const dy = (y - prop.y) / prop.footH;
  return dx * dx + dy * dy < 1;
}
