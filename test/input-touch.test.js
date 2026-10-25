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

// A page holding the stick, the thumb cluster and the zoom buttons. The
// browser globals are installed once: input.js listens on the first window.
class FakeElement extends EventTarget {
  constructor(attributes = {}) {
    super();
    this.classes = new Set();
    this.classList = {
      add: (...names) => names.forEach(n => this.classes.add(n)),
      remove: (...names) => names.forEach(n => this.classes.delete(n)),
      toggle: (name, force = !this.classes.has(name)) => { if (force) this.classes.add(name); else this.classes.delete(name); },
      contains: name => this.classes.has(name),
    };
    this.dataset = { ...attributes.dataset };
    this.style = {};
    this.hidden = Boolean(attributes.hidden);
    this.textContent = attributes.text ?? '';
    this.attributes = new Map();
    this.captured = [];
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setPointerCapture(id) { this.captured.push(id); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; }
}

const page = {};
async function installPage() {
  if (!page.window) {
    page.window = globalThis.window = new EventTarget();
    page.document = globalThis.document = new EventTarget();
    document.hidden = false;
    page.modules = {
      touch: await import('../src/core/touch.js'),
      input: await import('../src/core/input.js'),
    };
  }
  const buttons = {
    strike: new FakeElement({ dataset: { key: 'TouchStrike' } }),
    jump: new FakeElement({ dataset: { key: 'Space' } }),
    interact: new FakeElement({ dataset: { key: 'TouchInteract' }, hidden: true, text: 'SPORES' }),
    zoomIn: new FakeElement({ dataset: { zoom: '1.15' } }),
  };
  const root = new FakeElement();
  root.querySelectorAll = selector => selector === '[data-key]'
    ? [buttons.strike, buttons.jump, buttons.interact] : [buttons.zoomIn];
  const pad = new FakeElement();
  const cast = new FakeElement();
  const canvas = { tagName: 'CANVAS', focus() { document.activeElement = canvas; window.dispatchEvent(new Event('focusout')); } };
  const nodes = { 'touch-controls': root, 'move-pad': pad, 'move-stick': new FakeElement(), screen: canvas,
    'touch-cast': cast, 'touch-interact': buttons.interact };
  document.getElementById = id => nodes[id];
  const zooms = [];
  const touch = page.modules.touch.installTouchControls(factor => zooms.push(factor));
  page.modules.input.clearInput();
  return { ...page.modules, touch, root, pad, cast, canvas, buttons, zooms };
}

// Pointer events carry the time they happened: by default the mocked clock.
const pointer = (target, type, pointerId, { timeStamp = Date.now(), ...extra } = {}) => {
  const event = Object.assign(new Event(type, { cancelable: true }), { button: 0, pointerId, clientX: 50, clientY: 50, ...extra });
  Object.defineProperty(event, 'timeStamp', { value: timeStamp });
  target.dispatchEvent(event);
  return event;
};

test('starting a touch move returns focus from a panel to gameplay', async () => {
  const { input, pad, canvas } = await installPage();
  const { isControlTarget, moveAxis } = page.modules.input;
  document.activeElement = { tagName: 'SELECT' };
  assert.equal(isControlTarget(document.activeElement), true);

  pointer(pad, 'pointerdown', 7, { clientX: 80, clientY: 50 });
  assert.equal(document.activeElement, canvas, 'the joystick must release panel focus');
  assert.equal(isControlTarget(document.activeElement), false, 'the frame must accept touch movement');
  assert.ok(moveAxis().x > 0.8, 'focus cleanup must happen before the fresh touch move');
  assert.equal(input.isDown('ShiftLeft'), true);
  pad.dispatchEvent(Object.assign(new Event('pointerup'), { pointerId: 7 }));
  assert.deepEqual(moveAxis(), { x: 0, y: 0 });
  assert.equal(input.isDown('ShiftLeft'), false);
});

test('the stick follows only its own finger and a slight push stands still', async () => {
  const { input, pad } = await installPage();
  pointer(pad, 'pointerdown', 1, { button: 2 });
  assert.deepEqual(input.moveAxis(), { x: 0, y: 0 }, 'only the primary button steers');
  pointer(pad, 'pointerdown', 1, { clientX: 55, clientY: 50 });
  assert.deepEqual(input.moveAxis(), { x: 0, y: 0 }, 'inside the dead zone');
  pointer(pad, 'pointerdown', 2, { clientX: 100, clientY: 50 });
  pointer(pad, 'pointermove', 2, { clientX: 100, clientY: 50 });
  assert.deepEqual(input.moveAxis(), { x: 0, y: 0 }, 'a second finger cannot take the stick');
  pointer(pad, 'pointermove', 1, { clientX: 70, clientY: 50 });
  assert.ok(input.moveAxis().x > 0.5);
  assert.equal(input.isDown('ShiftLeft'), false, 'walking, not running');
  pointer(pad, 'pointercancel', 1);
  assert.deepEqual(input.moveAxis(), { x: 0, y: 0 });
});

test('a tap on CAST casts the bound rune on release and never opens the wheel', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const { touch, cast, input } = await installPage();
  const holds = [];
  touch.setCastHold(id => { holds.push(id); return true; });
  const down = pointer(cast, 'pointerdown', 4);
  assert.equal(down.defaultPrevented, true);
  assert.deepEqual(cast.captured, [4]);
  assert.ok(cast.classList.contains('pressed'));
  t.mock.timers.tick(120);
  assert.equal(input.wasTapped('TouchCast'), false, 'nothing casts while the finger is down');
  pointer(cast, 'pointerup', 4);
  pointer(cast, 'lostpointercapture', 4);
  assert.equal(input.wasTapped('TouchCast'), true);
  assert.equal(cast.classList.contains('pressed'), false);
  t.mock.timers.tick(1000);
  assert.deepEqual(holds, []);
  assert.equal(input.wasTapped('TouchCast'), false);
});

