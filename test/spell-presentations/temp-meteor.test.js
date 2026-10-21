import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/temp-meteor.js';
import spell from '../../src/spells/definitions/temp-meteor.js';
import { runeScene } from '../../test-support/spells.js';

const WHITE = [255, 248, 230];
const isWhite = point => point.color.every((channel, i) => channel === WHITE[i]);

function capture(stage, progress, radius = 3, heading = 0.7, life = 1) {
  const points = [];
  const effect = Object.freeze({ stage, progress, age: progress * life, life, radius, heading });
  presentation.draw(effect, (x, z, char, color, brightness) => points.push({ x, z, char, color, brightness }));
  return points;
}
// Casting lasts the profile's duration; `at` is seconds into the cast.
const castAt = (at, heading = 0) => capture('cast', at / presentation.duration, 0.8, heading, presentation.duration);
const lit = points => points.filter(point => point.brightness > 0.05);
const light = points => points.reduce((sum, point) => sum + point.brightness, 0);
const meanZ = points => points.reduce((sum, point) => sum + point.z, 0) / points.length;
const meanGreen = points => points.reduce((sum, point) => sum + point.color[1], 0) / points.length;

test('Meteor opts into its presentation while retaining its delayed gameplay graph', () => {
  assert.equal(spell.presentation, presentation);
  assert.equal(presentation.id, spell.id);
  assert.equal(presentation.duration, 1.25);
  assert.equal(spell.nodes.temp_meteor.steps[0].op, 'delay');
  assert.equal(spell.nodes.temp_meteor.steps[1].args.mob, 'Meteor');
  assert.deepEqual(spell.variants[0].params, { cooldown: 10, mana: 4, damage: 10 });
});

test('real Meteor casts render the profile and emit typed spell cues through impact', () => {
  const { casting, cast, advance, foe } = runeScene(spell);
  const cues = [];
  casting.onSound = cue => cues.push(cue);
  assert.equal(cast().ok, true);
  const castEffect = casting.effects.list.find(effect => effect.stage === 'cast');
  assert.equal(castEffect.presentation, presentation);
  assert.equal(castEffect.life, presentation.duration);
  assert.ok(cues.some(cue => cue.type === 'spell' && cue.stage === 'cast'
    && cue.spellId === spell.id && cue.presentation === presentation));
  advance(0.3);
  const charging = [];
  casting.effects.paint((x, z, char) => charging.push({ x, z, char }), casting.projectiles);
  assert.ok(charging.some(point => point.char === '@'), 'runtime paints the vortex heart overhead');
  advance(0.3);
  assert.ok(casting.projectiles.some(projectile => projectile.ctx.spell.presentation === presentation));
  const falling = [];
  casting.effects.paint((x, z, char) => falling.push({ x, z, char }), casting.projectiles);
  assert.ok(falling.filter(point => point.char === '@').length >= 4, 'runtime paints the burning meteor');
  advance(1.8);
  assert.equal(foe.health, 90);
  assert.ok(cues.some(cue => cue.type === 'spell' && cue.stage === 'impact'
    && cue.presentation === presentation));
  assert.ok(!cues.some(cue => cue.type === 'draw' || cue.type === 'slam'), 'spell uses its own cues instead of generic sword cues');
});

test('Meteor cast traces a sigil, winds a vortex overhead, releases the rock and locks onto the landing site', () => {
  const sigil = points => points.filter(point => Math.abs(point.z) < 1.2 && Math.abs(point.x) < 1.1
    && /[-|/\\*]/.test(point.char) && point.brightness > 0.3);
  assert.ok(sigil(castAt(0.3)).length > sigil(castAt(0.06)).length + 20, 'the fire sigil is traced progressively');

  const vortex = at => castAt(at).filter(point => point.z < -3.4);
  const width = points => Math.max(...points.map(point => Math.abs(point.x)));
  assert.ok(vortex(0.4).some(point => point.char === '@'), 'a burning heart forms six metres overhead');
  assert.ok(width(vortex(0.45)) < width(vortex(0.12)), 'the vortex arms tighten as it charges');
  assert.ok(vortex(0.5).some(isWhite), 'the rock tears free in a white flash');
  assert.ok(!vortex(0.3).some(isWhite), 'no flash before the release');
  assert.ok(vortex(0.75).some(point => point.char === '~'), 'the spent vortex unwinds into smoke');

  const reticle = at => castAt(at).filter(point => point.z > 5);
  assert.equal(reticle(0.3).length, 0, 'no target marker before the release');
  const marker = reticle(0.8);
  assert.ok(marker.some(point => point.char === 'x' && Math.abs(point.z - 7.5) < 0.3), 'the landing site 7.5 m ahead is marked');
  const span = points => Math.max(...points.map(point => Math.abs(point.x)));
  assert.ok(span(reticle(0.95)) < span(reticle(0.6)), 'the target ring tightens as the meteor nears');

  const turned = castAt(0.8, Math.PI / 2);
  const world = turned.map(point => ({ ...point, x: point.x * Math.cos(Math.PI / 2) + point.z * Math.sin(Math.PI / 2) }));
  assert.ok(world.some(point => point.char === 'x' && Math.abs(point.x - 7.5) < 0.3), 'the marker follows the aim');
});

