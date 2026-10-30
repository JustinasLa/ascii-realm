import assert from 'node:assert/strict';
import test from 'node:test';
import { FakeWorld, loadGame } from './helpers/main-game.js';
import { emptyRealm, SAVE_FEATURES } from '../src/save/format.js';
import { SaveStore } from '../src/save/store.js';
import { NOTICES } from '../src/save/session.js';
import { InventoryScreen } from '../src/ui/inventory.js';
import { StartChoice } from '../src/ui/start-choice.js';
import { installBrowser } from './helpers/station-dom.js';

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

// A page on `storage`, once it has settled.
const open = async (storage, query = '', real = {}, options = {}) => {
  const page = await loadGame(undefined, { href: `http://localhost/?debug&animals=0${query}`,
    real: { localStorage: storage, ...real }, ...options });
  await settle();
  return page;
};
// Picks `action` on the save's choice and waits for it to go through.
const choose = async (game, action) => {
  game.save.choice.choose(action);
  await settle();
};
// A page on `storage` that pressed Continue if it was offered.
const start = async (...args) => {
  const { game } = await open(...args);
  if (game.save.choice.mode === 'continue') await choose(game, 'continue');
  return game;
};

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
  assert.equal(first.save.choice.mode, 'stale', 'and says so on a screen, not a toast');
  assert.deepEqual(first.hud.toasts, []);
  assert.deepEqual(plain(await second.save.restore()), { ok: true, status: 'ok', repaired: 0, applied: true });
});

// A world with a bog whose edge stands at a known cell.
class BogWorld extends FakeWorld {
  constructor(...args) {
    super(...args);
    this.provinces = { nearest: () => 26, edgePoint: () => ({ x: 40, y: 30 }) };
  }
}

