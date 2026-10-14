import { ITEMS } from '../inventory/items.js';
import { hash2 } from '../core/rng.js';
import { putCell } from '../render/cells.js';
import { dg, glyph, over } from '../render/glyphs.js';

const GLINT = glyph('+');

// Loose items are drawn as small pictures: a body glyph with a second one
// layered over it in its own colour (a sword's hilt, a potion's liquid,
// berries on a leaf). Items without a picture fall back to their registry
// glyph. `c` defaults to the item's colour.
const STEEL = [176, 190, 204];
const HAFT = [140, 100, 62];
const ITEM_ART = {
  granite: { base: 'pebble', layer: 'speck', layerC: [222, 178, 170] },
  basalt: { base: 'pebble', layer: null },
  limestone: { base: 'pebble', layer: 'speck', layerC: [236, 230, 204] },
  flint: { base: 'props.item.flint' },
  stick: { base: 'props.item.stick' },
  berries: { base: 'props.item.leaf', c: [70, 128, 66], layer: 'props.berry.4' },
  mushroom: { base: 'props.item.stem', c: [222, 206, 170], layer: 'props.item.cap', layerC: [192, 108, 70] },
  reed: { base: 'props.item.reed' },
  clay: { base: 'props.item.clay' },
  straw: { base: 'props.item.straw' },
  fibre: { base: 'props.item.fibre' },
  oakLog: { base: 'props.item.log', layer: 'props.item.logend', layerC: [214, 176, 124] },
  ironOre: { base: 'props.item.ore', layer: 'props.item.glints', layerC: [232, 206, 160] },
  shortSword: { base: 'props.item.blade', c: STEEL, layer: 'props.item.hilt', layerC: HAFT },
  greatsword: { base: 'props.item.blade', c: STEEL, layer: 'props.item.hilt', layerC: [110, 84, 60] },
  dagger: { base: 'props.item.blade', c: STEEL, layer: 'props.item.hilt', layerC: [96, 70, 60] },
  longbow: { base: 'props.item.bow' },
  arrow: { base: 'props.item.shaft' },
  javelin: { base: 'props.item.shaft' },
  spear: { base: 'props.item.shaft', c: HAFT, layer: 'props.item.head', layerC: STEEL },
  battleAxe: { base: 'props.item.stick', c: HAFT, layer: 'props.item.head', layerC: STEEL },
  warHammer: { base: 'props.item.stick', c: HAFT, layer: 'props.item.hammerhead', layerC: [150, 156, 166] },
  quarterstaff: { base: 'props.item.stick' },
  healingDraught: { base: 'props.item.flask', c: [168, 186, 196], layer: 'props.item.liquid' },
  staminaTonic: { base: 'props.item.flask', c: [168, 186, 196], layer: 'props.item.liquid' },
  bandage: { base: 'props.item.roll' },
};

// The base and layer glyphs and colours for one loose item, kept per item.
const arts = new WeakMap();
function itemArt(item, definition) {
  const art = Object.hasOwn(ITEM_ART, item.id) ? ITEM_ART[item.id] : null;
  const colour = definition.colour;
  if (!art) {
    const body = typeof definition.groundGlyph === 'number' ? definition.groundGlyph : glyph(definition.groundGlyph);
    return { base: body, c: colour, layer: null };
  }
  const v = Math.floor(hash2(Math.floor(item.x), Math.floor(item.y), 5) * 8);
  const name = (n, count) => (n === 'pebble' || n === 'speck') ? `${n}.${v % count}` : n;
  return {
    base: dg(name(art.base, 8)),
    c: art.c ?? colour,
    layer: art.layer ? dg(name(art.layer, 16)) : null,
    layerC: art.layerC ?? colour,
  };
}

// A reflected cell can land below the view even when its source is above
// it. Include that destination range (and the water's sideways sway) when
// a sprite is sent to a different writer.
function visible(r, x, base, width, height, write) {
  const reflected = write !== putCell;
  const margin = reflected ? 2 : 0;
  return x + width + margin >= 0 && x - width - margin < r.cols
    && base - height < r.rows && base + (reflected ? height + 1 : 0) >= 0;
}

export function drawItem(r, view, item, time, write = putCell) {
  const definition = Object.hasOwn(ITEMS, item?.id) ? ITEMS[item.id] : null;
  if (!definition || !Number.isFinite(item.x) || !Number.isFinite(item.y)
    || (item.count ?? 1) <= 0) return;
  const sx = Math.floor(item.x) - view.x0;
  const base = Math.floor(item.y) - view.y0;
  if (!visible(r, sx, base, 1, 2, write)) return;

  const phase = item.phase ?? 0;
  const bob = 0.65 + Math.sin(time * 2 + phase) * 0.3;
  const sy = Math.floor(item.y - bob) - view.y0;
  const pulse = Math.max(0, Math.sin(time * 2.7 + phase));
  const light = 0.85 + pulse * 0.15;
  let art = arts.get(item);
  if (!art || art.id !== item.id) {
    art = itemArt(item, definition);
    art.id = item.id;
    arts.set(item, art);
  }
  write(r, sx, sy, art.base, art.c[0] * light, art.c[1] * light, art.c[2] * light, base);
  if (art.layer !== null) {
    write(r, sx, sy, over(art.layer), art.layerC[0] * light, art.layerC[1] * light, art.layerC[2] * light, base);
  }
  if (pulse > 0.96) {
    const [red, green, blue] = definition.colour;
    write(r, sx + 1, sy - 1, GLINT,
      red * 0.25 + 190, green * 0.25 + 190, blue * 0.25 + 190, base);
  }
}

