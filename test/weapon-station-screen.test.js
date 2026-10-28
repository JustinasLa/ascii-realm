import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AlloyBook } from '../src/crafting/alloy-book.js';
import { Inventory } from '../src/inventory/inventory.js';
import { HIT_GAP_MS, WeaponStationScreen } from '../src/ui/weapon-station.js';
import { installBrowser } from './helpers/station-dom.js';

const ID = 'r:spawn:13';
const count = (inventory, id) => inventory.slots.reduce((sum, stack) => sum + (stack?.id === id ? stack.count : 0), 0);
// Every text and attribute under a node, for the "no needed count" check.
const everything = (node) => [node._text, ...[...node.attributes.values()], ...node.children.flatMap(everything)].join('\n');

function mount(t, { items = [['ironIngot', 3], ['rawTin', 1], ['stonePickaxe', 1]], alloy = 2 } = {}) {
  const env = installBrowser(t);
  const root = env.document.createElement('div');
  root.id = 'inventory-root';
  env.document.body.append(root);
  const inventory = new Inventory({ starter: false, capacity: 1e6 });
  for (const [id, n] of items) inventory.add(id, n);
  if (alloy) inventory.add('alloyIngot', alloy, { alloy: 'a1' });
  const saves = [];
  const book = new AlloyBook({ storage: { getItem: () => null, setItem: (key, value) => saves.push([key, value]) }, seed: 1 });
  book.alloys.set('a1', {
    id: 'a1', name: 'Blackiron', colour: '5E6568', base: 'ironIngot', catalysts: ['rawTin'], type: 'metal', tier: 1,
    stats: { attackDamage: 4.2, bluntRating: 45, durability: 430.4 }, hits: { hit: 1, smallHit: 2, engrave: 3 }, xp: 2,
  });
  const notes = [];
  const hits = [];
  const finishes = [];
  const screen = new WeaponStationScreen({ book, inventory, random: () => 0.6, onToggle: () => {},
    onNotify: (message, kind) => notes.push([message, kind]), onHit: (id, kind) => hits.push([id, kind]),
    onFinish: (id, done) => finishes.push([id, done.name]) });
  const gameKeys = [];
  env.window.addEventListener('keydown', (event) => gameKeys.push(event.code));
  const press = (code, fields = {}) => {
    env.clock.now += 1000;
    const event = new Event('keydown', { cancelable: true });
    Object.assign(event, { code, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, repeat: false, ...fields });
    Object.defineProperty(event, 'target', { value: env.document.activeElement });
    env.window.dispatchEvent(event);
    return event;
  };
  const row = (name) => screen.list.children.find((node) => node.getAttribute('aria-label').startsWith(name));
  const tap = (node) => {
    env.clock.now += 1000;
    return node.dispatch('click', { detail: 1 });
  };
  const recipe = (name) => screen.recipeButtons.find((node) => node.textContent.startsWith(name));
  const bench = () => book.bench(ID);
  // A short sword with three Iron Ingots and a Blackiron loaded.
  const load = () => {
    tap(recipe('Short Sword'));
    for (const name of ['Iron Ingot', 'Iron Ingot', 'Iron Ingot', 'Blackiron']) tap(row(name));
  };
  return { ...env, screen, book, inventory, notes, hits, finishes, saves, gameKeys, press, row, tap, recipe, bench, load };
}

