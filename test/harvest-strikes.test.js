import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Combat } from '../src/entities/combat.js';

function advanceUntil(combat, finished) {
  const events = [];
  for (let frame = 0; frame < 1200; frame++) {
    if (finished()) return events;
    combat.update(1 / 120, false);
    events.push(...combat.events.splice(0));
  }
  assert.fail('combat did not reach the expected state');
}

test('one attack draws first and strikes once when the blade starts cutting', () => {
  const combat = new Combat();
  combat.attack();
  assert.equal(combat.move, 'draw');
  assert.deepEqual(combat.events, []);

  assert.deepEqual(advanceUntil(combat, () => combat.move === 'a'), []);
  assert.equal(combat.inHand, true);

  combat.update(0.11, false);
  assert.equal(combat.trailing, false);
  assert.deepEqual(combat.events, []);

  combat.update(1 / 120, false);
  assert.equal(combat.trailing, true);
  assert.deepEqual(combat.events.splice(0), [{ type: 'strike', swing: 'a' }]);
  assert.deepEqual(advanceUntil(combat, () => !combat.busy), []);
});

test('queued combo requests produce one strike for each actual swing', () => {
  const combat = new Combat();
  combat.inHand = true;
  combat.attack();
  for (let press = 0; press < 10; press++) combat.attack();
  assert.deepEqual(combat.events, []);

  const events = advanceUntil(combat, () => combat.move === 'b');
  assert.deepEqual(events, [{ type: 'strike', swing: 'a' }]);
  for (let press = 0; press < 10; press++) combat.attack();
  assert.deepEqual(combat.events, []);

  events.push(...advanceUntil(combat, () => combat.move === 'c'));
  events.push(...advanceUntil(combat, () => !combat.busy));
  assert.deepEqual(events, [
    { type: 'strike', swing: 'a' },
    { type: 'strike', swing: 'b' },
    { type: 'strike', swing: 'c' },
    { type: 'slam' },
  ]);

  // A later swing of the same type must get its own hit marker.
  combat.attack();
  assert.deepEqual(advanceUntil(combat, () => !combat.busy), [{ type: 'strike', swing: 'a' }]);
});

test('overhead strike keeps the slam at the end of the impact step', () => {
  const combat = new Combat();
  combat.inHand = true;
  combat.start('c');

  combat.update(0.18, false);
  assert.deepEqual(combat.events, []);
  combat.update(0.06, false);
  assert.deepEqual(combat.events.splice(0), [{ type: 'strike', swing: 'c' }]);
  combat.update(0.035, false);
  assert.deepEqual(combat.events, []);
  combat.update(0.035, false);
  assert.deepEqual(combat.events.splice(0), [{ type: 'slam' }]);
  assert.deepEqual(advanceUntil(combat, () => !combat.busy), []);
});

test('drawing, sheathing, and repeated requests during the draw emit no strike', () => {
  const combat = new Combat();
  combat.toggle();
  assert.deepEqual(advanceUntil(combat, () => !combat.busy), []);
  assert.equal(combat.inHand, true);
  combat.toggle();
  assert.deepEqual(advanceUntil(combat, () => !combat.busy), []);
  assert.equal(combat.inHand, false);

  combat.attack();
  for (let press = 0; press < 10; press++) combat.attack();
  assert.deepEqual(combat.events, []);
  assert.deepEqual(advanceUntil(combat, () => combat.move === 'a'), []);
  assert.deepEqual(advanceUntil(combat, () => !combat.busy), [{ type: 'strike', swing: 'a' }]);
});
