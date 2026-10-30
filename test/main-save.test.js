import assert from 'node:assert/strict';
import test from 'node:test';
import { loadGame } from './helpers/main-game.js';
import { emptyRealm, SAVE_FEATURES } from '../src/save/format.js';
import { SaveStore } from '../src/save/store.js';
import { NOTICES } from '../src/save/session.js';

const KEY = 'ascii-realm-save-1';
const WORLD = { seed: 1, woodland: 'sparse' };

// A localStorage stand-in shared across page loads.
function memory() {
  const map = new Map();
  return { map, getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)) };
}

// What the page returns, as plain data from this test's own realm.
const plain = (value) => JSON.parse(JSON.stringify(value));
const settle = async () => { for (let i = 0; i < 10; i++) await null; };

// A page on `storage`, once its Continue has finished.
const open = async (storage, query = '', real = {}) => {
  const page = await loadGame(undefined, { href: `http://localhost/?debug&animals=0${query}`,
    real: { localStorage: storage, ...real } });
  await settle();
  return page;
};
const start = async (...args) => (await open(...args)).game;

// Grants each name to one holder at a time, until it lets go; `wait` holds
// every request until `go()`.
function fakeLocks() {
  const held = new Set();
  let go = () => {};
  const locks = {
    wait: null,
    hold() { locks.wait = new Promise((resolve) => { go = resolve; }); },
    go: () => go(),
    async request(name, options, callback) {
      await locks.wait;
      if (held.has(name)) return callback(null);
      held.add(name);
      try {
        return await callback({ name });
      } finally {
        held.delete(name);
      }
    },
  };
  return locks;
}

const switchTo = (game, id, ids = [id]) => {
  Object.defineProperty(game.characters, 'active', { get: () => ({ id, sheet: { name: 'Mara' } }) });
  Object.defineProperty(game.characters, 'characters', { get: () => ids.map((each) => ({ id: each })) });
};

test('play comes back on the next page load: place, bag, worn gear, health and the time of day', async () => {
  const storage = memory();
  const first = await start(storage);
  assert.equal(first.save.store.writer, 'writer');
  Object.assign(first.player, { x: 31.5, y: -12 });
  first.player.heading = 1.25;
  first.player.vitals.health = 40;
  first.inventory.add('oakLog', 3);
  first.inventory.add('dagger');
  first.inventory.equip(first.inventory.slots.findIndex((stack) => stack?.id === 'dagger'));
  first.dayClock.set(3000);
  first.dayClock.days = 4;
  assert.deepEqual(plain(first.save.tick()), { ok: true, rev: 1 });
  const saved = JSON.parse(storage.map.get(KEY));
  assert.deepEqual([saved.features, saved.clock.day, Math.round(saved.clock.tick)], [SAVE_FEATURES, 4, 3000]);
  assert.equal(saved.bodies.outlaw.worn.mainHand.id, 'dagger');

  const second = await start(storage);
  const { player, inventory, dayClock } = second;
  assert.deepEqual([player.x, player.y, player.heading, player.vitals.health], [31.5, -12, 1.25, 40]);
  assert.equal(second.camera.x, 31.5, 'the camera wakes with the body');
  assert.deepEqual(inventory.serialize(), first.inventory.serialize());
  assert.equal(player.equipment, inventory.equipment);
  assert.deepEqual([dayClock.day, Math.round(dayClock.tick)], [4, 3000]);
  assert.deepEqual(plain(second.save.tick()), { ok: true, rev: 2 }, 'the Continue claimed the save');
  assert.deepEqual(plain(first.save.tick()), { ok: false, reason: 'other-tab' }, 'the older page writes no more');
  assert.deepEqual(first.hud.toasts, [NOTICES.stale]);
  assert.deepEqual(plain(await second.save.restore()), { ok: true, status: 'ok', repaired: 0, applied: true });
});

