import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyEdits, emptyRealm, OUTLAW, SAVE_FEATURES, SAVE_VERSION } from '../src/save/format.js';
import { SaveStore, isQuota } from '../src/save/store.js';

const WORLD = { seed: 1, woodland: 'sparse' };
const KEY = 'ascii-realm-save-1';
const EDITS = 'ascii-realm-edits-1';

function memory() {
  const map = new Map();
  return { map, getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)) };
}

// Grants each name to one holder at a time. Like the browser's, a request's
// promise settles only once its holder lets go.
function fakeLocks() {
  const held = new Set();
  return {
    held,
    async request(name, options, callback) {
      assert.deepEqual(options, { mode: 'exclusive', ifAvailable: true });
      await null;
      if (held.has(name)) return callback(null);
      held.add(name);
      try {
        return await callback({ name });
      } finally {
        held.delete(name);
      }
    },
  };
}

// Like `fakeLocks`, but holds each request until `open()`, and counts them.
function gatedLocks(locks = fakeLocks()) {
  let open = null;
  let gate = null;
  const gated = {
    calls: 0,
    locks,
    close() { gate = new Promise((resolve) => { open = resolve; }); },
    open: () => open(),
    async request(...args) {
      gated.calls++;
      await gate;
      return locks.request(...args);
    },
  };
  gated.close();
  return gated;
}

const settle = async () => { for (let i = 0; i < 5; i++) await null; };
const show = (persisted = true) => Object.assign(new Event('pageshow'), { persisted });
const storageEvent = (key) => Object.assign(new Event('storage'), { key });
const store = (options = {}) => new SaveStore({ storage: memory(), world: WORLD, locks: null, now: () => 1000, ...options });
const stored = (storage, key = KEY) => JSON.parse(storage.map.get(key));

test('a page with no save writes, then keeps writing its own record', () => {
  const saves = store();
  assert.equal(saves.writer, 'writer');
  assert.deepEqual(saves.read(), { status: 'none', record: null, repaired: 0, newerFeatures: false });
  const realm = emptyRealm(WORLD);
  assert.deepEqual(saves.write('realm', realm), { ok: true, rev: 1 });
  assert.deepEqual([realm.rev, realm.savedAt, realm.features], [1, 1000, SAVE_FEATURES]);
  assert.deepEqual(saves.write('realm', realm), { ok: true, rev: 2 });
  assert.deepEqual(saves.read().record, realm);
  assert.deepEqual(saves.write('edits', emptyEdits(WORLD)), { ok: true, rev: 1 });
  assert.equal(stored(saves.storage, EDITS).kind, 'edits');
});

test('reading never makes a page the owner; claiming does', async () => {
  const storage = memory();
  const first = store({ storage });
  first.write('realm', emptyRealm(WORLD));
  const second = store({ storage });
  assert.equal(second.read().status, 'ok');
  assert.deepEqual(second.write('realm', emptyRealm(WORLD)), { ok: false, reason: 'unclaimed' });
  assert.deepEqual(second.write('realm', emptyRealm(WORLD)), { ok: false, reason: 'unclaimed' });
  const claimed = await second.claim();
  assert.equal(claimed.ok, true);
  assert.equal(second.realm.rev, 1);
  assert.deepEqual(second.write('realm', second.realm), { ok: true, rev: 2 });
  assert.deepEqual(first.write('realm', emptyRealm(WORLD)), { ok: false, reason: 'other-tab' });
  assert.equal(first.foreign, true);
  assert.equal(stored(storage).rev, 2);
});

test('without locks two pages that read the same rev cannot both write', async () => {
  const storage = memory();
  store({ storage }).write('realm', emptyRealm(WORLD));
  const a = store({ storage });
  const b = store({ storage });
  await a.claim();
  await b.claim();
  const mine = { ...emptyRealm(WORLD), active: 'a' };
  assert.equal(a.write('realm', mine).ok, true);
  assert.deepEqual(b.write('realm', { ...emptyRealm(WORLD), active: 'b' }), { ok: false, reason: 'other-tab' });
  assert.equal(stored(storage).active, 'a');
});

