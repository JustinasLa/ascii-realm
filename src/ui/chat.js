// The lobby chat: a log in the lower left and a bar to type into. Enter (or
// `/`, already typed) opens the bar on desktop; phones have a CHAT button.
// Every line is built from text nodes, never markup, so nothing a player
// types can become part of the page.
import { CHAT_CHANNELS, CHAT_LOG_LINES, DEFAULT_CHANNEL, HELP_LINES, noticeText, parseChatInput,
  SWITCHABLE } from '../multiplayer/chat.js';
import { displayName } from '../multiplayer/protocol.js';

// Seconds a line stays fully visible while the bar is closed, and the second
// over which it then fades away.
export const LINE_SHOWN = 9;
export const LINE_FADE = 1;
const SENT_HISTORY = 100;
// One log line's height in CSS pixels: a reader this close to the bottom is
// following along, and new lines keep them there.
const LINE_HEIGHT = 16;
// Milliseconds after the closing press lifts in which its click, auxclick or
// contextmenu may still arrive (a touch's click comes a little later).
const GESTURE_TAIL = 500;
// What a pressed mouse or finger may still send after its pointerdown.
const GESTURE_EVENTS = ['mousedown', 'mouseup', 'click', 'auxclick', 'contextmenu'];

// How each channel's line reads: an optional [tag], a lead before the name,
// the words after it and a close after the message. Out-of-character lines
// show the name uncoloured.
const FORMATS = {
  rp: { after: ': "', close: '"' },
  shout: { after: ' shouts: "', close: '"' },
  yell: { after: ' yells: "', close: '"' },
  whisper: { after: ' whispers: "', close: '"' },
  looc: { tag: 'LOOC', after: ': ', plainName: true },
  ooc: { tag: 'OOC', after: ': ', plainName: true },
  action: { lead: '* ', after: ' ' },
  scene: { tag: 'Scene', after: ': *', close: '*' },
};
const ERRORS = new Set(['unheard', 'rate', 'too-long', 'hidden', 'invalid']);

const defaultControl = (target) => ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target?.tagName)
  || Boolean(target?.isContentEditable);

