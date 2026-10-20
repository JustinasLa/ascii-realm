import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/fire-breath.js';
import spell from '../../src/spells/definitions/fire-breath.js';
import { paintPresentation } from '../../src/spells/presentation.js';
import { runeScene } from '../../test-support/spells.js';

const LIVES = { cast: presentation.duration, pulse: 0.4, impact: 0.6, aura: 1.5, zone: 4, projectile: 1 };
const RADII = { cast: 0.8, pulse: 2, impact: 1, aura: 1, zone: 3, projectile: 1 };
const BUDGETS = { cast: 240, pulse: 90, impact: 150, aura: 120, zone: 140, projectile: 60 };

function capture(stage, progress, extra = {}) {
  const points = [];
  const life = extra.life ?? LIVES[stage];
  const effect = Object.freeze({ stage, age: progress * life, life, progress,
    radius: RADII[stage], heading: 0, x: 0, y: 0, ...extra });
  presentation.draw(effect, (x, z, char, color, brightness = 1) => {
    points.push({ x, z, char, color, brightness });
  });
  return points;
}

const width = points => Math.max(...points.map(point => point.x)) - Math.min(...points.map(point => point.x));
const reach = points => Math.max(...points.map(point => Math.hypot(point.x, point.z)));
const hot = point => point.color[1] > 200 && point.color[2] > 120;
const dense = point => '@#%'.includes(point.char);

test('Fire Breath draws breath in, ignites at the mouth and roars out as a widening jet', () => {
  assert.equal(spell.presentation, presentation);
  assert.equal(presentation.id, spell.id);
  // Anticipation: embers are sucked toward the mouth before anything is exhaled.
  const inhale = capture('cast', 0.04), drawn = capture('cast', 0.1);
  assert.ok(inhale.length > 0 && reach(inhale) < 2.6, 'the wind-up stays close to the caster');
  const motes = points => points.filter(point => Math.hypot(point.x, point.z) > 0.3);
  const mean = points => points.reduce((sum, point) => sum + Math.hypot(point.x, point.z), 0) / points.length;
  assert.ok(mean(motes(drawn)) < mean(motes(inhale)), 'embers converge on the mouth');
  // Ignition: a white-hot flash right at the mouth.
  const ignite = capture('cast', 0.13);
  assert.ok(ignite.some(point => hot(point) && point.char === '@' && Math.hypot(point.x, point.z) < 0.3));
  // The jet: a solid, dense, forward wedge that widens with distance and grows over time.
  const jet = capture('cast', 0.42), early = capture('cast', 0.2);
  assert.ok(jet.every(point => point.z > -0.3), 'the exhalation stays ahead of the caster');
  const near = jet.filter(point => point.z > 0.3 && point.z < 0.9 && point.brightness > 0.5);
  const far = jet.filter(point => point.z > 1.4 && point.z < 2.2 && point.brightness > 0.5);
  assert.ok(width(far) > width(near) * 1.5, 'the jet widens with distance');
  assert.ok(reach(jet) > reach(early) + 1, 'the breath unfurls over time');
  assert.ok(jet.filter(dense).length >= 12, 'the jet has a dense white-hot core');
  assert.ok(new Set(jet.map(point => point.char)).size >= 6, 'glyph density ramps from core to edge');
  // Fireballs roll out to the far end of the 6 m cone while the jet is still burning.
  const rolling = capture('cast', 0.55);
  assert.ok(rolling.some(point => point.z > 3.5 && point.brightness > 0.3));
  assert.notDeepEqual(jet, capture('cast', 0.44), 'flames keep moving between frames');
});

test('Fire Breath releases the jet, cools to embers and smoke and fades out smoothly', () => {
  const burning = capture('cast', 0.45), released = capture('cast', 0.75);
  const nearMouth = points => points.filter(point => point.z < 1 && point.brightness > 0.25);
  assert.ok(nearMouth(burning).length > 10 && nearMouth(released).length === 0, 'the tail detaches from the mouth');
  const green = points => points.reduce((sum, point) => sum + point.color[1], 0) / points.length;
  assert.ok(green(released) < green(burning) - 30, 'the fire cools from yellow to red and smoke');
  assert.ok(released.length < burning.length / 2, 'the flame thins out rather than popping');
  let previous = Infinity;
  for (let progress = 0.7; progress < 1; progress += 0.05) {
    const peak = Math.max(0, ...capture('cast', progress).map(point => point.brightness));
    assert.ok(peak <= previous + 0.15, `brightness keeps falling at ${progress.toFixed(2)}`);
    previous = peak;
  }
});

test('Fire Breath mouth flare, burn ticks, Burnt aura and projectile read as fire', () => {
  // The cast's FX visuals: a small glow, then a teardrop flare bursting forward.
  const glow = capture('pulse', 0.15), flare = capture('pulse', 0.5);
  assert.ok(glow.length > 0 && reach(glow) < 0.25);
  assert.ok(flare.every(point => point.z > -0.15) && reach(flare) > 0.8);
  assert.ok(flare.filter(point => point.z > 0.2 && point.z < 1.2).length > 25, 'the flare is a solid body');
  // Burn tick: white flash, upright tongues (world up is -z at heading 0), crackle and ash.
  const flash = capture('impact', 0.05), blaze = capture('impact', 0.35), ash = capture('impact', 0.8);
  assert.ok(flash.some(point => point.char === '@' && hot(point)));
  assert.ok(blaze.some(point => point.z < -0.5 && dense(point)), 'flame tongues stand up from the target');
  assert.ok(ash.some(point => point.color[0] < 140), 'ash and smoke remain as it burns out');
  // Upright fire stays upright whatever the heading of the effect.
  const turned = capture('impact', 0.35, { heading: Math.PI });
  const worldZ = turned.map(point => point.z * Math.cos(Math.PI) - point.x * Math.sin(Math.PI));
  assert.ok(worldZ.some(z => z < -0.5) && turned.some(point => point.z > 0.5));
  // Burnt aura: rekindling flames that change over time.
  const aura = capture('aura', 0.3);
  assert.ok(aura.some(point => point.z < -0.3 && dense(point)));
  assert.notDeepEqual(aura, capture('aura', 0.5));
  // Projectile: a compact fireball with a cooling trail streaming behind it.
  const projectile = capture('projectile', 0.4);
  assert.ok(projectile.some(point => Math.hypot(point.x, point.z) < 0.15 && dense(point)));
  assert.ok(projectile.some(point => point.z < -0.6), 'the trail streams behind');
  assert.ok(width(projectile) < 1, 'the moving flame stays compact');
});

