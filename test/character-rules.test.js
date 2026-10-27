import assert from 'node:assert/strict';
import test from 'node:test';
import { DAY, RACES } from '../src/character/catalog.js';
import { ageOn, birthdayFromAge, realmToday } from '../src/character/calendar.js';
import { ageError, ageOf, attributeCost, attributesError, attributesSpent, attributeTotals, birthdayError, blankSheet,
  canChange, classError, cleanSheet, cluesError, cluesNeeded, descriptionError, fieldError, genderError, lockEndsAt,
  clipText, clusterCount, graphemes, nameError, nameKey, normalName, raceError, setAge, setBirthday, sheetErrors,
  stepError, STEPS, textLength } from '../src/character/rules.js';

const NOW = new Date(2026, 9, 26, 12).getTime();
const TODAY = realmToday(NOW);
const ONLY = 'Name may only use letters, spaces, apostrophes, hyphens and full stops.';

// A sheet that passes every rule.
const valid = (changes = {}) => ({
  ...blankSheet(),
  name: 'Zoë Ashford',
  race: 'elf',
  birthday: birthdayFromAge(30, TODAY, 'c1'),
  class: 'archer',
  attributes: { strength: 1, dexterity: 3, constitution: 1, intelligence: 0, wisdom: 2, charisma: 0 },
  description: 'A lean, sun-browned hunter with a scar across her chin.',
  clues: ['Smells of pine resin and smoke', 'Hums old elven hunting songs'],
  ...changes,
});

test('names are made NFC with straight apostrophes and trimmed', () => {
  assert.equal(normalName('  Zoe\u0308 '), 'Zoë');
  assert.equal(normalName('O\u2019Brien'), "O'Brien");
  assert.equal(normalName('O\u02bcBrien'), "O'Brien");
  assert.equal(normalName(42), '');
  assert.equal(nameKey('ZOË'), nameKey('zoë'));
});

test('names in any alphabet pass', () => {
  for (const name of ['Zoë', 'Ærwyn', 'Łukasz', 'Ольга', '李小龍', "O'Brien", 'Anne-Marie', 'St. Clair', 'Zoe\u0308',
    'O\u2019Brien', ' Aria']) {
    assert.equal(nameError(name), null, name);
  }
});

test('name messages', () => {
  assert.equal(nameError(''), 'Name cannot be empty.');
  assert.equal(nameError('   '), 'Name cannot be empty.');
  for (const name of ['-Aria', 'Ar1a', 'Kael_', 'Kael 🙂', '.Aria']) assert.equal(nameError(name), ONLY, name);
  assert.equal(nameError('Al'), 'Name must be at least 3 characters.');
  assert.equal(nameError('Ali'), null);
  assert.equal(nameError('A'.repeat(24)), null);
  assert.equal(nameError('A'.repeat(25)), 'Name cannot exceed 24 characters.');
});

test('names are counted in letters as read, not code units', () => {
  assert.equal(textLength('Zoe\u0308'), 3);
  assert.equal(textLength('𠀀𠀀𠀀'), 3);
  // 24 letters with a combining mark NFC can't fold fit, though they take
  // 48 code units.
  assert.equal(nameError('q\u0307'.repeat(24)), null);
  assert.equal(nameError('q\u0307'.repeat(25)), 'Name cannot exceed 24 characters.');
  assert.equal(nameError('𠀀'.repeat(24)), null);
  assert.equal(nameError('𠀀'.repeat(25)), 'Name cannot exceed 24 characters.');
});

// Text whose letter count a code point count gets wrong.
const CLUSTERS = [
  ['q\u0307q', 2], ['q\u0307'.repeat(13), 13], ['\u0301a', 2], ['Zoe\u0308', 3], ['𠀀𠀀', 2], ['a\r\nb', 3], ['', 0],
  ['👩\u200D👩\u200D👧', 1], ['😀\u200D', 1], ['a\u200Db', 2], ['a\u200D😀', 2], ['Ali\u200Cce', 5],
  ['❤\uFE0F', 1], ['❤\uFE0E', 1], ['a\uFE0F', 1], ['👍🏽', 1],
  ['🇳🇱🇱🇹', 2], ['🇳🇱🇱', 2], ['🏴\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}', 1],
  ['क्षत्रिय', 3], ['স্ত্রী', 1], ['ক্\u200Dষ', 1], ['ಕ್ಷ', 2], ['ﾃﾞﾊﾟ', 2],
  ['ᄀ\u1161\u11A8', 1], ['ᄀᄀ', 1], ['\u11A8\u11A8', 1], ['가\u1161', 1], ['ᄀ가', 1],
  // A precomposed syllable with a final consonant takes only more finals.
  ['각\u1161가', 3], ['각\u11A8', 1], ['가\u11A8', 1], ['가\u1161\u11A8', 1], ['\u11A8\u1161', 2], ['각가', 2],
  ['ᄀ각', 1], ['\u1161가', 2],
  // A virama joins only consonants, and not across a non-joiner.
  ['अ्क', 2], ['क\u200C्क', 2], ['क्\u200Cक', 2], ['ক्ষ', 1],
];

