import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readForged } from '../src/crafting/forged.js';
import {
  averageStats, CLUE_DC, CLUE_PREFIX, craftRoll, CRAFT_MODIFIER, familyNeeded, HIT_ORDER, hitClue, hitsPercent, isExact,
  kindPercent, majorityUnit, makeWeapon, MAX_HITS, neededHits, NO_CLUE, qualityOf, RECIPES, unitHits, weaponName,
} from '../src/crafting/smithing.js';
import { ITEMS } from '../src/inventory/items.js';

// A scripted random source that fails the test if it runs dry.
function seq(...values) {
  const random = () => {
    assert.ok(values.length, 'no draw left');
    return values.shift();
  };
  random.left = () => values.length;
  return random;
}
// An Iron + Raw Tin alloy, as the alloy book keeps it.
const ALLOYS = {
  a1: { id: 'a1', name: 'Blackiron', colour: '5E6568', type: 'metal', tier: 1,
    stats: { attackDamage: 3.95, bluntRating: 45, durability: 406, projectileDamage: 0.4 }, hits: { hit: 1, smallHit: 2, engrave: 3 } },
};
const alloyOf = (id) => ALLOYS[id] ?? null;
const units = (...pairs) => pairs.flatMap(([unit, n]) => Array(n).fill(unit));

test('the recipes and the hit buttons', () => {
  assert.deepEqual(Object.entries(RECIPES).map(([id, r]) => [id, r.name, r.metal]), [
    ['shortSword', 'Short Sword', 4], ['dagger', 'Dagger', 4], ['battleAxe', 'Battle Axe', 4],
    ['warHammer', 'War Hammer', 4], ['spear', 'Spear', 4], ['greatsword', 'Greatsword', 8],
  ]);
  for (const [id, recipe] of Object.entries(RECIPES)) {
    assert.ok(ITEMS[id].weapon, `${id} is a weapon`);
    assert.equal(ITEMS[id].name, recipe.name);
  }
  assert.deepEqual(HIT_ORDER, ['hit', 'smallHit', 'etch', 'whittle', 'engrave', 'sew']);
  assert.deepEqual([CLUE_DC, CRAFT_MODIFIER, MAX_HITS], [12, 0, 999]);
});

test('each loaded unit adds its own hits', () => {
  assert.deepEqual(neededHits(units(['ironIngot', 4]), alloyOf), { hit: 16, smallHit: 4 });
  assert.deepEqual(neededHits(units(['steelIngot', 4]), alloyOf), { hit: 20, smallHit: 8 });
  assert.deepEqual(neededHits(units(['bronzeIngot', 4]), alloyOf), { hit: 4, smallHit: 20 });
  assert.deepEqual(neededHits(units(['copperIngot', 4]), alloyOf), { hit: 8, smallHit: 8 });
  assert.deepEqual(neededHits(units(['a1', 4]), alloyOf), { hit: 4, smallHit: 8, engrave: 12 });
  assert.deepEqual(neededHits(['ironIngot', 'a1', 'ironIngot', 'a1'], alloyOf), { hit: 10, smallHit: 6, engrave: 6 });
  assert.deepEqual(neededHits(units(['ironIngot', 8]), alloyOf), { hit: 32, smallHit: 8 });
  assert.deepEqual(neededHits([], alloyOf), {});
  assert.deepEqual(unitHits('a9', alloyOf), {}, 'an alloy the book lost adds nothing');
});

test('a hit is accepted when the piece needs any hit of its family', () => {
  const iron = neededHits(units(['ironIngot', 4]), alloyOf);
  assert.equal(familyNeeded(iron, 'hit'), true);
  assert.equal(familyNeeded(iron, 'smallHit'), true);
  for (const kind of ['etch', 'whittle', 'engrave', 'sew']) assert.equal(familyNeeded(iron, kind), false, kind);
  const alloy = neededHits(units(['a1', 4]), alloyOf);
  for (const kind of ['etch', 'sew', 'engrave', 'whittle']) assert.equal(familyNeeded(alloy, kind), true, kind);
  assert.equal(familyNeeded({ hit: 0 }, 'hit'), false);
  assert.equal(familyNeeded(iron, 'chisel'), false);
});

