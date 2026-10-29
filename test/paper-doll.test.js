import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EQUIPMENT_SLOTS } from '../src/inventory/items.js';
import { DOLL_BOXES, DOLL_COLUMNS, DOLL_ROWS, dollArea } from '../src/ui/paper-doll.js';

test('every equipment slot has one box on the doll, and no box is for an unknown slot', () => {
  assert.deepEqual(Object.keys(DOLL_BOXES).sort(), [...EQUIPMENT_SLOTS].sort());
  assert.ok(Object.isFrozen(DOLL_BOXES));
  for (const box of Object.values(DOLL_BOXES)) assert.ok(Object.isFrozen(box));
});

test('the boxes lie inside the 8 × 7 grid and never share a cell', () => {
  assert.equal(DOLL_COLUMNS, 8);
  assert.equal(DOLL_ROWS, 7);
  const cells = new Map();
  for (const [slot, { column, row, width, height }] of Object.entries(DOLL_BOXES)) {
    assert.ok(column >= 1 && column + width - 1 <= DOLL_COLUMNS, slot);
    assert.ok(row >= 1 && row + height - 1 <= DOLL_ROWS, slot);
    for (let x = column; x < column + width; x++) {
      for (let y = row; y < row + height; y++) {
        assert.equal(cells.get(`${x},${y}`), undefined, `${slot} overlaps ${cells.get(`${x},${y}`)}`);
        cells.set(`${x},${y}`, slot);
      }
    }
  }
});

test('the boxes have the reference shapes, and the five small ones are flagged', () => {
  const shape = (slot) => [DOLL_BOXES[slot].width, DOLL_BOXES[slot].height];
  for (const slot of ['mainHand', 'offHand']) assert.deepEqual(shape(slot), [2, 4]);
  assert.deepEqual(shape('chest'), [2, 3]);
  for (const slot of ['helm', 'legs', 'hands', 'feet']) assert.deepEqual(shape(slot), [2, 2]);
  const small = Object.keys(DOLL_BOXES).filter((slot) => DOLL_BOXES[slot].small);
  assert.deepEqual(small.sort(), ['amulet', 'cape', 'quiver', 'ringLeft', 'ringRight']);
  for (const slot of small) assert.deepEqual(shape(slot), [1, 1]);
});

test('the five columns: weapon and gloves, quiver and ring, helmet body legs, amulet cloak ring, shield and boots', () => {
  const place = (slot) => [DOLL_BOXES[slot].column, DOLL_BOXES[slot].row];
  assert.deepEqual(place('mainHand'), [1, 1]);
  assert.deepEqual(place('hands'), [1, 5]);
  assert.deepEqual(place('quiver'), [3, 2]);
  assert.deepEqual(place('ringLeft'), [3, 4]);
  assert.deepEqual(place('helm'), [4, 1]);
  assert.deepEqual(place('chest'), [4, 3]);
  assert.deepEqual(place('legs'), [4, 6]);
  assert.deepEqual(place('amulet'), [6, 2]);
  assert.deepEqual(place('cape'), [6, 3]);
  assert.deepEqual(place('ringRight'), [6, 4]);
  assert.deepEqual(place('offHand'), [7, 1]);
  assert.deepEqual(place('feet'), [7, 5]);
});

test('dollArea gives the CSS grid area, and the labels are the reference words', () => {
  assert.equal(dollArea('chest'), '3 / 4 / 6 / 6');
  assert.equal(dollArea('quiver'), '2 / 3 / 3 / 4');
  assert.equal(dollArea('mainHand'), '1 / 1 / 5 / 3');
  assert.deepEqual(['mainHand', 'offHand', 'helm', 'chest', 'legs', 'hands', 'feet', 'cape', 'amulet', 'ringLeft',
    'ringRight', 'quiver'].map((slot) => DOLL_BOXES[slot].label),
  ['weapon', 'shield', 'helmet', 'body', 'legs', 'gloves', 'boots', 'cloak', 'amulet', 'ring', 'ring', 'quiver']);
});
