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

const NAMES = ['Arwen Vale', 'Žydrūnas', '李小龍'];
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

// Portraits that record what they draw.
function portraits() {
  const made = [];
  return { made, portrait: (canvas) => {
    const portrait = { canvas, drawn: [], update(player) { this.drawn.push(player); } };
    made.push(portrait);
    return portrait;
  } };
}

// Characters made five days apart, each the active one when made.
function setup(t, { characters = 1, lobby = false, name = null, storage = memory(), ...options } = {}) {
  const document = installDocument(t);
  let time = NOW - 2 * DAY - 5 * DAY * (characters - 1);
  const roster = new Roster({ storage, now: () => time });
  for (let i = 0; i < characters; i++) {
    const draft = roster.newDraft();
    draft.sheet = { ...draft.sheet, ...sheet, name: NAMES[i] };
    assert.equal(roster.create(draft).ok, true);
    if (i < characters - 1) time += 5 * DAY;
  }
  time = NOW;
  const state = { lobby, name };
  const drawn = portraits();
  const pages = new CharacterPages({ doc: document, roster, now: () => time, inLobby: () => state.lobby,
    name: () => state.name ?? roster.active?.sheet.name ?? 'Kael', formatDate: iso, formatTime: iso,
    portrait: drawn.portrait, ...options });
  return { document, roster, pages, state, drawn, clock: { set: (at) => { time = at; } } };
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
  assert.equal(pages.sheet.textContent, 'You have no character yet. Make one on the Characters page.');
  assert.deepEqual(byClass(pages.list, 'character-roster')[0].children, []);
  assert.equal(byClass(pages.list, 'character-create')[0].textContent, 'Create character0 of 3 character slots used');
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
  const roster = new Roster({ storage: memory() });
  const pages = new CharacterPages({ roster });
  pages.render();
  assert.match(pages.sheet.textContent, /^You have no character yet\./);
  for (const action of ['onEdit', 'onCreate', 'onPlay']) assert.deepEqual(pages[action](), { ok: true });
  assert.equal(pages.equipment(), undefined);
  assert.throws(() => pages.portrait({ getContext: () => null }), /2D canvas/, 'the real portrait by default');
});

const buttons = (root, text) => allElements(root, (node) => node.tagName === 'BUTTON' && node.textContent === text);

test('Edit on the Character page asks the game; a refusal stays on the page', (t) => {
  const results = [{ ok: false, reason: 'You were hurt recently. Try again in 4 s.' }, { ok: true }];
  let asked = 0;
  const { pages } = setup(t, { onEdit: () => { asked++; return results.shift(); } });
  pages.render();
  assert.equal(pages.edit.textContent, 'Edit');
  pages.edit.click();
  assert.equal(pages.sheet.status.textContent, 'You were hurt recently. Try again in 4 s.');
  assert.equal(pages.sheet.status.getAttribute('role'), 'status');
  pages.edit.click();
  assert.equal(asked, 2);
  pages.render();
  assert.equal(pages.sheet.status.textContent, '', 'a new render clears the message');
});

test('Characters lists the roster most recently played first, with portraits', (t) => {
  const { pages, roster, drawn } = setup(t, { characters: 3, equipment: () => ({ weapon: null }) });
  // The first one played again, a day ago: it is first, and the cooldown runs.
  const [first] = roster.characters;
  roster.state.characters[0].switchedAt = NOW - DAY;
  roster.state.active = first.id;
  pages.render();
  assert.equal(pages.list.getAttribute('aria-label'), 'Characters');
  const [list] = byClass(pages.list, 'character-roster');
  assert.equal(list.getAttribute('aria-label'), 'Your characters');
  const names = tags(list, 'h4');
  assert.deepEqual(names.map((node) => node.textContent), ['Arwen Vale', '李小龍', 'Žydrūnas']);
  assert.ok(names.every((node) => node.getAttribute('dir') === 'auto' && node.tabIndex === -1));
  assert.deepEqual(list.children.map((item) => item.className), ['active', '', '']);
  assert.equal(byClass(list.children[0], 'character-playing')[0].textContent, 'Playing now');
  assert.equal(tags(list.children[0], 'p')[0].textContent, 'Elf · Archer · 34');
  const plays = buttons(list, 'Play as');
  assert.deepEqual(plays.map((node) => node.getAttribute('aria-label')), ['Play as 李小龍', 'Play as Žydrūnas']);
  const opens = iso(NOW + 3 * DAY);
  for (const play of plays) {
    assert.equal(play.getAttribute('aria-disabled'), 'true');
    const why = byClass(play.parentNode, 'character-lock')[0];
    assert.equal(play.getAttribute('aria-describedby'), why.id);
    assert.equal(why.textContent, `You are on cooldown from switching characters. Opens in 3d, on ${opens}.`);
  }
  // A portrait per character, each in its own skin, over the gear given.
  assert.equal(drawn.made.length, 3);
  assert.ok(list.children.every((item) => item.children[0].tagName === 'CANVAS'
    && item.children[0].getAttribute('aria-hidden') === 'true'));
  assert.deepEqual(drawn.made[0].drawn[0].equipment, { weapon: null });
  assert.deepEqual(byClass(pages.list, 'character-create')[0].children.map((node) => node.textContent),
    ['Create character', '3 of 3 character slots used', 'All 3 character slots are taken.']);
});

