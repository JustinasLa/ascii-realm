import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { test } from 'node:test';
import { bakeFine, fineBaked, fineOf, packCells, packFine, rebake, rebakeHere, unpackCells } from '../src/world/fine-bakes.js';
import { fineRecipe, fineSource, turnOf } from '../src/world/prop-art.js';
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

// Re-bakes that land only once `answer` is called, as a worker's would.
function answerLater(seasons) {
  rebakeHere(() => null);
  return () => { for (const job of seasons.jobs.values()) job.handle.result ??= bakeWhole(job.source); };
}

test('a tree in view dissolves into its new season over 2 s; one out of view turns at once', () => {
  try {
    const { world, trees } = scene();
    const seasons = new Seasons(world);
    const answer = answerLater(seasons);
    const seen = trees.at(-1);
    const visible = (p) => p === seen;
    seasons.update(trees, ...LAST_NIGHT_END, 10, { visible });
    assert.equal([...seasons.jobs.keys()][0], seen, 'the tree in view is asked for first');
    answer();
    for (let i = 0; i < 40 && seasons.pending; i++) seasons.update(trees, ...LAST_NIGHT_END, 10, { visible });
    assert.ok(trees.every((p) => p.season === 'autumn'));
    assert.equal(seasons.turning, 1);
    const turn = turnOf(seen);
    assert.deepEqual([turn.from, turn.at, turn.k], ['summer', 10, 0]);
    assert.ok(trees.filter((p) => p !== seen).every((p) => turnOf(p) === null));
    seasons.update(trees, ...LAST_NIGHT_END, 11, { visible });
    assert.equal(turn.k, 0.5);
    seasons.update(trees, ...LAST_NIGHT_END, 13, { visible });
    assert.equal(turn.k, 1);
    assert.equal(turnOf(seen), turn, 'kept while its old leaves are still falling');
    seasons.update(trees, ...LAST_NIGHT_END, 20.01, { visible });
    assert.equal(turnOf(seen), null);
    assert.equal(seasons.turning, 0);
    // Behind the play card a tree in view turns at once.
    const [other] = scene('summer', 8).trees;
    seasons.update([other], ...LAST_NIGHT_END, 0, { instant: true, visible: () => true });
    answer();
    seasons.update([other], ...LAST_NIGHT_END, 0, { instant: true, visible: () => true });
    assert.equal(other.season, 'autumn');
    assert.equal(turnOf(other), null);
  } finally {
    rebakeHere(null);
  }
});

test('while it dissolves a tree keeps the bounds of both crowns, then exactly its new ones', () => {
  try {
    const { world, trees } = scene();
    // A tree whose bare crown measures differently.
    const prop = trees.find((p) => !isDeepStrictEqual(p.bounds, rebuildProp(inSeason(fineSource(p), 'winter')).bounds));
    const seasons = new Seasons(world);
    const answer = answerLater(seasons);
    const old = { bounds: prop.bounds, top: prop.top, height: prop.height };
    // From summer straight to winter's bare crown.
    seasons.update([prop], 55, 23999, 0, { visible: () => true });
    answer();
    seasons.update([prop], 55, 23999, 0, { visible: () => true });
    const grown = rebuildProp(inSeason(fineSource(prop), 'winter'));
    const b = old.bounds, w = grown.bounds;
    assert.notDeepEqual(b, w);
    assert.deepEqual(prop.bounds, { minX: Math.min(b.minX, w.minX), maxX: Math.max(b.maxX, w.maxX),
      minY: Math.min(b.minY, w.minY), maxY: Math.max(b.maxY, w.maxY) });
    assert.equal(prop.top, Math.min(old.top, grown.top));
    assert.equal(prop.top + prop.height, Math.max(old.top + old.height, grown.top + grown.height));
    seasons.update([prop], 55, 23999, 11, { visible: () => true });
    assert.deepEqual([prop.bounds, prop.top, prop.height], [grown.bounds, grown.top, grown.height]);
  } finally {
    rebakeHere(null);
  }
});

