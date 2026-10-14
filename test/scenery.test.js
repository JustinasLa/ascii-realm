import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Scenery } from '../src/editor/scenery.js';
import { drawGround } from '../src/world/ground.js';
import { ASPECT, DIRT, GRASS, STONE, WATER, WATER_LEVEL, World } from '../src/world/world.js';
import { withLayers } from './helpers/renderer.js';

function fixture(seed = 42) {
  const world = new World(seed);
  return { world, scene: new Scenery(world) };
}

test('terrain brushes update rendered chunk arrays and restore original elevation', () => {
  const { world, scene } = fixture();
  const { x, y } = world.spawn;
  const { c, i } = world.locate(Math.floor(x), Math.floor(y));
  const originalElevation = c.elev[i];
  assert.equal(world.typeAt(x, y), GRASS);
  assert.equal(scene.paint(x, y, 0, WATER), 1);
  assert.equal(c.type[i], WATER);
  assert.ok(c.elev[i] < WATER_LEVEL);
  // Painted water is a knee-deep ford, like every lake.
  assert.equal(world.isWalkable(x, y), true);
  assert.ok(world.waterDepthAt(x, y) > 0);
  const renderer = withLayers({ cols: 1, rows: 1, mask: new Uint8Array(1), fg: new Float32Array(4), bg: new Float32Array(4) });
  drawGround(renderer, world, { x0: Math.floor(x), y0: Math.floor(y), rows: 1, cols: 1 }, 0, { x: -100, y: -100 });
  assert.equal(renderer.mask[0], WATER);
  assert.equal(scene.undo(), true);
  assert.equal(c.type[i], GRASS);
  assert.equal(c.elev[i], originalElevation);
  assert.equal(world.isWalkable(x, y), true);
  scene.redo();
  assert.equal(c.type[i], WATER);
});

test('brush circles use physical cell aspect across negative and positive chunk edges', () => {
  const { world, scene } = fixture();
  const centers = [[63.5, 63.5], [-0.5, -0.5]];
  scene.beginStroke();
  for (const [x, y] of centers) scene.paint(x, y, 2, DIRT);
  scene.endStroke();
  for (const [x, y] of centers) {
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const cx = Math.floor(x) + dx;
        const cy = Math.floor(y) + dy;
        if (Math.hypot(dx * ASPECT, dy) <= 2) assert.equal(world.typeAt(cx, cy), DIRT);
        else assert.equal(world.typeAt(cx, cy), world.originalTypeAt(cx, cy));
      }
    }
  }
  assert.equal(scene.undo(), true);
  assert.equal(scene.undo(), false, 'one stroke should produce one undo entry');
  assert.deepEqual(scene.counts, { terrain: 0, props: 0, removed: 0 });
});

test('scaled prop collision crosses chunk boundaries and erase undo restores it', () => {
  const { world, scene } = fixture();
  const prop = scene.place('rock', 65.5, 40.5, { scale: 3, seed: 19 });
  const x = prop.x - prop.footW * 0.75;
  const y = prop.y;
  assert.ok(x < 64);
  scene.paint(x, y, 0, DIRT);
  assert.ok(world.propsIn(x, y, x, y).some((p) => p.id === prop.id) || world.propsIn(x - prop.footW, y - 2, x + prop.footW, y + 2).some((p) => p.id === prop.id));
  assert.equal(world.isWalkable(x, y), false);
  assert.equal(scene.erase(prop.x, prop.y, 0), 1);
  assert.equal(world.isWalkable(x, y), true);
  scene.undo();
  assert.equal(world.isWalkable(x, y), false);
  scene.redo();
  assert.equal(world.isWalkable(x, y), true);
});

