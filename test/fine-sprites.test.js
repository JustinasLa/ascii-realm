import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mulberry32 } from '../src/core/rng.js';
import { FINE } from '../src/render/cells.js';
import { glyph, LAYER, over } from '../src/render/glyphs.js';
import { AsciiRenderer } from '../src/render/renderer.js';
import { fineRecipe, fineSource } from '../src/world/prop-art.js';
import { bakeFine, fineOf, packFine } from '../src/world/fine-bakes.js';
import { createProp, drawProp, generateProps, rebuildProp } from '../src/world/props.js';
import { makeTree } from '../src/world/trees.js';
import { World } from '../src/world/world.js';

// Trees and rocks are drawn in small letters, FINE to a cell, on a fine
// grid of their own with a dark backdrop, so they stand out from the grass.

const SET = 16;
const SOLID = 32;
const UNDER = 64;
const OVER = 128;

function renderer(cols = 8, rows = 6) {
  const r = Object.create(AsciiRenderer.prototype);
  r.allocate(cols, rows);
  return r;
}

const flagsAt = (r, fx, fy) => r.fineBg[(fy * r.fineCols + fx) * 4 + 3];
const finish = (steps) => {
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
};

test('a small cell keeps its glyph and backdrop and marks the cell it lies in', () => {
  const r = renderer();
  r.fineAt(5, 3, glyph('@'), 200, 180, 160, 10, 12, 20);
  assert.equal(r.fine[(3 * r.fineCols + 5) * 4 + 3], glyph('@'));
  assert.equal(flagsAt(r, 5, 3), SET | SOLID);
  assert.equal(r.fineMark[1 * r.cols + 2], 1);
  // A glyph without a backdrop laid over a solid small cell keeps it solid.
  r.fineAt(5, 3, glyph('.'), 90, 90, 90);
  assert.equal(flagsAt(r, 5, 3), SET | SOLID);
  r.fineAt(4, 3, glyph('.'), 90, 90, 90);
  assert.equal(flagsAt(r, 4, 3), SET);
  // Off the grid nothing is written.
  const marked = r.fineMark.reduce((a, b) => a + b, 0);
  r.fineAt(-1, 0, glyph('@'), 1, 1, 1);
  r.fineAt(r.fineCols, 0, glyph('@'), 1, 1, 1);
  assert.equal(r.fineMark.reduce((a, b) => a + b, 0), marked);
});

test('later cells stand in front of a sprite, layered effects over it, solid ones hide it', () => {
  const r = renderer();
  const cell = 1 * r.cols + 2;
  for (let j = 0; j < FINE; j++) for (let i = 0; i < FINE; i++) r.fineAt(4 + i, 2 + j, glyph('#'), 9, 9, 9, 1, 1, 1);
  // A firefly layered over the cell shows over the sprite's letters.
  r.layer(2, 1, over(glyph('*')), 255, 255, 120);
  assert.equal(flagsAt(r, 4, 2), SET | SOLID | UNDER | OVER);
  // The walker drawn after it replaces them, over the dark backdrop.
  r.put(2, 1, glyph('W'), 200, 150, 100);
  for (let j = 0; j < FINE; j++) for (let i = 0; i < FINE; i++) assert.equal(flagsAt(r, 4 + i, 2 + j), SET | SOLID | UNDER);
  // A small cell drawn afterwards, by a sprite in front, is in front again.
  r.fineAt(5, 3, glyph('%'), 9, 9, 9, 1, 1, 1);
  assert.equal(flagsAt(r, 5, 3), SET | SOLID);
  // A solid cell (a background) hides the sprite there altogether.
  r.putBg(2, 1, 8, 10, 14);
  for (let j = 0; j < FINE; j++) for (let i = 0; i < FINE; i++) assert.equal(flagsAt(r, 4 + i, 2 + j), 0);
  assert.equal(r.fineMark[cell], 0);
});

test('the fine grid is emptied with the ground every frame', () => {
  const r = renderer();
  r.fineAt(1, 1, glyph('@'), 1, 2, 3, 4, 5, 6);
  r.clearFine();
  assert.ok(r.fineBg.every((v, i) => i % 4 !== 3 || v === 0));
  assert.ok(r.fineMark.every((v) => v === 0));
});

test('lighting passes reach a sprite\'s small cells and its backdrop', () => {
  const r = renderer();
  r.fineAt(4, 2, glyph('#'), 100, 100, 100, 10, 10, 10);
  r.lightFine(1 * r.cols + 2, 50, 20, 0, 0.2);
  const at = (2 * r.fineCols + 4) * 4;
  assert.deepEqual([...r.fine.subarray(at, at + 3)], [150, 120, 100]);
  assert.deepEqual([...r.fineBg.subarray(at, at + 3)], [20, 14, 10]);
  // Empty small cells are left alone.
  const empty = (2 * r.fineCols + 5) * 4;
  assert.deepEqual([...r.fine.subarray(empty, empty + 3)], [0, 0, 0]);
});

