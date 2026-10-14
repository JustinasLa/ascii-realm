import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { mulberry32 } from '../src/core/rng.js';
import { dg, GLYPH_COUNT, GLYPH_MASK, GLYPHS, LAYER } from '../src/render/glyphs.js';
import { drawLeaves, MAX_LEAF_DRIFT } from '../src/world/leaves.js';
import { blocks, drawProp, generateProps, nearWater, propInView, treeSpeciesAt } from '../src/world/props.js';
import { reflector } from '../src/world/reflection.js';
import { makeBush, makeTree, MAX_LITTER_DEPTH, MAX_TREE_HALF_WIDTH, MAX_TREE_HEIGHT, TREE_SPECIES } from '../src/world/trees.js';
import { treeWind, windGust } from '../src/world/wind.js';
import { ASPECT, CHUNK_SIZE, GRASS, WATER, World } from '../src/world/world.js';
import { withLayers } from './helpers/renderer.js';

const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const FALLING_LEAVES = new Set([...Array.from({ length: 8 }, (_, h) => dg(`tree.fall.${h}`)),
  ...Array.from({ length: 4 }, (_, h) => dg(`tree.fall.edge.${h}`))]);
const FALLING_PETALS = new Set(Array.from({ length: 4 }, (_, h) => dg(`tree.fall.petal.${h}`)));
const EVERGREEN = new Set(['pine', 'spruce']);
const VIEW = { x0: 0, y0: 0, cols: 640, rows: 640 };

function tree(species = 'oak', season = 'summer', x = 100.5, y = 300.5) {
  return makeTree(x, y, mulberry32(123456), { species, season, seed: 42 });
}

// A cell may carry a second glyph layered over it (a highlight, snow, fruit)
// and the ground in front of a tree carries layered litter.
const isLayer = (cell) => (cell.g & LAYER) !== 0;
const baseCells = (prop) => prop.cells.filter((cell) => !isLayer(cell));
// Space is a real choice: the dark gaps between leaves in a crown.
const realGlyph = (g) => Number.isInteger(g) && (g & GLYPH_MASK) >= 0 && (g & GLYPH_MASK) < GLYPH_COUNT;

function shape(prop) {
  return baseCells(prop).map(({ dx, dy, foliage }) => [dx, dy, foliage]);
}

function recordProp(prop, view = VIEW, t = 0, player = null) {
  const cells = [];
  drawProp({ cols: view.cols, rows: view.rows }, view, prop,
    (_r, ...cell) => cells.push(cell), t, player, 42);
  return cells;
}

function recordLeaves(props, t, view = VIEW) {
  const cells = [];
  drawLeaves({ put: (...cell) => cells.push(cell) }, view, props, t, 42);
  return cells;
}

function worldCells(cells, view, hasBase = false) {
  return cells.map((cell) => {
    const result = [...cell];
    result[0] += view.x0;
    result[1] += view.y0;
    if (hasBase) result[6] += view.y0;
    return result;
  });
}

function freezeTree(prop) {
  for (const cell of prop.cells) Object.freeze(cell);
  Object.freeze(prop.cells);
  Object.freeze(prop.bounds);
  Object.freeze(prop.leafColor);
  return Object.freeze(prop);
}

