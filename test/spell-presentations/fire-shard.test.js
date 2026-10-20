import assert from 'node:assert/strict';
import test from 'node:test';
import presentation from '../../src/spells/presentations/fire-shard.js';
import spell from '../../src/spells/definitions/fire-shard.js';
import { runeScene } from '../../test-support/spells.js';

function capture(stage, progress, extra = {}) {
  const life = extra.life ?? (stage === 'projectile' ? 1 : presentation.duration);
  const points = [];
  const effect = Object.freeze({ stage, age: progress * life, life, progress, radius: 1, heading: 0, ...extra });
  presentation.draw(effect, (x, z, char, color, brightness = 1) => points.push({ x, z, char, color, brightness }));
  return points;
}

const lit = (points, floor = 0.05) => points.filter(point => point.brightness > floor);
const extent = points => Math.max(...points.map(point => Math.hypot(point.x, point.z)));
const spanX = points => Math.max(...points.map(point => point.x)) - Math.min(...points.map(point => point.x));
const meanGreen = points => points.reduce((sum, point) => sum + point.color[1], 0) / points.length;

// Every stage the spell can reach, with the radius each source uses in-game.
const STAGES = [
  ['cast', {}, 200], ['projectile', { radius: 0.65 }, 110], ['impact', {}, 230],
  ['pulse', { radius: 1, life: 0.25 }, 40], ['pulse', { radius: 3, life: 0.25 }, 90],
  ['aura', {}, 200], ['zone', {}, 200],
];

test('Fire Shard keeps every stage bounded, printable, deterministic and fully faded', () => {
  assert.equal(spell.presentation, presentation);
  assert.equal(presentation.id, spell.id);
  for (const [stage, extra, budget] of STAGES) {
    for (const heading of [0, 0.8, Math.PI / 2, 2.6, -2]) {
      for (const progress of [0, 0.05, 0.15, 0.3, 0.5, 0.75, 0.95]) {
        const points = capture(stage, progress, { ...extra, heading });
        assert.ok(points.length <= budget, `${stage} ${progress} plots ${points.length} > ${budget}`);
        for (const point of points) {
          assert.ok([point.x, point.z, point.brightness, ...point.color].every(Number.isFinite));
          assert.ok(Math.abs(point.x) <= 6 && Math.abs(point.z) <= 6);
          assert.match(point.char, /^[\x20-\x7e]$/);
          assert.ok(point.color.length === 3 && point.color.every(channel => channel >= 0 && channel <= 255));
          assert.ok(point.brightness >= 0 && point.brightness <= 1);
        }
      }
      assert.ok(capture(stage, 1, { ...extra, heading }).every(point => point.brightness === 0),
        `${stage} reaches brightness 0 at progress 1`);
      assert.ok(Math.max(0, ...capture(stage, 0.97, { ...extra, heading }).map(point => point.brightness)) < 0.25);
    }
    assert.deepEqual(capture(stage, 0.33, extra), capture(stage, 0.33, extra), 'drawing is a pure function of the clock');
  }
});

test('the shard flies as a faceted crystal pointing along its heading with a braided wake', () => {
  const south = capture('projectile', 0.3, { radius: 0.65 });
  const tip = south.reduce((best, point) => point.z > best.z ? point : best);
  assert.equal(tip.char, 'v', 'heading 0 flies down the screen');
  assert.deepEqual(tip.color, [255, 248, 230], 'the tip is white-hot');
  const east = capture('projectile', 0.3, { radius: 0.65, heading: Math.PI / 2 });
  assert.equal(east.reduce((best, point) => point.z > best.z ? point : best).char, '>');
  assert.ok(east.filter(point => point.char === '-').length >= 8, 'a sideways shard has a long horizontal core');
  const north = capture('projectile', 0.3, { radius: 0.65, heading: Math.PI });
  assert.equal(north.reduce((best, point) => point.z > best.z ? point : best).char, '^');
  const body = south.filter(point => point.z > -0.31);
  assert.ok(body.some(point => point.char === '\\') && body.some(point => point.char === '/'), 'front facets converge');
  assert.ok(spanX(body) < 0.25, 'the shard is a narrow needle');
  const wake = south.filter(point => point.z < -0.4);
  assert.ok(wake.some(point => point.z < -1.4), 'the wake trails well behind');
  assert.ok(Math.max(...wake.map(point => point.color[1])) < 248, 'the wake is cooler than the white-hot core');
  assert.ok(spanX(wake) > spanX(body), 'the wake flares wider than the needle');
  const counts = [0, 0.2, 0.5, 0.999, 1].map(progress => capture('projectile', progress, { radius: 0.65 }).length);
  assert.ok(counts.every(count => count === counts[0]), 'glyph count is constant in flight');
  const length = points => Math.max(...points.map(point => point.z)) - Math.min(...points.filter(point => point.z > -0.35).map(point => point.z));
  assert.ok(length(capture('projectile', 0)) < length(capture('projectile', 0.2)), 'the shard ignites and grows at launch');
  assert.notDeepEqual(capture('projectile', 0.3), capture('projectile', 0.31), 'the wake keeps churning');
  // In-game projectiles live ten seconds but run out of range after one: misses fizzle.
  const flying = Math.max(...capture('projectile', 0.05, { life: 10 }).map(point => point.brightness));
  const fizzling = Math.max(...capture('projectile', 0.095, { life: 10 }).map(point => point.brightness));
  assert.ok(fizzling < flying * 0.5);
});

