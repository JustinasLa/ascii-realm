import assert from 'node:assert/strict';
import { test } from 'node:test';

// Node's EventTarget gives us real preventDefault behavior without a browser.
// The small element shim supplies only the DOM ancestry that input filtering uses.
class Element {
  constructor(tagName, { id = '', parent = null, ui = false, editable = false } = {}) {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.parentElement = parent;
    this.ui = ui;
    this.editable = editable;
  }

  get isContentEditable() {
    return this.editable || !!this.parentElement?.isContentEditable;
  }

  closest(selector) {
    const selectors = selector.split(',').map((part) => part.trim());
    for (let node = this; node; node = node.parentElement) {
      if (selectors.some((part) => part === node.tagName.toLowerCase()
        || (part === '[contenteditable]' && node.editable)
        || (part === '[data-game-ui]' && node.ui))) return node;
    }
    return null;
  }
}

let fixtureId = 0;

async function fixture(t) {
  const saved = ['window', 'document'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const window = new EventTarget();
  const document = new EventTarget();
  const body = new Element('body');
  const canvas = new Element('canvas', { id: 'screen', parent: body });
  document.body = body;
  document.activeElement = body;
  document.hidden = false;
  document.visibilityState = 'visible';
  window.document = document;
  globalThis.window = window;
  globalThis.document = document;
  t.after(() => {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });

  const module = new URL('../src/core/input.js', import.meta.url);
  module.searchParams.set('input-test', String(++fixtureId));
  const input = await import(module.href);

  function send(type, properties = {}, surface = window) {
    const event = new Event(type, { cancelable: true });
    Object.defineProperties(event, Object.fromEntries(Object.entries({ target: body, ...properties })
      .map(([key, value]) => [key, { value, configurable: true }])));
    surface.dispatchEvent(event);
    return event;
  }

  const key = (type, code, properties = {}) => send(type, { code, repeat: false, ...properties });
  const pointer = (type, button, target = canvas) => send(type, { button, target });
  return { input, window, document, body, canvas, send, key, pointer };
}

test('a held attack key produces one press and one release, including quick taps', async (t) => {
  const { input, key } = await fixture(t);
  key('keydown', 'KeyJ');
  assert.equal(input.isDown('KeyJ', 'MouseLeft'), true);
  assert.equal(input.wasTapped('KeyJ'), true);
  assert.equal(input.wasTapped('KeyJ'), false);
  key('keydown', 'KeyJ', { repeat: true });
  assert.equal(input.wasTapped('KeyJ'), false);
  assert.equal(input.isDown('KeyJ'), true);
  key('keyup', 'KeyJ');
  assert.equal(input.isDown('KeyJ'), false);
  assert.equal(input.wasReleased('KeyJ'), true);
  assert.equal(input.wasReleased('KeyJ'), false);

  key('keydown', 'KeyJ');
  key('keyup', 'KeyJ');
  assert.equal(input.wasTapped('KeyJ'), true, 'a press between frames is retained');
  assert.equal(input.wasReleased('KeyJ'), true, 'a release between frames is retained');
  assert.equal(input.isDown('KeyJ'), false);
});

test('left mouse attack remains held until release outside the canvas', async (t) => {
  const { input, body, pointer } = await fixture(t);
  pointer('pointerdown', 0);
  assert.equal(input.isDown('MouseLeft'), true);
  assert.equal(input.wasTapped('MouseLeft'), true);
  assert.equal(input.wasTapped('MouseLeft'), false);
  pointer('pointerup', 0, body);
  assert.equal(input.isDown('MouseLeft'), false);
  assert.equal(input.wasReleased('MouseLeft'), true);
  assert.equal(input.wasReleased('MouseLeft'), false);
});

test('right mouse holds guard independently and prevents the scene context menu', async (t) => {
  const { input, canvas, send, pointer, key } = await fixture(t);
  key('keydown', 'KeyJ');
  pointer('pointerdown', 2);
  assert.equal(input.isDown('KeyJ'), true);
  assert.equal(input.isDown('MouseRight'), true);
  assert.equal(input.wasTapped('MouseRight'), true);
  const menu = send('contextmenu', { target: canvas });
  assert.equal(menu.defaultPrevented, true);

  pointer('pointerup', 2);
  assert.equal(input.isDown('MouseRight'), false);
  assert.equal(input.isDown('KeyJ'), true, 'releasing guard preserves the held attack');
  assert.equal(input.wasReleased('MouseRight'), true);
  assert.equal(input.wasReleased('KeyJ'), false);
});

test('chorded mouse buttons track attack and guard through pointermove transitions', async (t) => {
  const { input, canvas, body, send } = await fixture(t);
  const pointerEvent = (type, button, buttons, target = canvas) => send(type, {
    button, buttons, target, pointerId: 1, pointerType: 'mouse',
  });
  pointerEvent('pointerdown', 0, 1);
  assert.equal(input.wasTapped('MouseLeft'), true);

  // Pointer Events sends pointermove, rather than a second pointerdown, when
  // another mouse button is pressed while the first remains held.
  pointerEvent('pointermove', 2, 3);
  assert.equal(input.isDown('MouseLeft'), true);
  assert.equal(input.isDown('MouseRight'), true);
  assert.equal(input.wasTapped('MouseRight'), true);
  assert.equal(input.wasTapped('MouseLeft'), false);

  pointerEvent('pointermove', 0, 2);
  assert.equal(input.isDown('MouseLeft'), false);
  assert.equal(input.isDown('MouseRight'), true);
  assert.equal(input.wasReleased('MouseLeft'), true);
  assert.equal(input.wasReleased('MouseRight'), false);

  pointerEvent('pointerup', 2, 0, body);
  assert.equal(input.isDown('MouseRight'), false);
  assert.equal(input.wasReleased('MouseRight'), true);
  assert.equal(input.wasReleased('MouseLeft'), false);
});

test('weapon selection and material cycling fire once per physical key press', async (t) => {
  const { input, key } = await fixture(t);
  for (const code of [...Array.from({ length: 9 }, (_, i) => `Digit${i + 1}`),
    'BracketLeft', 'BracketRight', 'KeyM']) {
    key('keydown', code);
    assert.equal(input.wasTapped(code), true, code);
    assert.equal(input.wasTapped(code), false, code);
    key('keydown', code, { repeat: true });
    assert.equal(input.wasTapped(code), false, `${code} auto-repeat`);
    key('keyup', code);
    key('keydown', code);
    assert.equal(input.wasTapped(code), true, `${code} next press`);
    key('keyup', code);
  }
});

test('selects and editable fields receive keys without triggering gameplay', async (t) => {
  const { input, body, key } = await fixture(t);
  const controls = ['select', 'input', 'textarea', 'button']
    .map((tag) => new Element(tag, { parent: body }));
  const editor = new Element('div', { editable: true, parent: body });
  controls.push(new Element('span', { parent: editor }));
  for (const target of controls) {
    for (const code of ['KeyJ', 'KeyK', 'KeyM', 'Digit2', 'KeyW', 'ArrowDown', 'Space']) {
      const event = key('keydown', code, { target });
      assert.equal(event.defaultPrevented, false, `${target.tagName} ${code}`);
      assert.equal(input.isDown(code), false, `${target.tagName} ${code} held`);
      assert.equal(input.wasTapped(code), false, `${target.tagName} ${code} tapped`);
    }
  }
  assert.deepEqual(input.moveAxis(), { x: 0, y: 0 });
});

test('panel clicks and keyboard events on panel descendants cannot start attacks', async (t) => {
  const { input, body, pointer, key, send } = await fixture(t);
  const panel = new Element('section', { ui: true, parent: body });
  const label = new Element('span', { parent: panel });
  pointer('pointerdown', 0, label);
  pointer('pointerdown', 2, label);
  key('keydown', 'KeyJ', { target: label });
  key('keydown', 'KeyK', { target: label });
  key('keydown', 'Digit1', { target: label });
  assert.equal(input.isDown('MouseLeft', 'MouseRight', 'KeyJ', 'KeyK'), false);
  assert.equal(input.wasTapped('MouseLeft', 'MouseRight', 'KeyJ', 'KeyK', 'Digit1'), false);
  assert.equal(send('contextmenu', { target: label }).defaultPrevented, false);
});

test('unrelated canvases and mouse buttons do not generate weapon input', async (t) => {
  const { input, body, canvas, pointer, send } = await fixture(t);
  const otherCanvas = new Element('canvas', { id: 'preview', parent: body });
  pointer('pointerdown', 0, otherCanvas);
  pointer('pointerdown', 2, otherCanvas);
  send('pointermove', { button: 2, buttons: 3, target: canvas, pointerId: 1, pointerType: 'mouse' });
  pointer('pointerdown', 1, canvas);
  assert.equal(input.isDown('MouseLeft', 'MouseRight'), false);
  assert.equal(input.wasTapped('MouseLeft', 'MouseRight'), false);
  assert.equal(send('contextmenu', { target: otherCanvas }).defaultPrevented, false);
});

test('pointer cancellation clears a charge and ignores remaining captured moves', async (t) => {
  const { input, canvas, send } = await fixture(t);
  const properties = { target: canvas, pointerId: 7, pointerType: 'mouse' };
  send('pointerdown', { ...properties, button: 0, buttons: 1 });
  send('pointercancel', properties);
  assert.equal(input.isDown('MouseLeft'), false);
  assert.equal(input.wasTapped('MouseLeft'), false);
  assert.equal(input.wasReleased('MouseLeft'), false);
  assert.equal(input.wasCancelled(), true);

  send('pointermove', { ...properties, button: 2, buttons: 3 });
  send('pointerup', { ...properties, button: 0, buttons: 0 });
  assert.equal(input.isDown('MouseLeft', 'MouseRight'), false);
  assert.equal(input.wasTapped('MouseLeft', 'MouseRight'), false);
  assert.equal(input.wasReleased('MouseLeft', 'MouseRight'), false);
});

test('focus entering a selection panel cancels attack, guard, and pending edges', async (t) => {
  const { input, document, body, key, pointer, send } = await fixture(t);
  key('keydown', 'KeyJ');
  key('keydown', 'Digit1');
  key('keyup', 'Digit1');
  pointer('pointerdown', 0);
  pointer('pointerdown', 2);
  const select = new Element('select', { parent: body });
  document.activeElement = select;
  send('focusin', { target: select }, document);
  assert.equal(input.isDown('KeyJ', 'MouseLeft', 'MouseRight'), false);
  assert.equal(input.wasTapped('KeyJ', 'MouseLeft', 'MouseRight', 'Digit1'), false);
  assert.equal(input.wasReleased('Digit1', 'KeyJ', 'MouseLeft', 'MouseRight'), false);
  assert.equal(input.wasCancelled(), true);
  assert.equal(input.wasCancelled(), false);

  pointer('pointerup', 0, select);
  pointer('pointerup', 2, select);
  key('keyup', 'KeyJ', { target: select });
  assert.equal(input.wasReleased('KeyJ', 'MouseLeft', 'MouseRight'), false,
    'releasing after cancellation does not fire the charged attack');
});

test('window blur cancels held attack and guard without leaving a queued attack', async (t) => {
  const { input, key, pointer, send } = await fixture(t);
  key('keydown', 'KeyJ');
  key('keydown', 'KeyK');
  key('keydown', 'KeyW');
  pointer('pointerdown', 0);
  pointer('pointerdown', 2);
  send('blur');
  assert.equal(input.isDown('KeyJ', 'KeyK', 'MouseLeft', 'MouseRight'), false);
  assert.equal(input.wasTapped('KeyJ', 'KeyK', 'MouseLeft', 'MouseRight'), false);
  assert.equal(input.wasReleased('KeyJ', 'MouseLeft'), false);
  assert.deepEqual(input.moveAxis(), { x: 0, y: 0 });
  assert.equal(input.wasCancelled(), true);
  assert.equal(input.wasCancelled(), false);

  key('keyup', 'KeyJ');
  key('keyup', 'KeyK');
  pointer('pointerup', 0);
  pointer('pointerup', 2);
  assert.equal(input.wasReleased('KeyJ', 'KeyK', 'MouseLeft', 'MouseRight'), false,
    'returning to the page cannot release canceled actions');

  key('keydown', 'KeyJ');
  assert.equal(input.isDown('KeyJ'), true, 'a new press works after returning');
  assert.equal(input.wasTapped('KeyJ'), true);
});

test('hiding the document cancels a charged attack and held guard', async (t) => {
  const { input, document, key, pointer, send } = await fixture(t);
  key('keydown', 'KeyJ');
  pointer('pointerdown', 0);
  pointer('pointerdown', 2);
  document.hidden = true;
  document.visibilityState = 'hidden';
  send('visibilitychange', {}, document);
  assert.equal(input.isDown('KeyJ', 'MouseLeft', 'MouseRight'), false);
  assert.equal(input.wasTapped('KeyJ', 'MouseLeft', 'MouseRight'), false);
  assert.equal(input.wasReleased('KeyJ', 'MouseLeft', 'MouseRight'), false);
  assert.equal(input.wasCancelled(), true);

  document.hidden = false;
  document.visibilityState = 'visible';
  send('visibilitychange', {}, document);
  assert.equal(input.wasCancelled(), false, 'becoming visible does not cancel a new action');
});

test('movement and jump still work on the scene, with browser scrolling prevented', async (t) => {
  const { input, key } = await fixture(t);
  assert.equal(key('keydown', 'ArrowUp').defaultPrevented, true);
  key('keydown', 'KeyD');
  assert.deepEqual(input.moveAxis(), { x: 1, y: -1 });
  assert.equal(key('keydown', 'Space').defaultPrevented, true);
  assert.equal(input.wasTapped('Space'), true);
  key('keyup', 'ArrowUp');
  key('keyup', 'KeyD');
  assert.deepEqual(input.moveAxis(), { x: 0, y: 0 });
});