test('portraits are kept per character and given a new skin only when it changes', (t) => {
  const { pages, roster, drawn } = setup(t, { characters: 2 });
  pages.render();
  pages.render();
  assert.equal(drawn.made.length, 2);
  const [a] = drawn.made;
  assert.equal(a.drawn[0].skin, a.drawn[1].skin, 'the same skin object, so it is not redrawn');
  roster.setSkin(roster.characters[0].id, { tone: 'ember' });
  pages.render();
  const changed = drawn.made.find((made) => made.drawn[2].skin !== made.drawn[1].skin);
  assert.equal(changed.drawn[2].skin.tone, 'ember');
  assert.equal(drawn.made.length, 2);
});

test('Play as switches, says so and moves focus; refusals stay on the page', (t) => {
  const plays = [];
  const results = [];
  const { pages, roster, document } = setup(t, { characters: 2, onPlay: (id) => { plays.push(id); return results.shift() ?? roster.switchTo(id); } });
  roster.bypassCooldown = true;
  pages.render();
  const [other] = buttons(pages.list, 'Play as');
  // The game may still refuse: recently hurt.
  results.push({ ok: false, reason: 'You were hurt recently. Try again in 2 s.' });
  other.click();
  assert.equal(pages.list.status.textContent, 'You were hurt recently. Try again in 2 s.');
  assert.equal(roster.active.sheet.name, 'Žydrūnas');
  other.click();
  assert.equal(roster.active.sheet.name, 'Arwen Vale');
  assert.equal(pages.list.status.textContent, 'Now playing as Arwen Vale.');
  const [heading] = tags(pages.list, 'h4');
  assert.equal(heading.textContent, 'Arwen Vale');
  assert.equal(document.activeElement, heading, 'focus on the new active row\'s name');
  // Without the bypass the cooldown refuses, without asking the game.
  roster.bypassCooldown = false;
  pages.render();
  const [back] = buttons(pages.list, 'Play as');
  back.click();
  assert.match(pages.list.status.textContent, /^You are on cooldown from switching characters\. Opens in 4d, on /);
  assert.deepEqual(plays, [roster.characters[0].id, roster.characters[0].id]);
});

test('Create character asks the game while a slot is free, else says why', (t) => {
  let created = 0;
  const { pages, roster, clock } = setup(t, { characters: 2, onCreate: () => { created++; return { ok: true }; } });
  // The second character's switch cooldown has ended.
  clock.set(NOW + 3 * DAY);
  pages.render();
  const block = () => byClass(pages.list, 'character-create')[0];
  assert.equal(block().children[1].textContent, '2 of 3 character slots used');
  assert.equal(pages.create.getAttribute('aria-disabled'), null);
  assert.equal(block().children.length, 2);
  pages.create.click();
  assert.equal(created, 1);
  // A switch starts the cooldown, which also holds back a new character.
  roster.bypassCooldown = true;
  roster.switchTo(roster.characters[0].id);
  roster.bypassCooldown = false;
  clock.set(NOW + 4 * DAY);
  pages.render();
  assert.equal(pages.create.getAttribute('aria-disabled'), 'true');
  assert.equal(block().children[2].textContent,
    `You are on cooldown from switching characters. Opens in 3d, on ${iso(NOW + 7 * DAY)}.`);
  pages.create.click();
  assert.equal(created, 1);
  assert.equal(pages.list.status.textContent, block().children[2].textContent);
});

test('a cooldown that ends with the page open no longer holds back Create character or Play as', (t) => {
  for (const press of ['Create character', 'Play as']) {
    let created = 0;
    const { pages, roster, clock } = setup(t, { characters: 2, onCreate: () => { created++; return { ok: true }; },
      onPlay: (id) => roster.switchTo(id) });
    // Opened a day before the cooldown ends: both are shown refused.
    clock.set(NOW + DAY);
    pages.render();
    const [play] = buttons(pages.list, 'Play as');
    assert.equal(pages.create.getAttribute('aria-disabled'), 'true');
    assert.equal(play.getAttribute('aria-disabled'), 'true');
    // The page stays open past the opening time.
    clock.set(NOW + 2 * DAY + 1);
    (press === 'Play as' ? play : pages.create).click();
    if (press === 'Play as') {
      assert.equal(roster.active.sheet.name, 'Arwen Vale', 'switches without reopening the page');
      assert.equal(pages.list.status.textContent, 'Now playing as Arwen Vale.');
    } else {
      assert.equal(created, 1, 'asks the game without reopening the page');
      assert.equal(pages.create.getAttribute('aria-disabled'), null, 'and the list is shown as it is now');
      assert.equal(buttons(pages.list, 'Play as')[0].getAttribute('aria-disabled'), null);
    }
  }
});

test('a cooldown that began with the page open refuses Create character and redraws the list', (t) => {
  let created = 0;
  const { pages, roster, clock } = setup(t, { characters: 2, onCreate: () => { created++; return { ok: true }; } });
  clock.set(NOW + 3 * DAY);
  pages.render();
  const [play] = buttons(pages.list, 'Play as');
  assert.equal(play.getAttribute('aria-disabled'), null);
  // Switched elsewhere while the page was open.
  roster.switchTo(roster.characters[0].id);
  pages.create.click();
  assert.equal(created, 0);
  assert.equal(pages.create.getAttribute('aria-disabled'), 'true');
  assert.match(pages.list.status.textContent, /^You are on cooldown from switching characters\. Opens in 4d, on /);
});
