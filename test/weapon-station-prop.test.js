import assert from 'node:assert/strict';
import test from 'node:test';
import { glyph, GLYPH_MASK } from '../src/render/glyphs.js';
import { packFine } from '../src/world/fine-bakes.js';
import { fineRecipe, fineSource } from '../src/world/prop-art.js';
import { propDefinition } from '../src/world/prop-catalog.js';
import { createProp, rebuildProp } from '../src/world/props.js';

const finish = (steps) => {
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
};
const cellsOf = (prop) => finish(fineRecipe(prop)());
const light = (c) => c.r + c.gg + c.b;
const is = (c, ch) => (c.g & GLYPH_MASK) === glyph(ch);

test('the weapon station is a solid Camp prop baked in small letters, with no fire', () => {
  assert.deepEqual(propDefinition('weapon-station'),
    { kind: 'weapon-station', label: 'Weapon station', symbol: 'T', group: 'Camp', solid: true });
  const station = createProp('weapon-station', 4.5, 6.5, { seed: 3 });
  assert.equal(station.kind, 'weapon-station');
  assert.equal(station.solid, true);
  assert.equal(station.glow, undefined);
  assert.ok(station.footW > 6 && station.footH > 1);
  const fine = cellsOf(station);
  const xs = fine.map((c) => c.dx);
  const width = (Math.max(...xs) - Math.min(...xs) + 1) / 2;
  assert.ok(width >= 16 && width <= 21, `width ${width}`);
  assert.ok(Math.min(...fine.map((c) => c.dy)) >= -10);
});

test('a worker rebuilds the same station from its source', () => {
  for (const variant of [0, 1]) {
    const station = createProp('weapon-station', 4.5, 6.5, { seed: 7, scale: 1.2, variant });
    const source = fineSource(station);
    assert.deepEqual(structuredClone(source), source);
    const again = rebuildProp(structuredClone(source), true);
    assert.deepEqual(packFine(finish(fineRecipe(again)())), packFine(finish(fineRecipe(station)())));
  }
});

test('an anvil with a horn stands on the stump, and the six tools hang on the rack', () => {
  for (const seed of [3, 8]) {
    const fine = cellsOf(createProp('weapon-station', 0, 0, { seed, variant: 0 }));
    const face = fine.filter((c) => is(c, '='));
    const waist = fine.filter((c) => is(c, '#'));
    assert.ok(face.length >= 8 && waist.length >= 3);
    const row = face[0].dy;
    assert.ok(face.every((c) => c.dy === row), 'the face is one clean line');
    assert.ok(fine.some((c) => c.dy === row && is(c, '<') && c.dx < Math.min(...face.map((f) => f.dx))), 'the horn points west');
    const mean = (cells) => cells.reduce((sum, c) => sum + light(c), 0) / cells.length;
    assert.ok(mean(face) > mean(waist) * 1.5, 'the face is lit, the waist dark');
    assert.ok(waist.every((c) => c.dy > row), 'the waist hangs under the face');
    // The rack east of the anvil: the tools in order on one row.
    const hammer = fine.find((c) => is(c, 'T'));
    const tools = ['T', 't', '!', '/', 'i', '|'].map((ch) => fine.find((c) => is(c, ch) && c.dy === hammer.dy));
    assert.ok(tools.every(Boolean) && hammer.dy < row && hammer.dx > 2);
    assert.deepEqual(tools.map((c) => c.dx), [...tools.map((c) => c.dx)].sort((a, b) => a - b));
  }
});
