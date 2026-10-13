import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Inventory } from '../src/inventory/inventory.js';

class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, callback, options) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push({ callback, capture: options === true || options?.capture === true });
    this.listeners.set(type, listeners);
  }
  removeEventListener(type, callback, options) {
    const capture = options === true || options?.capture === true;
    this.listeners.set(type, (this.listeners.get(type) ?? [])
      .filter((entry) => entry.callback !== callback || entry.capture !== capture));
  }
  dispatch(event) {
    event.target ??= this;
    event.preventDefault ??= () => { event.defaultPrevented = true; };
    event.stopPropagation ??= () => {};
    event.stopImmediatePropagation ??= () => { event.stopped = true; };
    const listeners = [...(this.listeners.get(event.type) ?? [])].sort((a, b) => Number(b.capture) - Number(a.capture));
    for (const { callback } of listeners) {
      callback(event);
      if (event.stopped) break;
    }
    return event;
  }
}

class Node extends Events {
  constructor(tag, ownerDocument) {
    super();
    this.tagName = tag.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.attributes = new Map();
    this.hidden = false;
    this.textWrites = 0;
  }
  set textContent(value) { this._text = value; this.textWrites++; }
  get textContent() { return this._text ?? ''; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  append(...nodes) {
    for (const node of nodes) { node.parentNode = this; this.children.push(node); }
  }
  contains(node) {
    for (let current = node; current; current = current.parentNode) if (current === this) return true;
    return false;
  }
  closest(selector) {
    const selectors = selector.split(',').map((entry) => entry.trim());
    for (let node = this; node; node = node.parentNode) {
      if (selectors.includes(node.tagName.toLowerCase())
        || selectors.includes('[data-game-ui]') && node.hasAttribute('data-game-ui')) return node;
    }
    return null;
  }
  focus() {
    this.ownerDocument.activeElement = this;
    this.ownerDocument.dispatch({ type: 'focusin', target: this });
  }
  blur() {
    if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body;
  }
  click() { if (!this.disabled) this.dispatch({ type: 'click', target: this }); }
  remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((node) => node !== this);
    this.parentNode = null;
  }
}

class Document extends Events {
  constructor() {
    super();
    this.body = new Node('body', this);
    this.activeElement = this.body;
    this.hidden = false;
  }
  createElement(tag) { return new Node(tag, this); }
  getElementById(id) {
    const find = (node) => node.id === id ? node : node.children.map(find).find(Boolean);
    return find(this.body) ?? null;
  }
}

const document = new Document();
const window = new Events();
window.document = document;
window.innerWidth = 1024;
globalThis.window = window;
globalThis.document = document;
const { CollectionUI } = await import('../src/ui/collection.js');
const { clearInput, isDown, isGameplayBlocked, wasTapped } = await import('../src/core/input.js');

function setup(options = {}) {
  document.body.children = [];
  document.activeElement = document.body;
  window.innerWidth = 1024;
  clearInput();
  const canvas = document.createElement('canvas');
  canvas.id = 'screen';
  document.body.append(canvas);
  const inventory = new Inventory({ starter: false });
  inventory.slots[5] = { id: 'ironOre', count: 2 };
  const ui = new CollectionUI(inventory, options);
  return { ui, inventory, canvas };
}

function key(code, options = {}) {
  return window.dispatch({ type: 'keydown', code, target: document.activeElement, repeat: false, ...options });
}

function release(code) {
  return window.dispatch({ type: 'keyup', code, target: document.activeElement });
}

test('collection HUD selects the first occupied slot and caches unchanged inventory renders', () => {
  const { ui, inventory } = setup();
  try {
    assert.equal(ui.selectedSlot, 5);
    assert.equal(ui.slotButtons.length, 24);
    assert.equal(ui.summary.textContent, '1/24 stacks · 1.5/40 kg');
    assert.equal(ui.slotButtons[5].getAttribute('aria-pressed'), 'true');
    assert.match(ui.slotButtons[5].getAttribute('aria-label'), /Iron Ore, 2/);
    ui.update({ prompt: '[E] Pick up ore', time: 0 });
    assert.equal(ui.prompt.hidden, false);
    const writes = ui.slotButtons.map((button) => button.textWrites);
    ui.update({ prompt: '[E] Pick up ore', time: 1 });
    assert.deepEqual(ui.slotButtons.map((button) => button.textWrites), writes);
    inventory.add('ironOre');
    ui.update({ time: 2 });
    assert.match(ui.selection.textContent, /Iron Ore x3/);
    assert.equal(ui.summary.textContent, '1/24 stacks · 2.25/40 kg');
  } finally { ui.dispose(); }
});