test('?bog wins over a save put back by Continue', async () => {
  const storage = memory();
  const first = await start(storage);
  Object.assign(first.player, { x: 31.5, y: -12 });
  assert.deepEqual(plain(first.save.tick()), { ok: true, rev: 1 });
  const second = await start(storage, '&bog', { World: BogWorld });
  assert.deepEqual([second.player.x, second.player.y], [40.5, 30.5]);
  assert.equal(second.camera.x, 40.5);
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

test('save notices wait for the creator and the play card to go, so none runs out unseen', async () => {
  const damaged = () => {
    const storage = memory();
    storage.setItem(KEY, '{ not json');
    return storage;
  };
  const created = await open(damaged(), '&creator');
  assert.deepEqual(created.game.hud.toasts, []);
  created.game.creator.close();
  assert.deepEqual(created.game.hud.toasts, [NOTICES.corrupt]);
  const phone = await loadGame(undefined, { href: 'http://localhost/?debug&animals=0', phone: true, real: { localStorage: damaged() } });
  await settle();
  assert.deepEqual(phone.game.hud.toasts, []);
  phone.tapGate();
  assert.deepEqual(phone.game.hud.toasts, [NOTICES.corrupt]);
});

test('nothing moves or saves while the choice is open or a save is being put back', async () => {
  const storage = memory();
  (await start(storage)).save.tick();
  const before = storage.map.get(KEY);
  const locks = fakeLocks();
  locks.hold();
  const page = await open(storage, '', { navigator: { locks, vibrate() {} } });
  const { game } = page;
  game.inventoryScreen.isOpen = false;
  assert.equal(game.save.choice.mode, 'continue');
  assert.deepEqual(plain(game.save.choice.info), { who: 'Kael', day: 0, savedAt: JSON.parse(before).savedAt, hasBody: true,
    newerFeatures: false });
  assert.deepEqual([page.blocked(), game.player.takeDamage(10)], [true, 0], 'play is blocked and the player shielded');
  const tick = game.dayClock.tick;
  const frames = () => {
    page.hold('KeyD');
    page.frame(0.5);
    page.frame(0.5);
    assert.deepEqual([game.player.x, game.dayClock.tick], [0, tick]);
  };
  frames();
  assert.deepEqual(plain(game.save.tick()), { ok: false, reason: 'gated' }, 'and nothing is written');
  page.setHidden(true);
  page.setHidden(false);
  game.save.choice.choose('continue');
  assert.equal(page.audio.unlocks, 1, 'Continue is the tap to play');
  frames();
  assert.equal(storage.map.get(KEY), before);
  locks.go();
  await settle();
  assert.deepEqual([game.save.choice.isOpen, game.save.saveSession.holding, page.blocked()], [false, false, false]);
  page.frame(0.5);
  assert.notEqual(game.dayClock.tick, tick);
});

test('while the choice is open, Tab, I, Enter and Esc open no inventory and touch no bag', async (t) => {
  const storage = memory();
  (await start(storage)).save.tick();
  const { document } = installBrowser(t);
  const [bagRoot, choiceRoot] = ['inventory-root', 'creator-root'].map((id) => {
    const node = document.createElement('div');
    node.id = id;
    document.body.append(node);
    return node;
  });
  // The real inventory and choice, on the page's window, in the order main.js makes them.
  const onWindow = (window) => Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: window });
  const page = await open(storage, '', { InventoryScreen,
    CharacterPages: class { constructor() { [this.sheet, this.list] = [document.createElement('div'), document.createElement('div')]; } render() {} },
    StartChoice: class extends StartChoice { constructor(options) { super({ ...options, root: choiceRoot }); } } }, { onWindow });
  const { game } = page;
  const bag = JSON.stringify(game.inventory.slots);
  assert.equal(game.save.saveSession.choosing, true);
  const panel = choiceRoot.children[0];
  const press = (code, key) => page.window.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }),
    { code, key, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, repeat: false }));
  for (const [code, key] of [['Tab', 'Tab'], ['KeyI', 'i'], ['Enter', 'Enter'], ['Escape', 'Escape'], ['KeyI', 'i']]) {
    press(code, key);
  }
  assert.deepEqual([game.inventoryScreen.isOpen, choiceRoot.children[0], page.blocked()], [false, panel, true]);
  assert.equal(JSON.stringify(game.inventory.slots), bag);
  game.save.choice.pick('continue');
  await settle();
  press('KeyI', 'i');
  assert.deepEqual([game.save.choice.isOpen, game.inventoryScreen.isOpen, bagRoot.children.length > 0], [false, true, true],
    'once the choice is made, I opens the bag');
});

test('New game asks first, then writes a fresh save with ?instruments in the bag and clears the land', async () => {
  const storage = memory();
  const first = await start(storage);
  first.player.x = 20;
  first.inventory.add('oakLog', 3);
  first.save.tick();
  first.save.store.release();
  storage.setItem('ascii-realm-edits-1', JSON.stringify({ ...JSON.parse(storage.map.get(KEY)), kind: 'edits',
    chunks: { '0,0': [['fell', 'a']] } }));
  const { game } = await open(storage, '&instruments');
  assert.ok(game.inventory.slots.some((stack) => stack?.id === 'lute'), 'the bag the page starts with');
  await choose(game, 'new');
  assert.equal(game.save.choice.isOpen, false);
  const { bodies } = JSON.parse(storage.map.get(KEY));
  assert.deepEqual([bodies.outlaw.x, bodies.outlaw.bag.some((stack) => stack?.id === 'oakLog')], [0, false]);
  assert.ok(bodies.outlaw.bag.some((stack) => stack?.id === 'lute'));
  assert.deepEqual(JSON.parse(storage.map.get('ascii-realm-edits-1')).chunks, {});
  assert.equal(game.save.tick().ok, true);
});

test('a refused New game says why on the choice and leaves the save as it was', async () => {
  const storage = memory();
  (await start(storage)).save.tick();
  const before = storage.map.get(KEY);
  const { game } = await open(storage);
  const { setItem } = storage;
  storage.setItem = (key, value) => {
    if (key === KEY) throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
    setItem(key, value);
  };
  await choose(game, 'new');
  assert.deepEqual([game.save.choice.mode, game.save.choice.failed], ['continue', NOTICES.quota]);
  assert.equal(storage.map.get(KEY), before);
  assert.deepEqual(game.hud.toasts, []);
});