test('holding CAST opens the rune wheel on that finger and the lift casts nothing', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const { touch, cast, input, CAST_HOLD_MS, CAST_HINT_MS } = { ...await installPage(), ...page.modules.touch };
  const holds = [];
  touch.setCastHold(id => { holds.push(id); return true; });
  pointer(cast, 'pointerdown', 9);
  t.mock.timers.tick(CAST_HINT_MS - 1);
  assert.equal(cast.classList.contains('holding'), false);
  t.mock.timers.tick(1);
  assert.equal(cast.classList.contains('holding'), true, 'the dashed frame says the wheel is coming');
  t.mock.timers.tick(CAST_HOLD_MS - CAST_HINT_MS);
  assert.deepEqual(holds, [9]);
  pointer(cast, 'pointerdown', 10);
  pointer(cast, 'pointerup', 10);
  assert.equal(input.wasTapped('TouchCast'), false, 'a second finger on CAST does nothing');
  pointer(cast, 'pointerup', 9);
  assert.equal(input.wasTapped('TouchCast'), false);
  assert.equal(cast.classList.contains('holding'), false);
  assert.deepEqual(holds, [9]);
});

test('a quick tap whose lift a busy frame delayed still casts', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const { touch, cast, input } = await installPage();
  const holds = [];
  touch.setCastHold(id => { holds.push(id); return true; });
  const pressed = Date.now();
  pointer(cast, 'pointerdown', 3);
  t.mock.timers.tick(450);
  assert.deepEqual(holds, [3], 'the wheel opened before the lift arrived');
  pointer(cast, 'pointerup', 3, { timeStamp: pressed + 120 });
  assert.equal(input.wasTapped('TouchCast'), true);
});

test('the wheel learns whether a lift is still a tap, and loses a finger CAST loses', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const { touch, cast, CAST_HOLD_MS } = { ...await installPage(), ...page.modules.touch };
  const holds = [], drops = [];
  touch.setCastHold((id, isTap) => { holds.push([id, isTap]); return true; }, id => drops.push(id));
  const pressed = Date.now();
  pointer(cast, 'pointerdown', 5);
  pointer(cast, 'lostpointercapture', 6);
  t.mock.timers.tick(CAST_HOLD_MS);
  const [[id, isTap]] = holds;
  assert.equal(id, 5);
  assert.equal(isTap({ timeStamp: pressed + CAST_HOLD_MS - 1 }), true);
  assert.equal(isTap({ timeStamp: pressed + CAST_HOLD_MS }), false);
  pointer(cast, 'lostpointercapture', 5);
  assert.deepEqual(drops, [5], 'the wheel goes with the finger');
  assert.equal(cast.classList.contains('pressed'), false);
  // A press that never reached the wheel, or a lift already handled, drops nothing.
  pointer(cast, 'pointerdown', 7);
  t.mock.timers.tick(100);
  pointer(cast, 'lostpointercapture', 7);
  pointer(cast, 'pointerdown', 8);
  t.mock.timers.tick(CAST_HOLD_MS);
  pointer(cast, 'pointerup', 8);
  pointer(cast, 'lostpointercapture', 8);
  assert.deepEqual(drops, [5]);
});

