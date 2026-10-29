import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { worldToScreen } from '../src/editor/coordinates.js';
import { Camera } from '../src/world/camera.js';
import { groundUnder } from '../src/world/relief.js';
import { ASPECT, CHUNK_SIZE, World } from '../src/world/world.js';

let SceneryBuilder;
before(async () => {
  globalThis.window ??= { addEventListener() {} };
  ({ SceneryBuilder } = await import('../src/editor/builder.js'));
});

// A builder over the hill scene, its camera on the knoll.
function hillBuilder() {
  const world = new World(1, { relief: 'hill', rivers: false });
  const rect = { left: 0, top: 0, width: 1200, height: 600 };
  const canvas = { width: rect.width, height: rect.height, getBoundingClientRect: () => rect };
  const renderer = { canvas, cellW: 6 * ASPECT, cellH: 6 };
  const cursor = { hidden: true, style: {} };
  const builder = Object.assign(Object.create(SceneryBuilder.prototype), {
    world, canvas, renderer, cursor, enabled: true, tool: 'grass', radius: 2,
    camera: new Camera(world.spawn.x + 75, world.spawn.y - 30),
  });
  globalThis.document = { elementFromPoint: () => canvas };
  return builder;
}

test('the ground under a row of the flat view is the nearest raised top or slope drawn there', () => {
  // A step 5 rows high from row 10 back.
  const liftAt = (x, y) => (y <= 10 ? 5 : 0);
  assert.equal(groundUnder(liftAt, 0, 5), 10, 'the step\'s top');
  assert.equal(groundUnder(liftAt, 0, 8), 10, 'its face');
  assert.equal(groundUnder(liftAt, 0, 12), 12, 'flat ground in front');
  assert.equal(groundUnder(liftAt, 0, 0), 5, 'raised ground behind the edge');
  assert.equal(groundUnder(() => 0, 3, 7), 7, 'flat land');
});

test('on raised ground the builder points at, and draws its cursor on, the ground drawn there', () => {
  const builder = hillBuilder();
  const { world, renderer } = builder;
  const view = builder.camera.view(renderer);
  const rect = builder.canvas.getBoundingClientRect();
  const x = Math.floor(world.spawn.x + 75) + 0.5;
  const y = Math.floor(world.spawn.y - 4) + 0.5;
  // Lift is read from the chunks drawn, so those round the knoll are loaded.
  const cx = Math.floor(x / CHUNK_SIZE);
  for (let cy = Math.floor(y / CHUNK_SIZE) - 1; cy <= Math.floor(y / CHUNK_SIZE) + 1; cy++) world.chunk(cx, cy);
  const lift = world.liftAt(x, y);
  assert.ok(lift > 5);
  // The knoll's top there is drawn `lift` rows up.
  const at = worldToScreen(x, y - lift, rect, renderer, view);
  const point = builder.worldPoint({ clientX: at.x, clientY: at.y + 1 }, view);
  assert.equal(Math.floor(point.x), Math.floor(x));
  assert.equal(Math.floor(point.y), Math.floor(y));
  builder.pointer = { clientX: at.x, clientY: at.y + 1 };
  builder.drawPreview(view);
  assert.equal(builder.cursor.hidden, false);
  assert.equal(builder.cursor.style.top, `${at.y}px`);
  // Flat land is read as it always was.
  world.relief = null;
  const flat = builder.worldPoint({ clientX: at.x, clientY: at.y + 1 }, view);
  assert.equal(Math.floor(flat.y), Math.floor(y - lift));
});
