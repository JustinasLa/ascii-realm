import assert from 'node:assert/strict';
import test from 'node:test';
import { loadGame } from './helpers/main-game.js';

// Records what the frame hands the sky reflection and the sound.
async function load(query, options = {}) {
  const skies = [];
  const loaded = await loadGame(undefined, { href: `http://localhost/?debug&nogate${query}`, ...options,
    real: { drawSkyReflection: (r, view, t, sky) => skies.push(sky) } });
  const nights = [];
  loaded.game.sound.update = (...args) => nights.push(args[6]);
  return { ...loaded, skies, nights };
}

test('the world clock starts where the URL says and lights the frame by its sky', async () => {
  const { game, frame, skies, nights } = await load('&time=noon');
  assert.ok(Math.abs(game.dayClock.tick - 6000) < 1e-6);
  frame();
  const sky = skies.at(-1);
  assert.equal(sky, game.dayClock.state, 'one sky state, passed down');
  assert.equal(sky.sun, 1);
  assert.equal(game.renderer.sky, sky.grade);
  assert.ok(game.renderer.sky.gain[0] > 2);
  assert.equal(nights.at(-1), 0, 'the sound hears the day');
});

test('days pass with the world step and hold with a pinned frame', async () => {
  const fast = await load('&daylen=20&time=0');
  for (let i = 0; i < 60; i++) fast.frame(1 / 60);
  assert.ok(fast.game.dayClock.tick > 400, `${fast.game.dayClock.tick}`);
  const pinned = await load('&daylen=20&time=0&pintime=5');
  for (let i = 0; i < 60; i++) pinned.frame(1 / 60);
  assert.ok(Math.abs(pinned.game.dayClock.tick) < 1e-6);
});

test('a lobby shares the wall clock, and leaving it carries on solo', async () => {
  const { game, frame } = await load('&time=noon');
  game.multiplayer.room = { code: 'AB7K2D' };
  frame();
  assert.equal(game.dayClock.shared, true);
  const shared = game.dayClock.tick;
  game.multiplayer.room = null;
  frame();
  assert.equal(game.dayClock.shared, false);
  assert.ok(Math.abs(game.dayClock.tick - shared) < 5, 'no jump on leaving');
});
