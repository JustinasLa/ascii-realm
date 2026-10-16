import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InputState } from '../src/core/input-state.js';

test('movement, jump and strike can be held by independent fingers', () => {
  const input = new InputState();
  input.setMove(-0.7, 0.5, true);
  input.pressPointer(2, 'Space');
  input.pressPointer(3, 'KeyJ');
  assert.deepEqual(input.moveAxis(), { x: -0.7, y: 0.5 });
  assert.ok(input.isDown('ShiftLeft'));
  assert.ok(input.wasTapped('Space'));
  assert.ok(input.wasTapped('KeyJ'));
  input.releasePointer(2);
  assert.equal(input.isDown('Space'), false);
  assert.ok(input.isDown('KeyJ'));
  assert.equal(input.wasTapped('KeyJ'), false);
});

test('releasing touch does not release a physical key or another finger', () => {
  const input = new InputState();
  input.keyDown('KeyJ');
  input.pressPointer(2, 'KeyJ');
  input.pressPointer(3, 'KeyJ');
  input.releasePointer(2);
  assert.ok(input.isDown('KeyJ'));
  input.keyUp('KeyJ');
  assert.ok(input.isDown('KeyJ'));
  input.releasePointer(3);
  assert.equal(input.isDown('KeyJ'), false);
});

test('backgrounding clears queued taps as well as held movement', () => {
  const input = new InputState();
  input.keyDown('KeyW');
  input.pressPointer(3, 'KeyJ');
  input.setMove(1, 1, true);
  input.clear();
  assert.deepEqual(input.moveAxis(), { x: 0, y: 0 });
  assert.equal(input.wasTapped('KeyW', 'KeyJ'), false);
  assert.equal(input.isDown('KeyW', 'KeyJ', 'ShiftLeft'), false);
});

test('a short tap survives release and keyboard repeat does not queue attacks', () => {
  const input = new InputState();
  input.keyDown('Space');
  input.keyUp('Space');
  assert.ok(input.wasTapped('Space'));
  input.keyDown('Space', true);
  assert.equal(input.wasTapped('Space'), false);
});

test('starting a touch move returns focus from a panel to gameplay', async (t) => {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = new EventTarget();
  globalThis.document = new EventTarget();
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  });

  const root = new EventTarget();
  root.querySelectorAll = () => [];
  const pad = new EventTarget();
  pad.classList = { toggle() {}, remove() {} };
  pad.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 });
  pad.setPointerCapture = () => {};
  const stick = { style: {} };
  const canvas = { tagName: 'CANVAS', focus(options) {
    assert.equal(options.preventScroll, true);
    document.activeElement = canvas;
    // The input module clears held controls when focus leaves a panel.
    window.dispatchEvent(new Event('focusout'));
  } };
  const nodes = { 'touch-controls': root, 'move-pad': pad, 'move-stick': stick, screen: canvas };
  document.getElementById = id => nodes[id];
  const { installTouchControls } = await import('../src/core/touch.js');
  const { input, isControlTarget, moveAxis } = await import('../src/core/input.js');
  installTouchControls(() => {});
  document.activeElement = { tagName: 'SELECT' };
  assert.equal(isControlTarget(document.activeElement), true);

  pad.dispatchEvent(Object.assign(new Event('pointerdown', { cancelable: true }), {
    button: 0, pointerId: 7, clientX: 80, clientY: 50,
  }));
  assert.equal(document.activeElement, canvas, 'the joystick must release panel focus');
  assert.equal(isControlTarget(document.activeElement), false, 'the frame must accept touch movement');
  assert.ok(moveAxis().x > 0.8, 'focus cleanup must happen before the fresh touch move');
  assert.equal(input.isDown('ShiftLeft'), true);
  pad.dispatchEvent(Object.assign(new Event('pointerup'), { pointerId: 7 }));
  assert.deepEqual(moveAxis(), { x: 0, y: 0 });
  assert.equal(input.isDown('ShiftLeft'), false);
});