test('each tree species has a deterministic, distinct, bounded sprite', () => {
  assert.deepEqual(new Set(TREE_SPECIES), new Set([
    'oak', 'birch', 'pine', 'spruce', 'acacia', 'jungle', 'cherry', 'willow',
  ]));
  const silhouettes = new Set();
  for (const species of TREE_SPECIES) {
    const prop = tree(species);
    assert.deepEqual(prop, tree(species), species);
    assert.equal(prop.kind, 'tree');
    assert.equal(prop.species, species);
    assert.ok(prop.cells.length > 500 && prop.cells.length < 14000, species);
    assert.ok(prop.cells.some((cell) => cell.foliage), `${species} foliage`);
    assert.ok(prop.cells.some((cell) => !cell.foliage && !cell.litter && cell.dy >= -2), `${species} roots`);
    assert.ok(prop.footW > 0 && prop.footH > 0);
    assert.ok(prop.height >= 75 && prop.height <= MAX_TREE_HEIGHT, `${species} must tower over the 27-row player`);
    const occupied = new Set();
    let previous = null;
    for (const cell of prop.cells) {
      assert.ok(Number.isInteger(cell.dx) && Number.isInteger(cell.dy));
      // Only litter lies on the ground in front of the base.
      const lowest = cell.litter ? MAX_LITTER_DEPTH : 0;
      assert.ok(Math.abs(cell.dx) <= MAX_TREE_HALF_WIDTH && cell.dy >= 1 - MAX_TREE_HEIGHT && cell.dy <= lowest, species);
      const location = `${cell.dx},${cell.dy}`;
      if (isLayer(cell)) {
        // A layer stacks on the cell emitted just before it, moving with it.
        if (!cell.litter) {
          assert.ok(previous && !isLayer(previous) && previous.dx === cell.dx && previous.dy === cell.dy,
            `${species} layer at ${location} follows its base`);
          assert.equal(cell.flex, previous.flex);
          assert.equal(cell.foliage, previous.foliage);
          assert.equal(cell.br, undefined, 'a layer keeps its base cell background');
        }
        assert.ok((cell.rustle & LAYER) !== 0, 'a rustling layer stays a layer');
      } else {
        assert.ok(!occupied.has(location), `${species} duplicated ${location}`);
        occupied.add(location);
      }
      previous = cell;
      assert.ok(cell.dx >= prop.bounds.minX && cell.dx <= prop.bounds.maxX);
      assert.ok(cell.dy >= prop.bounds.minY && cell.dy <= prop.bounds.maxY);
      assert.ok(realGlyph(cell.g), `${species} glyph`);
      assert.ok(realGlyph(cell.rustle), `${species} rustle glyph`);
      if (cell.foliage) {
        assert.ok((cell.g & GLYPH_MASK) < GLYPHS.length, `${species} leaves use fine characters`);
        assert.ok((cell.rustle & GLYPH_MASK) < GLYPHS.length, `${species} rustles keep fine characters`);
      }
      for (const color of [cell.r, cell.gg, cell.b]) {
        assert.ok(Number.isFinite(color) && color >= 0 && color <= 255, `${species} color`);
      }
      assert.equal(typeof cell.foliage, 'boolean');
      assert.ok(Number.isFinite(cell.flex) && cell.flex >= 0 && cell.flex <= 1);
      if (!cell.foliage) assert.equal(cell.flex, 0, `${species} anchored wood`);
    }
    assert.equal(prop.top, Math.min(...prop.cells.map((cell) => cell.dy)));
    assert.ok(prop.cells.some(isLayer), `${species} has layered detail`);
    assert.equal(prop.height, prop.bounds.maxY - prop.top + 1);
    silhouettes.add(JSON.stringify(shape(prop)));
  }
  assert.equal(silhouettes.size, TREE_SPECIES.length);
});

test('row culling preserves complete seeded sprites across seasons and growth stages', () => {
  // Fingerprints matching a full-rectangle bake (no row culling) of the
  // fine character trees. Cover negative coordinates, thin/thick trunks, and
  // both caller-supplied and fallback random streams.
  const fixtures = [
    { seed: 1, x: -100.5, y: 300.5, randomSeed: 123456,
      expected: '743b2db2226bbe8f56b7349ec7443dc2728169b9f991f8736dbc8b72e39b9f3b' },
    { seed: 42, x: 100.5, y: -300.5, girth: 0.6, randomSeed: 42,
      expected: '4b780db9f61bf5ed0820dc3320e8e99c78f70ed40e82ba4f6faabdb6a477382a' },
    { seed: 9281, x: 63.5, y: 24.5, girth: 2, randomSeed: 9281,
      expected: 'ed872e6064ddb925959a8fa86b45d14107f7d023fc7c10b0f144022d842d0bc3' },
    { seed: 4294967295, x: -63.5, y: -24.5,
      expected: '2a04de0d50e61c2bf43846cc1df486a662fe251be212aecd68f4a314729917fe' },
  ];
  for (const { expected, randomSeed, ...options } of fixtures) {
    const digest = createHash('sha256');
    for (const species of TREE_SPECIES) {
      for (const season of SEASONS) {
        for (const growth of ['mature', 'sapling', 'bush']) {
          const random = randomSeed === undefined ? undefined : mulberry32(randomSeed);
          const prop = makeTree(options.x, options.y, random, { ...options, species, season, growth });
          digest.update(JSON.stringify(prop));
        }
      }
    }
    assert.equal(digest.digest('hex'), expected, `seed ${options.seed}`);
  }
});

