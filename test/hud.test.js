import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Player } from '../src/entities/player.js';
import { Inventory } from '../src/inventory/inventory.js';
import { ITEMS } from '../src/inventory/items.js';
import { Hud } from '../src/ui/hud.js';
import { Wallet } from '../src/inventory/wallet.js';
import { allElements, byClass, installDocument } from './helpers/dom.js';

// Cell sizes and scroll offsets are device pixels, while the overlay uses
// CSS pixels. The fixture canvas has devicePixelRatio 2 and a page offset.
const view = { x0: 100, y0: 200, offX: 0, offY: 0, cols: 80, rows: 20, cellW: 20, cellH: 40 };

function mount(t, options = {}) {
  const document = installDocument(t);
  const player = new Player(104, 206);
  const inventory = new Inventory();
  const hud = new Hud({ player, inventory, name: 'Kael', ...options });
  t.after(() => hud.destroy());
  hud.update(0, view);
  return { document, player, inventory, hud };
}

function meter(root, name) {
  const element = byClass(root, name)[0];
  assert.ok(element, `${name} is rendered`);
  assert.equal(element.getAttribute('role'), 'meter');
  assert.equal(element.getAttribute('aria-valuemin'), '0');
  const current = Number(element.getAttribute('aria-valuenow'));
  const maximum = Number(element.getAttribute('aria-valuemax'));
  assert.ok(Number.isFinite(current) && Number.isFinite(maximum));
  assert.ok(current >= 0 && current <= maximum);
  assert.doesNotMatch(element.textContent, /NaN|Infinity/);
  return { element, current, maximum };
}

test('HUD segmented bars and accessible values follow rounded, bounded player vitals', (t) => {
  const { document, player, hud } = mount(t);
  player.vitals.health = 50;
  hud.update(0, view);
  const health = meter(document.body, 'hud-health');
  assert.equal(health.current, 50);
  assert.equal(health.maximum, 100);
  assert.equal(byClass(document.body, 'hud-stamina').length, 0, 'stamina is switched off for now');
  assert.match(health.element.textContent, /50\s*\/\s*100/);

  player.vitals.health = 50.43;
  hud.update(0, view);
  assert.equal(meter(document.body, 'hud-health').current, 50.4);
  // The frame shows whole points, like an MMO party list; the meter keeps tenths.
  assert.match(health.element.textContent, /HP50\/100/);

  player.vitals.health = 200;
  hud.update(0, view);
  assert.equal(meter(document.body, 'hud-health').current, 100);

  player.vitals.health = NaN;
  hud.update(0, view);
  meter(document.body, 'hud-health');
  player.vitals.maxHealth = NaN;
  hud.update(0, view);
  meter(document.body, 'hud-health');
});

test('the status frame shows the attached caster mana under health', (t) => {
  const { document, hud } = mount(t);
  assert.equal(byClass(document.body, 'hud-mana')[0].hidden, true, 'no mana row before a caster is attached');
  const caster = { mana: 37.6, maxMana: 100 };
  hud.attachMana(caster);
  const mana = meter(document.body, 'hud-mana');
  assert.equal(mana.element.hidden, false);
  assert.match(mana.element.textContent, /MP38\/100/);
  caster.mana = 100;
  hud.update(0, view);
  assert.equal(meter(document.body, 'hud-mana').current, 100);
});

