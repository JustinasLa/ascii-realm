import assert from 'node:assert/strict';
import test from 'node:test';
import spell from '../../src/spells/definitions/maelstrom.js';
import { runeScene } from '../../test-support/spells.js';
import { toCells } from '../../src/entities/monsters.js';

test('Maelstrom warns then pulls and pulses five damage per second', () => {
  const { casting, player, ally, monsters, foe, advance, cast, aura, potion } = runeScene(spell, {  });
  const before = foe.y;
  cast();
  advance(0.8);
  assert.equal(foe.health, 100);
  advance(3);
  assert.ok(foe.health <= 90);
  assert.ok(foe.y < before);
  advance(6);
  const hp = foe.health;
  advance(3);
  assert.equal(foe.health, hp);
});
