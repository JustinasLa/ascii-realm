import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Scenery } from '../src/editor/scenery.js';
import { bakeFine, fineBakesPending, fineOf, startFineWorkers } from '../src/world/fine-bakes.js';
import { fineSource, withFine } from '../src/world/prop-art.js';
import { World } from '../src/world/world.js';

test('loaded and undo-restored scenery keeps its fine bake', () => {
  const world = new World(42);
  const scene = new Scenery(world);
  const original = scene.place('rock', world.spawn.x, world.spawn.y, { scale: 0.25, seed: 7 });
  fineOf(original);
  bakeFine();
  const expected = fineOf(original).cells;
  const source = fineSource(original);
  const saved = scene.serialize();
  const checkRestored = () => {
    const prop = world.addedProps.get(original.id);
    assert.deepEqual(fineSource(prop), source);
    fineOf(prop);
    bakeFine();
    assert.deepEqual(fineOf(prop)?.cells, expected);
  };

  scene.load(saved);
  checkRestored();
  scene.reset();
  assert.equal(scene.undo(), true);
  checkRestored();
  assert.equal(scene.undo(), true);
  assert.equal(world.addedProps.size, 0);
  assert.equal(scene.redo(), true);
  checkRestored();
});

test('worker construction failure leaves queued bakes available to the main thread', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: class {
    constructor() { throw new Error('Workers blocked'); }
  } });
  try {
    const prop = withFine({ cells: [] }, function* () { return []; }, { make: 'test' });
    fineOf(prop);
    assert.equal(fineBakesPending(), true);
    startFineWorkers(1);
    assert.equal(fineBakesPending(), true);
    bakeFine();
    assert.equal(fineOf(prop)?.cells.n, 0);
    assert.equal(fineBakesPending(), false);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'Worker', previous);
    else delete globalThis.Worker;
  }
});
