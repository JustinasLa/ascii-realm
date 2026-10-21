import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/silencing-shard.js';
import spell from '../../src/spells/definitions/silencing-shard.js';
import { runeScene } from '../../test-support/spells.js';
import { paintPresentation } from '../../src/spells/presentation.js';

function points(stage, progress, extra = {}) {
  const output = [];
  const effect = { stage, progress, age: progress, life: 1, radius: 1.5, heading: 0, ...extra };
  const before = structuredClone(effect);
  presentation.draw(effect, (x, z, char, color, brightness = 1) => output.push({ x, z, char, color, brightness }));
  assert.deepEqual(effect, before, 'rendering must not change simulation state');
  return output;
}

const extent = (output) => Math.max(...output.map(point => Math.hypot(point.x, point.z)));
const energy = (output) => output.reduce((sum, point) => sum + point.brightness, 0);

test('Silencing Shard opts into its profile without changing its silence-only gameplay', () => {
  assert.equal(spell.presentation, presentation);
  assert.equal(presentation.id, spell.id);
  assert.ok(presentation.duration >= 0.6 && presentation.duration <= 1.6);
  assert.deepEqual(spell.variants[0].params, { cooldown: 10, mana: 4, duration: 6 });
  assert.equal(spell.nodes.silencing_shard.steps[0].op, 'projectile');
  assert.equal(spell.nodes.silence.steps[0].args.auraname, 'Silenced');
  assert.ok(!Object.values(spell.nodes).flatMap(node => node.steps).some(step => step.op === 'mmodamage'));
});

test('a real cast renders the authored shard and seal and emits typed spell cues', () => {
  const { casting, foe, cast, advance, aura } = runeScene(spell);
  const cues = [];
  casting.onSound = cue => cues.push(cue);
  assert.equal(cast().ok, true);
  assert.equal(casting.projectiles.length, 1, 'the existing projectile launches');
  assert.ok(casting.effects.list.some(effect => effect.stage === 'cast' && effect.presentation === presentation));
  advance(0.05);
  const launch = [];
  casting.effects.paint((...point) => launch.push(point), casting.projectiles);
  assert.ok(launch.some(point => point[2] === '|') && launch.some(point => point[2] === '('),
    'the real effects stream contains the fractured crystal and sound waves');
  advance(0.1);
  assert.ok(aura(foe, 'Silenced'));
  assert.equal(foe.health, 100, 'presentation does not add damage');
  advance(0.3);
  const hit = [];
  casting.effects.paint((...point) => hit.push(point), casting.projectiles);
  assert.ok(hit.some(point => point[2] === 'X'), 'the real aura stream paints the silence seal');
  assert.ok(cues.some(cue => cue.stage === 'cast') && cues.some(cue => cue.stage === 'impact'));
  assert.ok(cues.every(cue => cue.type === 'spell' && cue.spellId === spell.id && cue.presentation === presentation),
    'cast and hit route through the authored spell sound rather than generic draw/slam cues');
});

test('cast pulls sound waves into a growing crystal, then a slash cracks it and a cut shockwave follows', () => {
  const opening = points('cast', 0.1), forming = points('cast', 0.4), snapped = points('cast', 0.7);
  const waves = output => output.filter(p => p.char === '(' || p.char === ')');
  assert.ok(waves(opening).length >= 6, 'wind-up shows sound-wave brackets on both flanks');
  assert.ok(waves(opening).some(p => p.x < 0) && waves(opening).some(p => p.x > 0));
  const reach = output => Math.max(...waves(output).map(p => Math.abs(p.x)));
  assert.ok(reach(opening) > reach(forming), 'the sound waves are drawn inward');
  assert.ok(!opening.some(p => p.char === '|' && Math.abs(p.x) < 0.05), 'the crystal has not formed during anticipation');
  assert.ok(forming.filter(p => p.char === '|' && Math.abs(p.x) < 0.2).length >= 4, 'the crystal core is drawn as a solid axis');
  assert.ok(forming.some(p => p.char === '/') && forming.some(p => p.char === '\\'), 'faceted crystal edges');
  const slash = points('cast', 0.5).filter(p => p.brightness > 0.6 && Math.abs(p.x) > 0.6
    && Math.abs((p.z - 0.5 * 1.75) / p.x - 0.95 / 1.25) < 0.05);
  assert.ok(slash.length >= 3, 'a bright muting slash cuts diagonally across the shard');
  assert.ok(extent(snapped) > extent(forming), 'the cracked shard throws a shockwave and splinters outward');
  assert.ok(energy(points('cast', 0.95)) < energy(snapped) * 0.3, 'follow-through dissipates smoothly');
  assert.ok(!opening.some(p => p.char === 'X'), 'cast and aura have different silhouettes');
});

