import assert from 'node:assert/strict';
import test from 'node:test';
import spell from '../../src/spells/definitions/frozen-tomb.js';
import presentation from '../../src/spells/presentations/frozen-tomb.js';
import { paintPresentation } from '../../src/spells/presentation.js';
import { playSpellSound } from '../../src/audio/spells.js';
import { runeScene } from '../../test-support/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';

function draw(stage, progress = 0.5, age = progress * presentation.duration) {
  const points = [];
  const effect = Object.freeze({ stage, progress, age, life: presentation.duration, radius: 2, heading: 0 });
  presentation.draw(effect, (x, z, char, color, brightness = 1) => points.push({ x, z, char, color, brightness }));
  return points;
}

test('Frozen Tomb opts in and draws six coffin corners, solid slab seams, and growing side panels', () => {
  assert.equal(spell.presentation, presentation);
  assert.equal(presentation.id, spell.id);
  const closed = draw('zone');
  const corners = closed.filter(point => point.char === '+');
  assert.equal(corners.length, 6, 'a six-sided coffin rather than a ring');
  const top = Math.max(...corners.map(point => point.z));
  const shoulder = corners.filter(point => point.z < top && point.z > 0);
  const head = corners.filter(point => point.z === top);
  assert.ok(Math.max(...head.map(point => Math.abs(point.x))) < Math.min(...shoulder.map(point => Math.abs(point.x))),
    'the narrow head widens into angular shoulders');
  assert.ok(closed.filter(point => point.char === '|' && point.x === 0).length >= 7, 'sealed central lid spine');
  assert.ok(closed.some(point => point.char === '-' && point.x < 0 && Math.abs(point.z) < 0.1), 'transverse slab seams');
  const early = draw('cast', 0.05).filter(point => point.char === '+');
  const late = draw('cast', 0.6).filter(point => point.char === '+');
  const height = points => Math.max(...points.map(point => point.z)) - Math.min(...points.map(point => point.z));
  assert.ok(height(late) > height(early) * 2, 'ice slabs rise from the foot of the tomb');
  assert.ok(Math.max(...late.map(point => Math.abs(point.x))) < Math.max(...early.map(point => Math.abs(point.x))),
    'split panels close inward');
});

test('Frozen Tomb fractures six corners on impact and sends a small coffin with a moving frost wake', () => {
  const impact = draw('impact', 0.4);
  assert.equal(impact.filter(point => point.char === '*').length, 6, 'one terminal chip per corner fault');
  assert.ok(impact.some(point => point.char === '#'), 'heavy lid lock at impact');
  assert.ok(!draw('cast', 0.4).some(point => point.char === '*' || point.char === '#'), 'cast differs from the lid fracture');
  const projectile = draw('projectile', 0.3, 0.06);
  assert.ok(projectile.some(point => point.char === '|') && projectile.some(point => point.char === '-'), 'coffin silhouette survives flight');
  assert.ok(projectile.filter(point => point.char === '.').every(point => point.z < -0.4), 'frost wake stays behind the coffin');
  assert.notDeepEqual(projectile, draw('projectile', 0.3, 0.13), 'frost wake advances with time');
  assert.ok(Math.max(...projectile.map(point => Math.abs(point.x))) < 0.4, 'flight shape stays compact');
});

test('Frozen Tomb geometry remains finite, bounded, deterministic and fades at every stage', () => {
  for (const stage of ['cast', 'projectile', 'impact', 'aura', 'zone', 'pulse']) {
    for (const progress of [0, 0.17, 0.55, 0.94, 1]) {
      const points = draw(stage, progress);
      assert.ok(points.length > 0 && points.length <= 96, `${stage} draw budget`);
      assert.deepEqual(points, draw(stage, progress), 'repeated render does not alter state');
      for (const point of points) {
        assert.ok([point.x, point.z, point.brightness, ...point.color].every(Number.isFinite));
        assert.ok(Math.abs(point.x) < 4 && Math.abs(point.z) < 4, 'local metre coordinates');
        assert.match(point.char, /^[\x20-\x7e]$/, 'one supported ASCII glyph');
        assert.ok(point.brightness >= 0 && point.brightness <= 1);
        assert.ok(point.color.every(channel => channel >= 0 && channel <= 255));
        if (progress === 1) assert.equal(point.brightness, 0, `${stage} fades completely`);
      }
    }
    assert.notDeepEqual(draw(stage, 0.1), draw(stage, 0.95), 'animation evolves');
  }
});

