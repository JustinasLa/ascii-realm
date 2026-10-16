import assert from 'node:assert/strict';
import test from 'node:test';
import spell from '../../src/spells/definitions/fire-rain.js';
import { runeScene } from '../../test-support/spells.js';
import { toCells } from '../../src/entities/monsters.js';

test('Fire Rain launches six shards then returns and disengages', () => {
  const { casting, player, ally, monsters, foe, advance, cast, aura, potion } = runeScene(spell, {  });
  cast();
  assert.ok(player.vy > 0);
  advance(0.8);
  assert.equal(foe.health, 100);
  advance(7.2);
  assert.equal(foe.health, 28);
  assert.ok(player.y < 0);
  assert.equal(casting.projectiles.length, 0);
});
