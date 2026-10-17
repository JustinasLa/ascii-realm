import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/temp-last-stand.js';
import spell from '../../src/spells/definitions/temp-last-stand.js';
import { runeScene } from '../../test-support/spells.js';

function frame(stage, progress = 0.25, extra = {}) {
  const points = [];
  presentation.draw({ stage, progress, age: progress * presentation.duration, life: presentation.duration,
    radius: 2, heading: 0, ...extra }, (x, z, char, color, brightness = 1) => {
    points.push({ x, z, char, color, brightness });
  });
  return points;
}

test('Flight of the Gladiator opts into its presentation without changing its TF resource costs', () => {
  assert.equal(spell.presentation, presentation);
  assert.equal(presentation.id, spell.id);
  assert.deepEqual(spell.variants[0].params, { cooldown: 20, mana: 8, damage: 20 });
  assert.equal(spell.source.sha256, 'ec0ccba909eda1abd6b943f87d4d185cf742744933ad399198df367b999656c7');
});

test('a real rune cast renders the crest and sends its own cast and landing sound cues', () => {
  const { casting, cast, advance, foe } = runeScene(spell, { range: 2 });
  const cues = [];
  casting.onSound = cue => cues.push(cue);
  assert.equal(cast().ok, true);
  const launch = casting.effects.list.find(effect => effect.stage === 'cast');
  assert.equal(launch.presentation, presentation);
  assert.equal(launch.life, presentation.duration);
  const rendered = [];
  casting.effects.paint((x, z, char) => rendered.push(char), casting.projectiles);
  assert.ok(rendered.filter(char => char === '|').length >= 6, 'runtime paints the sword blade');
  assert.ok(rendered.includes('/') && rendered.includes('\\') && rendered.includes('^'), 'runtime paints the laurel and flight crest');
  assert.ok(cues.some(cue => cue.type === 'spell' && cue.stage === 'cast' && cue.presentation === presentation));
  advance(0.5);
  assert.equal(foe.health, 90);
  advance(2);
  assert.equal(foe.health, 70);
  assert.ok(cues.some(cue => cue.type === 'spell' && cue.stage === 'impact' && cue.presentation === presentation));
  assert.ok(cues.filter(cue => cue.type === 'spell').every(cue => cue.spellId === spell.id));
  assert.ok(cues.every(cue => cue.type !== 'draw' && cue.type !== 'slam'), 'generic weapon sounds are replaced by spell cues');
});

test('the rising sword, paired laurel and flight chevrons resolve to a different landing crown', () => {
  const cast = frame('cast');
  const impact = frame('impact');
  assert.ok(cast.filter(p => p.char === '|').length >= 6, 'the cast has a continuous sword blade');
  assert.ok(cast.filter(p => p.char === '/').length >= 12, 'paired laurel leaves flank the blade');
  assert.equal(impact.filter(p => p.char === '^').length, 5, 'the landing shows five crown points');
  assert.ok(impact.filter(p => p.char === '=').length >= 5, 'the crown has a grounded band');
  assert.notDeepEqual(cast, impact);
  const earlyTip = frame('cast', 0.1).filter(p => p.char === '|').map(p => p.z);
  const lateTip = frame('cast', 0.6).filter(p => p.char === '|').map(p => p.z);
  assert.ok(Math.max(...lateTip) > Math.max(...earlyTip), 'the crest actually rises');
  assert.ok(frame('impact', 0.6).some(p => p.x > Math.max(...impact.map(p => p.x))), 'landing shockwave spreads');
  const projectile = frame('projectile');
  assert.ok(projectile.some(p => p.char === '^') && projectile.some(p => p.char === '|'));
  assert.equal(projectile.filter(p => p.char === ':').length, 3, 'the sword has a short trailing wake');
  assert.ok(projectile.length < cast.length / 2, 'projectile remains a compact silhouette');
});

test('all effect stages remain deterministic, bounded, finite and fade completely', () => {
  for (const stage of ['cast', 'impact', 'pulse', 'aura', 'zone', 'projectile']) {
    for (const p of [0, 0.2, 0.7, 0.95]) {
      const points = frame(stage, p);
      assert.ok(points.length > 0 && points.length <= 96);
      assert.deepEqual(points, frame(stage, p));
      for (const point of points) {
        assert.ok(Number.isFinite(point.x) && Number.isFinite(point.z));
        assert.ok(Math.abs(point.x) <= 8 && Math.abs(point.z) <= 8);
        assert.match(point.char, /^[\x20-\x7e]$/);
        assert.equal(point.color.length, 3);
        assert.ok(point.color.every(c => Number.isFinite(c) && c >= 0 && c <= 255));
        assert.ok(Number.isFinite(point.brightness) && point.brightness >= 0 && point.brightness <= 1);
      }
    }
    assert.deepEqual(frame(stage, 1), []);
    assert.ok(Math.max(...frame(stage, 0.95).map(p => p.brightness)) < Math.max(...frame(stage, 0.2).map(p => p.brightness)));
    assert.notDeepEqual(frame(stage, 0.1), frame(stage, 0.6));
  }
  assert.deepEqual(frame('cast', 0.3, { heading: 2 }), frame('cast', 0.3), 'heading rotation belongs to the runtime');
});

test('martial horn and paired rising calls launch into a separate low landing stamp', () => {
  const { cast, impact, pulse } = presentation.sounds;
  const horn = cast.find(v => v.type === 'sawtooth');
  const calls = cast.filter(v => v.kind === 'tone' && v.duration < 0.2);
  assert.ok(horn.frequency < calls[0].frequency && horn.duration > 0.3, 'low held horn underlies the calls');
  assert.equal(calls.length, 4, 'two short paired calls');
  for (let i = 1; i < calls.length; i++) assert.ok(calls[i].frequency > calls[i - 1].frequency);
  assert.ok(calls[2].delay - calls[1].delay > calls[1].delay - calls[0].delay, 'a breath separates the two pairs');
  assert.ok(cast.some(v => v.kind === 'noise' && v.filterType === 'bandpass' && v.attack > 0.05), 'launch air swells');
  assert.ok(impact.some(v => v.type === 'sine' && v.endFrequency < v.frequency && v.endFrequency < 60), 'landing stamps downward into bass');
  assert.ok(impact.some(v => v.kind === 'noise' && v.delay > 0), 'landing leaves a short grit tail');
  assert.ok(pulse.every(v => v.gain <= 0.02 && v.duration <= 0.12), 'repeat pulses stay quiet and brief');
  for (const voices of Object.values(presentation.sounds)) {
    assert.ok(voices.length > 0 && voices.length <= 8);
    for (const voice of voices) {
      assert.ok(['tone', 'noise'].includes(voice.kind));
      assert.ok(voice.delay >= 0 && voice.delay <= 2);
      assert.ok(voice.duration > 0 && voice.duration <= 2.5);
      assert.ok(voice.gain > 0 && voice.gain <= 0.25);
      assert.ok(voice.attack > 0 && voice.attack + voice.release <= voice.duration);
    }
  }
  assert.notDeepEqual(cast, impact);
});
