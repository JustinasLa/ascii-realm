import assert from 'node:assert/strict';
import test from 'node:test';
import profile from '../../src/spells/presentations/drowning-prison.js';
import spell from '../../src/spells/definitions/drowning-prison.js';
import { runeScene } from '../../test-support/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';
import { GameAudio } from '../../src/audio/audio.js';

const capture = (stage, progress = 0.2, heading = 0) => {
  const points = [];
  profile.draw({ stage, progress, age: progress * profile.duration, life: profile.duration, radius: 1, heading },
    (x, z, char, color, brightness = 1) => points.push({ x, z, char, color, brightness }));
  return points;
};

test('Drowning Prison opts into a bending rectangular cage with closing split caps and bubble chains', () => {
  assert.equal(spell.presentation, profile);
  const open = capture('cast', 0), closed = capture('cast', 0.8);
  const caps = points => points.filter(point => point.char === '-');
  assert.ok(!caps(open).some(point => point.x === 0), 'split lids start with an open centre');
  assert.ok(caps(closed).some(point => point.x === 0), 'lids meet at the centre');
  const span = points => Math.max(...points.map(point => Math.abs(point.x)));
  assert.ok(span(closed) < span(open), 'closing cell compresses around its occupant');
  const bars = closed.filter(point => point.char === '|');
  assert.ok(new Set(bars.map(point => point.z)).size > 4, 'bars run between both lids');
  assert.ok(bars.some(point => Math.abs(point.z) < 0.1 && !bars.some(end => Math.abs(end.z) > 1 && end.x === point.x)), 'bar middles bend away from their endpoints');
  assert.ok(closed.some(point => point.char === 'o') && closed.some(point => point.char === ':'), 'hanging chains carry individual bubbles');
});

test('impact locks the caps while the flying capsule retains small bars and a bubble trail', () => {
  assert.ok(capture('impact').some(point => point.char === '#'));
  assert.ok(!capture('cast').some(point => point.char === '#'));
  const projectile = capture('projectile');
  assert.ok(projectile.some(point => point.char === '|') && projectile.some(point => point.char === '-'));
  assert.ok(projectile.filter(point => ['o', '.'].includes(point.char)).every(point => point.z < -0.3), 'bubbles trail behind the capsule');
  assert.ok(projectile.every(point => Math.abs(point.x) < 0.4 && Math.abs(point.z) < 1.2));
  assert.deepEqual(capture('cast', 0.2, Math.PI / 2), capture('cast'), 'heading rotation belongs to the runtime');
});

test('every stage is deterministic, moves, stays finite and within its plot budget, and fades fully', () => {
  for (const stage of ['cast', 'impact', 'projectile', 'pulse', 'aura', 'zone']) {
    assert.deepEqual(capture(stage), capture(stage));
    assert.notDeepEqual(capture(stage, 0.1), capture(stage, 0.7));
    for (const progress of [0, 0.1, 0.5, 0.9, 1]) {
      const points = capture(stage, progress);
      assert.ok(points.length > 0 && points.length <= 96);
      for (const point of points) {
        assert.ok([point.x, point.z, point.brightness, ...point.color].every(Number.isFinite));
        assert.ok(Math.abs(point.x) < 4 && Math.abs(point.z) < 4);
        assert.ok(point.brightness >= 0 && point.brightness <= 1);
        assert.ok(point.color.every(channel => channel >= 0 && channel <= 255));
        assert.match(point.char, /^[\x20-\x7e]$/);
        if (progress === 1) assert.equal(point.brightness, 0);
      }
    }
  }
});

test('the sound phrase combines a hollow gong, accelerating rising bubbles and a low pressure close', () => {
  const { cast, impact, pulse } = profile.sounds;
  const gong = cast.filter(voice => !voice.delay && voice.kind === 'tone');
  assert.equal(gong.length, 2, 'two unequal partials make the submerged gong');
  assert.ok(gong.every(voice => voice.duration > 0.6 && voice.release > 0.6));
  const bubbles = cast.filter(voice => voice.kind === 'tone' && voice.delay > 0);
  assert.ok(bubbles.length >= 3);
  assert.ok(bubbles.every(voice => voice.endFrequency > voice.frequency));
  assert.ok(bubbles[2].delay - bubbles[1].delay < bubbles[1].delay - bubbles[0].delay, 'bubble rhythm accelerates');
  assert.ok(bubbles.every((voice, index) => index === 0 || voice.frequency > bubbles[index - 1].frequency));
  assert.ok(impact.some(voice => voice.endFrequency < 60 && voice.attack >= 0.05), 'closing pressure is a rounded bass fall');
  assert.ok(impact.some(voice => voice.kind === 'noise' && voice.cutoff < 500));
  assert.ok(pulse.every(voice => voice.gain <= 0.025 && voice.duration <= 0.15), 'hold ticks stay quiet and brief');
  for (const voices of Object.values(profile.sounds)) {
    assert.ok(voices.length > 0 && voices.length <= 8);
    for (const voice of voices) {
      assert.ok(voice.gain > 0 && voice.gain <= 0.25);
      assert.ok(voice.duration > 0 && voice.duration <= 2.5);
      assert.ok((voice.delay ?? 0) >= 0 && (voice.delay ?? 0) <= 2);
      assert.ok(Object.values(voice).filter(value => typeof value === 'number').every(Number.isFinite));
    }
  }
});

test('a real rune cast renders its profile and emits spell cues while preserving hold and damage', () => {
  const scene = runeScene(spell, { range: 20 }), events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  assert.equal(scene.cast().ok, false);
  assert.equal(events.filter(event => event.stage === 'cast').length, 1);
  const flying = [];
  scene.casting.effects.paint((...point) => flying.push(point), scene.casting.projectiles);
  assert.ok(flying.some(point => point[2] === '|') && flying.some(point => point[2] === 'o'));
  scene.advance(0.7);
  assert.equal(scene.foe.magicSpeed, 0);
  scene.advance(4);
  assert.equal(scene.foe.health, 76);
  const active = [];
  scene.casting.effects.paint((...point) => active.push(point), scene.casting.projectiles);
  assert.ok(active.some(point => point[2] === '|'), 'the runtime paints the authored prison during confinement');
  assert.ok(events.some(event => event.type === 'spell' && event.stage === 'impact'));
  assert.ok(events.some(event => event.type === 'spell' && event.stage === 'pulse'));
  assert.ok(events.every(event => event.presentation === profile && !['draw', 'slam'].includes(event.type)));
});

test('the authored layers run through spatial SFX without invalid audio parameters', () => {
  const fake = fakeRecordedAudio(), audio = new GameAudio({}, fake.engine), owner = {};
  for (const stage of ['cast', 'impact', 'pulse']) {
    const handles = audio.play({ type: 'spell', stage, presentation: profile, owner, x: 4, y: 12 });
    assert.equal(handles.length, profile.sounds[stage].length);
  }
  assert.ok(fake.routes.every(route => route.bus === 'sfx' && route.x === 4 && route.y === 12));
  assert.ok(fake.nodes.some(node => node.starts[0] > fake.context.currentTime));
  assert.deepEqual(fake.invalid, []);
  audio.play({ type: 'spell-stop', owner });
  assert.ok(fake.routes.every(route => route.disposals === 1));
});
