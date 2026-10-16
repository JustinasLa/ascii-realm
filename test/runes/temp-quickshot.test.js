import assert from 'node:assert/strict';
import test from 'node:test';
import spell from '../../src/spells/definitions/temp-quickshot.js';
import { runeScene } from '../../test-support/spells.js';
import { toCells } from '../../src/entities/monsters.js';

test('Leaf Arrow flies forward and deals eight damage once', () => {
  const { casting, player, ally, monsters, foe, advance, cast, aura, potion } = runeScene(spell, {  });
  cast();
  advance(0.7);
  assert.equal(foe.health, 92);
  advance(2);
  assert.equal(foe.health, 92);
});
