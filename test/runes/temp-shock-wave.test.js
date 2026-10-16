import assert from 'node:assert/strict';
import test from 'node:test';
import spell from '../../src/spells/definitions/temp-shock-wave.js';
import { runeScene } from '../../test-support/spells.js';
import { toCells } from '../../src/entities/monsters.js';

test('Woodland Anvil charges before its travelling earthquake damages and lifts', () => {
  const { casting, player, ally, monsters, foe, advance, cast, aura, potion } = runeScene(spell, {  });
  cast();
  advance(1);
  assert.equal(foe.health, 100);
  assert.equal(player.magicSpeed, 0);
  advance(4);
  assert.equal(foe.health, 80);
  assert.ok(monsters.events.some(e => e.type === 'hurt' && e.amount === 20));
});
