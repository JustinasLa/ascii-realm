import assert from 'node:assert/strict';
import test from 'node:test';
import { DAY } from '../src/character/catalog.js';
import { formatBirthday } from '../src/character/calendar.js';
import { Creation, LOCKED, PAGES, sampleDraft, wantsCreator } from '../src/character/creation.js';
import { Roster } from '../src/character/roster.js';
import { sheetErrors } from '../src/character/rules.js';
import { cleanSkin, DEFAULT_SKIN } from '../src/character/skin.js';

const START = new Date(2026, 9, 26, 12).getTime();

// A roster in memory on a settable clock with predictable ids.
function roster(entries = {}) {
  const map = new Map(Object.entries(entries));
  const storage = { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)) };
  const clock = { now: START };
  let n = 0;
  const made = new Roster({ storage, now: () => clock.now, randomId: () => `c${String(++n).padStart(4, '0')}` });
  return Object.assign(made, { clock });
}

const flow = (options = {}) => {
  const r = options.roster ?? roster();
  return new Creation({ roster: r, now: () => r.clock.now, ...options });
};
// A flow on a page with a finished sample draft.
const sample = (start, r = roster()) => flow({ roster: r, start, draft: sampleDraft(r, START) });

test('pages run in order, and only steps are counted', () => {
  assert.deepEqual(PAGES.map((page) => page.id), ['welcome', 'creation', 'name-info', 'name', 'class-info', 'class', 'race',
    'age', 'attributes', 'description-info', 'description', 'clues-info', 'clues', 'skin', 'summary']);
  const f = sample('welcome');
  const seen = [];
  do seen.push([f.page.id, f.counter && `${f.counter.n}/${f.counter.total}`]); while (f.next() && f.page.id !== 'summary');
  assert.deepEqual(seen.filter(([, counter]) => counter).map(([id, counter]) => `${id} ${counter}`),
    ['name 1/8', 'class 2/8', 'race 3/8', 'age 4/8', 'attributes 5/8', 'description 6/8', 'clues 7/8', 'skin 8/8']);
  assert.equal(f.page.id, 'summary');
  assert.equal(f.counter, null);
  assert.equal(f.error, null);
  assert.ok(f.next(), 'Next on the Summary stays there');
  assert.equal(f.page.id, 'summary');
  assert.ok(PAGES.filter((page) => page.kind === 'info').every((page) => page.lines.length >= 2));
});

test('Back goes back through info pages, and Welcome has none', () => {
  const f = sample('class');
  assert.ok(f.back());
  assert.equal(f.page.id, 'class-info');
  const first = flow();
  assert.equal(first.page.id, 'welcome');
  assert.equal(first.back(), false);
  assert.equal(flow({ start: 'nowhere' }).page.id, 'welcome');
});

test('a new draft starts blank with the suggested name and the default skin', () => {
  const r = roster({ 'ascii-realm-name': 'Kael' });
  const f = flow({ roster: r, start: 'name' });
  assert.equal(f.sheet.name, 'Kael');
  assert.equal(f.draft.id, 'c0001');
  assert.equal(f.draft.skin, DEFAULT_SKIN);
  assert.equal(f.age, null);
});

test('Next waits for the name rule', () => {
  const f = flow({ start: 'name' });
  assert.equal(f.error, 'Name cannot be empty.');
  assert.equal(f.next(), false);
  for (const [name, message] of [['Al', 'Name must be at least 3 characters.'], ['A'.repeat(24), null],
    ['A'.repeat(25), 'Name cannot exceed 24 characters.'], ['Zoë', null], ['O’Neil', null],
    ['R2D2', 'Name may only use letters, spaces, apostrophes, hyphens and full stops.']]) {
    f.set('name', name);
    assert.equal(f.error, message, name);
  }
  f.set('name', 'Zoë');
  assert.ok(f.next());
  assert.equal(f.page.id, 'class-info');
});

