import assert from 'node:assert/strict';
import test from 'node:test';
import spell from '../../src/spells/definitions/fire-breath.js';
import { runeScene } from '../../test-support/spells.js';
import { toCells } from '../../src/entities/monsters.js';

test('Fire Breath burns a forward target for four six-damage pulses', () => {
  const { casting, player, ally, monsters, foe, advance, cast, aura, potion } = runeScene(spell, {  });
  cast();
  advance(0.2);
  assert.equal(foe.health, 94);
  assert.ok(aura(foe, 'Burnt'));
  advance(4.5);
  assert.equal(foe.health, 76);
  assert.equal(aura(foe, 'Burnt'), false);
});
