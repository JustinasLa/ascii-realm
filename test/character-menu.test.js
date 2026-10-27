import assert from 'node:assert/strict';
import test from 'node:test';
import { DAY } from '../src/character/catalog.js';
import { countdown, lockState, sheetRows } from '../src/character/menu.js';

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
