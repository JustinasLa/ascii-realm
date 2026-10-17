import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/blessing-of-healing.js';
import spell from '../../src/spells/definitions/blessing-of-healing.js';
import { runeScene } from '../../test-support/spells.js';
import { playSpellSound } from '../../src/audio/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';

const draw = (stage, progress = 0.3, heading = 0) => {
  const points = [];
  presentation.draw({ stage, progress, age: progress * presentation.duration, life: presentation.duration, radius: 1, heading },
    (...point) => points.push(point));
  return points;
};

test('Blessing of Healing shelters a root rosette beneath a forked canopy and falling petals', () => {
  assert.equal(spell.presentation, presentation);
  const cast = draw('cast');
  const forks = cast.filter(p => p[2] === 'Y');
  assert.ok(forks.some(p => p[0] < 0) && forks.some(p => p[0] > 0), 'canopy branches on both sides');
  const flower = cast.filter(p => p[2] === '+');
  assert.ok(flower.length >= 6 && flower.every(p => p[1] < 0), 'small root rosette is below the canopy');
  const petals = cast.filter(p => p[2] === 'v');
  assert.ok(petals.length >= 5 && new Set(petals.map(p => p[1])).size > 3, 'petals fall separately');
  const early = draw('aura', 0.1).filter(p => p[2] === 'v');
  const later = draw('aura', 0.2).filter(p => p[2] === 'v');
  assert.ok(later.some((p, i) => p[1] < early[i][1]), 'droplets descend over time');
  const impact = draw('impact');
  assert.equal(impact.filter(p => p[2] === 'Y').length, 0, 'impact opens a flower instead of duplicating the canopy');
  assert.ok(impact.filter(p => p[2] === '(' || p[2] === ')').length >= 12);
  const bud = draw('projectile');
  assert.ok(bud.some(p => p[2] === 'v') && bud.filter(p => p[2] === '.').length >= 6, 'travelling petal bud has a pollen trail');
});

test('all stages remain finite, bounded, deterministic, animated and fade completely', () => {
  for (const stage of ['cast', 'impact', 'pulse', 'aura', 'zone', 'projectile']) {
    for (const progress of [0, 0.15, 0.5, 0.9, 1]) {
      const points = draw(stage, progress);
      assert.ok(points.length > 0 && points.length <= 96);
      assert.deepEqual(points, draw(stage, progress, Math.PI / 2), 'heading belongs to the shared adapter');
      for (const [x, z, char, color, brightness] of points) {
        assert.ok(Number.isFinite(x) && Number.isFinite(z) && Math.abs(x) < 3 && Math.abs(z) < 3);
        assert.match(char, /^[\x20-\x7e]$/);
        assert.ok(color.length === 3 && color.every(c => Number.isFinite(c) && c >= 0 && c <= 255));
        assert.ok(Number.isFinite(brightness) && brightness >= 0 && brightness <= 1);
        if (progress === 1) assert.equal(brightness, 0);
      }
    }
    assert.notDeepEqual(draw(stage, 0.1), draw(stage, 0.8));
  }
});

test('descending harp droplets lead to a major healing chord and round two-note resolve', () => {
  const { cast, impact, pulse } = presentation.sounds;
  assert.ok(cast.every(v => v.kind === 'tone' && v.attack < 0.01 && v.release > v.duration * 0.8));
  assert.ok(cast.slice(1).every((v, i) => v.frequency < cast[i].frequency && v.delay > cast[i].delay));
  assert.ok(cast[3].delay - cast[2].delay > cast[1].delay, 'droplet rhythm relaxes into the last note');
  const chord = impact.filter(v => !v.delay);
  assert.equal(chord.length, 3);
  assert.ok(Math.abs(chord[1].frequency / chord[0].frequency - 1.26) < 0.01);
  assert.ok(Math.abs(chord[2].frequency / chord[0].frequency - 1.5) < 0.01);
  const resolve = impact.filter(v => v.delay > 0);
  assert.ok(resolve.length === 2 && resolve[1].frequency < resolve[0].frequency);
  assert.ok(pulse.every(v => v.gain < 0.02 && v.duration < 0.2), 'repeating healing ticks remain quiet');
  for (const voices of Object.values(presentation.sounds)) {
    assert.ok(voices.length <= 8);
    for (const voice of voices) {
      assert.ok(voice.gain > 0 && voice.gain <= 0.25 && voice.duration <= 2.5 && (voice.delay ?? 0) <= 2);
    }
  }
  const fake = fakeRecordedAudio();
  const handles = playSpellSound(fake.engine, { stage: 'cast', presentation, x: 3, y: 4 });
  assert.equal(handles.length, cast.length);
  assert.ok(fake.routes.every(r => r.bus === 'sfx' && r.x === 3 && r.y === 4));
  assert.deepEqual(fake.invalid, []);
  handles.forEach(h => h.stop());
});

test('real channel cast renders its profile and emits typed healing cues without sword sounds', () => {
  const scene = runeScene(spell, { range: 15, allyInPath: true }), events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  assert.ok(events.some(e => e.type === 'spell' && e.stage === 'cast' && e.presentation === presentation));
  assert.ok(scene.casting.effects.list.some(e => e.stage === 'cast' && e.presentation === presentation));
  const dots = [];
  scene.casting.effects.paint((...p) => dots.push(p), scene.casting.projectiles);
  assert.ok(dots.some(p => p[2] === 'Y') && dots.some(p => p[2] === 'v'));
  scene.advance(2.2);
  assert.ok(scene.ally.vitals.health >= 44, 'original healing continues');
  assert.ok(scene.casting.mana < 87, 'original channel mana drain continues');
  assert.ok(events.some(e => e.type === 'spell' && e.stage === 'impact'));
  assert.ok(events.some(e => e.type === 'spell' && e.stage === 'pulse'));
  assert.ok(events.every(e => !['draw', 'slam'].includes(e.type)));
  assert.ok(events.filter(e => e.type === 'spell').every(e => e.presentation === presentation));
});
