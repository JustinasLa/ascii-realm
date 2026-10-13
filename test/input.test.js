import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

const events = new EventTarget();
const previousWindow = globalThis.window;
globalThis.window = events;
const { isDown, moveAxis, wasTapped } = await import('../src/core/input.js');
if (previousWindow === undefined) delete globalThis.window;
else globalThis.window = previousWindow;

function key(type, code, options = {}) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { code, repeat: false, ...options });
  events.dispatchEvent(event);
  return event;
}

beforeEach(() => events.dispatchEvent(new Event('blur')));

test('browser shortcuts do not become gameplay input or lose their default action', () => {
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
    for (const code of ['KeyF', 'KeyJ', 'KeyW', 'ArrowUp', 'Space']) {
      const event = key('keydown', code, { [modifier]: true });
      assert.equal(event.defaultPrevented, false, `${modifier} + ${code}`);
      assert.equal(isDown(code), false, `${modifier} + ${code} held`);
      assert.equal(wasTapped(code), false, `${modifier} + ${code} tapped`);
    }
  }
  assert.deepEqual(moveAxis(), { x: 0, y: 0 });
});

test('losing focus clears held keys and actions queued before the next frame', () => {
  for (const code of ['KeyW', 'ShiftLeft', 'Space', 'KeyJ', 'KeyF']) key('keydown', code);
  assert.deepEqual(moveAxis(), { x: 0, y: -1 });
  events.dispatchEvent(new Event('blur'));
  assert.deepEqual(moveAxis(), { x: 0, y: 0 });
  for (const code of ['KeyW', 'ShiftLeft', 'Space', 'KeyJ', 'KeyF']) {
    assert.equal(isDown(code), false, `${code} held`);
    assert.equal(wasTapped(code), false, `${code} tapped`);
  }
});

test('movement and actions still work while Shift is held', () => {
  key('keydown', 'ShiftLeft', { shiftKey: true });
  const arrow = key('keydown', 'ArrowRight', { shiftKey: true });
  const jump = key('keydown', 'Space', { shiftKey: true });
  assert.equal(isDown('ShiftLeft', 'ShiftRight'), true);
  assert.deepEqual(moveAxis(), { x: 1, y: 0 });
  assert.equal(arrow.defaultPrevented, true);
  assert.equal(jump.defaultPrevented, true);
  key('keyup', 'Space', { shiftKey: true });
  assert.equal(wasTapped('Space'), true);
  assert.equal(wasTapped('Space'), false);
  key('keyup', 'ArrowRight', { shiftKey: true });
  assert.deepEqual(moveAxis(), { x: 0, y: 0 });
});

test('repeated keydown events do not queue extra actions', () => {
  key('keydown', 'KeyJ');
  assert.equal(wasTapped('KeyJ'), true);
  key('keydown', 'KeyJ', { repeat: true });
  assert.equal(isDown('KeyJ'), true);
  assert.equal(wasTapped('KeyJ'), false);
  key('keyup', 'KeyJ');
  assert.equal(isDown('KeyJ'), false);
});