test('procedural props keep their original seed identity regardless of paint and load order', () => {
  const { world, scene } = fixture();
  const original = world.propsOf(1, 1).slice();
  assert.ok(original.length > 1);
  const [kept, removed] = original;
  scene.paint(kept.x, kept.y, 0, WATER);
  assert.ok(world.propsOf(1, 1).includes(kept), 'terrain painting should preserve original props');
  scene.erase(removed.x, removed.y, 0);
  scene.place('bush', 130.5, 130.5, { scale: 1.25, seed: 27 });
  const saved = scene.serialize();
  const restored = fixture();
  restored.scene.load(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(restored.scene.serialize(), saved);
  const visible = restored.world.propsOf(1, 1);
  assert.deepEqual(visible.map((p) => p.id), original.filter((p) => p.id !== removed.id).map((p) => p.id));
  assert.deepEqual(visible.find((p) => p.id === kept.id).cells, kept.cells);
  assert.equal(restored.world.typeAt(kept.x, kept.y), WATER);
  assert.deepEqual(restored.world.propsOf(2, 2).find((p) => p.id.startsWith('s:')).cells, world.propsOf(2, 2).find((p) => p.id.startsWith('s:')).cells);
});

test('procedural props are queryable and erasable from their own chunk', () => {
  const { world, scene } = fixture();
  // Forest generation keeps every base inside the chunk that owns it.
  const prop = world.propsOf(-6, -6).find((p) => Math.floor(p.x / 64) === -6 && Math.floor(p.y / 64) === -6);
  assert.ok(prop, 'seed fixture should contain a procedural prop');
  assert.ok(world.propsIn(prop.x, prop.y, prop.x, prop.y).some((p) => p.id === prop.id));
  assert.equal(scene.erase(prop.x, prop.y, 0), 1);
  assert.ok(!world.propsOf(-6, -6).some((p) => p.id === prop.id));
  scene.undo();
  assert.ok(world.propsOf(-6, -6).some((p) => p.id === prop.id));
});

test('reset, grouped history, no-op edits, and branching redo preserve scene state', () => {
  const { world, scene } = fixture();
  const { x, y } = world.spawn;
  scene.beginStroke();
  scene.paint(x, y, 0, DIRT);
  scene.place('tree', x + 10, y + 10, { seed: 7 });
  scene.endStroke();
  const edited = scene.serialize();
  scene.undo();
  assert.equal(scene.canRedo, true);
  scene.paint(x, y, 0, GRASS);
  assert.equal(scene.canRedo, true, 'no-op changes must not invalidate redo');
  scene.redo();
  assert.deepEqual(scene.serialize(), edited);
  assert.equal(scene.reset(), true);
  assert.deepEqual(scene.counts, { terrain: 0, props: 0, removed: 0 });
  scene.undo();
  assert.deepEqual(scene.serialize(), edited);
  scene.undo();
  scene.paint(x, y, 0, STONE);
  assert.equal(scene.canRedo, false);
  assert.equal(scene.redo(), false);
});

test('invalid imports leave edits, caches, and history unchanged', () => {
  const { world, scene } = fixture();
  scene.place('rock', 10.5, 10.5, { seed: 9 });
  const saved = scene.serialize();
  const base = { version: 1, seed: 42, terrain: [], props: [], removed: [] };
  const invalid = [
    null,
    { ...base, version: 2 },
    { ...base, seed: 41 },
    { ...base, terrain: [{ x: NaN, y: 0, type: GRASS }] },
    { ...base, terrain: [{ x: 0.25, y: 0, type: GRASS }] },
    { ...base, terrain: [{ x: 0, y: 0, type: 99 }] },
    { ...base, terrain: [{ x: 0, y: 0, type: DIRT }, { x: 0, y: 0, type: WATER }] },
    { ...base, props: [{ id: 's:1', kind: 'dragon', x: 0, y: 0, scale: 1, seed: 1 }] },
    { ...base, props: [{ id: 's:9007199254740991', kind: 'tree', x: 0, y: 0, scale: 1, seed: 1 }] },
    { ...base, removed: ['s:1'] },
    { ...base, removed: ['p:0:0:40'] },
    { ...base, terrain: Array.from({ length: 129 }, (_, i) => ({ x: i * 64, y: 0, type: DIRT })) },
  ];
  const chunksBefore = world.chunks.size;
  for (const data of invalid) {
    assert.throws(() => scene.load(data));
    assert.deepEqual(scene.serialize(), saved);
    assert.equal(world.chunks.size, chunksBefore, 'invalid import should not generate sparse world chunks');
  }
  scene.undo();
  assert.equal(scene.canUndo, false, 'invalid imports should not consume history entries');
});

test('placements preserve imported props when IDs wrap and skip occupied IDs', () => {
  const { world, scene } = fixture();
  const props = [1, 3, 5, 1_000_000_000].map((id, i) => ({
    id: `s:${id}`, kind: 'rock', x: 10.5 + i * 20, y: 20.5, scale: 1, seed: i, variant: 1,
  }));
  scene.load({ version: 1, seed: world.seed, terrain: [], removed: [], props });
  const originals = structuredClone([...world.addedProps.values()]);
  const placed = Array.from({ length: 3 }, (_, i) => scene.place('flowers', 100.5 + i * 10, 40.5, { seed: 10 + i }));
  assert.deepEqual(placed.map((prop) => prop.id), ['s:2', 's:4', 's:6']);
  assert.equal(world.addedProps.size, 7);
  for (const original of originals) assert.deepEqual(world.addedProps.get(original.id), original);

  const saved = scene.serialize();
  scene.undo();
  assert.equal(world.addedProps.size, 6);
  scene.redo();
  assert.deepEqual(scene.serialize(), saved);
  scene.place('flowers', 130.5, 40.5, { seed: 13 });
  assert.equal(world.addedProps.size, 8);
  for (const original of originals) assert.deepEqual(world.addedProps.get(original.id), original);
});

test('invalid brush arguments are rejected without changing the scene', () => {
  const { scene } = fixture();
  const before = scene.serialize();
  assert.throws(() => scene.paint(0, 0, 25, DIRT));
  assert.throws(() => scene.paint(0, 0, -1, DIRT));
  assert.throws(() => scene.paint(0, 0, 1, 5));
  assert.throws(() => scene.paint(Infinity, 0, 1, DIRT));
  assert.throws(() => scene.place('tree', 0, 0, { scale: 4 }));
  assert.throws(() => scene.erase(0, 0, NaN));
  assert.deepEqual(scene.serialize(), before);
  assert.equal(scene.canUndo, false);
});
