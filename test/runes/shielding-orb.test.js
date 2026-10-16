import assert from 'node:assert/strict';
import test from 'node:test';
import spell from '../../src/spells/definitions/shielding-orb.js';
import { runeScene } from '../../test-support/spells.js';
import { toCells } from '../../src/entities/monsters.js';

test('Shielding Orb grants an ally exactly thirteen absorption for six seconds', () => {
  const { casting, player, ally, monsters, foe, advance, cast, aura, potion } = runeScene(spell, { range: 12, allyInPath: true });
  cast();
  advance(0.5);
  assert.equal(casting.state(ally).shield, 13);
  assert.equal(casting.state().shield, 0);
  assert.equal(ally.takeDamage(15), 2);
  advance(6.5);
  assert.equal(casting.state(ally).shield, 0);
});