test('HUD hotbar reflects equipment, selection, and consumed quick-item counts', (t) => {
  const selections = [];
  let inventoryOpened = 0;
  const { document, player, inventory, hud } = mount(t, {
    onSelect: (index) => selections.push(index),
    onInventory: () => { inventoryOpened++; },
  });
  const slots = byClass(document.body, 'hud-slot');
  assert.equal(slots.length, 9);
  assert.equal(slots[0].getAttribute('aria-pressed'), 'true');
  assert.ok(slots[0].classList.contains('equipped'));
  assert.match(slots[0].getAttribute('aria-label'), new RegExp(ITEMS.shortSword.name));
  slots[1].click();
  assert.deepEqual(selections, [1]);

  inventory.selectHotbar(1);
  player.vitals.health = 20;
  assert.equal(inventory.useSelected(player.vitals), true);
  hud.update(0, view);
  assert.equal(slots[0].getAttribute('aria-pressed'), 'false');
  assert.equal(slots[1].getAttribute('aria-pressed'), 'true');
  assert.match(slots[1].getAttribute('aria-label'), /Healing Draught/);
  assert.match(slots[1].textContent, /x\s*2/);
  const inventoryButton = allElements(document.body,
    (element) => element.tagName === 'BUTTON' && /inventory/i.test(element.getAttribute('aria-label') ?? ''))[0];
  assert.ok(inventoryButton, 'inventory control is labeled');
  inventoryButton.click();
  assert.equal(inventoryOpened, 1);
});

test('HUD shows neither a compass nor coordinates', (t) => {
  const { document } = mount(t);
  assert.equal(byClass(document.body, 'hud-compass').length, 0);
  assert.equal(byClass(document.body, 'hud-coordinates').length, 0);
  assert.doesNotMatch(document.body.textContent, /X -?\d/);
});

test('pickup events and arbitrary player, item, and toast text are displayed as plain text', (t) => {
  const name = '<img src=x>';
  const itemName = '<svg onload=evil()>';
  const message = '<script>alert(1)</script>';
  const inventory = {
    selectedHotbar: 0,
    getHotbar: (index) => index === 0
      ? { item: { id: 'custom', name: itemName, glyph: '<b>' }, count: 1, equipped: false }
      : null,
  };
  const { document, hud } = mount(t, { name, inventory });
  assert.ok(document.body.textContent.includes(name));
  assert.ok(byClass(document.body, 'hud-slot')[0].getAttribute('aria-label').includes(itemName));
  assert.equal(byClass(document.body, 'hud-slot-glyph')[0].textContent, '<b>');
  hud.notify(message);
  hud.showEvent({ type: 'pickup', id: 'healingDraught', count: 2 });
  const messages = byClass(document.body, 'hud-toast').map((element) => element.textContent);
  assert.ok(messages.some((text) => text.includes(message)));
  assert.ok(messages.some((text) => text.includes(ITEMS.healingDraught.name) && text.includes('2')));
  assert.equal(allElements(document.body, (element) => ['IMG', 'SCRIPT', 'SVG', 'B'].includes(element.tagName)).length, 0);
});

test('HUD bounds and expires pickup toasts and damage numbers', (t) => {
  const { document, hud } = mount(t);
  for (let index = 0; index < 20; index++) hud.notify(`Pickup ${index}`);
  let messages = byClass(document.body, 'hud-toast');
  assert.equal(messages.length, 5);
  assert.ok(messages.some((element) => element.textContent.endsWith('Pickup 19')));
  assert.ok(messages.every((element) => !element.textContent.endsWith('Pickup 0')));
  hud.update(3.9, view);
  assert.equal(byClass(document.body, 'hud-toast').length, 5);
  hud.update(0.2, view);
  assert.equal(byClass(document.body, 'hud-toast').length, 0);

  for (let index = 0; index < 20; index++) hud.damage(index + 1, 104, 206);
  hud.update(0, view);
  assert.equal(byClass(document.body, 'hud-damage').length, 16);
  hud.update(1, view);
  assert.equal(byClass(document.body, 'hud-damage').length, 16);
  hud.update(0.2, view);
  assert.equal(byClass(document.body, 'hud-damage').length, 0);
  for (const [amount, x, y] of [[0, 104, 206], [-1, 104, 206], [NaN, 104, 206], [1, Infinity, 206]]) {
    hud.damage(amount, x, y);
  }
  hud.update(0, view);
  assert.equal(byClass(document.body, 'hud-damage').length, 0);
});