test('a store without storage, or with storage that throws, is unavailable', async () => {
  const none = store({ storage: null });
  assert.equal(none.read().status, 'unavailable');
  assert.deepEqual(none.write('realm', emptyRealm(WORLD)), { ok: false, reason: 'unavailable' });
  assert.deepEqual(await none.claim(), { ok: false, reason: 'unavailable', status: 'unavailable', record: null,
    repaired: 0, newerFeatures: false });
  const throwing = store({ storage: { getItem() { throw new Error('blocked'); }, setItem() {} } });
  assert.equal(throwing.read().status, 'unavailable');
  assert.deepEqual(throwing.write('realm', emptyRealm(WORLD)), { ok: false, reason: 'unavailable' });
});

test('the default storage is the page localStorage, or none when it is blocked', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    const storage = memory();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => storage });
    assert.equal(new SaveStore({ world: WORLD, locks: null }).storage, storage);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new Error('denied'); } });
    assert.equal(new SaveStore({ world: WORLD, locks: null }).storage, null);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: undefined });
    assert.equal(new SaveStore({ world: WORLD, locks: null }).storage, null);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else delete globalThis.localStorage;
  }
});

test('a full storage reports quota and keeps the previous record', () => {
  for (const error of [{ name: 'QuotaExceededError' }, { code: 22 }, { name: 'NS_ERROR_DOM_QUOTA_REACHED' }, { code: 1014 }]) {
    const saves = store();
    const realm = emptyRealm(WORLD);
    saves.write('realm', realm);
    const before = saves.storage.map.get(KEY);
    saves.storage.setItem = () => { throw error; };
    assert.deepEqual(saves.write('realm', realm), { ok: false, reason: 'quota' }, JSON.stringify(error));
    assert.equal(saves.storage.map.get(KEY), before);
    assert.equal(realm.rev, 1);
    assert.equal(isQuota(error), true);
  }
  const saves = store();
  saves.storage.setItem = () => { throw new Error('disk'); };
  assert.deepEqual(saves.write('realm', emptyRealm(WORLD)), { ok: false, reason: 'error' });
  assert.equal(isQuota(null), false);
});

test('a record over its cap is refused before storage is touched', () => {
  const saves = store();
  assert.deepEqual(saves.write('realm', { ...emptyRealm(WORLD), pad: 'x'.repeat(300 * 1024) }), { ok: false, reason: 'too-big' });
  assert.equal(saves.storage.map.size, 0);
});

test('a corrupt record is copied aside once, and left in place until the next write', async () => {
  const saves = store();
  let copies = 0;
  const setItem = saves.storage.setItem;
  saves.storage.setItem = (key, value) => {
    if (key.endsWith('-corrupt')) copies++;
    setItem(key, value);
  };
  saves.storage.map.set(KEY, '{broken');
  assert.equal(saves.read().status, 'corrupt');
  assert.equal(saves.read().status, 'corrupt');
  assert.equal(copies, 1);
  assert.equal(saves.storage.map.get(`${KEY}-corrupt`), '{broken');
  assert.equal(saves.storage.map.get(KEY), '{broken');
  assert.deepEqual(saves.write('realm', emptyRealm(WORLD)), { ok: false, reason: 'unclaimed' });
  const claimed = await saves.claim();
  assert.deepEqual([claimed.ok, claimed.status, saves.realm], [true, 'corrupt', null]);
  assert.deepEqual(saves.write('realm', emptyRealm(WORLD)), { ok: true, rev: 1 });
  assert.equal(saves.storage.map.get(`${KEY}-corrupt`), '{broken');
});

test('a quarantine that cannot be written is tried again on the next read', () => {
  const map = new Map([[KEY, 'nope']]);
  let fail = true;
  const saves = store({ storage: { map, getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { if (fail) throw new Error('full'); map.set(key, value); } } });
  assert.equal(saves.read().status, 'corrupt');
  assert.equal(map.has(`${KEY}-corrupt`), false);
  fail = false;
  saves.read();
  assert.equal(map.get(`${KEY}-corrupt`), 'nope');
});

test('a newer version makes the store read-only', async () => {
  const saves = store();
  saves.storage.map.set(KEY, JSON.stringify({ ...emptyRealm(WORLD), v: SAVE_VERSION + 1 }));
  assert.equal((await saves.claim()).reason, 'read-only');
  assert.equal(saves.readOnly, 'newer');
  assert.deepEqual(saves.write('realm', emptyRealm(WORLD)), { ok: false, reason: 'read-only' });
});

