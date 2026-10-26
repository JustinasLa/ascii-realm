import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { after, before, test } from 'node:test';
import { WebSocket } from 'ws';
import { Player } from '../src/entities/player.js';
import { playerState } from '../src/multiplayer/protocol.js';
import { createGameServer } from '../server/index.js';
import { create, join } from './helpers/lobby.js';

// Two lobbies serve every test, as building a lobby's world is the slow part.
let server;
before(async () => {
  const game = createGameServer();
  const { port } = await game.listen(0, '127.0.0.1');
  const host = await create(port, 42, 'Host');
  const elsewhere = await create(port, 43, 'Elsewhere');
  server = { game, port, code: host.lobby.code, host, elsewhere };
});
after(() => server.game.close());

// Ash and Bryn join the shared lobby for one test and leave after it.
async function pair(t) {
  const { port, code } = server;
  const peers = [];
  t.after(async () => {
    for (const who of peers) if (who.client.ws.readyState === WebSocket.OPEN) await who.client.leave();
  });
  const track = (who) => { peers.push(who); return who; };
  const ash = track(await join(port, code, 'Ash'));
  const bryn = track(await join(port, code, 'Bryn'));
  return { ash, bryn, track };
}

// Every note a peer hears from now on, from one performer: snapshots would
// push them out of the helper's short queue.
function listen(who, from) {
  const heard = [];
  who.client.ws.on('message', (data) => {
    const message = JSON.parse(data.toString());
    if (message.type === 'note' && message.from === from) heard.push(message);
  });
  return heard;
}
async function until(check, ms = 15000) {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await delay(10);
}

const LUTE = (degree = 0) => ({ instrument: 'lute', degree, octave: 0, chord: false });
const play = (who, note) => who.client.send({ type: 'note', note });
// Everything of a type that has arrived for a peer so far, taken off its queue.
async function drain(who, type, ms = 200) {
  await delay(ms);
  const got = [];
  for (;;) {
    const message = await Promise.race([who.client.next(type), delay(0).then(() => null)]);
    if (!message) return got;
    got.push(message);
  }
}

test('a note reaches the rest of the lobby from the performer, never the performer or another lobby', async (t) => {
  const { ash, bryn } = await pair(t);
  play(ash, { ...LUTE(4), chord: true });
  const heard = await bryn.client.next('note');
  assert.deepEqual(heard, { type: 'note', from: ash.lobby.id, note: { ...LUTE(4), chord: true } });
  assert.deepEqual((await server.host.client.next('note', (m) => m.from === ash.lobby.id)).note, heard.note);
  assert.deepEqual(await drain(ash, 'note'), [], 'no echo');
  assert.deepEqual(await drain(server.elsewhere, 'note', 0), [], 'another lobby hears nothing');
});

test('malformed notes neither fail the socket nor spend its budget', async (t) => {
  const { ash, bryn } = await pair(t);
  for (const request of [{ type: 'note' }, { type: 'note', note: { instrument: 'lute' } }, { type: 'note', note: 'x' },
    { type: 'note', note: { ...LUTE(), octave: 3 } }, { type: 'note2', note: LUTE() }]) ash.client.send(request);
  for (let i = 0; i < 20; i++) play(ash, LUTE(i % 8));
  const heard = [];
  for (let i = 0; i < 20; i++) heard.push(await bryn.client.next('note', (m) => m.from === ash.lobby.id));
  assert.deepEqual(heard.map((m) => m.note.degree), Array.from({ length: 20 }, (_, i) => i % 8));
  assert.deepEqual(await drain(ash, 'error', 0), []);
  assert.equal(ash.client.ws.readyState, WebSocket.OPEN);
});

test('a performer at 20 notes a second alongside state updates keeps its socket and every note', async (t) => {
  const { ash, bryn } = await pair(t);
  const heard = listen(bryn, ash.lobby.id);
  const state = playerState(new Player(0, 0));
  // Paced a touch over 50 ms so arrival jitter on the server never squeezes
  // twenty-one notes into one second; when each arrives isn't checked.
  for (let i = 0; i < 60; i++) {
    ash.client.send({ type: 'state', state });
    play(ash, LUTE(i % 8));
    await delay(52);
  }
  await until(() => heard.length >= 60);
  assert.deepEqual(heard.map((m) => m.note.degree), Array.from({ length: 60 }, (_, i) => i % 8));
  assert.equal(ash.client.ws.readyState, WebSocket.OPEN, 'the per-socket budget was not tripped');
});

test('a burst past the limit gives friends twenty, and the budget outlasts a reconnect', async (t) => {
  const { ash, bryn, track } = await pair(t);
  const heard = listen(bryn, ash.lobby.id);
  for (let i = 0; i < 30; i++) play(ash, LUTE(i % 8));
  await until(() => heard.length >= 20);
  await delay(300);
  assert.equal(heard.length, 20);
  // Drop the connection and resume the same place within the second.
  ash.client.ws.terminate();
  await bryn.client.next('snapshot', (m) => !m.players.some((p) => p.id === ash.lobby.id));
  const again = track(await join(server.port, server.code, 'Ash', ash.lobby.token));
  assert.equal(again.lobby.resumed, true);
  assert.equal(again.lobby.id, ash.lobby.id);
  for (let i = 0; i < 5; i++) play(again, LUTE());
  await delay(300);
  assert.equal(heard.length, 20, 'none of the five arrive');
  await delay(1100);
  for (let i = 0; i < 5; i++) play(again, LUTE());
  await until(() => heard.length >= 25);
  assert.equal(heard.length, 25);
});
