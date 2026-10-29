import assert from 'node:assert/strict';
import { test } from 'node:test';
import { presetSkin } from '../src/character/skin.js';
import { Inventory } from '../src/inventory/inventory.js';
import { EQUIPMENT_SLOTS, ITEMS } from '../src/inventory/items.js';
import { itemArt } from '../src/ui/item-art.js';
import { InventoryScreen } from '../src/ui/inventory.js';
import { DOLL_BOXES, dollArea } from '../src/ui/paper-doll.js';

// A fake DOM with just enough of the browser for the inventory panel:
// reflected attributes, focus, simple selectors and element events.
let currentDocument = null;

function matchesSimple(node, selector) {
  const attribute = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(selector);
  if (attribute) {
    const [, name, value] = attribute;
    if (!node.hasAttribute(name)) return false;
    return value === undefined || node.getAttribute(name) === value;
  }
  if (selector.startsWith('#')) return node.id === selector.slice(1);
  if (selector.startsWith('.')) return node.classList.contains(selector.slice(1));
  return node.tagName === selector.toUpperCase();
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.style = {};
    this.dataset = {};
    this.className = '';
    this.listeners = new Map();
    this.focusOptions = [];
    this.scrolls = [];
    this.disabled = false;
    this._text = '';
    const tokens = () => new Set(this.className.split(/\s+/).filter(Boolean));
    this.classList = {
      contains: (name) => tokens().has(name),
      add: (...names) => { this.className = [...new Set([...tokens(), ...names])].join(' '); },
      remove: (...names) => { this.className = [...tokens()].filter((name) => !names.includes(name)).join(' '); },
      toggle: (name, force) => {
        const next = force ?? !tokens().has(name);
        if (next) this.classList.add(name);
        else this.classList.remove(name);
        return next;
      },
    };
    if (this.tagName === 'CANVAS') {
      const context = {
        draws: 0,
        setTransform() {},
        clearRect() {},
        fillText() { this.draws++; },
      };
      this.getContext = (kind) => kind === '2d' ? context : null;
    }
  }

  get id() { return this.getAttribute('id') ?? ''; }
  set id(value) { this.setAttribute('id', value); }
  get hidden() { return this.hasAttribute('hidden'); }
  set hidden(value) {
    if (value) this.setAttribute('hidden', '');
    else this.removeAttribute('hidden');
  }
  get tabIndex() {
    if (this.hasAttribute('tabindex')) return Number(this.getAttribute('tabindex'));
    return this.tagName === 'BUTTON' ? 0 : -1;
  }
  set tabIndex(value) { this.setAttribute('tabindex', value); }
  get textContent() { return this._text + this.children.map((child) => child.textContent).join(''); }
  set textContent(value) {
    this.replaceChildren();
    this._text = String(value ?? '');
  }
  get isConnected() {
    let node = this;
    while (node.parentNode) node = node.parentNode;
    return node === currentDocument?.body;
  }

  append(...nodes) {
    for (const node of nodes) {
      node.remove();
      node.parentNode = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this._text = '';
    this.append(...nodes);
  }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }
  setAttribute(name, value) {
    if (name === 'class') this.className = String(value);
    else this.attributes.set(name, String(value));
  }
  getAttribute(name) {
    if (name === 'class') return this.className;
    return this.attributes.get(name) ?? null;
  }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }

  matches(selector) { return selector.split(',').some((part) => matchesSimple(this, part.trim())); }
  closest(selector) {
    for (let node = this; node; node = node.parentNode) if (node.matches(selector)) return node;
    return null;
  }
  contains(node) {
    for (let current = node; current; current = current.parentNode) if (current === this) return true;
    return false;
  }
  querySelectorAll(selector) {
    return this.children.flatMap((child) => [
      ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector),
    ]);
  }

  focus(options) {
    currentDocument.activeElement = this;
    this.focusOptions.push(options);
  }
  scrollIntoView(options) { this.scrolls.push(options); }
  getBoundingClientRect() { return this.rect ?? { left: 0, top: 0, width: 10, height: 10 }; }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  dispatch(type, fields = {}) {
    const event = {
      type, target: this, currentTarget: this, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.stopped = true; },
      ...fields,
    };
    for (const listener of this.listeners.get(type) ?? []) listener(event);
    return event;
  }
  click() { return this.dispatch('click'); }
}

// Node's EventTarget ignores a boolean `useCapture` in removeEventListener,
// which browsers honour, so spell it out as an options object.
class FakeWindow extends EventTarget {
  addEventListener(type, listener, options) {
    super.addEventListener(type, listener, typeof options === 'boolean' ? { capture: options } : options);
  }
  removeEventListener(type, listener, options) {
    super.removeEventListener(type, listener, typeof options === 'boolean' ? { capture: options } : options);
  }
}

function override(t, name, value) {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, name, original);
    else delete globalThis[name];
  });
}

function installBrowser(t, { canvas = true, hud = true } = {}) {
  const body = new FakeElement('body');
  const document = {
    body,
    activeElement: body,
    createElement: (tagName) => new FakeElement(tagName),
    getElementById(id) {
      const find = (node) => {
        for (const child of node.children) {
          if (child.id === id) return child;
          const found = find(child);
          if (found) return found;
        }
        return null;
      };
      return find(body);
    },
  };
  if (hud) {
    const hudRoot = new FakeElement('div');
    hudRoot.id = 'hud-root';
    body.append(hudRoot);
  }
  if (canvas) {
    const screen = new FakeElement('canvas');
    screen.id = 'screen';
    body.append(screen);
  }
  const window = new FakeWindow();
  const clock = { now: 1000 };
  const grid = { columns: '50px 50px 50px 50px 50px 50px' };
  currentDocument = document;
  override(t, 'document', document);
  override(t, 'window', window);
  override(t, 'performance', { now: () => clock.now });
  override(t, 'getComputedStyle', () => ({ gridTemplateColumns: grid.columns }));
  t.after(() => { currentDocument = null; });
  return { document, window, clock, grid };
}

function mount(t, { inventory = new Inventory(), browser = {}, beforeMount, ...options } = {}) {
  const env = installBrowser(t, browser);
  beforeMount?.(env);
  // Pages are built on the page's document.
  if (typeof options.pages === 'function') options.pages = options.pages(env);
  const player = {
    equipment: inventory.equipment,
    vitals: { health: 50, maxHealth: 100, stamina: 100, maxStamina: 100 },
  };
  const toggles = [];
  const notes = [];
  const screen = new InventoryScreen({
    inventory, player,
    onToggle: (open) => toggles.push(open),
    onNotify: (message, kind) => notes.push([message, kind]),
    ...options,
  });
  // Game controls listen after the panel, as main.js does.
  const gameKeys = [];
  env.window.addEventListener('keydown', (event) => gameKeys.push(event.code));
  env.window.addEventListener('keyup', (event) => gameKeys.push(`up:${event.code}`));

  const press = (code, { type = 'keydown', target = env.document.activeElement, ...fields } = {}) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { code, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false,
      repeat: false, ...fields });
    Object.defineProperty(event, 'target', { value: target });
    const before = gameKeys.length;
    env.window.dispatchEvent(event);
    return { prevented: event.defaultPrevented, reachedGame: gameKeys.length > before };
  };
  const bagButton = (index) => screen.bagNodes[index].button;
  const slotButton = (slot) => screen.equipmentNodes.get(slot).button;
  const indexOf = (id) => inventory.slots.findIndex((stack) => stack?.id === id);
  return { ...env, screen, inventory, player, toggles, notes, gameKeys, press, bagButton, slotButton, indexOf };
}

const visible = (node) => !node.hidden;

