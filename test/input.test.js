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

test('game input leaves builder controls and browser shortcuts available', async (t) => {
  const listeners = new Map();
  const previousWindow = globalThis.window;
  globalThis.window = {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
  };
  let input;
  try {
    input = await import(`../src/core/input.js?input-test=${Date.now()}`);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }

  function key(type, code, options = {}) {
    let prevented = false;
    listeners.get(type)({
      code,
      repeat: false,
      target: null,
      preventDefault() { prevented = true; },
      ...options,
    });
    return prevented;
  }

  await t.test('game keys still track taps, repeats and movement', () => {
    input.clearInput();
    assert.equal(key('keydown', 'ArrowLeft'), true);
    assert.equal(input.isDown('ArrowLeft'), true);
    assert.deepEqual(input.moveAxis(), { x: -1, y: 0 });
    assert.equal(input.wasTapped('ArrowLeft'), true);
    key('keydown', 'ArrowLeft', { repeat: true });
    assert.equal(input.wasTapped('ArrowLeft'), false);
    key('keyup', 'ArrowLeft');
    assert.equal(input.isDown('ArrowLeft'), false);
  });

  await t.test('controls preserve their default key behavior and do not move the player', () => {
    input.clearInput();
    const target = { closest: () => ({}) };
    assert.equal(key('keydown', 'ArrowDown', { target }), false);
    assert.equal(key('keydown', 'Space', { target }), false);
    assert.equal(input.isDown('ArrowDown', 'Space'), false);
    assert.equal(input.wasTapped('ArrowDown', 'Space'), false);
  });

  await t.test('browser shortcuts are ignored for every modifier', () => {
    for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
      input.clearInput();
      assert.equal(key('keydown', 'Space', { [modifier]: true }), false);
      assert.equal(input.isDown('Space'), false);
      assert.equal(input.wasTapped('Space'), false);
    }
  });

  await t.test('key release cleans up even after focus moves into a control', () => {
    input.clearInput();
    key('keydown', 'KeyW');
    key('keyup', 'KeyW', { target: { closest: () => ({}) }, ctrlKey: true });
    assert.equal(input.isDown('KeyW'), false);
  });

  await t.test('clear and blur discard held keys and unconsumed taps', () => {
    for (const clear of [input.clearInput, listeners.get('blur')]) {
      key('keydown', 'KeyW');
      key('keydown', 'Space');
      clear();
      assert.deepEqual(input.moveAxis(), { x: 0, y: 0 });
      assert.equal(input.isDown('Space'), false);
      assert.equal(input.wasTapped('KeyW', 'Space'), false);
    }
  });

  await t.test('control detection safely accepts targets without closest', () => {
    assert.equal(input.isControlTarget(null), false);
    assert.equal(input.isControlTarget({}), false);
    assert.equal(input.isControlTarget({ closest: () => null }), false);
    assert.equal(input.isControlTarget({ closest: () => ({}) }), true);
  });
});

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
