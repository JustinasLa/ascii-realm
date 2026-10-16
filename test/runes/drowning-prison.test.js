import assert from 'node:assert/strict';
import test from 'node:test';
import spell from '../../src/spells/definitions/drowning-prison.js';
import { runeScene } from '../../test-support/spells.js';
import { toCells } from '../../src/entities/monsters.js';

test('Drowning Prison holds its nearest target and deals four six-damage pulses', () => {
  const { casting, player, ally, monsters, foe, advance, cast, aura, potion } = runeScene(spell, { range: 20 });
  cast();
  advance(0.7);
  assert.equal(foe.magicSpeed, 0);
  advance(4);
  assert.equal(foe.health, 76);
  advance(1.5);
  assert.equal(foe.magicSpeed, 1);
});
