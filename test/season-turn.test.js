import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bakeFine, fineBaked, fineOf, packCells, packFine, rebake, rebakeHere, unpackCells } from '../src/world/fine-bakes.js';
import { fineRecipe, fineSource } from '../src/world/prop-art.js';
import { bakeWhole, finishRecipe, rebuildProp } from '../src/world/props.js';
import { Seasons, seasonal } from '../src/world/season-turn.js';
import { SEASONS } from '../src/world/seasons.js';
import { mulberry32 } from '../src/core/rng.js';
import { TREE_SPECIES, makeTree } from '../src/world/trees.js';
import { World } from '../src/world/world.js';

// A world, the props round its spawn, and a grove of every kind of tree
// grown in summer, as the land grows them.
function scene(season = 'summer', seed = 7) {
  const world = new World(seed, { season });
  const { x, y } = world.spawn;
  const props = world.propsIn(x - 120, y - 120, x + 120, y + 120);
  const rand = mulberry32(seed);
  const trees = TREE_SPECIES.map((species, i) => makeTree(x + i * 9.5, y + (i % 3) * 7.5, rand,
    { species, growth: ['mature', 'sapling', 'bush'][i % 3], seed }));
  return { world, props, trees };
}

const inSeason = (source, season) => ({ ...source, options: { ...source.options, season } });
const debris = () => ({ season: 'summer' });
const LAST_NIGHT_END = [27, 23999];
// Updates until every tree asked for has landed.
function settle(seasons, props, day, tick, options) {
  for (let i = 0; i < 400; i++) {
    seasons.update(props, day, tick, 0, options);
    if (!seasons.pending) return;
  }
}

test('a tree made again in another season is the tree grown in that season', () => {
  // Every kind of tree, each into a season of its own, so every season is
  // made again from every other.
  let n = 0;
  for (const species of TREE_SPECIES) for (const growth of ['mature', 'sapling', 'bush']) {
    const from = SEASONS[n % 4];
    const prop = makeTree(12.5, 30.5, mulberry32(n), { species, growth, season: from, seed: 5 });
    const key = `${species}:${growth}`;
    for (const season of [SEASONS[(++n + 1) % 4]]) {
      const source = inSeason(fineSource(prop), season);
      const grown = rebuildProp(source);
      const whole = bakeWhole(structuredClone(source));
      assert.equal(whole.season, season);
      assert.deepEqual(unpackCells(whole.cells), grown.cells, key);
      assert.deepEqual([whole.bounds, whole.top, whole.height, whole.leafColor],
        [grown.bounds, grown.top, grown.height, grown.leafColor]);
      assert.deepEqual(whole.fine, packFine(finishRecipe(fineRecipe(grown))));
    }
  }
});

test('packed cells come back as the same cells, gaps and flags included', () => {
  const tree = makeTree(4.5, 8.5, undefined, { species: 'oak', season: 'autumn', seed: 3 });
  const bush = makeTree(9.5, 2.5, undefined, { species: 'cherry', season: 'spring', growth: 'bush', seed: 3 });
  const sapling = makeTree(1.5, 1.5, undefined, { species: 'pine', season: 'winter', growth: 'sapling', seed: 3 });
  for (const prop of [tree, bush, sapling]) {
    assert.deepEqual(unpackCells(packCells(prop.cells)), prop.cells);
  }
  assert.ok(tree.cells.some((c) => c.litter) && tree.cells.some((c) => c.br === undefined));
  const odd = [{ dx: 1, dy: -2, g: 5, r: 1, gg: 2, b: 3, br: undefined, bgG: undefined, bb: undefined, foliage: undefined,
    flex: 0, phaseSin: 0, phaseCos: 1, rustle: 5, litter: false }];
  assert.deepEqual(unpackCells(packCells(odd)), odd);
});

test('the land grows the same trees in every season', () => {
  const ids = SEASONS.map((season) => scene(season).props.map((p) => `${p.id}:${p.kind}:${p.x}:${p.y}`).join());
  for (const list of ids) assert.equal(list, ids[0]);
});

