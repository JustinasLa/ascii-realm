import assert from 'node:assert/strict';
import test from 'node:test';
import profile from '../../src/spells/presentations/temp-summon-phoenix.js';
import spell from '../../src/spells/definitions/temp-summon-phoenix.js';
import { runeScene } from '../../test-support/spells.js';

function points(stage, progress = 0.4, age = progress * profile.duration, heading = 0) {
  const result = [];
  profile.draw(Object.freeze({ stage, progress, age, life: profile.duration, radius: 2, heading }),
    (x, z, char, color, brightness) => result.push({ x, z, char, color, brightness }));
  return result;
}

test('Fire Phoenix opts into its bird presentation without changing rune costs or source identity', () => {
  assert.equal(spell.presentation, profile);
  assert.equal(profile.id, spell.id);
  assert.equal(spell.name, 'Fire Phoneix');
  assert.deepEqual(spell.variants[0].params, { cooldown: 15, mana: 6, damage: 15, duration: 3 });
  assert.equal(spell.source.sha256, 'ec0ccba909eda1abd6b943f87d4d185cf742744933ad399198df367b999656c7');
});

test('a real Phoenix cast paints the bird and emits its typed spell cue instead of sword draw', () => {
  const scene = runeScene(spell, { range: 6 });
  const cues = [];
  scene.casting.onSound = cue => cues.push(cue);
  assert.equal(scene.cast().ok, true);
  const castCue = cues.find(cue => cue.type === 'spell' && cue.stage === 'cast');
  assert.ok(castCue);
  assert.equal(castCue.spellId, spell.id);
  assert.equal(castCue.presentation, profile);
  assert.ok(!cues.some(cue => cue.type === 'draw'));
  const castEffect = scene.casting.effects.list.find(effect => effect.stage === 'cast');
  assert.equal(castEffect.presentation, profile);
  assert.equal(castEffect.life, profile.duration);
  const painted = [];
  scene.casting.effects.paint((x, z, char) => painted.push({ x, z, char }), scene.casting.projectiles);
  assert.ok(painted.some(point => point.char === 'o') && painted.some(point => point.char === '>'), 'real effects paint the hooked bird head');
  scene.advance(2.6);
  assert.ok(cues.some(cue => cue.type === 'spell' && cue.stage === 'impact' && cue.presentation === profile && cue.y > 0),
    'the travelling Phoenix keeps its profile on impact');
});

test('paired swept wings, hooked head and three tail plumes persist in every effect stage', () => {
  for (const stage of ['cast', 'impact', 'pulse', 'aura', 'zone', 'projectile']) {
    const plotted = points(stage);
    const wings = plotted.filter(p => ['/', '\\'].includes(p.char) && Math.abs(p.x) > 0.5);
    assert.ok(wings.some(p => p.x < 0) && wings.some(p => p.x > 0), `${stage}: two wings`);
    for (const wing of wings) {
      assert.ok(wings.some(other => Math.abs(other.x + wing.x) < 1e-9 && Math.abs(other.z - wing.z) < 1e-9),
        `${stage}: articulated feathers have a matching opposite wing`);
    }
    const head = plotted.find(p => p.char === 'o');
    const beak = plotted.find(p => p.char === '>');
    const hook = plotted.find(p => p.char === 'v');
    assert.ok(head.z > 0 && beak.x > head.x && hook.z < beak.z, `${stage}: hooked bird head`);
    assert.ok(plotted.some(p => p.char === '|' && p.z < -0.7), `${stage}: long central tail`);
    assert.ok(plotted.some(p => p.char === '.' && p.z < -0.7), `${stage}: ember feather wake`);
  }
});

test('wings beat with time, projectile stays compact and impact opens a rebirth flare', () => {
  const first = points('cast', 0.4, 0.12);
  const second = points('cast', 0.4, 0.38);
  assert.notDeepEqual(first.filter(p => p.char === '/'), second.filter(p => p.char === '/'));
  const extent = list => Math.max(...list.map(p => Math.abs(p.x)));
  assert.ok(extent(points('projectile')) < extent(points('cast')));
  assert.ok(!points('cast').some(p => p.char === '+'));
  assert.ok(points('impact').some(p => p.char === '+'));
  assert.ok(extent(points('impact', 0.7)) > extent(points('impact', 0.1)));
  assert.deepEqual(points('cast', 0.4, 0.3, 1.8), points('cast', 0.4, 0.3, 0), 'adapter owns heading rotation');
});

test('all stages obey the draw budget and fade to silence at the end of their life', () => {
  for (const stage of ['cast', 'impact', 'pulse', 'aura', 'zone', 'projectile']) {
    for (const progress of [0, 0.15, 0.5, 0.85, 0.99]) {
      const plotted = points(stage, progress);
      assert.ok(plotted.length > 0 && plotted.length <= 96);
      for (const point of plotted) {
        assert.ok(Number.isFinite(point.x) && Number.isFinite(point.z));
        assert.match(point.char, /^[\x20-\x7e]$/);
        assert.equal(point.color.length, 3);
        assert.ok(point.color.every(c => Number.isFinite(c) && c >= 0 && c <= 255));
        assert.ok(Number.isFinite(point.brightness) && point.brightness >= 0 && point.brightness <= 1);
      }
    }
    const peak = list => Math.max(...list.map(p => p.brightness));
    assert.ok(peak(points(stage, 0.99)) < peak(points(stage, 0.5)) * 0.1);
    assert.deepEqual(points(stage, 1), []);
    assert.deepEqual(points(stage, 0.4), points(stage, 0.4), 'no random geometry');
  }
});

test('sound has two rising wingbeats, an answering cry and a separate bright rebirth flutter', () => {
  const whooshes = profile.sounds.cast.filter(v => v.kind === 'noise');
  assert.equal(whooshes.length, 2);
  assert.ok(whooshes[1].delay > whooshes[0].delay && whooshes[1].cutoff > whooshes[0].cutoff);
  const cry = profile.sounds.cast.filter(v => v.kind === 'tone' && v.type === 'sine' && v.duration > 0.2);
  assert.equal(cry.length, 2);
  assert.ok(cry[1].delay > cry[0].delay + cry[0].duration, 'cry has two separated calls');
  assert.ok(cry.every(v => v.endFrequency > v.frequency) && cry[1].frequency > cry[0].frequency);
  assert.notDeepEqual(profile.sounds.impact, profile.sounds.cast);
  assert.ok(profile.sounds.impact.some(v => v.kind === 'tone' && v.endFrequency >= v.frequency * 2), 'rebirth rises an octave');
  const embers = profile.sounds.impact.filter(v => v.delay >= 0.25);
  assert.ok(embers.length >= 3 && embers.every(v => v.duration <= 0.1 && v.endFrequency < v.frequency));
  assert.ok(profile.sounds.pulse.every(v => v.gain < 0.02 && v.duration <= 0.1), 'repeating burn ticks stay quiet');
  for (const event of Object.values(profile.sounds)) {
    assert.ok(event.length > 0 && event.length <= 8);
    for (const voice of event) {
      assert.ok(['tone', 'noise'].includes(voice.kind));
      assert.ok(voice.gain > 0 && voice.gain <= 0.25);
      assert.ok(voice.delay >= 0 && voice.delay <= 2);
      assert.ok(voice.duration > 0 && voice.duration <= 2.5);
      assert.ok(voice.attack > 0 && voice.release > 0 && voice.attack + voice.release <= voice.duration);
    }
  }
});
