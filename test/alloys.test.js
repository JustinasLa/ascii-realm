import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  discoveryChance, forgeAlloy, nameKey, recipeKey, scrapInputs, totalValue,
} from '../src/crafting/alloys.js';
import {
  ALLOY_NAMES, BASE_BONUS, COMBINATIONS, HIT_KINDS, INGREDIENTS, MAX_CATALYSTS, MAX_FACTOR, ODDS, PALETTE,
  STAT_NAMES, TYPE_NAMES,
} from '../src/crafting/ingredients.js';
import { ITEMS } from '../src/inventory/items.js';
import { itemArt } from '../src/ui/item-art.js';

// A scripted random source that throws when it runs out, so every test pins
// the exact number of draws.
function seq(...values) {
  let index = 0;
  const random = () => {
    if (index >= values.length) throw new Error(`random() drawn ${index + 1} times, scripted ${values.length}`);
    return values[index++];
  };
  random.left = () => values.length - index;
  return random;
}
const repeat = (value, count) => Array(count).fill(value);
const METAL = new Set(ALLOY_NAMES.metal);
const CRYSTAL = new Set(ALLOY_NAMES.crystal);

test('the six ingredients carry the forge numbers', () => {
  const table = JSON.parse(JSON.stringify(INGREDIENTS));
  assert.deepEqual(table, {
    ironIngot: {
      type: 'metal', base: true, value: 2, tier: 1, names: 'metal', xp: 2,
      stats: { attackDamage: 3.5, bluntRating: 50, durability: 500 }, hits: { hit: 4, smallHit: 1 },
    },
    steelIngot: {
      type: 'metal', base: true, value: 4, tier: 2, names: 'metal', xp: 4,
      stats: { armour: 0.5, attackDamage: 4, bluntRating: 60, durability: 1000 }, hits: { hit: 5, smallHit: 2 },
    },
    bronzeIngot: {
      type: 'metal', base: true, value: 6, tier: 2, names: 'metal', xp: 5,
      stats: { armour: 0.75, attackDamage: 4.25, bluntRating: 65, durability: 1500 }, hits: { hit: 1, smallHit: 5 },
    },
    copperIngot: {
      type: 'metal', base: false, value: 2, tier: 1, names: 'metal', xp: null,
      stats: { attackDamage: 3, bluntRating: 40, durability: 250 }, hits: { hit: 2, smallHit: 2 },
    },
    rawTin: {
      type: 'crystal', base: false, value: 8, tier: 4, names: 'crystal', xp: null,
      stats: {
        durability: 30, projectileDamage: 0.5, physicalDamage: 0.5,
        projectileDamageReduction: 0.25, physicalDamageReduction: 0.25,
      },
      hits: { hit: 6, engrave: 4 },
    },
    lapisLazuli: {
      type: 'crystal', base: false, value: 2, tier: 1, names: 'crystal', xp: null,
      stats: { magicDamage: 2 }, hits: { smallHit: 3 },
    },
  });
  for (const [id, ingredient] of Object.entries(INGREDIENTS)) {
    assert.ok(Object.hasOwn(ITEMS, id), id);
    assert.ok(Object.isFrozen(ingredient) && Object.isFrozen(ingredient.stats) && Object.isFrozen(ingredient.hits), id);
    assert.ok(Object.hasOwn(TYPE_NAMES, ingredient.type) && Object.hasOwn(ALLOY_NAMES, ingredient.names), id);
    for (const stat of Object.keys(ingredient.stats)) assert.ok(Object.hasOwn(STAT_NAMES, stat), stat);
    for (const kind of Object.keys(ingredient.hits)) assert.ok(Object.hasOwn(HIT_KINDS, kind), kind);
  }
  assert.deepEqual(Object.keys(INGREDIENTS).filter((id) => INGREDIENTS[id].base), ['ironIngot', 'steelIngot', 'bronzeIngot']);
  assert.deepEqual({ ...BASE_BONUS }, { steelIngot: 8, bronzeIngot: 12 });
  assert.deepEqual({ ...ODDS }, { base: 2, perRootValue: 4, max: 85 });
  assert.equal(MAX_FACTOR, 1.2);
  assert.equal(MAX_CATALYSTS, 4);
  assert.deepEqual(JSON.parse(JSON.stringify(COMBINATIONS)), { metal: ['metal', 'crystal'] });
  assert.deepEqual(Object.fromEntries(Object.entries(HIT_KINDS).map(([kind, { family }]) => [kind, family])), {
    hit: 'metal', smallHit: 'metal', etch: 'artisan', whittle: 'artisan', engrave: 'artisan', sew: 'artisan',
  });
});

