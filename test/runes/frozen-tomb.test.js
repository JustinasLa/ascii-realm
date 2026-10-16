import assert from 'node:assert/strict';
import test from 'node:test';
import spell from '../../src/spells/definitions/frozen-tomb.js';
import { runeScene } from '../../test-support/spells.js';
import { toCells } from '../../src/entities/monsters.js';

test('Frozen Tomb roots immediately and deals 23 damage after its delay', () => {
  const { casting, player, ally, monsters, foe, advance, cast, aura, potion } = runeScene(spell, { range: 20 });
  cast();
  advance(0.7);
  assert.equal(foe.magicSpeed, 0);
  assert.equal(foe.health, 100);
  advance(1);
  assert.equal(foe.health, 77);
  advance(5);
  assert.equal(foe.magicSpeed, 1);
});
