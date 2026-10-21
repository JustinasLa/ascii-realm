import assert from 'node:assert/strict';
import test from 'node:test';
import spell from '../../src/spells/definitions/fire-shard.js';
import { runeScene } from '../../test-support/spells.js';
import { toCells } from '../../src/entities/monsters.js';

test('Fire Shard hits once for 12 damage and costs four mana', () => {
  const { casting, player, ally, monsters, foe, advance, cast, aura, potion } = runeScene(spell, {  });
  assert.equal(cast().ok, true);
  advance(0.5);
  assert.equal(foe.health, 88);
  assert.equal(casting.mana, 96);
  assert.equal(cast().ok, true, 'recasting is limited by mana, not time');
  assert.equal(casting.mana, 92);
});
