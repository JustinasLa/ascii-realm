import assert from 'node:assert/strict';
import { test } from 'node:test';

class Element {
  constructor(tagName, { parent = null, ui = false, editable = false, href = false } = {}) {
    this.tagName = tagName.toUpperCase();
    this.parentElement = parent;
    this.ui = ui;
    this.editable = editable;
    this.href = href;
  }

  get isContentEditable() {
    return this.editable || !!this.parentElement?.isContentEditable;
  }

  closest(selector) {
    const selectors = selector.split(',').map((part) => part.trim());
    for (let node = this; node; node = node.parentElement) {
      if (selectors.some((part) => part === node.tagName.toLowerCase()
        || (part === 'a[href]' && node.tagName === 'A' && node.href)
        || (part === '[contenteditable]' && node.editable)
        || (part === '[data-game-ui]' && node.ui))) return node;
    }
    return null;
  }
}

let fixtureId = 0;

async function fixture(t, setupWindow = () => {}) {
  const saved = ['window', 'document'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const window = new EventTarget();
  const document = new EventTarget();
  const body = new Element('body');
  const scene = new Element('canvas', { parent: body });
  document.body = body;
  document.activeElement = scene;
  document.hidden = false;
  window.document = document;
  setupWindow(window);
  Object.defineProperty(globalThis, 'window', { value: window, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'document', { value: document, configurable: true, writable: true });
  const module = new URL('../src/core/input.js', import.meta.url);
  module.searchParams.set('collection-input-test', String(++fixtureId));
  let input;
  try {
    input = await import(module.href);
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }

  function send(type, properties = {}, surface = window) {
    const event = new Event(type, { cancelable: true });
    Object.defineProperties(event, Object.fromEntries(Object.entries({ target: scene, ...properties })
      .map(([key, value]) => [key, { value, configurable: true }])));
    surface.dispatchEvent(event);
    return event;
  }

  const key = (type, code, properties = {}) => send(type, { code, repeat: false, ...properties });
  function focus(target) {
    document.activeElement = target;
    send('focusin', { target }, document);
  }
  return { input, window, document, body, scene, send, key, focus };
}

test('scene movement and quick action taps keep normal keyboard behavior', async (t) => {
  const { input, key } = await fixture(t);
  assert.equal(key('keydown', 'ArrowUp').defaultPrevented, true);
  key('keydown', 'KeyD');
  assert.deepEqual(input.moveAxis(), { x: 1, y: -1 });
  assert.equal(input.wasTapped('ArrowUp'), true);
  key('keydown', 'ArrowUp', { repeat: true });
  assert.equal(input.wasTapped('ArrowUp'), false);

  assert.equal(key('keydown', 'Space').defaultPrevented, true);
  key('keyup', 'Space');
  assert.equal(input.wasTapped('Space'), true, 'a jump between frames is retained');
  assert.equal(input.wasTapped('Space'), false);
  key('keydown', 'KeyQ');
  key('keyup', 'KeyQ');
  assert.equal(input.wasTapped('KeyQ'), true, 'scene Q reaches the collection action');
  key('keyup', 'ArrowUp');
  key('keyup', 'KeyD');
  assert.deepEqual(input.moveAxis(), { x: 0, y: 0 });
});

test('native controls, editable descendants, and UI panels cannot queue game actions', async (t) => {
  const { input, body, key } = await fixture(t);
  const controls = ['button', 'select', 'input', 'textarea', 'summary']
    .map((tag) => new Element(tag, { parent: body }));
  controls.push(new Element('a', { parent: body, href: true }));
  controls.push(new Element('span', { parent: new Element('button', { parent: body }) }));
  controls.push(new Element('span', { parent: new Element('div', { editable: true, parent: body }) }));
  controls.push(new Element('span', { parent: new Element('section', { ui: true, parent: body }) }));

  for (const target of controls) {
    assert.equal(input.isGameplayTarget(target), false, target.tagName);
    for (const code of ['KeyQ', 'KeyE', 'KeyJ', 'Digit1', 'KeyW', 'ArrowDown', 'Space']) {
      const event = key('keydown', code, { target });
      assert.equal(event.defaultPrevented, false, `${target.tagName} ${code} native behavior`);
      assert.equal(input.isDown(code), false, `${target.tagName} ${code} held`);
      assert.equal(input.wasTapped(code), false, `${target.tagName} ${code} tapped`);
    }
  }
  assert.deepEqual(input.moveAxis(), { x: 0, y: 0 });
});

test('capture-consumed collection shortcuts do not leak into gameplay input', async (t) => {
  const shortcuts = new Set(['KeyI', 'Tab', 'Escape', 'KeyE', 'KeyQ', 'Digit1', 'Digit9']);
  const { input, key } = await fixture(t, (window) => {
    window.addEventListener('keydown', (event) => {
      if (shortcuts.has(event.code)) event.preventDefault();
    }, { capture: true });
  });
  key('keydown', 'KeyW');
  for (const code of shortcuts) {
    assert.equal(key('keydown', code).defaultPrevented, true, code);
    assert.equal(input.isDown(code), false, `${code} held`);
    assert.equal(input.wasTapped(code), false, `${code} tapped`);
  }
  assert.deepEqual(input.moveAxis(), { x: 0, y: -1 }, 'selecting a slot does not interrupt movement');
});

test('blocking a modal discards all pending input and held keys cannot return through repeat', async (t) => {
  const { input, key } = await fixture(t);
  key('keydown', 'KeyW');
  key('keydown', 'Space');
  input.setGameplayBlocked(true);
  assert.equal(input.isGameplayBlocked(), true);
  assert.deepEqual(input.moveAxis(), { x: 0, y: 0 });
  assert.equal(input.isDown('KeyW', 'Space'), false);
  assert.equal(input.wasTapped('KeyW', 'Space'), false);
  assert.equal(key('keydown', 'ArrowDown').defaultPrevented, false, 'modal keys keep native behavior');
  key('keydown', 'KeyQ');
  input.setGameplayBlocked(false);
  assert.equal(input.isGameplayBlocked(), false);
  assert.equal(input.wasTapped('Space', 'KeyQ', 'ArrowDown'), false, 'closing cannot replay modal keys');
  key('keydown', 'KeyW', { repeat: true });
  key('keydown', 'KeyQ', { repeat: true });
  assert.equal(input.isDown('KeyW', 'KeyQ'), false);
  assert.equal(input.wasTapped('KeyW', 'KeyQ'), false);
  key('keyup', 'KeyW');
  key('keydown', 'KeyW');
  assert.deepEqual(input.moveAxis(), { x: 0, y: -1 }, 'a fresh press resumes movement');
});

test('focus entering controls clears pending taps and blocks input until scene focus returns', async (t) => {
  const { input, body, scene, key, focus } = await fixture(t);
  key('keydown', 'KeyW');
  key('keydown', 'KeyQ');
  key('keyup', 'KeyQ');
  const select = new Element('select', { parent: body });
  focus(select);
  assert.equal(input.isGameplayBlocked(), true);
  assert.equal(input.isDown('KeyW'), false);
  assert.equal(input.wasTapped('KeyQ'), false);
  assert.deepEqual(input.moveAxis(), { x: 0, y: 0 });
  assert.equal(key('keydown', 'ArrowDown', { target: select }).defaultPrevented, false);

  focus(scene);
  assert.equal(input.isGameplayBlocked(), false);
  assert.equal(input.wasTapped('KeyQ', 'ArrowDown'), false);
  key('keydown', 'KeyW', { repeat: true });
  assert.deepEqual(input.moveAxis(), { x: 0, y: 0 });
  key('keyup', 'KeyW');
  key('keydown', 'KeyQ');
  assert.equal(input.wasTapped('KeyQ'), true);
});

test('blur, visibility changes, and explicit clearing discard held and queued actions', async (t) => {
  const { input, document, key, send } = await fixture(t);
  const clearThrough = [
    () => send('blur'),
    () => input.clearInput(),
    () => {
      document.hidden = true;
      send('visibilitychange', {}, document);
      assert.equal(input.isGameplayBlocked(), true);
      key('keydown', 'KeyQ');
      document.hidden = false;
      send('visibilitychange', {}, document);
    },
  ];
  for (const clear of clearThrough) {
    key('keydown', 'KeyW');
    key('keydown', 'KeyQ');
    clear();
    assert.deepEqual(input.moveAxis(), { x: 0, y: 0 });
    assert.equal(input.wasTapped('KeyQ', 'KeyW'), false);
    key('keydown', 'KeyW', { repeat: true });
    assert.equal(input.isDown('KeyW'), false, 'a cleared held key cannot resume on repeat');
    key('keyup', 'KeyW');
    key('keyup', 'KeyQ');
  }
});

test('input listeners keep their own window and document when another module fixture is imported', async (t) => {
  const original = await fixture(t);
  const other = await fixture(t);
  const control = new Element('button', { parent: other.body });
  other.focus(control);
  assert.equal(other.input.isGameplayBlocked(), true);
  assert.equal(original.input.isGameplayBlocked(), false, 'each import uses its own document');
  original.key('keydown', 'KeyQ');
  assert.equal(original.input.wasTapped('KeyQ'), true);
  assert.equal(other.input.wasTapped('KeyQ'), false);
});
