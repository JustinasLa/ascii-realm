import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { Player } from '../src/entities/player.js';
import { Inventory } from '../src/inventory/inventory.js';
import { Hud } from '../src/ui/hud.js';
import { byClass, installDocument } from './helpers/dom.js';

// The window the input module listens on. Node runs this file in its own
// process, so the stand-in stays out of other tests.
const listeners = new Map();
const fakeWindow = {
  addEventListener(type, listener) { listeners.set(type, [...(listeners.get(type) ?? []), listener]); },
};
const toWindow = (type, properties) => {
  const event = { type, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...properties };
  for (const listener of listeners.get(type) ?? []) listener(event);
  return event;
};
Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow });
const { clearInput, isDown, moveAxis, setGameplayBlocked } = await import('../src/core/input.js');

const view = { x0: 100, y0: 200, offX: 0, offY: 0, cols: 80, rows: 20, cellW: 20, cellH: 40 };

// What a browser does with focus: a focus change sends focusout from the old
// element and focusin to the new one, and both bubble up to the window.
function focusModel(canvas) {
  const model = { active: canvas, log: [] };
  model.focus = (element) => {
    if (model.active === element) return;
    if (model.active) {
      model.log.push(`focusout:${model.active.tagName}`);
      toWindow('focusout', { target: model.active });
    }
    model.active = element;
    model.log.push(`focusin:${element.tagName}`);
    toWindow('focusin', { target: element });
  };
  canvas.focus = () => model.focus(canvas);
  return model;
}

// A real mouse press on a button: pointerdown, then mousedown, whose default
// action focuses the button, then mouseup and click.
function press(button, model, { shiftKey = false } = {}) {
  const fire = (type) => {
    const event = { type, target: button, currentTarget: button, shiftKey, button: 0, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
    for (const listener of button.listeners.get(type) ?? []) listener(event);
    return event;
  };
  fire('pointerdown');
  if (!fire('mousedown').defaultPrevented) model.focus(button);
  fire('pointerup');
  fire('mouseup');
  fire('click');
}

function mount(t) {
  const document = installDocument(t);
  const canvas = document.getElementById('screen');
  const model = focusModel(canvas);
  const selected = [];
  const inventory = new Inventory();
  // As the game does: play, then hand the keys back to the canvas.
  const hud = new Hud({ player: new Player(104, 206), inventory, name: 'Kael',
    onNote: (index, event) => { selected.push([index, Boolean(event?.shiftKey)]); canvas.focus(); } });
  t.after(() => hud.destroy());
  hud.update(0, view);
  return { hud, model, selected, slots: byClass(document.body, 'hud-slot') };
}

beforeEach(() => {
  setGameplayBlocked(false);
  clearInput();
});

// Shift held to run, and D to walk east.
function holdShiftAndRun() {
  toWindow('keydown', { code: 'ShiftLeft', target: {} });
  toWindow('keydown', { code: 'KeyD', target: {} });
  assert.equal(isDown('ShiftLeft'), true);
}

test('a Shift-click on a note slot keeps focus, Shift and running', (t) => {
  const { hud, model, selected, slots } = mount(t);
  hud.setInstrument({ id: 'lute', shifted: true });
  hud.update(0, view);
  holdShiftAndRun();
  press(slots[1], model, { shiftKey: true });
  assert.deepEqual(selected, [[1, true]]);
  assert.deepEqual(model.log, []);
  assert.equal(model.active.tagName, 'CANVAS');
  assert.equal(isDown('ShiftLeft', 'ShiftRight'), true);
  assert.deepEqual(moveAxis(), { x: 1, y: 0 });
});
