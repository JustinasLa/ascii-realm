import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AlloyBook } from '../src/crafting/alloy-book.js';
import {
  cancelSmithy, chooseRecipe, describeWeapon, finishSmithy, hitSmithy, loadSmithy, MAX_HITS, NO_CLUE, Smithy,
  smithyScreenModel, takeSmithy,
} from '../src/crafting/smithing.js';
import { Inventory } from '../src/inventory/inventory.js';

// A scripted random source that fails the test if it runs dry.
function seq(...values) {
  const random = () => {
    assert.ok(values.length, 'no draw left');
    return values.shift();
  };
  random.left = () => values.length;
  return random;
}
// A book that knows Blackiron (a1) and a crystal alloy (a2, for the type check).
function makeBook() {
  const book = new AlloyBook({ storage: null, seed: 1 });
  book.alloys.set('a1', {
    id: 'a1', name: 'Blackiron', colour: '5E6568', base: 'ironIngot', catalysts: ['rawTin'], type: 'metal', tier: 1,
    stats: { attackDamage: 4.2, bluntRating: 45, durability: 430.4, projectileDamage: 0.4 },
    hits: { hit: 1, smallHit: 2, engrave: 3 }, xp: 2,
  });
  book.alloys.set('a2', { ...book.get('a1'), id: 'a2', name: 'Glass', type: 'crystal' });
  return book;
}
function bag(...stacks) {
  const inventory = new Inventory({ starter: false, capacity: 1e6 });
  stacks.forEach((stack, index) => { inventory.slots[index] = stack; });
  return inventory;
}
// A bag with every slot taken by something the station can't use.
const fullBag = (...stacks) => bag(...stacks, ...Array(24 - stacks.length).fill(null).map(() => ({ id: 'bandage', count: 1 })));
const bench = (recipe, units = [], done = {}) => Object.assign(new Smithy(), { recipe, units: [...units], done: { ...done } });
const iron4 = ['ironIngot', 'ironIngot', 'ironIngot', 'ironIngot'];
const snapshot = (smithy, inventory) => JSON.stringify([smithy.toJSON(), inventory.slots]);
// Every key anywhere in a value, for the "no needed count" check.
const keysOf = (value) => (value && typeof value === 'object'
  ? Object.entries(value).flatMap(([key, child]) => [key, ...keysOf(child)]) : []);

test('a recipe is chosen once, and never while a weapon waits', () => {
  const smithy = new Smithy();
  assert.equal(smithy.idle, true);
  assert.equal(chooseRecipe(smithy, 'spoon').status, 'invalid');
  assert.deepEqual(chooseRecipe(smithy, 'shortSword'), {
    ok: true, status: 'selected', message: 'Recipe Short Sword selected!', recipe: 'shortSword',
  });
  assert.deepEqual([smithy.idle, smithy.need, smithy.status()], [false, 4, 'Metal 0/4']);
  assert.deepEqual(chooseRecipe(smithy, 'dagger'), {
    ok: false, status: 'chosen', message: 'Station already has a recipe selected.',
  });
  const waiting = Object.assign(new Smithy(), { output: { id: 'dagger', count: 1, forged: { metal: 'Iron' } } });
  assert.deepEqual(chooseRecipe(waiting, 'dagger'), { ok: false, status: 'waiting', message: 'Take the Iron Dagger first.' });
  assert.equal(waiting.recipe, null);
});