test('Hits % scores each kind up to 100, back down to 0 at 200, and averages', () => {
  assert.equal(kindPercent(1, 3), 33);
  assert.equal(kindPercent(2, 3), 67);
  assert.equal(kindPercent(5, 0), 0);
  assert.equal(kindPercent(), 0);
  assert.equal(hitsPercent({}, {}), 100, 'nothing to get wrong');
  assert.equal(hitsPercent({ hit: 16, smallHit: 4 }, { hit: 16, smallHit: 4 }), 100);
  assert.equal(hitsPercent({ hit: 8 }, { hit: 16, smallHit: 4 }), 25, 'an untouched kind scores 0');
  assert.equal(hitsPercent({ hit: 24 }, { hit: 16 }), 50, '150% scores 50');
  assert.equal(hitsPercent({ hit: 32 }, { hit: 16 }), 0, 'exactly 200% scores 0');
  assert.equal(hitsPercent({ hit: 40 }, { hit: 16 }), 0, 'beyond 200% scores 0');
  assert.equal(hitsPercent({ hit: 16, etch: 3 }, { hit: 16 }), 50, 'an unneeded kind scores 0 and counts');
  // The classic worked example: a Gleaming sword.
  const done = { hit: 16, smallHit: 5, etch: 4, whittle: 6, sew: 10 };
  const needed = { hit: 16, smallHit: 4, etch: 4, whittle: 8, sew: 10 };
  assert.equal(hitsPercent(done, needed), 90);
  assert.equal(qualityOf(hitsPercent(done, needed)).name, 'Gleaming');
  // 199 of 200 rounds to 100, but only exact work is a Masterwork.
  assert.equal(hitsPercent({ hit: 199 }, { hit: 200 }), 99);
  assert.equal(isExact({ hit: 199 }, { hit: 200 }), false);
  assert.equal(isExact({ hit: 4, etch: 0 }, { hit: 4 }), true);
});

test('quality bands', () => {
  const bands = [[0, 'rusted'], [49, 'rusted'], [50, 'tempered'], [74, 'tempered'], [75, 'polished'],
    [89, 'polished'], [90, 'gleaming'], [99, 'gleaming'], [100, 'masterwork']];
  for (const [percent, id] of bands) assert.equal(qualityOf(percent).id, id, String(percent));
});

test('the craft roll: a d20 plus the modifier against 12, natural 20 and 1 decide alone', () => {
  const roll = (value, modifier) => {
    const random = seq(value);
    const result = craftRoll(random, modifier);
    assert.equal(random.left(), 0, 'one draw');
    return result;
  };
  assert.deepEqual(roll(0.95), { natural: 20, modifier: 0, total: 20, meets: true, text: 'Natural 20!' });
  assert.deepEqual(roll(0.95, -20), { natural: 20, modifier: -20, total: 0, meets: true, text: 'Natural 20!' });
  assert.deepEqual(roll(0, 20), { natural: 1, modifier: 20, total: 1, meets: false, text: 'Natural 1!' });
  assert.deepEqual(roll(0.5), { natural: 11, modifier: 0, total: 11, meets: false, text: '11 (+0) = 11' });
  assert.deepEqual(roll(0.55), { natural: 12, modifier: 0, total: 12, meets: true, text: '12 (+0) = 12' });
  assert.deepEqual(roll(0.65, -2), { natural: 14, modifier: -2, total: 12, meets: true, text: '14 (-2) = 12' });
  assert.equal(roll(0.6, 2).text, '13 (+2) = 15');
  const natural = craftRoll().natural;
  assert.ok(natural >= 1 && natural <= 20);
});

