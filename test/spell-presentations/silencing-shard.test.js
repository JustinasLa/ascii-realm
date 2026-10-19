import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/silencing-shard.js';
import spell from '../../src/spells/definitions/silencing-shard.js';
import { runeScene } from '../../test-support/spells.js';

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
  const launch = [];
  casting.effects.paint((...point) => launch.push(point), casting.projectiles);
  assert.ok(launch.some(point => point[2] === '|') && launch.some(point => point[2] === '('),
    'the real effects stream contains the fractured crystal and sound ring');
  advance(0.15);
  assert.ok(aura(foe, 'Silenced'));
  assert.equal(foe.health, 100, 'presentation does not add damage');
  const hit = [];
  casting.effects.paint((...point) => hit.push(point), casting.projectiles);
  assert.ok(hit.some(point => point[2] === 'X'), 'the real impact stream paints the silence seal');
  assert.ok(cues.some(cue => cue.stage === 'cast') && cues.some(cue => cue.stage === 'impact'));
  assert.ok(cues.every(cue => cue.type === 'spell' && cue.spellId === spell.id && cue.presentation === presentation),
    'cast and hit route through the authored spell sound rather than generic draw/slam cues');
});

test('cast closes a slashed sound ring around a fractured crystal; impact resolves into an X seal', () => {
  const opening = points('cast', 0.1), closing = points('cast', 0.75);
  assert.ok(extent(opening) > extent(closing), 'the sound ring must visibly close');
  assert.ok(opening.some(p => p.char === '(') && opening.some(p => p.char === ')'), 'sound-ring sides remain legible');
  assert.ok(opening.filter(p => p.char === '|').length >= 2, 'the split crystal keeps both axial facets');
  const impact = points('impact', 0.3);
  assert.ok(impact.some(p => p.char === 'X' && p.x === 0 && p.z === 0), 'impact must show a centered silence seal');
  assert.ok(!opening.some(p => p.char === 'X'), 'cast and impact have different silhouettes');
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    assert.ok(impact.some(p => p.x * sx > 0.2 && p.z * sz > 0.2 && Math.abs(Math.abs(p.x) - Math.abs(p.z)) < 1e-8),
      'both crossed seal strokes extend to all four quadrants');
  }
});

test('projectile keeps its small fractured silhouette and trailing muted fragments', () => {
  const projectile = points('projectile', 0.25);
  assert.ok(projectile.some(p => p.char === '|') && projectile.some(p => p.char === '/'));
  const trail = projectile.filter(p => p.z < -0.9);
  assert.ok(trail.length >= 4, 'a directional trail follows the shard');
  assert.ok(trail.every(p => p.brightness < 0.5), 'the trail stays dimmer than the crystal');
  assert.ok(Math.max(...projectile.map(p => Math.abs(p.x))) < 0.7, 'projectile stays compact');
  assert.notDeepEqual(projectile, points('projectile', 0.55), 'trail evolves over flight time');
  assert.deepEqual(projectile, points('projectile', 0.25, { heading: Math.PI / 2 }),
    'runtime owns heading rotation');
});

test('every stage is bounded, deterministic and fades completely without invalid plot data', () => {
  for (const stage of ['cast', 'impact', 'projectile', 'pulse', 'aura', 'zone']) {
    for (const progress of [0, 0.2, 0.5, 0.85, 0.99]) {
      const output = points(stage, progress);
      assert.ok(output.length > 0 && output.length <= 96, `${stage} has a bounded draw budget`);
      assert.deepEqual(output, points(stage, progress));
      for (const point of output) {
        assert.ok(Number.isFinite(point.x) && Number.isFinite(point.z));
        assert.ok(Math.hypot(point.x, point.z) < 5);
        assert.match(point.char, /^[!-~]$/);
        assert.ok(point.color.length === 3 && point.color.every(c => Number.isFinite(c) && c >= 0 && c <= 255));
        assert.ok(Number.isFinite(point.brightness) && point.brightness >= 0 && point.brightness <= 1);
      }
    }
    assert.ok(energy(points(stage, 0.99)) < energy(points(stage, 0.5)) * 0.2, `${stage} fades at the tail`);
    assert.equal(points(stage, 1).length, 0, `${stage} leaves no persistent pixels`);
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
