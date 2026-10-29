import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Furnaces } from '../src/crafting/furnace.js';
import { Inventory } from '../src/inventory/inventory.js';
import { FurnaceScreen } from '../src/ui/furnace.js';
import { InventoryScreen } from '../src/ui/inventory.js';
import { installBrowser } from './helpers/station-dom.js';

const ID = 'r:spawn:11';

function mount(t, { items = [['rawIron', 6], ['coal', 2], ['rawTin', 1], ['stonePickaxe', 1]], browser = {},
  bag = null } = {}) {
  const env = installBrowser(t, browser);
  // The inventory's root, which the game makes first.
  const root = env.document.createElement('div');
  root.id = 'inventory-root';
  env.document.body.append(root);
  const inventory = new Inventory({ starter: false });
  for (const [id, count] of items) inventory.add(id, count);
  const saves = [];
  const storage = { getItem: () => null, setItem: (key, value) => saves.push([key, value]) };
  const furnaces = new Furnaces({ storage, seed: 1 });
  // The bag, made before the furnace screen as main.js does, so its key
  // listener runs first.
  let screen;
  const satchel = bag && new InventoryScreen({ inventory: new Inventory({ starter: false }),
    player: { vitals: { health: 1, maxHealth: 1, stamina: 1, maxStamina: 1 } },
    isCovered: () => bag(screen) });
  const toggles = [];
  const notes = [];
  screen = new FurnaceScreen({ furnaces, inventory, onToggle: (open) => toggles.push(open),
    onNotify: (message, kind) => notes.push([message, kind]) });
  // Game controls listen after the screen, as main.js does.
  const gameKeys = [];
  env.window.addEventListener('keydown', (event) => gameKeys.push(event.code));
  env.window.addEventListener('keyup', (event) => gameKeys.push(`up:${event.code}`));
  const press = (code, { type = 'keydown', target = env.document.activeElement, ...fields } = {}) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { code, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, repeat: false, ...fields });
    Object.defineProperty(event, 'target', { value: target });
    const before = gameKeys.length;
    env.window.dispatchEvent(event);
    return { prevented: event.defaultPrevented, reachedGame: gameKeys.length > before };
  };
  const rows = () => screen.list.children;
  const row = (name) => rows().find((node) => node.getAttribute('aria-label').startsWith(name));
  // A tap: a pointer click, long after the screen opened.
  const tap = (node) => {
    env.clock.now += 1000;
    return node.dispatch('click', { detail: 1 });
  };
  return { ...env, screen, satchel, furnaces, inventory, toggles, notes, saves, gameKeys, press, rows, row, tap,
    furnace: () => furnaces.get(ID) };
}

test('opening the furnace blocks the scene and closing gives the canvas focus back', (t) => {
  const { document, screen, toggles } = mount(t);
  const canvas = document.getElementById('screen');
  const hud = document.getElementById('hud-root');
  assert.equal(screen.root.id, 'inventory-root');
  assert.equal(screen.screen.hidden, true);
  for (const [name, value] of [['role', 'dialog'], ['aria-modal', 'true'], ['aria-labelledby', 'furnace-title'],
    ['aria-describedby', 'furnace-help']]) assert.equal(screen.screen.getAttribute(name), value);
  assert.equal(document.getElementById('furnace-title').textContent, 'Furnace');
  assert.ok(document.getElementById('furnace-help').textContent.includes('Put in / take out'));
  screen.close();
  assert.deepEqual(toggles, [], 'closing a shut screen does nothing');
  assert.equal(screen.open(ID), true);
  assert.equal(screen.isOpen, true);
  assert.equal(screen.screen.hidden, false);
  assert.ok(document.body.classList.contains('station-open'));
  assert.ok(screen.root.classList.contains('is-open'));
  assert.equal(canvas.inert, true);
  assert.equal(hud.inert, true);
  assert.equal(document.activeElement, screen.rows[0], 'the first row that can go in');
  // Opening again keeps it open and refreshes it.
  assert.equal(screen.open(ID), true);
  assert.deepEqual(toggles, [true]);
  screen.close();
  assert.deepEqual(toggles, [true, false]);
  assert.equal(screen.screen.hidden, true);
  assert.ok(!document.body.classList.contains('station-open'));
  assert.equal(canvas.inert, false);
  assert.equal(document.activeElement, canvas);
});

