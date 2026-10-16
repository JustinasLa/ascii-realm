import assert from 'node:assert/strict';
import test from 'node:test';
import spell from '../../src/spells/definitions/temp-hailpiercer.js';
import { runeScene } from '../../test-support/spells.js';
import { toCells } from '../../src/entities/monsters.js';

test('Hailpiercer charges, pulls, then lands a twenty-damage burst', () => {
  const { casting, player, ally, monsters, foe, advance, cast, aura, potion } = runeScene(spell, {  });
  cast();
  advance(0.5);
  assert.equal(foe.health, 100);
  advance(4);
  assert.ok(foe.health <= 80);
  assert.ok(monsters.events.some(e => e.type === 'hurt' && e.amount === 20));
});
