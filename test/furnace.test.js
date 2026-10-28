import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  COOK_TIME, FUEL, FURNACE_KEY, Furnace, Furnaces, SLOTS, SMELTING, furnaceScreenModel, load, unload,
} from '../src/crafting/furnace.js';
import { Inventory } from '../src/inventory/inventory.js';
import { ITEMS } from '../src/inventory/items.js';
import { itemArt } from '../src/ui/item-art.js';

function furnace(state = {}) {
  return Object.assign(new Furnace(), state);
}

function bag(...stacks) {
  const inventory = new Inventory({ starter: false, capacity: 1000 });
  stacks.forEach((stack, index) => { inventory.slots[index] = stack; });
  return inventory;
}

function memory(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    writes: 0,
    getItem: (key) => data.get(key) ?? null,
    setItem(key, value) { this.writes++; data.set(key, value); },
  };
}

const snapshot = (f) => JSON.parse(JSON.stringify(f));

test('recipes and fuels follow the classic tables', () => {
  assert.equal(COOK_TIME, 10);
  assert.deepEqual({ ...SMELTING }, { rawIron: 'ironIngot', rawCopper: 'copperIngot' });
  for (const id of ['rawTin', 'coal', 'lapisLazuli']) assert.equal(Object.hasOwn(SMELTING, id), false, id);
  assert.deepEqual({ ...FUEL }, { coal: 80, oakLog: 15 });
  const f = new Furnace();
  for (const id of [...Object.keys(ITEMS), 'nothing']) {
    assert.equal(f.accepts('input', id), Object.hasOwn(SMELTING, id), id);
    assert.equal(f.accepts('fuel', id), Object.hasOwn(FUEL, id), id);
    assert.equal(f.accepts('output', id), false, id);
  }
});

test('both ingots stack to 64, weigh what their ore weighs and share a bar picture', () => {
  for (const [ore, ingot] of Object.entries(SMELTING)) {
    const item = ITEMS[ingot];
    assert.equal(item.stackLimit, 64);
    assert.equal(item.weight, ITEMS[ore].weight);
    assert.ok(item.tags.includes('resource') && item.tags.includes('metal'));
    const rows = itemArt(ingot).split('\n');
    assert.ok(rows.length <= 9 && rows.every((row) => row.length <= 11), ingot);
  }
  assert.equal(ITEMS.copperIngot.name, 'Copper Ingot');
  assert.equal(itemArt('copperIngot').replaceAll('o', '#'), itemArt('ironIngot'), 'one bar, filled with its ore');
});

test('one raw iron and one coal give one ingot in ten seconds', () => {
  const f = furnace({ input: { id: 'rawIron', count: 1 }, fuel: { id: 'coal', count: 3 } });
  assert.equal(f.advance(10), true);
  assert.deepEqual(f.output, { id: 'ironIngot', count: 1 });
  assert.equal(f.input, null);
  assert.equal(f.burn, 70);
  assert.equal(f.burnTotal, 80);
  assert.deepEqual(f.fuel, { id: 'coal', count: 2 });
  assert.equal(f.lit, true);
  assert.equal(f.advance(1), false, 'burning on with nothing to smelt changes no slot');
});

test('a coal smelts eight items, and a ninth cools back to nothing', () => {
  const eight = furnace({ input: { id: 'rawIron', count: 8 }, fuel: { id: 'coal', count: 1 } });
  eight.advance(80);
  assert.deepEqual(eight.output, { id: 'ironIngot', count: 8 });
  assert.equal(eight.burn, 0);
  assert.equal(eight.fuel, null);
  assert.equal(eight.lit, false);

  const nine = furnace({ input: { id: 'rawIron', count: 9 }, fuel: { id: 'coal', count: 1 } });
  nine.advance(1000);
  assert.deepEqual(nine.output, { id: 'ironIngot', count: 8 });
  assert.deepEqual(nine.input, { id: 'rawIron', count: 1 });
  assert.equal(nine.cook, 0);
});