test('idle, the station is a dialog listing the six pieces, and its satchel rows wait for one', (t) => {
  const { document, screen, row, recipe } = mount(t);
  assert.equal(screen.open(ID), true);
  assert.ok(screen.screen.classList.contains('smith-screen'));
  assert.equal(document.getElementById('smith-title').textContent, 'Weapon station');
  assert.equal(screen.closeButton.getAttribute('aria-label'), 'Close the weapon station');
  assert.equal(document.getElementById('smith-help').textContent, '1–6HitEnterAdd / pressArrowsMoveEscClose');
  assert.ok(document.body.classList.contains('station-open'));
  assert.equal(screen.piece.textContent, 'Choose a piece');
  assert.deepEqual(screen.recipeButtons.map((node) => node.textContent), ['Short SwordMetal x4', 'DaggerMetal x4',
    'Battle AxeMetal x4', 'War HammerMetal x4', 'SpearMetal x4', 'GreatswordMetal x8']);
  assert.equal(screen.recipes.hidden, false);
  assert.equal(screen.work.hidden, true);
  assert.equal(screen.take.hidden, true);
  assert.equal(screen.report.hidden, true);
  assert.equal(document.activeElement, recipe('Short Sword'), 'focus on the first piece');
  assert.deepEqual(screen.list.children.map((node) => node.getAttribute('aria-label')),
    ['Iron Ingot, 3. Choose a piece first.', 'Raw Tin, 1. Choose a piece first.', 'Blackiron, 2. Choose a piece first.']);
  assert.equal(row('Blackiron').children[1].style.color, '#5E6568', 'an alloy is named in its colour');
  assert.equal(screen._controls().length, 6 + 3 + 1);
});

test('a station that cannot be kept is refused, and an empty satchel says what can be worked', (t) => {
  const { screen, book, notes } = mount(t, { items: [['stonePickaxe', 1]], alloy: 0 });
  for (let i = 0; i < 32; i++) book.bench(`b${i}`).recipe = 'dagger';
  assert.equal(screen.open(ID), false);
  assert.deepEqual(notes, [["This weapon station can't be used: too many stations are busy.", 'error']]);
  screen.open('b0');
  assert.equal(screen.list.children.length, 0);
  assert.equal(screen.empty.hidden, false);
  assert.match(screen.empty.textContent, /^Nothing in your satchel can be worked\./);
});

test('choosing a piece shows its metal slots; rows load one unit each and refusals say why', (t) => {
  const { screen, row, tap, recipe, bench, inventory, notes, saves, document } = mount(t);
  screen.open(ID);
  tap(recipe('Greatsword'));
  assert.deepEqual(notes.at(-1), ['Recipe Greatsword selected!', 'info']);
  assert.equal(screen.recipes.hidden, true);
  assert.equal(screen.work.hidden, false);
  assert.equal(screen.slots.children.length, 8, 'eight slots for the Greatsword');
  tap(screen.cancel);
  assert.equal(screen.slots.children.length, 0);
  tap(recipe('Short Sword'));
  assert.equal(saves.length, 3);
  assert.equal(screen.piece.textContent, 'Short Sword · Metal 0/4');
  assert.deepEqual(screen.slots.children.map((node) => node.getAttribute('aria-label')),
    ['Metal 1: empty', 'Metal 2: empty', 'Metal 3: empty', 'Metal 4: empty']);
  assert.ok(screen.slots.children.every((node) => node.classList.contains('empty')));
  assert.equal(row('Raw Tin').getAttribute('aria-label'), 'Raw Tin, 1. Not for this piece.');
  assert.equal(row('Iron Ingot').getAttribute('aria-label'), 'Iron Ingot, 3. Put in the piece.');
  assert.equal(row('Iron Ingot').children[3].textContent, '→ Metal');
  tap(row('Raw Tin'));
  assert.deepEqual(notes.at(-1), ['This recipe does not call for that material.', 'error']);
  tap(row('Blackiron'));
  assert.equal(screen.feedback.textContent, 'Added Blackiron. Metal 1/4');
  tap(row('Iron Ingot'));
  assert.equal(count(inventory, 'ironIngot'), 2);
  assert.deepEqual(bench().units, ['a1', 'ironIngot']);
  const [first, second] = screen.slots.children;
  assert.equal(first.getAttribute('aria-label'), 'Metal 1: Blackiron');
  assert.equal(first.children[1].style.color, '#5E6568');
  assert.ok(first.children[0].textContent.length > 10, 'the ingot is drawn');
  assert.equal(second.children[1].textContent, 'Iron Ingot');
  assert.equal(document.activeElement, row('Iron Ingot'), 'focus moved from the hidden pieces to the first row that goes in');
  // Hits and Finish wait for all the metal.
  tap(screen.hitButtons[0]);
  assert.deepEqual(notes.at(-1), ['You only have 2 out of 4 Metal items. You have to add all the items before smithing.', 'error']);
  assert.equal(screen.hitButtons[0].getAttribute('aria-label'), '1 Hit: 0 done. Add all the metal first');
  tap(screen.finish);
  assert.equal(notes.at(-1)[1], 'error');
  assert.equal(screen.finish.getAttribute('aria-label'), 'Finish. Add all the metal first');
});

