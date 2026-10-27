import assert from 'node:assert/strict';
import test from 'node:test';
import { Roster, ROSTER_KEY } from '../src/character/roster.js';
import { cleanSkin } from '../src/character/skin.js';
import { loadGame } from './helpers/main-game.js';

// A localStorage stand-in that records every write.
function memory(entries = {}) {
  const map = new Map(Object.entries(entries));
  const writes = [];
  return { map, writes, getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { writes.push(key); map.set(key, String(value)); } };
}

const zoe = { id: 'c0001', createdAt: 1, switchedAt: null, sheet: { name: 'Zoë' }, skin: { tone: 'sage' } };
const saved = (character = zoe) => JSON.stringify({ v: 1, rev: 1, active: character.id, characters: [character] });
const sheet = { race: 'human', birthday: '0349-01-01', class: 'bard', description: 'A quiet wanderer with a lute on his back.',
  attributes: { strength: 1, dexterity: 1, constitution: 1, intelligence: 1, wisdom: 3, charisma: 1 },
  clues: ['Hums under his breath', 'Smells of wood smoke'] };

// The page with the lobby controls' options and renders recorded.
async function load(href, storage, options = {}) {
  const lobby = { renders: 0 };
  const harness = await loadGame(undefined, { href, ...options, real: { localStorage: storage,
    dressFigure: () => [{ y0: -20 }], ModelFigure: { load: () => new Promise(() => {}), library: () => new Promise(() => {}) },
    bindMultiplayerControls: (client, controls) => { lobby.options = controls; return () => { lobby.renders++; }; } } });
  return { ...harness, lobby };
}

const ownPlate = (harness) => { harness.frame(); return harness.game.nameplates.updates.at(-1).plates[0].name; };

test('the active character is played: HUD, inventory, nameplate, skin and lobby name', async () => {
  const storage = memory({ [ROSTER_KEY]: saved() });
  const harness = await load('http://localhost/?debug', storage);
  const { game, lobby } = harness;
  assert.equal(game.hud.name, 'Zoë');
  assert.equal(game.inventoryScreen.name, 'Zoë');
  assert.equal(ownPlate(harness), 'Zoë');
  assert.deepEqual(game.player.skin, cleanSkin({ tone: 'sage' }));
  assert.equal(lobby.options.name(), 'Zoë', 'a join sends the character\'s name');
  assert.equal(game.tint.getName(), 'Zoë');
  assert.deepEqual(storage.writes, [], 'nothing is written, ascii-realm-name least of all');
});

test('the inventory gets the Character page, which reads the roster and the lobby', async () => {
  const harness = await load('http://localhost/?debug', memory({ [ROSTER_KEY]: saved() }));
  const { game } = harness;
  const [page] = game.inventoryScreen.pages;
  assert.equal(page.id, 'character');
  assert.equal(page.label, 'Character');
  assert.equal(page.node, game.characterPages.sheet);
  const renders = game.characterPages.renders;
  page.onShow();
  assert.equal(game.characterPages.renders, renders + 1);
  assert.equal(game.characterPages.roster, game.characters);
  assert.equal(game.characterPages.name(), 'Zoë');
  assert.equal(game.characterPages.inLobby(), false);
  game.multiplayer.room = { code: 'AB7K2D' };
  assert.equal(game.characterPages.inLobby(), true);
});

test('?name= shows a valid name for this visit only; an invalid one is ignored', async () => {
  const storage = memory({ [ROSTER_KEY]: saved() });
  const ash = await load('http://localhost/?debug&name=%20Ash%20', storage);
  assert.equal(ash.game.hud.name, 'Ash');
  assert.equal(ash.game.inventoryScreen.name, 'Ash');
  assert.equal(ownPlate(ash), 'Ash');
  assert.equal(ash.lobby.options.name(), 'Ash');
  assert.equal(ash.game.characters.active.sheet.name, 'Zoë', 'the roster keeps its name');
  assert.deepEqual(storage.writes, []);
  const digits = await load('http://localhost/?debug&name=Ash2', storage);
  assert.equal(digits.game.hud.name, 'Zoë');
  const none = await load('http://localhost/?debug&nocreator&name=Al', memory());
  assert.equal(none.game.hud.name, 'Kael', 'no character: Kael, as before');
  assert.equal(ownPlate(none), 'Kael');
});

