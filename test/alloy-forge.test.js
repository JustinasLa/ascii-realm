import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AlloyBook } from '../src/crafting/alloy-book.js';
import {
  AlloyForge, FIRE_FUEL, FIRE_GLOW, NAMING_TIME, emptyForge, fireForge, forgeScreenModel, loadForge, takeForge,
} from '../src/crafting/alloys.js';
import { INGREDIENTS } from '../src/crafting/ingredients.js';
import { Inventory } from '../src/inventory/inventory.js';

// A scripted random source that throws when it runs out.
function seq(...values) {
  let index = 0;
  const random = () => {
    if (index >= values.length) throw new Error(`random() drawn ${index + 1} times, scripted ${values.length}`);
    return values[index++];
  };
  random.left = () => values.length - index;
  return random;
}
// The draws that make Iron Ingot + Raw Tin into the golden Ferranite.
const GOLDEN = [0.05, 0.30, 0.50, 0.10, 0.90, 0.5, 0.2, 0.4, 0.3, 0.5, 0.1, 0.5, 0.0, 0, 0.5, 0.99, 0, 0.7, 0];
const zeros = () => 0;
const PROP = 'r:spawn:12';

function bag(...stacks) {
  const inventory = new Inventory({ starter: false, capacity: 1e6 });
  stacks.forEach((stack, index) => { inventory.slots[index] = stack; });
  return inventory;
}
// Fills every empty slot with a full stack of logs, which nothing here merges with.
function fill(inventory) {
  inventory.slots.forEach((stack, index) => { if (!stack) inventory.slots[index] = { id: 'oakLog', count: 10 }; });
  return inventory;
}
const book = () => new AlloyBook({ storage: null, seed: 1 });
const mix = (base, ...catalysts) => Object.assign(new AlloyForge(), { base, catalysts });
const snapshot = (value) => JSON.parse(JSON.stringify(value));
const count = (inventory, id) => inventory.slots.reduce((sum, stack) => sum + (stack?.id === id ? stack.count : 0), 0);

test('a firing burns coal, and a new alloy is named within a minute and glows the hearth after', () => {
  assert.equal(FIRE_FUEL, 'coal');
  assert.equal(NAMING_TIME, 60);
  assert.equal(FIRE_GLOW, 10);
});

test('refusals come in the classic order with their messages, changing nothing', () => {
  const inventory = bag(
    { id: 'rawTin', count: 2 }, { id: 'copperIngot', count: 1 }, { id: 'alloyIngot', count: 1, alloy: 'a1' },
    { id: 'unusableScrap', count: 1, inputs: { ironIngot: 1, rawTin: 1 } }, { id: 'coal', count: 1 },
    { id: 'ironIngot', count: 1, alloy: 'a2' }, { id: 'ironIngot', count: 3 },
  );
  const forge = new AlloyForge();
  const before = snapshot(inventory.slots);
  const refused = (index) => {
    const done = loadForge(forge, inventory, index);
    assert.equal(done.ok, false);
    return [done.status, done.message];
  };
  assert.deepEqual(refused(0), ['refused', 'This ingredient cannot be used as the base.']);
  assert.deepEqual(refused(1), ['refused', 'This ingredient cannot be used as the base.']);
  for (const index of [2, 3, 4, 5]) assert.deepEqual(refused(index), ['refused', 'This item is not an ingredient.']);
  assert.deepEqual(refused(9), ['invalid', 'Select something in your bag.']);
  assert.deepEqual(refused(-1), ['invalid', 'Select something in your bag.']);
  assert.deepEqual(inventory.slots, before);
  assert.deepEqual(forge.toJSON(), { base: null, catalysts: [], output: null });

  forge.base = 'ironIngot';
  assert.deepEqual(refused(6), ['refused', 'This ingredient is already part of the recipe.']);
  forge.catalysts = ['steelIngot', 'bronzeIngot', 'copperIngot', 'lapisLazuli'];
  assert.deepEqual(refused(6), ['refused', 'This ingredient is already part of the recipe.'], 'already in, before full');
  assert.deepEqual(refused(0), ['refused', 'The alloy forge cannot fit any more ingredients.']);
  assert.equal(loadForge(forge, inventory, 0).code, 'capacity');
  assert.deepEqual(inventory.slots, before);
});