test('a name another character holds is refused', () => {
  const r = roster();
  assert.ok(r.create(sampleDraft(r, START)).ok);
  const f = flow({ roster: r, start: 'name' });
  f.set('name', 'arwen vale');
  assert.equal(f.error, 'Name already in use.');
});

test('class and race wait for a choice', () => {
  const f = flow({ start: 'class' });
  assert.equal(f.error, 'Pick a class.');
  f.set('class', 'bard');
  assert.equal(f.error, null);
  assert.ok(f.next());
  assert.equal(f.error, 'Pick a race.');
  f.set('race', 'dwarf');
  assert.equal(f.error, null);
});

test('a race brings its skin tone until one is chosen', () => {
  const f = flow({ start: 'race' });
  f.set('race', 'orc');
  assert.equal(f.draft.skin.tone, 'olive');
  f.set('race', 'oseni');
  assert.equal(f.draft.skin.tone, 'ember');
  f.set('race', 'human');
  assert.equal(f.draft.skin.tone, DEFAULT_SKIN.tone);
  f.draft.toneChosen = true;
  f.set('race', 'goblin');
  assert.equal(f.draft.skin.tone, DEFAULT_SKIN.tone);
});

test('the age starts at 18 and follows the race maximum', () => {
  const f = flow({ start: 'race' });
  f.set('race', 'elf');
  assert.ok(f.next());
  assert.equal(f.page.id, 'age');
  assert.equal(f.age, 18);
  assert.equal(f.error, null);
  assert.deepEqual(f.setAge(17), { ok: false, message: 'Age must be between 18 and 210 for your race.' });
  assert.equal(f.age, 18);
  assert.deepEqual(f.setAge(210), { ok: true, message: null });
  assert.deepEqual(f.setAge(211), { ok: false, message: 'Age must be between 18 and 210 for your race.' });
  const born = f.sheet.birthday;
  assert.ok(f.setAge(180).ok);
  assert.ok(f.setAge(210).ok);
  assert.equal(f.sheet.birthday, born, 'the same age gives the same birthday');
  assert.ok(f.back());
  f.set('race', 'orc');
  assert.ok(f.next());
  assert.equal(f.age, 210, 'a new race keeps the age');
  assert.equal(f.error, 'Age must be between 18 and 90 for your race.');
  assert.equal(f.next(), false);
  assert.ok(f.setAge(90).ok);
  assert.ok(f.next());
});

test('typed age and birthday stay pending until valid', () => {
  const f = sample('age');
  const born = f.sheet.birthday;
  f.typeAge('3');
  assert.deepEqual(f.pending, { age: { text: '3', message: 'Age must be between 18 and 210 for your race.' } });
  assert.equal(f.error, 'Age must be between 18 and 210 for your race.');
  assert.equal(f.sheet.birthday, born, 'the sheet keeps the last good birthday');
  assert.equal(f.next(), false);
  f.typeAge('x');
  assert.equal(f.pending.age.text, 'x');
  f.typeAge(' 40 ');
  assert.deepEqual(f.pending, {});
  assert.equal(f.age, 40);
  f.typeBirthday('31.02.300');
  assert.equal(f.error, 'Invalid birthday.');
  f.typeAge('41');
  assert.deepEqual(f.pending, {}, 'a good age clears a bad birthday');
  f.typeBirthday('01.01.379');
  assert.equal(f.error, 'Age must be between 18 and 210 for your race.');
  f.typeBirthday('02/10/345');
  assert.equal(f.error, null);
  assert.equal(formatBirthday(f.sheet.birthday), '02.10.345 AE');
  assert.equal(f.age, 34);
  f.typeAge('');
  assert.ok(f.error);
  assert.ok(f.back(), 'Back drops pending input');
  assert.deepEqual(f.pending, {});
  assert.deepEqual(f.setBirthday('nonsense'), { ok: false, message: 'Invalid birthday.' });
});