test('fuel is used only when something can smelt into the output', () => {
  const cases = [
    {},
    { input: { id: 'rawIron', count: 5 }, output: { id: 'ironIngot', count: 64 } },
    { input: { id: 'rawIron', count: 5 }, output: { id: 'copperIngot', count: 2 } },
    { input: { id: 'rawTin', count: 5 } },
  ];
  for (const state of cases) {
    const f = furnace({ ...state, fuel: { id: 'coal', count: 2 } });
    const before = snapshot(f);
    assert.equal(f.advance(100), false);
    assert.deepEqual(snapshot(f), before);
    assert.equal(f.lit, false);
  }
});

test('a started burn keeps ticking without input, and progress resets while blocked', () => {
  const f = furnace({ input: { id: 'rawIron', count: 2 }, fuel: { id: 'coal', count: 2 } });
  f.advance(3);
  assert.equal(f.cook, 3);
  assert.deepEqual(f.take('input', 64), { id: 'rawIron', count: 2 });
  f.advance(2);
  assert.equal(f.burn, 75);
  assert.equal(f.cook, 0);
  assert.equal(f.put('input', { id: 'rawIron', count: 2 }), 2);
  f.advance(20);
  assert.deepEqual(f.fuel, { id: 'coal', count: 1 }, 'no new coal while the burn lasts');
  assert.deepEqual(f.output, { id: 'ironIngot', count: 2 });
  assert.equal(f.burn, 55);
});

test('unlit progress falls back twice as fast', () => {
  const f = furnace({ input: { id: 'rawIron', count: 1 }, cook: 6 });
  f.advance(2);
  assert.equal(f.cook, 2);
  f.advance(5);
  assert.equal(f.cook, 0);
});

test('changing the input item starts its smelting over', () => {
  const f = furnace({ input: { id: 'rawIron', count: 1 }, fuel: { id: 'coal', count: 1 } });
  f.advance(4);
  f.take('input', 1);
  assert.equal(f.cook, 4, 'taking out alone does not reset before time passes');
  assert.equal(f.put('input', { id: 'rawCopper', count: 3 }), 3);
  assert.equal(f.cook, 0);
  f.advance(4);
  assert.equal(f.put('input', { id: 'rawCopper', count: 1 }), 1);
  assert.equal(f.cook, 4, 'more of the same item keeps the progress');
});

test('the outcome does not depend on the step size', () => {
  const start = () => furnace({ input: { id: 'rawIron', count: 9 }, fuel: { id: 'coal', count: 2 } });
  const whole = start();
  whole.advance(95);
  const small = start();
  for (let i = 0; i < 9500; i++) small.advance(0.01);
  let seed = 7;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const jagged = start();
  let left = 95;
  while (left > 0) {
    const step = Math.min(left, random() * 0.7);
    jagged.advance(step);
    left -= step;
  }
  for (const other of [small, jagged]) {
    for (const slot of SLOTS) assert.deepEqual(other[slot], whole[slot]);
    for (const key of ['burn', 'burnTotal', 'cook']) assert.ok(Math.abs(other[key] - whole[key]) < 1e-6, key);
  }
  assert.deepEqual(whole.output, { id: 'ironIngot', count: 9 });
  assert.equal(whole.burn, 65);
});

test('odd steps change nothing and a huge one ends', () => {
  const f = furnace({ input: { id: 'rawIron', count: 64 }, fuel: { id: 'coal', count: 64 } });
  const before = snapshot(f);
  for (const dt of [Infinity, NaN, -1, 0]) assert.equal(f.advance(dt), false);
  assert.deepEqual(snapshot(f), before);
  f.advance(1e9);
  assert.equal(f.input, null);
  assert.deepEqual(f.output, { id: 'ironIngot', count: 64 });
  assert.equal(f.lit, false);
});