test('on the season\'s last night the trees out of view turn, and the season begins at sunrise', () => {
  rebakeHere(bakeWhole);
  try {
    const { world, trees } = scene();
    const flotsam = debris();
    const seasons = new Seasons(world, { debris: flotsam });
    const measured = [];
    const measure = world.measureProp.bind(world);
    world.measureProp = (prop) => { measured.push(prop); measure(prop); };
    seasons.update(trees, 27, 11000, 0);
    assert.equal(seasons.pending, 0, 'nothing turns by day');
    for (const tick of [12000, 15000, 18000, 21000, 23999]) settle(seasons, trees, 27, tick);
    assert.equal(world.season, 'summer', 'the night before still belongs to summer');
    assert.equal(flotsam.season, 'summer');
    for (const prop of trees) {
      assert.equal(prop.season, 'autumn');
      const grown = rebuildProp(inSeason(fineSource(prop), 'autumn'));
      assert.deepEqual(prop.cells, grown.cells);
      assert.deepEqual([prop.bounds, prop.top, prop.height, prop.leafColor],
        [grown.bounds, grown.top, grown.height, grown.leafColor]);
      assert.equal(fineSource(prop).options.season, 'autumn', 'its later bakes are autumn ones');
      const fine = fineOf(prop);
      assert.ok(fine, 'its small letters landed with it');
      assert.deepEqual(packFine(finishRecipe(fineRecipe(prop))), fine.cells);
    }
    assert.equal(measured.length, trees.length);
    seasons.update(trees, 28, 0, 0);
    assert.equal(world.season, 'autumn');
    assert.equal(flotsam.season, 'autumn');
    assert.equal(seasons.name, 'autumn');
    assert.equal(seasons.dayOfSeason, 1);
  } finally {
    rebakeHere(null);
  }
});

test('a tree in view, directly or in the water, keeps its season until it leaves the view', () => {
  rebakeHere(bakeWhole);
  try {
    const { world, trees } = scene();
    const seasons = new Seasons(world);
    const [seen, ...rest] = trees;
    settle(seasons, trees, ...LAST_NIGHT_END, { visible: (p) => p === seen });
    assert.equal(seen.season, 'summer');
    assert.ok(rest.every((p) => p.season === 'autumn'));
    assert.equal(seasons.pending, 0, 'not even asked for');
    // One asked for out of view that comes into it by its new crown waits.
    const [other] = scene('summer', 8).trees;
    const old = other.bounds;
    seasons.update([other], ...LAST_NIGHT_END, 0, { visible: (p, b = p.bounds) => b !== old });
    assert.equal(other.season, 'summer');
    assert.equal(seasons.pending, 1);
    seasons.update([other], ...LAST_NIGHT_END, 0);
    assert.equal(other.season, 'autumn');
    // Behind the play card, a tree in view turns too.
    seasons.update([seen], ...LAST_NIGHT_END, 0, { instant: true, visible: () => true });
    assert.equal(seen.season, 'autumn');
  } finally {
    rebakeHere(null);
  }
});

test('felled, burnt and burning trees, pins and a lobby being joined turn nothing', () => {
  rebakeHere(bakeWhole);
  try {
    const { world, props, trees } = scene();
    assert.ok(trees.every(seasonal));
    assert.ok(props.some((p) => p.kind === 'rock' && !seasonal(p)));
    const [chopped, burnt, burning, late] = trees;
    chopped.chopped = true;
    burnt.burnt = true;
    burning.burning = { progress: 0.5, heat: 1 };
    const pinned = new Seasons(world, { pinned: 'summer', length: 3 });
    pinned.update(trees, 83, 23999, 0);
    assert.equal(world.season, 'summer');
    assert.equal(pinned.pending, 0);
    assert.equal(pinned.pinned, 'summer');
    assert.equal(pinned.length, 3);
    const held = new Seasons(world);
    held.update(trees, 60, 0, 0, { hold: true });
    assert.equal(world.season, 'summer', 'nothing at all while held');
    // Shared, a lobby's realm overrules the page's pin and length.
    pinned.update([chopped, burnt, burning], 60, 0, 0, { shared: true });
    assert.equal(world.season, 'winter');
    assert.equal(pinned.pinned, null);
    assert.equal(pinned.length, 28);
    assert.deepEqual([chopped, burnt, burning].map((p) => p.season), ['summer', 'summer', 'summer']);
    // A tree felled while it was being made again keeps its stump.
    const seasons = new Seasons(world);
    seasons.update([late], 27, 23999, 0, { visible: (p, b) => b !== undefined });
    assert.equal(seasons.pending, 1);
    late.chopped = true;
    seasons.update([], 27, 23999, 0);
    assert.equal(seasons.pending, 0);
    assert.equal(late.season, 'summer');
  } finally {
    rebakeHere(null);
  }
});

