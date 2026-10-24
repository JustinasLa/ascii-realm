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

// Enough of the panel for mode changes, on a builder built from the prototype.
function modeFixture(allowed) {
  const builder = fixture('stone');
  const node = () => ({ hidden: false, textContent: '', attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; } });
  Object.assign(builder, {
    allowed, enabled: false, player: { x: 0.5, y: 0.5 }, panel: { open: false },
    modeButton: node(), banner: node(), cursor: node(), modes: [], resets: 0,
    onModeChange(enabled) { this.modes.push(enabled); },
    onReset() { this.resets++; },
  });
  builder.canvas.style = {};
  return builder;
}

test('a phone can never enter building mode or change the scene', (t) => {
  const builder = modeFixture(() => false);
  const { scene } = builder;
  const before = JSON.stringify(scene.serialize());
  assert.equal(builder.setEnabled(true), false);
  const press = { code: 'KeyB', target: {}, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  builder.keydown(press);
  assert.equal(press.defaultPrevented, false, 'B is left alone');
  builder.edit(() => scene.paint(0.5, 0.5, 4, STONE), 'Painted.');
  builder.addRuins();
  builder.importScene({ version: 1, terrain: [[0, 0, STONE]], props: [] });
  const previousStorage = globalThis.localStorage;
  let reads = 0;
  globalThis.localStorage = { getItem: () => { reads++; return JSON.stringify(scene.serialize()); } };
  t.after(() => {
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
  });
  builder.load();
  assert.equal(reads, 0, 'the local scene is not even read');
  builder.enabled = true;
  builder.pointerDown(pointer(builder, 0.5, 0.5));
  assert.equal(builder.stroke, null, 'no stroke starts');
  builder.enabled = false;
  assert.equal(JSON.stringify(scene.serialize()), before);
  assert.equal(builder.enabled, false);
  assert.deepEqual(builder.modes, []);
  assert.equal(builder.resets, 0);
});

test('a builder without an allowed check still builds', () => {
  const builder = modeFixture(undefined);
  assert.equal(builder.setEnabled(true), true);
  assert.equal(builder.enabled, true);
  assert.equal(builder.panel.open, true);
  assert.equal(builder.modeButton.attributes['aria-pressed'], 'true');
  assert.equal(builder.canvas.style.touchAction, 'none');
});

test('forceExit leaves building mode even with no safe ground', () => {
  const builder = modeFixture(() => true);
  builder.setEnabled(true);
  builder.world = Object.assign(Object.create(builder.world), { isWalkable: () => false });
  builder.player = { x: 0.5, y: 0.5 };
  const before = JSON.stringify(builder.scene.serialize());
  assert.equal(builder.setEnabled(false), false, 'the normal exit refuses');
  assert.equal(builder.enabled, true);
  builder.forceExit();
  assert.equal(builder.enabled, false);
  assert.equal(builder.banner.hidden, true);
  assert.equal(builder.cursor.hidden, true);
  assert.equal(builder.canvas.style.touchAction, '');
  assert.equal(builder.modeButton.textContent, 'Start building');
  assert.deepEqual(builder.modes, [true, false]);
  assert.deepEqual(builder.player, { x: 0.5, y: 0.5 }, 'the player stays where they stand');
  assert.equal(JSON.stringify(builder.scene.serialize()), before);
  builder.forceExit();
  assert.deepEqual(builder.modes, [true, false], 'leaving twice does nothing');
});

test('forceExit uses the normal exit when there is safe ground', () => {
  const builder = modeFixture(() => true);
  builder.setEnabled(true);
  builder.forceExit();
  assert.equal(builder.enabled, false);
  assert.deepEqual(builder.modes, [true, false]);
});
