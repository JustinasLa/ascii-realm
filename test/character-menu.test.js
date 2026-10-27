import assert from 'node:assert/strict';
import test from 'node:test';
import { DAY } from '../src/character/catalog.js';
import { countdown, createState, lockNote, lockState, rosterRows, sheetRows, waitText } from '../src/character/menu.js';
import { Roster } from '../src/character/roster.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

test('countdowns read in days, hours and minutes, rounding minutes up', () => {
  const cases = [[0, '0m'], [-5, '0m'], [NaN, '0m'], [1, '1m'], [59 * 1000, '1m'], [MINUTE, '1m'], [61 * 1000, '2m'],
    [HOUR, '1h'], [DAY, '1d'], [4 * DAY, '4d'], [3 * DAY + 4 * HOUR + 12 * MINUTE, '3d 4h 12m'], [DAY + 30 * 1000, '1d 1m']];
  for (const [ms, text] of cases) assert.equal(countdown(ms), text, String(ms));
});

const CREATED = new Date(2026, 9, 20, 12).getTime();
const character = { id: 'c0001', createdAt: CREATED, switchedAt: null, skin: null, sheet: {
  name: 'Žydrūnas', gender: null, race: 'elf', birthday: '0345-10-02', class: 'archer',
  attributes: { strength: 0, dexterity: 3, constitution: 1, intelligence: 0, wisdom: 2, charisma: 0 },
  description: 'A tall archer with a grey cloak and a crooked smile.', clues: ['Smells of pine resin', 'Whistles when nervous'],
  traits: [] } };

test('race locks a day after creation; class, age and attributes after five; the rest never', () => {
  for (const [field, lock] of [['race', DAY], ['class', 5 * DAY], ['age', 5 * DAY], ['attributes', 5 * DAY]]) {
    assert.deepEqual(lockState(character, field, CREATED + lock - 1), { locked: false, at: CREATED + lock }, field);
    assert.deepEqual(lockState(character, field, CREATED + lock), { locked: true, at: CREATED + lock }, field);
  }
  for (const field of ['name', 'gender', 'description', 'clues', 'skin']) assert.equal(lockState(character, field, CREATED), null);
});

test('the Character page lists the sheet in order, with lock notes', () => {
  const now = CREATED + 2 * DAY;
  const formatDate = (ms) => `on ${new Date(ms).toISOString().slice(0, 10)}`;
  const rows = sheetRows(character, now, { formatDate });
  assert.deepEqual(rows.map((row) => row.label),
    ['Name', 'Gender', 'Age', 'Birthday', 'Race', 'Description', 'Class', 'Attributes', 'Clues']);
  const [name, gender, age, birthday, race, description, klass, attributes, clues] = rows;
  assert.equal(name.value, 'Žydrūnas');
  assert.equal(gender.value, 'Unset');
  assert.deepEqual([age.value, age.note], ['34', 'Locks in 3d']);
  assert.equal(birthday.value, '02.10.345 AE');
  assert.deepEqual([race.value, race.colour, race.note], ['Elf', '#5682f2', `Locked since ${formatDate(CREATED + DAY)}`]);
  assert.equal(description.value, character.sheet.description);
  assert.deepEqual([klass.value, klass.note], ['Archer', 'Locks in 3d']);
  assert.deepEqual(attributes.list, ['Strength 3', 'Dexterity 6', 'Constitution 4', 'Intelligence 3', 'Wisdom 5', 'Charisma 3']);
  assert.deepEqual(clues.list, character.sheet.clues);
  assert.equal(clues.note, undefined);
  // A ?name= visit says so; the default date is the device's own format.
  assert.equal(sheetRows(character, now, { shown: 'Ash' })[0].value, 'Žydrūnas (shown as Ash this visit)');
  assert.equal(sheetRows(character, now, { shown: 'Žydrūnas' })[0].value, 'Žydrūnas');
  assert.equal(sheetRows(character, now)[4].note, `Locked since ${new Date(CREATED + DAY).toLocaleDateString()}`);
});

