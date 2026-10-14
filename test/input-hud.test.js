import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';

// Only the browser APIs used by the input module are needed here. Node runs
// this test file in its own process, keeping these globals out of other tests.
class FakeEventTarget {
  listeners = new Map();

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type, properties = {}) {
    const event = {
      type,
      target: this,
      repeat: false,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      ...properties,
    };
    for (const listener of this.listeners.get(type) ?? []) listener(event);
    return event;
  }
}

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const fakeWindow = new FakeEventTarget();
const fakeDocument = new FakeEventTarget();
fakeDocument.hidden = false;
Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow });
Object.defineProperty(globalThis, 'document', { configurable: true, value: fakeDocument });

const {
  clearInput, isDown, isGameplayBlocked, moveAxis, setGameplayBlocked, wasTapped,
} = await import('../src/core/input.js');

after(() => {
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else delete globalThis.window;
  if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
  else delete globalThis.document;
});

beforeEach(() => {
  setGameplayBlocked(false);
  clearInput();
  fakeDocument.hidden = false;
});

const keydown = (code, properties = {}) => fakeWindow.dispatch('keydown', { code, ...properties });
const keyup = (code, properties = {}) => fakeWindow.dispatch('keyup', { code, ...properties });

function pressGameplayKeys() {
  keydown('KeyD');
  keydown('ShiftLeft');
  keydown('Space');
  keydown('KeyJ');
}

function assertNeutral() {
  assert.deepEqual(moveAxis(), { x: 0, y: 0 });
  assert.equal(isDown('KeyD', 'ShiftLeft', 'Space', 'KeyJ'), false);
  assert.equal(wasTapped('KeyD', 'ShiftLeft', 'Space', 'KeyJ'), false);
}

test('fresh gameplay presses move, run, jump, and attack once per press', () => {
  pressGameplayKeys();
  keydown('KeyW');
  assert.deepEqual(moveAxis(), { x: 1, y: -1 });
  assert.equal(isDown('ShiftLeft', 'ShiftRight'), true);
  assert.equal(wasTapped('Space'), true);
  assert.equal(wasTapped('KeyJ'), true);
  assert.equal(wasTapped('Space', 'KeyJ'), false);

  keydown('Space', { repeat: true });
  keydown('KeyJ');
  assert.equal(wasTapped('Space', 'KeyJ'), false);
  keyup('KeyJ');
  keydown('KeyJ');
  assert.equal(wasTapped('KeyJ'), true);
});

test('a quick press and release still queues one gameplay action', () => {
  keydown('Space');
  keyup('Space');
  assert.equal(isDown('Space'), false);
  assert.equal(wasTapped('Space'), true);
  assert.equal(wasTapped('Space'), false);
});

test('opening and closing a modal clears held keys and pending actions', () => {
  pressGameplayKeys();
  setGameplayBlocked(true);
  assert.equal(isGameplayBlocked(), true);
  assertNeutral();

  keydown('KeyD');
  keydown('Space');
  keydown('KeyJ');
  assertNeutral();

  setGameplayBlocked(false);
  assert.equal(isGameplayBlocked(), false);
  assertNeutral();
  pressGameplayKeys();
  assert.deepEqual(moveAxis(), { x: 1, y: 0 });
  assert.equal(isDown('ShiftLeft'), true);
  assert.equal(wasTapped('Space'), true);
  assert.equal(wasTapped('KeyJ'), true);
});

test('auto-repeat while blocked or after closing cannot revive cleared input', () => {
  pressGameplayKeys();
  setGameplayBlocked(true);
  for (const code of ['KeyD', 'Space', 'KeyJ']) {
    assert.equal(keydown(code, { repeat: true }).defaultPrevented, false);
  }
  setGameplayBlocked(false);
  for (const code of ['KeyD', 'Space', 'KeyJ']) {
    assert.equal(keydown(code, { repeat: true }).defaultPrevented, false);
  }
  assertNeutral();

  for (const code of ['KeyD', 'Space', 'KeyJ']) keyup(code);
  pressGameplayKeys();
  assert.deepEqual(moveAxis(), { x: 1, y: 0 });
  assert.equal(wasTapped('Space', 'KeyJ'), true);
});

test('setting the existing mode does not discard an active gameplay press', () => {
  pressGameplayKeys();
  setGameplayBlocked(false);
  assert.equal(isDown('KeyD'), true);
  assert.equal(wasTapped('Space'), true);
});

test('clearInput discards both held keys and queued actions', () => {
  pressGameplayKeys();
  clearInput();
  assertNeutral();
});

const editableTargets = [
  ['input', { tagName: 'INPUT' }],
  ['textarea', { tagName: 'TEXTAREA' }],
  ['select', { tagName: 'SELECT' }],
  ['contenteditable', { tagName: 'DIV', isContentEditable: true }],
  ['text inside contenteditable', { nodeType: 3, parentElement: { isContentEditable: true } }],
  ['select descendant', { tagName: 'OPTION', closest: () => ({ tagName: 'SELECT' }) }],
];