test('seasonal palettes preserve leafy-season geometry and the winter ground anchor', () => {
  for (const species of TREE_SPECIES) {
    const summer = tree(species);
    const summerWood = summer.cells.filter((cell) => !cell.foliage && !cell.litter && cell.dy >= -3);
    const palettes = new Set();
    for (const season of SEASONS) {
      const prop = tree(species, season);
      assert.deepEqual(prop, tree(species, season), `${species} ${season} repeatability`);
      assert.equal(prop.season, season);
      assert.deepEqual([prop.x, prop.y, prop.footW, prop.footH],
        [summer.x, summer.y, summer.footW, summer.footH]);
      palettes.add(JSON.stringify(prop.leafColor));
      if (season !== 'winter') {
        assert.deepEqual(shape(prop), shape(summer), `${species} ${season} shape`);
        assert.deepEqual(prop.bounds, summer.bounds);
        const woodGeometry = (cells) => cells.filter((cell) => !cell.foliage && !cell.litter)
          .map(({ dx, dy, g, flex }) => [dx, dy, g, flex]);
        assert.deepEqual(woodGeometry(prop.cells), woodGeometry(summer.cells), `${species} ${season} bark geometry`);
        assert.deepEqual(prop.cells.filter((cell) => !cell.foliage && !cell.litter && cell.dy >= -3),
          summerWood, `${species} ${season} low-trunk color`);
      }
      for (const cell of summerWood) {
        assert.ok(prop.cells.some((other) => !other.foliage && other.dx === cell.dx && other.dy === cell.dy),
          `${species} ${season} root at ${cell.dx},${cell.dy}`);
      }
    }
    assert.equal(palettes.size, SEASONS.length, `${species} seasonal tint`);
    const winterFoliage = baseCells(tree(species, 'winter')).filter((cell) => cell.foliage).length;
    const summerFoliage = baseCells(summer).filter((cell) => cell.foliage).length;
    assert.ok(EVERGREEN.has(species) ? winterFoliage >= summerFoliage * 0.9 : winterFoliage < summerFoliage * 0.5,
      `${species} winter foliage`);
  }
});

test('world seasons accept supported names and fall back to summer', () => {
  assert.equal(new World(42).season, 'summer');
  for (const season of SEASONS) assert.equal(new World(42, { season }).season, season);
  for (const season of ['', 'monsoon', 'SUMMER', null]) {
    assert.equal(new World(42, { season }).season, 'summer');
  }
});

