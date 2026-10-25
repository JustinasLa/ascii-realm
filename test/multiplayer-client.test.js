import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { MultiplayerClient } from '../src/multiplayer/client.js';
import { Player } from '../src/entities/player.js';
import { playerState } from '../src/multiplayer/protocol.js';

class Socket {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.bufferedAmount = 0;
    this.sent = [];
    this.listeners = new Map();
    Socket.instances.push(this);
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  emit(type, event = {}) { for (const fn of this.listeners.get(type) || []) fn(event); }
  send(message) { this.sent.push(JSON.parse(message)); }
  close() { this.readyState = 3; this.emit('close'); }
  open() { this.readyState = 1; this.emit('open'); }
  message(message) { this.emit('message', { data: JSON.stringify(message) }); }
}

function setup(t, options = {}) {
  Socket.instances = [];
  const client = new MultiplayerClient({ WebSocketImpl: Socket, baseUrl: 'http://localhost:8000', ...options });
  t.after(() => client.leave());
  return client;
}

function joined() {
  const self = { id: 'a1', name: 'Kael', color: 0, state: playerState(new Player(0, 0)) };
  return { type: 'joined', code: 'ABC234', seed: 7, id: 'a1', token: 'private-token', maxPlayers: 8,
    time: 1, resumed: false, self, players: [self] };
}

test('client creates a lobby and only sends state after joining', (t) => {
  let received;
  const client = setup(t, { getState: () => joined().self.state, onJoin: (lobby) => { received = lobby; } });
  client.connect({ mode: 'create', name: 'Kael', seed: 7 });
  const socket = Socket.instances[0];
  client.sendState();
  assert.equal(socket.sent.length, 0);
  socket.open();
  assert.equal(socket.sent[0].type, 'create');
  assert.equal(socket.sent[0].seed, 7);
  socket.message(joined());
  assert.equal(client.status, 'online');
  assert.equal(received.seed, 7);
  assert.equal(socket.sent[1].type, 'state');
  socket.bufferedAmount = 100000;
  client.sendState();
  assert.equal(socket.sent.length, 2);
});

test('connection failures and server errors keep the game in solo mode', (t) => {
  const client = setup(t);
  client.connect({ mode: 'join', code: 'bad' });
  assert.equal(client.status, 'error');
  assert.equal(Socket.instances.length, 0);
  client.connect({ mode: 'join', code: 'ABC234' });
  const socket = Socket.instances[0];
  socket.open();
  socket.message({ type: 'error', message: 'Lobby not found.' });
  assert.equal(client.status, 'error');
  assert.equal(client.message, 'Lobby not found.');
  assert.equal(client.room, null);
  assert.equal(client.socket, null);
});

for (const callback of ['onJoin', 'onSnapshot', 'onChange']) {
  for (const replace of [false, true]) {
    test(`${callback} can ${replace ? 'replace' : 'cancel'} a connection while joining`, (t) => {
      const client = setup(t, { getState: () => joined().self.state });
      let handled = false;
      client[callback] = (value) => {
        if (handled || (callback === 'onSnapshot' && !value.length)
          || (callback === 'onChange' && value.status !== 'online')) return;
        handled = true;
        if (replace) client.connect({ mode: 'join', code: 'DEF567' });
        else client.leave(false);
      };
      client.connect({ mode: 'create' });
      const first = Socket.instances[0];
      first.open();
      first.message(joined());
      assert.equal(handled, true);
      assert.equal(client.status, replace ? 'connecting' : 'offline');
      assert.equal(client.room, null);
      assert.equal(client.sendTimer, undefined);
      assert.equal(first.sent.some((message) => message.type === 'state'), false);
      if (replace) {
        const second = Socket.instances[1];
        assert.equal(client.socket, second);
        second.open();
        assert.equal(second.sent[0].code, 'DEF567');
        second.message({ ...joined(), code: 'DEF567' });
        assert.equal(client.status, 'online');
        assert.equal(client.room.code, 'DEF567');
        assert.equal(second.sent[1].type, 'state');
      } else assert.equal(client.socket, null);
    });
  }
}

test('a brief disconnect rejoins the same code with its private resume token', async (t) => {
  const client = setup(t, { retryDelay: 5 });
  client.connect({ mode: 'create', name: 'Kael', seed: 7 });
  const first = Socket.instances[0];
  first.open();
  first.message(joined());
  first.close();
  assert.equal(client.status, 'reconnecting');
  await delay(20);
  const second = Socket.instances[1];
  second.open();
  assert.equal(second.sent[0].type, 'join');
  assert.equal(second.sent[0].code, 'ABC234');
  assert.equal(second.sent[0].token, 'private-token');
  second.message({ ...joined(), resumed: true });
  assert.equal(client.status, 'online');
  assert.equal(client.retry, 0);
});