test('damage numbers follow camera scrolling in CSS pixels and rise before expiring', (t) => {
  const { document, hud } = mount(t);
  hud.showEvent({ type: 'damage', amount: 7.66, x: 140, y: 210 });
  hud.update(0, view);
  const number = byClass(document.body, 'hud-damage')[0];
  assert.ok(number);
  assert.match(number.textContent, /7\.7/);
  const position = () => {
    const translation = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(number.style.transform);
    assert.ok(translation, 'damage has a CSS position');
    return { x: Number(translation[1]), y: Number(translation[2]) };
  };
  const initial = position();
  assert.ok(Number.isFinite(initial.x) && Number.isFinite(initial.y));
  hud.update(0, { ...view, x0: view.x0 + 1, y0: view.y0 + 1, offX: 6, offY: 8 });
  assert.ok(Math.abs(position().x - initial.x + 13) < 0.11);
  assert.ok(Math.abs(position().y - initial.y + 24) < 0.11);
  hud.update(0.5, view);
  assert.ok(position().y < initial.y, 'damage rises above its world position');
  assert.equal(byClass(document.body, 'hud-damage').length, 1);
});

test('wounded enemies get just the segmented health bar, following them and gone once dropped', (t) => {
  const { document, hud } = mount(t);
  hud.setFoes([{ id: 7, name: 'Skeleton', health: 38.2, maxHealth: 60, x: 140, y: 210 }]);
  hud.update(0, view);
  const bars = byClass(document.body, 'hud-foe');
  assert.equal(bars.length, 1);
  const bar = bars[0];
  assert.equal(bar.textContent, '', 'no name, label or numbers');
  assert.equal(bar.getAttribute('aria-label'), 'Skeleton health');
  assert.equal(Number(bar.getAttribute('aria-valuenow')), 38.2);
  assert.equal(Number(bar.getAttribute('aria-valuemax')), 60);
  const filled = byClass(bar, 'hud-vital-filled')[0];
  assert.equal(filled.style.width, '63.7%');
  const position = () => /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(bar.style.transform).slice(1).map(Number);
  const [x, y] = position();
  hud.setFoes([{ id: 7, name: 'Skeleton', health: 15, maxHealth: 60, x: 141, y: 210 }]);
  hud.update(0, view);
  assert.ok(Math.abs(position()[0] - x - 10) < 0.11, 'moves with the enemy in CSS pixels');
  assert.equal(position()[1], y);
  assert.equal(filled.style.width, '25.0%');
  assert.equal(byClass(document.body, 'hud-foe').length, 1, 'the same bar is reused');
  // Off screen, it hides; left out, it goes.
  hud.setFoes([{ id: 7, name: 'Skeleton', health: 15, maxHealth: 60, x: 1000, y: 210 }]);
  hud.update(0, view);
  assert.equal(bar.hidden, true);
  hud.setFoes([]);
  hud.update(0, view);
  assert.equal(byClass(document.body, 'hud-foe').length, 0);
});

test('damage and enemy bars share viewport visibility while damage stays inside its edges', (t) => {
  const { document, hud } = mount(t);
  hud.damage(10, 100, 200);
  hud.setFoes([{ id: 1, health: 10, maxHealth: 20, x: 100, y: 200 }]);
  hud.update(0, view);
  const damage = byClass(document.body, 'hud-damage')[0];
  const foe = byClass(document.body, 'hud-foe')[0];
  const position = (node) => /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/
    .exec(node.style.transform).slice(1).map(Number);
  assert.equal(damage.hidden, false);
  assert.equal(foe.hidden, false);
  assert.ok(position(damage)[0] > position(foe)[0], 'damage has a left-edge inset');
  assert.ok(position(damage)[1] > position(foe)[1], 'damage has a top-edge inset');

  hud.update(0, { ...view, x0: 101 });
  assert.equal(damage.hidden, true);
  assert.equal(foe.hidden, true);
  hud.update(0, view);
  assert.equal(damage.hidden, false);
  assert.equal(foe.hidden, false);
  hud.update(0, { ...view, cellW: 0 });
  assert.equal(damage.hidden, true);
  assert.equal(foe.hidden, true);
});

