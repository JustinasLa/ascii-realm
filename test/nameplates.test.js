import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { graphemes } from '../src/character/rules.js';
import { fitName, NAMEPLATES, Nameplates } from '../src/ui/nameplates.js';
import { NAMEPLATE_BACKDROP } from '../src/multiplayer/tint.js';
import { byClass, installDocument } from './helpers/dom.js';

// World cells of 6 by 12 CSS px; the view's corner at (100, 50), 600 by 360
// px of scene.
const projection = {
  project: (x, y) => {
    const px = (x - 100) * 6;
    const py = (y - 50) * 12;
    return { x: px, y: py, visible: px >= 0 && px <= 600 && py >= 0 && py <= 360 };
  },
};

const noInsets = () => ({ left: 0, right: 0 });
// Text measured as letters `px` wide each.
const letters = (px) => (text) => graphemes(text).length * px;

function setup(t) {
  const document = installDocument(t);
  const root = document.createElement('div');
  document.body.append(root);
  return { root, nameplates: new Nameplates({ doc: document, root, insets: noInsets, measureText: letters(40) }) };
}

const ash = { key: 'self', x: 130, row: 60, depth: 64, name: 'Ash', tag: null, colour: [146, 198, 235] };

test('each player\'s name shows centred over their head, a cell tall, in their colour', (t) => {
  const { root, nameplates } = setup(t);
  nameplates.update([ash, { key: 'b2', x: 150, row: 70, name: 'Ash', tag: 2, colour: [255, 85, 85] }], projection);
  assert.equal(nameplates.size, 2);
  assert.equal(root.style.fontSize, '12px', 'letters a cell tall');
  const [own, other] = byClass(root, 'nameplate');
  assert.equal(own.textContent, 'Ash');
  assert.equal(own.style.color, 'rgb(146, 198, 235)');
  assert.equal(own.style.transform, 'translate(180.0px, 126.0px) translate(-50%, -50%)', 'centred on its column and row');
  assert.deepEqual(other.children.map((child) => [child.className, child.textContent]),
    [['nameplate-name', 'Ash'], ['nameplate-tag', ' (2)']], 'the tag in an element of its own after the name');
  assert.equal(other.style.color, 'rgb(255, 85, 85)');
  assert.ok(!own.hidden);
});

test('names follow their players, change only what changed, and leave with them', (t) => {
  const { root, nameplates } = setup(t);
  nameplates.update([ash], projection);
  const [node] = byClass(root, 'nameplate');
  const name = node.children[0];
  let writes = 0;
  const textContent = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(name), 'textContent');
  Object.defineProperty(name, 'textContent', { get: () => textContent.get.call(name),
    set: (value) => { writes++; textContent.set.call(name, value); } });
  nameplates.update([ash], projection);
  assert.equal(writes, 0, 'a name that stays is not written again');
  nameplates.update([{ ...ash, x: 131, name: 'Asha', tag: 3, colour: [255, 170, 0] }], projection);
  assert.equal(byClass(root, 'nameplate')[0], node, 'the same element moves');
  assert.equal(writes, 1);
  assert.equal(node.textContent, 'Asha (3)');
  assert.equal(node.style.color, 'rgb(255, 170, 0)');
  assert.match(node.style.transform, /^translate\(186\.0px, 126\.0px\)/);
  // Off the scene: hidden, and shown again where it comes back.
  nameplates.update([{ ...ash, x: 50 }], projection);
  assert.equal(node.hidden, true);
  nameplates.update([ash], projection);
  assert.equal(node.hidden, false);
  assert.equal(node.textContent, 'Ash');
  nameplates.update([], projection);
  assert.equal(nameplates.size, 0);
  assert.equal(byClass(root, 'nameplate').length, 0);
});

test('letters stand a cell apart, as the scene spaces them, measured once per size', (t) => {
  const document = installDocument(t);
  const root = document.createElement('div');
  document.body.append(root);
  const widths = [];
  const nameplates = new Nameplates({ doc: document, root, insets: noInsets, measureText: letters(6),
    measure: () => { widths.push(root.style.fontSize); return 5.2; } });
  nameplates.update([ash], projection);
  nameplates.update([ash], projection);
  assert.deepEqual(widths, ['12px'], 'measured at the new size, and only then');
  assert.equal(root.style.letterSpacing, '0.80px', 'a 6 px cell less a 5.2 px letter');
  // The page's own probe: a hidden run of letters in the layer, gone after.
  const probing = new Nameplates({ doc: document, root, insets: noInsets });
  assert.equal(probing.probe(), 40, '800 px over twenty letters');
  assert.equal(root.children.filter((child) => child.classList.contains('nameplate-probe')).length, 0);
  probing.update([ash], projection);
  assert.equal(probing.advance, 40);
  assert.equal(root.style.letterSpacing, '0.00px', 'never drawn closer than the font');
});

