import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHAT_LOG_LINES, HELP_LINES, SWITCHABLE } from '../src/multiplayer/chat.js';
import { ChatUi, LINE_FADE, LINE_SHOWN } from '../src/ui/chat.js';

// Just enough DOM for the chat: elements are event targets with children,
// classes, a style and text. Markup is refused, so any HTML use fails.
class El extends EventTarget {
  constructor(tagName, doc) {
    super();
    Object.assign(this, { tagName: tagName.toUpperCase(), doc, children: [], parentNode: null, style: {},
      hidden: false, value: '', placeholder: '', className: '', scrollTop: 0, scrollHeight: 0, clientHeight: 0,
      _text: '' });
    const tokens = () => new Set(this.className.split(/\s+/).filter(Boolean));
    this.classList = {
      contains: (name) => tokens().has(name),
      add: (...names) => { this.className = [...new Set([...tokens(), ...names])].join(' '); },
      remove: (...names) => { this.className = [...tokens()].filter((n) => !names.includes(n)).join(' '); },
    };
  }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  set textContent(value) { this.children = []; this._text = String(value); }
  set innerHTML(_) { throw new Error('chat must never use innerHTML'); }
  insertAdjacentHTML() { throw new Error('chat must never use insertAdjacentHTML'); }
  append(...nodes) {
    for (const node of nodes) {
      node.remove();
      node.parentNode = this;
      this.children.push(node);
    }
    this.scrollHeight = this.children.length * 16;
  }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
    this.parentNode = null;
  }
  contains(node) {
    for (let at = node; at; at = at.parentNode) if (at === this) return true;
    return false;
  }
  focus() { this.doc.activeElement = this; this.doc.focusCalls.push(this.id); }
  blur() { if (this.doc.activeElement === this) this.doc.activeElement = null; }
  click() { this.dispatchEvent(new Event('click')); }
}

function setup({ phone = false, viewport = null, inLobby = true, mayOpen = () => true, isCovered, sendOk = true } = {}) {
  const ids = {};
  const bodyClasses = new Set();
  const rootStyle = {};
  const doc = Object.assign(new EventTarget(), {
    activeElement: null,
    focusCalls: [],
    body: { classList: { add: (c) => bodyClasses.add(c), remove: (c) => bodyClasses.delete(c) } },
    documentElement: { style: { setProperty: (k, v) => { rootStyle[k] = v; } } },
    createElement: (tag) => new El(tag, doc),
    getElementById: (id) => ids[id],
  });
  for (const [id, tag] of Object.entries({ chat: 'section', 'chat-log': 'ol', 'chat-bar': 'form', 'chat-channel': 'select',
    'chat-input': 'input', 'chat-send': 'button', 'chat-close': 'button', 'chat-open': 'button' })) {
    ids[id] = new El(tag, doc);
    ids[id].id = id;
  }
  ids['chat-bar'].hidden = true;
  ids.chat.append(ids['chat-log'], ids['chat-bar']);
  ids['chat-bar'].append(ids['chat-channel'], ids['chat-input'], ids['chat-send'], ids['chat-close']);
  const win = Object.assign(new EventTarget(), { innerHeight: 800, visualViewport: viewport });
  const sent = [];
  const toggled = [];
  const client = {
    sendChat: (channel, text) => { sent.push([channel, text]); return sendOk; },
    toggleChat: (channel) => { toggled.push(channel); return sendOk; },
  };
  const toggles = [];
  const scene = new EventTarget();
  const chat = new ChatUi({ doc, win, phone: { phone }, client, scene, mayOpen, isCovered, onToggle: (open) => toggles.push(open),
    colorOf: (member) => [[169, 212, 174], [146, 198, 235]][member.color] });
  chat.setAvailable(inLobby);
  const key = (key, { target = null, ...extra } = {}) => {
    const event = Object.assign(new Event('keydown', { cancelable: true }), { key, ...extra });
    // The page's key handler is on the window; the focused element is the target.
    Object.defineProperty(event, 'target', { value: target });
    win.dispatchEvent(event);
    return event;
  };
  const barKey = (key, extra = {}) => {
    const event = Object.assign(new Event('keydown', { cancelable: true }), { key, ...extra });
    ids['chat-input'].dispatchEvent(event);
    return event;
  };
  const type = (text) => {
    ids['chat-input'].value = text;
    const event = new Event('submit', { cancelable: true });
    ids['chat-bar'].dispatchEvent(event);
    return event;
  };
  const lines = () => ids['chat-log'].children.map((li) => li.textContent);
  return { chat, doc, win, scene, ids, sent, toggled, toggles, key, barKey, type, lines, bodyClasses, rootStyle };
}

