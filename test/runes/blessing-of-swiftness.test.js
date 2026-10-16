import assert from 'node:assert/strict';
import test from 'node:test';
import spell from '../../src/spells/definitions/blessing-of-swiftness.js';
import { runeScene } from '../../test-support/spells.js';
import { toCells } from '../../src/entities/monsters.js';

test('Blessing of Swiftness roots briefly then grants six seconds of Speed II', () => {
  const { casting, player, ally, monsters, foe, advance, cast, aura, potion } = runeScene(spell, { range: 12, allyInPath: true, allyRange: 1 });
  cast();
  advance(0.1);
  assert.equal(ally.magicSpeed, 0);
  advance(1.2);
  assert.equal(ally.magicSpeed, 1.4);
  advance(6);
  assert.equal(ally.magicSpeed, 1);
});
