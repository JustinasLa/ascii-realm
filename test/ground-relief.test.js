import assert from 'node:assert/strict';
import { test } from 'node:test';
import { drawGround, drawRaisedRow, raisedRows } from '../src/world/ground.js';
import { HILL, hillRelief, MAX_LIFT } from '../src/world/relief.js';
import { CHUNK_SIZE, World } from '../src/world/world.js';

const UNSET = 255;

function renderer(view) {
  const n = view.cols * view.rows;
  return {
    cols: view.cols,
    rows: view.rows,
    fg: new Uint8ClampedArray(n * 4),
    bg: new Uint8ClampedArray(n * 4),
    ov: new Uint8ClampedArray(n * 4),
    cellLit: new Uint8Array(n * 4),
    mask: new Uint8Array(n).fill(UNSET),
    fineMark: new Uint8Array(n),
    motion: new Uint8Array(n * 4).fill(9),
    motionUsed: false,
    motionPass: 3,
    covered: [],
    overFine(cell, flag) { this.covered.push([cell, flag]); },
  };
}

// The hill world with every chunk round the knoll generated.
function knoll(scene) {
  const world = new World(1, { relief: 'hill', rivers: false });
  if (scene) world.relief = hillRelief(world.spawn, 1, scene);
  for (let cx = 0; cx <= 2; cx++) for (let cy = 0; cy <= 1; cy++) world.chunk(cx, cy);
  return world;
}

// A front-slope cell of the knoll: lifted, with lower ground in front.
function slopeCell(world, minDrop = 1) {
  for (let y = 40; y < 64; y++) {
    for (let x = 30; x < 120; x++) {
      const lift = world.liftAt(x, y);
      if (lift && lift - world.liftAt(x, y + 1) >= minDrop && x % CHUNK_SIZE > 0 && x % CHUNK_SIZE < 63) {
        return { x, y, lift, front: world.liftAt(x, y + 1) };
      }
    }
  }
  throw new Error('no slope');
}

const column = (r, sx) => Array.from({ length: r.rows }, (_, sy) => r.mask[sy * r.cols + sx] !== UNSET);

test('a raised cell draws its top its lift higher and the slope down to the cell in front', () => {
  const world = knoll();
  const { x, y, lift, front } = slopeCell(world);
  const view = { x0: x - 20, y0: y - 40, cols: 40, rows: 50 };
  const r = renderer(view);
  drawRaisedRow(r, world, view, y);
  const written = column(r, x - view.x0).flatMap((set, sy) => (set ? [sy] : []));
  const top = y - lift - view.y0;
  assert.deepEqual(written, Array.from({ length: lift - front + 1 }, (_, k) => top + k));
  assert.ok(written.at(-1) < y + 1 - front - view.y0, 'never reaches the top of the cell in front');
  // The top shows the cell's own ground letter, as the flat pass does.
  const flat = renderer(view);
  drawGround(flat, world, view, 0, null, 0, true);
  const at = (buf, sy, sx = x - view.x0) => buf[(sy * view.cols + sx) * 4 + 3];
  const own = (y - view.y0);
  assert.equal(at(r.fg, top), at(flat.fg, own));
  assert.equal(r.mask[top * view.cols + x - view.x0], world.typeAt(x, y));
  // The first slope row takes its neighbour's letter, so none repeats down it.
  assert.equal(at(r.fg, top + 1), at(flat.fg, own, x + 1 - view.x0));
});

test('raised ground hides the small letters of a sprite behind it', () => {
  const world = knoll();
  const { x, y, lift } = slopeCell(world);
  const view = { x0: x - 20, y0: y - 40, cols: 40, rows: 50 };
  const r = renderer(view);
  const cell = (y - lift - view.y0) * view.cols + x - view.x0;
  r.fineMark[cell] = 1;
  r.motionUsed = true;
  drawRaisedRow(r, world, view, y);
  assert.deepEqual(r.covered, [[cell, 0]]);
  assert.deepEqual([...r.motion.subarray(cell * 4, cell * 4 + 4)], [0, 0, 6, 0], 'no longer a moving sprite');
});

test('a steep drop shows earth below its first slope rows', () => {
  const world = knoll({ ...HILL, knoll: { ...HILL.knoll, height: 2, ry: 6 } });
  const { x, y, lift, front } = slopeCell(world, 3);
  const view = { x0: x - 20, y0: y - 40, cols: 40, rows: 50 };
  const r = renderer(view);
  drawRaisedRow(r, world, view, y);
  assert.equal(column(r, x - view.x0).filter(Boolean).length, lift - front + 1);
  // Each slope row is a neighbouring column's ground, dimmed for the first
  // two rows and tinted as earth below them.
  const flat = renderer(view);
  drawGround(flat, world, view, 0, null, 0, true);
  const top = y - lift - view.y0;
  let earth = 0;
  for (let k = 1; k <= lift - front; k++) {
    const tint = k <= 2 ? [0.8, 0.8, 0.8] : [0.62, 0.55, 0.48];
    const o = ((top + k) * view.cols + x - view.x0) * 4;
    const from = ((y - view.y0) * view.cols + x - view.x0 + (k & 1 ? 1 : -1)) * 4;
    for (let c = 0; c < 3; c++) {
      assert.ok(Math.abs(r.fg[o + c] - flat.fg[from + c] * tint[c]) <= 1, `row ${k}, channel ${c}`);
    }
    // Where the slope's own tint would miss by more than the rounding.
    if (k > 2 && [0, 1, 2].some((c) => flat.fg[from + c] * (0.8 - tint[c]) > 2)) earth++;
  }
  assert.ok(earth > 0, 'an earth row whose tint tells it from the slope');
});

test('rows above and below the view are clipped, and flat rows draw nothing', () => {
  const world = knoll();
  const { x, y, lift } = slopeCell(world);
  const high = { x0: x - 20, y0: y - lift + 1, cols: 40, rows: 3 };
  const r = renderer(high);
  drawRaisedRow(r, world, high, y);
  assert.ok(r.mask.some((m) => m !== UNSET));
  const flat = renderer(high);
  drawRaisedRow(flat, world, high, 5);
  assert.ok(flat.mask.every((m) => m === UNSET));
});

test('the painter gets one raised row for every lifted ground row that can show', () => {
  const world = knoll();
  const view = { x0: 0, y0: 0, cols: 160, rows: 40 };
  const rows = raisedRows(renderer(view), world, view);
  const ys = rows.map((row) => row.y);
  const lifted = [];
  for (let y = 0; y < view.rows + MAX_LIFT; y++) {
    if (Array.from({ length: view.cols }, (_, x) => world.liftAt(x, y)).some(Boolean)) lifted.push(y);
  }
  assert.deepEqual(ys, lifted);
  assert.ok(ys.at(-1) >= view.rows, 'rows below the view can be raised into it');
  const r = renderer(view);
  const drawn = raisedRows(r, world, view);
  for (const row of drawn) row.draw();
  assert.ok(r.mask.some((m) => m !== UNSET));
});
