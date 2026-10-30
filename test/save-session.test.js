import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Player } from '../src/entities/player.js';
import { Inventory } from '../src/inventory/inventory.js';
import { OUTLAW, SAVE_FEATURES, SAVE_VERSION } from '../src/save/format.js';
import { starterKit } from '../src/save/body.js';
import { SaveStore } from '../src/save/store.js';
import { AUTOSAVE_MS, IDLE_TIMEOUT_MS, NOTICES, SaveSession } from '../src/save/session.js';

const WORLD = { seed: 1, woodland: 'sparse' };
const KEY = 'ascii-realm-save-1';

function memory() {
  const map = new Map();
  return { map, getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)) };
}

// A game on a walkable world, with the outlaw played unless `active` says.
function setup({ storage = memory(), active = null, ids = [], off = null, now = () => 1000, store } = {}) {
  const world = { spawn: { x: 4, y: 5 }, isWalkable: () => true };
  const inventory = new Inventory({ starter: false });
  inventory.restore(starterKit());
  const player = new Player(world.spawn.x, world.spawn.y);
  player.equipment = inventory.equipment;
  const live = { player, inventory, world, appliedId: active ?? OUTLAW };
  const characters = { active: active && { id: active }, characters: ids.map((id) => ({ id })) };
  const clock = { day: 0, tick: 14000, get() { return { day: this.day, tick: this.tick }; },
    set({ day, tick }) { Object.assign(this, { day, tick }); } };
  const told = [];
  const reasons = [];
  store ??= new SaveStore({ storage, world: WORLD, locks: null, now });
  const session = new SaveSession({ store, world: WORLD, live, characters, clock, now, off, notify: (text, reason) => {
    told.push(text);
    reasons.push(reason);
  } });
  return { storage, store, session, live, player, inventory, characters, clock, told, reasons };
}

const stored = (storage) => JSON.parse(storage.map.get(KEY));
const body = (fields = {}) => ({ savedAt: 1, x: 30, y: -12, heading: 1, health: 40, stamina: 20, respawn: null,
  bag: [{ id: 'oakLog', count: 3 }], worn: { mainHand: { id: 'dagger', count: 1 } }, ...fields });
const record = (fields = {}) => JSON.stringify({ v: SAVE_VERSION, game: 'ascii-realm', kind: 'realm', rev: 4, savedAt: 1,
  features: SAVE_FEATURES, world: WORLD, active: OUTLAW, clock: { day: 3, tick: 2000 }, bodies: { outlaw: body() },
  piles: [], ...fields });
const full = () => { throw Object.assign(new Error('full'), { name: 'QuotaExceededError' }); };

test('saves every minute when idle, within five seconds', () => {
  assert.deepEqual([AUTOSAVE_MS, IDLE_TIMEOUT_MS], [60_000, 5000]);
});

test('every notice fits the phone\'s one-line toast', () => {
  for (const [key, text] of Object.entries(NOTICES)) assert.ok(text.length <= 27, `${key}: ${text}`);
});

test('a world with no save starts fresh, then saves its body and the clock', async () => {
  const { session, storage, player, clock, told } = setup();
  assert.equal(session.boot().status, 'none');
  assert.deepEqual(session.save('auto'), { ok: false, reason: 'gated' }, 'nothing writes before the save is opened');
  const resumed = session.resume();
  assert.equal(session.holding, true, 'the world is held while it opens');
  assert.deepEqual(await resumed, { ok: true, status: 'none', repaired: 0, applied: false });
  assert.equal(session.holding, false);
  player.x = 9;
  clock.tick = 500;
  assert.deepEqual(session.save('auto'), { ok: true, rev: 1 });
  const saved = stored(storage);
  assert.deepEqual([saved.features, saved.clock, saved.bodies.outlaw.x], [SAVE_FEATURES, { day: 0, tick: 500 }, 9]);
  assert.equal(session.lastSaved, 1000);
  assert.deepEqual(told, [], 'an automatic save says nothing');
  assert.equal(session.save('manual').ok, true);
  assert.deepEqual(told, ['Game saved.']);
});