test('a hold the wheel refuses, or a cancelled press, casts nothing', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const { touch, cast, input } = await installPage();
  let holds = 0;
  touch.setCastHold(() => { holds++; return false; });
  pointer(cast, 'pointerdown', 1, { button: 1 });
  t.mock.timers.tick(400);
  assert.equal(holds, 0, 'only the primary button presses CAST');
  pointer(cast, 'pointerdown', 1);
  t.mock.timers.tick(400);
  pointer(cast, 'pointerup', 1);
  assert.equal(holds, 1);
  assert.equal(input.wasTapped('TouchCast'), false, 'a long press never fires a surprise cast');

  for (const end of [
    () => pointer(cast, 'pointercancel', 2),
    () => window.dispatchEvent(new Event('blur')),
    () => window.dispatchEvent(new Event('resize')),
    () => { document.hidden = true; document.dispatchEvent(new Event('visibilitychange')); document.hidden = false; },
  ]) {
    pointer(cast, 'pointerdown', 2);
    t.mock.timers.tick(100);
    pointer(cast, 'lostpointercapture', 3);
    end();
    assert.equal(cast.classList.contains('pressed'), false);
    t.mock.timers.tick(1000);
    pointer(cast, 'pointerup', 2);
    assert.equal(input.wasTapped('TouchCast'), false);
  }
  document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(holds, 1, 'cleared timers never open the wheel late');
});

test('CAST, STRIKE and the stick work together under three fingers', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const { cast, pad, buttons, input } = await installPage();
  pointer(pad, 'pointerdown', 1, { clientX: 20, clientY: 50 });
  pointer(buttons.strike, 'pointerdown', 2);
  pointer(cast, 'pointerdown', 3);
  t.mock.timers.tick(80);
  pointer(cast, 'pointerup', 3);
  assert.ok(input.moveAxis().x < 0);
  assert.ok(input.isDown('TouchStrike'));
  assert.ok(input.wasTapped('TouchCast'));
  assert.ok(buttons.strike.classList.contains('pressed'));
  pointer(buttons.strike, 'pointerup', 2);
  assert.equal(input.isDown('TouchStrike'), false);
  assert.equal(buttons.strike.classList.contains('pressed'), false);
  pointer(pad, 'pointerup', 1);
});

test('buttons answer keyboard activation, zoom, and clear when the page loses focus', async () => {
  const { cast, buttons, input, root, zooms } = await installPage();
  const click = (target, detail) => target.dispatchEvent(Object.assign(new Event('click'), { detail }));
  click(cast, 1);
  click(buttons.jump, 1);
  assert.equal(input.wasTapped('TouchCast', 'Space'), false, 'pointer clicks were handled on press');
  click(cast, 0);
  click(buttons.interact, 0);
  assert.ok(input.wasTapped('TouchCast'));
  assert.ok(input.wasTapped('TouchInteract'));
  pointer(buttons.jump, 'pointerdown', 5, { button: 2 });
  assert.equal(input.isDown('Space'), false);
  click(buttons.zoomIn, 1);
  assert.deepEqual(zooms, [1.15]);
  const menu = new Event('contextmenu', { cancelable: true });
  root.dispatchEvent(menu);
  assert.equal(menu.defaultPrevented, true);

  for (const leave of [
    () => window.dispatchEvent(new Event('blur')),
    () => window.dispatchEvent(new Event('resize')),
    () => { document.hidden = true; document.dispatchEvent(new Event('visibilitychange')); document.hidden = false; },
  ]) {
    pointer(buttons.jump, 'pointerdown', 6);
    assert.ok(buttons.jump.classList.contains('pressed'));
    leave();
    assert.equal(buttons.jump.classList.contains('pressed'), false);
    assert.equal(input.isDown('Space'), false);
  }
  document.dispatchEvent(new Event('visibilitychange'));
});

test('the contextual button shows only what is in reach', async () => {
  const { touch, buttons } = await installPage();
  touch.interact.update({ kind: 'fire', label: 'DOUSE', ariaLabel: 'Put out the fire' }, 0);
  assert.equal(buttons.interact.hidden, false);
  assert.equal(buttons.interact.textContent, 'DOUSE');
  touch.interact.update(null, 1);
  assert.equal(buttons.interact.hidden, true);
});
