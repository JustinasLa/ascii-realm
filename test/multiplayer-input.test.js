import assert from 'node:assert/strict';
import { test } from 'node:test';

const listeners = new Map();
globalThis.window = { addEventListener(type, fn) {
  if (!listeners.has(type)) listeners.set(type, []);
  listeners.get(type).push(fn);
} };
const { isDown, moveAxis, wasTapped } = await import('../src/core/input.js');
const scene = { closest: () => null };
const field = { closest: () => ({}) };
function fire(type, options = {}) {
  for (const fn of listeners.get(type) || []) fn({ target: scene, preventDefault() {}, ...options });
}

test('typing a lobby code does not walk, jump, attack or zoom the scene', () => {
  fire('keydown', { code: 'KeyA', target: field });
  fire('keydown', { code: 'KeyJ', target: field });
  let prevented = false;
  fire('keydown', { code: 'Space', target: field, preventDefault() { prevented = true; } });
  assert.deepEqual(moveAxis(), { x: 0, y: 0 });
  assert.equal(wasTapped('KeyJ', 'Space'), false);
  assert.equal(prevented, false);
  fire('keydown', { code: 'KeyD' });
  assert.equal(isDown('KeyD'), true);
  fire('focusin', { target: field });
  assert.equal(isDown('KeyD'), false);
  assert.equal(wasTapped('KeyD'), false);
});

test('blur clears both movement and unconsumed presses', () => {
  fire('keydown', { code: 'KeyJ' });
  fire('keydown', { code: 'ArrowLeft' });
  fire('blur');
  assert.equal(wasTapped('KeyJ'), false);
  assert.deepEqual(moveAxis(), { x: 0, y: 0 });
});
