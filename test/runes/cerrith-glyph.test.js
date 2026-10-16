import assert from 'node:assert/strict';
import test from 'node:test';
import spell from '../../src/spells/definitions/cerrith-glyph.js';
import { runeScene } from '../../test-support/spells.js';
import { toCells } from '../../src/entities/monsters.js';

test('Cerrith Glyph grants a nearby player a 23-point shield after arming', () => {
  const { casting, player, ally, monsters, foe, advance, cast, aura, potion } = runeScene(spell, { range: 15, allyInPath: true, allyRange: 1.5 });
  cast();
  advance(0.8);
  assert.equal(casting.state(ally).shield, 0);
  advance(1.5);
  assert.equal(casting.state(ally).shield, 23);
  advance(7);
  assert.equal(casting.state(ally).shield, 0);
});
