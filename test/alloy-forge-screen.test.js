import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AlloyBook } from '../src/crafting/alloy-book.js';
import { Inventory } from '../src/inventory/inventory.js';
import { AlloyForgeScreen } from '../src/ui/alloy-forge.js';
import { installBrowser } from './helpers/station-dom.js';

const ID = 'r:spawn:12';
const count = (inventory, id) => inventory.slots.reduce((sum, stack) => sum + (stack?.id === id ? stack.count : 0), 0);

function mount(t, { items = [['ironIngot', 3], ['rawTin', 2], ['lapisLazuli', 1], ['coal', 2], ['stonePickaxe', 1]] } = {}) {
  const env = installBrowser(t);
  const root = env.document.createElement('div');
  root.id = 'inventory-root';
  env.document.body.append(root);
  const inventory = new Inventory({ starter: false });
  for (const [id, count] of items) inventory.add(id, count);
  const saves = [];
  const book = new AlloyBook({ storage: { getItem: () => null, setItem: (key, value) => saves.push([key, value]) }, seed: 1 });
  const toggles = [];
  const notes = [];
  const discoveries = [];
  const screen = new AlloyForgeScreen({ book, inventory, random: () => 0, onToggle: (open) => toggles.push(open),
    onNotify: (message, kind) => notes.push([message, kind]), onDiscover: (id, alloy) => discoveries.push([id, alloy.name]) });
  const gameKeys = [];
  env.window.addEventListener('keydown', (event) => gameKeys.push(event.code));
  const press = (code, { target = env.document.activeElement, ...fields } = {}) => {
    const event = new Event('keydown', { cancelable: true });
    Object.assign(event, { code, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, repeat: false, ...fields });
    Object.defineProperty(event, 'target', { value: target });
    const before = gameKeys.length;
    env.window.dispatchEvent(event);
    return { prevented: event.defaultPrevented, reachedGame: gameKeys.length > before };
  };
  const row = (name) => screen.list.children.find((node) => node.getAttribute('aria-label').startsWith(name));
  const tap = (node) => {
    env.clock.now += 1000;
    return node.dispatch('click', { detail: 1 });
  };
  // Loads Iron Ingot then Raw Tin and fires them into Ferranite.
  const discover = () => {
    tap(row('Iron Ingot'));
    tap(row('Raw Tin'));
    tap(screen.fire);
  };
  return { ...env, screen, book, inventory, toggles, notes, discoveries, saves, gameKeys, press, row, tap, discover,
    forge: () => book.forge(ID) };
}

test('the forge screen is a dialog over the scene, with five empty slots and nothing to fire', (t) => {
  const { document, screen, toggles, row } = mount(t);
  assert.equal(screen.open(ID), true);
  for (const [name, value] of [['role', 'dialog'], ['aria-modal', 'true'], ['aria-labelledby', 'forge-title'],
    ['aria-describedby', 'forge-help']]) assert.equal(screen.screen.getAttribute(name), value);
  assert.ok(screen.screen.classList.contains('forge-screen'));
  assert.equal(document.getElementById('forge-title').textContent, 'Alloy forge');
  assert.equal(screen.closeButton.getAttribute('aria-label'), 'Close the alloy forge');
  assert.equal(document.getElementById('forge-help').textContent, 'EnterAdd / pressArrowsMoveEscClose');
  assert.ok(document.body.classList.contains('station-open'));
  assert.equal(document.getElementById('screen').inert, true);
  assert.deepEqual(toggles, [true]);
  assert.deepEqual(screen.slots.map((node) => node.getAttribute('aria-label')),
    ['Base: empty', 'Catalyst 1: empty', 'Catalyst 2: empty', 'Catalyst 3: empty', 'Catalyst 4: empty']);
  assert.deepEqual(screen.slots.map((node) => node.caption.textContent), ['Base', 'Catalyst', 'Catalyst', 'Catalyst', 'Catalyst']);
  assert.equal(screen.status.textContent, 'Base 0/1 · Catalysts 0/4');
  assert.equal(screen.result.textContent, 'Add a base and a catalyst');
  assert.equal(screen.fire.textContent, 'Fire · 1 Coal (2)');
  assert.equal(screen.fire.getAttribute('aria-disabled'), 'true');
  assert.equal(screen.emptyButton.getAttribute('aria-disabled'), 'true');
  assert.equal(screen.take.hidden, true);
  assert.equal(screen.naming.hidden, true);
  assert.equal(screen.knownTitle.textContent, 'Known alloys (0)');
  assert.equal(screen.known.hidden, true);
  assert.equal(screen.knownEmpty.hidden, false);
  // Ingredients, alloy ingots and scrap only: the pickaxe is left out.
  assert.deepEqual(screen.list.children.map((node) => node.getAttribute('aria-label')), [
    'Iron Ingot, 3. Put in the base slot.', 'Raw Tin, 2. Can\'t be the base.', 'Lapis Lazuli, 1. Can\'t be the base.']);
  assert.equal(row('Raw Tin').getAttribute('aria-disabled'), 'true');
  assert.equal(document.activeElement, row('Iron Ingot'), 'the first row that can go in');
  screen.close();
  assert.equal(screen.isOpen, false);
  assert.equal(document.activeElement, document.getElementById('screen'));
});

