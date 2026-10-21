import assert from 'node:assert/strict';
import test from 'node:test';
import { RadialMenu, sectorAt, sectorPath, WHEEL } from '../src/spells/radial.js';

const mid = (WHEEL.inner + WHEEL.outer) / 2;
const schools = [
  { id: 'oseni', items: [{ id: 'fire-shard' }, { id: 'fire-rain' }, { id: 'fire-breath' }, { id: 'meteor' }] },
  { id: 'seithr', items: [{ id: 'ice-shard' }] },
  { id: 'cerrith', items: [] },
  { id: 'mitlan', items: [{ id: 'tide-shard' }, { id: 'maelstrom' }] },
];
const menu = () => { const m = new RadialMenu(); m.setGroups(schools); return m; };

test('sectors count clockwise from the top and ignore the hub', () => {
  assert.equal(sectorAt(0, -mid, 4), 0);
  assert.equal(sectorAt(mid, 0, 4), 1);
  assert.equal(sectorAt(0, mid, 4), 2);
  assert.equal(sectorAt(-mid, 0, 4), 3);
  assert.equal(sectorAt(-5, -mid, 4), 0, 'just left of the top is still the top sector');
  assert.equal(sectorAt(0, -10, 4), -1, 'the hub picks nothing');
  assert.equal(sectorAt(0, -WHEEL.outer * 3, 4), -1, 'far beyond the rim picks nothing');
  assert.equal(sectorAt(0, -mid, 0), -1);
  assert.match(sectorPath(0, 0, 10, 20, 0, 1), /^M.*A20 20 0 0 1 .*L.*A10 10 0 0 0 .*Z$/);
});

test('empty schools stay off the wheel', () => {
  const m = menu();
  assert.deepEqual(m.groups.map(g => g.id), ['oseni', 'seithr', 'mitlan']);
  assert.equal(new RadialMenu().open(), false, 'nothing to show without runes');
});

test('releasing on a school opens its runes, then a click binds one', () => {
  const m = menu();
  m.open();
  m.point(mid, 0);
  assert.equal(m.hovered.id, 'seithr');
  assert.deepEqual(m.release(), { type: 'group', group: schools[1] });
  assert.equal(m.isOpen, true);
  assert.equal(m.held, false);
  assert.equal(m.stage, 'items');
  const result = m.press(0, -mid);
  assert.equal(result.type, 'item');
  assert.equal(result.item.id, 'ice-shard');
  assert.equal(m.isOpen, false);
});

test('one held gesture: push out through a school, then release on a rune', () => {
  const m = menu();
  m.open();
  m.point(0, -mid);
  const entered = m.point(0, -(WHEEL.outer + WHEEL.flick + 1));
  assert.equal(entered.type, 'group');
  assert.equal(m.group.id, 'oseni');
  assert.equal(m.held, true, 'still held, so letting go chooses');
  m.point(0, mid);
  const result = m.release();
  assert.equal(result.item.id, 'fire-breath');
  assert.equal(m.isOpen, false);
});

test('a flick only opens a school after the pointer has been inside the wheel', () => {
  const m = menu();
  m.open();
  assert.equal(m.point(0, -(WHEEL.outer + 40)), null, 'a far press position is not a flick');
  assert.equal(m.stage, 'groups');
  m.point(0, -mid);
  assert.equal(m.point(0, -(WHEEL.outer + 40)).type, 'group');
});

test('a click while holding opens a school too', () => {
  const m = menu();
  m.open();
  assert.equal(m.press(-mid, 0).group.id, 'mitlan');
  assert.equal(m.held, true);
  m.point(0, -mid);
  assert.equal(m.release().item.id, 'tide-shard');
});

test('the hub goes back, letting go over nothing cancels', () => {
  const m = menu();
  m.open();
  m.point(0, 10);
  assert.deepEqual(m.release(), { type: 'close' });
  assert.equal(m.isOpen, false);

  m.open();
  m.press(mid, 0);
  assert.equal(m.stage, 'items');
  assert.deepEqual(m.press(0, 0), { type: 'back' });
  assert.equal(m.stage, 'groups');
  assert.equal(m.back().type, 'close', 'backing out of the schools closes the wheel');

  m.open(false);
  m.press(mid, 0);
  assert.deepEqual(m.press(0, -WHEEL.outer * 3), { type: 'close' }, 'clicking outside closes');
  assert.equal(m.release(), null, 'a closed wheel ignores a late release');
});

test('a school that loses its runes closes the open wheel', () => {
  const m = menu();
  m.open();
  m.press(mid, 0);
  m.setGroups(schools.filter(s => s.id !== 'seithr'));
  assert.equal(m.isOpen, false);
});
