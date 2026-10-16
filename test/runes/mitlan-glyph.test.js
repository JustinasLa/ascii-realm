import assert from 'node:assert/strict';
import test from 'node:test';
import spell from '../../src/spells/definitions/mitlan-glyph.js';
import { runeScene } from '../../test-support/spells.js';
import { toCells } from '../../src/entities/monsters.js';

test('Mitlan Glyph arms then damages, lifts and slows on contact', () => {
  const { casting, player, ally, monsters, foe, advance, cast, aura, potion } = runeScene(spell, { range: 1 });
  cast();
  advance(0.8);
  assert.equal(foe.health, 100);
  advance(1.5);
  assert.equal(foe.health, 86);
  assert.ok(aura(foe, 'Slowed'));
  assert.ok(foe.magicLift > 0 || potion(foe, 'slow'));
});
