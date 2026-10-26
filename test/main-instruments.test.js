import assert from 'node:assert/strict';
import test from 'node:test';
import { INSTRUMENT_IDS } from '../src/audio/instruments.js';
import { loadGame } from './helpers/main-game.js';

const carried = inventory => inventory.slots.filter(Boolean).map(stack => stack.id);

test('?instruments puts one of each instrument in the bag, unequipped and without notices', async () => {
  const { game } = await loadGame(undefined, { href: 'http://localhost/?debug&instruments&skeletons=0&goblins=0&trolls=0&elves=0&animals=0' });
  assert.deepEqual(carried(game.inventory), INSTRUMENT_IDS);
  assert.equal(game.inventory.equipment.offHand, null);
  assert.deepEqual(game.inventory.equipment.mainHand, { id: 'shortSword', count: 1 });
  assert.deepEqual(game.inventory.events, []);
  assert.deepEqual(game.inventory.hotbar.filter(Boolean), ['shortSword']);
});

test('without the query nothing hands instruments out', async () => {
  const { game } = await loadGame(undefined, { href: 'http://localhost/?debug&skeletons=0&goblins=0&trolls=0&elves=0&animals=0' });
  assert.deepEqual(carried(game.inventory), []);
});