test('chunk visitation order preserves props, grass ownership, and the actual spawn clearing', () => {
  const forward = new World(42, { season: 'autumn' });
  const reverse = new World(42, { season: 'autumn' });
  assert.deepEqual(forward.spawn, reverse.spawn);
  const cx0 = Math.floor(forward.spawn.x / CHUNK_SIZE);
  const cy0 = Math.floor(forward.spawn.y / CHUNK_SIZE);
  const chunks = [];
  for (let cy = cy0 - 2; cy <= cy0 + 2; cy++) {
    for (let cx = cx0 - 2; cx <= cx0 + 2; cx++) chunks.push([cx, cy]);
  }
  chunks.push([-3, -3], [3, 3]);
  const generated = new Map();
  let trees = 0;
  let props = 0;
  const growths = new Set();
  for (const [cx, cy] of chunks) {
    const chunkProps = forward.propsOf(cx, cy);
    generated.set(`${cx},${cy}`, chunkProps);
    // The world tags each generated prop with an id so the builder can erase it.
    const untagged = chunkProps.map(({ id, ...prop }) => prop);
    assert.deepEqual(generateProps(forward, cx, cy, CHUNK_SIZE), untagged, `${cx},${cy} regeneration`);
    for (const prop of chunkProps) {
      props++;
      if (prop.growth) growths.add(prop.growth);
      assert.equal(Math.floor(prop.x / CHUNK_SIZE), cx, `${prop.kind} owning x chunk`);
      assert.equal(Math.floor(prop.y / CHUNK_SIZE), cy, `${prop.kind} owning y chunk`);
      assert.equal(forward.typeAt(prop.x, prop.y), GRASS);
      assert.ok(Math.hypot((prop.x - forward.spawn.x) * ASPECT, prop.y - forward.spawn.y) >= 36,
        `prop at ${prop.x},${prop.y} intrudes into spawn clearing`);
      if (prop.kind === 'tree') {
        trees++;
        assert.ok(TREE_SPECIES.includes(prop.species));
        assert.equal(prop.season, 'autumn');
        if (prop.species === 'willow') assert.ok(nearWater(forward, Math.floor(prop.x), Math.floor(prop.y)));
      }
    }
  }
  assert.ok(props > 0 && trees > 0, 'placement fixture exercises populated chunks');
  assert.deepEqual(growths, new Set(['mature', 'sapling', 'bush']), 'forests generate all three growth layers');
  for (const [cx, cy] of [...chunks].reverse()) {
    assert.deepEqual(reverse.propsOf(cx, cy), generated.get(`${cx},${cy}`), `${cx},${cy} reversed visitation`);
  }
});

test('terrain species selection reaches every species and reserves willows for water', () => {
  const dry = { seed: 42, typeAt: () => GRASS };
  const wet = { seed: 42, typeAt: () => WATER };
  assert.equal(nearWater(dry, 0, 0), false);
  assert.equal(nearWater(wet, 0, 0), true);
  const found = new Set();
  const rand = mulberry32(817263);
  for (let i = 0; i < 4096 && found.size < TREE_SPECIES.length; i++) {
    const x = Math.floor((rand() - 0.5) * 16000);
    const y = Math.floor((rand() - 0.5) * 16000);
    const drySpecies = treeSpeciesAt(dry, x, y);
    const wetSpecies = treeSpeciesAt(wet, x, y);
    assert.equal(treeSpeciesAt(dry, x, y), drySpecies);
    assert.equal(treeSpeciesAt(wet, x, y), wetSpecies);
    assert.notEqual(drySpecies, 'willow');
    assert.ok(TREE_SPECIES.includes(drySpecies));
    assert.ok(TREE_SPECIES.includes(wetSpecies));
    found.add(drySpecies);
    found.add(wetSpecies);
  }
  assert.deepEqual(found, new Set(TREE_SPECIES));
});

test('wind moves foliage gently, keeps wood rooted, and never changes cached cells', () => {
  let moved = false;
  for (const species of TREE_SPECIES) {
    const prop = freezeTree(tree(species));
    const original = structuredClone(prop);
    for (let t = 0; t <= 36; t += 2) {
      const gust = windGust(42, prop.x, prop.y, t);
      const sway = treeWind(prop, t, 42);
      assert.ok(Number.isFinite(gust) && gust >= 0 && gust <= 1);
      assert.ok(Number.isFinite(sway) && Math.abs(sway) <= 2);
      assert.equal(treeWind(prop, t, 42), sway);
      assert.ok(Math.abs(treeWind(prop, t + 0.001, 42) - sway) < 0.01);
      const drawn = recordProp(prop, VIEW, t);
      assert.equal(drawn.length, prop.cells.length);
      for (let i = 0; i < drawn.length; i++) {
        const cell = prop.cells[i];
        const [sx, sy, , , , , base] = drawn[i];
        const rootedX = Math.floor(prop.x) + cell.dx;
        assert.equal(sy, Math.floor(prop.y) + cell.dy);
        assert.equal(base, Math.floor(prop.y));
        if (cell.foliage) {
          assert.ok(Math.abs(sx - rootedX) <= 2);
          if (sx !== rootedX) moved = true;
        } else {
          assert.equal(sx, rootedX, `${species} stationary bark`);
          assert.deepEqual(drawn[i].slice(2, 6), [cell.g, cell.r, cell.gg, cell.b]);
        }
      }
    }
    assert.deepEqual(prop, original, `${species} cache`);
  }
  assert.ok(moved, 'sampled gusts actually animate foliage');
});

