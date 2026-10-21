import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/seithr-glyph.js';
import definition from '../../src/spells/definitions/seithr-glyph.js';
import { runeScene } from '../../test-support/spells.js';

const RUNES = ['I', 'N', 'Y', 'X', 'M', 'T'];
const BUDGET = { cast: 250, impact: 250, projectile: 110, pulse: 90, aura: 160, zone: 160 };

function frame(stage, progress, extra = {}) {
  const points = [];
  const life = extra.life ?? 1;
  const effect = Object.freeze({ stage, progress, radius: 3, age: progress * life,
    life, heading: 0, ...extra });
  presentation.draw(effect, (x, z, char, color, brightness = 1) => {
    points.push({ x, z, char, color, brightness });
  });
  return points;
}
const lit = points => points.filter(point => point.brightness > 0.05);
const light = points => points.reduce((sum, point) => sum + point.brightness, 0);
const extent = points => Math.max(0, ...points.map(point => Math.hypot(point.x, point.z)));
const whiteness = points => points.reduce((sum, point) => sum + point.color[0] * point.brightness, 0) / light(points);

test('Seithr Glyph opts in while preserving its original spell behavior data', () => {
  assert.equal(definition.presentation, presentation);
  assert.equal(presentation.id, definition.id);
  assert.equal(presentation.duration, 1.35);
  assert.deepEqual(definition.variants[0].params, {
    cooldown: 20, mana: 8, duration: 8, frozen_duration: 8,
  });
  assert.equal(definition.root, 'seithr_glyph');
  assert.match(definition.nodes.seithr_glyph_skill_active.steps[0].args.d, /frozen_duration/);
});

test('cast gathers frost, etches a six-armed hexagram arm by arm, flashes its seal and lifts away', () => {
  const windUp = frame('cast', 0.12, { radius: 0.8 });
  assert.ok(windUp.length >= 16 && windUp.every(point => !RUNES.includes(point.char)));
  assert.ok(extent(windUp) > 1.5, 'motes start well outside the sigil');
  assert.ok(extent(frame('cast', 0.3, { radius: 0.8 }).filter(p => ['.', "'", '+'].includes(p.char)))
    < extent(windUp), 'motes spiral inward');

  const etching = frame('cast', 0.32, { radius: 0.8 });
  const built = frame('cast', 0.74, { radius: 0.8 });
  const strokes = points => points.filter(point => ['-', '/', '\\', '|'].includes(point.char));
  assert.ok(strokes(built).length > strokes(etching).length * 1.5, 'arms keep etching outward');
  assert.deepEqual(RUNES.filter(rune => built.some(point => point.char === rune)), RUNES,
    'a rune settles on every face of the hexagon');
  assert.ok(['-', '/', '\\'].every(char => built.some(point => point.char === char)),
    'arms at 0/60/120 degrees read as clean strokes on the tilted ground');

  const flash = frame('cast', 0.76, { radius: 0.8 });
  assert.ok(flash.some(point => point.char === '@' && point.x === 0 && point.z === 0), 'the seal flashes');
  assert.ok(whiteness(flash) > whiteness(frame('cast', 0.6, { radius: 0.8 })), 'the flash whitens the glyph');

  const late = frame('cast', 0.96, { radius: 0.8 });
  assert.ok(light(late) < light(frame('cast', 0.84, { radius: 0.8 })) * 0.5, 'the glyph thins and fades out');
  assert.ok(late.length < flash.length, 'dissolving glyphs drop out instead of popping');
});

test('stroke glyphs follow the on-screen direction under any heading', () => {
  // At progress 0.74 the cast sigil has turned 0.74 * 0.18 radians; pick its first arm.
  const arm = points => points.filter(point => point.x > 0.5
    && Math.abs(Math.atan2(point.z, point.x) - 0.74 * 0.18) < 0.03 && ['-', '/', '\\', '|'].includes(point.char));
  const flat = arm(frame('cast', 0.74));
  const turned = arm(frame('cast', 0.74, { heading: Math.PI / 2 }));
  assert.ok(flat.length >= 4 && flat.every(point => point.char === '-'));
  assert.ok(turned.length >= 4 && turned.every(point => point.char === '|'));
  assert.deepEqual(frame('zone', 0.5, { life: 8 }), frame('zone', 0.5, { life: 8, heading: Math.PI }),
    'world rotation belongs to the shared runtime');
});