test('the name lists and palette are complete, unique and frozen', () => {
  assert.equal(ALLOY_NAMES.metal.length, 42);
  assert.equal(ALLOY_NAMES.metal[0], 'Ferranite');
  assert.equal(ALLOY_NAMES.metal[1], 'Blackiron');
  assert.equal(ALLOY_NAMES.metal.at(-1), 'Eclipsium');
  assert.equal(ALLOY_NAMES.crystal.length, 40);
  assert.equal(ALLOY_NAMES.crystal[0], 'Soulglass');
  assert.equal(ALLOY_NAMES.crystal.at(-1), 'Starcrystal');
  assert.equal(METAL.size + CRYSTAL.size, 82, 'every name is unique');
  for (const name of [...METAL, ...CRYSTAL]) assert.match(name, /^[A-Z][a-z]+$/);
  assert.equal(PALETTE.length, 49);
  assert.equal(new Set(PALETTE).size, 49);
  for (const colour of PALETTE) assert.match(colour, /^[0-9A-F]{6}$/);
  assert.deepEqual([PALETTE[0], PALETTE.at(-1)], ['B0B3B5', 'A28E82']);
  for (const list of [ALLOY_NAMES, ALLOY_NAMES.metal, ALLOY_NAMES.crystal, PALETTE]) assert.ok(Object.isFrozen(list));
});

test('steel, bronze and alloy ingots and scrap are bag items with small art', () => {
  for (const id of ['steelIngot', 'bronzeIngot', 'alloyIngot', 'unusableScrap']) {
    const item = ITEMS[id];
    assert.equal(item.stackLimit, 64, id);
    assert.equal(item.weight, 0.75, id);
    assert.ok(item.tags.includes('resource'), id);
    const rows = itemArt(id).split('\n');
    assert.ok(rows.length <= 9 && rows.every((row) => row.length <= 11), id);
  }
  assert.equal(ITEMS.unusableScrap.name, 'Unusable Scrap');
  assert.equal(itemArt('alloyIngot').replaceAll('%', '#'), itemArt('ironIngot'), 'one bar, its own fill');
  assert.equal(itemArt('bronzeIngot').replaceAll('+', '#'), itemArt('ironIngot'));
});

test('a new mix succeeds at 2 + 4·√value % plus the base bonus, at most 85 %', () => {
  assert.equal(totalValue('ironIngot', ['rawTin']), 10);
  assert.ok(Math.abs(discoveryChance('ironIngot', ['rawTin']) - 14.6491) < 1e-4);
  assert.ok(Math.abs(discoveryChance('steelIngot', ['rawTin']) - 23.8564) < 1e-4);
  assert.ok(Math.abs(discoveryChance('bronzeIngot', ['rawTin']) - (2 + 4 * Math.sqrt(14) + 12)) < 1e-9);
  assert.equal(discoveryChance('ironIngot', ['copperIngot']), 10, 'catalysts never get a base bonus');
  assert.equal(discoveryChance('ironIngot', ['steelIngot']), 2 + 4 * Math.sqrt(6));
  const rich = { ironIngot: INGREDIENTS.ironIngot, gem: { value: 1000 } };
  assert.equal(discoveryChance('ironIngot', ['gem'], rich), 85);
});

test('a failed roll is scrap for good after one draw', () => {
  const random = seq(0.1465);
  assert.deepEqual(forgeAlloy({ base: 'ironIngot', catalysts: ['rawTin'] }, { random }), { kind: 'scrap', keep: true });
  assert.equal(random.left(), 0);
});