test('loading refuses in order and changes nothing, or moves exactly one unit', () => {
  const book = makeBook();
  const inventory = bag(
    { id: 'ironIngot', count: 3 }, { id: 'coal', count: 2 }, { id: 'unusableScrap', count: 1, inputs: { ironIngot: 1 } },
    { id: 'shortSword', count: 1, material: 'iron', forged: { metal: 'Iron', quality: 'rusted', hits: 0, stats: { attackDamage: 3.5 }, inputs: { ironIngot: 4 } } },
    { id: 'alloyIngot', count: 1, alloy: 'a9' }, { id: 'rawTin', count: 1 }, { id: 'lapisLazuli', count: 1 },
    { id: 'alloyIngot', count: 2, alloy: 'a1' }, { id: 'alloyIngot', count: 1, alloy: 'a2' }, { id: 'copperIngot', count: 1 },
  );
  const smithy = new Smithy();
  const refused = (index, code, message) => {
    const before = snapshot(smithy, inventory);
    const done = loadSmithy(smithy, inventory, index, book);
    assert.deepEqual([done.ok, done.status, done.code, done.message], [false, 'refused', code, message], `slot ${index}`);
    assert.equal(snapshot(smithy, inventory), before);
  };
  refused(0, 'recipe', 'No recipe on this station. Select a recipe first.');
  chooseRecipe(smithy, 'shortSword');
  for (const index of [1, 2, 3, 4]) refused(index, 'material', 'That is not a material you can work.');
  for (const index of [5, 6, 8]) refused(index, 'type', 'This recipe does not call for that material.');
  assert.equal(loadSmithy(smithy, inventory, 23, book).status, 'invalid');

  assert.deepEqual(loadSmithy(smithy, inventory, 0, book), {
    ok: true, status: 'loaded', message: 'Added Iron Ingot. Metal 1/4', id: 'ironIngot', unit: 'ironIngot',
  });
  assert.deepEqual(inventory.slots[0], { id: 'ironIngot', count: 2 });
  assert.equal(loadSmithy(smithy, inventory, 7, book).message, 'Added Blackiron. Metal 2/4');
  assert.deepEqual(inventory.slots[7], { id: 'alloyIngot', count: 1, alloy: 'a1' });
  loadSmithy(smithy, inventory, 7, book);
  loadSmithy(smithy, inventory, 9, book);
  assert.deepEqual(smithy.units, ['ironIngot', 'a1', 'a1', 'copperIngot']);
  assert.equal(inventory.slots[7], null);
  refused(0, 'full', 'The piece already has enough of that material.');
});

test('a bag that hands back the wrong thing is restored', () => {
  const book = makeBook();
  const inventory = bag({ id: 'ironIngot', count: 3 });
  inventory.remove = () => ({ id: 'ironIngot', count: 2 });
  const smithy = bench('shortSword');
  assert.deepEqual(loadSmithy(smithy, inventory, 0, book), {
    ok: false, status: 'invalid', message: 'That could not be moved.', id: 'ironIngot',
  });
  assert.deepEqual([smithy.units, inventory.slots[0]], [[], { id: 'ironIngot', count: 3 }]);
});

test('hits wait for all the metal, only work a needed family and never show what is needed', () => {
  const book = makeBook();
  const smithy = new Smithy();
  assert.equal(hitSmithy(smithy, 'hit', book).status, 'recipe');
  smithy.recipe = 'shortSword';
  smithy.units = ['ironIngot', 'ironIngot'];
  assert.deepEqual(hitSmithy(smithy, 'hit', book), {
    ok: false, status: 'missing',
    message: 'You only have 2 out of 4 Metal items. You have to add all the items before smithing.',
  });
  smithy.units = iron4;
  assert.equal(hitSmithy(smithy, 'chisel', book).message, 'You cannot work the piece with that tool.');
  for (const kind of ['etch', 'whittle', 'engrave', 'sew']) {
    assert.deepEqual(hitSmithy(smithy, kind, book), { ok: false, status: 'tool', message: 'This tool is not needed for this craft.' });
  }
  assert.deepEqual(hitSmithy(smithy, 'smallHit', book), { ok: true, status: 'hit', message: '+1 Small Hit', kind: 'smallHit', done: 1 });
  for (let i = 0; i < 30; i++) assert.equal(hitSmithy(smithy, 'hit', book).message, '+1 Hit', 'past what is needed too');
  assert.deepEqual(smithy.done, { smallHit: 1, hit: 30 });
  smithy.done.hit = MAX_HITS;
  assert.deepEqual(hitSmithy(smithy, 'hit', book), { ok: false, status: 'limit', message: "That piece can't take more work." });

  const engraved = bench('shortSword', ['a1', 'ironIngot', 'ironIngot', 'ironIngot']);
  for (const kind of ['etch', 'whittle', 'engrave', 'sew']) assert.equal(hitSmithy(engraved, kind, book).ok, true, kind);
});