test('the lobbed crystal tumbles with a tapering frost trail and fades in by age', () => {
  const at = age => frame('projectile', age / 10, { life: 10, age, radius: 0.65 });
  assert.equal(lit(at(0)).length, 0, 'nothing pops at the hand on the first frame');
  const flight = at(0.4);
  assert.ok(flight.some(point => point.char === '@' && point.x === 0 && point.z === 0));
  const trail = flight.filter(point => point.z < -0.3);
  assert.ok(trail.length >= 15 && trail.every(point => point.z < 0), 'the trail streams behind');
  const near = trail.filter(point => point.z > -0.6), far = trail.filter(point => point.z < -1);
  assert.ok(light(near) / near.length > light(far) / far.length, 'the trail is bright near the crystal');
  assert.ok(far.every(point => ['.', "'"].includes(point.char)), 'and sparse at its tail');
  assert.notDeepEqual(at(0.4).filter(p => p.z > -0.12), at(0.45).filter(p => p.z > -0.12),
    'the crystal spins');
});

test('impact slams the seal white, bursts shards outward and leaves hanging frost', () => {
  const slam = frame('impact', 0.08, { radius: 1 });
  assert.ok(slam.some(point => point.char === '@'));
  assert.ok(whiteness(slam) > whiteness(frame('impact', 0.5, { radius: 1 })));
  const needles = progress => frame('impact', progress, { radius: 1 }).filter(point => ['*', "'"].includes(point.char));
  assert.ok(extent(needles(0.45)) > extent(needles(0.1)), 'shards fly outward');
  assert.ok(light(frame('impact', 0.85, { radius: 1 })) < light(frame('impact', 0.3, { radius: 1 })) * 0.4);
});

test('pulses ring outward from a six-needle burst, even at the six metre freeze shockwave', () => {
  for (const radius of [1, 3, 6]) {
    const early = frame('pulse', 0.15, { radius, life: 0.25 });
    const late = frame('pulse', 0.6, { radius, life: 0.25 });
    assert.ok(extent(late) > extent(early), `radius ${radius} ring expands`);
    assert.ok(early.length <= BUDGET.pulse);
  }
});

test('frozen targets are encased in upright ice crystals that grow, glint and fade', () => {
  for (const heading of [0, 1.1, Math.PI]) {
    const points = frame('aura', 0.5, { radius: 1, life: 1.5, heading });
    const tips = points.filter(point => point.char === '^');
    assert.ok(tips.length >= 5, 'a ring of crystal tips');
    for (const tip of tips) {
      const screenZ = tip.z * Math.cos(heading) - tip.x * Math.sin(heading);
      assert.ok(screenZ < -0.2, 'crystals stand up on screen whatever the heading');
    }
  }
  const height = progress => -Math.min(...frame('aura', progress, { radius: 1, life: 1.5 }).map(point => point.z));
  assert.ok(height(0.04) < height(0.3), 'the crystals grow');
  assert.ok(lit(frame('aura', 0.5, { radius: 1, life: 0.3 })).length > 20, 'brief re-freeze blips still read');
});

test('the armed glyph etches at the landing spot, holds with runes and a perimeter, then dissolves', () => {
  const zone = (age, extra = {}) => frame('zone', age / 8, { radius: 4, life: 8, ...extra });
  const opening = zone(0.3), armed = zone(4);
  assert.ok(extent(lit(opening)) > 2.5, 'a frost shock ring sweeps out first');
  assert.ok(!opening.some(point => RUNES.includes(point.char)));
  assert.deepEqual(RUNES.filter(rune => armed.some(point => point.char === rune)), RUNES);
  assert.ok(armed.some(point => Math.abs(Math.hypot(point.x, point.z) - 4) < 0.25), 'the trap reach is marked');
  assert.ok(lit(armed).length > 100 && armed.length <= BUDGET.zone);
  assert.notDeepEqual(zone(4), zone(4.5), 'the held glyph breathes and glints');
  assert.ok(zone(7.8).length < armed.length * 0.6, 'the glyph thins as it expires');

  const seed = frame('zone', 0.5, { radius: 4, life: 1 });
  assert.ok(seed.length > 40 && !seed.some(point => RUNES.includes(point.char)),
    'the brief spawn totem only gathers frost before the glyph arms');
});