// ------------------------------------------------------------ gatherables
//
// Resource plants are laid out once per node from its phase, so no two
// bushes share a silhouette, then drawn each frame with a little sway.

const layouts = new WeakMap();
const LEAF = [52, 116, 70];
const LEAF_LIT = [92, 158, 86];
const WOOD = [120, 88, 56];
const BERRY_COLOURS = [[226, 56, 98], [196, 38, 78], [158, 52, 142]];

function bushLayout(node) {
  const phase = node.phase ?? 0;
  const seed = Math.floor(phase * 1000) + 7;
  const rand = (i) => hash2(i, 3, seed);
  // Three or four leafy lobes inside the 13 by 9 footprint.
  const lobes = [
    { x: 0, y: -4.6, rx: 4.2 + rand(1) * 1.6, ry: 2.6 + rand(2) * 0.8 },
    { x: -2.6 - rand(3) * 1.2, y: -3.2, rx: 2.6 + rand(4), ry: 2 + rand(5) * 0.6 },
    { x: 2.4 + rand(6) * 1.4, y: -3.4 - rand(7), rx: 2.4 + rand(8), ry: 2 + rand(9) * 0.6 },
  ];
  if (rand(10) < 0.6) lobes.push({ x: (rand(11) - 0.5) * 4, y: -6.2, rx: 2.2 + rand(12), ry: 1.6 });
  const leaves = [];
  const twigs = [];
  for (let dy = -8; dy <= -1; dy++) {
    for (let dx = -6; dx <= 6; dx++) {
      let depth = 0;
      for (const lobe of lobes) {
        const nx = (dx - lobe.x) / lobe.rx;
        const ny = (dy + 0.5 - lobe.y) / lobe.ry;
        depth = Math.max(depth, 1 - nx * nx - ny * ny);
      }
      if (depth <= 0) continue;
      const h = hash2(dx, dy, seed);
      // Gaps inside the crown show the woody forks.
      if (depth > 0.35 && dy > -6 && h < 0.13) {
        twigs.push({ dx, dy, g: dg(`props.fork.${Math.floor(h * 30) % 4}`) });
        continue;
      }
      const lit = Math.max(0, Math.min(1, 0.55 - dx * 0.05 - (dy + 4) * 0.08 + (h - 0.5) * 0.2));
      const level = depth < 0.2 ? 1 : lit > 0.5 ? 3 : 2;
      leaves.push({ dx, dy, g: dg(`props.leaves.${level}.${Math.floor(h * 4)}`), lit, edge: depth < 0.25 });
    }
  }
  // The stems leaving the ground.
  const stems = [
    { dx: 0, dy: 0, g: dg('props.fork.2') },
    { dx: -1, dy: 0, g: dg('props.strip.3.0') },
    { dx: 1, dy: 0, g: dg('props.strip.1.0') },
    // The main stems rise into the crown; leaves drawn later cover them.
    { dx: 0, dy: -1, g: dg('props.fork.0') },
    { dx: -1, dy: -2, g: dg('props.strip.3.0') },
    { dx: 1, dy: -2, g: dg('props.fork.1') },
  ];
  // Fruit hangs on the outer, sunnier leaves.
  const sites = leaves.filter((c) => !c.edge && c.dy <= -2)
    .sort((a, b) => hash2(a.dx, a.dy, seed + 1) - hash2(b.dx, b.dy, seed + 1));
  const berry = BERRY_COLOURS[Math.floor(hash2(seed, 2, 9) * BERRY_COLOURS.length)];
  return { leaves, twigs, stems, sites, berry, seed };
}

function grassLayout(node) {
  const phase = node.phase ?? 0;
  const seed = Math.floor(phase * 1000) + 11;
  const cols = [];
  const half = 2 + (hash2(seed, 1, 1) < 0.5 ? 1 : 0);
  for (let dx = -half; dx <= half; dx++) {
    const height = Math.max(2, Math.round(5 - Math.abs(dx) * 1.1 + hash2(dx, 0, seed) * 1.6));
    const plume = height >= 4 && hash2(dx, 1, seed) < 0.7;
    cols.push({ dx, height, plume, v: Math.floor(hash2(dx, 2, seed) * 4) });
  }
  return { cols };
}

