import test from 'node:test';
import assert from 'node:assert/strict';
import { stroke, wheelCells, wrap } from '../src/spells/wheel-art.js';
import { sectorAt, WHEEL } from '../src/spells/radial.js';

const cw = 7.2, lh = 14, cols = 2 * Math.floor((WHEEL.outer + 20) / cw) + 1, rows = 2 * Math.floor((WHEEL.outer + 20) / lh) + 1;
const art = count => wheelCells({ count, inner: WHEEL.inner, outer: WHEEL.outer, cw, lh, cols, rows });
const text = grid => grid.map(row => row.map(cell => cell.ch || ' ').join('')).join('\n');

test('lines pick characters by slope and by where they cross the cell', () => {
  assert.equal(stroke(0, 0, -1, cw, lh), '-', 'a level line through the middle');
  assert.equal(stroke(5, 0, -1, cw, lh), '_', 'a level line low in the cell');
  assert.equal(stroke(-5, 0, -1, cw, lh), "'", 'a level line high in the cell');
  assert.equal(stroke(0, 1, 0, cw, lh), '|');
  const slant = Math.atan2(lh, cw);
  assert.equal(stroke(0, Math.sin(slant), Math.cos(slant), cw, lh), '/');
  assert.equal(stroke(0, Math.sin(slant), -Math.cos(slant), cw, lh), '\\');
  assert.equal(stroke(lh, 0, -1, cw, lh), '', 'a line a whole cell away misses');
});

test('the rims are unbroken and drawn in ASCII', () => {
  const grid = art(4);
  assert.match(text(grid), /^[ \-_.'|/\\+\n]*$/);
  // Every column the outer rim spans has a rim character above the hub.
  const centre = (cols - 1) / 2, span = Math.floor(WHEEL.outer / cw) - 1;
  for (let c = centre - span; c <= centre + span; c++) {
    assert.ok(grid.slice(0, (rows - 1) / 2).some(row => row[c].zone === 'line'), `column ${c} has a rim`);
  }
  for (const row of grid) assert.ok(row.filter(cell => cell.zone === 'line').length >= 2 || row.every(cell => cell.zone === 'out'));
});

test('cells agree with the pointer on which sector they belong to', () => {
  for (const count of [1, 4, 14]) {
    const grid = art(count);
    grid.forEach((row, r) => row.forEach((cell, c) => {
      if (cell.zone !== 'ring') return;
      const dx = (c - (cols - 1) / 2) * cw, dy = (r - (rows - 1) / 2) * lh;
      assert.equal(cell.sectors[0], sectorAt(dx, dy, count), `${count} sectors at ${r},${c}`);
    }));
  }
});

test('spokes divide the sectors and meet the rims in a +', () => {
  assert.ok(!text(art(1)).includes('+'), 'one sector has no spokes');
  for (const count of [4, 8, 14]) {
    const joins = new Set(art(count).flat().filter(cell => cell.ch === '+').map(cell => cell.sectors[0]));
    assert.equal(joins.size, count, `every one of ${count} spokes meets a rim`);
  }
  const spoke = art(4).flat().find(cell => cell.zone === 'line' && cell.sectors.length === 2);
  assert.ok(spoke.sectors.every(s => s >= 0 && s < 4));
});

test('labels wrap on words and split only words too long for a line', () => {
  assert.deepEqual(wrap('Blessing of Swiftness', 12), ['Blessing of', 'Swiftness']);
  assert.deepEqual(wrap('Hailpiercer', 8), ['Hailpier', 'cer']);
  assert.deepEqual(wrap('', 8), []);
});
