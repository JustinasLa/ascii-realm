import assert from 'node:assert/strict';
import test from 'node:test';
import spell from '../../src/spells/definitions/ice-shard.js';
import { runeScene } from '../../test-support/spells.js';
import { toCells } from '../../src/entities/monsters.js';

test('Ice Shard slows without damage and wears off', () => {
  const { casting, player, ally, monsters, foe, advance, cast, aura, potion } = runeScene(spell, {  });
  cast();
  advance(0.5);
  assert.ok(aura(foe, 'Slowed'));
  assert.equal(foe.magicSpeed, 0.7);
  assert.equal(foe.health, 100);
  advance(7.5);
  assert.equal(foe.magicSpeed, 1);
});
