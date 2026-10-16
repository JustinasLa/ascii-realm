import assert from 'node:assert/strict';
import test from 'node:test';
import spell from '../../src/spells/definitions/ice-wave.js';
import { runeScene } from '../../test-support/spells.js';
import { toCells } from '../../src/entities/monsters.js';

test('Ice Wave deals eight damage, pushes and slows for ten seconds', () => {
  const { casting, player, ally, monsters, foe, advance, cast, aura, potion } = runeScene(spell, {  });
  const before = foe.y;
  cast();
  advance(0.5);
  assert.equal(foe.health, 92);
  assert.ok(foe.y > before);
  assert.ok(aura(foe, 'Slowed'));
  advance(11);
  assert.equal(foe.magicSpeed, 1);
});
