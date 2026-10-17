import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/fire-rain.js';
import spell from '../../src/spells/definitions/fire-rain.js';
import { runeScene } from '../../test-support/spells.js';

function draw(stage, progress, overrides = {}) {
  const points = [];
  presentation.draw({ stage, progress, age: progress * presentation.duration,
    life: presentation.duration, radius: 2, heading: 0, ...overrides },
  (x, z, char, color, brightness) => points.push({ x, z, char, color, brightness }));
  return points;
}

test('a real Fire Rain cast renders its gate and splash profile and emits typed spell cues', () => {
  const scene = runeScene(spell), events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  assert.ok(events.some(event => event.type === 'spell' && event.stage === 'cast'
    && event.spellId === spell.id && event.presentation === presentation));
  assert.ok(scene.casting.effects.list.some(effect => effect.stage === 'cast'
    && effect.presentation === presentation), 'runtime retains the selected profile');
  const launch = [];
  scene.casting.effects.paint((...point) => launch.push(point), scene.casting.projectiles);
  assert.ok(launch.some(point => point[2] === 'V') && launch.some(point => point[2] === '-'),
    'runtime paints the suspended runic gate');
  const acceptedCueCount = events.length;
  assert.equal(scene.cast().ok, false);
  assert.equal(events.length, acceptedCueCount, 'cooldown rejection adds no sound');
  scene.advance(1.3);
  assert.equal(scene.foe.health, 88, 'first falling shot keeps its TF damage and launch delay');
  const landing = [];
  scene.casting.effects.paint((...point) => landing.push(point), scene.casting.projectiles);
  assert.ok(landing.some(point => point[2] === '^'), 'runtime paints flame splash crowns after a hit');
  assert.ok(events.some(event => event.stage === 'impact') && events.some(event => event.stage === 'pulse'));
  assert.ok(events.every(event => event.type === 'spell' && event.presentation === presentation),
    'authored cues replace the generic draw and slam sounds');
});

test('Fire Rain opts into a suspended gate with moving slanted rain and separate splash impacts', () => {
  assert.equal(spell.presentation, presentation);
  assert.equal(presentation.id, spell.id);
  const cast = draw('cast', 0.25);
  const lintel = cast.filter(point => point.char === '-' || point.char === '+');
  assert.ok(lintel.some(point => point.x < -1) && lintel.some(point => point.x > 1), 'gate spans both sides of the rain');
  assert.ok(cast.filter(point => point.char === 'V').length === 2, 'two hanging runes flank the central rune');
  assert.ok(cast.some(point => point.char === '\\'), 'slanted fire streaks descend from the gate');
  const next = draw('cast', 0.32);
  assert.notDeepEqual(cast.filter(point => point.char === '*'), next.filter(point => point.char === '*'), 'drop positions move with time');
  const impact = draw('impact', 0.25);
  assert.ok(impact.some(point => point.char === '^') && impact.some(point => point.char === '/')
    && impact.some(point => point.char === '\\'), 'impacts form umbrella-shaped flame crowns');
  assert.ok(!impact.some(point => point.char === '-' || point.char === 'V'), 'impact resolves the gate into separate splashes');
  assert.notDeepEqual(impact, draw('impact', 0.55), 'splash crowns expand and throw embers');
});

test('Fire Rain handles all presentation stages with finite, bounded, fading ASCII marks', () => {
  for (const stage of ['cast', 'impact', 'pulse', 'aura', 'zone', 'projectile']) {
    for (const progress of [0, 0.2, 0.55, 0.9, 1]) {
      for (const radius of [0.1, 1, 5, 40]) {
        const points = draw(stage, progress, { radius });
        assert.ok(points.length <= 96, 'draw budget stays bounded');
        for (const point of points) {
          assert.ok(Number.isFinite(point.x) && Number.isFinite(point.z));
          assert.ok(Math.abs(point.x) <= 6 && Math.abs(point.z) <= 8, 'geometry stays local to the spell');
          assert.match(point.char, /^[\x21-\x7e]$/);
          assert.ok(point.color.length === 3 && point.color.every(channel => Number.isFinite(channel) && channel >= 0 && channel <= 255));
          assert.ok(Number.isFinite(point.brightness) && point.brightness >= 0 && point.brightness <= 1);
        }
        if (progress === 1) assert.equal(points.length, 0, 'expired effects leave no visible marks');
      }
    }
    assert.ok(Math.max(...draw(stage, 0.9).map(point => point.brightness))
      < Math.max(...draw(stage, 0.2).map(point => point.brightness)), 'every stage fades before expiry');
  }
  const projectile = draw('projectile', 0.2);
  assert.ok(projectile.length < 16 && projectile.some(point => point.char === '*'));
  const trail = projectile.filter(point => point.char === '.');
  assert.ok(trail.length >= 3 && trail.every(point => point.x < 0 && point.z < 0), 'compact ember has an oblique trailing wake');
  assert.deepEqual(draw('cast', 0.3), draw('cast', 0.3), 'geometry is deterministic');
  assert.deepEqual(draw('cast', 0.3), draw('cast', 0.3, { heading: Math.PI / 2 }), 'runtime owns heading rotation');
});

test('Fire Rain sounds rise into spaced falling whistles and sizzling drops', () => {
  const { cast, impact, pulse } = presentation.sounds;
  const rise = cast.find(voice => voice.kind === 'tone' && voice.endFrequency > voice.frequency);
  assert.ok(rise && rise.delay === 0 && rise.attack > 0.08, 'airy opening sweep rises gradually');
  const whistles = cast.filter(voice => voice.kind === 'tone' && voice.endFrequency < voice.frequency);
  assert.equal(whistles.length, 3);
  assert.ok(whistles[1].delay - whistles[0].delay > 0.25 && whistles[2].delay - whistles[1].delay > 0.25,
    'three separate falling drops have room between them');
  for (const whistle of whistles) {
    assert.ok(cast.some(voice => voice.kind === 'noise' && voice.delay > whistle.delay
      && voice.delay < whistle.delay + whistle.duration && voice.filterType === 'highpass'), 'each whistle lands with a sizzle');
  }
  assert.ok(impact.filter(voice => voice.kind === 'noise').length >= 3, 'impact has a cascading sizzling texture');
  assert.notDeepEqual(cast, impact);
  assert.ok(pulse.every(voice => voice.duration < 0.1 && voice.gain < 0.03), 'repeated ticks remain short and quiet');
  for (const voices of Object.values(presentation.sounds)) {
    assert.ok(voices.length > 0 && voices.length <= 8);
    for (const voice of voices) {
      assert.ok(['tone', 'noise'].includes(voice.kind));
      assert.ok(voice.delay >= 0 && voice.delay <= 2);
      assert.ok(voice.duration > 0 && voice.duration <= 2.5);
      assert.ok(voice.gain > 0 && voice.gain <= 0.25);
      assert.ok(voice.attack > 0 && voice.release > 0 && voice.attack + voice.release <= voice.duration);
      if (voice.kind === 'tone') assert.ok(voice.frequency > 0 && voice.endFrequency > 0);
    }
  }
});
