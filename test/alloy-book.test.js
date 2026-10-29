import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALLOY_KEY, AlloyBook, describeStack } from '../src/crafting/alloy-book.js';
import { AlloyForge, fireForge, loadForge } from '../src/crafting/alloys.js';
import { chooseRecipe, finishSmithy, hitSmithy, loadSmithy } from '../src/crafting/smithing.js';
import { Inventory } from '../src/inventory/inventory.js';

function memory(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    writes: 0,
    getItem: (key) => data.get(key) ?? null,
    setItem(key, value) { this.writes++; data.set(key, value); },
  };
}
function bag(...stacks) {
  const inventory = new Inventory({ starter: false, capacity: 1e6 });
  stacks.forEach((stack, index) => { inventory.slots[index] = stack; });
  return inventory;
}
const zeros = () => 0;
const mix = (base, ...catalysts) => Object.assign(new AlloyForge(), { base, catalysts });
const PROP = 'r:spawn:12';
const KEY = `${ALLOY_KEY}-7`;
// Forges `mix` as a new alloy with every draw at 0.
const discover = (book, ...ids) => fireForge(mix(...ids), bag({ id: 'coal', count: 1 }), book, PROP, zeros).alloy;
const IRON_TIN = {
  id: 'a1', name: 'Blackiron', colour: '5E6568', base: 'ironIngot', catalysts: ['rawTin'], type: 'metal', tier: 1,
  stats: { attackDamage: 3.5, bluntRating: 45, durability: 406, projectileDamage: 0.4 },
  hits: { hit: 1, smallHit: 2, engrave: 3 }, xp: 2,
};
const IRON_LAPIS = { ...IRON_TIN, id: 'a2', name: 'Moon Iron', catalysts: ['lapisLazuli'], stats: { magicDamage: 1.2 } };
// A forging plan for `alloy`, which the book gives its own id.
const plan = ({ id, ...alloy }) => ({ kind: 'alloy', alloy });
const save = (fields = {}) => JSON.stringify({ v: 1, next: 3, alloys: [IRON_TIN, IRON_LAPIS], scrap: [], forges: {}, ...fields });
const loaded = (text) => new AlloyBook({ storage: memory({ [KEY]: text }), seed: 7 });

test('the book records new alloys with rising ids and keeps scrap only for a failed roll', () => {
  const book = new AlloyBook({ storage: null, seed: 1 });
  const alloy = book.record('ironIngot|rawTin', plan(IRON_TIN));
  assert.equal(alloy.id, 'a1');
  assert.equal(book.get('a1'), alloy);
  assert.equal(book.result('ironIngot|rawTin'), alloy);
  assert.deepEqual([book.next, book.version], [2, 1]);
  assert.deepEqual(book.naming, { id: 'a1', until: 60 });
  assert.equal(book.record('ironIngot|lapisLazuli', { kind: 'scrap', keep: false }), null);
  assert.equal(book.result('ironIngot|lapisLazuli'), null);
  assert.equal(book.record('ironIngot|lapisLazuli', { kind: 'scrap', keep: true }), null);
  assert.equal(book.result('ironIngot|lapisLazuli'), 'scrap');
  assert.equal(book.get('a9'), null);
  assert.equal(book.taken('BLACKIRON'), true);
  assert.equal(book.taken('Blackiron', 'a1'), false);
  assert.equal(book.taken('Ferranite'), false);
});

