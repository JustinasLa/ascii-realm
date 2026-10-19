import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/fire-breath.js';
import spell from '../../src/spells/definitions/fire-breath.js';
import { runeScene } from '../../test-support/spells.js';

function capture(stage, progress, extra = {}) {
  const points = [];
  const effect = Object.freeze({ stage, age: progress * presentation.duration,
    life: presentation.duration, progress, radius: 1.2, heading: 0, ...extra });
  presentation.draw(effect, (x, z, char, color, brightness = 1) => {
    points.push({ x, z, char, color, brightness });
  });
  return points;
}

const width = points => Math.max(...points.map(point => point.x)) - Math.min(...points.map(point => point.x));

test('Fire Breath opts into a forward cone of separate flame tongues and rolling heat', () => {
  assert.equal(spell.presentation, presentation);
  assert.equal(presentation.id, spell.id);
  const early = capture('cast', 0.06), full = capture('cast', 0.43);
  assert.ok(full.every(point => point.z > 0), 'the exhalation stays ahead of the caster');
  const near = full.filter(point => point.z < 2);
  const far = full.filter(point => point.z > 3.5);
  assert.ok(width(far) > width(near) * 1.5, 'the silhouette widens with distance');
  assert.ok(width(full) > width(early) * 1.4, 'the breath unfurls over time');
  assert.equal(full.filter(point => point.char === '^').length, 7, 'each separated tongue has a visible tip');
  assert.ok(full.some(point => point.char === '-') && full.some(point => point.char === ','));
  assert.notDeepEqual(full, capture('cast', 0.62), 'licks and heat combs keep moving');
  assert.deepEqual(full, capture('cast', 0.43, { heading: 2 }), 'world rotation belongs to the renderer');
});

test('Fire Breath has a compact travelling flame, charred impact and safe fading across stages', () => {
  const projectile = capture('projectile', 0.3);
  assert.ok(projectile.some(point => point.z > 0 && point.char === '^'));
  assert.ok(projectile.some(point => point.z < -0.5 && point.char === '.'));
  assert.ok(width(projectile) < 1, 'the moving flame stays compact');
  const impact = capture('impact', 0.6);
  assert.ok(impact.some(point => point.z < 0) && impact.some(point => point.z > 0));
  assert.ok(impact.some(point => point.char === "'") && impact.some(point => point.color[0] < 160));
  assert.notDeepEqual(impact, capture('cast', 0.6));
  for (const stage of ['cast', 'impact', 'pulse', 'aura', 'zone', 'projectile']) {
    for (const progress of [0, 0.2, 0.5, 0.96]) {
      const points = capture(stage, progress);
      assert.ok(points.length > 0 && points.length <= 96);
      for (const point of points) {
        assert.ok([point.x, point.z, point.brightness, ...point.color].every(Number.isFinite));
        assert.ok(Math.abs(point.x) <= 7 && Math.abs(point.z) <= 7);
        assert.match(point.char, /^[\x21-\x7e]$/);
        assert.ok(point.color.every(channel => channel >= 0 && channel <= 255));
        assert.ok(point.brightness >= 0 && point.brightness <= 1);
      }
    }
    assert.ok(Math.max(...capture(stage, 0.96).map(point => point.brightness)) < 0.2);
    assert.deepEqual(capture(stage, 1), [], 'finished effects leave no persistent marks');
  }
  assert.deepEqual(capture('cast', 0.35), capture('cast', 0.35), 'rendering is deterministic');
});

test('Fire Breath exhales overlapping air bursts over chest rumble and breaks into dry crackle', () => {
  const { cast, impact, pulse } = presentation.sounds;
  const breaths = cast.filter(voice => voice.kind === 'noise' && voice.delay > 0);
  assert.ok(breaths.length >= 3 && breaths.every(voice => voice.attack >= 0.05));
  assert.ok(breaths.slice(1).every((voice, index) => voice.delay < breaths[index].delay + breaths[index].duration));
  assert.ok(cast.some(voice => voice.kind === 'tone' && voice.frequency < 100 && voice.endFrequency < voice.frequency));
  assert.ok(new Set(breaths.map(voice => voice.cutoff)).size >= 3, 'air bursts broaden as the cone opens');
  assert.ok(impact.filter(voice => voice.kind === 'noise').every(voice => voice.duration <= 0.16 && voice.attack <= 0.003));
  assert.ok(impact.some(voice => voice.delay > 0.1), 'crackle has a distinct staggered tail');
  assert.ok(pulse.every(voice => voice.gain <= 0.02 && voice.duration <= 0.12));
  for (const sequence of Object.values(presentation.sounds)) {
    assert.ok(sequence.length > 0 && sequence.length <= 8);
    for (const voice of sequence) {
      assert.ok(['tone', 'noise'].includes(voice.kind));
      assert.ok(voice.gain > 0 && voice.gain <= 0.25);
      assert.ok(voice.delay >= 0 && voice.delay <= 2);
      assert.ok(voice.duration > 0 && voice.duration <= 2.5);
      assert.ok(voice.attack > 0 && voice.attack + voice.release <= voice.duration);
    }
  }
});

test('real Fire Breath casts paint the authored profile and emit typed breath cues', () => {
  const scene = runeScene(spell), cues = [];
  scene.casting.onSound = cue => cues.push(cue);
  assert.equal(scene.cast().ok, true);
  const count = cues.length;
  assert.equal(scene.cast().ok, false, 'cooldown rejection stays silent');
  assert.equal(cues.length, count);
  const castEffect = scene.casting.effects.list.find(effect => effect.stage === 'cast');
  assert.equal(castEffect.presentation, presentation);
  assert.equal(castEffect.life, presentation.duration);
  const points = [];
  scene.casting.effects.paint((...point) => points.push(point));
  assert.ok(points.some(point => point[2] === '^') && points.some(point => point[2] === '-'),
    'the real effect stream contains flame tips and heat combs');
  scene.advance(0.2);
  assert.equal(scene.foe.health, 94);
  assert.equal(cues.filter(cue => cue.stage === 'cast').length, 1);
  assert.ok(cues.some(cue => cue.stage === 'impact'));
  assert.ok(cues.every(cue => cue.type === 'spell' && cue.spellId === spell.id && cue.presentation === presentation),
    'casts and burn hits use the Fire Breath profile instead of weapon cues');
  scene.advance(4.5);
  assert.equal(scene.foe.health, 76, 'the four original six-damage burn pulses remain intact');
});
