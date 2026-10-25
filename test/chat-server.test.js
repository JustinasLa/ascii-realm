import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { after, before, test } from 'node:test';
import { WebSocket } from 'ws';
import { Player } from '../src/entities/player.js';
import { SCALE, TILT } from '../src/entities/rig.js';
import { chatSeed, MAX_CHAT_LENGTH, muffle, clarityAt } from '../src/multiplayer/chat.js';
import { playerState } from '../src/multiplayer/protocol.js';
import { createGameServer } from '../server/index.js';
import { create, join, peer, setup } from './helpers/lobby.js';

const u = (...codes) => String.fromCharCode(...codes);
// World rows per metre down the screen.
const ROWS_PER_METRE = SCALE * TILT;

// One lobby serves every test: building a lobby's world is the slow part,
// and many at once crowd the machine for the other test files. Its host
// stands far off with the out-of-character channels hidden, so it never
// hears or counts as a listener.
let lobby;
before(async () => {
  const game = createGameServer();
  const { port } = await game.listen(0, '127.0.0.1');
  const host = await create(port, 42, 'Host');
  host.client.send({ type: 'state', state: playerState(new Player(0, 100000)) });
  for (const channel of ['ooc', 'looc']) {
    host.client.send({ type: 'chat-toggle', channel });
    await host.client.next('chat-notice');
  }
  lobby = { game, port, code: host.lobby.code, host };
});
after(() => lobby.game.close());

// Ash and Bryn join the shared lobby for one test and leave after it; any
// peer passed to `track` leaves too.
async function pair(t) {
  const { game, port, code } = lobby;
  const peers = [];
  const track = (who) => { peers.push(who); return who; };
  t.after(async () => {
    for (const who of peers) if (who.client.ws.readyState === WebSocket.OPEN) await who.client.leave();
  });
  const ash = track(await join(port, code, 'Ash'));
  const bryn = track(await join(port, code, 'Bryn'));
  return { port, game, ash, bryn, code, track };
}

// Moves a peer and waits until the server has its new place.
async function place(who, watcher, x, y) {
  who.client.send({ type: 'state', state: playerState(new Player(x, y)) });
  await watcher.client.next('snapshot', (m) => m.players.some((p) => p.id === who.lobby.id && p.state.y === y && p.state.x === x));
}

const chat = (who, channel, text) => who.client.send({ type: 'chat', channel, text });

test('a line said nearby reaches both players, cleaned, from the speaker', async (t) => {
  const { ash, bryn } = await pair(t);
  await place(ash, bryn, 0, 0);
  await place(bryn, ash, 0, 2 * ROWS_PER_METRE);
  chat(ash, 'rp', `  hello  ${u(0x201c)}friend${u(0x201d)} <b>${u(0x202e)}${u(0xd83d, 0xde00)}  `);
  const [heard, echo] = await Promise.all([bryn.client.next('chat'), ash.client.next('chat')]);
  assert.equal(heard.seq, echo.seq);
  assert.deepEqual(heard, { type: 'chat', seq: heard.seq, channel: 'rp', from: ash.lobby.id, name: 'Ash',
    text: 'hello "friend" <b>', clarity: 1, muffled: false });
  assert.deepEqual(echo, heard);
  chat(bryn, 'action', 'waves');
  const wave = await ash.client.next('chat');
  assert.equal(wave.seq, heard.seq + 1);
  assert.equal(wave.from, bryn.lobby.id);
  assert.equal(wave.text, 'waves');
});

