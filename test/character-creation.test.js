import assert from 'node:assert/strict';
import test from 'node:test';
import { DAY } from '../src/character/catalog.js';
import { formatBirthday } from '../src/character/calendar.js';
import { Creation, PAGES, sampleDraft } from '../src/character/creation.js';
import { Roster } from '../src/character/roster.js';
import { sheetErrors } from '../src/character/rules.js';
import { DEFAULT_SKIN } from '../src/character/skin.js';

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
    'age', 'attributes', 'description-info', 'description', 'clues-info', 'clues', 'summary']);
  const f = sample('welcome');
  const seen = [];
  do seen.push([f.page.id, f.counter && `${f.counter.n}/${f.counter.total}`]); while (f.next() && f.page.id !== 'summary');
  assert.deepEqual(seen.filter(([, counter]) => counter).map(([id, counter]) => `${id} ${counter}`),
    ['name 1/7', 'class 2/7', 'race 3/7', 'age 4/7', 'attributes 5/7', 'description 6/7', 'clues 7/7']);
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
    ['race', 'Race'], ['age', 'Age'], ['attributes', 'Attributes'], ['description', 'Description'], ['clues', 'Clues']]);
  const value = (step) => f.rows.find((row) => row.step === step).value;
  assert.equal(value('gender'), 'Female');
  assert.equal(value('class'), 'Archer');
  assert.equal(value('race'), 'Elf');
  assert.equal(value('age'), `34 (born ${formatBirthday(f.sheet.birthday)})`);
  assert.equal(value('attributes').split('\n')[1], 'Dexterity 6');
  assert.equal(value('clues'), 'Smells faintly of pine resin\nHums old songs under her breath');
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
