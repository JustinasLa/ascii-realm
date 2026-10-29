import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Grass } from '../src/world/grass.js';
import { CHUNK_SIZE, World } from '../src/world/world.js';

const world = new World(1, { relief: 'hill', rivers: false, meadow: true });
const relief = world.relief;
// Chunks take their lift when generated, so they are made with the relief on.
for (let cx = -1; cx <= 3; cx++) for (let cy = -1; cy <= 1; cy++) world.chunk(cx, cy);
const r = { cols: 120, rows: 60, put() {}, putBg() {}, setGlyph() {} };

// Every blade cell the row's roots write, by root column.
function row(y, view, { flat = false, reflected = false } = {}) {
  const cells = [];
  const write = (_r, sx, sy, g, cr, cg, cb) => cells.push({ sx, sy, cr, cg, cb });
  if (reflected) write.visible = () => true;
  world.relief = flat ? null : relief;
  new Grass().drawRow(r, world, view, 0, y, write);
  world.relief = relief;
  return cells;
}

// A knoll-top row: lifted 11 across its middle.
const y = Math.floor(world.spawn.y) - 6;
const view = { x0: 20, y0: y - 30, cols: 120, rows: 60 };

test('grass rooted on raised ground stands its lift higher', () => {
  const flat = row(y, view, { flat: true });
  const lifted = row(y, view);
  assert.ok(flat.length > 20);
  assert.equal(lifted.length, flat.length);
  const lift = flat.map((cell, k) => cell.sy - lifted[k].sy);
  assert.ok(lift.some((d) => d === 11), 'the knoll top lifts its blades 11 rows');
  assert.deepEqual(lifted.map((c) => c.sx), flat.map((c) => c.sx), 'only rows move');
});

test('reflections of grass stay where the water is', () => {
  const flat = row(y, view, { flat: true, reflected: true });
  const lifted = row(y, view, { reflected: true });
  assert.deepEqual(lifted.map((c) => c.sy), flat.map((c) => c.sy));
});

test('roots raised into the view from below it draw without reading past the contact field', () => {
  // The knoll's front rows lie below this view and are lifted into it.
  const high = { x0: 20, y0: y - 60, cols: 120, rows: 60 };
  const cells = row(y + 4, high);
  assert.ok(cells.some((c) => c.sy < high.rows), 'blades show in the view');
  assert.ok(cells.every((c) => Number.isFinite(c.cr) && Number.isFinite(c.cg) && Number.isFinite(c.cb)));
  // The row along a chunk's last row reads its front neighbour from the field.
  const edge = row(CHUNK_SIZE - 1, { x0: 20, y0: 0, cols: 120, rows: 60 });
  assert.ok(edge.every((c) => Number.isFinite(c.cr)));
});

test('the layered pass reaches the rows that can be raised into the view', () => {
  const grass = new Grass();
  const seen = [];
  grass.drawRow = (_r, _w, _v, _t, at) => seen.push(at);
  grass.drawLayered(r, world, view, 0, []);
  assert.equal(seen.at(-1), view.y0 + view.rows + 8 + world.maxLift - 1);
});
