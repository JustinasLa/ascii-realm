import assert from 'node:assert/strict';
import test from 'node:test';
import spell from '../../src/spells/definitions/cold-embrace.js';
import { runeScene } from '../../test-support/spells.js';
import { toCells } from '../../src/entities/monsters.js';

test('Cold Embrace creates a delayed weakening field', () => {
  const { casting, player, ally, monsters, foe, advance, cast, aura, potion } = runeScene(spell, { range: 20 });
  cast();
  advance(0.3);
  assert.equal(aura(foe, 'Weakened'), false);
  advance(2);
  assert.ok(aura(foe, 'Weakened'));
  assert.equal(foe.magicDamage, -4);
  assert.equal(foe.health, 100);
  advance(8);
  assert.equal(foe.magicDamage, 0);
});
