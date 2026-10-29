import assert from 'node:assert/strict';
import { test } from 'node:test';
import { liftView } from '../src/world/camera.js';
import { chunkLift, HILL, hillRelief, LIFT_PER_METRE, liftRows, MAX_LIFT, reliefLight } from '../src/world/relief.js';
import { CHUNK_SIZE, GRASS, SHORE, WATER, World } from '../src/world/world.js';

const hill = new World(1, { relief: 'hill', rivers: false });
const { x: sx0, y: sy0 } = hill.spawn;
const sx = Math.floor(sx0);
const sy = Math.floor(sy0);
const box = hill.relief;
// The ground is lifted as it is drawn, from its loaded chunks.
for (let cy = Math.floor((box.y0 - 1) / CHUNK_SIZE); cy <= Math.floor((box.y1 + 2) / CHUNK_SIZE); cy++) {
  for (let cx = Math.floor((box.x0 - 1) / CHUNK_SIZE); cx <= Math.floor((box.x1 + 1) / CHUNK_SIZE); cx++) hill.chunk(cx, cy);
}

function* cells() {
  for (let y = box.y0 - 1; y <= box.y1 + 1; y++) for (let x = box.x0 - 1; x <= box.x1 + 1; x++) yield [x, y];
}

test('a metre of height lifts the ground as far as it lifts a jumping character', () => {
  assert.ok(Math.abs(LIFT_PER_METRE - 11.26) < 0.01);
});

test('the hill scene raises a ridge north of spawn with lower meadow behind it', () => {
  assert.deepEqual(hill.spawn, { x: 0.5, y: 51.5 });
  const column = (dx) => Array.from({ length: 60 }, (_, k) => hill.liftAt(sx + dx, sy - 50 + k));
  assert.equal(Math.max(...column(0)), 18, 'the crest stands 1.6 m high');
  assert.equal(hill.liftAt(sx, sy - 6), 0, 'its foot');
  assert.equal(hill.liftAt(sx, sy - 40), 0, 'the meadow behind it');
  assert.equal(hill.liftAt(sx, sy), 0, 'spawn stays on flat ground');
  assert.equal(hill.liftAt(sx + HILL.ridge.x0 - 5, sy - 24), 0, 'west of its end');
  assert.equal(hill.liftAt(sx + HILL.ridge.x1 + 5, sy - 24), 0, 'east of its end');
  assert.equal(hill.liftAt(sx + 75, sy - 6), 11, 'the knoll top stands a metre high');
  assert.equal(hill.liftAt(sx + 75.9, sy - 5.2), 11, 'a position lifts as its cell');
});

test('every lift is in range, water is never raised and slopes are gentle', () => {
  let drop = 0;
  let water = 0;
  for (const [x, y] of cells()) {
    const lift = hill.liftAt(x, y);
    assert.ok(lift >= 0 && lift <= MAX_LIFT);
    const { c, i } = hill.locate(x, y);
    assert.equal(c.lift?.[i] ?? 0, lift, `chunk and field agree at ${x},${y}`);
    if (c.type[i] === WATER || c.type[i] === SHORE) {
      water++;
      assert.equal(lift, 0);
    }
    drop = Math.max(drop, lift - hill.liftAt(x, y + 1));
  }
  assert.ok(water > 0, 'the lake edge reaches the box');
  assert.ok(drop <= 2, `steepest drop ${drop}`);
});

test('the lift of ground no chunk is loaded for is none, and asking loads nothing', () => {
  const fresh = new World(1, { relief: 'hill', rivers: false });
  fresh.chunks.clear();
  assert.equal(fresh.liftAt(sx + 20, sy - 24), 0);
  assert.equal(fresh.chunks.size, 0);
  fresh.chunk(Math.floor((sx + 20) / CHUNK_SIZE), Math.floor((sy - 24) / CHUNK_SIZE));
  assert.equal(fresh.liftAt(sx + 20, sy - 24), hill.liftAt(sx + 20, sy - 24));
});

test('water and shore inside the relief stay flat for the ground and for whatever stands there', () => {
  // A relief a metre high over the whole box, lake edge and all.
  const wet = new World(1, { relief: 'hill', rivers: false });
  wet.relief.heightAt = () => 1;
  wet.chunks.clear();
  const lifts = { [WATER]: new Set(), [SHORE]: new Set(), [GRASS]: new Set() };
  for (const [x, y] of cells()) {
    const { c, i } = wet.locate(x, y);
    if (x < box.x0 || x > box.x1 || y < box.y0 || y > box.y1) continue;
    lifts[c.type[i]]?.add(wet.liftAt(x + 0.5, y + 0.5));
    assert.equal(wet.liftAt(x, y), c.lift[i]);
  }
  assert.deepEqual([...lifts[WATER]], [0]);
  assert.deepEqual([...lifts[SHORE]], [0]);
  assert.deepEqual([...lifts[GRASS]], [11]);
});