test('a new alloy can be renamed in letters and underscores, shown as spaces', () => {
  const storage = memory();
  const book = new AlloyBook({ storage, seed: 7 });
  discover(book, 'ironIngot', 'rawTin');
  const ingots = bag({ id: 'alloyIngot', count: 2, alloy: 'a1' });
  assert.equal(describeStack(ingots.slots[0], book).name, 'Ferranite');
  const refused = (text) => { const done = book.rename(text); return [done.status, done.message]; };
  for (const text of ['Moon-Iron', 'Moon Iron', 'Iron2', '', '___', 42]) {
    assert.deepEqual(refused(text), ['invalid', 'Name can only contain letters (A–Z) and underscores (_).'], text);
  }
  assert.deepEqual(refused('A'.repeat(25)), ['long', 'That name is too long.']);
  assert.equal(book.version, 1);
  assert.equal(storage.writes, 0, 'refusals write nothing');
  assert.deepEqual(book.rename('__Moon__Iron_'), { ok: true, status: 'named', message: 'Named the new alloy Moon Iron.', name: 'Moon Iron' });
  assert.equal(book.get('a1').name, 'Moon Iron');
  assert.deepEqual([book.naming, book.version, storage.writes], [null, 2, 1]);
  assert.equal(JSON.parse(storage.data.get(KEY)).alloys[0].name, 'Moon Iron');
  assert.deepEqual(ingots.slots[0], { id: 'alloyIngot', count: 2, alloy: 'a1' }, 'stacks keep their id');
  assert.equal(describeStack(ingots.slots[0], book).name, 'Moon Iron');
  assert.deepEqual(refused('Other'), ['none', 'You have no alloy to name.']);
  assert.deepEqual(book.keepName(), { ok: false, status: 'none', message: 'You have no alloy to name.' });
});

test('a name must be free in any case, though an alloy may keep its own', () => {
  const book = new AlloyBook({ storage: null, seed: 1 });
  discover(book, 'ironIngot', 'rawTin');
  discover(book, 'ironIngot', 'lapisLazuli');
  assert.equal(book.naming.id, 'a2');
  assert.deepEqual(book.rename('FERRANITE'), { ok: false, status: 'taken', message: 'An alloy with that name already exists.' });
  assert.equal(book.rename('BLACKIRON').name, 'BLACKIRON');
  assert.equal(book.alloys.get('a2').name, 'BLACKIRON');
});

test('the naming window runs out after a minute of game time', () => {
  const book = new AlloyBook({ storage: null, seed: 1 });
  discover(book, 'ironIngot', 'rawTin');
  assert.equal(book.update(60), null);
  book.time += 0.01;
  assert.deepEqual(book.rename('Late'), { ok: false, status: 'timeout', message: 'Naming timed out.' });
  assert.equal(book.naming, null);

  discover(book, 'ironIngot', 'lapisLazuli');
  assert.equal(book.update(Number.NaN), null);
  assert.equal(book.update(-5), null);
  assert.deepEqual(book.update(60.01), { ok: false, status: 'timeout', message: 'Naming timed out.' });
  assert.equal(book.update(1), null);
  assert.equal(book.keepName().status, 'none');
  assert.equal(book.get('a2').name, 'Blackiron');

  discover(book, 'ironIngot', 'copperIngot');
  assert.deepEqual(book.keepName(), { ok: true, status: 'kept', message: 'Kept the name Bloodsteel.', name: 'Bloodsteel' });
  assert.equal(book.naming, null);
  discover(book, 'steelIngot', 'rawTin');
  book.time += 61;
  assert.equal(book.keepName().status, 'timeout');
});

test('the book, the scrap and each forge\'s contents survive a reload; the window and glows do not', () => {
  const storage = memory();
  const book = new AlloyBook({ storage, seed: 7 });
  assert.equal(book.key, 'ascii-realm-alloys-7');
  const alloy = discover(book, 'ironIngot', 'rawTin');
  fireForge(mix('ironIngot', 'lapisLazuli'), bag({ id: 'coal', count: 1 }), book, PROP, () => 0.99);
  const inventory = bag({ id: 'steelIngot', count: 1 }, { id: 'rawTin', count: 1 });
  assert.equal(book.saved(PROP, (forge) => loadForge(forge, inventory, 0)).ok, true);
  assert.equal(book.saved(PROP, (forge) => loadForge(forge, inventory, 1)).ok, true);
  book.forge(PROP).output = { id: 'alloyIngot', count: 1, alloy: 'a1' };
  book.forge('r:other').output = { id: 'unusableScrap', count: 1, inputs: { ironIngot: 1, lapisLazuli: 1 } };
  book.forge('r:idle');
  book.save();

  const again = new AlloyBook({ storage, seed: 7 });
  assert.deepEqual(again.toJSON(), book.toJSON());
  assert.deepEqual(again.get('a1'), alloy);
  assert.equal(again.result('ironIngot|lapisLazuli'), 'scrap');
  assert.equal(again.next, 2);
  assert.deepEqual(again.forge(PROP).toJSON(), {
    base: 'steelIngot', catalysts: ['rawTin'], output: { id: 'alloyIngot', count: 1, alloy: 'a1' },
  });
  assert.deepEqual([...again.forges.keys()], [PROP, 'r:other']);
  assert.deepEqual([again.naming, again.lit(PROP), book.lit(PROP)], [null, false, true]);
  assert.equal(new AlloyBook({ storage, seed: 8 }).alloys.size, 0, 'another world has its own book');
});

