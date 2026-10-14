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