test('the golden iron and tin alloy fixes the order of every draw', () => {
  const random = seq(0.1464, 0.30, 0.50, 0.10, 0.90, 0.5, 0.2, 0.4, 0.3, 0.5, 0.1, 0.5, 0.0, 0, 0.5, 0.99, 0, 0.7, 0);
  assert.deepEqual(forgeAlloy({ base: 'ironIngot', catalysts: ['rawTin'] }, { random }), {
    kind: 'alloy',
    alloy: {
      name: 'Ferranite', colour: 'B0B3B5', base: 'ironIngot', catalysts: ['rawTin'], type: 'metal', tier: 1,
      stats: { attackDamage: 3.5, bluntRating: 45, durability: 406, projectileDamage: 0.4 },
      hits: { hit: 1, smallHit: 2, engrave: 3 },
      xp: 2,
    },
  });
  assert.equal(random.left(), 0);
});

test('a loss passed over at first can turn into half a gain, held to 1.2× the base', () => {
  // Tin's four extra stats all stay out; durability (−470) skips the quick
  // apply at floor(0.9·10) = 9, applies at 20 + 10 > 25, flips to +235 at
  // 60 + 10 > 65, takes 80 % of it and caps at 600.
  const random = seq(0.05, ...repeat(0.99, 4), 0.9, 0.2, 0.6, 0.5, 0.5, 0.5, 0, 0, 0, 0, 0, 0);
  const { alloy } = forgeAlloy({ base: 'ironIngot', catalysts: ['rawTin'] }, { random });
  assert.deepEqual(alloy.stats, { attackDamage: 3.5, bluntRating: 50, durability: 600 });
  assert.equal(random.left(), 0);
});

test('copper on iron only loses, with the multiplier clamped to 0–1', () => {
  // Attack −0.5 flips to +0.25 at full strength; blunt −10 takes a 0 multiplier
  // and is shaken by ±10 % as unchanged; durability −250 takes 42 %.
  const random = seq(0.05, 0, 0.99, 0.99, 0, 0, 0, 0, 0.5, 0.5, 0.75, 0, 0, 0, 0, 0);
  const { alloy } = forgeAlloy({ base: 'ironIngot', catalysts: ['copperIngot'] }, { random });
  assert.deepEqual(alloy.stats, { attackDamage: 3.75, bluntRating: 52.5, durability: 395 });
  assert.deepEqual(alloy.catalysts, ['copperIngot']);
  assert.equal(random.left(), 0);
});

test('lapis adds magic damage only when its join and merge checks pass', () => {
  const tail = [0.5, 0.5, 0.5, 0, 0, 0, 0, 0];
  const joined = seq(0.05, 0.1, 0.3, 0.5, ...tail);
  assert.deepEqual(forgeAlloy({ base: 'ironIngot', catalysts: ['lapisLazuli'] }, { random: joined }).alloy.stats,
    { attackDamage: 3.5, bluntRating: 50, durability: 500, magicDamage: 1.36 });
  assert.equal(joined.left(), 0);
  const skipped = seq(0.05, 0.1, 0.2, ...tail);
  assert.deepEqual(forgeAlloy({ base: 'ironIngot', catalysts: ['lapisLazuli'] }, { random: skipped }).alloy.stats,
    { attackDamage: 3.5, bluntRating: 50, durability: 500 });
  assert.equal(skipped.left(), 0);
  const left = seq(0.05, 0.26, ...tail);
  assert.equal(forgeAlloy({ base: 'ironIngot', catalysts: ['lapisLazuli'] }, { random: left }).alloy.stats.magicDamage,
    undefined, 'joins below 26 % only');
  assert.equal(left.left(), 0);
});

test('steel on iron gains up to the caps, and the XP lies between theirs', () => {
  for (const [draw, xp] of [[0, 2], [1, 4], [0.5, 3]]) {
    // Armour stays out; every gain applies in full; durability caps at 600.
    const random = seq(0.05, 0.99, ...repeat(0.99, 6), 0, 0, 0, draw, 0);
    const { alloy } = forgeAlloy({ base: 'ironIngot', catalysts: ['steelIngot'] }, { random });
    assert.deepEqual(alloy.stats, { attackDamage: 4, bluntRating: 60, durability: 600 });
    assert.deepEqual(alloy.hits, { hit: 1, smallHit: 1 }, 'only the first input naming a kind draws');
    assert.equal(alloy.xp, xp);
    assert.equal(random.left(), 0);
  }
});