test('a tree wanted back in its own season before it lands is left as it is', () => {
  rebakeHere(bakeWhole);
  try {
    const { world, trees } = scene();
    const [prop] = trees;
    const seasons = new Seasons(world);
    const cells = prop.cells;
    seasons.update([prop], 27, 23999, 0, { visible: (p, b) => b !== undefined });
    assert.equal(seasons.pending, 1);
    seasons.update([prop], 28, 0, 0, { shared: true, visible: (p, b) => b !== undefined });
    assert.equal(seasons.pending, 1, 'the realm wants autumn too: kept');
    seasons.update([prop], 0, 0, 0, { visible: (p, b) => b !== undefined });
    assert.equal(seasons.pending, 0);
    seasons.update([prop], 0, 0, 0);
    assert.equal(prop.cells, cells);
  } finally {
    rebakeHere(null);
  }
});

test('a tree is landed only in the season the clock wants when it lands, in this frame\'s props or not', () => {
  rebakeHere(bakeWhole);
  try {
    const { world, trees } = scene();
    const [jumped, joined, shot, failed] = trees;
    const cells = trees.map((p) => p.cells);
    const seasons = new Seasons(world);
    const byNewCrown = { visible: (p, b) => b !== undefined };
    // A clock jump back to summer, with the tree out of the frame's props.
    seasons.update([jumped], 27, 23999, 0, byNewCrown);
    seasons.update([], 0, 0, 0);
    assert.equal(seasons.pending, 0);
    // A lobby's realm, in winter.
    seasons.update([joined], 27, 23999, 0, byNewCrown);
    seasons.update([], 60, 0, 0, { shared: true });
    assert.equal(seasons.pending, 0);
    // A scripted shot after a jump back.
    seasons.update([shot], 27, 23999, 0, byNewCrown);
    seasons.update([], 0, 0, 0, { visible: () => true });
    assert.equal(seasons.pending, 1);
    seasons.finish();
    // A job no worker made, no longer wanted: dropped, not kept back.
    seasons.update([failed], 27, 23999, 0, byNewCrown);
    seasons.jobs.get(failed).handle.failed = true;
    seasons.update([], 0, 0, 0);
    assert.equal(seasons.pending, 0);
    assert.equal(seasons.failed, 0);
    assert.deepEqual([jumped, joined, shot, failed].map((p) => p.season), ['summer', 'summer', 'summer', 'summer']);
    assert.deepEqual(trees.slice(0, 4).map((p) => p.cells), cells.slice(0, 4));
    seasons.update([failed], 27, 23999, 0);
    assert.equal(failed.season, 'autumn', 'and asked for again when wanted');
  } finally {
    rebakeHere(null);
  }
});

test('landings stop for the frame once a millisecond has gone', () => {
  rebakeHere(bakeWhole);
  const now = performance.now;
  try {
    const { world, trees } = scene();
    const seasons = new Seasons(world);
    const three = trees.slice(0, 3);
    seasons.update(three, 27, 23999, 0, { visible: (p, b) => b !== undefined });
    let clock = 0;
    performance.now = () => (clock += 2);
    seasons.update(three, 27, 23999, 0);
    assert.equal(seasons.pending, 2, 'one landing, the first always lands');
    seasons.update(three, 27, 23999, 0);
    seasons.update(three, 27, 23999, 0);
    assert.equal(seasons.pending, 0);
  } finally {
    performance.now = now;
    rebakeHere(null);
  }
});

test('without a worker a tree is never made here: it keeps its look while the season rolls', () => {
  const { world, trees } = scene();
  const notes = [];
  const info = console.info;
  console.info = (text) => notes.push(text);
  try {
    assert.equal(rebake(fineSource(trees[0])).failed, true);
    const seasons = new Seasons(world);
    seasons.update(trees, 27, 23999, 0);
    seasons.update(trees, 28, 0, 0);
    assert.equal(world.season, 'autumn');
    assert.ok(trees.every((p) => p.season === 'summer'));
    assert.equal(seasons.failed, trees.length);
    assert.equal(seasons.pending, 0, 'and not asked for again');
    assert.equal(notes.length, 1);
  } finally {
    console.info = info;
  }
});

test('a landed tree\'s fine bake is its own, and a later bake of it is of its new season', () => {
  rebakeHere(bakeWhole);
  try {
    const { world, trees } = scene();
    const [prop] = trees;
    fineOf(prop);
    const seasons = new Seasons(world);
    seasons.update([prop], 27, 23999, 0);
    bakeFine();
    assert.equal(fineOf(prop), fineBaked(prop), 'the old bake still queued never lands over it');
    // Cells replaced again (as a builder might) bake from the new source.
    prop.cells = [...prop.cells];
    assert.equal(fineBaked(prop), null);
    fineOf(prop);
    bakeFine();
    const grown = rebuildProp(inSeason(fineSource(prop), 'autumn'), true);
    assert.deepEqual(fineOf(prop).cells, packFine(finishRecipe(fineRecipe(grown))));
  } finally {
    rebakeHere(null);
  }
});
