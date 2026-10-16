import assert from 'node:assert/strict';
import test from 'node:test';
import spell from '../../src/spells/definitions/restoration.js';
import { runeScene } from '../../test-support/spells.js';
import { toCells } from '../../src/entities/monsters.js';

test('Restoration cleanses four TF debuffs while preserving silence', () => {
  const { casting, player, ally, monsters, foe, advance, cast, aura, potion } = runeScene(spell, { range: 15, allyInPath: true });
  const ctx = casting.context(spell, spell.variants[0], player);
  for (const name of ['Slowed', 'Frozen', 'Burnt', 'Weakened', 'Silenced']) casting.aura(ally, { auraname: name, d: '200' }, ctx);
  cast();
  advance(3);
  for (const name of ['Slowed', 'Frozen', 'Burnt', 'Weakened']) assert.equal(aura(ally, name), false);
  assert.ok(aura(ally, 'Silenced'));
});
