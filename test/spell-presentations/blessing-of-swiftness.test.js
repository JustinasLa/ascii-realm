import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/blessing-of-swiftness.js';
import spell from '../../src/spells/definitions/blessing-of-swiftness.js';
import { runeScene } from '../../test-support/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';
import { playSpellSound } from '../../src/audio/spells.js';

function draw(stage, progress = 0.3) {
  const points = [];
  presentation.draw({ stage, age: progress * presentation.duration,
    life: presentation.duration, progress, radius: 1, heading: 0 }, (...p) => points.push(p));
  return points;
}

test('Swiftness has two veined forward leaves, circling wind and a compact projectile trail', () => {
  assert.equal(spell.presentation, presentation);
  const cast = draw('cast'), impact = draw('impact'), projectile = draw('projectile');
  for (const points of [cast, impact, projectile]) {
    const tips = points.filter(p => p[2] === '^');
    assert.equal(tips.length, 2, 'each stride has a pair of pointed leaves');
    assert.ok(tips[0][0] < 0 && tips[1][0] > 0, 'leaves straddle the forward path');
    assert.equal(points.filter(p => p[2] === '|').length, 2, 'both leaves retain their midrib');
    assert.ok(points.some(p => p[2] === '~'), 'wind ribbons identify the blessing');
    assert.ok(points.some(p => p[2] === '.' && p[1] < 0), 'motes trail behind the stride');
  }
  assert.ok(Math.max(...projectile.map(p => Math.abs(p[0]))) < 0.4, 'travelling leaf crest stays compact');
  assert.notDeepEqual(cast, impact, 'the arrival spreads and advances the leaf pair');
  assert.ok(impact.filter(p => p[2] === '^').every((p, i) => p[1] > cast.filter(p => p[2] === '^')[i][1]));
});

test('all Swiftness stages animate deterministically, stay bounded and fade cleanly', () => {
  for (const stage of ['cast', 'impact', 'pulse', 'aura', 'zone', 'projectile']) {
    const start = draw(stage, 0), middle = draw(stage, 0.5), end = draw(stage, 1);
    assert.notDeepEqual(start, middle, `${stage} moves over its lifetime`);
    assert.deepEqual(middle, draw(stage, 0.5), `${stage} is deterministic`);
    for (const points of [start, middle, end]) {
      assert.ok(points.length > 10 && points.length <= 96);
      for (const [x, z, char, color, brightness = 1] of points) {
        assert.ok([x, z, brightness, ...color].every(Number.isFinite));
        assert.ok(Math.abs(x) < 3 && Math.abs(z) < 3);
        assert.match(char, /^[\x20-\x7e]$/);
        assert.ok(color.every(c => c >= 0 && c <= 255));
        assert.ok(brightness >= 0 && brightness <= 1);
      }
    }
    assert.ok(end.every(p => p[4] === 0), `${stage} disappears at expiry`);
  }
});

test('Swiftness plays a quick woody arpeggio with a brush and a high finishing ping', () => {
  const cast = presentation.sounds.cast, impact = presentation.sounds.impact;
  const wood = cast.filter(s => s.kind === 'tone' && s.type === 'triangle');
  assert.equal(wood.length, 3);
  assert.ok(wood.every((s, i) => !i || s.frequency > wood[i - 1].frequency));
  assert.ok(wood.every((s, i) => !i || s.delay > (wood[i - 1].delay ?? 0)));
  assert.ok(wood.every(s => s.attack <= 0.003 && s.duration < 0.1 && s.cutoff <= 2000), 'short filtered plucks make the woody attack');
  assert.ok(cast.some(s => s.kind === 'noise' && s.attack > 0.04), 'wind brushes in beneath the plucks');
  const ping = cast.find(s => s.type === 'sine');
  assert.ok(ping.frequency > wood.at(-1).frequency && ping.delay > wood.at(-1).delay);
  assert.notDeepEqual(cast, impact);
  assert.ok(presentation.sounds.pulse.every(s => s.duration <= 0.1 && s.gain < 0.02));
  for (const [stage, recipe] of Object.entries(presentation.sounds)) {
    assert.ok(recipe.length > 0 && recipe.length <= 8);
    for (const voice of recipe) {
      assert.ok(voice.gain > 0 && voice.gain <= 0.25);
      assert.ok(voice.duration > 0 && voice.duration <= 2.5);
      assert.ok((voice.delay ?? 0) >= 0 && (voice.delay ?? 0) <= 2);
    }
    const fake = fakeRecordedAudio();
    const handles = playSpellSound(fake.engine, { presentation, stage, x: 2, y: 4 });
    assert.equal(handles.length, recipe.length);
    assert.ok(fake.routes.every(r => r.bus === 'sfx' && r.x === 2 && r.y === 4));
    assert.deepEqual(fake.invalid, []);
    handles.forEach(h => h.stop());
  }
});

test('real Swiftness casts render the profile and emit typed cues without changing the blessing', () => {
  const scene = runeScene(spell, { range: 12, allyInPath: true, allyRange: 1 }), events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  const acceptedEvents = events.length;
  assert.equal(scene.cast().ok, false);
  assert.equal(events.length, acceptedEvents, 'cooldown rejection is silent');
  assert.equal(scene.casting.mana, 94);
  const dots = [];
  scene.casting.effects.paint((...p) => dots.push(p), scene.casting.projectiles);
  assert.ok(dots.some(p => p[2] === '^') && dots.some(p => p[2] === '~'), 'runtime paints authored leaves and ribbons');
  scene.advance(0.1);
  assert.equal(scene.ally.magicSpeed, 0, 'the source root still applies');
  scene.advance(1.2);
  assert.equal(scene.ally.magicSpeed, 1.4, 'the source grants Speed II');
  assert.equal(events.filter(e => e.stage === 'cast').length, 1);
  assert.ok(events.some(e => e.type === 'spell' && e.stage === 'impact'));
  assert.ok(events.some(e => e.type === 'spell' && e.stage === 'pulse'));
  assert.ok(events.every(e => e.type === 'spell' && e.presentation === presentation));
  assert.ok(events.every(e => !['draw', 'slam'].includes(e.type)));
  scene.advance(6);
  assert.equal(scene.ally.magicSpeed, 1, 'the six-second blessing still expires');
});
