import assert from 'node:assert/strict';
import test from 'node:test';
import { ITEMS } from '../src/inventory/items.js';
import { family, glyph, GLYPH_MASK, LAYER, over } from '../src/render/glyphs.js';
import { drawItem, drawResource } from '../src/world/item-draw.js';
import { reflector } from '../src/world/reflection.js';
import { GRASS, WATER } from '../src/world/world.js';
import { withLayers } from './helpers/renderer.js';

const id = Object.keys(ITEMS)[0];
const item = { uid: 'test-item', id, count: 1, x: 4.5, y: 4.5, phase: 0 };
const view = { x0: -8, y0: -8, cols: 24, rows: 24 };
// Ripe fruit is a berry cluster layered over a leaf in a berry colour.
const BERRIES = new Set(family('props.berry.').map(over));
const ripeFruit = args => BERRIES.has(args[3]) && args[4] > args[5] * 2 && args[6] > args[5];
const FORKS = new Set(family('props.fork.'));

function buffer(type = GRASS) {
  const r = { cols: 24, rows: 24,
    fg: new Uint8ClampedArray(24 * 24 * 4),
    bg: new Uint8ClampedArray(24 * 24 * 4),
    mask: new Uint8Array(24 * 24).fill(type) };
  r.put = (x, y, g, red, green, blue) => {
    assert.ok([x, y, g, red, green, blue].every(Number.isFinite));
    if (x < 0 || y < 0 || x >= r.cols || y >= r.rows) return;
    r.fg.set([red, green, blue, g], (y * r.cols + x) * 4);
  };
  r.putBg = (x, y, red, green, blue) => {
    if (x < 0 || y < 0 || x >= r.cols || y >= r.rows) return;
    r.bg.set([red, green, blue, 0], (y * r.cols + x) * 4);
  };
  return withLayers(r);
}

test('loose items are drawn as a body with a layered detail, or their registry glyph', () => {
  const sword = [];
  drawItem(buffer(), view, { ...item, id: 'shortSword' }, 0, (...args) => sword.push(args));
  assert.equal(sword.length, 2);
  assert.equal(sword[0][3] & LAYER, 0, 'the blade is the base glyph');
  assert.ok(sword[1][3] & LAYER, 'the hilt is layered over it');
  assert.equal(sword[1][1], sword[0][1]);
  assert.equal(sword[1][2], sword[0][2]);
  assert.ok(sword[1][4] > sword[1][6], 'the hilt is warm wood against cool steel');
  const plain = [];
  drawItem(buffer(), view, { ...item, id: 'outlawHood' }, 0, (...args) => plain.push(args));
  assert.equal(plain.length, 1);
  assert.equal(plain[0][3], glyph(ITEMS.outlawHood.groundGlyph));
  // Every item with a picture uses valid glyphs.
  for (const key of Object.keys(ITEMS)) {
    const writes = [];
    drawItem(buffer(), view, { ...item, id: key }, 0, (...args) => writes.push(args));
    assert.ok(writes.length >= 1 && writes.every(args => (args[3] & GLYPH_MASK) > 0), key);
  }
});

test('loose items keep a fixed mirror base while bobbing', () => {
  const writes = [];
  const capture = (...args) => writes.push(args);
  drawItem(buffer(), view, item, 0, capture);
  const first = writes[0];
  assert.equal(first[1], 12);
  assert.equal(first[7], 12);
  assert.ok(first[2] < first[7]);
  writes.length = 0;
  drawItem(buffer(), view, item, Math.PI * 0.75, capture);
  assert.equal(writes[0][7], first[7]);
  assert.notEqual(writes[0][2], first[2]);
});

test('item glints animate colour and go through the same writer as their body', () => {
  const early = [];
  const peak = [];
  drawItem(buffer(), view, item, 0, (...args) => early.push(args));
  drawItem(buffer(), view, item, Math.PI / 5.4, (...args) => peak.push(args));
  assert.notDeepEqual(early[0].slice(4, 7), peak[0].slice(4, 7));
  assert.equal(peak.length, early.length + 1);
  assert.equal(peak.at(-1)[3], glyph('+'));
  assert.equal(peak.at(-1)[7], peak[0][7]);
});