test('Enter opens the bar only in a lobby and when nothing else is in the way', () => {
  let allowed = false;
  const ui = setup({ mayOpen: () => allowed });
  assert.equal(ui.key('Enter').defaultPrevented, false);
  assert.equal(ui.chat.isOpen, false);
  allowed = true;
  for (const extra of [{ repeat: true }, { isComposing: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true },
    { target: { tagName: 'INPUT' } }, { target: { tagName: 'DIV', isContentEditable: true } }]) {
    ui.key('Enter', extra);
    assert.equal(ui.chat.isOpen, false, JSON.stringify(extra));
  }
  const pre = new Event('keydown', { cancelable: true });
  Object.assign(pre, { key: 'Enter' });
  pre.preventDefault();
  ui.win.dispatchEvent(pre);
  assert.equal(ui.chat.isOpen, false, 'a key another control used');
  ui.key('a');
  assert.equal(ui.chat.isOpen, false);
  const opened = ui.key('Enter');
  assert.equal(opened.defaultPrevented, true, 'the opening Enter cannot also submit');
  assert.equal(ui.chat.isOpen, true);
  assert.equal(ui.ids['chat-bar'].hidden, false);
  assert.equal(ui.ids['chat-input'].value, '');
  assert.equal(ui.doc.activeElement, ui.ids['chat-input']);
  assert.ok(ui.bodyClasses.has('chat-open'));
  assert.ok(ui.ids.chat.classList.contains('open'));
  assert.deepEqual(ui.toggles, [true]);
  ui.key('Enter');
  ui.chat.open();
  assert.deepEqual(ui.toggles, [true], 'already open');

  const solo = setup({ inLobby: false });
  solo.key('Enter');
  solo.chat.open();
  assert.equal(solo.chat.isOpen, false);
  assert.equal(solo.ids.chat.hidden, true);
  assert.equal(solo.ids['chat-open'].hidden, true);
});

test('/ opens the bar with the slash typed; Escape and the close button drop the draft', () => {
  const ui = setup();
  assert.equal(ui.key('/').defaultPrevented, true);
  assert.equal(ui.ids['chat-input'].value, '/');
  ui.ids['chat-input'].value = '/me waves';
  ui.barKey('Escape', { isComposing: true });
  assert.equal(ui.chat.isOpen, true, 'an IME is still composing');
  assert.equal(ui.barKey('Escape').defaultPrevented, true);
  assert.equal(ui.chat.isOpen, false);
  assert.equal(ui.ids['chat-input'].value, '');
  assert.equal(ui.ids['chat-bar'].hidden, true);
  assert.equal(ui.bodyClasses.has('chat-open'), false);
  ui.key('Enter');
  ui.ids['chat-input'].value = 'draft';
  ui.ids['chat-close'].click();
  assert.equal(ui.ids['chat-input'].value, '');
  ui.key('Enter');
  ui.ids['chat-input'].value = 'kept';
  ui.win.dispatchEvent(new Event('pagehide'));
  assert.equal(ui.chat.isOpen, false);
  assert.equal(ui.ids['chat-input'].value, 'kept', 'hiding the page keeps the draft');
  ui.chat.close();
  assert.deepEqual(ui.toggles, [true, false, true, false, true, false]);
  ui.barKey('x');
});