test('a tree\'s fine bake is the same tree at twice the detail', () => {
  for (const species of ['oak', 'pine', 'willow']) {
    const prop = makeTree(100.5, 300.5, mulberry32(9), { species, seed: 42 });
    const fine = finish(fineRecipe(prop)());
    const body = (cells, k) => {
      const out = { minX: Infinity, maxX: -Infinity, minY: Infinity };
      for (const c of cells) {
        if (c.litter) continue;
        out.minX = Math.min(out.minX, c.dx / k);
        out.maxX = Math.max(out.maxX, c.dx / k);
        out.minY = Math.min(out.minY, c.dy / k);
      }
      return out;
    };
    const coarse = body(prop.cells, 1);
    const small = body(fine, FINE);
    for (const side of ['minX', 'maxX', 'minY']) {
      assert.ok(Math.abs(coarse[side] - small[side]) <= 1.5, `${species} ${side}: ${coarse[side]} vs ${small[side]}`);
    }
    assert.ok(fine.length > prop.cells.length * 2.5, `${species} has more, smaller cells`);
    assert.ok(fine.every((c) => c.g < LAYER || c.litter === false));
    // Solid small cells carry the backdrop that gives the sprite its edge.
    assert.ok(fine.filter((c) => c.br !== undefined).length > fine.length * 0.5);
    // The recipe is deterministic and stays off the prop itself.
    assert.deepEqual(finish(fineRecipe(prop)()), fine);
    assert.equal(Object.values(prop).some((v) => typeof v === 'function'), false);
    structuredClone(prop);
  }
});

test('rocks and builder props bake fine too; shading variations carry over', () => {
  const world = new World(7);
  let rock = null;
  for (let c = 0; c < 40 && !rock; c++) rock = generateProps(world, c, 3, 128).find((p) => p.kind === 'rock');
  assert.ok(rock, 'a generated rock');
  const fine = finish(fineRecipe(rock)());
  assert.ok(fine.length > rock.cells.length * 2);
  const placed = createProp('rock', 10.5, 20.5, { seed: 5, scale: 1.4 });
  const plain = createProp('rock', 10.5, 20.5, { seed: 5, scale: 1.4, variant: 0 });
  assert.ok(finish(fineRecipe(placed)()).length > placed.cells.length * 2);
  assert.ok(fineRecipe(plain));
  structuredClone(placed);
});

test('a prop is drawn in ordinary cells until its fine bake is done', () => {
  const prop = makeTree(20.5, 60.5, mulberry32(4), { species: 'birch', seed: 42 });
  const view = { x0: 0, y0: 0, cols: 60, rows: 70 };
  const r = renderer(view.cols, view.rows);
  r.put = AsciiRenderer.prototype.put;
  assert.equal(fineOf(prop), null);
  drawProp(r, view, prop, undefined, 0, null, 42);
  assert.equal(r.fineUsed, false, 'drawn coarse while the bake is queued');
  bakeFine();
  const baked = fineOf(prop);
  assert.ok(baked);
  r.clearFine();
  r.fg.fill(0);
  drawProp(r, view, prop, undefined, 0, null, 42);
  assert.equal(r.fineUsed, true);
  // The leaf litter in front of the trunk still lies on the ordinary grid.
  assert.ok(baked.ground.length > 0 && baked.ground.every((c) => c.g >= LAYER && c.dy >= -1));
  let litter = 0;
  for (const c of baked.ground) {
    const at = ((60 + c.dy) * view.cols + 20 + c.dx) * 4 + 3;
    if (r.fg[at] || r.bg[at]) litter++;
  }
  assert.ok(litter > 0);
  // Reflections and other writers still get the ordinary cells.
  const seen = [];
  drawProp(r, view, prop, (_r, ...cell) => seen.push(cell), 0, null, 42, true);
  assert.ok(seen.length > 0);
});

test('a time budget spreads a tree\'s fine bake over several calls', () => {
  const prop = makeTree(40.5, 90.5, mulberry32(8), { species: 'oak', seed: 42 });
  fineOf(prop);
  let calls = 0;
  while (!fineOf(prop) && calls < 10000) {
    bakeFine(0);
    calls++;
  }
  assert.ok(calls > 10, `took ${calls} steps`);
  assert.ok(fineOf(prop).cells.n > prop.cells.length);
});

