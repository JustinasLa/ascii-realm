import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { placeRuinScene, RUIN_CLEARING, RUIN_COURT, RUIN_PROPS } from '../src/editor/ruin-scene.js';
import { Scenery } from '../src/editor/scenery.js';
import { GRASS, STONE, WATER, World } from '../src/world/world.js';

let SceneryBuilder;
before(async () => {
  const previous = globalThis.window;
  globalThis.window = { addEventListener() {} };
  try {
    ({ SceneryBuilder } = await import('../src/editor/builder.js'));
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});

function fixture(seed = 42) {
  const world = new World(seed);
  return { world, scene: new Scenery(world) };
}

test('ruins merge at the camera, preserve distant edits, and undo/redo as one edit', () => {
  const { world, scene } = fixture();
  scene.place('crate', 400.5, 400.5, { seed: 99 });
  scene.paint(400.5, 400.5, 0, WATER);
  const before = scene.serialize();
  const { origin } = placeRuinScene(scene, { x: -0.2, y: 63.9 });
  assert.deepEqual(origin, { x: -0.5, y: 63.5 });
  assert.equal(world.addedProps.size, before.props.length + RUIN_PROPS.length);
  assert.equal(new Set(RUIN_PROPS.map(p => p.kind)).size, 9);
  assert.deepEqual(scene.serialize().props[0], before.props[0]);
  assert.equal(world.typeAt(400, 400), WATER);
  assert.ok(scene.counts.removed > 0, 'generated obstacles are cleared');
  const after = scene.serialize();
  assert.ok(scene.undo());
  assert.deepEqual(scene.serialize(), before);
  assert.ok(scene.redo());
  assert.deepEqual(scene.serialize(), after);
  const restored = fixture();
  restored.scene.load(JSON.parse(JSON.stringify(after)));
  assert.deepEqual(restored.scene.serialize(), after);
  for (const prop of world.addedProps.values()) {
    assert.deepEqual(restored.world.addedProps.get(prop.id).cells, prop.cells);
  }
});

test('preset variation is reproducible for the same seed and site', () => {
  const a = fixture(), b = fixture(), c = fixture(43);
  const centre = { x: 64.5, y: -64.5 };
  for (const { scene } of [a, b, c]) placeRuinScene(scene, centre);
  assert.deepEqual(a.scene.serialize(), b.scene.serialize());
  assert.notDeepEqual(a.scene.serialize().props.map(p => p.seed), c.scene.serialize().props.map(p => p.seed));
});

test('court, player-width gate route and side exits stay dry and walkable across seeds', () => {
  for (const seed of [1, 42, 221]) {
    const { world, scene } = fixture(seed);
    const { origin } = placeRuinScene(scene, { x: 0, y: 0 });
    const walk = (dx, dy) => {
      const x = origin.x + dx, y = origin.y + dy;
      assert.notEqual(world.typeAt(x, y), WATER, `water at ${dx},${dy}, seed ${seed}`);
      assert.equal(world.isWalkable(x, y), true, `blocked at ${dx},${dy}, seed ${seed}`);
    };
    for (let y = RUIN_COURT.minY; y <= RUIN_COURT.maxY; y++) {
      for (let x = RUIN_COURT.minX; x <= RUIN_COURT.maxX; x++) walk(x, y);
    }
    for (let y = RUIN_CLEARING.minY + 2; y <= RUIN_CLEARING.maxY - 2; y++) {
      for (const x of [-1.2, 0, 1.2]) walk(x, y);
    }
    // Side exits run above the rubble and below the tall column bases.
    for (let x = RUIN_CLEARING.minX + 2; x <= RUIN_CLEARING.maxX - 2; x++) walk(x, 8);
    const gate = [...world.addedProps.values()].find(p => p.kind === 'stone-gate');
    assert.equal(gate.collisionRects.length, 2);
    for (const rect of gate.collisionRects) {
      assert.equal(world.isWalkable(gate.x + (rect.minX + rect.maxX) / 2, gate.y), false);
    }
    assert.equal(world.typeAt(origin.x, origin.y), STONE);
    assert.equal(world.typeAt(origin.x + 65, origin.y - 50), GRASS);
  }
});

test('procedural deadwood reaching in from outside the clearing is removed', () => {
  const { scene, world } = fixture();
  const propsIn = world.propsIn.bind(world);
  const trunk = { id: 'p:1:0:39', x: RUIN_CLEARING.maxX + 5.5, y: 0.5,
    footW: 1, footH: 1, colliders: [{ ax: -12, ay: 0, bx: 0, by: 0, r: 1 }] };
  world.propsIn = (...args) => [...propsIn(...args), trunk];
  placeRuinScene(scene, { x: 0, y: 0 });
  assert.ok(world.removedProps.has(trunk.id));
});

test('overlapping authored props and invalid coordinates leave the scene and history intact', () => {
  const { scene } = fixture();
  scene.place('crate', 0.5, 0.5, { seed: 1 });
  const before = scene.serialize();
  assert.throws(() => placeRuinScene(scene, { x: 0, y: 0 }), /overlaps placed props/);
  for (const centre of [{ x: NaN, y: 0 }, { x: Infinity, y: 0 }, { x: 999999, y: 0 }]) {
    assert.throws(() => placeRuinScene(scene, centre), /world limits/);
  }
  assert.deepEqual(scene.serialize(), before);
  assert.ok(scene.undo());
  assert.equal(scene.canUndo, false, 'failed presets must not add history entries');
});

test('scene limits reject the entire preset without painting terrain or clearing props', () => {
  const { scene } = fixture();
  const data = scene.serialize();
  data.props = Array.from({ length: 240 }, (_, i) => ({
    id: `s:${i + 1}`, kind: 'crate', x: 400.5 + i * 4, y: 400.5, scale: 1, seed: i, variant: 1,
  }));
  scene.load(data);
  const before = scene.serialize();
  assert.throws(() => placeRuinScene(scene, { x: 0, y: 0 }), /editing limits/);
  assert.deepEqual(scene.serialize(), before);
  assert.ok(scene.undo());
  assert.equal(scene.canUndo, false);
});

function builderFixture() {
  const { world, scene } = fixture();
  const messages = [];
  const builder = Object.assign(Object.create(SceneryBuilder.prototype), {
    world, scene, camera: { x: 0.5, y: 0.5 }, stroke: null,
    ghost: {}, nextSeed: 1, resetCount: 0,
    canvas: { hasPointerCapture: () => false },
    setEnabled(value) { this.enabled = value; return true; },
    refresh(message) { messages.push(message); },
    onReset() { this.resetCount++; },
  });
  return { builder, messages };
}

test('builder preset closes a pending stroke and exposes one undoable preset', () => {
  const { builder, messages } = builderFixture();
  builder.scene.beginStroke();
  builder.stroke = { id: 1 };
  builder.scene.paint(400.5, 400.5, 0, WATER);
  const before = builder.scene.serialize();
  builder.addRuins();
  assert.equal(builder.enabled, true);
  assert.equal(builder.stroke, null);
  assert.equal(builder.ghost, null);
  assert.equal(builder.resetCount, 1);
  assert.match(messages.at(-1), /Added the column ruins/);
  assert.ok(builder.scene.undo());
  assert.deepEqual(builder.scene.serialize(), before);
  assert.ok(builder.scene.undo(), 'prior paint stroke stays separately undoable');
});

test('builder reports a blocked preset without clearing preview or resetting effects', () => {
  const { builder, messages } = builderFixture();
  builder.scene.place('crate', 0.5, 0.5, { seed: 1 });
  const ghost = builder.ghost;
  builder.addRuins();
  assert.match(messages.at(-1), /Pan to an empty area/);
  assert.equal(builder.ghost, ghost);
  assert.equal(builder.resetCount, 0);
  assert.equal(builder.scene.counts.props, 1);
});