test('without a projection no name shows, and a zoom resizes every name', (t) => {
  const { root, nameplates } = setup(t);
  nameplates.update([ash], projection);
  nameplates.update([ash], null);
  assert.equal(byClass(root, 'nameplate').length, 0);
  const zoomed = { project: (x, y) => ({ ...projection.project(x, y), y: (y - 50) * 7.3 }) };
  nameplates.update([ash], zoomed);
  assert.equal(root.style.fontSize, '7.5px', 'to the nearest half pixel');
  const flat = { project: (x) => ({ x, y: 0, visible: true }) };
  nameplates.update([ash], flat);
  assert.equal(root.style.fontSize, '1px', 'never smaller than a pixel');
});

test('a name too long for the room is cut short with an ellipsis, never its tag', () => {
  const width = letters(6);
  assert.equal(fitName('Ash', ' (2)', 42, width), 'Ash', 'fits exactly');
  assert.equal(fitName('Ashley', ' (2)', 42, width), 'As\u2026');
  assert.equal(fitName('Ashley', '', 24, width), 'Ash\u2026', 'no tag: all the room for the name');
  assert.equal(fitName('Ashley', ' (12)', 18, width), '\u2026', 'only the ellipsis when no letter fits');
});

test('names are cut by whole letters, never inside an accent or an emoji', () => {
  const width = letters(6);
  const marked = 'Ame\u0301lie';
  assert.equal(fitName(marked, '', 24, width), 'Ame\u0301\u2026', 'the accent stays on its letter');
  const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';
  assert.equal(fitName(`Al${family}xyz`, ' (2)', 48, width), `Al${family}\u2026`);
  // CJK letters twice as wide as Latin ones fit half as many.
  const wide = (text) => [...text].reduce((sum, c) => sum + (/\p{Script=Han}/u.test(c) ? 12 : 6), 0);
  assert.equal(fitName('李小龍李小龍', '', 42, wide), '李小龍\u2026');
});

test('a plate is centred on its measured width, measured once per text and size', (t) => {
  const document = installDocument(t);
  const root = document.createElement('div');
  document.body.append(root);
  const measured = [];
  const wide = (text) => { measured.push(text); return [...text].reduce((sum, c) => sum + (/\p{Script=Han}/u.test(c) ? 12 : 6), 0); };
  const nameplates = new Nameplates({ doc: document, root, insets: noInsets, measure: () => 6, measureText: wide });
  const plate = { ...ash, x: 101, name: '李小龍' };
  nameplates.update([plate], projection);
  const [node] = byClass(root, 'nameplate');
  // 36 px of letters and 6 px of padding, held 4 px inside the left edge.
  assert.match(node.style.transform, /^translate\(25\.0px,/);
  assert.deepEqual(measured, ['李小龍']);
  nameplates.update([plate], projection);
  assert.deepEqual(measured, ['李小龍'], 'from the cache');
  const zoomed = { project: (x, y) => ({ ...projection.project(x, y), y: (y - 50) * 7.3 }) };
  nameplates.update([plate], zoomed);
  assert.deepEqual(measured, ['李小龍', '李小龍'], 'a new font size measures again');
  // The page's own probe: a hidden plate in the layer, padded nothing, gone after.
  const probing = new Nameplates({ doc: document, root, insets: noInsets });
  assert.equal(probing.probeText('Ash'), 800);
  assert.equal(root.children.filter((child) => child.classList.contains('nameplate-text-probe')).length, 0);
  assert.match(css, /^\.nameplate-text-probe \{ visibility: hidden; padding: 0; \}/m);
});

test('every plate is measured before the frame writes any', (t) => {
  const document = installDocument(t);
  const root = document.createElement('div');
  document.body.append(root);
  const log = [];
  const append = root.append.bind(root);
  root.append = (...nodes) => { log.push('write'); append(...nodes); };
  const nameplates = new Nameplates({ doc: document, root, insets: noInsets, measure: () => 6,
    measureText: (text) => { log.push('measure'); return letters(6)(text); } });
  nameplates.update([ash, { ...ash, key: 'b', name: 'Bryn' }], projection);
  assert.deepEqual(log, ['measure', 'measure', 'write', 'write']);
});

// A window whose safe-area insets the test sets, read the way the page reads
// `env(safe-area-inset-*)`: as the padding of a probe in the layer.
function fakeWindow() {
  const listeners = {};
  const win = {
    safe: { left: 0, right: 0 }, reads: 0, resized: null,
    ResizeObserver: class {
      constructor(fn) { this.fn = fn; }
      observe() { win.resized = () => this.fn(); }
    },
    addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); },
    fire: (type) => { for (const fn of listeners[type] ?? []) fn(); },
    getComputedStyle: (node) => {
      assert.ok(node.className === 'nameplate-safe' && node.parentNode, 'read from a probe in the layer');
      win.reads++;
      return { paddingLeft: win.safe.left ? `${win.safe.left}px` : '', paddingRight: `${win.safe.right}px` };
    },
  };
  return win;
}

