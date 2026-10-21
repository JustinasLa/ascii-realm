import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { GLYPH_COUNT, GLYPH_MASK, LAYER } from '../src/render/glyphs.js';
import { PROP_CATALOG } from '../src/world/prop-catalog.js';
import { blocks, createProp, drawProp, generateProps } from '../src/world/props.js';

const kinds = PROP_CATALOG.map(({ kind }) => kind);
const glyphCount = GLYPH_COUNT;

test('builder props are deterministic, varied by seed, and stable when moved', () => {
  for (const kind of kinds) {
    const prop = createProp(kind, 8.5, -3.25, { seed: 42 });
    assert.deepEqual(createProp(kind, 8.5, -3.25, { seed: 42 }), prop);
    assert.notDeepEqual(createProp(kind, 8.5, -3.25, { seed: 43 }).cells, prop.cells);
    assert.deepEqual(createProp(kind, -200, 300, { seed: 42 }).cells, prop.cells);
    assert.equal(prop.kind, kind);
    assert.equal(prop.x, 8.5);
    assert.equal(prop.y, -3.25);
    assert.equal(prop.scale, 1);
    assert.equal(prop.seed, 42);
    assert.equal(prop.solid, PROP_CATALOG.find((definition) => definition.kind === kind).solid);
    assert.ok(prop.cells.length > 0);
    assert.ok(Number.isFinite(prop.footW) && prop.footW > 0);
    assert.ok(Number.isFinite(prop.footH) && prop.footH > 0);
  }
});

test('scaling changes silhouettes and collision footprints without duplicate cells', () => {
  for (const kind of kinds) {
    const original = createProp(kind, 10, 20, { seed: 8 });
    for (const scale of [0.25, 0.5, 0.75, 1, 1.5, 2, 3]) {
      const prop = createProp(kind, 10, 20, { seed: 8, scale });
      assert.equal(prop.scale, scale);
      assert.equal(prop.footW, original.footW * scale);
      assert.equal(prop.footH, original.footH * scale);
      assert.equal(blocks(prop, 10, 20), prop.solid);
      assert.equal(blocks(prop, 10 + prop.footW * 0.9, 20), prop.solid);
      assert.equal(blocks(prop, 10, 20 + prop.footH * 0.9), prop.solid);
      assert.ok(!blocks(prop, 10 + prop.footW * 1.1, 20));
      assert.ok(!blocks(prop, 10, 20 + prop.footH * 1.1));
      // One base cell per spot; layered cells stack over the base before them.
      const bases = prop.cells.filter(({ g }) => !(g & LAYER));
      const positions = new Set(bases.map(({ dx, dy }) => `${dx},${dy}`));
      assert.equal(positions.size, bases.length);
      prop.cells.forEach((cell, i) => {
        if (!(cell.g & LAYER) || i === 0) return;
        const before = prop.cells[i - 1];
        if (before.dx === cell.dx && before.dy === cell.dy) assert.equal(before.g & LAYER, 0);
      });
      assert.ok(prop.cells.length > 0 && prop.cells.length < 12000);
      const top = Math.min(...prop.cells.map(({ dy }) => dy));
      const originalTop = Math.min(...original.cells.map(({ dy }) => dy));
      // Props are re-drawn at their new size, so thin tips can gain a row or two.
      assert.ok(Math.abs(top - originalTop * scale) <= Math.max(3, Math.abs(originalTop * scale) * 0.1),
        `${kind} at scale ${scale}`);
      for (const cell of prop.cells) {
        assert.ok(Number.isInteger(cell.dx) && Number.isInteger(cell.dy));
        const g = cell.g & GLYPH_MASK;
        assert.ok(Number.isInteger(cell.g) && g > 0 && g < glyphCount, `${kind} contains an atlas glyph`);
        assert.ok([cell.r, cell.gg, cell.b].every(Number.isFinite));
      }
    }
    const small = createProp(kind, 10, 20, { seed: 8, scale: 0.5 });
    const large = createProp(kind, 10, 20, { seed: 8, scale: 2 });
    assert.ok(small.cells.length < original.cells.length);
    assert.ok(large.cells.length > original.cells.length);
  }
});

test('builder props can be drawn by the existing renderer without an adapter', () => {
  for (const kind of kinds) {
    const prop = createProp(kind, 12.75, -4.5, { scale: 1.5, seed: 6 });
    const writes = [];
    const renderer = {};
    drawProp(renderer, { x0: 4, y0: -10 }, prop, (...args) => writes.push(args));
    assert.equal(writes.length, prop.cells.length);
    for (let i = 0; i < writes.length; i++) {
      const cell = prop.cells[i];
      assert.deepEqual(writes[i], [renderer, 8 + cell.dx, 5 + cell.dy, cell.g, cell.r, cell.gg, cell.b, 5,
        cell.br, cell.bgG, cell.bb]);
    }
  }
});

test('rejects invalid kinds, coordinates, options, scales and seeds before baking', () => {
  for (const kind of ['flower', '', null, 1]) assert.throws(() => createProp(kind, 0, 0), TypeError);
  for (const value of [NaN, Infinity, -Infinity, '1', null, undefined]) {
    assert.throws(() => createProp('tree', value, 0), TypeError);
    assert.throws(() => createProp('tree', 0, value), TypeError);
  }
  for (const value of [null, [], 1, 'options']) assert.throws(() => createProp('tree', 0, 0, value), TypeError);
  for (const scale of [0, -1, 0.249, 3.001, Number.MAX_VALUE, NaN, Infinity, '1', null]) {
    assert.throws(() => createProp('tree', 0, 0, { scale }), RangeError);
  }
  for (const seed of [NaN, Infinity, -Infinity, '1', null]) {
    assert.throws(() => createProp('tree', 0, 0, { seed }), TypeError);
  }
});

test('factory calls return independent cells and accept finite fractional seeds', () => {
  for (const kind of kinds) {
    const prop = createProp(kind, 0, 0, { seed: -8.5 });
    const other = createProp(kind, 0, 0, { seed: -8.5 });
    prop.cells[0].dx = 999;
    assert.notEqual(other.cells[0].dx, 999);
    assert.equal(other.seed, -8.5);
  }
});

test('adding builder props preserves existing procedural tree and rock generation', () => {
  const world = { seed: 7, spawn: { x: -1000, y: -1000 }, typeAt: () => 2 };
  const props = generateProps(world, -13, -4, 64);
  assert.equal(props.length, 2);
  assert.ok(props.every(({ kind }) => kind === 'tree' || kind === 'rock'), 'the wild holds only trees and rocks');
  assert.ok(props.some(({ kind }) => kind === 'tree'));
  assert.ok(props.some(({ kind, footW }) => kind === 'rock' && footW > 15), 'a big rock stands in this chunk');
  // Culling bounds and the drawn cells are derived art; where and what the
  // generated props are (their placement and random stream) must not change.
  const digest = createHash('sha256').update(JSON.stringify(props.map(({ kind, x, y, footW, footH, species, condition }) =>
    ({ kind, x, y, footW, footH, species, condition })))).digest('hex');
  assert.equal(digest, '918691d6a90f33711a5daf51b12094714932069651b46b61658b65801498985b');
});