test('?instruments and ?time= apply to a fresh start, and ?time= beats a saved clock', async () => {
  const storage = memory();
  const first = await start(storage, '&instruments');
  assert.ok(first.inventory.slots.some((stack) => stack?.id === 'lute'));
  first.inventory.remove(first.inventory.slots.findIndex((stack) => stack?.id === 'lute'));
  first.save.tick();
  const second = await start(storage, '&instruments&time=noon');
  assert.equal(second.inventory.slots.some((stack) => stack?.id === 'lute'), false, 'a Continue adds no instruments');
  assert.equal(Math.round(second.dayClock.tick), 6000);
});

test('stored body fields this build doesn\'t know survive a Continue and a save', async () => {
  const storage = memory();
  (await start(storage)).save.tick();
  const record = JSON.parse(storage.map.get(KEY));
  record.bodies.outlaw.later = { kept: true };
  storage.setItem(KEY, JSON.stringify(record));
  const second = await start(storage);
  second.player.x = 7;
  assert.equal(second.save.tick().ok, true);
  const body = JSON.parse(storage.map.get(KEY)).bodies.outlaw;
  assert.deepEqual([body.later, body.x], [{ kept: true }, 7]);
});

test('a damaged save starts fresh and says so; the first save writes over it', async () => {
  const storage = memory();
  storage.setItem(KEY, '{ not json');
  const game = await start(storage);
  assert.deepEqual(game.hud.toasts, [NOTICES.corrupt]);
  assert.equal(storage.map.get(`${KEY}-corrupt`), '{ not json', 'the damaged text is kept aside');
  assert.equal(game.player.x, 0);
  assert.equal(game.save.tick().ok, true);
  assert.equal(game.save.read().status, 'ok');
  const other = await start(memory());
  other.save.store.release();
  assert.equal((await other.save.restore()).reason, 'released');
});

test('nothing moves while a save is being put back', async () => {
  const storage = memory();
  (await start(storage)).save.tick();
  const locks = fakeLocks();
  locks.hold();
  const page = await open(storage, '', { navigator: { locks, vibrate() {} } });
  const { game } = page;
  assert.equal(game.save.saveSession.holding, true);
  const tick = game.dayClock.tick;
  page.hold('KeyD');
  page.frame(0.5);
  page.frame(0.5);
  assert.deepEqual([game.player.x, game.dayClock.tick], [0, tick]);
  assert.deepEqual(plain(game.save.tick()), { ok: false, reason: 'gated' }, 'and nothing is written');
  page.setHidden(true);
  page.setHidden(false);
  assert.equal(JSON.parse(storage.map.get(KEY)).rev, 1);
  locks.go();
  await settle();
  assert.equal(game.save.saveSession.holding, false);
  page.frame(0.5);
  assert.notEqual(game.dayClock.tick, tick);
});

test('it saves every minute when idle, not while hidden, and at once as the page hides', async () => {
  const storage = memory();
  const page = await open(storage);
  const { game, intervals, idles, runIdle } = page;
  const [timer] = intervals;
  assert.equal(timer.ms, 60_000);
  timer.run();
  assert.equal(idles.at(-1).options.timeout, 5000);
  runIdle();
  assert.equal(JSON.parse(storage.map.get(KEY)).rev, 1);
  page.document.hidden = true;
  timer.run();
  runIdle();
  assert.equal(JSON.parse(storage.map.get(KEY)).rev, 1, 'no autosave while hidden');
  page.document.hidden = false;
  game.player.x = 6;
  page.setHidden(true);
  assert.deepEqual([JSON.parse(storage.map.get(KEY)).rev, JSON.parse(storage.map.get(KEY)).bodies.outlaw.x], [2, 6]);
  page.setHidden(false);
  game.player.x = 8;
  page.window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: true }));
  assert.deepEqual([JSON.parse(storage.map.get(KEY)).bodies.outlaw.x, game.save.store.writer], [8, 'released']);
});

test('a defeat saves the body woken at spawn once the browser is idle', async () => {
  const storage = memory();
  const page = await open(storage);
  const { game } = page;
  game.player.x = 9;
  game.player.vitals.health = 0;
  page.frame();
  assert.equal(storage.map.has(KEY), false, 'not inside the frame');
  page.runIdle();
  const { x, health } = JSON.parse(storage.map.get(KEY)).bodies.outlaw;
  assert.deepEqual([x, health > 0], [0, true]);
});