test('without a canvas the focus goes back where it was; with nothing to load, to the input', (t) => {
  const { document, screen } = mount(t, { items: [['rawTin', 1]], browser: { canvas: false, hud: false } });
  const before = document.createElement('button');
  document.body.append(before);
  before.focus();
  screen.open(ID);
  assert.equal(document.activeElement, screen.slots.input);
  screen.close();
  assert.equal(document.activeElement, before);
});

test('a furnace that cannot be kept is refused with a message', (t) => {
  const { screen, furnaces, notes, toggles } = mount(t);
  furnaces.get = () => null;
  assert.equal(screen.open(ID), false);
  assert.equal(screen.isOpen, false);
  assert.deepEqual(toggles, []);
  assert.deepEqual(notes, [["This furnace can't be used: too many furnaces are busy.", 'error']]);
});

test('slots and satchel rows say what they hold and where things go', (t) => {
  const { screen, rows, furnace } = mount(t);
  screen.open(ID);
  assert.equal(screen.slots.input.getAttribute('aria-label'), 'Input: empty. Choose ore from your satchel.');
  assert.equal(screen.slots.fuel.getAttribute('aria-label'), 'Fuel: empty. Choose fuel from your satchel.');
  assert.equal(screen.slots.output.getAttribute('aria-label'), 'Output: empty. Smelted ingots come out here.');
  assert.ok(screen.slots.input.classList.contains('empty'));
  // Resources only: the pickaxe is left out.
  assert.deepEqual(rows().map((node) => node.getAttribute('aria-label')), [
    'Raw Iron, 6. Put in the input.', 'Coal, 2. Put in the fuel slot.', 'Raw Tin, 1. Does not smelt.']);
  assert.deepEqual(rows().map((node) => node.textContent.split('x').at(-1)), ['6→ Input', '2→ Fuel', '1Does not smelt']);
  assert.equal(rows()[2].getAttribute('aria-disabled'), 'true');
  assert.equal(rows()[0].getAttribute('aria-disabled'), null);
  assert.equal(screen.empty.hidden, true);
  assert.equal(screen.status.textContent, 'Nothing to smelt');
  Object.assign(furnace(), { input: { id: 'rawIron', count: 6 }, output: { id: 'ironIngot', count: 3 } });
  screen.update();
  assert.equal(screen.slots.input.getAttribute('aria-label'), 'Input: Raw Iron, 6. Press to take back.');
  assert.equal(screen.slots.output.getAttribute('aria-label'), 'Output: Iron Ingot, 3. Press to take.');
  assert.equal(screen.slots.output.count.textContent, 'x3');
  assert.ok(screen.slots.output.art.textContent.length > 10, 'the ingot is drawn');
  assert.ok(!screen.slots.output.classList.contains('empty'));
});

test('the satchel says so when nothing in it smelts or burns', (t) => {
  const { screen, rows } = mount(t, { items: [['stonePickaxe', 1]] });
  screen.open(ID);
  assert.equal(rows().length, 0);
  assert.equal(screen.empty.hidden, false);
  assert.equal(screen.empty.textContent,
    'Nothing in your satchel smelts or burns. Mine iron, copper and coal from ore veins.');
});