test('without Intl.Segmenter, letters are counted the same', () => {
  const segments = new Intl.Segmenter('en', { granularity: 'grapheme' });
  const counts = () => CLUSTERS.map(([text]) => [textLength(text), clusterCount(text)]);
  const names = () => ['q\u0307'.repeat(24), 'q\u0307'.repeat(25), 'q\u0307q', 'q\u0307qq'].map((name) => nameError(name));
  const withSegmenter = [counts(), names()];
  const segmenter = Intl.Segmenter;
  delete Intl.Segmenter;
  let without;
  try {
    without = [counts(), names()];
  } finally {
    Intl.Segmenter = segmenter;
  }
  assert.deepEqual(without, withSegmenter);
  assert.deepEqual(withSegmenter[0], CLUSTERS.map(([, letters]) => [letters, letters]));
  assert.deepEqual(CLUSTERS.map(([text]) => [...segments.segment(text)].length), CLUSTERS.map(([, letters]) => letters));
  assert.deepEqual(without[1], [null, 'Name cannot exceed 24 characters.', 'Name must be at least 3 characters.', null]);
});

test('text splits into whole letters and clips without splitting one, with or without Intl.Segmenter', () => {
  const split = () => [
    graphemes('Ame\u0301lie'), graphemes('a👩\u200D👩\u200D👧b'), graphemes('🇳🇱🇱🇹'), graphemes('ᄀ\u1161\u11A8가'),
    graphemes('क्षत्रिय'), clipText('e\u0301'.repeat(25), 24), clipText(42, 1),
  ];
  const withSegmenter = split();
  const segmenter = Intl.Segmenter;
  delete Intl.Segmenter;
  let without;
  try {
    without = split();
  } finally {
    Intl.Segmenter = segmenter;
  }
  assert.deepEqual(without, withSegmenter);
  assert.deepEqual(withSegmenter, [['A', 'm', 'e\u0301', 'l', 'i', 'e'], ['a', '👩\u200D👩\u200D👧', 'b'], ['🇳🇱', '🇱🇹'],
    ['ᄀ\u1161\u11A8', '가'], ['क्ष', 'त्रि', 'य'], 'e\u0301'.repeat(24), '4']);
  // Every cluster of the counting cases rejoins into the text.
  for (const [text, letters] of CLUSTERS) {
    assert.equal(graphemes(text).length, letters, text);
    assert.equal(graphemes(text).join(''), text);
  }
});

test('without Intl.Segmenter, long runs of marks are counted in one pass', () => {
  const text = `a${'\u094D'.repeat(10_000)}`;
  const segmenter = Intl.Segmenter;
  delete Intl.Segmenter;
  let letters;
  let message;
  const start = performance.now();
  try {
    letters = textLength(text);
    message = nameError(`Ana${'\u094D'.repeat(10_000)}`);
  } finally {
    Intl.Segmenter = segmenter;
  }
  assert.ok(performance.now() - start < 50);
  assert.equal(letters, 1);
  assert.equal(clusterCount(`क${'\u094D'.repeat(10_000)}क`), 1);
  assert.equal(message, null);
});

test('no two characters share a name, ignoring case', () => {
  const others = [{ id: 'c1', sheet: { name: 'zoë' } }];
  assert.equal(nameError('ZOË', { others }), 'Name already in use.');
  assert.equal(nameError('ZOË', { others, selfId: 'c1' }), null);
  assert.equal(nameError('Zoey', { others }), null);
});

test('gender, race and class', () => {
  for (const gender of [null, 'male', 'female', 'other']) assert.equal(genderError(gender), null);
  assert.equal(genderError('robot'), 'Pick a gender or leave it unset.');
  assert.equal(raceError(null), 'Pick a race.');
  assert.equal(raceError(undefined), 'Pick a race.');
  assert.equal(raceError('troll'), 'Unknown race: troll');
  assert.equal(raceError('orc'), null);
  assert.equal(classError(null), 'Pick a class.');
  assert.equal(classError(undefined), 'Pick a class.');
  assert.equal(classError('rogue'), 'Unknown class: rogue');
  assert.equal(classError('bard'), null);
});

