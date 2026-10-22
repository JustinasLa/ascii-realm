import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { createGameServer } from '../server/index.js';
import { Player } from '../src/entities/player.js';
import { MAX_PLAYERS, playerState, PROTOCOL_VERSION } from '../src/multiplayer/protocol.js';

async function setup(t, options = {}) {
  const game = createGameServer(options);
  const { port } = await game.listen(0, '127.0.0.1');
  t.after(() => game.close());
  return { game, port };
}

async function peer(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/multiplayer`);
  const queue = [];
  const waiters = [];
  ws.on('error', () => {});
  ws.on('message', (data) => {
    const message = JSON.parse(data.toString());
    const i = waiters.findIndex((w) => w.type === message.type && w.match(message));
    if (i >= 0) {
      const waiter = waiters.splice(i, 1)[0];
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    } else {
      queue.push(message);
      if (queue.length > 100) queue.shift();
    }
  });
  await once(ws, 'open');
  return { ws,
    send: (message) => ws.send(JSON.stringify(message)),
    next(type, match = () => true) {
      const i = queue.findIndex((m) => m.type === type && match(m));
      if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { type, match, resolve, timer: setTimeout(() => {
          waiters.splice(waiters.indexOf(waiter), 1);
          reject(new Error(`Timed out waiting for ${type}`));
        }, 3000) };
        waiters.push(waiter);
      });
    },
    async leave() {
      const closed = once(ws, 'close');
      ws.send(JSON.stringify({ type: 'leave' }));
      await closed;
    },
  };
}

async function create(port, seed = 42, name = 'Kael') {
  const client = await peer(port);
  client.send({ type: 'create', version: PROTOCOL_VERSION, seed, name });
  return { client, lobby: await client.next('joined') };
}

async function join(port, code, name = 'Rowan', token) {
  const client = await peer(port);
  client.send({ type: 'join', version: PROTOCOL_VERSION, code, name, token });
  return { client, lobby: await client.next('joined') };
}

test('friends join by code with the same seed and receive movement, jumps and sword poses', async (t) => {
  const { port, game } = await setup(t);
  const host = await create(port, 42);
  assert.match(host.lobby.code, /^[A-Z2-9]{6}$/);
  const world = game.rooms.get(host.lobby.code).world;
  assert.equal(world.spawnRuins.props.length, 8, 'lobby spawning uses the same ruin map as normal clients');
  const gate = world.spawnRuins.props.find(prop => prop.kind === 'stone-gate');
  assert.equal(world.isWalkable(gate.x, gate.y), true);
  const friend = await join(port, ` ${host.lobby.code.toLowerCase()} `);
  assert.equal(friend.lobby.seed, 42);
  assert.notEqual(friend.lobby.id, host.lobby.id);
  assert.notEqual(friend.lobby.self.color, host.lobby.self.color);
  assert.equal(friend.lobby.players.length, 2);
  assert.ok(Math.hypot(friend.lobby.self.state.x - host.lobby.self.state.x, friend.lobby.self.state.y - host.lobby.self.state.y) < 50);
  const state = { ...host.lobby.self.state, x: host.lobby.self.state.x + 10, air: 0.5 };
  state.combat = { ...state.combat, inHand: true, trailing: true, active: 1 };
  host.client.send({ type: 'state', id: friend.lobby.id, state: { ...state, token: 'spoof' } });
  const update = await friend.client.next('snapshot', (m) => m.players.some((p) => p.id === host.lobby.id && p.state.x === state.x));
  const remote = update.players.find((p) => p.id === host.lobby.id);
  assert.equal(remote.state.air, 0.5);
  assert.equal(remote.state.combat.inHand, true);
  assert.equal(remote.state.combat.trailing, true);
  assert.equal(remote.state.token, undefined);
  assert.ok(update.players.every((p) => !('token' in p)));
  const late = await join(port, host.lobby.code, 'Ash');
  assert.equal(late.lobby.players.find((p) => p.id === host.lobby.id).state.x, state.x);
  assert.equal(late.lobby.players.length, 3);
});

test('rooms remain isolated and the creator can leave while friends keep the lobby', async (t) => {
  const { port, game } = await setup(t);
  const a = await create(port, 7, 'A');
  const b = await create(port, 8, 'B');
  const friend = await join(port, a.lobby.code);
  assert.equal((await b.client.next('snapshot')).players.length, 1);
  await a.client.leave();
  await friend.client.next('snapshot', (m) => m.players.length === 1);
  assert.ok(game.rooms.has(a.lobby.code));
  const late = await join(port, a.lobby.code, 'Late');
  assert.equal(late.lobby.players.length, 2);
  assert.equal(late.lobby.seed, 7);
  assert.ok(late.lobby.players.every((p) => p.id !== b.lobby.id));
});

test('lobbies hold eight players and free slots on intentional leave', async (t) => {
  const { port } = await setup(t);
  const host = await create(port);
  for (let i = 1; i < MAX_PLAYERS; i++) await join(port, host.lobby.code, `Friend ${i}`);
  const extra = await peer(port);
  extra.send({ type: 'join', version: PROTOCOL_VERSION, code: host.lobby.code });
  assert.match((await extra.next('error')).message, /full/);
  await host.client.leave();
  const replacement = await join(port, host.lobby.code);
  assert.equal(replacement.lobby.players.length, MAX_PLAYERS);
  assert.equal(new Set(replacement.lobby.players.map((p) => p.color)).size, MAX_PLAYERS);
});

test('brief disconnects resume identity and pose with a private token', async (t) => {
  const { port } = await setup(t);
  const host = await create(port);
  const friend = await join(port, host.lobby.code);
  const state = { ...host.lobby.self.state, x: host.lobby.self.state.x + 12 };
  host.client.send({ type: 'state', state });
  await friend.client.next('snapshot', (m) => m.players.some((p) => p.id === host.lobby.id && p.state.x === state.x));
  const closed = once(host.client.ws, 'close');
  host.client.ws.terminate();
  await closed;
  await friend.client.next('snapshot', (m) => m.players.length === 1);
  const resumed = await join(port, host.lobby.code, 'Ignored rename', host.lobby.token);
  assert.equal(resumed.lobby.id, host.lobby.id);
  assert.equal(resumed.lobby.self.name, 'Kael');
  assert.equal(resumed.lobby.self.state.x, state.x);
  assert.equal(resumed.lobby.resumed, true);
  const impostor = await join(port, host.lobby.code, 'New friend', 'wrong-token');
  assert.notEqual(impostor.lobby.id, host.lobby.id);
});

test('empty rooms expire after reconnect grace; deliberate leave removes them immediately', async (t) => {
  const { port, game } = await setup(t, { reconnectMs: 50 });
  const host = await create(port);
  const closed = once(host.client.ws, 'close');
  host.client.ws.terminate();
  await closed;
  await delay(160);
  assert.equal(game.rooms.size, 0);
  const next = await create(port);
  await next.client.leave();
  assert.equal(game.rooms.size, 0);
});

test('invalid codes, unknown lobbies, incompatible clients and malformed messages fail clearly', async (t) => {
  const { port } = await setup(t);
  for (const [request, match] of [
    [{ type: 'join', version: PROTOCOL_VERSION, code: 'AB' }, /six-character/],
    [{ type: 'join', version: PROTOCOL_VERSION, code: 'ZZZZZZ' }, /not found/],
    [{ type: 'create', version: -1 }, /Refresh/],
  ]) {
    const client = await peer(port);
    client.send(request);
    assert.match((await client.next('error')).message, match);
  }
  const bad = await peer(port);
  bad.ws.send('{oops');
  assert.match((await bad.next('error')).message, /Invalid/);
  const binary = await peer(port);
  binary.ws.send(Buffer.from('{}'));
  assert.match((await binary.next('error')).message, /JSON text/);
  const big = await peer(port);
  const closed = once(big.ws, 'close');
  big.ws.send('a'.repeat(9000));
  assert.equal((await closed)[0], 1009);
  assert.ok((await create(port)).lobby.code);
});

test('malformed names cannot crash lobby creation or joining', async (t) => {
  const { port } = await setup(t);
  const host = await create(port, 42, { toString: null });
  assert.equal(host.lobby.self.name, 'Wanderer');
  const friend = await join(port, host.lobby.code, [{ toString: null }]);
  assert.equal(friend.lobby.self.name, 'Wanderer');
  const next = await join(port, host.lobby.code, 'Rowan');
  assert.equal(next.lobby.self.name, 'Rowan');
  assert.equal(next.lobby.players.length, 3);
});

test('invalid state cannot corrupt a room or impersonate another player', async (t) => {
  const { port, game } = await setup(t);
  const host = await create(port);
  const raw = playerState(new Player(0, 0));
  host.client.send({ type: 'state', state: { ...raw, x: 'not a number' } });
  await delay(70);
  assert.equal(game.rooms.get(host.lobby.code).players.get(host.lobby.id).state.x, host.lobby.self.state.x);
});

test('room limits bound server resources', async (t) => {
  const { port } = await setup(t, { maxRooms: 1 });
  await create(port);
  const extra = await peer(port);
  extra.send({ type: 'create', version: PROTOCOL_VERSION });
  assert.match((await extra.next('error')).message, /busy/);
});

test('one address cannot hold unbounded connections or create lobbies without pause', async (t) => {
  const { port } = await setup(t, { maxPerAddress: 3, roomsPerMinute: 2 });
  await create(port);
  await create(port);
  const third = await peer(port);
  third.send({ type: 'create', version: PROTOCOL_VERSION });
  const closed = once(third.ws, 'close');
  assert.match((await third.next('error')).message, /Too many lobbies/);
  await closed;
  await delay(20);
  await peer(port);
  const fourth = new WebSocket(`ws://127.0.0.1:${port}/multiplayer`);
  fourth.on('error', () => {});
  const [code] = await once(fourth, 'close');
  assert.equal(code, 1013);
});

