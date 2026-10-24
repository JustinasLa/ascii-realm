import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installPinchZoom, pinchFactor } from '../src/core/pinch.js';

function setup() {
  const surface = new EventTarget();
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { hidden: false });
  const zooms = [];
  const pinch = installPinchZoom(surface, (factor) => zooms.push(factor), { win, doc });
  const send = (type, pointerId, clientX = 0, clientY = 0, pointerType = 'touch') =>
    surface.dispatchEvent(Object.assign(new Event(type), { pointerId, clientX, clientY, pointerType }));
  const product = () => zooms.reduce((total, factor) => total * factor, 1);
  return { surface, win, doc, zooms, pinch, send, product };
}

test('spreading two fingers zooms in by the ratio of their distances', () => {
  const { send, zooms, product } = setup();
  send('pointerdown', 1, 100, 300);
  send('pointerdown', 2, 200, 300);
  for (let step = 1; step <= 10; step++) send('pointermove', 2, 200 + step * 5, 300);
  assert.equal(zooms.length, 10);
  assert.ok(Math.abs(product() - 1.5) < 1e-9, `zoomed by ${product()}`);
  assert.ok(zooms.every((factor) => factor <= 1.25));
});

test('pinching the fingers together zooms out', () => {
  const { send, product } = setup();
  send('pointerdown', 1, 0, 0);
  send('pointerdown', 2, 0, 200);
  for (let step = 1; step <= 10; step++) {
    send('pointermove', 1, 0, step * 5);
    send('pointermove', 2, 0, 200 - step * 5);
  }
  assert.ok(Math.abs(product() - 0.5) < 1e-9);
});

test('one finger, mice and pens do not zoom', () => {
  const { send, zooms, pinch } = setup();
  send('pointerdown', 1, 0, 0);
  send('pointermove', 1, 80, 0);
  send('pointerdown', 7, 0, 0, 'mouse');
  send('pointerdown', 8, 50, 0, 'pen');
  send('pointermove', 7, 300, 0, 'mouse');
  send('pointermove', 8, 300, 0, 'pen');
  assert.equal(pinch.fingers, 1);
  assert.deepEqual(zooms, []);
});

test('lifting a finger stops zooming and a new pair starts from its own distance', () => {
  const { send, zooms, pinch } = setup();
  send('pointerdown', 1, 0, 0);
  send('pointerdown', 2, 100, 0);
  send('pointermove', 2, 110, 0);
  assert.equal(zooms.length, 1);
  send('pointerup', 2, 110, 0);
  send('pointerup', 9, 0, 0);
  send('pointermove', 1, 40, 0);
  assert.equal(zooms.length, 1, 'one finger left');
  send('pointerdown', 3, 240, 0);
  assert.equal(pinch.fingers, 2);
  send('pointermove', 3, 260, 0);
  assert.equal(zooms.length, 2);
  assert.ok(Math.abs(zooms[1] - 220 / 200) < 1e-9, 'measured from the new pair, not the old one');
});

test('a third finger pauses the pinch', () => {
  const { send, zooms } = setup();
  send('pointerdown', 1, 0, 0);
  send('pointerdown', 2, 100, 0);
  send('pointerdown', 3, 50, 50);
  send('pointermove', 2, 150, 0);
  assert.deepEqual(zooms, []);
});

test('cancel, blur and a hidden page reset the pinch', () => {
  const { send, zooms, pinch, win, doc } = setup();
  const pair = () => { send('pointerdown', 1, 0, 0); send('pointerdown', 2, 100, 0); };
  pair();
  send('pointercancel', 1);
  assert.equal(pinch.fingers, 0);
  pair();
  win.dispatchEvent(new Event('blur'));
  assert.equal(pinch.fingers, 0);
  pair();
  doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(pinch.fingers, 2, 'a visible page keeps the pinch');
  doc.hidden = true;
  doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(pinch.fingers, 0);
  send('pointermove', 2, 150, 0);
  assert.deepEqual(zooms, []);
});

test('dispose removes every listener', () => {
  const { send, zooms, pinch, win } = setup();
  pinch.dispose();
  send('pointerdown', 1, 0, 0);
  send('pointerdown', 2, 100, 0);
  send('pointermove', 2, 150, 0);
  win.dispatchEvent(new Event('blur'));
  assert.equal(pinch.fingers, 0);
  assert.deepEqual(zooms, []);
});

test('pinchFactor clamps each step and ignores fingers too close together', () => {
  assert.equal(pinchFactor(100, 110), 1.1);
  assert.equal(pinchFactor(100, 300), 1.25);
  assert.equal(pinchFactor(100, 10), 0.8);
  assert.equal(pinchFactor(0, 100), 1);
  assert.equal(pinchFactor(100, 0), 1);
  assert.equal(pinchFactor(4, 100), 1);
  assert.equal(pinchFactor(Number.NaN, 100), 1);
});

test('the default listeners attach to the page window and document', (t) => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = new EventTarget();
  globalThis.document = Object.assign(new EventTarget(), { hidden: true });
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  });
  const surface = new EventTarget();
  const pinch = installPinchZoom(surface, () => {});
  surface.dispatchEvent(Object.assign(new Event('pointerdown'), { pointerId: 1, pointerType: 'touch' }));
  document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(pinch.fingers, 0);
  pinch.dispose();
});