test('Save now and Save game save at once and say so; the Game panel tells how saving goes', async () => {
  const storage = memory();
  const page = await open(storage);
  const { game, saveElements } = page;
  assert.equal(saveElements.get('phone-menu-save').hidden, false);
  assert.equal(saveElements.get('save-controls').hidden, false);
  saveElements.get('save-controls').dispatchEvent(new Event('toggle'));
  assert.equal(saveElements.get('save-status').textContent, 'Saves every minute and when you leave.');
  saveElements.get('save-now').dispatchEvent(new Event('click'));
  saveElements.get('phone-menu-save').dispatchEvent(new Event('click'));
  assert.equal(JSON.parse(storage.map.get(KEY)).rev, 2);
  assert.deepEqual(game.hud.toasts, ['Game saved.', 'Game saved.']);
  assert.match(saveElements.get('save-status').textContent, /Last saved \d+:\d\d ago\.$/);
  page.setPhone(true);
  assert.equal(saveElements.get('save-controls').hidden, true, 'phones save from the menu row');
});

test('joining a lobby saves first, says so, then stops saving for the rest of the page', async () => {
  const storage = memory();
  const game = await start(storage);
  game.multiplayer.onJoin({ seed: 1, code: 'ABC234' });
  assert.deepEqual(game.hud.toasts, ['Game saved. Lobby play isn\'t saved.']);
  assert.equal(JSON.parse(storage.map.get(KEY)).rev, 1);
  game.multiplayer.room = null;
  assert.deepEqual(plain(game.save.now()), { ok: false, reason: 'paused' });
  assert.equal(game.hud.toasts.at(-1), 'Lobby play isn\'t saved.');
});

test('lobby pages, preview scenes and ?nogate save nothing and offer no save', async () => {
  const storage = memory();
  for (const [query, reason] of [['&room=ABCD', 'lobby'], ['&scene=hill', 'scene'], ['&scene=ruins', 'scene']]) {
    const { game, saveElements } = await open(storage, query);
    assert.equal(game.save.store, null, query);
    assert.equal(game.save.saveSession, null, query);
    assert.deepEqual(plain(game.save.now()), { ok: false, reason }, query);
    assert.deepEqual(plain(game.save.read()), { status: reason }, query);
    assert.deepEqual(plain(await game.save.claim()), { ok: false, reason }, query);
    assert.deepEqual(plain(await game.save.restore()), { ok: false, reason }, query);
    assert.equal(saveElements.get('phone-menu-save').hidden, true, query);
    assert.equal(saveElements.get('save-controls').hidden, true, query);
    game.player.vitals.health = 0;
  }
  assert.equal(storage.map.has(KEY), false);
  const page = await open(storage, '&nogate');
  assert.deepEqual(plain(page.game.save.tick()), { ok: false, reason: 'tool' });
  assert.deepEqual([page.intervals.length, page.saveElements.get('phone-menu-save').hidden], [0, true]);
  page.frame();
  page.game.player.vitals.health = 0;
  page.frame();
  page.runIdle();
  assert.equal(storage.map.has(KEY), false);
});

test('a lobby page that falls in battle saves nothing', async () => {
  const page = await open(memory(), '&room=ABCD');
  page.game.player.vitals.health = 0;
  page.frame();
  assert.deepEqual(page.idles, []);
});

test('a character switch puts their body on at once and saves soon', async () => {
  const storage = memory();
  const page = await open(storage);
  const { game } = page;
  game.player.x = 12;
  game.camera.x = 999;
  switchTo(game, 'c0123456789abcdef');
  game.characters.onChange();
  assert.deepEqual([game.player.x, game.camera.x], [0, 0], 'the new character sets out from spawn');
  page.runIdle();
  const { bodies, active } = JSON.parse(storage.map.get(KEY));
  assert.deepEqual([bodies.outlaw.x, bodies.c0123456789abcdef.x, active], [12, 0, 'c0123456789abcdef']);
  game.characters.onChange();
  assert.deepEqual(page.idles, [], 'the same character again changes nothing');
});

