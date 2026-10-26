import { readChat, readChatNotice } from './chat.js';
import { cleanCode, cleanName, cleanSeed, lobbyServerUrl, MAX_PLAYERS, PROTOCOL_VERSION, readMembers, readNote,
  RollingLimit, UPDATE_MS, validCode } from './protocol.js';
import { parseTint } from './tint.js';

const validId = (id) => typeof id === 'string' && /^[0-9a-f]{1,32}$/.test(id);

export class MultiplayerClient {
  // Sends a lobby message if the connection is up and not backed up.
  sendNow(message) {
    if (this.status !== 'online' || this.socket?.readyState !== 1 || this.socket.bufferedAmount >= 32768) return false;
    this.socket.send(JSON.stringify(message));
    return true;
  }
  sendCast(cast) { this.sendNow({ type: 'spellcast', cast }); }
  // Chat goes through the server, which echoes it back: false means it
  // wasn't sent at all.
  sendChat(channel, text) { return this.sendNow({ type: 'chat', channel, text }); }
  toggleChat(channel) { return this.sendNow({ type: 'chat-toggle', channel }); }
  // A played note, for friends to hear. The server's 20-a-second window is
  // kept here too, so a note it would drop is never sent; the window isn't
  // reset by a reconnect, as the server's isn't. False means not sent.
  sendNote(note) {
    const clean = readNote(note);
    if (!clean || this.status !== 'online' || this.socket?.readyState !== 1 || this.socket.bufferedAmount >= 32768) return false;
    if (!this.noteLimit.allow(this.now())) return false;
    return this.sendNow({ type: 'note', note: clean });
  }
  // The player's name colour, or null for the automatic one. It goes with
  // every join, and straight to the lobby when it changes there.
  setTint(tint) {
    this.tint = parseTint(tint);
    this.sendNow({ type: 'tint', tint: this.tint });
  }
  constructor({ getState, onJoin = () => {}, onSnapshot = () => {}, onChange = () => {},
    WebSocketImpl = globalThis.WebSocket, baseUrl = globalThis.location?.href,
    connectionTimeout = 8000, retryDelay = 1000, now = () => performance.now() } = {}) {
    Object.assign(this, { getState, onJoin, onSnapshot, onChange, WebSocketImpl, baseUrl, connectionTimeout, retryDelay, now });
    this.noteLimit = new RollingLimit();
    this.status = 'offline';
    this.message = 'Play solo, create a lobby, or join with a code.';
    this.room = null;
    this.players = [];
    this.socket = null;
    this.id = null;
    this.token = null;
    this.retry = 0;
    this.tint = null;
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
        code: this.room.code, token: this.token, name: this.options.name, tint: this.tint }
        : { type: this.options.mode, version: PROTOCOL_VERSION, name: this.options.name,
          seed: this.options.seed, code: this.options.code, tint: this.tint }));
    });
    socket.addEventListener('message', (event) => {
      if (this.socket !== socket) return;
      let message;
      try { message = JSON.parse(event.data); }
      catch { return; }
      if (!message || typeof message !== 'object') return;
      if (message.type === 'error') {
        this.fail(typeof message.message === 'string' ? message.message.slice(0, 200) : 'Could not join this lobby.');
      } else if (message.type === 'joined') {
        if (!validCode(message.code) || !message.self || !Array.isArray(message.players) || !validId(message.id)) return;
        const seed = cleanSeed(message.seed);
        clearTimeout(this.timeout);
        const maxPlayers = Number.isInteger(message.maxPlayers) ? Math.min(MAX_PLAYERS, Math.max(1, message.maxPlayers)) : MAX_PLAYERS;
        this.room = { code: message.code, seed, maxPlayers };
        this.id = message.id;
        this.token = typeof message.token === 'string' ? message.token.slice(0, 128) : null;
        this.retry = 0;
        this.players = readMembers(message.players);
        const self = this.players.find((p) => p.id === this.id);
        // Those already here aren't announced; changes from now on are.
        this.known = new Map(this.players.map((p) => [p.id, p]));
        this.onRoster?.({ self: true, code: message.code, resumed: message.resumed === true });
        this.onJoin({ code: message.code, seed, id: this.id, self: self?.state ?? null });
        if (this.socket !== socket) return;
        this.onSnapshot(this.players, this.id);
        if (this.socket !== socket) return;
        this.setStatus('online', 'Connected. Share the lobby code with your friends.');
        if (this.socket !== socket) return;
        clearInterval(this.sendTimer);
        this.sendTimer = setInterval(() => this.sendState(), UPDATE_MS);
        this.sendState();
      } else if (message.type === 'spellcast' && this.room && typeof message.casterId === 'string') {
        this.onCast?.(message);
      } else if (message.type === 'note' && this.room && validId(message.from) && message.from !== this.id) {
        const note = readNote(message.note);
        if (note) this.onNote?.({ from: message.from, note });
      } else if (message.type === 'chat' && this.room) {
        const line = readChat(message);
        if (line) this.onChat?.(line);
      } else if (message.type === 'chat-notice' && this.room) {
        const notice = readChatNotice(message);
        if (notice) this.onChatNotice?.(notice);
      } else if (message.type === 'snapshot' && this.room && Array.isArray(message.players)) {
        // A new name colour redraws the lobby panel, but isn't a join.
        const roster = () => this.players.map((p) => `${p.id}:${p.name}:${p.tag}:${p.tint}`).join('|');
        const before = roster();
        this.players = readMembers(message.players);
        this.onSnapshot(this.players, this.id);
        const after = roster();
        if (before !== after) {
          this.diffRoster();
          this.onChange(this);
        }
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

  // Tells the chat who joined and who left since the last roster.
  diffRoster() {
    const now = new Map(this.players.map((p) => [p.id, p]));
    const joined = this.players.filter((p) => !this.known.has(p.id));
    const left = [...this.known.values()].filter((p) => !now.has(p.id));
    this.known = now;
    if (joined.length || left.length) this.onRoster?.({ joined, left });
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

  fail(message) {
    this.leave(false);
    this.setStatus('error', message);
  }

  leave(notify = true) {
    this.clearTimers();
    if (this.room) this.onRoster?.({ left: 'self' });
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
