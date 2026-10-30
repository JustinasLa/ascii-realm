import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BagGestures, HOLD_MS, MOUSE_SLOP, TOUCH_SLOP } from '../src/ui/bag-gestures.js';

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
  pad.setPointerCapture = (id) => drags.push(['capture', id]);
  const holds = [];
  const drags = [];
  const node = { getBoundingClientRect: () => ({ left: 1, top: 2, right: 3, bottom: 4 }) };
  const gestures = new BagGestures({ surface: pad, sourceOf: (target) => (source && target === 'card' ? { selection: 'bow', node } : null),
    onHold: (selection, rect) => holds.push([selection, rect]),
    onDragStart: (selection, point) => drags.push(['start', selection, point]),
    onDragMove: (point, target) => drags.push(['move', point, target]),
    onDrop: (selection, target) => drags.push(['drop', selection, target]),
    onDragEnd: () => drags.push(['end']),
    hitTest: (x, y) => `${x},${y}` });
  const down = (fields = {}) => pad.fire('pointerdown', { pointerType: 'touch', pointerId: 1, button: 0, isPrimary: true,
    clientX: 50, clientY: 50, timeStamp: 0, target: 'card', ...fields });
  return { pad, holds, drags, gestures, down };
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

test('mice never hold, and other buttons and fingers, empty places and an unclaimed swallow are left alone', (t) => {
  const { pad, holds, drags, gestures, down } = setup(t);
  down({ pointerType: 'mouse' });
  t.mock.timers.tick(HOLD_MS);
  pad.fire('pointerup', { pointerId: 1, timeStamp: 2000 });
  assert.equal(pad.fire('click').stopped, false, 'a long mouse press is a click');
  down({ button: 2 });
  down({ isPrimary: false });
  down({ target: 'gap' });
  t.mock.timers.tick(HOLD_MS);
  assert.deepEqual(holds, []);
  assert.deepEqual(drags, []);
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

test('a hold, then a move past the slop, drags to where the finger lifts, and swallows its click', (t) => {
  const { pad, holds, drags, gestures, down } = setup(t);
  down();
  t.mock.timers.tick(HOLD_MS);
  pad.fire('pointermove', { pointerId: 1, clientX: 50, clientY: 50 + TOUCH_SLOP });
  assert.deepEqual(drags, [], 'a wobble stays a hold');
  pad.fire('pointermove', { pointerId: 1, clientX: 50, clientY: 50 - TOUCH_SLOP - 5 });
  pad.fire('pointermove', { pointerId: 2, clientX: 9, clientY: 9 });
  pad.fire('pointermove', { pointerId: 1, clientX: 40, clientY: 20 });
  assert.equal(holds.length, 1);
  assert.deepEqual(drags, [['start', 'bow', { x: 50, y: 35, touch: true }], ['move', { x: 50, y: 35, touch: true }, '50,35'],
    ['move', { x: 40, y: 20, touch: true }, '40,20']], 'no pointer capture for a finger');
  assert.equal(gestures.active && gestures.dragging, true);
  assert.equal(pad.fire('touchmove').defaultPrevented, true, 'a drag never scrolls');
  pad.fire('pointerdown', { pointerType: 'touch', pointerId: 2, isPrimary: false, target: 'card' });
  pad.fire('pointerup', { pointerId: 2, clientX: 0, clientY: 0 });
  assert.equal(gestures.dragging, true, 'a second finger changes nothing');
  pad.fire('pointerup', { pointerId: 1, clientX: 40, clientY: 22, timeStamp: 900 });
  assert.deepEqual(drags.slice(3), [['drop', 'bow', '40,22'], ['end']]);
  assert.equal(gestures.active, false);
  assert.equal(pad.fire('touchmove').defaultPrevented, false);
  assert.equal(pad.fire('click').stopped, true, 'the lift clicks nothing');
});

test('a pressed mouse drags once it moves past its slop, captured by the surface', (t) => {
  const { pad, holds, drags, gestures, down } = setup(t);
  assert.equal(MOUSE_SLOP, 4);
  down({ pointerType: 'mouse' });
  pad.fire('pointermove', { pointerId: 1, clientX: 53, clientY: 50 });
  pad.fire('pointerup', { pointerId: 1, clientX: 53, clientY: 50, timeStamp: 100 });
  assert.equal(pad.fire('click').stopped, false, 'a short wobble is a click');
  down({ pointerType: 'mouse' });
  pad.fire('pointermove', { pointerId: 1, clientX: 56, clientY: 50 });
  assert.deepEqual(drags, [['capture', 1], ['start', 'bow', { x: 56, y: 50, touch: false }],
    ['move', { x: 56, y: 50, touch: false }, '56,50']]);
  t.mock.timers.tick(HOLD_MS);
  assert.deepEqual(holds, [], 'no timer runs for a mouse');
  pad.fire('pointerup', { pointerId: 1, clientX: 70, clientY: 80, timeStamp: 200 });
  assert.deepEqual(drags.slice(3), [['drop', 'bow', '70,80'], ['end']]);
  assert.equal(gestures.dragging, false);
  assert.equal(pad.fire('click').stopped, true);
});

test('a cancelled drag ends without a drop', (t) => {
  const { pad, drags, gestures, down } = setup(t);
  const drag = () => {
    down({ pointerType: 'mouse' });
    pad.fire('pointermove', { pointerId: 1, clientX: 60, clientY: 50 });
    drags.length = 0;
  };
  drag();
  pad.fire('pointercancel');
  assert.deepEqual(drags, [['end']]);
  assert.equal(pad.fire('click').stopped, false, 'a cancelled pointer sends no click');
  drag();
  gestures.cancel();
  gestures.cancel();
  assert.deepEqual(drags, [['end']], 'once');
  pad.fire('pointerup', { pointerId: 1, timeStamp: 100 });
  assert.equal(pad.fire('click').stopped, true, 'the lift after Esc clicks nothing');
  drag();
  gestures.destroy();
  assert.deepEqual(drags, [['end']]);
});

test('a touch drags only after its hold, through the default hit test', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pad = surface();
  const seen = [];
  const original = globalThis.document;
  globalThis.document = { elementFromPoint: (x, y) => `at ${x},${y}` };
  t.after(() => { globalThis.document = original; });
  new BagGestures({ surface: pad, onHold() {}, onDragStart() {}, onDragEnd() {}, onDrop() {},
    onDragMove: (point, target) => seen.push(target), sourceOf: () => ({ selection: 1, node: { getBoundingClientRect: () => ({}) } }) });
  pad.fire('pointerdown', { pointerType: 'touch', pointerId: 1, clientX: 0, clientY: 0, timeStamp: 0 });
  t.mock.timers.tick(HOLD_MS);
  pad.fire('pointermove', { pointerId: 1, clientX: 20, clientY: 0 });
  assert.deepEqual(seen, ['at 20,0']);
});

test('a cancelled hold, or any later press on the wider surface, leaves the next click alone', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pad = surface();
  const root = surface();
  const gestures = new BagGestures({ surface: pad, swallowOn: root, onHold() {},
    sourceOf: () => ({ selection: 1, node: { getBoundingClientRect: () => ({}) } }) });
  const hold = () => {
    pad.fire('pointerdown', { pointerType: 'touch', pointerId: 1, timeStamp: 0 });
    t.mock.timers.tick(HOLD_MS);
  };
  assert.equal(root.listeners.get('pointerdown')[0].options, true, 'in the capture phase');
  hold();
  pad.fire('pointercancel');
  assert.equal(root.fire('click').stopped, false, 'a cancelled touch sends no click to swallow');
  // A press on a pinned panel's button never reaches the presses' surface.
  hold();
  pad.fire('pointerup', { timeStamp: HOLD_MS });
  root.fire('pointerdown');
  assert.equal(root.fire('click').stopped, false, 'the panel button acts');
  gestures.destroy();
  assert.equal(root.listeners.get('pointerdown').length, 0);
});