test('attribute ranks keep to the pool and the maximum rank', () => {
  const f = flow({ start: 'attributes' });
  assert.equal(f.left, 12);
  assert.equal(f.error, 'Spend exactly 12 attribute points (spent 0).');
  assert.equal(f.rankBlock('strength', -1), 'Already at rank 0.');
  assert.equal(f.rank('strength', -1), false);
  for (let i = 0; i < 3; i++) assert.ok(f.rank('strength', 1));
  assert.equal(f.left, 5);
  assert.equal(f.rankBlock('strength', 1), 'Costs 8 points; 5 points available.');
  assert.equal(f.rank('strength', 1), false);
  assert.ok(f.rank('dexterity', 1) && f.rank('dexterity', 1));
  assert.equal(f.error, 'Spend exactly 12 attribute points (spent 10).');
  assert.ok(f.rank('wisdom', 1) && f.rank('charisma', 1));
  assert.equal(f.left, 0);
  assert.equal(f.error, null);
  assert.ok(f.rank('charisma', -1));
  assert.equal(f.error, 'Spend exactly 12 attribute points (spent 11).');
  f.sheet.attributes = { ...f.sheet.attributes, intelligence: 4 };
  assert.equal(f.rankBlock('intelligence', 1), 'Maximum rank reached.');
  assert.equal(f.left, -14);
  assert.equal(f.error, 'Spend exactly 12 attribute points (spent 26).');
});

test('description and gender gate their step', () => {
  const f = sample('description');
  for (const [text, message] of [['a'.repeat(31), 'Description must be at least 32 characters.'], [` ${'a'.repeat(32)} `, null],
    ['a'.repeat(256), null], ['a'.repeat(257), 'Description cannot exceed 256 characters.'], ['  ', 'Description cannot be empty.']]) {
    f.set('description', text);
    assert.equal(f.error, message, text.length);
  }
  f.set('description', 'a'.repeat(40));
  f.set('gender', 'robot');
  assert.equal(f.error, 'Pick a gender or leave it unset.');
  f.set('gender', null);
  assert.equal(f.error, null);
});

test('clues are added one at a time up to ten', () => {
  const f = flow({ start: 'clues' });
  assert.equal(f.error, 'Needs at least 2 clues.');
  assert.deepEqual(f.addClue('  Short one '), { ok: false, message: 'Each clue must be 12 to 48 characters.' });
  assert.deepEqual(f.addClue('x'.repeat(49)), { ok: false, message: 'Each clue must be 12 to 48 characters.' });
  assert.deepEqual(f.addClue(` ${'x'.repeat(48)} `), { ok: true, message: null });
  assert.equal(f.error, 'Needs at least 2 clues.');
  assert.ok(f.addClue('Smells of woodsmoke').ok);
  assert.equal(f.error, null);
  assert.deepEqual(f.addClue('SMELLS OF WOODSMOKE'), { ok: false, message: 'Duplicate clue: SMELLS OF WOODSMOKE' });
  for (let i = 3; i <= 10; i++) assert.ok(f.addClue(`Clue number ${i} here`).ok);
  assert.deepEqual(f.addClue('One clue too many'), { ok: false, message: 'You cannot have more than 10 clues.' });
  assert.equal(f.sheet.clues.length, 10);
  f.removeClue(1);
  assert.equal(f.sheet.clues.length, 9);
  assert.ok(!f.sheet.clues.includes('Smells of woodsmoke'));
  assert.equal(f.sheet.clues[0], 'x'.repeat(48));
});