test('Continue puts back the active character\'s body and the clock, or only the body when asked', async () => {
  const storage = memory();
  storage.setItem(KEY, record());
  const { session, player, inventory, clock, told } = setup({ storage });
  assert.equal(session.boot().status, 'ok');
  let woke = 0;
  session.onSwitch = () => woke++;
  assert.deepEqual(await session.resume(), { ok: true, status: 'ok', repaired: 0, applied: true });
  assert.deepEqual([player.x, player.y, player.vitals.health], [30, -12, 40]);
  assert.equal(inventory.equipment.mainHand.id, 'dagger');
  assert.deepEqual(clock.get(), { day: 3, tick: 2000 });
  assert.equal(woke, 1);
  assert.deepEqual(told, []);
  assert.deepEqual(session.save('auto'), { ok: true, rev: 5 });

  const again = setup({ storage });
  again.clock.tick = 9;
  await again.session.resume({ restoreClock: false });
  assert.deepEqual(again.clock.get(), { day: 0, tick: 9 });
});

test('a character with no body on this world sets out with the starter kit at spawn', async () => {
  const storage = memory();
  storage.setItem(KEY, record({ clock: null }));
  const { session, player, inventory, clock, live } = setup({ storage, active: 'c0123456789abcdef', ids: ['c0123456789abcdef'] });
  player.x = 50;
  inventory.add('oakLog', 2);
  await session.resume();
  assert.deepEqual([player.x, player.y], [4, 5]);
  assert.equal(inventory.slots.some((stack) => stack?.id === 'oakLog'), false);
  assert.equal(live.appliedId, 'c0123456789abcdef');
  assert.deepEqual(clock.get(), { day: 0, tick: 14000 }, 'a save with no clock leaves the time alone');
});

test('a save with things that couldn\'t be read says so, once', async () => {
  const storage = memory();
  storage.setItem(KEY, record({ bodies: { outlaw: body({ bag: [{ id: 'nothing-like-this', count: 1 }] }) } }));
  const { session, told } = setup({ storage });
  session.boot();
  assert.equal((await session.resume()).repaired, 1);
  assert.deepEqual(told, [NOTICES.repaired]);
});

test('a damaged save starts fresh, and the first save writes over it', async () => {
  const storage = memory();
  storage.setItem(KEY, '{ not json');
  const { session, told } = setup({ storage });
  assert.equal(session.boot().status, 'corrupt');
  assert.deepEqual(told, [NOTICES.corrupt]);
  assert.equal(storage.map.get(`${KEY}-corrupt`), '{ not json');
  assert.equal((await session.resume()).applied, false);
  assert.deepEqual(session.save('auto'), { ok: true, rev: 1 });
  assert.equal(new SaveStore({ storage, world: WORLD, locks: null }).read().status, 'ok');
  assert.equal(storage.map.get(`${KEY}-corrupt`), '{ not json', 'the damaged text stays aside');
});

test('a save from a newer version, or with newer parts, is never written; the choice tells it', async () => {
  for (const fields of [{ v: 99 }, { features: 99 }]) {
    const storage = memory();
    storage.setItem(KEY, record(fields));
    const before = storage.map.get(KEY);
    const { session, told } = setup({ storage });
    session.boot();
    assert.deepEqual(told, []);
    const resumed = await session.resume();
    assert.equal(resumed.ok, !fields.v, 'newer parts still play');
    assert.deepEqual(session.save('auto').ok, false);
    assert.equal(storage.map.get(KEY), before);
    assert.deepEqual(told, fields.v ? [NOTICES['read-only']] : [], 'an automatic save keeps it quiet');
    session.save('manual');
    assert.equal(told.at(-1), NOTICES['read-only'], 'a save by hand says why');
    assert.equal(session.status(), NOTICES['read-only']);
  }
});

