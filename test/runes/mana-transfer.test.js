import assert from 'node:assert/strict';
import test from 'node:test';
import spell from '../../src/spells/definitions/mana-transfer.js';
import { runeScene } from '../../test-support/spells.js';
import { toCells } from '../../src/entities/monsters.js';

test('Mana Transfer moves two mana per pulse and stops out of range', () => {
  const { casting, player, ally, monsters, foe, advance, cast, aura, potion } = runeScene(spell, { range: 15, allyInPath: true, allyRange: 1 });
  cast();
  advance(1.1);
  assert.ok(casting.state(ally).mana >= 24);
  assert.ok(casting.mana < 94);
  assert.equal(player.magicSpeed, 0);
  ally.y = toCells(0, 5)[1];
  advance(1.2);
  assert.equal(aura(player, 'Mana_Transfer_Active'), false);
  advance(1.2);
  assert.equal(player.magicSpeed, 1);
});