test('a tree drawn in ordinary cells dissolves in them and takes its small letters when done', () => {
  try {
    const { world, trees } = scene();
    const [coarse, fine] = trees;
    fineOf(fine);
    bakeFine();
    const oldFine = fineBaked(fine);
    const seasons = new Seasons(world);
    const answer = answerLater(seasons);
    seasons.update([coarse, fine], ...LAST_NIGHT_END, 0, { visible: () => true });
    answer();
    for (let i = 0; i < 4; i++) seasons.update([coarse, fine], ...LAST_NIGHT_END, 0, { visible: () => true });
    assert.equal(turnOf(fine).fine, oldFine, 'fine to fine');
    assert.ok(fineBaked(fine) && fineBaked(fine) !== oldFine);
    const turn = turnOf(coarse);
    assert.equal(turn.fine, null);
    const { pending } = turn;
    assert.ok(pending);
    assert.equal(fineOf(coarse, true), null, 'no bake is asked for while it dissolves');
    seasons.update([coarse, fine], ...LAST_NIGHT_END, 1.5, { visible: () => true });
    assert.equal(fineBaked(coarse), null);
    seasons.update([coarse, fine], ...LAST_NIGHT_END, 2, { visible: () => true });
    assert.equal(fineBaked(coarse).cells, pending, 'adopted once the dissolve is done');
    assert.equal(turn.pending, null);
    // A turn cut short by another landing ends cleanly first.
    const again = new Seasons(world);
    const reply = answerLater(again);
    coarse.season = 'spring';
    again.update([coarse], 0, 0, 3, { visible: () => true });
    reply();
    again.update([coarse], 0, 0, 3, { visible: () => true });
    assert.equal(coarse.season, 'summer');
    assert.equal(turnOf(coarse).from, 'spring');
    again.finish();
    assert.equal(turnOf(coarse), null);
  } finally {
    rebakeHere(null);
  }
});

test('felled, burnt and burning trees, pins and a lobby being joined turn nothing', () => {
  try {
    const { world, props, trees } = scene();
    assert.ok(trees.every(seasonal));
    assert.ok(props.some((p) => p.kind === 'rock' && !seasonal(p)));
    const [chopped, burnt, burning, late] = trees;
    chopped.chopped = true;
    burnt.burnt = true;
    burning.burning = { progress: 0.5, heat: 1 };
    rebakeHere(bakeWhole);
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
    const answer = answerLater(seasons);
    seasons.update([late], 27, 23999, 0);
    assert.equal(seasons.pending, 1);
    late.chopped = true;
    answer();
    seasons.update([], 27, 23999, 0);
    assert.equal(seasons.pending, 0);
    assert.equal(late.season, 'summer');
  } finally {
    rebakeHere(null);
  }
});

test('a tree wanted back in its own season before it lands is left as it is', () => {
  try {
    const { world, trees } = scene();
    const [prop] = trees;
    const seasons = new Seasons(world);
    answerLater(seasons);
    const cells = prop.cells;
    seasons.update([prop], 27, 23999, 0);
    assert.equal(seasons.pending, 1);
    seasons.update([prop], 28, 0, 0, { shared: true });
    assert.equal(seasons.pending, 1, 'the realm wants autumn too: kept');
    seasons.update([prop], 0, 0, 0);
    assert.equal(seasons.pending, 0);
    assert.equal(prop.cells, cells);
  } finally {
    rebakeHere(null);
  }
});

test('landings stop for the frame once a millisecond has gone', () => {
  const now = performance.now;
  try {
    const { world, trees } = scene();
    const seasons = new Seasons(world);
    const answer = answerLater(seasons);
    const three = trees.slice(0, 3);
    seasons.update(three, 27, 23999, 0);
    answer();
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