test('a base that takes no catalyst of a type refuses it by its type names', () => {
  const table = { ...INGREDIENTS, geode: { ...INGREDIENTS.rawTin, base: true } };
  const forge = mix('geode');
  assert.deepEqual(forge.refusal({ id: 'ironIngot', count: 1 }, table), {
    code: 'incompatible',
    message: 'A Crystal base cannot be mixed with a Metal catalyst.',
    reason: "Doesn't mix with Crystal",
  });
  assert.equal(mix('ironIngot').refusal({ id: 'rawTin' }, table), null, 'a metal base takes crystal');
});

test('loading moves exactly one unit, the base first and a base-capable ingot after it as a catalyst', () => {
  const inventory = bag({ id: 'ironIngot', count: 5 }, { id: 'steelIngot', count: 1 }, { id: 'rawTin', count: 1 });
  const forge = new AlloyForge();
  assert.deepEqual(loadForge(forge, inventory, 0), {
    ok: true, status: 'loaded', message: 'Added Iron Ingot. Base 1/1 · Catalysts 0/4', id: 'ironIngot',
  });
  assert.deepEqual(inventory.slots[0], { id: 'ironIngot', count: 4 });
  assert.equal(loadForge(forge, inventory, 1).message, 'Added Steel Ingot. Base 1/1 · Catalysts 1/4');
  assert.equal(loadForge(forge, inventory, 2).message, 'Added Raw Tin. Base 1/1 · Catalysts 2/4');
  assert.deepEqual(inventory.slots.slice(0, 3), [{ id: 'ironIngot', count: 4 }, null, null]);
  assert.deepEqual(forge.ingredients, ['ironIngot', 'steelIngot', 'rawTin']);
  assert.deepEqual(forgeScreenModel(forge, inventory, book()).bag.map((row) => row.target), [null]);
});

test('a bag that hands back the wrong stack is put back as it was', () => {
  for (const wrong of [null, { id: 'rawTin', count: 1 }, { id: 'ironIngot', count: 2 }]) {
    const inventory = bag({ id: 'ironIngot', count: 3 });
    inventory.remove = (index) => { inventory.slots[index] = null; return wrong; };
    const forge = new AlloyForge();
    assert.deepEqual(loadForge(forge, inventory, 0), {
      ok: false, status: 'invalid', message: 'That could not be moved.', id: 'ironIngot',
    });
    assert.deepEqual(inventory.slots[0], { id: 'ironIngot', count: 3 });
    assert.equal(forge.base, null);
  }
});

test('ingredients can be loaded while a result waits, but the forge only fires once it is taken', () => {
  const alloys = book();
  const inventory = bag({ id: 'ironIngot', count: 1 }, { id: 'rawTin', count: 1 }, { id: 'coal', count: 1 });
  const forge = mix(null);
  forge.output = { id: 'unusableScrap', count: 1, inputs: { ironIngot: 1, rawTin: 1 } };
  assert.equal(loadForge(forge, inventory, 0).ok, true);
  assert.equal(loadForge(forge, inventory, 1).ok, true);
  assert.deepEqual(fireForge(forge, inventory, alloys, PROP, seq()), {
    ok: false, status: 'waiting', message: 'Take the Unusable Scrap first.',
  });
  assert.equal(count(inventory, 'coal'), 1);
  assert.deepEqual(forge.ingredients, ['ironIngot', 'rawTin']);
});

test('firing needs two ingredients and a coal, and a refusal takes nothing', () => {
  const alloys = book();
  const inventory = bag({ id: 'coal', count: 2 });
  const one = mix('ironIngot');
  assert.deepEqual(fireForge(one, inventory, alloys, PROP, seq()), {
    ok: false, status: 'few', message: 'You need at least 2 ingredients to make an alloy.',
  });
  assert.deepEqual(fireForge(new AlloyForge(), inventory, alloys, PROP, seq()).status, 'few');
  const cold = bag({ id: 'oakLog', count: 3 }, { id: 'coal', count: 1, material: 'iron' });
  const two = mix('ironIngot', 'rawTin');
  assert.deepEqual(fireForge(two, cold, alloys, PROP, seq()), {
    ok: false, status: 'fuel', message: 'The alloy forge needs 1 Coal to fire.',
  });
  assert.deepEqual(two.ingredients, ['ironIngot', 'rawTin']);
  assert.equal(count(inventory, 'coal'), 2);
  assert.equal(alloys.lit(PROP), false);
});

