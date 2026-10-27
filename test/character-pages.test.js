import assert from 'node:assert/strict';
import test from 'node:test';
import { DAY } from '../src/character/catalog.js';
import { Roster } from '../src/character/roster.js';
import { CharacterPages, LOBBY_NOTE } from '../src/ui/character-pages.js';
import { allElements, byClass, installDocument } from './helpers/dom.js';

const NOW = new Date(2026, 9, 26, 12).getTime();
const sheet = { name: 'Arwen Vale', gender: 'female', race: 'elf', birthday: '0345-10-02', class: 'archer',
  attributes: { strength: 0, dexterity: 3, constitution: 2, intelligence: 0, wisdom: 1, charisma: 1 },
  description: 'A tall archer with a grey cloak and a crooked smile.', clues: ['Smells of pine resin', 'Whistles when nervous'] };

function memory() {
  const map = new Map();
  return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)) };
}

function setup(t, { characters = 1, lobby = false, name = null, storage = memory() } = {}) {
  const document = installDocument(t);
  let time = NOW - 2 * DAY;
  const roster = new Roster({ storage, now: () => time });
  for (let i = 0; i < characters; i++) {
    const draft = roster.newDraft();
    draft.sheet = { ...draft.sheet, ...sheet };
    assert.equal(roster.create(draft).ok, true);
  }
  time = NOW;
  const state = { lobby, name };
  const pages = new CharacterPages({ doc: document, roster, now: () => time, inLobby: () => state.lobby,
    name: () => state.name ?? roster.active?.sheet.name ?? 'Kael', formatDate: (ms) => new Date(ms).toISOString().slice(0, 10) });
  return { document, roster, pages, state };
}

const tags = (root, tag) => allElements(root, (node) => node.tagName === tag.toUpperCase());

test('the Character page shows the active character\'s sheet, as text, with its locks', (t) => {
  const { pages } = setup(t);
  assert.equal(pages.sheet.getAttribute('aria-label'), 'Character');
  pages.render();
  const labels = tags(pages.sheet, 'dt').map((node) => node.textContent);
  assert.deepEqual(labels, ['Name', 'Gender', 'Age', 'Birthday', 'Race', 'Description', 'Class', 'Attributes', 'Clues']);
  const values = tags(pages.sheet, 'dd');
  assert.equal(values[0].textContent, 'Arwen Vale');
  assert.equal(values[0].getAttribute('dir'), 'auto');
  assert.equal(values[1].textContent, 'Female');
  assert.equal(values[4].textContent, `ElfLocked since ${new Date(NOW - DAY).toISOString().slice(0, 10)}`);
  assert.equal(values[4].style.color, '#5682f2');
  assert.deepEqual(byClass(pages.sheet, 'character-lock').map((node) => node.textContent),
    ['Locks in 3d', `Locked since ${new Date(NOW - DAY).toISOString().slice(0, 10)}`, 'Locks in 3d', 'Locks in 3d']);
  assert.deepEqual(tags(values[7], 'li').map((node) => node.textContent).slice(0, 2), ['Strength 3', 'Dexterity 6']);
  const [clues] = tags(values[8], 'ol');
  assert.deepEqual(clues.children.map((node) => node.textContent), sheet.clues);
  assert.equal(byClass(pages.sheet, 'character-note').length, 0, 'no lobby, no save error');
});

test('a fresh profile has no character yet', (t) => {
  const { pages } = setup(t, { characters: 0 });
  pages.render();
  assert.equal(pages.sheet.textContent, 'You have no character yet.');
});

test('in a lobby, after a change and with ?name= the page says so', (t) => {
  const { pages, roster, state } = setup(t, { name: 'Ash' });
  state.lobby = true;
  pages.render();
  assert.equal(tags(pages.sheet, 'dd')[0].textContent, 'Arwen Vale (shown as Ash this visit)');
  assert.deepEqual(byClass(pages.sheet, 'character-note').map((node) => node.textContent), [LOBBY_NOTE]);
  assert.equal(roster.update(roster.active.id, { name: 'Arwen Brook' }).ok, true);
  state.name = null;
  state.lobby = false;
  pages.render();
  assert.equal(tags(pages.sheet, 'dd')[0].textContent, 'Arwen Brook');
  assert.equal(byClass(pages.sheet, 'character-note').length, 0);
});

test('a roster that cannot save says why', (t) => {
  const failing = { getItem: () => null, setItem: () => { throw new Error('full'); } };
  const { pages, roster } = setup(t, { storage: failing });
  pages.render();
  assert.ok(roster.saveError);
  assert.deepEqual(byClass(pages.sheet, 'character-note').map((node) => node.textContent), [roster.saveError]);
});

test('the pages work with only a roster given', (t) => {
  installDocument(t);
  const pages = new CharacterPages({ roster: { active: null, saveError: null } });
  pages.render();
  assert.equal(pages.sheet.textContent, 'You have no character yet.');
});