test('storage that can\'t be reached says so once', async () => {
  const { session, told } = setup({ storage: { getItem: full, setItem: full } });
  assert.equal(session.boot().status, 'unavailable');
  assert.deepEqual(await session.resume(), { ok: false, reason: 'unavailable', status: 'unavailable', repaired: 0, applied: false });
  assert.deepEqual(told, [NOTICES.unavailable]);
  assert.deepEqual(session.save('manual'), { ok: false, reason: 'gated' });
  assert.deepEqual(told.at(-1), NOTICES.unavailable, 'a save by hand says why');
});

test('a world open in another tab isn\'t continued here and never written', async () => {
  const held = new Set();
  const locks = { async request(name, options, callback) {
    await null;
    if (held.has(name)) return callback(null);
    held.add(name);
    try {
      return await callback({ name });
    } finally {
      held.delete(name);
    }
  } };
  const storage = memory();
  storage.setItem(KEY, record());
  const other = new SaveStore({ storage, world: WORLD, locks });
  await other.ready;
  const { session, told, reasons, player, store } = setup({ storage, store: new SaveStore({ storage, world: WORLD, locks }) });
  session.boot();
  assert.equal((await session.resume()).reason, 'other-tab');
  assert.equal(player.x, 4, 'the body stays as it started');
  assert.deepEqual(told, [NOTICES['other-tab']]);
  assert.equal(reasons[0], 'other-tab', 'the page shows it as a screen');
  assert.deepEqual(session.save('hide'), { ok: false, reason: 'gated' });
  assert.equal(session.status(), NOTICES['other-tab']);
  session.save('manual');
  assert.equal(told.length, 2, 'a save by hand says why again');
  assert.equal(storage.map.get(KEY), record());
  assert.equal(await store.retry(), 'other-tab', 'Try again asks for the lock again');
  other.release();
  assert.equal(await store.retry(), 'writer');
  assert.equal(await store.retry(), 'writer', 'and only while another tab held it');
  assert.equal(store.ownRev.realm, null, 'without claiming the save');
  assert.equal(storage.map.get(KEY), record());
});

test('a Continue cut short by the page hiding gives up', async () => {
  const { session, store } = setup();
  store.release();
  assert.equal((await session.resume()).reason, 'released');
  session.save('manual');
  assert.equal(session.status(), NOTICES.gated);
});

test('failed saves are told once until one lands, and a save by hand always answers', async () => {
  const { session, storage, told } = setup();
  await session.resume();
  const { setItem } = storage;
  for (const [reason, text] of [['quota', NOTICES.quota], ['error', NOTICES.error]]) {
    storage.setItem = reason === 'quota' ? full : () => { throw new Error('broken'); };
    told.length = 0;
    assert.deepEqual(session.save('auto'), { ok: false, reason });
    session.save('hide');
    assert.deepEqual(told, [text]);
    session.save('manual');
    assert.deepEqual(told, [text, text]);
    storage.setItem = setItem;
    assert.equal(session.save('auto').ok, true);
    storage.setItem = reason === 'quota' ? full : () => { throw new Error('broken'); };
    session.save('auto');
    assert.deepEqual(told, [text, text, text], 'told again after a save landed');
    storage.setItem = setItem;
  }
  session.store.write = () => ({ ok: false, reason: 'too-big' });
  told.length = 0;
  session.save('auto');
  assert.deepEqual(told, [NOTICES['too-big']]);
});

test('another tab saving after a Continue makes this page stale', async () => {
  const { session, storage, told } = setup();
  await session.resume();
  session.save('auto');
  const other = new SaveStore({ storage, world: WORLD, locks: null });
  await other.claim();
  other.write('realm', other.realm);
  assert.deepEqual(session.save('auto'), { ok: false, reason: 'other-tab' });
  assert.deepEqual(told, [NOTICES.stale]);
  session.tell('stale');
  session.tell('writer');
  assert.equal(told.length, 1);
});