test('looping rune pulses and glints stay continuous across their wraps', () => {
  const at = (stage, age, radius) => frame(stage, age / 8, { radius, life: 8, age, heading: 0.7 });
  const rune = (points, char) => points.find(point => point.char === char)?.brightness ?? 0;
  // The pulse of rune I wraps at age 1 / 0.7; it used to jump from about 0.45 to 0.75 there.
  const wrap = 1 / 0.7;
  assert.ok(Math.abs(rune(at('zone', wrap - 1e-4, 4), 'I') - rune(at('zone', wrap + 1e-4, 4), 'I')) < 0.005);
  const pulse = Array.from({ length: 30 }, (_, step) => rune(at('zone', 2 + step / 21, 4), 'I'));
  assert.ok(Math.max(...pulse) - Math.min(...pulse) > 0.15, 'the runes still pulse');
  // The arm glint fades in instead of appearing mid-arm at full strength.
  assert.ok(Math.abs(light(at('zone', 1.2 - 1e-4, 4)) - light(at('zone', 1.2 + 1e-4, 4))) < 0.05);

  const steps = (stage, from, to, radius) => {
    let previous = null, total = 0, runes = 0;
    for (let step = 0; from + step * 0.005 <= to; step++) {
      const points = at(stage, from + step * 0.005, radius);
      const now = { light: light(points), runes: RUNES.map(char => rune(points, char)) };
      if (previous) {
        total = Math.max(total, Math.abs(now.light - previous.light));
        runes = Math.max(runes, ...now.runes.map((value, index) => Math.abs(value - previous.runes[index])));
      }
      previous = now;
    }
    return { total, runes };
  };
  const zone = steps('zone', 1, 7, 4);
  assert.ok(zone.runes < 0.03, `held runes never pop: ${zone.runes}`);
  assert.ok(zone.total < 0.4, `the held glyph never pops: ${zone.total}`);
  // Each crystal glint climbs off its tip before restarting at the base.
  const aura = steps('aura', 0.5, 5, 1);
  assert.ok(aura.total < 0.12, `crystal glints never pop: ${aura.total}`);
});

test('every stage stays finite, bounded, deterministic and fades to clear terrain', () => {
  for (const stage of ['cast', 'impact', 'pulse', 'aura', 'zone', 'projectile']) {
    for (const radius of [0.65, 1, 3, 4, 6]) {
      for (const life of [0.25, 1, 1.5, 8]) {
        for (let step = 0; step <= 40; step++) {
          const progress = step / 40;
          const points = frame(stage, progress, { radius, life, heading: 0.7 });
          assert.ok(points.length <= BUDGET[stage], `${stage} ${radius} ${life} ${progress}: ${points.length}`);
          for (const point of points) {
            assert.ok(Number.isFinite(point.x) && Number.isFinite(point.z));
            assert.ok(Math.hypot(point.x, point.z) < 10);
            assert.match(point.char, /^[\x20-\x7e]$/);
            assert.ok(point.color.length === 3 && point.color.every(channel => channel >= 0 && channel <= 255));
            assert.ok(Number.isFinite(point.brightness) && point.brightness >= 0 && point.brightness <= 1);
          }
        }
        assert.equal(frame(stage, 1, { radius, life }).length, 0, `${stage} fully fades`);
      }
    }
    assert.deepEqual(frame(stage, 0.4), frame(stage, 0.4), `${stage} is deterministic`);
    assert.ok(light(frame(stage, 0.97, { life: 8 })) < light(frame(stage, 0.5, { life: 8 })));
  }
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
  let points = [];
  scene.casting.effects.paint((...point) => points.push(point), scene.casting.projectiles);
  assert.ok(points.some(point => point[2] === '@'), 'the lobbed crystal reaches the renderer');
  scene.advance(0.6);
  points = [];
  scene.casting.effects.paint((...point) => points.push(point), scene.casting.projectiles);
  assert.ok(RUNES.some(rune => points.some(point => point[2] === rune)), 'authored runes reach the renderer');
  assert.ok(points.some(point => point[2] === '/'), 'hexagram strokes reach the renderer');
  scene.advance(1.2);
  assert.ok(scene.aura(scene.foe, 'Frozen'), 'the existing armed glyph still freezes contacts');
  assert.ok(scene.casting.effects.list.some(effect => effect.stage === 'aura' && effect.presentation === presentation));
  assert.ok(events.some(event => event.stage === 'impact'), 'freeze seals with the authored chord');
  assert.ok(events.every(event => event.type === 'spell' && event.spellId === definition.id
    && event.presentation === presentation), 'all spell cues carry this profile instead of draw/slam');
});
