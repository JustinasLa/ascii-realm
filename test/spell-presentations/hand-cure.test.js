import assert from 'node:assert/strict';
import test from 'node:test';
import spell from '../../src/spells/definitions/hand-cure.js';
import presentation from '../../src/spells/presentations/hand-cure.js';
import { paintPresentation } from '../../src/spells/presentation.js';
import { playSpellSound } from '../../src/audio/spells.js';
import { runeScene } from '../../test-support/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';

function points(stage, progress = 0.25, radius = 1) {
  const result = [];
  presentation.draw(Object.freeze({ stage, progress, age: progress * presentation.duration, life: presentation.duration, radius, heading: 0 }), (...p) => result.push(p));
  return result;
}

test('Hand Cure gathers five unequal fingers and inward stitches, then opens a flower cross', () => {
  assert.equal(spell.presentation, presentation);
  const hand = points('cast'), tips = hand.filter(p => p[2] === "'");
  assert.equal(tips.length, 5, 'five fingertip highlights identify a healing hand');
  assert.equal(new Set(tips.map(p => p[0])).size, 5);
  assert.ok(Math.max(...tips.map(p => p[1])) - Math.min(...tips.map(p => p[1])) > 0.5, 'thumb and fingers have unequal lengths');
  const earlyStitches = points('cast', 0.1).filter(p => p[2] === '-');
  const lateStitches = points('cast', 0.7).filter(p => p[2] === '-');
  assert.ok(Math.max(...lateStitches.map(p => Math.abs(p[0]))) < Math.min(...earlyStitches.map(p => Math.abs(p[0]))), 'stitches pull toward the palm');
  const flower = points('impact'), petalTips = flower.filter(p => p[2] === '*');
  assert.equal(petalTips.length, 4, 'four cardinal petals form the healing cross');
  assert.ok(petalTips.some(p => p[0] > 0.4) && petalTips.some(p => p[0] < -0.4));
  assert.ok(petalTips.some(p => p[1] > 0.4) && petalTips.some(p => p[1] < -0.4));
  assert.ok(flower.some(p => p[0] === 0 && p[1] === 0 && p[2] === '+'));
  assert.notDeepEqual(hand, flower);
  const projectile = points('projectile');
  assert.equal(projectile.filter(p => p[2] === "'").length, 5);
  assert.ok(projectile.some(p => p[1] < -1), 'compact hand retains its stitched trail');
});

test('all Hand Cure stages are deterministic, bounded, animated, and fully faded at their end', () => {
  for (const stage of ['cast', 'impact', 'pulse', 'aura', 'zone', 'projectile']) {
    for (const progress of [0, 0.25, 0.7, 1]) {
      const draw = points(stage, progress, 40);
      assert.ok(draw.length > 20 && draw.length <= 96);
      assert.deepEqual(draw, points(stage, progress, 40), 'profile uses no random state');
      for (const [x, z, char, color, brightness] of draw) {
        assert.ok([x, z, brightness, ...color].every(Number.isFinite));
        assert.ok(Math.abs(x) < 3 && Math.abs(z) < 3);
        assert.match(char, /^[\x20-\x7e]$/);
        assert.ok(color.every(v => v >= 0 && v <= 255));
        assert.ok(brightness >= 0 && brightness <= 1);
        if (progress === 1) assert.equal(brightness, 0);
      }
    }
    assert.notDeepEqual(points(stage, 0.1), points(stage, 0.6), `${stage} evolves over time`);
  }
});