test('Frozen Tomb sound grows from a bass groan through climbing ticks to a heavy lid snap', () => {
  const { cast, impact, pulse } = presentation.sounds;
  const groan = cast.find(voice => voice.kind === 'tone' && voice.frequency < 150);
  assert.ok(groan.endFrequency > groan.frequency && groan.attack > 0.1 && groan.duration > 0.8, 'slow ice-growing groan');
  const ticks = cast.filter(voice => voice.kind === 'tone' && voice.frequency > 500);
  assert.ok(ticks.length >= 3);
  for (let i = 1; i < ticks.length; i++) {
    assert.ok(ticks[i].frequency > ticks[i - 1].frequency && ticks[i].delay > ticks[i - 1].delay,
      'crystal ticks climb in pitch and time');
  }
  assert.ok(impact.some(voice => voice.kind === 'tone' && voice.frequency < 150 && voice.endFrequency < voice.frequency), 'weighted falling lid tone');
  assert.ok(impact.some(voice => voice.kind === 'noise' && voice.filterType === 'highpass' && voice.duration < 0.1), 'brittle sealing snap');
  assert.ok(impact.some(voice => voice.delay > 0.15), 'late small corner crack');
  assert.ok(pulse.every(voice => voice.gain <= 0.025 && voice.duration <= 0.1), 'repeated zone ticks stay quiet');
  assert.notDeepEqual(cast, impact);
  for (const voices of Object.values(presentation.sounds)) {
    assert.ok(voices.length > 0 && voices.length <= 8);
    for (const voice of voices) {
      assert.ok(Object.values(voice).filter(value => typeof value === 'number').every(Number.isFinite));
      assert.ok(voice.gain > 0 && voice.gain <= 0.25);
      assert.ok(voice.duration > 0 && voice.duration <= 2.5);
      assert.ok((voice.delay ?? 0) >= 0 && (voice.delay ?? 0) <= 2);
      assert.ok(voice.attack + voice.release <= voice.duration, 'smooth envelope fits the voice');
    }
  }
});

test('real Frozen Tomb cast renders its profile and routes typed cues while preserving root and damage', () => {
  const scene = runeScene(spell, { range: 20 });
  const events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  assert.equal(scene.casting.mana, 90, 'TF mana cost');
  assert.equal(scene.cast().ok, false, 'TF cooldown still rejects repeat casts');
  assert.equal(events.filter(event => event.stage === 'cast').length, 1);
  const projectile = scene.casting.projectiles[0];
  assert.equal(projectile.ctx.spell.presentation, presentation);
  const initial = [];
  scene.casting.effects.paint((...point) => initial.push(point), scene.casting.projectiles);
  assert.ok(initial.some(point => point[2] === '+') && initial.some(point => point[2] === '|'), 'runtime paints coffin joints and spine');
  const expected = [];
  paintPresentation(presentation, scene.casting.effects.list.find(effect => effect.stage === 'cast'), (...point) => expected.push(point));
  assert.deepEqual(initial.slice(0, expected.length), expected, 'effects renderer consumes authored geometry');
  scene.advance(0.7);
  assert.equal(scene.foe.magicSpeed, 0);
  assert.equal(scene.foe.health, 100, 'damage waits for the source delay');
  scene.advance(1);
  assert.equal(scene.foe.health, 77);
  assert.ok(events.some(event => event.stage === 'impact'));
  assert.ok(events.every(event => event.type === 'spell' && event.spellId === spell.id && event.presentation === presentation),
    'spell cues replace sword draw/slam cues for the whole cast');
  const fake = fakeRecordedAudio();
  const castEvent = events.find(event => event.stage === 'cast');
  const impactEvent = events.find(event => event.stage === 'impact');
  const castHandles = playSpellSound(fake.engine, castEvent);
  const impactHandles = playSpellSound(fake.engine, impactEvent);
  assert.equal(castHandles.length, presentation.sounds.cast.length);
  assert.equal(impactHandles.length, presentation.sounds.impact.length);
  assert.ok(fake.routes.every(route => route.bus === 'sfx' && Number.isFinite(route.x) && Number.isFinite(route.y)));
  assert.ok(fake.nodes.some(node => node.starts.some(time => time > fake.context.currentTime)), 'crystal ticks are scheduled in audio time');
  assert.deepEqual(fake.invalid, []);
  for (const handle of [...castHandles, ...impactHandles]) handle.stop();
  scene.advance(5);
  assert.equal(scene.foe.magicSpeed, 1, 'root expires at the source duration');
});
