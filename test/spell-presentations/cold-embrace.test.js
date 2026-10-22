import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/cold-embrace.js';
import spell from '../../src/spells/definitions/cold-embrace.js';
import { runeScene } from '../../test-support/spells.js';

// Radii and lives the game actually uses for each stage of this rune.
const GAME = {
  cast: { radius: 0.8, life: 1.15 }, projectile: { radius: 0.65, life: 1 }, impact: { radius: 1, life: 1.15 },
  pulse: { radius: 1, life: 0.25 }, aura: { radius: 1, life: 1.5 }, zone: { radius: 4, life: 1 },
};
const BUDGET = { cast: 250, impact: 250, projectile: 110, pulse: 90, aura: 160, zone: 160 };
const STAGES = Object.keys(GAME);

function frame(stage, progress, extra = {}) {
  const points = [];
  const { radius, life } = GAME[stage];
  const effect = Object.freeze({ stage, progress, radius, age: progress * life, life, heading: 0, ...extra });
  presentation.draw(effect, (x, z, char, color, brightness) => points.push({ x, z, char, color, brightness }));
  return points;
}
const lit = points => points.filter(point => point.brightness > 0.05);
const reach = points => Math.max(...points.map(point => Math.hypot(point.x, point.z)));
const arms = points => points.filter(point => point.char === '(' || point.char === ')');
const isWhite = point => point.color.every(c => c > 250);

test('Cold Embrace opts into its own presentation without changing rune costs or weakening graph', () => {
  assert.equal(spell.presentation, presentation);
  assert.equal(presentation.id, spell.id);
  assert.equal(presentation.duration, 1.15);
  assert.deepEqual(spell.variants[0].params, { cooldown: 20, mana: 8, duration: 6 });
  assert.equal(spell.nodes.cold_embrace_skill_active.steps[0].args.auraname, 'Weakened');
});

test('a real Cold Embrace cast renders its crescent arms and emits typed profile cues through the delayed field', () => {
  const scene = runeScene(spell, { range: 20 });
  const events = [];
  scene.casting.onSound = event => events.push(event);
  assert.equal(scene.cast().ok, true);
  assert.equal(scene.castWithoutMana().ok, false, 'mana rejection does not replay the cast cue');
  assert.equal(events.filter(event => event.type === 'spell' && event.stage === 'cast').length, 1);
  assert.ok(scene.casting.effects.list.some(effect => effect.stage === 'cast' && effect.presentation === presentation));
  scene.advance(0.4);
  const dots = [];
  scene.casting.effects.paint((...point) => dots.push(point), scene.casting.projectiles);
  assert.ok(dots.some(point => point[2] === '(') && dots.some(point => point[2] === ')'),
    'the production renderer consumes the authored crescent geometry');
  scene.advance(1.9);
  assert.ok(scene.aura(scene.foe, 'Weakened'));
  assert.equal(scene.foe.magicDamage, -4);
  assert.equal(scene.foe.health, 100, 'the presentation preserves the weakening-only gameplay');
  assert.ok(events.some(event => event.type === 'spell' && event.stage === 'impact'));
  assert.ok(events.some(event => event.type === 'spell' && event.stage === 'pulse'));
  assert.ok(events.every(event => event.type === 'spell' && event.spellId === spell.id && event.presentation === presentation),
    'all cast, impact and field cues use the profile instead of draw/slam weapon sounds');
  const fieldDots = [];
  scene.casting.effects.paint((...point) => fieldDots.push(point), scene.casting.projectiles);
  assert.ok(fieldDots.some(point => point[2] === '='), 'the weakened target is cinched by a frost band');
});

test('cast: frost motes spiral in, the mirrored arms grow and close into an embrace, then thaw', () => {
  // Anticipation: motes start far out and are drawn inward as the arms form.
  const gather = frame('cast', 0.1), formed = frame('cast', 0.45);
  assert.ok(reach(lit(gather)) > reach(lit(formed)) + 0.3, 'motes converge from the air');
  assert.ok(arms(frame('cast', 0.08)).length < arms(formed).length, 'the arms grow from their middles');

  // The two crescents are exact mirrors that close on a hollow centre.
  const inner = points => Math.min(...arms(points).map(point => Math.abs(point.x)));
  const open = frame('cast', 0.32), closed = frame('cast', 0.66);
  assert.ok(inner(closed) < inner(open) * 0.5, 'the arms close in');
  for (const points of [open, closed]) {
    const left = arms(points).filter(point => point.char === '(');
    const right = arms(points).filter(point => point.char === ')');
    assert.ok(left.length > 5 && right.length === left.length);
    assert.ok(left.every(point => point.x < -0.15) && right.every(point => point.x > 0.15), 'the held space stays hollow');
    for (const point of left) assert.ok(right.some(other => Math.abs(other.x + point.x) < 1e-9 && Math.abs(other.z - point.z) < 1e-9));
  }

  // The embrace lands with a white flash in the centre, absent before it.
  assert.ok(!frame('cast', 0.3).some(point => Math.hypot(point.x, point.z) < 1e-9));
  const flash = frame('cast', 0.62).find(point => point.x === 0 && point.z === 0);
  assert.ok(flash && isWhite(flash) && flash.brightness > 0.9);

  // Follow-through: the arms thin out and dim instead of popping.
  const thaw = frame('cast', 0.9);
  assert.ok(arms(thaw).length < arms(closed).length);
  assert.ok(Math.max(...thaw.map(point => point.brightness)) < Math.max(...closed.map(point => point.brightness)));
});

