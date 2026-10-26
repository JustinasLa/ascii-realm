import assert from 'node:assert/strict';
import test from 'node:test';
import { InstrumentKeys, noteSlot } from '../src/core/instrument-keys.js';

// A window and a child target: the window's capture listener runs before
// the child's own listener, as in the page.
function setup({ instrument = 'lute', canPlay = true, isControl } = {}) {
  const window = new EventTarget();
  const notes = [];
  const state = { instrument, canPlay };
  const keys = new InstrumentKeys(window, {
    instrument: () => state.instrument,
    canPlay: () => state.canPlay,
    isControl,
    onNote: (slot, shifted) => notes.push([slot, shifted]),
  });
  const press = (code, extra = {}) => {
    const event = Object.assign(new Event('keydown', { cancelable: true }), { code, ...extra });
    window.dispatchEvent(event);
    return event;
  };
  return { window, keys, notes, state, press };
}

test('noteSlot maps the digit row and numpad 1-8, nothing else', () => {
  for (let n = 1; n <= 8; n++) {
    assert.equal(noteSlot({ code: `Digit${n}` }), n);
    assert.equal(noteSlot({ code: `Numpad${n}` }), n);
  }
  for (const code of ['Digit9', 'Digit0', 'Numpad9', 'Numpad0', 'KeyQ', 'Digit10', '', undefined]) {
    assert.equal(noteSlot({ code }), null, String(code));
  }
  assert.equal(noteSlot(null), null);
});

test('keys 1-8 play at once and are claimed; Shift plays the second layer', () => {
  const { notes, press } = setup();
  for (let n = 1; n <= 8; n++) {
    const event = press(`Digit${n}`);
    assert.equal(event.defaultPrevented, true);
    assert.equal(event.cancelBubble, true, 'propagation stops');
  }
  press('Numpad3', { shiftKey: true });
  press('Digit8', { shiftKey: true });
  assert.deepEqual(notes, [[1, false], [2, false], [3, false], [4, false], [5, false], [6, false], [7, false], [8, false],
    [3, true], [8, true]]);
});

test('a claimed key never reaches listeners further along', () => {
  const window = new EventTarget();
  const body = new EventTarget();
  let reached = 0;
  const keys = new InstrumentKeys(window, { instrument: () => 'lute', canPlay: () => true, onNote() {} });
  body.addEventListener('keydown', () => reached++);
  // A child's own listener only runs if the window's capture listener let it.
  const event = Object.assign(new Event('keydown', { cancelable: true }), { code: 'Digit1' });
  assert.equal(keys.handle(event), true);
  if (!event.cancelBubble) body.dispatchEvent(event);
  assert.equal(reached, 0);
});

test('9, 0 and other keys, and every key without an instrument, are left alone', () => {
  const { notes, press, state } = setup();
  for (const code of ['Digit9', 'Digit0', 'Numpad9', 'KeyQ', 'ShiftLeft']) {
    const event = press(code);
    assert.equal(event.defaultPrevented, false, code);
    assert.equal(event.cancelBubble, false, code);
  }
  state.instrument = null;
  const event = press('Digit1');
  assert.equal(event.defaultPrevented, false);
  assert.deepEqual(notes, []);
});

test('held keys never replay, and keys that may not play are claimed but silent', () => {
  const { notes, press, state } = setup();
  assert.equal(press('Digit2', { repeat: true }).defaultPrevented, true);
  state.canPlay = false;
  assert.equal(press('Digit3').defaultPrevented, true, 'claimed so it cannot equip quick-slot gear');
  assert.deepEqual(notes, []);
});

test('browser shortcuts, typing and controls keep their keys', () => {
  const field = { tagName: 'INPUT' };
  const { notes, press } = setup({ isControl: target => target === field });
  for (const extra of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }]) {
    assert.equal(press('Digit1', extra).defaultPrevented, false, JSON.stringify(extra));
  }
  // The control is found as the target or anywhere on the composed path.
  const window = new EventTarget();
  const keys = new InstrumentKeys(window, { instrument: () => 'lute', canPlay: () => true,
    isControl: target => target === field, onNote: () => notes.push('played') });
  const onPath = Object.assign(new Event('keydown', { cancelable: true }), { code: 'Digit1', composedPath: () => [{}, field] });
  assert.equal(keys.handle(onPath), false);
  const targeted = Object.assign(new Event('keydown', { cancelable: true }), { code: 'Digit1' });
  Object.defineProperty(targeted, 'target', { value: field });
  assert.equal(keys.handle(targeted), false);
  const prevented = Object.assign(new Event('keydown', { cancelable: true }), { code: 'Digit1' });
  prevented.preventDefault();
  assert.equal(keys.handle(prevented), false);
  assert.deepEqual(notes, []);
});

test('the listener is a capture listener and dispose removes it', () => {
  const calls = [];
  const target = {
    addEventListener: (type, listener, options) => calls.push(['add', type, listener, options]),
    removeEventListener: (type, listener, options) => calls.push(['remove', type, listener, options]),
  };
  const keys = new InstrumentKeys(target, { instrument: () => null, canPlay: () => true, onNote() {} });
  keys.dispose();
  assert.deepEqual(calls.map(([kind, type, , options]) => [kind, type, options]),
    [['add', 'keydown', { capture: true }], ['remove', 'keydown', { capture: true }]]);
  assert.equal(calls[0][2], calls[1][2]);
  // The default control check treats nothing as a control.
  const window = new EventTarget();
  const played = [];
  new InstrumentKeys(window, { instrument: () => 'flute', canPlay: () => true, onNote: slot => played.push(slot) });
  window.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { code: 'Digit4', composedPath: () => [{}] }));
  assert.deepEqual(played, [4]);
});