test('opening the inventory blocks the scene and closing returns focus to the canvas', (t) => {
  const { document, screen, toggles, press, bagButton } = mount(t);
  const canvas = document.getElementById('screen');
  const hudRoot = document.getElementById('hud-root');
  assert.equal(screen.root.id, 'inventory-root');
  assert.equal(screen.root.parentNode, document.body);
  assert.equal(screen.isOpen, false);
  assert.equal(screen.screen.hidden, true);
  assert.equal(screen.screen.getAttribute('role'), 'dialog');

  const open = press('KeyI');
  assert.deepEqual(open, { prevented: true, reachedGame: false });
  assert.equal(screen.isOpen, true);
  assert.equal(screen.screen.hidden, false);
  assert.ok(screen.root.classList.contains('is-open'));
  assert.ok(document.body.classList.contains('inventory-open'));
  assert.equal(hudRoot.inert, true);
  assert.equal(canvas.inert, true);
  assert.deepEqual(toggles, [true]);
  assert.equal(document.activeElement, bagButton(0), 'the selected slot takes focus');
  assert.deepEqual(bagButton(0).focusOptions.at(-1), { preventScroll: true }, 'the sheet opens at its top');
  assert.equal(screen.slotCounter.textContent, 'Bag 15/24');

  // Key releases never leak into the game while the panel is open.
  assert.equal(press('KeyI', { type: 'keyup' }).reachedGame, false);
  assert.equal(press('KeyW', { type: 'keyup' }).reachedGame, false);

  screen.setOpen(true);
  assert.deepEqual(toggles, [true], 'opening twice does nothing');

  assert.deepEqual(press('Escape'), { prevented: true, reachedGame: false });
  assert.equal(screen.isOpen, false);
  assert.equal(screen.screen.hidden, true);
  assert.ok(!screen.root.classList.contains('is-open'));
  assert.ok(!document.body.classList.contains('inventory-open'));
  assert.equal(hudRoot.inert, false);
  assert.equal(canvas.inert, false);
  assert.deepEqual(toggles, [true, false]);
  assert.equal(canvas.getAttribute('tabindex'), '0');
  assert.equal(document.activeElement, canvas);
  assert.deepEqual(canvas.focusOptions.at(-1), { preventScroll: true });

  // The Escape release is swallowed once; later releases reach the game.
  assert.equal(press('Escape', { type: 'keyup' }).reachedGame, false);
  assert.equal(press('Escape', { type: 'keyup' }).reachedGame, true);

  assert.equal(press('Tab').prevented, true);
  assert.equal(screen.isOpen, true, 'Tab opens the inventory');
  assert.equal(press('Tab', { repeat: true }).prevented, true);
  assert.equal(screen.isOpen, true, 'a held Tab does not flicker the panel');
  assert.equal(press('Tab').reachedGame, false);
  assert.equal(screen.isOpen, false, 'Tab closes it again');

  screen.toggle();
  assert.equal(screen.isOpen, true);
  screen.screen.querySelectorAll('.inventory-close')[0].click();
  assert.equal(screen.isOpen, false, 'the Close button closes the panel');
  assert.deepEqual(toggles, [true, false, true, false, true, false]);
});

test('a blurred window forgets swallowed key releases', (t) => {
  const { window, screen, press } = mount(t);
  press('KeyI');
  screen.setOpen(false);
  window.dispatchEvent(new Event('blur'));
  assert.equal(press('KeyI', { type: 'keyup' }).reachedGame, true);
});

test('closing without a scene canvas returns focus to what had it before', (t) => {
  const { document, screen, press } = mount(t, { browser: { canvas: false, hud: false } });
  const field = new FakeElement('button');
  document.body.append(field);
  field.focus();
  press('KeyI');
  assert.equal(screen.isOpen, true);
  assert.notEqual(document.activeElement, field);
  press('Escape');
  assert.equal(document.activeElement, field);
});

test('the panel reuses an existing inventory root', (t) => {
  const { document, screen } = mount(t, {
    beforeMount: ({ document: doc }) => {
      const root = new FakeElement('div');
      root.id = 'inventory-root';
      doc.body.append(root);
    },
  });
  assert.equal(screen.root, document.getElementById('inventory-root'));
  assert.equal(screen.root.children.length, 1);
  assert.equal(screen.root.children[0], screen.screen);
});

test('keys reach the game while closed, and typing never opens the inventory', (t) => {
  const { document, screen, press } = mount(t);
  const input = new FakeElement('input');
  document.body.append(input);
  assert.deepEqual(press('KeyI', { target: input }), { prevented: false, reachedGame: true });

  const editor = new FakeElement('div');
  editor.isContentEditable = true;
  document.body.append(editor);
  assert.equal(press('KeyI', { target: editor }).reachedGame, true);

  const dock = new FakeElement('aside');
  dock.id = 'panel-dock';
  const dockButton = new FakeElement('button');
  dock.append(dockButton);
  document.body.append(dock);
  assert.equal(press('Tab', { target: dockButton }).reachedGame, true);
  assert.equal(screen.isOpen, false);

  assert.deepEqual(press('KeyW'), { prevented: false, reachedGame: true });
  assert.equal(press('KeyW', { type: 'keyup' }).reachedGame, true);
  assert.equal(press('Escape').reachedGame, true);
  assert.equal(screen.isOpen, false);
});

test('a key another handler already handled is ignored', (t) => {
  const { window, screen } = mount(t);
  const event = new Event('keydown', { cancelable: true });
  event.code = 'KeyI';
  event.preventDefault();
  window.dispatchEvent(event);
  assert.equal(screen.isOpen, false);
});

test('modifier shortcuts keep browser defaults but stay away from game controls', (t) => {
  const { document, screen, press } = mount(t);
  press('KeyI');
  assert.deepEqual(press('KeyI', { ctrlKey: true }), { prevented: false, reachedGame: false });
  assert.equal(screen.isOpen, true);
  assert.deepEqual(press('KeyR', { altKey: true }), { prevented: false, reachedGame: false });
  assert.deepEqual(press('KeyL', { metaKey: true }), { prevented: false, reachedGame: false });

  // Unbound keys are hidden from the game; movement and attack keys also lose their defaults.
  assert.deepEqual(press('KeyZ'), { prevented: false, reachedGame: false });
  for (const code of ['Space', 'KeyW', 'KeyD', 'KeyQ', 'Backspace']) {
    assert.deepEqual(press(code, { target: document.body }), { prevented: true, reachedGame: false }, code);
  }
});

test('Shift+Tab cycles focus backwards through the visible panel buttons', (t) => {
  const { document, screen, press, bagButton } = mount(t, { onDrop: () => null });
  press('KeyI');
  const close = screen.screen.querySelectorAll('.inventory-close')[0];
  assert.equal(document.activeElement, bagButton(0));

  assert.equal(press('Tab', { shiftKey: true }).prevented, true);
  assert.equal(screen.isOpen, true, 'reverse Tab does not close the panel');
  assert.equal(document.activeElement, close);
  press('Tab', { shiftKey: true });
  assert.equal(document.activeElement, screen.dropButton, 'focus wraps to the last button');
  press('Tab', { shiftKey: true });
  assert.equal(document.activeElement, screen.useButton, 'the hidden Equip and Unequip buttons are skipped');
  press('Tab', { shiftKey: true });
  assert.equal(document.activeElement, bagButton(0), 'only the selected slot is in the tab order');
});