test('age runs from 18 to the race maximum', () => {
  for (const race of RACES) {
    const message = `Age must be between 18 and ${race.maxAge} for your race.`;
    assert.equal(ageError(17, race.id), message);
    assert.equal(ageError(18, race.id), null);
    assert.equal(ageError(race.maxAge, race.id), null);
    assert.equal(ageError(race.maxAge + 1, race.id), message);
    assert.equal(ageError(20.5, race.id), message);
  }
  assert.equal(ageError(91, 'orc'), 'Age must be between 18 and 90 for your race.');
  assert.equal(ageError(30, null), 'Select a race before setting a birthday.');
});

test('the birthday must give an age the race allows', () => {
  assert.equal(birthdayError(valid(), NOW), null);
  assert.equal(ageOf(valid(), NOW), 30);
  assert.equal(birthdayError(valid({ race: null }), NOW), 'Select a race before setting a birthday.');
  assert.equal(birthdayError(valid({ birthday: null }), NOW), 'Invalid birthday.');
  assert.equal(birthdayError(valid({ birthday: '0379-02-30' }), NOW), 'Invalid birthday.');
  const old = valid({ birthday: birthdayFromAge(100, TODAY, 'c1') });
  assert.equal(birthdayError(old, NOW), null);
  // Changing the race to orc puts the age out of range.
  assert.equal(birthdayError({ ...old, race: 'orc' }, NOW), 'Age must be between 18 and 90 for your race.');
});

test('setAge picks the stable birthday for that age', () => {
  const result = setAge(valid(), 45, 'c9', NOW);
  assert.equal(result.ok, true);
  assert.equal(ageOn(result.sheet.birthday, TODAY), 45);
  assert.equal(setAge(valid(), 45, 'c9', NOW).sheet.birthday, result.sheet.birthday);
  assert.deepEqual(setAge(valid({ race: 'orc' }), 91, 'c9', NOW),
    { ok: false, message: 'Age must be between 18 and 90 for your race.' });
});

test('a typed birthday is accepted when its age is in range', () => {
  const result = setBirthday(valid(), '14.07.349', NOW);
  assert.deepEqual([result.ok, result.sheet.birthday], [true, '0349-07-14']);
  assert.deepEqual(setBirthday(valid(), '14/07/349', NOW).sheet.birthday, '0349-07-14');
  assert.deepEqual(setBirthday(valid(), '14.07.370', NOW), { ok: false, message: 'Age must be between 18 and 210 for your race.' });
  assert.deepEqual(setBirthday(valid(), '31.02.349', NOW), { ok: false, message: 'Invalid birthday.' });
  assert.deepEqual(setBirthday(valid({ race: null }), '14.07.349', NOW),
    { ok: false, message: 'Select a race before setting a birthday.' });
});

test('description length after trimming', () => {
  assert.equal(descriptionError(''), 'Description cannot be empty.');
  assert.equal(descriptionError('   '), 'Description cannot be empty.');
  assert.equal(descriptionError(null), 'Description cannot be empty.');
  assert.equal(descriptionError(` ${'a'.repeat(31)} `), 'Description must be at least 32 characters.');
  assert.equal(descriptionError(` ${'a'.repeat(32)} `), null);
  assert.equal(descriptionError('a'.repeat(256)), null);
  assert.equal(descriptionError('a'.repeat(257)), 'Description cannot exceed 256 characters.');
});

test('clue counts and lengths', () => {
  const clue = (i) => `Clue number ${String(i).padStart(2, '0')}`;
  const clues = (n) => Array.from({ length: n }, (_, i) => clue(i));
  assert.equal(cluesError(clues(1)), 'Needs at least 2 clues.');
  assert.equal(cluesError(clues(2)), null);
  assert.equal(cluesError(clues(10)), null);
  assert.equal(cluesError(clues(11)), 'You cannot have more than 10 clues.');
  assert.equal(cluesError(clues(3), 4), 'Needs at least 4 clues.');
  assert.equal(cluesError([...clues(1), 'a'.repeat(11)]), 'Each clue must be 12 to 48 characters.');
  assert.equal(cluesError([...clues(1), 'a'.repeat(12)]), null);
  assert.equal(cluesError([...clues(1), 'a'.repeat(48)]), null);
  assert.equal(cluesError([...clues(1), 'a'.repeat(49)]), 'Each clue must be 12 to 48 characters.');
  assert.equal(cluesError([...clues(1), `  ${'a'.repeat(11)}  `]), 'Each clue must be 12 to 48 characters.');
  assert.equal(cluesError([clue(1), 7]), 'Each clue must be 12 to 48 characters.');
  assert.equal(cluesError(null), 'Needs at least 2 clues.');
});

