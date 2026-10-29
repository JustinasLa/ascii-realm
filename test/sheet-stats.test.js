import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sheetStats } from '../src/ui/sheet-stats.js';

const vitals = { health: 99.6, maxHealth: 100, stamina: 42.4, maxStamina: 100 };
const pairs = (stats) => stats.map(({ label, value }) => `${label} ${value}`);

test('the strip shows HP, stamina and weight, rounded as the HUD rounds them', () => {
  const stats = sheetStats({ vitals, weight: 3.25, capacity: 60 });
  assert.deepEqual(pairs(stats), ['HP 100/100', 'stamina 42/100', 'weight 3.3/60 kg']);
  assert.deepEqual(stats.map(({ key }) => key), ['hp', 'stamina', 'weight']);
});

test('with a mana source MP follows HP', () => {
  const stats = sheetStats({ vitals, mana: { mana: 40.2, maxMana: 100 }, weight: 0, capacity: 60 });
  assert.deepEqual(pairs(stats), ['HP 100/100', 'MP 40/100', 'stamina 42/100', 'weight 0/60 kg']);
});

test('attributes come in sheet order, then the weight and the pouch last', () => {
  const attributes = { charisma: 3, strength: 7, dexterity: 4, constitution: 6, intelligence: 5, wisdom: 2 };
  const stats = sheetStats({ vitals, attributes, weight: 12.2, capacity: 60, cents: 1240 });
  assert.deepEqual(pairs(stats), ['HP 100/100', 'stamina 42/100', 'STR 7', 'DEX 4', 'CON 6', 'INT 5', 'WIS 2', 'CHA 3',
    'weight 12.2/60 kg', 'pouch 12.40d']);
  assert.deepEqual(pairs(sheetStats({ vitals, weight: 0, capacity: 60, cents: 0 })).at(-1), 'pouch 0.00d');
});

test('a number the game lacks shows dashes, never an invented value', () => {
  const stats = sheetStats({ vitals: {}, mana: { mana: NaN, maxMana: 100 }, attributes: { strength: 5 },
    weight: undefined, capacity: 60, cents: null });
  assert.deepEqual(pairs(stats), ['HP --/--', 'MP --/--', 'stamina --/--', 'STR 5', 'DEX --', 'CON --', 'INT --',
    'WIS --', 'CHA --', 'weight --/60 kg']);
});

test('no stat the game has no numbers for ever appears', () => {
  const labels = sheetStats({ vitals, mana: { mana: 1, maxMana: 1 }, attributes: {}, weight: 1, capacity: 60, cents: 5 })
    .map(({ label }) => label.toLowerCase());
  for (const missing of ['level', 'xp', 'armour', 'gold', 'evasion', 'accuracy', 'damage', 'crit', 'dps']) {
    assert.equal(labels.includes(missing), false, missing);
  }
});