test('camera translation and reflection share the same animated source cells', () => {
  const prop = freezeTree(tree('willow'));
  const a = { ...VIEW, x0: 20, y0: 10 };
  const b = { ...VIEW, x0: 27, y0: 3 };
  const t = 17.25;
  assert.deepEqual(worldCells(recordProp(prop, a, t), a, true),
    worldCells(recordProp(prop, b, t), b, true));
  const r = withLayers({ cols: a.cols, rows: a.rows,
    mask: new Uint8Array(a.cols * a.rows).fill(WATER), fg: new Float64Array(a.cols * a.rows * 4) });
  const sources = [];
  const mirror = reflector(t, a);
  drawProp(r, a, prop, (renderer, ...cell) => {
    sources.push(cell);
    mirror(renderer, ...cell);
  }, t, null, 42);
  assert.deepEqual(sources, recordProp(prop, a, t));
  assert.ok(r.fg.some((value, i) => i % 4 === 3 && value > 0), 'reflection writes water cells');
});

test('culling retains crowns below the viewport and reflections from trees above it', () => {
  const prop = tree('jungle');
  const bx = Math.floor(prop.x);
  const by = Math.floor(prop.y);
  const crownView = { x0: bx - 32, y0: by + prop.top - 2, cols: 64, rows: 24 };
  assert.ok(by >= crownView.y0 + crownView.rows, 'tree base is below the viewport');
  assert.equal(propInView(crownView, prop), true);
  const visible = [];
  drawProp({ putBg() {}, put: (...cell) => {
    if (cell[0] >= 0 && cell[1] >= 0 && cell[0] < crownView.cols && cell[1] < crownView.rows) visible.push(cell);
  } }, crownView, prop, undefined, 5, null, 42);
  assert.ok(visible.length > 0, 'offscreen base still draws its crown');

  // Below the litter lying in front of the trunk.
  const lakeView = { x0: bx - 32, y0: by + prop.bounds.maxY + 1, cols: 64, rows: 40 };
  assert.equal(propInView(lakeView, prop), false);
  assert.equal(propInView(lakeView, prop, true), true);
  const r = withLayers({ cols: lakeView.cols, rows: lakeView.rows,
    mask: new Uint8Array(lakeView.cols * lakeView.rows).fill(WATER),
    fg: new Float64Array(lakeView.cols * lakeView.rows * 4) });
  drawProp(r, lakeView, prop, reflector(5, lakeView), 5, null, 42);
  assert.ok(r.fg.some((value, i) => i % 4 === 3 && value > 0), 'above-screen tree reflects into lake');
});

test('clipping large reflected sprites preserves the uncropped water image', () => {
  const prop = tree('willow');
  for (const view of [
    { x0: 65, y0: 320, cols: 64, rows: 80 },
    { x0: 130, y0: 360, cols: 64, rows: 80 },
    { x0: 38, y0: 300, cols: 64, rows: 80 },
  ]) {
    const renderer = () => withLayers({ cols: view.cols, rows: view.rows,
      mask: new Uint8Array(view.cols * view.rows).fill(WATER),
      fg: new Float64Array(view.cols * view.rows * 4) });
    const full = renderer();
    const clipped = renderer();
    drawProp(full, view, prop, reflector(12, view), 12, null, 42);
    drawProp(clipped, view, prop, reflector(12, view), 12, null, 42, true);
    assert.deepEqual(clipped.fg, full.fg, 'wind and ripples survive source clipping');
    assert.ok(full.fg.some((v, i) => i % 4 === 3 && v > 0), 'fixture reflects some canopy');
  }
});