test('Meteor projectile is a tumbling burning rock with a long tapering tail behind it', () => {
  const points = capture('projectile', 0.3, 0.65, 0);
  assert.ok(points.length >= 80 && points.length <= 110);
  const core = points.filter(point => Math.hypot(point.x, point.z) < 0.35);
  assert.ok(core.filter(point => point.char === '@').length >= 4, 'molten heart and white-hot leading rim');
  assert.ok(core.some(point => point.char === '#' || point.char === '%'), 'dark stone body');
  // Heading 0 travels down the screen, so the tail streams up (negative z).
  const tail = points.filter(point => point.z < -0.6);
  assert.ok(tail.length >= 30, 'a dense fire tail');
  assert.ok(Math.min(...points.map(point => point.z)) < -2.5, 'the tail stretches well behind the rock');
  assert.ok(Math.max(...points.map(point => point.z)) < 0.6, 'nothing streams ahead of the bow shock');
  assert.ok(points.some(point => isWhite(point) && point.z > 0.3), 'plasma bow shock on the leading side');
  const near = tail.filter(point => point.z > -1.5), far = tail.filter(point => point.z < -2.2);
  assert.ok(meanGreen(near) > meanGreen(far), 'the tail cools from gold to red with distance');
  assert.notDeepEqual(capture('projectile', 0.32, 0.65, 0), points, 'the rock tumbles and the tail flickers');
});

test('Meteor impact flashes white, engulfs the target in flame and scatters cooling embers', () => {
  const early = capture('impact', 0.05, 1), middle = capture('impact', 0.35, 1), late = capture('impact', 0.8, 1);
  assert.ok(early.filter(isWhite).length >= 8, 'white starburst on contact');
  assert.ok(!middle.some(isWhite), 'the flash is brief');
  assert.ok(middle.some(point => point.char === '^' && point.z < -0.4), 'flames climb the target');
  assert.ok(lit(late).length > 0 && light(late) < light(middle) * 0.6, 'it fades as it cools');
  assert.ok(meanGreen(late) < meanGreen(middle), 'embers cool toward red');
});