test('finishing with exact work makes a Masterwork without a roll', () => {
  const book = makeBook();
  const inventory = bag();
  const smithy = bench('shortSword', iron4, { hit: 16, smallHit: 4 });
  const random = seq();
  const done = finishSmithy(smithy, inventory, book, random);
  assert.deepEqual([done.ok, done.status, done.percent, done.quality, done.roll, done.clue, done.waiting],
    [true, 'finished', 100, 'masterwork', null, null, false]);
  assert.equal(done.message, 'Hit Percentage: 100%\nQuality: Masterwork\nYou made an Iron Short Sword.');
  assert.equal(done.name, 'Iron Short Sword');
  assert.deepEqual(inventory.slots[0], {
    id: 'shortSword', count: 1, material: 'iron',
    forged: { metal: 'Iron', quality: 'masterwork', hits: 100, stats: { attackDamage: 3.5, bluntRating: 50, durability: 500 }, inputs: { ironIngot: 4 } },
  });
  assert.deepEqual(smithy.toJSON(), { recipe: null, units: [], done: {}, output: null });
  assert.equal(smithy.idle, true);
});

test('a near miss rolls for its clue, a failed roll gives none, and no hits at all is Rusted', () => {
  const book = makeBook();
  const near = finishSmithy(bench('shortSword', ['a1', 'a1', 'a1', 'ironIngot'], { hit: 7, smallHit: 6, engrave: 9 }), bag(), book, seq(0.6));
  assert.deepEqual([near.percent, near.quality, near.roll.text], [95, 'gleaming', '13 (+0) = 13']);
  assert.deepEqual(near.lines, [
    'Hit Percentage: 95%', 'Quality: Gleaming', 'Craft roll: 13 (+0) = 13',
    'Looking the piece over, you sense it needed a little more Small Hit work.', 'You made a Blackiron Short Sword.',
  ]);
  const failed = finishSmithy(bench('dagger', iron4, { hit: 16, smallHit: 3 }), bag(), book, seq(0.5));
  assert.deepEqual([failed.percent, failed.roll.text, failed.clue], [88, '11 (+0) = 11', NO_CLUE]);
  const random = seq(0.95);
  const rusted = finishSmithy(bench('greatsword', [...iron4, ...iron4]), bag(), book, random);
  assert.deepEqual([rusted.percent, rusted.quality, rusted.roll.text, random.left()], [0, 'rusted', 'Natural 20!', 0]);
  assert.equal(rusted.clue, 'Looking the piece over, you sense it needed some Small Hit work.');
});

test('finishing is refused before the metal is in, and changes nothing', () => {
  const book = makeBook();
  const smithy = bench('shortSword', ['ironIngot']);
  const inventory = bag();
  assert.equal(finishSmithy(new Smithy(), inventory, book, seq()).status, 'recipe');
  assert.deepEqual(finishSmithy(smithy, inventory, book, seq()), {
    ok: false, status: 'missing',
    message: 'You only have 1 out of 4 Metal items. You have to add all the items before smithing.',
  });
  assert.deepEqual(smithy.units, ['ironIngot']);
});

test('a full bag leaves the weapon on the station for Take, which blocks new work', () => {
  const book = makeBook();
  const inventory = fullBag();
  const smithy = bench('shortSword', ['a1', 'a1', 'a1', 'ironIngot'], { hit: 6, smallHit: 7, engrave: 9 });
  const done = finishSmithy(smithy, inventory, book, seq(0.1));
  assert.deepEqual([done.waiting, done.lines.at(-1)],
    [true, 'You made a Blackiron Short Sword. Your bag is full: it waits on the station.']);
  assert.equal(smithy.output.forged.colour, '5E6568');
  assert.equal(smithy.idle, false);
  assert.equal(chooseRecipe(smithy, 'dagger').message, 'Take the Blackiron Short Sword first.');
  assert.equal(loadSmithy(smithy, bag({ id: 'ironIngot', count: 1 }), 0, book).code, 'waiting');
  assert.equal(hitSmithy(smithy, 'hit', book).status, 'waiting');
  assert.equal(finishSmithy(smithy, inventory, book).status, 'waiting');
  assert.equal(cancelSmithy(smithy, inventory, book).status, 'empty', 'Cancel never touches the weapon');
  assert.deepEqual(takeSmithy(smithy, inventory), { ok: false, status: 'full', message: 'Your bag is full.', id: 'shortSword' });
  inventory.slots[3] = null;
  assert.deepEqual(takeSmithy(smithy, inventory), { ok: true, status: 'took', message: 'Took Blackiron Short Sword.', id: 'shortSword' });
  assert.equal(inventory.slots[3].forged.metal, 'Blackiron');
  assert.deepEqual([smithy.output, smithy.idle], [null, true]);
  assert.deepEqual(takeSmithy(smithy, inventory), { ok: false, status: 'empty', message: 'Nothing to take.' });
});

