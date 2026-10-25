// Real lobby servers on an ephemeral port, and peers that wait for the
// messages a test expects.
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createGameServer } from '../../server/index.js';
import { PROTOCOL_VERSION } from '../../src/multiplayer/protocol.js';

// Creating a lobby builds its world on the server, which takes several seconds
// on CI's shared runner while coverage is recording.
const MESSAGE_TIMEOUT_MS = 15000;

export async function setup(t, options = {}) {
  const game = createGameServer(options);
  const { port } = await game.listen(0, '127.0.0.1');
  t.after(() => game.close());
  return { game, port };
}

export async function peer(port) {
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
        }, MESSAGE_TIMEOUT_MS) };
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

export async function create(port, seed = 42, name = 'Kael') {
  const client = await peer(port);
  client.send({ type: 'create', version: PROTOCOL_VERSION, seed, name });
  return { client, lobby: await client.next('joined') };
}

export async function join(port, code, name = 'Rowan', token) {
  const client = await peer(port);
  client.send({ type: 'join', version: PROTOCOL_VERSION, code, name, token });
  return { client, lobby: await client.next('joined') };
}
