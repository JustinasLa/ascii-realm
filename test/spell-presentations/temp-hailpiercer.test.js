import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/temp-hailpiercer.js';
import spell from '../../src/spells/definitions/temp-hailpiercer.js';
import { runeScene } from '../../test-support/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';
import { playSpellSound } from '../../src/audio/spells.js';

function draw(stage, progress = 0.3, age = progress * presentation.duration) {
  const points = [];
  presentation.draw({ stage, progress, age, life: presentation.duration, radius: 1, heading: 0 }, (...point) => points.push(point));
  return points;
}

test('Hailpiercer draws a thin barbed harpoon, then an expanding puncture ripple', () => {
  assert.equal(spell.presentation, presentation);
  const shaft = draw('projectile');
  assert.ok(shaft.some(p => p[2] === '^'), 'pointed harpoon nose');
  assert.ok(shaft.filter(p => p[0] === 0).length >= 12, 'long narrow spine');
  assert.ok(shaft.some(p => p[0] < 0 && p[2] === '/'));
  assert.ok(shaft.some(p => p[0] > 0 && p[2] === '\\'), 'paired swept shoulders');
  assert.ok(shaft.filter(p => p[2] === '.').every(p => p[1] < 0), 'hail wake trails behind the tip');
  const early = draw('impact', 0.1), late = draw('impact', 0.6);
  const rippleWidth = points => Math.max(...points.filter(p => p[2] === '-').map(p => Math.abs(p[0])));
  assert.ok(rippleWidth(late) > rippleWidth(early) * 2, 'puncture ring expands');
  assert.equal(early.filter(p => p[2] === '/' || p[2] === '\\').length, 4, 'small crossed puncture remains central');
  assert.notDeepEqual(draw('cast'), shaft);
  assert.notDeepEqual(shaft, early);
  assert.notDeepEqual(draw('cast', 0.1), draw('cast', 0.6), 'charge assembles and inhales hail');
  assert.notDeepEqual(draw('projectile', 0.3, 0.1), draw('projectile', 0.3, 0.2), 'wake moves during flight');
});

test('every Hailpiercer stage is deterministic, bounded, and fades completely', () => {
  for (const stage of ['cast', 'projectile', 'impact', 'pulse', 'zone', 'aura']) {
    for (const progress of [0, 0.2, 0.7, 0.99, 1]) {
      const points = draw(stage, progress);
      assert.deepEqual(points, draw(stage, progress));
      assert.ok(points.length > 0 && points.length <= 96);
      for (const [x, z, char, color, brightness] of points) {
        assert.ok([x, z, brightness, ...color].every(Number.isFinite));
        assert.ok(Math.abs(x) < 4 && Math.abs(z) < 4);
        assert.match(char, /^[\x20-\x7e]$/);
        assert.ok(color.every(c => c >= 0 && c <= 255));
        assert.ok(brightness >= 0 && brightness <= 1);
        if (progress === 1) assert.equal(brightness, 0);
      }
    }
  }
});

test('Hailpiercer sound pairs a low twang/high whizz with a pinpoint strike and diminishing rattle', () => {
  const { cast, impact, pulse } = presentation.sounds;
  assert.ok(cast.some(v => v.kind === 'tone' && v.frequency < 300 && v.endFrequency < v.frequency));
  assert.ok(cast.some(v => v.kind === 'tone' && v.frequency > 2000 && v.endFrequency > v.frequency));
  assert.ok(cast.some(v => v.kind === 'noise' && v.filterType === 'highpass'));
  assert.ok(impact.some(v => (v.delay ?? 0) === 0 && v.duration < 0.08), 'short pinpoint attack');
  const rattle = impact.filter(v => v.kind === 'noise' && v.delay > 0);
  assert.equal(rattle.length, 3);
  assert.ok(rattle.every((v, i) => !i || (v.delay > rattle[i - 1].delay && v.gain < rattle[i - 1].gain)), 'separate diminishing rattle grains');
  assert.ok(pulse.every(v => v.gain <= 0.025 && v.duration <= 0.08));
  for (const recipe of Object.values(presentation.sounds)) {
    assert.ok(recipe.length <= 8);
    assert.ok(recipe.every(v => v.gain <= 0.25 && v.duration <= 2.5 && (v.delay ?? 0) <= 2));
  }
  for (const stage of ['cast', 'impact', 'pulse']) {
    const fake = fakeRecordedAudio();
    const handles = playSpellSound(fake.engine, { stage, presentation, x: 3, y: 5 });
    assert.equal(handles.length, presentation.sounds[stage].length);
    assert.ok(fake.routes.every(r => r.bus === 'sfx' && r.x === 3 && r.y === 5));
    assert.deepEqual(fake.invalid, []);
    handles.forEach(handle => handle.stop());
  }
});

test('real Hailpiercer casts use the authored profile and spell cues while preserving the delayed damage', () => {
  const scene = runeScene(spell), events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  assert.equal(scene.cast().ok, false, 'second cast is rejected while charging');
  assert.equal(events.filter(e => e.stage === 'cast').length, 1);
  const launch = [];
  scene.casting.effects.paint((...p) => launch.push(p), scene.casting.projectiles);
  assert.ok(launch.some(p => p[2] === '^'), 'runtime renders the authored harpoon');
  scene.advance(0.5);
  assert.equal(scene.foe.health, 100, 'charge delay is preserved');
  scene.advance(4);
  assert.ok(scene.monsters.events.some(e => e.type === 'hurt' && e.amount === 20));
  const cues = events.filter(e => e.type === 'spell');
  assert.ok(cues.some(e => e.stage === 'impact'));
  assert.ok(cues.every(e => e.presentation === presentation));
  assert.ok(events.every(e => !['draw', 'slam'].includes(e.type)), 'spell never uses sword cues');
});
