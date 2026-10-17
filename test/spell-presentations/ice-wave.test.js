import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/ice-wave.js';
import spell from '../../src/spells/definitions/ice-wave.js';
import { runeScene } from '../../test-support/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';
import { playSpellSound } from '../../src/audio/spells.js';

function points(stage, progress, extra = {}) {
  const result = [];
  presentation.draw(Object.freeze({ stage, age: progress * presentation.duration,
    life: presentation.duration, progress, radius: 1, heading: 0, ...extra }),
  (x, z, char, color, brightness = 1) => result.push({ x, z, char, color, brightness }));
  return result;
}

test('Ice Wave opts into its own presentation while retaining its rune cost and source', () => {
  assert.equal(spell.presentation, presentation);
  assert.equal(presentation.id, spell.id);
  assert.deepEqual(spell.variants[0].params, { cooldown: 15, mana: 6, duration: 10, damage: 8 });
  assert.equal(spell.source.sha256, 'dd420157d6e6bbbfa6a8aa60a51f3e625b8a4885f4070cfc3fb59b94b1130599');
});

test('a real rune cast renders the authored crest and emits typed spatial cast/impact cues', () => {
  const scene = runeScene(spell), events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  scene.advance(0.05);
  assert.equal(scene.foe.health, 92);
  assert.ok(scene.aura(scene.foe, 'Slowed'));
  assert.ok(scene.casting.effects.list.some(effect => effect.stage === 'cast' && effect.presentation === presentation));
  assert.ok(scene.casting.effects.list.some(effect => effect.stage === 'impact' && effect.presentation === presentation));
  const rendered = [];
  scene.casting.effects.paint((...point) => rendered.push(point), scene.casting.projectiles);
  assert.ok(rendered.some(point => point[2] === '^') && rendered.some(point => point[2] === '~'));
  const castCue = events.find(event => event.type === 'spell' && event.stage === 'cast');
  assert.ok(castCue && castCue.spellId === spell.id && castCue.presentation === presentation);
  assert.ok(events.some(event => event.type === 'spell' && event.stage === 'impact'
    && event.spellId === spell.id && event.presentation === presentation));
  assert.ok(events.every(event => !['draw', 'slam'].includes(event.type)));
  const count = events.length;
  assert.equal(scene.cast().ok, false, 'cooldown still rejects a second cast');
  assert.equal(events.length, count, 'rejected casts remain silent');
  const audio = fakeRecordedAudio();
  const handles = playSpellSound(audio.engine, castCue);
  assert.equal(handles.length, presentation.sounds.cast.length);
  assert.ok(audio.routes.every(route => route.bus === 'sfx' && route.x === castCue.x && route.y === castCue.y));
  assert.deepEqual(audio.invalid, []);
  for (const handle of handles) handle.stop();
});

test('the serrated crest has three rolling rows, curling shoulders and a snow wake', () => {
  const early = points('cast', 0.15), late = points('cast', 0.65);
  const teeth = drawing => drawing.filter(point => point.char === '^');
  assert.equal(teeth(early).length, 21, 'three rows of seven teeth');
  assert.equal(early.filter(point => point.char === '/').length, teeth(early).length);
  assert.equal(early.filter(point => point.char === '\\').length, teeth(early).length);
  assert.ok(early.some(point => point.char === '~' && point.x < -1));
  assert.ok(early.some(point => point.char === '~' && point.x > 1));
  assert.ok(early.some(point => point.char === '.' && point.z < 0));
  const meanZ = drawing => teeth(drawing).reduce((sum, point) => sum + point.z, 0) / teeth(drawing).length;
  assert.ok(meanZ(late) > meanZ(early) + 0.9, 'the complete crest advances forward');
  const frontRows = teeth(early).slice(0, 7), backRows = teeth(early).slice(14);
  assert.ok(Math.max(...frontRows.map(point => point.z)) > Math.max(...backRows.map(point => point.z)) + 0.7);
});