test('the clue names the kind closest to right, and only which way it was off', () => {
  const clue = (done, needed) => hitClue({ hit: done }, { hit: needed });
  const needed = (amount) => `${CLUE_PREFIX}you sense it needed ${amount} Hit work.`;
  const took = (amount) => `${CLUE_PREFIX}you sense it took ${amount} Hit work.`;
  for (const [d, n] of [[3, 4], [1, 2], [6, 8]]) assert.equal(clue(d, n), needed('a little more'), `${d}/${n}`);
  for (const [d, n] of [[2, 4], [5, 8]]) assert.equal(clue(d, n), needed('more'), `${d}/${n}`);
  assert.equal(clue(1, 5), needed('much more'));
  for (const [d, n] of [[5, 4], [2, 1]]) assert.equal(clue(d, n), took('a little too much'), `${d}/${n}`);
  assert.equal(clue(7, 4), took('too much'));
  assert.equal(clue(8, 4), took('far too much'));
  assert.equal(hitClue({}, { smallHit: 4 }), `${CLUE_PREFIX}you sense it needed some Small Hit work.`);
  assert.equal(hitClue({ hit: 4, etch: 2 }, { hit: 4 }), `${CLUE_PREFIX}you sense it took Etch work it didn't need.`);
  assert.equal(hitClue({ hit: 4 }, { hit: 4 }), null);
  assert.equal(hitClue({}, {}), null);
  // Closest by count; then by the share it was off; then by the kind's id.
  assert.equal(hitClue({ hit: 4, smallHit: 0, etch: 2 }, { hit: 5, smallHit: 3, etch: 2 }), needed('a little more'));
  assert.equal(hitClue({ smallHit: 1, hit: 9 }, { smallHit: 2, hit: 10 }), needed('a little more'));
  assert.equal(hitClue({ smallHit: 3, hit: 5 }, { smallHit: 4, hit: 4 }), took('a little too much'));
  assert.equal(hitClue({ sew: 1, etch: 1 }, {}), `${CLUE_PREFIX}you sense it took Etch work it didn't need.`);
  assert.equal(hitClue({ chisel: 1 }, {}), `${CLUE_PREFIX}you sense it took chisel work it didn't need.`);
  assert.equal(NO_CLUE, "Looking the piece over, you can't tell what went wrong with it.");
});

test('the main metal is the one loaded most; a tie goes to the one loaded first', () => {
  assert.equal(majorityUnit(['ironIngot', 'a1', 'a1', 'a1']), 'a1');
  assert.equal(majorityUnit(['a1', 'ironIngot', 'ironIngot', 'a1']), 'a1');
  assert.equal(majorityUnit(['ironIngot', 'a1', 'a1', 'ironIngot']), 'ironIngot');
  assert.equal(majorityUnit([]), null);
});

test('stats are the mean over every unit, a unit lacking one counting 0', () => {
  assert.equal(JSON.stringify(averageStats(['a1', 'a1', 'a1', 'ironIngot'], alloyOf)),
    JSON.stringify({ attackDamage: 3.84, bluntRating: 46.25, durability: 429.5, projectileDamage: 0.3 }));
  assert.deepEqual(averageStats(units(['ironIngot', 3], ['copperIngot', 1]), alloyOf), { attackDamage: 3.38, bluntRating: 47.5, durability: 437.5 });
  assert.deepEqual(averageStats(units(['ironIngot', 8]), alloyOf), averageStats(units(['ironIngot', 4]), alloyOf));
  assert.deepEqual(averageStats(['steelIngot', 'ironIngot'], alloyOf), { attackDamage: 3.75, bluntRating: 55, durability: 750, armour: 0.25 });
  assert.deepEqual(averageStats(['a9'], alloyOf), {});
});

test('the finished weapon is named and coloured for its main metal and survives the bag', () => {
  const iron = makeWeapon('shortSword', units(['ironIngot', 3], ['copperIngot', 1]), 92, alloyOf);
  assert.deepEqual(iron, {
    id: 'shortSword', count: 1, material: 'iron',
    forged: { metal: 'Iron', quality: 'gleaming', hits: 92,
      stats: { attackDamage: 3.38, bluntRating: 47.5, durability: 437.5 }, inputs: { copperIngot: 1, ironIngot: 3 } },
  });
  assert.equal(weaponName(iron), 'Iron Short Sword');
  assert.deepEqual(readForged(iron.forged), iron.forged);
  const alloy = makeWeapon('dagger', ['ironIngot', 'a1', 'a1', 'a1'], 40, alloyOf);
  assert.equal(Object.hasOwn(alloy, 'material'), false);
  assert.equal(alloy.forged.colour, '5E6568');
  assert.equal(alloy.forged.quality, 'rusted');
  assert.equal(JSON.stringify(alloy.forged.inputs), JSON.stringify({ a1: 3, ironIngot: 1 }));
  assert.equal(weaponName(alloy), 'Blackiron Dagger');
  assert.deepEqual(readForged(alloy.forged), alloy.forged);
  for (const [unit, metal, material] of [['steelIngot', 'Steel', 'steel'], ['bronzeIngot', 'Bronze', 'bronze'], ['copperIngot', 'Copper', 'copper']]) {
    const stack = makeWeapon('greatsword', units([unit, 8]), 100, alloyOf);
    assert.deepEqual([stack.forged.metal, stack.material, stack.forged.quality], [metal, material, 'masterwork']);
    assert.deepEqual(readForged(stack.forged), stack.forged);
  }
});
