import assert from 'node:assert/strict';
import test from 'node:test';
import spell from '../../src/spells/definitions/temp-earth-spike.js';
import { runeScene } from '../../test-support/spells.js';
import { toCells } from '../../src/entities/monsters.js';

test('Earth Spike creates a travelling damaging and lifting fissure', () => {
  const { casting, player, ally, monsters, foe, advance, cast, aura, potion } = runeScene(spell, {  });
  cast();
  advance(0.8);
  assert.ok(foe.health <= 88);
  assert.ok(monsters.events.some(e => e.type === 'hurt' && e.amount === 12));
  assert.ok(foe.magicLift > 0);
});