test('slots take what fits and give back what they hold', () => {
  const f = furnace({ input: { id: 'rawIron', count: 60 } });
  assert.equal(f.room('input', 'rawIron'), 4);
  assert.equal(f.room('input', 'rawCopper'), 0);
  assert.equal(f.room('fuel', 'coal'), 64);
  assert.equal(f.room('output', 'ironIngot'), 0);
  assert.equal(f.put('input', { id: 'rawIron', count: 10 }), 4);
  assert.equal(f.put('fuel', { id: 'rawIron', count: 1 }), 0);
  assert.deepEqual(f.take('input', 5), { id: 'rawIron', count: 5 });
  assert.equal(f.take('fuel', 1), null);
  assert.equal(f.take('advance', 1), null);
});

test('loading sends a whole bag stack to its slot', () => {
  const f = new Furnace();
  const inventory = bag({ id: 'rawIron', count: 6 }, { id: 'coal', count: 4 }, { id: 'coal', count: 1 });
  assert.deepEqual(load(f, inventory, 0), {
    ok: true, status: 'loaded', message: 'Put Raw Iron x6 in the furnace.', id: 'rawIron', count: 6, slot: 'input',
  });
  assert.equal(inventory.slots[0], null);
  assert.equal(load(f, inventory, 1).message, 'Added Coal x4 as fuel.');
  assert.equal(load(f, inventory, 2).message, 'Added Coal as fuel.');
  assert.deepEqual(f.input, { id: 'rawIron', count: 6 });
  assert.deepEqual(f.fuel, { id: 'coal', count: 5 });
});

test('a nearly full slot takes part of a stack', () => {
  const f = furnace({ input: { id: 'rawIron', count: 62 } });
  const inventory = bag({ id: 'rawIron', count: 5 });
  const done = load(f, inventory, 0);
  assert.equal(done.message, 'Put Raw Iron x2 in the furnace.');
  assert.deepEqual(inventory.slots[0], { id: 'rawIron', count: 3 });
  assert.equal(f.input.count, 64);
});

test('every refusal leaves the bag and the furnace as they were', () => {
  const cases = [
    [{}, null, 'invalid', 'Select something in your bag.'],
    [{}, { id: 'shortSword', count: 1, material: 'steel' }, 'refused', "Short Sword can't go in the furnace."],
    [{}, { id: 'rawTin', count: 2 }, 'refused', 'Raw Tin does not smelt.'],
    [{}, { id: 'lapisLazuli', count: 2 }, 'refused', 'Lapis Lazuli does not smelt.'],
    [{}, { id: 'deerHide', count: 2 }, 'refused', "Deer Hide can't go in the furnace."],
    [{}, { id: 'stonePickaxe', count: 1 }, 'refused', "Stone Pickaxe can't go in the furnace."],
    [{ fuel: { id: 'oakLog', count: 1 } }, { id: 'coal', count: 2 }, 'occupied', 'The fuel slot holds Log.'],
    [{ input: { id: 'rawCopper', count: 1 } }, { id: 'rawIron', count: 2 }, 'occupied', 'The input holds Raw Copper.'],
    [{ input: { id: 'rawIron', count: 64 } }, { id: 'rawIron', count: 2 }, 'full', 'The input is full.'],
    [{ fuel: { id: 'coal', count: 64 } }, { id: 'coal', count: 2 }, 'full', 'The fuel slot is full.'],
  ];
  for (const [state, stack, status, message] of cases) {
    const f = furnace(state);
    const inventory = bag(stack);
    const before = [snapshot(f), snapshot(inventory.slots)];
    const done = load(f, inventory, 0);
    assert.equal(done.ok, false, message);
    assert.equal(done.status, status, message);
    assert.equal(done.message, message);
    assert.deepEqual([snapshot(f), snapshot(inventory.slots)], before, message);
  }
});

test('a stack with its own properties stays out of the furnace', () => {
  const f = new Furnace();
  const inventory = bag({ id: 'rawIron', count: 2, material: 'steel' });
  assert.equal(load(f, inventory, 0).message, "Raw Iron can't go in the furnace.");
  assert.equal(f.input, null);
});