test('arrow keys move through the bag grid and around the equipment figure', (t) => {
  const { document, screen, grid, press, bagButton, slotButton } = mount(t);
  press('KeyI');
  const step = (code) => {
    assert.deepEqual(press(code), { prevented: true, reachedGame: false });
    return screen.selection;
  };
  assert.deepEqual(step('ArrowRight'), { source: 'bag', index: 1 });
  assert.deepEqual(step('ArrowDown'), { source: 'bag', index: 7 });
  assert.deepEqual(step('ArrowLeft'), { source: 'bag', index: 6 });
  assert.deepEqual(step('ArrowUp'), { source: 'bag', index: 0 });
  assert.equal(document.activeElement, bagButton(0));
  assert.equal(bagButton(0).getAttribute('aria-pressed'), 'true');
  assert.equal(bagButton(6).getAttribute('aria-pressed'), 'false');

  grid.columns = 'none';
  assert.deepEqual(step('ArrowDown'), { source: 'bag', index: 6 }, 'six columns without a grid template');

  // Lay the boxes out on the paper doll's grid: cells 50 wide, 40 tall.
  for (const [slot, { column, row, width, height }] of Object.entries(DOLL_BOXES)) {
    slotButton(slot).rect = { left: (column - 1) * 50, top: (row - 1) * 40, width: width * 50, height: height * 40 };
  }
  assert.equal(press('KeyG').prevented, true);
  assert.deepEqual(screen.selection, { source: 'equipment', slot: 'helm' });
  assert.equal(document.activeElement, slotButton('helm'));
  assert.deepEqual(step('ArrowUp'), { source: 'equipment', slot: 'helm' }, 'nothing lies above the helmet');
  assert.deepEqual(step('ArrowRight'), { source: 'equipment', slot: 'amulet' });
  assert.deepEqual(step('ArrowRight'), { source: 'equipment', slot: 'offHand' });
  assert.deepEqual(step('ArrowDown'), { source: 'equipment', slot: 'feet' });
  assert.equal(document.activeElement, slotButton('feet'));
  slotButton('chest').click();
  assert.deepEqual(step('ArrowDown'), { source: 'equipment', slot: 'legs' });
  assert.deepEqual(step('ArrowLeft'), { source: 'equipment', slot: 'hands' });
  assert.deepEqual(step('ArrowUp'), { source: 'equipment', slot: 'mainHand' });
  assert.deepEqual(step('ArrowRight'), { source: 'equipment', slot: 'quiver' }, 'the quiver sits beside the weapon');
  assert.deepEqual(step('ArrowRight'), { source: 'equipment', slot: 'helm' });

  press('KeyG');
  assert.deepEqual(screen.selection, { source: 'bag', index: 0 });
  assert.equal(document.activeElement, bagButton(0));
});

test('E equips, U unequips and Enter uses or swaps the selected item', (t) => {
  const { document, screen, inventory, player, notes, press, bagButton, slotButton, indexOf } = mount(t);
  press('KeyI');
  const buckler = indexOf('woodenBuckler');
  bagButton(buckler).focus();
  bagButton(buckler).click();

  assert.equal(press('KeyE', { repeat: true }).prevented, true);
  assert.equal(inventory.equipment.offHand, null, 'a held key does not repeat the action');
  assert.equal(press('KeyU').prevented, true);
  assert.equal(inventory.equipment.offHand, null, 'U does nothing for a bag item');

  press('KeyE');
  assert.equal(inventory.equipment.offHand.id, 'woodenBuckler');
  assert.deepEqual(screen.selection, { source: 'equipment', slot: 'offHand' });
  assert.equal(document.activeElement, slotButton('offHand'));
  assert.deepEqual(notes.at(-1), ['Equipped Wooden Buckler.', 'success']);
  assert.equal(screen.feedback.textContent, 'Equipped Wooden Buckler.');
  assert.equal(screen.feedback.dataset.kind, 'success');
  assert.ok(visible(screen.feedback));

  press('KeyE');
  assert.equal(notes.length, 1, 'E does nothing for equipped gear');

  press('KeyU');
  assert.equal(inventory.equipment.offHand, null);
  assert.deepEqual(notes.at(-1), ['Unequipped Wooden Buckler.', 'success']);
  assert.deepEqual(screen.selection, { source: 'bag', index: indexOf('woodenBuckler') });
  assert.equal(document.activeElement, bagButton(indexOf('woodenBuckler')));

  // Enter equips gear from the bag, and takes off equipped gear.
  press('Enter');
  assert.equal(inventory.equipment.offHand.id, 'woodenBuckler');
  press('NumpadEnter');
  assert.equal(inventory.equipment.offHand, null);

  // Enter drinks a consumable.
  bagButton(0).click();
  press('KeyE');
  assert.equal(notes.length, 4, 'a draught cannot be equipped');
  press('Enter');
  assert.equal(player.vitals.health, 85);
  assert.equal(inventory.slots[0].count, 2);
  assert.deepEqual(notes.at(-1), ['Used Healing Draught.', 'success']);
  assert.equal(document.activeElement, bagButton(0));

  // Materials and empty slots have no action.
  bagButton(indexOf('rawIron')).click();
  press('Enter');
  bagButton(20).click();
  press('Enter');
  press('KeyE');
  // Hidden action buttons do nothing even when clicked.
  screen.useButton.click();
  slotButton('helm').click();
  screen.useButton.click();
  screen.equipButton.click();
  assert.equal(inventory.equipment.helm.id, 'outlawHood');
  assert.equal(notes.length, 5);
});

test('panel buttons respond to clicks, Space and Enter, and keep the details in view', (t) => {
  const { document, screen, inventory, player, notes, press, bagButton, slotButton, indexOf } = mount(t);
  press('KeyI');
  bagButton(indexOf('woodenBuckler')).click();

  screen.equipButton.focus();
  assert.equal(press('Enter').prevented, true);
  assert.equal(inventory.equipment.offHand.id, 'woodenBuckler');
  assert.equal(document.activeElement, screen.unequipButton, 'Unequip is the next contextual action');
  assert.deepEqual(screen.feedback.scrolls.at(-1), { block: 'nearest' });

  press('Space', { repeat: true });
  assert.equal(inventory.equipment.offHand.id, 'woodenBuckler', 'a held Space does not press again');
  press('Space');
  assert.equal(inventory.equipment.offHand, null);
  assert.equal(document.activeElement, screen.equipButton);

  // Space on a slot presses it; Enter on a slot activates the selection instead.
  slotButton('helm').focus();
  press('Space');
  assert.deepEqual(screen.selection, { source: 'equipment', slot: 'helm' });

  // Clicking Use on the last draught hides the button, so focus stays on the details.
  bagButton(0).click();
  inventory.slots[0].count = 1;
  screen.useButton.focus();
  press('Enter');
  assert.equal(player.vitals.health, 85);
  assert.equal(inventory.slots[0], null);
  assert.equal(screen.useButton.hidden, true);
  assert.equal(document.activeElement, screen.details);

  // Mouse clicks on the action buttons.
  bagButton(indexOf('dagger')).click();
  screen.equipButton.click();
  assert.equal(inventory.equipment.mainHand.id, 'dagger');
  screen.unequipButton.click();
  assert.equal(inventory.equipment.mainHand, null);
  bagButton(indexOf('staminaTonic')).click();
  player.vitals.stamina = 10;
  screen.useButton.click();
  assert.equal(player.vitals.stamina, 55);
  assert.deepEqual(notes.at(-1), ['Used Stamina Tonic.', 'success']);
});

test('double-clicking a slot equips or unequips its gear', (t) => {
  const { screen, inventory, press, bagButton, slotButton, indexOf } = mount(t);
  press('KeyI');
  const bow = indexOf('longbow');
  bagButton(bow).click();
  assert.deepEqual(screen.selection, { source: 'bag', index: bow });
  bagButton(bow).dispatch('dblclick');
  assert.equal(inventory.equipment.mainHand.id, 'longbow');
  assert.ok(inventory.slots.some((stack) => stack?.id === 'shortSword'), 'the sword returns to the bag');

  slotButton('helm').click();
  assert.deepEqual(screen.selection, { source: 'equipment', slot: 'helm' });
  slotButton('helm').dispatch('dblclick');
  assert.equal(inventory.equipment.helm, null);
  assert.deepEqual(screen.selection, { source: 'bag', index: indexOf('outlawHood') });
});