test('saplings and walkable bushes form a varied layer below mature trees', () => {
  const heights = new Set();
  for (const species of TREE_SPECIES) {
    const mature = tree(species);
    const young = makeTree(100.5, 300.5, mulberry32(123456), { species, seed: 42, growth: 'sapling' });
    const bush = makeBush(100.5, 300.5, mulberry32(123456), { species, seed: 42 });
    assert.equal(young.growth, 'sapling');
    assert.equal(bush.kind, 'bush');
    assert.ok(young.height >= 12 && young.height <= 55, `${species} sapling size`);
    assert.ok(bush.height >= 5 && bush.height <= 20, `${species} bush size`);
    assert.ok(mature.height > young.height * 2.5, `${species} mature-to-young scale`);
    assert.ok(mature.footW > young.footW);
    assert.ok(bush.cells.some(c => c.foliage));
    assert.equal(blocks(bush, bush.x, bush.y), false, 'the player can pass through undergrowth');
    assert.equal(blocks(mature, mature.x, mature.y), true, 'solid mature trunk');
    assert.equal(blocks(young, young.x, young.y), true, 'solid sapling stem');
    assert.deepEqual(bush, makeBush(100.5, 300.5, mulberry32(123456), { species, seed: 42 }));
    heights.add(young.height);
  }
  assert.ok(heights.size >= 4, 'sapling species have different proportions');
});

test('moonlit crowns are paler on top and trunks are pale grey in every growth stage', () => {
  const brightness = (c) => c.r + c.gg + c.b;
  const mean = (cells) => cells.reduce((sum, c) => sum + brightness(c), 0) / cells.length;
  for (const species of TREE_SPECIES) {
    const prop = tree(species);
    const leaves = prop.cells.filter((c) => c.foliage);
    const top = Math.min(...leaves.map((c) => c.dy));
    const bottom = Math.max(...leaves.map((c) => c.dy));
    const third = (bottom - top) / 3;
    assert.ok(mean(leaves.filter((c) => c.dy < top + third)) > mean(leaves.filter((c) => c.dy > bottom - third)) * 1.2,
      `${species} crown top is lit`);
    const trunk = baseCells(prop).filter((c) => !c.foliage && !c.litter && c.dy > -6);
    // Moonlit bark is a pale cool grey, its letters heaviest toward the moon.
    const sum = (k) => trunk.reduce((total, c) => total + c[k], 0);
    if (species !== 'birch') assert.ok(sum('b') >= sum('r'), `${species} cool moonlit bark`);
    // Deeply shaded bark under a leafy cell must still choose a real glyph.
    for (let i = 0; i < 24; i++) {
      for (const growth of ['sapling', 'bush']) {
        const young = makeTree(i * 37.5, 300.5 + i, mulberry32(i + 1), { species, seed: 42, growth });
        assert.ok(young.cells.every((c) => realGlyph(c.g)),
          `${species} ${growth} ${i} glyphs`);
      }
    }
  }
});

test('nearby player reveal removes only local foliage behind the tree', () => {
  const prop = freezeTree(tree());
  let t = 0;
  while (t < 100 && Math.abs(treeWind(prop, t, 42)) > 0.4) t += 0.125;
  assert.ok(t < 100, 'fixture has a calm crown position');
  const baseline = recordProp(prop, VIEW, t);
  const foliage = prop.cells.filter((cell) => cell.foliage);
  const center = foliage[Math.floor(foliage.length / 2)];
  const bounds = { x: Math.floor(prop.x) + center.dx, y: Math.floor(prop.y) + center.dy, rx: 8, ry: 9 };
  const behind = { y: prop.y - 1, foliageBounds: bounds };
  const revealed = recordProp(prop, VIEW, t, behind);
  assert.ok(revealed.length < baseline.length, 'leaves reveal the nearby player');
  assert.ok(revealed.length > baseline.length - foliage.length, 'distant foliage stays opaque');
  const retained = new Set(revealed.map(([sx, sy]) => `${sx},${sy}`));
  for (let i = 0; i < baseline.length; i++) {
    const [sx, sy] = baseline[i];
    if (retained.has(`${sx},${sy}`)) continue;
    assert.equal(prop.cells[i].foliage, true, 'wood cannot be erased');
    assert.ok(((sx - bounds.x) / bounds.rx) ** 2 + ((sy - bounds.y) / bounds.ry) ** 2 < 1,
      'only cells inside the player bounds can be erased');
  }
  assert.deepEqual(recordProp(prop, VIEW, t, { y: prop.y + 1, foliageBounds: bounds }), baseline);
  assert.deepEqual(recordProp(prop, VIEW, t, { y: prop.y, foliageBounds: bounds }), baseline);
  assert.deepEqual(recordProp(prop, VIEW, t, {
    y: prop.y - 1, foliageBounds: { ...bounds, x: bounds.x + 1000 },
  }), baseline);
  assert.deepEqual(recordProp(prop, VIEW, t, behind), revealed, 'dither is repeatable');
  const shiftedView = { ...VIEW, x0: 7, y0: -3 };
  assert.deepEqual(worldCells(recordProp(prop, shiftedView, t, behind), shiftedView, true), revealed);
});