test('a new mix burns one coal and both ingredients into a new alloy ingot', () => {
  const alloys = book();
  const inventory = bag({ id: 'coal', count: 3 }, { id: 'ironIngot', count: 1 }, { id: 'rawTin', count: 1 });
  const forge = new AlloyForge();
  loadForge(forge, inventory, 1);
  loadForge(forge, inventory, 2);
  const random = seq(...GOLDEN);
  const done = fireForge(forge, inventory, alloys, PROP, random);
  assert.equal(random.left(), 0);
  const alloy = alloys.get('a1');
  assert.deepEqual(done, {
    ok: true, status: 'fired', message: 'You discovered Ferranite!', outcome: 'new', alloy, waiting: false,
  });
  assert.deepEqual(alloy, {
    id: 'a1', name: 'Ferranite', colour: 'B0B3B5', base: 'ironIngot', catalysts: ['rawTin'], type: 'metal', tier: 1,
    stats: { attackDamage: 3.5, bluntRating: 45, durability: 406, projectileDamage: 0.4 },
    hits: { hit: 1, smallHit: 2, engrave: 3 }, xp: 2,
  });
  assert.equal(alloys.result('ironIngot|rawTin'), alloy);
  assert.deepEqual(alloys.naming, { id: 'a1', until: 60 });
  assert.deepEqual(inventory.slots.slice(0, 3), [{ id: 'coal', count: 2 }, { id: 'alloyIngot', count: 1, alloy: 'a1' }, null]);
  assert.deepEqual(forge.toJSON(), { base: null, catalysts: [], output: null });
  assert.equal(alloys.lit(PROP), true);
  assert.equal(alloys.lit('elsewhere'), false);
  alloys.update(9.99);
  assert.equal(alloys.lit(PROP), true);
  alloys.update(0.02);
  assert.equal(alloys.lit(PROP), false);
});

test('a known mix gives the same alloy in any loading order, without a draw', () => {
  const alloys = book();
  const inventory = bag({ id: 'coal', count: 2 });
  const first = fireForge(mix('ironIngot', 'rawTin', 'lapisLazuli'), inventory, alloys, PROP, zeros);
  assert.equal(first.outcome, 'new');
  const again = fireForge(mix('ironIngot', 'lapisLazuli', 'rawTin'), inventory, alloys, PROP, seq());
  assert.deepEqual(again, {
    ok: true, status: 'fired', message: 'The forge gives Ferranite.', outcome: 'known', alloy: first.alloy, waiting: false,
  });
  assert.deepEqual(inventory.slots[1], { id: 'alloyIngot', count: 2, alloy: 'a1' });
  assert.equal(alloys.next, 2);
});

test('a failed roll is scrap for good, recording what it consumed', () => {
  const alloys = book();
  const inventory = bag({ id: 'coal', count: 2 });
  const random = seq(0.1465);
  assert.deepEqual(fireForge(mix('ironIngot', 'rawTin'), inventory, alloys, PROP, random), {
    ok: true, status: 'fired', message: 'The mix fails. You get Unusable Scrap.', outcome: 'scrap', alloy: null,
    waiting: false,
  });
  assert.equal(random.left(), 0);
  assert.equal(alloys.result('ironIngot|rawTin'), 'scrap');
  assert.equal(fireForge(mix('ironIngot', 'rawTin'), inventory, alloys, PROP, seq()).outcome, 'scrap');
  assert.deepEqual(inventory.slots[1], { id: 'unusableScrap', count: 2, inputs: { ironIngot: 1, rawTin: 1 } });
  assert.equal(alloys.naming, null);
  assert.equal(alloys.alloys.size, 0);
});

test('with no free name the forge gives scrap and leaves the mix unknown', () => {
  const alloys = book();
  alloys.taken = () => true;
  const inventory = bag({ id: 'coal', count: 1 });
  const done = fireForge(mix('ironIngot', 'rawTin'), inventory, alloys, PROP, zeros);
  assert.equal(done.outcome, 'scrap');
  assert.equal(alloys.result('ironIngot|rawTin'), null);
  assert.deepEqual(inventory.slots[0], { id: 'unusableScrap', count: 1, inputs: { ironIngot: 1, rawTin: 1 } });
});

