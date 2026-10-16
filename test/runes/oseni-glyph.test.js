import assert from 'node:assert/strict';
import test from 'node:test';
import spell from '../../src/spells/definitions/oseni-glyph.js';
import { runeScene } from '../../test-support/spells.js';
import { toCells } from '../../src/entities/monsters.js';

test('Oseni Glyph arms before dealing one 23-damage explosion', () => {
  const { casting, player, ally, monsters, foe, advance, cast, aura, potion } = runeScene(spell, { range: 1 });
  cast();
  advance(0.8);
  assert.equal(foe.health, 100);
  advance(1.5);
  assert.equal(foe.health, 77);
  advance(3);
  assert.equal(foe.health, 77);
});
