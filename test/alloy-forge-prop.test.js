import assert from 'node:assert/strict';
import test from 'node:test';
import { AsciiRenderer } from '../src/render/renderer.js';
import { bakeFine, fineOf, packFine } from '../src/world/fine-bakes.js';
import { drawFurnaceGlow, glowCells } from '../src/world/furnace-glow.js';
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
const light = (c) => c.r + c.gg + c.b;
const warm = (c) => c.r > 2 * c.b && c.r > 40;

function renderer(cols, rows) {
  const r = Object.create(AsciiRenderer.prototype);
  r.allocate(cols, rows);
  return r;
}

// A forge drawn from its fine bake into a renderer with room around it.
function drawn(options = { seed: 3 }) {
  const forge = createProp('alloy-forge', 24.5, 16.5, options);
  fineOf(forge, true);
  bakeFine();
  const r = renderer(48, 20);
  r.fine = new Uint8ClampedArray(r.fine.length);
  const view = { x0: 0, y0: 0, cols: 48, rows: 20 };
  drawProp(r, view, forge);
  return { forge, r, view };
}

const cellsOf = (forge) => finish(fineRecipe(forge)()).filter((c) => c.br !== undefined);

test('the alloy forge is a solid Camp prop baked in small letters', () => {
  assert.deepEqual(propDefinition('alloy-forge'),
    { kind: 'alloy-forge', label: 'Alloy forge', symbol: 'U', group: 'Camp', solid: true });
  const forge = createProp('alloy-forge', 4.5, 6.5, { seed: 3 });
  assert.equal(forge.kind, 'alloy-forge');
  assert.equal(forge.solid, true);
  assert.ok(forge.footW > 6 && forge.footH > 1);
  // The hearth and the bellows: about 20 columns wide and 5 rows tall.
  const fine = cellsOf(forge);
  const xs = fine.map((c) => c.dx);
  const width = (Math.max(...xs) - Math.min(...xs) + 1) / 2;
  assert.ok(width >= 18 && width <= 23, `width ${width}`);
  assert.ok(Math.min(...fine.map((c) => c.dy)) >= -12);
});

test('a worker rebuilds the same forge from its source', () => {
  for (const variant of [0, 1]) {
    const forge = createProp('alloy-forge', 4.5, 6.5, { seed: 7, scale: 1.2, variant });
    const source = fineSource(forge);
    assert.deepEqual(structuredClone(source), source);
    const again = rebuildProp(structuredClone(source), true);
    assert.deepEqual(packFine(finish(fineRecipe(again)())), packFine(finish(fineRecipe(forge)())));
  }
});

test('the coals glow scales with the builder size', () => {
  const plain = createProp('alloy-forge', 0, 0, { seed: 5, variant: 0 });
  const big = createProp('alloy-forge', 0, 0, { seed: 5, variant: 0, scale: 2 });
  for (const key of ['x', 'y', 'rx', 'ry']) assert.ok(Math.abs(big.glow[key] - 2 * plain.glow[key]) < 1e-9, key);
  assert.ok(plain.glow.y < -3 && plain.glow.rx > 2 * plain.glow.ry);
});

test('the glow\'s ember bed lies on the dark coals and its flames rise round the crucible', () => {
  for (const options of [{ seed: 3 }, { seed: 11, variant: 0 }, { seed: 4, scale: 1.5 }]) {
    const { forge, r, view } = drawn(options);
    const before = r.fineBg.slice();
    const touched = [];
    const fineAt = r.fineAt;
    r.fineAt = function record(fx, fy, ...rest) {
      touched.push([fx, fy, rest.length]);
      return fineAt.call(this, fx, fy, ...rest);
    };
    drawFurnaceGlow(r, view, forge, 0.4);
    const embers = glowCells(forge.glow, true).filter(([, , ember]) => ember).length;
    assert.ok(touched.length >= 20 && embers >= 6, `${touched.length} glow letters, ${embers} embers`);
    const bottom = Math.max(...touched.map(([, fy]) => fy));
    const xs = touched.map(([fx]) => fx);
    for (const [fx, fy, args] of touched) {
      assert.equal(args, 4, 'no backdrop is passed');
      const i = (fy * r.fineCols + fx) * 4;
      assert.deepEqual([...r.fineBg.slice(i, i + 3)], [...before.slice(i, i + 3)], 'the backing is left as it was');
      if (fy !== bottom) continue;
      assert.ok(before[i + 3] & SOLID, `(${fx}, ${fy}) is on the forge`);
      assert.ok(before[i] + before[i + 1] + before[i + 2] < 50, `(${fx}, ${fy}) backing is dark`);
    }
    assert.ok(Math.max(...xs) - Math.min(...xs) < 4 * forge.glow.rx / 0.6 + 2);
  }
});

test('cold, the coals show faint baked embers and the crucible stands out from them', () => {
  const forge = createProp('alloy-forge', 0, 0, { seed: 3, variant: 0 });
  const fine = cellsOf(forge);
  const top = Math.min(...fine.filter((c) => c.dx > 8).map((c) => c.dy));
  const coals = fine.filter((c) => c.dy === top && Math.abs(c.dx - 1) <= 6);
  assert.ok(coals.some(warm), 'some embers glow in the coals');
  assert.ok(coals.some((c) => light(c) < 60), 'the rest of the coals are dark');
  const crucible = fine.filter((c) => c.dy < top && c.dy > top - 4);
  assert.ok(crucible.length >= 12);
  const mean = (cells) => cells.reduce((sum, c) => sum + light(c), 0) / cells.length;
  assert.ok(mean(crucible) > mean(coals.filter((c) => !warm(c))) * 2);
  // Molten metal in its mouth, and the bellows west of the hearth.
  assert.ok(fine.some((c) => c.dy <= top - 4 && c.r > 150));
  assert.ok(Math.min(...fine.map((c) => c.dx)) < -20);
});
