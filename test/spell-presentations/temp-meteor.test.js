import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/temp-meteor.js';
import spell from '../../src/spells/definitions/temp-meteor.js';
import { runeScene } from '../../test-support/spells.js';

function capture(stage, progress, radius = 3) {
  const points = [];
  const effect = Object.freeze({ stage, progress, age: progress, life: 1, radius, heading: 0.7 });
  presentation.draw(effect, (x, z, char, color, brightness) => points.push({ x, z, char, color, brightness }));
  return points;
}

test('Meteor opts into its presentation while retaining its delayed gameplay graph', () => {
  assert.equal(spell.presentation, presentation);
  assert.equal(presentation.id, spell.id);
  assert.equal(spell.nodes.temp_meteor.steps[0].op, 'delay');
  assert.equal(spell.nodes.temp_meteor.steps[1].args.mob, 'Meteor');
  assert.deepEqual(spell.variants[0].params, { cooldown: 10, mana: 4, damage: 10 });
});

test('real Meteor casts render the profile and emit typed spell cues through impact', () => {
  const { casting, cast, advance, foe } = runeScene(spell);
  const cues = [];
  casting.onSound = cue => cues.push(cue);
  assert.equal(cast().ok, true);
  const castEffect = casting.effects.list.find(effect => effect.stage === 'cast');
  assert.equal(castEffect.presentation, presentation);
  assert.equal(castEffect.life, presentation.duration);
  assert.ok(cues.some(cue => cue.type === 'spell' && cue.stage === 'cast'
    && cue.spellId === spell.id && cue.presentation === presentation));
  const points = [];
  casting.effects.paint((x, z, char) => points.push({ x, z, char }), casting.projectiles);
  assert.ok(points.some(point => point.char === '@'), 'runtime paints the faceted meteor core');
  assert.ok(points.some(point => point.char === '.'), 'runtime paints its molten tail');
  advance(0.55);
  assert.ok(casting.projectiles.some(projectile => projectile.ctx.spell.presentation === presentation));
  advance(1.8);
  assert.equal(foe.health, 90);
  assert.ok(cues.some(cue => cue.type === 'spell' && cue.stage === 'impact'
    && cue.presentation === presentation));
  assert.ok(!cues.some(cue => cue.type === 'draw' || cue.type === 'slam'), 'spell uses its own cues instead of generic sword cues');
});

test('Meteor descends diagonally with a broken tail and keeps a compact projectile silhouette', () => {
  const early = capture('cast', 0.1), late = capture('cast', 0.6);
  const earlyCore = early.find(point => point.char === '@');
  const lateCore = late.find(point => point.char === '@');
  assert.ok(lateCore.x > earlyCore.x && lateCore.z > earlyCore.z, 'the core falls toward the origin');
  assert.ok(early.filter(point => point.char === '.').every(point => point.x < earlyCore.x && point.z < earlyCore.z), 'tail trails behind the fall');
  assert.notDeepEqual(early, late, 'fall and tail move with time');
  const projectile = capture('projectile', 0.3);
  assert.ok(projectile.some(point => point.char === '@'));
  assert.ok(projectile.some(point => point.char === '/') && projectile.some(point => point.char === '\\'));
  assert.ok(projectile.filter(point => point.char === '.').length >= 4);
  assert.ok(Math.max(...projectile.map(point => Math.hypot(point.x, point.z))) < 2.5);
});

test('Meteor impact forms a broad double crater rim with airborne rock debris', () => {
  const early = capture('impact', 0.1), middle = capture('impact', 0.5);
  const rimWidth = points => Math.max(...points.filter(point => point.char === '-').map(point => Math.abs(point.x)));
  assert.ok(rimWidth(middle) > rimWidth(early), 'crater shock front expands');
  assert.ok(middle.filter(point => point.char === '=').length >= 6, 'inner crater remains distinct');
  assert.ok(middle.some(point => point.char === '^' && point.z < -1), 'chips lift above the crater');
  assert.ok(middle.some(point => point.x < -2) && middle.some(point => point.x > 2));
  assert.ok(!middle.some(point => point.char === '@'), 'impact resolves the falling body into rubble');
});

test('Meteor remains deterministic, bounded and fades out in every supported stage', () => {
  for (const stage of ['cast', 'projectile', 'impact', 'pulse', 'aura', 'zone']) {
    for (const progress of [0, 0.2, 0.6, 0.98]) {
      const points = capture(stage, progress, 100);
      assert.ok(points.length > 0 && points.length <= 96);
      assert.deepEqual(capture(stage, progress, 100), points);
      for (const point of points) {
        assert.ok(Number.isFinite(point.x) && Number.isFinite(point.z));
        assert.match(point.char, /^[ -~]$/);
        assert.equal(point.color.length, 3);
        assert.ok(point.color.every(channel => Number.isFinite(channel) && channel >= 0 && channel <= 255));
        assert.ok(Number.isFinite(point.brightness) && point.brightness >= 0 && point.brightness <= 1);
        assert.ok(Math.hypot(point.x, point.z) < 15);
      }
    }
    assert.ok(Math.max(...capture(stage, 0.98).map(point => point.brightness)) < 0.1);
    assert.deepEqual(capture(stage, 1), []);
  }
});

test('Meteor sound has a rushing downward growl, dual detonation and spaced stone taps', () => {
  const { cast, impact, pulse } = presentation.sounds;
  const growls = cast.filter(voice => voice.kind === 'tone');
  assert.ok(growls.length >= 2 && growls.every(voice => voice.endFrequency < voice.frequency));
  assert.ok(cast.some(voice => voice.kind === 'noise' && voice.attack >= 0.1), 'rush builds under the growl');
  const bass = impact.filter(voice => voice.kind === 'tone' && voice.delay === 0);
  assert.equal(bass.length, 2);
  assert.notEqual(bass[0].type, bass[1].type);
  assert.ok(bass.every(voice => voice.endFrequency < 40 && voice.attack < 0.01));
  const taps = impact.filter(voice => voice.delay > 0);
  assert.ok(taps.length >= 3);
  assert.ok(taps.every((voice, i) => i === 0 || voice.delay > taps[i - 1].delay));
  assert.ok(taps.every(voice => voice.duration <= 0.1), 'debris is short percussive taps');
  assert.ok(pulse.every(voice => voice.gain < 0.02 && voice.duration < 0.2));
  for (const sequence of Object.values(presentation.sounds)) {
    assert.ok(sequence.length <= 8);
    for (const voice of sequence) {
      assert.ok(['tone', 'noise'].includes(voice.kind));
      assert.ok(voice.gain > 0 && voice.gain <= 0.25);
      assert.ok(voice.duration > 0 && voice.duration <= 2.5);
      assert.ok(voice.delay >= 0 && voice.delay <= 2);
      assert.ok(voice.attack > 0 && voice.release > 0 && voice.attack + voice.release <= voice.duration);
    }
  }
});
