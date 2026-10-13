import { randomBytes, randomInt } from 'node:crypto';
import { WebSocket } from 'ws';
import { Player } from '../src/entities/player.js';
import { World, ASPECT } from '../src/world/world.js';
import { cleanCode, cleanName, cleanSeed, MAX_PLAYERS, playerState,
  PROTOCOL_VERSION, readPlayerState, UPDATE_MS, validCode } from '../src/multiplayer/protocol.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function attachLobbies(wss, { reconnectMs = 30000, maxRooms = 128 } = {}) {
  const rooms = new Map();
  const connections = new Map();

  function send(socket, message) {
    if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < 65536) {
      socket.send(JSON.stringify(message));
    }
  }

  function members(room) {
    return [...room.players.values()].filter((p) => p.socket).map((p) => ({
      id: p.id, name: p.name, color: p.color, state: p.state,
    }));
  }

  function broadcast(room) {
    const message = { type: 'snapshot', time: (Date.now() - room.createdAt) / 1000, players: members(room) };
    for (const p of room.players.values()) if (p.socket) send(p.socket, message);
  }

  function remove(session, reserve) {
    if (!session.player) return;
    const { room, player } = session;
    player.socket = null;
    if (reserve) player.expires = Date.now() + reconnectMs;
    else room.players.delete(player.id);
    session.player = null;
    session.room = null;
    if (room.players.size === 0) rooms.delete(room.code);
    else broadcast(room);
  }

  function fail(socket, message) {
    send(socket, { type: 'error', message });
    socket.close(1008, 'Lobby request rejected');
  }

  function newCode() {
    let code;
    do code = Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
    while (rooms.has(code));
    return code;
  }

  function spawnFor(room) {
    const anchor = [...room.players.values()].find((p) => p.socket)?.state ?? room.world.spawn;
    for (let i = 0; i < 64; i++) {
      const angle = i * 2.4;
      const radius = i === 0 ? 0 : 5 + Math.floor(i / 8) * 3;
      const x = anchor.x + Math.cos(angle) * radius / ASPECT;
      const y = anchor.y + Math.sin(angle) * radius;
      if (!room.world.isWalkable(x, y) || !room.world.isWalkable(x - 1.2, y)
        || !room.world.isWalkable(x + 1.2, y)) continue;
      if ([...room.players.values()].some((p) => Math.hypot((p.state.x - x) * ASPECT, p.state.y - y) < 4)) continue;
      return { x, y };
    }
    return room.world.spawn;
  }

  function join(socket, session, request) {
    if (session.player) return fail(socket, 'Leave your current lobby before joining another.');
    if (request.version !== PROTOCOL_VERSION) return fail(socket, 'Refresh the game to use this lobby server.');
    let room;
    if (request.type === 'create') {
      if (rooms.size >= maxRooms) return fail(socket, 'The server is busy. Try again shortly.');
      const seed = cleanSeed(request.seed);
      room = { code: newCode(), seed, world: new World(seed), createdAt: Date.now(), players: new Map() };
      rooms.set(room.code, room);
    } else {
      if (!validCode(request.code)) return fail(socket, 'Enter a six-character lobby code.');
      room = rooms.get(cleanCode(request.code));
      if (!room) return fail(socket, 'Lobby not found. Check the code or create a new lobby.');
    }
    let player = typeof request.token === 'string' ? [...room.players.values()]
      .find((p) => p.token === request.token && !p.socket && p.expires > Date.now()) : null;
    const resumed = !!player;
    if (!player) {
      // Expired reservations should never prevent a new friend joining.
      for (const p of room.players.values()) {
        if (!p.socket && p.expires <= Date.now()) room.players.delete(p.id);
      }
      if (room.players.size >= MAX_PLAYERS) return fail(socket, `This lobby is full (${MAX_PLAYERS} players).`);
      const color = Array.from({ length: MAX_PLAYERS }, (_, i) => i)
        .find((i) => ![...room.players.values()].some((p) => p.color === i));
      const { x, y } = spawnFor(room);
      player = { id: randomBytes(8).toString('hex'), token: randomBytes(24).toString('hex'),
        name: cleanName(request.name), color, state: playerState(new Player(x, y)) };
      room.players.set(player.id, player);
    }
    player.socket = socket;
    player.expires = null;
    session.room = room;
    session.player = player;
    clearTimeout(session.timeout);
    const players = members(room);
    send(socket, { type: 'joined', code: room.code, seed: room.seed, id: player.id,
      token: player.token, resumed, maxPlayers: MAX_PLAYERS, time: (Date.now() - room.createdAt) / 1000,
      self: players.find((p) => p.id === player.id), players });
    broadcast(room);
  }

  wss.on('connection', (socket) => {
    if (connections.size >= 256) return socket.close(1013, 'Server busy');
    const session = { room: null, player: null, alive: true, tokens: 120, lastMessage: Date.now(), lastState: 0 };
    connections.set(socket, session);
    session.timeout = setTimeout(() => socket.close(1008, 'Join a lobby first'), 10000);
    session.timeout.unref();
    socket.on('error', () => {}); // Close handles cleanup, including malformed WebSocket frames.
    socket.on('pong', () => { session.alive = true; });
    socket.on('message', (data, binary) => {
      const now = Date.now();
      session.tokens = Math.min(120, session.tokens + (now - session.lastMessage) * 0.08) - 1;
      session.lastMessage = now;
      if (session.tokens < 0) return socket.close(1008, 'Too many messages');
      if (binary) return fail(socket, 'Lobby messages must be JSON text.');
      let request;
      try { request = JSON.parse(data.toString()); }
      catch { return fail(socket, 'Invalid lobby message.'); }
      if (!request || typeof request !== 'object' || Array.isArray(request)) return fail(socket, 'Invalid lobby message.');
      if (request.type === 'create' || request.type === 'join') join(socket, session, request);
      else if (request.type === 'leave') {
        remove(session, false);
        socket.close(1000, 'Left lobby');
      } else if (request.type === 'state' && session.player && now - session.lastState >= 20) {
        const state = readPlayerState(request.state);
        if (state) {
          session.player.state = state;
          session.lastState = now;
        }
      }
    });
    socket.on('close', () => {
      clearTimeout(session.timeout);
      remove(session, true);
      connections.delete(socket);
    });
  });

  const tick = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      for (const p of room.players.values()) if (!p.socket && p.expires <= now) room.players.delete(p.id);
      if (room.players.size === 0) rooms.delete(room.code);
      else broadcast(room);
    }
  }, UPDATE_MS);
  const heartbeat = setInterval(() => {
    for (const [socket, session] of connections) {
      if (!session.alive) socket.terminate();
      else { session.alive = false; socket.ping(); }
    }
  }, 15000);
  tick.unref();
  heartbeat.unref();

  return { rooms, dispose() {
    clearInterval(tick);
    clearInterval(heartbeat);
    for (const session of connections.values()) clearTimeout(session.timeout);
  } };
}
