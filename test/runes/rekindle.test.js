import assert from 'node:assert/strict';
import test from 'node:test';
import spell from '../../src/spells/definitions/rekindle.js';
import { oseni } from '../../src/spells/elements/oseni.js';
import { runeScene } from '../../test-support/spells.js';

test('Rekindle is an Oseni rune that heals the caster at once, then burns on for four more heals', () => {
  assert.ok(oseni.includes(spell.id));
  assert.equal(spell.element, 'oseni');
  const { casting, player, ally, foe, advance, cast, aura } = runeScene(spell, { range: 3, allyInPath: true, allyRange: 1 });
  assert.equal(cast().ok, true);
  assert.equal(casting.mana, 92);
  assert.equal(player.vitals.health, 70);
  advance(0.9);
  assert.equal(player.vitals.health, 70);
  advance(0.2);
  assert.ok(aura(player, 'Rekindle'));
  assert.equal(player.vitals.health, 74);
  advance(2);
  assert.equal(player.vitals.health, 82);
  advance(1);
  assert.equal(player.vitals.health, 86);
  advance(2);
  assert.equal(player.vitals.health, 86, 'the burn ends after four heals');
  assert.equal(aura(player, 'Rekindle'), false);
  assert.equal(ally.vitals.health, 20, 'only the caster is healed');
  assert.equal(foe.health, 100);
});

test('Rekindle never heals past full health and needs no target', () => {
  const { casting, player, monsters, advance, cast } = runeScene(spell);
  monsters.list.length = 0;
  casting.peers = () => [];
  casting.sync();
  player.vitals.health = 95;
  assert.equal(cast({ target: null }).ok, true);
  advance(5);
  assert.equal(player.vitals.health, player.vitals.maxHealth);
});

test('Rekindle cannot be cast while silenced or without mana', () => {
  const { casting, player, cast, castWithoutMana } = runeScene(spell);
  assert.equal(castWithoutMana().ok, false);
  assert.equal(player.vitals.health, 60);
  casting.aura(player, { auraname: 'Silenced', d: '100' }, casting.context(spell, spell.variants[0], player));
  assert.equal(cast().ok, false);
  assert.equal(player.vitals.health, 60);
});