test('oversized frames from rejected connections cannot crash the server', async (t) => {
  const { port } = await setup(t, { maxPerAddress: 1 });
  const host = await create(port);
  const rejected = new WebSocket(`ws://127.0.0.1:${port}/multiplayer`);
  rejected.on('error', () => {});
  const closed = once(rejected, 'close');
  rejected.on('open', () => rejected.send('a'.repeat(9000)));
  assert.equal((await closed)[0], 1013);
  const health = await fetch(`http://127.0.0.1:${port}/health`);
  assert.deepEqual(await health.json(), { ok: true });
  await host.client.leave();
  assert.ok((await create(port)).lobby.code);
});

test('a friend far from the world is not used to place newcomers', async (t) => {
  const { port } = await setup(t);
  const host = await create(port, 42);
  const state = { ...host.lobby.self.state, x: 900000, y: -900000 };
  host.client.send({ type: 'state', state });
  await host.client.next('snapshot', (m) => m.players.some((p) => p.state.x === 900000));
  const friend = await join(port, host.lobby.code);
  assert.ok(Math.abs(friend.lobby.self.state.x) < 10000);
  assert.ok(Math.abs(friend.lobby.self.state.y) < 10000);
});

test('HTTP serves the game with correct MIME types and keeps server and private files inaccessible', async (t) => {
  const { port } = await setup(t);
  const base = `http://127.0.0.1:${port}`;
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /lobby-code/);
  const script = await fetch(`${base}/src/main.js`, { method: 'HEAD' });
  assert.match(script.headers.get('content-type'), /javascript/);
  assert.equal(await script.text(), '');
  for (const path of ['/server/index.js', '/node_modules/ws/index.js', '/.git', '/package.json',
    '/src/%2e%2e/server/index.js', '/src/%5c..%5cserver%5cindex.js', '/src//main.js']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 404, path);
    await response.text();
  }
  assert.equal((await fetch(`${base}/health`)).status, 200);
  const post = await fetch(base, { method: 'POST' });
  assert.equal(post.status, 405);
});