test('failed actions say why', (t) => {
  const inventory = new Inventory({ starter: false });
  inventory.slots[0] = { id: 'greatsword', count: 1 };
  inventory.slots[1] = { id: 'healingDraught', count: 2 };
  for (let index = 2; index < 24; index++) inventory.slots[index] = { id: 'flint', count: 1 };
  inventory.equipment.mainHand = { id: 'shortSword', count: 1 };
  inventory.equipment.offHand = { id: 'woodenBuckler', count: 1 };
  const { document, screen, player, notes, press, bagButton, slotButton } = mount(t, { inventory });
  press('KeyI');

  press('KeyE');
  assert.deepEqual(notes.at(-1), ['No room to replace equipped gear.', 'error']);
  assert.equal(inventory.equipment.mainHand.id, 'shortSword');
  assert.deepEqual(screen.selection, { source: 'bag', index: 0 });
  assert.equal(screen.feedback.dataset.kind, 'error');

  screen.equipButton.focus();
  press('Enter');
  assert.equal(document.activeElement, screen.equipButton, 'focus stays on the failed action');

  slotButton('mainHand').click();
  press('KeyU');
  assert.deepEqual(notes.at(-1), ['Your bag has no room for this gear.', 'error']);
  assert.equal(inventory.equipment.mainHand.id, 'shortSword');
  assert.deepEqual(screen.selection, { source: 'equipment', slot: 'mainHand' });
  screen.unequipButton.focus();
  press('Enter');
  assert.equal(document.activeElement, screen.unequipButton);

  player.vitals.health = 100;
  bagButton(1).click();
  bagButton(1).focus();
  assert.equal(screen.useButton.disabled, true);
  assert.equal(screen.useButton.getAttribute('title'), 'Your vitality is already full.');
  press('Enter');
  assert.deepEqual(notes.at(-1), ['Your vitality is already full.', 'info']);
  assert.equal(inventory.slots[1].count, 2);

  player.vitals.health = 40;
  bagButton(0).click();
  bagButton(1).click();
  assert.equal(screen.useButton.disabled, false);
  assert.equal(screen.useButton.getAttribute('title'), '');
});

test('X drops the selected bag stack through onDrop', (t) => {
  const results = [];
  const drops = [];
  const { screen, notes, press, bagButton, slotButton, indexOf } = mount(t, {
    onDrop: (index) => { drops.push(index); return results.shift(); },
  });
  const help = screen.screen.children.at(-1);
  assert.match(help.textContent, /XDrop/);
  press('KeyI');
  assert.ok(visible(screen.dropButton));

  const ore = indexOf('rawIron');
  bagButton(ore).click();
  results.push({ ok: true, message: 'Dropped Iron Ore.' }, { ok: false, message: 'Nothing to drop.' }, undefined);
  assert.equal(press('KeyX').prevented, true);
  assert.deepEqual(notes.at(-1), ['Dropped Iron Ore.', 'success']);
  screen.dropButton.click();
  assert.deepEqual(notes.at(-1), ['Nothing to drop.', 'info']);
  press('KeyX');
  assert.equal(notes.length, 2, 'a silent drop sends no message');
  assert.deepEqual(drops, [ore, ore, ore]);

  bagButton(20).click();
  assert.equal(screen.dropButton.hidden, true, 'an empty slot cannot drop');
  press('KeyX');
  slotButton('helm').click();
  press('KeyX');
  assert.equal(screen.dropButton.hidden, true, 'equipped gear cannot drop');
  assert.equal(drops.length, 3);
});

test('without onDrop there is no drop key or button', (t) => {
  const { screen, inventory, notes, press, indexOf } = mount(t);
  const help = screen.screen.children.at(-1);
  assert.equal(help.id, 'inventory-help');
  assert.doesNotMatch(help.textContent, /Drop/);
  press('KeyI');
  assert.equal(screen.dropButton.hidden, true);
  const before = inventory.slots[0].count;
  assert.equal(press('KeyX').prevented, true);
  assert.equal(inventory.slots[0].count, before);
  assert.equal(notes.length, 0);
  assert.ok(indexOf('rawIron') >= 0);
});

test('number keys do nothing in the window and never reach the game', (t) => {
  const { document, screen, inventory, notes, press, bagButton, indexOf } = mount(t);
  press('KeyI');
  assert.doesNotMatch(document.body.textContent, /1-9|quick slot/i);
  bagButton(indexOf('rawIron')).click();
  const before = JSON.stringify([inventory.slots, inventory.equipment, screen.selection]);
  for (const code of ['Digit3', 'Numpad4', 'Digit9']) {
    assert.deepEqual(press(code), { prevented: false, reachedGame: false }, code);
  }
  assert.equal(JSON.stringify([inventory.slots, inventory.equipment, screen.selection]), before);
  assert.equal(notes.length, 0);
});

test('the twelve equipment slots take boots on the feet and arrows in the quiver', (t) => {
  const { screen, inventory, notes, press, bagButton, slotButton, indexOf } = mount(t);
  press('KeyI');
  assert.deepEqual([...screen.equipmentNodes.keys()], ['helm', 'chest', 'legs', 'hands', 'cape', 'mainHand', 'offHand',
    'feet', 'amulet', 'ringLeft', 'ringRight', 'quiver']);
  assert.deepEqual([...screen.equipmentNodes.values()].map(({ button }) => button.children[0].textContent),
    ['helmet', 'body', 'legs', 'gloves', 'cloak', 'weapon', 'shield', 'boots', 'amulet', 'ring', 'ring', 'quiver']);
  assert.equal(slotButton('feet').getAttribute('aria-label'), 'Feet: Riding Boots');
  assert.equal(slotButton('legs').getAttribute('aria-label'), 'Legs: empty');
  slotButton('feet').click();
  press('KeyU');
  bagButton(indexOf('ridingBoots')).click();
  press('KeyE');
  assert.deepEqual(screen.selection, { source: 'equipment', slot: 'feet' });

  bagButton(indexOf('arrow')).click();
  assert.equal(bagButton(indexOf('arrow')).getAttribute('data-item-kind'), 'equipment');
  press('Enter');
  assert.deepEqual(screen.selection, { source: 'equipment', slot: 'quiver' });
  assert.deepEqual(inventory.equipment.quiver, { id: 'arrow', count: 30 });
  assert.equal(screen.equipmentNodes.get('quiver').count.textContent, '30');
  assert.equal(slotButton('quiver').getAttribute('aria-label'), 'Quiver: Arrow');
  assert.equal(screen.equipmentNodes.get('feet').count.textContent, '');
  assert.deepEqual(notes.at(-1), ['Equipped Arrow.', 'success']);

  inventory.add('arrow', 20);
  assert.equal(inventory.equipment.quiver.count, 40, 'pickups top the quiver up');
  bagButton(indexOf('arrow')).click();
  press('KeyE');
  assert.deepEqual(notes.at(-1), ['Your quiver is full.', 'error']);
  bagButton(indexOf('woodenBuckler')).click();
  inventory.add('outlawHood', 24);
  slotButton('quiver').click();
  press('KeyU');
  assert.deepEqual(notes.at(-1), ['Your bag has no room for this gear.', 'error']);
});

