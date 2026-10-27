import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { MultiplayerClient } from '../src/multiplayer/client.js';
import {
  guardLobbyConnect, lobbyWorldUrl, needsWorldReload, PENDING_LOBBY, resumePendingLobby, sparseWorldUrl,
} from '../src/world/woodland.js';
import { setup } from './helpers/lobby.js';

const storage = (entries = {}) => {
  const map = new Map(Object.entries(entries));
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
};
const fakeClient = () => ({ requests: [], connect(request) { this.requests.push(request); } });

test('a dense page asked for a lobby keeps the request and reloads instead of connecting', () => {
  for (const mode of ['create', 'join']) {
    const client = fakeClient();
    const session = storage();
    let reloads = 0;
    assert.equal(guardLobbyConnect(client, { dense: true, storage: session, reload: () => reloads++ }), true);
    client.connect({ mode, name: 'Kael', seed: 7, code: mode === 'join' ? 'ABC234' : '', server: 'wss://x.example/lobby' });
    assert.equal(client.requests.length, 0, 'no socket is opened');
    assert.equal(reloads, 1);
    // The reloaded, sparse page makes the same request.
    const next = fakeClient();
    const request = resumePendingLobby(next, session);
    assert.deepEqual(next.requests, [{ mode, name: 'Kael', seed: 7, code: mode === 'join' ? 'ABC234' : '', server: 'wss://x.example/lobby' }]);
    assert.deepEqual(request, next.requests[0]);
    assert.equal(session.map.has(PENDING_LOBBY), false, 'made once');
    assert.equal(resumePendingLobby(fakeClient(), session), null);
  }
});

test('a sparse page connects straight away, and a broken or missing request is ignored', () => {
  const client = fakeClient();
  assert.equal(guardLobbyConnect(client, { dense: false, storage: storage(), reload: () => assert.fail() }), false);
  client.connect({ mode: 'create' });
  assert.equal(client.requests.length, 1);
  // Without storage the dense page still never connects.
  const blocked = fakeClient();
  let reloads = 0;
  guardLobbyConnect(blocked, { dense: true, storage: null, reload: () => reloads++ });
  blocked.connect({ mode: 'join', code: 'ABC234' });
  assert.equal(reloads, 1);
  assert.equal(blocked.requests.length, 0);
  assert.equal(resumePendingLobby(fakeClient(), null), null);
  assert.equal(resumePendingLobby(fakeClient(), storage({ [PENDING_LOBBY]: '{not json' })), null);
  assert.equal(resumePendingLobby(fakeClient(), storage({ [PENDING_LOBBY]: '{"mode":"steal"}' })), null);
  const defaults = fakeClient();
  resumePendingLobby(defaults, storage({ [PENDING_LOBBY]: '{"mode":"create","name":"Ana","seed":3}' }));
  assert.deepEqual(defaults.requests, [{ mode: 'create', name: 'Ana', seed: 3, code: undefined, server: '' }]);
});

test('joining reloads into the lobby\'s seed, and out of dense woods', () => {
  assert.equal(needsWorldReload({ seed: 7 }, 7, 'sparse'), false);
  assert.equal(needsWorldReload({ seed: 8 }, 7, 'sparse'), true);
  assert.equal(needsWorldReload({ seed: 7 }, 7, 'dense'), true);
  const url = lobbyWorldUrl('http://localhost/?seed=7&woodland=dense&flora=1', { seed: 7, code: 'ABC234' }, 'wss://x.example');
  assert.equal(url.searchParams.get('woodland'), null);
  assert.equal(url.searchParams.get('flora'), '1');
  assert.equal(url.searchParams.get('room'), 'ABC234');
  assert.equal(url.searchParams.get('server'), 'wss://x.example');
  assert.equal(lobbyWorldUrl('http://localhost/', { seed: 9, code: 'ABC234' }).searchParams.has('server'), false);
});

class Socket {
  constructor() { this.readyState = 1; this.sent = []; this.closed = 0; }
  send(message) { this.sent.push(JSON.parse(message)); }
  close() { this.closed++; }
}

test('suspending drops the connection without telling the lobby', () => {
  const changes = [];
  const client = new MultiplayerClient({ WebSocketImpl: Socket, onChange: (c) => changes.push(c.status) });
  const socket = new Socket();
  Object.assign(client, { socket, room: { code: 'ABC234' }, status: 'online' });
  client.suspend();
  assert.deepEqual(socket.sent, [], 'no leave');
  assert.equal(socket.closed, 1);
  assert.equal(client.socket, null);
  assert.equal(client.room, null);
  assert.deepEqual(changes, ['offline']);
  const leaving = new Socket();
  Object.assign(client, { socket: leaving, room: { code: 'ABC234' } });
  client.leave();
  assert.deepEqual(leaving.sent, [{ type: 'leave' }]);
});

test('a lobby keeps a suspended player\'s seat for the reconnect window; leaving gives it up', async (t) => {
  const { port, game } = await setup(t, { reconnectMs: 300 });
  const open = async () => {
    let joined;
    const done = new Promise((resolve) => { joined = resolve; });
    const client = new MultiplayerClient({ WebSocketImpl: WebSocket, baseUrl: 'http://localhost/', onJoin: joined });
    client.connect({ mode: 'create', name: 'Kael', seed: 7, server: `ws://127.0.0.1:${port}/multiplayer` });
    await done;
    return client;
  };
  const suspended = await open();
  const socket = suspended.socket;
  suspended.suspend();
  await once(socket, 'close');
  await delay(50);
  assert.equal(game.rooms.size, 1, 'the room waits for its player');
  await delay(500);
  assert.equal(game.rooms.size, 0, 'and closes once the window passes');
  const leaving = await open();
  const second = leaving.socket;
  leaving.leave();
  await once(second, 'close');
  await delay(50);
  assert.equal(game.rooms.size, 0, 'a player who leaves gives the room up at once');
});

test('the sparse world a dense page reloads into names the request\'s lobby server', () => {
  const url = sparseWorldUrl('http://localhost/?seed=7&woodland=dense&flora=1', { server: 'wss://x.example/lobby' });
  assert.equal(url.searchParams.get('woodland'), null);
  assert.equal(url.searchParams.get('flora'), '1');
  assert.equal(url.searchParams.get('server'), 'wss://x.example/lobby');
  assert.equal(sparseWorldUrl('http://localhost/?woodland=dense&server=wss://old.example', { server: '  ' })
    .searchParams.has('server'), false, 'the default server drops an old address');
  assert.equal(sparseWorldUrl('http://localhost/?woodland=dense').searchParams.has('server'), false);
});
