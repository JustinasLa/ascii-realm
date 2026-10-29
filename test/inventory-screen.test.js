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
  getBoundingClientRect() {
    const { left = 0, top = 0, width = 10, height = 10 } = this.rect ?? {};
    return { left, top, width, height, right: left + width, bottom: top + height };
  }
  get offsetWidth() { return this.getBoundingClientRect().width; }
  get offsetHeight() { return this.getBoundingClientRect().height; }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((entry) => entry !== listener));
  }
  dispatch(type, fields = {}) {
    const event = {
      type, target: this, currentTarget: this, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.stopped = true; },
      stopImmediatePropagation() { this.stopped = true; this.immediate = true; },
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
  override(t, 'innerWidth', 1000);
  override(t, 'innerHeight', 800);
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
  // Selects without acting, as the arrow keys do; a click acts at once.
  const pick = (selection) => screen._select(typeof selection === 'string' ? { source: 'equipment', slot: selection }
    : { source: 'bag', index: selection }, true);
  // A mouse (or pen, or touch) moving over `target`.
  const hover = (target, x = 100, y = 100, pointerType = 'mouse') => screen.screen.dispatch('pointermove',
    { target, pointerType, clientX: x, clientY: y });
  return { ...env, screen, inventory, player, toggles, notes, gameKeys, press, bagButton, slotButton, indexOf, pick, hover };
}

const visible = (node) => !node.hidden;
const tipLines = (screen) => screen.tooltip.lines.children.map((node) => node.textContent);

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

test('scrolled down to the bag and closed, the sheet reopens at its top', (t) => {
  const { screen } = mount(t);
  screen.setOpen(true);
  screen.screen.scrollTop = 240;
  screen.setOpen(false);
  assert.equal(screen.screen.scrollTop, 240, 'closing leaves the scroll alone');
  screen.setOpen(true);
  assert.equal(screen.screen.scrollTop, 0);
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
  assert.deepEqual(screen.root.children, [screen.tooltip.node, screen.screen], 'the item tooltip and the window');
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
  const filters = ['materials', 'consumables', 'ammo', 'cloaks', 'armor', 'weapons', 'all'];
  for (const [step, id] of filters.entries()) {
    if (step) press('Tab', { shiftKey: true });
    assert.equal(document.activeElement, screen.filterNodes.get(id).button, 'the shown filter tabs, backwards');
  }
  press('Tab', { shiftKey: true });
  assert.equal(document.activeElement, close);
  press('Tab', { shiftKey: true });
  assert.equal(document.activeElement, screen.dropButton, 'focus wraps to the last button');
  press('Tab', { shiftKey: true });
  assert.equal(document.activeElement, screen.useButton, 'the hidden Equip and Unequip buttons are skipped');
  assert.equal(screen.tooltip.shown, false);
  press('Tab', { shiftKey: true });
  assert.equal(document.activeElement, bagButton(0), 'only the selected slot is in the tab order');
  assert.equal(screen.tooltip.nameNode.textContent, 'Healing Draught', 'its tooltip shows beside it');
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
  const { document, screen, inventory, player, notes, press, bagButton, slotButton, indexOf, pick } = mount(t);
  press('KeyI');
  const buckler = indexOf('woodenBuckler');
  pick(buckler);

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
  pick(0);
  press('KeyE');
  assert.equal(notes.length, 4, 'a draught cannot be equipped');
  press('Enter');
  assert.equal(player.vitals.health, 85);
  assert.equal(inventory.slots[0].count, 2);
  assert.deepEqual(notes.at(-1), ['Used Healing Draught.', 'success']);
  assert.equal(document.activeElement, bagButton(0));

  // Materials and an empty tab have no action.
  pick(indexOf('rawIron'));
  press('Enter');
  screen._filterBy('cloaks');
  press('Enter');
  press('KeyE');
  // Hidden action buttons do nothing even when clicked.
  screen.useButton.click();
  pick('helm');
  screen.useButton.click();
  screen.equipButton.click();
  assert.equal(inventory.equipment.helm.id, 'outlawHood');
  assert.equal(notes.length, 5);
});

test('panel buttons respond to clicks, Space and Enter, and keep the details in view', (t) => {
  const { document, screen, inventory, player, notes, press, slotButton, indexOf, pick } = mount(t);
  press('KeyI');
  pick(indexOf('woodenBuckler'));

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

  // Space on a slot presses it, as a click does: the hood comes off at once.
  slotButton('helm').focus();
  press('Space');
  assert.equal(inventory.equipment.helm, null);
  assert.deepEqual(screen.selection, { source: 'equipment', slot: 'helm' }, 'the selection stays on the box');

  // Using the last draught moves the selection on to the next card, the tonic.
  pick(0);
  inventory.slots[0].count = 1;
  screen.useButton.focus();
  press('Enter');
  assert.equal(player.vitals.health, 85);
  assert.equal(inventory.slots[0], null);
  assert.deepEqual(screen.selection, { source: 'bag', index: indexOf('staminaTonic') });
  assert.equal(screen.useButton.disabled, true, 'stamina is full');
  assert.equal(document.activeElement, screen.details, 'so focus stays on the details');

  // Mouse clicks on the action buttons.
  pick(indexOf('dagger'));
  screen.equipButton.click();
  assert.equal(inventory.equipment.mainHand.id, 'dagger');
  screen.unequipButton.click();
  assert.equal(inventory.equipment.mainHand, null);
  pick(indexOf('staminaTonic'));
  player.vitals.stamina = 10;
  screen.useButton.click();
  assert.equal(player.vitals.stamina, 55);
  assert.deepEqual(notes.at(-1), ['Used Stamina Tonic.', 'success']);
});