test('every successful move saves at once, and a refused one writes nothing', () => {
  const storage = memory();
  const book = new AlloyBook({ storage, seed: 7 });
  const inventory = bag({ id: 'rawTin', count: 1 }, { id: 'ironIngot', count: 1 });
  assert.equal(book.saved(PROP, (forge) => loadForge(forge, inventory, 0)).status, 'refused');
  assert.equal(storage.writes, 0);
  book.saved(PROP, (forge) => loadForge(forge, inventory, 1));
  assert.equal(storage.writes, 1);
  assert.equal(new AlloyBook({ storage, seed: 7 }).forge(PROP).base, 'ironIngot');
});

test('at 32 busy forges another is refused, and an idle one makes way', () => {
  const book = new AlloyBook({ storage: null, seed: 1 });
  for (let i = 0; i < 32; i++) book.forge(`f${i}`).base = 'ironIngot';
  assert.equal(book.forge('f32'), null);
  assert.deepEqual(book.saved('f32', () => assert.fail('no forge to move')), {
    ok: false, status: 'busy', message: "This alloy forge can't be used: too many stations are busy.",
  });
  book.forge('f5').base = null;
  assert.ok(book.forge('f32'));
  assert.equal(book.forges.has('f5'), false);
  assert.equal(book.forges.size, 32);
  for (const id of ['', 'x'.repeat(65), 7]) assert.throws(() => book.forge(id), TypeError);
});

test('a bad file, version or storage loads nothing and never throws', () => {
  for (const text of ['{', 'null', '[]', JSON.stringify({ v: 2, alloys: [IRON_TIN] }), save({ v: '1' })]) {
    const book = loaded(text);
    assert.deepEqual([book.alloys.size, book.recipes.size, book.forges.size, book.next], [0, 0, 0, 1], text);
  }
  const broken = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('full'); },
  };
  const book = new AlloyBook({ storage: broken, seed: 7 });
  discover(book, 'ironIngot', 'rawTin');
  assert.doesNotThrow(() => book.save());
  assert.equal(book.get('a1').name, 'Ferranite', 'the book lives on for this visit');
  const empty = loaded(JSON.stringify({ v: 1 }));
  assert.deepEqual([empty.alloys.size, empty.recipes.size, empty.forges.size, empty.next], [0, 0, 0, 1]);
});

test('without a storage the book uses localStorage when the page allows it', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    const storage = memory({ [KEY]: save() });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => storage });
    assert.equal(new AlloyBook({ seed: 7 }).alloys.size, 2);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('blocked'); } });
    assert.equal(new AlloyBook({ seed: 7 }).storage, null);
    delete globalThis.localStorage;
    assert.equal(new AlloyBook().storage, null);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
});

