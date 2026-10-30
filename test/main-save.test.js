import assert from 'node:assert/strict';
import test from 'node:test';
import { loadGame } from './helpers/main-game.js';
import { emptyRealm } from '../src/save/format.js';
import { SaveStore } from '../src/save/store.js';

const KEY = 'ascii-realm-save-1';

// A localStorage stand-in shared across page loads.
function memory() {
  const map = new Map();
  return { map, getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)) };
}

// What the page returns, as plain data from this test's own realm.
const plain = (value) => JSON.parse(JSON.stringify(value));

const start = async (storage, query = '', real = {}) => (await loadGame(undefined, {
  href: `http://localhost/?debug&animals=0${query}`, real: { localStorage: storage, ...real } })).game;

// Grants each name to one holder at a time, until it lets go.
function fakeLocks() {
  const held = new Set();
  return {
    async request(name, options, callback) {
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

test('a body saved by hand comes back on the next page load: place, bag, worn gear and health', async () => {
  const storage = memory();
  const first = await start(storage);
  assert.equal(first.save.store.writer, 'writer');
  Object.assign(first.player, { x: 31.5, y: -12 });
  first.player.heading = 1.25;
  first.player.vitals.health = 40;
  first.inventory.add('oakLog', 3);
  first.inventory.add('dagger');
  first.inventory.equip(first.inventory.slots.findIndex((stack) => stack?.id === 'dagger'));
  assert.deepEqual(plain(first.save.now()), { ok: true, rev: 1 });
  assert.deepEqual(plain(first.save.now()), { ok: true, rev: 2 }, 'later saves land on the same record');
  const saved = JSON.parse(storage.map.get(KEY));
  assert.equal(saved.active, 'outlaw');
  assert.equal(saved.bodies.outlaw.worn.mainHand.id, 'dagger');

  const second = await start(storage);
  assert.equal(second.player.x, 0, 'nothing restores on its own');
  assert.equal(second.save.read().status, 'ok');
  assert.deepEqual(plain(second.save.now()), { ok: false, reason: 'unclaimed' }, 'a page that only read may not write');
  second.camera.x = 999;
  assert.deepEqual(plain(await second.save.restore()), { status: 'ok', repaired: 0, applied: true });
  const { player, inventory } = second;
  assert.deepEqual([player.x, player.y, player.heading, player.vitals.health], [31.5, -12, 1.25, 40]);
  assert.equal(second.camera.x, 31.5, 'the camera wakes with the body');
  assert.deepEqual(inventory.serialize(), first.inventory.serialize());
  assert.equal(inventory.equipment.mainHand.id, 'dagger');
  assert.equal(player.equipment, inventory.equipment);
  assert.deepEqual(plain(second.save.now()), { ok: true, rev: 3 }, 'restoring claims the save');
  assert.deepEqual(plain(first.save.now()), { ok: false, reason: 'other-tab' }, 'the older page writes no more');
});

test('stored body fields this build doesn\'t know survive a restore and a save', async () => {
  const storage = memory();
  const first = await start(storage);
  first.save.now();
  const record = JSON.parse(storage.map.get(KEY));
  record.bodies.outlaw.later = { kept: true };
  storage.setItem(KEY, JSON.stringify(record));
  const second = await start(storage);
  await second.save.restore();
  second.player.x = 7;
  assert.equal(second.save.now().ok, true);
  const body = JSON.parse(storage.map.get(KEY)).bodies.outlaw;
  assert.deepEqual([body.later, body.x], [{ kept: true }, 7]);
});

test('a restore with nothing stored, or a damaged save, puts nothing back', async () => {
  const storage = memory();
  const game = await start(storage);
  game.player.x = 5;
  assert.deepEqual(plain(await game.save.restore()), { status: 'none', repaired: 0, applied: false });
  assert.equal(game.player.x, 5);
  storage.setItem(KEY, '{ not json');
  assert.deepEqual(plain(await game.save.restore()), { status: 'corrupt', repaired: 0, applied: false });
  assert.equal(storage.map.get(`${KEY}-corrupt`), '{ not json', 'the damaged text is kept aside');
  assert.equal(game.player.x, 5);
  const other = await start(memory());
  other.save.store.release();
  assert.deepEqual(plain(await other.save.restore()), { status: 'released', repaired: 0, applied: false });
});

test('joining a lobby stops saving for the rest of the page', async () => {
  const game = await start(memory());
  game.multiplayer.onJoin({ seed: 1, code: 'ABC234' });
  game.multiplayer.room = null;
  assert.deepEqual(plain(game.save.now()), { ok: false, reason: 'paused' });
});

test('lobby pages and preview scenes build no store', async () => {
  const storage = memory();
  for (const [query, reason] of [['&room=ABCD', 'lobby'], ['&scene=hill', 'scene'], ['&scene=ruins', 'scene']]) {
    const game = await start(storage, query);
    assert.equal(game.save.store, null, query);
    assert.deepEqual(plain(game.save.now()), { ok: false, reason }, query);
    assert.deepEqual(plain(game.save.read()), { status: reason }, query);
    assert.deepEqual(plain(await game.save.restore()), { status: reason, repaired: 0, applied: false }, query);
  }
  assert.equal(storage.map.has(KEY), false);
});

test('a save after the active character changed files the live body under its own id', async () => {
  const storage = memory();
  const game = await start(storage);
  game.player.x = 12;
  game.camera.x = 999;
  Object.defineProperty(game.characters, 'active', { get: () => ({ id: 'c0123456789abcdef' }) });
  Object.defineProperty(game.characters, 'characters', { get: () => [{ id: 'c0123456789abcdef' }] });
  assert.equal(game.save.now().ok, true);
  const { bodies, active } = JSON.parse(storage.map.get(KEY));
  assert.equal(bodies.outlaw.x, 12);
  assert.equal(bodies.c0123456789abcdef.x, 0, 'the new character sets out from spawn');
  assert.equal(active, 'c0123456789abcdef');
  assert.equal(game.camera.x, 0, 'the camera wakes with the new body');
});

test('a refused first save after a character switch keeps the outgoing body for the next save', async () => {
  const storage = memory();
  const game = await start(storage);
  game.player.x = 12;
  game.inventory.add('oakLog', 3);
  const bag = plain(game.inventory.serialize());
  Object.defineProperty(game.characters, 'active', { get: () => ({ id: 'c0123456789abcdef' }) });
  Object.defineProperty(game.characters, 'characters', { get: () => [{ id: 'c0123456789abcdef' }] });
  const { setItem } = storage;
  storage.setItem = (key, value) => {
    if (key === KEY) throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
    setItem(key, value);
  };
  assert.deepEqual(plain(game.save.now()), { ok: false, reason: 'quota' });
  assert.equal(storage.map.has(KEY), false);
  assert.equal(game.player.x, 0, 'the new character is played');
  storage.setItem = setItem;
  game.player.x = 3;
  assert.equal(game.save.now().ok, true);
  const { bodies } = JSON.parse(storage.map.get(KEY));
  assert.equal(bodies.outlaw.x, 12, 'the outgoing body was kept through the refusal');
  assert.deepEqual({ bag: bodies.outlaw.bag, worn: bodies.outlaw.worn }, bag);
  assert.equal(bodies.c0123456789abcdef.x, 3);
});

test('bodies a refused save filed survive claiming the save from another tab, which keeps its other bodies', async () => {
  const storage = memory();
  const locks = fakeLocks();
  const other = new SaveStore({ storage, world: { seed: 1, woodland: 'sparse' }, locks, now: () => 1 });
  assert.equal(await other.ready, 'writer');
  const game = await start(storage, '', { navigator: { locks, vibrate() {} } });
  assert.equal(await game.save.store.ready, 'other-tab');
  game.player.x = 12;
  game.inventory.add('oakLog', 3);
  const bag = plain(game.inventory.serialize());
  const [next, kept] = ['c0123456789abcdef', 'cfedcba9876543210'];
  Object.defineProperty(game.characters, 'active', { get: () => ({ id: next }) });
  Object.defineProperty(game.characters, 'characters', { get: () => [{ id: next }, { id: kept }] });
  assert.deepEqual(plain(game.save.now()), { ok: false, reason: 'other-tab' });
  assert.equal(game.player.x, 0, 'the new character is played');
  assert.deepEqual(plain(await game.save.claim()), { ok: false, reason: 'other-tab' });
  assert.equal((await other.claim()).ok, true);
  const body = (x) => ({ savedAt: 1, x, y: 0, heading: 0, health: 50, stamina: 50, respawn: null, bag: [], worn: {} });
  const theirs = { ...emptyRealm(other.world), bodies: { outlaw: body(40), [kept]: body(9) }, active: kept };
  assert.equal(other.write('realm', theirs).ok, true);
  other.release();
  assert.equal((await game.save.claim()).ok, true);
  game.player.x = 3;
  assert.equal(game.save.now().ok, true);
  const { bodies, active } = JSON.parse(storage.map.get(KEY));
  assert.equal(bodies.outlaw.x, 12, 'the body this page played wins over the other tab\'s');
  assert.deepEqual({ bag: bodies.outlaw.bag, worn: bodies.outlaw.worn }, bag);
  assert.equal(bodies[next].x, 3);
  assert.equal(bodies[kept].x, 9, 'a body this page never played is left as stored');
  assert.equal(active, next);
  game.player.x = 5;
  storage.setItem(KEY, JSON.stringify({ ...JSON.parse(storage.map.get(KEY)), bodies: { [next]: body(1) } }));
  assert.equal((await game.save.claim()).ok, true);
  assert.equal(game.save.now().ok, true);
  assert.equal(JSON.parse(storage.map.get(KEY)).bodies.outlaw, undefined, 'a written body is no longer pending');
});

test('a switch away from a character deleted meanwhile files no body for them, even after a refused save', async () => {
  const storage = memory();
  const game = await start(storage);
  const [gone, next] = ['c0123456789abcdef', 'cfedcba9876543210'];
  game.save.live.appliedId = gone;
  Object.defineProperty(game.characters, 'active', { get: () => ({ id: next }) });
  Object.defineProperty(game.characters, 'characters', { get: () => [{ id: next }] });
  game.save.store.pause('test');
  assert.deepEqual(plain(game.save.now()), { ok: false, reason: 'paused' });
  game.save.store.pausedBy = null;
  assert.equal(game.save.now().ok, true);
  assert.deepEqual(Object.keys(JSON.parse(storage.map.get(KEY)).bodies).sort(), [next]);
});