test('Fire Breath stays within budget, valid and fully faded at every stage', () => {
  for (const stage of Object.keys(LIVES)) {
    for (const heading of [0, 0.9, -2.4]) {
      for (const progress of [0.02, 0.15, 0.3, 0.5, 0.6, 0.8, 0.96]) {
        const points = capture(stage, progress, { heading, x: 4.3, y: 9.7 });
        assert.ok(points.length <= BUDGETS[stage], `${stage} ${progress} uses ${points.length}`);
        for (const point of points) {
          assert.ok([point.x, point.z, point.brightness, ...point.color].every(Number.isFinite));
          assert.ok(Math.abs(point.x) <= 7 && Math.abs(point.z) <= 7);
          assert.match(point.char, /^[\x20-\x7e]$/);
          assert.ok(point.color.every(channel => channel >= 0 && channel <= 255));
          assert.ok(point.brightness >= 0 && point.brightness <= 1);
        }
      }
    }
    assert.ok(Math.max(0, ...capture(stage, 0.96).map(point => point.brightness)) < 0.2, `${stage} is nearly faded`);
    assert.deepEqual(capture(stage, 1), [], 'finished effects leave no persistent marks');
  }
  assert.deepEqual(capture('cast', 0.35), capture('cast', 0.35), 'rendering is deterministic');
});

test('Fire Breath shapes land on separate screen cells at any heading', () => {
  for (const heading of [0, 0.6, Math.PI / 2, 2.5, -1.1]) {
    const cells = new Set();
    let count = 0;
    paintPresentation(presentation, { stage: 'cast', x: 12.4, y: 30.7, age: 0.45, life: presentation.duration,
      radius: 0.8, heading }, (x, y) => { count++; cells.add(`${Math.floor(x)},${Math.floor(y)}`); });
    assert.ok(count > 150);
    assert.ok(cells.size >= count * 0.85, `heading ${heading}: ${cells.size} cells for ${count} glyphs`);
  }
});

test('Fire Breath exhales overlapping air bursts over chest rumble and breaks into dry crackle', () => {
  const { cast, impact, pulse } = presentation.sounds;
  const breaths = cast.filter(voice => voice.kind === 'noise' && voice.delay > 0);
  assert.ok(breaths.length >= 3 && breaths.every(voice => voice.attack >= 0.05));
  assert.ok(breaths.slice(1).every((voice, index) => voice.delay < breaths[index].delay + breaths[index].duration));
  assert.ok(cast.some(voice => voice.kind === 'tone' && voice.frequency < 100 && voice.endFrequency < voice.frequency));
  assert.ok(new Set(breaths.map(voice => voice.cutoff)).size >= 3, 'air bursts broaden as the cone opens');
  assert.ok(impact.filter(voice => voice.kind === 'noise').every(voice => voice.duration <= 0.16 && voice.attack <= 0.003));
  assert.ok(impact.some(voice => voice.delay > 0.1), 'crackle has a distinct staggered tail');
  assert.ok(pulse.every(voice => voice.gain <= 0.02 && voice.duration <= 0.12));
  for (const sequence of Object.values(presentation.sounds)) {
    assert.ok(sequence.length > 0 && sequence.length <= 8);
    for (const voice of sequence) {
      assert.ok(['tone', 'noise'].includes(voice.kind));
      assert.ok(voice.gain > 0 && voice.gain <= 0.25);
      assert.ok(voice.delay >= 0 && voice.delay <= 2);
      assert.ok(voice.duration > 0 && voice.duration <= 2.5);
      assert.ok(voice.attack > 0 && voice.attack + voice.release <= voice.duration);
    }
  }
});

test('real Fire Breath casts paint the authored profile and emit typed breath cues', () => {
  const scene = runeScene(spell), cues = [];
  scene.casting.onSound = cue => cues.push(cue);
  assert.equal(scene.cast().ok, true);
  const count = cues.length;
  assert.equal(scene.cast().ok, false, 'cooldown rejection stays silent');
  assert.equal(cues.length, count);
  const castEffect = scene.casting.effects.list.find(effect => effect.stage === 'cast');
  assert.equal(castEffect.presentation, presentation);
  assert.equal(castEffect.life, presentation.duration);
  scene.advance(0.2);
  assert.equal(scene.foe.health, 94);
  const points = [];
  scene.casting.effects.paint((...point) => points.push(point));
  assert.ok(points.length > 60 && points.some(point => point[2] === '@'),
    'the real effect stream contains the white-hot jet core');
  assert.equal(cues.filter(cue => cue.stage === 'cast').length, 1);
  assert.ok(cues.some(cue => cue.stage === 'impact'));
  assert.ok(cues.every(cue => cue.type === 'spell' && cue.spellId === spell.id && cue.presentation === presentation),
    'casts and burn hits use the Fire Breath profile instead of weapon cues');
  scene.advance(4.5);
  assert.equal(scene.foe.health, 76, 'the four original six-damage burn pulses remain intact');
});
