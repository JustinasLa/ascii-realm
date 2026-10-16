import assert from 'node:assert/strict';
import test from 'node:test';
import spell from '../../src/spells/definitions/crashing-wave.js';
import { runeScene } from '../../test-support/spells.js';
import { toCells } from '../../src/entities/monsters.js';

test('Crashing Wave pierces with eighteen damage and knockback', () => {
  const { casting, player, ally, monsters, foe, advance, cast, aura, potion } = runeScene(spell, {  });
  const before = foe.y;
  cast();
  advance(0.7);
  assert.equal(foe.health, 82);
  assert.ok(foe.y > before);
  advance(2);
  assert.equal(foe.health, 82);
});