test('newer features can be played but not written over', async () => {
  const saves = store();
  saves.storage.map.set(KEY, JSON.stringify({ ...emptyRealm(WORLD), rev: 4, features: 99 }));
  const claimed = await saves.claim();
  assert.deepEqual([claimed.ok, claimed.status, saves.readOnly], [true, 'ok', 'newer-features']);
  assert.deepEqual(saves.write('realm', saves.realm), { ok: false, reason: 'read-only' });
  assert.equal(stored(saves.storage).features, 99);
});

test('unknown fields survive a read and a write at the same features', async () => {
  const saves = store();
  const body = { x: 1, y: 2, heading: 0, health: 5, stamina: 5, respawn: null, bag: [], worn: {}, mood: 'calm' };
  saves.storage.map.set(KEY, JSON.stringify({ ...emptyRealm(WORLD), rev: 1, later: [1], bodies: { [OUTLAW]: body } }));
  await saves.claim();
  assert.equal(saves.write('realm', saves.realm).ok, true);
  const record = stored(saves.storage);
  assert.deepEqual([record.later, record.bodies[OUTLAW].mood, record.rev], [[1], 'calm', 2]);
});

test('a paused store refuses to write', () => {
  const saves = store();
  assert.equal(saves.paused, false);
  saves.pause('lobby');
  assert.deepEqual([saves.paused, saves.pausedBy], [true, 'lobby']);
  assert.deepEqual(saves.write('realm', emptyRealm(WORLD)), { ok: false, reason: 'paused' });
});

test('another tab saving this world marks the store, other keys do not', () => {
  const events = new EventTarget();
  const saves = store({ events });
  let told = 0;
  saves.onForeign = () => told++;
  events.dispatchEvent(storageEvent('ascii-realm-save-2'));
  events.dispatchEvent(storageEvent(null));
  assert.deepEqual([saves.foreign, told], [false, 0]);
  events.dispatchEvent(storageEvent(KEY));
  events.dispatchEvent(storageEvent(EDITS));
  assert.deepEqual([saves.foreign, told], [true, 2]);
});

test('with locks one page writes and the other only reads until the first lets go', async () => {
  const storage = memory();
  const locks = fakeLocks();
  const a = store({ storage, locks });
  const b = store({ storage, locks });
  assert.equal(a.writer, 'pending');
  assert.deepEqual(a.write('realm', emptyRealm(WORLD)), { ok: false, reason: 'pending' });
  assert.equal(await a.ready, 'writer');
  assert.equal(await b.ready, 'other-tab');
  assert.ok(locks.held.has(KEY), 'the lock is still held after ready');
  assert.deepEqual(a.write('realm', emptyRealm(WORLD)), { ok: true, rev: 1 });
  assert.deepEqual(b.write('realm', emptyRealm(WORLD)), { ok: false, reason: 'other-tab' });
  assert.deepEqual(await b.claim(), { ok: false, reason: 'other-tab' });
  a.release();
  assert.deepEqual(a.write('realm', emptyRealm(WORLD)), { ok: false, reason: 'released' });
  await null;
  const claimed = await b.claim();
  assert.equal(claimed.ok, true);
  assert.deepEqual(b.write('realm', b.realm), { ok: true, rev: 2 });
});

test('a browser that refuses locks falls back to the rev check', async () => {
  const saves = store({ locks: { request: () => Promise.reject(new Error('insecure')) } });
  assert.equal(await saves.ready, 'writer');
  const thrown = store({ locks: { request() { throw new Error('no'); } } });
  assert.equal(await thrown.ready, 'writer');
  assert.equal(saves.write('realm', emptyRealm(WORLD)).ok, true);
});

test('hiding the page saves first, then lets the lock go', async () => {
  const events = new EventTarget();
  const locks = fakeLocks();
  const saves = store({ events, locks });
  await saves.ready;
  const order = [];
  saves.onHide = () => order.push(saves.write('realm', emptyRealm(WORLD)).ok);
  events.dispatchEvent(new Event('pagehide'));
  assert.deepEqual(order, [true]);
  assert.equal(saves.writer, 'released');
  await null;
  await null;
  assert.equal(locks.held.size, 0);
  events.dispatchEvent(show(false));
  assert.equal(saves.writer, 'released');
});

test('a page back from the cache writes again when nobody saved meanwhile', async () => {
  const events = new EventTarget();
  const saves = store({ events, locks: fakeLocks() });
  await saves.ready;
  saves.write('realm', emptyRealm(WORLD));
  events.dispatchEvent(new Event('pagehide'));
  events.dispatchEvent(show());
  assert.equal(saves.writer, 'pending');
  assert.equal(await saves.ready, 'writer');
  assert.deepEqual(saves.write('realm', emptyRealm(WORLD)), { ok: true, rev: 2 });
});

