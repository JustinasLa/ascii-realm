import assert from 'node:assert/strict';
import test from 'node:test';
import spell from '../../src/spells/definitions/lightning.js';
import { mitlan } from '../../src/spells/elements/mitlan.js';
import { runeScene } from '../../test-support/spells.js';
import { toCells } from '../../src/entities/monsters.js';

test('Lightning is a Mitlan rune that strikes the target after a short charge and stuns it', () => {
  assert.ok(mitlan.includes(spell.id));
  assert.equal(spell.element, 'mitlan');
  const { casting, foe, advance, cast, potion } = runeScene(spell, { range: 6 });
  const strikes = [];
  casting.onLightning = point => strikes.push(point);
  assert.equal(cast().ok, true);
  assert.equal(casting.mana, 93);
  advance(0.5);
  assert.equal(foe.health, 100, 'the charge ring gives a moment to step out');
  assert.equal(strikes.length, 0);
  advance(0.15);
  assert.equal(foe.health, 82);
  assert.ok(potion(foe, 'stun'));
  assert.deepEqual(strikes, [{ x: foe.x, y: foe.y, strength: 1 }]);
  advance(0.6);
  assert.equal(foe.magicStunned, false);
});

test('Lightning hits everything within its radius of the strike point, never the caster', () => {
  const { casting, player, foe, monsters, advance, cast } = runeScene(spell, { range: 1.5 });
  const near = Object.assign(Object.create(Object.getPrototypeOf(foe)), foe);
  near.y += toCells(0, 2)[1]; near.health = 100;
  const far = Object.assign(Object.create(Object.getPrototypeOf(foe)), foe);
  far.y += toCells(0, 4)[1]; far.health = 100;
  monsters.list.push(near, far);
  casting.sync();
  cast();
  advance(0.7);
  assert.equal(foe.health, 82);
  assert.equal(near.health, 82);
  assert.equal(far.health, 100);
  assert.equal(player.vitals.health, 60);
});

test('Lightning falls at the aimed point when nothing is targeted', () => {
  const { casting, foe, advance, cast } = runeScene(spell, { range: 10 });
  const strikes = [];
  casting.onLightning = point => strikes.push(point);
  const aim = { x: 0, y: toCells(0, 3)[1] };
  cast({ target: null, aim });
  advance(0.7);
  assert.deepEqual(strikes.map(({ x, y }) => ({ x, y })), [aim]);
  assert.equal(foe.health, 100);
});