test('clue checks run in order, the first bad clue deciding', () => {
  // Too many is reported before a short clue.
  assert.equal(cluesError([...Array.from({ length: 10 }, (_, i) => `Clue number ${i}0`), 'short']),
    'You cannot have more than 10 clues.');
  assert.equal(cluesError(['Smells of pine resin', 'SMELLS OF PINE RESIN']), 'Duplicate clue: SMELLS OF PINE RESIN');
  // A long clue before a duplicate wins, and a duplicate before a long one.
  assert.equal(cluesError(['Smells of pine resin', 'a'.repeat(49), 'smells of pine resin']),
    'Each clue must be 12 to 48 characters.');
  assert.equal(cluesError(['Smells of pine resin', 'smells of pine resin', 'a'.repeat(49)]),
    'Duplicate clue: smells of pine resin');
});

test('evil characters need four clues', () => {
  assert.equal(cluesNeeded(valid()), 2);
  assert.equal(cluesNeeded({ traits: [{ id: 'spiteful', evil: true }] }), 4);
  assert.equal(cluesNeeded({}), 2);
  assert.equal(stepError('clues', { id: 'c1', sheet: valid({ traits: [{ evil: true }] }) }, { now: NOW }), 'Needs at least 4 clues.');
});

test('attribute ranks cost 1, 2, 4 and 8 points', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(attributeCost), [0, 1, 3, 7, 15]);
  const ranks = (values) => Object.fromEntries(['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma']
    .map((key, i) => [key, values[i] ?? 0]));
  assert.equal(attributesSpent(ranks([1, 3, 1, 0, 2, 0])), 12);
  assert.equal(attributesSpent(undefined), 0);
  assert.equal(attributesError(ranks([1, 3, 1, 0, 2, 0])), null);
  assert.equal(attributesError(ranks([3, 2, 1, 1])), null);
  assert.equal(attributesError(ranks([3, 2])), 'Spend exactly 12 attribute points (spent 10).');
  assert.equal(attributesError(ranks([3, 2, 1, 1, 1])), 'Spend exactly 12 attribute points (spent 13).');
  assert.equal(attributesError(ranks([4])), 'Spend exactly 12 attribute points (spent 15).');
  assert.equal(attributesError(ranks([5])), 'Attribute ranks must be whole numbers from 0 to 4.');
  assert.equal(attributesError(ranks([1.5])), 'Attribute ranks must be whole numbers from 0 to 4.');
  assert.equal(attributesError(ranks([-1])), 'Attribute ranks must be whole numbers from 0 to 4.');
  assert.equal(attributesError({}), 'Spend exactly 12 attribute points (spent 0).');
});

test('attribute totals add the race bonus and never drop below 0', () => {
  assert.deepEqual(attributeTotals(valid()),
    { strength: 4, dexterity: 6, constitution: 4, intelligence: 3, wisdom: 5, charisma: 3 });
  assert.deepEqual(attributeTotals({ ...valid(), race: null }),
    { strength: 1, dexterity: 3, constitution: 1, intelligence: 0, wisdom: 2, charisma: 0 });
  const totals = attributeTotals({ ...valid(), traits: [{ modifiers: { strength: -9, wisdom: 2 } }, null] });
  assert.equal(totals.strength, 0);
  assert.equal(totals.wisdom, 7);
  assert.deepEqual(attributeTotals({}), { strength: 0, dexterity: 0, constitution: 0, intelligence: 0, wisdom: 0, charisma: 0 });
});

