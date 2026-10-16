import assert from 'node:assert/strict';
import test from 'node:test';
import spell from '../../src/spells/definitions/temp-summon-phoenix.js';
import { runeScene } from '../../test-support/spells.js';
import { toCells } from '../../src/entities/monsters.js';

test('Fire Phoenix accelerates after its summoning delay and leaves a burning trail', () => {
  const { casting, player, ally, monsters, foe, advance, cast, aura, potion } = runeScene(spell, { range: 6 });
  cast();
  advance(0.6);
  assert.equal(foe.health, 100);
  advance(2);
  assert.ok(foe.health <= 85);
  assert.ok(monsters.events.some(e => e.type === 'hurt' && e.amount === 15));
  assert.ok(casting.effects.list.length > 0);
});