test('Enter sends on the active channel, closes, and remembers what was sent', () => {
  const ui = setup();
  ui.key('Enter');
  const submitted = ui.type('  hello there ');
  assert.equal(submitted.defaultPrevented, true);
  assert.deepEqual(ui.sent, [['rp', 'hello there']]);
  assert.equal(ui.chat.isOpen, false);
  assert.equal(ui.ids['chat-input'].value, '');
  ui.key('Enter');
  ui.type('/shout over here');
  ui.key('Enter');
  ui.type('/shout over here');
  ui.key('Enter');
  ui.type('   ');
  assert.deepEqual(ui.sent.at(-1), ['shout', 'over here']);
  assert.equal(ui.chat.isOpen, false, 'an empty line just closes');
  ui.key('Enter');
  ui.barKey('ArrowDown');
  assert.equal(ui.ids['chat-input'].value, '');
  ui.barKey('ArrowUp');
  assert.equal(ui.ids['chat-input'].value, '/shout over here', 'repeats are kept once');
  ui.barKey('ArrowUp');
  assert.equal(ui.ids['chat-input'].value, '  hello there ');
  ui.barKey('ArrowUp');
  assert.equal(ui.ids['chat-input'].value, '  hello there ');
  assert.equal(ui.barKey('ArrowDown').defaultPrevented, true);
  ui.barKey('ArrowDown');
  assert.equal(ui.ids['chat-input'].value, '');
  for (let i = 0; i < 105; i++) {
    ui.key('Enter');
    ui.type(`line ${i}`);
  }
  assert.equal(ui.chat.sent.length, 100);
  assert.equal(ui.chat.sent[0], 'line 5');
});

test('commands switch and toggle channels; local errors are shown and nothing is sent', () => {
  const ui = setup();
  assert.deepEqual(ui.ids['chat-channel'].children.map((o) => o.value), SWITCHABLE);
  assert.equal(ui.ids['chat-channel'].children[1].textContent, 'OOC (whole lobby)');
  assert.equal(ui.ids['chat-input'].placeholder, 'Say something…');
  const run = (text) => { ui.key('Enter'); ui.type(text); };
  run('/channel');
  run('/channel me');
  assert.equal(ui.chat.active, 'action');
  assert.equal(ui.ids['chat-channel'].value, 'action');
  assert.equal(ui.ids['chat-input'].placeholder, 'Describe an action…');
  run('waves');
  run('/channel me');
  run('/channeltoggle ooc');
  run('/shout');
  run('/dance');
  run('/help');
  assert.deepEqual(ui.sent, [['action', 'waves']]);
  assert.deepEqual(ui.toggled, ['ooc']);
  assert.deepEqual(ui.lines().slice(0, 6), [
    '· Your default chat channel is rp.', '· Switched to action.', '· You are already using that channel.',
    '· Usage: /shout <message>', '· Unknown command. Type /help for a list.', `· ${HELP_LINES[0]}`]);
  assert.equal(ui.lines().length, 5 + HELP_LINES.length);
  assert.ok(ui.ids['chat-log'].children[3].className.includes('chat-error'));
  assert.equal(ui.ids['chat-log'].children[1].className, 'chat-line chat-system');
  // The picker switches too, and hands the keys back to the bar.
  ui.key('Enter');
  ui.ids['chat-channel'].value = 'yell';
  ui.ids['chat-channel'].dispatchEvent(new Event('change'));
  assert.equal(ui.chat.active, 'yell');
  assert.equal(ui.doc.activeElement, ui.ids['chat-input']);
  assert.equal(ui.ids['chat-input'].placeholder, 'Yell…');
  // What the server reports hidden can't be sent on.
  ui.chat.notice({ code: 'toggled', channel: 'ooc', hidden: true });
  run('/ooc anyone');
  assert.equal(ui.lines().at(-1), '· Channel is toggled off. Toggle it back on.');
  ui.chat.notice({ code: 'toggled', channel: 'ooc', hidden: false });
  run('/ooc anyone');
  assert.deepEqual(ui.sent.at(-1), ['ooc', 'anyone']);
  assert.equal(ui.lines().at(-1), '· Toggled ooc visibility ON.');
});

test('a send the connection refused says so', () => {
  const ui = setup({ sendOk: false });
  ui.key('Enter');
  ui.type('hello');
  ui.key('Enter');
  ui.type('/channeltoggle looc');
  assert.deepEqual(ui.lines(), ['· Not connected. Your message was not sent.', '· Not connected. Your message was not sent.']);
  assert.ok(ui.ids['chat-log'].children[0].className.includes('chat-error'));
});