test('a forge that cannot be kept is refused, and an empty satchel says what goes in', (t) => {
  const { screen, book, notes, document } = mount(t, { items: [['stonePickaxe', 1]] });
  const forge = book.forge;
  book.forge = () => null;
  assert.equal(screen.open(ID), false);
  assert.deepEqual(notes, [["This alloy forge can't be used: too many forges are busy.", 'error']]);
  book.forge = forge;
  screen.open(ID);
  assert.equal(screen.list.children.length, 0);
  assert.equal(screen.empty.hidden, false);
  assert.match(screen.empty.textContent, /^Nothing in your satchel goes in the forge\./);
  assert.equal(document.activeElement, screen.fire, 'with nothing to add, Fire');
});

test('rows load one unit each, refusals say why, and Fire and Empty work only when they can', (t) => {
  const { screen, row, tap, forge, inventory, notes, saves } = mount(t);
  screen.open(ID);
  tap(row('Raw Tin'));
  assert.deepEqual(notes.at(-1), ['This ingredient cannot be used as the base.', 'error']);
  tap(screen.fire);
  assert.deepEqual(notes.at(-1), ['You need at least 2 ingredients to make an alloy.', 'error']);
  tap(screen.emptyButton);
  assert.deepEqual(notes.at(-1), ['The forge is empty.', 'error']);
  assert.equal(saves.length, 0, 'nothing is saved for a refusal');
  tap(row('Iron Ingot'));
  assert.equal(screen.feedback.textContent, 'Added Iron Ingot. Base 1/1 · Catalysts 0/4');
  assert.equal(screen.feedback.hidden, false);
  assert.equal(forge().base, 'ironIngot');
  assert.equal(count(inventory, 'ironIngot'), 2);
  assert.equal(screen.slots[0].getAttribute('aria-label'), 'Base: Iron Ingot');
  assert.equal(screen.slots[0].caption.textContent, 'Iron Ingot');
  assert.ok(screen.slots[0].art.textContent.length > 10, 'the ingot is drawn');
  assert.ok(!screen.slots[0].classList.contains('empty'));
  assert.equal(row('Raw Tin').getAttribute('aria-label'), 'Raw Tin, 2. Put in a catalyst slot.');
  tap(row('Raw Tin'));
  assert.equal(screen.status.textContent, 'Base 1/1 · Catalysts 1/4');
  assert.equal(screen.result.textContent, 'Result: Unknown mix');
  assert.equal(screen.fire.getAttribute('aria-disabled'), 'false');
  assert.equal(screen.emptyButton.getAttribute('aria-disabled'), 'false');
  tap(screen.emptyButton);
  assert.equal(screen.feedback.textContent, 'Took back Raw Tin, Iron Ingot.');
  assert.equal(count(inventory, 'ironIngot'), 3);
  assert.equal(saves.length, 3);
});

