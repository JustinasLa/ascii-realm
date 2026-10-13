import assert from 'node:assert/strict';
import { test } from 'node:test';

test('secondary pointers are ignored, old-style pointer buttons and both vertical axes work', async t => {
  const f = await fixture(t);
  f.canvas.focus = () => { f.canvas.focused = true; };
  f.canvas.setPointerCapture = id => { f.canvas.captured = id; };
  for (const type of ['pointerdown', 'pointermove', 'pointerup']) {
    f.point(type, 10, 20, { isPrimary: false, button: 0, buttons: 1 });
    assert.equal(f.input.pointerPosition(), null);
    assert.equal(f.input.isDown('MouseLeft'), false);
  }
  f.point('pointerdown', 10, 20, { button: 0, buttons: undefined });
  assert.equal(f.canvas.focused, true); assert.equal(f.canvas.captured, 1);
  assert.equal(f.input.isDown('MouseLeft'), true);
  f.point('pointerup', 10, 20, { button: 0 });
  for (const [code, y] of [['KeyW', -1], ['KeyS', 1]]) {
    f.key('keydown', code); assert.equal(f.input.moveAxis().y, y); f.key('keyup', code);
  }
});

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
  const point = (type, x, y, properties = {}) => send(type, {
    target: canvas, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse',
    button: -1, buttons: 0, ...properties,
  });
  return { input, window, document, body, canvas, send, key, pointer, point };
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

test('hovering the scene supplies cursor aim without starting an attack', async (t) => {
  const { input, point } = await fixture(t);
  assert.equal(input.pointerPosition(), null);
  point('pointermove', 0, 120.5);
  assert.deepEqual(input.pointerPosition(), { x: 0, y: 120.5 });
  assert.equal(input.isDown('MouseLeft', 'MouseRight'), false);
  assert.equal(input.wasTapped('MouseLeft', 'MouseRight'), false);
  assert.equal(input.wasReleased('MouseLeft', 'MouseRight'), false);

  point('pointermove', 280.25, 90);
  assert.deepEqual(input.pointerPosition(), { x: 280.25, y: 90 });
});

test('cursor position snapshots cannot mutate the aim tracker', async (t) => {
  const { input, point } = await fixture(t);
  point('pointermove', 75, 180);
  const position = input.pointerPosition();
  position.x = -900;
  position.y = -400;
  assert.deepEqual(input.pointerPosition(), { x: 75, y: 180 });

  const snapshot = input.pointerPosition();
  point('pointermove', 130, 210);
  assert.deepEqual(snapshot, { x: 75, y: 180 }, 'later movement preserves existing snapshots');
  assert.deepEqual(input.pointerPosition(), { x: 130, y: 210 });
});

test('a scene press, held movement, and release each update cursor aim', async (t) => {
  const { input, point } = await fixture(t);
  point('pointerdown', 64, 125, { button: 0, buttons: 1 });
  assert.deepEqual(input.pointerPosition(), { x: 64, y: 125 });
  assert.equal(input.isDown('MouseLeft'), true);
  assert.equal(input.wasTapped('MouseLeft'), true);

  point('pointermove', 110, 145, { buttons: 1 });
  assert.deepEqual(input.pointerPosition(), { x: 110, y: 145 });
  assert.equal(input.isDown('MouseLeft'), true);
  assert.equal(input.wasTapped('MouseLeft'), false, 'aiming while drawing does not start another attack');

  point('pointerup', 145, 160, { button: 0 });
  assert.deepEqual(input.pointerPosition(), { x: 145, y: 160 });
  assert.equal(input.isDown('MouseLeft'), false);
  assert.equal(input.wasReleased('MouseLeft'), true);
});

test('UI and unrelated surfaces clear cursor aim without supplying a target', async (t) => {
  const { input, body, point } = await fixture(t);
  const panel = new Element('section', { ui: true, parent: body });
  const label = new Element('span', { parent: panel });
  const select = new Element('select', { parent: panel });
  const preview = new Element('canvas', { id: 'preview', parent: body });
  for (const target of [label, select, preview, body]) {
    point('pointermove', 210, 220);
    assert.deepEqual(input.pointerPosition(), { x: 210, y: 220 });
    point('pointermove', 20, 30, { target });
    assert.equal(input.pointerPosition(), null, `${target.tagName} hover cannot aim`);
    point('pointerdown', 25, 35, { button: 0, buttons: 1, target });
    point('pointerup', 28, 38, { button: 0, target });
    assert.equal(input.pointerPosition(), null, `${target.tagName} click cannot aim`);
    assert.equal(input.isDown('MouseLeft'), false);
    assert.equal(input.wasTapped('MouseLeft'), false);
    assert.equal(input.wasReleased('MouseLeft'), false);
  }
});

