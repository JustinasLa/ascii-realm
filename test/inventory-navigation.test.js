import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptySlotHint, InventoryScreen } from '../src/ui/inventory.js';

test('vertical bag navigation wraps within each column, including an incomplete last row', (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'getComputedStyle');
  let columns = 5;
  Object.defineProperty(globalThis, 'getComputedStyle', {
    configurable: true,
    value: () => ({ gridTemplateColumns: Array(columns).fill('50px').join(' ') }),
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'getComputedStyle', original);
    else delete globalThis.getComputedStyle;
  });

  const screen = Object.create(InventoryScreen.prototype);
  screen.bagGrid = {};
  screen.bagNodes = Array(24);
  screen._select = function (selection, focus) {
    assert.equal(focus, true);
    this.selection = selection;
  };
  const navigate = (index, code, expected) => {
    screen.selection = { source: 'bag', index };
    screen._navigate(code);
    assert.deepEqual(screen.selection, { source: 'bag', index: expected });
  };

  navigate(0, 'ArrowUp', 20);
  navigate(20, 'ArrowDown', 0);
  navigate(3, 'ArrowUp', 23);
  navigate(23, 'ArrowDown', 3);
  navigate(4, 'ArrowUp', 19);
  navigate(19, 'ArrowDown', 4);
  navigate(15, 'ArrowDown', 20);
  navigate(20, 'ArrowUp', 15);
  navigate(0, 'ArrowLeft', 23);
  navigate(23, 'ArrowRight', 0);

  columns = 6;
  navigate(0, 'ArrowUp', 18);
  navigate(18, 'ArrowDown', 0);
  navigate(5, 'ArrowUp', 23);
  navigate(23, 'ArrowDown', 5);
});

test('an empty equipment slot names no key on phones', () => {
  assert.equal(emptySlotHint(false), 'Select compatible gear in your bag, then press E to equip it.');
  assert.equal(emptySlotHint(false, true), 'Select compatible gear in your bag, then tap Equip.');
  assert.doesNotMatch(emptySlotHint(false, true), /press|\bE\b/);
  assert.equal(emptySlotHint(true, true), emptySlotHint(true));
});
