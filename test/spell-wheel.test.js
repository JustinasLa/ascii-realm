import assert from 'node:assert/strict';
import test from 'node:test';
import { WHEEL } from '../src/spells/radial.js';

// The rune wheel on a page: a window that records listeners, a body, and a
// canvas whose 2D context counts what it draws.
class Node extends EventTarget {
  constructor(tag) {
    super();
    this.tag = tag;
    this.style = {};
    this.dataset = {};
    this.children = [];
    this.attributes = new Map();
    this.hidden = false;
    const classes = this.classes = new Set();
    this.classList = { add: n => classes.add(n), remove: n => classes.delete(n), contains: n => classes.has(n) };
    this.captured = [];
  }
  append(...nodes) { this.children.push(...nodes); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setPointerCapture(id) { this.captured.push(id); }
  set className(value) { value.split(' ').forEach(n => this.classes.add(n)); }
}

const context = () => ({
  drawn: [],
  font: '',
  measureText() { return { width: this.zeroWidth ? 0 : 7.2 }; },
  setTransform() {}, clearRect() {}, fillRect() {},
  fillText(ch) { this.drawn.push(ch); },
});

let SpellControls;
async function page(t, { width = 390, height = 844, canvas2d = true } = {}) {
  const saved = {};
  for (const key of ['window', 'document', 'innerWidth', 'innerHeight', 'devicePixelRatio', 'getComputedStyle']) {
    saved[key] = Object.getOwnPropertyDescriptor(globalThis, key);
  }
  const window = new EventTarget();
  const body = new Node('body');
  const document = {
    body,
    createElement: tag => {
      const node = new Node(tag);
      if (tag === 'canvas' && canvas2d) {
        const ctx = context();
        node.getContext = () => ctx;
      }
      return node;
    },
  };
  Object.assign(globalThis, { window, document, innerWidth: width, innerHeight: height, devicePixelRatio: 2,
    getComputedStyle: () => ({ fontFamily: 'mono', getPropertyValue: name => ` ${name}-colour ` }) });
  t.after(() => {
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  SpellControls ??= (await import('../src/spells/controls.js')).SpellControls;
  return { window, document, body };
}

const SPELLS = [
  { id: 'fire-shard', name: 'Fire Shard', element: 'oseni' },
  { id: 'fire-rain', name: 'Fire Rain', element: 'oseni' },
  { id: 'ice-shard', name: 'Ice Shard', element: 'seithr' },
  { id: 'ward', name: 'Ward', element: 'cerrith', toggleAura: 'Ward' },
];
const casting = (spells = SPELLS, mana = 50) => ({
  available: spells, selected: spells[0].id, spells: new Map(spells.map(s => [s.id, s])), player: {},
  state: () => ({ mana }), variant: s => s.noVariant ? null : {},
  modifiers: () => ({ mana: 20, damage: 8, heal: 3, shield_power: 4, duration: 6, mana_regen: 1 }),
  hasAura: () => false,
});

function controls(options = {}, spells) {
  const surface = new Node('canvas');
  const binds = [];
  let focused = 0;
  const wheel = new SpellControls(casting(spells), { surface, storage: null, castKey: () => 'CAST',
    onBind: spell => binds.push(spell.id), onFocus: () => focused++, ...options });
  return { wheel, surface, binds, focused: () => focused, ctx: wheel.ctx };
}

// Events reach the window's listeners; `target` says where they started.
const pointer = (target, type, { target: from, ...extra } = {}) => {
  const event = Object.assign(new Event(type, { cancelable: true }), { button: 0, pointerType: 'touch', pointerId: 1,
    clientX: innerWidth / 2, clientY: innerHeight / 2, ...extra });
  if (from) Object.defineProperty(event, 'target', { value: from });
  target.dispatchEvent(event);
  return event;
};
// A point on the wheel `distance` units out at `angle` from the top, clockwise.
const at = (wheel, distance, angle) => ({ clientX: wheel.cx + Math.sin(angle) * distance * wheel.scale,
  clientY: wheel.cy - Math.cos(angle) * distance * wheel.scale });
const label = wheel => wheel.canvas.getAttribute('aria-label');

test('holding CAST opens the wheel mid-screen on that finger, once', async (t) => {
  const { body } = await page(t);
  let allowed = false;
  const { wheel } = controls({ canOpen: () => allowed });
  assert.equal(body.children[0], wheel.wheel);
  assert.equal(wheel.wheel.hidden, true);
  assert.equal(wheel.openTouch(4), false, 'blocked gameplay keeps the wheel shut');
  allowed = true;
  assert.equal(wheel.openTouch(4), true);
  assert.deepEqual([wheel.source, wheel.pointerId, wheel.menu.held], ['touch', 4, true]);
  assert.equal(wheel.wheel.hidden, false);
  assert.ok(body.classList.contains('spell-wheel-open'));
  assert.equal(wheel.openTouch(5), false, 'an open wheel is not reopened');
  assert.equal(wheel.pointerId, 4);
  assert.match(label(wheel), /Tap CAST to cast/);
  assert.ok(wheel.ctx.drawn.length > 100, 'the rims and labels are drawn');
});

test('sliding the holding finger to a school and lifting opens it; a tap binds a rune', async (t) => {
  const { window } = await page(t);
  const { wheel, binds, focused } = controls();
  wheel.openTouch(1);
  // Another finger's moves don't steer.
  pointer(window, 'pointermove', { pointerId: 2, ...at(wheel, 150, 0) });
  assert.equal(wheel.menu.hover, -1);
  pointer(window, 'pointermove', { pointerId: 1, ...at(wheel, 150, 0) });
  assert.equal(wheel.menu.hover, 0);
  assert.match(label(wheel), /Oseni/);
  wheel.update();
  pointer(window, 'pointerup', { pointerId: 2 });
  assert.equal(wheel.menu.isOpen, true, 'another finger lifting does nothing');
  pointer(window, 'pointerup', { pointerId: 1, ...at(wheel, 150, 0) });
  assert.equal(wheel.menu.stage, 'items');
  assert.equal(wheel.wheel.dataset.stage, 'items');
  assert.match(label(wheel), /^Fire Shard, 20 mana/, 'the finger still points at the first rune');
  wheel.update();
  // Hovering a rune shows its numbers.
  const step = Math.PI * 2 / 2;
  pointer(window, 'pointermove', { pointerId: 7, ...at(wheel, 150, step) });
  assert.match(label(wheel), /Fire Rain, 20 mana, 8 dmg, 3 heal, 4 shield, 6s long, \+1 mana\/s/);
  // The finger that held is gone; a fresh tap picks.
  const tap = pointer(window, 'pointerdown', { pointerId: 7, ...at(wheel, 150, step) });
  assert.equal(tap.defaultPrevented, true);
  assert.deepEqual(binds, ['fire-rain']);
  assert.equal(wheel.menu.isOpen, false);
  assert.equal(wheel.wheel.hidden, true);
  assert.equal(focused(), 1);
  // A closed wheel ignores the pointer.
  pointer(window, 'pointermove', { pointerId: 7 });
  pointer(window, 'pointerdown', { pointerId: 7 });
  pointer(window, 'pointerup', { pointerId: 7 });
  assert.deepEqual(binds, ['fire-rain']);
});

test('a cancelled finger shuts the wheel and an empty tap in the hub goes back', async (t) => {
  const { window } = await page(t);
  const { wheel } = controls();
  wheel.openTouch(1);
  pointer(window, 'pointercancel', { pointerId: 1 });
  assert.equal(wheel.menu.isOpen, false);
  wheel.openTouch(1);
  pointer(window, 'pointerup', { pointerId: 1 });
  assert.equal(wheel.menu.isOpen, false, 'lifting in the hub puts the wheel away');
  wheel.openTouch(1);
  wheel.apply(wheel.menu.press(...[150, 0].map((v, i) => i ? -150 : 0)));
  assert.equal(wheel.menu.stage, 'items');
  pointer(window, 'pointerdown', { pointerId: 9 });
  assert.equal(wheel.menu.stage, 'groups', 'a tap in the hub goes back a stage');
  wheel.apply(null);
  for (const leave of ['blur', 'resize']) {
    wheel.openTouch(1);
    window.dispatchEvent(new Event(leave));
    assert.equal(wheel.menu.isOpen, false, leave);
  }
  window.dispatchEvent(new Event('blur'));
  window.dispatchEvent(new Event('resize'));
});

test('a lift that still counts as a tap on CAST closes the wheel without binding', async (t) => {
  const { window } = await page(t);
  const { wheel, binds, focused } = controls();
  wheel.openTouch(1, e => e.tap);
  // Movement queued behind the hold timer slides into a school and onto a rune.
  pointer(window, 'pointermove', { pointerId: 1, ...at(wheel, 150, 0) });
  pointer(window, 'pointermove', { pointerId: 1, ...at(wheel, WHEEL.outer + WHEEL.flick + 10, 0) });
  assert.equal(wheel.menu.stage, 'items');
  pointer(window, 'pointermove', { pointerId: 1, ...at(wheel, 150, 0) });
  pointer(window, 'pointerup', { pointerId: 1, tap: true, ...at(wheel, 150, 0) });
  assert.equal(wheel.menu.isOpen, false);
  assert.deepEqual(binds, [], 'a tap never rebinds');
  assert.equal(focused(), 1);
  wheel.openTouch(1, e => e.tap);
  pointer(window, 'pointermove', { pointerId: 1, ...at(wheel, 150, 0) });
  pointer(window, 'pointerup', { pointerId: 1, tap: false, ...at(wheel, 150, 0) });
  assert.equal(wheel.menu.stage, 'items', 'a real hold still opens the school');
});

test('CAST losing its finger puts away the wheel that finger opened', async (t) => {
  await page(t);
  const { wheel, focused } = controls();
  wheel.dropTouch(1);
  assert.equal(focused(), 0, 'a closed wheel has nothing to drop');
  wheel.openTouch(3);
  wheel.dropTouch(4);
  assert.equal(wheel.menu.isOpen, true, 'another finger is not the one that held');
  wheel.dropTouch(3);
  assert.equal(wheel.menu.isOpen, false);
  assert.equal(wheel.wheel.hidden, true);
  assert.equal(focused(), 1);
});

test('the middle mouse button holds the wheel open over the scene', async (t) => {
  const { window } = await page(t, { width: 1280, height: 720 });
  const { wheel, surface, binds } = controls({ castKey: () => 'R' });
  const mouse = (type, extra) => pointer(window, type, { pointerType: 'mouse', pointerId: 1, ...extra });
  mouse('mousedown', { button: 1, target: new Node('div') });
  assert.equal(wheel.menu.isOpen, false, 'only over the scene');
  const down = mouse('mousedown', { button: 1, target: surface, clientX: 640, clientY: 360 });
  assert.equal(down.defaultPrevented, true);
  assert.equal(wheel.source, 'mouse');
  assert.match(label(wheel), /Bound to \[R\]/);
  // Mouse presses while held are taken by the mousedown handler.
  assert.equal(mouse('pointerdown', { button: 0 }).defaultPrevented, false);
  mouse('pointermove', at(wheel, 150, 0));
  mouse('mousedown', { button: 0, ...at(wheel, 150, 0) });
  assert.equal(wheel.menu.stage, 'items');
  mouse('mousedown', { button: 2 });
  assert.equal(wheel.menu.stage, 'groups', 'a right click goes back');
  const menu = mouse('contextmenu', {});
  assert.equal(menu.defaultPrevented, true);
  mouse('mousedown', { button: 3 });
  // Letting go of the middle button over a school opens it for a click.
  mouse('pointermove', at(wheel, 150, 0));
  mouse('mouseup', { button: 1 });
  assert.equal(wheel.menu.stage, 'items');
  assert.equal(wheel.menu.held, false);
  mouse('mouseup', { button: 0 });
  // Now a left click chooses through pointerdown, and a right click goes back.
  mouse('pointerdown', { button: 2 });
  mouse('mousedown', { button: 2 });
  assert.equal(wheel.menu.stage, 'groups');
  mouse('mousedown', { button: 2 });
  assert.equal(wheel.menu.isOpen, false, 'right click on the schools closes');
  mouse('contextmenu', {});
  assert.equal(mouse('contextmenu', {}).defaultPrevented, false);
  // Middle click toggles it shut again.
  mouse('mousedown', { button: 1, target: surface });
  mouse('mousedown', { button: 1, target: surface });
  assert.equal(wheel.menu.isOpen, false);
  mouse('mouseup', { button: 1 });
  // Escape and the scroll wheel.
  mouse('mousedown', { button: 1, target: surface });
  const scroll = new Event('wheel', { cancelable: true });
  window.dispatchEvent(scroll);
  assert.equal(scroll.defaultPrevented, true);
  window.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: 'a' }));
  assert.equal(wheel.menu.isOpen, true);
  window.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' }));
  assert.equal(wheel.menu.isOpen, false);
  window.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' }));
  const quiet = new Event('wheel', { cancelable: true });
  window.dispatchEvent(quiet);
  assert.equal(quiet.defaultPrevented, false);
  assert.equal(mouse('auxclick', { button: 1, target: surface }).defaultPrevented, true, 'no autoscroll');
  assert.equal(mouse('auxclick', { button: 1, target: new Node('div') }).defaultPrevented, false);
  assert.deepEqual(binds, []);
});