test('range decides who hears; speech fades and blurs towards its edge', async (t) => {
  const { ash, bryn, code, game } = await pair(t);
  const firstSeq = game.rooms.get(code).chatSeq;
  await place(ash, bryn, 0, 0);
  await place(bryn, ash, 0, 30 * ROWS_PER_METRE);
  chat(ash, 'rp', 'can you hear');
  await ash.client.next('chat');
  assert.equal((await ash.client.next('chat-notice')).code, 'unheard');
  chat(ash, 'ooc', 'still here');
  assert.equal((await bryn.client.next('chat')).text, 'still here');
  chat(ash, 'yell', 'over here');
  const yelled = await bryn.client.next('chat', (m) => m.channel === 'yell');
  assert.equal(yelled.text, 'over here');
  assert.ok(yelled.clarity < 1 && yelled.clarity >= 0.85, 'a yell carries 30 m almost undimmed');
  // Not speech, but ranged: local out-of-character chat stops at 20 m.
  chat(ash, 'looc', 'lag?');
  await ash.client.next('chat', (m) => m.channel === 'looc');
  assert.equal((await ash.client.next('chat-notice')).code, 'unheard');

  await place(bryn, ash, 0, 14 * ROWS_PER_METRE);
  chat(ash, 'rp', 'the ship is lost');
  const blurred = await bryn.client.next('chat', (m) => m.channel === 'rp');
  const clarity = clarityAt(14, 15);
  const expected = muffle('the ship is lost', clarity, chatSeed(blurred.seq, bryn.lobby.id));
  assert.equal(blurred.clarity, Math.round(clarity * 100) / 100);
  assert.ok(blurred.clarity < 0.85);
  assert.equal(blurred.text, expected.text);
  assert.equal(blurred.muffled, expected.muffled);
  // The speaker hears their own words.
  assert.equal((await ash.client.next('chat', (m) => m.seq === blurred.seq)).text, 'the ship is lost');

  await place(bryn, ash, 0, 2.5 * ROWS_PER_METRE);
  chat(ash, 'whisper', 'psst');
  await ash.client.next('chat', (m) => m.channel === 'whisper');
  assert.equal((await ash.client.next('chat-notice')).code, 'unheard');
  await place(bryn, ash, 0, 1 * ROWS_PER_METRE);
  chat(ash, 'whisper', 'psst');
  assert.equal((await bryn.client.next('chat', (m) => m.channel === 'whisper')).text, 'psst');
  assert.equal(game.rooms.get(code).chatSeq - firstSeq, 7);
});

test('the lobby-wide channel ignores distance; local speech does not', async (t) => {
  const { ash, bryn } = await pair(t);
  await place(ash, bryn, 0, 0);
  await place(bryn, ash, 0, 500 * ROWS_PER_METRE);
  chat(ash, 'ooc', 'anyone?');
  const far = await bryn.client.next('chat');
  assert.equal(far.text, 'anyone?');
  assert.equal(far.clarity, 1);
  await place(bryn, ash, 0, 16 * ROWS_PER_METRE);
  chat(ash, 'rp', 'and now?');
  await ash.client.next('chat', (m) => m.channel === 'rp');
  assert.equal((await ash.client.next('chat-notice')).code, 'unheard');
  chat(ash, 'ooc', 'bye');
  assert.equal((await bryn.client.next('chat')).text, 'bye', 'the rp line never reached Bryn');
});

test('a full-length line muffled at any distance is still delivered within the limit', async (t) => {
  const { ash, bryn } = await pair(t);
  await place(ash, bryn, 0, 0);
  const text = 'the shy thrush sits '.repeat(13).slice(0, MAX_CHAT_LENGTH).trim();
  for (const metres of [9.5, 10.5, 11.5, 12.5, 13.5, 13.9]) {
    await place(bryn, ash, 0, metres * ROWS_PER_METRE);
    chat(ash, 'rp', text);
    const heard = await bryn.client.next('chat');
    assert.ok(heard.text.length <= MAX_CHAT_LENGTH, `${metres} m`);
    await delay(110);
  }
});

test('a hidden channel is neither heard nor sent, and stays hidden through a reconnect', async (t) => {
  const { port, ash, bryn, code, track } = await pair(t);
  bryn.client.send({ type: 'chat-toggle', channel: 'ooc' });
  assert.deepEqual(await bryn.client.next('chat-notice'), { type: 'chat-notice', code: 'toggled', channel: 'ooc', hidden: true });
  chat(ash, 'ooc', 'hello?');
  await ash.client.next('chat');
  assert.equal((await ash.client.next('chat-notice')).code, 'unheard');
  ash.client.send({ type: 'chat-toggle', channel: 'ooc' });
  await ash.client.next('chat-notice');
  chat(ash, 'ooc', 'muted');
  assert.equal((await ash.client.next('chat-notice')).code, 'hidden');
  ash.client.send({ type: 'chat-toggle', channel: 'rp' });
  assert.equal((await ash.client.next('chat-notice')).code, 'invalid');
  ash.client.send({ type: 'chat-toggle', channel: 'ooc' });
  assert.equal((await ash.client.next('chat-notice')).hidden, false);

  const closed = once(bryn.client.ws, 'close');
  bryn.client.ws.close();
  await closed;
  const back = track(await join(port, code, 'Bryn', bryn.lobby.token));
  assert.equal(back.lobby.resumed, true);
  chat(ash, 'ooc', 'still muted?');
  await ash.client.next('chat', (m) => m.text === 'still muted?');
  assert.equal((await ash.client.next('chat-notice')).code, 'unheard');
  back.client.send({ type: 'chat-toggle', channel: 'ooc' });
  assert.equal((await back.client.next('chat-notice')).hidden, false);
  chat(ash, 'ooc', 'now?');
  assert.equal((await back.client.next('chat')).text, 'now?');
});

