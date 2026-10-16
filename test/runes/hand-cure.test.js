import assert from 'node:assert/strict';
import test from 'node:test';
import spell from '../../src/spells/definitions/hand-cure.js';
import { runeScene } from '../../test-support/spells.js';
import { toCells } from '../../src/entities/monsters.js';

test('Hand Cure heals eighteen at close range and roots both participants', () => {
  const { casting, player, ally, monsters, foe, advance, cast, aura, potion } = runeScene(spell, { range: 12, allyInPath: true, allyRange: 1 });
  cast();
  advance(0.1);
  assert.equal(ally.vitals.health, 38);
  assert.equal(ally.magicSpeed, 0);
  assert.equal(player.magicSpeed, 0);
  advance(1.2);
  assert.equal(ally.magicSpeed, 1);
  assert.equal(player.magicSpeed, 1);
});
