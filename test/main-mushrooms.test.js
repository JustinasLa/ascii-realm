import assert from 'node:assert/strict';
import test from 'node:test';
import { loadGame } from './helpers/main-game.js';

test('E interacts once and is consumed while frozen or building', async () => {
  const { game, tap, frame } = await loadGame();
  let interactions = 0;
  game.mushrooms.interact = () => { interactions++; return true; };
  tap('KeyE'); frame(); frame();
  assert.equal(interactions, 1);
  game.freeze = true;
  tap('KeyE'); frame();
  game.freeze = false;
  frame();
  assert.equal(interactions, 1);
  game.builder.enabled = true;
  tap('KeyE'); frame();
  game.builder.enabled = false;
  frame();
  assert.equal(interactions, 1);
  tap('KeyE'); frame();
  assert.equal(interactions, 2);
});
