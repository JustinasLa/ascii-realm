import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { worldToScreen } from '../src/editor/coordinates.js';
import { Scenery } from '../src/editor/scenery.js';
import { Camera } from '../src/world/camera.js';
import { ASPECT, STONE, World } from '../src/world/world.js';

let SceneryBuilder;
before(async () => {
  const previousWindow = globalThis.window;
  globalThis.window = { addEventListener() {} };
  try {
    ({ SceneryBuilder } = await import('../src/editor/builder.js'));
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

function fixture(tool) {
  const world = new World(42);
  const captured = new Set();
  const rect = { left: 0, top: 0, width: 2000, height: 600 };
  const canvas = {
    width: rect.width,
    height: rect.height,
    getBoundingClientRect: () => rect,
    focus() {},
    setPointerCapture: (id) => captured.add(id),
    hasPointerCapture: (id) => captured.has(id),
    releasePointerCapture: (id) => captured.delete(id),
  };
  // At minimum zoom the stroke spans 1800 CSS pixels inside the canvas.
  const renderer = { canvas, cellW: 6 * ASPECT, cellH: 6 };
  const builder = Object.assign(Object.create(SceneryBuilder.prototype), {
    world,
    scene: new Scenery(world),
    canvas,
    renderer,
    camera: new Camera(250.5, 0.5),
    enabled: true,
    tool,
    radius: 1,
    stroke: null,
    refresh() {},
  });
  return builder;
}

function pointer(builder, x, y) {
  const point = worldToScreen(x, y, builder.canvas.getBoundingClientRect(),
    builder.renderer, builder.camera.view(builder.renderer));
  return { clientX: point.x, clientY: point.y, pointerId: 1,
    button: 0, buttons: 1, isPrimary: true, preventDefault() {} };
}

test('a long pointer movement paints a continuous narrow stroke with one undo entry', () => {
  const builder = fixture('stone');
  const { scene, world } = builder;
  const before = scene.serialize();
  builder.pointerDown(pointer(builder, 0.5, 0.5));
  builder.pointerMove(pointer(builder, 500.5, 0.5));
  for (let x = 0; x <= 500; x++) {
    assert.equal(world.typeAt(x, 0), STONE, `stroke left a gap at column ${x}`);
  }
  assert.equal(scene.canUndo, false, 'the stroke stays open until the pointer is released');
  builder.finishStroke();
  assert.equal(builder.canvas.hasPointerCapture(1), false);
  const painted = scene.serialize();
  assert.equal(scene.undo(), true);
  assert.deepEqual(scene.serialize(), before);
  assert.equal(scene.undo(), false, 'the whole stroke is a single history entry');
  assert.equal(scene.redo(), true);
  assert.deepEqual(scene.serialize(), painted);
});

test('a long eraser movement removes props between pointer events and undo restores them', () => {
  const builder = fixture('erase');
  const { scene, world } = builder;
  scene.beginStroke();
  for (let x = 2; x < 500; x += 5) scene.place('crate', x + 0.5, 0.5, { seed: x });
  scene.endStroke();
  const before = scene.serialize();
  builder.pointerDown(pointer(builder, 0.5, 0.5));
  builder.pointerMove(pointer(builder, 500.5, 0.5));
  builder.finishStroke();
  assert.equal(world.addedProps.size, 0, 'the eraser must reach every prop along the stroke');
  const erased = scene.serialize();
  assert.equal(scene.undo(), true);
  assert.deepEqual(scene.serialize(), before);
  assert.equal(scene.redo(), true);
  assert.deepEqual(scene.serialize(), erased);
});
