import assert from 'node:assert/strict';
import test from 'node:test';
import { toCells } from '../src/entities/monsters.js';
import { loadGame } from './helpers/main-game.js';

test('the game runs frames with a herd about, drawn once its figures arrive', async () => {
  const { game, frame, loadAnimalFigures } = await loadGame();
  const [dx, dy] = toCells(12, 0);
  game.animals.spawn('deer', { x: game.player.x + dx, y: game.player.y + dy, count: 3 });
  for (let i = 0; i < 10; i++) frame();
  assert.equal(game.animals.list.length, 3);
  assert.equal(game.animals.events.length, 0, 'their events are spent each frame');
  const seen = { updates: 0, rasterised: 0 };
  await loadAnimalFigures({
    update: (dt, list) => { seen.updates++; assert.equal(list, game.animals.list); },
    rasterise: (view, list) => {
      seen.rasterised++;
      return list.map((animal) => ({ animal, cells: [], contacts: [{ x: animal.x, y: animal.y }], depth: animal.y,
        shadow: [0.7, 0.25], base: 0 }));
    },
  });
  for (let i = 0; i < 5; i++) frame();
  assert.ok(seen.updates >= 5 && seen.rasterised >= 5);
  assert.ok(game.animalFigures, 'the figures are on the debug handle');
  // Paused, the animals keep still.
  game.freeze = true;
  const before = game.animals.list.map((a) => [a.x, a.y]);
  frame();
  assert.deepEqual(game.animals.list.map((a) => [a.x, a.y]), before);
});

test('a noise the player makes reaches the animals through the frame', async () => {
  const { game, frame } = await loadGame();
  const [dx] = toCells(10, 0);
  game.animals.spawn('deer', { x: game.player.x + dx, y: game.player.y, count: 1 });
  game.animals.calm();
  game.player.events.push({ type: 'strike', x: game.player.x, y: game.player.y, strength: 1 });
  frame();
  assert.equal(game.animals.list[0].state, 'flee');
});

test('?animals=0 leaves the land empty and never loads the figures', async () => {
  const { game, frame } = await loadGame({ x: 0, y: 0 }, { href: 'http://localhost/?debug&animals=0' });
  game.animals.spawn('rabbit', { x: game.player.x, y: game.player.y });
  frame();
  assert.equal(game.animals.enabled, false);
  assert.equal(game.animals.list.length, 0);
  assert.equal(game.animalFigures, undefined);
});

test('?deer and ?rabbits cap each kind', async () => {
  const { game } = await loadGame({ x: 0, y: 0 }, { href: 'http://localhost/?debug&deer=2&rabbits=0' });
  assert.deepEqual(game.animals.counts, { deer: 2, rabbit: 0 });
});
