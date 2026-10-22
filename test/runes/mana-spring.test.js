import assert from 'node:assert/strict';
import test from 'node:test';
import spell from '../../src/spells/definitions/mana-spring.js';
import tideShard from '../../src/spells/definitions/tide-shard.js';
import { mitlan } from '../../src/spells/elements/mitlan.js';
import { SpellControls } from '../../src/spells/controls.js';
import { paintPresentation } from '../../src/spells/presentation.js';
import { runeScene } from '../../test-support/spells.js';

test('Mana Spring is a free Mitlan toggle restoring only its caster, beginning after one second', () => {
  assert.ok(mitlan.includes(spell.id));
  const { casting, player, ally, foe, advance, cast, aura } = runeScene(spell);
  casting.state().mana = 0;
  casting.state(ally).manaDelay = Infinity;
  assert.equal(cast().ok, true);
  assert.ok(aura(player, 'Mana_Spring'));
  casting.state().manaDelay = Infinity; // Isolate the spell from baseline regeneration.
  advance(0.9);
  assert.equal(casting.mana, 0);
  advance(0.2);
  assert.equal(casting.mana, 2);
  advance(4);
  assert.equal(casting.mana, 10);
  assert.equal(casting.state(ally).mana, 20);
  assert.equal(player.vitals.health, 60);
  assert.equal(foe.health, 100);
  assert.equal(player.magicSpeed, 1);
  assert.equal(player.magicRooted, false);
});

test('Mana Spring follows movement and other spell casts, and caps at maximum mana', () => {
  const { casting, player, advance, cast, aura } = runeScene(spell);
  casting.spells.set(tideShard.id, tideShard);
  casting.state().mana = 50;
  cast();
  player.x = 100;
  casting.selected = tideShard.id;
  assert.equal(casting.cast().ok, true);
  const spent = casting.mana;
  advance(1.1);
  assert.ok(casting.mana >= spent + 2);
  assert.ok(aura(player, 'Mana_Spring'));
  casting.state().mana = 99;
  advance(2);
  assert.equal(casting.mana, casting.maxMana);
});

test('toggles do not stack or give instant mana; turning off cancels future pulses', () => {
  const { casting, advance, cast, aura, player } = runeScene(spell);
  casting.state().mana = 10;
  for (let i = 0; i < 10; i++) assert.equal(cast().ok, true);
  assert.equal(casting.mana, 10);
  assert.equal(aura(player, 'Mana_Spring'), false);
  casting.state().manaDelay = Infinity;
  advance(2);
  assert.equal(casting.mana, 10);
  cast();
  casting.state().manaDelay = Infinity;
  advance(1.1);
  assert.equal(casting.mana, 12);
  assert.equal(cast().stopped, true);
  advance(3);
  assert.equal(casting.mana, 12);
});

test('Mana Spring needs no target, rejects silence, stops on death and clears on respawn reset', () => {
  const { casting, player, monsters, advance, cast, aura } = runeScene(spell);
  monsters.list.length = 0;
  casting.peers = () => [];
  casting.state().auras.set('silenced', { until: Infinity });
  assert.equal(cast({ target: null }).ok, false);
  assert.equal(aura(player, 'Mana_Spring'), false);
  casting.state().auras.delete('silenced');
  assert.equal(cast({ target: null }).ok, true);
  casting.state().mana = 20;
  player.vitals.health = 0;
  advance(3);
  assert.equal(casting.mana, 20);
  player.respawn(0, 0);
  casting.reset();
  assert.equal(aura(player, 'Mana_Spring'), false);
  casting.state().mana = 20;
  casting.state().manaDelay = Infinity;
  advance(3);
  assert.equal(casting.mana, 20);
});

test('Mana Spring stays active beyond the normal aura lifetime and relays both toggles', () => {
  const { casting, player, cast, advance, aura } = runeScene(spell), relays = [];
  casting.onCast = event => relays.push(event);
  cast();
  assert.equal(casting.state().auras.get('mana_spring').until, Infinity);
  casting.time = 5001;
  casting.state().auras.get('mana_spring').next = 5002;
  advance(1.1);
  assert.ok(aura(player, 'Mana_Spring'));
  cast();
  assert.equal(relays.length, 2);
  assert.ok(relays.every(e => e.id === spell.id));
});

test('the rune wheel exposes regeneration and toggle state; blue ripple geometry is finite and bounded', () => {
  const { casting, cast } = runeScene(spell);
  const stats = () => SpellControls.prototype.stats.call({ casting }, spell);
  assert.ok(stats().includes('+2 mana/s'));
  assert.ok(stats().includes('Cast to activate'));
  cast();
  assert.ok(stats().includes('Active - cast off'));
  for (const stage of ['cast', 'aura', 'pulse']) {
    const points = [];
    paintPresentation(spell.presentation, { x: 0, y: 0, stage, age: 0.3, life: 0.7, heading: 1.2 }, (...p) => points.push(p));
    assert.equal(points.length, 30);
    assert.ok(points.flatMap(p => [p[0], p[1], ...p[3], p[4]]).every(Number.isFinite));
  }
});
