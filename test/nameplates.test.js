import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Nameplates } from '../src/ui/nameplates.js';
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

function setup(t) {
  const document = installDocument(t);
  const root = document.createElement('div');
  document.body.append(root);
  return { root, nameplates: new Nameplates({ doc: document, root }) };
}

const ash = { key: 'self', x: 130, row: 60, name: 'Ash', tag: null, colour: [146, 198, 235] };

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
  const nameplates = new Nameplates({ doc: document, root, measure: () => { widths.push(root.style.fontSize); return 5.2; } });
  nameplates.update([ash], projection);
  nameplates.update([ash], projection);
  assert.deepEqual(widths, ['12px'], 'measured at the new size, and only then');
  assert.equal(root.style.letterSpacing, '0.80px', 'a 6 px cell less a 5.2 px letter');
  // The page's own probe: a hidden run of letters in the layer, gone after.
  const probing = new Nameplates({ doc: document, root });
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
});