test('a bag that hands back the wrong coal is put back, and nothing is fired', () => {
  const alloys = book();
  const inventory = bag({ id: 'coal', count: 2 });
  inventory.remove = (index) => { inventory.slots[index] = null; return { id: 'coal', count: 2 }; };
  const forge = mix('ironIngot', 'rawTin');
  assert.deepEqual(fireForge(forge, inventory, alloys, PROP, seq()), {
    ok: false, status: 'invalid', message: 'That could not be moved.',
  });
  assert.deepEqual(inventory.slots[0], { id: 'coal', count: 2 });
  assert.deepEqual(forge.ingredients, ['ironIngot', 'rawTin']);
  assert.equal(alloys.lit(PROP), false);
});

test('with a full bag the result waits in the forge for Take', () => {
  const alloys = book();
  const inventory = fill(bag({ id: 'coal', count: 5 }, { id: 'ironIngot', count: 1 }, { id: 'rawTin', count: 1 }));
  const forge = new AlloyForge();
  loadForge(forge, inventory, 1);
  loadForge(forge, inventory, 2);
  fill(inventory);
  const done = fireForge(forge, inventory, alloys, PROP, seq(...GOLDEN));
  assert.equal(done.message, 'You discovered Ferranite! Your bag is full: it waits in the forge.');
  assert.equal(done.waiting, true);
  assert.deepEqual(forge.toJSON(), { base: null, catalysts: [], output: { id: 'alloyIngot', count: 1, alloy: 'a1' } });
  assert.equal(count(inventory, 'coal'), 4);
  assert.equal(count(inventory, 'alloyIngot'), 0);
  assert.equal(fireForge(forge, inventory, alloys, PROP, seq()).message, 'Take the Ferranite first.');

  const before = snapshot(inventory.slots);
  assert.deepEqual(takeForge(forge, inventory, alloys), { ok: false, status: 'full', message: 'Your bag is full.', id: 'alloyIngot' });
  assert.deepEqual(inventory.slots, before);
  assert.ok(forge.output);
  inventory.slots[7] = null;
  assert.deepEqual(takeForge(forge, inventory, alloys), { ok: true, status: 'took', message: 'Took Ferranite.', id: 'alloyIngot' });
  assert.deepEqual(inventory.slots[7], { id: 'alloyIngot', count: 1, alloy: 'a1' });
  assert.equal(forge.output, null);
  assert.deepEqual(takeForge(forge, inventory, alloys), { ok: false, status: 'empty', message: 'Nothing to take.' });
});

test('a bag at its weight limit leaves the result in the forge the same way', () => {
  const alloys = book();
  const inventory = bag({ id: 'coal', count: 2 });
  inventory.capacity = inventory.weight - 0.2;
  const forge = mix('ironIngot', 'rawTin');
  assert.equal(fireForge(forge, inventory, alloys, PROP, seq(0.5)).waiting, true);
  assert.deepEqual(forge.output, { id: 'unusableScrap', count: 1, inputs: { ironIngot: 1, rawTin: 1 } });
  assert.equal(takeForge(forge, inventory, alloys).status, 'full');
  inventory.capacity = 1;
  assert.equal(takeForge(forge, inventory, alloys).message, 'Took Unusable Scrap.');
  assert.deepEqual(inventory.slots[1], { id: 'unusableScrap', count: 1, inputs: { ironIngot: 1, rawTin: 1 } });
});

test('emptying gives back the catalysts last-in first, then the base, leaving the output', () => {
  const inventory = bag();
  const forge = mix('ironIngot', 'rawTin', 'lapisLazuli');
  forge.output = { id: 'alloyIngot', count: 1, alloy: 'a1' };
  assert.deepEqual(emptyForge(forge, inventory), {
    ok: true, status: 'emptied', message: 'Took back Lapis Lazuli, Raw Tin, Iron Ingot.',
    ids: ['lapisLazuli', 'rawTin', 'ironIngot'],
  });
  assert.deepEqual(inventory.slots.slice(0, 3), [
    { id: 'lapisLazuli', count: 1 }, { id: 'rawTin', count: 1 }, { id: 'ironIngot', count: 1 },
  ]);
  assert.deepEqual(forge.toJSON(), { base: null, catalysts: [], output: { id: 'alloyIngot', count: 1, alloy: 'a1' } });
  assert.deepEqual(emptyForge(forge, inventory), { ok: false, status: 'empty', message: 'The forge is empty.' });
});