export class ChatUi {
  constructor({ doc = document, win = window, phone = { phone: false }, client, scene = null, mayOpen = () => true,
    isCovered = () => false, onToggle = () => {}, colorOf = () => null, isControlTarget = defaultControl } = {}) {
    Object.assign(this, { doc, win, phone, client, scene, mayOpen, isCovered, onToggle, colorOf, isControlTarget });
    const $ = (id) => doc.getElementById(id);
    this.root = $('chat');
    this.log = $('chat-log');
    this.bar = $('chat-bar');
    this.select = $('chat-channel');
    this.input = $('chat-input');
    this.openButton = $('chat-open');
    this.lines = [];
    this.sent = [];
    this.historyAt = 0;
    this.available = false;
    this._open = false;
    this.active = DEFAULT_CHANNEL;
    this.hidden = new Set();
    // The press that closed the bar, until it has finished.
    this.gesture = null;
    for (const id of SWITCHABLE) {
      const option = doc.createElement('option');
      option.value = id;
      option.textContent = CHAT_CHANNELS[id].label;
      this.select.append(option);
    }
    this.setChannel(DEFAULT_CHANNEL);
    this.bar.addEventListener('submit', (event) => {
      event.preventDefault();
      this.submit();
    });
    this.input.addEventListener('keydown', (event) => this.barKey(event));
    this.select.addEventListener('change', () => {
      this.setChannel(this.select.value);
      this.input.focus({ preventScroll: true });
    });
    $('chat-close').addEventListener('click', () => this.close());
    // Inside the tap, so phones raise the keyboard.
    this.openButton.addEventListener('click', () => this.open());
    win.addEventListener('keydown', (event) => this.key(event));
    // Escape closes the bar wherever focus has wandered, unless a panel
    // already took the key or one opened over the chat (the builder from its
    // toolbar): that panel closes first, and chat on the next Escape.
    doc.addEventListener('keydown', (event) => {
      if (!this._open || event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      if (!this.root.contains(doc.activeElement) && this.isCovered()) return;
      event.preventDefault();
      // The window's handlers come after the document's; none of them may
      // take this Escape as well.
      event.stopPropagation();
      this.close();
    });
    // A click or tap on the scene puts the bar away, and only that: with any
    // button or finger, the whole press is chat's, so it never also strikes,
    // aims, builds or opens the rune wheel.
    scene?.addEventListener('pointerdown', (event) => {
      if (!this._open) return;
      // No compatibility mousedown or mouseup follows a cancelled pointerdown.
      event.preventDefault();
      event.stopImmediatePropagation();
      this.gesture = { id: event.pointerId, endsAt: Infinity };
      this.close();
    });
    // Listening on the window in the capture phase, ahead of everyone else,
    // to swallow what the press still sends: a click, an auxclick, a menu.
    win.addEventListener('pointerdown', () => { this.gesture = null; }, true);
    const lifted = (event) => {
      if (this.gesture?.id === event.pointerId) this.gesture.endsAt = event.timeStamp + GESTURE_TAIL;
    };
    win.addEventListener('pointerup', lifted, true);
    win.addEventListener('pointercancel', lifted, true);
    for (const type of GESTURE_EVENTS) win.addEventListener(type, (event) => this.swallow(event), true);
    win.addEventListener('pagehide', () => this.close({ keepDraft: true }));
    // The on-screen keyboard shrinks the visual viewport; the bar rides on it.
    const viewport = win.visualViewport;
    const follow = () => {
      const covered = Math.max(0, Math.round(win.innerHeight - viewport.height - viewport.offsetTop));
      doc.documentElement.style.setProperty('--chat-kb', `${covered}px`);
    };
    viewport?.addEventListener('resize', follow);
    viewport?.addEventListener('scroll', follow);
  }

  get isOpen() { return this._open; }

  // Mouse events carry no pointer id; a click from the keyboard has its own.
  swallow(event) {
    const { gesture } = this;
    if (!gesture) return;
    if (event.timeStamp > gesture.endsAt) {
      this.gesture = null;
      return;
    }
    if (event.pointerId !== undefined && event.pointerId !== gesture.id) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  // Chat exists only in a lobby.
  setAvailable(available) {
    this.available = Boolean(available);
    this.root.hidden = !this.available;
    this.openButton.hidden = !this.available;
    if (!this.available) this.close();
  }

  setChannel(id) {
    this.active = id;
    this.select.value = id;
    this.input.placeholder = CHAT_CHANNELS[id].placeholder;
  }

  key(event) {
    if (this._open || !this.available || event.defaultPrevented || event.repeat || event.isComposing) return;
    if (event.ctrlKey || event.metaKey || event.altKey || this.isControlTarget(event.target)) return;
    if (event.key !== 'Enter' && event.key !== '/') return;
    if (!this.mayOpen()) return;
    // The key that opens the bar must not also submit it or type itself.
    event.preventDefault();
    this.open(event.key === '/' ? '/' : '');
  }

  barKey(event) {
    if (event.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      this.browse(event.key === 'ArrowUp' ? -1 : 1);
    }
  }

  // Steps through what was sent, newest first, back to an empty bar.
  browse(step) {
    const at = Math.max(0, Math.min(this.sent.length, this.historyAt + step));
    if (at === this.historyAt) return;
    this.historyAt = at;
    this.input.value = this.sent[at] ?? '';
  }

  open(prefill = '') {
    if (!this.available || this._open || !this.mayOpen()) return;
    this._open = true;
    if (prefill) this.input.value = prefill;
    this.historyAt = this.sent.length;
    this.bar.hidden = false;
    this.root.classList.add('open');
    this.doc.body.classList.add('chat-open');
    this.input.focus({ preventScroll: true });
    this.onToggle(true);
    this.log.scrollTop = this.log.scrollHeight;
  }

  // Escape, the close button or a tap on the scene throw the draft away;
  // the page being hidden keeps it.
  close({ keepDraft = false } = {}) {
    if (!this._open) return;
    this._open = false;
    if (!keepDraft) this.input.value = '';
    this.bar.hidden = true;
    this.root.classList.remove('open');
    this.doc.body.classList.remove('chat-open');
    this.input.blur?.();
    this.onToggle(false);
  }

  submit() {
    const raw = this.input.value;
    if (raw.trim()) {
      if (this.sent.at(-1) !== raw) this.sent.push(raw);
      if (this.sent.length > SENT_HISTORY) this.sent.shift();
    }
    const result = parseChatInput(raw, { active: this.active, hidden: this.hidden });
    this.close();
    if (result.kind === 'send') {
      if (!this.client.sendChat(result.channel, result.text)) this.system(noticeText('offline'), 'error');
    } else if (result.kind === 'toggle') {
      if (!this.client.toggleChat(result.channel)) this.system(noticeText('offline'), 'error');
    } else if (result.kind === 'switch') {
      this.setChannel(result.channel);
      this.system(noticeText('switched', result));
    } else if (result.kind === 'show-channel') {
      this.system(noticeText('show-channel', result));
    } else if (result.kind === 'help') {
      for (const line of HELP_LINES) this.system(line);
    } else if (result.kind === 'error') {
      this.system(noticeText(result.code, result), 'error');
    }
  }

  span(text, className) {
    const node = this.doc.createElement('span');
    node.className = className;
    node.textContent = text;
    return node;
  }

  // A player's name, isolated so a right-to-left one keeps its tag after it.
  speaker(member, className) {
    const node = this.span('', className);
    node.append(Object.assign(this.doc.createElement('bdi'), { textContent: member.name }));
    if (member.tag) node.append(this.span(` (${member.tag})`, 'chat-name-tag'));
    return node;
  }

  // A reader scrolled back through the log stays where they are.
  add(node) {
    const log = this.log;
    const following = log.scrollHeight - log.scrollTop - log.clientHeight <= LINE_HEIGHT;
    log.append(node);
    const line = { node, age: 0 };
    this.lines.push(line);
    while (this.lines.length > CHAT_LOG_LINES) this.lines.shift().node.remove();
    if (following) log.scrollTop = log.scrollHeight;
    return line;
  }

  // A relayed line. `roster` gives the speaker's name colour; the line keeps
  // the colour it was written in.
  receive(message, roster = []) {
    const item = this.doc.createElement('li');
    item.className = `chat-line chat-${message.channel}`;
    if (message.muffled) {
      item.classList.add('chat-muffled');
      item.append(this.span(message.text, 'chat-text'));
      return this.add(item);
    }
    const format = FORMATS[message.channel];
    if (format.tag) {
      item.append(this.span('[', 'chat-bracket'), this.span(format.tag, 'chat-tag'), this.span('] ', 'chat-bracket'));
    }
    if (format.lead) item.append(this.span(format.lead, 'chat-lead'));
    const name = this.speaker(message, 'chat-name');
    const member = format.plainName ? null : roster.find((m) => m.id === message.from);
    const tint = member ? this.colorOf(member) : null;
    if (tint) name.style.color = `rgb(${tint[0]}, ${tint[1]}, ${tint[2]})`;
    item.append(name, this.span(format.after, 'chat-punct'), this.span(message.text, 'chat-text'));
    if (format.close) item.append(this.span(format.close, 'chat-punct'));
    return this.add(item);
  }

  // A quiet line from the page itself, or a red one for an error.
  system(text, kind = 'info') {
    const item = this.doc.createElement('li');
    item.className = `chat-line chat-system${kind === 'error' ? ' chat-error' : ''}`;
    item.append(this.span(`· ${text}`, 'chat-text'));
    return this.add(item);
  }

  notice(notice) {
    if (notice.code === 'toggled') {
      if (notice.hidden) this.hidden.add(notice.channel);
      else this.hidden.delete(notice.channel);
    }
    this.system(noticeText(notice.code, notice), ERRORS.has(notice.code) ? 'error' : 'info');
  }

  // Joins and leaves, worked out from the lobby's roster. A join that isn't
  // a resume is a fresh player on the server, with nothing hidden.
  roster(change) {
    if (change.self) {
      if (!change.resumed) this.hidden.clear();
      this.system(change.resumed ? `Reconnected to lobby ${change.code}.` : `Joined lobby ${change.code}.`);
      return;
    }
    if (change.left === 'self') {
      this.system('Left the lobby.');
      this.reset();
      return;
    }
    for (const member of change.joined ?? []) this.system(`${displayName(member)} joined the lobby.`);
    for (const member of change.left ?? []) this.system(`${displayName(member)} left the lobby.`);
  }

  // A new lobby starts on the default channel with nothing hidden.
  reset() {
    this.close();
    this.setChannel(DEFAULT_CHANNEL);
    this.hidden.clear();
  }

  // Lines fade out a few seconds after they arrive; the open log still
  // shows them all.
  update(dt) {
    for (const line of this.lines) {
      if (line.gone) continue;
      line.age += dt;
      const fade = Math.max(0, Math.min(1, (LINE_SHOWN + LINE_FADE - line.age) / LINE_FADE));
      const opacity = fade < 1 ? String(Math.round(fade * 100) / 100) : '';
      if (opacity !== line.node.style.opacity) line.node.style.opacity = opacity;
      if (fade <= 0) {
        line.gone = true;
        line.node.classList.add('faded');
      }
    }
  }
}