test('each invalid alloy is dropped on its own', () => {
  const variants = [
    null, 'a3', { id: 'b3' }, { id: 'a0' }, { id: 'a10000' }, { id: 3 }, { id: 'a1' },
    { name: 'Moon  Iron' }, { name: 'Moon_Iron' }, { name: ' Moon' }, { name: 'A'.repeat(25) }, { name: 7 },
    { name: 'BLACKIRON' }, { colour: 'FFFFFF' }, { colour: '5e6568' },
    { base: 'copperIngot' }, { base: 'nothing' }, { base: null }, { catalysts: [] }, { catalysts: 'rawTin' },
    { catalysts: ['rawTin', 'lapisLazuli'] }, { catalysts: ['ironIngot'] }, { catalysts: ['lapisLazuli', 'lapisLazuli'] },
    { catalysts: ['bronzeIngot', 'copperIngot', 'lapisLazuli', 'rawTin', 'steelIngot'] }, { catalysts: ['rawTin'] },
    { type: 'crystal' }, { tier: 2 }, { stats: [] }, { stats: null }, { stats: { speed: 1 } },
    { stats: { attackDamage: 2e6 } }, { stats: { attackDamage: '3' } }, { hits: { hit: 0 } }, { hits: { hit: 4 } },
    { hits: { hit: 1.5 } }, { hits: { punch: 1 } }, { xp: -1 }, { xp: '2' },
    // Ids that can't become strings are dropped before they are keyed.
    { base: { toString: null } }, { catalysts: [{ toString: null }] },
  ];
  for (const variant of variants) {
    const bad = variant && typeof variant === 'object' ? { ...IRON_LAPIS, id: 'a3', name: 'Other', ...variant } : variant;
    const book = loaded(save({ alloys: [IRON_TIN, bad] }));
    assert.deepEqual([...book.alloys.keys()], ['a1'], JSON.stringify(variant));
    assert.equal(book.next, 3);
  }
  const fine = loaded(save({ alloys: [IRON_TIN, { ...IRON_LAPIS, xp: null, extra: 'dropped' }] }));
  assert.deepEqual(fine.get('a2'), { ...IRON_LAPIS, xp: null });
  assert.equal(fine.result('ironIngot|lapisLazuli'), fine.get('a2'));
});

test('each invalid scrap key is dropped on its own', () => {
  const bad = [5, null, 'ironIngot', 'ironIngot|rawTin|x', 'rawTin|ironIngot', 'ironIngot|rawTin,lapisLazuli',
    'ironIngot|', 'ironIngot|rawTin', 'nothing|rawTin'];
  const book = loaded(save({ scrap: ['ironIngot|copperIngot', ...bad, 'ironIngot|copperIngot,lapisLazuli', 'steelIngot|rawTin', 'ironIngot|copperIngot'] }));
  assert.deepEqual([...book.recipes].filter(([, known]) => known === 'scrap').map(([key]) => key),
    ['ironIngot|copperIngot', 'ironIngot|copperIngot,lapisLazuli', 'steelIngot|rawTin']);
  assert.equal(book.result('ironIngot|rawTin'), book.get('a1'), 'an alloy\'s key is never scrap');
});

test('next is kept when it is above every id, and worked out again otherwise', () => {
  assert.equal(loaded(save({ next: 9 })).next, 9);
  for (const next of [1, 2, 2.5, '9', 10000, undefined]) assert.equal(loaded(save({ next })).next, 3, String(next));
  assert.equal(loaded(save({ alloys: [], next: 1 })).next, 1);
});

test('each invalid forge is dropped on its own, and at most 32 load', () => {
  const ok = { base: 'ironIngot', catalysts: ['rawTin'], output: null };
  const bad = {
    '': ok, ['x'.repeat(65)]: ok, a: null, b: 'ironIngot', c: { ...ok, base: 'rawTin', catalysts: [] },
    d: { ...ok, base: null }, e: { ...ok, catalysts: 'rawTin' }, f: { ...ok, catalysts: ['rawTin', 'rawTin'] },
    g: { ...ok, output: { id: 'alloyIngot', count: 2, alloy: 'a1' } }, h: { ...ok, output: { id: 'alloyIngot', count: 1, alloy: 'a9' } },
    i: { ...ok, output: { id: 'unusableScrap', count: 1 } }, j: { ...ok, output: { id: 'ironIngot', count: 1 } },
    k: { base: 'ironIngot', catalysts: [] }, o: { ...ok, base: { toString: null } },
    p: { ...ok, catalysts: [{ toString: null }] },
  };
  const good = {
    l: ok, m: { base: null, catalysts: [], output: { id: 'unusableScrap', count: 1, inputs: { rawTin: 1, ironIngot: 1 } } },
    n: { ...ok, output: { id: 'alloyIngot', count: 1, alloy: 'a2', inputs: { rawTin: 1 } } },
  };
  const book = loaded(save({ forges: { ...bad, ...good } }));
  assert.deepEqual([...book.forges.keys()], ['l', 'm', 'n']);
  assert.deepEqual(book.forges.get('m').output, { id: 'unusableScrap', count: 1, inputs: { ironIngot: 1, rawTin: 1 } });
  assert.deepEqual(book.forges.get('n').output, { id: 'alloyIngot', count: 1, alloy: 'a2' });

  const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`f${i}`, ok]));
  assert.equal(loaded(save({ forges: many })).forges.size, 32);
  assert.equal(loaded(save({ forges: 'none' })).forges.size, 0);
});