test('keys 1–6 strike once a press, never on a repeat or a held modifier, and no needed count is shown', (t) => {
  const { screen, load, press, clock, bench, hits, notes, gameKeys, saves } = mount(t);
  screen.open(ID);
  load();
  assert.equal(screen.piece.textContent, 'Short Sword · Metal 4/4');
  assert.equal(screen.finish.getAttribute('aria-disabled'), 'false');
  const before = saves.length;
  press('Digit1');
  press('Numpad1');
  press('Digit2');
  press('Numpad5');
  assert.deepEqual(bench().done, { hit: 2, smallHit: 1, engrave: 1 });
  assert.deepEqual(hits, [[ID, 'hit'], [ID, 'hit'], [ID, 'smallHit'], [ID, 'engrave']]);
  assert.equal(saves.length, before, 'hits are saved later, by the book');
  assert.equal(screen.feedback.textContent, '+1 Engrave');
  assert.equal(notes.filter(([message]) => message.startsWith('+1')).length, 0, 'a hit makes no toast');
  assert.deepEqual(gameKeys, [], 'no key reaches the game');
  // Sparks over the anvil, gone after a moment.
  assert.ok(screen.anvil.classList.contains('struck'));
  assert.match(screen.anvil.textContent, /\*/);
  clock.now += 200;
  screen.update();
  assert.ok(!screen.anvil.classList.contains('struck'));
  assert.doesNotMatch(screen.anvil.textContent, /\*/);
  // A repeat, a modifier, or a second press too soon don't count.
  press('Digit1', { repeat: true });
  press('Digit1', { ctrlKey: true });
  press('Digit1');
  clock.now += HIT_GAP_MS - 1;
  screen._hit('hit');
  assert.equal(bench().done.hit, 3);
  // Whittle isn't needed: Blackiron needs engrave, so etch and sew may strike, but iron alone wouldn't.
  press('Digit4');
  assert.equal(bench().done.whittle, 1);
  screen.update();
  assert.deepEqual(screen.hitButtons.map((node) => node.count.textContent), ['3', '1', '0', '1', '1', '0']);
  assert.deepEqual(screen.hitButtons.map((node) => node.children[1].textContent),
    ['Hit', 'Small Hit', 'Etch', 'Whittle', 'Engrave', 'Sew']);
  assert.equal(screen.total.textContent, 'Total 6');
  // The piece needs Hit 13 (3 × 4 + 1), and that number is nowhere in the dialog.
  assert.doesNotMatch(everything(screen.screen), /\b13\b/);
});

test('a hit kind the piece does not need is refused with its reason', (t) => {
  const { screen, tap, recipe, row, press, notes } = mount(t, { items: [['ironIngot', 4]], alloy: 0 });
  screen.open(ID);
  tap(recipe('Dagger'));
  for (let i = 0; i < 4; i++) tap(row('Iron Ingot'));
  press('Digit3');
  assert.deepEqual(notes.at(-1), ['This tool is not needed for this craft.', 'error']);
  assert.equal(screen.hitButtons[2].getAttribute('aria-disabled'), 'true');
  assert.equal(screen.hitButtons[2].getAttribute('aria-label'), '3 Etch: 0 done. Not needed for this piece');
});

