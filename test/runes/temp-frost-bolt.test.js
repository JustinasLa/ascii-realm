import assert from 'node:assert/strict';
import test from 'node:test';
import spell from '../../src/spells/definitions/temp-frost-bolt.js';
import { runeScene } from '../../test-support/spells.js';
import { toCells } from '../../src/entities/monsters.js';

test('Frost Bolt hits for eight and applies two seconds of Slowness III', () => {
  const { casting, player, ally, monsters, foe, advance, cast, aura, potion } = runeScene(spell, {  });
  cast();
  advance(0.5);
  assert.equal(foe.health, 92);
  assert.equal(foe.magicSpeed, 0.55);
  advance(2.5);
  assert.equal(foe.magicSpeed, 1);
});