// Dispatches one event along a path of targets, as a page would on the way
// up, until a listener stops it.
const bubble = (event, ...path) => {
  for (const target of path) {
    target.dispatchEvent(event);
    if (event.cancelBubble) break;
  }
  return event;
};
const pointer = (type, { pointerId, timeStamp = 0, ...extra } = {}) => {
  const event = Object.assign(new Event(type, { cancelable: true }), extra);
  // Mouse events have no pointer id; pointer events (and, in browsers, click,
  // auxclick and contextmenu) do.
  if (pointerId !== undefined) event.pointerId = pointerId;
  Object.defineProperty(event, 'timeStamp', { value: timeStamp });
  return event;
};

test('a click or tap on the scene closes the bar and is the whole press, with any button or finger', () => {
  const ui = setup();
  // The game's own handlers come after the chat's: a strike on the scene,
  // and the rune wheel, the builder and the menus on the window.
  let struck = 0;
  const reached = [];
  ui.scene.addEventListener('pointerdown', () => { struck++; });
  for (const type of ['mousedown', 'mouseup', 'click', 'auxclick', 'contextmenu', 'pointerup']) {
    ui.win.addEventListener(type, (event) => reached.push(type + (event.pointerId ?? '')), true);
  }
  let time = 0;
  // A press as the page sees it: the window first (capture), then the scene,
  // then whatever the browser still sends for it.
  const press = ({ button = 0, pointerType = 'mouse', pointerId = 1 } = {}) => {
    time += 2000;
    const down = pointer('pointerdown', { pointerId, pointerType, button, timeStamp: time });
    bubble(down, ui.win, ui.scene);
    const at = (type, offset, id) => ui.win.dispatchEvent(pointer(type, { pointerId: id, button, timeStamp: time + offset }));
    const after = [];
    // A cancelled pointerdown has no compatibility mouse events, but a
    // browser that sent them anyway would find them taken too.
    for (const [type, offset, id] of [['mousedown', 1], ['pointerup', 50, pointerId], ['mouseup', 51],
      ['click', 52, pointerId], ['auxclick', 53, pointerId], ['contextmenu', 54, pointerId], ['click', 300, pointerId]]) {
      after.push(at(type, offset, id));
    }
    return { down, after };
  };
  for (const [button, pointerType, pointerId] of [[0, 'mouse', 1], [1, 'mouse', 1], [2, 'mouse', 1], [0, 'touch', 7]]) {
    const label = `${pointerType} button ${button}`;
    ui.chat.open();
    ui.ids['chat-input'].value = 'half a thought';
    const { down, after } = press({ button, pointerType, pointerId });
    assert.equal(ui.chat.isOpen, false, label);
    assert.equal(ui.ids['chat-input'].value, '', label);
    assert.equal(down.defaultPrevented, true, `${label}: no compatibility mousedown follows`);
    assert.equal(struck, 0, `${label}: the closing press is only a close`);
    // Only the lift itself still reaches the game, so nothing is left held.
    assert.deepEqual(reached, [`pointerup${pointerId}`], label);
    assert.deepEqual(after, [false, true, false, false, false, false, false], `${label}: nothing else acts on it`);
    reached.length = 0;
  }
  assert.deepEqual(ui.toggles, [true, false, true, false, true, false, true, false]);

  // The next press, with the bar shut, is the game's again.
  const { down, after } = press();
  assert.equal(down.defaultPrevented, false);
  assert.equal(struck, 1, 'with the bar shut, the scene gets its clicks');
  assert.ok(after.every(Boolean));
  assert.deepEqual(reached, ['mousedown', 'pointerup1', 'mouseup', 'click1', 'auxclick1', 'contextmenu1', 'click1']);
});

