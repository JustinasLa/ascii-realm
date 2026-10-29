import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BagGestures, HOLD_MS, TOUCH_SLOP } from '../src/ui/bag-gestures.js';

// A surface that records its listeners, and events that record what was done to them.
function surface() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, listener, options) { listeners.set(type, [...(listeners.get(type) ?? []), { listener, options }]); },
    removeEventListener(type, listener) { listeners.set(type, (listeners.get(type) ?? []).filter((entry) => entry.listener !== listener)); },
    fire(type, fields = {}) {
      const event = { type, defaultPrevented: false, stopped: false, preventDefault() { this.defaultPrevented = true; },
        stopImmediatePropagation() { this.stopped = true; }, ...fields };
      for (const { listener } of listeners.get(type) ?? []) listener(event);
      return event;
    },
  };
}

function setup(t, { source = true } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pad = surface();
  const holds = [];
  const node = { getBoundingClientRect: () => ({ left: 1, top: 2, right: 3, bottom: 4 }) };
  const gestures = new BagGestures({ surface: pad, sourceOf: (target) => (source && target === 'card' ? { selection: 'bow', node } : null),
    onHold: (selection, rect) => holds.push([selection, rect]) });
  const down = (fields = {}) => pad.fire('pointerdown', { pointerType: 'touch', pointerId: 1, button: 0, isPrimary: true,
    clientX: 50, clientY: 50, timeStamp: 0, target: 'card', ...fields });
  return { pad, holds, gestures, down };
}

test('a touch held still for the hold time pins, stops scrolling and swallows its click', (t) => {
  const { pad, holds, gestures, down } = setup(t);
  assert.equal(HOLD_MS, 450);
  assert.equal(TOUCH_SLOP, 10);
  down();
  t.mock.timers.tick(HOLD_MS - 1);
  assert.equal(holds.length, 0);
  assert.equal(pad.fire('touchmove').defaultPrevented, false, 'a press may still scroll');
  pad.fire('pointermove', { pointerId: 1, clientX: 56, clientY: 58 });
  t.mock.timers.tick(1);
  assert.deepEqual(holds, [['bow', { left: 1, top: 2, right: 3, bottom: 4 }]]);
  assert.equal(gestures.active, true);
  assert.equal(pad.fire('touchmove').defaultPrevented, true, 'a hold never scrolls');
  pad.fire('pointerup', { timeStamp: 900 });
  assert.equal(gestures.active, false);
  assert.equal(holds.length, 1, 'the lift adds nothing');
  const click = pad.fire('click');
  assert.ok(click.defaultPrevented && click.stopped, 'the lift sends a click, swallowed');
  assert.equal(pad.fire('click').stopped, false, 'only that one');
  assert.equal(pad.listeners.get('click')[0].options, true, 'in the capture phase');
  assert.deepEqual(pad.listeners.get('touchmove')[0].options, { passive: false });
});

test('a quick tap, a swipe or a cancelled touch is no hold', (t) => {
  const { pad, holds, down } = setup(t);
  down();
  t.mock.timers.tick(200);
  pad.fire('pointerup', { timeStamp: 200 });
  t.mock.timers.tick(HOLD_MS);
  assert.equal(pad.fire('click').stopped, false, 'a tap clicks');
  down();
  pad.fire('pointermove', { pointerId: 2, clientX: 300, clientY: 300 });
  pad.fire('pointermove', { pointerId: 1, clientX: 50, clientY: 50 + TOUCH_SLOP + 1 });
  t.mock.timers.tick(HOLD_MS);
  down();
  pad.fire('pointercancel');
  t.mock.timers.tick(HOLD_MS);
  pad.fire('pointermove', { pointerId: 1, clientX: 0, clientY: 0 });
  assert.deepEqual(holds, []);
});

test('a lift that runs before the late timer still holds', (t) => {
  const { pad, holds } = setup(t);
  pad.fire('pointerdown', { pointerType: 'pen', pointerId: 4, clientX: 0, clientY: 0, timeStamp: 1000, target: 'card' });
  pad.fire('pointerup', { timeStamp: 1000 + HOLD_MS });
  assert.equal(holds.length, 1);
  assert.equal(pad.fire('click').stopped, true);
  t.mock.timers.tick(HOLD_MS);
  assert.equal(holds.length, 1, 'the timer does not fire again');
});

test('mice, other buttons and fingers, empty places and an unclaimed swallow are left alone', (t) => {
  const { pad, holds, gestures, down } = setup(t);
  down({ pointerType: 'mouse' });
  down({ button: 2 });
  down({ isPrimary: false });
  down({ target: 'gap' });
  t.mock.timers.tick(HOLD_MS);
  assert.deepEqual(holds, []);
  // A hold whose click never came does not eat the next tap.
  down();
  t.mock.timers.tick(HOLD_MS);
  pad.fire('pointercancel');
  down();
  pad.fire('pointerup', { timeStamp: 10 });
  assert.equal(pad.fire('click').stopped, false);
  gestures.cancel();
  gestures.destroy();
  assert.ok([...pad.listeners.values()].every((entries) => entries.length === 0), 'every listener removed');
});

test('the click can be swallowed on a wider surface than the presses', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pad = surface();
  const root = surface();
  const gestures = new BagGestures({ surface: pad, swallowOn: root, onHold() {},
    sourceOf: () => ({ selection: 1, node: { getBoundingClientRect: () => ({}) } }) });
  assert.equal(pad.listeners.has('click'), false);
  pad.fire('pointerdown', { pointerType: 'touch', pointerId: 1, timeStamp: 0 });
  t.mock.timers.tick(HOLD_MS);
  pad.fire('pointerup', { timeStamp: HOLD_MS });
  assert.equal(root.fire('click').stopped, true);
  gestures.destroy();
  assert.equal(root.listeners.get('click').length, 0);
});
