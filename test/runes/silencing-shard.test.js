import assert from 'node:assert/strict';
import test from 'node:test';
import spell from '../../src/spells/definitions/silencing-shard.js';
import { runeScene } from '../../test-support/spells.js';
import { toCells } from '../../src/entities/monsters.js';

test('Silencing Shard prevents casting for six seconds without damage', () => {
  const { casting, player, ally, monsters, foe, advance, cast, aura, potion } = runeScene(spell, {  });
  cast();
  advance(0.5);
  assert.ok(aura(foe, 'Silenced'));
  assert.equal(foe.health, 100);
  assert.equal(casting.cast(spell.id, { caster: foe }).ok, false);
  advance(6.5);
  assert.equal(aura(foe, 'Silenced'), false);
});