// A 600 by 360 px layer, its corner where the scene's is, and a clock.
function edgeSetup(t) {
  const document = installDocument(t);
  const root = document.createElement('div');
  document.body.append(root);
  root.rect = { left: 0, top: 0, width: 600, height: 360 };
  root.getBoundingClientRect = () => root.rect;
  const win = fakeWindow();
  let time = 1000;
  const nameplates = new Nameplates({ doc: document, win, root, now: () => time, measure: () => 6, measureText: letters(6) });
  // The plate's left and right edges in CSS px, from its centre and its
  // letters (a cell each) and padding (a quarter of the 12 px font a side).
  const edges = (node) => {
    const centre = Number(node.style.transform.match(/^translate\(([-\d.]+)px/)[1]);
    const half = (node.textContent.length * 6 + 6) / 2;
    return [centre - half, centre + half];
  };
  return { root, win, nameplates, edges, tick: (ms) => { time += ms; } };
}

const twin = (x, extra = {}) => ({ key: 'b2', x, row: 60, depth: 64, name: 'Ash', tag: 2, colour: [255, 85, 85], ...extra });

test('a plate by the screen\'s edge stays whole inside it, tag and all', (t) => {
  const { root, nameplates, edges } = edgeSetup(t);
  const [node] = (nameplates.update([twin(199.5)], projection), byClass(root, 'nameplate'));
  assert.ok(!node.hidden, 'the player still shows, at the far right column');
  assert.equal(node.textContent, 'Ash (2)');
  assert.deepEqual(edges(node), [600 - NAMEPLATES.edge - 48, 600 - NAMEPLATES.edge], 'held in from the right edge');
  nameplates.update([twin(100.2)], projection);
  assert.deepEqual(edges(node), [NAMEPLATES.edge, NAMEPLATES.edge + 48], 'and from the left');
  nameplates.update([twin(150)], projection);
  assert.deepEqual(edges(node), [276, 324], 'centred over the player away from the edges');
  // The vertical place is the row's, wherever the layer stands.
  assert.match(node.style.transform, /^translate\(300\.0px, 126\.0px\)/);
});

test('a notch keeps plates clear of it, on whichever side a turn puts it', (t) => {
  const { root, win, nameplates, edges, tick } = edgeSetup(t);
  win.safe = { left: 44, right: 0 };
  nameplates.update([twin(100.2)], projection);
  const [node] = byClass(root, 'nameplate');
  assert.equal(edges(node)[0], 44 + NAMEPLATES.edge, 'beside the notch on the left');
  assert.equal(root.children.some((child) => child.className === 'nameplate-safe'), false, 'the probe is gone again');
  nameplates.update([twin(199.5)], projection);
  assert.equal(edges(node)[1], 600 - NAMEPLATES.edge, 'the right edge has no notch');
  assert.equal(win.reads, 1, 'the safe area is read once while nothing changes');
  // Turned the other way round: the same size, the notch now on the right.
  win.safe = { left: 0, right: 44 };
  win.fire('orientationchange');
  tick(16);
  nameplates.update([twin(199.5)], projection);
  assert.equal(edges(node)[1], 600 - 44 - NAMEPLATES.edge, 'clear of the notch on the right');
  nameplates.update([twin(100.2)], projection);
  assert.equal(edges(node)[0], NAMEPLATES.edge, 'the left edge is free now');
  tick(NAMEPLATES.settle);
  nameplates.update([twin(100.2)], projection);
  const reads = win.reads;
  nameplates.update([twin(100.2)], projection);
  assert.equal(win.reads, reads, 'settled: read no more');
  // Turned upright: the layer narrows after the resize event has passed.
  win.fire('resize');
  tick(NAMEPLATES.settle * 2);
  root.rect = { left: 0, top: 0, width: 300, height: 600 };
  win.safe = { left: 0, right: 0 };
  win.resized();
  nameplates.update([twin(149.9)], projection);
  assert.equal(edges(node)[1], 300 - NAMEPLATES.edge, 'held inside the narrower screen');
});

test('a plate wider than the screen shortens the name and keeps the tag whole', (t) => {
  const { root, nameplates, edges } = edgeSetup(t);
  root.rect = { left: 0, top: 0, width: 120, height: 360 };
  const long = twin(110, { name: 'Abcdefghijklmnopqrstuvwx' });
  nameplates.update([long], projection);
  const [node] = byClass(root, 'nameplate');
  // (120 - 2 * 4 - 6) / 6 = 17 letters: 12 of the name, the ellipsis, ' (2)'.
  assert.deepEqual(node.children.map((child) => child.textContent), ['Abcdefghijkl\u2026', ' (2)']);
  const [left, right] = edges(node);
  assert.ok(left >= NAMEPLATES.edge && right <= 120 - NAMEPLATES.edge, `${left}-${right} inside`);
  // Given the room again, the name is whole.
  root.rect = { left: 0, top: 0, width: 600, height: 360 };
  nameplates.box = null;
  nameplates.update([long], projection);
  assert.equal(node.textContent, 'Abcdefghijklmnopqrstuvwx (2)');
});

test('without a window nothing listens for turns, and the layer box is still read', (t) => {
  const document = installDocument(t);
  const root = document.createElement('div');
  document.body.append(root);
  const nameplates = new Nameplates({ doc: document, root, insets: noInsets, measure: () => 6, measureText: letters(6) });
  nameplates.update([twin(199.5)], projection);
  assert.equal(nameplates.box.width, 800, 'the layer\'s own width');
  assert.equal(nameplates.settleUntil, -Infinity);
});

test('a nearer player\'s plate stands over a farther one\'s, and swaps as they cross', (t) => {
  const { root, nameplates } = setup(t);
  // Two plates on the same spot: Bryn a row nearer the camera than Ash.
  const bryn = { ...ash, key: 'b2', name: 'Bryn', depth: 65 };
  nameplates.update([bryn, ash], projection);
  const [front, back] = byClass(root, 'nameplate');
  assert.equal(front.textContent, 'Bryn', 'created first');
  assert.deepEqual([front.style.zIndex, back.style.zIndex], ['2', '1'], 'the nearer on top');
  let writes = 0;
  for (const node of [front, back]) {
    let z = node.style.zIndex;
    Object.defineProperty(node.style, 'zIndex', { get: () => z, set: (value) => { writes++; z = value; } });
  }
  nameplates.update([{ ...bryn, depth: 64.5 }, ash], projection);
  assert.equal(writes, 0, 'no write while the order holds');
  // Bryn walks up past Ash: now Ash is the nearer.
  nameplates.update([{ ...bryn, depth: 63 }, ash], projection);
  assert.deepEqual([front.style.zIndex, back.style.zIndex], ['1', '2']);
  assert.equal(writes, 2);
  nameplates.update([{ ...bryn, depth: 62 }, ash], projection);
  assert.equal(writes, 2, 'still crossed: nothing written');
  // A plate off the scene takes no place in the order.
  nameplates.update([{ ...bryn, x: 50 }, ash], projection);
  assert.equal(back.style.zIndex, '1');
  assert.equal(front.hidden, true);
});

// The page's layers, as style.css and index.html set them.
const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const rule = (selector) => css.match(new RegExp(`^${selector.replace(/[.#]/g, '\\$&')} \\{([^}]*)\\}`, 'm'))?.[1] ?? '';

test('a name\'s only backdrop is its own opaque one, over the scene\'s fog and dark edges', () => {
  const plate = rule('.nameplate');
  const layer = rule('#nameplate-root');
  assert.match(plate, /background: rgb\((\d+), (\d+), (\d+)\);/);
  const [, ...rgb] = plate.match(/background: rgb\((\d+), (\d+), (\d+)\);/);
  assert.deepEqual(rgb.map(Number), NAMEPLATE_BACKDROP, 'the backdrop the contrast check uses');
  for (const style of [plate, layer]) assert.doesNotMatch(style, /opacity|filter|mix-blend|rgba/, 'nothing fades a name');
  assert.doesNotMatch(css, /[^-]nameplate[^{]*\{[^}]*opacity/, 'no rule dims nameplates');
  // The layer stands over the canvas, which draws the fog and the edges,
  // and under the bubbles and the HUD.
  const z = (style) => Number(style.match(/z-index: (\d+)/)[1]);
  assert.equal(z(layer), 8);
  assert.ok(z(layer) < z(rule('#bubble-root')) && z(layer) < z(rule('#hud-root')));
  assert.ok(html.indexOf('id="screen"') < html.indexOf('id="nameplate-root"'));
  assert.ok(html.indexOf('id="nameplate-root"') < html.indexOf('id="bubble-root"'));
  // The safe-area probe is padded by the screen's side insets.
  assert.match(rule('.nameplate-safe'), /padding: 0 env\(safe-area-inset-right, 0px\) 0 env\(safe-area-inset-left, 0px\);/);
});