test('a refused first save after a character switch keeps the outgoing body for the next save', async () => {
  const storage = memory();
  const game = await start(storage);
  game.player.x = 12;
  game.inventory.add('oakLog', 3);
  const bag = plain(game.inventory.serialize());
  switchTo(game, 'c0123456789abcdef');
  const { setItem } = storage;
  storage.setItem = (key, value) => {
    if (key === KEY) throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
    setItem(key, value);
  };
  assert.deepEqual(plain(game.save.now()), { ok: false, reason: 'quota' });
  assert.deepEqual(game.hud.toasts, [NOTICES.quota]);
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

test('a page that waited on another tab continues once it closes, keeping a switched-away body', async () => {
  const storage = memory();
  const locks = fakeLocks();
  const other = new SaveStore({ storage, world: WORLD, locks, now: () => 1 });
  assert.equal(await other.ready, 'writer');
  const game = await start(storage, '', { navigator: { locks, vibrate() {} } });
  assert.equal(game.save.store.writer, 'other-tab');
  assert.deepEqual(game.hud.toasts, [NOTICES['other-tab']]);
  game.player.x = 12;
  game.inventory.add('oakLog', 3);
  const bag = plain(game.inventory.serialize());
  const [next, kept] = ['c0123456789abcdef', 'cfedcba9876543210'];
  switchTo(game, next, [next, kept]);
  game.characters.onChange();
  assert.equal(game.player.x, 0, 'the new character is played');
  assert.deepEqual(plain(game.save.now()), { ok: false, reason: 'gated' });
  assert.equal((await other.claim()).ok, true);
  const body = (x) => ({ savedAt: 1, x, y: 0, heading: 0, health: 50, stamina: 50, respawn: null, bag: [], worn: {} });
  const theirs = { ...emptyRealm(WORLD), bodies: { outlaw: body(40), [kept]: body(9) }, active: kept };
  assert.equal(other.write('realm', theirs).ok, true);
  other.release();
  assert.equal((await game.save.restore()).ok, true);
  game.player.x = 3;
  assert.equal(game.save.now().ok, true);
  const { bodies, active } = JSON.parse(storage.map.get(KEY));
  assert.equal(bodies.outlaw.x, 12, 'the body this page played wins over the other tab\'s');
  assert.deepEqual({ bag: bodies.outlaw.bag, worn: bodies.outlaw.worn }, bag);
  assert.equal(bodies[next].x, 3);
  assert.equal(bodies[kept].x, 9, 'a body this page never played is left as stored');
  assert.equal(active, next);
});

test('back from the back/forward cache after another tab saved, the page says to reload', async () => {
  const storage = memory();
  const locks = fakeLocks();
  const page = await open(storage, '', { navigator: { locks, vibrate() {} } });
  page.game.save.tick();
  page.window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: true }));
  const other = new SaveStore({ storage, world: WORLD, locks });
  assert.equal((await other.claim()).ok, true);
  assert.equal(other.write('realm', other.realm).ok, true);
  other.release();
  page.window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
  page.window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: false }));
  await settle();
  assert.equal(page.game.save.store.writer, 'stale');
  assert.deepEqual(page.game.hud.toasts, [NOTICES.stale]);
});

test('a switch away from a character deleted meanwhile files no body for them, even after a refused save', async () => {
  const storage = memory();
  const game = await start(storage);
  const [gone, next] = ['c0123456789abcdef', 'cfedcba9876543210'];
  game.save.live.appliedId = gone;
  switchTo(game, next);
  game.save.store.pause('test');
  assert.deepEqual(plain(game.save.now()), { ok: false, reason: 'paused' });
  game.save.store.pausedBy = null;
  assert.equal(game.save.now().ok, true);
  assert.deepEqual(Object.keys(JSON.parse(storage.map.get(KEY)).bodies).sort(), [next]);
});

test('fine bakes share the idle wait with saves', async () => {
  const budgets = [];
  const page = await open(memory(), '&nogate', { fineBakesPending: () => true, bakeFine: (ms) => budgets.push(ms) });
  page.frame();
  page.frame();
  assert.deepEqual(page.idles.map(({ options }) => options.timeout), [120], 'one bake waits at a time');
  page.runIdle();
  assert.deepEqual(budgets, [3]);
});