test('a page back from the cache is stale when another tab saved meanwhile', async () => {
  const storage = memory();
  const events = new EventTarget();
  const locks = fakeLocks();
  const a = store({ storage, events, locks });
  await a.ready;
  a.write('realm', emptyRealm(WORLD));
  events.dispatchEvent(new Event('pagehide'));
  await null;
  const b = store({ storage, locks });
  await b.claim();
  b.write('realm', b.realm);
  b.release();
  await null;
  events.dispatchEvent(show());
  assert.equal(await a.ready, 'stale');
  assert.deepEqual(a.write('realm', emptyRealm(WORLD)), { ok: false, reason: 'stale' });
  assert.equal((await a.claim()).ok, true);
  assert.equal(a.write('realm', a.realm).ok, true);
});

test('a page back from the cache reads only while another tab holds the lock', async () => {
  const storage = memory();
  const events = new EventTarget();
  const locks = fakeLocks();
  const a = store({ storage, events, locks });
  await a.ready;
  events.dispatchEvent(new Event('pagehide'));
  await null;
  const b = store({ storage, locks });
  assert.equal(await b.ready, 'writer');
  events.dispatchEvent(show());
  assert.equal(await a.ready, 'other-tab');
});

test('without locks a page back from the cache checks the rev at once', () => {
  const storage = memory();
  const events = new EventTarget();
  const saves = store({ storage, events });
  saves.write('realm', emptyRealm(WORLD));
  events.dispatchEvent(new Event('pagehide'));
  events.dispatchEvent(show());
  assert.equal(saves.writer, 'writer');
  storage.map.set(KEY, JSON.stringify({ ...emptyRealm(WORLD), rev: 9 }));
  events.dispatchEvent(new Event('pagehide'));
  events.dispatchEvent(show());
  assert.equal(saves.writer, 'stale');
  storage.map.set(KEY, '{');
  events.dispatchEvent(show());
  assert.equal(saves.writer, 'stale', 'an unreadable rev counts as moved');
});

test('claiming reads the edits record too, so newer edits are never written over', async () => {
  const saves = store();
  saves.storage.map.set(EDITS, JSON.stringify({ ...emptyEdits(WORLD), rev: 3, features: 99 }));
  const claimed = await saves.claim();
  assert.deepEqual([claimed.ok, saves.readOnly], [true, 'newer-features']);
  assert.deepEqual(saves.write('edits', emptyEdits(WORLD)), { ok: false, reason: 'read-only' });
  const newer = store();
  newer.storage.map.set(EDITS, JSON.stringify({ ...emptyEdits(WORLD), v: SAVE_VERSION + 1 }));
  assert.equal((await newer.claim()).reason, 'read-only');
  assert.deepEqual(newer.write('edits', emptyEdits(WORLD)), { ok: false, reason: 'read-only' });
  assert.equal(stored(newer.storage, EDITS).v, SAVE_VERSION + 1);
});

test('claiming adopts the rev of the text it read, even when another tab saves mid-claim', async () => {
  const storage = memory();
  storage.map.set(KEY, JSON.stringify({ ...emptyRealm(WORLD), rev: 1 }));
  const getItem = storage.getItem;
  storage.getItem = (key) => {
    const text = getItem(key);
    if (key === KEY) storage.map.set(KEY, JSON.stringify({ ...emptyRealm(WORLD), rev: 2, active: null, later: 'b' }));
    return text;
  };
  const saves = store({ storage });
  await saves.claim();
  storage.getItem = getItem;
  assert.deepEqual([saves.realm.rev, saves.ownRev.realm], [1, 1]);
  assert.deepEqual(saves.write('realm', saves.realm), { ok: false, reason: 'other-tab' });
  assert.equal(stored(storage).later, 'b');
});

test('a lock granted after the page let go is given up at once', async () => {
  const events = new EventTarget();
  const locks = fakeLocks();
  const saves = store({ events, locks });
  events.dispatchEvent(new Event('pagehide'));
  assert.equal(await saves.ready, 'released');
  assert.deepEqual(saves.write('realm', emptyRealm(WORLD)), { ok: false, reason: 'released' });
  await null;
  assert.equal(locks.held.size, 0);
  const refused = store({ locks: { request: () => Promise.reject(new Error('insecure')) } });
  refused.release();
  assert.equal(await refused.ready, 'released');
  const other = store({ locks });
  assert.equal(await other.ready, 'writer');
});