test('a click acts at once and keeps the selection, focus and sheet where they were', (t) => {
  const { document, screen, inventory, player, notes, press, bagButton, slotButton, indexOf } = mount(t);
  press('KeyI');
  const all = [...screen.bagNodes.map((nodes) => nodes.button), ...[...screen.equipmentNodes.values()].map((n) => n.button)];
  assert.ok(all.every((button) => !button.listeners.has('dblclick')), 'a double-click would equip, then take off');
  const focused = document.activeElement;
  const focusCalls = () => all.reduce((sum, button) => sum + button.focusOptions.length, 0);
  const before = focusCalls();

  // Gear equips, swapping: the sword comes back to the bow's card.
  const bow = indexOf('longbow');
  bagButton(bow).click();
  assert.equal(inventory.equipment.mainHand.id, 'longbow');
  assert.equal(inventory.slots[bow].id, 'shortSword');
  assert.deepEqual(notes.at(-1), ['Equipped Yew Longbow.', 'success']);
  assert.deepEqual(screen.selection, { source: 'bag', index: bow }, 'the selection stays in the bag');
  assert.equal(document.activeElement, focused);
  assert.equal(focusCalls(), before, 'focus never moves');

  // A consumable is used; at full vitality it says so.
  bagButton(indexOf('healingDraught')).click();
  assert.equal(player.vitals.health, 85);
  assert.deepEqual(notes.at(-1), ['Used Healing Draught.', 'success']);
  player.vitals.health = 100;
  bagButton(indexOf('healingDraught')).click();
  assert.deepEqual(notes.at(-1), ['Your vitality is already full.', 'info']);
  // A material only selects.
  const ore = indexOf('rawIron');
  const count = notes.length;
  bagButton(ore).click();
  assert.deepEqual(screen.selection, { source: 'bag', index: ore });
  assert.equal(notes.length, count);
  assert.equal(focusCalls(), before);

  // A filled doll box takes its gear off, and the selection stays on the box.
  slotButton('helm').click();
  assert.equal(inventory.equipment.helm, null);
  assert.deepEqual(notes.at(-1), ["Unequipped Outlaw's Hood.", 'success']);
  assert.deepEqual(screen.selection, { source: 'equipment', slot: 'helm' });
  slotButton('helm').click();
  assert.deepEqual(screen.selection, { source: 'equipment', slot: 'helm' }, 'an empty box only selects');
  assert.equal(focusCalls(), before);

  // Equipping the focused, last card of its tab hides it: focus moves on
  // without scrolling the sheet, and the selection to the next card.
  screen._filterBy('armor');
  const hood = indexOf('outlawHood');
  const buckler = indexOf('woodenBuckler');
  bagButton(hood).focus();
  bagButton(hood).click();
  assert.equal(inventory.equipment.helm.id, 'outlawHood');
  assert.deepEqual(screen.selection, { source: 'bag', index: buckler });
  assert.equal(document.activeElement, bagButton(buckler));
  assert.deepEqual(document.activeElement.focusOptions.at(-1), { preventScroll: true });

  // With a full bag, a box says so and keeps its gear.
  for (let index = 0; index < 24; index++) inventory.slots[index] ??= { id: 'flint', count: 1 };
  slotButton('feet').click();
  assert.deepEqual(notes.at(-1), ['Your bag has no room for this gear.', 'error']);
  assert.equal(inventory.equipment.feet.id, 'ridingBoots');
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

  screen._filterBy('cloaks');
  assert.equal(screen.dropButton.hidden, true, 'an empty tab cannot drop');
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
  const { screen, inventory, notes, press, bagButton, slotButton, indexOf, pick } = mount(t);
  press('KeyI');
  assert.deepEqual([...screen.equipmentNodes.keys()], ['helm', 'chest', 'legs', 'hands', 'cape', 'mainHand', 'offHand',
    'feet', 'amulet', 'ringLeft', 'ringRight', 'quiver']);
  assert.deepEqual([...screen.equipmentNodes.values()].map(({ button }) => button.children[0].textContent),
    ['helmet', 'body', 'legs', 'gloves', 'cloak', 'weapon', 'shield', 'boots', 'amulet', 'ring', 'ring', 'quiver']);
  assert.equal(slotButton('feet').getAttribute('aria-label'), 'Feet: Riding Boots');
  assert.equal(slotButton('legs').getAttribute('aria-label'), 'Legs: empty');
  pick('feet');
  press('KeyU');
  pick(indexOf('ridingBoots'));
  press('KeyE');
  assert.deepEqual(screen.selection, { source: 'equipment', slot: 'feet' });

  pick(indexOf('arrow'));
  assert.equal(bagButton(indexOf('arrow')).getAttribute('data-item-kind'), 'ammo');
  press('Enter');
  assert.deepEqual(screen.selection, { source: 'equipment', slot: 'quiver' });
  assert.deepEqual(inventory.equipment.quiver, { id: 'arrow', count: 30 });
  assert.equal(screen.equipmentNodes.get('quiver').count.textContent, '30');
  assert.equal(slotButton('quiver').getAttribute('aria-label'), 'Quiver: Arrow');
  assert.equal(screen.equipmentNodes.get('feet').count.textContent, '');
  assert.deepEqual(notes.at(-1), ['Equipped Arrow.', 'success']);

  inventory.add('arrow', 20);
  assert.equal(inventory.equipment.quiver.count, 40, 'pickups top the quiver up');
  pick(indexOf('arrow'));
  press('KeyE');
  assert.deepEqual(notes.at(-1), ['Your quiver is full.', 'error']);
  pick(indexOf('woodenBuckler'));
  inventory.add('outlawHood', 24);
  pick('quiver');
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

test('the bag reads its count and hint, then filter tabs with stack counts over a card per slot', (t) => {
  let phone = false;
  const { screen, inventory, press, bagButton, indexOf } = mount(t, { onDrop: () => null, phone: () => phone });
  press('KeyI');
  assert.equal(screen.slotCounter.textContent, 'Bag 15/24');
  assert.equal(screen.bagHint.textContent, 'LMB \u2014 equip / take off \u00b7 RMB \u2014 drop');
  phone = true;
  screen.update();
  assert.equal(screen.bagHint.textContent, 'tap \u2014 equip / take off \u00b7 hold \u2014 drop');

  const filters = [...screen.filterNodes.values()].map(({ button }) => button);
  assert.equal(filters.length, 8);
  assert.ok(filters.every((button) => button.getAttribute('role') === null), 'not page tabs');
  assert.deepEqual(filters.filter(visible).map((button) => button.textContent),
    ['All15', 'Weapons8', 'Armor1', 'Cloaks0', 'Ammo1', 'Consumables3', 'Materials2']);
  assert.equal(screen.filterNodes.get('instruments').button.hidden, true, 'no instruments yet');
  assert.equal(screen.filterNodes.get('all').button.getAttribute('aria-pressed'), 'true');
  assert.ok(screen.filterNodes.get('all').button.classList.contains('selected'));
  assert.equal(screen.cardGrid.getAttribute('aria-label'), 'Carried items');

  assert.equal(screen.bagNodes.length, 24);
  assert.deepEqual(screen.bagNodes.map(({ button }) => !button.hidden), inventory.slots.map(Boolean));
  assert.equal(screen.bagEmpty.hidden, true);
  const arrows = bagButton(indexOf('arrow'));
  assert.equal(screen.bagNodes[indexOf('arrow')].count.textContent, '\u00d730');
  assert.equal(screen.bagNodes[indexOf('longbow')].count.textContent, 'yew');
  assert.equal(screen.bagNodes[indexOf('rawIron')].icon.textContent, itemArt('rawIron', ITEMS.rawIron.glyph));
  assert.equal(arrows.getAttribute('aria-label'), `Slot ${indexOf('arrow') + 1}: Arrow, count 30`);
  assert.equal(arrows.getAttribute('data-item-kind'), 'ammo');
  assert.equal(arrows.getAttribute('data-item-id'), 'arrow');
  inventory.unequip('mainHand');
  screen.update();
  assert.equal(screen.bagNodes[indexOf('shortSword')].count.textContent, 'iron');
  inventory.add('lute');
  screen.update();
  assert.equal(screen.filterNodes.get('instruments').button.textContent, 'Instruments1');
  assert.equal(screen.slotCounter.textContent, 'Bag 17/24');
});

test('a filter tab shows only its kind, moves the selection to its first card and falls back to all', (t) => {
  const { screen, inventory, press, bagButton, slotButton, indexOf, pick } = mount(t, { onDrop: (index) => {
    inventory.remove(index, inventory.slots[index].count);
    return { ok: true, message: 'Dropped.' };
  } });
  press('KeyI');
  let draws = 0;
  const render = screen._render.bind(screen);
  screen._render = () => { draws++; return render(); };
  screen.filterNodes.get('weapons').button.click();
  assert.equal(draws, 1, 'one redraw per filter change');
  assert.equal(screen.filter, 'weapons');
  assert.equal(screen.filterNodes.get('weapons').button.getAttribute('aria-pressed'), 'true');
  assert.equal(screen.filterNodes.get('all').button.getAttribute('aria-pressed'), 'false');
  const weapons = ['longbow', 'spear', 'javelin', 'battleAxe', 'dagger', 'greatsword', 'warHammer', 'quarterstaff'];
  assert.deepEqual(screen.bagNodes.filter(({ button }) => visible(button)).map(({ button }) => button.getAttribute('data-item-id')),
    weapons);
  assert.deepEqual(screen.selection, { source: 'bag', index: indexOf('longbow') });
  screen.filterNodes.get('weapons').button.click();
  assert.equal(draws, 1, 'the same tab again changes nothing');
  pick(indexOf('dagger'));
  screen.filterNodes.get('all').button.click();
  assert.deepEqual(screen.selection, { source: 'bag', index: indexOf('dagger') }, 'a shown card stays selected');
  pick('helm');
  screen.filterNodes.get('consumables').button.click();
  assert.deepEqual(screen.selection, { source: 'equipment', slot: 'helm' }, 'the doll keeps its selection');

  // Dropping the last arrows while on Ammo empties the tab, so all shows.
  screen.filterNodes.get('ammo').button.click();
  assert.deepEqual(screen.selection, { source: 'equipment', slot: 'helm' });
  pick(indexOf('arrow'));
  press('KeyX');
  assert.equal(indexOf('arrow'), -1);
  assert.equal(screen.filter, 'all');
  assert.equal(screen.filterNodes.get('ammo').button.hidden, true);
  assert.equal(screen.filterNodes.get('all').button.getAttribute('aria-pressed'), 'true');
  assert.ok(screen.selection.index > 0 && inventory.slots[screen.selection.index], 'on the next card');
  assert.equal(visible(bagButton(screen.selection.index)), true);
  assert.ok(slotButton('helm'));
});

test('an empty tab shows Nothing here, selects nothing and ignores the bag keys', (t) => {
  const drops = [];
  const { document, screen, inventory, notes, press, bagButton, slotButton, indexOf } = mount(t,
    { onDrop: (index) => drops.push(index) });
  press('KeyI');
  screen.filterNodes.get('cloaks').button.focus();
  screen.filterNodes.get('cloaks').button.click();
  assert.equal(screen.selection, null);
  assert.equal(screen.bagEmpty.hidden, false);
  assert.equal(screen.bagEmpty.textContent, 'Nothing here.');
  assert.equal(screen.filterNodes.get('cloaks').button.textContent, 'Cloaks0');
  assert.ok(screen.bagNodes.every(({ button }) => button.hidden));
  const before = JSON.stringify([inventory.slots, inventory.equipment]);
  for (const code of ['ArrowRight', 'ArrowDown', 'Enter', 'KeyX', 'KeyE', 'KeyU']) {
    assert.equal(press(code, { target: bagButton(0) }).prevented, true, code);
  }
  assert.equal(JSON.stringify([inventory.slots, inventory.equipment]), before);
  assert.equal(screen.selection, null);
  assert.deepEqual([drops, notes], [[], []]);
  screen.filterNodes.get('all').button.click();
  assert.deepEqual(screen.selection, { source: 'bag', index: 0 }, 'back on All, the first card');
  screen.filterNodes.get('cloaks').button.click();
  assert.equal(screen.selection, null);

  // G goes to the doll, and back finds no card, so it stays there.
  for (const [slot, { column, row, width, height }] of Object.entries(DOLL_BOXES)) {
    slotButton(slot).rect = { left: (column - 1) * 50, top: (row - 1) * 40, width: width * 50, height: height * 40 };
  }
  press('KeyG');
  assert.deepEqual(screen.selection, { source: 'equipment', slot: 'helm' });
  press('KeyG');
  assert.deepEqual(screen.selection, { source: 'equipment', slot: 'helm' });

  // Taking the cloak off fills the tab, and G and Enter work again.
  inventory.unequip('cape');
  screen.update();
  press('KeyG');
  assert.deepEqual(screen.selection, { source: 'bag', index: indexOf('travelCloak') }, 'G goes to the first shown card');
  press('Enter');
  assert.equal(inventory.equipment.cape.id, 'travelCloak', 'Enter acts like a click');
  assert.deepEqual(screen.selection, { source: 'equipment', slot: 'cape' }, 'a key follows the item');
  assert.equal(document.activeElement, slotButton('cape'));
});

test('a tap acts at once, and a hold pins the tooltip with its buttons', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const drops = [];
  const { screen, inventory, notes, bagButton, slotButton, indexOf } = mount(t, { onDrop: (index) => {
    drops.push(index);
    inventory.remove(index, inventory.slots[index].count);
    return { ok: true, message: 'Dropped.' };
  }, phone: () => true });
  screen.setOpen(true);
  const touch = (button, ms) => {
    screen.screen.dispatch('pointerdown', { pointerType: 'touch', target: button, pointerId: 1, button: 0, timeStamp: 0 });
    t.mock.timers.tick(ms);
    screen.screen.dispatch('pointerup', { pointerType: 'touch', target: button, pointerId: 1, timeStamp: ms });
    // The window sees the click first, as the capture phase does.
    if (!screen.root.dispatch('click', { target: button }).immediate) button.click();
  };
  const tip = screen.tooltip;
  const actions = () => tip.actions.children.map((button) => button.textContent);
  const bow = indexOf('longbow');
  touch(bagButton(bow), 100);
  assert.equal(inventory.equipment.mainHand.id, 'longbow', 'a tap equips at once');
  assert.equal(tip.shown, false);

  // A hold selects the card and pins its tooltip under it, with no help line.
  const tonic = indexOf('staminaTonic');
  bagButton(tonic).rect = { left: 40, top: 300, width: 56, height: 112 };
  touch(bagButton(tonic), 450);
  assert.deepEqual(screen.selection, { source: 'bag', index: tonic });
  assert.equal(tip.pinned, true);
  assert.equal(tip.nameNode.textContent, 'Stamina Tonic');
  assert.equal(tip.help.hidden, true);
  assert.deepEqual(actions(), ['use', 'drop']);
  assert.equal(tip.node.style.transform, 'translate(40px, 416px)', 'under the card');
  assert.equal(notes.length, 1, 'the lift that ends a hold does nothing');
  // Its buttons act on it and close it.
  inventory.equipment.mainHand = null;
  screen.screen.dispatch('scroll');
  assert.equal(tip.pinned, true, 'a scroll leaves a pinned panel');
  tip.actions.children[0].click();
  assert.deepEqual(notes.at(-1), ['Your vitality is already full.', 'info']);
  assert.equal(tip.shown, false);
  touch(bagButton(tonic), 500);
  tip.actions.children[1].click();
  assert.deepEqual(drops, [tonic]);
  assert.equal(tip.shown, false);

  // Gear has equip and drop, materials drop only, a filled box takes off.
  const dagger = indexOf('dagger');
  touch(bagButton(dagger), 450);
  assert.deepEqual(actions(), ['equip', 'drop']);
  tip.actions.children[0].click();
  assert.equal(inventory.equipment.mainHand.id, 'dagger');
  assert.equal(screen.selection.source, 'bag', 'the selection stays in the bag');
  touch(bagButton(indexOf('rawIron')), 450);
  assert.deepEqual(actions(), ['drop']);
  // A press anywhere else in the window closes the panel before it acts.
  screen.screen.dispatch('pointerdown', { pointerType: 'touch', target: screen.cardGrid, pointerId: 2 });
  assert.equal(tip.shown, false);
  touch(slotButton('helm'), 450);
  assert.equal(tip.nameNode.textContent, "Outlaw's Hood");
  assert.deepEqual(actions(), ['take off']);
  tip.actions.children[0].click();
  assert.equal(inventory.equipment.helm, null);
  assert.deepEqual(screen.selection, { source: 'equipment', slot: 'helm' });
  // Empty boxes, and everything a mouse does, never hold.
  touch(slotButton('helm'), 600);
  touch(slotButton('amulet'), 600);
  screen.screen.dispatch('pointerdown', { pointerType: 'mouse', target: bagButton(0), pointerId: 3, button: 0 });
  t.mock.timers.tick(600);
  assert.equal(tip.shown, false);
  // Closing the window drops a hold in progress.
  screen.screen.dispatch('pointerdown', { pointerType: 'touch', target: bagButton(0), pointerId: 4, button: 0 });
  screen.setOpen(false);
  t.mock.timers.tick(600);
  assert.equal(tip.shown, false);
  // A scroll settling under a touch on its way to a hold leaves it be.
  screen.setOpen(true);
  screen.screen.dispatch('pointerdown', { pointerType: 'touch', target: bagButton(0), pointerId: 5, button: 0 });
  screen.screen.dispatch('scroll');
  t.mock.timers.tick(450);
  assert.equal(tip.pinned, true);
});

test('a stack that hides under the filter is never left selected, so no key acts on it', (t) => {
  const drops = [];
  const { document, screen, inventory, notes, press, bagButton, slotButton, indexOf } = mount(t, {
    onDrop: (index) => {
      drops.push(inventory.slots[index].id);
      inventory.remove(index, inventory.slots[index].count);
      return { ok: true, message: 'Dropped.' };
    },
  });
  for (const [slot, { column, row, width, height }] of Object.entries(DOLL_BOXES)) {
    slotButton(slot).rect = { left: (column - 1) * 50, top: (row - 1) * 40, width: width * 50, height: height * 40 };
  }
  press('KeyI');
  screen.filterNodes.get('weapons').button.click();
  press('KeyG');
  assert.deepEqual(screen.selection, { source: 'equipment', slot: 'helm' });
  press('KeyU');
  const hood = indexOf('outlawHood');
  assert.ok(hood >= 0, 'the helm is in the bag');
  assert.equal(bagButton(hood).hidden, true, 'under Weapons');
  assert.deepEqual(screen.selection, { source: 'bag', index: indexOf('longbow') }, 'on the first shown card');
  assert.equal(document.activeElement, bagButton(indexOf('longbow')));
  press('KeyX');
  assert.deepEqual(drops, ['longbow'], 'X drops what shows, never the hidden helm');
  assert.equal(inventory.slots[hood].id, 'outlawHood');

  // A change from outside before the next frame (a pickup, a world drop)
  // is caught by the key itself.
  const spear = screen.selection.index;
  assert.equal(inventory.slots[spear].id, 'spear');
  inventory.remove(spear, 1);
  press('KeyX');
  assert.deepEqual(drops, ['longbow', 'javelin']);

  // On an empty tab the gear taken off hides too, and nothing is selected.
  screen.filterNodes.get('cloaks').button.click();
  press('KeyG');
  assert.deepEqual(screen.selection, { source: 'equipment', slot: 'helm' });
  press('ArrowDown');
  const slot = screen.selection.slot;
  const gear = inventory.equipment[slot].id;
  assert.notEqual(ITEMS[gear].equipmentSlot, 'cape');
  press('KeyU');
  assert.equal(inventory.equipment[slot], null);
  assert.equal(screen.selection, null);
  assert.equal(document.activeElement, slotButton(slot), 'focus stays on the box');
  const before = JSON.stringify([inventory.slots, inventory.equipment]);
  for (const code of ['KeyX', 'Enter', 'KeyE']) press(code);
  assert.equal(JSON.stringify([inventory.slots, inventory.equipment]), before);
  assert.deepEqual(drops, ['longbow', 'javelin']);
  assert.equal(notes.filter(([message]) => message.startsWith('Equipped')).length, 0);

  // Using the last of a stack, or a pickup into an empty tab, lands on a shown card.
  screen.filterNodes.get('all').button.click();
  inventory.slots[0].count = 1;
  screen._select({ source: 'bag', index: 0 }, true);
  press('Enter');
  assert.equal(inventory.slots[0], null);
  assert.equal(bagButton(0).hidden, true);
  assert.equal(screen.selection.index, 1);
  screen.filterNodes.get('cloaks').button.click();
  assert.equal(screen.selection, null);
  inventory.unequip('cape');
  screen.update();
  assert.deepEqual(screen.selection, { source: 'bag', index: indexOf('travelCloak') });
});

test('cards drag natively only on mouse desktops, switching as the pointer does', (t) => {
  const query = { matches: false, listeners: [], addEventListener(type, listener) { this.listeners.push([type, listener]); },
    removeEventListener(type, listener) { this.listeners = this.listeners.filter(([, entry]) => entry !== listener); } };
  const asked = [];
  const { screen, bagButton } = mount(t, { beforeMount: () => override(t, 'matchMedia', (text) => {
    asked.push(text);
    return query;
  }) });
  screen.setOpen(true);
  assert.deepEqual(asked, ['(hover: hover) and (pointer: fine)']);
  assert.equal(bagButton(0).getAttribute('draggable'), 'false', 'a touch screen holds instead');
  query.matches = true;
  query.listeners[0][1]();
  assert.equal(bagButton(0).getAttribute('draggable'), 'true');
  assert.equal(bagButton(20).getAttribute('draggable'), 'false', 'an empty card never drags');
  screen.destroy();
  assert.deepEqual(query.listeners, []);
});

test('a right-click drops a card, and the browser menu never opens in the window', (t) => {
  const drops = [];
  const { screen, inventory, notes, bagButton, slotButton, indexOf } = mount(t, {
    onDrop: (index) => {
      drops.push([index, inventory.slots[index].count]);
      inventory.remove(index, inventory.slots[index].count);
      return { ok: true, message: 'Dropped Iron Ore x6.' };
    },
  });
  screen.setOpen(true);
  const ore = indexOf('rawIron');
  const art = screen.bagNodes[ore].icon;
  screen.screen.dispatch('pointerdown', { pointerType: 'mouse', button: 2, target: art });
  const menu = screen.screen.dispatch('contextmenu', { target: art });
  assert.equal(menu.defaultPrevented, true);
  assert.deepEqual(drops, [[ore, 6]]);
  assert.deepEqual(notes.at(-1), ['Dropped Iron Ore x6.', 'success']);
  assert.equal(bagButton(ore).hidden, true);
  assert.equal(inventory.slots[screen.selection.index]?.id, 'oakLog', 'the selection moves to the next card');

  for (const target of [slotButton('helm'), screen.cardGrid, screen.screen]) {
    assert.equal(screen.screen.dispatch('contextmenu', { target }).defaultPrevented, true);
  }
  // A long touch sends a contextmenu on Android: it drops nothing.
  const log = indexOf('oakLog');
  screen.screen.dispatch('pointerdown', { pointerType: 'touch', target: bagButton(log) });
  assert.equal(screen.screen.dispatch('contextmenu', { target: bagButton(log) }).defaultPrevented, true);
  assert.equal(drops.length, 1);
  assert.equal(inventory.equipment.helm.id, 'outlawHood');
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
  const { screen, inventory, press, bagButton, indexOf, pick } = mount(t);
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
  assert.equal(slot.getAttribute('data-item-kind'), 'consumables');
  assert.equal(slot.getAttribute('draggable'), 'true');
  assert.equal(slot.getAttribute('tabindex'), '0');
  assert.equal(slot.getAttribute('aria-describedby'), 'inventory-item-details');
  assert.ok(slot.classList.contains('selected'));
  assert.equal(screen.bagNodes[0].count.textContent, '\u00d73');
  assert.equal(bagButton(indexOf('woodenBuckler')).getAttribute('data-item-kind'), 'armor');
  assert.equal(bagButton(indexOf('rawIron')).getAttribute('data-item-kind'), 'materials');
  assert.equal(bagButton(20).getAttribute('aria-label'), 'Slot 21: empty');
  assert.equal(bagButton(20).getAttribute('draggable'), 'false');
  assert.equal(bagButton(20).hidden, true, 'an empty card hides');
  assert.equal(bagButton(20).hasAttribute('aria-describedby'), false);

  // Equipped gear.
  pick('mainHand');
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
  assert.equal(screen.equipmentNodes.get('mainHand').button.getAttribute('aria-label'), `Main hand: ${sword.name}`);
  assert.equal(screen.equipmentNodes.get('mainHand').button.getAttribute('tabindex'), '0');
  assert.equal(screen.equipmentNodes.get('mainHand').icon.textContent, itemArt('shortSword', sword.glyph));
  inventory.equipment.mainHand.durability = 40;
  screen.update();
  assert.equal(screen.durability.textContent, 'Durability: 40 / 100');

  // Empty slots.
  pick('offHand');
  assert.equal(screen.equipmentNodes.get('offHand').button.getAttribute('aria-label'), 'Off hand: empty');
  assert.equal(screen.itemName.textContent, 'Off hand slot');
  assert.equal(screen.itemType.textContent, '');
  assert.equal(screen.description.textContent, 'Click gear in the bag to equip it.');
  assert.equal(screen.stats.hidden, true);
  assert.equal(screen.stats.children.length, 0);
  assert.equal(screen.itemPreview.hidden, true);
  assert.equal(screen.itemWeight.hidden, true);
  assert.equal(screen.unequipButton.hidden, true);
  pick(0);
  screen._filterBy('cloaks');
  assert.equal(screen.selection, null);
  assert.equal(screen.itemName.textContent, 'Empty slot');
  assert.equal(screen.description.textContent, 'Drag another item into this slot to move or swap it.');
  assert.equal(screen.details.getAttribute('data-item-id'), '');
});

test('on phones an empty equipment slot names the Equip button instead of a key', (t) => {
  let phone = true;
  const { screen, press, pick } = mount(t, { phone: () => phone });
  press('KeyI');
  pick('offHand');
  assert.equal(screen.description.textContent, 'Tap gear in the bag to equip it.');

  phone = false;
  pick('helm');
  pick('offHand');
  assert.equal(screen.description.textContent, 'Click gear in the bag to equip it.');
});

test('flipping phone mode rewrites the empty-slot hint with the same slot selected', (t) => {
  let phone = false;
  const { screen, press, pick } = mount(t, { phone: () => phone });
  press('KeyI');
  pick('offHand');
  assert.equal(screen.description.textContent, 'Click gear in the bag to equip it.');

  phone = true;
  screen.update();
  assert.equal(screen.description.textContent, 'Tap gear in the bag to equip it.');
  phone = false;
  screen.update();
  assert.equal(screen.description.textContent, 'Click gear in the bag to equip it.');
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
  assert.equal(weapon.hasAttribute('title'), false, 'the item tooltip names it');
  assert.equal(screen.equipmentNodes.get('mainHand').icon.textContent, itemArt('shortSword', ITEMS.shortSword.glyph));
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
  assert.equal(screen.selection, null, 'an empty bag selects nothing');
  assert.equal(screen.nameNode.textContent, 'Kael');
  screen.setOpen(true);
  assert.equal(env.document.activeElement, screen.filterNodes.get('all').button, 'so the All tab takes focus');
  assert.equal(screen.bagEmpty.textContent, 'Your bag is empty.');
  assert.equal(screen.bagEmpty.hidden, false);
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
  assert.equal(root.children.includes(screen.tooltip.node), false, 'the tooltip goes too');
  screen.screen.dispatch('pointerdown', { pointerType: 'touch', target: screen.bagNodes[0].button });
  assert.equal(screen.gestures._press, null, 'holds are no longer watched');
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
  const { screen, press, pick } = mount(t, { inventory, phone: () => phone });
  press('KeyI');
  const lines = () => screen.noteLines.filter((line) => !line.hidden).map((line) => line.textContent);
  pick(0);
  assert.equal(screen.notes.hidden, true, 'the sword plays nothing');
  assert.deepEqual(lines(), []);
  pick(1);
  assert.equal(screen.notes.hidden, false);
  assert.deepEqual(lines(), [
    'Use keys 1-8 to play notes: 1-[C] 2-[D] 3-[E] 4-[F] 5-[G] 6-[A] 7-[B] 8-[C]',
    'Hold Shift to play chords: 1-[C] 2-[D] 3-[E] 4-[F] 5-[G] 6-[A] 7-[B] 8-[C]',
  ]);
  assert.deepEqual(screen.stats.children.map((node) => node.textContent),
    ['Material', 'Wood and gut', 'Voice', 'Plucked strings', 'Notes', 'C4-C5', 'Shift', 'Chords']);
  pick(2);
  assert.equal(lines()[1], 'Hold Shift to play additional notes: 9-[C] 10-[D] 11-[E] 12-[F] 13-[G] 14-[A] 15-[B] 16-[C]');
  phone = true;
  screen.update();
  assert.equal(lines().length, 3);
  assert.equal(lines()[2], 'Played with a keyboard for now.');
  assert.equal(screen.itemPreview.textContent, itemArt('flute', ITEMS.flute.glyph));
  pick(3);
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

test('a mouse over a filled card or box shows its tooltip beside the pointer, which moves it, and leaving hides it', (t) => {
  const { screen, inventory, press, bagButton, slotButton, indexOf, hover } = mount(t, { onDrop: () => null });
  press('KeyI');
  const tip = screen.tooltip;
  assert.equal(tip.node.id, 'inventory-item-tooltip');
  assert.equal(tip.node.getAttribute('role'), 'tooltip');
  assert.equal(tip.node.parentNode, screen.root, 'in the root, so the window never clips it');
  assert.equal(tip.shown, false);

  // Over the art inside the bow's card.
  const bow = indexOf('longbow');
  hover(bagButton(bow).children[0]);
  assert.equal(tip.shown, true);
  assert.equal(tip.nameNode.textContent, 'Yew Longbow');
  assert.equal(tip.nameNode.style.color, '', 'the light blue of the CSS');
  assert.deepEqual(tipLines(screen), ['weapon \u00b7 two hands', ITEMS.longbow.description, 'material Yew', 'weight 1.1 kg',
    'durability 100/100']);
  assert.equal(tip.help.textContent, 'click \u2014 equip \u00b7 right-click \u2014 drop');
  assert.equal(tip.node.style.transform, 'translate(114px, 114px)', 'below right of the pointer');
  assert.deepEqual(screen.selection, { source: 'bag', index: 0 }, 'hovering selects nothing');
  const renders = tip.renders;
  hover(bagButton(bow), 300, 200);
  assert.equal(tip.node.style.transform, 'translate(314px, 214px)');
  hover(bagButton(bow), 995, 795);
  assert.equal(tip.node.style.transform, 'translate(971px, 771px)', 'flipped left and up at the edges');
  assert.equal(tip.renders, renders, 'moving only moves it');

  // A draught, at its stack's weight; a material; a filled box.
  hover(bagButton(0));
  assert.deepEqual(tipLines(screen), ['consumable', ITEMS.healingDraught.description, 'weight 0.25 kg each \u00b7 0.75 kg',
    'restores 35 health']);
  assert.equal(tip.help.textContent, 'click \u2014 use \u00b7 right-click \u2014 drop');
  hover(bagButton(indexOf('rawIron')));
  assert.equal(tip.help.textContent, 'right-click \u2014 drop');
  inventory.equipment.mainHand.durability = 40;
  hover(slotButton('mainHand'));
  assert.equal(tip.nameNode.textContent, 'Short Sword');
  assert.equal(tipLines(screen).at(-1), 'durability 40/100');
  assert.equal(tip.help.textContent, 'click \u2014 take off');

  // Touch moves, empty boxes and the gaps between show nothing.
  hover(bagButton(bow), 100, 100, 'touch');
  assert.equal(tip.nameNode.textContent, 'Short Sword', 'a touch never hovers');
  hover(slotButton('amulet'));
  assert.equal(tip.shown, false);
  hover(bagButton(bow));
  hover(screen.cardGrid);
  assert.equal(tip.shown, false);
  // Leaving the window, a scroll, a filter, a drag or closing hides it.
  for (const hide of [
    () => screen.screen.dispatch('pointerleave'),
    () => screen.screen.dispatch('scroll'),
    () => screen.filterNodes.get('weapons').button.click(),
    () => bagButton(bow).dispatch('dragstart', { dataTransfer: { setData() {} } }),
    () => screen.setOpen(false),
  ]) {
    screen.setOpen(true);
    hover(bagButton(bow));
    assert.equal(tip.shown, true);
    hide();
    assert.equal(tip.shown, false);
  }
});

test('the keys show the tooltip beside the button they select, and an empty box says how to fill it', (t) => {
  let phone = false;
  const { document, screen, press, bagButton, slotButton, hover } = mount(t, { phone: () => phone });
  for (const [slot, { column, row, width, height }] of Object.entries(DOLL_BOXES)) {
    slotButton(slot).rect = { left: (column - 1) * 50, top: (row - 1) * 40, width: width * 50, height: height * 40 };
  }
  press('KeyI');
  const tip = screen.tooltip;
  assert.equal(tip.shown, false, 'opening shows no tooltip');
  bagButton(1).rect = { left: 300, top: 200, width: 50, height: 100 };
  press('ArrowRight');
  assert.equal(document.activeElement, bagButton(1));
  assert.equal(tip.nameNode.textContent, 'Stamina Tonic');
  assert.equal(tip.node.style.transform, 'translate(364px, 214px)', 'beside the button');
  // A scroll carries the button, and the tooltip follows it.
  bagButton(1).rect = { left: 300, top: 120, width: 50, height: 100 };
  screen.screen.dispatch('scroll');
  assert.equal(tip.node.style.transform, 'translate(364px, 134px)');

  press('KeyG');
  assert.equal(tip.nameNode.textContent, "Outlaw's Hood");
  press('ArrowRight');
  const slot = screen.selection.slot;
  assert.equal(screen.inventory.equipment[slot], null);
  assert.equal(tip.nameNode.textContent, slot === 'amulet' ? 'Amulet' : tip.nameNode.textContent);
  assert.deepEqual(tipLines(screen), []);
  assert.equal(tip.help.textContent, 'Click gear in the bag to equip it.');
  phone = true;
  screen.update();
  assert.equal(tip.help.textContent, 'Tap gear in the bag to equip it.', 'phones name taps');
  // A pointer press ends the keyboard's tooltips.
  screen.screen.dispatch('pointerdown', { pointerType: 'mouse', target: screen.cardGrid });
  hover(screen.cardGrid);
  assert.equal(tip.shown, false);
  screen._select({ source: 'bag', index: 0 }, true);
  assert.equal(tip.shown, false, 'a selection a pointer made shows none');
});

test('the tooltip redraws when what it describes changes, and only then', (t) => {
  let version = 0;
  const { screen, inventory, press, bagButton, slotButton, indexOf, hover } = mount(t, { describeVersion: () => version });
  press('KeyI');
  const tip = screen.tooltip;
  hover(slotButton('mainHand'));
  assert.equal(tip.nameNode.textContent, 'Short Sword');
  const renders = tip.renders;
  screen.update();
  screen.update();
  assert.equal(tip.renders, renders, 'an unchanged frame does not redraw');
  // An equip swaps another sword into the same box under the pointer.
  screen._select({ source: 'bag', index: indexOf('dagger') });
  screen._equip({ pointer: true });
  screen.update();
  assert.equal(tip.nameNode.textContent, 'Dagger');
  assert.equal(tip.renders, renders + 1);
  // A count, or the describer's version.
  const arrows = indexOf('arrow');
  hover(bagButton(arrows));
  inventory.slots[arrows].count = 12;
  screen.update();
  assert.equal(tipLines(screen).at(-1), 'weight 0.03 kg each \u00b7 0.36 kg');
  const before = tip.renders;
  version++;
  screen.update();
  assert.equal(tip.renders, before, 'the same lines are not rebuilt');
  assert.notEqual(tip._key, null);
  // A stack that leaves its card takes the tooltip with it.
  inventory.remove(arrows, 12);
  screen.update();
  assert.equal(tip.shown, false);
});

test('an instrument lists its keys in its tooltip, and phones say why they wait', (t) => {
  let phone = false;
  const inventory = new Inventory({ starter: false });
  for (const id of ['shortSword', 'lute', 'flute']) inventory.add(id);
  const { screen, press, bagButton, hover } = mount(t, { inventory, phone: () => phone });
  press('KeyI');
  hover(bagButton(0));
  assert.equal(tipLines(screen).some((line) => line.startsWith('Use keys')), false, 'the sword plays nothing');
  hover(bagButton(1));
  assert.deepEqual(tipLines(screen), ['instrument', ITEMS.lute.description, 'material Wood and gut', 'voice Plucked strings',
    'notes C4-C5', 'shift Chords', 'weight 1.5 kg',
    'Use keys 1-8 to play notes: 1-[C] 2-[D] 3-[E] 4-[F] 5-[G] 6-[A] 7-[B] 8-[C]',
    'Hold Shift to play chords: 1-[C] 2-[D] 3-[E] 4-[F] 5-[G] 6-[A] 7-[B] 8-[C]']);
  hover(bagButton(2));
  assert.equal(tipLines(screen).at(-1), 'Hold Shift to play additional notes: 9-[C] 10-[D] 11-[E] 12-[F] 13-[G] 14-[A] 15-[B] 16-[C]');
  phone = true;
  screen._hold({ source: 'bag', index: 2 });
  assert.equal(tipLines(screen).at(-1), 'Played with a keyboard for now.');
});

test("a stack's own description gives its tooltip its name in its colour, its text and stats", (t) => {
  let version = 0;
  let name = 'Ferranite';
  const inventory = new Inventory({ starter: false });
  inventory.add('alloyIngot', 1, { alloy: 'a1' });
  inventory.add('rawTin', 2);
  const { screen, press, bagButton, hover } = mount(t, { inventory, describeVersion: () => version,
    describe: (stack) => (stack.id === 'alloyIngot' ? { name, colour: '#B0B3B5', description: `An ingot of ${name}.`,
      stats: { 'Attack Damage': '3.15', Tier: '1' } } : null) });
  press('KeyI');
  hover(bagButton(0));
  const tip = screen.tooltip;
  assert.equal(tip.nameNode.textContent, 'Ferranite');
  assert.equal(tip.nameNode.style.color, '#B0B3B5');
  assert.deepEqual(tipLines(screen), ['material', 'An ingot of Ferranite.', 'material Alloy', 'attack damage 3.15', 'tier 1',
    'weight 0.75 kg']);
  assert.equal(bagButton(0).getAttribute('aria-label'), 'Slot 1: Ferranite, count 1');
  // A rename shows once the describer's version moves.
  name = 'Moon Iron';
  screen.update();
  assert.equal(tip.nameNode.textContent, 'Ferranite');
  version++;
  screen.update();
  assert.equal(tip.nameNode.textContent, 'Moon Iron');
  // Anything else keeps its item's own text and the default ink.
  hover(bagButton(1));
  assert.equal(tip.nameNode.textContent, 'Raw Tin');
  assert.equal(tip.nameNode.style.color, '');
});

test('a smithed sword shows its metal once, its quality, socket and damage, and its own durability', async (t) => {
  const { describeWeapon, makeWeapon } = await import('../src/crafting/smithing.js');
  const blackiron = { id: 'a1', name: 'Blackiron', colour: '5E6568', type: 'metal',
    stats: { attackDamage: 4.2, durability: 430.4 }, hits: { hit: 1 } };
  const book = { get: (id) => (id === 'a1' ? blackiron : null) };
  const inventory = new Inventory({ starter: false });
  for (const units of [['a1', 'a1', 'a1', 'ironIngot'], ['steelIngot', 'steelIngot', 'steelIngot', 'ironIngot']]) {
    const { id, count, ...extras } = makeWeapon('shortSword', units, 92, book.get);
    inventory.add(id, count, extras);
  }
  inventory.add('outlawHood');
  const { screen, press, bagButton, hover } = mount(t, { inventory, describe: (stack) => describeWeapon(stack, book) });
  press('KeyI');
  hover(bagButton(0));
  const tip = screen.tooltip;
  assert.equal(tip.nameNode.textContent, 'Blackiron Short Sword');
  assert.equal(tip.nameNode.style.color, '#5E6568');
  const lines = tipLines(screen);
  assert.equal(lines[0], 'weapon \u00b7 one hand', "the grip from the sword's own stats");
  assert.deepEqual(lines.filter((line) => /^material/i.test(line)), ['material Blackiron']);
  assert.ok(lines.includes('quality Gleaming'));
  assert.ok(lines.includes('socket Radiant (empty)'));
  assert.ok(Number(lines.find((line) => line.startsWith('damage ')).slice(7)) > 24);
  assert.deepEqual(lines.filter((line) => line.startsWith('durability')), ['durability 448/448'],
    '(3 × 430.4 + 500) ÷ 4, rounded, once');
  // Steel over an iron base reads steel, on the card and in the tooltip.
  assert.equal(screen.bagNodes[1].count.textContent, 'steel');
  hover(bagButton(1));
  assert.deepEqual(tipLines(screen).filter((line) => /^material/i.test(line)), ['material Steel']);
  assert.equal(screen.bagNodes[2].count.textContent, 'wool', 'plain gear reads its own material');
});

test('a redraw keeps the tooltip where the pointer moved it on the same card', (t) => {
  const { screen, inventory, press, bagButton, indexOf, hover } = mount(t);
  press('KeyI');
  const arrows = indexOf('arrow');
  hover(bagButton(arrows));
  hover(bagButton(arrows), 300, 200);
  inventory.slots[arrows].count = 12;
  screen.update();
  assert.equal(tipLines(screen).at(-1), 'weight 0.03 kg each · 0.36 kg');
  assert.equal(screen.tooltip.node.style.transform, 'translate(314px, 214px)', 'not back where it first was');
});

test('using up the focused stack with Enter shows the tooltip of the card that takes focus', (t) => {
  const { document, screen, inventory, press, bagButton } = mount(t);
  press('KeyI');
  press('ArrowRight');
  press('ArrowLeft');
  assert.equal(screen.tooltip.nameNode.textContent, 'Healing Draught');
  inventory.slots[0].count = 1;
  press('Enter');
  assert.equal(inventory.slots[0], null);
  const focused = document.activeElement;
  assert.notEqual(focused, bagButton(0));
  assert.equal(screen.tooltip.shown, true);
  assert.equal(screen.tooltip.nameNode.textContent, screen._selectedItem().item.name);
});

test('a resize re-places a pinned panel by its card', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { window, screen, bagButton, indexOf } = mount(t, { phone: () => true });
  screen.setOpen(true);
  window.dispatchEvent(new Event('resize'));
  assert.equal(screen.tooltip.shown, false);
  const tonic = bagButton(indexOf('staminaTonic'));
  tonic.rect = { left: 40, top: 300, width: 56, height: 112 };
  screen.screen.dispatch('pointerdown', { pointerType: 'touch', target: tonic, pointerId: 1, button: 0, timeStamp: 0 });
  t.mock.timers.tick(450);
  assert.equal(screen.tooltip.node.style.transform, 'translate(40px, 416px)');
  // Turned to landscape: the card is higher and the screen shorter.
  tonic.rect = { left: 600, top: 100, width: 56, height: 112 };
  override(t, 'innerWidth', 800);
  override(t, 'innerHeight', 400);
  window.dispatchEvent(new Event('resize'));
  assert.equal(screen.tooltip.pinned, true);
  assert.equal(screen.tooltip.node.style.transform, 'translate(600px, 216px)');
  assert.deepEqual(screen.tooltip.actions.children.map((button) => button.textContent), ['use'], 'its button kept');
});
