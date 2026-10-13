import { cleanCode, cleanName, cleanSeed, lobbyServerUrl, PROTOCOL_VERSION, UPDATE_MS,
  validCode } from './protocol.js';

export class MultiplayerClient {
  constructor({ getState, onJoin = () => {}, onSnapshot = () => {}, onChange = () => {},
    WebSocketImpl = globalThis.WebSocket, baseUrl = globalThis.location?.href,
    connectionTimeout = 8000, retryDelay = 1000 } = {}) {
    Object.assign(this, { getState, onJoin, onSnapshot, onChange, WebSocketImpl, baseUrl, connectionTimeout, retryDelay });
    this.status = 'offline';
    this.message = 'Play solo, create a lobby, or join with a code.';
    this.room = null;
    this.players = [];
    this.socket = null;
    this.id = null;
    this.token = null;
    this.retry = 0;
  }

  connect({ mode, name, seed, code, server = '' }) {
    this.leave(false);
    try {
      if (!['create', 'join'].includes(mode)) throw new Error('Choose Create lobby or Join lobby.');
      if (mode === 'join' && !validCode(code)) throw new Error('Enter a six-character lobby code.');
      this.options = { mode, name: cleanName(name), seed: cleanSeed(seed), code: cleanCode(code),
        server: lobbyServerUrl(server, this.baseUrl) };
      this.open(false);
    } catch (error) { this.fail(error.message); }
  }

  setStatus(status, message) {
    this.status = status;
    this.message = message;
    this.onChange(this);
  }

  clearTimers() {
    clearTimeout(this.timeout);
    clearTimeout(this.retryTimer);
    clearInterval(this.sendTimer);
  }

  open(resuming) {
    this.clearTimers();
    this.setStatus(resuming ? 'reconnecting' : 'connecting', resuming
      ? 'Connection interrupted. Reconnecting to your lobby…' : 'Connecting to the lobby server…');
    let socket;
    try { socket = new this.WebSocketImpl(this.options.server); }
    catch { this.fail('Could not connect. Check the address under Lobby server.'); return; }
    this.socket = socket;
    this.timeout = setTimeout(() => {
      if (this.socket !== socket) return;
      this.socket = null;
      socket.close();
      if (this.room) this.reconnect();
      else this.fail('Could not reach the lobby server. Check its address under Lobby server.');
    }, this.connectionTimeout);
    socket.addEventListener('open', () => {
      if (this.socket !== socket) return;
      socket.send(JSON.stringify(resuming ? { type: 'join', version: PROTOCOL_VERSION,
        code: this.room.code, token: this.token, name: this.options.name }
        : { type: this.options.mode, version: PROTOCOL_VERSION, name: this.options.name,
          seed: this.options.seed, code: this.options.code }));
    });
    socket.addEventListener('message', (event) => {
      if (this.socket !== socket) return;
      let message;
      try { message = JSON.parse(event.data); }
      catch { return; }
      if (!message || typeof message !== 'object') return;
      if (message.type === 'error') {
        this.fail(typeof message.message === 'string' ? message.message : 'Could not join this lobby.');
      } else if (message.type === 'joined') {
        if (!validCode(message.code) || !message.self || !Array.isArray(message.players)) return;
        clearTimeout(this.timeout);
        this.room = { code: message.code, seed: message.seed, maxPlayers: message.maxPlayers };
        this.id = message.id;
        this.token = message.token;
        this.retry = 0;
        this.players = message.players;
        this.clock = { time: message.time, at: performance.now() };
        this.onJoin(message);
        this.onSnapshot(this.players, this.id);
        this.setStatus('online', 'Connected. Share the lobby code with your friends.');
        clearInterval(this.sendTimer);
        this.sendTimer = setInterval(() => this.sendState(), UPDATE_MS);
        this.sendState();
      } else if (message.type === 'snapshot' && this.room && Array.isArray(message.players)) {
        const before = this.players.map((p) => `${p.id}:${p.name}`).join('|');
        this.players = message.players;
        this.clock = { time: message.time, at: performance.now() };
        this.onSnapshot(this.players, this.id);
        const after = this.players.map((p) => `${p.id}:${p.name}`).join('|');
        if (before !== after) this.onChange(this);
      }
    });
    socket.addEventListener('error', () => {}); // The close event owns retries and the user-facing error.
    socket.addEventListener('close', () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.clearTimers();
      if (this.room) this.reconnect();
      else this.fail('Could not reach the lobby server. Check its address under Lobby server.');
    });
  }

  sendState() {
    if (this.status !== 'online' || this.socket?.readyState !== 1 || this.socket.bufferedAmount > 32768) return;
    const state = this.getState?.();
    if (state) this.socket.send(JSON.stringify({ type: 'state', state }));
  }

  reconnect() {
    if (this.retry >= 5) {
      this.fail('Connection lost. Enter the lobby code to join again.');
      return;
    }
    this.setStatus('reconnecting', 'Connection interrupted. Reconnecting to your lobby…');
    const delay = Math.min(8000, this.retryDelay * 2 ** this.retry++);
    this.retryTimer = setTimeout(() => this.open(true), delay);
  }

  worldTime(fallback) {
    return this.status === 'online' && Number.isFinite(this.clock?.time)
      ? this.clock.time + (performance.now() - this.clock.at) / 1000 : fallback;
  }

  fail(message) {
    this.leave(false);
    this.setStatus('error', message);
  }

  leave(notify = true) {
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      if (socket.readyState === 1) socket.send(JSON.stringify({ type: 'leave' }));
      socket.close();
    }
    this.room = null;
    this.id = null;
    this.token = null;
    this.players = [];
    this.retry = 0;
    this.status = 'offline';
    this.message = 'Playing solo. Create a lobby or join with a code.';
    this.onSnapshot([], null);
    if (notify) this.onChange(this);
  }
}