test('item reflection is dimmed and confined to water', () => {
  const dry = buffer();
  const wet = buffer(WATER);
  drawItem(dry, view, item, 0, reflector(0, view));
  drawItem(wet, view, item, 0, reflector(0, view));
  assert.equal(dry.fg.some(value => value !== 0), false);
  assert.ok(wet.fg.some(value => value !== 0));
  const cells = [];
  drawItem(buffer(), view, item, 0, (...args) => cells.push(args));
  const base = cells[0][7];
  const expectedRow = 2 * base - cells[0][2] + 1;
  assert.ok(wet.fg.slice(expectedRow * wet.cols * 4, (expectedRow + 1) * wet.cols * 4)
    .some(value => value !== 0));
  const reflectedColour = [...wet.fg].filter((value, index) => index % 4 < 3 && value > 0);
  assert.ok(Math.max(...reflectedColour) < Math.max(...cells[0].slice(4, 7)));
  assert.equal(wet.fg.slice(0, (base + 1) * wet.cols * 4).some(value => value !== 0), false);
});

test('offscreen item sources can still reflect into the visible water', () => {
  const reflectedView = { ...view, x0: 0, y0: 0 };
  const writes = [];
  const above = { ...item, x: 8.5, y: -0.1 };
  drawItem(buffer(), reflectedView, above, Math.PI / 5.4, (...args) => writes.push(args));
  assert.ok(writes.length > 0);
  assert.ok(writes.every(args => args[2] < 0));
  assert.ok(writes.some(args => 2 * args[7] - args[2] + 1 >= 0));
  const wet = buffer(WATER);
  drawItem(wet, reflectedView, above, Math.PI / 5.4, reflector(Math.PI / 5.4, reflectedView));
  assert.ok(wet.fg.some(value => value !== 0));
  const ordinary = buffer();
  drawItem(ordinary, reflectedView, above, Math.PI / 5.4);
  assert.equal(ordinary.fg.some(value => value !== 0), false);
});

test('resource nodes render harvestable tufts and berries, then visible depleted forms', () => {
  for (const kind of ['grass', 'bush']) {
    const node = { uid: 'test-resource', kind, x: -2.5, y: -1.5, harvested: false, phase: 0 };
    const whole = [];
    const harvested = [];
    drawResource(buffer(), view, node, 0, (...args) => whole.push(args));
    drawResource(buffer(), view, { ...node, harvested: true }, 0, (...args) => harvested.push(args));
    assert.ok(whole.length > 3);
    assert.ok(whole.every(args => args[7] === 6));
    assert.ok(whole.some(args => args[2] < 6));
    assert.ok(harvested.length > 0);
    assert.notDeepEqual(whole.map(args => args.slice(1)), harvested.map(args => args.slice(1)));
    if (kind === 'grass') assert.ok(harvested.every(args => args[2] === args[7]));
    if (kind === 'bush') {
      assert.ok(whole.some(ripeFruit));
      assert.equal(harvested.some(ripeFruit), false);
      assert.deepEqual(whole.filter(args => !ripeFruit(args)).map(args => args.slice(1)),
        harvested.map(args => args.slice(1)),
        'picking removes the fruit while preserving every leaf, branch and root');
    }
  }
});

test('berry bushes show their harvest count as distinct ripe fruit clusters', () => {
  const node = { uid: 'berry-bush', kind: 'bush', x: 4.5, y: 10.5, phase: 0 };
  for (const count of [4, 5, 6, 7]) {
    const writes = [];
    drawResource(buffer(), view, { ...node, berryCount: count }, 0, (...args) => writes.push(args));
    const berries = writes.filter(ripeFruit);
    assert.equal(berries.length, count);
    assert.equal(new Set(berries.map(args => `${args[1]},${args[2]}`)).size, count);
    assert.ok(writes.every(args => args[7] === 18));
  }
});

test('legacy and invalid berry counts retain the two-cluster harvest fallback', () => {
  const node = { uid: 'legacy-bush', kind: 'bush', x: 4.5, y: 10.5, phase: 0 };
  for (const count of [undefined, null, 0, -1, 2, 3, 8, 100, 4.5, NaN, Infinity, '5']) {
    const writes = [];
    drawResource(buffer(), view, { ...node, berryCount: count }, 0, (...args) => writes.push(args));
    assert.equal(writes.filter(ripeFruit).length, 2);
  }
});