test('with a full bag emptying gives back what fits, and the base stays while a catalyst does', () => {
  // The base's own stack has room, but the base waits behind the tin.
  const inventory = fill(bag({ id: 'ironIngot', count: 1 }, null));
  inventory.slots[1] = null;
  const forge = mix('ironIngot', 'rawTin', 'lapisLazuli');
  assert.deepEqual(emptyForge(forge, inventory), {
    ok: true, status: 'emptied', message: 'Took back Lapis Lazuli. Your bag has no room for the rest.', ids: ['lapisLazuli'],
  });
  assert.deepEqual(forge.ingredients, ['ironIngot', 'rawTin']);
  const before = snapshot(inventory.slots);
  assert.deepEqual(emptyForge(forge, inventory), { ok: false, status: 'full', message: 'Your bag is full.' });
  assert.deepEqual(inventory.slots, before);
  assert.deepEqual(forge.ingredients, ['ironIngot', 'rawTin']);

  inventory.slots[5] = null;
  assert.equal(emptyForge(forge, inventory).message, 'Took back Raw Tin, Iron Ingot.');
  assert.deepEqual(inventory.slots[0], { id: 'ironIngot', count: 2 });

  const stuck = fill(bag(null));
  stuck.slots[0] = null;
  const base = mix('steelIngot', 'rawTin');
  assert.equal(emptyForge(base, stuck).message, 'Took back Raw Tin. Your bag has no room for the rest.');
  assert.deepEqual(base.toJSON(), { base: 'steelIngot', catalysts: [], output: null });
});

test('a catalyst the bag can\'t take doesn\'t hold back an earlier one whose stack has room', () => {
  // No free slot: the tin joins its stack, the lapis has nowhere to go.
  const inventory = fill(bag({ id: 'rawTin', count: 1 }));
  const forge = mix('ironIngot', 'copperIngot', 'rawTin', 'lapisLazuli');
  assert.deepEqual(emptyForge(forge, inventory), {
    ok: true, status: 'emptied', message: 'Took back Raw Tin. Your bag has no room for the rest.', ids: ['rawTin'],
  });
  assert.deepEqual(inventory.slots[0], { id: 'rawTin', count: 2 });
  assert.deepEqual(forge.ingredients, ['ironIngot', 'copperIngot', 'lapisLazuli']);

  inventory.slots[1] = null;
  assert.equal(emptyForge(forge, inventory).message, 'Took back Lapis Lazuli. Your bag has no room for the rest.');
  assert.deepEqual(forge.ingredients, ['ironIngot', 'copperIngot']);
});

