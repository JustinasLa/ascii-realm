import assert from 'node:assert/strict';
import test from 'node:test';
import { Inventory } from '../src/inventory/inventory.js';
import { LABELS, lootLabels } from '../src/ui/loot-labels.js';

// One cell is a pixel across and down; everything is on screen but x < 0.
const project = (x, y) => ({ x, y, visible: x >= 0 });
const player = { x: 0, y: 0 };
let uid = 0;
const stack = (id, count, x, y) => ({ uid: `drop:${++uid}`, id, count, x, y });

test('each stack apart from the others is named on its own, with its count past one', () => {
  const inventory = new Inventory();
  const labels = lootLabels([stack('bone', 2, 10, 10), stack('arrow', 1, 10, 200), stack('bone', 0, 10, 400),
    stack('bone', 1, -5, 10)], player, inventory, project);
  assert.deepEqual(labels.map((l) => l.text), ['Bone x2', 'Arrow']);
  assert.deepEqual([labels[0].x, labels[0].y], [10, 10 - LABELS.lift]);
  assert.equal(labels[0].full, false);
  assert.equal(labels[0].count, 1);
  // Lifted toward the light: brighter than the item's own colour.
  assert.ok(labels[0].colour.every((c) => c >= 150), String(labels[0].colour));
});

test('stacks whose names would overlap share one label naming the first two and how many more', () => {
  const inventory = new Inventory();
  const far = 400;
  const labels = lootLabels([stack('bone', 2, far, 0), stack('arrow', 1, far + 2, 0), stack('ironIngot', 4, far + 4, 0),
    stack('bone', 1, far + 6, 0)], player, inventory, project);
  assert.equal(labels.length, 1);
  assert.equal(labels[0].text, 'Bone x2, Arrow x1 +2 more');
  assert.equal(labels[0].count, 4);
});

test('a label grown by a merge takes in the neighbours it now overlaps, so no two labels overlap', () => {
  const inventory = new Inventory();
  // Two bones apart on one row; the arrow merges with the second, and the
  // longer shared label would then reach over the first.
  const labels = lootLabels([stack('bone', 1, 200, 0), stack('bone', 1, 250, 0), stack('arrow', 1, 260, 0)],
    player, inventory, project);
  assert.equal(labels.length, 1);
  assert.equal(labels[0].text, 'Bone x1, Bone x1 +1 more');
  assert.equal(labels[0].count, 3);
  assert.deepEqual([labels[0].x, labels[0].y], [200, -LABELS.lift]);
});

test('a stack within 4 m is always named, even in a shared label', () => {
  const inventory = new Inventory();
  const labels = lootLabels([stack('bone', 2, 1, 0), stack('arrow', 1, 2, 0), stack('ironIngot', 4, 3, 0)],
    player, inventory, project);
  assert.equal(labels.length, 1);
  assert.equal(labels[0].text, 'Bone x2, Arrow x1, Iron Ingot x4');
});

test('thirty stacks in view leave none unaccounted for, past the cap of own labels', () => {
  const inventory = new Inventory();
  // Far apart and far off, so no two would overlap and none is near.
  const items = Array.from({ length: 30 }, (_, i) => stack('bone', 1, 200 + i * 300, 0));
  const labels = lootLabels(items, player, inventory, project);
  assert.equal(labels.length, LABELS.max);
  assert.equal(labels.reduce((n, l) => n + l.count, 0), 30);
  assert.ok(labels.some((l) => /\+\d+ more$/.test(l.text)));
});

test('a stack the bag has no room for shows its label dimmed', () => {
  const full = { spaceFor: () => 0 };
  assert.equal(lootLabels([stack('bone', 1, 10, 10)], player, full, project)[0].full, true);
  // A name cut to 24 characters; an unknown item shows its id.
  assert.equal(lootLabels([stack('mystery', 1, 10, 10)], player, full, project)[0].text, 'mystery');
});

test('coin is named by its value in its own gold, and never makes a label full', () => {
  const inventory = new Inventory({ starter: false });
  const [coin] = lootLabels([stack('denars', 73, 10, 10)], player, inventory, project);
  assert.equal(coin.text, '0.73d');
  assert.deepEqual(coin.colour, [179, 145, 34]);
  inventory.slots = inventory.slots.map(() => ({ id: 'longbow', count: 1 }));
  assert.equal(lootLabels([stack('denars', 73, 10, 10)], player, inventory, project)[0].full, false, 'coins alone');
  const [mixed] = lootLabels([stack('denars', 100, 10, 10), stack('bone', 1, 11, 10)], player, inventory, project);
  assert.equal(mixed.text, '1.00d, Bone x1');
  assert.equal(mixed.full, true, 'the bone has no room');
});