test('the target frame shows the struck creature by name and health, and hides without one', (t) => {
  const { document, hud } = mount(t);
  const frame = byClass(document.body, 'hud-target')[0];
  assert.equal(frame.hidden, true, 'hidden until something is struck');
  assert.equal(frame.getAttribute('aria-label'), 'Target');
  const name = byClass(frame, 'hud-target-name')[0];
  const note = byClass(frame, 'hud-target-note')[0];
  const value = byClass(frame, 'hud-vital-value')[0];
  hud.setTarget({ id: 'monster:3', name: 'Goblin', health: 22.4, maxHealth: 35, note: '', slain: false });
  hud.update(0, view);
  assert.equal(frame.hidden, false);
  assert.equal(name.textContent, 'Goblin');
  assert.equal(note.textContent, '');
  const health = meter(frame, 'hud-target-health');
  assert.equal(health.current, 22.4);
  assert.equal(value.textContent, '23/35');
  assert.equal(byClass(frame, 'hud-vital-filled')[0].style.width, '64.0%');
  assert.equal(health.element.getAttribute('aria-valuetext'), 'Goblin, 22.4 of 35');
  // Its last sliver never reads 0 until it falls.
  hud.setTarget({ name: 'Troll', health: 0.4, maxHealth: 150, note: 'enraged', slain: false });
  hud.update(0, view);
  assert.equal(value.textContent, '1/150');
  assert.equal(note.textContent, 'enraged');
  hud.setTarget({ name: 'Troll', health: 0, maxHealth: 150, note: 'slain', slain: true });
  hud.update(0, view);
  assert.equal(value.textContent, '0/150');
  assert.equal(frame.classList.contains('slain'), true);
  assert.equal(health.element.getAttribute('aria-valuetext'), 'Troll, slain, 0 of 150');
  hud.setTarget({ name: 'A creature with a very long name indeed', health: 5, maxHealth: 5 });
  hud.update(0, view);
  assert.equal(name.textContent, 'A creature with a very l');
  assert.equal(note.textContent, '');
  assert.equal(frame.classList.contains('slain'), false);
  hud.setTarget({ health: 5, maxHealth: 5 });
  hud.update(0, view);
  assert.equal(name.textContent, 'Foe');
  hud.setTarget(null);
  hud.update(0, view);
  assert.equal(frame.hidden, true);
});

test('the target\'s overhead bar is outlined', (t) => {
  const { document, hud } = mount(t);
  hud.setFoes([{ id: 1, name: 'Goblin', health: 10, maxHealth: 20, x: 140, y: 210, target: true },
    { id: 2, name: 'Elf', health: 10, maxHealth: 20, x: 150, y: 210 }]);
  hud.update(0, view);
  const [first, second] = byClass(document.body, 'hud-foe');
  assert.equal(first.classList.contains('target'), true);
  assert.equal(second.classList.contains('target'), false);
});