test('the screen model shows the slots, the known result and why the forge can or cannot fire', () => {
  const alloys = book();
  const inventory = bag(
    { id: 'ironIngot', count: 3 }, { id: 'rawTin', count: 2 }, { id: 'coal', count: 3 }, { id: 'shortSword', count: 1 },
    { id: 'coal', count: 2 }, { id: 'lapisLazuli', count: 1 }, { id: 'oakLog', count: 1 },
  );
  const forge = new AlloyForge();
  let model = forgeScreenModel(forge, inventory, alloys);
  assert.deepEqual(model, {
    base: null, catalysts: [null, null, null, null], status: 'Base 0/1 · Catalysts 0/4', result: null,
    fire: { ready: false, reason: 'You need at least 2 ingredients to make an alloy.', coal: 5 },
    output: null, canEmpty: false, naming: null, known: [],
    bag: [
      { index: 0, id: 'ironIngot', name: 'Iron Ingot', count: 3, target: 'base', reason: null },
      { index: 1, id: 'rawTin', name: 'Raw Tin', count: 2, target: null, reason: "Can't be the base" },
      { index: 5, id: 'lapisLazuli', name: 'Lapis Lazuli', count: 1, target: null, reason: "Can't be the base" },
    ],
  });
  loadForge(forge, inventory, 0);
  model = forgeScreenModel(forge, inventory, alloys);
  assert.deepEqual(model.base, { id: 'ironIngot', name: 'Iron Ingot' });
  assert.equal(model.result, null);
  assert.equal(model.canEmpty, true);
  assert.deepEqual(model.bag.map((row) => [row.target, row.reason]), [
    [null, 'Already in the mix'], ['catalyst', null], ['catalyst', null],
  ]);
  loadForge(forge, inventory, 1);
  model = forgeScreenModel(forge, inventory, alloys);
  assert.deepEqual(model.catalysts, [{ id: 'rawTin', name: 'Raw Tin' }, null, null, null]);
  assert.equal(model.status, 'Base 1/1 · Catalysts 1/4');
  assert.equal(model.result, 'Unknown mix');
  assert.deepEqual(model.fire, { ready: true, reason: null, coal: 5 });

  const full = mix('ironIngot', 'steelIngot', 'bronzeIngot', 'copperIngot', 'rawTin');
  assert.equal(forgeScreenModel(full, inventory, alloys).bag.at(-1).reason, 'Forge is full');
  assert.equal(forgeScreenModel(forge, bag(), alloys).fire.reason, 'The alloy forge needs 1 Coal to fire.');
});

test('the screen model names the result, the output, the naming window and the known alloys', () => {
  const alloys = book();
  const inventory = fill(bag({ id: 'coal', count: 4 }));
  const forge = mix('ironIngot', 'rawTin');
  fireForge(forge, inventory, alloys, PROP, seq(...GOLDEN));
  alloys.update(12.4);
  forge.base = 'ironIngot';
  forge.catalysts = ['rawTin'];
  let model = forgeScreenModel(forge, inventory, alloys);
  assert.equal(model.result, 'Ferranite');
  assert.deepEqual(model.output, { name: 'Ferranite', colour: '#B0B3B5' });
  assert.deepEqual(model.fire, { ready: false, reason: 'Take the Ferranite first.', coal: 3 });
  assert.deepEqual(model.naming, { id: 'a1', name: 'Ferranite', left: 48 });
  assert.deepEqual(model.known, [{
    id: 'a1', name: 'Ferranite', colour: '#B0B3B5', recipe: 'Iron Ingot + Raw Tin',
    stats: [['Attack Damage', '3.5'], ['Blunt Rating', '45'], ['Durability', '406'], ['Projectile Damage', '0.4']],
  }]);

  const roomy = bag({ id: 'coal', count: 3 }, { id: 'alloyIngot', count: 1, alloy: 'a1' },
    { id: 'unusableScrap', count: 1, inputs: { ironIngot: 1, lapisLazuli: 1 } }, null, { id: 'alloyIngot', count: 1, alloy: 'a7' });
  forge.output = null;
  fireForge(mix('ironIngot', 'lapisLazuli'), roomy, alloys, PROP, seq(0.99));
  fireForge(mix('ironIngot', 'copperIngot', 'lapisLazuli'), roomy, alloys, PROP, zeros);
  model = forgeScreenModel(mix('ironIngot', 'lapisLazuli'), roomy, alloys);
  assert.equal(model.result, 'Scrap');
  assert.equal(model.naming.name, 'Blackiron');
  assert.deepEqual(model.known.map((alloy) => [alloy.name, alloy.recipe]), [
    ['Ferranite', 'Iron Ingot + Raw Tin'], ['Blackiron', 'Iron Ingot + Copper Ingot + Lapis Lazuli'],
  ]);
  assert.deepEqual(model.bag.map((row) => [row.name, row.count, row.reason]), [
    ['Ferranite', 1, 'Not an ingredient'], ['Unusable Scrap', 2, 'Not an ingredient'], ['Blackiron', 1, 'Not an ingredient'],
    ['Unknown alloy', 1, 'Not an ingredient'],
  ]);
  assert.deepEqual(forgeScreenModel(Object.assign(new AlloyForge(), { output: roomy.slots[2] }), roomy, alloys).output, {
    name: 'Unusable Scrap', colour: null,
  });
  alloys.update(60.01);
  assert.equal(forgeScreenModel(forge, roomy, alloys).naming, null);
});