test('captured pointer coordinates over the equipment panel cannot aim at the world', async (t) => {
  const { input, document, body, canvas, point } = await fixture(t);
  const panel = new Element('section', { ui: true, parent: body });
  const label = new Element('span', { parent: panel });
  document.elementFromPoint = () => canvas;
  point('pointerdown', 200, 240, { button: 0, buttons: 1 });
  assert.deepEqual(input.pointerPosition(), { x: 200, y: 240 });

  // A captured event still targets the canvas when the cursor passes over UI.
  document.elementFromPoint = () => label;
  point('pointermove', 500, 60, { buttons: 1 });
  assert.equal(input.pointerPosition(), null);
  point('pointerup', 510, 65, { button: 0 });
  assert.equal(input.pointerPosition(), null);
});

test('leaving the screen clears hover aim until the cursor returns', async (t) => {
  const { input, body, point } = await fixture(t);
  point('pointermove', 230, 250);
  assert.deepEqual(input.pointerPosition(), { x: 230, y: 250 });
  point('pointerout', 240, 260, { relatedTarget: body });
  assert.equal(input.pointerPosition(), null);
  point('pointermove', 180, 150);
  assert.deepEqual(input.pointerPosition(), { x: 180, y: 150 });
});

test('captured movement outside the canvas clears aim despite retaining the canvas target', async (t) => {
  const { input, canvas, point } = await fixture(t);
  canvas.getBoundingClientRect = () => ({
    left: 10, top: 20, right: 310, bottom: 220, width: 300, height: 200,
  });
  point('pointerdown', 100, 100, { button: 0, buttons: 1 });
  assert.deepEqual(input.pointerPosition(), { x: 100, y: 100 });
  point('pointermove', 330, 100, { buttons: 1 });
  assert.equal(input.pointerPosition(), null);
  assert.equal(input.isDown('MouseLeft'), true, 'leaving the canvas still preserves the held draw');
  point('pointerup', 335, 110, { button: 0 });
  assert.equal(input.pointerPosition(), null);
  assert.equal(input.isDown('MouseLeft'), false);
});

for (const reason of ['blur', 'UI focus', 'UI selection', 'hidden document', 'pointer cancel']) {
  test(`${reason} clears cursor aim and late captured release cannot restore it`, async (t) => {
    const { input, document, body, send, point } = await fixture(t);
    point('pointerdown', 200, 230, { button: 0, buttons: 1 });
    assert.deepEqual(input.pointerPosition(), { x: 200, y: 230 });
    if (reason === 'blur') send('blur');
    else if (reason === 'UI focus' || reason === 'UI selection') {
      const select = new Element('select', { parent: body });
      document.activeElement = select;
      send(reason === 'UI focus' ? 'focusin' : 'change', { target: select }, document);
    } else if (reason === 'hidden document') {
      document.hidden = true;
      document.visibilityState = 'hidden';
      send('visibilitychange', {}, document);
    } else point('pointercancel', 210, 235);
    assert.equal(input.pointerPosition(), null);
    assert.equal(input.wasCancelled(), true);

    point('pointermove', 330, 350, { buttons: 1 });
    assert.equal(input.pointerPosition(), null, 'a canceled captured move cannot restore aim');
    point('pointerup', 340, 360, { button: 0 });
    assert.equal(input.pointerPosition(), null, 'a late release cannot restore aim');
    assert.equal(input.isDown('MouseLeft'), false);
    assert.equal(input.wasTapped('MouseLeft'), false);
    assert.equal(input.wasReleased('MouseLeft'), false, 'a canceled draw does not fire');

    document.activeElement = body;
    document.hidden = false;
    document.visibilityState = 'visible';
    point('pointermove', 150, 180);
    assert.deepEqual(input.pointerPosition(), { x: 150, y: 180 }, 'new hover provides a fresh aim target');
  });
}

test('mouse release preserves its cursor aim when hover moves before the next frame', async (t) => {
  const { input, point } = await fixture(t);
  point('pointerdown', 100, 120, { button: 0, buttons: 1 });
  point('pointerup', 145, 160, { button: 0 });
  point('pointermove', 410, 430);
  assert.deepEqual(input.pointerPosition(), { x: 410, y: 430 });
  assert.deepEqual(input.attackReleasePosition(), { x: 145, y: 160 },
    'the shot uses the release point rather than the latest hover');
  assert.equal(input.attackReleasePosition(), null, 'the release aim is consumed once');
});