test('the Summary lists the sheet, and Edit returns to it', () => {
  const f = sample('summary');
  assert.equal(f.page.title, 'Review your character');
  assert.deepEqual(f.rows.map((row) => [row.step, row.label]), [['name', 'Name'], ['gender', 'Gender'], ['class', 'Class'],
    ['race', 'Race'], ['age', 'Age'], ['attributes', 'Attributes'], ['description', 'Description'], ['clues', 'Clues'], ['skin', 'Skin']]);
  const value = (step) => f.rows.find((row) => row.step === step).value;
  assert.equal(value('gender'), 'Female');
  assert.equal(value('class'), 'Archer');
  assert.equal(value('race'), 'Elf');
  assert.equal(value('age'), `34 (born ${formatBirthday(f.sheet.birthday)})`);
  assert.equal(value('attributes').split('\n')[1], 'Dexterity 6');
  assert.equal(value('clues'), 'Smells faintly of pine resin\nHums old songs under her breath');
  assert.equal(value('skin'), 'Outlaw · Weathered skin · Umber hair');
  f.edit('race');
  assert.equal(f.page.id, 'race');
  assert.ok(f.returning);
  assert.ok(f.next());
  assert.equal(f.page.id, 'summary');
  assert.equal(f.returning, false);
  f.edit('gender');
  assert.equal(f.page.id, 'description');
  assert.ok(f.back());
  assert.equal(f.page.id, 'summary');
  f.set('gender', null);
  f.set('race', null);
  f.set('class', null);
  assert.equal(value('gender'), 'Unset');
  assert.equal(value('race'), '');
  assert.equal(value('class'), '');
  assert.equal(value('attributes').split('\n')[1], 'Dexterity 3', 'no race, no bonus');
});

test('the final recheck lists every failing step and blocks Create', () => {
  const r = roster();
  const f = sample('summary', r);
  assert.ok(f.setAge(180).ok);
  f.set('race', 'orc');
  f.set('description', 'short');
  assert.deepEqual(f.review, [
    { step: 'age', label: 'Age', message: 'Age must be between 18 and 90 for your race.' },
    { step: 'description', label: 'Description', message: 'Description must be at least 32 characters.' },
  ]);
  const refused = f.create();
  assert.equal(refused.ok, false);
  assert.deepEqual(refused.errors.map((e) => e.step), ['age', 'description']);
  assert.equal(r.characters.length, 0, 'nothing is written');
  assert.equal(f.error, 'Age must be between 18 and 90 for your race.', 'the Summary refuses with the first');
  assert.equal(f.next(), false);
});

test('Create saves the character, makes it active and keeps its skin', () => {
  const r = roster();
  const f = sample('summary', r);
  f.set('race', 'orc');
  assert.ok(f.setAge(40).ok);
  assert.deepEqual(f.review, []);
  assert.deepEqual(f.allowed, { ok: true });
  const made = f.create();
  assert.ok(made.ok);
  assert.equal(r.active.id, f.draft.id);
  assert.equal(r.active.sheet.name, 'Arwen Vale');
  assert.equal(r.active.skin.tone, 'olive');
  assert.deepEqual(sheetErrors(r.active, { now: START }), []);
});

test('Create passes on the roster refusals', () => {
  const r = roster();
  assert.ok(r.create(sampleDraft(r, START)).ok);
  const second = sample('summary', r);
  second.set('name', 'Brann');
  assert.ok(second.create().ok);
  const third = sample('summary', r);
  third.set('name', 'Cora');
  const cooldown = third.allowed;
  assert.equal(cooldown.reason, 'You are on cooldown from switching characters.');
  assert.equal(cooldown.opensAt, START + 4 * DAY);
  assert.deepEqual(third.create(), cooldown);
  assert.equal(third.error, cooldown.reason, 'the Summary refuses while on cooldown');
  r.clock.now += 4 * DAY;
  assert.ok(third.create().ok);
  assert.deepEqual(sample('summary', r).allowed, { ok: false, reason: 'All 3 character slots are taken.' });
  const newer = roster({ 'ascii-realm-characters': JSON.stringify({ v: 99 }) });
  assert.equal(sample('summary', newer).allowed.reason, 'Characters were saved by a newer version of the game.');
});

test('the sample draft passes every rule', () => {
  const r = roster();
  const draft = sampleDraft(r, START);
  assert.deepEqual(sheetErrors(draft, { now: START }), []);
  assert.equal(draft.skin, DEFAULT_SKIN);
});