test('dragging a bag stack onto another slot moves or swaps it', (t) => {
  const { document, screen, inventory, press, bagButton, indexOf } = mount(t);
  press('KeyI');
  const dataTransfer = () => ({ data: {}, setData(type, value) { this.data[type] = value; } });

  const empty = bagButton(20).dispatch('dragstart', { dataTransfer: dataTransfer() });
  assert.equal(empty.defaultPrevented, true, 'an empty slot cannot be dragged');
  assert.equal(bagButton(5).dispatch('dragover', { dataTransfer: {} }).defaultPrevented, false);
  assert.equal(bagButton(5).dispatch('drop', { dataTransfer: {} }).defaultPrevented, false);

  const ore = indexOf('rawIron');
  const start = bagButton(ore).dispatch('dragstart', { dataTransfer: dataTransfer() });
  assert.equal(start.defaultPrevented, false);
  assert.equal(start.dataTransfer.data['application/x-ascii-realm-slot'], String(ore));
  assert.equal(start.dataTransfer.effectAllowed, 'move');
  assert.deepEqual(screen.selection, { source: 'bag', index: ore });
  const over = bagButton(20).dispatch('dragover', { dataTransfer: {} });
  assert.equal(over.defaultPrevented, true);
  assert.equal(over.dataTransfer.dropEffect, 'move');
  assert.equal(bagButton(20).dispatch('drop', { dataTransfer: {} }).defaultPrevented, true);
  assert.equal(inventory.slots[ore], null);
  assert.deepEqual(inventory.slots[20], { id: 'rawIron', count: 6 });
  assert.deepEqual(screen.selection, { source: 'bag', index: 20 });
  assert.equal(document.activeElement, bagButton(20));
  assert.equal(bagButton(20).getAttribute('data-item-id'), 'rawIron');
  assert.equal(bagButton(ore).getAttribute('data-item-kind'), 'empty');

  // A drop onto its own slot changes nothing.
  bagButton(20).dispatch('dragstart', { dataTransfer: dataTransfer() });
  bagButton(20).dispatch('drop', { dataTransfer: {} });
  assert.deepEqual(inventory.slots[20], { id: 'rawIron', count: 6 });

  // A cancelled drag leaves later drops alone.
  bagButton(0).dispatch('dragstart', { dataTransfer: dataTransfer() });
  bagButton(0).dispatch('dragend');
  assert.equal(bagButton(1).dispatch('drop', { dataTransfer: {} }).defaultPrevented, false);
  assert.equal(inventory.slots[0].id, 'healingDraught');

  // Closing the panel also ends a drag.
  bagButton(0).dispatch('dragstart', { dataTransfer: dataTransfer() });
  screen.setOpen(false);
  screen.setOpen(true);
  assert.equal(bagButton(1).dispatch('dragover', { dataTransfer: {} }).defaultPrevented, false);
});

test('feedback shows only while open and fades after three and a half seconds', (t) => {
  const { screen, clock, notes, press } = mount(t);
  screen.onNotify('Picked up Flint.');
  assert.deepEqual(notes, [['Picked up Flint.', 'info']], 'the game hears it even while closed');
  assert.equal(screen.feedback.hidden, true);

  press('KeyI');
  screen.onNotify('Picked up Reed.', 'success');
  assert.equal(screen.feedback.textContent, 'Picked up Reed.');
  assert.equal(screen.feedback.hidden, false);
  clock.now += 3499;
  screen.update();
  assert.equal(screen.feedback.hidden, false);
  clock.now += 1;
  screen.update();
  assert.equal(screen.feedback.hidden, true);

  screen.onNotify('Again.');
  press('Escape');
  press('KeyI');
  assert.equal(screen.feedback.hidden, true, 'reopening starts without old feedback');
});

test('update redraws only when the inventory, selection or vitality changes', (t) => {
  const { screen, inventory, player, press } = mount(t);
  let draws = 0;
  const render = screen._render.bind(screen);
  screen._render = () => { draws++; return render(); };

  screen.update();
  assert.equal(draws, 0, 'a closed panel does no work');
  press('KeyI');
  assert.equal(draws, 1);
  screen.update();
  screen.update();
  assert.equal(draws, 1);
  inventory.add('flint', 2);
  screen.update();
  assert.equal(draws, 2);
  assert.equal(screen.slotCounter.textContent, 'Bag 16/24');
  player.vitals.health = 100;
  screen.update();
  assert.equal(draws, 3);
  assert.equal(screen.useButton.disabled, true);
});

test('a new skin does not redraw the window, which has no portrait', (t) => {
  const { screen, player, press } = mount(t);
  let draws = 0;
  const render = screen._render.bind(screen);
  screen._render = () => { draws++; return render(); };
  press('KeyI');
  assert.equal(draws, 1);
  player.skin = presetSkin('drover');
  screen.update();
  assert.equal(draws, 1);
  assert.equal(screen.screen.querySelectorAll('canvas').length, 0);
});

test('details describe the selected item, its stats, weight and durability', (t) => {
  const { screen, inventory, press, bagButton, slotButton, indexOf } = mount(t);
  press('KeyI');
  const draught = ITEMS.healingDraught;
  assert.equal(screen.itemType.textContent, 'Consumable');
  assert.equal(screen.itemName.textContent, draught.name);
  assert.equal(screen.description.textContent, draught.description);
  assert.equal(screen.itemPreview.textContent, itemArt('healingDraught', draught.glyph));
  assert.equal(screen.itemPreview.hidden, false);
  assert.deepEqual(screen.stats.children.map((node) => [node.tagName, node.textContent]),
    [['DT', 'Health'], ['DD', '+35']]);
  assert.equal(screen.stats.hidden, false);
  assert.equal(screen.itemWeight.textContent, '0.25 kg each / 0.75 kg carried / 3 items');
  assert.equal(screen.durability.hidden, true);
  assert.equal(screen.durability.textContent, '');
  assert.equal(screen.details.textContent.includes('Quick slot'), false);
  assert.equal(screen.details.getAttribute('data-item-id'), 'healingDraught');
  assert.ok(visible(screen.useButton));
  assert.equal(screen.equipButton.hidden, true);
  assert.equal(screen.unequipButton.hidden, true);

  assert.equal(stat(screen, 'weight'), '39.8/60 kg');
  const slot = bagButton(0);
  assert.equal(slot.getAttribute('aria-label'), `Slot 1: ${draught.name}, count 3`);
  assert.equal(slot.getAttribute('data-item-kind'), 'consumable');
  assert.equal(slot.getAttribute('draggable'), 'true');
  assert.equal(slot.getAttribute('tabindex'), '0');
  assert.equal(slot.getAttribute('aria-describedby'), 'inventory-item-details');
  assert.ok(slot.classList.contains('selected'));
  assert.equal(screen.bagNodes[0].count.textContent, 'x3');
  assert.equal(bagButton(indexOf('woodenBuckler')).getAttribute('data-item-kind'), 'equipment');
  assert.equal(bagButton(indexOf('rawIron')).getAttribute('data-item-kind'), 'material');
  assert.equal(bagButton(20).getAttribute('aria-label'), 'Slot 21: empty');
  assert.equal(bagButton(20).getAttribute('draggable'), 'false');
  assert.ok(bagButton(20).classList.contains('empty'));
  assert.equal(bagButton(20).hasAttribute('aria-describedby'), false);

  // Equipped gear.
  slotButton('mainHand').click();
  const sword = ITEMS.shortSword;
  assert.equal(bagButton(0).hasAttribute('aria-describedby'), false, 'only the selection is described');
  assert.equal(screen.itemType.textContent, 'Equipment');
  assert.equal(screen.itemName.textContent, sword.name);
  assert.deepEqual(screen.stats.children.map((node) => node.textContent),
    ['Material', 'Iron', 'Grip', 'One hand']);
  assert.equal(screen.durability.textContent, 'Durability: 100 / 100');
  assert.equal(screen.durability.hidden, false);
  assert.equal(screen.itemWeight.textContent, `${sword.weight} kg each / ${sword.weight} kg carried / 1 item`);
  assert.ok(visible(screen.unequipButton));
  assert.equal(screen.equipButton.hidden, true);
  assert.equal(screen.useButton.hidden, true);
  assert.equal(slotButton('mainHand').getAttribute('aria-label'), `Main hand: ${sword.name}`);
  assert.equal(slotButton('mainHand').getAttribute('tabindex'), '0');
  assert.equal(screen.equipmentNodes.get('mainHand').icon.textContent, itemArt('shortSword', sword.glyph));
  inventory.equipment.mainHand.durability = 40;
  screen.update();
  assert.equal(screen.durability.textContent, 'Durability: 40 / 100');

  // Empty slots.
  slotButton('offHand').click();
  assert.equal(slotButton('offHand').getAttribute('aria-label'), 'Off hand: empty');
  assert.equal(screen.itemName.textContent, 'Off hand slot');
  assert.equal(screen.itemType.textContent, '');
  assert.equal(screen.description.textContent, 'Select compatible gear in your bag, then press E to equip it.');
  assert.equal(screen.stats.hidden, true);
  assert.equal(screen.stats.children.length, 0);
  assert.equal(screen.itemPreview.hidden, true);
  assert.equal(screen.itemWeight.hidden, true);
  assert.equal(screen.unequipButton.hidden, true);
  bagButton(20).click();
  assert.equal(screen.itemName.textContent, 'Empty slot');
  assert.equal(screen.description.textContent, 'Drag another item into this slot to move or swap it.');
  assert.equal(screen.details.getAttribute('data-item-id'), '');
});