test('keyboard attack release captures the cursor position at keyup', async (t) => {
  const { input, key, point } = await fixture(t);
  point('pointermove', 80, 95);
  key('keydown', 'KeyJ');
  point('pointermove', 120, 135);
  key('keyup', 'KeyJ');
  point('pointermove', 410, 430);
  assert.deepEqual(input.attackReleasePosition(), { x: 120, y: 135 });
  assert.deepEqual(input.pointerPosition(), { x: 410, y: 430 });
  assert.equal(input.wasReleased('KeyJ'), true);

  key('keyup', 'KeyJ');
  assert.equal(input.attackReleasePosition(), null, 'a stray keyup does not queue another shot');
  assert.equal(input.wasReleased('KeyJ'), false);
});

test('chorded left-button release captures its pointermove position while guard stays held', async (t) => {
  const { input, point } = await fixture(t);
  point('pointerdown', 50, 60, { button: 0, buttons: 1 });
  point('pointermove', 100, 120, { button: 2, buttons: 3 });
  point('pointermove', 210, 240, { button: 0, buttons: 2 });
  point('pointermove', 400, 420, { buttons: 2 });
  assert.equal(input.isDown('MouseLeft'), false);
  assert.equal(input.isDown('MouseRight'), true);
  assert.deepEqual(input.attackReleasePosition(), { x: 210, y: 240 });
  point('pointerup', 450, 460, { button: 2 });
  assert.equal(input.attackReleasePosition(), null, 'releasing guard does not queue an attack');
});

test('combined keyboard and mouse attacks capture aim only when the final binding releases', async (t) => {
  const { input, key, point } = await fixture(t);
  key('keydown', 'KeyJ');
  point('pointerdown', 100, 120, { button: 0, buttons: 1 });
  key('keyup', 'KeyJ');
  assert.equal(input.isDown('MouseLeft'), true);
  assert.equal(input.attackReleasePosition(), null, 'a remaining mouse hold keeps the draw active');
  point('pointerup', 200, 220, { button: 0 });
  assert.deepEqual(input.attackReleasePosition(), { x: 200, y: 220 });

  point('pointerdown', 250, 270, { button: 0, buttons: 1 });
  key('keydown', 'KeyJ');
  point('pointerup', 300, 320, { button: 0 });
  assert.equal(input.isDown('KeyJ'), true);
  assert.equal(input.attackReleasePosition(), null, 'a remaining keyboard hold keeps the draw active');
  point('pointermove', 350, 370);
  key('keyup', 'KeyJ');
  assert.deepEqual(input.attackReleasePosition(), { x: 350, y: 370 });
});

test('starting a new mouse or keyboard attack clears an unconsumed previous release aim', async (t) => {
  const { input, key, point } = await fixture(t);
  point('pointerdown', 100, 120, { button: 0, buttons: 1 });
  point('pointerup', 145, 160, { button: 0 });
  key('keydown', 'KeyJ');
  assert.equal(input.attackReleasePosition(), null, 'a fresh keyboard draw replaces the old release');
  point('pointermove', 210, 240);
  key('keyup', 'KeyJ');
  point('pointerdown', 300, 320, { button: 0, buttons: 1 });
  assert.equal(input.attackReleasePosition(), null, 'a fresh mouse draw replaces the old release');
  point('pointerup', 350, 370, { button: 0 });
  assert.deepEqual(input.attackReleasePosition(), { x: 350, y: 370 });
});

test('cancellation clears an already queued release aim before the next frame', async (t) => {
  const { input, point, send } = await fixture(t);
  point('pointerdown', 100, 120, { button: 0, buttons: 1 });
  point('pointerup', 145, 160, { button: 0 });
  send('blur');
  assert.equal(input.attackReleasePosition(), null);
  assert.equal(input.wasReleased('MouseLeft'), false);
  point('pointerup', 300, 320, { button: 0 });
  assert.equal(input.attackReleasePosition(), null, 'a late release does not restore the canceled shot');

  point('pointerdown', 350, 370, { button: 0, buttons: 1 });
  point('pointerup', 380, 400, { button: 0 });
  assert.deepEqual(input.attackReleasePosition(), { x: 380, y: 400 }, 'a fresh draw can release normally');
});

test('consumed release coordinates cannot mutate the current cursor aim', async (t) => {
  const { input, point } = await fixture(t);
  assert.equal(input.attackReleasePosition(), null);
  point('pointerdown', 100, 120, { button: 0, buttons: 1 });
  point('pointerup', 145, 160, { button: 0 });
  const release = input.attackReleasePosition();
  assert.deepEqual(release, { x: 145, y: 160 });
  release.x = -900;
  release.y = -400;
  assert.deepEqual(input.pointerPosition(), { x: 145, y: 160 });
  assert.equal(input.attackReleasePosition(), null);

  point('pointerdown', 200, 220, { button: 0, buttons: 1 });
  point('pointerup', 240, 260, { button: 0 });
  assert.deepEqual(input.attackReleasePosition(), { x: 240, y: 260 });
});