test('impact collapses into split plates and a projectile retains a compact toothed silhouette', () => {
  const cast = points('cast', 0.35), impact = points('impact', 0.35), projectile = points('projectile', 0.35);
  assert.ok(cast.some(point => point.char === '^'));
  assert.ok(!impact.some(point => point.char === '^'));
  assert.ok(impact.some(point => point.char === '#') && impact.some(point => point.char === '_'));
  assert.ok(projectile.some(point => point.char === '^') && projectile.some(point => point.char === '.'));
  assert.ok(projectile.length < cast.length / 2);
  assert.ok(Math.max(...projectile.map(point => Math.abs(point.x))) < 0.6);
  const lateImpact = points('impact', 0.75);
  assert.ok(Math.max(...lateImpact.map(point => point.x)) > Math.max(...impact.map(point => point.x)));
});

test('every stage remains deterministic, finite, bounded and fades to an empty final frame', () => {
  for (const stage of ['cast', 'impact', 'pulse', 'aura', 'zone', 'projectile']) {
    for (const progress of [0, 0.15, 0.5, 0.95]) {
      const drawing = points(stage, progress);
      assert.ok(drawing.length > 0 && drawing.length <= 96);
      assert.deepEqual(drawing, points(stage, progress));
      assert.deepEqual(drawing, points(stage, progress, { heading: Math.PI / 2 }), 'rotation belongs to the runtime');
      for (const point of drawing) {
        assert.ok(Number.isFinite(point.x) && Number.isFinite(point.z));
        assert.ok(Math.abs(point.x) < 4 && Math.abs(point.z) < 4);
        assert.match(point.char, /^[\x20-\x7e]$/);
        assert.equal(point.color.length, 3);
        assert.ok(point.color.every(channel => Number.isFinite(channel) && channel >= 0 && channel <= 255));
        assert.ok(Number.isFinite(point.brightness) && point.brightness >= 0 && point.brightness <= 1);
      }
    }
    assert.ok(Math.max(...points(stage, 0.95).map(point => point.brightness))
      < Math.max(...points(stage, 0.5).map(point => point.brightness)) / 3);
    assert.deepEqual(points(stage, 1), []);
  }
});

test('sound is a long snow scrape over cold air with irregular crystal teeth and a short collapse', () => {
  const { cast, impact, pulse } = presentation.sounds;
  const scrape = cast.find(voice => voice.kind === 'noise' && voice.filterType === 'highpass');
  const air = cast.find(voice => voice.kind === 'noise' && voice.filterType === 'lowpass');
  const teeth = cast.filter(voice => voice.kind === 'tone');
  assert.ok(scrape.duration > 0.7 && scrape.attack > 0.1);
  assert.ok(air.cutoff < 600 && air.duration > 0.6);
  assert.equal(teeth.length, 4);
  assert.ok(teeth.every((voice, i) => i === 0 || voice.delay > teeth[i - 1].delay));
  assert.ok(teeth[1].frequency < teeth[0].frequency && teeth[2].frequency > teeth[0].frequency,
    'the teeth chatter, rather than playing a scale');
  assert.ok(teeth[3].delay - teeth[2].delay > teeth[1].delay - teeth[0].delay);
  assert.ok(impact.some(voice => voice.kind === 'noise' && voice.attack < 0.01));
  assert.ok(impact.some(voice => voice.kind === 'tone' && voice.endFrequency < 100));
  assert.ok(impact.filter(voice => voice.frequency > 1000).length >= 3);
  assert.notDeepEqual(cast, impact);
  assert.ok(pulse.every(voice => voice.gain <= 0.02 && voice.duration < 0.15));
  for (const sequence of Object.values(presentation.sounds)) {
    assert.ok(sequence.length > 0 && sequence.length <= 8);
    for (const voice of sequence) {
      assert.ok(['tone', 'noise'].includes(voice.kind));
      assert.ok(voice.gain > 0 && voice.gain <= 0.25);
      assert.ok(voice.duration > 0 && voice.duration <= 2.5);
      assert.ok(voice.delay >= 0 && voice.delay <= 2);
      assert.ok(voice.attack > 0 && voice.release > 0 && voice.attack + voice.release <= voice.duration);
      if (voice.kind === 'tone') {
        assert.ok(voice.frequency > 20 && voice.endFrequency > 20);
      }
    }
  }
});
