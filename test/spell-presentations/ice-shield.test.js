import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/ice-shield.js';
import spell from '../../src/spells/definitions/ice-shield.js';
import { runeScene } from '../../test-support/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';
import { GameAudio } from '../../src/audio/audio.js';

function frame(stage, progress, radius = 1.4) {
  const points = [];
  const effect = Object.freeze({ stage, progress, radius, age: progress * 1.18, life: 1.18, heading: 1.1 });
  presentation.draw(effect, (x, z, char, color, brightness = 1) => points.push({ x, z, char, color, brightness }));
  return points;
}

test('a real Ice Shield cast paints its authored plates and routes its chord as a typed spell cue', () => {
  const scene = runeScene(spell), events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  const castCue = events.find(event => event.type === 'spell' && event.stage === 'cast');
  assert.ok(castCue, 'the runtime emits a cast cue');
  assert.equal(castCue.spellId, spell.id);
  assert.equal(castCue.presentation, presentation);
  assert.ok(events.every(event => event.type === 'spell' && event.presentation === presentation));
  assert.ok(events.every(event => !['draw', 'slam'].includes(event.type)));
  const count = events.length;
  assert.equal(scene.cast().ok, false);
  assert.equal(events.length, count, 'a rejected cooldown cast stays silent');
  const launch = scene.casting.effects.list.find(effect => effect.stage === 'cast');
  assert.equal(launch.presentation, presentation);
  scene.advance(0.4);
  const points = [];
  scene.casting.effects.paint((...point) => points.push(point));
  assert.ok(points.some(point => point[2] === 'o'), 'the live renderer draws plate centers');
  assert.ok(points.some(point => point[2] === '^') && points.some(point => point[2] === 'v'));
  const fake = fakeRecordedAudio(), audio = new GameAudio({}, fake.engine);
  const voices = audio.play(castCue);
  assert.equal(voices.length, presentation.sounds.cast.length);
  assert.ok(fake.routes.every(route => route.bus === 'sfx' && route.x === scene.player.x && route.y === scene.player.y));
  assert.deepEqual(fake.invalid, []);
  audio.play({ type: 'spell-stop', owner: castCue.owner });
  assert.ok(voices.every(voice => voice.ended));
});

test('Ice Shield opts into seven locking plates and a frosted pointed shield rim', () => {
  assert.equal(spell.presentation, presentation);
  assert.equal(presentation.id, spell.id);
  const early = frame('cast', 0.12);
  const formed = frame('cast', 0.5);
  const plates = formed.filter(point => point.char === 'o');
  assert.equal(plates.length, 7, 'one central plate and six surrounding plates');
  assert.equal(plates.filter(point => point.x < 0).length, 3);
  assert.equal(plates.filter(point => point.x > 0).length, 3);
  assert.ok(formed.some(point => point.char === '^' && point.z < -1));
  assert.ok(formed.some(point => point.char === 'v' && point.z > 1.5), 'lower rim resolves to a shield point');
  assert.ok(formed.filter(point => point.char === '/').length >= 14);
  assert.ok(formed.filter(point => point.char === '\\').length >= 14);
  assert.ok(early.filter(point => point.char === 'o').length < plates.length, 'outer plates join after the center');
  assert.notDeepEqual(early, formed);
  assert.deepEqual(frame('cast', 0.5), formed, 'animation is deterministic');
});

test('Ice Shield contact branches stress cracks while a projectile retains one plate and a wake', () => {
  const impact = frame('impact', 0.35);
  assert.equal(impact.filter(point => point.char === 'x').length, 3);
  assert.ok(impact.some(point => point.char === '|'));
  assert.ok(!frame('cast', 0.35).some(point => point.char === 'x'));
  assert.notDeepEqual(impact, frame('impact', 0.65), 'stress cracks spread after contact');
  const projectile = frame('projectile', 0.35);
  assert.equal(projectile.filter(point => point.char === 'o').length, 1);
  const wake = projectile.filter(point => point.char === '.');
  assert.equal(wake.length, 5);
  assert.ok(wake.every(point => point.z < -0.45));
  assert.ok(wake[0].brightness > wake.at(-1).brightness, 'frost wake recedes in brightness');
  assert.ok(projectile.length < impact.length / 3);
});

test('Ice Shield stages keep finite local ASCII geometry, a bounded draw budget, and a clean fade', () => {
  for (const stage of ['cast', 'impact', 'pulse', 'aura', 'zone', 'projectile']) {
    for (const radius of [0, 0.8, 40, NaN]) {
      for (const progress of [0.05, 0.3, 0.5, 0.9, 0.999]) {
        const points = frame(stage, progress, radius);
        assert.ok(points.length > 0 && points.length <= 96, `${stage} respects the particle budget`);
        for (const point of points) {
          assert.ok(Number.isFinite(point.x) && Number.isFinite(point.z));
          assert.ok(Math.abs(point.x) <= 3.5 && Math.abs(point.z) <= 3.5);
          assert.match(point.char, /^[\x21-\x7e]$/);
          assert.equal(point.color.length, 3);
          assert.ok(point.color.every(value => Number.isFinite(value) && value >= 0 && value <= 255));
          assert.ok(Number.isFinite(point.brightness) && point.brightness >= 0 && point.brightness <= 1);
        }
      }
    }
    assert.deepEqual(frame(stage, 1), []);
    const peak = Math.max(...frame(stage, 0.5).map(point => point.brightness));
    const final = Math.max(...frame(stage, 0.999).map(point => point.brightness));
    assert.ok(final < peak * 0.02, `${stage} fades before removal`);
  }
});

test('Ice Shield has an overlapping rising chord, snow hiss, and low inharmonic glass contact', () => {
  const { cast, impact, pulse } = presentation.sounds;
  const chord = cast.slice(0, 3);
  assert.ok(chord.every(voice => voice.kind === 'tone' && voice.endFrequency > voice.frequency));
  assert.ok(chord[0].frequency < chord[1].frequency && chord[1].frequency < chord[2].frequency);
  assert.ok(chord[0].delay + chord[0].duration > chord[2].delay, 'notes overlap into a chord');
  assert.ok(cast.some(voice => voice.kind === 'noise' && voice.attack >= 0.05), 'snow forms with a soft hiss');
  const glass = impact.filter(voice => voice.kind === 'tone');
  assert.equal(glass.length, 3);
  assert.ok(glass[0].frequency < chord[0].frequency);
  assert.ok(Math.abs(glass[1].frequency / glass[0].frequency - 1.5) > 0.05, 'contact has an inharmonic rim partial');
  assert.ok(glass[0].release > 0.5, 'the low rim rings after contact');
  assert.ok(pulse.every(voice => voice.duration <= 0.25 && voice.gain <= 0.015));
  for (const voices of Object.values(presentation.sounds)) {
    assert.ok(voices.length > 0 && voices.length <= 8);
    for (const voice of voices) {
      assert.ok(['tone', 'noise'].includes(voice.kind));
      assert.ok(voice.delay >= 0 && voice.delay <= 2);
      assert.ok(voice.duration > 0 && voice.duration <= 2.5);
      assert.ok(voice.gain > 0 && voice.gain <= 0.25);
      assert.ok(voice.attack > 0 && voice.release > 0 && voice.attack + voice.release <= voice.duration);
      if (voice.kind === 'tone') assert.ok(voice.frequency >= 20 && voice.frequency <= 20000);
    }
  }
});