test('cancel gives the metal back last loaded first and loses the hits', () => {
  const book = makeBook();
  const inventory = bag();
  const smithy = bench('shortSword', ['ironIngot', 'a1', 'a1', 'ironIngot'], { hit: 3 });
  assert.deepEqual(cancelSmithy(smithy, inventory, book), {
    ok: true, status: 'cancelled', message: 'Project cancelled. Took back Iron Ingot x2 and Blackiron x2.',
    units: ['ironIngot', 'a1', 'a1', 'ironIngot'],
  });
  assert.deepEqual(inventory.slots.slice(0, 2), [{ id: 'ironIngot', count: 2 }, { id: 'alloyIngot', count: 2, alloy: 'a1' }]);
  assert.deepEqual(smithy.toJSON(), { recipe: null, units: [], done: {}, output: null });
  assert.equal(cancelSmithy(smithy, inventory, book).message, 'There is no project to cancel.');
  const bare = bench('dagger');
  assert.equal(cancelSmithy(bare, inventory, book).message, 'Project cancelled.');
  assert.equal(bare.idle, true);
});

test('cancel with a full bag gives back what fits and keeps the rest with the recipe', () => {
  const book = makeBook();
  const inventory = fullBag({ id: 'ironIngot', count: 63 });
  const smithy = bench('shortSword', ['a1', 'ironIngot', 'ironIngot', 'ironIngot'], { hit: 5 });
  assert.deepEqual(cancelSmithy(smithy, inventory, book), {
    ok: true, status: 'cancelled', message: 'Took back Iron Ingot. Your bag has no room for the rest.', units: ['ironIngot'],
  });
  assert.deepEqual([smithy.recipe, smithy.units, smithy.done], ['shortSword', ['a1', 'ironIngot', 'ironIngot'], {}]);
  const before = snapshot(smithy, inventory);
  assert.deepEqual(cancelSmithy(smithy, inventory, book), { ok: false, status: 'full', message: 'Your bag is full.' });
  assert.equal(snapshot(smithy, inventory), before);
});