test('only the closing press is swallowed: not other pointers, a keyboard click, or anything once it is over', () => {
  const ui = setup();
  const reached = [];
  for (const type of ['mousedown', 'click']) ui.win.addEventListener(type, (event) => reached.push(type), true);
  const send = (type, options) => ui.win.dispatchEvent(pointer(type, options));
  // No press in flight: nothing to swallow.
  assert.equal(send('click', { pointerId: 1, timeStamp: 1 }), true);
  ui.chat.open();
  bubble(pointer('pointerdown', { pointerId: 1, timeStamp: 10 }), ui.win, ui.scene);
  assert.equal(ui.chat.isOpen, false);
  // A second finger lifting doesn't end the first one's press.
  ui.win.dispatchEvent(pointer('pointerup', { pointerId: 2, timeStamp: 20 }));
  assert.equal(ui.chat.gesture.endsAt, Infinity);
  assert.equal(send('click', { pointerId: -1, timeStamp: 30 }), true, 'Enter on a focused button clicks it');
  assert.equal(send('mousedown', { timeStamp: 5000 }), false, 'still held');
  ui.win.dispatchEvent(pointer('pointercancel', { pointerId: 1, timeStamp: 6000 }));
  assert.equal(send('click', { pointerId: 1, timeStamp: 6500 }), false, 'within the press\'s tail');
  assert.equal(send('click', { pointerId: 1, timeStamp: 6501 }), true, 'long after');
  assert.equal(ui.chat.gesture, null);
  // A new press ends the old one at once.
  ui.chat.open();
  bubble(pointer('pointerdown', { pointerId: 1, timeStamp: 7000 }), ui.win, ui.scene);
  bubble(pointer('pointerdown', { pointerId: 1, timeStamp: 7100 }), ui.win, ui.scene);
  assert.equal(ui.chat.gesture, null);
  assert.equal(send('mousedown', { timeStamp: 7101 }), true);
  assert.deepEqual(reached, ['click', 'click', 'click', 'mousedown']);
});

test('Escape closes the bar once focus has left it, but not a key another panel took', () => {
  const ui = setup();
  const escape = (extra = {}) => {
    const event = Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape', ...extra });
    ui.doc.dispatchEvent(event);
    return event;
  };
  assert.equal(escape().defaultPrevented, false, 'nothing to close');
  ui.chat.open();
  ui.ids['chat-input'].blur();
  escape({ isComposing: true });
  assert.equal(ui.chat.isOpen, true, 'an IME is still composing');
  const taken = new Event('keydown', { cancelable: true });
  Object.assign(taken, { key: 'Escape' });
  taken.preventDefault();
  ui.doc.dispatchEvent(taken);
  assert.equal(ui.chat.isOpen, true, 'another panel took this Escape');
  escape({ key: 'a' });
  assert.equal(ui.chat.isOpen, true);
  const closing = escape();
  assert.equal(closing.defaultPrevented, true);
  assert.equal(closing.cancelBubble, true, 'the window\'s panels never see it');
  assert.equal(ui.chat.isOpen, false);
  assert.deepEqual(ui.toggles, [true, false]);
});

test('Escape closes a panel opened over the chat first, and never both at once', () => {
  let builder = false;
  const ui = setup({ isCovered: () => builder });
  // The builder listens on the window, after the document, and doesn't ask
  // whether the key was already used; it skips keys typed into a field.
  let exits = 0;
  ui.win.addEventListener('keydown', (event) => {
    if (!builder || event.key !== 'Escape' || event.target?.tagName === 'INPUT') return;
    event.preventDefault();
    builder = false;
    exits++;
  });
  const escape = (target) => {
    const event = Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' });
    // The focused element is the target; the event rises to the document
    // and then the window.
    Object.defineProperty(event, 'target', { value: target });
    return bubble(event, ...(target ? [target] : []), ui.doc, ui.win);
  };
  const toolbar = new El('button', ui.doc);

  // Chat open with a draft, then the builder opened from its toolbar.
  ui.chat.open();
  ui.ids['chat-input'].value = 'half a thought';
  builder = true;
  toolbar.focus();
  escape(toolbar);
  assert.deepEqual([builder, ui.chat.isOpen, exits], [false, true, 1], 'only the builder closes');
  assert.equal(ui.ids['chat-input'].value, 'half a thought', 'the draft is kept');
  escape(toolbar);
  assert.deepEqual([ui.chat.isOpen, exits], [false, 1], 'then the chat');

  // Typing in the chat makes it the top layer: Escape closes only the chat,
  // from the input or from another of its controls.
  for (const control of ['chat-input', 'chat-channel']) {
    ui.chat.open();
    builder = true;
    ui.ids[control].focus();
    escape(ui.ids[control]);
    assert.deepEqual([builder, ui.chat.isOpen, exits], [true, false, 1], control);
    builder = false;
  }
  // With focus nowhere, an open builder still goes first.
  ui.chat.open();
  builder = true;
  ui.doc.activeElement = null;
  escape(null);
  assert.deepEqual([builder, ui.chat.isOpen, exits], [false, true, 2]);
  escape(null);
  assert.equal(ui.chat.isOpen, false);
});