test('a bag removal that goes wrong is undone', () => {
  const f = new Furnace();
  const inventory = bag({ id: 'rawIron', count: 6 });
  inventory.remove = (index) => { inventory.slots[index] = null; return { id: 'rawIron', count: 1 }; };
  const done = load(f, inventory, 0);
  assert.equal(done.status, 'invalid');
  assert.deepEqual(inventory.slots[0], { id: 'rawIron', count: 6 });
  assert.equal(f.input, null);
  inventory.remove = () => null;
  assert.equal(load(f, inventory, 0).status, 'invalid');
});

test('unloading takes as much as the bag holds', () => {
  const f = furnace({ output: { id: 'ironIngot', count: 5 } });
  const roomy = bag();
  assert.deepEqual(unload(f, 'output', roomy), {
    ok: true, status: 'took', message: 'Took Iron Ingot x5.', id: 'ironIngot', count: 5, remaining: 0,
  });
  assert.equal(f.output, null);
  assert.deepEqual(unload(f, 'output', roomy), { ok: false, status: 'empty', message: 'Nothing to take.' });
  assert.equal(unload(f, 'cook', roomy).status, 'empty');

  const light = new Inventory({ starter: false, capacity: 2.25 });
  f.output = { id: 'ironIngot', count: 5 };
  assert.equal(unload(f, 'output', light).message, 'Took Iron Ingot x3. Your bag has no room for the rest.');
  assert.deepEqual(f.output, { id: 'ironIngot', count: 2 });
  assert.deepEqual(unload(f, 'output', light), { ok: false, status: 'full', message: 'Your bag is full.', id: 'ironIngot' });
  assert.deepEqual(f.output, { id: 'ironIngot', count: 2 });

  const one = furnace({ fuel: { id: 'coal', count: 1 } });
  assert.equal(unload(one, 'fuel', roomy).message, 'Took Coal.');
});

test('saved states validate every field', () => {
  const good = {
    input: { id: 'rawIron', count: 5 }, fuel: { id: 'coal', count: 2 }, output: { id: 'ironIngot', count: 3 },
    burn: 41.2, burnTotal: 80, cook: 3.5,
  };
  assert.deepEqual(snapshot(Furnace.from(good)), good);
  assert.deepEqual(snapshot(Furnace.from({ ...good, input: null, fuel: null, output: null, burn: 0, burnTotal: 0, cook: 0 })),
    { ...good, input: null, fuel: null, output: null, burn: 0, burnTotal: 0, cook: 0 });
  const bad = [
    null, 'x',
    { ...good, input: undefined }, { ...good, input: { id: 'rawTin', count: 1 } },
    { ...good, input: { id: 'rawIron', count: 0 } }, { ...good, input: { id: 'rawIron', count: 65 } },
    { ...good, input: { id: 'rawIron', count: 1.5 } }, { ...good, fuel: { id: 'rawIron', count: 1 } },
    { ...good, output: { id: 'rawIron', count: 1 } }, { ...good, output: { id: 'toString', count: 1 } },
    { ...good, burnTotal: 50 }, { ...good, burn: 81 }, { ...good, burn: -1 }, { ...good, burn: '4' },
    { ...good, cook: 10.5 }, { ...good, cook: -0.1 }, { ...good, cook: NaN },
  ];
  for (const data of bad) assert.equal(Furnace.from(data), null, JSON.stringify(data));
  const f = Furnace.from({ ...good, burn: 1 / 3, cook: 2 / 3 });
  assert.equal(f.toJSON().burn, 0.333);
  assert.equal(f.toJSON().cook, 0.667);
});

test('the store makes furnaces by id and works them all on game time', () => {
  const storage = memory();
  const furnaces = new Furnaces({ storage, seed: 1 });
  assert.equal(furnaces.key, `${FURNACE_KEY}-1`);
  const near = furnaces.get('r:spawn:11');
  assert.strictEqual(furnaces.get('r:spawn:11'), near);
  for (const id of ['', 'x'.repeat(65), 7, null]) assert.throws(() => furnaces.get(id), TypeError);
  assert.ok(furnaces.get('x'.repeat(64)));
  const far = furnaces.get('s:7');
  Object.assign(far, { input: { id: 'rawCopper', count: 2 }, fuel: { id: 'coal', count: 1 } });
  near.input = { id: 'rawIron', count: 1 };
  near.fuel = { id: 'coal', count: 1 };
  assert.equal(furnaces.lit('s:7'), false);
  furnaces.update(1);
  assert.equal(furnaces.lit('s:7'), true);
  assert.equal(furnaces.lit('r:spawn:11'), true);
  assert.equal(furnaces.lit('nowhere'), false);
  furnaces.update(19);
  assert.deepEqual(far.output, { id: 'copperIngot', count: 2 });
  assert.deepEqual(near.output, { id: 'ironIngot', count: 1 });
});