test('a worker rebuilds the same prop from its source and bakes it the same', () => {
  const world = new World(3);
  const found = {};
  for (let c = 0; c < 200 && !(found.tree && found.rock); c++) {
    for (const p of generateProps(world, c % 20, Math.floor(c / 20) - 5, 128)) found[p.kind] ??= p;
  }
  const props = [found.tree, found.rock, createProp('rock', 4.5, 9.5, { seed: 11, scale: 0.8 })];
  const kinds = new Set();
  for (const prop of props) {
    const source = fineSource(prop);
    assert.ok(source, `${prop.kind} has a source`);
    // The source is plain data a worker can be sent.
    assert.deepEqual(structuredClone(source), source);
    const again = rebuildProp(structuredClone(source), true);
    assert.deepEqual(packFine(finish(fineRecipe(again)())), packFine(finish(fineRecipe(prop)())), prop.kind);
    kinds.add(prop.kind);
  }
  assert.ok(kinds.has('tree') && kinds.has('rock'));
});

test('packed cells keep painter order within each row and the rows in order', () => {
  const cells = [
    { dx: 0, dy: -1, g: glyph('#'), r: 1, gg: 2, b: 3, br: 4, bgG: 5, bb: 6 },
    { dx: 0, dy: -2, g: glyph('o'), r: 1, gg: 2, b: 3 },
    { dx: 0, dy: -1, g: over(glyph('.')), r: 9, gg: 9, b: 9 },
  ];
  const p = packFine(cells);
  assert.deepEqual([...p.dy], [-2, -1, -1]);
  assert.deepEqual([...p.g], [glyph('o'), glyph('#'), over(glyph('.'))]);
  assert.deepEqual([...p.solid], [0, 1, 0]);
  assert.deepEqual([...p.rows], [0, 1, -2, 0, 0, 1, 3, -1, 0, 0]);
});

test('fine trunks and roots are outlined like trees in ordinary cells', () => {
  const prop = makeTree(100.5, 300.5, mulberry32(9), { species: 'oak', seed: 42, girth: 1.6 });
  const fine = finish(fineRecipe(prop)());
  const edges = new Set([...'()[]/\\|'].map(glyph));
  let rows = 0;
  let outlined = 0;
  for (let dy = -30; dy <= -6; dy++) {
    const row = fine.filter((c) => c.dy === dy && !c.foliage && c.g < LAYER).sort((a, b) => a.dx - b.dx);
    if (row.length < 6) continue;
    rows++;
    if (edges.has(row[0].g) && edges.has(row[row.length - 1].g)) outlined++;
  }
  assert.ok(rows > 10 && outlined >= rows * 0.9, `${outlined} of ${rows} trunk rows have both edges outlined`);
  // The foot spreads into roots in front of the base, outlined where they
  // slope and wider than the trunk above it.
  const below = fine.filter((c) => c.dy > 0 && !c.foliage && !c.litter);
  assert.ok(below.some((c) => c.g === glyph('/') || c.g === glyph('\\')));
  const span = (cells) => Math.max(...cells.map((c) => c.dx)) - Math.min(...cells.map((c) => c.dx));
  const trunk = fine.filter((c) => c.dy === -24 && !c.foliage && c.g < LAYER);
  assert.ok(span(below) > span(trunk) * 1.6, 'the roots spread wider than the trunk');
});

test('a solid sprite is ringed by an outline of nothing that later cells cover', () => {
  const r = renderer(10, 8);
  r.fineAt(9, 7, glyph('#'), 9, 9, 9, 1, 1, 1);
  // The empty small cells up to two away are marked as its outline.
  for (const [x, y] of [[7, 7], [11, 7], [9, 5], [9, 9], [8, 6]]) assert.equal(flagsAt(r, x, y), 15, `${x},${y}`);
  assert.equal(flagsAt(r, 6, 7), 0, 'the outline is narrow');
  // A weaker outline never weakens a stronger one, and a strength of 0
  // (a sprite's foot on the ground) leaves none.
  r.fineAt(9, 3, glyph('#'), 9, 9, 9, 1, 1, 1, 4);
  assert.equal(flagsAt(r, 9, 5), 15);
  assert.equal(flagsAt(r, 9, 1), 4);
  r.fineAt(16, 12, glyph('#'), 9, 9, 9, 1, 1, 1, 0);
  assert.equal(flagsAt(r, 16, 13), 0);
  // A glyph without a backdrop, like a leaf, has none.
  r.fineAt(16, 2, glyph('/'), 9, 9, 9);
  assert.equal(flagsAt(r, 17, 2), 0);
  // The sprite's own cells are never outline.
  r.fineAt(10, 7, glyph('#'), 9, 9, 9, 1, 1, 1);
  assert.equal(flagsAt(r, 10, 7), SET | SOLID);
  // Grass or a walker drawn afterwards stands in front of the outline in
  // its cell; the outline in other cells stays.
  r.put(3, 3, glyph('W'), 200, 150, 100);
  assert.equal(flagsAt(r, 7, 7), 0);
  assert.equal(flagsAt(r, 8, 6), 15);
  r.clearFine();
  assert.equal(flagsAt(r, 8, 6), 0);
});