test('aura closes the sound ring, crosses two strokes into an X seal and drifts apart', () => {
  const early = points('aura', 0.05), held = points('aura', 0.5), late = points('aura', 0.95);
  assert.ok(!early.some(p => p.char === 'X'), 'the seal has not locked yet');
  assert.ok(held.some(p => p.char === 'X' && p.x === 0 && p.z === 0), 'the held aura shows a centered silence seal');
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    assert.ok(held.some(p => p.x * sx > 0.2 && p.z * sz > 0.2 && Math.abs(Math.abs(p.x) - Math.abs(p.z)) < 1e-8),
      'both crossed seal strokes extend to all four quadrants');
  }
  const ring = output => output.filter(p => Math.abs(Math.hypot(p.x, p.z) - 1.5 * 1.05) < 0.05);
  assert.ok(ring(held).length > ring(early).length, 'the sound ring closes around the target');
  assert.ok(energy(late) < energy(held) * 0.25, 'the seal fades out');
  const impact = points('impact', 0.3);
  assert.ok(impact.some(p => p.char === 'X' && p.x === 0 && p.z === 0), 'impact stamps the same seal');
});

test('hit burst shatters into a compact star with a white flash, then thins out', () => {
  const flash = points('pulse', 0.02, { radius: 3 }), mid = points('pulse', 0.5, { radius: 3 });
  assert.ok(flash.some(p => p.char === '@' && p.x === 0 && p.z === 0 && p.brightness > 0.9), 'white flash core');
  assert.ok(!mid.some(p => p.char === '@'), 'flash is brief');
  assert.ok(extent(mid) > extent(flash), 'the shatter expands');
  assert.ok(extent(mid) < 3, 'the shatter stays compact rather than scattering across the arena');
  assert.ok(mid.length >= 80 && mid.length <= 140, 'the one-off burst is dense but within budget');
  const tick = points('pulse', 0.3, { radius: 1 });
  assert.ok(tick.length <= 24, 'projectile tick ripples stay lean');
  assert.ok(extent(tick) < 1.2);
});

test('projectile keeps a compact cracked shard with a frost wake and inward sound waves', () => {
  const projectile = points('projectile', 0.25);
  assert.ok(projectile.some(p => p.char === '|') && projectile.some(p => p.char === '/'));
  const shard = projectile.filter(p => p.z > -0.5 && Math.abs(p.x) < 0.25);
  const trail = projectile.filter(p => p.z < -0.6);
  assert.ok(trail.length >= 8, 'a directional frost wake follows the shard');
  const mean = list => list.reduce((s, p) => s + p.brightness, 0) / list.length;
  assert.ok(mean(trail) < mean(shard), 'the wake stays dimmer than the crystal');
  assert.ok(Math.max(...projectile.map(p => Math.abs(p.x))) < 0.9, 'projectile stays compact');
  assert.ok(projectile.some(p => p.char === '(') && projectile.some(p => p.char === ')'), 'sound waves flank the shard');
  assert.notDeepEqual(projectile, points('projectile', 0.55), 'wake evolves over flight time');
  const turned = points('projectile', 0.25, { heading: Math.PI / 2 });
  const glint = output => output.find(p => p.char === '*' && Math.abs(p.x) < 1e-9 && p.z > 0.7);
  assert.ok(glint(projectile) && glint(turned), 'the tip glint leads along local +z');
  assert.equal(glint(turned).z, glint(projectile).z, 'runtime owns heading rotation');
  assert.ok(turned.some(p => p.char === '-'), 'edge glyphs follow the on-screen slope once rotated');
});

test('motion is continuous between frames', () => {
  for (const stage of ['cast', 'projectile', 'aura', 'zone']) {
    const a = points(stage, 0.4), b = points(stage, 0.4 + 1 / 120);
    const lit = output => output.filter(p => p.brightness > 0.15).length;
    assert.ok(Math.abs(lit(a) - lit(b)) <= 12, `${stage} lit glyph count does not pop`);
    assert.ok(Math.abs(energy(a) - energy(b)) < energy(a) * 0.2, `${stage} brightness does not pop`);
  }
});