test('glyphs follow the on-screen slant of each stroke at any heading', () => {
  const upright = frame('cast', 0.5), turned = frame('cast', 0.5, { heading: Math.PI / 2 });
  // Geometry stays local (the adapter rotates it once); only the glyph sampling adapts ...
  assert.ok(Math.abs(reach(upright) - reach(turned)) < 0.05);
  // ... but the side arms that stand upright now lie flat on screen.
  assert.ok(arms(upright).length > 10);
  assert.ok(arms(turned).length < arms(upright).length / 3);
  assert.ok(turned.filter(point => point.char === '-').length > upright.filter(point => point.char === '-').length);
});

test('impact: the claws wind up and snap shut, lashing three bands while shards fly out', () => {
  const gap = points => Math.min(...arms(points).map(point => Math.abs(point.x)));
  assert.ok(gap(frame('impact', 0.06)) > gap(frame('impact', 0.02)), 'a small wind-up opens the claws first');
  assert.ok(gap(frame('impact', 0.2)) < gap(frame('impact', 0.06)) * 0.4, 'then they slam shut');
  assert.ok(!frame('impact', 0.1).some(point => point.char === '='));
  const snap = frame('impact', 0.2);
  assert.ok(snap.some(point => point.x === 0 && point.z === 0 && isWhite(point)), 'white flash on the snap');
  const bands = frame('impact', 0.3).filter(point => point.char === '=');
  assert.ok(bands.some(point => point.z < -0.4) && bands.some(point => Math.abs(point.z) < 0.1) && bands.some(point => point.z > 0.4));
  const shards = points => points.filter(point => /[|/\\-]/.test(point.char) && point.brightness > 0.05);
  assert.ok(reach(shards(frame('impact', 0.5))) > reach(shards(frame('impact', 0.25))), 'shards keep travelling');
});

test('pulse: a snowflake pops and rings out a spreading frost wave at every game radius', () => {
  for (const radius of [1, 2, 4]) {
    const early = frame('pulse', 0.15, { radius }), late = frame('pulse', 0.7, { radius });
    assert.ok(early.length <= BUDGET.pulse && late.length <= BUDGET.pulse);
    assert.ok(reach(late) > reach(early), 'the frost ring expands');
    assert.ok(early.filter(point => point.char === '*').length >= 6, 'six crystal tips');
  }
});

test('zone: two arms reach around the field from behind and hoarfrost creeps inward', () => {
  const early = arms(frame('zone', 0.05)).concat(frame('zone', 0.05).filter(point => point.char === '-'));
  assert.ok(early.length > 0 && early.every(point => point.z < 0), 'the arms start behind the target');
  const late = frame('zone', 0.55);
  assert.ok(late.some(point => point.z > 2 && point.x < -0.5) && late.some(point => point.z > 2 && point.x > 0.5),
    'both arms wrap round to the front');
  assert.ok(arms(late).some(point => point.char === '(' && point.x < -3) && arms(late).some(point => point.char === ')' && point.x > 3));
  const crystals = p => frame('zone', p).filter(point => '.+'.includes(point.char) || point.char === '*').length;
  assert.ok(crystals(0.6) > crystals(0.15), 'hoarfrost accumulates');
});

test('aura: small arms wrap the weakened target, breathe, and release', () => {
  const gap = points => Math.min(...arms(points).map(point => Math.abs(point.x)));
  assert.ok(gap(frame('aura', 0.3)) < gap(frame('aura', 0.02)));
  assert.ok(frame('aura', 0.5).some(point => point.char === '='));
  const held = Math.max(...frame('aura', 0.5).map(point => point.brightness));
  assert.ok(Math.max(...frame('aura', 0.92).map(point => point.brightness)) < held * 0.6);
});

