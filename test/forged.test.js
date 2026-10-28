import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_UNITS, QUALITIES, readForged } from '../src/crafting/forged.js';

const VALID = {
  metal: 'Blackiron', colour: '5E6568', quality: 'gleaming', hits: 92,
  stats: { projectileDamage: 0.3, attackDamage: 3.85, bluntRating: 46.25, durability: 429.5 },
  inputs: { ironIngot: 1, a1: 3 },
};
const variant = (changes) => ({ ...VALID, ...changes });

test('the quality bands and their sockets', () => {
  assert.deepEqual(QUALITIES.map((q) => [q.id, q.name, q.at, q.socket]), [
    ['rusted', 'Rusted', 0, null], ['tempered', 'Tempered', 50, 'Basic'], ['polished', 'Polished', 75, 'Polished'],
    ['gleaming', 'Gleaming', 90, 'Radiant'], ['masterwork', 'Masterwork', 100, 'Mythical'],
  ]);
  assert.ok(Object.isFrozen(QUALITIES) && QUALITIES.every(Object.isFrozen));
  assert.equal(MAX_UNITS, 8);
});

test('a forged weapon reads back frozen, in a fixed key order with sorted stats and inputs', () => {
  const forged = readForged(VALID);
  assert.equal(JSON.stringify(forged), JSON.stringify({
    metal: 'Blackiron', colour: '5E6568', quality: 'gleaming', hits: 92,
    stats: { attackDamage: 3.85, bluntRating: 46.25, durability: 429.5, projectileDamage: 0.3 },
    inputs: { a1: 3, ironIngot: 1 },
  }));
  assert.ok(Object.isFrozen(forged) && Object.isFrozen(forged.stats) && Object.isFrozen(forged.inputs));
  assert.deepEqual(readForged(forged), forged, 'it reads itself back');
  // An ingot weapon has no colour of its own.
  const { colour, ...ingot } = VALID;
  assert.equal(colour, '5E6568');
  assert.equal(Object.hasOwn(readForged({ ...ingot, inputs: { ironIngot: 4 } }), 'colour'), false);
  assert.equal(readForged({ ...ingot, metal: 'Dark Steel', inputs: { a12: 8 } }).metal, 'Dark Steel');
});

test('each bad field drops the whole forging', () => {
  for (const bad of [null, 'Iron', [VALID], 7]) assert.equal(readForged(bad), null);
  const cases = {
    metal: [undefined, 'Iron2', 'A'.repeat(25), ' Iron', 'Iron  Steel', 3],
    colour: ['5e6568', '123456', 'FFFFFF', null],
    quality: [undefined, 'legendary', 'Gleaming'],
    hits: [undefined, 101, -1, 1.5, '92'],
    stats: [undefined, {}, { attackDamage: 3, speed: 1 }, { attackDamage: NaN }, { attackDamage: 3, durability: 2e6 },
      { durability: 500 }, { attackDamage: 0 }, { attackDamage: -1 }, [3]],
    inputs: [undefined, {}, { rawTin: 1 }, { lapisLazuli: 1 }, { b1: 1 }, { a0: 1 }, { ironIngot: 0 }, { ironIngot: 1.5 },
      { ironIngot: 5, a1: 4 }, ['ironIngot'], { shortSword: 1 }],
  };
  for (const [field, values] of Object.entries(cases)) {
    for (const value of values) assert.equal(readForged(variant({ [field]: value })), null, `${field} ${JSON.stringify(value)}`);
  }
  assert.ok(readForged(variant({ inputs: { ironIngot: 4, a1: 4 } })), 'eight units is the most');
  assert.ok(readForged(variant({ stats: { attackDamage: 4, armour: -0.5 } })), 'a stat may be negative');
});

test('the look friends see keeps only the metal and colour', () => {
  assert.deepEqual(readForged(VALID, { look: true }), { metal: 'Blackiron', colour: '5E6568' });
  assert.ok(Object.isFrozen(readForged(VALID, { look: true })));
  assert.deepEqual(readForged({ metal: 'Iron' }, { look: true }), { metal: 'Iron' });
  assert.equal(readForged({ metal: 'Iron' }), null, 'a look alone is not a whole forging');
  assert.equal(readForged({ metal: 'Iron', colour: 'ABCDEF' }, { look: true }), null);
  assert.equal(readForged({ metal: '<b>' }, { look: true }), null);
});
