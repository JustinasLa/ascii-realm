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