test('each weapon station\'s piece and waiting weapon survive a reload', () => {
  const storage = memory();
  const book = new AlloyBook({ storage, seed: 7 });
  book.record('ironIngot|rawTin', plan(IRON_TIN));
  const inventory = bag({ id: 'alloyIngot', count: 1, alloy: 'a1' }, { id: 'ironIngot', count: 7 }, { id: 'rawTin', count: 1 });
  assert.equal(book.savedBench('r:spawn:13', (s) => chooseRecipe(s, 'shortSword')).ok, true);
  assert.equal(storage.writes, 1);
  assert.equal(book.savedBench('r:spawn:13', (s) => loadSmithy(s, inventory, 2, book)).status, 'refused');
  assert.equal(storage.writes, 1, 'a refusal writes nothing');
  for (const index of [0, 1, 1, 1]) book.savedBench('r:spawn:13', (s) => loadSmithy(s, inventory, index, book));
  book.savedBench('r:spawn:13', (s) => hitSmithy(s, 'hit', book), { later: true });
  assert.equal(storage.writes, 5, 'a hit waits');
  book.flush();
  book.flush();
  assert.equal(storage.writes, 6, 'the page going away saves it once');
  book.savedBench('r:spawn:13', (s) => hitSmithy(s, 'etch', book), { later: true });
  book.update(1.99);
  assert.equal(storage.writes, 6);
  book.update(0.01);
  assert.equal(storage.writes, 7, 'two seconds later it is saved');
  book.update(5);
  assert.equal(storage.writes, 7, 'and only once');
  book.savedBench('r:spawn:13', (s) => hitSmithy(s, 'hit', book), { later: true });
  book.update(1);
  book.savedBench('r:spawn:13', (s) => hitSmithy(s, 'hit', book), { later: true });
  book.update(1);
  assert.equal(storage.writes, 8, 'hits in a row save every two seconds');
  // A dagger finished into a full bag waits on its station.
  const full = bag(...Array.from({ length: 24 }, () => ({ id: 'bandage', count: 1 })));
  book.savedBench('r:west', (s) => chooseRecipe(s, 'dagger'));
  for (let i = 0; i < 3; i++) book.savedBench('r:west', (s) => loadSmithy(s, inventory, 1, book));
  assert.equal(book.savedBench('r:west', (s) => finishSmithy(s, full, book, () => 0)).status, 'missing');
  book.bench('r:west').units.push('ironIngot');
  assert.equal(book.savedBench('r:west', (s) => finishSmithy(s, full, book, () => 0)).waiting, true);
  book.bench('r:idle');

  const again = new AlloyBook({ storage, seed: 7 });
  assert.deepEqual(again.toJSON(), book.toJSON());
  assert.deepEqual(again.toJSON().benches['r:spawn:13'], {
    recipe: 'shortSword', units: ['a1', 'ironIngot', 'ironIngot', 'ironIngot'], done: { hit: 3, etch: 1 }, output: null,
  });
  assert.equal(again.bench('r:west').output.forged.metal, 'Iron');
  assert.deepEqual([...again.benches.keys()], ['r:spawn:13', 'r:west']);
  assert.deepEqual(loaded(save()).benches.size, 0, 'a file without stations loads');
});

