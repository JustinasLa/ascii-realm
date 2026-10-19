import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/temp-earth-spike.js';
import spell from '../../src/spells/definitions/temp-earth-spike.js';
import { runeScene } from '../../test-support/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';
import { playSpellSound } from '../../src/audio/spells.js';

function draw(stage, progress) {
  const points = [];
  presentation.draw({ stage, age: progress * presentation.duration, life: presentation.duration,
    progress, radius: 2, heading: 0 }, (...point) => points.push(point));
  return points;
}

test('Earth Spike opts into its tiered stone presentation and stays finite and bounded in every stage', () => {
  assert.equal(spell.presentation, presentation);
  assert.equal(presentation.id, spell.id);
  for (const stage of ['cast', 'impact', 'pulse', 'aura', 'zone', 'projectile']) {
    for (const progress of [0, 0.14, 0.5, 0.9, 1]) {
      const points = draw(stage, progress);
      assert.ok(points.length >= 15 && points.length <= 96);
      for (const [x, z, char, color, brightness] of points) {
        assert.ok([x, z, brightness, ...color].every(Number.isFinite));
        assert.ok(Math.abs(x) <= 4 && Math.abs(z) <= 4);
        assert.match(char, /^[\x20-\x7e]$/);
        assert.ok(color.every(c => c >= 0 && c <= 255));
        assert.ok(brightness >= 0 && brightness <= 1);
        if (progress === 1) assert.equal(brightness, 0, `${stage} fades completely`);
      }
    }
  }
});

test('Earth Spike grows three ledged stone tiers, throws dirt, and curls leaves before a cracked impact', () => {
  const early = draw('cast', 0.03), risen = draw('cast', 0.4), impact = draw('impact', 0.4);
  const tips = points => points.filter(p => p[2] === '^');
  assert.equal(tips(risen).length, 3, 'three visible stone tips');
  assert.equal(risen.filter(p => p[2] === '_').length, 6, 'each tier has a pair of ledges');
  assert.ok(Math.max(...tips(risen).map(p => p[1])) > Math.max(...tips(early).map(p => p[1])) + 1);
  assert.ok(risen.some(p => p[2] === '(') && risen.some(p => p[2] === ')'), 'paired leaf curls');
  assert.ok(risen.some(p => p[2] === '.' && Math.abs(p[0]) > 0.4), 'displaced soil');
  assert.ok(Math.max(...impact.map(p => Math.abs(p[0]))) > Math.max(...risen.map(p => Math.abs(p[0]))), 'impact cracks spread past the outcrop');
  assert.notDeepEqual(impact, risen);
  const projectile = draw('projectile', 0.4);
  assert.equal(tips(projectile).length, 3, 'travelling fissure retains compact tiered silhouette');
  assert.ok(projectile.some(p => p[1] < -1 && p[2] === '.'), 'soil wake trails the moving tip');
});

test('Earth Spike has a soil rise, separated rock cracks, compact descending strike and quiet tick recipe', () => {
  const { cast, impact, pulse } = presentation.sounds;
  assert.ok(cast.some(v => v.kind === 'noise' && v.filterType === 'lowpass' && v.attack >= 0.05));
  const cracks = cast.filter(v => v.kind === 'noise' && v.filterType === 'bandpass');
  assert.equal(cracks.length, 2);
  assert.ok(cracks[1].delay - cracks[0].delay >= 0.1, 'two distinct cracks follow the rumble');
  assert.ok(impact.some(v => v.kind === 'tone' && v.frequency > v.endFrequency && v.endFrequency < 50));
  assert.ok(pulse.every(v => v.gain < 0.025 && v.duration <= 0.1), 'travelling pulses remain quiet');
  for (const [stage, recipe] of Object.entries(presentation.sounds)) {
    assert.ok(recipe.length > 0 && recipe.length <= 8);
    assert.ok(recipe.every(v => v.gain > 0 && v.gain <= 0.25 && v.duration > 0 && v.duration <= 2.5 && (v.delay ?? 0) <= 2));
    const audio = fakeRecordedAudio();
    const handles = playSpellSound(audio.engine, { stage, presentation, x: 2, y: 3 });
    assert.equal(handles.length, recipe.length, `${stage} schedules every authored layer`);
    assert.ok(audio.routes.every(r => r.bus === 'sfx' && r.x === 2 && r.y === 3));
    assert.deepEqual(audio.invalid, []);
    for (const handle of handles) handle.stop();
  }
});

test('real Earth Spike cast renders its profile, emits typed cues and preserves damaging lift without sword sounds', () => {
  const scene = runeScene(spell), events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  assert.equal(scene.cast().ok, false, 'cooldown rejects a second cast');
  assert.equal(events.filter(e => e.type === 'spell' && e.stage === 'cast').length, 1);
  const points = [];
  scene.casting.effects.paint((...p) => points.push(p), scene.casting.projectiles);
  assert.ok(points.some(p => p[2] === '_') && points.some(p => p[2] === '^'), 'runtime paints authored ledges and tips');
  scene.advance(0.8);
  assert.ok(scene.foe.health <= 88 && scene.foe.magicLift > 0, 'TF damage and lifting fissure remain intact');
  assert.ok(events.some(e => e.type === 'spell' && e.stage === 'impact'));
  assert.ok(events.some(e => e.type === 'spell' && e.stage === 'pulse'));
  assert.ok(events.every(e => e.type === 'spell' && e.presentation === presentation));
  assert.ok(events.every(e => !['draw', 'slam'].includes(e.type)));
});
