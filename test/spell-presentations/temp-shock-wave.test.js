import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/temp-shock-wave.js';
import spell from '../../src/spells/definitions/temp-shock-wave.js';
import { runeScene } from '../../test-support/spells.js';
import { paintPresentation } from '../../src/spells/presentation.js';
import { playSpellSound } from '../../src/audio/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';

function draw(stage, progress, heading = 0) {
  const points = [];
  presentation.draw({ stage, progress, age: progress * presentation.duration,
    life: presentation.duration, radius: 1, heading }, (...point) => points.push(point));
  return points;
}

test('Woodland Anvil has a protruding horn, broad foot, and descending mallet', () => {
  assert.equal(spell.presentation, presentation);
  const early = draw('cast', 0.05), late = draw('cast', 0.55);
  const horn = early.find(p => p[2] === '<');
  const face = early.filter(p => p[2] === '=' && p[1] === horn[1]);
  assert.ok(horn[0] < Math.min(...face.map(p => p[0])), 'horn projects beyond the flat working face');
  const feet = early.filter(p => p[1] < -0.8);
  assert.ok(feet.some(p => p[0] < -0.8) && feet.some(p => p[0] > 0.8), 'anvil rests on two wide feet');
  const headHeight = points => Math.min(...points.filter(p => p[3][0] === 205 && p[2] === '=').map(p => p[1]));
  assert.ok(headHeight(early) > headHeight(late) + 1, 'mallet falls onto the working face');
  assert.ok(late.some(p => p[2] === '*'), 'contact briefly throws a bright strike');
  assert.deepEqual(draw('cast', 0.3, Math.PI / 2), draw('cast', 0.3), 'heading rotation belongs to the shared adapter');
});

test('impact sends rectangular slabs forward, while projectile retains horn and block trail', () => {
  const start = draw('impact', 0.1), later = draw('impact', 0.55);
  const corners = points => points.filter(p => p[2] === '+');
  assert.ok(corners(start).length >= 8, 'several outlined slabs have square corners');
  for (const point of corners(start)) {
    assert.ok(corners(start).some(other => other[0] === -point[0] && other[1] === point[1]), 'slab corners form matched left/right edges');
  }
  assert.ok(Math.max(...corners(later).map(p => p[1])) > Math.max(...corners(start).map(p => p[1])), 'shock slabs advance across the ground');
  assert.ok(!start.some(p => p[3][0] === 205), 'impact resolves to the planted anvil and earth rather than another mallet');
  const projectile = draw('projectile', 0.2);
  assert.ok(projectile.some(p => p[2] === '<'), 'travelling effect remains an anvil');
  assert.ok(projectile.filter(p => p[1] < -0.6 && ['[', ']'].includes(p[2])).length >= 6, 'squared wake follows the compact silhouette');
  assert.notDeepEqual(start, draw('cast', 0.1));
});

test('all stages remain finite, bounded, ASCII, deterministic, and fade completely', () => {
  for (const stage of ['cast', 'impact', 'pulse', 'aura', 'zone', 'projectile']) {
    for (const progress of [0, 0.35, 0.7, 0.98, 1]) {
      const points = draw(stage, progress);
      assert.ok(points.length > 0 && points.length <= 96, `${stage} fits its draw budget`);
      assert.deepEqual(points, draw(stage, progress));
      for (const [x, z, char, color, brightness = 1] of points) {
        assert.ok([x, z, brightness, ...color].every(Number.isFinite));
        assert.ok(Math.abs(x) < 8 && Math.abs(z) < 8);
        assert.match(char, /^[\x20-\x7e]$/);
        assert.ok(color.every(value => value >= 0 && value <= 255));
        assert.ok(brightness >= 0 && brightness <= 1);
        if (progress === 1) assert.equal(brightness, 0, `${stage} fades completely`);
      }
    }
    assert.notDeepEqual(draw(stage, 0.1), draw(stage, 0.95), `${stage} evolves with time`);
  }
});

