import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/maelstrom.js';
import spell from '../../src/spells/definitions/maelstrom.js';
import { runeScene } from '../../test-support/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';
import { playSpellSound } from '../../src/audio/spells.js';

function draw(stage, age = 0.2, progress = 0.2, radius = 3) {
  const points = [];
  const effect = Object.freeze({ stage, age, life: 1, progress, radius, heading: 1.1 });
  presentation.draw(effect, (...point) => points.push(point));
  return points;
}
const distance = point => Math.hypot(point[0], point[1]);

test('Maelstrom makes five rotating spiral arms around a dark eye and pulls streaks inward', () => {
  const first = draw('zone', 0.05), next = draw('zone', 0.1);
  const tips = first.filter(point => point[2] === ')');
  assert.equal(tips.length, 5, 'five separate outer arms');
  const angles = tips.map(point => Math.atan2(point[1], point[0])).sort((a, b) => a - b);
  for (let i = 0; i < angles.length; i++) {
    const spacing = (angles[(i + 1) % angles.length] - angles[i] + Math.PI * 2) % (Math.PI * 2);
    assert.ok(Math.abs(spacing - Math.PI * 2 / 5) < 1e-8, 'arms evenly surround the eye');
  }
  const laterTips = next.filter(point => point[2] === ')');
  assert.ok(tips.every((point, i) => Math.abs(distance(point) - distance(laterTips[i])) < 1e-8));
  assert.notDeepEqual(tips.map(p => p.slice(0, 2)), laterTips.map(p => p.slice(0, 2)), 'whole whirlpool rotates');
  const streaks = first.filter(point => point[2] === '-'), laterStreaks = next.filter(point => point[2] === '-');
  assert.ok(streaks.every((point, i) => distance(laterStreaks[i]) < distance(point)), 'streak heads move inward');
  const eye = first.find(point => point[2] === '@');
  assert.equal(distance(eye), 0);
  assert.ok(eye[3].every((channel, i) => channel < tips[0][3][i]), 'eye is darker than foamy arms');
});

test('Maelstrom contracts on impact, has a compact projectile wake, and fades every stage', () => {
  const cast = draw('cast'), impact = draw('impact');
  assert.notDeepEqual(cast, impact);
  assert.ok(impact.some(p => p[2] === '*') && !cast.some(p => p[2] === '*'), 'impact has a foam fringe');
  const earlyImpact = draw('impact', 0.1, 0.1), lateImpact = draw('impact', 0.6, 0.6);
  assert.ok(Math.max(...lateImpact.map(distance)) < Math.max(...earlyImpact.map(distance)), 'impact spirals collapse');
  const projectile = draw('projectile');
  assert.ok(projectile.some(p => p[1] < -1), 'projectile trails behind its compact eye');
  assert.ok(Math.max(...projectile.filter(p => p[2] === '~').map(distance)) < 0.6);
  for (const stage of ['cast', 'projectile', 'impact', 'pulse', 'aura', 'zone']) {
    for (const [age, progress] of [[0, 0], [0.4, 0.4], [1, 1]]) {
      const points = draw(stage, age, progress, 7);
      assert.ok(points.length > 10 && points.length <= 96, `${stage} stays inside its glyph budget`);
      for (const [x, z, char, color, brightness] of points) {
        assert.ok([x, z, brightness, ...color].every(Number.isFinite));
        assert.ok(Math.abs(x) < 10 && Math.abs(z) < 10);
        assert.match(char, /^[\x20-\x7e]$/);
        assert.ok(color.every(channel => channel >= 0 && channel <= 255));
        assert.ok(brightness >= 0 && brightness <= 1);
        if (progress === 1) assert.equal(brightness, 0, `${stage} fades completely`);
      }
    }
  }
});

test('Maelstrom layers a low rumble and overlapping descending water tones with a sucking release', () => {
  assert.equal(spell.presentation, presentation);
  const cast = presentation.sounds.cast;
  const descents = cast.filter(voice => voice.kind === 'tone' && voice.type === 'sine');
  assert.ok(cast.some(voice => voice.kind === 'tone' && voice.frequency < 100 && voice.duration >= 1), 'low rumble');
  assert.ok(descents.length >= 3);
  for (let i = 0; i < descents.length; i++) {
    assert.ok(descents[i].endFrequency < descents[i].frequency / 2, 'audible downward glide');
    if (i > 0) assert.ok(descents[i].delay < descents[i - 1].delay + descents[i - 1].duration, 'water tones overlap');
  }
  assert.ok(presentation.sounds.impact.some(voice => voice.kind === 'noise' && voice.filterType === 'bandpass'
    && voice.attack > 0.15 && voice.release > 0.15), 'rounded sucking release');
  assert.notDeepEqual(presentation.sounds.cast, presentation.sounds.impact);
  for (const [stage, voices] of Object.entries(presentation.sounds)) {
    assert.ok(voices.length > 0 && voices.length <= 8);
    for (const voice of voices) {
      assert.ok(voice.gain > 0 && voice.gain <= (stage === 'pulse' ? 0.025 : 0.25));
      assert.ok(voice.duration > 0 && voice.duration <= 2.5);
      assert.ok((voice.delay ?? 0) >= 0 && (voice.delay ?? 0) <= 2);
    }
    const fake = fakeRecordedAudio();
    const handles = playSpellSound(fake.engine, { stage, presentation, x: 4, y: 8 });
    assert.equal(handles.length, voices.length, 'every authored layer reaches the instruments');
    assert.ok(fake.routes.every(route => route.bus === 'sfx' && route.x === 4 && route.y === 8));
    assert.deepEqual(fake.invalid, []);
    for (const handle of handles) handle.stop();
  }
});

test('Maelstrom uses authored projectile/zone geometry and typed cast/impact cues in a real rune scene', () => {
  const scene = runeScene(spell), events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  const eventCount = events.length;
  assert.equal(scene.cast().ok, false);
  assert.equal(events.length, eventCount, 'cooldown rejection stays silent');
  const launch = [];
  scene.casting.effects.paint((...p) => launch.push(p), scene.casting.projectiles);
  assert.ok(launch.some(p => p[2] === '@') && launch.some(p => p[2] === '~'), 'real projectile paints its whirlpool');
  assert.equal(scene.casting.mana, 90);
  scene.advance(0.8);
  assert.equal(scene.foe.health, 100, 'warning window remains harmless');
  scene.advance(3);
  assert.ok(scene.foe.health <= 90, 'existing repeated damage still runs');
  assert.ok(scene.casting.effects.list.some(effect => effect.stage === 'zone' && effect.presentation === presentation));
  const zone = [];
  scene.casting.effects.paint((...p) => zone.push(p), scene.casting.projectiles);
  assert.ok(zone.some(p => p[2] === '@') && zone.some(p => p[2] === ')'), 'active zone paints the five-arm whirlpool');
  assert.equal(events.filter(event => event.type === 'spell' && event.stage === 'cast').length, 1);
  assert.ok(events.some(event => event.type === 'spell' && event.stage === 'impact'));
  assert.ok(events.some(event => event.type === 'spell' && event.stage === 'pulse'));
  assert.ok(events.every(event => event.type === 'spell' && event.spellId === 'maelstrom' && event.presentation === presentation));
  assert.ok(events.every(event => !['draw', 'slam'].includes(event.type)));
});