test('every stage is bounded, deterministic and fades completely without invalid plot data', () => {
  const budget = { cast: 230, impact: 170, projectile: 110, pulse: 140, aura: 100, zone: 120 };
  for (const stage of Object.keys(budget)) {
    for (const radius of [0.8, 1.5, 3]) {
      for (const progress of [0, 0.2, 0.5, 0.85, 0.99]) {
        const output = points(stage, progress, { radius });
        assert.ok(output.length <= budget[stage], `${stage} has a bounded draw budget`);
        assert.deepEqual(output, points(stage, progress, { radius }));
        for (const point of output) {
          assert.ok(Number.isFinite(point.x) && Number.isFinite(point.z));
          assert.ok(Math.hypot(point.x, point.z) < 6);
          assert.match(point.char, /^[ -~]$/);
          assert.ok(point.color.length === 3 && point.color.every(c => Number.isFinite(c) && c >= 0 && c <= 255));
          assert.ok(Number.isFinite(point.brightness) && point.brightness >= 0 && point.brightness <= 1);
        }
      }
    }
    assert.ok(points(stage, 0.5).length > 0, `${stage} draws mid-life`);
    assert.ok(energy(points(stage, 0.99)) < energy(points(stage, 0.5)) * 0.2, `${stage} fades at the tail`);
    assert.equal(points(stage, 1).length, 0, `${stage} leaves no persistent pixels`);
  }
});

test('every stage stays within budget whichever way the runtime turns it', () => {
  // Heading changes how many cells a line spans on screen, so sweep it densely.
  const budget = { cast: 230, impact: 170, projectile: 110, pulse: 140, aura: 100, zone: 120 };
  for (const stage of Object.keys(budget)) {
    let most = 0;
    for (let h = 0; h < 48; h++) {
      const heading = h / 48 * Math.PI * 2;
      for (const radius of stage === 'projectile' ? [1] : [0.8, 1.5, 3]) {
        for (let i = 0; i <= 40; i++) {
          // Only the projectile and zone animate on age, so only they need an independent age.
          const ages = stage === 'projectile' || stage === 'zone' ? [i / 40, 0.07 + i * 0.137] : [i / 40];
          for (const age of ages) {
            most = Math.max(most, points(stage, i / 40, { radius, heading, age }).length);
          }
        }
      }
    }
    assert.ok(most <= budget[stage], `${stage} peaks at ${most} glyphs, above ${budget[stage]}`);
  }
});

test('a side-on projectile keeps every glyph, including the tip glint, under the runtime cap', () => {
  for (let h = 0; h < 48; h++) {
    const heading = h / 48 * Math.PI * 2, drawn = [];
    const count = paintPresentation(presentation, { x: 0, y: 0, stage: 'projectile', age: 0.07, life: 1, heading },
      (...point) => drawn.push(point), 128);
    let raw = 0;
    presentation.draw({ stage: 'projectile', progress: 0.07, age: 0.07, life: 1, radius: 1, heading }, () => raw++);
    assert.ok(raw <= 110, `heading ${heading.toFixed(2)} emits ${raw} glyphs`);
    assert.equal(count, raw, 'nothing is dropped by the 128-glyph projectile cap');
    assert.equal(drawn.at(-1)[2], '*', 'the bright tip marker, drawn last, survives');
  }
});

test('sound is a hollow damped bell, descending notch breath and abrupt quiet cutoff', () => {
  const { cast, impact } = presentation.sounds;
  const bell = cast.filter(voice => voice.kind === 'tone');
  const breath = cast.filter(voice => voice.kind === 'noise');
  assert.equal(bell.length, 2, 'bell uses separate body and inharmonic partial');
  const ratio = bell[1].frequency / bell[0].frequency;
  assert.ok(ratio > 1.5 && ratio < 1.7, 'a hollow non-octave bell avoids a melodic chord');
  assert.ok(bell.every(v => v.release > v.duration * 0.6));
  assert.ok(breath.length >= 3 && breath.every(v => v.filterType === 'notch'));
  for (let i = 1; i < breath.length; i++) {
    assert.ok(breath[i].delay > breath[i - 1].delay && breath[i].cutoff < breath[i - 1].cutoff,
      'breath descends through progressively lower missing bands');
    assert.ok(breath[i].gain < breath[i - 1].gain, 'air is damped as the ring closes');
  }
  const click = impact.at(-1);
  assert.ok(click.delay >= Math.max(...impact.slice(0, -1).map(v => v.delay + v.duration)), 'click follows the soft cutoff');
  assert.ok(click.duration < 0.03 && click.gain < 0.03, 'cutoff click is tiny and brief');
  assert.notDeepEqual(cast, impact);
  for (const voices of Object.values(presentation.sounds)) {
    assert.ok(voices.length <= 8);
    for (const voice of voices) {
      assert.ok(['tone', 'noise'].includes(voice.kind));
      assert.ok(voice.delay >= 0 && voice.delay <= 2 && voice.duration > 0 && voice.duration <= 2.5);
      assert.ok(voice.gain > 0 && voice.gain <= 0.25);
      assert.ok(voice.attack > 0 && voice.release > 0 && voice.attack + voice.release <= voice.duration);
    }
  }
});