test('the store saves contents at once and progress every two seconds', () => {
  const storage = memory();
  const furnaces = new Furnaces({ storage, seed: 3 });
  furnaces.update(5);
  assert.equal(storage.writes, 0, 'nothing to keep, nothing written');
  const f = furnaces.get('a');
  Object.assign(f, { input: { id: 'rawIron', count: 2 }, fuel: { id: 'coal', count: 1 } });
  furnaces.update(0.5);
  assert.equal(storage.writes, 1, 'lighting the coal changed a slot');
  furnaces.update(1);
  assert.equal(storage.writes, 1);
  furnaces.update(1);
  assert.equal(storage.writes, 2, 'progress after two seconds');
  furnaces.update(NaN);
  assert.equal(storage.writes, 2);
  furnaces.update(7.5);
  assert.equal(storage.writes, 3, 'an ingot changed a slot');
  const saved = JSON.parse(storage.getItem('ascii-realm-furnaces-3'));
  assert.equal(saved.v, 1);
  assert.deepEqual(saved.furnaces.a.output, { id: 'ironIngot', count: 1 });
  assert.deepEqual(snapshot(new Furnaces({ storage, seed: 3 }).get('a')), saved.furnaces.a);
  assert.deepEqual(new Furnaces({ storage, seed: 4 }).states.size, 0, 'another world has its own furnaces');
});

test('bag moves through the store survive an immediate reload', () => {
  const storage = memory();
  const furnaces = new Furnaces({ storage, seed: 1 });
  const inventory = bag({ id: 'rawIron', count: 6 }, { id: 'rawTin', count: 1 });
  assert.equal(furnaces.putIn('r:spawn:11', inventory, 0).ok, true);
  assert.equal(furnaces.putIn('r:spawn:11', inventory, 1).ok, false);
  assert.equal(storage.writes, 1);
  assert.deepEqual(new Furnaces({ storage, seed: 1 }).get('r:spawn:11').input, { id: 'rawIron', count: 6 });
  assert.equal(furnaces.takeOut('r:spawn:11', 'input', inventory).message, 'Took Raw Iron x6.');
  assert.equal(new Furnaces({ storage, seed: 1 }).states.size, 0, 'an emptied furnace is not kept');
});

test('at most 32 furnaces: an idle one makes way, else a new one is refused', () => {
  const storage = memory();
  const furnaces = new Furnaces({ storage, seed: 1 });
  for (let i = 0; i < 32; i++) furnaces.get(`s:${i}`).fuel = { id: 'coal', count: 1 };
  assert.equal(furnaces.get('s:new'), null);
  const refused = furnaces.putIn('s:new', bag({ id: 'coal', count: 1 }), 0);
  assert.equal(refused.status, 'busy');
  assert.equal(refused.message, "This furnace can't be used: too many furnaces are busy.");
  furnaces.save();
  const reloaded = new Furnaces({ storage, seed: 1 });
  assert.equal(reloaded.states.size, 32);
  assert.deepEqual(snapshot(reloaded.get('s:31')), snapshot(furnaces.get('s:31')));

  furnaces.get('s:5').fuel = null;
  const made = furnaces.get('s:new');
  assert.ok(made);
  assert.equal(furnaces.states.has('s:5'), false);
  assert.equal(furnaces.states.size, 32);
});

