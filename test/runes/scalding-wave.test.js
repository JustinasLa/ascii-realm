import assert from 'node:assert/strict';
import test from 'node:test';
import spell from '../../src/spells/definitions/scalding-wave.js';
import { runeScene } from '../../test-support/spells.js';
import { toCells } from '../../src/entities/monsters.js';

test('Scalding Wave pushes and deals three five-damage burn pulses', () => {
  const { casting, player, ally, monsters, foe, advance, cast, aura, potion } = runeScene(spell, {  });
  const before = foe.y;
  cast();
  advance(0.5);
  assert.ok(foe.y > before);
  assert.ok(aura(foe, 'Burnt'));
  advance(3.5);
  assert.equal(foe.health, 85);
});
