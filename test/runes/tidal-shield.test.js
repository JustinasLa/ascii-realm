import assert from 'node:assert/strict';
import test from 'node:test';
import spell from '../../src/spells/definitions/tidal-shield.js';
import { runeScene } from '../../test-support/spells.js';
import { toCells } from '../../src/entities/monsters.js';

test('Tidal Shield absorbs seven and its close burst deals six and pushes', () => {
  const { casting, player, ally, monsters, foe, advance, cast, aura, potion } = runeScene(spell, { range: 2 });
  const before = foe.y;
  cast();
  advance(0.5);
  assert.equal(casting.state().shield, 7);
  assert.equal(foe.health, 94);
  assert.ok(foe.y > before);
  advance(6);
  assert.equal(casting.state().shield, 0);
});