test('Finish shows the report until a new piece is chosen; Cancel gives the metal back', (t) => {
  const { screen, tap, load, recipe, press, inventory, notes, finishes, document } = mount(t, { items: [['ironIngot', 6]] });
  screen.open(ID);
  load();
  for (let i = 0; i < 13; i++) press('Digit1');
  tap(screen.finish);
  assert.deepEqual(finishes, [[ID, 'Iron Short Sword']]);
  assert.deepEqual(notes.at(-1), ['You made an Iron Short Sword.', 'info']);
  assert.equal(screen.report.hidden, false);
  assert.equal(screen.report.getAttribute('role'), 'status');
  const lines = screen.report.children.map((node) => node.textContent);
  assert.equal(lines[0], 'Hit Percentage: 33%');
  assert.deepEqual(lines.slice(1, 3), ['Quality: Rusted', 'Craft roll: 13 (+0) = 13']);
  assert.match(lines[3], /^Looking the piece over, you sense it needed/);
  assert.equal(count(inventory, 'shortSword'), 1);
  assert.equal(screen.recipes.hidden, false, 'the pieces again, below the report');
  assert.equal(document.activeElement.isConnected, true);
  // The report stays on a redraw and goes with the next piece.
  screen.update();
  assert.equal(screen.report.hidden, false);
  tap(recipe('Dagger'));
  assert.equal(screen.report.hidden, true);
  tap(screen.cancel);
  assert.deepEqual(notes.at(-1), ['Project cancelled.', 'info']);
  tap(screen.cancel);
  assert.deepEqual(notes.at(-1), ['There is no project to cancel.', 'error']);
  // The report also goes when the screen is opened again.
  load();
  tap(screen.finish);
  screen.close();
  screen.open(ID);
  assert.equal(screen.report.hidden, true);
});

test('with a full bag the weapon waits on the station for Take', (t) => {
  const { screen, tap, load, inventory, notes, bench } = mount(t);
  screen.open(ID);
  load();
  while (inventory.add('bandage', 1));
  tap(screen.finish);
  assert.equal(screen.take.hidden, false);
  assert.equal(screen.take.textContent, 'Take Iron Short Sword');
  assert.equal(screen.piece.textContent, 'A finished weapon waits on the station.');
  assert.equal(screen.recipes.hidden, true);
  assert.equal(screen._controls().includes(screen.take), true);
  tap(screen.take);
  assert.deepEqual(notes.at(-1), ['Your bag is full.', 'error']);
  inventory.slots[inventory.slots.findIndex((stack) => stack?.id === 'bandage')] = null;
  tap(screen.take);
  assert.deepEqual(notes.at(-1), ['Took Iron Short Sword.', 'info']);
  assert.equal(bench().output, null);
  assert.equal(screen.take.hidden, true);
});

test('an alloy weapon waiting to be taken is named in its colour', (t) => {
  const { screen, tap, recipe, row, inventory, bench } = mount(t, { items: [], alloy: 4 });
  screen.open(ID);
  tap(recipe('Dagger'));
  for (let i = 0; i < 4; i++) tap(row('Blackiron'));
  while (inventory.add('bandage', 1));
  tap(screen.finish);
  assert.equal(bench().output.forged.metal, 'Blackiron');
  assert.equal(screen.take.children[1].textContent, 'Blackiron Dagger');
  assert.equal(screen.take.children[1].style.color, '#5E6568');
});

test('update() redraws only what changed, and the feedback line fades', (t) => {
  const { screen, tap, recipe, clock } = mount(t);
  screen.open(ID);
  tap(recipe('Spear'));
  const slots = screen.slots.children;
  const rows = screen.list.children;
  screen.update();
  assert.equal(screen.slots.children, slots, 'the slots are kept');
  assert.equal(screen.list.children, rows, 'the satchel rows are kept');
  assert.equal(screen.feedback.hidden, false);
  clock.now += 4000;
  screen.update();
  assert.equal(screen.feedback.hidden, true);
  screen.close();
  screen.update();
});