test('a save from a newer version offers Reload or playing without saving', async () => {
  const storage = memory();
  (await start(storage)).save.tick();
  storage.setItem(KEY, JSON.stringify({ ...JSON.parse(storage.map.get(KEY)), v: 99 }));
  const page = await open(storage);
  page.game.inventoryScreen.isOpen = false;
  assert.equal(page.game.save.choice.mode, 'newer');
  page.game.save.choice.choose('reload');
  assert.equal(page.navigatedTo(), 'reload');
  await choose(page.game, 'decline');
  assert.deepEqual([page.game.save.choice.isOpen, page.blocked()], [false, false]);
  assert.deepEqual(plain(page.game.save.now()), { ok: false, reason: 'declined' });
  assert.deepEqual(page.game.hud.toasts, [NOTICES.tool]);
  page.window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
  await settle();
  assert.equal(page.game.save.choice.isOpen, false, 'nothing is offered again');
});

test('land changes from a newer version turn Continue, or a quiet start, into the newer-save screen', async () => {
  const storage = memory();
  (await start(storage)).save.tick();
  const newerEdits = JSON.stringify({ ...JSON.parse(storage.map.get(KEY)), kind: 'edits', chunks: {}, v: 99 });
  storage.setItem('ascii-realm-edits-1', newerEdits);
  const before = storage.map.get(KEY);
  const page = await open(storage);
  page.game.inventoryScreen.isOpen = false;
  const { choice } = page.game.save;
  assert.equal(choice.mode, 'continue');
  await choose(page.game, 'continue');
  assert.deepEqual([choice.shown, choice.failed], [['continue', 'newer'], null]);
  choice.choose('reload');
  assert.equal(page.navigatedTo(), 'reload');
  await choose(page.game, 'decline');
  assert.deepEqual([choice.isOpen, page.blocked()], [false, false]);
  assert.deepEqual(plain(page.game.save.now()), { ok: false, reason: 'declined' });
  assert.deepEqual([storage.map.get(KEY), storage.map.get('ascii-realm-edits-1')], [before, newerEdits]);
  storage.map.delete(KEY);
  const quiet = (await open(storage)).game.save.choice;
  assert.deepEqual(quiet.shown, ['newer']);
});

test('a save open in another tab shows that screen; Try again checks, then offers the choice', async () => {
  const storage = memory();
  (await start(storage)).save.tick();
  const locks = fakeLocks();
  const other = new SaveStore({ storage, world: WORLD, locks });
  assert.equal(await other.ready, 'writer');
  const page = await open(storage, '', { navigator: { locks, vibrate() {} } });
  const { choice } = page.game.save;
  assert.deepEqual(choice.shown, ['continue', 'other-tab']);
  await choose(page.game, 'retry');
  assert.deepEqual(choice.shown.slice(2), ['other-tab']);
  other.release();
  await choose(page.game, 'retry');
  assert.equal(choice.mode, 'continue');
  assert.equal(page.game.save.store.ownRev.realm, null, 'Try again claims nothing');
  await choose(page.game, 'continue');
  assert.equal(page.game.save.tick().ok, true);
});

test('a first visit with a save shows the choice first, then the creator', async () => {
  const storage = memory();
  (await start(storage)).save.tick();
  const { game } = await open(storage, '&creator');
  assert.deepEqual([game.save.choice.mode, game.creator.isOpen], ['continue', false]);
  await choose(game, 'continue');
  assert.deepEqual([game.save.choice.isOpen, game.creator.isOpen], [false, true]);
});

test('on a phone the choice is the tap to play: no play card over it, and none when the page comes back', async () => {
  const storage = memory();
  (await start(storage)).save.tick();
  const page = await open(storage, '', {}, { phone: true });
  const { game } = page;
  assert.deepEqual([game.save.choice.mode, game.native.gate.waiting], ['continue', false]);
  page.setHidden(true);
  page.setHidden(false);
  page.window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: true }));
  assert.equal(game.native.gate.waiting, false);
  page.window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
  await settle();
  await choose(game, 'continue');
  assert.deepEqual([game.save.choice.isOpen, game.native.gate.waiting, page.audio.unlocks], [false, false, 1]);
});