test('forges and weapon stations share the cap of 32, and an idle one of either makes way', () => {
  const book = new AlloyBook({ storage: null, seed: 1 });
  for (let i = 0; i < 16; i++) book.forge(`f${i}`).base = 'ironIngot';
  for (let i = 0; i < 16; i++) book.bench(`b${i}`).recipe = 'dagger';
  assert.deepEqual([book.forge('f16'), book.bench('b16')], [null, null]);
  assert.deepEqual(book.savedBench('b16', () => assert.fail('no station to move')), {
    ok: false, status: 'busy', message: "This weapon station can't be used: too many stations are busy.",
  });
  book.forge('f3').base = null;
  assert.ok(book.bench('b16'), 'an idle forge makes way for a station');
  assert.deepEqual([book.forges.has('f3'), book.forges.size + book.benches.size], [false, 32]);
  book.bench('b16').recipe = 'dagger';
  book.bench('b2').recipe = null;
  assert.ok(book.forge('f3'), 'an idle station makes way for a forge');
  assert.equal(book.benches.has('b2'), false);
  for (const id of ['', 'x'.repeat(65), 7]) assert.throws(() => book.bench(id), TypeError);
});

test('each invalid weapon station is dropped on its own, and forges and stations load 32 at most', () => {
  const piece = { recipe: 'shortSword', units: ['a1'], done: {}, output: null };
  const benches = { ok: piece, bad: { ...piece, units: ['rawTin'] }, ['x'.repeat(65)]: piece, empty: null };
  assert.deepEqual([...loaded(save({ benches })).benches.keys()], ['ok']);
  assert.equal(loaded(save({ benches: 'none' })).benches.size, 0);
  const forges = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`f${i}`, { base: 'ironIngot', catalysts: [], output: null }]));
  const many = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`b${i}`, piece]));
  const book = loaded(save({ forges, benches: many }));
  assert.deepEqual([book.forges.size, [...book.benches.keys()]], [30, ['b0', 'b1']]);
});

test('the bag describes alloy ingots by their alloy and scrap by what it consumed', () => {
  const book = loaded(save());
  assert.deepEqual(describeStack({ id: 'alloyIngot', count: 1, alloy: 'a1' }, book), {
    name: 'Blackiron', colour: '#5E6568', description: 'An ingot of Blackiron, forged from Iron Ingot and Raw Tin.',
    stats: { 'Attack Damage': '3.5', 'Blunt Rating': '45', Durability: '406', 'Projectile Damage': '0.4', Tier: '1' },
  });
  book.record('ironIngot|copperIngot,lapisLazuli', plan({ ...IRON_TIN, name: 'Grimcore', catalysts: ['copperIngot', 'lapisLazuli'] }));
  assert.equal(describeStack({ id: 'alloyIngot', count: 1, alloy: 'a3' }, book).description,
    'An ingot of Grimcore, forged from Iron Ingot, Copper Ingot and Lapis Lazuli.');
  assert.deepEqual(describeStack({ id: 'alloyIngot', count: 1, alloy: 'a9' }, book), {
    name: 'Unknown alloy', colour: null, description: 'A bar of a forged alloy.', stats: null,
  });
  assert.equal(describeStack({ id: 'alloyIngot', count: 1 }, book).name, 'Unknown alloy');
  assert.deepEqual(describeStack({ id: 'unusableScrap', count: 3, inputs: { rawTin: 1, ironIngot: 2 } }, book), {
    name: 'Unusable Scrap', colour: null, description: 'What is left of a failed alloy of Iron Ingot x2 and Raw Tin.', stats: null,
  });
  assert.equal(describeStack({ id: 'unusableScrap', count: 1, inputs: { ironIngot: 2 } }, book).description,
    'What is left of a failed alloy of Iron Ingot x2.');
  assert.equal(describeStack({ id: 'unusableScrap', count: 1 }, book), null);
  assert.equal(describeStack({ id: 'ironIngot', count: 1 }, book), null);
  assert.equal(describeStack(null, book), null);
});
