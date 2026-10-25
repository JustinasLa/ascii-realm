import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { attachLobbies } from './lobbies.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.wav': 'audio/wav', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json' };

export function createGameServer({ root = ROOT, reconnectMs, maxRooms, maxPerAddress, roomsPerMinute, heartbeatMs } = {}) {
  const server = createServer(async (request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    let path;
    try { path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
    catch { response.writeHead(400).end('Invalid path'); return; }
    if (path === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(request.method === 'HEAD' ? undefined : JSON.stringify({ ok: true }));
      return;
    }
    if (path === '/') path = '/index.html';
    // Serve game assets only: never expose server code, tests, Git files or dependencies.
    const parts = path.split('/').slice(1);
    if (path.includes('\\') || parts.some((p) => !p || p.startsWith('.'))
      || !(['/index.html', '/style.css', '/manifest.webmanifest'].includes(path) || ['src', 'assets', 'vendor', 'docs'].includes(parts[0]))
      || !MIME[extname(path)]) {
      response.writeHead(404).end('Not found');
      return;
    }
    try {
      const file = await realpath(resolve(root, ...parts));
      const rel = relative(await realpath(root), file);
      if (isAbsolute(rel) || rel.startsWith(`..${sep}`) || rel === '..') throw new Error('Invalid path');
      const info = await stat(file);
      if (!info.isFile()) throw new Error('Not a file');
      response.writeHead(200, { 'Content-Type': MIME[extname(path)], 'Content-Length': info.size,
        'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      if (request.method === 'HEAD') response.end();
      else createReadStream(file).on('error', () => response.destroy()).pipe(response);
    } catch { response.writeHead(404).end('Not found'); }
  });
  const wss = new WebSocketServer({ server, path: '/multiplayer', maxPayload: 8192, perMessageDeflate: false });
  const lobbies = attachLobbies(wss, { reconnectMs, maxRooms, maxPerAddress, roomsPerMinute, heartbeatMs });
  return { server, wss, rooms: lobbies.rooms,
    listen(port = 8000, host = '0.0.0.0') {
      return new Promise((resolveListen, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => { server.off('error', reject); resolveListen(server.address()); });
      });
    },
    async close() {
      lobbies.dispose();
      for (const socket of wss.clients) socket.terminate();
      await Promise.all([
        new Promise((done) => wss.close(done)),
        new Promise((done) => server.close(done)),
      ]);
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const game = createGameServer();
  const address = await game.listen(Number(process.env.PORT || 8000), process.env.HOST || '0.0.0.0');
  console.log(`ASCII Realm: http://localhost:${address.port} — create or join a lobby from Multiplayer.`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void game.close(); });
}
