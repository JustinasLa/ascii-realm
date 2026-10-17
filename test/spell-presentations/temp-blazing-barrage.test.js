import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/temp-blazing-barrage.js';
import spell from '../../src/spells/definitions/temp-blazing-barrage.js';
import { runeScene } from '../../test-support/spells.js';

function frame(stage, progress, radius = 1) {
  const points = [];
  const effect = Object.freeze({ stage, progress, age: progress * presentation.duration,
    life: presentation.duration, radius, heading: 0.72 });
  presentation.draw(effect, (x, z, char, color, brightness = 1) =>
    points.push({ x, z, char, color, brightness }));
  return points;
}

test('Blazing Barrage opts into a deterministic, bounded presentation for every effect stage', () => {
  assert.equal(spell.presentation, presentation);
  assert.equal(presentation.id, spell.id);
  for (const stage of ['cast', 'impact', 'projectile', 'pulse', 'aura', 'zone']) {
    for (const progress of [0, 0.15, 0.4, 0.7, 0.94, 1]) {
      const points = frame(stage, progress, 40);
      assert.ok(points.length <= 96, `${stage} remains within the glyph budget`);
      if (progress < 1) assert.ok(points.length > 0, `${stage} has visible geometry`);
      else assert.equal(points.length, 0, `${stage} fades to nothing`);
      for (const p of points) {
        assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z));
        assert.ok(Math.abs(p.x) < 7 && Math.abs(p.z) < 7, 'large radii remain readable');
        assert.match(p.char, /^[\x20-\x7e]$/);
        assert.equal(p.color.length, 3);
        assert.ok(p.color.every(c => Number.isFinite(c) && c >= 0 && c <= 255));
        assert.ok(Number.isFinite(p.brightness) && p.brightness >= 0 && p.brightness <= 1);
      }
      assert.deepEqual(points, frame(stage, progress, 40));
    }
  }
});

test('cast alternates six muzzles, advances staggered bolts, then opens a broad fireblast', () => {
  const first = frame('cast', 0.15);
  const volley = frame('cast', 0.34);
  const heads = volley.filter(p => p.char === '*');
  assert.ok(heads.some(p => p.x < 0) && heads.some(p => p.x > 0), 'bolts fire from alternating sides');
  assert.ok(heads.length > first.filter(p => p.char === '*').length, 'multiple live shots overlap');
  assert.ok(Math.max(...heads.map(p => p.z)) > Math.max(...first.filter(p => p.char === '*').map(p => p.z)),
    'earlier rounds travel ahead of later rounds');
  assert.equal(first.filter(p => p.char === '#').length, 12, 'each of six muzzles has two rails');
  const final = frame('cast', 0.93);
  assert.ok(final.some(p => p.char === '^'), 'final blast has a toothed bowed front');
  assert.ok(Math.max(...final.map(p => p.x)) - Math.min(...final.map(p => p.x)) > 3,
    'fireblast spans the full barrel fan');
  assert.notDeepEqual(frame('cast', 0.4), frame('impact', 0.4), 'impact resolves into its own outward burst');
  const projectile = frame('projectile', 0.4);
  assert.ok(projectile.some(p => p.char === '*') && projectile.some(p => p.z < -0.6),
    'travelling rounds retain a hot nose and a trailing ember wake');
  const light = points => points.reduce((sum, p) => sum + p.brightness, 0);
  assert.ok(light(frame('impact', 0.97)) < light(frame('impact', 0.7)), 'late flames fade cleanly');
});

test('sound uses six clipped fireball pops and a delayed emphatic low blast', () => {
  const pops = presentation.sounds.cast.slice(0, 6);
  assert.ok(pops.every(p => p.kind === 'tone' && p.duration < 0.1 && p.endFrequency < p.frequency));
  for (let i = 1; i < pops.length; i++) {
    assert.ok(Math.abs(pops[i].delay - pops[i - 1].delay - 0.15) < 1e-8, 'shots follow the gameplay rhythm');
    assert.notEqual(pops[i].type, pops[i - 1].type, 'alternating barrel timbres');
  }
  const blast = presentation.sounds.cast.slice(6);
  assert.ok(blast.some(v => v.kind === 'noise') && blast.some(v => v.endFrequency < 50));
  assert.ok(blast.every(v => v.delay > pops.at(-1).delay && v.duration > pops[0].duration));
  assert.ok(presentation.sounds.impact.some(v => v.kind === 'noise' && v.filterType === 'highpass'),
    'impact includes a short ember fizz after the attack');
  for (const voices of Object.values(presentation.sounds)) {
    assert.ok(voices.length > 0 && voices.length <= 8);
    for (const v of voices) {
      assert.ok(v.gain > 0 && v.gain <= 0.25);
      assert.ok(v.duration > 0 && v.duration <= 2.5);
      assert.ok(v.delay >= 0 && v.delay <= 2);
      assert.ok(v.attack > 0 && v.release > 0 && v.attack + v.release <= v.duration);
    }
  }
});

test('real casts render the barrage profile and emit its typed cast/impact cues', () => {
  const scene = runeScene(spell, { range: 6 }), sounds = [];
  scene.casting.onSound = cue => sounds.push(cue);
  assert.equal(scene.cast().ok, true);
  assert.equal(scene.cast().ok, false, 'cooldown rejects a second cast');
  assert.equal(sounds.filter(cue => cue.stage === 'cast').length, 1);
  assert.ok(scene.casting.effects.list.some(effect => effect.stage === 'cast' && effect.presentation === presentation));

  scene.advance(0.4);
  assert.ok(scene.casting.projectiles.length > 0, 'source graph launches real fireballs');
  const stationary = [], moving = [];
  scene.casting.effects.paint((...point) => stationary.push(point));
  scene.casting.effects.paint((...point) => moving.push(point), scene.casting.projectiles);
  const rounds = moving.slice(stationary.length);
  assert.ok(rounds.length > scene.casting.projectiles.length, 'each projectile draws its authored silhouette and trail');
  assert.ok(rounds.some(point => point[2] === ':') && rounds.some(point => point[2] === '/'),
    'runtime paints the barrage ember wake and angled shoulders');

  scene.advance(4);
  assert.ok(scene.foe.health < 100, 'presentation preserves barrage damage');
  assert.ok(sounds.some(cue => cue.type === 'spell' && cue.stage === 'impact'));
  assert.ok(sounds.every(cue => cue.type === 'spell' && cue.spellId === spell.id && cue.presentation === presentation),
    'casts and hits use typed spell cues instead of sword draw/slam sounds');
});
