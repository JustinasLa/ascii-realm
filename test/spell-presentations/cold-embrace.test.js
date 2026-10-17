import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/cold-embrace.js';
import spell from '../../src/spells/definitions/cold-embrace.js';
import { runeScene } from '../../test-support/spells.js';

function frame(stage, progress, extra = {}) {
  const points = [];
  const effect = Object.freeze({ stage, progress, radius: 2, age: progress * 1.15, life: 1.15, heading: 0, ...extra });
  presentation.draw(effect, (x, z, char, color, brightness) => points.push({ x, z, char, color, brightness }));
  return points;
}

test('Cold Embrace opts into its own presentation without changing rune costs or weakening graph', () => {
  assert.equal(spell.presentation, presentation);
  assert.equal(presentation.id, spell.id);
  assert.deepEqual(spell.variants[0].params, { cooldown: 20, mana: 8, duration: 6 });
  assert.equal(spell.nodes.cold_embrace_skill_active.steps[0].args.auraname, 'Weakened');
});

test('a real Cold Embrace cast renders its claws and emits typed profile cues through the delayed field', () => {
  const scene = runeScene(spell, { range: 20 });
  const events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  assert.equal(scene.cast().ok, false, 'cooldown rejection does not replay the cast cue');
  assert.equal(events.filter(event => event.type === 'spell' && event.stage === 'cast').length, 1);
  assert.ok(scene.casting.effects.list.some(effect => effect.stage === 'cast' && effect.presentation === presentation));
  const dots = [];
  scene.casting.effects.paint((...point) => dots.push(point), scene.casting.projectiles);
  assert.ok(dots.some(point => point[2] === '(') && dots.some(point => point[2] === ')'),
    'the production renderer consumes the authored crescent geometry');
  scene.advance(2.3);
  assert.ok(scene.aura(scene.foe, 'Weakened'));
  assert.equal(scene.foe.magicDamage, -4);
  assert.equal(scene.foe.health, 100, 'the presentation preserves the weakening-only gameplay');
  assert.ok(events.some(event => event.type === 'spell' && event.stage === 'impact'));
  assert.ok(events.some(event => event.type === 'spell' && event.stage === 'pulse'));
  assert.ok(events.every(event => event.type === 'spell' && event.spellId === spell.id && event.presentation === presentation),
    'all cast, impact and field cues use the profile instead of draw/slam weapon sounds');
  const fieldDots = [];
  scene.casting.effects.paint((...point) => fieldDots.push(point), scene.casting.projectiles);
  assert.ok(fieldDots.some(point => point[2] === '='), 'the live weakening field renders binding frost bands');
});

test('opposing crescent claws tighten inward while retaining a hollow target space', () => {
  const early = frame('cast', 0.1).filter(point => point.char === '(' || point.char === ')');
  const late = frame('cast', 0.65).filter(point => point.char === '(' || point.char === ')');
  const width = points => Math.max(...points.map(point => Math.abs(point.x)));
  assert.ok(width(late) < width(early) * 0.8);
  for (const points of [early, late]) {
    const left = points.filter(point => point.char === '(');
    const right = points.filter(point => point.char === ')');
    assert.ok(left.length > 5 && right.length === left.length);
    for (let i = 0; i < left.length; i++) {
      assert.equal(left[i].x, -right[i].x);
      assert.equal(left[i].z, right[i].z);
      assert.ok(left[i].x < -0.2 && right[i].x > 0.2);
    }
  }
});

test('impact seals three frost bands and a central crack, distinct from the open cast', () => {
  const cast = frame('cast', 0.3), impact = frame('impact', 0.3);
  assert.ok(cast.some(point => point.char === '-'));
  assert.ok(!cast.some(point => point.char === '='));
  const bands = impact.filter(point => point.char === '=');
  assert.ok(bands.some(point => point.z < -0.4));
  assert.ok(bands.some(point => Math.abs(point.z) < 0.05));
  assert.ok(bands.some(point => point.z > 0.4));
  assert.ok(impact.some(point => point.x === 0 && point.z === 0 && point.char === '+'));
  assert.ok(impact.some(point => point.char === '\\'));
});

