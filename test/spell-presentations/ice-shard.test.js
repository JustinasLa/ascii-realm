import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/ice-shard.js';
import spell from '../../src/spells/definitions/ice-shard.js';
import { runeScene } from '../../test-support/spells.js';

function points(stage, progress, options = {}) {
  const result = [];
  const effect = Object.freeze({ stage, progress, age: progress * 0.86, life: 0.86,
    radius: 2, heading: 1.3, ...options });
  presentation.draw(effect, (x, z, char, color, brightness = 1) => {
    result.push({ x, z, char, color: [...color], brightness });
  });
  return result;
}

test('Ice Shard opts into its crystal profile while retaining its rune parameters', () => {
  assert.equal(spell.presentation, presentation);
  assert.equal(presentation.id, spell.id);
  assert.equal(spell.root, 'ice_shard');
  assert.deepEqual(spell.variants[0].params, { cooldown: 10, mana: 4, duration: 6 });
  assert.equal(spell.nodes.ice_shard.steps[0].args.onhit, 'Ice_Shard_HIT');
});

test('real Ice Shard casts render its crystal and fractures with typed spell cues', () => {
  const scene = runeScene(spell);
  const events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  assert.equal(scene.cast().ok, false, 'cooldown rejection emits no extra cast cue');
  assert.equal(events.filter(event => event.stage === 'cast').length, 1);
  assert.equal(scene.casting.effects.list[0].presentation, presentation);
  assert.equal(scene.casting.projectiles[0].ctx.spell.presentation, presentation);
  const flight = [];
  scene.casting.effects.paint((...point) => flight.push(point), scene.casting.projectiles);
  assert.ok(flight.some(point => point[2] === '.') && flight.some(point => point[2] === '|'),
    'runtime paints crystal facets and frost dust');
  assert.ok(!flight.some(point => point[2] === '+'));
  scene.advance(0.15);
  assert.ok(scene.aura(scene.foe, 'Slowed'));
  assert.equal(scene.foe.health, 100, 'presentation preserves the slow-only rune');
  assert.ok(events.some(event => event.type === 'spell' && event.stage === 'impact'));
  assert.ok(events.every(event => event.type === 'spell' && event.spellId === spell.id
    && event.presentation === presentation), 'cast replaces generic draw/slam cues');
  const fracture = [];
  scene.casting.effects.paint((...point) => fracture.push(point), scene.casting.projectiles);
  assert.ok(fracture.filter(point => point[2] === '+').length >= 6,
    'runtime paints six-ray fractures at contact');
  assert.ok(fracture.some(point => point[2] === '<') && fracture.some(point => point[2] === '>'));
});

test('projectile is a faceted diamond with six edge splinters and a trailing frost wake', () => {
  const flight = points('projectile', 0.3);
  const edges = flight.filter(point => point.char === '*');
  assert.equal(edges.length, 7, 'six side splinters plus one leading tip');
  assert.equal(edges.filter(point => point.x < 0).length, 3);
  assert.equal(edges.filter(point => point.x > 0).length, 3);
  assert.ok(flight.some(point => point.char === '|'));
  assert.ok(flight.some(point => point.char === '-'));
  const dust = flight.filter(point => point.char === '.');
  assert.ok(dust.length > 5);
  assert.ok(dust.every(point => point.z < 0), 'dust follows behind the forward tip');
  assert.ok(Math.min(...dust.map(point => point.z)) < Math.min(...edges.map(point => point.z)));
  assert.ok(Math.max(...flight.map(point => Math.hypot(point.x, point.z))) < 1.5,
    'in-flight motif stays compact');
});