test('on phones an empty equipment slot names the Equip button instead of a key', (t) => {
  let phone = true;
  const { screen, press, slotButton } = mount(t, { phone: () => phone });
  press('KeyI');
  slotButton('offHand').click();
  assert.equal(screen.description.textContent, 'Select compatible gear in your bag, then tap Equip.');

  phone = false;
  slotButton('helm').click();
  slotButton('offHand').click();
  assert.equal(screen.description.textContent, 'Select compatible gear in your bag, then press E to equip it.');
});

test('flipping phone mode rewrites the empty-slot hint with the same slot selected', (t) => {
  let phone = false;
  const { screen, press, slotButton } = mount(t, { phone: () => phone });
  press('KeyI');
  slotButton('offHand').click();
  assert.equal(screen.description.textContent, 'Select compatible gear in your bag, then press E to equip it.');

  phone = true;
  screen.update();
  assert.equal(screen.description.textContent, 'Select compatible gear in your bag, then tap Equip.');
  phone = false;
  screen.update();
  assert.equal(screen.description.textContent, 'Select compatible gear in your bag, then press E to equip it.');
});

test('the header names the character and its class, an outlaw without one', (t) => {
  const { screen } = mount(t, { name: 'Mira' });
  assert.equal(screen.nameNode.textContent, 'Mira');
  assert.equal(screen.classNode.textContent, 'Outlaw');
  assert.equal(screen.nameNode.getAttribute('dir'), 'auto');
  const identity = screen.nameNode.parentNode;
  assert.equal(identity.tagName, 'H2');
  assert.equal(identity.textContent, 'Mira · Outlaw');
  assert.equal(identity.children[1].getAttribute('aria-hidden'), 'true');
  screen.setName('Mira', 'Archer');
  assert.equal(screen.classNode.textContent, 'Archer');
  screen.setName('Tamsin');
  assert.equal(screen.nameNode.textContent, 'Tamsin');
  assert.equal(screen.classNode.textContent, 'Archer', 'a name alone keeps the class');
  screen.setName(7, null);
  assert.equal(screen.nameNode.textContent, '7');
  assert.equal(screen.classNode.textContent, 'Outlaw');
  assert.equal(mount(t, { className: 'Warrior' }).screen.classNode.textContent, 'Warrior');
});

test('the close button reads close (I), keeps its name and closes the window', (t) => {
  const { screen, press } = mount(t);
  press('KeyI');
  const close = screen.screen.querySelectorAll('.inventory-close')[0];
  assert.equal(close.textContent, 'closeI');
  assert.equal(close.children[0].tagName, 'KBD');
  assert.equal(close.getAttribute('aria-label'), 'Close inventory');
  assert.equal(screen.screen.getAttribute('role'), 'dialog');
  assert.equal(screen.screen.getAttribute('aria-modal'), 'true');
  assert.equal(screen.screen.getAttribute('aria-label'), 'Inventory');
  close.click();
  assert.equal(screen.isOpen, false);
});

test('the paper doll has a box per slot, on its grid area, in slot order', (t) => {
  const { screen, press, slotButton } = mount(t, { describe: (stack) => stack.id === 'shortSword' ? { name: 'Short Sword' } : null });
  press('KeyI');
  const boxes = screen.screen.querySelectorAll('.equipment-slot');
  assert.deepEqual(boxes.map((button) => button.dataset.equipmentSlot), [...EQUIPMENT_SLOTS]);
  for (const button of boxes) {
    const slot = button.dataset.equipmentSlot;
    assert.equal(button.style.gridArea, dollArea(slot));
    assert.equal(button.dataset.box, DOLL_BOXES[slot].small ? 'small' : 'large');
  }
  assert.equal(boxes.filter((button) => button.dataset.box === 'small').length, 5);
  const amulet = slotButton('amulet');
  assert.ok(amulet.classList.contains('empty'));
  assert.equal(amulet.classList.contains('filled'), false);
  assert.equal(amulet.children[0].textContent, 'amulet');
  assert.equal(amulet.hasAttribute('title'), false);
  assert.equal(slotButton('cape').getAttribute('aria-label'), 'Cloak: Travelling Cloak');
  assert.equal(slotButton('legs').getAttribute('aria-label'), 'Legs: empty');
  const weapon = slotButton('mainHand');
  assert.ok(weapon.classList.contains('filled'));
  assert.equal(weapon.classList.contains('empty'), false);
  assert.equal(weapon.getAttribute('title'), 'Short Sword');
  assert.equal(screen.equipmentNodes.get('mainHand').icon.textContent, itemArt('shortSword', ITEMS.shortSword.glyph));
  assert.equal(slotButton('feet').getAttribute('title'), 'Riding Boots', "an item's own name without a description");
  assert.equal(screen.equipmentNodes.get('feet').count.textContent, '', 'only the quiver counts');
  assert.equal(screen.screen.querySelectorAll('.equipment-slot-name').length, 0);
  assert.equal(screen.screen.querySelectorAll('canvas').length, 0);
});

// The value of one pair in the stats strip, by its label.
function stat(screen, label) {
  const pair = screen.statsStrip.children.find((node) => node.children[0].textContent === label);
  return pair?.children[1].textContent;
}