test('a blocked game closes the wheel and low mana greys runes out', async (t) => {
  await page(t, { width: 200, height: 200 });
  let allowed = true;
  const spells = [...SPELLS, ...Array.from({ length: 9 }, (_, i) => ({ id: `x${i}`, name: `Rune ${i}`, element: 'mitlan' }))];
  const { wheel } = controls({ canOpen: () => allowed }, spells);
  wheel.casting.state = () => ({ mana: 5 });
  wheel.openTouch(1);
  assert.ok(wheel.scale < 1, 'a small screen shrinks the wheel');
  wheel.menu.enter(wheel.menu.groups[3]);
  wheel.drawWheel();
  assert.equal(wheel.menu.entries.length, 9);
  assert.ok(wheel.waiting.every(Boolean));
  wheel.update();
  wheel.menu.point(0, -150);
  wheel.paint();
  assert.match(label(wheel), /Rune 0/);
  allowed = false;
  wheel.update();
  assert.equal(wheel.menu.isOpen, false);
});

test('a page without a 2D canvas still opens and binds', async (t) => {
  await page(t, { canvas2d: false });
  const { wheel, binds } = controls();
  assert.equal(wheel.ctx, null);
  assert.equal(wheel.openTouch(1), true);
  wheel.apply(wheel.menu.press(0, -150));
  wheel.apply(wheel.menu.press(0, -150));
  assert.deepEqual(binds, ['fire-shard']);
});

