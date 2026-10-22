import assert from 'node:assert/strict';
import test from 'node:test';
import spell from '../../src/spells/definitions/lightning.js';
import { mitlan } from '../../src/spells/elements/mitlan.js';
import { runeScene } from '../../test-support/spells.js';
import { Monster, toCells } from '../../src/entities/monsters.js';

// A foe `metres` down the screen from the caster, `across` metres to the side.
function addFoe(scene, metres, across = 0) {
  const foe = new Monster(...toCells(across, metres), { risen: true });
  foe.health = foe.maxHealth = 100;
  scene.monsters.list.push(foe);
  scene.casting.sync();
  return foe;
}
function watch(scene) {
  const strikes = [];
  scene.casting.onLightning = point => strikes.push({ x: point.x, y: point.y });
  return strikes;
}
const arcs = scene => scene.casting.effects.list.filter(e => e.stage === 'pulse' && e.shape === 'chain');

test('Lightning is a Mitlan rune that strikes the target after a short charge and stuns it', () => {
  assert.ok(mitlan.includes(spell.id));
  assert.equal(spell.element, 'mitlan');
  const scene = runeScene(spell, { range: 6 }), { casting, foe, advance, cast, potion } = scene;
  const strikes = watch(scene);
  assert.equal(cast().ok, true);
  assert.equal(casting.mana, 93);
  advance(0.5);
  assert.equal(foe.health, 100, 'the charge ring gives a moment to step out');
  assert.equal(strikes.length, 0);
  advance(0.15);
  assert.equal(foe.health, 82);
  assert.ok(potion(foe, 'stun'));
  assert.deepEqual(strikes, [{ x: foe.x, y: foe.y }]);
  assert.equal(arcs(scene).length, 0, 'nothing to chain to');
  advance(0.6);
  assert.equal(foe.magicStunned, false);
});

test('one bolt strikes one foe; the rest of a cluster take chained lightning for half damage', () => {
  const scene = runeScene(spell, { range: 6 }), { foe, player, advance, cast, potion } = scene;
  const inRing = addFoe(scene, 8);        // 2 m from the strike, inside the ring
  const hop = addFoe(scene, 10.5);        // outside the ring, 2.5 m from inRing
  const alone = addFoe(scene, 14.5);      // 4 m from the nearest foe
  const strikes = watch(scene);
  cast();
  advance(0.65);
  assert.deepEqual(strikes, [{ x: foe.x, y: foe.y }], 'a single bolt, on the foe nearest the strike point');
  assert.equal(foe.health, 82);
  advance(0.25);
  assert.ok(potion(foe, 'stun') && !potion(inRing, 'stun') && !potion(hop, 'stun'), 'only the bolt stuns');
  advance(0.25);
  assert.equal(strikes.length, 1);
  assert.equal(inRing.health, 91);
  assert.equal(hop.health, 91, 'the chain carries on to foes close to the last one struck');
  assert.equal(alone.health, 100, 'too far from everyone to be reached');
  assert.equal(player.vitals.health, 60, 'never the caster');
});

test('the chain leaps link by link, nearest first', () => {
  const scene = runeScene(spell, { range: 6 }), { advance, cast } = scene;
  const second = addFoe(scene, 7.5), third = addFoe(scene, 9.5);
  cast();
  advance(0.62);
  assert.equal(second.health, 100, 'chained hops follow the strike rather than land with it');
  advance(0.1);
  assert.equal(second.health, 91);
  assert.equal(third.health, 100);
  advance(0.1);
  assert.equal(third.health, 91);
  const [first, next] = arcs(scene);
  assert.ok(first.radius > 1.4 && first.radius < 1.6 && Math.abs(first.heading) < 1e-9, 'an arc runs from foe to foe');
  assert.equal(next.x, second.x);
  assert.equal(next.y, second.y);
});

test('anything inside the ring is chained even when it is far from the other foes', () => {
  const scene = runeScene(spell, { range: 4 }), { foe, advance, cast } = scene;
  const opposite = addFoe(scene, 8.4);    // 4.4 m from foe, 2.4 m from the strike point
  const strikes = watch(scene);
  const aim = { x: 0, y: toCells(0, 6)[1] };
  cast({ target: null, aim });
  advance(1);
  assert.deepEqual(strikes, [{ x: foe.x, y: foe.y }], 'the bolt snaps to the foe nearest the aimed point');
  assert.equal(foe.health, 82);
  assert.equal(opposite.health, 91);
});

test('Lightning falls on the aimed ground when nothing is inside the ring', () => {
  const scene = runeScene(spell, { range: 10 }), { foe, advance, cast } = scene;
  const strikes = watch(scene);
  const aim = { x: 0, y: toCells(0, 3)[1] };
  cast({ target: null, aim });
  advance(0.7);
  assert.deepEqual(strikes, [aim]);
  assert.equal(foe.health, 100);
});