test('each step reports its first problem', () => {
  const draft = (changes) => ({ id: 'c1', sheet: valid(changes) });
  const ctx = { now: NOW };
  for (const step of STEPS) assert.equal(stepError(step, draft(), ctx), null, step);
  assert.deepEqual(STEPS, ['name', 'class', 'race', 'age', 'attributes', 'description', 'clues']);
  assert.equal(stepError('name', draft({ name: 'X' }), ctx), 'Name must be at least 3 characters.');
  assert.equal(stepError('class', draft({ class: null }), ctx), 'Pick a class.');
  assert.equal(stepError('race', draft({ race: null }), ctx), 'Pick a race.');
  assert.equal(stepError('age', draft({ race: 'orc', birthday: birthdayFromAge(95, TODAY, 'c1') }), ctx),
    'Age must be between 18 and 90 for your race.');
  assert.equal(stepError('attributes', draft({ attributes: blankSheet().attributes }), ctx),
    'Spend exactly 12 attribute points (spent 0).');
  assert.equal(stepError('description', draft({ description: 'short' }), ctx), 'Description must be at least 32 characters.');
  assert.equal(stepError('description', draft({ gender: 'robot' }), ctx), 'Pick a gender or leave it unset.');
  assert.equal(stepError('clues', draft({ clues: [] }), ctx), 'Needs at least 2 clues.');
  assert.equal(stepError('skin', draft(), ctx), null, 'any skin passes');
  assert.equal(stepError('traits', draft(), ctx), 'Unknown step: traits');
  // The clock defaults to now.
  assert.equal(stepError('age', draft()), null);
  assert.equal(fieldError('gender', draft({ gender: 'male' })), null);
  assert.equal(fieldError('colour', draft(), ctx), 'Unknown field: colour');
});

test('the name step sees the other characters', () => {
  const draft = { id: 'c2', sheet: valid({ name: 'ZOË ASHFORD' }) };
  const others = [{ id: 'c1', sheet: valid() }];
  assert.equal(stepError('name', draft, { others, now: NOW }), 'Name already in use.');
  assert.equal(stepError('name', { ...draft, id: 'c1' }, { others, now: NOW }), null);
});

test('sheetErrors lists every failing step in order', () => {
  assert.deepEqual(sheetErrors({ id: 'c1', sheet: valid() }, { now: NOW }), []);
  assert.deepEqual(sheetErrors({ id: 'c1', sheet: blankSheet() }, { now: NOW }), [
    { step: 'name', message: 'Name cannot be empty.' },
    { step: 'class', message: 'Pick a class.' },
    { step: 'race', message: 'Pick a race.' },
    { step: 'age', message: 'Select a race before setting a birthday.' },
    { step: 'attributes', message: 'Spend exactly 12 attribute points (spent 0).' },
    { step: 'description', message: 'Description cannot be empty.' },
    { step: 'clues', message: 'Needs at least 2 clues.' },
  ]);
});

test('change locks count from creation', () => {
  const character = { createdAt: NOW };
  for (const field of ['name', 'gender', 'description', 'clues', 'skin']) {
    assert.equal(canChange(character, field, NOW + 1000 * DAY), true, field);
    assert.equal(lockEndsAt(character, field), null);
  }
  for (const [field, lock] of [['race', DAY], ['class', 5 * DAY], ['age', 5 * DAY], ['birthday', 5 * DAY], ['attributes', 5 * DAY]]) {
    assert.equal(canChange(character, field, NOW + lock - 1), true, field);
    assert.equal(canChange(character, field, NOW + lock), false, field);
    assert.equal(lockEndsAt(character, field), NOW + lock);
  }
  assert.equal(canChange(character, 'traits', NOW), false);
  assert.equal(canChange(character, 'colour', NOW), false);
});

test('a blank sheet', () => {
  assert.deepEqual(blankSheet(), { name: '', gender: null, race: null, birthday: null, class: null,
    attributes: { strength: 0, dexterity: 0, constitution: 0, intelligence: 0, wisdom: 0, charisma: 0 },
    description: '', clues: [], traits: [] });
  assert.notEqual(blankSheet().attributes, blankSheet().attributes);
});

test('cleaning repairs types field by field and keeps rule breaches', () => {
  assert.deepEqual(cleanSheet(valid()), valid());
  assert.deepEqual(cleanSheet(null), blankSheet());
  assert.deepEqual(cleanSheet({ name: 7, gender: 'robot', race: 'troll', birthday: '351-1-1', class: 'rogue',
    attributes: { strength: 9, dexterity: -2, constitution: 2.7, intelligence: 'x', wisdom: NaN },
    description: 5, clues: ['  Smells of smoke  ', 3, null, 'short'], traits: [{ evil: true }] }), {
    name: '', gender: null, race: null, birthday: null, class: null,
    attributes: { strength: 4, dexterity: 0, constitution: 2, intelligence: 0, wisdom: 0, charisma: 0 },
    description: '', clues: ['Smells of smoke', 'short'], traits: [] });
  assert.equal(cleanSheet({ clues: 'nope' }).clues.length, 0);
  assert.equal(cleanSheet({ description: '  too short  ' }).description, 'too short');
  assert.equal(cleanSheet({ birthday: ' 0351-10-02 ' }).birthday, '0351-10-02');
  assert.equal(cleanSheet({ name: ' Zoe\u0308 ' }).name, 'Zoë');
});
