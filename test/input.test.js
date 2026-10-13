import assert from 'node:assert/strict';
import { test } from 'node:test';

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
