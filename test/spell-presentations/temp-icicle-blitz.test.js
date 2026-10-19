import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/temp-icicle-blitz.js';
import spell from '../../src/spells/definitions/temp-icicle-blitz.js';
import { runeScene } from '../../test-support/spells.js';

function sample(stage, progress, radius = 1, heading = 0) {
  const effect = Object.freeze({ stage, progress, age: progress, life: 1, radius, heading });
  const points = [];
  presentation.draw(effect, (x, z, char, color, brightness = 1) => points.push({ x, z, char, color, brightness }));
  return points;
}

test('Icicle Blitz real casts render authored needles and emit spell cues while preserving damage', () => {
  const scene = runeScene(spell), events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  const cuesBeforeRejectedCast = events.length;
  assert.equal(scene.cast().ok, false);
  assert.equal(events.length, cuesBeforeRejectedCast, 'cooldown rejection stays silent');
  assert.ok(events.some(event => event.type === 'spell' && event.stage === 'cast' && event.presentation === presentation));
  assert.ok(scene.casting.effects.list.some(effect => effect.stage === 'cast' && effect.presentation === presentation));

  const points = [];
  scene.casting.effects.paint((...point) => points.push(point), scene.casting.projectiles);
  assert.ok(points.some(point => point[2] === 'v'), 'game renderer consumes the needle profile');
  assert.ok(points.some(point => point[2] === '|'), 'game renderer consumes the narrow crystal shaft');
  scene.advance(0.7);
  assert.equal(scene.foe.health, 96, 'authored effects preserve the existing four-damage quill');
  assert.ok(events.some(event => event.type === 'spell' && event.stage === 'impact' && event.presentation === presentation));
  assert.ok(events.every(event => event.type === 'spell' && event.presentation === presentation));
  assert.ok(!events.some(event => event.type === 'draw' || event.type === 'slam'));
});

test('Icicle Blitz opts into a staggered five-needle volley and a different shard splash', () => {
  assert.equal(spell.presentation, presentation);
  assert.equal(presentation.id, spell.id);
  const frames = [0.05, 0.2, 0.4, 0.58, 0.79].map(progress => sample('cast', progress));
  const shafts = new Set(frames.flat().filter(point => point.char === '|').map(point => point.x));
  assert.equal(shafts.size, 5, 'five staggered needle lanes appear over the cast');
  assert.ok(frames.every(frame => frame.some(point => point.char === 'v')));
  assert.ok(frames.flat().some(point => point.char === '+'));
  assert.ok(frames.flat().some(point => point.char === '*'));
  assert.notDeepEqual(frames[0], frames[2], 'needles launch and move between frames');

  const splash = sample('impact', 0.3);
  assert.equal(splash.filter(point => point.char === '*').length, 3, 'three separate crystal contact points');
  assert.ok(splash.some(point => point.char === '/'));
  assert.ok(splash.some(point => point.char === '\\'));
  assert.ok(!splash.some(point => point.char === 'v'));
  const projectile = sample('projectile', 0.3);
  assert.ok(projectile.some(point => point.char === 'v'));
  assert.ok(projectile.some(point => point.char === ':'));
  assert.ok(projectile.some(point => point.z < -0.8), 'flight retains a narrow dust trail');
  assert.deepEqual(sample('cast', 0.3, 1, 0), sample('cast', 0.3, 1, Math.PI / 2), 'runtime owns heading rotation');
});

test('Icicle Blitz frames are deterministic, bounded, and fade away for every stage', () => {
  for (const stage of ['cast', 'impact', 'projectile', 'pulse', 'aura', 'zone']) {
    for (const radius of [0.1, 1, 12]) {
      for (const progress of [0, 0.15, 0.4, 0.8, 0.99, 1]) {
        const points = sample(stage, progress, radius);
        assert.deepEqual(points, sample(stage, progress, radius));
        assert.ok(points.length <= 96, `${stage} stays inside the plot budget`);
        for (const point of points) {
          assert.ok(Number.isFinite(point.x) && Number.isFinite(point.z));
          assert.ok(Math.abs(point.x) <= 3 && Math.abs(point.z) <= 3);
          assert.match(point.char, /^[\x20-\x7e]$/);
          assert.equal(point.color.length, 3);
          assert.ok(point.color.every(value => Number.isFinite(value) && value >= 0 && value <= 255));
          assert.ok(Number.isFinite(point.brightness) && point.brightness >= 0 && point.brightness <= 1);
        }
      }
    }
    assert.deepEqual(sample(stage, 1), [], `${stage} disappears at its end`);
  }
  const peak = points => Math.max(0, ...points.map(point => point.brightness));
  assert.ok(peak(sample('impact', 0.9)) < peak(sample('impact', 0.2)) * 0.4);
  assert.ok(peak(sample('projectile', 0.99)) < peak(sample('projectile', 0.2)) * 0.1);
});

test('Icicle Blitz uses irregular high pings, interleaved swishes, and a compact dry crunch', () => {
  const { cast, impact, pulse } = presentation.sounds;
  const pings = cast.filter(voice => voice.kind === 'tone');
  assert.equal(pings.length, 5);
  const gaps = pings.slice(1).map((voice, index) => Number((voice.delay - pings[index].delay).toFixed(3)));
  assert.ok(new Set(gaps).size >= 3, 'the volley is deliberately irregular');
  assert.ok(pings.every(voice => voice.frequency >= 1500 && voice.endFrequency < voice.frequency));
  assert.ok(cast.filter(voice => voice.kind === 'noise').length >= 2);
  assert.ok(pings.at(-1).delay < 0.5, 'pings form a rapid burst');
  assert.ok(impact.some(voice => voice.kind === 'noise' && voice.filterType === 'bandpass'));
  assert.ok(impact.some(voice => voice.kind === 'tone' && voice.frequency < pings[0].frequency));
  assert.ok(impact.every(voice => voice.delay + voice.duration < 0.25), 'impact stays a compact crunch');
  assert.ok(pulse.every(voice => voice.gain <= 0.025 && voice.duration <= 0.1));
  for (const sequence of Object.values(presentation.sounds)) {
    assert.ok(sequence.length > 0 && sequence.length <= 8);
    for (const voice of sequence) {
      assert.ok(['tone', 'noise'].includes(voice.kind));
      assert.ok(voice.delay >= 0 && voice.delay <= 2);
      assert.ok(voice.duration > 0 && voice.duration <= 2.5);
      assert.ok(voice.gain > 0 && voice.gain <= 0.25);
      assert.ok(voice.attack > 0 && voice.release > 0 && voice.attack + voice.release <= voice.duration);
    }
  }
});
