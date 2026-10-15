import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Player } from '../src/entities/player.js';
import { Inventory } from '../src/inventory/inventory.js';
import { ITEMS } from '../src/inventory/items.js';
import { Hud } from '../src/ui/hud.js';
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

test('HUD has no compass and coordinates are available only in debug mode', (t) => {
  const { document, player, hud } = mount(t);
  assert.equal(byClass(document.body, 'hud-coordinates').length, 0);
  assert.equal(byClass(document.body, 'hud-compass').length, 0);
  hud.destroy();
  const debugHud = new Hud({ player, inventory: new Inventory(), name: 'Kael', debug: true });
  t.after(() => debugHud.destroy());
  debugHud.update(0, view);
  const coordinates = byClass(document.body, 'hud-coordinates')[0];
  assert.ok(coordinates);
  const initial = coordinates.textContent;
  player.x += 20;
  player.y -= 30;
  debugHud.update(0, view);
  assert.notEqual(coordinates.textContent, initial);
  assert.match(coordinates.textContent, /124/);
  assert.match(coordinates.textContent, /176/);
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

test('wounded enemies get a status frame like the player, following them and gone once dropped', (t) => {
  const { document, hud } = mount(t);
  hud.setFoes([{ id: 7, name: 'Skeleton', health: 38.2, maxHealth: 60, x: 140, y: 210 }]);
  hud.update(0, view);
  const frames = byClass(document.body, 'hud-foe');
  assert.equal(frames.length, 1);
  const frame = frames[0];
  assert.match(frame.textContent, /Skeleton/);
  assert.match(frame.textContent, /HP38\/60/);
  const bar = meter(frame, 'hud-health');
  assert.equal(bar.current, 38.2);
  assert.equal(bar.maximum, 60);
  const position = () => /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(frame.style.transform).slice(1).map(Number);
  const [x, y] = position();
  hud.setFoes([{ id: 7, name: 'Skeleton', health: 16, maxHealth: 60, x: 141, y: 210 }]);
  hud.update(0, view);
  assert.ok(Math.abs(position()[0] - x - 10) < 0.11, 'moves with the enemy in CSS pixels');
  assert.equal(position()[1], y);
  assert.match(frame.textContent, /HP16\/60/);
  assert.equal(byClass(document.body, 'hud-foe').length, 1, 'the same frame is reused');
  // Off screen, it hides; left out, it goes.
  hud.setFoes([{ id: 7, name: 'Skeleton', health: 16, maxHealth: 60, x: 1000, y: 210 }]);
  hud.update(0, view);
  assert.equal(frame.hidden, true);
  hud.setFoes([]);
  hud.update(0, view);
  assert.equal(byClass(document.body, 'hud-foe').length, 0);
});