test('tapping rows loads them, tapping slots takes them back, and each says so', (t) => {
  const { screen, row, tap, furnace, inventory, notes, saves, clock } = mount(t);
  screen.open(ID);
  tap(row('Raw Iron'));
  tap(row('Coal'));
  assert.deepEqual(furnace().input, { id: 'rawIron', count: 6 });
  assert.deepEqual(furnace().fuel, { id: 'coal', count: 2 });
  assert.equal(screen.feedback.textContent, 'Added Coal x2 as fuel.');
  assert.equal(screen.feedback.getAttribute('role'), 'status');
  assert.equal(screen.feedback.hidden, false);
  assert.equal(saves.length, 2, 'each move is saved at once');
  tap(row('Raw Tin'));
  assert.equal(screen.feedback.textContent, 'Raw Tin does not smelt.');
  assert.equal(screen.feedback.dataset.kind, 'error');
  tap(screen.slots.fuel);
  assert.equal(furnace().fuel, null);
  assert.equal(inventory.slots.reduce((n, stack) => n + (stack?.id === 'coal' ? stack.count : 0), 0), 2);
  assert.deepEqual(notes.map(([message]) => message), ['Put Raw Iron x6 in the furnace.', 'Added Coal x2 as fuel.',
    'Raw Tin does not smelt.', 'Took Coal x2.']);
  tap(screen.slots.output);
  assert.equal(screen.feedback.textContent, 'Nothing to take.');
  // The line goes after a few seconds.
  clock.now += 3600;
  screen.update();
  assert.equal(screen.feedback.hidden, true);
});

test('the tap that opened the screen does not also press what lands under it', (t) => {
  const { screen, row, furnace, clock } = mount(t);
  screen.open(ID);
  row('Raw Iron').dispatch('click', { detail: 1 });
  assert.equal(furnace().input, null);
  // A keyboard or screen reader press has no pointer detail and works at once.
  row('Raw Iron').dispatch('click', { detail: 0 });
  assert.deepEqual(furnace().input, { id: 'rawIron', count: 6 });
  clock.now += 600;
  screen.closeButton.dispatch('click', { detail: 1 });
  assert.equal(screen.isOpen, false);
});

test('the gauges move with the furnace, their spoken values in whole steps', (t) => {
  const { screen, row, tap, furnace, furnaces } = mount(t);
  screen.open(ID);
  assert.equal(screen.flame.getAttribute('role'), 'progressbar');
  assert.equal(screen.flame.getAttribute('aria-valuetext'), 'Out of fuel');
  assert.equal(screen.flame.textContent, ' . \n . \n . ');
  assert.equal(screen.arrow.textContent, '[>          ]');
  tap(row('Raw Iron'));
  tap(row('Coal'));
  furnaces.update(4.05);
  screen.update();
  assert.equal(screen.flame.textContent, ' ^ \n(^)\n/^\\');
  assert.ok(screen.flame.classList.contains('lit'));
  assert.equal(screen.flame.getAttribute('aria-valuetext'), '76 seconds of fuel left');
  assert.equal(screen.flame.getAttribute('aria-valuenow'), '95');
  assert.equal(screen.arrow.textContent, '[====>      ]');
  assert.equal(screen.arrow.getAttribute('aria-valuenow'), '40');
  assert.equal(screen.arrow.getAttribute('aria-valuetext'), '40 percent');
  assert.equal(screen.status.textContent, 'Burning, 76 s of fuel left · smelting Raw Iron, 40%');
  // Within the same second and step, nothing spoken changes.
  const set = [];
  for (const node of [screen.flame, screen.arrow]) {
    const original = node.setAttribute.bind(node);
    node.setAttribute = (name, value) => { set.push(name); original(name, value); };
  }
  furnaces.update(0.1);
  screen.update();
  assert.deepEqual(set, []);
  assert.equal(screen.status.textContent, 'Burning, 76 s of fuel left · smelting Raw Iron, 41%');
  furnaces.update(1);
  screen.update();
  assert.deepEqual(set.sort(), ['aria-valuenow', 'aria-valuetext', 'aria-valuenow', 'aria-valuetext'].sort());
  // The burn runs low: the flame shows less.
  furnace().burn = 20;
  screen.update();
  assert.equal(screen.flame.textContent, ' . \n . \n/^\\');
});

test('the screen touches the page only when something changed', (t) => {
  const { screen, rows } = mount(t);
  screen.open(ID);
  const first = rows()[0];
  const status = screen.status;
  let writes = 0;
  const original = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(status), 'textContent');
  Object.defineProperty(status, 'textContent', { get: () => original.get.call(status),
    set: (value) => { writes++; original.set.call(status, value); } });
  screen.update();
  screen.update();
  assert.equal(writes, 0);
  assert.equal(rows()[0], first, 'the rows are kept');
  screen.close();
  screen.update();
  assert.equal(writes, 0, 'a shut screen does nothing');
});

