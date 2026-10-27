import { hash2, mulberry32 } from '../core/rng.js';
import { rockTypeAt } from './geology.js';
import { blocks } from './props.js';
import { neighbourSolids } from './woodland.js';
import { ASPECT, GRASS } from './world.js';

// Ore veins: tight clusters of fist-high ore blocks on the surface, placed per
// chunk from the world seed. In each row: how often a vein is of that ore, its
// blocks, a block's drop, the pickaxe tier it needs and its flecks' colours.
export const ORES = Object.freeze({
  coal: { id: 'coal', name: 'Coal ore', weight: 40, size: [4, 8], drop: { id: 'coal', count: [1, 1] }, tier: 'wood',
    fleck: [44, 42, 46], glint: [150, 150, 160], density: 0.46 },
  copper: { id: 'copper', name: 'Copper ore', weight: 20, size: [3, 7], drop: { id: 'rawCopper', count: [2, 5] },
    tier: 'stone', fleck: [224, 122, 62], patina: [88, 176, 136], density: 0.42 },
  iron: { id: 'iron', name: 'Iron ore', weight: 20, size: [2, 5], drop: { id: 'rawIron', count: [1, 1] }, tier: 'stone',
    fleck: [232, 160, 98], density: 0.4 },
  tin: { id: 'tin', name: 'Tin ore', weight: 12, size: [2, 5], drop: { id: 'rawTin', count: [1, 1] }, tier: 'stone',
    fleck: [208, 214, 220], density: 0.38 },
  lapis: { id: 'lapis', name: 'Lapis ore', weight: 8, size: [1, 4], drop: { id: 'lapisLazuli', count: [4, 9] },
    tier: 'stone', fleck: [50, 92, 216], lift: 1.15, density: 0.4 },
});

// The chance of 0, 1 or 2 veins in a chunk.
export const VEIN_COUNT = [0.6, 0.3, 0.1];

// The host stone takes the local rock's colour: dark basalt, grey granite, pale limestone.
export const HOST_TINT = Object.freeze({
  basalt: { k: 0.72, add: [-2, 0, 8] },
  granite: { k: 0.96, add: [10, 4, 0] },
  limestone: { k: 1.18, add: [14, 12, 2] },
});

const SPAWN_CLEAR = 40;

// A mined block is remembered by its base cell.
export const minedKey = (block) => `ore:${Math.floor(block.x)}:${Math.floor(block.y)}`;

// A block's art seed and size, from its base cell alone, so placement and the bake agree.
export function oreSeed(world, x, y) {
  return Math.floor(hash2(Math.floor(x), Math.floor(y), world.seed + 2811) * 2 ** 32);
}
export function oreRadius(seed) {
  return 2.2 + mulberry32(seed)() * 0.4;
}
export const oreFoot = (seed) => oreRadius(seed) * 0.9 / ASPECT;

function pick(weights, roll) {
  let sum = 0;
  for (let i = 0; i < weights.length - 1; i++) if (roll < (sum += weights[i])) return i;
  return weights.length - 1;
}

// The ore blocks of a chunk as `{ x, y, ore, host, seed, vein }`, in placement order.
// `props` are the chunk's generated props; neighbours' scenery comes from their
// seeds (neighbourSolids), so loading order never matters. A vein hugs the
// chunk's big rock where it can and otherwise sits on open ground.
export function placeVeins(world, cx, cy, size, props) {
  const rand = mulberry32(Math.floor(hash2(cx, cy, world.seed + 2809) * 2 ** 32));
  const step = 2 * 2.4 / ASPECT * 0.8; // side by side and across, block to block in a vein
  const neighbours = [[step, 0], [-step, 0], [step / 2, 1.6], [-step / 2, 1.6], [step / 2, -1.6], [-step / 2, -1.6]];
  const solids = neighbourSolids(world, cx, cy, size);
  const trees = props.filter((p) => p.kind === 'tree');
  const rock = props.find((p) => p.kind === 'rock' && p.footW > 8) ?? null;
  const out = [];
  const nearSolid = (x, y) => trees.some((t) => Math.abs(x - t.x) < t.footW + 6 && Math.abs(y - t.y) < t.footH + 3)
    || solids.some((s) => s.box ? x > s.x0 - 4 && x < s.x1 + 4 && y > s.y0 - 2 && y < s.y1 + 2
      : Math.abs(x - s.x) < s.footW + 6 && Math.abs(y - s.y) < s.footH + 3);
  // Snapped, then its base and every cell of its foot checked; one that fails is dropped.
  const candidate = (px, py, placed) => {
    const x = Math.floor(px) + 0.5, y = Math.floor(py) + 0.5;
    const seed = oreSeed(world, x, y);
    const foot = oreFoot(seed);
    if (x - foot < cx * size + 4 || x + foot >= (cx + 1) * size - 4) return null;
    const top = Math.floor(y - 0.9), bottom = Math.floor(y + 0.9); // the foot's rows, lower edge included
    if (top < cy * size + 2 || bottom >= (cy + 1) * size - 2) return null;
    if (world.spawn && Math.hypot((x - world.spawn.x) * ASPECT, y - world.spawn.y) < SPAWN_CLEAR) return null;
    for (let gy = top; gy <= bottom; gy++) {
      for (let gx = Math.floor(x - foot); gx <= Math.floor(x + foot); gx++) if (world.typeAt(gx, gy) !== GRASS) return null;
    }
    if (nearSolid(x, y)) return null;
    for (const dx of [0, -foot, foot]) if (props.some((p) => blocks(p, x + dx, y))) return null;
    if (placed.some((b) => Math.abs(b.x - x) < 5 && Math.abs(b.y - y) < 1)) return null;
    return { x, y, seed };
  };
  const attempts = pick(VEIN_COUNT, rand());
  const ores = Object.values(ORES);
  for (let v = 0; v < attempts; v++) {
    const ore = ores[pick(ores.map((o) => o.weight / 100), rand())];
    const n = ore.size[0] + Math.floor(rand() * (ore.size[1] - ore.size[0] + 1));
    let anchor = null;
    if (v === 0 && rock) {
      for (const [ax, ay] of [[rock.x - rock.footW - 3.5, rock.y + 1], [rock.x + rock.footW + 3.5, rock.y + 1],
        [rock.x + (rand() - 0.5) * rock.footW, rock.y + rock.footH + 2]]) {
        anchor ??= candidate(ax, ay, out);
      }
    }
    for (let i = 0; i < 6 && !anchor; i++) {
      anchor = candidate(cx * size + 10 + rand() * (size - 20), cy * size + 6 + rand() * (size - 12), out);
    }
    if (!anchor) continue;
    const vein = [anchor];
    for (let tries = 0; vein.length < n && tries < 6 * n; tries++) {
      const from = vein[Math.floor(rand() * vein.length)];
      const [ox, oy] = neighbours[Math.floor(rand() * 6)];
      const next = candidate(from.x + ox + (rand() - 0.5) * 0.8, from.y + oy + (rand() - 0.5) * 0.6, [...out, ...vein]);
      if (next) vein.push(next);
    }
    if (vein.length < ore.size[0]) continue;
    const host = rockTypeAt(world, anchor.x, anchor.y);
    for (const b of vein) out.push({ ...b, ore: ore.id, host, vein: v });
  }
  return out;
}
