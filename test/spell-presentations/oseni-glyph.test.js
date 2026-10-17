import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/oseni-glyph.js';
import spell from '../../src/spells/definitions/oseni-glyph.js';
import { runeScene } from '../../test-support/spells.js';

function capture(stage, progress = 0.4, age = progress * 1.16, radius = 3) {
  const points = [];
  const effect = Object.freeze({ stage, age, progress, radius, life: 1.16, heading: 0.7 });
  presentation.draw(effect, (x, z, char, color, brightness) => {
    points.push({ x, z, char, color, brightness });
  });
  return points;
}

test('Oseni Glyph opts into its own profile without changing its rune cost or timing', () => {
  assert.equal(spell.presentation, presentation);
  assert.equal(presentation.id, spell.id);
  assert.deepEqual(spell.variants[0].params, { cooldown: 20, mana: 8, duration: 8, damage: 23 });
});

test('the armed sigil has three matching bent spokes, cross-strokes and orbiting sparks', () => {
  const points = capture('zone');
  assert.ok(points.some(p => p.char === '|'));
  assert.ok(points.some(p => p.char === '+'));
  assert.equal(points.filter(p => p.char === '*').length, 3);
  const angle = Math.PI * 2 / 3, c = Math.cos(angle), s = Math.sin(angle);
  for (const point of points) {
    const x = point.x * c - point.z * s, z = point.x * s + point.z * c;
    assert.ok(points.some(p => p.char === point.char && Math.hypot(p.x - x, p.z - z) < 1e-8),
      'each rune stroke has a matching stroke one third of a turn away');
  }
  assert.notDeepEqual(capture('zone', 0.4, 0.3), capture('zone', 0.4, 0.9),
    'spokes and sparks orbit as the glyph waits');
});

test('impact fractures outward while flight keeps a compact pinwheel and trailing embers', () => {
  const cast = capture('cast'), impact = capture('impact'), flight = capture('projectile');
  assert.ok(impact.some(p => p.char === '#'));
  assert.ok(!cast.some(p => p.char === '#'));
  const reach = points => Math.max(...points.map(p => Math.hypot(p.x, p.z)));
  assert.ok(reach(capture('impact', 0.7)) > reach(capture('impact', 0.1)),
    'the three fractures move out from the sealing point');
  assert.ok(reach(flight) < reach(cast));
  assert.equal(flight.filter(p => p.char === '.').length, 5);
  assert.ok(flight.filter(p => p.char === '.').every(p => p.z < 0), 'ember wake stays behind the projectile');
});

test('all effect stages stay bounded, deterministic, atlas-compatible and fade out', () => {
  for (const stage of ['cast', 'impact', 'pulse', 'aura', 'zone', 'projectile']) {
    for (const progress of [0, 0.2, 0.55, 0.93]) {
      const points = capture(stage, progress);
      assert.ok(points.length > 0 && points.length <= 96);
      assert.deepEqual(points, capture(stage, progress));
      for (const p of points) {
        assert.ok([p.x, p.z, p.brightness, ...p.color].every(Number.isFinite));
        assert.ok(Math.hypot(p.x, p.z) < 12);
        assert.match(p.char, /^[\x21-\x7e]$/);
        assert.ok(p.color.every(c => c >= 0 && c <= 255));
        assert.ok(p.brightness >= 0 && p.brightness <= 1);
      }
    }
    assert.ok(Math.max(...capture(stage, 0.99).map(p => p.brightness)) < 0.05);
    assert.deepEqual(capture(stage, 1), []);
  }
});

test('sound seals a low drone with three paired metallic beats and a finishing chime', () => {
  const { cast, impact, pulse } = presentation.sounds;
  const drone = cast.find(v => v.type === 'triangle' && v.duration > 0.8);
  assert.ok(drone && drone.frequency < 200 && drone.attack > 0.05);
  const beats = cast.filter(v => v.duration < 0.2 && v.frequency > 600);
  const times = [...new Set(beats.map(v => v.delay))];
  assert.equal(times.length, 3);
  assert.ok(Math.abs((times[1] - times[0]) - (times[2] - times[1])) < 1e-8);
  for (const time of times) {
    const pair = beats.filter(v => v.delay === time);
    assert.equal(pair.length, 2, 'each metallic strike layers two inharmonic partials');
    assert.ok(pair[1].frequency / pair[0].frequency > 1.5);
  }
  assert.ok(cast.some(v => v.delay > times[2] && v.frequency > 1200 && v.release > 0.3));
  assert.ok(impact.some(v => v.kind === 'noise') && impact.some(v => v.frequency < 200));
  assert.notDeepEqual(cast, impact);
  assert.ok(pulse.every(v => v.gain < 0.02 && v.duration < 0.2));
  for (const voices of [cast, impact, pulse]) {
    assert.ok(voices.length > 0 && voices.length <= 8);
    for (const voice of voices) {
      assert.ok(voice.gain > 0 && voice.gain <= 0.25);
      assert.ok(voice.delay >= 0 && voice.delay <= 2);
      assert.ok(voice.duration > 0 && voice.duration <= 2.5);
      assert.ok(voice.attack + voice.release <= voice.duration);
    }
  }
});

test('a real rune cast paints the sigil and emits its typed cast and impact cues', () => {
  const { casting, cast, advance, foe } = runeScene(spell, { range: 1 });
  const sounds = [], stages = new Set(), chars = new Set();
  casting.onSound = event => sounds.push(event);
  assert.equal(cast().ok, true);
  const castEffect = casting.effects.list.find(effect => effect.stage === 'cast');
  assert.equal(castEffect.presentation, presentation);
  assert.equal(castEffect.life, presentation.duration);

  for (let frame = 0; frame < 50; frame++) {
    for (const effect of casting.effects.list) {
      assert.equal(effect.presentation, presentation);
      stages.add(effect.stage);
    }
    if (casting.projectiles.length) stages.add('projectile');
    casting.effects.paint((x, z, char) => {
      assert.ok(Number.isFinite(x) && Number.isFinite(z));
      chars.add(char);
    }, casting.projectiles);
    advance(0.05);
  }

  for (const stage of ['cast', 'projectile', 'impact']) assert.ok(stages.has(stage));
  for (const char of ['|', '+', '#']) assert.ok(chars.has(char), 'the profile reaches the actual world-cell paint stream');
  for (const stage of ['cast', 'impact']) {
    assert.ok(sounds.some(event => event.type === 'spell' && event.stage === stage
      && event.spellId === spell.id && event.presentation === presentation));
  }
  assert.ok(!sounds.some(event => event.type === 'draw' || event.type === 'slam'));
  assert.equal(foe.health, 77);
});