test('arrows and Tab move through the slots, rows and Close, and Enter or Space presses', (t) => {
  const { document, screen, press, furnace, rows } = mount(t);
  screen.open(ID);
  const order = [screen.slots.input, screen.slots.fuel, screen.slots.output, ...rows(), screen.closeButton];
  assert.equal(document.activeElement, order[3]);
  assert.deepEqual(press('ArrowDown'), { prevented: true, reachedGame: false });
  assert.equal(document.activeElement, order[4]);
  press('ArrowRight');
  press('Tab');
  assert.equal(document.activeElement, order[6], 'Close');
  press('Tab');
  assert.equal(document.activeElement, order[0], 'Tab wraps round');
  press('Tab', { shiftKey: true });
  assert.equal(document.activeElement, order[6]);
  press('ArrowUp');
  press('ArrowLeft');
  assert.equal(document.activeElement, order[4]);
  // Coal goes in; its row is gone and the focus stays at the same place.
  press('Enter');
  assert.deepEqual(furnace().fuel, { id: 'coal', count: 2 });
  assert.equal(document.activeElement, rows()[1]);
  press('Space', { repeat: true });
  assert.equal(furnace().input, null, 'a held key presses once');
  press('ArrowUp');
  press('NumpadEnter');
  assert.deepEqual(furnace().input, { id: 'rawIron', count: 6 });
  // The last row went in: the focus falls back to the input.
  screen.close();
  screen.open(ID);
  document.body.focus();
  press('ArrowUp');
  assert.equal(document.activeElement, screen.closeButton, 'from outside, up is the last control');
  document.body.focus();
  press('ArrowDown');
  assert.equal(document.activeElement, screen.slots.input);
  press('Enter', { target: document.body });
  assert.equal(furnace().input, null, 'Enter takes the input back');
});

test('the last satchel row going in leaves the focus on the input slot', (t) => {
  const { document, screen, press } = mount(t, { items: [['coal', 1]] });
  screen.open(ID);
  press('Enter');
  assert.equal(document.activeElement, screen.slots.input);
});

test('Escape and E close it; no key reaches the game, browser shortcuts still work', (t) => {
  const { screen, press, toggles, gameKeys } = mount(t);
  assert.equal(press('KeyW').reachedGame, true, 'shut, keys go to the game');
  screen.open(ID);
  assert.deepEqual(press('KeyW'), { prevented: true, reachedGame: false });
  assert.deepEqual(press('KeyW', { type: 'keyup' }), { prevented: false, reachedGame: false });
  assert.deepEqual(press('KeyR', { ctrlKey: true }), { prevented: false, reachedGame: false });
  press('Escape', { repeat: true });
  assert.equal(screen.isOpen, true, 'a held Escape does not close it');
  press('Escape');
  assert.equal(screen.isOpen, false);
  assert.equal(press('Escape', { type: 'keyup' }).reachedGame, false, 'its key-up is kept too');
  assert.equal(press('KeyW', { type: 'keyup' }).reachedGame, true);
  screen.open(ID);
  press('KeyE');
  assert.equal(screen.isOpen, false);
  assert.deepEqual(toggles, [true, false, true, false]);
  // A key already handled elsewhere is left alone.
  screen.open(ID);
  const before = gameKeys.length;
  const handled = new Event('keydown', { cancelable: true });
  Object.assign(handled, { code: 'KeyW' });
  handled.preventDefault();
  screen._handleKeydown(handled);
  assert.equal(gameKeys.length, before);
});

test('the bag cannot open over the furnace', (t) => {
  let guarded = true;
  const { screen, satchel: bag, press } = mount(t, { bag: (furnace) => guarded && furnace.isOpen });
  screen.open(ID);
  press('KeyI');
  assert.equal(bag.isOpen, false);
  assert.equal(screen.isOpen, true);
  screen.close();
  press('KeyI');
  assert.equal(bag.isOpen, true);
  press('KeyI');
  // The bag hears keys first, so only its cover check keeps it shut.
  guarded = false;
  screen.open(ID);
  press('KeyI');
  assert.equal(bag.isOpen, true, 'unguarded, the bag would open over the furnace');
});