test('painting water on raised ground flattens it, and restoring the ground raises it again', () => {
  const edited = new World(1, { relief: 'hill', rivers: false });
  // A crest cell.
  const x = sx + 20;
  const y = sy - 50 + Array.from({ length: 60 }, (_, k) => hill.liftAt(x, sy - 50 + k)).indexOf(18);
  const { c, i } = edited.locate(x, y);
  const ly = Math.floor(i / CHUNK_SIZE);
  const row = () => Math.max(...c.lift.subarray(ly * CHUNK_SIZE, (ly + 1) * CHUNK_SIZE));
  assert.equal(edited.liftAt(x, y), 18);
  edited.setTerrain(x, y, WATER);
  assert.equal(edited.liftAt(x, y), 0);
  assert.equal(c.liftRows[ly], row());
  // An edit replayed on a regenerated chunk keeps it flat too.
  edited.chunks.clear();
  assert.equal(edited.locate(x, y).c.lift[i], 0);
  edited.setTerrain(x, y, c.baseType[i]);
  assert.equal(edited.liftAt(x, y), 18);
  assert.equal(edited.locate(x, y).c.liftRows[ly], 18);
});

test('a chunk keeps the most any cell of each row is lifted', () => {
  const c = hill.chunk(0, 0);
  for (let ly = 0; ly < CHUNK_SIZE; ly++) {
    assert.equal(c.liftRows[ly], Math.max(...c.lift.subarray(ly * CHUNK_SIZE, (ly + 1) * CHUNK_SIZE)));
  }
  assert.equal(hill.chunk(0, 5).lift, null, 'chunks the relief misses carry none');
  assert.equal(hill.chunk(0, 5).liftRows, null);
  const started = performance.now();
  for (let k = 0; k < 20; k++) chunkLift(box, k % 5, 0, CHUNK_SIZE, c.type);
  const ms = (performance.now() - started) / 20;
  console.log(`chunkLift: ${ms.toFixed(3)} ms per chunk`);
  assert.ok(ms < 5, `${ms} ms per chunk`);
});

test('the flat world has no relief', () => {
  const flat = new World(1, { rivers: false });
  assert.equal(flat.relief, null);
  assert.equal(flat.maxLift, 0);
  assert.equal(flat.liftAt(sx + 20, sy - 24), 0);
  assert.equal(flat.chunk(0, 0).lift, null);
  assert.equal(flat.propsOf(1, 0).some((p) => p.id.startsWith('h:')), false);
});

test('the scene props stand on the hill once, on bare ground, outside the builder edits', () => {
  const ids = [];
  for (let cx = -2; cx <= 6; cx++) for (let cy = 0; cy <= 1; cy++) {
    for (const p of hill.propsOf(cx, cy)) if (p.id.startsWith('h:')) ids.push(p.id);
  }
  assert.deepEqual(ids.sort(), ['h:0', 'h:1', 'h:2']);
  const tree = box.props[0];
  assert.equal(tree.kind, 'tree');
  assert.deepEqual([tree.x, tree.y], [sx + 75.5, sy - 7.5]);
  const { c, i } = hill.locate(Math.floor(tree.x), Math.floor(tree.y));
  assert.equal(c.grassHeight[i], 0, 'no grass grows through the trunk');
  assert.equal(hill.addedProps.size, 0);
});

test('outside its box a relief lifts nothing and misses whole chunks', () => {
  const relief = hillRelief({ x: 0.5, y: 0.5 }, 3);
  assert.equal(liftRows(relief, relief.x1 + 1, 0), 0);
  assert.equal(liftRows(relief, 0, relief.y0 - 1), 0);
  assert.equal(chunkLift(relief, 20, 0, CHUNK_SIZE, new Uint8Array(CHUNK_SIZE ** 2)), null);
  assert.equal(chunkLift(relief, 0, 3, CHUNK_SIZE, new Uint8Array(CHUNK_SIZE ** 2)), null);
});

test('higher ground catches more moonlight and a slope facing the viewer less', () => {
  assert.equal(reliefLight(0, 0), 1);
  assert.ok(reliefLight(18, 18) > 1.2);
  assert.ok(reliefLight(9, 7) < 1);
  assert.ok(reliefLight(9, 12) > reliefLight(9, 9) - 1e-9);
});

test('a lifted view moves everything drawn through it up by whole rows', () => {
  const view = { x0: 4, y0: 10, cols: 80, rows: 60, offX: 1, offY: 2 };
  assert.equal(liftView(view, 0), view, 'flat ground keeps the view itself');
  assert.deepEqual(liftView(view, 4), { ...view, y0: 14 });
});
