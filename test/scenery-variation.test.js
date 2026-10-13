import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomSeed } from '../src/core/rng.js';
import { Scenery } from '../src/editor/scenery.js';
import { PROP_CATALOG } from '../src/world/prop-catalog.js';
import { createProp } from '../src/world/props.js';
import { World } from '../src/world/world.js';

test('repeated placements of every prop get distinct variations even when random seeds collide', () => {
  const scene = new Scenery(new World(42), { seedSource: () => 7 });
  for (const { kind } of PROP_CATALOG) {
    const props = Array.from({ length: 12 }, () => scene.place(kind, 20.5, 40.5));
    assert.equal(new Set(props.map((prop) => prop.seed)).size, props.length);
    assert.equal(new Set(props.map((prop) => JSON.stringify(prop.cells))).size, props.length, kind);
    assert.equal(new Set(props.map((prop) => `${prop.footW},${prop.footH}`)).size, props.length, kind);
  }
  assert.equal(new Set([...scene.world.addedProps.values()].map((prop) => prop.seed)).size, 180);
});

test('pending preview uses the placed variation, while seed selection avoids imported 32-bit aliases', () => {
  const scene = new Scenery(new World(42), { seedSource: () => 4294967295 });
  scene.place('rock', 1.5, 2.5, { seed: -1 });
  scene.place('rock', 1.5, 2.5, { seed: 4294967296 });
  const seed = scene.nextPropSeed();
  assert.equal(seed, 1, 'selection skips used unsigned aliases and wraps at 32 bits');
  assert.equal(scene.nextPropSeed(seed), seed, 'hovering keeps the same pending variation');
  const preview = createProp('rock', 0, 0, { seed, scale: 1.7 });
  const placed = scene.place('rock', 10.5, 20.5, { seed, scale: 1.7 });
  assert.deepEqual(placed.cells, preview.cells);
  assert.equal(placed.footW, preview.footW);
  assert.equal(placed.footH, preview.footH);
  assert.equal(scene.nextPropSeed(seed), 2, 'after placement the next variation is different');
});

test('randomized props retain their exact appearance through save, load, undo and redo', () => {
  const scene = new Scenery(new World(42), { seedSource: () => 80 });
  const original = Array.from({ length: 6 }, () => structuredClone(scene.place('rock', 20.5, 40.5)));
  const saved = JSON.parse(JSON.stringify(scene.serialize()));
  const restored = new Scenery(new World(42), { seedSource: () => 80 });
  restored.load(saved);
  assert.deepEqual([...restored.world.addedProps.values()], original);
  const additional = restored.place('rock', 20.5, 40.5);
  assert.equal(additional.seed, 86);
  assert.ok(original.every((prop) => JSON.stringify(prop.cells) !== JSON.stringify(additional.cells)));
  restored.undo();
  assert.deepEqual([...restored.world.addedProps.values()], original);
  restored.redo();
  assert.deepEqual(restored.world.addedProps.get(additional.id), additional);
});

test('older saved prop definitions keep their original shapes instead of acquiring new variations', () => {
  const scene = new Scenery(new World(42));
  const props = PROP_CATALOG.map(({ kind }, i) => ({
    id: `s:${i + 1}`, kind, x: i * 30 + 0.5, y: 40.5, scale: 1.5, seed: 42,
  }));
  scene.load({ version: 1, seed: 42, terrain: [], removed: [], props });
  for (const definition of props) {
    const loaded = scene.world.addedProps.get(definition.id);
    const legacy = createProp(definition.kind, definition.x, definition.y, { ...definition, variant: 0 });
    assert.equal(loaded.variant, 0);
    assert.deepEqual(loaded.cells, legacy.cells);
    assert.equal(loaded.footW, legacy.footW);
    assert.equal(loaded.footH, legacy.footH);
  }
  assert.ok(scene.serialize().props.every((prop) => prop.variant === 0));
  const oldRock = createProp('rock', 0, 0, { seed: 42, variant: 0 });
  assert.notDeepEqual(oldRock.cells, createProp('rock', 0, 0, { seed: 42 }).cells);
});

test('unsupported appearance versions cannot change a scene or its history', () => {
  const scene = new Scenery(new World(42));
  scene.place('rock', 20.5, 40.5);
  const before = scene.serialize();
  const invalid = structuredClone(before);
  invalid.props[0].variant = 2;
  assert.throws(() => scene.load(invalid), /variation version/);
  assert.throws(() => scene.place('rock', 0, 0, { variant: null }), /variation version/);
  assert.deepEqual(scene.serialize(), before);
  assert.equal(scene.undo(), true);
  assert.equal(scene.canUndo, false);
});

test('fresh prop seeds are valid unsigned 32-bit values', () => {
  for (let i = 0; i < 32; i++) {
    const seed = randomSeed();
    assert.ok(Number.isInteger(seed) && seed >= 0 && seed <= 4294967295);
  }
});