test('start-up opens the creator for a first visit only', () => {
  const at = (query, r = roster()) => wantsCreator(new URLSearchParams(query), r);
  assert.equal(at(''), true, 'an empty roster');
  assert.equal(at('?nocreator'), false, 'tools skip it');
  assert.equal(at('?nogate'), false, 'and so do benchmarks');
  assert.equal(at('?creator&nogate'), true, '?creator always opens it');
  const made = roster();
  assert.ok(made.create(sampleDraft(made, START)).ok);
  assert.equal(at('', made), false, 'a character exists');
  assert.equal(at('?creator', made), true);
  const newer = roster({ 'ascii-realm-characters': JSON.stringify({ v: 99 }) });
  assert.equal(at('', newer), false, 'a roster that can\'t create plays as before');
});

test('the skin step always passes, and presets keep the tone and hair', () => {
  const f = sample('skin');
  assert.equal(f.error, null);
  assert.equal(f.preset.id, 'outlaw');
  f.setRegion('hair', 'flax');
  f.wearPreset('drover');
  assert.equal(f.preset.id, 'drover');
  assert.equal(f.draft.skin.hair, 'flax', 'a preset keeps the hair');
  assert.equal(f.draft.skin.layers.hood, false);
  assert.equal(f.skinText, 'Drover · Weathered skin · Flax hair · Hood down');
  f.setRegion('boots', 'tan');
  assert.equal(f.preset, null, 'a changed outfit is custom');
  f.setLayer('jerkin', false);
  f.setLayer('cloak', false);
  assert.equal(f.skinText, 'Custom · Weathered skin · Flax hair · Hood down · No jerkin · No cloak');
  f.setLayer('hood', true);
  assert.equal(f.draft.skin.layers.hood, true);
  assert.ok(f.next());
  assert.equal(f.page.id, 'summary');
  f.edit('skin');
  assert.equal(f.page.id, 'skin');
  assert.ok(f.returning);
});

test('a tone the player picks is kept through race changes', () => {
  const f = sample('race');
  f.set('race', 'orc');
  assert.equal(f.draft.skin.tone, 'olive', 'the race brings its tone');
  f.setRegion('hair', 'black');
  f.set('race', 'goblin');
  assert.equal(f.draft.skin.tone, 'fern', 'other picks leave the tone to the race');
  f.setRegion('tone', 'ember');
  assert.ok(f.draft.toneChosen);
  f.set('race', 'dryad');
  assert.equal(f.draft.skin.tone, 'ember');
  f.wearPreset('reaver');
  assert.equal(f.draft.skin.tone, 'ember', 'and presets keep it');
});

// A saved character (Arwen, an elf, in olive) and an edit of it.
function editing(r = roster()) {
  const draft = { ...sampleDraft(r, START), skin: cleanSkin({ tone: 'olive' }) };
  assert.ok(r.create(draft).ok);
  return { r, edit: () => flow({ roster: r, edit: r.active }) };
}

test('Edit starts on the Summary with the saved sheet and skin', () => {
  const { r, edit } = editing();
  const f = edit();
  assert.equal(f.page.id, 'summary');
  assert.equal(f.editing, true);
  assert.equal(f.counter, null);
  assert.deepEqual(f.sheet, r.active.sheet);
  assert.notEqual(f.sheet, r.active.sheet);
  assert.deepEqual(f.draft.skin, cleanSkin({ tone: 'olive' }));
  assert.equal(f.draft.toneChosen, true, 'olive is not the elf tone, so it was picked');
  r.setSkin(r.active.id, null);
  assert.equal(edit().draft.toneChosen, false);
  assert.equal(f.changed, false);
  assert.deepEqual(f.changes, {});
  assert.equal(flow().editing, false);
});