test('cast grows into a diamond; impact breaks into six expanding fracture rays', () => {
  const earlyCast = points('cast', 0.02);
  const formedCast = points('cast', 0.3);
  const leadingTip = list => Math.max(...list.filter(point => point.char === '*').map(point => point.z));
  assert.ok(leadingTip(formedCast) > leadingTip(earlyCast));
  const fracture = points('impact', 0.2);
  const tips = fracture.filter(point => point.char === '+');
  assert.equal(tips.length, 6);
  const sectors = new Set(tips.map(point => Math.round(Math.atan2(point.x, point.z) / (Math.PI / 3))));
  assert.equal(sectors.size, 6, 'fractures cover six distinct directions');
  assert.equal(fracture.filter(point => point.char === '-').length, 6, 'each ray branches sideways');
  const laterTips = points('impact', 0.65).filter(point => point.char === '+');
  assert.ok(Math.hypot(laterTips[0].x, laterTips[0].z) > Math.hypot(tips[0].x, tips[0].z));
  assert.notDeepEqual(formedCast, fracture);
  assert.notDeepEqual(points('projectile', 0.1), points('projectile', 0.4), 'frost dust drifts with time');
});

test('every supported stage is deterministic, bounded and fades to nothing', () => {
  for (const stage of ['cast', 'projectile', 'impact', 'pulse', 'aura', 'zone']) {
    const early = points(stage, 0.2);
    assert.deepEqual(early, points(stage, 0.2));
    assert.ok(early.length > 0 && early.length <= 96);
    for (const progress of [0, 0.2, 0.65, 0.999]) {
      for (const point of points(stage, progress)) {
        assert.ok(Number.isFinite(point.x) && Number.isFinite(point.z));
        assert.ok(Math.hypot(point.x, point.z) < 5);
        assert.match(point.char, /^[\x20-\x7e]$/);
        assert.ok(point.color.every(channel => Number.isFinite(channel) && channel >= 0 && channel <= 255));
        assert.ok(Number.isFinite(point.brightness) && point.brightness >= 0 && point.brightness <= 1);
      }
    }
    assert.ok(Math.max(...points(stage, 0.999).map(point => point.brightness)) < 0.01);
    assert.equal(points(stage, 1).length, 0);
    assert.equal(points(stage, 1.5).length, 0);
    for (const point of points(stage, NaN, { age: NaN, life: Infinity, radius: NaN })) {
      assert.ok([point.x, point.z, point.brightness].every(Number.isFinite));
    }
  }
});

test('glass plink and rising whistle resolve into an irregular high-frequency fracture cluster', () => {
  const { cast, impact } = presentation.sounds;
  const plink = cast[0];
  assert.equal(plink.kind, 'tone');
  assert.ok(plink.attack < 0.005 && plink.frequency > 2000 && plink.duration < 0.15);
  const whistle = cast.find(voice => voice.endFrequency > voice.frequency);
  assert.ok(whistle && whistle.delay > plink.delay && whistle.attack > plink.attack);
  assert.ok(cast.some(voice => voice.kind === 'noise' && voice.filterType === 'highpass'));
  assert.equal(impact[0].kind, 'noise');
  assert.ok(impact.filter(voice => voice.kind === 'tone' && voice.endFrequency < voice.frequency).length >= 3);
  assert.ok(new Set(impact.slice(1).map((voice, index) =>
    Math.round((voice.delay - impact[index].delay) * 1000))).size > 3,
  'falling glass fragments land at uneven intervals');
  assert.notDeepEqual(cast, impact);
  for (const voices of [cast, impact]) {
    assert.ok(voices.length > 0 && voices.length <= 8);
    for (const voice of voices) {
      assert.ok(['tone', 'noise'].includes(voice.kind));
      assert.ok(voice.gain > 0 && voice.gain <= 0.25);
      assert.ok(voice.delay >= 0 && voice.delay <= 2);
      assert.ok(voice.duration > 0 && voice.duration <= 2.5);
      assert.ok(voice.attack > 0 && voice.release > 0 && voice.attack + voice.release <= voice.duration);
      assert.ok(Object.values(voice).every(value => typeof value !== 'number' || Number.isFinite(value)));
    }
  }
});
