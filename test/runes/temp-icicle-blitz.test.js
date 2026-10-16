import assert from 'node:assert/strict';
import test from 'node:test';
import spell from '../../src/spells/definitions/temp-icicle-blitz.js';
import { runeScene } from '../../test-support/spells.js';
import { toCells } from '../../src/entities/monsters.js';

test('Icicle Blitz builds an eight-second stack and adds a quill on the next cast', () => {
  const { casting, player, ally, monsters, foe, advance, cast, aura, potion } = runeScene(spell, {  });
  cast();
  advance(0.7);
  assert.equal(foe.health, 96);
  advance(5.5);
  assert.equal(cast().ok, true);
  advance(1);
  assert.equal(casting.state().auras.get('glacial_quills_stack').stacks, 2);
  assert.equal(foe.health, 88);
});