test('the XP is empty, and not drawn, without a base XP', () => {
  const random = seq(0.01, ...repeat(0.99, 8), 0, 0, 0, 0, 0, 0, 0);
  const { alloy } = forgeAlloy({ base: 'copperIngot', catalysts: ['rawTin'] }, { random });
  assert.equal(alloy.xp, null);
  assert.equal(random.left(), 0, 'no XP draw');
});

test('a taken name is drawn again, each retry removing the name it picked', () => {
  // The roll, lapis staying out, the base stats shaken by ±0 % and two hits.
  const random = seq(0.05, 0.5, 0.5, 0.5, 0.5, 0, 0, 0, 0, 0, 0, 0);
  const taken = (name) => name === 'Ferranite';
  const { alloy } = forgeAlloy({ base: 'ironIngot', catalysts: ['lapisLazuli'] }, { random, taken });
  assert.equal(alloy.name, 'Blackiron');
  assert.equal(random.left(), 0);
});

test('with every metal name taken the catalysts\' lists name it, duplicates kept', () => {
  const metalTaken = (name) => METAL.has(name);
  const fallback = seq(0.05, 0.5, 0.5, 0.5, 0.5, 0, 0, ...repeat(0, 1 + 42 + 1), 0, 0);
  const named = forgeAlloy({ base: 'ironIngot', catalysts: ['lapisLazuli'] }, { random: fallback, taken: metalTaken });
  assert.equal(named.alloy.name, 'Soulglass');
  assert.equal(fallback.left(), 0);

  // Tin and lapis both bring the crystal list: 80 backups, all taken.
  const everyName = (name) => METAL.has(name) || CRYSTAL.has(name);
  const full = seq(0.01, ...repeat(0.99, 5), ...repeat(0.5, 5), 0, 0, 0, ...repeat(0, 1 + 42 + 80));
  assert.deepEqual(forgeAlloy({ base: 'ironIngot', catalysts: ['rawTin', 'lapisLazuli'] }, { random: full, taken: everyName }),
    { kind: 'scrap', keep: false });
  assert.equal(full.left(), 0, 'no XP or colour draw after the names run out');
});

test('the colour is rounded over the palette, so the last one can come up', () => {
  const random = seq(0.05, 0.5, 0.5, 0.5, 0.5, 0, 0, 0, 0, 0.995);
  const { alloy } = forgeAlloy({ base: 'ironIngot', catalysts: ['lapisLazuli'] }, { random });
  assert.equal(alloy.colour, 'A28E82');
  assert.equal(random.left(), 0);
});

test('the default source forges something without arguments', () => {
  const { kind } = forgeAlloy({ base: 'bronzeIngot', catalysts: ['rawTin', 'lapisLazuli'] });
  assert.ok(kind === 'alloy' || kind === 'scrap');
});

test('recipe keys and scrap inputs list the catalysts in id order', () => {
  const catalysts = ['rawTin', 'lapisLazuli', 'copperIngot'];
  assert.equal(recipeKey('ironIngot', catalysts), 'ironIngot|copperIngot,lapisLazuli,rawTin');
  assert.equal(recipeKey('ironIngot', ['copperIngot', 'rawTin', 'lapisLazuli']), recipeKey('ironIngot', catalysts));
  assert.deepEqual(catalysts, ['rawTin', 'lapisLazuli', 'copperIngot'], 'loading order is untouched');
  const inputs = scrapInputs('steelIngot', catalysts);
  assert.deepEqual(Object.entries(inputs), [['copperIngot', 1], ['lapisLazuli', 1], ['rawTin', 1], ['steelIngot', 1]]);
  assert.deepEqual(scrapInputs('ironIngot', ['ironIngot']), { ironIngot: 2 });
  assert.equal(nameKey('Dark Steel'), 'dark_steel');
});