test('Meteor landing: a ground-cracking shock front and small rolling fireballs', () => {
  const ring = points => points.filter(point => Math.abs(point.z) < 0.4 && Math.abs(point.x) > 0.3);
  const reach = points => Math.max(...ring(points).map(point => Math.abs(point.x)));
  const at = t => capture('pulse', t, 2, 0, 0.6);
  assert.ok(at(0.02).some(isWhite), 'detonation flash');
  assert.ok(reach(at(0.3)) > reach(at(0.08)) + 0.4, 'the shock front races outward');
  assert.ok(reach(at(0.3)) < 2.2, 'and stays a readable size');
  assert.ok(lit(at(0.75)).length < lit(at(0.25)).length && light(at(0.75)) < light(at(0.25)) * 0.6, 'the front frays into dust');
  assert.ok(at(0.35).some(point => /[#o*^]/.test(point.char) && point.z < -0.4), 'rock chunks are thrown on arcs');
  assert.ok(at(0.25).length <= 210);

  const flare = t => capture('pulse', t, 1, 0, 0.25);
  assert.ok(meanZ(flare(0.7)) < meanZ(flare(0.1)), 'the small fireballs roll upward');
  assert.ok(flare(0.4).length <= 90, 'repeated burn ticks stay lean');
});

test('Meteor zone is a burning crater that forms hot and cools over its life', () => {
  const at = p => capture('zone', p, 1.5, 0, 2);
  const early = at(0.12), late = at(0.9);
  const rim = points => points.filter(point => /[#%o^]/.test(point.char) && Math.abs(point.z) < 1.2);
  const width = Math.max(...rim(at(0.5)).map(point => Math.abs(point.x)));
  assert.ok(width > 0.8 && width < 1.2, 'rubble rim sits inside the burning area');
  assert.ok(at(0.5).filter(point => /[~=]/.test(point.char)).length >= 20, 'molten floor churns inside');
  assert.ok(meanGreen(late) < meanGreen(early), 'the crater cools from orange to dull red');
  assert.notDeepEqual(at(0.5), at(0.52), 'flames flicker and embers rise');
});

test('Meteor art keeps its orientation whatever the aim heading', () => {
  const rotate = (point, heading) => ({
    x: point.x * Math.cos(heading) + point.z * Math.sin(heading),
    z: point.z * Math.cos(heading) - point.x * Math.sin(heading),
  });
  const straight = capture('impact', 0.3, 1, 0), turned = capture('impact', 0.3, 1, 1.1);
  assert.equal(turned.length, straight.length);
  turned.forEach((point, i) => {
    const world = rotate(point, 1.1);
    assert.ok(Math.abs(world.x - straight[i].x) < 1e-9 && Math.abs(world.z - straight[i].z) < 1e-9);
    assert.equal(point.char, straight[i].char);
  });
});

test('Meteor remains deterministic, bounded and fades out in every supported stage', () => {
  const budget = { cast: 256, projectile: 110, impact: 200, pulse: 210, aura: 160, zone: 160 };
  for (const stage of ['cast', 'projectile', 'impact', 'pulse', 'aura', 'zone']) {
    for (const progress of [0, 0.2, 0.4, 0.6, 0.8, 0.98]) {
      for (const radius of [0.8, 1, 2, 100]) {
        const points = capture(stage, progress, radius);
        assert.ok((points.length > 0 || progress > 0.9) && points.length <= budget[stage], `${stage} ${progress} ${radius}: ${points.length}`);
        assert.deepEqual(capture(stage, progress, radius), points);
        for (const point of points) {
          assert.ok(Number.isFinite(point.x) && Number.isFinite(point.z));
          assert.match(point.char, /^[ -~]$/);
          assert.equal(point.color.length, 3);
          assert.ok(point.color.every(channel => Number.isFinite(channel) && channel >= 0 && channel <= 255));
          assert.ok(Number.isFinite(point.brightness) && point.brightness >= 0 && point.brightness <= 1);
          assert.ok(Math.hypot(point.x, point.z) < 15);
        }
      }
    }
    assert.ok(Math.max(...capture(stage, 0.98).map(point => point.brightness)) < 0.1);
    assert.deepEqual(capture(stage, 1), []);
  }
});

test('Meteor sound has a rushing downward growl, dual detonation and spaced stone taps', () => {
  const { cast, impact, pulse } = presentation.sounds;
  const growls = cast.filter(voice => voice.kind === 'tone');
  assert.ok(growls.length >= 2 && growls.every(voice => voice.endFrequency < voice.frequency));
  assert.ok(cast.some(voice => voice.kind === 'noise' && voice.attack >= 0.1), 'rush builds under the growl');
  const bass = impact.filter(voice => voice.kind === 'tone' && voice.delay === 0);
  assert.equal(bass.length, 2);
  assert.notEqual(bass[0].type, bass[1].type);
  assert.ok(bass.every(voice => voice.endFrequency < 40 && voice.attack < 0.01));
  const taps = impact.filter(voice => voice.delay > 0);
  assert.ok(taps.length >= 3);
  assert.ok(taps.every((voice, i) => i === 0 || voice.delay > taps[i - 1].delay));
  assert.ok(taps.every(voice => voice.duration <= 0.1), 'debris is short percussive taps');
  assert.ok(pulse.every(voice => voice.gain < 0.02 && voice.duration < 0.2));
  for (const sequence of Object.values(presentation.sounds)) {
    assert.ok(sequence.length <= 8);
    for (const voice of sequence) {
      assert.ok(['tone', 'noise'].includes(voice.kind));
      assert.ok(voice.gain > 0 && voice.gain <= 0.25);
      assert.ok(voice.duration > 0 && voice.duration <= 2.5);
      assert.ok(voice.delay >= 0 && voice.delay <= 2);
      assert.ok(voice.attack > 0 && voice.release > 0 && voice.attack + voice.release <= voice.duration);
    }
  }
});