test('every stage stays finite, deterministic and within its draw budget, then fades away', () => {
  for (const stage of ['cast', 'impact', 'pulse', 'aura', 'zone', 'projectile']) {
    for (const p of [0, 0.25, 0.7, 0.97]) {
      const points = frame(stage, p);
      assert.ok(points.length > 0 && points.length <= 96, `${stage} point budget`);
      assert.deepEqual(points, frame(stage, p), `${stage} is deterministic`);
      for (const point of points) {
        assert.ok(Number.isFinite(point.x) && Number.isFinite(point.z));
        assert.ok(Math.abs(point.x) <= 5 && Math.abs(point.z) <= 5);
        assert.match(point.char, /^[\x21-\x7e]$/);
        assert.ok(point.color.length === 3 && point.color.every(c => Number.isFinite(c) && c >= 0 && c <= 255));
        assert.ok(Number.isFinite(point.brightness) && point.brightness >= 0 && point.brightness <= 1);
      }
    }
    assert.ok(Math.max(...frame(stage, 0.97).map(point => point.brightness)) < 0.1);
    assert.deepEqual(frame(stage, 1), []);
    assert.notDeepEqual(frame(stage, 0.1), frame(stage, 0.65));
    // The runtime rotates local geometry once; heading must not rotate it here.
    assert.deepEqual(frame(stage, 0.3), frame(stage, 0.3, { heading: Math.PI / 2 }));
  }
  const projectile = frame('projectile', 0.3);
  assert.ok(projectile.some(point => point.char === '('));
  assert.ok(projectile.some(point => point.char === ')'));
  assert.ok(projectile.filter(point => point.char === '.').every(point => point.z < 0));
  assert.ok(Math.max(...projectile.map(point => Math.hypot(point.x, point.z))) < 1.2);
});

test('age fallback and unusual radii remain safe without mutating the effect', () => {
  assert.deepEqual(frame('cast', NaN, { age: 0.575 }), frame('cast', 0.5));
  for (const radius of [NaN, -20, 0, 40, Infinity]) {
    assert.ok(frame('cast', 0.3, { radius }).every(point => Number.isFinite(point.x) && Number.isFinite(point.z)));
  }
});

test('sound draws air inward before descending glass pairs and a compact closing crack', () => {
  const { cast, impact, pulse } = presentation.sounds;
  const suction = cast.find(voice => voice.kind === 'noise');
  assert.equal(suction.delay, 0);
  assert.ok(suction.attack > suction.duration * 0.4);
  assert.equal(suction.filterType, 'bandpass');
  const glass = cast.filter(voice => voice.kind === 'tone');
  assert.equal(glass.length, 4);
  assert.ok(glass.every(voice => voice.endFrequency < voice.frequency));
  assert.ok(glass[1].delay - glass[0].delay < 0.06);
  assert.ok(glass[3].delay - glass[2].delay < 0.06);
  assert.ok(glass[2].delay - glass[1].delay > 0.15);
  assert.ok(glass[2].frequency < glass[0].frequency && glass[3].frequency < glass[1].frequency);
  const crack = impact.find(voice => voice.kind === 'noise');
  assert.ok(crack.delay > 0.1 && crack.duration < 0.1 && crack.attack < 0.005);
  assert.ok(pulse.every(voice => voice.gain <= 0.02 && voice.duration <= 0.15));
  for (const voices of Object.values(presentation.sounds)) {
    assert.ok(voices.length > 0 && voices.length <= 8);
    for (const voice of voices) {
      assert.ok(voice.gain > 0 && voice.gain <= 0.25);
      assert.ok(voice.duration > 0 && voice.duration <= 2.5);
      assert.ok(voice.delay >= 0 && voice.delay <= 2);
      assert.ok(voice.attack > 0 && voice.release > 0 && voice.attack + voice.release <= voice.duration);
    }
  }
});
