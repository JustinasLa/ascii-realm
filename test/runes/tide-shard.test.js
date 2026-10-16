import assert from 'node:assert/strict';
import test from 'node:test';
import spell from '../../src/spells/definitions/tide-shard.js';
import { runeScene } from '../../test-support/spells.js';
import { toCells } from '../../src/entities/monsters.js';

test('Tide Shard hits for twelve and pushes the target back', () => {
  const { casting, player, ally, monsters, foe, advance, cast, aura, potion } = runeScene(spell, {  });
  const before = foe.y;
  cast();
  advance(0.6);
  assert.equal(foe.health, 88);
  assert.ok(foe.y > before);
});
