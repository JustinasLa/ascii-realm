import assert from 'node:assert/strict';
import test from 'node:test';
import { loadGame } from './helpers/main-game.js';

// River debris runs with the frame: updated while the game runs, held while
// it is paused, drawn with its reflection and its foam, and never saved.
test('the frame drifts, draws and reflects the river debris', async () => {
  const { game, frame } = await loadGame();
  const debris = game.debris;
  assert.equal(debris.options.world, game.world);
  const piece = { y: game.player.y + 1 };
  debris.pieces.push(piece);
  game.grass.drawReflections = (r, w, v, t, mirror, list) => list.filter((d) => d.y === piece.y).forEach((d) => d.draw());
  game.grass.drawLayered = (r, w, v, t, list) => list.filter((d) => d.y === piece.y).forEach((d) => d.draw());
  debris.calls.length = 0;
  frame(0.05);
  const kinds = debris.calls.map(([kind]) => kind);
  assert.deepEqual(kinds, ['update', 'reflect', 'surface', 'draw']);
  assert.equal(debris.calls[1][1], piece);
  debris.calls.length = 0;
  game.freeze = true;
  frame(0.05);
  assert.ok(!debris.calls.some(([kind]) => kind === 'update'));
});

// The player and every risen monster wade into the debris, and the splashes
// of their knocks are heard.
test('the frame hands the debris its wading bodies and plays its splashes', async () => {
  const { game, frame } = await loadGame();
  const debris = game.debris;
  const monster = (state) => ({ state, kind: { id: 'skeleton' }, x: 0, y: 0, alive: true });
  const risen = monster('chase'), rising = monster('rise');
  game.monsters.living = [risen, rising];
  const played = [];
  game.sound.play = (e) => played.push(e);
  const splash = { type: 'splash', x: 1, y: 2, strength: 0.3 };
  debris.update = (dt, world, view, player, weather, splashes, bodies) => {
    debris.calls.push(['update', dt, bodies]);
    debris.events.push(splash);
  };
  debris.calls.length = 0;
  frame(0.05);
  // The list is built inside the game's own realm, so compare its members.
  assert.deepEqual([...debris.calls.find(([kind]) => kind === 'update')[2]], [game.player, risen]);
  assert.ok(played.includes(splash));
  assert.equal(debris.events.length, 0);
});
