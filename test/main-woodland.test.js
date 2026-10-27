import assert from 'node:assert/strict';
import test from 'node:test';
import { PENDING_LOBBY } from '../src/world/woodland.js';
import { loadGame } from './helpers/main-game.js';

test('the page address chooses the world\'s woods and flowers', async () => {
  const { game } = await loadGame(undefined, { href: 'http://localhost/?debug&woodland=dense&flora=0' });
  assert.equal(game.world.options.woodland, 'dense');
  assert.equal(game.world.options.flora, false);
  const plain = await loadGame(undefined, { href: 'http://localhost/?debug' });
  assert.equal(plain.game.world.options.woodland, 'sparse');
  assert.equal('flora' in plain.game.world.options, false);
});

test('a page starting in or on its way to a lobby plays the sparse world', async () => {
  for (const [href, session] of [
    ['http://localhost/?debug&woodland=dense&room=ABC234', new Map()],
    ['http://localhost/?debug&woodland=dense', new Map([['ascii-realm-rejoin', 'ABC234']])],
    ['http://localhost/?debug&woodland=dense', new Map([[PENDING_LOBBY, '{"mode":"join","code":"ABC234"}']])],
  ]) {
    const { game } = await loadGame(undefined, { href, session });
    assert.equal(game.world.woodland, 'sparse', href);
  }
});

test('creating a lobby from dense woods reloads into the sparse world and creates it there', async () => {
  const session = new Map();
  const first = await loadGame(undefined, { href: 'http://localhost/?debug&seed=5&woodland=dense', session });
  first.game.multiplayer.connect({ mode: 'create', name: 'Kael', seed: 5, code: '', server: '' });
  assert.deepEqual(first.game.multiplayer.connects, [], 'no connection from the dense page');
  const destination = new URL(first.navigatedTo());
  assert.equal(destination.searchParams.has('woodland'), false);
  assert.equal(destination.searchParams.get('seed'), '5');
  const second = await loadGame(undefined, { href: destination.href, session });
  assert.equal(second.game.world.woodland, 'sparse');
  assert.deepEqual(second.game.multiplayer.connects, [{ mode: 'create', name: 'Kael', seed: 5, code: '', server: '' }]);
  assert.equal(session.has(PENDING_LOBBY), false);
});

test('a dense page that somehow joins keeps its seat and reloads into the sparse world', async () => {
  const session = new Map();
  const { game, navigatedTo } = await loadGame(undefined, { href: 'http://localhost/?debug&woodland=dense', session });
  game.multiplayer.onJoin({ seed: 1, code: 'ABC234' });
  assert.equal(game.multiplayer.suspends, 1);
  assert.deepEqual(game.multiplayer.leaves, []);
  assert.equal(session.get('ascii-realm-rejoin'), 'ABC234');
  const destination = new URL(navigatedTo());
  assert.equal(destination.searchParams.has('woodland'), false);
  assert.equal(destination.searchParams.get('room'), 'ABC234');
  // A sparse page on the lobby's seed just plays on.
  const sparse = await loadGame(undefined, { href: 'http://localhost/?debug' });
  sparse.game.multiplayer.onJoin({ seed: 1, code: 'ABC234' });
  assert.equal(sparse.navigatedTo(), undefined);
  sparse.game.multiplayer.onJoin({ seed: 2, code: 'ABC234' });
  assert.deepEqual(sparse.game.multiplayer.leaves, [false]);
});
