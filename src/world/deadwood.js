import { valueNoise } from '../core/noise.js';
import { hash2, mulberry32 } from '../core/rng.js';
import { dg } from '../render/glyphs.js';
import { MOSS } from '../render/palette.js';
import { bakeSurface, cellBounds, ringGlyph } from './prop-art.js';
import { ASPECT } from './world.js';

export const DEADWOOD_CONDITIONS = Object.freeze(['fallen', 'snag', 'stump', 'beaver']);
// Includes the far end of a fallen trunk whose centre is in another chunk.
export const DEADWOOD_REACH_X = 64;
export const DEADWOOD_REACH_Y = 16;

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));

function closest(x, y, segment) {
  const dx = segment.bx - segment.ax;
  const dy = segment.by - segment.ay;
  const t = clamp(((x - segment.ax) * dx + (y - segment.ay) * dy) / (dx * dx + dy * dy || 1));
  return { t, x: segment.ax + dx * t, y: segment.ay + dy * t };
}

export function deadwoodBlocks(prop, x, y) {
  const px = (x - prop.x) * ASPECT;
  const py = y - prop.y;
  return prop.colliders.some(s => {
    const p = closest(px, py, s);
    return (px - p.x) ** 2 + (py - p.y) ** 2 < s.r ** 2;
  });
}

export function deadwoodInClearing(prop, spawn, radius = 36) {
  const px = (spawn.x - prop.x) * ASPECT;
  const py = spawn.y - prop.y;
  return prop.colliders.some(s => {
    const p = closest(px, py, s);
    return Math.hypot(px - p.x, py - p.y) < radius + s.r;
  });
}

// Dead wood is baked like any other prop (see prop-art.js), over the full
// reach of a fallen trunk on either side of its base.
function bake(sample, left, right, top, bottom, seed, options) {
  const cells = bakeSurface(0, Math.floor(top) - 1, Math.ceil(bottom) + 1, sample, seed,
    { ...options, x0: Math.floor(left / ASPECT) - 1, x1: Math.ceil(right / ASPECT) + 1 });
  for (const cell of cells) {
    cell.foliage = false;
    cell.flex = 0;
  }
  return { cells, bounds: cellBounds(cells) };
}

const FUNGUS = [168, 146, 108];
const mossGlyph = (px, py, seed) => dg(`props.moss.${Math.floor(hash2(Math.floor(px * 2), Math.floor(py), seed) * 6)}`);

