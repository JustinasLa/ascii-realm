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