test('leaving cancels retries and late socket messages cannot resurrect a lobby', async (t) => {
  const client = setup(t, { retryDelay: 10 });
  client.connect({ mode: 'create' });
  const socket = Socket.instances[0];
  socket.open();
  socket.message(joined());
  socket.close();
  client.leave();
  socket.message(joined());
  await delay(30);
  assert.equal(Socket.instances.length, 1);
  assert.equal(client.status, 'offline');
  assert.equal(client.room, null);
});

test('connection timeouts surface a useful error without leaving timers running', async (t) => {
  const client = setup(t, { connectionTimeout: 10 });
  client.connect({ mode: 'create' });
  await delay(30);
  assert.equal(client.status, 'error');
  assert.match(client.message, /lobby server/);
  assert.equal(client.socket, null);
});

test('snapshot callbacks update the roster and leaving clears remote players', (t) => {
  const snapshots = [];
  const client = setup(t, { onSnapshot: (players) => snapshots.push(players) });
  client.connect({ mode: 'join', code: 'abc234' });
  const socket = Socket.instances[0];
  socket.open();
  assert.equal(socket.sent[0].code, 'ABC234');
  socket.message(joined());
  const members = [...joined().players, { ...joined().self, id: 'b2', name: 'Rowan', color: 1 }];
  socket.message({ type: 'snapshot', time: 2, players: members });
  assert.equal(client.players.length, 2);
  assert.equal(snapshots.at(-1).length, 2);
  client.leave();
  assert.equal(snapshots.at(-1).length, 0);
  assert.equal(socket.sent.at(-1).type, 'leave');
});

test('unloading silently leaves the client in a consistent offline state for cached pages', (t) => {
  let changes = 0;
  const client = setup(t, { onChange: () => { changes++; } });
  client.connect({ mode: 'create' });
  const socket = Socket.instances[0];
  socket.open();
  socket.message(joined());
  const before = changes;
  client.leave(false);
  assert.equal(changes, before);
  assert.equal(client.status, 'offline');
  assert.equal(client.socket, null);
  assert.equal(client.room, null);
});

test('malformed lobby members are dropped and names, colours and seeds are cleaned', (t) => {
  let received;
  const client = setup(t, { onJoin: (lobby) => { received = lobby; } });
  client.connect({ mode: 'create' });
  const socket = Socket.instances[0];
  socket.open();
  const good = joined().self;
  socket.message({ ...joined(), seed: 'huge', players: [
    { ...good, name: 'x'.repeat(5000), color: 99 },
    { ...good, id: '../../etc' },
    { ...good, id: 'c3', state: { x: 'nope' } },
    null,
  ] });
  assert.equal(client.status, 'online');
  assert.equal(received.seed, 1);
  assert.equal(client.players.length, 1);
  assert.equal(client.players[0].name.length, 24);
  assert.equal(client.players[0].color, 0);
  socket.message({ type: 'joined', ...joined(), id: { toString: () => 'a1' } });
  assert.equal(client.id, 'a1');
});

test('chat, toggles and casts are sent only while online and not backed up', (t) => {
  const client = setup(t);
  assert.equal(client.sendChat('rp', 'early'), false);
  client.connect({ mode: 'create' });
  const socket = Socket.instances[0];
  socket.open();
  assert.equal(client.sendChat('rp', 'still joining'), false);
  socket.message(joined());
  assert.equal(client.sendChat('rp', 'hello'), true);
  assert.equal(client.toggleChat('ooc'), true);
  client.sendCast({ id: 'rune', heading: 0 });
  assert.deepEqual(socket.sent.slice(-3), [{ type: 'chat', channel: 'rp', text: 'hello' },
    { type: 'chat-toggle', channel: 'ooc' }, { type: 'spellcast', cast: { id: 'rune', heading: 0 } }]);
  socket.bufferedAmount = 40000;
  assert.equal(client.sendChat('rp', 'lagging'), false);
  assert.equal(client.toggleChat('ooc'), false);
  assert.equal(socket.sent.at(-1).type, 'spellcast');
});

