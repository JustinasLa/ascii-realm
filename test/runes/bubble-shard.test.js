import assert from 'node:assert/strict';
import test from 'node:test';
import spell from '../../src/spells/definitions/bubble-shard.js';
import { runeScene } from '../../test-support/spells.js';
import { toCells } from '../../src/entities/monsters.js';

test('Bubble Shard hits for six and slows for six seconds', () => {
  const { casting, player, ally, monsters, foe, advance, cast, aura, potion } = runeScene(spell, {  });
  cast();
  advance(0.5);
  assert.equal(foe.health, 94);
  assert.ok(aura(foe, 'Slowed'));
  advance(7);
  assert.equal(foe.magicSpeed, 1);
});