test('casting snaps two jaws shut, fires a muzzle flash and recoils into embers', () => {
  const wide = capture('cast', 0.01), shut = capture('cast', 0.14);
  assert.ok(spanX(wide) > spanX(shut) * 2, 'the jaws close during the wind-up');
  assert.ok(shut.some(point => point.char === '@'), 'the needle point gathers heat');
  const release = capture('cast', 0.2);
  const flash = release.find(point => point.char === '@');
  assert.ok(flash && flash.brightness > 0.6 && flash.color[2] > 200, 'release flashes white');
  const flare = lit(capture('cast', 0.26)).filter(point => point.z > 1.3);
  assert.ok(flare.length >= 4, 'muzzle streaks shoot ahead of the caster');
  assert.ok(flare.every(point => Math.abs(point.x) < point.z), 'the flare stays in a forward cone');
  assert.ok(!capture('cast', 0.6).some(point => point.char === '@'), 'the flash is gone by the follow-through');
  const late = lit(capture('cast', 0.6), 0.02);
  assert.ok(late.some(point => point.char === '~'), 'heat shimmer rises late');
  assert.ok(meanGreen(late) < meanGreen(lit(capture('cast', 0.2))), 'everything cools toward red');
  assert.ok(lit(capture('cast', 0.9), 0.02).length < lit(capture('cast', 0.4), 0.02).length, 'embers thin out');
});

test('impact flashes white, fractures into splinters and flame tongues, then cools to smoke', () => {
  const flash = capture('impact', 0.03);
  assert.ok(flash.some(point => point.char === '@' && point.brightness > 0.7));
  const burst = lit(capture('impact', 0.3)), early = lit(capture('impact', 0.08));
  const across = lit(capture('impact', 0.3, { heading: Math.PI / 2 })); // rising heat moves sideways in local space
  assert.ok(extent(burst) > extent(early), 'the burst expands');
  assert.ok(burst.length >= 60, 'the burst is dense rather than a scatter of dots');
  assert.ok(burst.some(point => '#%*+'.includes(point.char)) && burst.some(point => point.char === '.'),
    'glyphs ramp from dense core to sparse edge');
  const ahead = across.filter(point => point.z > 0.3).length, behind = across.filter(point => point.z < -0.3).length;
  assert.ok(ahead > behind, 'fragments follow through along the flight path');
  assert.ok(meanGreen(lit(capture('impact', 0.7), 0.02)) < meanGreen(early), 'the fire cools');
  assert.ok(!capture('impact', 0.2).some(point => point.char === '~'));
  assert.ok(capture('impact', 0.6).some(point => point.char === '~'), 'smoke curls up late');
  assert.ok(capture('impact', 0.9).length < capture('impact', 0.3).length, 'the fire thins out instead of popping');
  assert.notDeepEqual(capture('impact', 0.4), capture('impact', 0.42), 'flames and embers keep moving');
});

test('tick visuals scorch a cooling trail and hit visuals ring outward', () => {
  const trail = lit(capture('pulse', 0.1, { radius: 1, life: 0.25 }));
  assert.ok(trail.length >= 8 && trail.length <= 40, 'the trail stays lean');
  assert.ok(trail.filter(point => point.char === '|').length >= 5, 'a streak lies along the flight line');
  assert.ok(trail.filter(point => point.z < -1).length >= 3, 'the streak bridges back to the previous tick');
  assert.ok(lit(capture('pulse', 0.8, { radius: 1, life: 0.25 })).length < trail.length, 'the streak breaks up as it cools');
  const ring = r => capture('pulse', r, { radius: 3, life: 0.25 });
  assert.ok(extent(ring(0.6)) > extent(ring(0.1)) * 1.5, 'the shockwave expands');
  assert.ok(ring(0.1).length >= 50, 'the ring is continuous at first');
  assert.ok(ring(0.85).length < ring(0.1).length, 'the ring thins out');
  assert.notDeepEqual(ring(0.3), capture('impact', 0.3), 'hit rings differ from the fracture burst');
});

test('a real Fire Shard cast paints the profile through every stage and keeps TF damage', () => {
  const scene = runeScene(spell);
  assert.equal(scene.cast().ok, true);
  const launch = [];
  scene.casting.effects.paint((...point) => launch.push(point), scene.casting.projectiles);
  assert.ok(launch.some(point => point[2] === 'v'), 'the shard tip is visible at launch');
  assert.ok(launch.some(point => point[2] === '@'), 'the casting needle point is visible');
  scene.advance(0.15);
  const stages = new Set(scene.casting.effects.list.filter(effect => effect.presentation === presentation).map(effect => effect.stage));
  assert.ok(stages.has('impact') && stages.has('pulse'), 'hits and ticks use the authored profile');
  const hit = [];
  scene.casting.effects.paint((...point) => hit.push(point), scene.casting.projectiles);
  assert.ok(hit.length > 40 && hit.length <= 4096);
  assert.equal(scene.foe.health, 88, 'presentation preserves the 12 TF damage');
});