test('every channel reads as it should, with the speaker\'s tint, and text stays text', () => {
  const ui = setup();
  const roster = [{ id: 'a1', color: 0 }, { id: 'b2', color: 1 }];
  const line = (channel, text = 'hi', extra = {}) => ui.chat.receive({ seq: 1, channel, from: 'a1', name: 'Ash', text,
    clarity: 1, muffled: false, ...extra }, roster);
  for (const channel of ['rp', 'shout', 'yell', 'whisper', 'looc', 'ooc', 'action', 'scene']) line(channel);
  assert.deepEqual(ui.lines(), ['Ash: "hi"', 'Ash shouts: "hi"', 'Ash yells: "hi"', 'Ash whispers: "hi"',
    '[LOOC] Ash: hi', '[OOC] Ash: hi', '* Ash hi', '[Scene] Ash: *hi*']);
  const rp = ui.ids['chat-log'].children[0];
  assert.equal(rp.className, 'chat-line chat-rp');
  assert.equal(rp.children[0].className, 'chat-name');
  assert.equal(rp.children[0].style.color, 'rgb(169, 212, 174)');
  line('rp', 'hey', { from: 'b2', name: 'Bryn' });
  assert.equal(ui.ids['chat-log'].children.at(-1).children[0].style.color, 'rgb(146, 198, 235)');
  line('rp', 'gone', { from: 'ff', name: 'Old' });
  assert.equal(ui.ids['chat-log'].children.at(-1).children[0].style.color, undefined, 'no tint for someone who left');
  ui.chat.receive({ seq: 2, channel: 'rp', from: 'ff', name: 'Old', text: 'no roster', clarity: 1, muffled: false });
  line('rp', '*muffled voices*', { muffled: true });
  const muffled = ui.ids['chat-log'].children.at(-1);
  assert.equal(muffled.textContent, '*muffled voices*', 'no name for a voice too muffled to place');
  assert.ok(muffled.classList.contains('chat-muffled'));
  line('rp', '<img src=x onerror=alert(1)>');
  const hostile = ui.ids['chat-log'].children.at(-1);
  assert.equal(hostile.textContent, 'Ash: "<img src=x onerror=alert(1)>"');
  assert.ok(hostile.children.every((child) => child.tagName === 'SPAN' && child.children.length === 0));
  assert.equal(ui.ids['chat-log'].scrollTop, ui.ids['chat-log'].scrollHeight);
});