test('sound has a delayed wooden strike, resonant anvil body, and separate low aftershock', () => {
  const { cast, impact, pulse } = presentation.sounds;
  assert.ok(cast.some(v => v.kind === 'noise' && v.delay >= 0.5 && v.filterType === 'bandpass'), 'mallet strike waits for the hammer descent');
  assert.ok(cast.filter(v => v.kind === 'tone' && v.delay >= 0.6).length >= 2, 'inharmonic body tones follow the mallet');
  assert.ok(impact.some(v => v.kind === 'noise' && v.delay >= 0.2 && v.cutoff <= 200), 'soil aftershock follows the contact');
  assert.ok(impact.some(v => v.kind === 'tone' && v.delay >= 0.2 && v.endFrequency < 40), 'aftershock has a descending sub-bass body');
  assert.notDeepEqual(cast, impact);
  assert.ok(pulse.every(v => v.gain <= 0.03 && v.duration <= 0.15), 'repeated ground ticks remain quiet and brief');
  for (const recipe of Object.values(presentation.sounds)) {
    assert.ok(recipe.length > 0 && recipe.length <= 8);
    for (const voice of recipe) {
      assert.ok(voice.gain > 0 && voice.gain <= 0.25);
      assert.ok(voice.duration > 0 && voice.duration <= 2.5);
      assert.ok((voice.delay ?? 0) >= 0 && (voice.delay ?? 0) <= 2);
    }
    const fake = fakeRecordedAudio();
    const stage = Object.entries(presentation.sounds).find(([, value]) => value === recipe)[0];
    const handles = playSpellSound(fake.engine, { presentation, stage, x: 4, y: 7 });
    assert.equal(handles.length, recipe.length, 'every authored layer reaches the existing voice instruments');
    assert.ok(fake.routes.every(route => route.bus === 'sfx' && route.x === 4 && route.y === 7));
    assert.deepEqual(fake.invalid, []);
    for (const handle of handles) handle.stop();
  }
});

test('real rune cast renders authored cues and travelling anvil without sword sounds or gameplay changes', () => {
  const scene = runeScene(spell), events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  assert.equal(scene.cast().ok, false, 'original cooldown still rejects repeated casts');
  assert.equal(events.filter(event => event.stage === 'cast').length, 1);
  const castDots = [];
  scene.casting.effects.paint((...point) => castDots.push(point), scene.casting.projectiles);
  assert.ok(castDots.some(point => point[2] === '<'), 'runtime paints the authored anvil horn');
  scene.advance(1);
  assert.equal(scene.foe.health, 100, 'earthquake retains its charge delay');
  assert.equal(scene.player.magicSpeed, 0, 'charge retains its movement restriction');
  scene.advance(1.5);
  assert.ok(scene.casting.projectiles.length > 0, 'original projectile carries the earthquake');
  const projectile = scene.casting.projectiles[0], expected = [], actual = [];
  paintPresentation(presentation, { x: projectile.x, y: projectile.y - projectile.h * 5,
    stage: 'projectile', age: projectile.age, life: projectile.life, radius: 0.65,
    heading: Math.atan2(projectile.dx, projectile.dz) }, (...point) => expected.push(point));
  scene.casting.effects.paint((...point) => actual.push(point), scene.casting.projectiles);
  assert.ok(expected.length > 0 && expected.every(point => actual.some(other => JSON.stringify(other) === JSON.stringify(point))), 'live projectile renderer uses the authored profile');
  scene.advance(2.5);
  assert.equal(scene.foe.health, 80, 'original TF damage remains 20');
  assert.ok(events.some(event => event.type === 'spell' && event.stage === 'impact'));
  assert.ok(events.every(event => event.type === 'spell' && event.presentation === presentation));
  assert.ok(events.every(event => !['draw', 'slam'].includes(event.type)));
});