test('the stats strip shows live HP, stamina and weight, then MP, attributes and the pouch once they exist', (t) => {
  let attributes = null;
  const { screen, player, press } = mount(t, { wallet: { cents: 1240 }, attributes: () => attributes });
  assert.equal(screen.statsStrip.tagName, 'DL');
  assert.equal(screen.statsStrip.getAttribute('aria-label'), 'Character stats');
  screen.update();
  assert.equal(screen.statsStrip.children.length, 0, 'a closed window writes nothing');
  press('KeyI');
  assert.deepEqual(screen.statsStrip.children.map((pair) => pair.textContent),
    ['HP50/100', 'stamina100/100', 'weight39.8/60 kg', 'pouch12.40d']);
  screen.attachMana({ mana: 40, maxMana: 100 });
  attributes = { strength: 7, dexterity: 4, constitution: 6, intelligence: 5, wisdom: 3, charisma: 3 };
  screen.update();
  assert.deepEqual(screen.statsStrip.children.map((pair) => pair.children[0].textContent),
    ['HP', 'MP', 'stamina', 'STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA', 'weight', 'pouch']);
  assert.equal(stat(screen, 'MP'), '40/100');
  assert.equal(stat(screen, 'STR'), '7');

  // Only the HP value is written when the HP changes, and nothing after.
  const writes = new Map();
  for (const pair of screen.statsStrip.children) {
    const value = pair.children[1];
    const label = pair.children[0].textContent;
    const set = Object.getOwnPropertyDescriptor(FakeElement.prototype, 'textContent').set;
    Object.defineProperty(value, 'textContent', { configurable: true,
      get: Object.getOwnPropertyDescriptor(FakeElement.prototype, 'textContent').get,
      set(text) { writes.set(label, (writes.get(label) ?? 0) + 1); set.call(this, text); } });
  }
  const pairs = screen.statsStrip.children;
  player.vitals.health = 37;
  screen.update();
  assert.deepEqual([...writes], [['HP', 1]]);
  assert.equal(stat(screen, 'HP'), '37/100');
  assert.equal(screen.statsStrip.children, pairs, 'the same pairs');
  screen.update();
  assert.deepEqual([...writes], [['HP', 1]]);

  screen.attachMana(null);
  screen.update();
  assert.equal(stat(screen, 'MP'), undefined);
});

test('the panel works without optional callbacks and starts on an empty bag', (t) => {
  const env = installBrowser(t);
  const inventory = new Inventory({ starter: false, capacity: 10 });
  const screen = new InventoryScreen({
    inventory, player: { equipment: inventory.equipment, vitals: { health: 1, maxHealth: 1, stamina: 1, maxStamina: 1 } },
  });
  assert.deepEqual(screen.selection, { source: 'bag', index: 0 });
  assert.equal(screen.nameNode.textContent, 'Kael');
  screen.setOpen(true);
  screen.onNotify('Hello.');
  assert.equal(screen.feedback.textContent, 'Hello.');
  assert.equal(stat(screen, 'weight'), '0/10 kg');
  assert.equal(stat(screen, 'pouch'), undefined);
  assert.equal(stat(screen, 'MP'), undefined);
  assert.equal(screen.description.textContent, 'Drag another item into this slot to move or swap it.');
  screen.destroy();
  assert.equal(env.document.body.classList.contains('inventory-open'), false);
});

test('destroy closes the panel and removes its listeners', (t) => {
  const { screen, toggles, press } = mount(t);
  press('KeyI');
  const root = screen.root;
  screen.destroy();
  assert.equal(screen.isOpen, false);
  assert.deepEqual(toggles, [true, false]);
  assert.equal(root.children.includes(screen.screen), false);
  assert.equal(screen.screen.parentNode, null);
  assert.deepEqual(press('KeyI'), { prevented: false, reachedGame: true });
  assert.equal(screen.isOpen, false);
  assert.equal(press('KeyI', { type: 'keyup' }).reachedGame, true);
});

test('destroying a closed panel does not toggle it', (t) => {
  const { screen, toggles, press } = mount(t);
  screen.destroy();
  assert.deepEqual(toggles, []);
  assert.equal(press('KeyI').reachedGame, true);
});

test('pointer and wheel events inside the panel stay away from the scene', (t) => {
  const { screen } = mount(t);
  for (const type of ['wheel', 'pointerdown', 'pointerup', 'mousedown', 'mouseup']) {
    assert.equal(screen.screen.dispatch(type).stopped, true, type);
  }
});

test('an instrument lists its keys under the description, and phones say why they wait', (t) => {
  let phone = false;
  const inventory = new Inventory({ starter: false });
  for (const id of ['shortSword', 'lute', 'flute']) inventory.add(id);
  const { screen, press, bagButton } = mount(t, { inventory, phone: () => phone });
  press('KeyI');
  const lines = () => screen.noteLines.filter((line) => !line.hidden).map((line) => line.textContent);
  bagButton(0).click();
  assert.equal(screen.notes.hidden, true, 'the sword plays nothing');
  assert.deepEqual(lines(), []);
  bagButton(1).click();
  assert.equal(screen.notes.hidden, false);
  assert.deepEqual(lines(), [
    'Use keys 1-8 to play notes: 1-[C] 2-[D] 3-[E] 4-[F] 5-[G] 6-[A] 7-[B] 8-[C]',
    'Hold Shift to play chords: 1-[C] 2-[D] 3-[E] 4-[F] 5-[G] 6-[A] 7-[B] 8-[C]',
  ]);
  assert.deepEqual(screen.stats.children.map((node) => node.textContent),
    ['Material', 'Wood and gut', 'Voice', 'Plucked strings', 'Notes', 'C4-C5', 'Shift', 'Chords']);
  bagButton(2).click();
  assert.equal(lines()[1], 'Hold Shift to play additional notes: 9-[C] 10-[D] 11-[E] 12-[F] 13-[G] 14-[A] 15-[B] 16-[C]');
  phone = true;
  screen.update();
  assert.equal(lines().length, 3);
  assert.equal(lines()[2], 'Played with a keyboard for now.');
  assert.equal(screen.itemPreview.textContent, itemArt('flute', ITEMS.flute.glyph));
  bagButton(3).click();
  assert.equal(screen.notes.hidden, true, 'an empty slot plays nothing');
});

// The inventory with the Character page, holding a button, as a second tab.
function withCharacterPage(t) {
  const shows = [];
  let node;
  const env = mount(t, { inventory: new Inventory({ starter: true }), pages: ({ document }) => {
    node = document.createElement('section');
    const edit = document.createElement('button');
    edit.className = 'page-button';
    node.append(edit);
    return [{ id: 'character', label: 'Character', node, onShow: () => shows.push('character') }];
  } });
  return { ...env, node, shows, tabs: env.screen.pages.map((page) => page.tab) };
}

test('without extra pages there is no tab row', (t) => {
  const { screen } = mount(t);
  const [tabs] = screen.screen.querySelectorAll('.inventory-tabs');
  assert.equal(tabs.hidden, true);
  assert.equal(screen.page, 'inventory');
});

test('the pages are tabs: roles, names, the chosen one and the panels they control', (t) => {
  const { screen, node, tabs } = withCharacterPage(t);
  const [list] = screen.screen.querySelectorAll('.inventory-tabs');
  assert.equal(list.hidden, false);
  assert.deepEqual([list.getAttribute('role'), list.getAttribute('aria-label')], ['tablist', 'Pages']);
  assert.deepEqual(tabs.map((tab) => [tab.textContent, tab.getAttribute('role'), tab.getAttribute('aria-controls'),
    tab.getAttribute('aria-selected'), tab.tabIndex]),
  [['Inventory', 'tab', 'inventory-page-inventory', 'true', 0], ['Character', 'tab', 'inventory-page-character', 'false', -1]]);
  const [body] = screen.screen.querySelectorAll('.inventory-body');
  for (const [panel, tab] of [[body, tabs[0]], [node, tabs[1]]]) {
    assert.deepEqual([panel.id, panel.getAttribute('role'), panel.getAttribute('aria-labelledby')],
      [tab.getAttribute('aria-controls'), 'tabpanel', tab.id]);
  }
  assert.equal(node.hidden, true);
  assert.equal(screen.nameNode.getAttribute('dir'), 'auto');
});

