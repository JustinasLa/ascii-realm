import assert from 'node:assert/strict';
import test from 'node:test';
import profile from '../../src/spells/presentations/healing-orb.js';
import spell from '../../src/spells/definitions/healing-orb.js';
import { runeScene } from '../../test-support/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';
import { playSpellSound } from '../../src/audio/spells.js';

function points(stage, progress, heading = 0) {
  const result = [];
  const effect = Object.freeze({ stage, progress, age: progress * profile.duration,
    life: profile.duration, radius: 3, heading });
  profile.draw(effect, (...point) => result.push(point));
  return result;
}

test('Healing Orb opts into a bounded, deterministic profile that fades in every stage', () => {
  assert.equal(spell.presentation, profile);
  for (const stage of ['cast', 'projectile', 'impact', 'pulse', 'aura', 'zone']) {
    for (const p of [0, 0.25, 0.7, 1]) {
      const drawn = points(stage, p);
      assert.ok(drawn.length > 20 && drawn.length <= 96, `${stage} stays within its point budget`);
      for (const [x, z, char, color, brightness] of drawn) {
        assert.ok([x, z, brightness, ...color].every(Number.isFinite));
        assert.ok(Math.abs(x) <= 3 && Math.abs(z) <= 3);
        assert.match(char, /^[\x21-\x7e]$/);
        assert.ok(color.every(c => c >= 0 && c <= 255));
        assert.ok(brightness >= 0 && brightness <= 1);
      }
      assert.deepEqual(drawn, points(stage, p, Math.PI / 2), 'the runtime owns heading rotation');
    }
    assert.ok(points(stage, 1).every(p => p[4] === 0), `${stage} fades completely`);
    assert.notDeepEqual(points(stage, 0.1), points(stage, 0.6));
  }
});

test('flight retains a compact seed, crossed veins, and a curling pollen wake', () => {
  const flight = points('projectile', 0.3);
  const seed = flight.filter(p => p[2] !== '.' && p[2] !== ':');
  assert.ok(seed.some(p => p[0] < -0.25) && seed.some(p => p[0] > 0.25));
  assert.ok(seed.some(p => p[1] > 0.5), 'the seed has a forward tip');
  assert.ok(seed.some(p => p[2] === '/') && seed.some(p => p[2] === '\\'), 'crossed leaf veins');
  const wake = flight.filter(p => p[1] < -0.65);
  assert.ok(wake.some(p => p[0] < 0) && wake.some(p => p[0] > 0), 'pollen curls on both sides');
  assert.ok(wake.some(p => p[1] < -2.4), 'pollen trails behind the seed');
});

test('landing opens five separate petals around the healing cross', () => {
  const bloom = points('impact', 0.55);
  const tips = bloom.filter(p => p[2] === 'o');
  assert.equal(tips.length, 5);
  assert.equal(bloom.filter(p => p[2] === '+').length, 1);
  assert.ok(tips.every(p => Math.hypot(p[0], p[1]) > 1.3));
  const span = stagePoints => Math.max(...stagePoints.map(p => Math.hypot(p[0], p[1])));
  assert.ok(span(points('impact', 0.6)) > span(points('impact', 0.05)) * 1.8, 'petals unfurl outward');
  assert.ok(span(points('pulse', 0.55)) < span(bloom), 'repeating pollen blooms remain small');
  assert.notDeepEqual(points('cast', 0.55), bloom);
});

test('the seed chime rises through three pure notes before the airy landing bloom', () => {
  const { cast, impact, pulse } = profile.sounds;
  assert.equal(cast[0].type, 'sine');
  const melody = cast.slice(1);
  assert.equal(melody.length, 3);
  assert.ok(melody.every(v => v.kind === 'tone' && v.type === 'sine'));
  assert.ok(melody.every((v, i) => !i || v.frequency > melody[i - 1].frequency && v.delay > melody[i - 1].delay));
  assert.ok(impact.some(v => v.kind === 'noise' && v.attack >= 0.08 && v.release >= 0.3), 'bloom is a soft air swell');
  assert.ok(impact.filter(v => v.kind === 'tone').length >= 3, 'landing opens into a chord');
  assert.ok(pulse.every(v => v.gain <= 0.02 && v.duration <= 0.15));
  for (const recipe of [cast, impact, pulse]) {
    assert.ok(recipe.length <= 8);
    assert.ok(recipe.every(v => v.gain > 0 && v.gain <= 0.25 && v.duration <= 2.5 && (v.delay ?? 0) <= 2));
  }
  const fake = fakeRecordedAudio();
  for (const stage of ['cast', 'impact', 'pulse']) {
    const handles = playSpellSound(fake.engine, { stage, presentation: profile, x: 4, y: 8 });
    assert.equal(handles.length, profile.sounds[stage].length);
    handles.forEach(handle => handle.stop());
  }
  assert.ok(fake.routes.every(r => r.bus === 'sfx' && r.x === 4 && r.y === 8 && r.disposals === 1));
  assert.deepEqual(fake.invalid, []);
});

test('real Healing Orb casts render the profile and emit typed heal cues without sword sounds', () => {
  const scene = runeScene(spell, { range: 12, allyInPath: true }), events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  assert.equal(scene.cast().ok, false, 'cooldown rejection stays silent');
  assert.equal(events.filter(e => e.stage === 'cast').length, 1);
  assert.equal(scene.casting.projectiles.length, 1);
  const flight = [];
  scene.casting.effects.paint((...p) => flight.push(p), scene.casting.projectiles);
  assert.ok(flight.some(p => p[2] === '(') && flight.some(p => p[2] === ')'), 'runtime renders the seed coat');
  assert.ok(flight.some(p => p[2] === '/') && flight.some(p => p[2] === '\\'), 'runtime renders leaf veins');
  scene.advance(0.15);
  assert.equal(scene.ally.vitals.health, 32);
  assert.equal(scene.player.vitals.health, 60);
  assert.equal(scene.foe.health, 100);
  assert.ok(events.some(e => e.stage === 'impact'));
  assert.ok(events.every(e => e.type === 'spell' && e.spellId === spell.id && e.presentation === profile));
  assert.ok(events.every(e => !['draw', 'slam'].includes(e.type)));
  const landing = [];
  scene.casting.effects.paint((...p) => landing.push(p), scene.casting.projectiles);
  assert.ok(landing.some(p => p[2] === '+'), 'runtime renders the healing petal centre');
});