test('letting go while a claim waits for ready wins: no new lock, and the claim is refused', async () => {
  for (const letGo of [(saves) => saves.release(), (saves, events) => events.dispatchEvent(new Event('pagehide'))]) {
    const events = new EventTarget();
    const gated = gatedLocks();
    const saves = store({ events, locks: gated });
    const claim = saves.claim();
    letGo(saves, events);
    gated.open();
    assert.deepEqual(await claim, { ok: false, reason: 'released' });
    await settle();
    assert.equal(saves.writer, 'released');
    assert.equal(gated.calls, 1, 'the claim asked for no lock of its own');
    assert.equal(gated.locks.held.size, 0);
    const other = store({ locks: gated.locks });
    assert.equal(await other.ready, 'writer');
    other.release();
    await settle();
    events.dispatchEvent(show());
    assert.equal(await saves.ready, 'writer', 'only a page back from the cache asks again');
  }
});

test('letting go while a claim waits for its own lock wins as well', async () => {
  const gated = gatedLocks();
  const holder = store({ locks: gated.locks });
  await holder.ready;
  const saves = store({ locks: gated });
  gated.open();
  assert.equal(await saves.ready, 'other-tab');
  holder.release();
  gated.close();
  const claim = saves.claim();
  await settle();
  assert.equal(gated.calls, 2);
  saves.release();
  gated.open();
  assert.deepEqual(await claim, { ok: false, reason: 'released' });
  await settle();
  assert.equal(saves.writer, 'released');
  assert.equal(gated.locks.held.size, 0);
  assert.equal(await store({ locks: gated.locks }).ready, 'writer');
});

test('a page that let go cannot claim until it is back from the cache', async () => {
  const saves = store();
  saves.release();
  assert.deepEqual(await saves.claim(), { ok: false, reason: 'released' });
  assert.deepEqual(saves.write('realm', emptyRealm(WORLD)), { ok: false, reason: 'released' });
});

test('data that cannot be turned into JSON is an error, not a throw', () => {
  const saves = store();
  const cyclic = emptyRealm(WORLD);
  cyclic.self = cyclic;
  assert.deepEqual(saves.write('realm', cyclic), { ok: false, reason: 'error' });
  let deep = [];
  for (let i = 0; i < 1e6; i++) deep = [deep];
  assert.deepEqual(saves.write('realm', { ...emptyRealm(WORLD), deep }), { ok: false, reason: 'error' });
  assert.deepEqual(saves.write('realm', { ...emptyRealm(WORLD), big: 1n }), { ok: false, reason: 'error' });
  assert.equal(saves.storage.map.size, 0);
});

test('a save that throws as the page hides still lets the lock go', async () => {
  const listeners = {};
  const locks = fakeLocks();
  const saves = store({ locks, events: { addEventListener: (type, listener) => { listeners[type] = listener; } } });
  await saves.ready;
  saves.onHide = () => { throw new Error('boom'); };
  assert.throws(() => listeners.pagehide(), /boom/);
  assert.equal(saves.writer, 'released');
  await null;
  await null;
  assert.equal(locks.held.size, 0);
});

test('the default locks are the page navigator.locks, and the default clock is the real one', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  try {
    const locks = fakeLocks();
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks } });
    const saves = new SaveStore({ storage: memory(), world: WORLD });
    assert.equal(await saves.ready, 'writer');
    assert.ok(locks.held.has(KEY));
    const before = Date.now();
    const realm = emptyRealm(WORLD);
    saves.write('realm', realm);
    assert.ok(realm.savedAt >= before && realm.savedAt <= Date.now());
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: undefined });
    assert.equal(new SaveStore({ storage: memory(), world: WORLD }).locks, null);
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else delete globalThis.navigator;
  }
});

test('a stored rev that is not a whole number counts as 0', async () => {
  const saves = store();
  saves.storage.map.set(KEY, JSON.stringify({ ...emptyRealm(WORLD), rev: 'x' }));
  await saves.claim();
  assert.equal(saves.ownRev.realm, 0);
  assert.deepEqual(saves.write('realm', saves.realm), { ok: true, rev: 1 });
});
