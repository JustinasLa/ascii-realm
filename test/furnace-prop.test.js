import assert from 'node:assert/strict';
import test from 'node:test';
import { AsciiRenderer } from '../src/render/renderer.js';
import { bakeFine, fineOf, packFine } from '../src/world/fine-bakes.js';
import { drawFurnaceGlow } from '../src/world/furnace-glow.js';
import { fineRecipe, fineSource } from '../src/world/prop-art.js';
import { propDefinition } from '../src/world/prop-catalog.js';
import { createProp, drawProp, rebuildProp } from '../src/world/props.js';

const finish = (steps) => {
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
};
const SOLID = 32;

function renderer(cols, rows) {
  const r = Object.create(AsciiRenderer.prototype);
  r.allocate(cols, rows);
  return r;
}

// A furnace drawn from its fine bake into a renderer with room around it.
function drawn(options = { seed: 3 }) {
  const furnace = createProp('furnace', 20.5, 16.5, options);
  fineOf(furnace, true);
  bakeFine();
  const r = renderer(40, 20);
  r.fine = new Uint8ClampedArray(r.fine.length);
  const view = { x0: 0, y0: 0, cols: 40, rows: 20 };
  drawProp(r, view, furnace);
  return { furnace, r, view };
}

test('the furnace is a solid Camp prop baked in small letters', () => {
  assert.deepEqual(propDefinition('furnace'), { kind: 'furnace', label: 'Furnace', symbol: 'n', group: 'Camp', solid: true });
  const furnace = createProp('furnace', 4.5, 6.5, { seed: 3 });
  assert.equal(furnace.kind, 'furnace');
  assert.equal(furnace.solid, true);
  assert.ok(furnace.footW > 5 && furnace.footH > 1);
  assert.ok(fineRecipe(furnace));
  // About 13 to 15 columns wide and 7 rows tall.
  const fine = finish(fineRecipe(furnace)());
  const xs = fine.map((c) => c.dx);
  const width = (Math.max(...xs) - Math.min(...xs) + 1) / 2;
  assert.ok(width >= 12 && width <= 16, `width ${width}`);
  assert.ok(Math.min(...fine.map((c) => c.dy)) >= -14);
});

test('a worker rebuilds the same furnace from its source', () => {
  for (const variant of [0, 1]) {
    const furnace = createProp('furnace', 4.5, 6.5, { seed: 7, scale: 1.2, variant });
    const source = fineSource(furnace);
    assert.deepEqual(structuredClone(source), source);
    const again = rebuildProp(structuredClone(source), true);
    assert.deepEqual(packFine(finish(fineRecipe(again)())), packFine(finish(fineRecipe(furnace)())));
  }
});

test('the mouth glow scales with the builder size and the variation', () => {
  const plain = createProp('furnace', 0, 0, { seed: 5, variant: 0 });
  assert.deepEqual(plain.glow, { x: 0, y: -1.35, rx: 1.05, ry: 0.85 });
  const big = createProp('furnace', 0, 0, { seed: 5, variant: 0, scale: 2 });
  assert.deepEqual(big.glow, { x: 0, y: -2.7, rx: 2.1, ry: 1.7 });
  const varied = createProp('furnace', 0, 0, { seed: 5, variant: 1 });
  assert.notDeepEqual(varied.glow, plain.glow);
  assert.ok(Math.abs(varied.glow.rx / varied.glow.ry - (1.05 / 0.85) * (varied.footW / plain.footW)
    / (varied.footH / plain.footH)) < 1e-9);
});

test('every glow letter lands on the dark mouth and keeps its backing', () => {
  for (const options of [{ seed: 3 }, { seed: 11, variant: 0 }, { seed: 4, scale: 1.5 }]) {
    const { furnace, r, view } = drawn(options);
    const before = r.fineBg.slice();
    const touched = [];
    const fineAt = r.fineAt;
    r.fineAt = function record(fx, fy, ...rest) {
      touched.push([fx, fy, rest.length]);
      return fineAt.call(this, fx, fy, ...rest);
    };
    drawFurnaceGlow(r, view, furnace, 0.4);
    assert.ok(touched.length >= 12, `${touched.length} glow letters`);
    for (const [fx, fy, args] of touched) {
      assert.equal(args, 4, 'no backdrop is passed');
      const i = (fy * r.fineCols + fx) * 4;
      assert.ok(before[i + 3] & SOLID, `(${fx}, ${fy}) is on the furnace`);
      assert.ok(before[i] + before[i + 1] + before[i + 2] < 30, `(${fx}, ${fy}) backing is dark`);
      assert.deepEqual([...r.fineBg.slice(i, i + 3)], [...before.slice(i, i + 3)]);
      assert.ok(r.fineBg[i + 3] & SOLID);
    }
  }
});

test('the mouth is dark and the top slab catches more light than the front', () => {
  const furnace = createProp('furnace', 0, 0, { seed: 3, variant: 0 });
  const fine = finish(fineRecipe(furnace)());
  const at = (dx, dy) => fine.find((c) => c.dx === dx && c.dy === dy && c.br !== undefined);
  const light = (c) => c.r + c.gg + c.b;
  // The mouth's middle, two small rows over the grate.
  assert.ok(light(at(0, -3)) < 60);
  const top = fine.filter((c) => c.dy === -11 && c.br !== undefined && Math.abs(c.dx) < 4);
  const front = fine.filter((c) => c.dy === -7 && c.br !== undefined && Math.abs(c.dx) < 4);
  const mean = (cells) => cells.reduce((sum, c) => sum + light(c), 0) / cells.length;
  assert.ok(mean(top) > mean(front), `${mean(top)} > ${mean(front)}`);
});
