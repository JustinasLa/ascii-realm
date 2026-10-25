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
      hidden: false, value: '', placeholder: '', className: '', scrollTop: 0, scrollHeight: 0, _text: '' });
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
  focus() { this.doc.activeElement = this; this.doc.focusCalls.push(this.id); }
  blur() { if (this.doc.activeElement === this) this.doc.activeElement = null; }
  click() { this.dispatchEvent(new Event('click')); }
}

function setup({ phone = false, viewport = null, inLobby = true, mayOpen = () => true, sendOk = true } = {}) {
  const ids = {};
  const bodyClasses = new Set();
  const rootStyle = {};
  const doc = {
    activeElement: null,
    focusCalls: [],
    body: { classList: { add: (c) => bodyClasses.add(c), remove: (c) => bodyClasses.delete(c) } },
    documentElement: { style: { setProperty: (k, v) => { rootStyle[k] = v; } } },
    createElement: (tag) => new El(tag, doc),
    getElementById: (id) => ids[id],
  };
  for (const [id, tag] of Object.entries({ chat: 'section', 'chat-log': 'ol', 'chat-bar': 'form', 'chat-channel': 'select',
    'chat-input': 'input', 'chat-send': 'button', 'chat-close': 'button', 'chat-open': 'button' })) {
    ids[id] = new El(tag, doc);
    ids[id].id = id;
  }
  ids['chat-bar'].hidden = true;
  const win = Object.assign(new EventTarget(), { innerHeight: 800, visualViewport: viewport });
  const sent = [];
  const toggled = [];
  const client = {
    sendChat: (channel, text) => { sent.push([channel, text]); return sendOk; },
    toggleChat: (channel) => { toggled.push(channel); return sendOk; },
  };
  const toggles = [];
  const chat = new ChatUi({ doc, win, phone: { phone }, client, mayOpen, onToggle: (open) => toggles.push(open),
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
  return { chat, doc, win, ids, sent, toggled, toggles, key, barKey, type, lines, bodyClasses, rootStyle };
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
