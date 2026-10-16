import assert from 'node:assert/strict';
import test from 'node:test';
import spell from '../../src/spells/definitions/ice-shield.js';
import { runeScene } from '../../test-support/spells.js';
import { toCells } from '../../src/entities/monsters.js';

test('Ice Shield absorbs exactly ten health and expires after six seconds', () => {
  const { casting, player, ally, monsters, foe, advance, cast, aura, potion } = runeScene(spell, {  });
  cast();
  assert.equal(casting.state().shield, 10);
  assert.equal(player.takeDamage(12), 2);
  assert.equal(player.vitals.health, 58);
  advance(6.2);
  assert.equal(casting.state().shield, 0);
});