test('a font that measures nothing still lays out the grid, and toggled auras say so', async (t) => {
  await page(t);
  const { wheel } = controls();
  wheel.ctx.zeroWidth = true;
  wheel.openTouch(1);
  assert.equal(wheel.cell.cw, 12 * 0.6);
  assert.deepEqual(wheel.colors, { ink: '--ink-colour', muted: '--muted-colour', quiet: '--quiet-colour' });
  const ward = SPELLS[3];
  assert.ok(wheel.stats(ward).includes('Cast to activate'));
  wheel.casting.hasAura = () => true;
  assert.ok(wheel.stats(ward).includes('Active - cast off'));
  wheel.casting.variant = () => null;
  assert.deepEqual(wheel.stats(ward), ['0 mana', 'Active - cast off']);
  assert.equal(WHEEL.inner, 84);
});

test('on a phone a turn moves a wheel held on CAST to the new centre; others close', async (t) => {
  const { window } = await page(t, { width: 393, height: 852 });
  const { wheel } = controls({ isPhone: () => true });
  wheel.openTouch(1);
  Object.assign(globalThis, { innerWidth: 852, innerHeight: 393 });
  window.dispatchEvent(new Event('resize'));
  assert.equal(wheel.menu.isOpen, true, 'the finger keeps the wheel');
  assert.deepEqual([wheel.cx, wheel.cy], [426, 196.5]);
  assert.equal(wheel.ring.style.left, '426px');
  pointer(window, 'pointerup', { pointerId: 1 });
  assert.equal(wheel.menu.isOpen, false);
  wheel.open(100, 100, true, 'mouse');
  window.dispatchEvent(new Event('resize'));
  assert.equal(wheel.menu.isOpen, false, 'a mouse wheel closes on a phone too');
  const tablet = controls().wheel;
  tablet.openTouch(1);
  window.dispatchEvent(new Event('resize'));
  assert.equal(tablet.menu.isOpen, false, 'tablets close a touch wheel as before');
});