test('locked steps: race after a day; class, age and attributes after five; the rest never', () => {
  const { r, edit } = editing();
  const at = (ms) => { r.clock.now = ms; return edit(); };
  for (const [step, lock] of [['race', DAY], ['class', 5 * DAY], ['age', 5 * DAY], ['attributes', 5 * DAY]]) {
    assert.deepEqual(at(START + lock - 1).locked(step), { locked: false, at: START + lock }, step);
    assert.deepEqual(at(START + lock).locked(step), { locked: true, at: START + lock }, step);
  }
  const f = at(START + DAY);
  for (const step of ['name', 'gender', 'description', 'clues', 'skin']) assert.equal(f.locked(step), null, step);
  assert.equal(flow().locked('race'), null, 'a new character has no locks');
  assert.deepEqual(f.rows.map((row) => row.lock?.locked ?? null), [null, null, false, true, false, false, null, null, null]);
  assert.equal(f.edit('race'), LOCKED);
  assert.equal(f.page.id, 'summary');
  assert.equal(f.edit('class'), null);
  assert.equal(f.page.id, 'class');
  assert.ok(f.next());
  assert.equal(f.page.id, 'summary');
  f.edit('gender');
  assert.equal(f.page.id, 'description');
});

test('an edit checks only what it changes, and never the creation cooldown', () => {
  const r = roster();
  // An elf made long ago: the switch cooldown runs, and every lock has passed.
  const { edit } = editing(r);
  r.state.characters[0].switchedAt = START;
  r.clock.now = START + DAY;
  const f = edit();
  assert.equal(r.canCreate().ok, false);
  assert.deepEqual(f.allowed, { ok: true }, 'no creation cooldown when editing');
  assert.equal(f.error, null);
  f.set('name', 'A');
  assert.deepEqual(f.review, [{ step: 'name', label: 'Name', message: 'Name must be at least 3 characters.' }]);
  f.set('name', 'Arwen Brook');
  f.set('gender', 'nope');
  assert.equal(f.review[0].step, 'description', 'gender is reviewed on the Description step');
  f.set('gender', 'male');
  assert.deepEqual(f.changes, { name: 'Arwen Brook', gender: 'male' });
  assert.equal(f.changed, true);
  // A lock that passed while editing.
  f.set('race', 'human');
  assert.deepEqual(f.allowed, { ok: false, reason: 'Race is locked.' });
  assert.equal(f.error, 'Race is locked.');
  assert.deepEqual(f.save(), { ok: false, reason: 'Race is locked.' });
});

test('an age change on an edit is reviewed on the Age step', () => {
  const { r, edit } = editing();
  const f = edit();
  r.clock.now = START + 1000;
  f.edit('age');
  f.sheet.birthday = '0100-01-01';
  assert.deepEqual(f.review.map((e) => [e.step, e.label]), [['age', 'Age']]);
});

test('Save writes only what changed: nothing, the sheet fields, or the skin', () => {
  const { r, edit } = editing();
  const writes = () => r.state.rev;
  let f = edit();
  const rev = writes();
  assert.deepEqual(f.save(), { ok: true, character: r.characters[0] });
  assert.equal(writes(), rev, 'no change writes nothing');
  const calls = [];
  const update = r.update.bind(r);
  const setSkin = r.setSkin.bind(r);
  Object.assign(r, { update: (id, changes) => { calls.push(['update', changes]); return update(id, changes); },
    setSkin: (id, skin) => { calls.push(['skin', skin.tone]); return setSkin(id, skin); } });
  f = edit();
  f.set('name', 'Arwen Brook');
  const saved = f.save();
  assert.equal(saved.character.sheet.name, 'Arwen Brook');
  assert.deepEqual(calls, [['update', { name: 'Arwen Brook' }]]);
  calls.length = 0;
  f = edit();
  f.setRegion('tone', 'ember');
  assert.equal(f.changed, true);
  assert.ok(f.save().ok);
  assert.deepEqual(calls, [['skin', 'ember']]);
  assert.equal(r.active.skin.tone, 'ember');
  // A skin the roster refuses.
  f = edit();
  f.setRegion('tone', 'olive');
  r.readOnly = true;
  assert.deepEqual(f.save(), { ok: false, reason: 'Characters were saved by a newer version of the game.' });
  assert.equal(f.allowed.reason, 'Characters were saved by a newer version of the game.');
});