for (const [name, target] of editableTargets) {
  test(`typing in ${name} does not move, jump, or attack`, () => {
    for (const code of ['KeyD', 'ShiftLeft', 'Space', 'KeyJ', 'ArrowRight']) {
      assert.equal(keydown(code, { target }).defaultPrevented, false);
    }
    assertNeutral();
    assert.equal(isDown('ArrowRight'), false);
    assert.equal(wasTapped('ArrowRight'), false);
  });
}

test('editable controls in a composed event path do not send gameplay input', () => {
  const target = { tagName: 'CUSTOM-EDITOR' };
  const path = [target, { tagName: 'TEXTAREA' }, fakeWindow];
  for (const code of ['KeyD', 'Space', 'KeyJ']) {
    const event = keydown(code, { target, composedPath: () => path });
    assert.equal(event.defaultPrevented, false);
  }
  assertNeutral();
});

for (const tagName of ['BUTTON', 'SUMMARY']) {
  test(`keyboard activation of ${tagName.toLowerCase()} preserves its default and clears gameplay input`, () => {
    const target = { tagName };
    pressGameplayKeys();
    fakeWindow.dispatch('focusin', { target });
    assertNeutral();
    assert.equal(keydown('Space', { target }).defaultPrevented, false);
    assert.equal(keydown('KeyJ', { target }).defaultPrevented, false);
    assertNeutral();
  });
}

test('a nested button label and a link preserve keyboard control without gameplay actions', () => {
  const button = { tagName: 'BUTTON' };
  const link = { tagName: 'A' };
  for (const target of [
    { tagName: 'SPAN', closest: () => button },
    { tagName: 'A', closest: () => link },
  ]) {
    assert.equal(keydown('Space', { target }).defaultPrevented, false);
    assert.equal(keydown('KeyJ', { target }).defaultPrevented, false);
  }
  assertNeutral();
});

test('keydown events already consumed by UI do not send gameplay input', () => {
  for (const code of ['KeyD', 'Space', 'KeyJ']) {
    keydown(code, { defaultPrevented: true });
  }
  assertNeutral();
});

test('keyup still releases a held key when a UI control consumes the event', () => {
  keydown('KeyD');
  keyup('KeyD', { defaultPrevented: true, target: { tagName: 'INPUT' } });
  assert.equal(isDown('KeyD'), false);
  assert.deepEqual(moveAxis(), { x: 0, y: 0 });
});

for (const type of ['blur', 'focusout']) {
  test(`${type} clears held movement and pending jump and attack`, () => {
    pressGameplayKeys();
    fakeWindow.dispatch(type);
    assertNeutral();
    keydown('KeyD', { repeat: true });
    keydown('Space', { repeat: true });
    keydown('KeyJ', { repeat: true });
    assertNeutral();

    pressGameplayKeys();
    assert.equal(isDown('KeyD'), true);
    assert.equal(wasTapped('Space'), true);
    assert.equal(wasTapped('KeyJ'), true);
  });
}

test('focusing an editable control clears held keys and queued actions', () => {
  pressGameplayKeys();
  fakeWindow.dispatch('focusin', { target: { tagName: 'TEXTAREA' } });
  assertNeutral();
});

test('hiding the document clears held movement and pending jump and attack', () => {
  pressGameplayKeys();
  fakeDocument.hidden = true;
  fakeDocument.dispatch('visibilitychange');
  assertNeutral();
  fakeDocument.hidden = false;
  fakeDocument.dispatch('visibilitychange');
  keydown('KeyD', { repeat: true });
  keydown('Space', { repeat: true });
  keydown('KeyJ', { repeat: true });
  assertNeutral();

  pressGameplayKeys();
  assert.equal(isDown('KeyD'), true);
  assert.equal(wasTapped('Space'), true);
  assert.equal(wasTapped('KeyJ'), true);
});

test('a visible document event preserves current gameplay input', () => {
  pressGameplayKeys();
  fakeDocument.dispatch('visibilitychange');
  assert.equal(isDown('KeyD'), true);
  assert.equal(wasTapped('Space'), true);
});

test('arrows and Space prevent browser defaults only during gameplay', () => {
  const codes = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'];
  for (const code of codes) assert.equal(keydown(code).defaultPrevented, true);
  setGameplayBlocked(true);
  for (const code of codes) assert.equal(keydown(code).defaultPrevented, false);
  setGameplayBlocked(false);
  for (const code of codes) {
    assert.equal(keydown(code, { target: { tagName: 'INPUT' } }).defaultPrevented, false);
  }
});

test('Tab remains available for browser focus navigation in every mode', () => {
  assert.equal(keydown('Tab').defaultPrevented, false);
  setGameplayBlocked(true);
  assert.equal(keydown('Tab').defaultPrevented, false);
  setGameplayBlocked(false);
  assert.equal(keydown('Tab', { target: { tagName: 'INPUT' } }).defaultPrevented, false);
});