test('quiet refusals stay quiet, except for a save by hand', async () => {
  const { session, store, told } = setup();
  await session.resume();
  store.pause('lobby');
  assert.equal(session.save('auto').reason, 'paused');
  assert.deepEqual(told, []);
  assert.equal(session.status(), NOTICES.paused);
  session.save('manual');
  assert.deepEqual(told, ['Lobby play isn\'t saved.']);
  store.pausedBy = null;
  store.writer = 'pending';
  session.save('manual');
  assert.deepEqual(told.at(-1), NOTICES.gated);
  store.writer = 'stale';
  assert.equal(session.status(), NOTICES.stale);
});

test('a page that never saves (?nogate) reads and writes nothing', async () => {
  const storage = memory();
  storage.setItem(KEY, record());
  const { session, player, told } = setup({ storage, off: 'tool' });
  assert.deepEqual(session.boot(), { status: 'tool' });
  assert.deepEqual(await session.resume(), { ok: false, reason: 'tool' });
  assert.deepEqual(session.save('auto'), { ok: false, reason: 'tool' });
  assert.equal(player.x, 4);
  assert.deepEqual(told, []);
  session.save('manual');
  assert.deepEqual(told, [NOTICES.tool]);
  assert.equal(session.status(), NOTICES.tool);
  assert.equal(storage.map.get(KEY), record());
});

test('a character switch puts the new body on at once and files the old one for the next save', async () => {
  const id = 'c0123456789abcdef';
  const { session, storage, player, characters, live } = setup({ ids: [id] });
  await session.resume();
  let woke = 0;
  session.onSwitch = () => woke++;
  assert.equal(session.sync(), false, 'nothing to do while the same character plays');
  player.x = 12;
  characters.active = { id };
  assert.equal(session.sync(), true);
  assert.deepEqual([player.x, live.appliedId, woke], [4, id, 1]);
  player.x = 3;
  assert.equal(session.save('switch').ok, true);
  const { bodies, active } = stored(storage);
  assert.deepEqual([bodies.outlaw.x, bodies[id].x, active], [12, 3, id]);
});

test('the menu line says how saving goes', async () => {
  let now = 1000;
  const { session } = setup({ now: () => now });
  assert.equal(session.status(), NOTICES.gated);
  await session.resume();
  assert.equal(session.status(), 'Saves every minute and when you leave.');
  session.save('auto');
  now += 42_000;
  assert.equal(session.status(), 'Saves every minute and when you leave. Last saved 0:42 ago.');
  now += 3600_000 + 5 * 60_000;
  assert.equal(session.status(), 'Saves every minute and when you leave. Last saved 1:05:42 ago.');
});

test('before a lobby it saves once, says what happened, then saves no more', async () => {
  const fresh = setup();
  fresh.session.beforeLobby();
  assert.deepEqual(fresh.told, ['Lobby play isn\'t saved.'], 'before a Continue nothing is written');

  const ok = setup();
  await ok.session.resume();
  ok.session.beforeLobby();
  assert.deepEqual(ok.told, [NOTICES.lobby]);
  assert.equal(stored(ok.storage).rev, 1);
  assert.equal(ok.session.save('auto').reason, 'paused');

  const failed = setup();
  await failed.session.resume();
  failed.storage.setItem = full;
  failed.session.beforeLobby();
  assert.deepEqual(failed.told, [NOTICES.quota, NOTICES['lobby-failed']]);
});