test('a sheet without a gender, race or class reads Unset, and a gender shows its name', () => {
  const blank = { ...character, sheet: { ...character.sheet, gender: 'female', race: null, class: null } };
  const rows = sheetRows(blank, CREATED);
  assert.equal(rows[1].value, 'Female');
  assert.deepEqual([rows[4].value, rows[4].colour], ['Unset', null]);
  assert.equal(rows[6].value, 'Unset');
});

test('lock notes say when a choice locked or how long until it does', () => {
  assert.equal(lockNote({ locked: false, at: CREATED + DAY }, CREATED), 'Locks in 1d');
  assert.equal(lockNote({ locked: true, at: CREATED }, CREATED + DAY), `Locked since ${new Date(CREATED).toLocaleDateString()}`);
  assert.equal(lockNote({ locked: true, at: CREATED }, CREATED, () => 'then'), 'Locked since then');
});

// A roster of three made a day apart from CREATED, with ids c0001 to c0003.
function three() {
  const map = new Map();
  let now = CREATED;
  let n = 0;
  const roster = new Roster({ storage: { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) },
    now: () => now, bypassCooldown: true, randomId: () => `c000${++n}` });
  for (const [name, race] of [['Bryn', 'elf'], ['Ash', 'human'], ['Cael', 'elf']]) {
    const draft = roster.newDraft();
    draft.sheet = { ...character.sheet, name, race, clues: [...character.sheet.clues],
      attributes: { strength: 1, dexterity: 3, constitution: 1, intelligence: 0, wisdom: 2, charisma: 0 } };
    if (race === 'human') draft.sheet.birthday = '0349-01-01';
    assert.equal(roster.create(draft).ok, true, name);
    now += DAY;
  }
  return { roster, at: (ms) => { now = ms; } };
}

test('roster rows: most recently played first, then by name, with their line and Play as', () => {
  const { roster, at } = three();
  const now = CREATED + 3 * DAY;
  let rows = rosterRows(roster, now);
  assert.deepEqual(rows.map((row) => [row.id, row.name, row.active]), [['c0003', 'Cael', true], ['c0002', 'Ash', false], ['c0001', 'Bryn', false]]);
  assert.equal(rows[0].line, `Elf · Archer · ${rows[0].line.split(' · ')[2]}`);
  assert.match(rows[1].line, /^Human · Archer · 30$/);
  assert.ok(rows.every((row) => row.play.ok), 'the cooldown is bypassed');
  // Two played at the same moment go by name; an unset race and class say so.
  roster.state.characters[0].switchedAt = roster.state.characters[1].switchedAt;
  roster.state.characters[0].sheet.race = null;
  roster.state.characters[0].sheet.class = null;
  roster.bypassCooldown = false;
  at(now);
  rows = rosterRows(roster, now);
  assert.deepEqual(rows.map((row) => row.name), ['Cael', 'Ash', 'Bryn']);
  assert.match(rows[2].line, /^Unset · Unset · \d+$/);
  assert.deepEqual(rows[1].play, { ok: false, reason: 'You are on cooldown from switching characters.', opensAt: CREATED + 6 * DAY });
});

test('the Create state counts the slots and passes on the refusal', () => {
  const { roster } = three();
  assert.deepEqual(createState(roster), { ok: false, reason: 'All 3 character slots are taken.', used: '3 of 3 character slots used' });
  roster.state.characters.pop();
  assert.deepEqual(createState(roster), { ok: true, used: '2 of 3 character slots used' });
});

test('waiting text: the reason, then how long and when', () => {
  const opensAt = CREATED + 3 * DAY + 4 * HOUR + 12 * MINUTE;
  assert.equal(waitText({ reason: 'Wait.', opensAt }, CREATED, () => 'Friday'), 'Wait. Opens in 3d 4h 12m, on Friday.');
  assert.equal(waitText({ reason: 'Wait.', opensAt }, CREATED), `Wait. Opens in 3d 4h 12m, on ${new Date(opensAt).toLocaleString()}.`);
  assert.equal(waitText({ reason: 'All 3 character slots are taken.' }, CREATED), 'All 3 character slots are taken.');
});
