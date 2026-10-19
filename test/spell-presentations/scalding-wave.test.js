import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/scalding-wave.js';
import spell from '../../src/spells/definitions/scalding-wave.js';
import { paintPresentation } from '../../src/spells/presentation.js';
import { playSpellSound } from '../../src/audio/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';
import { runeScene } from '../../test-support/spells.js';

const draw = (stage, progress) => {
  const points = [];
  const effect = Object.freeze({ stage, progress, age: progress * presentation.duration,
    life: presentation.duration, radius: 1.5, heading: 0 });
  presentation.draw(effect, (...point) => points.push(point));
  return points;
};

test('Scalding Wave renders a moving crest, steam columns, and boiling fringe', () => {
  assert.equal(spell.presentation, presentation);
  const early = draw('cast', 0.1), late = draw('cast', 0.55), impact = draw('impact', 0.3);
  const crest = points => points.filter(p => p[2] === '~' && p[3][0] < 200);
  const front = points => crest(points).reduce((sum, p) => sum + p[1], 0) / crest(points).length;
  assert.ok(front(late) > front(early), 'the water front travels forward');
  assert.ok(late.filter(p => p[2] === ':').length >= 9, 'three separate steam columns');
  assert.ok(late.some(p => p[2] === 'o' && p[3][0] > p[3][2]), 'warm boiling beads');
  assert.ok(crest(late).some(p => p[0] < -0.5) && crest(late).some(p => p[0] > 0.5), 'wide crest');
  assert.notDeepEqual(late, impact, 'impact breaks into a splash fan');
  assert.ok(impact.filter(p => p[2] === 'o').length > late.filter(p => p[2] === 'o').length);
  assert.ok(draw('projectile', 0.3).some(p => p[1] < -0.5), 'compact travelling silhouette has a wet wake');
});

test('all Scalding Wave stages are deterministic, bounded, evolving, and fade out', () => {
  for (const stage of ['cast', 'impact', 'pulse', 'aura', 'zone', 'projectile']) {
    for (const progress of [0, 0.25, 0.7, 1]) {
      const points = draw(stage, progress);
      assert.ok(points.length > 10 && points.length <= 96, `${stage} stays within its plot budget`);
      assert.deepEqual(points, draw(stage, progress));
      for (const [x, z, char, color, brightness] of points) {
        assert.ok([x, z, brightness, ...color].every(Number.isFinite));
        assert.ok(Math.abs(x) < 5 && Math.abs(z) < 5);
        assert.match(char, /^[\x20-\x7e]$/);
        assert.ok(color.every(c => c >= 0 && c <= 255));
        assert.ok(brightness >= 0 && brightness <= 1);
        if (progress === 1) assert.equal(brightness, 0);
      }
    }
    assert.notDeepEqual(draw(stage, 0.1), draw(stage, 0.6));
  }
});

test('Scalding Wave layers hot hiss and bubbling under a sharp impact steam release', () => {
  const { cast, impact, pulse } = presentation.sounds;
  assert.ok(cast.some(v => v.kind === 'noise' && v.filterType === 'highpass' && v.attack >= 0.05));
  assert.ok(cast.some(v => v.kind === 'noise' && v.cutoff < 400), 'low bubbling texture');
  const bubbles = cast.filter(v => v.kind === 'tone');
  assert.ok(bubbles.length >= 2 && bubbles[0].delay !== bubbles[1].delay);
  assert.ok(bubbles.every(v => v.type === 'sine' && v.frequency > v.endFrequency));
  assert.ok(impact.some(v => v.kind === 'noise' && v.cutoff > 5000 && v.attack < 0.005), 'sharp pressure release');
  assert.ok(impact.some(v => v.release > 0.2), 'steam tail');
  assert.notDeepEqual(cast, impact);
  assert.ok(pulse.every(v => v.gain <= 0.025 && v.duration < 0.1), 'repeated simmer stays quiet');
  for (const [stage, recipe] of Object.entries(presentation.sounds)) {
    assert.ok(recipe.length > 0 && recipe.length <= 8);
    for (const voice of recipe) {
      assert.ok(voice.gain > 0 && voice.gain <= 0.25);
      assert.ok(voice.duration > 0 && voice.duration <= 2.5);
      assert.ok((voice.delay ?? 0) >= 0 && (voice.delay ?? 0) <= 2);
    }
    const fake = fakeRecordedAudio();
    const handles = playSpellSound(fake.engine, { stage, presentation, x: 2, y: 4 });
    assert.equal(handles.length, recipe.length);
    assert.ok(fake.routes.every(route => route.bus === 'sfx' && route.x === 2 && route.y === 4));
    assert.deepEqual(fake.invalid, []);
    for (const handle of handles) handle.stop();
    assert.ok(fake.routes.every(route => route.disposals === 1));
  }
});

test('real Scalding Wave cast uses authored profile and typed cues while retaining TF burn', () => {
  const scene = runeScene(spell), events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  assert.equal(scene.cast().ok, false, 'cooldown rejects a duplicate cast');
  assert.equal(events.filter(e => e.stage === 'cast').length, 1);
  assert.ok(events.some(e => e.stage === 'impact'), 'burn aura emits impact steam release');
  assert.ok(events.every(e => e.type === 'spell' && e.presentation === presentation && e.spellId === spell.id));
  assert.ok(events.every(e => !['draw', 'slam'].includes(e.type)));
  assert.ok(scene.casting.effects.list.every(e => e.presentation === presentation));
  const rendered = [], expected = [];
  scene.casting.effects.paint((...p) => rendered.push(p), scene.casting.projectiles);
  for (const effect of scene.casting.effects.list) paintPresentation(presentation, effect, (...p) => expected.push(p));
  assert.deepEqual(rendered, expected, 'the real effects renderer consumes the authored geometry');
  assert.ok(rendered.some(p => p[2] === ':') && rendered.some(p => p[2] === 'o'));
  scene.advance(4);
  assert.equal(scene.foe.health, 85, 'three original five-damage burn pulses');
});
