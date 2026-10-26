import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION } from '../src/multiplayer/protocol.js';
import { PLAYER_COLORS, rgbHex } from '../src/multiplayer/tint.js';
import { createGameServer } from '../server/index.js';
import { peer } from './helpers/lobby.js';

// One lobby serves every test, as building its world is the slow part. Its
// host stays for the whole file; each test's players leave after it.
let lobby;
before(async () => {
  const game = createGameServer();
  const { port } = await game.listen(0, '127.0.0.1');
  const host = await peer(port);
  host.send({ type: 'create', version: PROTOCOL_VERSION, seed: 42, name: 'Host', tint: '#FFAA00' });
  lobby = { game, port, host, joined: await host.next('joined') };
});
after(() => lobby.game.close());

async function enter(t, name, tint, extra = {}) {
  const client = await peer(lobby.port);
  client.send({ type: 'join', version: PROTOCOL_VERSION, code: lobby.joined.code, name, tint, ...extra });
  const joined = await client.next('joined');
  t.after(async () => { if (client.ws.readyState === WebSocket.OPEN) await client.leave(); });
  return { client, joined, id: joined.id };
}

// The next snapshot `watcher` gets in which `test` holds for member `id`.
const seen = (watcher, id, test) => watcher.next('snapshot', (m) => m.players.some((p) => p.id === id && test(p)));
const member = (message, id) => message.players.find((p) => p.id === id);

test('the creator\'s colour is cleaned and every member entry carries a colour and a tag', () => {
  const self = lobby.joined.self;
  assert.equal(self.tint, '#ffaa00');
  assert.equal(self.tag, null);
  assert.deepEqual(Object.keys(self).sort(), ['color', 'id', 'name', 'state', 'tag', 'tint']);
});

test('friends see a chosen colour, a change and a clear, and a newcomer sees them all at once', async (t) => {
  const bryn = await enter(t, 'Bryn');
  assert.equal(member(bryn.joined, bryn.id).tint, null, 'no colour is Auto');
  assert.equal(member(bryn.joined, lobby.joined.id).tint, '#ffaa00');
  assert.notEqual(member(bryn.joined, bryn.id).color, lobby.joined.self.color, 'automatic colours stay unique');
  bryn.client.send({ type: 'tint', tint: '#55FFFF' });
  await seen(lobby.host, bryn.id, (p) => p.tint === '#55ffff');
  const cai = await enter(t, 'Cai', '#ff5555');
  assert.deepEqual(cai.joined.players.map((p) => p.tint), ['#ffaa00', '#55ffff', '#ff5555'], 'a late joiner sees every colour in its first roster');
  bryn.client.send({ type: 'tint', tint: null });
  await seen(cai.client, bryn.id, (p) => p.tint === null);
  bryn.client.send({ type: 'tint', tint: '#000000' });
  const lifted = await seen(cai.client, bryn.id, (p) => ![null, '#55ffff'].includes(p.tint));
  assert.equal(member(lifted, bryn.id).tint, '#8d8d8d', 'black is never stored');
});

test('anything but a hex colour or null leaves the colour as it was', async (t) => {
  const bryn = await enter(t, 'Bryn', '#ff5555');
  for (const tint of ['red', 'dark_aqua', 42, '#zzzzzz', { hex: '#00aaaa' }, ['#00aaaa'], true]) {
    bryn.client.send({ type: 'tint', tint });
  }
  bryn.client.send({ type: 'tint' });
  bryn.client.send({ type: 'state', state: 'not a state' });
  const later = await lobby.host.next('snapshot', (m) => member(m, bryn.id));
  assert.equal(member(later, bryn.id).tint, '#ff5555');
  assert.equal(bryn.client.ws.readyState, WebSocket.OPEN, 'a bad colour closes nothing');
  const junk = await enter(t, 'Dara', 'not a colour');
  assert.equal(member(junk.joined, junk.id).tint, null, 'a bad colour never fails a join');
});

test('a colour sent before joining is ignored', async (t) => {
  const early = await peer(lobby.port);
  t.after(async () => { if (early.ws.readyState === WebSocket.OPEN) await early.leave(); });
  early.send({ type: 'tint', tint: '#55ff55' });
  early.send({ type: 'join', version: PROTOCOL_VERSION, code: lobby.joined.code, name: 'Eli' });
  const joined = await early.next('joined');
  assert.equal(joined.self.tint, null);
});

test('a resumed player brings the colour picked while away; none means Auto', async (t) => {
  const bryn = await enter(t, 'Bryn', '#ff5555');
  bryn.client.ws.terminate();
  await lobby.host.next('snapshot', (m) => !member(m, bryn.id));
  const back = await enter(t, 'Bryn', '#ffaa00', { token: bryn.joined.token });
  assert.equal(back.joined.resumed, true);
  assert.equal(back.id, bryn.id);
  assert.equal(back.joined.self.tint, '#ffaa00');
  back.client.ws.terminate();
  await lobby.host.next('snapshot', (m) => !member(m, bryn.id));
  const again = await enter(t, 'Bryn', undefined, { token: bryn.joined.token });
  assert.equal(again.joined.self.tint, null);
});

test('players sharing a name get a lasting tag and never a look-alike colour', async (t) => {
  const ash = await enter(t, 'Ash', '#ff5555');
  const ash2 = await enter(t, 'ash', '#ff5555');
  const ash3 = await enter(t, 'ASH', '#ff5a58');
  const roster = ash3.joined.players;
  assert.deepEqual([ash, ash2, ash3].map((p) => member(ash3.joined, p.id).tag), [null, 2, 3]);
  const shown = [ash, ash2, ash3].map((p) => member(ash3.joined, p.id).tint);
  assert.equal(shown[0], '#ff5555');
  assert.equal(new Set(shown).size, 3, 'three different colours');
  assert.ok(shown.slice(1).every((tint) => PLAYER_COLORS.some((c) => rgbHex(c) === tint)), 'the later ones show automatic colours');
  assert.equal(roster.length, 4);
  // Chat names the speaker with their tag.
  ash2.client.send({ type: 'chat', channel: 'ooc', text: 'which Ash?' });
  const line = await ash.client.next('chat', (m) => m.from === ash2.id);
  assert.equal(line.name, 'ash');
  assert.equal(line.tag, 2);
  // The first Ash leaves: the second gets its own red back, and keeps its tag.
  await ash.client.leave();
  const after = await seen(ash3.client, ash2.id, (p) => p.tint === '#ff5555');
  assert.equal(member(after, ash2.id).tag, 2);
  assert.equal(member(after, ash3.id).tag, 3);
  // A new Ash takes the lowest free tag.
  const ash4 = await enter(t, 'Ash');
  assert.equal(ash4.joined.self.tag, null, '"Ash" itself is free again');
  const ash5 = await enter(t, 'Ash');
  assert.equal(ash5.joined.self.tag, 4);
});

test('a page from before name colours is told to refresh', async () => {
  const old = await peer(lobby.port);
  const closed = once(old.ws, 'close');
  old.send({ type: 'join', version: 3, code: lobby.joined.code, name: 'Old', tint: '#ff5555' });
  const error = await old.next('error');
  assert.equal(error.message, 'Refresh the game to use this lobby server.');
  assert.equal(PROTOCOL_VERSION, 4);
  await closed;
});