test('layered berry bushes have visible woody forks and sway above planted roots', () => {
  const node = { uid: 'shrub', kind: 'bush', x: 4.5, y: 10.5, phase: 0, berryCount: 7 };
  const still = [];
  const wind = [];
  const varied = [];
  drawResource(buffer(), view, node, 0, (...args) => still.push(args));
  drawResource(buffer(), view, node, 1.3, (...args) => wind.push(args));
  drawResource(buffer(), view, { ...node, phase: 1 }, 0, (...args) => varied.push(args));
  const xs = still.map(args => args[1]);
  const ys = still.map(args => args[2]);
  assert.ok(Math.max(...xs) - Math.min(...xs) + 1 <= 13);
  assert.ok(Math.max(...ys) - Math.min(...ys) + 1 <= 9);
  assert.ok(still.some(args => FORKS.has(args[3]) && args[4] > args[5] && args[6] < args[5]), 'woody forks show');
  assert.ok(still.some(args => FORKS.has(args[3]) && args[2] < args[7] - 2), 'forks inside the crown');
  assert.ok(still.some(args => args[5] > args[4] * 1.5), 'the canopy stays green');
  assert.deepEqual(still.filter(args => args[2] === args[7]).map(args => args.slice(1)),
    wind.filter(args => args[2] === args[7]).map(args => args.slice(1)));
  const stillTop = still.filter(args => args[2] <= args[7] - 6);
  const movingTop = wind.filter(args => args[2] <= args[7] - 6);
  assert.ok(stillTop.length > 0);
  assert.deepEqual(stillTop.map(args => args[1] + 1), movingTop.map(args => args[1]));
  assert.notDeepEqual(still.map(args => args.slice(1, 4)), varied.map(args => args.slice(1, 4)),
    'each bush has its own shape');
  assert.ok(wind.every(args => args[7] === 18));
});

test('large bushes remain visible when only their high leaves enter the viewport', () => {
  const edgeView = { ...view, x0: 0, y0: 0 };
  const below = { uid: 'below', kind: 'bush', x: 11.5, y: 31.5, phase: 0, berryCount: 7 };
  const r = buffer();
  drawResource(r, edgeView, below, 0);
  const lastRow = r.fg.slice(23 * r.cols * 4);
  assert.ok(lastRow.some(value => value > 0));
  assert.equal(r.fg.slice(0, 23 * r.cols * 4).some(value => value > 0), false);

  const outside = buffer();
  drawResource(outside, edgeView, { ...below, y: 32.5 }, 0);
  assert.equal(outside.fg.some(value => value > 0), false);

  const right = buffer();
  drawResource(right, edgeView, { ...below, x: 29.5, y: 10.5 }, 0);
  assert.ok(right.fg.some(value => value > 0), 'the broad canopy reaches six columns from the base');
  const pastRight = buffer();
  drawResource(pastRight, edgeView, { ...below, x: 30.5, y: 10.5 }, 0);
  assert.equal(pastRight.fg.some(value => value > 0), false);
});

test('large bushes above the viewport still cast water-only reflections into it', () => {
  const edgeView = { ...view, x0: 0, y0: 0 };
  const above = { uid: 'above', kind: 'bush', x: 11.5, y: -6.5, phase: 0, berryCount: 7 };
  const wet = buffer(WATER);
  const dry = buffer();
  const source = buffer();
  drawResource(wet, edgeView, above, 0, reflector(0, edgeView));
  drawResource(dry, edgeView, above, 0, reflector(0, edgeView));
  drawResource(source, edgeView, above, 0);
  assert.ok(wet.fg.some(value => value > 0));
  assert.equal(dry.fg.some(value => value > 0), false);
  assert.equal(source.fg.some(value => value > 0), false);
  assert.equal(wet.fg.slice(3 * wet.cols * 4).some(value => value > 0), false,
    'the upper leaves reflect no farther than nine rows below the fixed base');

  const beyond = buffer(WATER);
  drawResource(beyond, edgeView, { ...above, y: -10.5 }, 0, reflector(0, edgeView));
  assert.equal(beyond.fg.some(value => value > 0), false);
});

test('resource reflections use the fixed ground base and water mask', () => {
  for (const kind of ['grass', 'bush']) {
    const node = { uid: 'node', kind, x: 3.5, y: 3.5, phase: 0 };
    const wet = buffer(WATER);
    const dry = buffer();
    drawResource(wet, view, node, 0, reflector(0, view));
    drawResource(dry, view, node, 0, reflector(0, view));
    assert.ok(wet.fg.some(value => value !== 0));
    assert.equal(dry.fg.some(value => value !== 0), false);
  }
});

test('distant and invalid entities produce no writes', () => {
  const r = buffer();
  const writes = [];
  const capture = (...args) => writes.push(args);
  drawItem(r, view, { ...item, x: 1000 }, 1, capture);
  drawItem(r, view, { ...item, y: -1000 }, 1, capture);
  for (const invalidId of ['unknown', '__proto__', 'constructor', 'toString']) {
    drawItem(r, view, { ...item, id: invalidId }, 1, capture);
  }
  drawItem(r, view, { ...item, count: 0 }, 1, capture);
  drawResource(r, view, { kind: 'grass', x: 1000, y: 0 }, 1, capture);
  drawResource(r, view, { kind: 'grass', x: 0, y: -1000 }, 1, capture);
  assert.equal(writes.length, 0);
});