test('projectile: a snapping claw pair around a white core streams frost behind it', () => {
  for (const age of [0.02, 0.1, 0.19]) {
    const points = frame('projectile', age / 10, { age, life: 10 });
    const core = points.find(point => point.char === '@');
    assert.ok(core && isWhite(core));
    assert.ok(points.some(point => point.char === '(') && points.some(point => point.char === ')'));
    const trail = points.filter(point => '*:.'.includes(point.char) && point.z < -0.15);
    assert.ok(trail.length > 15, 'frost trail behind the claws');
    assert.ok(reach(points) < 1.3);
  }
  const a = frame('projectile', 0.001, { age: 0.01, life: 10 }), b = frame('projectile', 0.0015, { age: 0.015, life: 10 });
  const moved = a.map((point, i) => Math.hypot(point.x - b[i].x, point.z - b[i].z));
  assert.ok(Math.max(...moved) < 0.15, 'frames move continuously instead of jittering');
});

test('every stage stays finite, deterministic and within its draw budget, then fades away', () => {
  for (const stage of STAGES) {
    for (const p of [0, 0.1, 0.25, 0.45, 0.62, 0.7, 0.85, 0.97]) {
      const points = frame(stage, p);
      assert.ok(points.length <= BUDGET[stage], `${stage} point budget (${points.length})`);
      if (p > 0) assert.ok(points.length > 0, `${stage} draws at ${p}`);
      assert.deepEqual(points, frame(stage, p), `${stage} is deterministic`);
      for (const point of points) {
        assert.ok(Number.isFinite(point.x) && Number.isFinite(point.z));
        assert.ok(Math.abs(point.x) <= 5 && Math.abs(point.z) <= 5);
        assert.match(point.char, /^[\x21-\x7e]$/);
        assert.ok(point.color.length === 3 && point.color.every(c => Number.isFinite(c) && c >= 0 && c <= 255));
        assert.ok(Number.isFinite(point.brightness) && point.brightness >= 0 && point.brightness <= 1);
      }
    }
    assert.ok(Math.max(...frame(stage, 0.97).map(point => point.brightness)) < 0.15, `${stage} fades`);
    assert.ok(frame(stage, 0.9999).every(point => point.brightness < 0.01));
    assert.deepEqual(frame(stage, 1), []);
    assert.notDeepEqual(frame(stage, 0.1), frame(stage, 0.65));
  }
});

test('turned strokes sample more cells but every stage stays within budget at any heading', () => {
  for (const stage of STAGES) {
    for (let h = 0; h < 64; h++) {
      const heading = h / 64 * Math.PI * 2;
      for (let step = 0; step <= 40; step++) {
        const progress = step / 40;
        for (const radius of [GAME[stage].radius, 0.3, 1.5, 4, 8]) {
          const count = frame(stage, progress, { heading, radius }).length;
          assert.ok(count <= BUDGET[stage], `${stage} budget at heading ${heading}, progress ${progress}, radius ${radius} (${count})`);
        }
      }
    }
  }
  // The reviewed worst cases: impact at heading 9pi/32 and projectile at 7pi/16.
  assert.ok(frame('impact', 0.2, { heading: 9 * Math.PI / 32 }).length <= BUDGET.impact);
  assert.ok(frame('projectile', 0, { heading: 7 * Math.PI / 16 }).length <= BUDGET.projectile);
});

test('age fallback and unusual radii and headings remain safe without mutating the effect', () => {
  assert.deepEqual(frame('cast', NaN, { age: 0.575 }), frame('cast', 0.5));
  for (const stage of STAGES) {
    for (const radius of [NaN, -20, 0, 40, Infinity]) {
      const points = frame(stage, 0.3, { radius });
      assert.ok(points.length <= BUDGET[stage]);
      assert.ok(points.every(point => Number.isFinite(point.x) && Number.isFinite(point.z) && Math.abs(point.x) <= 48));
    }
    for (const heading of [NaN, -7, 1e9]) assert.ok(frame(stage, 0.4, { heading }).every(point => /^[\x21-\x7e]$/.test(point.char)));
  }
});

test('Cold Embrace constricts frozen breath around beating tomb tones', () => {
  const { cast, impact, pulse } = presentation.sounds;
  const low = cast.filter(v => v.kind === 'tone' && v.frequency < 100);
  assert.ok(low.length >= 2 && Math.abs(low[0].frequency - low[1].frequency) < 5, 'slow beating pressure');
  assert.ok(impact.some(v => v.kind === 'noise' && v.duration > 1), 'enclosed breath dwindles');
  assert.ok(cast.some(v => v.kind === 'tone' && v.frequency < 200), 'a low body anchors the spell');
  assert.notDeepEqual(cast, impact);
  assert.ok(pulse.reduce((sum, v) => sum + v.gain, 0) < cast.reduce((sum, v) => sum + v.gain, 0), 'repeat pulses stay beneath the cast');
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