test('relayed chat, notices and casts reach their callbacks only when well formed', (t) => {
  const lines = [];
  const notices = [];
  const casts = [];
  const client = setup(t);
  Object.assign(client, { onChat: (m) => lines.push(m), onChatNotice: (n) => notices.push(n), onCast: (c) => casts.push(c) });
  client.connect({ mode: 'create' });
  const socket = Socket.instances[0];
  socket.open();
  const line = { type: 'chat', seq: 1, channel: 'rp', from: 'b2', name: 'Rowan', text: 'hi', clarity: 1, muffled: false };
  socket.message(line);
  socket.message({ type: 'chat-notice', code: 'rate' });
  assert.equal(lines.length + notices.length, 0, 'nothing before joining');
  socket.message(joined());
  socket.message(line);
  socket.message({ ...line, channel: 'admin' });
  socket.message({ ...line, text: '<img src=x onerror=alert(1)>', seq: 2 });
  socket.message({ type: 'chat-notice', code: 'rate' });
  socket.message({ type: 'chat-notice', code: 'nonsense' });
  socket.message({ type: 'spellcast', casterId: 'b2', id: 'rune' });
  socket.message({ type: 'spellcast', casterId: 7 });
  socket.emit('message', { data: 'not json' });
  socket.message(null);
  assert.deepEqual(lines.map((m) => m.text), ['hi', '<img src=x onerror=alert(1)>']);
  assert.deepEqual(notices, [{ code: 'rate' }]);
  assert.equal(casts.length, 1);
  client.onChat = client.onChatNotice = undefined;
  socket.message(line);
  socket.message({ type: 'chat-notice', code: 'rate' });
});

test('the roster reports who joins and leaves, but not who was already there', (t) => {
  const changes = [];
  const client = setup(t, { retryDelay: 5 });
  client.onRoster = (change) => changes.push(change);
  client.connect({ mode: 'create' });
  const socket = Socket.instances[0];
  socket.open();
  const rowan = { ...joined().self, id: 'b2', name: 'Rowan', color: 1 };
  socket.message({ ...joined(), players: [joined().self, rowan] });
  assert.deepEqual(changes, [{ self: true, code: 'ABC234', resumed: false }]);
  socket.message({ type: 'snapshot', time: 2, players: [joined().self, rowan] });
  assert.equal(changes.length, 1, 'Rowan was already here');
  const bryn = { ...rowan, id: 'c3', name: 'Bryn' };
  socket.message({ type: 'snapshot', time: 3, players: [joined().self, bryn] });
  assert.deepEqual(changes.at(-1), { joined: [client.players[1]], left: [{ id: 'b2', name: 'Rowan' }] });
  socket.message({ type: 'snapshot', time: 4, players: [joined().self, { ...bryn, name: 'Bryn the Bold' }] });
  assert.equal(changes.length, 2, 'a new name is no join or leave');
  client.leave();
  assert.deepEqual(changes.at(-1), { left: 'self' });
  client.leave();
  assert.equal(changes.length, 3, 'leaving twice says so once');
});

test('a resumed lobby is reported as a reconnect', async (t) => {
  const changes = [];
  const client = setup(t, { retryDelay: 5 });
  client.onRoster = (change) => changes.push(change);
  client.connect({ mode: 'create' });
  Socket.instances[0].open();
  Socket.instances[0].message(joined());
  Socket.instances[0].close();
  await delay(20);
  Socket.instances[1].open();
  Socket.instances[1].message({ ...joined(), resumed: true });
  assert.deepEqual(changes.at(-1), { self: true, code: 'ABC234', resumed: true });
});

test('a client gives up after five failed reconnects and a connection that cannot open fails', async (t) => {
  const client = setup(t, { retryDelay: 1, connectionTimeout: 5 });
  client.connect({ mode: 'create' });
  Socket.instances[0].open();
  Socket.instances[0].message(joined());
  Socket.instances[0].close();
  for (let i = 0; i < 80 && client.status !== 'error'; i++) await delay(5);
  assert.equal(client.status, 'error');
  assert.equal(client.message, 'Connection lost. Enter the lobby code to join again.');
  const broken = setup(t, { WebSocketImpl: class { constructor() { throw new Error('blocked'); } } });
  broken.connect({ mode: 'create' });
  assert.equal(broken.status, 'error');
  assert.match(broken.message, /Could not connect/);
  const refused = setup(t);
  refused.connect({ mode: 'create' });
  Socket.instances.at(-1).close();
  assert.equal(refused.status, 'error');
  assert.match(refused.message, /Could not reach the lobby server/);
});