test('the prompt, extra frame notes, name and party frames show what they are given', (t) => {
  const { document, hud } = mount(t);
  const prompt = byClass(document.body, 'hud-prompt')[0];
  hud.setPrompt('[E] Disturb glowcap');
  assert.equal(prompt.hidden, false);
  assert.equal(prompt.textContent, '[E] Disturb glowcap');
  hud.setPrompt('');
  assert.equal(prompt.hidden, true);

  hud.attachNote(null);
  const note = document.createElement('div');
  note.className = 'carry';
  hud.attachNote(note);
  assert.equal(note.classList.contains('hud-frame-note'), true);
  assert.equal(note.parentNode ?? note.parentElement, byClass(document.body, 'hud-status')[0]);

  hud.setName('');
  assert.equal(byClass(document.body, 'hud-name')[0].textContent, 'Wanderer');
  hud.setName('Robin');
  assert.equal(byClass(document.body, 'hud-name')[0].textContent, 'Robin');

  const tab = byClass(document.body, 'hud-party-tab')[0];
  hud.setParty([{ id: 'a', name: 'Marian', health: 40, maxHealth: 100, note: '12m' }, { id: 'b', health: 10, maxHealth: 100 }]);
  let members = byClass(document.body, 'hud-member');
  assert.equal(members.length, 2);
  assert.equal(tab.hidden, false);
  assert.equal(byClass(members[0], 'hud-name')[0].textContent, 'Marian · 12m');
  assert.equal(byClass(members[1], 'hud-name')[0].textContent, 'Wanderer');
  const name = byClass(members[0], 'hud-name-text')[0];
  assert.equal(name.textContent, 'Marian');
  assert.equal(byClass(members[0], 'hud-name-note')[0].textContent, ' · 12m');
  assert.equal(name.style.color, '', 'a name without a colour keeps the frame\'s ink');
  hud.setParty([{ id: 'a', name: 'Marian', colour: [255, 85, 85], health: 30, maxHealth: 100 }, { id: 'b', health: 10, maxHealth: 100 }]);
  assert.equal(byClass(document.body, 'hud-member')[0], members[0], 'the same frames are reused');
  assert.equal(name.style.color, 'rgb(255, 85, 85)', 'the name shows in its name colour');
  assert.equal(byClass(members[0], 'hud-name')[0].textContent, 'Marian', 'no note, no dot');
  hud.setParty([{ id: 'a', name: 'Marian (2)', colour: [0, 170, 170], health: 30, maxHealth: 100 }, { id: 'b', health: 10, maxHealth: 100 }]);
  members = byClass(document.body, 'hud-member');
  assert.equal(byClass(members[0], 'hud-name-text')[0].textContent, 'Marian (2)');
  assert.equal(byClass(members[0], 'hud-name-text')[0].style.color, 'rgb(0, 170, 170)');
  hud.setParty('nobody');
  members = byClass(document.body, 'hud-member');
  assert.equal(members.length, 0);
  assert.equal(tab.hidden, true);
});

test('an unchanged target leaves the frame\'s DOM untouched', (t) => {
  const { document, hud } = mount(t);
  const frame = byClass(document.body, 'hud-target')[0];
  hud.setTarget({ id: 'monster:3', name: 'Goblin', health: 22.4, maxHealth: 35, note: 'enraged', slain: false });
  hud.update(0, view);
  const writes = [];
  for (const node of [frame, ...allElements(frame, () => true)]) {
    const setAttribute = node.setAttribute.bind(node);
    node.setAttribute = (name, value) => {
      writes.push(name);
      setAttribute(name, value);
    };
  }
  for (let i = 0; i < 3; i++) {
    hud.setTarget({ id: 'monster:3', name: 'Goblin', health: 22.4, maxHealth: 35, note: 'enraged', slain: false });
    hud.update(0, view);
  }
  assert.deepEqual(writes, []);
  assert.equal(byClass(frame, 'hud-target-health')[0].getAttribute('aria-valuetext'), 'Goblin, 22.4 of 35');
});