test('server notices, joins and leaves become quiet lines', () => {
  const ui = setup();
  for (const code of ['unheard', 'rate', 'too-long', 'hidden', 'invalid']) ui.chat.notice({ code });
  assert.ok(ui.ids['chat-log'].children.every((li) => li.classList.contains('chat-error')));
  ui.chat.roster({ self: true, code: 'ABC234', resumed: false });
  ui.chat.roster({ self: true, code: 'ABC234', resumed: true });
  ui.chat.roster({ joined: [{ id: 'b2', name: 'Bryn' }], left: [{ id: 'c3', name: 'Cai' }] });
  ui.chat.roster({});
  assert.deepEqual(ui.lines().slice(5), ['· Joined lobby ABC234.', '· Reconnected to lobby ABC234.',
    '· Bryn joined the lobby.', '· Cai left the lobby.']);
  ui.key('Enter');
  ui.type('/channel yell');
  ui.chat.notice({ code: 'toggled', channel: 'looc', hidden: true });
  ui.key('Enter');
  ui.chat.roster({ left: 'self' });
  assert.equal(ui.lines().at(-1), '· Left the lobby.');
  assert.equal(ui.chat.isOpen, false);
  assert.equal(ui.chat.active, 'rp');
  assert.equal(ui.chat.hidden.size, 0);
  ui.chat.setAvailable(false);
  assert.equal(ui.ids.chat.hidden, true);
  // A reconnect the server could resume keeps what was hidden; one it
  // couldn't made a fresh player with nothing hidden, so the page agrees.
  ui.chat.notice({ code: 'toggled', channel: 'ooc', hidden: true });
  ui.chat.roster({ self: true, code: 'ABC234', resumed: true });
  assert.deepEqual([...ui.chat.hidden], ['ooc']);
  ui.chat.roster({ self: true, code: 'ABC234', resumed: false });
  assert.equal(ui.chat.hidden.size, 0);
  ui.chat.setAvailable(true);
  ui.key('Enter');
  ui.type('/ooc back again');
  assert.deepEqual(ui.sent.at(-1), ['ooc', 'back again']);
});

test('new lines keep a reader at the bottom but leave one reading back where they are', () => {
  const ui = setup();
  const log = ui.ids['chat-log'];
  for (let i = 0; i < 30; i++) ui.chat.system(`line ${i}`);
  assert.equal(log.scrollTop, log.scrollHeight, 'the closed log always shows the newest');
  ui.chat.open();
  log.clientHeight = 20 * 16;
  log.scrollTop = log.scrollHeight - log.clientHeight;
  ui.chat.system('at the bottom');
  assert.equal(log.scrollTop, log.scrollHeight);
  log.scrollTop = log.scrollHeight - log.clientHeight - 16;
  ui.chat.system('a line up');
  assert.equal(log.scrollTop, log.scrollHeight, 'within a line still follows');
  const back = log.scrollHeight - log.clientHeight - 5 * 16;
  log.scrollTop = back;
  ui.chat.receive({ seq: 3, channel: 'ooc', from: 'a1', name: 'Ash', text: 'hi', clarity: 1, muffled: false });
  ui.chat.system('another');
  assert.equal(log.scrollTop, back, 'reading back is left alone');
});

test('the log keeps 100 lines, and closed lines fade out after nine seconds', () => {
  const ui = setup();
  for (let i = 0; i < CHAT_LOG_LINES + 5; i++) ui.chat.system(`line ${i}`);
  assert.equal(ui.ids['chat-log'].children.length, CHAT_LOG_LINES);
  assert.equal(ui.lines()[0], '· line 5');
  const first = ui.ids['chat-log'].children[0];
  ui.chat.update(LINE_SHOWN - 0.1);
  assert.equal(first.style.opacity, '');
  ui.chat.update(0.6);
  assert.equal(first.style.opacity, '0.5');
  ui.chat.update(LINE_FADE);
  assert.equal(first.style.opacity, '0');
  assert.ok(first.classList.contains('faded'));
  ui.chat.system('fresh');
  ui.chat.update(1);
  assert.ok(ui.ids['chat-log'].children.at(-1).style.opacity === '');
  assert.equal(first.style.opacity, '0');
});

test('phones open from the CHAT button in the same tap, and the bar follows the keyboard', () => {
  const viewport = Object.assign(new EventTarget(), { height: 800, offsetTop: 0 });
  const ui = setup({ phone: true, viewport });
  assert.equal(ui.ids['chat-open'].hidden, false);
  ui.ids['chat-open'].click();
  assert.equal(ui.chat.isOpen, true);
  assert.deepEqual(ui.doc.focusCalls, ['chat-input']);
  viewport.height = 500;
  viewport.dispatchEvent(new Event('resize'));
  assert.equal(ui.rootStyle['--chat-kb'], '300px');
  viewport.offsetTop = 40;
  viewport.dispatchEvent(new Event('scroll'));
  assert.equal(ui.rootStyle['--chat-kb'], '260px');
  viewport.height = 900;
  viewport.dispatchEvent(new Event('resize'));
  assert.equal(ui.rootStyle['--chat-kb'], '0px');
});
