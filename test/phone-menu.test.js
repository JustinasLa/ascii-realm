import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PhoneMenu } from '../src/ui/phone-menu.js';

class Node extends EventTarget {
  constructor(name, { shown = true } = {}) {
    super();
    this.name = name;
    this.attributes = new Map();
    this.shown = shown;
    this.disabled = false;
    this.inert = false;
    this.doc = null;
  }
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  removeAttribute(key) { this.attributes.delete(key); }
  checkVisibility() { return this.shown; }
  focus() { this.doc.activeElement = this; }
  click() { this.dispatchEvent(new Event('click')); }
}

function setup({ phone = { phone: true }, legacyVisibility = false } = {}) {
  const classes = new Set();
  const doc = {
    activeElement: null,
    body: { classList: { toggle: (name, on) => { if (on) classes.add(name); else classes.delete(name); } } },
  };
  const node = (name, options) => Object.assign(new Node(name, options), { doc });
  const button = node('menu');
  const closeButton = node('close');
  const inventoryButton = node('inventory');
  const builderSummary = node('builder', { shown: false });
  const audioSummary = node('audio');
  const disabledSkip = Object.assign(node('skip'), { disabled: true });
  const lastSlider = node('slider');
  const contents = [closeButton, builderSummary, inventoryButton, audioSummary, disabledSkip, lastSlider];
  if (legacyVisibility) {
    for (const item of contents) {
      item.checkVisibility = undefined;
      item.offsetParent = item.shown ? {} : null;
    }
  }
  const dock = Object.assign(node('dock'), { querySelectorAll: () => contents });
  dock.setAttribute('role', 'navigation');
  dock.setAttribute('aria-label', 'Game panels');
  const canvas = node('canvas');
  const hud = node('hud');
  const touch = node('touch');
  const win = new EventTarget();
  const calls = [];
  const menu = new PhoneMenu({
    button, dock, closeButton, inventoryButton, outside: [touch, hud, canvas, null], canvas, phone, win, doc,
    onToggle: (open) => calls.push(['toggle', open, menu.open]),
    onInventory: () => calls.push(['inventory', menu.open]),
  });
  const key = (code, extra = {}) => {
    const event = Object.assign(new Event('keydown', { cancelable: true }), { code, ...extra });
    let stopped = false;
    event.stopImmediatePropagation = () => { stopped = true; };
    win.dispatchEvent(event);
    return { event, stopped: () => stopped };
  };
  return { menu, classes, doc, button, closeButton, inventoryButton, audioSummary, lastSlider,
    dock, canvas, hud, touch, win, calls, key };
}

test('opening shows the sheet as a modal dialog and focuses Close', () => {
  const { menu, classes, doc, button, closeButton, dock, calls, touch, hud, canvas } = setup();
  button.click();
  assert.equal(menu.open, true);
  assert.ok(classes.has('phone-menu-open'));
  assert.equal(dock.getAttribute('role'), 'dialog');
  assert.equal(dock.getAttribute('aria-modal'), 'true');
  assert.equal(dock.getAttribute('aria-label'), 'Menu');
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  assert.equal(doc.activeElement, closeButton, 'never the hidden builder summary');
  assert.deepEqual([touch.inert, hud.inert, canvas.inert], [true, true, true]);
  assert.deepEqual(calls, [['toggle', true, true]]);
  menu.setOpen(true);
  assert.equal(calls.length, 1, 'opening twice does nothing');
});

test('Close, the menu button and Escape each return to a clean screen', () => {
  for (const close of ['close', 'button', 'escape']) {
    const { menu, classes, doc, button, closeButton, dock, canvas, touch, key } = setup();
    menu.setOpen(true);
    if (close === 'close') closeButton.click();
    else if (close === 'button') button.click();
    else assert.equal(key('Escape').event.defaultPrevented, true);
    assert.equal(menu.open, false, close);
    assert.equal(classes.has('phone-menu-open'), false);
    assert.equal(dock.getAttribute('role'), 'navigation');
    assert.equal(dock.getAttribute('aria-modal'), null);
    assert.equal(dock.getAttribute('aria-label'), 'Game panels');
    assert.equal(button.getAttribute('aria-expanded'), 'false');
    assert.equal(doc.activeElement, canvas);
    assert.equal(touch.inert, false);
  }
});

