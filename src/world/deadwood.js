import { valueNoise } from '../core/noise.js';
import { hash2, mulberry32 } from '../core/rng.js';
import { glyph } from '../render/glyphs.js';
import { MOSS } from '../render/palette.js';
import { ASPECT } from './world.js';

export const DEADWOOD_CONDITIONS = Object.freeze(['fallen', 'snag', 'stump', 'beaver']);
// Includes the far end of a fallen trunk whose centre is in another chunk.
export const DEADWOOD_REACH_X = 64;
export const DEADWOOD_REACH_Y = 16;

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const G = Object.fromEntries([...'.:,|/\\#%oO0=*'].map(c => [c, glyph(c)]));

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

function bake(sample, left, right, top, bottom) {
  const cells = [];
  const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (let dy = Math.floor(top) - 1; dy <= Math.ceil(bottom) + 1; dy++) {
    for (let dx = Math.floor(left / ASPECT) - 1; dx <= Math.ceil(right / ASPECT) + 1; dx++) {
      let hits = 0, red = 0, green = 0, blue = 0, detail = null;
      for (const oy of [-5 / 6, -0.5, -1 / 6]) {
        for (const ox of [-0.25, 0.25]) {
          const s = sample((dx + ox) * ASPECT, dy + oy);
          if (!s) continue;
          hits++;
          red += s.color[0]; green += s.color[1]; blue += s.color[2];
          detail = s;
        }
      }
      if (hits < 2) continue;
      const cell = { dx, dy, g: detail.g, r: Math.round(red / hits), gg: Math.round(green / hits),
        b: Math.round(blue / hits), foliage: false, flex: 0 };
      if (hits >= 5) {
        cell.br = Math.round(cell.r * 0.15);
        cell.bgG = Math.round(cell.gg * 0.15);
        cell.bb = Math.round(cell.b * 0.16);
      }
      cells.push(cell);
      bounds.minX = Math.min(bounds.minX, dx); bounds.maxX = Math.max(bounds.maxX, dx);
      bounds.minY = Math.min(bounds.minY, dy); bounds.maxY = Math.max(bounds.maxY, dy);
    }
  }
  return { cells, bounds };
}

export function makeDeadwood(x, y, rand, { condition = 'fallen', species = 'oak', seed = 1 } = {}) {
  if (!DEADWOOD_CONDITIONS.includes(condition)) condition = 'fallen';
  const spriteSeed = Math.floor(hash2(Math.floor(x), Math.floor(y), seed + 763) * 2 ** 32);
  const random = rand ?? mulberry32(spriteSeed);
  const radius = 1.9 + random() * 2.1;
  const bark = species === 'birch' ? [176, 182, 184] : [140, 96, 64];
  const woodColor = [194, 146, 86];
  const branches = [];
  const chips = [];
  let colliders, sample, left, right, top, bottom;
  const timber = (px, py, light, exposed = false, g = G['|']) => {
    const grain = valueNoise(px * 1.2, py * 0.2, spriteSeed + 11);
    const base = exposed ? woodColor : bark;
    return { color: base.map((v, i) => clamp(v * light * (0.84 + grain * 0.28) + (i === 2 ? 6 : 0), 0, 255)), g };
  };

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
        if (d < 1) {
          if (d > 0.78) return timber(px, py, 0.6, false, G['#']);
          const ring = Math.floor(Math.sqrt(d) * 7);
          return timber(px, py, 0.72 + (1 - ny) * 0.18, true, ring % 2 ? G['o'] : G['O']);
        }
      }
      const p = closest(px, py + radius, trunk);
      const along = (px - trunk.ax) * dx + (py + radius - trunk.ay) * dy;
      if (along >= 0 && along <= length && Math.abs(py - (p.y - radius)) < radius) {
        const normal = (py - p.y + radius) / radius;
        const grain = valueNoise(along * 0.35, normal * 2, spriteSeed + 17);
        const exposed = grain > 0.8;
        const moss = normal < -0.3 && grain < 0.27;
        const s = timber(px, py, 0.62 - normal * 0.27, exposed, exposed ? G['='] : grain < 0.5 ? G[':'] : G['%']);
        if (moss) s.color = MOSS.map((v) => v * (0.8 + grain * 0.6));
        return s;
      }
      for (const b of branches) {
        const p = closest(px, py, b);
        if (Math.hypot(px - p.x, py - p.y) < b.r) return timber(px, py, 0.7, p.t > 0.88, G[b.bx > b.ax ? '/' : '\\']);
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
      chips.push({ x: (random() - 0.5) * radius * 5, y: -random() * 2, g: i % 2 ? G['/'] : G[','] });
    }
    left = -radius * 3 - 14; right = radius * 3 + 14; top = -height - 4; bottom = 2;
    sample = (px, py) => {
      const v = clamp(-py / height);
      const centre = -py * lean;
      let width = radius * (1 - v * (1 - taper));
      if (condition === 'beaver') width *= 1 - Math.max(0, 1 - Math.abs(v - 0.7) / 0.4) * 0.68;
      const nx = (px - centre) / width;
      const splinter = valueNoise(px * 1.3, 0, spriteSeed + 29) * (condition === 'snag' ? 5 : 2);
      if (py <= 0.2 && py >= -height + splinter && Math.abs(nx) < 1) {
        const exposed = condition === 'beaver' && v > 0.25 || py < -height + 5;
        const grain = valueNoise(px * 1.8, py * 0.16, spriteSeed + 37);
        const g = exposed ? (condition === 'beaver' ? (Math.floor(py * 2) % 3 ? G['/'] : G[':']) : G['#']) : grain < 0.35 ? G[':'] : G['|'];
        return timber(px, py, 0.65 - nx * 0.24 + Math.sqrt(Math.max(0, 1 - nx * nx)) * 0.16, exposed, g);
      }
      if (condition === 'stump') {
        const d = ((px - height * lean) / (radius * taper)) ** 2 + ((py + height) / 1.2) ** 2;
        if (d < 1) return timber(px, py, 0.95, true, Math.floor(Math.sqrt(d) * 6) % 2 ? G['O'] : G['o']);
      }
      for (const b of branches) {
        const p = closest(px, py, b);
        if (Math.hypot(px - p.x, py - p.y) < b.r) return timber(px, py, 0.7, p.t > 0.88, G[b.bx > b.ax ? '/' : '\\']);
      }
      for (const chip of chips) if (Math.abs(px - chip.x) < 0.42 && Math.abs(py - chip.y) < 0.3) {
        return { color: [180, 134, 78], g: chip.g };
      }
      // Flared exposed roots keep a damaged upright tree grounded.
      if (py > -2 && py < 0.2 && Math.abs(px) < radius + (py + 2) * 0.7) return timber(px, py, 0.6, false, G['/']);
      return null;
    };
  }
  const { cells, bounds } = bake(sample, left, right, top, bottom);
  return { kind: 'deadwood', condition, species, x, y, cells, bounds, colliders,
    footW: radius / ASPECT, footH: radius * 0.65, height: bounds.maxY - bounds.minY + 1, top: bounds.minY };
}
