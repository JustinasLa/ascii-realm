import assert from 'node:assert/strict';
import test from 'node:test';
import spell from '../../src/spells/definitions/temp-vine-wave.js';
import { runeScene } from '../../test-support/spells.js';
import { toCells } from '../../src/entities/monsters.js';

test('Vine Wave delays damage before slowing and poisoning its target', () => {
  const { casting, player, ally, monsters, foe, advance, cast, aura, potion } = runeScene(spell, {  });
  cast();
  advance(0.4);
  assert.equal(foe.health, 100);
  advance(1);
  assert.ok(foe.health <= 84);
  assert.ok(potion(foe, 'poison'));
  assert.ok(foe.magicSpeed < 1);
  advance(4);
  assert.equal(potion(foe, 'poison'), undefined);
});