test('the screen model lists recipes when idle and the piece while it is worked, never a needed count', () => {
  const book = makeBook();
  const inventory = bag(
    { id: 'ironIngot', count: 3 }, { id: 'bandage', count: 1 }, { id: 'alloyIngot', count: 2, alloy: 'a1' },
    { id: 'rawTin', count: 1 }, { id: 'unusableScrap', count: 1, inputs: { ironIngot: 1, rawTin: 1 } },
    { id: 'alloyIngot', count: 1, alloy: 'a9' },
  );
  const smithy = new Smithy();
  const idle = smithyScreenModel(smithy, inventory, book);
  assert.deepEqual(idle.recipes.map((r) => [r.id, r.label]), [
    ['shortSword', 'Metal x4'], ['dagger', 'Metal x4'], ['battleAxe', 'Metal x4'],
    ['warHammer', 'Metal x4'], ['spear', 'Metal x4'], ['greatsword', 'Metal x8'],
  ]);
  assert.deepEqual([idle.recipe, idle.slots, idle.status, idle.canFinish, idle.finishReason, idle.canCancel, idle.output],
    [null, [], 'Metal 0/0', false, 'Choose a piece first', false, null]);
  assert.ok(idle.hits.every((row) => !row.allowed && row.reason === 'Choose a piece first'));
  assert.deepEqual(idle.bag.map((row) => [row.index, row.name, row.colour, row.target, row.reason]), [
    [0, 'Iron Ingot', null, null, 'Choose a piece first'], [2, 'Blackiron', '#5E6568', null, 'Choose a piece first'],
    [3, 'Raw Tin', null, null, 'Choose a piece first'], [4, 'Unusable Scrap', null, null, 'Choose a piece first'],
    [5, 'Unknown alloy', null, null, 'Choose a piece first'],
  ]);

  chooseRecipe(smithy, 'shortSword');
  loadSmithy(smithy, inventory, 2, book);
  const loading = smithyScreenModel(smithy, inventory, book);
  assert.equal(loading.recipes, null);
  assert.deepEqual(loading.recipe, { id: 'shortSword', name: 'Short Sword' });
  assert.deepEqual(loading.slots, [{ unit: 'a1', name: 'Blackiron', colour: '#5E6568' }, null, null, null]);
  assert.deepEqual([loading.ready, loading.canFinish, loading.finishReason, loading.canCancel], [false, false, 'Add all the metal first', true]);
  assert.ok(loading.hits.every((row) => row.reason === 'Add all the metal first'));
  assert.deepEqual(loading.bag.map((row) => [row.name, row.count, row.target, row.reason]), [
    ['Iron Ingot', 3, 'metal', null], ['Blackiron', 1, 'metal', null], ['Raw Tin', 1, null, 'Not for this piece'],
    ['Unusable Scrap', 1, null, "Can't be worked"], ['Unknown alloy', 1, null, "Can't be worked"],
  ]);

  for (let i = 0; i < 3; i++) loadSmithy(smithy, inventory, 0, book);
  hitSmithy(smithy, 'hit', book);
  hitSmithy(smithy, 'hit', book);
  hitSmithy(smithy, 'engrave', book);
  const working = smithyScreenModel(smithy, inventory, book);
  assert.deepEqual(working.hits, [
    { kind: 'hit', key: 1, name: 'Hit', done: 2, allowed: true, reason: null },
    { kind: 'smallHit', key: 2, name: 'Small Hit', done: 0, allowed: true, reason: null },
    { kind: 'etch', key: 3, name: 'Etch', done: 0, allowed: true, reason: null },
    { kind: 'whittle', key: 4, name: 'Whittle', done: 0, allowed: true, reason: null },
    { kind: 'engrave', key: 5, name: 'Engrave', done: 1, allowed: true, reason: null },
    { kind: 'sew', key: 6, name: 'Sew', done: 0, allowed: true, reason: null },
  ]);
  assert.deepEqual([working.total, working.ready, working.canFinish, working.status], [3, true, true, 'Metal 4/4']);
  assert.ok(working.bag.every((row) => row.reason !== 'Choose a piece first'));
  assert.equal(working.bag.find((row) => row.name === 'Blackiron').reason, 'Piece has enough');
  assert.ok(!keysOf([idle, loading, working]).some((key) => /need/i.test(key)), 'no needed field anywhere');
  assert.ok(!JSON.stringify(working).includes(':13'), 'the 13 Hits needed appear nowhere');

  const ironOnly = smithyScreenModel(bench('dagger', iron4), inventory, book);
  assert.deepEqual(ironOnly.hits.map((row) => row.reason),
    [null, null, 'Not needed for this piece', 'Not needed for this piece', 'Not needed for this piece', 'Not needed for this piece']);

  finishSmithy(smithy, fullBag(), book, seq(0.1));
  const waiting = smithyScreenModel(smithy, inventory, book);
  assert.deepEqual([waiting.recipes, waiting.output, waiting.canCancel, waiting.finishReason],
    [null, { name: 'Iron Short Sword', colour: null }, false, 'Take the weapon first']);
  const alloy = Object.assign(new Smithy(), { output: { id: 'dagger', count: 1, forged: { metal: 'Blackiron', colour: '5E6568' } } });
  assert.deepEqual(smithyScreenModel(alloy, bag(), book).output, { name: 'Blackiron Dagger', colour: '#5E6568' });
});

