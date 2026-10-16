import assert from 'node:assert/strict';
import test from 'node:test';
import spell from '../../src/spells/definitions/temp-glacial-fan.js';
import { runeScene } from '../../test-support/spells.js';
import { toCells } from '../../src/entities/monsters.js';

test('Glacial Fan fires five staggered directions with sixteen-damage shards', () => {
  const { casting, player, ally, monsters, foe, advance, cast, aura, potion } = runeScene(spell, { range: 6 });
  cast();
  advance(0.1);
  const left = casting.projectiles[0]?.dx;
  advance(0.35);
  assert.ok(casting.projectiles.some(p => p.dx !== left));
  advance(1);
  assert.ok(foe.health < 100);
  assert.ok(monsters.events.some(e => e.type === 'hurt' && e.amount === 16));
});
