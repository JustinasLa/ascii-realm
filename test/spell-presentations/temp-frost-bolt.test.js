import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/temp-frost-bolt.js';
import spell from '../../src/spells/definitions/temp-frost-bolt.js';
import { runeScene } from '../../test-support/spells.js';

function draw(stage, progress, options = {}) {
  const points = [];
  presentation.draw(Object.freeze({ stage, progress, age: progress * presentation.duration,
    life: presentation.duration, radius: 1, heading: 0, ...options }),
  (x, z, char, color, brightness = 1) => points.push({ x, z, char, color, brightness }));
  return points;
}

const extent = (points, axis) => Math.max(...points.map(p => p[axis])) - Math.min(...points.map(p => p[axis]));

test('Frost Bolt opts into a long comet with paired frost ribs and trailing vapour', () => {
  assert.equal(spell.presentation, presentation);
  assert.equal(presentation.id, spell.id);
  const points = draw('cast', 0.3);
  assert.ok(extent(points, 'z') > extent(points, 'x') * 3, 'the silhouette is a long bolt');
  assert.equal(points.filter(p => p.char === '[').length, 5, 'five separated left ribs');
  assert.equal(points.filter(p => p.char === ']').length, 5, 'five separated right ribs');
  assert.ok(points.some(p => p.char === '^' && p.z > 0), 'a pointed leading nose');
  assert.ok(points.some(p => p.char === '.' && p.z < -1.5), 'vapour trails behind the ribs');
  assert.notDeepEqual(draw('cast', 0.15), draw('cast', 0.6), 'the bolt stretches and flexes during release');
});

test('the projectile retains its ribbed nose and tail without rotating its local geometry twice', () => {
  const points = draw('projectile', 0.4);
  assert.ok(points.some(p => p.char === '^'));
  assert.ok(points.some(p => p.char === '[') && points.some(p => p.char === ']'));
  assert.ok(points.some(p => p.z < -1));
  assert.ok(extent(points, 'x') < 1 && extent(points, 'z') < 3, 'the projectile stays compact');
  assert.deepEqual(draw('projectile', 0.4, { heading: 1.2 }), points);
});

test('impact snaps the rib pairs apart around a jagged seam instead of keeping the comet', () => {
  const early = draw('impact', 0.15), late = draw('impact', 0.65);
  assert.ok(!early.some(p => p.char === '^'), 'the forward nose has shattered');
  assert.ok(early.some(p => p.char === 'x'), 'broken frozen chips fly from the seam');
  const ribWidth = points => extent(points.filter(p => p.char === '[' || p.char === ']'), 'x');
  assert.ok(ribWidth(late) > ribWidth(early) * 2, 'the two rib halves snap outward');
  assert.ok(early.filter(p => Math.abs(p.x) < 0.15 && '/\\'.includes(p.char)).length >= 8,
    'a bright jagged fracture runs through the middle');
  assert.notDeepEqual(early, draw('cast', 0.15));
});

test('every effect stage is deterministic, bounded, atlas compatible, and fades out', () => {
  for (const stage of ['cast', 'projectile', 'impact', 'pulse', 'aura', 'zone']) {
    for (const progress of [0, 0.2, 0.65, 0.99]) {
      for (const radius of [0, 1, 40]) {
        const options = { radius };
        const points = draw(stage, progress, options);
        assert.deepEqual(points, draw(stage, progress, options));
        assert.ok(points.length > 0 && points.length <= 96, `${stage} stays within the draw budget`);
        for (const p of points) {
          assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z));
          assert.ok(Math.abs(p.x) < 8 && Math.abs(p.z) < 12);
          assert.match(p.char, /^[!-~]$/);
          assert.equal(p.color.length, 3);
          assert.ok(p.color.every(value => Number.isFinite(value) && value >= 0 && value <= 255));
          assert.ok(Number.isFinite(p.brightness) && p.brightness >= 0 && p.brightness <= 1);
        }
      }
    }
    assert.ok(Math.max(...draw(stage, 0.99).map(p => p.brightness)) < 0.05);
    assert.deepEqual(draw(stage, 1), []);
  }
});

test('the sound is an immediate string snap, delayed falling whistle and lower crystal crunch', () => {
  const { cast, impact } = presentation.sounds;
  const snap = cast.find(v => v.kind === 'tone' && v.type === 'triangle' && v.delay === 0);
  const whistle = cast.find(v => v.kind === 'tone' && v.duration > 0.3);
  assert.ok(snap && snap.attack <= 0.003 && snap.duration < 0.12 && snap.endFrequency < snap.frequency / 2);
  assert.ok(whistle && whistle.delay > snap.delay && whistle.endFrequency < whistle.frequency / 2);
  assert.ok(cast.some(v => v.kind === 'noise' && v.filterType === 'highpass' && v.duration < 0.05));
  assert.ok(impact.some(v => v.kind === 'noise' && v.filterType === 'bandpass' && v.cutoff < 1600));
  assert.ok(impact.some(v => v.kind === 'tone' && v.frequency < whistle.endFrequency));
  assert.ok(new Set(impact.filter(v => v.kind === 'tone').map(v => v.delay)).size >= 3,
    'the crunch has separate irregular chip attacks');
  assert.notDeepEqual(cast, impact);
  for (const sequence of Object.values(presentation.sounds)) {
    assert.ok(sequence.length > 0 && sequence.length <= 8);
    for (const voice of sequence) {
      assert.ok(['tone', 'noise'].includes(voice.kind));
      for (const [field, value] of Object.entries(voice)) {
        if (typeof value === 'number') assert.ok(Number.isFinite(value), field);
      }
      assert.ok(voice.gain > 0 && voice.gain <= 0.25);
      assert.ok(voice.delay >= 0 && voice.delay <= 2);
      assert.ok(voice.duration > 0 && voice.duration <= 2.5);
      assert.ok(voice.attack > 0 && voice.release > 0 && voice.attack + voice.release <= voice.duration);
    }
  }
});

test('a real Frost Bolt cast renders its comet and split impact and emits typed spell cues', () => {
  const { casting, cast, advance, foe } = runeScene(spell);
  const sounds = [];
  casting.onSound = event => sounds.push(event);
  assert.equal(cast().ok, true);
  assert.ok(casting.effects.list.some(effect => effect.stage === 'cast' && effect.presentation === presentation));
  assert.equal(casting.projectiles.length, 1);
  const rendered = [];
  const paint = () => casting.effects.paint((x, z, char, color, brightness) =>
    rendered.push({ x, z, char, color, brightness }), casting.projectiles);
  paint();
  assert.ok(rendered.some(point => point.char === '^'), 'the runtime paints the pointed comet nose');
  assert.ok(rendered.some(point => point.char === '[') && rendered.some(point => point.char === ']'),
    'the runtime paints segmented frost ribs');
  advance(0.2);
  assert.equal(foe.health, 92);
  assert.ok(casting.effects.list.some(effect => effect.stage === 'impact' && effect.presentation === presentation));
  rendered.length = 0;
  paint();
  assert.ok(rendered.some(point => point.char === 'x'), 'the real impact paints broken frozen chips');
  for (const stage of ['cast', 'impact']) {
    const cue = sounds.find(event => event.type === 'spell' && event.stage === stage);
    assert.ok(cue, `the ${stage} sound reaches the spatial spell bus`);
    assert.equal(cue.spellId, spell.id);
    assert.equal(cue.presentation, presentation);
  }
  assert.ok(!sounds.some(event => event.type === 'draw' || event.type === 'slam'));
});
