import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bindMultiplayerControls } from '../src/multiplayer/controls.js';

// Just enough DOM for the Multiplayer panel. Markup is refused.
class El extends EventTarget {
  constructor(tagName) {
    super();
    Object.assign(this, { tagName: tagName.toUpperCase(), children: [], style: {}, dataset: {}, className: '',
      hidden: false, disabled: false, open: false, value: '', blurred: 0, focused: 0, selected: 0, _text: '' });
  }
  get textContent() { return this._text + this.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join(''); }
  set textContent(value) { this.children = []; this._text = String(value); }
  set innerHTML(_) { throw new Error('the panel must never use innerHTML'); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; this._text = ''; }
  blur() { this.blurred++; }
  focus() { this.focused++; }
  select() { this.selected++; }
  click() { this.dispatchEvent(new Event('click')); }
}

const IDS = ['multiplayer-controls', 'multiplayer-summary', 'lobby-form', 'lobby-as', 'lobby-code', 'lobby-server',
  'lobby-create', 'lobby-join', 'lobby-leave', 'multiplayer-status', 'lobby-session', 'lobby-room-code', 'lobby-players',
  'lobby-copy-code', 'lobby-copy-invite', 'lobby-share'];

// Swaps the page's storage and clipboard for the test's own.
function globals(t, { local, session, clipboard }) {
  const saved = Object.fromEntries(['localStorage', 'sessionStorage', 'navigator']
    .map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const define = (key, value) => Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  define('localStorage', local);
  define('sessionStorage', session);
  define('navigator', { clipboard });
  t.after(() => {
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
}

function mount(t, { search = '', stored = null, rejoin = null, clipboard, storageThrows = false, name = 'Kael' } = {}) {
  const ids = Object.fromEntries(IDS.map((id) => [id, new El(id === 'lobby-players' ? 'ul' : 'div')]));
  const doc = { getElementById: (id) => ids[id], createElement: (tag) => new El(tag) };
  const items = new Map(stored ? [['ascii-realm-name', stored]] : []);
  const blocked = () => { throw new Error('blocked'); };
  const writes = [];
  const local = storageThrows ? { getItem: blocked, setItem: blocked }
    : { getItem: (key) => items.get(key) ?? null, setItem: (key, value) => { writes.push(key); items.set(key, value); } };
  const sessionItems = new Map(rejoin ? [['ascii-realm-rejoin', rejoin]] : []);
  const session = storageThrows ? { getItem: blocked } : {
    getItem: (key) => sessionItems.get(key) ?? null, removeItem: (key) => sessionItems.delete(key) };
  const copied = [];
  globals(t, { local, session, clipboard: clipboard ?? { writeText: async (text) => { copied.push(text); } } });
  const loc = { href: `https://game.example/play/${search}`, search };
  const urls = [];
  const navigation = { replaceState: (state, title, url) => { urls.push(String(url)); } };
  const client = { status: 'offline', message: '', room: null, players: [], id: null, options: { server: '' },
    connects: [], leaves: 0,
    connect(options) { this.connects.push(options); this.options = options; },
    leave() { this.leaves++; } };
  let done = 0;
  // The active character's name, which the test may change.
  const shown = { name };
  const render = bindMultiplayerControls(client, { name: () => shown.name, seed: () => 7,
    onDone: () => { done++; }, document: doc, location: loc, history: navigation });
  return { ids, client, render, shown, items, writes, sessionItems, copied, urls, loc, done: () => done };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('the panel has no name field: you join as the active character', (t) => {
  const page = mount(t, { stored: 'Bryn', name: 'Žydrūnas' });
  assert.equal(page.ids['lobby-name'], undefined);
  assert.equal(page.ids['lobby-as'].textContent, 'You join as Žydrūnas.');
  assert.equal(page.ids['multiplayer-controls'].open, false);
  assert.equal(page.ids['multiplayer-summary'].textContent, 'Multiplayer · Solo');
  assert.deepEqual(page.client.connects, []);
  // A rename or a switch shows at the next render, and goes with the next join.
  page.shown.name = 'Анна';
  page.render();
  assert.equal(page.ids['lobby-as'].textContent, 'You join as Анна.');
  page.ids['lobby-create'].click();
  assert.equal(page.client.connects.at(-1).name, 'Анна');
  Object.assign(page.client, { status: 'online', room: { code: 'ABC234', maxPlayers: 8 } });
  page.render();
  assert.equal(page.ids['lobby-as'].textContent,
    'You join as Анна. A new name or character shows here when you next join.');
  assert.deepEqual(page.writes, [], 'the old lobby name is never written');
  assert.equal(page.items.get('ascii-realm-name'), 'Bryn');
});

test('an invite joins at once, unless it names its own lobby server', (t) => {
  let page = mount(t, { search: '?room=abc234&name=Ash' });
  assert.equal(page.ids['multiplayer-controls'].open, true);
  assert.deepEqual(page.client.connects, [{ mode: 'join', name: 'Kael', seed: 7, code: 'ABC234', server: '' }]);
  assert.deepEqual(page.writes, []);
  page = mount(t, { search: '?room=ABC234&server=wss://lobby.example' });
  assert.deepEqual(page.client.connects, []);
  assert.equal(page.ids['multiplayer-status'].textContent,
    'This invite uses another lobby server. Check its address, then press Join.');
  page = mount(t, { search: '?room=ABC234&server=wss://lobby.example', rejoin: 'ABC234' });
  assert.equal(page.client.connects.length, 1, 'reloading into the lobby rejoins it');
  assert.equal(page.sessionItems.size, 0);
  page = mount(t, { search: '?room=ABC234', storageThrows: true });
  assert.equal(page.client.connects.length, 1);
});

test('Create, Join, typing a code and Leave drive the client', (t) => {
  const page = mount(t);
  const { ids, client } = page;
  ids['lobby-create'].click();
  assert.deepEqual(client.connects.at(-1), { mode: 'create', name: 'Kael', seed: 7, code: '', server: '' });
  assert.equal(ids['lobby-create'].blurred, 1);
  assert.equal(page.done(), 1);
  ids['lobby-code'].value = 'abc234';
  ids['lobby-code'].dispatchEvent(new Event('input'));
  assert.equal(ids['lobby-code'].value, 'ABC234');
  const submit = new Event('submit', { cancelable: true });
  ids['lobby-form'].dispatchEvent(submit);
  assert.equal(submit.defaultPrevented, true);
  assert.equal(client.connects.at(-1).mode, 'join');
  assert.equal(client.connects.at(-1).code, 'ABC234');
  ids['lobby-leave'].click();
  assert.equal(client.leaves, 1);
  assert.equal(ids['lobby-leave'].blurred, 1);
});

test('in a lobby the panel lists everyone by name, tag and name colour', (t) => {
  const page = mount(t);
  const { ids, client, render } = page;
  client.status = 'connecting';
  render();
  assert.equal(ids['lobby-create'].disabled, true);
  assert.equal(ids['lobby-leave'].hidden, false);
  assert.equal(ids['lobby-leave'].textContent, 'Cancel');
  Object.assign(client, { status: 'online', message: 'Connected.', id: 'a1', room: { code: 'ABC234', maxPlayers: 8 },
    options: { server: '' }, players: [
      { id: 'a1', name: 'Ash', tag: null, color: 1, tint: null },
      { id: 'b2', name: 'Ash', tag: 2, color: 0, tint: '#ff5555' },
    ] });
  ids['lobby-server'].value = '';
  render();
  assert.equal(ids['lobby-form'].hidden, true);
  assert.equal(ids['lobby-session'].hidden, false);
  assert.equal(ids['lobby-leave'].textContent, 'Leave lobby');
  assert.equal(ids['multiplayer-status'].dataset.state, 'online');
  assert.equal(ids['multiplayer-summary'].textContent, 'Lobby ABC234 · 2/8');
  assert.equal(ids['lobby-room-code'].textContent, 'ABC234');
  const items = ids['lobby-players'].children;
  assert.deepEqual(items.map((item) => item.textContent), ['Ash (you)', 'Ash (2)']);
  const names = items.map((item) => item.children[0]);
  assert.ok(names.every((name) => name.className === 'lobby-player-name'));
  assert.deepEqual(names.map((name) => name.style.color), ['rgb(146, 198, 235)', 'rgb(255, 85, 85)']);
  assert.deepEqual(names.map((name) => name.textContent), ['Ash', 'Ash']);
  assert.ok(!items[0].children.some((child) => child.className === 'lobby-player-tag'), 'a unique name has no tag');
  const tag = items[1].children[1];
  assert.equal(tag.className, 'lobby-player-tag', 'the tag is its own element after the name');
  assert.equal(tag.textContent, ' (2)');
  assert.equal(tag.style.color, 'rgb(255, 85, 85)');
  assert.equal(new URL(page.urls.at(-1)).searchParams.get('room'), 'ABC234', 'a refresh keeps the code');
  assert.equal(new URL(page.urls.at(-1)).searchParams.get('server'), null);
  ids['lobby-server'].value = 'wss://lobby.example';
  client.options.server = 'wss://lobby.example';
  render();
  assert.equal(new URL(page.urls.at(-1)).searchParams.get('server'), 'wss://lobby.example');
  // Leaving drops the code from the address.
  Object.assign(client, { status: 'offline', room: null, players: [] });
  render();
  assert.equal(new URL(page.urls.at(-1)).searchParams.get('room'), null);
  assert.equal(ids['lobby-share'].hidden, true);
  client.status = 'error';
  render();
  assert.equal(ids['lobby-players'].children.length, 0);
});

test('the code and a clean invite are copied, or shown to copy by hand', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const page = mount(t, { search: '?name=Ash&tint=ff5555&debug&seed=9&server=wss://old.example' });
  const { ids, client, render } = page;
  ids['lobby-copy-code'].click();
  ids['lobby-copy-invite'].click();
  await flush();
  assert.deepEqual(page.copied, [], 'nothing to copy outside a lobby');
  Object.assign(client, { status: 'online', room: { code: 'ABC234', maxPlayers: 8 }, players: [] });
  ids['lobby-server'].value = '';
  render();
  ids['lobby-copy-code'].click();
  await flush();
  assert.deepEqual(page.copied, ['ABC234']);
  assert.equal(ids['lobby-copy-code'].textContent, 'Copied');
  t.mock.timers.tick(1500);
  assert.equal(ids['lobby-copy-code'].textContent, 'Copy code');
  ids['lobby-copy-invite'].click();
  await flush();
  const invite = new URL(page.copied.at(-1));
  assert.deepEqual([...invite.searchParams.keys()], ['room'], 'no name, colour, debug, seed or server of yours');
  t.mock.timers.tick(1500);
  assert.equal(ids['lobby-copy-invite'].textContent, 'Copy invite');
  ids['lobby-server'].value = 'wss://lobby.example';
  client.options = { server: 'wss://lobby.example' };
  ids['lobby-copy-invite'].click();
  await flush();
  assert.equal(new URL(page.copied.at(-1)).searchParams.get('server'), 'wss://lobby.example');
});

test('without a clipboard the text is shown, selected, to copy by hand', async (t) => {
  const page = mount(t, { clipboard: { writeText: async () => { throw new Error('denied'); } } });
  const { ids, client, render } = page;
  Object.assign(client, { status: 'online', room: { code: 'ABC234', maxPlayers: 8 }, players: [] });
  render();
  ids['lobby-copy-code'].click();
  await flush();
  assert.equal(ids['lobby-share'].hidden, false);
  assert.equal(ids['lobby-share'].value, 'ABC234');
  assert.equal(ids['lobby-share'].selected, 1);
});