test('stacks lying on the ground are named above them, dimmed when the bag is full, gone once taken', (t) => {
  const { document, hud, player, inventory } = mount(t);
  const bone = { uid: 'drop:1', id: 'bone', count: 2, x: 140, y: 210 };
  hud.setLoot([bone], player, inventory);
  hud.update(0, view);
  const [label] = byClass(document.body, 'hud-loot-label');
  assert.equal(label.textContent, 'Bone x2');
  assert.match(label.style.transform, /translate\([-\d.]+px, [-\d.]+px\) translate\(-50%, -100%\)/);
  assert.match(label.style.color, /^rgb\(/);
  assert.equal(label.classList.contains('full'), false);
  inventory.spaceFor = () => 0;
  hud.update(0, view);
  assert.equal(byClass(document.body, 'hud-loot-label')[0], label, 'reused');
  assert.equal(label.classList.contains('full'), true);
  hud.setLoot(null);
  hud.update(0, view);
  assert.equal(byClass(document.body, 'hud-loot-label').length, 0);
});

test('the pouch shows its balance under the bag and brightens for a moment on each gain', (t) => {
  const wallet = new Wallet({ storage: null });
  const { document, hud } = mount(t, { wallet });
  const purse = byClass(document.body, 'hud-purse')[0];
  assert.equal(purse.hidden, false);
  assert.equal(purse.textContent, 'Pouch 0.00d');
  assert.equal(purse.getAttribute('aria-label'), 'Pouch 0.00 denars');
  wallet.earn('coin:1', 73);
  hud.update(0, view);
  assert.equal(byClass(purse, 'hud-purse-value')[0].textContent, '0.73');

  hud.earned(73);
  const toast = byClass(document.body, 'hud-toast').at(-1);
  assert.equal(toast.textContent, '+0.73d');
  assert.equal(toast.dataset.kind, 'coin');
  assert.ok(purse.classList.contains('gain'));
  for (let i = 0; i < 11; i++) hud.update(0.1, view);
  assert.ok(purse.classList.contains('gain'), 'still bright at 1.1 s');
  hud.update(0.2, view);
  assert.ok(!purse.classList.contains('gain'), 'at rest after 1.2 s');

  // A coin event tells the same way; nonsense gains tell nothing.
  hud.showEvent({ type: 'coin', cents: 5 });
  assert.equal(byClass(document.body, 'hud-toast').at(-1).textContent, '+0.05d');
  const toasts = byClass(document.body, 'hud-toast').length;
  for (const bad of [0, -3, 1.5, undefined]) hud.earned(bad);
  assert.equal(byClass(document.body, 'hud-toast').length, toasts);
});

test('an unchanged pouch leaves its DOM untouched, and without a pouch the line is hidden', (t) => {
  const wallet = new Wallet({ storage: null });
  const { document, hud } = mount(t, { wallet });
  const purse = byClass(document.body, 'hud-purse')[0];
  const value = byClass(purse, 'hud-purse-value')[0];
  const writes = [];
  const setAttribute = purse.setAttribute.bind(purse);
  purse.setAttribute = (name, v) => { writes.push(name); setAttribute(name, v); };
  Object.defineProperty(value, 'textContent', { get: () => '0.00', set: () => writes.push('text') });
  for (let i = 0; i < 3; i++) hud.update(0.1, view);
  assert.deepEqual(writes, []);

  const other = mount(t);
  const bare = byClass(other.document.body, 'hud-purse')[0];
  assert.equal(bare.hidden, true);
  other.hud.earned(100);
  assert.equal(byClass(other.document.body, 'hud-toast').at(-1).textContent, '+1.00d');
  other.hud.destroy();
  other.hud.earned(100);
});

test('the projector reads the screen boxes once per size, again after a resize', (t) => {
  const listeners = new Map();
  globalThis.addEventListener = (type, fn) => listeners.set(type, fn);
  globalThis.removeEventListener = (type, fn) => { if (listeners.get(type) === fn) listeners.delete(type); };
  t.after(() => { delete globalThis.addEventListener; delete globalThis.removeEventListener; });
  const { document, hud } = mount(t);
  const screen = document.getElementById('screen');
  let reads = 0;
  let rect = { left: 25, top: 30, width: 800, height: 400 };
  screen.getBoundingClientRect = () => { reads++; return rect; };
  hud.boxes = null;
  const at = () => hud.projector(view).project(110, 210);
  assert.deepEqual(at(), { x: 125, y: 230, visible: true });
  at();
  assert.equal(reads, 1, 'read once while the screen keeps its size');
  rect = { left: 0, top: 0, width: 800, height: 400 };
  listeners.get('resize')();
  assert.deepEqual(at(), { x: 100, y: 200, visible: true }, 'read again after a resize');
  screen.width = 800;
  assert.deepEqual(at(), { x: 200, y: 200, visible: true }, 'and when the canvas is given another size');
  assert.equal(reads, 3);
  hud.destroy();
  assert.equal(listeners.has('resize'), false, 'a destroyed HUD stops listening');
});