test('the Continue screen\'s summary: the day, when it was saved, and whether this character has a body', () => {
  const storage = memory();
  storage.setItem(KEY, record({ savedAt: 5000 }));
  const ok = setup({ storage });
  ok.session.boot();
  assert.deepEqual(ok.session.summary(), { day: 3, savedAt: 5000, hasBody: true, newerFeatures: false });
  storage.setItem(KEY, record({ clock: null, features: 99 }));
  const other = setup({ storage, active: 'c0123456789abcdef', ids: ['c0123456789abcdef'] });
  other.session.boot();
  assert.deepEqual(other.session.summary(), { day: null, savedAt: 1, hasBody: false, newerFeatures: true });
});

test('the world is held while the choice is open as well as while a save opens', () => {
  const { session } = setup();
  assert.equal(session.holding, false);
  session.choosing = true;
  assert.equal(session.holding, true);
});

test('New game writes a fresh save with only the body played now, then clears the land\'s changes', async () => {
  const storage = memory();
  storage.setItem(KEY, record({ bodies: { outlaw: body(), c0123456789abcdef: body() } }));
  storage.setItem('ascii-realm-edits-1', JSON.stringify({ v: SAVE_VERSION, game: 'ascii-realm', kind: 'edits', rev: 2,
    savedAt: 1, features: SAVE_FEATURES, world: WORLD, chunks: { '0,0': [['fell', 'tree-1']] } }));
  const { session, inventory, told } = setup({ storage });
  inventory.add('lute');
  const order = [];
  const { setItem } = storage;
  storage.setItem = (key, value) => {
    order.push(key);
    setItem(key, value);
  };
  session.boot();
  assert.equal(session.save('auto').reason, 'gated');
  const started = session.startOver();
  assert.equal(session.holding, true);
  assert.deepEqual(await started, { ok: true, rev: 5 });
  assert.equal(session.holding, false);
  assert.deepEqual(order, [KEY, 'ascii-realm-edits-1'], 'the save first, the land second');
  const fresh = stored(storage);
  assert.deepEqual(Object.keys(fresh.bodies), ['outlaw']);
  assert.deepEqual([fresh.bodies.outlaw.x, fresh.bodies.outlaw.bag.some((stack) => stack?.id === 'lute')], [4, true]);
  const edits = JSON.parse(storage.map.get('ascii-realm-edits-1'));
  assert.deepEqual([edits.rev, edits.chunks], [3, {}]);
  assert.deepEqual(session.save('auto'), { ok: true, rev: 6 });
  assert.deepEqual(told, []);
});

test('a New game whose save is refused changes nothing, says nothing and keeps saving off', async () => {
  const storage = memory();
  storage.setItem(KEY, record());
  const edits = JSON.stringify({ v: SAVE_VERSION, game: 'ascii-realm', kind: 'edits', rev: 2, savedAt: 1,
    features: SAVE_FEATURES, world: WORLD, chunks: {} });
  storage.setItem('ascii-realm-edits-1', edits);
  const { session, told } = setup({ storage });
  storage.setItem = full;
  session.boot();
  assert.deepEqual(await session.startOver(), { ok: false, reason: 'quota' });
  assert.deepEqual([storage.map.get(KEY), storage.map.get('ascii-realm-edits-1')], [record(), edits]);
  assert.deepEqual(told, []);
  assert.equal(session.writable, false);
  assert.equal(session.explain('quota'), NOTICES.quota);
  assert.equal(session.explain('released'), NOTICES.gated);
  assert.equal(session.explain('nothing-like-this'), NOTICES.error);

  const released = setup({ storage });
  released.store.release();
  assert.equal((await released.session.startOver()).reason, 'released');
});

test('playing without saving writes nothing more on this page', async () => {
  const { session, storage, told } = setup();
  await session.resume();
  session.decline();
  assert.deepEqual(session.save('auto'), { ok: false, reason: 'declined' });
  assert.deepEqual(told, []);
  session.save('manual');
  assert.deepEqual(told, [NOTICES.tool]);
  assert.equal(session.status(), NOTICES.tool);
  session.beforeLobby();
  assert.equal(told.at(-1), NOTICES.paused);
  assert.equal(storage.map.has(KEY), false);
});
