import assert from 'node:assert/strict';
import test from 'node:test';
import profile from '../../src/spells/presentations/crashing-wave.js';
import spell from '../../src/spells/definitions/crashing-wave.js';
import { runeScene } from '../../test-support/spells.js';
import { playSpellSound } from '../../src/audio/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';

function draw(stage, progress = 0.3) {
  const points = [];
  profile.draw({ stage, progress, age: progress * profile.duration, life: profile.duration,
    radius: 1, heading: 0 }, (...point) => points.push(point));
  return points;
}

test('Crashing Wave opts into a hooked foam crest, current ribs and a travelling wake', () => {
  assert.equal(spell.presentation, profile);
  assert.equal(profile.id, spell.id);
  const points = draw('projectile');
  const crest = points.filter(p => p[2] === '-');
  assert.ok(crest.length >= 8, 'the dashed crest curls across multiple segments');
  const peak = Math.max(...crest.map(p => p[1]));
  assert.ok(crest.some(p => p[0] > 0 && p[1] < peak * 0.5), 'the lip hooks back beneath its peak');
  assert.ok(points.some(p => p[2] === '~'), 'current ribs fill the face');
  assert.ok(points.filter(p => p[2] === '_').every(p => p[1] < 0), 'the wake stays behind the breaker');
  assert.ok(Math.max(...points.map(p => p[0])) - Math.min(...points.map(p => p[0])) < 2,
    'the projectile remains a compact readable curl');
  const impact = draw('impact');
  assert.ok(impact.some(p => p[2] === 'o'), 'tumbling droplets mark the collision');
  assert.ok(Math.max(...impact.map(p => p[0])) - Math.min(...impact.map(p => p[0])) > 3,
    'impact spills into a broader wash than the projectile');
  assert.notDeepEqual(draw('cast'), impact);
});

test('every stage stays finite, bounded, deterministic, moving and fully faded', () => {
  for (const stage of ['cast', 'projectile', 'impact', 'pulse', 'aura', 'zone']) {
    for (const p of [0, 0.2, 0.65, 1]) {
      const points = draw(stage, p);
      assert.ok(points.length > 20 && points.length <= 96);
      for (const [x, z, char, color, brightness] of points) {
        assert.ok(Number.isFinite(x) && Number.isFinite(z) && Math.abs(x) < 6 && Math.abs(z) < 6);
        assert.match(char, /^[\x20-\x7e]$/);
        assert.ok(color.length === 3 && color.every(c => Number.isFinite(c) && c >= 0 && c <= 255));
        assert.ok(Number.isFinite(brightness) && brightness >= 0 && brightness <= 1);
      }
      assert.deepEqual(points, draw(stage, p));
    }
    assert.notDeepEqual(draw(stage, 0.2).map(p => p.slice(0, 2)), draw(stage, 0.65).map(p => p.slice(0, 2)));
    assert.ok(draw(stage, 1).every(p => p[4] === 0));
  }
});

test('surf gathers in staggered noise layers, then a deep thump leads a long foam hiss', () => {
  const { cast, impact, pulse } = profile.sounds;
  const rush = cast.filter(v => v.kind === 'noise');
  assert.ok(rush.length >= 3 && new Set(rush.map(v => v.delay ?? 0)).size === rush.length);
  assert.ok(rush[0].attack > 0.2, 'the surf swells instead of clicking');
  const thump = impact.find(v => v.kind === 'tone');
  const hiss = impact.find(v => v.kind === 'noise' && v.filterType === 'highpass');
  assert.ok(thump.frequency < 120 && thump.endFrequency < thump.frequency);
  assert.ok(hiss.delay > 0 && hiss.duration > 1 && hiss.release > 1, 'foam outlasts the breaker hit');
  assert.ok(pulse.every(v => v.gain <= 0.02 && v.duration <= 0.1), 'repeating tick foam stays quiet');
  for (const voices of Object.values(profile.sounds)) {
    assert.ok(voices.length <= 8);
    for (const v of voices) {
      assert.ok(v.gain > 0 && v.gain <= 0.25 && v.duration > 0 && v.duration <= 2.5);
      assert.ok((v.delay ?? 0) >= 0 && (v.delay ?? 0) <= 2);
    }
  }
  const fake = fakeRecordedAudio();
  for (const stage of ['cast', 'impact', 'pulse']) {
    const handles = playSpellSound(fake.engine, { type: 'spell', stage, presentation: profile, x: 2, y: 7 });
    assert.equal(handles.length, profile.sounds[stage].length);
    handles.forEach(h => h.stop());
  }
  assert.ok(fake.routes.every(r => r.bus === 'sfx' && r.x === 2 && r.y === 7));
  assert.deepEqual(fake.invalid, []);
});

test('real Crashing Wave casts render the curl and emit typed spell cues while preserving damage', () => {
  const scene = runeScene(spell), events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  assert.equal(scene.cast().ok, false, 'cooldown rejection produces no second cast');
  const cast = events.filter(e => e.type === 'spell' && e.stage === 'cast');
  assert.equal(cast.length, 1);
  assert.equal(cast[0].presentation, profile);
  assert.ok(scene.casting.effects.list.some(e => e.stage === 'cast' && e.presentation === profile));
  assert.ok(scene.casting.projectiles.some(p => p.ctx.spell.presentation === profile));
  const points = [];
  scene.casting.effects.paint((...point) => points.push(point), scene.casting.projectiles);
  assert.ok(points.some(p => p[2] === '~') && points.some(p => p[2] === '-'), 'runtime draws foam and current ribs');
  const before = scene.foe.y;
  scene.advance(0.7);
  assert.equal(scene.foe.health, 82);
  assert.ok(scene.foe.y > before, 'the original knockback still applies');
  assert.ok(events.some(e => e.type === 'spell' && e.stage === 'impact' && e.presentation === profile));
  assert.ok(events.some(e => e.type === 'spell' && e.stage === 'pulse'));
  assert.ok(events.every(e => !['draw', 'slam'].includes(e.type)), 'casting never emits sword draw or slam cues');
});
