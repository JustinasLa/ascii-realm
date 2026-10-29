import assert from 'node:assert/strict';
import test from 'node:test';
import { loadGame } from './helpers/main-game.js';

test('the inventory drops a whole bag stack through the hunt collection', async () => {
  const { game } = await loadGame(undefined, { href: 'http://localhost/?debug&skeletons=0&goblins=0&trolls=0&elves=0&animals=0' });
  const calls = [];
  game.collection.drop = (player, index, count) => {
    calls.push([player === game.player, index, count]);
    return { ok: true, message: 'Dropped.' };
  };
  game.inventory.slots.fill(null);
  game.inventory.add('arrow', 30);
  game.inventory.add('rawIron', 6);
  assert.deepEqual(game.inventoryScreen.onDrop(1), { ok: true, message: 'Dropped.' });
  game.inventoryScreen.onDrop(0);
  game.inventoryScreen.onDrop(5);
  assert.deepEqual(calls, [[true, 1, 6], [true, 0, 30], [true, 5, 1]]);
});