test('another tab\'s change renames and re-skins at once, but leaves an open creator\'s preview', async () => {
  const storage = memory({ [ROSTER_KEY]: saved() });
  const harness = await load('http://localhost/?debug', storage);
  const { game, window, lobby } = harness;
  const other = new Roster({ storage });
  other.update('c0001', { name: 'Zoë Vale' });
  other.setSkin('c0001', { tone: 'ember' });
  const renders = [game.characterPages.renders, lobby.renders];
  window.dispatchEvent(Object.assign(new Event('storage'), { key: ROSTER_KEY }));
  assert.equal(game.hud.name, 'Zoë Vale');
  assert.equal(game.inventoryScreen.name, 'Zoë Vale');
  assert.equal(ownPlate(harness), 'Zoë Vale');
  assert.equal(lobby.options.name(), 'Zoë Vale');
  assert.deepEqual(game.player.skin, cleanSkin({ tone: 'ember' }));
  assert.deepEqual([game.characterPages.renders, lobby.renders], [renders[0] + 1, renders[1] + 1]);
  // With the creator open, its preview stays on the outlaw.
  const open = await load('http://localhost/?debug&creator', storage, { creator: true });
  const preview = cleanSkin({ tone: 'olive' });
  open.game.creator.onPreview(preview);
  other.update('c0001', { name: 'Zoë Brook' });
  open.window.dispatchEvent(Object.assign(new Event('storage'), { key: ROSTER_KEY }));
  assert.equal(open.game.hud.name, 'Zoë Brook');
  assert.equal(open.game.player.skin, preview);
});

test('after the first character is created the HUD shows its name', async () => {
  const storage = memory();
  const harness = await load('http://localhost/?debug', storage, { creator: true });
  const { game } = harness;
  assert.equal(game.hud.name, 'Kael');
  const draft = game.characters.newDraft();
  draft.sheet = { ...draft.sheet, ...sheet, name: 'Анна' };
  const made = game.characters.create(draft);
  game.creator.close(made.character);
  assert.equal(game.hud.name, 'Анна');
  assert.equal(game.inventoryScreen.name, 'Анна');
  assert.equal(ownPlate(harness), 'Анна');
  assert.equal(storage.writes.includes('ascii-realm-name'), false);
});

// Two characters, Zoë playing since the second was made five days ago.
const now = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const pair = (switchedAt = now - 5 * DAY) => JSON.stringify({ v: 1, rev: 1, active: 'c0001', characters: [
  { ...zoe, createdAt: now - 10 * DAY, switchedAt, sheet: { ...sheet, name: 'Zoë' } },
  { id: 'c0002', createdAt: now - 6 * DAY, switchedAt: now - 6 * DAY, sheet: { ...sheet, name: 'Анна' }, skin: { tone: 'ember' } }] });

async function menu(href = 'http://localhost/?debug', storage = memory({ [ROSTER_KEY]: pair() })) {
  const harness = await load(href, storage, { creator: true });
  const notes = [];
  harness.game.hud.notify = (message) => notes.push(message);
  return { ...harness, notes, pages: harness.game.characterPages, storage };
}

test('the inventory gets the Characters page too', async () => {
  const { game, pages } = await menu();
  const [, list] = game.inventoryScreen.pages;
  assert.deepEqual([list.id, list.label, list.node], ['characters', 'Characters', pages.list]);
  const renders = pages.renders;
  list.onShow();
  assert.equal(pages.renders, renders + 1);
  assert.equal(pages.equipment(), game.inventory.equipment);
});

test('Edit opens the creator on the active character and blocks play; Save and Cancel go back to the page', async () => {
  const harness = await menu();
  const { game, pages, notes } = harness;
  game.inventoryScreen.setOpen(true, 'character');
  assert.deepEqual({ ...pages.onEdit() }, { ok: true });
  assert.deepEqual(game.inventoryScreen.opened.at(-1), [false, undefined]);
  const options = game.creator.opened.at(-1);
  assert.deepEqual([options.start, options.edit.id, options.roster], ['summary', 'c0001', game.characters]);
  assert.equal(harness.blocked(), true, 'play stays blocked while the creator is open');
  // Cancel: the saved skin is back, and the Character page with Edit focused.
  game.creator.onPreview(cleanSkin({ tone: 'olive' }));
  game.creator.close(null);
  assert.deepEqual(game.player.skin, cleanSkin({ tone: 'sage' }));
  assert.deepEqual(game.inventoryScreen.opened.at(-1), [true, 'character']);
  assert.deepEqual(pages.focused, ['edit']);
  assert.deepEqual(notes, []);
  // Save: the new name everywhere, and a note.
  pages.onEdit();
  game.characters.update('c0001', { name: 'Zoë Vale' });
  game.creator.close(game.characters.active);
  assert.equal(game.hud.name, 'Zoë Vale');
  assert.equal(game.inventoryScreen.name, 'Zoë Vale');
  assert.deepEqual(notes, ['Changes saved.']);
  game.multiplayer.room = { code: 'AB7K2D' };
  pages.onEdit();
  game.creator.close(game.characters.active);
  assert.equal(notes.at(-1), 'Changes saved. Others see the new name when you next join.');
});