test('bad saves load nothing, bad entries only themselves', () => {
  const good = { input: null, fuel: { id: 'coal', count: 1 }, output: null, burn: 0, burnTotal: 0, cook: 0 };
  const key = 'ascii-realm-furnaces-1';
  const loaded = (value) => new Furnaces({ storage: memory({ [key]: value }), seed: 1 }).states;
  assert.deepEqual([...loaded(JSON.stringify({ v: 1, furnaces: { a: good, b: { ...good, cook: 11 }, ['x'.repeat(65)]: good } })).keys()], ['a']);
  for (const value of ['{', JSON.stringify({ v: 2, furnaces: { a: good } }), JSON.stringify({ v: 1 }),
    JSON.stringify({ v: 1, furnaces: 'a' }), 'null']) assert.equal(loaded(value).size, 0, value);
  const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`s:${i}`, good]));
  assert.equal(loaded(JSON.stringify({ v: 1, furnaces: many })).size, 32);

  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('full'); } };
  const furnaces = new Furnaces({ storage: throwing, seed: 1 });
  assert.equal(furnaces.states.size, 0);
  furnaces.get('a').fuel = { id: 'coal', count: 1 };
  assert.doesNotThrow(() => furnaces.save());
  assert.doesNotThrow(() => new Furnaces({ storage: null, seed: 1 }).save());
});

test('the store falls back to the page storage, or none', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    const storage = memory();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => storage });
    assert.strictEqual(new Furnaces({ seed: 1 }).storage, storage);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('blocked'); } });
    assert.equal(new Furnaces().storage, null);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else delete globalThis.localStorage;
  }
});

test('the screen model shows slots, gauges, status and where each resource goes', () => {
  const inventory = bag(
    { id: 'rawIron', count: 6 }, { id: 'coal', count: 4 }, { id: 'rawTin', count: 1 },
    { id: 'stonePickaxe', count: 1 }, { id: 'deerHide', count: 2 }, null, { id: 'rawCopper', count: 2, material: 'steel' },
  );
  const f = furnace({ input: { id: 'rawIron', count: 6 }, fuel: { id: 'coal', count: 2 }, burn: 52, burnTotal: 80, cook: 4 });
  const model = furnaceScreenModel(f, inventory);
  assert.deepEqual(model.input, { id: 'rawIron', name: 'Raw Iron', count: 6 });
  assert.equal(model.output, null);
  assert.equal(model.flame, 0.65);
  assert.equal(model.arrow, 0.4);
  assert.equal(model.lit, true);
  assert.equal(model.status, 'Burning, 52 s of fuel left · smelting Raw Iron, 40%');
  assert.deepEqual(model.bag, [
    { index: 0, id: 'rawIron', name: 'Raw Iron', count: 6, target: 'input', reason: null },
    { index: 1, id: 'coal', name: 'Coal', count: 4, target: 'fuel', reason: null },
    { index: 2, id: 'rawTin', name: 'Raw Tin', count: 1, target: null, reason: 'Does not smelt' },
    { index: 4, id: 'deerHide', name: 'Deer Hide', count: 2, target: null, reason: 'Not for the furnace' },
    { index: 6, id: 'rawCopper', name: 'Raw Copper', count: 2, target: null, reason: 'Not for the furnace' },
  ]);

  const status = (state) => furnaceScreenModel(furnace(state), bag()).status;
  assert.equal(status({}), 'Nothing to smelt');
  assert.equal(status({ burn: 3.2, burnTotal: 80 }), 'Burning, 4 s of fuel left · nothing to smelt');
  assert.equal(status({ input: { id: 'rawIron', count: 1 } }), 'Out of fuel');
  assert.equal(status({ input: { id: 'rawIron', count: 1 }, fuel: { id: 'coal', count: 1 } }), 'Lighting the fuel');
  assert.equal(status({ input: { id: 'rawIron', count: 1 }, output: { id: 'ironIngot', count: 64 } }), 'Output full');
  assert.equal(status({ input: { id: 'rawIron', count: 1 }, output: { id: 'copperIngot', count: 1 } }),
    'Output holds Copper Ingot');
  assert.equal(furnaceScreenModel(new Furnace(), bag()).flame, 0);
});