function layout(node) {
  let l = layouts.get(node);
  if (!l || l.phase !== node.phase) {
    l = node.kind === 'bush' ? bushLayout(node) : grassLayout(node);
    l.phase = node.phase;
    layouts.set(node, l);
  }
  return l;
}

const STRAW = [168, 172, 86];
const SEED = [216, 198, 136];
const STUBBLE = [0, 1, 2].map((i) => dg(`props.stubble.${i}`));
const BLADES = [0, 1, 2, 3, 4].map((l) => [0, 1].map((v) => dg(`props.blades.${l}.${v}`)));
const PLUMES = [0, 1, 2, 3].map((v) => dg(`props.plume.${v}`));
const BERRIES = [0, 1, 2, 3, 4, 5].map((v) => over(dg(`props.berry.${v}`)));

export function drawResource(r, view, node, time, write = putCell) {
  if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.y)) return;
  const sx = Math.floor(node.x) - view.x0;
  const base = Math.floor(node.y) - view.y0;
  const bush = node.kind === 'bush';
  if (!visible(r, sx, base, bush ? 6 : 3, bush ? 8 : 6, write)) return;
  const phase = node.phase ?? 0;

  if (node.kind === 'grass') {
    // A tussock of tall sedge with feathery seed heads, or its cut stubble.
    if (node.harvested) {
      for (let dx = -1; dx <= 1; dx++) {
        write(r, sx + dx, base, STUBBLE[dx + 1], 132, 136, 76, base);
      }
      return;
    }
    const { cols } = layout(node);
    const sway = Math.sin(time * 1.6 + phase) * 0.7;
    for (const col of cols) {
      for (let h = 0; h < col.height; h++) {
        const lean = col.dx * 0.35 + sway * (h + 1) / col.height;
        const l = Math.max(0, Math.min(4, Math.round(2 + lean * 1.6)));
        const light = 0.7 + h / col.height * 0.45 - col.dx * 0.03;
        const tip = h === col.height - 1;
        if (tip && col.plume) {
          write(r, sx + col.dx, base - h, PLUMES[col.v], SEED[0] * light, SEED[1] * light, SEED[2] * light, base);
          continue;
        }
        const c = h < col.height / 2 ? [92, 150, 70] : STRAW;
        write(r, sx + col.dx, base - h, BLADES[l][(col.v + h) % 2], c[0] * light, c[1] * light, c[2] * light, base);
      }
    }
    return;
  }

  if (!bush) return;
  const l = layout(node);
  const wind = Math.sin(time * 1.1 + phase);
  // Only the narrow upper lobes move a whole cell; the broad lower canopy
  // stays within the plant's 13-column footprint and its roots stay planted.
  const sway = (dy) => dy <= -6 ? Math.round(wind * 0.85 * -dy / 8) : 0;
  const tint = Math.sin(phase * 2.3) * 0.06;
  for (const cell of l.stems) {
    write(r, sx + cell.dx, base + cell.dy, cell.g, WOOD[0] * 0.85, WOOD[1] * 0.85, WOOD[2] * 0.85, base);
  }
  for (const cell of l.twigs) {
    const light = 0.75 - cell.dx * 0.03;
    write(r, sx + cell.dx + sway(cell.dy), base + cell.dy, cell.g, WOOD[0] * light, WOOD[1] * light, WOOD[2] * light, base);
  }
  const count = Number.isInteger(node.berryCount) && node.berryCount >= 4 && node.berryCount <= 7
    ? node.berryCount : 2;
  const fruit = node.harvested ? 0 : Math.min(count, l.sites.length);
  const ripe = new Set(l.sites.slice(0, fruit));
  for (const cell of l.leaves) {
    const shimmer = Math.sin(time * 1.1 + phase + cell.dx * 0.55) * 0.05;
    const k = 0.75 + tint + shimmer;
    const c = cell.edge ? LEAF_LIT : LEAF;
    const mix = cell.lit;
    const x = sx + cell.dx + sway(cell.dy);
    const y = base + cell.dy;
    const red = (c[0] + (LEAF_LIT[0] - c[0]) * mix) * k;
    const green = (c[1] + (LEAF_LIT[1] - c[1]) * mix) * k;
    const blue = (c[2] + (LEAF_LIT[2] - c[2]) * mix) * k;
    // Inside the crown, deep shade fills the gaps between leaves.
    if (cell.edge) write(r, x, y, cell.g, red, green, blue, base);
    else write(r, x, y, cell.g, red, green, blue, base, red * 0.2, green * 0.22, blue * 0.22 + 3);
    if (ripe.has(cell)) {
      const light = 0.94 + Math.sin(time * 1.7 + phase + cell.dx) * 0.06;
      const b = l.berry;
      write(r, x, y, BERRIES[Math.abs(cell.dx + cell.dy * 3) % 6],
        b[0] * light, b[1] * light, b[2] * light, base);
    }
  }
}