test('a warning that waited behind the play card is dropped once the other tab has gone', async () => {
  const storage = memory();
  const locks = fakeLocks();
  const other = new SaveStore({ storage, world: WORLD, locks });
  await other.ready;
  const page = await open(storage, '', { navigator: { locks, vibrate() {} } }, { phone: true });
  const { game } = page;
  assert.equal(game.save.choice.isOpen, false, 'the other-tab screen waits for the card');
  page.window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: true }));
  other.release();
  page.window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
  await settle();
  page.tapGate();
  assert.deepEqual([game.save.choice.shown, game.hud.toasts], [[], []]);
  assert.equal(game.save.tick().ok, true);
});

test('another tab taking the world mid-play shows a screen; once it goes, play carries on saving', async () => {
  const storage = memory();
  const locks = fakeLocks();
  const page = await open(storage, '', { navigator: { locks, vibrate() {} } });
  const { game } = page;
  game.save.tick();
  page.window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: true }));
  const other = new SaveStore({ storage, world: WORLD, locks });
  await other.ready;
  page.window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
  await settle();
  assert.equal(game.save.choice.mode, 'other-tab');
  game.player.vitals.health = 1;
  assert.equal(game.player.takeDamage(10), 0);
  other.release();
  await choose(game, 'retry');
  assert.equal(game.save.choice.isOpen, false);
  assert.equal(page.audio.unlocks, 0, 'play was already started');
  assert.deepEqual(plain(game.save.tick()), { ok: true, rev: 3 });
  game.save.saveSession.choosing = true;
  game.save.store.writer = 'stale';
  await choose(game, 'decline');
  assert.equal(game.save.saveSession.choosing, false);
  assert.deepEqual(plain(game.save.tick()), { ok: false, reason: 'declined' });
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
  game.phoneMenu.setOpen(true);
  saveElements.get('phone-menu-save').dispatchEvent(new Event('click'));
  assert.equal(game.phoneMenu.open, false, 'the menu closes so the toast shows');
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
  assert.deepEqual(game.hud.toasts, [NOTICES.lobby]);
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
    assert.deepEqual(plain(game.save.tick()), { ok: false, reason }, query);
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
  assert.equal(game.save.choice.mode, 'other-tab');
  assert.deepEqual(game.hud.toasts, []);
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
  await choose(game, 'retry');
  assert.deepEqual([game.save.choice.mode, game.save.choice.info.hasBody], ['continue', false]);
  await choose(game, 'continue');
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
  assert.equal(page.game.save.choice.mode, 'stale');
  assert.deepEqual(page.game.hud.toasts, []);
  page.game.save.choice.choose('reload');
  assert.equal(page.navigatedTo(), 'reload');
});

test('a Continue the page hid during is offered again when it comes back from the back/forward cache', async () => {
  const storage = memory();
  const first = await start(storage);
  first.player.x = 31.5;
  first.save.tick();
  first.save.store.release();
  const locks = fakeLocks();
  locks.hold();
  const page = await open(storage, '', { navigator: { locks, vibrate() {} } });
  const { game } = page;
  game.save.choice.choose('continue');
  page.window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: true }));
  locks.go();
  await settle();
  assert.deepEqual(plain(game.save.tick()), { ok: false, reason: 'gated' }, 'the Continue was cut short');
  assert.equal(game.save.choice.failed, NOTICES.gated);
  assert.equal(game.player.x, 0);
  page.window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
  await settle();
  assert.deepEqual(game.save.choice.shown, ['continue', 'continue'], 'the choice is offered again');
  await choose(game, 'continue');
  assert.equal(game.player.x, 31.5, 'the save is put back');
  assert.deepEqual(plain(game.save.tick()), { ok: true, rev: 2 });
  assert.deepEqual(game.hud.toasts, []);
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
