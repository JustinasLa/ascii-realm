import assert from 'node:assert/strict';
import test from 'node:test';
import { ITEMS } from '../src/inventory/items.js';
import { glyph } from '../src/render/glyphs.js';
import { drawItem, drawResource } from '../src/world/item-draw.js';
import { reflector } from '../src/world/reflection.js';
import { GRASS, WATER } from '../src/world/world.js';

const id = Object.keys(ITEMS)[0];
const item = { uid: 'test-item', id, count: 1, x: 4.5, y: 4.5, phase: 0 };
const view = { x0: -8, y0: -8, cols: 24, rows: 24 };

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
  return r;
}

test('loose items use their registry glyph and keep a fixed mirror base while bobbing', () => {
  const writes = [];
  const capture = (...args) => writes.push(args);
  drawItem(buffer(), view, item, 0, capture);
  const first = writes[0];
  const def = ITEMS[id];
  assert.equal(first[3], typeof def.groundGlyph === 'number' ? def.groundGlyph : glyph(def.groundGlyph));
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
  assert.equal(peak.length, 2);
  assert.equal(peak[1][3], glyph('+'));
  assert.equal(peak[1][7], peak[0][7]);
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
      assert.ok(whole.some(args => args[4] > args[5]));
      assert.ok(harvested.every(args => args[5] > args[4]));
    }
  }
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
