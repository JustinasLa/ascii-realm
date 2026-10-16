import assert from 'node:assert/strict';
import test from 'node:test';
import spell from '../../src/spells/definitions/blessing-of-healing.js';
import { runeScene } from '../../test-support/spells.js';
import { toCells } from '../../src/entities/monsters.js';

test('Blessing of Healing channels healing orbs and drains two mana per pulse', () => {
  const { casting, player, ally, monsters, foe, advance, cast, aura, potion } = runeScene(spell, { range: 15, allyInPath: true });
  cast();
  advance(2.2);
  assert.ok(ally.vitals.health >= 44);
  assert.ok(casting.mana < 87);
  assert.equal(player.magicSpeed, 0);
  assert.ok(aura(player, 'BHealing_Active'));
  casting.state().mana = 0;
  advance(1.2);
  assert.equal(aura(player, 'BHealing_Active'), false);
  advance(1.2);
  assert.equal(player.magicSpeed, 1);
});