test('a discovery opens the naming row with its burst, and renaming closes it', (t) => {
  const { screen, discover, notes, discoveries, document, book, inventory } = mount(t);
  screen.open(ID);
  discover();
  assert.deepEqual(notes.at(-1), ['You discovered Ferranite!', 'discovery']);
  assert.deepEqual(discoveries, [[ID, 'Ferranite']]);
  assert.equal(count(inventory, 'alloyIngot'), 1);
  assert.equal(screen.naming.hidden, false);
  assert.equal(screen.discovered.textContent, 'You discovered Ferranite!');
  assert.equal(screen.discovered.children[1].style.color, `#${book.get('a1').colour}`);
  assert.equal(screen.countdown.textContent, 'Name it within 60 s');
  assert.equal(screen.naming.children[0].textContent, '\\ | /\n- * -\n/ | \\');
  assert.equal(screen.nameInput.value, 'Ferranite');
  assert.equal(document.activeElement, screen.nameInput);
  assert.equal(screen.nameInput.selected, true);
  screen.nameInput.dispatch('focus');
  assert.deepEqual(screen.nameInput.scrolls, [{ block: 'center' }], 'kept above a phone keyboard');
  book.update(1.5);
  screen.update();
  assert.equal(screen.countdown.textContent, 'Name it within 59 s');
  assert.equal(screen.knownTitle.textContent, 'Known alloys (1)');
  const [item] = screen.known.children;
  assert.equal(item.textContent, '[####]FerraniteIron Ingot + Raw TinAttack Damage 3.15 · Blunt Rating 45 · Durability 450');
  assert.equal(item.children[0].getAttribute('aria-hidden'), 'true');
  assert.equal(item.children[0].style.color, `#${book.get('a1').colour}`);
  // A bad name is refused and the row stays.
  screen.nameInput.value = 'Moon Iron';
  assert.equal(screen.naming.dispatch('submit').defaultPrevented, true);
  assert.deepEqual(notes.at(-1), ['Name can only contain letters (A–Z) and underscores (_).', 'error']);
  assert.equal(screen.naming.hidden, false);
  screen.nameInput.value = 'Moon_Iron';
  screen.naming.dispatch('submit');
  assert.deepEqual(notes.at(-1), ['Named the new alloy Moon Iron.', 'info']);
  assert.equal(screen.naming.hidden, true);
  assert.equal(screen.known.children[0].children[1].textContent, 'Moon Iron');
  assert.equal(screen.known.hidden, false);
  assert.equal(screen.knownEmpty.hidden, true);
  // The ingot in the satchel goes by its alloy's name.
  assert.equal(screen.list.children.at(-1).getAttribute('aria-label'), 'Moon Iron, 1. Not an ingredient.');
});

test('Rename and Keep name are buttons too, and the window running out closes the row', (t) => {
  const { screen, discover, notes, tap, book } = mount(t, { items: [['ironIngot', 3], ['rawTin', 2],
    ['lapisLazuli', 1], ['copperIngot', 1], ['coal', 3]] });
  screen.open(ID);
  discover();
  screen.nameInput.value = 'Blackiron';
  tap(screen.renameButton);
  assert.deepEqual(notes.at(-1), ['Named the new alloy Blackiron.', 'info']);
  tap(screen.list.children[0]);
  const lapis = screen.list.children.find((node) => node.getAttribute('aria-label').startsWith('Lapis'));
  tap(lapis);
  tap(screen.fire);
  assert.equal(screen.naming.hidden, false);
  assert.equal(screen.nameInput.value, 'Ferranite', 'the next alloy\'s name');
  tap(screen.keepButton);
  assert.deepEqual(notes.at(-1), ['Kept the name Ferranite.', 'info']);
  assert.equal(screen.naming.hidden, true);
  tap(screen.list.children[0]);
  tap(screen.list.children.find((node) => node.getAttribute('aria-label').startsWith('Copper')));
  tap(screen.fire);
  assert.equal(screen.naming.hidden, false);
  const timedOut = book.update(61);
  screen.tell(timedOut);
  assert.deepEqual(notes.at(-1), ['Naming timed out.', 'error']);
  assert.equal(screen.feedback.textContent, 'Naming timed out.');
  assert.equal(screen.naming.hidden, true);
});

