import assert from 'node:assert/strict';
import test from 'node:test';
import spell from '../../src/spells/definitions/temp-last-stand.js';
import { runeScene } from '../../test-support/spells.js';
import { toCells } from '../../src/entities/monsters.js';

test('Flight of the Gladiator protects the caster then deals ten plus twenty damage', () => {
  const { casting, player, ally, monsters, foe, advance, cast, aura, potion } = runeScene(spell, { range: 2 });
  cast();
  assert.equal(player.takeDamage(12), 0);
  advance(0.5);
  assert.equal(foe.health, 90);
  advance(2);
  assert.equal(foe.health, 70);
  assert.equal(player.takeDamage(12), 12);
});