test('the inventory opens on a page, turns to another while open, and shows each', (t) => {
  const { screen, node, tabs, shows, document } = withCharacterPage(t);
  const [body] = screen.screen.querySelectorAll('.inventory-body');
  const [help] = screen.screen.querySelectorAll('.inventory-help');
  screen.setOpen(true, 'character');
  assert.equal(screen.isOpen, true);
  assert.deepEqual([node.hidden, body.hidden, help.hidden], [false, true, true]);
  assert.equal(document.activeElement, tabs[1], 'focus on the page\'s tab');
  assert.deepEqual(shows, ['character']);
  assert.ok(tabs[1].classList.contains('selected'));
  screen.setOpen(true);
  assert.deepEqual([node.hidden, body.hidden, help.hidden], [true, false, false]);
  assert.equal(document.activeElement, tabs[0]);
  screen.setOpen(true, 'nowhere');
  assert.equal(screen.page, 'inventory', 'an unknown page changes nothing');
  screen.setOpen(false);
  screen.toggle();
  assert.equal(screen.page, 'inventory', 'I, Tab and the phone menu open the bag');
  assert.equal(document.activeElement, screen._selectedButton());
  tabs[1].click();
  assert.equal(screen.page, 'character');
  assert.deepEqual(shows, ['character', 'character']);
});

test('C turns to the next page, once per press; arrows, Home and End move along the tabs', (t) => {
  const { screen, tabs, press, document } = withCharacterPage(t);
  screen.setOpen(true);
  assert.deepEqual(press('KeyC'), { prevented: true, reachedGame: false });
  assert.equal(screen.page, 'character');
  assert.equal(document.activeElement, tabs[1]);
  press('KeyC', { repeat: true });
  assert.equal(screen.page, 'character', 'a held key turns no further');
  press('KeyC');
  assert.equal(screen.page, 'inventory', 'and wraps round');
  tabs[0].focus();
  for (const [code, page] of [['ArrowRight', 'character'], ['ArrowRight', 'inventory'], ['ArrowLeft', 'character'],
    ['Home', 'inventory'], ['End', 'character']]) {
    assert.deepEqual(press(code), { prevented: true, reachedGame: false }, code);
    assert.equal(screen.page, page, code);
    assert.equal(document.activeElement, screen._tab(), code);
  }
  // Enter and Space on a tab choose it.
  tabs[0].focus();
  press('Enter');
  assert.equal(screen.page, 'inventory');
  tabs[1].focus();
  press('Space');
  assert.equal(screen.page, 'character');
});

test('on the Character page the bag keys do nothing, game keys stay out, and Esc, Tab and Shift+Tab work', (t) => {
  const { screen, node, tabs, press, document, inventory } = withCharacterPage(t);
  screen.setOpen(true, 'character');
  const before = JSON.stringify([inventory.slots, inventory.equipment, screen.selection]);
  for (const code of ['KeyG', 'KeyE', 'KeyU', 'KeyX', 'Digit1', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'NumpadEnter', 'KeyQ', 'KeyW', 'Space', 'KeyZ']) {
    tabs[1].focus();
    if (code === 'ArrowLeft' || code === 'ArrowRight') document.activeElement = document.body;
    assert.equal(press(code, { target: document.body }).reachedGame, false, code);
  }
  assert.equal(JSON.stringify([inventory.slots, inventory.equipment, screen.selection]), before);
  assert.equal(screen.page, 'character');
  assert.equal(press('KeyW', { target: document.body }).prevented, true, 'movement keys are swallowed');
  // Shift+Tab cycles the visible buttons: the chosen tab, Close and the page's own.
  const [pageButton] = node.querySelectorAll('.page-button');
  const [close] = screen.screen.querySelectorAll('.inventory-close');
  tabs[1].focus();
  press('Tab', { shiftKey: true });
  assert.equal(document.activeElement, pageButton);
  press('Tab', { shiftKey: true });
  assert.equal(document.activeElement, close);
  press('Tab', { shiftKey: true });
  assert.equal(document.activeElement, tabs[1]);
  press('Escape');
  assert.equal(screen.isOpen, false);
  screen.setOpen(true, 'character');
  press('Tab');
  assert.equal(screen.isOpen, false, 'Tab closes from any page');
});

test('on the bag page arrows still move through the slots, even from its tab', (t) => {
  const { screen, tabs, press, document } = withCharacterPage(t);
  screen.setOpen(true);
  press('ArrowRight');
  assert.equal(screen.selection.index, 1);
  tabs[0].focus();
  press('ArrowDown');
  assert.equal(screen.selection.index, 7);
  assert.equal(document.activeElement, screen._selectedButton());
});

test('a stack with its own description shows its name in its colour, its text and stats', (t) => {
  let version = 0;
  let name = 'Ferranite';
  const inventory = new Inventory({ starter: false });
  inventory.add('alloyIngot', 1, { alloy: 'a1' });
  inventory.add('rawTin', 2);
  const { screen, press, bagButton } = mount(t, { inventory, describeVersion: () => version,
    describe: (stack) => (stack.id === 'alloyIngot' ? { name, colour: '#B0B3B5', description: `An ingot of ${name}.`,
      stats: { 'Attack Damage': '3.15', Tier: '1' } } : null) });
  press('KeyI');
  assert.equal(screen.itemName.textContent, 'Ferranite');
  assert.equal(screen.itemName.style.color, '#B0B3B5');
  assert.equal(screen.description.textContent, 'An ingot of Ferranite.');
  assert.deepEqual(screen.stats.children.map((node) => node.textContent), ['Attack Damage', '3.15', 'Tier', '1']);
  assert.equal(bagButton(0).getAttribute('aria-label'), 'Slot 1: Ferranite, count 1');
  // A rename shows once the describer's version moves.
  name = 'Moon Iron';
  screen.update();
  assert.equal(screen.itemName.textContent, 'Ferranite');
  version++;
  screen.update();
  assert.equal(screen.itemName.textContent, 'Moon Iron');
  // Anything else keeps its item's own text and the default ink.
  press('ArrowRight');
  assert.equal(screen.itemName.textContent, 'Raw Tin');
  assert.equal(screen.itemName.style.color, '');
  assert.equal(bagButton(1).getAttribute('aria-label'), 'Slot 2: Raw Tin, count 2');
});

test('a smithed sword shows its metal, quality, socket and damage, and its own durability', async (t) => {
  const { describeWeapon, makeWeapon } = await import('../src/crafting/smithing.js');
  const blackiron = { id: 'a1', name: 'Blackiron', colour: '5E6568', type: 'metal',
    stats: { attackDamage: 4.2, durability: 430.4 }, hits: { hit: 1 } };
  const book = { get: (id) => (id === 'a1' ? blackiron : null) };
  const { id, count, ...extras } = makeWeapon('shortSword', ['a1', 'a1', 'a1', 'ironIngot'], 92, book.get);
  const inventory = new Inventory({ starter: false });
  inventory.add(id, count, extras);
  const { screen, press } = mount(t, { inventory, describe: (stack) => describeWeapon(stack, book) });
  press('KeyI');
  assert.equal(screen.itemName.textContent, 'Blackiron Short Sword');
  assert.equal(screen.itemName.style.color, '#5E6568');
  const stats = Object.fromEntries(screen.stats.children.map((node) => node.textContent)
    .reduce((pairs, text, i) => (i % 2 ? pairs.at(-1).push(text) : pairs.push([text]), pairs), []));
  assert.equal(stats.Material, 'Blackiron');
  assert.equal(stats.Quality, 'Gleaming');
  assert.equal(stats.Socket, 'Radiant (empty)');
  assert.ok(Number(stats.Damage) > 24);
  assert.equal(screen.durability.textContent, 'Durability: 448 / 448', '(3 × 430.4 + 500) ÷ 4, rounded');
  assert.equal(screen.durability.hidden, false);
});