test('Hand Cure uses asymmetric plucked phrases, warm body harmonics, and quiet restorative chimes', () => {
  const { cast, impact, pulse } = presentation.sounds;
  const phrase = voices => voices.filter(v => v.type === 'triangle');
  for (const voices of [cast, impact]) {
    assert.ok(voices.length <= 8 && voices.every(v => v.kind === 'tone'));
    const plucks = phrase(voices);
    assert.ok(plucks.length >= 3 && plucks.every(v => v.attack < 0.01 && v.release > v.duration * 0.8));
    assert.ok(plucks.every(v => v.endFrequency < v.frequency && v.endFrequency > v.frequency * 0.9));
    const [a, b, c] = plucks.map(v => v.delay);
    assert.notEqual(b - a, c - b, 'the plucks use an intimate, uneven rhythm');
    assert.ok(voices.some(v => v.type === 'sine' && v.frequency < 250 && v.attack > 0.02), 'warm middle harmonic under the plucks');
    assert.ok(voices.some(v => v.type === 'sine' && v.frequency > 700 && v.gain < 0.025), 'small restorative finishing chime');
  }
  assert.ok(phrase(cast).every((v, i, notes) => i === 0 || v.frequency > notes[i - 1].frequency));
  assert.ok(phrase(impact).every((v, i, notes) => i === 0 || v.frequency < notes[i - 1].frequency));
  assert.ok(pulse.every(v => v.gain <= 0.02 && v.duration < 0.2));
  for (const voices of [cast, impact, pulse]) for (const voice of voices) {
    assert.ok(voice.duration > 0 && voice.duration <= 2.5 && voice.delay >= 0 && voice.delay <= 2);
    assert.ok(voice.gain > 0 && voice.gain <= 0.25);
  }
});

test('real Hand Cure cast heals unchanged and routes authored profiles and typed spatial sound cues', () => {
  const scene = runeScene(spell, { range: 12, allyInPath: true, allyRange: 1 }), events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  assert.equal(scene.ally.vitals.health, 38);
  assert.equal(scene.casting.mana, 94);
  scene.advance(0.05);
  assert.equal(scene.player.magicSpeed, 0);
  assert.equal(scene.ally.magicSpeed, 0);
  assert.ok(events.some(e => e.type === 'spell' && e.stage === 'cast' && e.x === scene.player.x && e.y === scene.player.y));
  assert.ok(events.some(e => e.type === 'spell' && e.stage === 'impact'));
  assert.ok(scene.casting.effects.list.some(e => e.stage === 'impact' && e.x === scene.ally.x && e.y === scene.ally.y), 'healing flower appears on the ally');
  assert.ok(events.some(e => e.type === 'spell' && e.stage === 'pulse'));
  assert.ok(events.every(e => e.type === 'spell' && e.spellId === 'hand-cure' && e.presentation === presentation));
  assert.ok(events.every(e => !['draw', 'slam'].includes(e.type)));
  const before = events.length;
  assert.equal(scene.cast().ok, false);
  assert.equal(events.length, before, 'cooldown rejection has no new sound');
  const rendered = [], expected = [];
  scene.casting.effects.paint((...p) => rendered.push(p));
  for (const effect of scene.casting.effects.list) {
    assert.equal(effect.presentation, presentation);
    paintPresentation(presentation, effect, (...p) => expected.push(p));
  }
  assert.ok(rendered.some(p => p[2] === "'") && rendered.some(p => p[2] === '+'));
  assert.deepEqual(rendered, expected, 'runtime effect stream actually calls the Hand Cure profile');
  const fake = fakeRecordedAudio(), handles = [];
  for (const event of events) handles.push(...playSpellSound(fake.engine, event));
  assert.equal(handles.length, events.reduce((sum, e) => sum + presentation.sounds[e.stage].length, 0));
  assert.ok(fake.routes.every(r => r.bus === 'sfx'));
  assert.ok(fake.routes.some(r => r.x === scene.ally.x && r.y === scene.ally.y));
  assert.ok(fake.nodes.some(n => n.kind === 'oscillator' && n.starts[0] > fake.context.currentTime));
  assert.deepEqual(fake.invalid, []);
  for (const handle of handles) handle.stop();
  assert.ok(fake.routes.every(r => r.disposals === 1));
  scene.advance(1.2);
  assert.equal(scene.player.magicSpeed, 1);
  assert.equal(scene.ally.magicSpeed, 1);
  assert.equal(scene.casting.effects.list.length, 0);
});
