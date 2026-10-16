import assert from 'node:assert/strict';
import test from 'node:test';
import spell from '../../src/spells/definitions/healing-orb.js';
import { runeScene } from '../../test-support/spells.js';
import { toCells } from '../../src/entities/monsters.js';

test('Healing Orb heals another player for twelve without healing the caster', () => {
  const { casting, player, ally, monsters, foe, advance, cast, aura, potion } = runeScene(spell, { range: 12, allyInPath: true });
  cast();
  advance(0.5);
  assert.equal(ally.vitals.health, 32);
  assert.equal(player.vitals.health, 60);
  assert.equal(foe.health, 100);
});
