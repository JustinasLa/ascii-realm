import assert from 'node:assert/strict';
import test from 'node:test';
import spell from '../../src/spells/definitions/frostveil.js';
import { runeScene } from '../../test-support/spells.js';
import { toCells } from '../../src/entities/monsters.js';

test('Frostveil refreshes silence only while a target stays in its field', () => {
  const { casting, player, ally, monsters, foe, advance, cast, aura, potion } = runeScene(spell, { range: 20 });
  cast();
  advance(2);
  assert.ok(aura(foe, 'Silenced'));
  foe.y = toCells(0, 40)[1];
  advance(1.6);
  assert.equal(aura(foe, 'Silenced'), false);
  assert.equal(foe.health, 100);
});