test('typing in the name field never closes the screen or moves focus; Esc and Tab still do', (t) => {
  const { screen, discover, press, document, book } = mount(t);
  screen.open(ID);
  discover();
  for (const code of ['KeyE', 'KeyI', 'KeyA', 'ArrowLeft', 'ArrowDown', 'Enter', 'Space', 'Backspace']) {
    const { prevented, reachedGame } = press(code);
    assert.equal(prevented, false, `${code} reaches the field`);
    assert.equal(reachedGame, false, `${code} never reaches the game`);
    assert.equal(screen.isOpen, true, code);
    assert.equal(document.activeElement, screen.nameInput, code);
  }
  assert.equal(press('Tab').prevented, true);
  assert.equal(document.activeElement, screen.renameButton);
  press('Tab', { shiftKey: true });
  press('Escape');
  assert.equal(screen.isOpen, false);
  // The window keeps running with the screen shut, and the row is back on reopening.
  book.update(10);
  screen.open(ID);
  assert.equal(screen.naming.hidden, false);
  assert.equal(screen.countdown.textContent, 'Name it within 50 s');
  assert.equal(screen.nameInput.value, 'Ferranite');
});

test('arrows move over every control in order; E closes from a button', (t) => {
  const { screen, discover, press, document, row } = mount(t);
  screen.open(ID);
  discover();
  screen.fire.focus();
  const order = [];
  // Into the name field by arrow, out of it by Tab, as arrows move its caret.
  for (const code of ['ArrowDown', 'ArrowDown', 'Tab', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown']) {
    order.push(document.activeElement);
    press(code);
  }
  const controls = [screen.fire, screen.emptyButton, screen.nameInput, screen.renameButton, screen.keepButton,
    row('Iron Ingot'), row('Raw Tin'), row('Lapis Lazuli'), row('Ferranite')];
  assert.deepEqual(order.map((node) => controls.indexOf(node)), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(document.activeElement, screen.known);
  press('ArrowDown');
  assert.equal(document.activeElement, screen.closeButton);
  press('KeyE');
  assert.equal(screen.isOpen, false);
});

test('a full bag leaves the result in the forge to take', (t) => {
  const { screen, row, tap, inventory, forge, notes } = mount(t, { items: [['ironIngot', 1], ['rawTin', 1], ['coal', 2]] });
  screen.open(ID);
  tap(row('Iron Ingot'));
  tap(row('Raw Tin'));
  for (let i = 0; i < inventory.slots.length; i++) if (!inventory.slots[i]) inventory.slots[i] = { id: 'stonePickaxe', count: 1 };
  tap(screen.fire);
  assert.deepEqual(notes.at(-1), ['You discovered Ferranite! Your bag is full: it waits in the forge.', 'discovery']);
  assert.equal(screen.take.hidden, false);
  assert.equal(screen.take.textContent, 'Take Ferranite');
  assert.match(screen.take.children[1].style.color, /^#[0-9A-F]{6}$/i);
  tap(screen.take);
  assert.deepEqual(notes.at(-1), ['Your bag is full.', 'error']);
  inventory.slots[inventory.slots.length - 1] = null;
  tap(screen.take);
  assert.deepEqual(notes.at(-1), ['Took Ferranite.', 'info']);
  assert.equal(forge().output, null);
  assert.equal(screen.take.hidden, true);
});

test('update touches the page only when something it shows changed', (t) => {
  const { screen, clock, discover, book } = mount(t);
  assert.equal(screen.update(), undefined, 'a shut screen does nothing');
  screen.open(ID);
  const renders = [];
  const known = [];
  const render = screen._render.bind(screen);
  const renderKnown = screen._renderKnown.bind(screen);
  screen._render = (...args) => (renders.push(1), render(...args));
  screen._renderKnown = (...args) => (known.push(1), renderKnown(...args));
  screen.update();
  screen.update();
  assert.deepEqual([renders.length, known.length], [0, 0]);
  discover();
  assert.equal(known.length, 1, 'the list is drawn again once the book has a new alloy');
  book.update(1);
  screen.update();
  assert.equal(known.length, 1, 'but not as the countdown runs');
  clock.now += 4000;
  screen.update();
  assert.equal(screen.feedback.hidden, true, 'the feedback line goes after a while');
});