test('every creator session blocks play, and each close unblocks it', async () => {
  const harness = await menu();
  const { game, pages } = harness;
  for (const open of [pages.onEdit, pages.onCreate, pages.onEdit]) {
    game.inventoryScreen.setOpen(true, 'character');
    open();
    assert.equal(harness.blocked(), true);
    game.creator.close(null);
    game.inventoryScreen.setOpen(false);
    assert.equal(harness.blocked(), false);
  }
});

test('Create opens a new character; cancelled goes back to Characters, made starts play', async () => {
  const harness = await menu();
  const { game, pages, notes } = harness;
  assert.deepEqual({ ...pages.onCreate() }, { ok: true });
  const options = game.creator.opened.at(-1);
  assert.deepEqual([options.start, options.mode], ['creation', 'new']);
  game.creator.close(null);
  assert.deepEqual(game.inventoryScreen.opened.at(-1), [true, 'characters']);
  assert.deepEqual(pages.focused, ['create']);
  pages.onCreate();
  const draft = game.characters.newDraft();
  draft.sheet = { ...draft.sheet, ...sheet, name: 'Ash' };
  game.characters.bypassCooldown = true;
  const made = game.characters.create(draft);
  game.creator.close(made.character);
  assert.equal(game.hud.name, 'Ash');
  assert.deepEqual(notes, ['Now playing as Ash.']);
});

test('Play as switches name and skin at once, without a reload; the cooldown refuses without ?debug', async () => {
  const harness = await menu();
  const { game, pages, notes } = harness;
  assert.equal(game.characters.bypassCooldown, true, '?debug skips the cooldown');
  game.characters.bypassCooldown = false;
  const plate = () => { harness.frame(); return harness.game.nameplates.updates.at(-1).plates[0].name; };
  assert.equal(plate(), 'Zoë');
  assert.deepEqual({ ...pages.onPlay('c0002') }, { ok: true });
  assert.equal(game.hud.name, 'Анна');
  assert.equal(game.inventoryScreen.name, 'Анна');
  assert.deepEqual(game.player.skin, cleanSkin({ tone: 'ember' }));
  assert.equal(plate(), 'Анна');
  assert.equal(harness.navigatedTo(), undefined, 'no reload');
  assert.deepEqual(notes, ['Now playing as Анна.']);
  const refused = pages.onPlay('c0001');
  assert.equal(refused.reason, 'You are on cooldown from switching characters.');
  assert.equal(game.characters.active.id, 'c0002');
  const debug = await menu('http://localhost/?debug', memory({ [ROSTER_KEY]: pair(now - DAY) }));
  debug.game.multiplayer.room = { code: 'AB7K2D' };
  assert.equal(debug.pages.onPlay('c0002').ok, true, '?debug skips the cooldown');
  assert.deepEqual(debug.notes, ['Now playing as Анна. Others see the new name when you next join.']);
});

test('recently hurt: Edit, Create and Play as are refused until 10 s of play pass', async () => {
  const harness = await menu();
  const { game, pages } = harness;
  game.inventoryScreen.setOpen(true, 'characters');
  harness.frame();
  game.player.takeDamage(5);
  harness.frame();
  const opened = [game.inventoryScreen.opened.length, game.creator.opened.length];
  for (const act of [() => pages.onEdit(), () => pages.onCreate(), () => pages.onPlay('c0002')]) {
    assert.deepEqual({ ...act() }, { ok: false, reason: 'You were hurt recently. Try again in 10 s.' });
  }
  assert.deepEqual([game.inventoryScreen.opened.length, game.creator.opened.length], opened, 'nothing closes or opens');
  assert.equal(game.characters.active.id, 'c0001');
  let frames = 0;
  while (!pages.onPlay('c0002').ok && frames < 2000) { harness.frame(0.05); frames++; }
  assert.ok(frames > 150 && frames < 2000, `allowed after about 10 s (${frames} frames)`);
  assert.equal(game.characters.active.id, 'c0002');
});
