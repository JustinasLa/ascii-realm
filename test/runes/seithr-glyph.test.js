import assert from 'node:assert/strict';
import test from 'node:test';
import spell from '../../src/spells/definitions/seithr-glyph.js';
import { runeScene } from '../../test-support/spells.js';
import { toCells } from '../../src/entities/monsters.js';

test('Seithr Glyph arms then freezes a contact for eight seconds', () => {
  const { casting, player, ally, monsters, foe, advance, cast, aura, potion } = runeScene(spell, { range: 1 });
  cast();
  advance(0.8);
  assert.equal(aura(foe, 'Frozen'), false);
  advance(1.5);
  assert.ok(aura(foe, 'Frozen'));
  assert.equal(foe.magicSpeed, 0);
  advance(9);
  assert.equal(foe.magicSpeed, 1);
  assert.equal(foe.health, 100);
});