test('falling leaves are deterministic, capped, seasonal, and camera-stable', () => {
  const shiftedView = { ...VIEW, x0: 5, y0: 3 };
  for (const season of SEASONS) {
    for (const species of TREE_SPECIES) {
      const prop = freezeTree(tree(species, season));
      const original = structuredClone(prop);
      let emitted = 0;
      for (let t = 0; t <= 60; t += 0.5) {
        const cells = recordLeaves([prop], t);
        assert.deepEqual(recordLeaves([prop], t), cells, `${species} ${season} repeatability`);
        assert.ok(cells.length <= 2, 'at most two falling leaves per tree');
        assert.deepEqual(worldCells(recordLeaves([prop], t, shiftedView), shiftedView), cells);
        for (const [sx, sy, g, cr, cg, cb] of cells) {
          emitted++;
          assert.ok(Number.isInteger(sx) && Number.isInteger(sy));
          assert.ok(sy >= Math.floor(prop.y) + prop.top && sy < Math.floor(prop.y), 'leaf stays above ground');
          assert.ok([cr, cg, cb].every((color) => Number.isFinite(color) && color >= 0 && color <= 255));
          const fall = species === 'cherry' && season === 'spring' ? FALLING_PETALS : FALLING_LEAVES;
          assert.ok(fall.has(g), `${species} ${season} falling glyph`);
        }
      }
      if (season === 'winter' || EVERGREEN.has(species)) assert.equal(emitted, 0);
      else assert.ok(emitted > 0, `${species} ${season} produces leaves`);
      assert.deepEqual(prop, original, `${species} ${season} particle cache`);
    }
  }
  const grove = TREE_SPECIES.map((species, i) => freezeTree(tree(species, 'autumn', 70.5 + i * 60, 100.5)));
  const sort = (cells) => cells.map((cell) => JSON.stringify(cell)).sort();
  for (let t = 0; t <= 30; t += 0.5) {
    const cells = recordLeaves(grove, t);
    assert.ok(cells.length <= grove.length * 2);
    assert.deepEqual(sort(recordLeaves([...grove].reverse(), t)), sort(cells), 'particle order is independent of prop order');
  }
  assert.deepEqual(recordLeaves([{ kind: 'rock', x: 100, y: 100, cells: [] }], 5), []);
});

test('particle selection retains an offscreen tree whose falling leaf drifts into view', () => {
  const model = tree('oak', 'autumn');
  const narrow = {
    ...model, height: 9, top: -8,
    bounds: { minX: 0, maxX: 0, minY: -8, maxY: 0 },
    cells: [{ ...model.cells.find((cell) => cell.foliage), dx: 0, dy: -8 }],
  };
  let sample = null;
  for (let t = 0; t <= 240 && !sample; t += 0.125) {
    const cell = recordLeaves([narrow], t).find(([sx]) => Math.abs(sx - Math.floor(narrow.x)) >= 4);
    if (cell) sample = { t, cell };
  }
  assert.ok(sample, 'a sampled leaf drifts beyond normal sprite culling');
  const view = { x0: sample.cell[0], y0: sample.cell[1] - 1, cols: 1, rows: 3 };
  assert.equal(propInView(view, narrow), false, 'the tree sprite is outside the viewport');
  assert.equal(propInView(view, narrow, false, MAX_LEAF_DRIFT), true, 'leaf drift expands tree selection');
  const selected = [narrow].filter((prop) => propInView(view, prop, false, MAX_LEAF_DRIFT));
  assert.ok(recordLeaves(selected, sample.t, view).length > 0, 'the offscreen tree contributes a visible leaf');
});
