import assert from 'node:assert/strict';
import test from 'node:test';
import spell from '../../src/spells/definitions/temp-blazing-barrage.js';
import { runeScene } from '../../test-support/spells.js';
import { toCells } from '../../src/entities/monsters.js';

test('Blazing Barrage launches spread fireballs and a delayed fireblast', () => {
  const { casting, player, ally, monsters, foe, advance, cast, aura, potion } = runeScene(spell, { range: 6 });
  cast();
  advance(0.9);
  assert.ok(casting.projectiles.length > 1);
  assert.ok(new Set(casting.projectiles.map(p => p.dx.toFixed(2))).size > 1);
  advance(4);
  assert.ok(foe.health < 100);
  assert.ok(monsters.events.some(e => e.type === 'hurt' && (e.amount === 9 || e.amount === 15)));
});
