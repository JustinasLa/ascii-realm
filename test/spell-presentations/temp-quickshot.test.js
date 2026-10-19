import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/temp-quickshot.js';
import spell from '../../src/spells/definitions/temp-quickshot.js';
import { paintPresentation } from '../../src/spells/presentation.js';
import { playSpellSound } from '../../src/audio/spells.js';
import { runeScene } from '../../test-support/spells.js';
import { fakeRecordedAudio } from '../../test-support/recorded-audio.js';

function points(stage, progress = 0.25) {
  const result = [];
  presentation.draw({ stage, progress, age: progress * presentation.duration,
    life: presentation.duration, radius: 1, heading: 0 }, (...p) => result.push(p));
  return result;
}

test('Leaf Arrow has a straight midrib, pointed leaf head, alternating fletching and trailing leaf', () => {
  assert.equal(spell.presentation, presentation);
  const flight = points('projectile');
  const midrib = flight.filter(p => p[2] === '|');
  assert.ok(midrib.length >= 8 && midrib.every(p => p[0] === 0), 'a continuous straight vein defines the arrow');
  assert.ok(flight.some(p => p[2] === '^' && p[1] > 0.7), 'the pointed head leads the midrib');
  const fletching = flight.filter(p => ['<', '>'].includes(p[2]));
  assert.deepEqual(fletching.map(p => Math.sign(p[0])), [-1, 1, -1, 1]);
  assert.ok(fletching.every(p => p[1] < 0), 'leaflet fletching stays behind the head');
  assert.ok(flight.some(p => p[2] === ',' && p[1] < -1.5), 'one detached leaf trails behind');
  const impact = points('impact');
  assert.equal(impact.filter(p => p[2] === '^').length, 5, 'impact opens five separate leaf tips');
  assert.ok(impact.some(p => p[2] === '*'));
  assert.ok(!impact.some(p => p[2] === '|'), 'impact has leaf veins radiating from a star instead of a shaft');
});

test('all Leaf Arrow stages are finite, bounded, deterministic, animated and fade out', () => {
  for (const stage of ['cast', 'projectile', 'impact', 'pulse', 'aura', 'zone']) {
    const first = points(stage, 0.05), middle = points(stage, 0.5), last = points(stage, 1);
    assert.deepEqual(middle, points(stage, 0.5));
    assert.notDeepEqual(first, middle, `${stage} geometry develops over time`);
    for (const frame of [first, middle, last]) {
      assert.ok(frame.length > 10 && frame.length <= 96);
      for (const [x, z, char, color, brightness] of frame) {
        assert.ok([x, z, brightness, ...color].every(Number.isFinite));
        assert.ok(Math.abs(x) < 3 && Math.abs(z) < 3, 'the quick arrow and star stay compact');
        assert.match(char, /^[\x20-\x7e]$/);
        assert.ok(color.every(c => c >= 0 && c <= 255));
        assert.ok(brightness >= 0 && brightness <= 1);
      }
    }
    assert.ok(last.every(p => p[4] === 0), `${stage} fades completely`);
  }
  assert.notDeepEqual(points('cast'), points('projectile'));
  assert.notDeepEqual(points('cast'), points('impact'));
});

test('Leaf Arrow schedules a woody two-part twang, delayed dart and uneven dry leaf flicks on SFX', () => {
  const { cast, impact } = presentation.sounds;
  const twang = cast.filter(v => v.kind === 'tone');
  assert.equal(twang.length, 2);
  assert.ok(twang.every(v => v.endFrequency < v.frequency && v.attack <= 0.002));
  assert.ok(twang.some(v => v.type === 'triangle') && twang.some(v => v.type === 'sine'));
  const dart = cast.find(v => v.kind === 'noise');
  assert.ok(dart.delay > Math.max(...twang.map(v => v.delay ?? 0)));
  assert.equal(dart.filterType, 'bandpass');
  const flicks = impact.filter(v => v.kind === 'noise');
  assert.equal(flicks.length, 3);
  const intervals = flicks.slice(1).map((v, i) => v.delay - (flicks[i].delay ?? 0));
  assert.notEqual(intervals[0], intervals[1], 'the dry flicks have an uneven rhythm');
  assert.ok(flicks.every(v => v.duration <= 0.05));
  assert.notDeepEqual(cast, impact);
  for (const [stage, recipe] of Object.entries(presentation.sounds)) {
    assert.ok(recipe.length <= 8);
    for (const v of recipe) {
      assert.ok(v.gain > 0 && v.gain <= 0.25 && v.duration > 0 && v.duration <= 2.5);
      assert.ok((v.delay ?? 0) >= 0 && (v.delay ?? 0) <= 2);
      assert.ok(Object.values(v).filter(v => typeof v === 'number').every(Number.isFinite));
    }
    const fake = fakeRecordedAudio();
    const handles = playSpellSound(fake.engine, { presentation, stage, x: 7, y: 11 });
    assert.equal(handles.length, recipe.length);
    assert.ok(fake.routes.every(r => r.bus === 'sfx' && r.x === 7 && r.y === 11));
    const sources = fake.nodes.filter(n => ['source', 'oscillator'].includes(n.kind));
    assert.deepEqual(sources.map(n => n.starts[0]), recipe.map(v => fake.context.currentTime + (v.delay ?? 0)));
    assert.deepEqual(fake.invalid, []);
    handles.forEach(h => h.stop());
    assert.ok(fake.routes.every(r => r.disposals === 1));
  }
});

test('real Leaf Arrow casts render the authored profile, emit typed spell cues and retain eight damage', () => {
  const scene = runeScene(spell), sounds = [];
  scene.casting.onSound = event => sounds.push(event);
  const mana = scene.casting.state(scene.player).mana;
  assert.equal(scene.cast().ok, true);
  assert.equal(scene.casting.state(scene.player).mana, mana - 4);
  assert.equal(scene.cast().ok, false, 'cooldown rejects a second shot');
  assert.equal(sounds.length, 1, 'a rejected cast is silent');
  assert.equal(sounds[0].type, 'spell');
  assert.equal(sounds[0].stage, 'cast');
  assert.equal(sounds[0].presentation, presentation);
  assert.equal(scene.casting.projectiles[0].ctx.spell.presentation, presentation);
  const launched = [];
  scene.casting.effects.paint((...p) => launched.push(p), scene.casting.projectiles);
  assert.ok(launched.some(p => p[2] === '|') && launched.some(p => p[2] === '^'));
  scene.advance(0.2);
  assert.equal(scene.foe.health, 92);
  assert.ok(sounds.some(e => e.stage === 'impact' && e.type === 'spell'));
  assert.ok(sounds.every(e => e.presentation === presentation && !['draw', 'slam'].includes(e.type)));
  const impact = scene.casting.effects.list.find(e => e.stage === 'impact');
  assert.equal(impact.presentation, presentation);
  const rendered = [];
  paintPresentation(presentation, impact, (...p) => rendered.push(p));
  assert.equal(rendered.filter(p => p[2] === '^').length, 5);
  scene.advance(2);
  assert.equal(scene.foe.health, 92, 'the leaf star is cosmetic');
  assert.equal(scene.casting.projectiles.length, 0);
});
