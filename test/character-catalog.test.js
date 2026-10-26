import assert from 'node:assert/strict';
import test from 'node:test';
import { ATTRIBUTE_NAMES, ATTRIBUTES, CLASSES, classOf, DAY, GENDERS, genderOf, raceBonus, RACES, raceOf, RULES, UNSET }
  from '../src/character/catalog.js';

test('seven races with their maximum ages and two lines each', () => {
  assert.deepEqual(RACES.map((race) => [race.id, race.name, race.maxAge]), [
    ['human', 'Human', 110], ['elf', 'Elf', 210], ['orc', 'Orc', 90], ['goblin', 'Goblin', 90],
    ['dwarf', 'Dwarf', 160], ['dryad', 'Dryad', 210], ['oseni', 'Oseni', 160]]);
  for (const race of RACES) {
    assert.equal(race.lines.length, 2);
    assert.match(race.colour, /^#[0-9a-f]{6}$/);
  }
  assert.equal(raceOf('elf').maxAge, 210);
  assert.equal(raceOf('troll'), null);
});

test('every race gives +3 to each attribute', () => {
  assert.deepEqual(raceBonus(), Object.fromEntries(ATTRIBUTES.map((key) => [key, 3])));
  assert.equal(RULES.raceBonus, 3);
});

test('seven classes in order, one line each', () => {
  assert.deepEqual(CLASSES.map((entry) => entry.name), ['Archer', 'Bard', 'Warrior', 'Paladin', 'Guardian', 'Mage', 'Musketeer']);
  for (const entry of CLASSES) assert.ok(entry.line.length > 20 && !entry.line.includes('\n'));
  assert.equal(classOf('mage').name, 'Mage');
  assert.equal(classOf('rogue'), null);
});

test('six attributes, three genders and Unset', () => {
  assert.deepEqual(ATTRIBUTES, ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma']);
  assert.deepEqual(Object.keys(ATTRIBUTE_NAMES), ATTRIBUTES);
  assert.deepEqual(GENDERS.map((entry) => entry.name), ['Male', 'Female', 'Other']);
  assert.equal(genderOf('other').name, 'Other');
  assert.equal(genderOf('x'), null);
  assert.equal(UNSET, 'Unset');
});

test('the rule numbers', () => {
  assert.equal(RULES.pool, 12);
  assert.equal(RULES.maxRank, 4);
  assert.equal(RULES.minAge, 18);
  assert.deepEqual(RULES.name, { min: 3, max: 24 });
  assert.deepEqual(RULES.description, { min: 32, max: 256 });
  assert.deepEqual(RULES.clues, { min: 12, max: 48, most: 10, needed: 2, neededEvil: 4 });
  assert.equal(RULES.slots, 3);
  assert.equal(RULES.switchCooldownMs, 4 * DAY);
  assert.deepEqual(RULES.locks, { race: DAY, class: 5 * DAY, age: 5 * DAY, attributes: 5 * DAY });
});

test('the catalogue is frozen', () => {
  for (const value of [RACES, RACES[0], RACES[0].lines, CLASSES, CLASSES[0], ATTRIBUTES, ATTRIBUTE_NAMES,
    GENDERS, GENDERS[0], RULES, RULES.name, RULES.clues, RULES.locks, raceBonus()]) {
    assert.ok(Object.isFrozen(value));
  }
});