test('the Inventory row closes the menu before opening the inventory', () => {
  const { menu, inventoryButton, calls } = setup();
  menu.setOpen(true);
  inventoryButton.click();
  assert.deepEqual(calls, [['toggle', true, true], ['toggle', false, false], ['inventory', false]]);
});

test('I with the menu open goes through the Inventory row', () => {
  const { menu, calls, key } = setup();
  assert.equal(key('KeyI').stopped(), false, 'a closed menu leaves I to the inventory');
  menu.setOpen(true);
  const press = key('KeyI');
  assert.equal(press.event.defaultPrevented, true);
  assert.equal(press.stopped(), true);
  assert.equal(menu.open, false);
  assert.deepEqual(calls.at(-1), ['inventory', false]);
  menu.setOpen(true);
  key('KeyI', { repeat: true });
  assert.equal(menu.open, true, 'a held key does not repeat');
  for (const modifier of ['altKey', 'ctrlKey', 'metaKey']) {
    assert.equal(key('KeyI', { [modifier]: true }).event.defaultPrevented, false, modifier);
  }
  const typing = { code: 'KeyI', target: { closest: () => ({}) }, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() {} };
  menu.keydown(typing);
  assert.equal(typing.defaultPrevented, false, 'typing an I into the lobby form');
  assert.equal(menu.open, true);
});

test('Tab and Shift+Tab wrap between the first and last visible controls', () => {
  const { menu, doc, closeButton, audioSummary, lastSlider, key } = setup();
  menu.setOpen(true);
  assert.equal(doc.activeElement, closeButton);
  const back = key('Tab', { shiftKey: true });
  assert.equal(back.event.defaultPrevented, true);
  assert.equal(doc.activeElement, lastSlider, 'skips the disabled control');
  const forward = key('Tab');
  assert.equal(forward.event.defaultPrevented, true);
  assert.equal(doc.activeElement, closeButton);
  audioSummary.focus();
  assert.equal(key('Tab').event.defaultPrevented, false, 'the browser moves focus inside the sheet');
  assert.equal(key('Tab', { shiftKey: true }).event.defaultPrevented, false);
  doc.activeElement = null;
  key('Tab');
  assert.equal(doc.activeElement, closeButton, 'focus that escaped comes back');
  doc.activeElement = null;
  key('Tab', { shiftKey: true });
  assert.equal(doc.activeElement, lastSlider);
});

test('visibility falls back to offsetParent in older browsers', () => {
  const { menu, doc, lastSlider, key } = setup({ legacyVisibility: true });
  menu.setOpen(true);
  key('Tab', { shiftKey: true });
  assert.equal(doc.activeElement, lastSlider);
});

test('keys pass through while the menu is closed or already handled', () => {
  const { menu, key } = setup();
  assert.equal(key('Escape').event.defaultPrevented, false);
  menu.setOpen(true);
  const event = Object.assign(new Event('keydown', { cancelable: true }), { code: 'Escape' });
  event.preventDefault();
  menu.keydown(event);
  assert.equal(menu.open, true);
  assert.equal(key('KeyW').event.defaultPrevented, false);
});

test('the menu closes when the page hides or the device stops being a phone', () => {
  const device = { phone: true };
  const { menu, win } = setup({ phone: device });
  menu.setOpen(true);
  win.dispatchEvent(new Event('pagehide'));
  assert.equal(menu.open, false);
  device.phone = false;
  menu.setOpen(true);
  assert.equal(menu.open, false, 'only phones open the sheet');
});

test('the dock gets default labels back when it had none', () => {
  const { menu, dock } = setup();
  dock.attributes.clear();
  const fresh = new PhoneMenu({ ...menu, win: new EventTarget() });
  fresh.setOpen(true);
  fresh.setOpen(false);
  assert.equal(dock.getAttribute('role'), 'navigation');
  assert.equal(dock.getAttribute('aria-label'), 'Game panels');
});