test('bag keyboard input clears movement, consumes Q, and restores gameplay focus without ghost keys', () => {
  const drops = [];
  const { ui, canvas } = setup({ onDrop: (index) => drops.push(index) });
  try {
    key('KeyW');
    assert.equal(isDown('KeyW'), true);
    assert.equal(key('KeyI').defaultPrevented, true);
    assert.equal(ui.open, true);
    assert.equal(isGameplayBlocked(), true);
    assert.equal(isDown('KeyW'), false);
    assert.equal(document.activeElement, ui.slotButtons[5]);
    key('KeyI', { repeat: true });
    assert.equal(ui.open, true);
    key('KeyQ');
    key('KeyQ', { repeat: true });
    assert.deepEqual(drops, [5]);
    key('KeyE');
    key('KeyJ');
    assert.equal(wasTapped('KeyE', 'KeyJ', 'KeyQ'), false);
    key('Escape');
    assert.equal(ui.open, false);
    assert.equal(document.activeElement, canvas);
    assert.equal(isGameplayBlocked(), false);
    release('KeyI');
    key('KeyW', { repeat: true });
    assert.equal(isDown('KeyW'), false);
    release('KeyW');
    key('KeyW');
    assert.equal(isDown('KeyW'), true);
    key('KeyQ');
    assert.equal(wasTapped('KeyQ'), true, 'closed bag leaves world drop handling to the game');
  } finally { ui.dispose(); }
});

test('selection works through number keys, arrows at both grid sizes, and click', () => {
  const { ui } = setup();
  try {
    key('Digit9');
    assert.equal(ui.selectedSlot, 8);
    assert.equal(wasTapped('Digit9'), false);
    key('Tab');
    key('ArrowDown');
    assert.equal(ui.selectedSlot, 14);
    assert.equal(document.activeElement, ui.slotButtons[14]);
    window.innerWidth = 400;
    key('ArrowUp');
    assert.equal(ui.selectedSlot, 10);
    key('Home');
    key('ArrowLeft');
    assert.equal(ui.selectedSlot, 0);
    key('End');
    key('ArrowRight');
    assert.equal(ui.selectedSlot, 23);
    ui.slotButtons[5].click();
    assert.equal(ui.selectedSlot, 5);
    assert.equal(document.activeElement, ui.slotButtons[5]);
    key('Tab');
    assert.equal(ui.open, false);
  } finally { ui.dispose(); }
});

test('mute is invoked once and native dialog buttons remain keyboard accessible', () => {
  let muted = false;
  let toggles = 0;
  const drops = [];
  const { ui, canvas } = setup({
    onMute: () => { muted = !muted; toggles++; return muted; },
    isMuted: () => muted,
    onDrop: (index) => drops.push(index),
  });
  try {
    key('KeyM');
    key('KeyM', { repeat: true });
    assert.equal(toggles, 1);
    assert.equal(wasTapped('KeyM'), false);
    assert.equal(ui.muteButton.getAttribute('aria-pressed'), 'true');
    ui.muteButton.focus();
    ui.muteButton.click();
    assert.equal(toggles, 2);
    assert.equal(document.activeElement, canvas);
    ui.bagButton.click();
    ui.dropButton.focus();
    key('Enter');
    assert.deepEqual(drops, [5]);
    ui.closeButton.focus();
    key('Space');
    assert.equal(ui.open, false);
    assert.equal(document.activeElement, canvas);
  } finally { ui.dispose(); }
});

test('toasts expire on the supplied clock and disposal removes keyboard handlers', () => {
  const { ui } = setup();
  ui.toast('Collected ore');
  ui.update({ time: 0 });
  assert.equal(ui.toastNode.hidden, false);
  ui.update({ time: 2.99 });
  assert.equal(ui.toastNode.hidden, false);
  ui.update({ time: 3 });
  assert.equal(ui.toastNode.hidden, true);
  key('KeyI');
  ui.dispose();
  assert.equal(document.getElementById('collection-ui'), null);
  assert.equal(isGameplayBlocked(), false);
  key('KeyI');
  assert.equal(wasTapped('KeyI'), true);
  ui.dispose();
});