export function makeDeadwood(x, y, rand, { condition = 'fallen', species = 'oak', seed = 1 } = {}) {
  if (!DEADWOOD_CONDITIONS.includes(condition)) condition = 'fallen';
  const spriteSeed = Math.floor(hash2(Math.floor(x), Math.floor(y), seed + 763) * 2 ** 32);
  const random = rand ?? mulberry32(spriteSeed);
  const radius = 1.9 + random() * 2.1;
  const birch = species === 'birch';
  const bark = birch ? [168, 174, 176] : [116, 86, 62];
  const woodColor = [172, 136, 92];
  const branches = [];
  const chips = [];
  let colliders, sample, left, right, top, bottom;
  // Weathered timber: bark (furrowed, or birch's chalky skin) with bare
  // wood where it has peeled. `lying` turns the bark's furrows sideways.
  const timber = (px, py, light, exposed = false, lying = false) => {
    const grain = valueNoise(px * 1.2, py * 0.2, spriteSeed + 11);
    const l = clamp(light * (0.84 + grain * 0.28));
    if (exposed) return { m: lying ? 'plankh' : 'plank', l, c: woodColor };
    return { m: birch ? 'birch' : lying ? 'barkh' : 'bark', l, c: bark };
  };
  const endGrain = (nx, ny, d, px, py) => d > 0.78
    ? timber(px, py, 0.5)
    : { m: 'cut', l: clamp(0.66 - nx * 0.1 - ny * 0.12), c: woodColor,
      g: ringGlyph(-nx, -ny, spriteSeed, Math.floor(px * 2), Math.floor(py * 2)) };

  if (condition === 'fallen') {
    const length = 23 + random() * 19;
    const angle = (random() - 0.5) * 0.55;
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const trunk = { ax: -dx * length / 2, ay: -dy * length / 2,
      bx: dx * length / 2, by: dy * length / 2, r: radius * 0.65 };
    colliders = [trunk];
    for (let i = 0; i < 3; i++) {
      const t = 0.2 + i * 0.26;
      const ax = trunk.ax + dx * length * t, ay = trunk.ay + dy * length * t - radius;
      const side = random() < 0.5 ? -1 : 1;
      branches.push({ ax, ay, bx: ax + side * (3 + random() * 6), by: ay - 3 - random() * 6, r: 0.35 + random() * 0.35 });
    }
    const fungusAt = length * (0.15 + hash2(spriteSeed, 3, 1) * 0.7);
    left = trunk.ax - radius * 2; right = trunk.bx + radius * 2;
    top = Math.min(trunk.ay, trunk.by) - radius * 2 - 11;
    bottom = Math.max(trunk.ay, trunk.by) + radius;
    sample = (px, py) => {
      // Cut end grain and a dark rim make the cylinder readable on the grass.
      for (const end of [trunk.ax, trunk.bx]) {
        const t = end === trunk.ax ? 0 : 1;
        const cy = trunk.ay + (trunk.by - trunk.ay) * t - radius;
        const nx = (px - end) / (radius * 0.65), ny = (py - cy) / radius;
        const d = nx * nx + ny * ny;
        if (d < 1) return endGrain(nx, ny, d, px, py);
      }
      const p = closest(px, py + radius, trunk);
      const along = (px - trunk.ax) * dx + (py + radius - trunk.ay) * dy;
      if (along >= 0 && along <= length && Math.abs(py - (p.y - radius)) < radius) {
        const normal = (py - p.y + radius) / radius;
        const grain = valueNoise(along * 0.35, normal * 2, spriteSeed + 17);
        const exposed = grain > 0.86;
        const s = timber(px, py, 0.68 - normal * 0.4, exposed, true);
        if (normal < -0.25 && grain < 0.4) {
          s.acc = { g: mossGlyph(px, py, spriteSeed), c: MOSS.map((v) => v * (0.75 + grain * 0.7)) };
        } else if (Math.abs(along - fungusAt) < 1 && normal > -0.1 && normal < 0.6) {
          s.acc = { g: dg(`props.fungus.${Math.floor(hash2(spriteSeed, 5, 2) * 3)}`), c: FUNGUS };
        }
        return s;
      }
      for (const b of branches) {
        const p = closest(px, py, b);
        if (Math.hypot(px - p.x, py - p.y) < b.r) return timber(px, py, 0.7, p.t > 0.88);
      }
      return null;
    };
  } else {
    const height = condition === 'snag' ? 34 + random() * 33 : condition === 'beaver' ? 13 + random() * 8 : 7 + random() * 9;
    const lean = (random() - 0.5) * 0.11;
    const taper = condition === 'snag' ? 0.47 : 0.8;
    colliders = [{ ax: 0, ay: 0, bx: 0, by: 0, r: radius * 0.65 }];
    if (condition === 'snag') for (let i = 0; i < 5; i++) {
      const ay = -height * (0.35 + i * 0.11), ax = -ay * lean;
      const side = i % 2 ? 1 : -1;
      branches.push({ ax, ay, bx: ax + side * (5 + random() * 8), by: ay - 3 - random() * 7, r: 0.3 + random() * 0.35 });
    }
    if (condition === 'beaver') for (let i = 0; i < 9; i++) {
      chips.push({ x: (random() - 0.5) * radius * 5, y: -random() * 2, g: i % 4 });
    }
    const fungusY = -height * (0.2 + hash2(spriteSeed, 4, 1) * 0.4);
    left = -radius * 3 - 14; right = radius * 3 + 14; top = -height - 4; bottom = 2;
    sample = (px, py) => {
      const v = clamp(-py / height);
      const centre = -py * lean;
      if (condition === 'stump') {
        // The sawn top, seen from above.
        const nx = (px - height * lean) / (radius * taper);
        const ny = (py + height) / 1.2;
        const d = nx * nx + ny * ny;
        if (d < 1) return endGrain(nx, ny, d, px, py);
      }
      let width = radius * (1 - v * (1 - taper));
      if (condition === 'beaver') width *= 1 - Math.max(0, 1 - Math.abs(v - 0.7) / 0.4) * 0.68;
      const nx = (px - centre) / width;
      const splinter = condition === 'stump' ? 0 : valueNoise(px * 1.3, 0, spriteSeed + 29) * (condition === 'snag' ? 5 : 2);
      if (py <= 0.2 && py >= -height + splinter && Math.abs(nx) < 1) {
        const exposed = condition === 'beaver' && v > 0.45 && v < 0.95 || condition === 'snag' && py < -height + 5;
        const round = Math.sqrt(Math.max(0, 1 - nx * nx));
        const s = timber(px, py, 0.5 - nx * 0.34 + round * 0.18, exposed);
        if (!exposed && nx > 0.2 && valueNoise(px * 1.4, py * 0.5, spriteSeed + 41) < 0.4 && v < 0.6) {
          s.acc = { g: mossGlyph(px, py, spriteSeed), c: MOSS };
        } else if (!exposed && Math.abs(py - fungusY) < 0.7 && nx < -0.3 && condition !== 'stump') {
          s.acc = { g: dg('props.fungus.1'), c: FUNGUS };
        }
        return s;
      }
      for (const b of branches) {
        const p = closest(px, py, b);
        if (Math.hypot(px - p.x, py - p.y) < b.r) return timber(px, py, 0.7, p.t > 0.88);
      }
      // Flared exposed roots keep a damaged upright tree grounded.
      if (py > -2 && py < 0.2 && Math.abs(px) < radius + (py + 2) * 0.7) return timber(px, py, 0.5, false, true);
      return null;
    };
  }
  // Gnawed chips lie scattered at the foot of a beaver's work.
  const extras = chips.map((chip) => ({ dx: Math.round(chip.x / ASPECT), dy: Math.round(chip.y) + 1,
    g: dg(`props.chips.${chip.g}`), c: [200, 156, 96] }));
  const shadow = condition === 'fallen' ? null : { rx: radius * 1.6, ry: 1, ox: radius * 0.4 };
  const { cells, bounds } = bake(sample, left, right, top, bottom, spriteSeed, { extras, shadow });
  return { kind: 'deadwood', condition, species, x, y, cells, bounds, colliders,
    footW: radius / ASPECT, footH: radius * 0.65, height: bounds.maxY - bounds.minY + 1, top: bounds.minY };
}