test('bad channels, long or empty text and chat before joining are refused', async (t) => {
  const { port, ash } = await pair(t);
  for (const channel of ['admin', '__proto__', 'constructor', 5]) {
    chat(ash, channel, 'hi');
    assert.equal((await ash.client.next('chat-notice')).code, 'invalid');
  }
  chat(ash, 'rp', 'x'.repeat(300));
  assert.equal((await ash.client.next('chat-notice')).code, 'too-long');
  chat(ash, 'rp', 'x'.repeat(2000));
  chat(ash, 'rp', 42);
  ash.client.send({ type: 'chat-toggle', channel: 'looc' });
  chat(ash, 'ooc', 'marker');
  // Nothing came back for the empty or non-text lines: the toggle's notice
  // and the marker are next.
  assert.equal((await ash.client.next('chat-notice')).code, 'toggled');
  assert.equal((await ash.client.next('chat')).text, 'marker');

  const stranger = await peer(port);
  stranger.send({ type: 'chat', channel: 'ooc', text: 'let me in' });
  stranger.send({ type: 'chat-toggle', channel: 'ooc' });
  await delay(150);
  assert.equal(stranger.ws.readyState, WebSocket.OPEN);
  chat(ash, 'ooc', 'second marker');
  assert.equal((await ash.client.next('chat')).text, 'second marker');
});

test('a burst of ten is relayed, the eleventh refused, and the budget refills and survives a reconnect', async (t) => {
  const { port, ash, bryn, code, track } = await pair(t);
  for (let i = 0; i < 11; i++) chat(ash, 'ooc', `line ${i}`);
  for (let i = 0; i < 10; i++) assert.equal((await bryn.client.next('chat')).text, `line ${i}`);
  assert.equal((await ash.client.next('chat-notice', (m) => m.code === 'rate')).code, 'rate');
  await delay(1050);
  chat(ash, 'ooc', 'after a pause');
  assert.equal((await bryn.client.next('chat')).text, 'after a pause');
  assert.equal(ash.client.ws.readyState, WebSocket.OPEN);

  // Bryn spends the budget, drops and comes back: still too fast.
  for (let i = 0; i < 10; i++) chat(bryn, 'ooc', `b${i}`);
  for (let i = 0; i < 10; i++) await ash.client.next('chat', (m) => m.text === `b${i}`);
  const closed = once(bryn.client.ws, 'close');
  bryn.client.ws.close();
  await closed;
  const back = track(await join(port, code, 'Bryn', bryn.lobby.token));
  chat(back, 'ooc', 'b10');
  assert.equal((await back.client.next('chat-notice', (m) => m.code === 'rate')).code, 'rate');
  // A toggle counts against the same budget.
  back.client.send({ type: 'chat-toggle', channel: 'looc' });
  assert.equal((await back.client.next('chat-notice', (m) => m.code === 'rate')).code, 'rate');
});

test('runes cast by a friend reach the others', async (t) => {
  const { ash, bryn } = await pair(t);
  const { spellIds } = await import('../src/spells/catalog.js');
  ash.client.send({ type: 'spellcast', cast: { id: 'not-a-rune', heading: 0 } });
  ash.client.send({ type: 'spellcast', cast: { id: spellIds[0], heading: 7, aim: { x: 1, y: 2 } } });
  const cast = await bryn.client.next('spellcast');
  assert.equal(cast.casterId, ash.lobby.id);
  assert.equal(cast.id, spellIds[0]);
  assert.ok(Math.abs(cast.heading - (7 - 2 * Math.PI)) < 1e-9);
});

test('a socket that stops answering the heartbeat is dropped', async (t) => {
  const { port } = await setup(t, { heartbeatMs: 60 });
  const lively = await peer(port);
  const silent = new WebSocket(`ws://127.0.0.1:${port}/multiplayer`, { autoPong: false });
  silent.on('error', () => {});
  await once(silent, 'open');
  await once(silent, 'close');
  assert.equal(lively.ws.readyState, WebSocket.OPEN, 'a peer answering pings stays connected');
});
