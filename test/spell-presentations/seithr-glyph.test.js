import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/seithr-glyph.js';
import definition from '../../src/spells/definitions/seithr-glyph.js';
import { runeScene } from '../../test-support/spells.js';

function frame(stage, progress, extra = {}) {
  const points = [];
  const effect = Object.freeze({ stage, progress, radius: 3, age: progress,
    life: 1, heading: 0, ...extra });
  presentation.draw(effect, (x, z, char, color, brightness = 1) => {
    points.push({ x, z, char, color, brightness });
  });
  return points;
}

test('Seithr Glyph opts in while preserving its original spell behavior data', () => {
  assert.equal(definition.presentation, presentation);
  assert.equal(presentation.id, definition.id);
  assert.deepEqual(definition.variants[0].params, {
    cooldown: 20, mana: 8, duration: 8, frozen_duration: 8,
  });
  assert.equal(definition.root, 'seithr_glyph');
  assert.match(definition.nodes.seithr_glyph_skill_active.steps[0].args.d, /frozen_duration/);
});

test('six branched arms and six square runes etch into a snowflake sigil', () => {
  const early = frame('cast', 0.12);
  const built = frame('cast', 0.74);
  assert.ok(built.length > early.length, 'arms and runes finish etching over time');
  assert.equal(built.filter(point => point.char === '*').length, 7,
    'six arm tips and a bright center');
  assert.equal(built.filter(point => point.char === '|').length, 12,
    'six square runes each have two side strokes');
  assert.equal(built.filter(point => ['/', '\\'].includes(point.char)).length, 24,
    'each arm carries two paired branches');
  const impact = frame('impact', 0.5);
  assert.ok(impact.some(point => point.char === 'x'));
  assert.notDeepEqual(impact, frame('cast', 0.5));
  const before = frame('impact', 0.2).filter(point => point.char === '|');
  const after = frame('impact', 0.65).filter(point => point.char === '|');
  const radialExtent = points => Math.max(...points.map(point => Math.hypot(point.x, point.z)));
  assert.ok(radialExtent(after) > radialExtent(before), 'impact pushes the square seal outward');
});

test('every stage stays finite, bounded, deterministic and fades to clear terrain', () => {
  for (const stage of ['cast', 'impact', 'pulse', 'aura', 'zone', 'projectile']) {
    for (const progress of [0, 0.05, 0.3, 0.65, 0.95, 1]) {
      const points = frame(stage, progress);
      assert.ok(points.length <= 96);
      assert.deepEqual(points, frame(stage, progress), `${stage} is deterministic`);
      for (const point of points) {
        assert.ok(Number.isFinite(point.x) && Number.isFinite(point.z));
        assert.ok(Math.hypot(point.x, point.z) < 10);
        assert.match(point.char, /^[\x20-\x7e]$/);
        assert.ok(point.color.length === 3 && point.color.every(channel => channel >= 0 && channel <= 255));
        assert.ok(Number.isFinite(point.brightness) && point.brightness >= 0 && point.brightness <= 1);
      }
    }
    assert.equal(frame(stage, 1).length, 0, `${stage} fully fades`);
    const brightness = points => points.reduce((sum, point) => sum + point.brightness, 0);
    assert.ok(brightness(frame(stage, 0.95)) < brightness(frame(stage, 0.65)));
  }
  const projectile = frame('projectile', 0.5);
  assert.ok(projectile.some(point => point.z < -0.7 && point.char === '.'));
  assert.ok(projectile.some(point => point.char === '/'));
  assert.deepEqual(frame('zone', 0.5), frame('zone', 0.5, { heading: Math.PI }),
    'world rotation belongs to the shared runtime');
});

test('six crystalline steps precede a drone, simultaneous sealing chord and quiet pulse', () => {
  const cast = presentation.sounds.cast;
  const steps = cast.filter(voice => voice.type === 'sine');
  assert.equal(steps.length, 6);
  assert.ok(steps.every((voice, index) => index === 0 ||
    (voice.delay > steps[index - 1].delay && voice.frequency > steps[index - 1].frequency)));
  const drone = cast.find(voice => voice.type === 'triangle');
  assert.ok(drone.duration > steps.at(-1).delay + steps.at(-1).duration);
  assert.ok(drone.gain < Math.min(...steps.map(voice => voice.gain)));
  const chord = presentation.sounds.impact.filter(voice => voice.delay === 0);
  assert.ok(chord.length >= 3 && new Set(chord.map(voice => voice.frequency)).size === chord.length);
  for (const voices of Object.values(presentation.sounds)) {
    assert.ok(voices.length <= 8);
    for (const voice of voices) {
      assert.ok(['tone', 'noise'].includes(voice.kind));
      assert.ok(voice.gain > 0 && voice.gain <= 0.25);
      assert.ok(voice.duration > 0 && voice.duration <= 2.5);
      assert.ok(voice.delay >= 0 && voice.delay <= 2);
      assert.ok(voice.attack > 0 && voice.release > 0 && voice.attack + voice.release <= voice.duration);
    }
  }
  assert.ok(presentation.sounds.pulse.every(voice => voice.gain <= 0.02 && voice.duration <= 0.2));
});

test('real Seithr Glyph casts render the authored runes and emit typed crystal cues', () => {
  const scene = runeScene(definition, { range: 1 });
  const events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  assert.equal(scene.cast().ok, false, 'cooldown rejects a repeat cast without another cue');
  assert.equal(events.filter(event => event.stage === 'cast').length, 1);
  assert.ok(scene.casting.effects.list.some(effect =>
    effect.stage === 'cast' && effect.presentation === presentation));
  scene.advance(0.35);
  const points = [];
  scene.casting.effects.paint((...point) => points.push(point), scene.casting.projectiles);
  assert.ok(points.some(point => point[2] === '|'), 'authored square rune strokes reach the renderer');
  assert.ok(points.some(point => point[2] === '/'), 'branched snowflake strokes reach the renderer');
  scene.advance(2);
  assert.ok(scene.aura(scene.foe, 'Frozen'), 'the existing armed glyph still freezes contacts');
  assert.ok(events.some(event => event.stage === 'impact'), 'freeze seals with the authored chord');
  assert.ok(events.every(event => event.type === 'spell' && event.spellId === definition.id
    && event.presentation === presentation), 'all spell cues carry this profile instead of draw/slam');
});
