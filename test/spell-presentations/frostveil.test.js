import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/frostveil.js';
import spell from '../../src/spells/definitions/frostveil.js';
import { runeScene } from '../../test-support/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';
import { playSpellSound } from '../../src/audio/spells.js';

function points(stage, progress, radius = 2) {
  const result = [];
  presentation.draw(Object.freeze({ stage, progress, age: progress * presentation.duration,
    life: presentation.duration, radius, heading: 0 }), (...point) => result.push(point));
  return result;
}

test('Frostveil opens diamond eyelets in fine draping threads and parts its curtains on contact', () => {
  const cast = points('cast', 0.2), open = points('cast', 0.7), impact = points('impact', 0.2);
  assert.ok(cast.filter(p => p[2] === '|').length > 15, 'fine hanging threads remain the main motif');
  for (const glyph of ['<', '>', '/', '\\']) assert.ok(cast.some(p => p[2] === glyph), 'open diamond outlines');
  const eyeWidth = list => Math.abs(list.filter(p => p[2] === '>')[1][0] - list.filter(p => p[2] === '<')[1][0]);
  assert.ok(eyeWidth(open) > eyeWidth(cast), 'eyelets open during casting');
  const threadSpread = list => {
    const threads = list.filter(p => p[2] === '|');
    return threads.reduce((sum, p) => sum + Math.abs(p[0]), 0) / threads.length;
  };
  assert.ok(threadSpread(points('impact', 0.7)) > threadSpread(impact), 'impact parts the curtains');
  assert.notDeepEqual(cast, impact);
  assert.ok(points('projectile', 0.2).length < cast.length, 'travelling eyelet has a compact thread wake');
  assert.ok(points('projectile', 0.2).some(p => p[1] < -0.7 && p[2] === ':'));
  assert.ok(Math.max(...points('zone', 0.2, 8).map(p => Math.abs(p[0]))) > 3,
    'field presentation covers a wider area than the cast');
});

test('Frostveil stays deterministic, finite, ASCII, bounded and fades in every runtime stage', () => {
  for (const stage of ['cast', 'impact', 'pulse', 'aura', 'zone', 'projectile']) {
    for (const p of [0, 0.2, 0.7, 1]) {
      const result = points(stage, p, 40);
      assert.ok(result.length > 0 && result.length <= 96);
      assert.deepEqual(result, points(stage, p, 40));
      for (const [x, z, char, color, brightness] of result) {
        assert.ok([x, z, brightness, ...color].every(Number.isFinite));
        assert.ok(Math.abs(x) < 10 && Math.abs(z) < 10);
        assert.match(char, /^[\x20-\x7e]$/);
        assert.ok(color.every(c => c >= 0 && c <= 255));
        assert.ok(brightness >= 0 && brightness <= 1);
        if (p === 1) assert.equal(brightness, 0);
      }
    }
    assert.notDeepEqual(points(stage, 0.2), points(stage, 0.7));
  }
});

test('Frostveil has a staggered upper shimmer, slow falling glissando and whisper close', () => {
  const { cast, impact, pulse } = presentation.sounds;
  const harmonics = cast.filter(v => v.kind === 'tone' && v.type === 'sine');
  assert.equal(harmonics.length, 2);
  assert.ok(harmonics.every(v => v.frequency > 1400 && v.attack >= 0.1));
  assert.ok(harmonics[1].delay > 0 && harmonics[1].frequency > harmonics[0].frequency);
  assert.ok(cast.some(v => v.kind === 'tone' && v.duration > 0.8 && v.endFrequency < v.frequency / 2));
  assert.ok(cast.some(v => v.kind === 'noise' && v.attack >= 0.15 && v.filterType === 'highpass'));
  assert.ok(impact.some(v => v.kind === 'noise' && v.delay > 0 && v.release > 0.3));
  assert.ok(pulse.every(v => v.gain < 0.015 && v.duration < 0.2), 'repeated field cues stay quiet and brief');
  for (const [stage, voices] of Object.entries(presentation.sounds)) {
    assert.ok(voices.length > 0 && voices.length <= 8);
    for (const voice of voices) {
      assert.ok(voice.gain > 0 && voice.gain <= 0.25);
      assert.ok(voice.duration > 0 && voice.duration <= 2.5);
      assert.ok((voice.delay ?? 0) >= 0 && (voice.delay ?? 0) <= 2);
    }
    const fake = fakeRecordedAudio();
    const handles = playSpellSound(fake.engine, { stage, presentation, x: 4, y: 7 });
    assert.equal(handles.length, voices.length);
    assert.ok(fake.routes.every(r => r.bus === 'sfx' && r.x === 4 && r.y === 7));
    assert.deepEqual(fake.invalid, []);
    handles.forEach(h => h.stop());
  }
});

test('the real Frostveil rune renders its profile and sends typed spell cues while retaining silence gameplay', () => {
  assert.equal(spell.presentation, presentation);
  const scene = runeScene(spell, { range: 20 }), sounds = [];
  scene.casting.onSound = event => sounds.push(event);
  assert.equal(scene.cast().ok, true);
  assert.equal(scene.cast().ok, false);
  assert.equal(sounds.filter(e => e.stage === 'cast').length, 1);
  const launch = [];
  scene.casting.effects.paint((...p) => launch.push(p), scene.casting.projectiles);
  assert.ok(launch.some(p => p[2] === '|') && launch.some(p => p[2] === '<'));
  assert.ok(scene.casting.projectiles.every(p => p.ctx.spell.presentation === presentation));
  scene.advance(2);
  assert.ok(scene.aura(scene.foe, 'Silenced'));
  assert.equal(scene.foe.health, 100);
  assert.ok(sounds.some(e => e.stage === 'impact'));
  assert.ok(sounds.some(e => e.stage === 'pulse'));
  assert.ok(sounds.every(e => e.type === 'spell' && e.presentation === presentation));
  assert.ok(sounds.every(e => !['draw', 'slam'].includes(e.type)));
  const field = [];
  scene.casting.effects.paint((...p) => field.push(p), scene.casting.projectiles);
  assert.ok(field.some(p => p[2] === '|') && field.some(p => p[2] === '>'));
});
