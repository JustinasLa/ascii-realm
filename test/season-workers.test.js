import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mulberry32 } from '../src/core/rng.js';
import { adoptFine, bakeFine, dropRebake, fineBaked, fineOf, fineWorkers, packFine, rebake, startFineWorkers, unpackCells }
  from '../src/world/fine-bakes.js';
import { fineSource, withFine } from '../src/world/prop-art.js';
import { bakeWhole } from '../src/world/props.js';
import { Seasons } from '../src/world/season-turn.js';
import { makeTree } from '../src/world/trees.js';

// Stand-in workers that run the real fine-worker.js in this thread, one
// message at a time when a test says so.
const workers = [];
let current = null;
globalThis.self = { postMessage: (data) => current.onmessage({ data }) };
await import('../src/world/fine-worker.js');
const onWorker = globalThis.self.onmessage;
globalThis.Worker = class {
  constructor() {
    this.inbox = [];
    workers.push(this);
  }

  postMessage(data) { this.inbox.push(data); }
  terminate() { this.terminated = true; }
};
// Answers the oldest message each worker holds.
function work(times = 1) {
  for (let i = 0; i < times; i++) {
    for (const worker of workers) {
      const data = worker.inbox.shift();
      if (!data) continue;
      current = worker;
      onWorker({ data });
    }
  }
}
startFineWorkers(1);

const grow = (species, x, season = 'summer') =>
  makeTree(x, 4.5, mulberry32(x * 10), { species, season, seed: 2 });
const autumn = (prop) => ({ ...fineSource(prop), options: { ...fineSource(prop).options, season: 'autumn' } });

test('a worker makes a tree again in full, as the main thread would', () => {
  assert.equal(fineWorkers(), 1);
  const prop = grow('oak', 10.5);
  const handle = rebake(autumn(prop));
  assert.equal(handle.result, null);
  work();
  const expected = bakeWhole(autumn(prop));
  assert.deepEqual(unpackCells(handle.result.cells), unpackCells(expected.cells));
  assert.deepEqual(handle.result, { ...expected });
});

test('the workers take fine bakes in view, then trees turning in view, then the rest', () => {
  const [busy, aside, unseen, seen, inView] = ['oak', 'birch', 'willow', 'cherry', 'pine']
    .map((species, i) => grow(species, 20.5 + i * 8));
  fineOf(busy, true);
  fineOf(aside);
  const later = rebake(autumn(unseen));
  const soon = rebake(autumn(seen), true);
  fineOf(inView, true);
  work();
  assert.ok(fineBaked(busy));
  work();
  assert.ok(fineBaked(inView), 'a fine bake in view first');
  work();
  assert.ok(soon.result && !later.result, 'then a turning tree in view');
  work();
  assert.ok(later.result && !fineBaked(aside));
  work();
  assert.ok(fineBaked(aside));
});

test('a tree whose old bake is still on its way keeps the bake it was given', () => {
  const prop = grow('oak', 70.5);
  fineOf(prop, true);
  const given = packFine([]);
  adoptFine(prop, given);
  work();
  assert.equal(fineOf(prop).cells, given);
  const dropped = rebake(autumn(prop));
  dropRebake(dropped);
  work();
  assert.equal(dropped.result, null, 'a dropped re-bake never lands');
});

test('a re-bake no worker can make fails, is tried once more, and the tree keeps its look', () => {
  const notes = [];
  const info = console.info;
  console.info = (text) => notes.push(text);
  try {
    const broken = rebake(null);
    work();
    assert.equal(broken.failed, true);
    const prop = grow('oak', 80.5);
    const world = { season: 'summer', measureProp() {} };
    const seasons = new Seasons(world);
    const real = fineSource(prop);
    real.x = { valueOf() { throw new Error('no such tree'); } };
    seasons.update([prop], 27, 23999, 0);
    work();
    seasons.update([prop], 27, 23999, 0);
    assert.equal(seasons.pending, 1, 'asked once more');
    work();
    seasons.update([prop], 27, 23999, 0);
    assert.equal(seasons.pending, 0);
    assert.equal(seasons.failed, 1);
    assert.equal(prop.season, 'summer');
    assert.equal(notes.length, 1);
  } finally {
    console.info = info;
  }
});

test('a fine bake a worker cannot make is left to the main thread', () => {
  const prop = withFine({ cells: [] }, function* () { return []; }, { make: 'tree', x: { valueOf() { throw new Error(); } } });
  fineOf(prop);
  work();
  assert.equal(fineOf(prop), null);
  bakeFine();
  assert.equal(fineOf(prop).cells.n, 0);
});

test('finish lands every tree still being made, here and at once', () => {
  const world = { season: 'summer', measureProp() {} };
  const seasons = new Seasons(world);
  const trees = Array.from({ length: 30 }, (_, i) => grow('birch', 100.5 + i * 6));
  seasons.update(trees, 27, 23999, 0);
  assert.equal(seasons.pending, 24, 'at most 24 at once');
  work();
  seasons.finish();
  assert.equal(seasons.pending, 0);
  assert.equal(trees.filter((p) => p.season === 'autumn').length, 24);
  work(30);
});

test('a worker that stops leaves fine bakes to the main thread and fails re-bakes', () => {
  const prop = grow('oak', 400.5);
  const sent = rebake(autumn(prop));
  const waiting = rebake(autumn(grow('oak', 410.5)));
  const fine = grow('oak', 420.5);
  fineOf(fine);
  workers[0].onerror({ preventDefault() {} });
  assert.equal(workers[0].terminated, true);
  assert.equal(fineWorkers(), 0);
  assert.equal(sent.failed, true);
  assert.equal(waiting.failed, true);
  assert.equal(fineOf(fine), null);
});