test('item details show the metal, quality, hits, socket, damage, stats and durability', () => {
  const book = makeBook();
  const forged = (units, done) => {
    const inventory = bag();
    finishSmithy(bench('shortSword', units, done), inventory, book, seq(0.1));
    return inventory.slots[0];
  };
  const alloy = forged(['a1', 'a1', 'a1', 'ironIngot'], { hit: 7, smallHit: 6, engrave: 9 });
  assert.deepEqual(describeWeapon(alloy, book), {
    name: 'Blackiron Short Sword',
    colour: '#5E6568',
    description: 'A Blackiron Short Sword smithed from 3 Blackiron and 1 Iron Ingot.',
    stats: {
      Material: 'Blackiron', Quality: 'Gleaming', Hits: '95%', Socket: 'Radiant (empty)', Damage: '24.18',
      'Attack Damage': '4.03', 'Blunt Rating': '46.25', Durability: '447.8', 'Projectile Damage': '0.3',
    },
    durability: 448,
  });
  const iron = forged(iron4, {});
  assert.deepEqual(describeWeapon(iron, book).stats, {
    Material: 'Iron', Quality: 'Rusted', Hits: '0%', Socket: 'none', Damage: '21',
    'Attack Damage': '3.5', 'Blunt Rating': '50', Durability: '500',
  });
  const sockets = [[{ hit: 4, smallHit: 4 }, 'Tempered', 'Basic (empty)'], [{ hit: 12, smallHit: 4 }, 'Polished', 'Polished (empty)'],
    [{ hit: 16, smallHit: 4 }, 'Masterwork', 'Mythical (empty)']];
  for (const [done, quality, socket] of sockets) {
    const { stats } = describeWeapon(forged(iron4, done), book);
    assert.deepEqual([stats.Quality, stats.Socket], [quality, socket]);
  }
  const lost = { ...iron, forged: { ...iron.forged, inputs: { a7: 1, ironIngot: 3 }, stats: { attackDamage: 3.5 } } };
  assert.deepEqual([describeWeapon(lost, book).description, describeWeapon(lost, book).durability],
    ['An Iron Short Sword smithed from 1 Unknown alloy and 3 Iron Ingot.', null]);
  assert.equal(describeWeapon({ id: 'shortSword', count: 1, material: 'iron' }, book), null);
  assert.equal(describeWeapon({ id: 'ironIngot', count: 1, forged: iron.forged }, book), null);
  assert.equal(describeWeapon(null, book), null);
});

test('a saved station loads only when it keeps the station rules', () => {
  const book = makeBook();
  const output = { id: 'shortSword', count: 1, material: 'iron', forged: { metal: 'Iron', quality: 'rusted', hits: 0, stats: { attackDamage: 3.5 }, inputs: { ironIngot: 4 } } };
  const good = [
    { recipe: null, units: [], done: {}, output: null },
    { recipe: 'shortSword', units: ['a1', 'ironIngot'], done: {}, output: null },
    { recipe: 'shortSword', units: ['a1', ...iron4.slice(1)], done: { hit: 5, engrave: MAX_HITS }, output: null },
    { recipe: null, units: [], done: {}, output },
  ];
  for (const data of good) assert.deepEqual(Smithy.from(data, book).toJSON(), data);
  const bad = [
    null, 7, { recipe: 'spoon', units: [], done: {}, output: null },
    { recipe: null, units: ['ironIngot'], done: {}, output: null },
    { recipe: 'shortSword', units: 'ironIngot', done: {}, output: null },
    { recipe: 'shortSword', units: [...iron4, 'ironIngot'], done: {}, output: null },
    { recipe: 'shortSword', units: ['rawTin'], done: {}, output: null },
    { recipe: 'shortSword', units: ['a9'], done: {}, output: null },
    { recipe: 'shortSword', units: [7], done: {}, output: null },
    { recipe: 'shortSword', units: ['ironIngot'], done: { hit: 1 }, output: null },
    { recipe: 'shortSword', units: iron4, done: { etch: 1 }, output: null },
    { recipe: 'shortSword', units: iron4, done: { chisel: 1 }, output: null },
    { recipe: 'shortSword', units: iron4, done: { hit: 0 }, output: null },
    { recipe: 'shortSword', units: iron4, done: { hit: 1000 }, output: null },
    { recipe: 'shortSword', units: iron4, done: { hit: 1.5 }, output: null },
    { recipe: 'shortSword', units: iron4, done: [], output: null },
    { recipe: 'shortSword', units: iron4, done: null, output: null },
    { recipe: 'shortSword', units: [], done: {}, output },
    { recipe: null, units: [], done: {}, output: { ...output, count: 2 } },
    { recipe: null, units: [], done: {}, output: { ...output, id: 'ironIngot' } },
    { recipe: null, units: [], done: {}, output: { ...output, forged: { metal: 'Iron' } } },
    { recipe: null, units: [], done: {}, output: { ...output, material: 'gold' } },
    { recipe: null, units: [], done: {}, output: { id: 'shortSword', count: 1 } },
    { recipe: null, units: [], done: {}, output: 'shortSword' },
  ];
  for (const data of bad) assert.equal(Smithy.from(data, book), null, JSON.stringify(data));
});
